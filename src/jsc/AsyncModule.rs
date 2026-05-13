//! Port of `src/jsc/AsyncModule.zig`.
//!
//! B-2 un-gate: real `AsyncModule` / `Queue` / `InitOpts` types compile against
//! the `lib.rs` stub surface so `ModuleLoader` can re-export them and
//! `VirtualMachine.modules` can widen from `()` → `Queue`. `fulfill()` and the
//! `Bun__onFulfillAsyncModule` extern are real (called from
//! `RuntimeTranspilerStore::run_from_js_thread`). The package-manager-driven
//! bodies (`Queue::poll_modules` / `resolve_error` / `download_error` /
//! `resume_loading_module`) are preserved verbatim from the Phase-A draft
//! `bun_install::PackageManager` runTasks / `MultiArrayList` column accessors /
//! `bun_bundler::linker` that aren't wired yet.

use bun_collections::{ByteVecExt, VecExt};
use core::ffi::c_void;
use core::sync::atomic::AtomicU32;

use bun_alloc::Arena as ArenaAllocator;
use bun_bundler::options;
use bun_bundler::transpiler::ParseResult;
use bun_core::{OwnedString, String as BunString, ZigString};
use bun_install::dependency::Dependency;
use bun_install::{DependencyID, Resolution};
use bun_io::KeepAlive;
use bun_options_types::LoaderExt as _;
use bun_options_types::schema::api;
use bun_resolver::fs as Fs;
use bun_resolver::package_json::PackageJSON;
use bun_sys::Fd;

use crate::virtual_machine::VirtualMachine;
use crate::{
    self as jsc, ErrorableResolvedSource, JSGlobalObject, JSInternalPromise, JSValue, JsError,
    JsResult, ResolvedSource, StrongOptional, ZigStringJsc as _,
};

bun_core::declare_scope!(AsyncModule, hidden);

pub struct InitOpts<'a> {
    pub parse_result: ParseResult,
    pub referrer: &'a [u8],
    pub specifier: &'a [u8],
    pub path: Fs::Path<'a>,
    pub promise_ptr: Option<*mut *mut JSInternalPromise>,
    pub fd: Option<Fd>,
    pub package_json: Option<&'a PackageJSON>,
    pub loader: bun_ast::Loader,
    pub hash: u32,
    pub arena: Box<ArenaAllocator>,
}

pub struct AsyncModule {
    // This is all the state used by the printer to print the module
    pub parse_result: ParseResult,
    pub promise: StrongOptional, // Strong.Optional, default .empty
    /// Packed `referrer ++ specifier ++ path.text`. Owns the bytes that the
    /// Zig version aliased via `buf.allocatedSlice()`. Stored as offsets so
    /// the struct stays movable (no self-referential borrows); reconstruct
    /// slices via `referrer()` / `specifier()` / `path_text()`.
    pub string_buf: Box<[u8]>,
    referrer_len: u32,
    specifier_len: u32,
    pub fd: Option<Fd>,
    // PORT NOTE: `?*PackageJSON` / `*JSGlobalObject` — both are VM-lifetime
    // backrefs (BACKREF/JSC_BORROW class in LIFETIMES.tsv). `package_json` is
    // stored as a raw ptr so `AsyncModule` is `'static`-embeddable in
    // `Queue`/`VirtualMachine` without a phantom lifetime; `global_this` uses
    // [`crate::GlobalRef`] which encapsulates the single audited deref.
    pub package_json: Option<core::ptr::NonNull<PackageJSON>>,
    pub loader: api::Loader,
    pub hash: u32, // default = u32::MAX
    pub global_this: crate::GlobalRef,
    pub arena: Box<ArenaAllocator>,

    // This is the specific state for making it async
    pub poll_ref: KeepAlive,
    pub any_task: bun_event_loop::AnyTask::AnyTask,
}

pub type Id = u32;

pub struct PackageDownloadError<'a> {
    pub name: &'a [u8],
    pub resolution: Resolution,
    pub err: bun_core::Error,
    pub url: &'a [u8],
}

pub struct PackageResolveError<'a> {
    pub name: &'a [u8],
    pub err: bun_core::Error,
    pub url: &'a [u8],
    pub version: bun_install::dependency::Version,
}

#[allow(dead_code)]
pub struct DeferredDependencyError {
    pub dependency: Dependency,
    pub root_dependency_id: DependencyID,
    pub err: bun_core::Error,
}

pub type Map = Vec<AsyncModule>;

#[derive(Default)]
pub struct Queue {
    pub map: Map,
    pub scheduled: u32,
    pub concurrent_task_count: AtomicU32,
}

impl Queue {
    /// Recover the owning VM.
    ///
    /// S017: dropped `container_of` recovery — provenance of `&mut self`
    /// (which only covers `vm.modules`) cannot soundly widen to the whole
    /// `VirtualMachine` under Stacked Borrows (see the analogous note on
    /// `ExitHandler::dispatch_on_exit`). Route through the per-thread
    /// singleton instead: same pointer, full-allocation provenance via
    /// [`VirtualMachine::get_mut_ptr`], and no `unsafe` at the call site.
    /// `&mut self` is kept as a receiver so existing callers
    /// (`self.vm().package_manager()`) don't change shape.
    #[inline]
    pub fn vm(&mut self) -> &mut VirtualMachine {
        VirtualMachine::get().as_mut()
    }

    pub fn on_resolve(_: &mut Queue) {
        bun_core::scoped_log!(AsyncModule, "onResolve");
    }
}

// Taskable: `Queue` is enqueued via `ConcurrentTask::create_from(this)` in
// `on_wake_handler` and dispatched in `bun_runtime::dispatch::run_task` →
// `vm.modules.on_poll()` (Zig: `PollPendingModulesTask`). The pointer is a
// borrow into `VirtualMachine.modules`, never freed by the dispatcher.
impl bun_event_loop::Taskable for Queue {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::PollPendingModulesTask;
}

