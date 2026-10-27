use core::cell::Cell;
use core::ffi::c_void;

use bun_alloc::Arena as ArenaAllocator;
use bun_bundler::transpiler::ParseResult;
use bun_collections::VecCell;
use bun_core::{EncodedSlice, String as BunString, StringView};
use bun_install::{PackageID, Resolution};
use bun_io::KeepAlive;
use bun_resolver::fs as Fs;

use crate::bun_string_jsc;
use crate::virtual_machine::VirtualMachine;
use crate::{
    self as jsc, EncodedSliceJsc as _, ErrorableResolvedSource, JSGlobalObject, JSInternalPromise,
    JSValue, JsError, JsResult, ResolvedSource, StringJsc as _, StrongOptional,
};

bun_core::declare_scope!(AsyncModule, hidden);

pub struct InitOpts<'a> {
    pub parse_result: ParseResult<'static>,
    pub referrer: &'a [u8],
    pub specifier: &'a [u8],
    pub path: Fs::Path<'a>,
    pub promise_ptr: Option<*mut *mut JSInternalPromise>,
    pub arena: Box<ArenaAllocator>,
    /// Backs `parse_result`'s small `AstVec`s (inline bump chunk); must stay
    /// alive alongside `arena` until the module finishes loading.
    pub ast_alloc_state: Option<Box<bun_alloc::ast_alloc::AstAllocState>>,
    /// `ResolvedSource::is_static` of what `parse_result` is printed as.
    pub is_static: bool,
}

pub struct AsyncModule {
    // This is all the state used by the printer to print the module
    pub(crate) parse_result: ParseResult<'static>,
    pub(crate) promise: StrongOptional, // Strong.Optional, default .empty
    /// Packed `referrer ++ specifier ++ path.text`. Owns the bytes; stored as offsets so
    /// the struct stays movable (no self-referential borrows); reconstruct
    /// slices via `referrer()` / `specifier()` / `path_text()`.
    pub(crate) string_buf: Box<[u8]>,
    referrer_len: u32,
    specifier_len: u32,
    // `*JSGlobalObject` is a VM-lifetime backref (BACKREF/JSC_BORROW class in
    // LIFETIMES.tsv); [`crate::GlobalRef`] encapsulates the single audited
    // deref.
    pub global_this: crate::GlobalRef,
    pub(crate) arena: Box<ArenaAllocator>,
    /// See [`InitOpts::ast_alloc_state`].
    pub ast_alloc_state: Option<Box<bun_alloc::ast_alloc::AstAllocState>>,
    /// See [`InitOpts::is_static`].
    is_static: bool,

    // This is the specific state for making it async
    pub(crate) poll_ref: KeepAlive,
}

struct PackageDownloadError<'a> {
    pub name: &'a [u8],
    pub resolution: Resolution,
    pub err: &'static str,
    pub url: &'a [u8],
}

struct PackageResolveError<'a> {
    pub name: &'a [u8],
    pub err: &'static str,
    pub url: &'a [u8],
    pub version: bun_install::dependency::Version,
}

/// The modules that wait for a package. Whoever walks them takes them all out first
/// ([`Queue::take`]), because rejecting a module's promise calls into JavaScriptCore.
///
/// Its entry points are tasks of the event loop, apart from `enqueue`. No reference to the package
/// manager or to the transpiler is held across a turn of the loop, which is what "a task" means
/// in the `SAFETY` comments below.
///
/// FIXME: a macro is the exception. It runs, and turns the macro loop, under the `&mut Transpiler`
/// of the parse that called it.
///
/// FIXME: there is one package manager per process, which the VM of a Worker gets too, and
/// nothing orders one thread's `&mut` to it with another's.
#[derive(Default)]
pub struct Queue {
    map: VecCell<AsyncModule>,
    /// What `run_tasks` reported, until it returns.
    errors: VecCell<PackageError>,
    scheduled: Cell<u32>,
}

enum PackageError {
    Manifest {
        name: Box<[u8]>,
        err: &'static str,
        url: Box<[u8]>,
    },
    Download {
        package_id: PackageID,
        name: Box<[u8]>,
        resolution: Resolution,
        err: &'static str,
        url: Box<[u8]>,
    },
}

/// The `WakeHandler`'s context, kept for the VM's lifetime; the waking threads outlive any one VM.
pub struct WakeContext {
    pub handle: crate::VmHandle,
    pub kind: crate::LoopKind,
}

impl Queue {
    fn take(&self) -> Vec<AsyncModule> {
        self.map.take()
    }

    /// What is left of [`take`](Self::take)'s, ahead of the modules enqueued since.
    fn put_back(&self, mut modules: Vec<AsyncModule>) {
        modules.append(&mut self.map.take());
        drop(self.map.replace(modules));
    }

    pub(crate) fn on_resolve(_: &Queue) {
        bun_core::scoped_log!(AsyncModule, "onResolve");
    }
}