impl AsyncModule {
    #[inline]
    pub fn referrer(&self) -> &[u8] {
        &self.string_buf[..self.referrer_len as usize]
    }

    #[inline]
    pub fn specifier(&self) -> &[u8] {
        let off = self.referrer_len as usize;
        &self.string_buf[off..off + self.specifier_len as usize]
    }

    #[inline]
    pub fn path_text(&self) -> &[u8] {
        let off = self.referrer_len as usize + self.specifier_len as usize;
        &self.string_buf[off..]
    }

    /// Spec AsyncModule.zig:412-460. Dispatch the (possibly errored) transpile
    /// result back into JSC via `Bun__onFulfillAsyncModule`. This is the entry
    /// point `RuntimeTranspilerStore::run_from_js_thread` calls when a
    /// concurrent transpile job finishes.
    pub fn fulfill(
        global_this: &JSGlobalObject,
        promise: JSValue,
        resolved_source: &mut ResolvedSource,
        err: Option<bun_core::Error>,
        specifier_: BunString,
        referrer_: BunString,
        log: &mut bun_ast::Log,
    ) -> JsResult<()> {
        jsc::mark_binding();
        let mut specifier = specifier_;
        let mut referrer = referrer_;
        // PORT NOTE: Zig `defer { specifier.deref(); referrer.deref(); scope.deinit(); }` —
        // BunString is `Copy` in the Rust port (no Drop), so deref the held
        // refcounts explicitly via scopeguard. The `TopExceptionScope` is
        // omitted: `from_js_host_call_generic` already checks the VM for a
        // pending exception after the FFI call (host_fn.rs).
        //
        // The guard captures raw pointers to the locals (not by-value copies)
        // so the deref observes the *post-FFI* value of the variable, matching
        // Zig `defer` semantics — `Bun__onFulfillAsyncModule` receives
        // `&mut specifier`/`&mut referrer` and is free to overwrite them.
        // Safety: `specifier`/`referrer` are declared above this guard, so
        // they outlive it (locals drop in reverse order); the `&mut` reborrow
        // passed to FFI below is dead by the time the guard runs.
        let sp: *mut BunString = &raw mut specifier;
        let rp: *mut BunString = &raw mut referrer;
        let _strings_guard = scopeguard::guard((), move |()| unsafe {
            (*sp).deref();
            (*rp).deref();
        });

        let mut errorable: ErrorableResolvedSource;
        if let Some(e) = err {
            // PORT NOTE: inner Zig `defer { if (needs_deref) { needs_deref = false;
            // source_code.deref(); } }` — `OwnedString` derefs on Drop at the end
            // of this `if` arm; `None` is the no-op path.
            let _source_code_guard = if resolved_source.source_code_needs_deref {
                resolved_source.source_code_needs_deref = false;
                Some(OwnedString::new(resolved_source.source_code))
            } else {
                None
            };

            if e == bun_core::err!("JSError") {
                errorable = ErrorableResolvedSource::err(
                    bun_core::err!("JSError"),
                    global_this.take_error(JsError::Thrown),
                );
            } else {
                // Spec AsyncModule.zig:440-447 —
                // `VirtualMachine.processFetchLog(globalThis, specifier,
                // referrer, log, &errorable, e)` synthesizes a JS
                // Error/AggregateError from the parser log and writes it into
                // `errorable.result.err.value`. Without this the import promise
                // would reject with `undefined` (ModuleLoader.cpp:473).
                // PORT NOTE: call the `virtual_machine` impl directly (takes
                // `&JSGlobalObject`) instead of the `module_loader` shim that
                // takes `*mut` — avoids a `&T as *const T as *mut T` cast,
                // which is UB-adjacent under Stacked Borrows even when the
                // callee never writes through it.
                errorable = ErrorableResolvedSource::err(e, JSValue::UNDEFINED);
                crate::virtual_machine::process_fetch_log(
                    global_this,
                    specifier,
                    referrer,
                    log,
                    &mut errorable,
                    e,
                );
            }
        } else {
            errorable = ErrorableResolvedSource::ok(*resolved_source);
        }
        // TODO(port): Zig calls log.deinit() here explicitly (early), then uses
        // specifier after. In Rust, caller owns `log`; we leave it to caller's
        // Drop. Verify no behavioral diff.

        bun_core::scoped_log!(AsyncModule, "fulfill: {}", specifier);

        jsc::from_js_host_call_generic(global_this, || {
            Bun__onFulfillAsyncModule(
                global_this,
                promise,
                &mut errorable,
                &mut specifier,
                &mut referrer,
            )
        })
    }
}

// PORT NOTE: pub fn deinit → impl Drop. Body only freed owned fields (promise,
// parse_result, arena, string_buf), all of which now have Drop impls on their
// Rust types. No explicit Drop needed; relying on field Drop order.
// bun.default_allocator.free(this.stmt_blocks);
// bun.default_allocator.free(this.expr_blocks);

// TODO(port): move to <area>_sys
//
// safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
// ABI-identical to non-null `*const`); `ErrorableResolvedSource`/`BunString`
// are `#[repr(C)]` payloads whose `&mut` is exclusive for the call. C++ reads
// from / writes through these in-place; no caller-side raw-pointer precondition.
unsafe extern "C" {
    safe fn Bun__onFulfillAsyncModule(
        global_object: &JSGlobalObject,
        promise_value: JSValue,
        res: &mut ErrorableResolvedSource,
        specifier: &mut BunString,
        referrer: &mut BunString,
    );
}

use core::sync::atomic::Ordering;
use std::io::Write as _;

use bun_core::strings;
use bun_install::package_manager::run_tasks;
use bun_install::{self as install, LogLevel, PackageID, PackageManager};

use crate::event_loop::{AnyTask, ConcurrentTaskItem, Task};

/// `RunTasksCallbacks` impl for the auto-install module queue. Mirrors the Zig
/// anonymous `comptime callbacks: anytype` struct passed at
/// AsyncModule.zig:108-133 — `onExtract = void`, `onResolve` /
/// `onPackageManifestError` / `onPackageDownloadError` forward to the `Queue`
/// methods, `progress_bar` selected via const generic to match the
/// `enable_ansi_colors_stderr` branch.
struct QueueRunTasksCallbacks<const PROGRESS: bool>;

impl<const PROGRESS: bool> run_tasks::RunTasksCallbacks for QueueRunTasksCallbacks<PROGRESS> {
    type Ctx = Queue;

    const PROGRESS_BAR: bool = PROGRESS;
    const HAS_ON_PACKAGE_MANIFEST_ERROR: bool = true;
    const HAS_ON_PACKAGE_DOWNLOAD_ERROR: bool = true;
    const HAS_ON_RESOLVE: bool = true;

    fn on_resolve(ctx: &mut Queue) {
        Queue::on_resolve(ctx)
    }

    fn on_package_manifest_error(ctx: &mut Queue, name: &[u8], err: bun_core::Error, url: &[u8]) {
        ctx.on_package_manifest_error(name, err, url)
    }

    fn on_package_download_error_pkg(
        ctx: &mut Queue,
        package_id: PackageID,
        name: &[u8],
        resolution: &Resolution,
        err: bun_core::Error,
        url: &[u8],
    ) {
        ctx.on_package_download_error(package_id, name, resolution, err, url)
    }
}

impl Queue {
    pub fn enqueue(&mut self, global_object: &JSGlobalObject, opts: InitOpts<'_>) {
        bun_core::scoped_log!(AsyncModule, "enqueue: {}", bstr::BStr::new(opts.specifier));
        let mut module = AsyncModule::init(opts, global_object).expect("unreachable");
        module.poll_ref.ref_(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));