// Taskable: dispatched in `bun_runtime::dispatch::run_task` → `vm.modules.on_poll()`.
impl bun_event_loop::Taskable for Queue {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::PollPendingModulesTask;
    /// A "poll your pending modules" ping from an install thread. It owns nothing and names no
    /// queue (`this` is null): the VM that runs it polls its own.
    unsafe fn release_unrun(_: *mut Self) {}
    /// A ping to the VM's own module queue.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl bun_event_loop::Taskable for AsyncModule {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AsyncModule;
    /// A module whose dependencies finished installing but whose fulfilment
    /// will not run: undo `done()`'s bookkeeping and drop it (its promise
    /// handle, arena and parse result go with the box).
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box `done()` queued.
        let this = unsafe { bun_core::heap::take(this) };
        let scheduled = &VirtualMachine::get().modules.scheduled;
        this.poll_ref.unref(bun_io::js_vm_ctx());
        scheduled.set(scheduled.get() - 1);
    }
    /// Fulfils a module fetch of a loader; calls no script of its own.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl AsyncModule {
    #[inline]
    pub(crate) fn referrer(&self) -> &[u8] {
        &self.string_buf[..self.referrer_len as usize]
    }

    #[inline]
    pub(crate) fn specifier(&self) -> &[u8] {
        let off = self.referrer_len as usize;
        &self.string_buf[off..off + self.specifier_len as usize]
    }

    #[inline]
    pub(crate) fn path_text(&self) -> &[u8] {
        let off = self.referrer_len as usize + self.specifier_len as usize;
        &self.string_buf[off..]
    }

    /// Dispatch the (possibly errored) transpile
    /// result back into JSC via `Bun__onFulfillAsyncModule`. Called from
    /// `RuntimeTranspilerStore::run_from_js_thread` and `on_done` when a
    /// concurrent transpile job finishes.
    /// `module_loader`: the `JSModuleLoader` that fetched, or empty for the global object's.
    pub(crate) fn fulfill(
        global_this: &JSGlobalObject,
        promise: JSValue,
        module_loader: JSValue,
        result: Result<ResolvedSource, crate::CrateError>,
        specifier: &BunString,
        referrer: &BunString,
        log: &mut bun_ast::Log,
    ) -> JsResult<()> {
        jsc::mark_binding();
        let mut errorable = match result {
            Ok(resolved_source) => ErrorableResolvedSource::ok(resolved_source),
            Err(
                crate::CrateError::JSError | crate::CrateError::Bundler(bun_bundler::Error::Js(_)),
            ) => ErrorableResolvedSource::err(global_this.take_error(JsError::Thrown)),
            Err(e) => ErrorableResolvedSource::err(crate::virtual_machine::process_fetch_log(
                global_this,
                specifier,
                referrer,
                log,
                e,
            )),
        };
        bun_core::scoped_log!(AsyncModule, "fulfill: {}", specifier);

        jsc::from_js_host_call_generic(global_this, || {
            Bun__onFulfillAsyncModule(
                global_this,
                promise,
                module_loader,
                &mut errorable,
                specifier,
                referrer,
            )
        })
    }
}

// pub fn deinit → impl Drop. Body only freed owned fields (promise,
// parse_result, arena, string_buf), all of which now have Drop impls on their
// Rust types. No explicit Drop needed; relying on field Drop order.
// bun.default_allocator.free(this.stmt_blocks);
// bun.default_allocator.free(this.expr_blocks);

// safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
// ABI-identical to non-null `*const`); `res` stays owned by this frame — C++
// takes the fields it keeps by transfer (zeroing them) and the rest drops here.
unsafe extern "C" {
    #[allow(improper_ctypes)]
    safe fn Bun__onFulfillAsyncModule(
        global_object: &JSGlobalObject,
        promise_value: JSValue,
        module_loader: JSValue,
        res: &mut ErrorableResolvedSource,
        specifier: &BunString,
        referrer: &BunString,
    );
}

use core::sync::atomic::Ordering;
use std::io::Write as _;

use bun_install::package_manager::run_tasks;
use bun_install::{self as install, LogLevel};

use crate::event_loop::{ConcurrentTaskItem, Task};

/// `RunTasksCallbacks` impl for the auto-install module queue. The errors are only recorded:
/// `run_tasks` has the package manager borrowed, which reporting one reads, and reporting one
/// calls into JavaScriptCore. `progress_bar` selected via const generic to match the
/// `enable_ansi_colors_stderr` branch.
struct QueueRunTasksCallbacks<'a, const PROGRESS: bool>(core::marker::PhantomData<&'a Queue>);

impl<'a, const PROGRESS: bool> run_tasks::RunTasksCallbacks
    for QueueRunTasksCallbacks<'a, PROGRESS>
{
    type Ctx = &'a Queue;

    const PROGRESS_BAR: bool = PROGRESS;
    const HAS_ON_PACKAGE_MANIFEST_ERROR: bool = true;
    const HAS_ON_PACKAGE_DOWNLOAD_ERROR: bool = true;
    const HAS_ON_RESOLVE: bool = true;

    fn on_resolve(ctx: &mut &'a Queue) {
        Queue::on_resolve(ctx)
    }

    fn on_package_manifest_error(
        ctx: &mut &'a Queue,
        name: &[u8],
        err: bun_install::Error,
        url: &[u8],
    ) {
        ctx.errors.push(PackageError::Manifest {
            name: name.into(),
            err: err.name(),
            url: url.into(),
        });
    }

    fn on_package_download_error_pkg(
        ctx: &mut &'a Queue,
        package_id: PackageID,
        name: &[u8],
        resolution: &Resolution,
        err: bun_install::Error,
        url: &[u8],
    ) {
        ctx.errors.push(PackageError::Download {
            package_id,
            name: name.into(),
            resolution: *resolution,
            err: err.name(),
            url: url.into(),
        });
    }
}

impl Queue {
    /// # Safety
    /// No reference to the package manager or to the transpiler is live.
    pub unsafe fn enqueue(&self, global_object: &JSGlobalObject, opts: InitOpts<'_>) {
        bun_core::scoped_log!(AsyncModule, "enqueue: {}", bstr::BStr::new(opts.specifier));
        let module = AsyncModule::init(opts, global_object).expect("unreachable");
        module.poll_ref.ref_(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));

        self.map.push(module);
        // SAFETY: fn contract. It schedules network tasks, which call nothing of ours here.
        unsafe { VirtualMachine::get().package_manager() }.drain_dependency_list();
    }

    /// `WakeHandler::handler` — runs on install / HTTP-callback threads
    /// (`PackageManager::wake_raw`). `ctx` is the [`WakeContext`] registered in
    /// `runtime/jsc_hooks.rs`; the VM is reached only through its handle.
    pub fn on_wake_handler(ctx: *mut c_void, _: *mut c_void) {
        bun_core::scoped_log!(AsyncModule, "onWake");
        // SAFETY: `ctx` is the leaked `WakeContext` registered with this handler.
        let ctx = unsafe { &*ctx.cast::<WakeContext>() };
        let task = ConcurrentTaskItem::create(Task::new(
            <Queue as bun_event_loop::Taskable>::TAG,
            core::ptr::null_mut(),
            bun_event_loop::ContextId::NONE,
        ));
        if let crate::vm_handle::Posted::Refused(task) = ctx.handle.post(ctx.kind, task) {
            // That VM has closed: nobody is waiting on these modules any more.
            // SAFETY: refused ⇒ we own the task box.
            unsafe { drop(bun_core::heap::take(task.as_ptr())) };
        }
    }

    pub fn on_poll(&self) {
        bun_core::scoped_log!(AsyncModule, "onPoll");
        if self.map.is_empty() {
            // A synchronous auto-install drains its own tasks; here their failures would be lost.
            return;
        }
        self.run_tasks();
        self.poll_modules();
    }

    pub(crate) fn run_tasks(&self) {
        // SAFETY: a task. The callbacks `run_tasks` is given do not reach the package manager.
        let pm = unsafe { VirtualMachine::get().package_manager() };
        let mut ctx = self;

        if bun_core::output::enable_ansi_colors_stderr() {
            pm.start_progress_bar_if_none();
            run_tasks::run_tasks::<QueueRunTasksCallbacks<'_, true>>(
                pm,
                &mut ctx,
                true,
                LogLevel::Default,
            )
            .expect("unreachable");
        } else {
            run_tasks::run_tasks::<QueueRunTasksCallbacks<'_, false>>(
                pm,
                &mut ctx,
                true,
                LogLevel::DefaultNoProgress,
            )
            .expect("unreachable");
        }

        for error in self.errors.take() {
            match error {
                PackageError::Manifest { name, err, url } => {
                    self.on_package_manifest_error(&name, err, &url);
                }
                PackageError::Download {
                    package_id,
                    name,
                    resolution,
                    err,
                    url,
                } => self.on_package_download_error(package_id, &name, &resolution, err, &url),
            }
        }
    }

    pub(crate) fn on_package_manifest_error(&self, name: &[u8], err: &'static str, url: &[u8]) {
        bun_core::scoped_log!(
            AsyncModule,
            "onPackageManifestError: {}",
            bstr::BStr::new(name)
        );

        let vm = VirtualMachine::get();
        let mut modules = self.take();
        modules.retain_mut(|module| {
            for pending in module.parse_result.pending_imports.iter() {
                if pending.tag == bun_resolver::PendingResolutionTag::Resolve {
                    if pending.esm.name.slice(&pending.string_buf) != name {
                        continue;
                    }

                    let version = pending.dependency.clone();
                    let import_record_id = pending.import_record_id;

                    module.resolve_error(
                        vm,
                        import_record_id,
                        &PackageResolveError {
                            name,
                            err,
                            url,
                            version,
                        },
                    );
                    return false; // continue :outer
                }
            }
            true
        });
        self.put_back(modules);
    }

    pub(crate) fn on_package_download_error(
        &self,
        package_id: PackageID,
        name: &[u8],
        resolution: &Resolution,
        err: &'static str,
        url: &[u8],
    ) {
        bun_core::scoped_log!(
            AsyncModule,
            "onPackageDownloadError: {}",
            bstr::BStr::new(name)
        );

        let vm = VirtualMachine::get();
        let mut modules = self.take();
        modules.retain_mut(|module| {
            // SAFETY: a task, after `run_tasks` returned its borrow. This one ends before
            // `download_error` takes its own.
            let resolution_ids = unsafe { vm.package_manager() }
                .lockfile
                .buffers
                .resolutions
                .as_slice();
            let Some(import_record_id) = module
                .parse_result
                .pending_imports
                .iter()
                .find(|pending| resolution_ids[pending.root_dependency_id as usize] == package_id)
                .map(|pending| pending.import_record_id)
            else {
                return true;
            };
            module.download_error(
                vm,
                import_record_id,
                &PackageDownloadError {
                    name,
                    resolution: *resolution,
                    err,
                    url,
                },
            );
            false
        });
        self.put_back(modules);
    }

    pub(crate) fn poll_modules(&self) {
        let vm = VirtualMachine::get();
        // SAFETY: a task, after `run_tasks` returned its borrow. What is called below is the
        // package manager's own, and `done`, which queues a task.
        let pm = unsafe { vm.package_manager() };
        if pm.pending_tasks.load(Ordering::Relaxed) > 0 {
            return;
        }
        let mut modules = self.take();

        // Walk by index and `remove(i)` finished modules by value into
        // `done(self)`, so each module's owned fields are dropped exactly once
        // (in `on_done`).
        let mut i = 0;
        while i < modules.len() {
            let (done_count, tags_len) = {
                let module = &mut modules[i];
                let pending_imports = &mut module.parse_result.pending_imports;
                // var esms = module.parse_result.pending_imports.items(.esm);
                // var versions = module.parse_result.pending_imports.items(.dependency);
                let mut done_count: usize = 0;
                let tags_len = pending_imports.len();
                for tag_i in 0..tags_len {
                    let root_id = pending_imports[tag_i].root_dependency_id;
                    let resolution_ids = pm.lockfile.buffers.resolutions.as_slice();
                    if root_id as usize >= resolution_ids.len() {
                        continue;
                    }
                    let package_id = resolution_ids[root_id as usize];

                    match pending_imports[tag_i].tag {
                        bun_resolver::PendingResolutionTag::Resolve => {
                            if package_id == install::INVALID_PACKAGE_ID {
                                continue;
                            }

                            // if we get here, the package has already been resolved.
                            pending_imports[tag_i].tag =
                                bun_resolver::PendingResolutionTag::Download;
                        }
                        bun_resolver::PendingResolutionTag::Download => {
                            if package_id == install::INVALID_PACKAGE_ID {
                                unreachable!();
                            }
                        }
                        bun_resolver::PendingResolutionTag::Done => {
                            done_count += 1;
                            continue;
                        }
                    }

                    if package_id == install::INVALID_PACKAGE_ID {
                        continue;
                    }

                    let package = pm.lockfile.packages.get(package_id as usize);
                    debug_assert!(package.resolution.tag != install::resolution::Tag::Root);
                    let dependency = pm.lockfile.buffers.dependencies[root_id as usize].behavior;

                    let mut name_and_version_hash: Option<u64> = None;
                    let mut patchfile_hash: Option<u64> = None;
                    // The lockfile is reached through `&mut self.lockfile`
                    // (PackageManagerLifecycle.rs) to avoid the
                    // `&mut self`/`&self.lockfile` aliasing borrowck rejects.
                    match pm.determine_preinstall_state(
                        &package,
                        dependency,
                        &mut name_and_version_hash,
                        &mut patchfile_hash,
                    ) {
                        install::PreinstallState::Done => {
                            // we are only truly done if all the dependencies are done.
                            let current_tasks = pm.total_tasks;
                            // so if enqueuing all the dependencies produces no new tasks, we are done.
                            pm.enqueue_dependency_list(package.dependencies);
                            if current_tasks == pm.total_tasks {
                                pending_imports[tag_i].tag =
                                    bun_resolver::PendingResolutionTag::Done;
                                done_count += 1;
                            }
                        }
                        install::PreinstallState::Extracting => {
                            // we are extracting the package
                            // we need to wait for the next poll
                            continue;
                        }
                        install::PreinstallState::Extract => {}
                        _ => {}
                    }
                }
                (done_count, tags_len)
            };

            if done_count == tags_len {
                modules.remove(i).done(vm);
            } else {
                i += 1;
            }
        }
        self.put_back(modules);

        if self.map.is_empty() {
            // ensure we always end the progress bar
            pm.end_progress_bar();
        }
    }
}