        // PORT NOTE: allocator arg dropped (Vec uses global mimalloc).
        self.map.push(module);
        // PERF(port): was assume_capacity-free append
        self.vm().package_manager().drain_dependency_list();
    }

    pub fn on_dependency_error(
        ctx: *mut c_void,
        dependency: &Dependency,
        root_dependency_id: DependencyID,
        err: bun_core::Error,
    ) {
        // SAFETY: ctx was registered as *Queue when installing this callback.
        let this: &mut Queue = unsafe { bun_ptr::callback_ctx::<Queue>(ctx) };
        bun_core::scoped_log!(
            AsyncModule,
            "onDependencyError: {}",
            bstr::BStr::new(this.vm().package_manager().lockfile.str(&dependency.name))
        );

        // PORT NOTE: reshaped for borrowck — Zig iterated copies and
        // compacted in place; Rust uses retain_mut and lets Drop free
        // removed modules.
        this.map.retain_mut(|module| {
            // PORT NOTE: Zig `MultiArrayList.items(.root_dependency_id)` →
            // `Vec<PendingResolution>` field walk.
            for (dep_i, pending) in module.parse_result.pending_imports.iter().enumerate() {
                if pending.root_dependency_id != root_dependency_id {
                    continue;
                }
                let import_record_id = pending.import_record_id;
                // S017: per-thread VM singleton (safe accessor) instead of
                // `container_of`-derived `*mut`; provenance is the original
                // allocation, disjoint from the `&mut module` borrow above.
                let vm = VirtualMachine::get().as_mut();
                // PORT NOTE: reshaped for borrowck — `lockfile.str()` ties the
                // returned slice to `&vm`, which conflicts with passing
                // `&mut vm` to `resolve_error`. The lockfile string buffer is
                // stable across `resolve_error` (no realloc on the error
                // path); detach the borrow via raw ptr.
                let name =
                    bun_ptr::RawSlice::new(vm.package_manager().lockfile.str(&dependency.name));
                module
                    .resolve_error(
                        vm,
                        import_record_id,
                        PackageResolveError {
                            name: name.slice(),
                            err,
                            url: b"",
                            version: dependency.version.clone(),
                        },
                    )
                    .expect("unreachable");
                return false; // continue :outer — drop this module
            }
            true
        });
    }

    pub fn on_wake_handler(ctx: *mut c_void, _: *mut c_void) {
        bun_core::scoped_log!(AsyncModule, "onWake");
        let queue = ctx.cast::<Queue>();
        let task = ConcurrentTaskItem::create_from(queue);
        // Runs on thread-pool / HTTP-callback threads (PackageManager::wake_raw)
        // where the per-thread `VirtualMachine::get()` singleton is NOT
        // installed — using it here would panic. `ctx` was registered as
        // `addr_of_mut!((*vm).modules)` from a raw `*mut VirtualMachine`
        // (runtime/jsc_hooks.rs), so its provenance covers the whole VM and
        // `from_field_ptr!` is sound. S017 does not apply: that rule forbids
        // widening from a `&mut self`-derived pointer, but `ctx` is a raw
        // `*mut` carried from the original allocation.
        let vm = unsafe { &mut *bun_core::from_field_ptr!(VirtualMachine, modules, queue) };
        vm.enqueue_task_concurrent(task);
    }

    pub fn on_poll(&mut self) {
        bun_core::scoped_log!(AsyncModule, "onPoll");
        self.run_tasks();
        self.poll_modules();
    }

    pub fn run_tasks(&mut self) {
        // PORT NOTE: reshaped for borrowck — Zig held `pm` across the call
        // while passing `this` (which can recover `pm` via
        // `@fieldParentPtr`). The Rust `run_tasks` free fn takes both
        // `&mut PackageManager` and `&mut Queue`; the package manager is a
        // separate heap allocation (`NonNull<dyn AutoInstaller>` on the
        // resolver), so the two borrows are disjoint.
        // S017: per-thread VM singleton (safe accessor) instead of
        // `container_of`-derived `*mut` reborrow.
        let pm = VirtualMachine::get().as_mut().package_manager();

        if bun_core::output::enable_ansi_colors_stderr() {
            pm.start_progress_bar_if_none();
            run_tasks::run_tasks::<QueueRunTasksCallbacks<true>>(pm, self, true, LogLevel::Default)
                .expect("unreachable");
        } else {
            run_tasks::run_tasks::<QueueRunTasksCallbacks<false>>(
                pm,
                self,
                true,
                LogLevel::DefaultNoProgress,
            )
            .expect("unreachable");
        }
    }

    pub fn on_package_manifest_error(&mut self, name: &[u8], err: bun_core::Error, url: &[u8]) {
        bun_core::scoped_log!(
            AsyncModule,
            "onPackageManifestError: {}",
            bstr::BStr::new(name)
        );

        // PORT NOTE: reshaped for borrowck — compaction loop → retain_mut.
        self.map.retain_mut(|module| {
            // PORT NOTE: Zig `MultiArrayList.items(.tag)` etc. →
            // `Vec<PendingResolution>` field walk.
            for (tag_i, pending) in module.parse_result.pending_imports.iter().enumerate() {
                if pending.tag == bun_resolver::PendingResolutionTag::Resolve {
                    if pending.esm.name.slice(&pending.string_buf) != name {
                        continue;
                    }

                    let version = pending.dependency.clone();
                    let import_record_id = pending.import_record_id;

                    // S017: per-thread VM singleton (safe accessor).
                    let vm = VirtualMachine::get().as_mut();
                    module
                        .resolve_error(
                            vm,
                            import_record_id,
                            PackageResolveError {
                                name,
                                err,
                                url,
                                version,
                            },
                        )
                        .expect("unreachable");
                    return false; // continue :outer
                }
            }
            true
        });
    }

    pub fn on_package_download_error(
        &mut self,
        package_id: PackageID,
        name: &[u8],
        resolution: &Resolution,
        err: bun_core::Error,
        url: &[u8],
    ) {
        bun_core::scoped_log!(
            AsyncModule,
            "onPackageDownloadError: {}",
            bstr::BStr::new(name)
        );

        // S017: per-thread VM singleton (safe accessor) instead of
        // `container_of`-derived `*mut` reborrow. `resolution_ids` borrows the
        // lockfile (separate heap allocation, never reallocated on the
        // download-error path); detach via `RawSlice` so the closure can fetch
        // a fresh `&mut VirtualMachine` without borrowck tying it to this read.
        let resolution_ids = bun_ptr::RawSlice::new(
            VirtualMachine::get()
                .as_mut()
                .package_manager()
                .lockfile
                .buffers
                .resolutions
                .as_slice(),
        );

        // PORT NOTE: reshaped for borrowck — compaction loop → retain_mut.
        self.map.retain_mut(|module| {
            // PORT NOTE: Zig `MultiArrayList.items(.import_record_id)` /
            // `.items(.root_dependency_id)` → `Vec<PendingResolution>` field
            // walk.
            for pending in module.parse_result.pending_imports.iter() {
                if resolution_ids.slice()[pending.root_dependency_id as usize] != package_id {
                    continue;
                }
                let import_record_id = pending.import_record_id;
                // S017: per-thread VM singleton (safe accessor).
                let vm = VirtualMachine::get().as_mut();
                module
                    .download_error(
                        vm,
                        import_record_id,
                        PackageDownloadError {
                            name,
                            resolution: resolution.clone(),
                            err,
                            url,
                        },
                    )
                    .expect("unreachable");
                return false; // continue :outer
            }
            true
        });
    }

    pub fn poll_modules(&mut self) {
        // S017: per-thread VM singleton (safe accessor) instead of
        // `container_of`-derived `*mut` reborrow. The package manager is a
        // separate heap allocation, disjoint from `self` (= `vm.modules`).
        let pm = VirtualMachine::get().as_mut().package_manager();
        if pm.pending_tasks.load(Ordering::Relaxed) > 0 {
            return;
        }

        // PORT NOTE: reshaped for borrowck — Zig compacted by index then
        // truncated `items.len` without running deinit on finished slots. Rust
        // walks by index and `remove(i)` finished modules by value into
        // `done(self)`, so each module's owned fields are dropped exactly once
        // (in `on_done`).
        let mut i = 0;
        while i < self.map.len() {
            let (done_count, tags_len) = {
                let module = &mut self.map[i];
                // PORT NOTE: Zig `MultiArrayList.items(.tag)` /
                // `.items(.root_dependency_id)` → `Vec<PendingResolution>`
                // field walk via `iter_mut()`.
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

                    let mut name_and_version_hash: Option<u64> = None;
                    let mut patchfile_hash: Option<u64> = None;
                    // PORT NOTE: Zig passed `pm.lockfile` as a separate arg;
                    // the Rust port collapsed it onto `&mut self.lockfile`
                    // (PackageManagerLifecycle.rs) to avoid the
                    // `&mut self`/`&self.lockfile` aliasing borrowck rejects.
                    match pm.determine_preinstall_state(
                        &package,
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
                let module = self.map.remove(i);
                // S017: per-thread VM singleton (safe accessor).
                module.done(VirtualMachine::get().as_mut());
            } else {
                i += 1;
            }
        }

        if self.map.is_empty() {
            // ensure we always end the progress bar
            self.vm().package_manager().end_progress_bar();
        }
    }
}