/// Points the transpiler, its linker and resolver, and the package manager at `log`.
fn set_log(vm: &VirtualMachine, log: core::ptr::NonNull<bun_ast::Log>) {
    // SAFETY: `resume_loading_module` runs as a task of the event loop and holds no borrow of the
    // transpiler between statements, and nothing in this one runs script or reaches the
    // transpiler through the VM again.
    unsafe { vm.transpiler_mut() }.set_log(log.as_ptr());
    // SAFETY: likewise for the package manager.
    unsafe { vm.package_manager() }.log = log.as_ptr();
}

impl AsyncModule {
    pub(crate) fn init(
        opts: InitOpts<'_>,
        global_object: &JSGlobalObject,
    ) -> Result<AsyncModule, bun_alloc::AllocError> {
        // var stmt_blocks = js_ast.Stmt.Data.toOwnedSlice();
        // var expr_blocks = js_ast.Expr.Data.toOwnedSlice();
        // `JSInternalPromise` aliases `JSPromise` upstream
        // (JSInternalPromise.rs), so `JSPromise::create` is the
        // `createInternalPromise` equivalent.
        let this_promise = crate::JSPromise::create(global_object).to_js();
        let promise = StrongOptional::create(this_promise, global_object);

        let mut buf = bun_core::StringBuilder::default();
        buf.count(opts.referrer);
        buf.count(opts.specifier);
        buf.count(opts.path.text);

        buf.allocate()?;
        // SAFETY: caller guarantees promise_ptr is non-null and points to a valid out-slot.
        unsafe {
            *opts.promise_ptr.unwrap() = this_promise.as_promise().unwrap();
        }
        // Self-referential borrows can't be stored, so capture lengths and pack
        // `referrer ++ specifier ++ path.text` into `string_buf`, then expose
        // them via `referrer()`/`specifier()`/`path_text()`. `move_to_slice()`
        // transfers ownership (resets `buf` so its Drop is a no-op) — exactly
        // one free, via `string_buf`.
        let referrer_len = opts.referrer.len() as u32;
        let specifier_len = opts.specifier.len() as u32;
        let _ = buf.append(opts.referrer);
        let _ = buf.append(opts.specifier);
        let _ = buf.append(opts.path.text);
        let string_buf = buf.move_to_slice();

        Ok(AsyncModule {
            parse_result: opts.parse_result,
            promise,
            string_buf,
            referrer_len,
            specifier_len,
            // .stmt_blocks = stmt_blocks,
            // .expr_blocks = expr_blocks,
            global_this: crate::GlobalRef::new(global_object),
            arena: opts.arena,
            ast_alloc_state: opts.ast_alloc_state,
            is_static: opts.is_static,
            poll_ref: KeepAlive::default(),
        })
    }

    pub(crate) fn done(self, jsc_vm: &VirtualMachine) {
        let scheduled = &jsc_vm.modules.scheduled;
        scheduled.set(scheduled.get() + 1);
        jsc_vm.enqueue_task(Task::from_boxed(Box::new(self)));
    }

    #[allow(
        clippy::boxed_local,
        reason = "reclaim point for the box `done()` handed to the task queue"
    )]
    pub fn on_done(mut this: Box<AsyncModule>) -> JsResult<()> {
        jsc::mark_binding();
        // Copy the `GlobalRef` out (it is `Copy`) so the borrow of `this` ends
        // before `&mut this` reborrows below; deref via the local for the rest
        // of the function. `GlobalRef::deref` encapsulates the JSC_BORROW
        // lifetime invariant, so no raw-pointer deref is open-coded here.
        let global_ref = this.global_this;
        let global_this: &JSGlobalObject = &global_ref;
        let jsc_vm = VirtualMachine::get();
        let scheduled = &jsc_vm.modules.scheduled;
        scheduled.set(scheduled.get() - 1);
        if scheduled.get() == 0 {
            // SAFETY: a task (see `Queue`); the borrow ends with the statement.
            unsafe { jsc_vm.package_manager() }.end_progress_bar();
        }
        let mut log = bun_ast::Log::init();
        this.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        let result = this.resume_loading_module(&mut log);
        let spec = StringView::borrow_utf8(this.specifier());
        let referrer = StringView::borrow_utf8(this.referrer());
        Self::fulfill(
            global_this,
            this.promise.get().unwrap(),
            // Only the global object's loader resolves packages asynchronously (`Bun__transpileFile`).
            JSValue::ZERO,
            result,
            &spec,
            &referrer,
            &mut log,
        )
    }

    fn resolve_error(
        &mut self,
        vm: &VirtualMachine,
        import_record_id: u32,
        result: &PackageResolveError<'_>,
    ) {
        // Copy the `GlobalRef` out so the borrow of `self` ends before
        // `&mut self` reborrows below; `GlobalRef::deref` is the safe
        // JSC_BORROW accessor.
        let global_ref = self.global_this;
        let global_this: &JSGlobalObject = &global_ref;

        let mut msg: Vec<u8> = Vec::new();
        let e = result.err;
        if e == "PackageManifestHTTP400" {
            let _ = write!(
                &mut msg,
                "HTTP 400 while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            );
        } else if e == "PackageManifestHTTP401" {
            let _ = write!(
                &mut msg,
                "HTTP 401 while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            );
        } else if e == "PackageManifestHTTP402" {
            let _ = write!(
                &mut msg,
                "HTTP 402 while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            );
        } else if e == "PackageManifestHTTP403" {
            let _ = write!(
                &mut msg,
                "HTTP 403 while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            );
        } else if e == "PackageManifestHTTP404" {
            let _ = write!(
                &mut msg,
                "Package '{}' was not found",
                bstr::BStr::new(result.name)
            );
        } else if e == "PackageManifestHTTP4xx" {
            let _ = write!(
                &mut msg,
                "HTTP 4xx while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            );
        } else if e == "PackageManifestHTTP5xx" {
            let _ = write!(
                &mut msg,
                "HTTP 5xx while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            );
        } else if matches!(e, "DistTagNotFound" | "NoMatchingVersion") {
            // `Version::try_npm()` performs the tag guard and yields the
            // `NpmInfo` (whose `.version` is the semver query group).
            let npm = result.version.try_npm();
            let prefix: &[u8] =
                if e == "NoMatchingVersion" && npm.map(|n| n.version.is_exact()).unwrap_or(false) {
                    b"Version not found"
                } else if npm.map(|n| !n.version.is_exact()).unwrap_or(false) {
                    b"No matching version found"
                } else {
                    b"No match found"
                };

            // SAFETY: `Queue::run_tasks` has returned its borrow. This one is last used for `msg`,
            // before anything calls into JavaScriptCore.
            let literal = unsafe { vm.package_manager() }
                .lockfile
                .str(&result.version.literal);
            let _ = write!(
                &mut msg,
                "{} '{}' for package '{}' (but package exists)",
                bstr::BStr::new(prefix),
                bstr::BStr::new(literal),
                bstr::BStr::new(result.name)
            );
        } else {
            let _ = write!(
                &mut msg,
                "{} resolving package '{}' at '{}'",
                e,
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            );
        }

        let name: &[u8] = match e {
            "NoMatchingVersion" => b"PackageVersionNotFound",
            "DistTagNotFound" => b"PackageTagNotFound",
            "PackageManifestHTTP403" => b"PackageForbidden",
            "PackageManifestHTTP404" => b"PackageNotFound",
            _ => b"PackageResolveError",
        };

        let error_instance = EncodedSlice::utf8(&msg).to_error_instance(global_this);
        let put_properties = || -> JsResult<()> {
            if !result.url.is_empty() {
                error_instance.put(
                    global_this,
                    b"url",
                    bun_string_jsc::create_utf8_for_js(global_this, result.url)?,
                );
            }
            error_instance.put(
                global_this,
                b"name",
                BunString::static_(name).to_js(global_this)?,
            );
            error_instance.put(
                global_this,
                b"pkg",
                bun_string_jsc::create_utf8_for_js(global_this, result.name)?,
            );
            error_instance.put(
                global_this,
                b"specifier",
                bun_string_jsc::create_utf8_for_js(global_this, self.specifier())?,
            );
            let location = bun_ast::range_data(
                Some(&self.parse_result.source),
                self.parse_result.ast.import_records[import_record_id as usize].range,
                b"",
            )
            .location
            .unwrap();
            error_instance.put(
                global_this,
                b"sourceURL",
                bun_string_jsc::create_utf8_for_js(
                    global_this,
                    self.parse_result.source.path.text,
                )?,
            );
            error_instance.put(
                global_this,
                b"line",
                JSValue::js_number(location.line as f64),
            );
            if let Some(line_text) = location.line_text.as_deref() {
                error_instance.put(
                    global_this,
                    b"lineText",
                    bun_string_jsc::create_utf8_for_js(global_this, line_text)?,
                );
            }
            error_instance.put(
                global_this,
                b"column",
                JSValue::js_number(location.column as f64),
            );
            let referrer = self.referrer();
            if !referrer.is_empty() && referrer != b"undefined" {
                error_instance.put(
                    global_this,
                    b"referrer",
                    bun_string_jsc::create_utf8_for_js(global_this, referrer)?,
                );
            }
            Ok(())
        };
        // Building a property value threw (e.g. STRING_TOO_LONG): reject with
        // the error as built so far rather than an error about the error.
        if put_properties().is_err() {
            let _ = global_this.clear_exception_except_termination();
        }

        let promise_value = self.promise.swap();
        let promise = promise_value.as_internal_promise().unwrap();
        promise_value.ensure_still_alive();
        self.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        // The caller (Queue::retain_mut) returns `false` and Vec drops the
        // element, running Drop.
        // `JSInternalPromise` is an `opaque_ffi!` ZST handle; `opaque_mut` is
        // the centralised non-null deref proof.
        let _ =
            JSInternalPromise::opaque_mut(promise).reject_as_handled(global_this, error_instance);
    }

    fn download_error(
        &mut self,
        vm: &VirtualMachine,
        import_record_id: u32,
        result: &PackageDownloadError<'_>,
    ) {
        // Copy the `GlobalRef` out so the borrow of `self` ends before
        // `&mut self` reborrows below; `GlobalRef::deref` is the
        // safe JSC_BORROW accessor.
        let global_ref = self.global_this;
        let global_this: &JSGlobalObject = &global_ref;

        // SAFETY: `Queue::run_tasks` has returned its borrow. This one is last used for `msg`,
        // before anything calls into JavaScriptCore.
        let string_bytes = unsafe { vm.package_manager() }
            .lockfile
            .buffers
            .string_bytes
            .as_slice();
        let resolution_fmt = bun_core::fmt::redacted(
            result
                .resolution
                .fmt(string_bytes, bun_core::fmt::PathSep::Any),
        );

        let mut msg: Vec<u8> = Vec::new();
        let e = result.err;
        if e == "TarballHTTP400" {
            let _ = write!(
                &mut msg,
                "HTTP 400 downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            );
        } else if e == "TarballHTTP401" {
            let _ = write!(
                &mut msg,
                "HTTP 401 downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            );
        } else if e == "TarballHTTP402" {
            let _ = write!(
                &mut msg,
                "HTTP 402 downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            );
        } else if e == "TarballHTTP403" {
            let _ = write!(
                &mut msg,
                "HTTP 403 downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            );
        } else if e == "TarballHTTP404" {
            let _ = write!(
                &mut msg,
                "HTTP 404 downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            );
        } else if e == "TarballHTTP4xx" {
            let _ = write!(
                &mut msg,
                "HTTP 4xx downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            );
        } else if e == "TarballHTTP5xx" {
            let _ = write!(
                &mut msg,
                "HTTP 5xx downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            );
        } else if e == "TarballFailedToExtract" {
            let _ = write!(
                &mut msg,
                "Failed to extract tarball for package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            );
        } else {
            let _ = write!(
                &mut msg,
                "{} downloading package '{}@{}'",
                e,
                bstr::BStr::new(result.name),
                resolution_fmt
            );
        }

        let name: &[u8] = match e {
            "TarballFailedToExtract" => b"PackageExtractionError",
            "TarballHTTP403" => b"TarballForbiddenError",
            "TarballHTTP404" => b"TarballNotFoundError",
            _ => b"TarballDownloadError",
        };

        let error_instance = EncodedSlice::utf8(&msg).to_error_instance(global_this);
        let put_properties = || -> JsResult<()> {
            if !result.url.is_empty() {
                error_instance.put(
                    global_this,
                    b"url",
                    bun_string_jsc::create_utf8_for_js(global_this, result.url)?,
                );
            }
            error_instance.put(
                global_this,
                b"name",
                BunString::static_(name).to_js(global_this)?,
            );
            error_instance.put(
                global_this,
                b"pkg",
                bun_string_jsc::create_utf8_for_js(global_this, result.name)?,
            );
            let specifier = self.specifier();
            if !specifier.is_empty() && specifier != b"undefined" {
                error_instance.put(
                    global_this,
                    b"referrer",
                    bun_string_jsc::create_utf8_for_js(global_this, specifier)?,
                );
            }

            let location = bun_ast::range_data(
                Some(&self.parse_result.source),
                self.parse_result.ast.import_records[import_record_id as usize].range,
                b"",
            )
            .location
            .unwrap();
            error_instance.put(
                global_this,
                b"specifier",
                bun_string_jsc::create_utf8_for_js(
                    global_this,
                    self.parse_result.ast.import_records[import_record_id as usize]
                        .path
                        .text,
                )?,
            );
            error_instance.put(
                global_this,
                b"sourceURL",
                bun_string_jsc::create_utf8_for_js(
                    global_this,
                    self.parse_result.source.path.text,
                )?,
            );
            error_instance.put(
                global_this,
                b"line",
                JSValue::js_number(location.line as f64),
            );
            if let Some(line_text) = location.line_text.as_deref() {
                error_instance.put(
                    global_this,
                    b"lineText",
                    bun_string_jsc::create_utf8_for_js(global_this, line_text)?,
                );
            }
            error_instance.put(
                global_this,
                b"column",
                JSValue::js_number(location.column as f64),
            );
            Ok(())
        };
        // Building a property value threw (e.g. STRING_TOO_LONG): reject with
        // the error as built so far rather than an error about the error.
        if put_properties().is_err() {
            let _ = global_this.clear_exception_except_termination();
        }

        let promise_value = self.promise.swap();
        let promise = promise_value.as_internal_promise().unwrap();
        promise_value.ensure_still_alive();
        self.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        // Caller drops via retain_mut → false.
        // `JSInternalPromise` is an `opaque_ffi!` ZST handle; `opaque_mut` is
        // the centralised non-null deref proof.
        let _ =
            JSInternalPromise::opaque_mut(promise).reject_as_handled(global_this, error_instance);
    }

    pub(crate) fn resume_loading_module(
        &mut self,
        log: &mut bun_ast::Log,
    ) -> crate::CrateResult<ResolvedSource> {
        bun_core::scoped_log!(
            AsyncModule,
            "resumeLoadingModule: {}",
            bstr::BStr::new(self.specifier())
        );
        // Take `parse_result` by value via `mem::take`, then restore below, to
        // satisfy borrowck around `linker.link(&mut parse_result)` while
        // `self` is also borrowed.
        let arena = *self.parse_result.ast.parts.allocator();
        let mut parse_result =
            core::mem::replace(&mut self.parse_result, ParseResult::empty(arena));
        // SAFETY: `string_buf` is a `Box<[u8]>` whose backing allocation is
        // stable for the lifetime of `*self`; this fn never replaces it, so
        // slices into it remain valid across the `&mut self` reborrows below
        // (`self.parse_result = ...`). Detach the borrow so borrowck doesn't
        // tie `path`/`specifier` to `&self`.
        let specifier: &[u8] = unsafe { bun_ptr::detach_lifetime(self.specifier()) };
        // SAFETY: same `string_buf` stability invariant as `specifier` above —
        // the backing `Box<[u8]>` is never replaced in this fn.
        let path_text: &[u8] = unsafe { bun_ptr::detach_lifetime(self.path_text()) };
        let path = Fs::Path::init(path_text);
        let jsc_vm = VirtualMachine::get();
        // `vm.log` is set unconditionally in `init` and never cleared, so the
        // `expect` is infallible.
        let old_log = jsc_vm.log.get().expect("vm.log set in init");

        set_log(jsc_vm, core::ptr::NonNull::from(&mut *log));
        let _restore = scopeguard::guard((), |()| set_log(jsc_vm, old_log));

        // We _must_ link because:
        // - node_modules bundle won't be properly
        // SAFETY: as in `set_log`. `link` rewrites import records and writes to the log.
        unsafe { jsc_vm.transpiler_mut() }
            .linker
            .link::<false, true>(
                &path,
                &mut parse_result,
                &jsc_vm.origin,
                bun_bundler::options::ImportPathFormat::AbsolutePath,
            )?;
        self.parse_result = parse_result;
        // `print_with_source_map` consumes `ParseResult` by
        // value (it moves `ast` into `print_ast`). Hoist the post-print
        // read (`is_commonjs_module`) above the move so we
        // can `mem::take` instead of cloning.
        let is_commonjs_module = self.parse_result.ast.has_commonjs_export_names
            || self.parse_result.ast.exports_kind == bun_ast::ExportsKind::Cjs;
        let arena = *self.parse_result.ast.parts.allocator();
        let parse_result = core::mem::replace(&mut self.parse_result, ParseResult::empty(arena));

        // `VirtualMachine.source_code_printer` is a thread-local
        // `?*BufferPrinter` (see `SOURCE_CODE_PRINTER`). `BufferPrinter` is `!Clone`, so
        // swap the buffer out and write it back via the `_writeback`
        // guard — same observable effect (the thread-local's buffer is
        // reused). Matches RuntimeTranspilerStore.rs.
        let mut printer_ptr = crate::virtual_machine::SOURCE_CODE_PRINTER
            .get()
            .expect("source_code_printer not initialized");
        // SAFETY: thread-local owns the leaked Box; only this thread touches it.
        let mut printer = core::mem::replace(
            unsafe { printer_ptr.as_mut() },
            bun_js_printer::BufferPrinter::init(bun_js_printer::BufferWriter::init()),
        );
        printer.ctx.reset();
        // The writeback must fire at fn exit,
        // *after* the `printer.ctx.get_written()` reads below. Declare the
        // guard immediately after `printer` so it drops last (locals drop in
        // reverse declaration order) and the buffer is still populated when
        // read.
        let _writeback =
            scopeguard::guard((printer_ptr.as_ptr(), &raw mut printer), |(dst, src)| {
                // SAFETY: `dst` is the thread-local's leaked Box, `src` is the
                // stack `printer`; both outlive this guard (it drops before
                // `printer`). Move the buffer back into the thread-local slot.
                unsafe {
                    *dst = core::mem::replace(
                        &mut *src,
                        bun_js_printer::BufferPrinter::init(bun_js_printer::BufferWriter::init()),
                    )
                };
            });

        {
            let mut mapper = jsc_vm.source_map_handler(&raw mut printer);
            // SAFETY: as in `set_log`. Of the VM, printing reaches only `source_mappings`, through
            // `mapper`.
            let _ = unsafe { jsc_vm.transpiler_mut() }.print_with_source_map(
                // `self.arena` is the same per-call arena that built
                // `parse_result.ast` (handed to the queue via
                // `InitOpts::arena` after the original parse). The
                // printer's rope-flattening scratch belongs in it, not
                // in the per-VM `transpiler_arena`.
                &self.arena,
                parse_result,
                &mut printer,
                bun_js_printer::Format::EsmAscii,
                mapper.get(),
                None,
            )?;
        }

        // `bun_core::env::DUMP_SOURCE` is debug, non-test builds only. The previous
        // `cfg(feature = "dump_source")` gate referenced a feature that doesn't
        // exist, which silently compiled this call out everywhere.
        if bun_core::env::DUMP_SOURCE {
            crate::runtime_transpiler_store::dump_source_string(
                &jsc_vm.source_mappings,
                specifier,
                printer.ctx.get_written(),
            );
        }

        // No watcher registration here: `maybe_watch_file` already ran before
        // the enqueue, and the fd the parse opened may have been closed (and
        // the number recycled) by the transpile frame's fd guard.

        Ok(ResolvedSource {
            source_code: BunString::clone_latin1(printer.ctx.get_written()),
            source_url: BunString::clone_utf8(path.text),
            is_commonjs_module,
            is_static: self.is_static,
            ..Default::default()
        })
    }
}