impl AsyncModule {
    pub fn init(
        opts: InitOpts<'_>,
        global_object: &JSGlobalObject,
    ) -> Result<AsyncModule, bun_alloc::AllocError> {
        // var stmt_blocks = js_ast.Stmt.Data.toOwnedSlice();
        // var expr_blocks = js_ast.Expr.Data.toOwnedSlice();
        // PORT NOTE: `JSInternalPromise` aliases `JSPromise` upstream
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
        // PORT NOTE: Zig kept three aliasing slices into `buf` plus
        // `buf.allocatedSlice()` as the owning storage. Rust can't store
        // self-referential borrows, so capture lengths and pack
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
            fd: opts.fd,
            package_json: opts.package_json.map(core::ptr::NonNull::from),
            loader: opts.loader.to_api(),
            hash: opts.hash,
            // .stmt_blocks = stmt_blocks,
            // .expr_blocks = expr_blocks,
            global_this: crate::GlobalRef::new(global_object),
            arena: opts.arena,
            poll_ref: KeepAlive::default(),
            any_task: AnyTask::AnyTask::default(),
        })
    }

    pub fn done(self, jsc_vm: &mut VirtualMachine) {
        // PORT NOTE: Zig `allocator.create` + bitwise copy then truncated the
        // queue without running deinit on the discarded slot — single
        // ownership transfers to the heap clone. In Rust the caller
        // (`Queue::poll_modules`) removes the element by value and passes it
        // here, so `Box::new(self)` is the same single transfer with no
        // `ptr::read` and no double-Drop.
        let clone = bun_core::heap::into_raw(Box::new(self));
        jsc_vm.modules.scheduled += 1;
        // SAFETY: clone is a valid heap::alloc allocation owned by the
        // task queue until on_done reclaims it via heap::take; we hold
        // the only reference here.
        unsafe {
            // PORT NOTE: Zig `AnyTask.New(AsyncModule, onDone).init(clone)` —
            // Rust cannot take a fn as const generic, so hand-write the shim
            // (option (b) in event_loop/AnyTask.rs).
            (*clone).any_task = AnyTask::AnyTask {
                ctx: Some(core::ptr::NonNull::new_unchecked(clone).cast()),
                callback: |p| {
                    Self::on_done(p.cast());
                    Ok(())
                },
            };
            jsc_vm.enqueue_task(Task::init(&raw mut (*clone).any_task));
        }
    }

    pub fn on_done(this: *mut AsyncModule) {
        jsc::mark_binding();
        // SAFETY: `this` was heap-allocated in `done`; reclaimed at end of this fn.
        let this = unsafe { &mut *this };
        // Copy the `GlobalRef` out (it is `Copy`) so the borrow of `this` ends
        // before `&mut this` reborrows below; deref via the local for the rest
        // of the function. `GlobalRef::deref` encapsulates the JSC_BORROW
        // lifetime invariant, so no raw-pointer deref is open-coded here.
        let global_ref = this.global_this;
        let global_this: &JSGlobalObject = &global_ref;
        // SAFETY: `VirtualMachine::get()` is the live per-thread VM (one VM per
        // thread); the Zig `globalThis.bunVM()` returns the same pointer.
        let jsc_vm = VirtualMachine::get().as_mut();
        jsc_vm.modules.scheduled -= 1;
        if jsc_vm.modules.scheduled == 0 {
            jsc_vm.package_manager().end_progress_bar();
        }
        let mut log = bun_ast::Log::init();
        this.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        let errorable: ErrorableResolvedSource = match this.resume_loading_module(&mut log) {
            Ok(rs) => ErrorableResolvedSource::ok(rs),
            Err(err) if err == bun_core::err!("JSError") => ErrorableResolvedSource::err(
                bun_core::err!("JSError"),
                global_this.take_error(JsError::Thrown),
            ),
            Err(err) => {
                // PORT NOTE: Zig declared `errorable = undefined` and relied on
                // `processFetchLog` writing the out-param. Rust pre-seeds the
                // err so the `&mut` borrow is definitely-initialized;
                // `process_fetch_log` overwrites `result.err.value`.
                let mut errorable = ErrorableResolvedSource::err(err, JSValue::UNDEFINED);
                crate::virtual_machine::process_fetch_log(
                    global_this,
                    BunString::init(ZigString::init(this.specifier())),
                    BunString::init(ZigString::init(this.referrer())),
                    &mut log,
                    &mut errorable,
                    err,
                );
                errorable
            }
        };
        let mut errorable = errorable;
        // log dropped at scope exit (defer log.deinit()).

        let mut spec = BunString::init(ZigString::from_bytes(this.specifier()).with_encoding());
        let mut ref_ = BunString::init(ZigString::from_bytes(this.referrer()).with_encoding());
        let _ = jsc::from_js_host_call_generic(global_this, || {
            Bun__onFulfillAsyncModule(
                global_this,
                this.promise.get().unwrap(),
                &mut errorable,
                &mut spec,
                &mut ref_,
            )
        });
        // SAFETY: reclaim the Box allocated in `done`; Drop runs deinit logic.
        drop(unsafe { bun_core::heap::take(this) });
    }

    // TODO(port): narrow error set to bun_alloc::AllocError — Zig body only
    // `try`s std.fmt.allocPrint (OOM-only). write! into Vec<u8> is
    // infallible here; `.ok()` collapses the `fmt::Result`.
    fn resolve_error(
        &mut self,
        vm: &mut VirtualMachine,
        import_record_id: u32,
        result: PackageResolveError<'_>,
    ) -> Result<(), bun_core::Error> {
        // Copy the `GlobalRef` out so the borrow of `self` ends before
        // `&mut self` reborrows below; `GlobalRef::deref` is the safe
        // JSC_BORROW accessor.
        let global_ref = self.global_this;
        let global_this: &JSGlobalObject = &global_ref;

        let mut msg: Vec<u8> = Vec::new();
        let e = result.err;
        if e == bun_core::err!("PackageManifestHTTP400") {
            write!(
                &mut msg,
                "HTTP 400 while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            )
            .ok();
        } else if e == bun_core::err!("PackageManifestHTTP401") {
            write!(
                &mut msg,
                "HTTP 401 while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            )
            .ok();
        } else if e == bun_core::err!("PackageManifestHTTP402") {
            write!(
                &mut msg,
                "HTTP 402 while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            )
            .ok();
        } else if e == bun_core::err!("PackageManifestHTTP403") {
            write!(
                &mut msg,
                "HTTP 403 while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            )
            .ok();
        } else if e == bun_core::err!("PackageManifestHTTP404") {
            write!(
                &mut msg,
                "Package '{}' was not found",
                bstr::BStr::new(result.name)
            )
            .ok();
        } else if e == bun_core::err!("PackageManifestHTTP4xx") {
            write!(
                &mut msg,
                "HTTP 4xx while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            )
            .ok();
        } else if e == bun_core::err!("PackageManifestHTTP5xx") {
            write!(
                &mut msg,
                "HTTP 5xx while resolving package '{}' at '{}'",
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            )
            .ok();
        } else if e == bun_core::err!("DistTagNotFound") || e == bun_core::err!("NoMatchingVersion")
        {
            // PORT NOTE: Zig peeks at the tagged-union via
            // `result.version.tag == .npm and
            // result.version.value.npm.version.isExact()`. The Rust
            // `Version::try_npm()` performs the tag guard and yields the
            // `NpmInfo` (whose `.version` is the semver query group).
            let npm = result.version.try_npm();
            let prefix: &[u8] = if e == bun_core::err!("NoMatchingVersion")
                && npm.map(|n| n.version.is_exact()).unwrap_or(false)
            {
                b"Version not found"
            } else if npm.map(|n| !n.version.is_exact()).unwrap_or(false) {
                b"No matching version found"
            } else {
                b"No match found"
            };

            write!(
                &mut msg,
                "{} '{}' for package '{}' (but package exists)",
                bstr::BStr::new(prefix),
                bstr::BStr::new(vm.package_manager().lockfile.str(&result.version.literal)),
                bstr::BStr::new(result.name)
            )
            .ok();
        } else {
            write!(
                &mut msg,
                "{} resolving package '{}' at '{}'",
                e.name(),
                bstr::BStr::new(result.name),
                bstr::BStr::new(result.url)
            )
            .ok();
        }
        // msg dropped at scope exit (defer bun.default_allocator.free(msg)).

        let name: &[u8] = if e == bun_core::err!("NoMatchingVersion") {
            b"PackageVersionNotFound"
        } else if e == bun_core::err!("DistTagNotFound") {
            b"PackageTagNotFound"
        } else if e == bun_core::err!("PackageManifestHTTP403") {
            b"PackageForbidden"
        } else if e == bun_core::err!("PackageManifestHTTP404") {
            b"PackageNotFound"
        } else {
            b"PackageResolveError"
        };

        let error_instance = ZigString::from_bytes(&msg)
            .with_encoding()
            .to_error_instance(global_this);
        if !result.url.is_empty() {
            error_instance.put(
                global_this,
                b"url",
                ZigString::from_bytes(result.url)
                    .with_encoding()
                    .to_js(global_this),
            );
        }
        error_instance.put(
            global_this,
            b"name",
            ZigString::from_bytes(name)
                .with_encoding()
                .to_js(global_this),
        );
        error_instance.put(
            global_this,
            b"pkg",
            ZigString::from_bytes(result.name)
                .with_encoding()
                .to_js(global_this),
        );
        error_instance.put(
            global_this,
            b"specifier",
            ZigString::from_bytes(self.specifier())
                .with_encoding()
                .to_js(global_this),
        );
        let location = bun_ast::range_data(
            Some(&self.parse_result.source),
            self.parse_result
                .ast
                .import_records
                .at(import_record_id as usize)
                .range,
            b"",
        )
        .location
        .unwrap();
        error_instance.put(
            global_this,
            b"sourceURL",
            ZigString::from_bytes(self.parse_result.source.path.text)
                .with_encoding()
                .to_js(global_this),
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
                ZigString::from_bytes(line_text)
                    .with_encoding()
                    .to_js(global_this),
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
                ZigString::from_bytes(referrer)
                    .with_encoding()
                    .to_js(global_this),
            );
        }

        let promise_value = self.promise.swap();
        let promise = promise_value.as_internal_promise().unwrap();
        promise_value.ensure_still_alive();
        let _ = vm;
        self.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        // PORT NOTE: Zig called `this.deinit()` here; in Rust the caller
        // (Queue::retain_mut) returns `false` and Vec drops the element,
        // running Drop.
        // `JSInternalPromise` is an `opaque_ffi!` ZST handle; `opaque_mut` is
        // the centralised non-null deref proof.
        let _ =
            JSInternalPromise::opaque_mut(promise).reject_as_handled(global_this, error_instance);
        Ok(())
    }

    fn download_error(
        &mut self,
        vm: &mut VirtualMachine,
        import_record_id: u32,
        result: PackageDownloadError<'_>,
    ) -> Result<(), bun_core::Error> {
        // Copy the `GlobalRef` out so the borrow of `self` ends before
        // `&mut vm` / `&mut self` reborrows below; `GlobalRef::deref` is the
        // safe JSC_BORROW accessor.
        let global_ref = self.global_this;
        let global_this: &JSGlobalObject = &global_ref;

        // `string_bytes` borrows the per-VM lockfile arena which outlives this
        // stack frame; capture as `RawSlice` so `Resolution::fmt` doesn't
        // extend the `&mut vm` borrow across the `match e` body (the `else`
        // arm calls `vm.package_manager()` again).
        let string_bytes = bun_ptr::RawSlice::new(
            vm.package_manager()
                .lockfile
                .buffers
                .string_bytes
                .as_slice(),
        );
        let resolution_fmt = result
            .resolution
            .fmt(string_bytes.slice(), bun_core::fmt::PathSep::Any);

        let mut msg: Vec<u8> = Vec::new();
        let e = result.err;
        if e == bun_core::err!("TarballHTTP400") {
            write!(
                &mut msg,
                "HTTP 400 downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            )
            .ok();
        } else if e == bun_core::err!("TarballHTTP401") {
            write!(
                &mut msg,
                "HTTP 401 downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            )
            .ok();
        } else if e == bun_core::err!("TarballHTTP402") {
            write!(
                &mut msg,
                "HTTP 402 downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            )
            .ok();
        } else if e == bun_core::err!("TarballHTTP403") {
            write!(
                &mut msg,
                "HTTP 403 downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            )
            .ok();
        } else if e == bun_core::err!("TarballHTTP404") {
            write!(
                &mut msg,
                "HTTP 404 downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            )
            .ok();
        } else if e == bun_core::err!("TarballHTTP4xx") {
            write!(
                &mut msg,
                "HTTP 4xx downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            )
            .ok();
        } else if e == bun_core::err!("TarballHTTP5xx") {
            write!(
                &mut msg,
                "HTTP 5xx downloading package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            )
            .ok();
        } else if e == bun_core::err!("TarballFailedToExtract") {
            write!(
                &mut msg,
                "Failed to extract tarball for package '{}@{}'",
                bstr::BStr::new(result.name),
                resolution_fmt
            )
            .ok();
        } else {
            write!(
                &mut msg,
                "{} downloading package '{}@{}'",
                e.name(),
                bstr::BStr::new(result.name),
                result.resolution.fmt(
                    vm.package_manager()
                        .lockfile
                        .buffers
                        .string_bytes
                        .as_slice(),
                    bun_core::fmt::PathSep::Any,
                )
            )
            .ok();
        }
        // msg dropped at scope exit.

        let name: &[u8] = if e == bun_core::err!("TarballFailedToExtract") {
            b"PackageExtractionError"
        } else if e == bun_core::err!("TarballHTTP403") {
            b"TarballForbiddenError"
        } else if e == bun_core::err!("TarballHTTP404") {
            b"TarballNotFoundError"
        } else {
            b"TarballDownloadError"
        };

        let error_instance = ZigString::from_bytes(&msg)
            .with_encoding()
            .to_error_instance(global_this);
        if !result.url.is_empty() {
            error_instance.put(
                global_this,
                b"url",
                ZigString::from_bytes(result.url)
                    .with_encoding()
                    .to_js(global_this),
            );
        }
        error_instance.put(
            global_this,
            b"name",
            ZigString::from_bytes(name)
                .with_encoding()
                .to_js(global_this),
        );
        error_instance.put(
            global_this,
            b"pkg",
            ZigString::from_bytes(result.name)
                .with_encoding()
                .to_js(global_this),
        );
        let specifier = self.specifier();
        if !specifier.is_empty() && specifier != b"undefined" {
            error_instance.put(
                global_this,
                b"referrer",
                ZigString::from_bytes(specifier)
                    .with_encoding()
                    .to_js(global_this),
            );
        }

        let location = bun_ast::range_data(
            Some(&self.parse_result.source),
            self.parse_result
                .ast
                .import_records
                .at(import_record_id as usize)
                .range,
            b"",
        )
        .location
        .unwrap();
        error_instance.put(
            global_this,
            b"specifier",
            ZigString::from_bytes(
                self.parse_result
                    .ast
                    .import_records
                    .at(import_record_id as usize)
                    .path
                    .text,
            )
            .with_encoding()
            .to_js(global_this),
        );
        error_instance.put(
            global_this,
            b"sourceURL",
            ZigString::from_bytes(self.parse_result.source.path.text)
                .with_encoding()
                .to_js(global_this),
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
                ZigString::from_bytes(line_text)
                    .with_encoding()
                    .to_js(global_this),
            );
        }
        error_instance.put(
            global_this,
            b"column",
            JSValue::js_number(location.column as f64),
        );

        let promise_value = self.promise.swap();
        let promise = promise_value.as_internal_promise().unwrap();
        promise_value.ensure_still_alive();
        let _ = vm;
        self.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        // PORT NOTE: Zig called `this.deinit()` here; caller drops via
        // retain_mut → false.
        // `JSInternalPromise` is an `opaque_ffi!` ZST handle; `opaque_mut` is
        // the centralised non-null deref proof.
        let _ =
            JSInternalPromise::opaque_mut(promise).reject_as_handled(global_this, error_instance);
        Ok(())
    }

    pub fn resume_loading_module(
        &mut self,
        log: &mut bun_ast::Log,
    ) -> Result<ResolvedSource, bun_core::Error> {
        bun_core::scoped_log!(
            AsyncModule,
            "resumeLoadingModule: {}",
            bstr::BStr::new(self.specifier())
        );
        // PORT NOTE: Zig copied `parse_result` by value, mutated, wrote
        // back. Rust takes-by-value via `mem::take` then restores below to
        // satisfy borrowck around `linker.link(&mut parse_result)` while
        // `self` is also borrowed.
        let mut parse_result = core::mem::take(&mut self.parse_result);
        // SAFETY: `string_buf` is a `Box<[u8]>` whose backing allocation is
        // stable for the lifetime of `*self`; this fn never replaces it, so
        // slices into it remain valid across the `&mut self` reborrows below
        // (`self.parse_result = ...`). Detach the borrow so borrowck doesn't
        // tie `path`/`specifier` to `&self`.
        let specifier: &[u8] = unsafe { bun_ptr::detach_lifetime(self.specifier()) };
        let path_text: &[u8] = unsafe { bun_ptr::detach_lifetime(self.path_text()) };
        let path = Fs::Path::init(path_text);
        let jsc_vm = VirtualMachine::get_mut_ptr();
        // SAFETY: `jsc_vm` is the live per-thread VM (one VM per thread);
        // raw-ptr aliasing matches the Zig `*VirtualMachine` field accesses
        // (`transpiler.log`/`resolver.log`/`linker.log` are themselves raw
        // `*mut Log` aliased deliberately — see `Transpiler::set_log`).
        let old_log = unsafe { (*jsc_vm).log };

        let log_ptr: *mut bun_ast::Log = log;
        // SAFETY: see above — single-thread VM; raw-ptr field stores.
        unsafe {
            (*jsc_vm).transpiler.linker.log = log_ptr;
            (*jsc_vm).transpiler.log = log_ptr;
            (*jsc_vm).transpiler.resolver.log = log_ptr;
            (*jsc_vm).package_manager().log = log_ptr;
        }
        let _restore = scopeguard::guard((jsc_vm, old_log), |(jsc_vm, old_log)| {
            // SAFETY: same per-thread VM; restoring the original `*mut Log`
            // values stored above.
            unsafe {
                let old_log_ptr = old_log.map(|p| p.as_ptr()).unwrap_or(core::ptr::null_mut());
                (*jsc_vm).transpiler.linker.log = old_log_ptr;
                (*jsc_vm).transpiler.log = old_log_ptr;
                (*jsc_vm).transpiler.resolver.log = old_log_ptr;
                (*jsc_vm).package_manager().log = old_log_ptr;
            }
        });

        // We _must_ link because:
        // - node_modules bundle won't be properly
        // SAFETY: per-thread VM; `linker` is a value field of `transpiler`.
        unsafe {
            (*jsc_vm).transpiler.linker.link::<false, true>(
                &path,
                &mut parse_result,
                &(*jsc_vm).origin,
                bun_bundler::options::ImportPathFormat::AbsolutePath,
            )?;
        }
        self.parse_result = parse_result;
        // PORT NOTE: `print_with_source_map` consumes `ParseResult` by
        // value (it moves `ast` into `print_ast`). Hoist the post-print
        // reads (`is_commonjs_module` / `input_fd`) above the move so we
        // can `mem::take` instead of cloning.
        let is_commonjs_module = self.parse_result.ast.has_commonjs_export_names
            || self.parse_result.ast.exports_kind == bun_ast::ExportsKind::Cjs;
        let input_fd = self.parse_result.input_fd;
        let parse_result = core::mem::take(&mut self.parse_result);

        // PORT NOTE: `VirtualMachine.source_code_printer` is a thread-local
        // `?*BufferPrinter` (see `SOURCE_CODE_PRINTER`); Zig dereferenced to
        // copy by value (`var printer = source_code_printer.?.*`), reset, and
        // wrote back in a `defer`. `BufferPrinter` is `!Clone` in Rust, so
        // swap the buffer out instead and write it back via the `_writeback`
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
        // Zig: `defer source_code_printer.?.* = printer;` — fires at fn exit,
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
            // SAFETY: per-thread VM; `source_map_handler` stashes the
            // `*mut BufferPrinter` and only reborrows inside
            // `on_source_map_chunk` after the writer's last use retires.
            let mut mapper = unsafe { (*jsc_vm).source_map_handler(&raw mut printer) };
            // SAFETY: per-thread VM.
            let _ = unsafe {
                (*jsc_vm).transpiler.print_with_source_map(
                    parse_result,
                    &mut printer,
                    bun_js_printer::Format::EsmAscii,
                    mapper.get(),
                    None,
                )
            }?;
        }

        #[cfg(feature = "dump_source")]
        {
            crate::runtime_transpiler_store::dump_source_string(
                jsc_vm as *mut VirtualMachine,
                specifier,
                printer.ctx.get_written(),
            );
        }
        // TODO(port): Environment.dump_source mapped to cfg feature; confirm flag name.

        // SAFETY: per-thread VM.
        if unsafe { (*jsc_vm).is_watcher_enabled() } {
            // SAFETY: per-thread VM.
            let mut resolved_source = unsafe {
                (*jsc_vm).ref_counted_resolved_source::<false>(
                    printer.ctx.get_written(),
                    BunString::init(specifier),
                    path.text,
                    None,
                )
            };

            if let Some(fd_) = input_fd {
                if bun_paths::is_absolute(path.text)
                    && !strings::contains(path.text, b"node_modules")
                {
                    // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set
                    // when `is_watcher_enabled()`; cast recovers the
                    // concrete type (matches VirtualMachine.rs:2301).
                    let watcher = unsafe {
                        &mut *(*jsc_vm)
                            .bun_watcher
                            .cast::<crate::hot_reloader::ImportWatcher>()
                    };
                    // PORT NOTE: `bun_watcher::PackageJSON` is an opaque
                    // forward-decl of `bun_resolver::PackageJSON`;
                    // the watcher only stores the pointer, so cast through.
                    // SAFETY: `package_json` (when set) is a VM-lifetime
                    // backref — outlives the watcher entry.
                    let package_json = self
                        .package_json
                        .map(|p| unsafe { &*p.as_ptr().cast::<bun_watcher::PackageJSON>() });
                    let _ = watcher.add_file::<true>(
                        fd_,
                        path.text,
                        self.hash,
                        bun_ast::Loader::from_api(self.loader),
                        Fd::INVALID,
                        package_json,
                    );
                }
            }

            resolved_source.is_commonjs_module = is_commonjs_module;

            return Ok(resolved_source);
        }

        Ok(ResolvedSource {
            source_code: BunString::clone_latin1(printer.ctx.get_written()),
            specifier: BunString::init(specifier),
            source_url: BunString::init(path.text),
            is_commonjs_module,
            ..Default::default()
        })
    }
}

// ported from: src/jsc/AsyncModule.zig
