//! Port of `src/jsc/AsyncModule.zig`.
//!
//! B-2 un-gate: real `AsyncModule` / `Queue` / `InitOpts` types compile against
//! the `lib.rs` stub surface so `ModuleLoader` can re-export them and
//! `VirtualMachine.modules` can widen from `()` → `Queue`. `fulfill()` and the
//! `Bun__onFulfillAsyncModule` extern are real (called from
//! `RuntimeTranspilerStore::run_from_js_thread`). The package-manager-driven
//! bodies (`Queue::poll_modules` / `resolve_error` / `download_error` /
//! `resume_loading_module`) are preserved verbatim from the Phase-A draft
//! inside `` blocks below — every body reaches into
//! `bun_install::PackageManager` runTasks / `MultiArrayList` column accessors /
//! `bun_bundler::linker` that aren't wired yet (see PORT STATUS).

use core::ffi::c_void;
use core::sync::atomic::AtomicU32;

use bun_aio::KeepAlive;
use bun_alloc::Arena as ArenaAllocator;
use bun_bundler::options;
use bun_bundler::transpiler::ParseResult;
use bun_install::dependency::Dependency;
use bun_install::{DependencyID, Resolution};
use bun_logger as logger;
use bun_options_types::schema::api;
use bun_resolver::fs as Fs;
use bun_resolver::package_json::PackageJSON;
use bun_string::{String as BunString, ZigString};
use bun_sys::Fd;

use crate::virtual_machine::VirtualMachine;
use crate::{
    self as jsc, ErrorableResolvedSource, JSGlobalObject, JSInternalPromise, JSValue, JsError,
    JsResult, ResolvedSource, StrongOptional,
};

#[allow(non_upper_case_globals)]
bun_core::declare_scope!(AsyncModule, hidden);

// TODO(port): `opts: anytype` in Zig — accessed only as a field bag. Expressed
// here as an explicit struct; reconcile with the actual call sites in
// ModuleLoader once `transpileSourceCode`'s pending-import path is un-gated.
pub struct InitOpts<'a> {
    pub parse_result: ParseResult,
    pub referrer: &'a [u8],
    pub specifier: &'a [u8],
    pub path: Fs::Path<'a>,
    pub promise_ptr: Option<*mut *mut JSInternalPromise>,
    pub fd: Option<Fd>,
    pub package_json: Option<&'a PackageJSON>,
    pub loader: options::Loader,
    pub arena: Box<ArenaAllocator>,
}

pub struct AsyncModule<'a> {
    // This is all the state used by the printer to print the module
    pub parse_result: ParseResult,
    pub promise: StrongOptional, // Strong.Optional, default .empty
    pub path: Fs::Path<'a>,
    // TODO(port): lifetime — specifier/referrer/path.text are slices into
    // `string_buf` (self-referential). Phase B: store as (off,len) pairs.
    pub specifier: &'a [u8],
    pub referrer: &'a [u8],
    pub string_buf: Box<[u8]>,
    pub fd: Option<Fd>,
    pub package_json: Option<&'a PackageJSON>,
    pub loader: api::Loader,
    pub hash: u32, // default = u32::MAX
    pub global_this: &'a JSGlobalObject,
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

// TODO(port): AsyncModule carries <'a>; Queue is embedded intrusively in
// VirtualMachine via @fieldParentPtr, so it cannot itself be generic over a
// borrowed lifetime. Using 'static here as a placeholder — Phase B must
// reconcile (likely by storing raw ptrs or restructuring AsyncModule's slices
// to (off,len) pairs into `string_buf`).
pub type Map = Vec<AsyncModule<'static>>;

#[derive(Default)]
pub struct Queue {
    pub map: Map,
    pub scheduled: u32,
    pub concurrent_task_count: AtomicU32,
}

impl Queue {
    /// `@fieldParentPtr("modules", this)` — recover the owning VM.
    ///
    /// SAFETY: `self` must point to `VirtualMachine.modules`; Queue is only
    /// ever constructed in place as that field. Gated until
    /// `VirtualMachine.modules` widens from `()` → `Queue`.
    
    pub fn vm(&mut self) -> &mut VirtualMachine {
        unsafe {
            &mut *((self as *mut Self as *mut u8)
                .sub(core::mem::offset_of!(VirtualMachine, modules))
                .cast::<VirtualMachine>())
        }
    }

    pub fn on_resolve(_: &mut Queue) {
        bun_core::scoped_log!(AsyncModule, "onResolve");
    }
}

impl<'a> AsyncModule<'a> {
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
        log: &mut logger::Log,
    ) -> JsResult<()> {
        jsc::mark_binding(core::panic::Location::caller());
        let mut specifier = specifier_;
        let mut referrer = referrer_;
        // PORT NOTE: Zig `defer { specifier.deref(); referrer.deref(); scope.deinit(); }` —
        // BunString is `Copy` in the Rust port (no Drop), so deref the held
        // refcounts explicitly via scopeguard. The `TopExceptionScope` is
        // omitted: `from_js_host_call_generic` already checks the VM for a
        // pending exception after the FFI call (host_fn.rs).
        let _specifier_guard = scopeguard::guard(specifier, |s| s.deref());
        let _referrer_guard = scopeguard::guard(referrer, |s| s.deref());

        let mut errorable: ErrorableResolvedSource;
        if let Some(e) = err {
            // PORT NOTE: inner Zig defer block hoisted; runs at end of `if`
            // arm via scopeguard.
            let source_code = resolved_source.source_code;
            let needs_deref = resolved_source.source_code_needs_deref;
            resolved_source.source_code_needs_deref = false;
            let _guard = scopeguard::guard((), move |_| {
                if needs_deref {
                    source_code.deref();
                }
            });

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
                // `errorable.result.err.value`. Routed through the §Dispatch
                // `LoaderHooks::process_fetch_log` slot (body lives in
                // `bun_runtime`); without this the import promise would reject
                // with `undefined` (ModuleLoader.cpp:473).
                errorable = ErrorableResolvedSource::err(e, JSValue::UNDEFINED);
                super::process_fetch_log(
                    global_this as *const JSGlobalObject as *mut JSGlobalObject,
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
            // SAFETY: C ABI — all pointers are valid for the call; `errorable`
            // / `specifier` / `referrer` outlive the FFI body.
            unsafe {
                Bun__onFulfillAsyncModule(
                    global_this,
                    promise,
                    &mut errorable,
                    &mut specifier,
                    &mut referrer,
                )
            }
        })
    }
}

// PORT NOTE: pub fn deinit → impl Drop. Body only freed owned fields (promise,
// parse_result, arena, string_buf), all of which now have Drop impls on their
// Rust types. No explicit Drop needed; relying on field Drop order.
// bun.default_allocator.free(this.stmt_blocks);
// bun.default_allocator.free(this.expr_blocks);

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn Bun__onFulfillAsyncModule(
        global_object: *const JSGlobalObject,
        promise_value: JSValue,
        res: *mut ErrorableResolvedSource,
        specifier: *mut BunString,
        referrer: *mut BunString,
    );
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_install::PackageManager` / `MultiArrayList` column-accessor /
// `bun_bundler::linker`-dependent items — preserved verbatim from the Phase-A
// draft. Un-gate piecewise once: (a) `MultiArrayList<PendingResolution>` gains
// per-field column accessors (`items_tag` / `items_root_dependency_id` / …),
// (b) `PackageManager::run_tasks` callback shape is fixed, (c)
// `VirtualMachine.modules` widens from `()` → `Queue` so `Queue::vm()` is
// sound, (d) `KeepAlive::ref_/unref` get a `&mut VirtualMachine` overload (or
// the `EventLoopCtx` vtable for VM is installed).
// ──────────────────────────────────────────────────────────────────────────

mod _gated_impl {
    use super::*;
    use core::sync::atomic::Ordering;
    use std::io::Write as _;

    use bun_install::{self as install, PackageID, PackageManager};
    use bun_string::{self as bun_str, strings};

    use crate::event_loop::{AnyTask, ConcurrentTaskItem, Task};

    impl Queue {
        pub fn enqueue(&mut self, global_object: &JSGlobalObject, opts: InitOpts<'_>) {
            bun_core::scoped_log!(AsyncModule, "enqueue: {}", bstr::BStr::new(opts.specifier));
            let mut module = AsyncModule::init(opts, global_object).expect("unreachable");
            module.poll_ref.ref_(self.vm());

            // PORT NOTE: allocator arg dropped (Vec uses global mimalloc).
            self.map.push(module);
            // PERF(port): was assume_capacity-free append
            self.vm().package_manager().drain_dependency_list();
        }

        pub fn on_dependency_error(
            ctx: *mut c_void,
            dependency: Dependency,
            root_dependency_id: DependencyID,
            err: bun_core::Error,
        ) {
            // SAFETY: ctx was registered as *Queue when installing this callback.
            let this: &mut Queue = unsafe { &mut *(ctx as *mut Queue) };
            bun_core::scoped_log!(
                AsyncModule,
                "onDependencyError: {}",
                bstr::BStr::new(this.vm().package_manager().lockfile.str(&dependency.name))
            );

            // PORT NOTE: reshaped for borrowck — Zig iterated copies and
            // compacted in place; Rust uses retain_mut and lets Drop free
            // removed modules.
            let vm_ptr: *mut VirtualMachine = self.vm();
            this.map.retain_mut(|module| {
                let root_dependency_ids =
                    module.parse_result.pending_imports.items_root_dependency_id();
                for (dep_i, dep) in root_dependency_ids.iter().enumerate() {
                    if *dep != root_dependency_id {
                        continue;
                    }
                    let import_record_id =
                        module.parse_result.pending_imports.items_import_record_id()[dep_i];
                    // SAFETY: vm_ptr derived via @fieldParentPtr; valid for the lifetime of self.
                    let vm = unsafe { &mut *vm_ptr };
                    module
                        .resolve_error(
                            vm,
                            import_record_id,
                            PackageResolveError {
                                name: vm.package_manager().lockfile.str(&dependency.name),
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

        pub fn on_wake_handler(ctx: *mut c_void, _: &mut PackageManager) {
            bun_core::scoped_log!(AsyncModule, "onWake");
            // SAFETY: ctx was registered as *Queue when installing this callback.
            let this: &mut Queue = unsafe { &mut *(ctx as *mut Queue) };
            this.vm()
                .enqueue_task_concurrent(ConcurrentTaskItem::create_from(this));
        }

        pub fn on_poll(&mut self) {
            bun_core::scoped_log!(AsyncModule, "onPoll");
            self.run_tasks();
            self.poll_modules();
        }

        pub fn run_tasks(&mut self) {
            let pm = self.vm().package_manager();

            if bun_core::output::enable_ansi_colors_stderr() {
                pm.start_progress_bar_if_none();
                pm.run_tasks(
                    self,
                    PackageManager::RunTasksCallbacks {
                        on_extract: (),
                        on_resolve: Self::on_resolve,
                        on_package_manifest_error: Self::on_package_manifest_error,
                        on_package_download_error: Self::on_package_download_error,
                        progress_bar: true,
                    },
                    true,
                    PackageManager::Options::LogLevel::Default,
                )
                .expect("unreachable");
            } else {
                pm.run_tasks(
                    self,
                    PackageManager::RunTasksCallbacks {
                        on_extract: (),
                        on_resolve: Self::on_resolve,
                        on_package_manifest_error: Self::on_package_manifest_error,
                        on_package_download_error: Self::on_package_download_error,
                        progress_bar: false,
                    },
                    true,
                    PackageManager::Options::LogLevel::DefaultNoProgress,
                )
                .expect("unreachable");
            }
            // TODO(port): Zig passes `*Queue` as a comptime type param to
            // pm.runTasks for callback dispatch. Phase B: confirm Rust
            // PackageManager::run_tasks signature.
        }

        pub fn on_package_manifest_error(
            &mut self,
            name: &[u8],
            err: bun_core::Error,
            url: &[u8],
        ) {
            bun_core::scoped_log!(
                AsyncModule,
                "onPackageManifestError: {}",
                bstr::BStr::new(name)
            );

            // PORT NOTE: reshaped for borrowck — compaction loop → retain_mut.
            let vm_ptr: *mut VirtualMachine = self.vm();
            self.map.retain_mut(|module| {
                let tags = module.parse_result.pending_imports.items_tag();
                for (tag_i, tag) in tags.iter().enumerate() {
                    if *tag == bun_resolver::PendingResolutionTag::Resolve {
                        let esms = module.parse_result.pending_imports.items_esm();
                        let esm = esms[tag_i];
                        let string_bufs = module.parse_result.pending_imports.items_string_buf();

                        if esm.name.slice(string_bufs[tag_i]) != name {
                            continue;
                        }

                        let versions = module.parse_result.pending_imports.items_dependency();
                        let import_record_id =
                            module.parse_result.pending_imports.items_import_record_id()[tag_i];

                        // SAFETY: vm_ptr derived via @fieldParentPtr; valid for the lifetime of self.
                        let vm = unsafe { &mut *vm_ptr };
                        module
                            .resolve_error(
                                vm,
                                import_record_id,
                                PackageResolveError {
                                    name,
                                    err,
                                    url,
                                    version: versions[tag_i].clone(),
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

            let vm_ptr: *mut VirtualMachine = self.vm();
            // SAFETY: vm_ptr valid; we only read lockfile buffers here.
            let resolution_ids: &[PackageID] = unsafe {
                (*vm_ptr)
                    .package_manager()
                    .lockfile
                    .buffers
                    .resolutions
                    .as_slice()
            };

            // PORT NOTE: reshaped for borrowck — compaction loop → retain_mut.
            self.map.retain_mut(|module| {
                let record_ids = module.parse_result.pending_imports.items_import_record_id();
                let root_dependency_ids =
                    module.parse_result.pending_imports.items_root_dependency_id();
                for (import_id, dependency_id) in root_dependency_ids.iter().enumerate() {
                    if resolution_ids[*dependency_id as usize] != package_id {
                        continue;
                    }
                    // SAFETY: vm_ptr derived via @fieldParentPtr; valid for the lifetime of self.
                    let vm = unsafe { &mut *vm_ptr };
                    module
                        .download_error(
                            vm,
                            record_ids[import_id],
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
            let vm_ptr: *mut VirtualMachine = self.vm();
            // SAFETY: vm_ptr derived via @fieldParentPtr; valid for the lifetime of self.
            let pm = unsafe { (*vm_ptr).package_manager() };
            if pm.pending_tasks.load(Ordering::Relaxed) > 0 {
                return;
            }

            // PORT NOTE: reshaped for borrowck — Zig compacted by index; Rust uses retain_mut.
            self.map.retain_mut(|module| {
                let tags = module.parse_result.pending_imports.items_tag_mut();
                let root_dependency_ids =
                    module.parse_result.pending_imports.items_root_dependency_id();
                // var esms = module.parse_result.pending_imports.items(.esm);
                // var versions = module.parse_result.pending_imports.items(.dependency);
                let mut done_count: usize = 0;
                let tags_len = tags.len();
                for tag_i in 0..tags_len {
                    let root_id = root_dependency_ids[tag_i];
                    let resolution_ids = pm.lockfile.buffers.resolutions.as_slice();
                    if root_id as usize >= resolution_ids.len() {
                        continue;
                    }
                    let package_id = resolution_ids[root_id as usize];

                    match tags[tag_i] {
                        bun_resolver::PendingResolutionTag::Resolve => {
                            if package_id == install::INVALID_PACKAGE_ID {
                                continue;
                            }

                            // if we get here, the package has already been resolved.
                            tags[tag_i] = bun_resolver::PendingResolutionTag::Download;
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

                    let package = pm.lockfile.packages.get(package_id);
                    debug_assert!(package.resolution.tag != install::resolution::Tag::Root);

                    let mut name_and_version_hash: Option<u64> = None;
                    let mut patchfile_hash: Option<u64> = None;
                    match pm.determine_preinstall_state(
                        &package,
                        &pm.lockfile,
                        &mut name_and_version_hash,
                        &mut patchfile_hash,
                    ) {
                        install::PreinstallState::Done => {
                            // we are only truly done if all the dependencies are done.
                            let current_tasks = pm.total_tasks;
                            // so if enqueuing all the dependencies produces no new tasks, we are done.
                            pm.enqueue_dependency_list(package.dependencies);
                            if current_tasks == pm.total_tasks {
                                tags[tag_i] = bun_resolver::PendingResolutionTag::Done;
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

                if done_count == tags_len {
                    // SAFETY: vm_ptr derived via @fieldParentPtr; valid for the lifetime of self.
                    module.done(unsafe { &mut *vm_ptr });
                    false
                } else {
                    true
                }
            });

            if self.map.is_empty() {
                // ensure we always end the progress bar
                self.vm().package_manager().end_progress_bar();
            }
        }
    }

    impl<'a> AsyncModule<'a> {
        pub fn init(
            opts: InitOpts<'a>,
            global_object: &'a JSGlobalObject,
        ) -> Result<AsyncModule<'a>, bun_alloc::AllocError> {
            // var stmt_blocks = js_ast.Stmt.Data.toOwnedSlice();
            // var expr_blocks = js_ast.Expr.Data.toOwnedSlice();
            let this_promise = JSValue::create_internal_promise(global_object);
            let promise = StrongOptional::create(this_promise, global_object);

            let mut buf = bun_str::StringBuilder::default();
            buf.count(opts.referrer);
            buf.count(opts.specifier);
            buf.count(opts.path.text);

            buf.allocate()?;
            // SAFETY: caller guarantees promise_ptr is non-null and points to a valid out-slot.
            unsafe {
                *opts.promise_ptr.unwrap() = this_promise.as_promise().unwrap();
            }
            let referrer = buf.append(opts.referrer);
            let specifier = buf.append(opts.specifier);
            let path = Fs::Path::init(buf.append(opts.path.text));

            // TODO(port): referrer/specifier/path borrow buf.allocated_slice() (self-referential).
            Ok(AsyncModule {
                parse_result: opts.parse_result,
                promise,
                path,
                specifier,
                referrer,
                fd: opts.fd,
                package_json: opts.package_json,
                loader: opts.loader.to_api(),
                string_buf: buf.allocated_slice(),
                hash: u32::MAX,
                // .stmt_blocks = stmt_blocks,
                // .expr_blocks = expr_blocks,
                global_this: global_object,
                arena: opts.arena,
                poll_ref: KeepAlive::default(),
                any_task: AnyTask::default(),
            })
        }

        pub fn done(&mut self, jsc_vm: &mut VirtualMachine) {
            // PORT NOTE: Zig allocator.create + bitwise copy. In Rust we Box a
            // moved-out value; caller (poll_modules) returns `false` from
            // retain_mut so the slot is dropped without double-free. We use
            // ptr::read to move out of &mut self — caller MUST drop the slot
            // without running Drop again.
            // TODO(port): this is unsound as written; Phase B should
            // restructure poll_modules to drain finished modules by value
            // instead.
            // SAFETY: bitwise move out of &mut self; caller must forget the
            // original slot (see TODO(port) above).
            let clone: Box<AsyncModule<'a>> = Box::new(unsafe { core::ptr::read(self) });
            let clone = Box::into_raw(clone);
            jsc_vm.modules.scheduled += 1;
            // SAFETY: clone is a valid Box::into_raw allocation owned by the
            // task queue until on_done reclaims it via Box::from_raw; we hold
            // the only reference here.
            unsafe {
                (*clone).any_task = AnyTask::new::<AsyncModule, { Self::on_done }>(clone);
                jsc_vm.enqueue_task(Task::init(&mut (*clone).any_task));
            }
        }

        pub fn on_done(this: *mut AsyncModule<'a>) {
            jsc::mark_binding(core::panic::Location::caller());
            // SAFETY: `this` was Box::into_raw'd in `done`; reclaimed at end of this fn.
            let this = unsafe { &mut *this };
            let jsc_vm = this.global_this.bun_vm();
            jsc_vm.modules.scheduled -= 1;
            if jsc_vm.modules.scheduled == 0 {
                jsc_vm.package_manager().end_progress_bar();
            }
            let mut log = logger::Log::init();
            let mut errorable: ErrorableResolvedSource;
            this.poll_ref.unref(jsc_vm);
            'outer: {
                errorable = match this.resume_loading_module(&mut log) {
                    Ok(rs) => ErrorableResolvedSource::ok(rs),
                    Err(err) => {
                        if err == bun_core::err!("JSError") {
                            errorable = ErrorableResolvedSource::err(
                                bun_core::err!("JSError"),
                                this.global_this.take_error(JsError::Thrown),
                            );
                            break 'outer;
                        } else {
                            VirtualMachine::process_fetch_log(
                                this.global_this,
                                BunString::init(ZigString::init(this.specifier)),
                                BunString::init(ZigString::init(this.referrer)),
                                &mut log,
                                &mut errorable,
                                err,
                            );
                            break 'outer;
                        }
                    }
                };
            }
            // log dropped at scope exit (defer log.deinit()).

            let mut spec = BunString::init(ZigString::init(this.specifier).with_encoding());
            let mut ref_ = BunString::init(ZigString::init(this.referrer).with_encoding());
            let _ = jsc::from_js_host_call_generic(this.global_this, || unsafe {
                Bun__onFulfillAsyncModule(
                    this.global_this,
                    this.promise.get().unwrap(),
                    &mut errorable,
                    &mut spec,
                    &mut ref_,
                )
            });
            // SAFETY: reclaim the Box allocated in `done`; Drop runs deinit logic.
            drop(unsafe { Box::from_raw(this) });
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
            let global_this = self.global_this;

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
            } else if e == bun_core::err!("DistTagNotFound")
                || e == bun_core::err!("NoMatchingVersion")
            {
                // PORT NOTE: Zig peeks at the tagged-union via
                // `result.version.tag == .npm and
                // result.version.value.npm.version.isExact()`. The Rust
                // `Version::npm()` accessor performs the tag guard and yields
                // the `NpmInfo` (whose `.version` is the semver query group).
                let npm = result.version.npm();
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
                    bstr::BStr::new(
                        vm.package_manager().lockfile.str(&result.version.literal)
                    ),
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

            let error_instance = ZigString::init(&msg)
                .with_encoding()
                .to_error_instance(global_this);
            if !result.url.is_empty() {
                error_instance.put(
                    global_this,
                    b"url",
                    ZigString::init(result.url).with_encoding().to_js(global_this),
                );
            }
            error_instance.put(
                global_this,
                b"name",
                ZigString::init(name).with_encoding().to_js(global_this),
            );
            error_instance.put(
                global_this,
                b"pkg",
                ZigString::init(result.name)
                    .with_encoding()
                    .to_js(global_this),
            );
            error_instance.put(
                global_this,
                b"specifier",
                ZigString::init(self.specifier)
                    .with_encoding()
                    .to_js(global_this),
            );
            let location = logger::range_data(
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
                ZigString::init(self.parse_result.source.path.text)
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
                    ZigString::init(line_text).with_encoding().to_js(global_this),
                );
            }
            error_instance.put(
                global_this,
                b"column",
                JSValue::js_number(location.column as f64),
            );
            if !self.referrer.is_empty() && self.referrer != b"undefined" {
                error_instance.put(
                    global_this,
                    b"referrer",
                    ZigString::init(self.referrer)
                        .with_encoding()
                        .to_js(global_this),
                );
            }

            let promise_value = self.promise.swap();
            let promise = promise_value.as_internal_promise().unwrap();
            promise_value.ensure_still_alive();
            self.poll_ref.unref(vm);
            // PORT NOTE: Zig called `this.deinit()` here; in Rust the caller
            // (Queue::retain_mut) returns `false` and Vec drops the element,
            // running Drop.
            // SAFETY: `promise` is a live `JSInternalPromise*` from
            // `as_internal_promise`; reborrow for the FFI call only.
            let _ = unsafe { &mut *promise }.reject_as_handled(global_this, error_instance);
            Ok(())
        }

        fn download_error(
            &mut self,
            vm: &mut VirtualMachine,
            import_record_id: u32,
            result: PackageDownloadError<'_>,
        ) -> Result<(), bun_core::Error> {
            let global_this = self.global_this;

            let string_bytes: *const [u8] =
                vm.package_manager().lockfile.buffers.string_bytes.as_slice();
            // SAFETY: `string_bytes` is borrowed from the per-VM lockfile arena
            // which outlives this stack frame; reborrow as `&[u8]` so
            // `Resolution::fmt` doesn't extend the `&mut vm` borrow across the
            // `match e` body (the `else` arm calls `vm.package_manager()`
            // again).
            let resolution_fmt = result
                .resolution
                .fmt(unsafe { &*string_bytes }, bun_core::fmt::PathSep::Any);

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
                        vm.package_manager().lockfile.buffers.string_bytes.as_slice(),
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

            let error_instance = ZigString::init(&msg)
                .with_encoding()
                .to_error_instance(global_this);
            if !result.url.is_empty() {
                error_instance.put(
                    global_this,
                    b"url",
                    ZigString::init(result.url).with_encoding().to_js(global_this),
                );
            }
            error_instance.put(
                global_this,
                b"name",
                ZigString::init(name).with_encoding().to_js(global_this),
            );
            error_instance.put(
                global_this,
                b"pkg",
                ZigString::init(result.name)
                    .with_encoding()
                    .to_js(global_this),
            );
            if !self.specifier.is_empty() && self.specifier != b"undefined" {
                error_instance.put(
                    global_this,
                    b"referrer",
                    ZigString::init(self.specifier)
                        .with_encoding()
                        .to_js(global_this),
                );
            }

            let location = logger::range_data(
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
                ZigString::init(
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
                ZigString::init(self.parse_result.source.path.text)
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
                    ZigString::init(line_text).with_encoding().to_js(global_this),
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
            self.poll_ref.unref(vm);
            // PORT NOTE: Zig called `this.deinit()` here; caller drops via
            // retain_mut → false.
            // SAFETY: `promise` is a live `JSInternalPromise*` from
            // `as_internal_promise`; reborrow for the FFI call only.
            let _ = unsafe { &mut *promise }.reject_as_handled(global_this, error_instance);
            Ok(())
        }

        pub fn resume_loading_module(
            &mut self,
            log: &mut logger::Log,
        ) -> Result<ResolvedSource, bun_core::Error> {
            bun_core::scoped_log!(
                AsyncModule,
                "resumeLoadingModule: {}",
                bstr::BStr::new(self.specifier)
            );
            // PORT NOTE: Zig copied `parse_result` by value, mutated, wrote
            // back. Rust takes-by-value via `mem::take` then restores below to
            // satisfy borrowck around `linker.link(&mut parse_result)` while
            // `self` is also borrowed.
            let mut parse_result = core::mem::take(&mut self.parse_result);
            let path = self.path.clone();
            let jsc_vm = VirtualMachine::get();
            let specifier = self.specifier;
            // SAFETY: `jsc_vm` is the live per-thread VM (one VM per thread);
            // raw-ptr aliasing matches the Zig `*VirtualMachine` field accesses
            // (`transpiler.log`/`resolver.log`/`linker.log` are themselves raw
            // `*mut Log` aliased deliberately — see `Transpiler::set_log`).
            let old_log = unsafe { (*jsc_vm).log };

            let log_ptr: *mut logger::Log = log;
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
                    let old_log_ptr = old_log
                        .map(|p| p.as_ptr())
                        .unwrap_or(core::ptr::null_mut());
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
                || self.parse_result.ast.exports_kind == bun_js_parser::ExportsKind::Cjs;
            let input_fd = self.parse_result.input_fd;
            let parse_result = core::mem::take(&mut self.parse_result);

            // PORT NOTE: `VirtualMachine.source_code_printer` is a thread-local
            // `?*BufferPrinter` (see `SOURCE_CODE_PRINTER`); Zig dereferenced
            // to copy by value, reset, and wrote back in a `defer`. We mirror
            // with `clone()`/scopeguard write-back to preserve the same
            // buffer-reuse dance (matches RuntimeTranspilerStore.rs:802).
            let printer_ptr = crate::virtual_machine::SOURCE_CODE_PRINTER
                .get()
                .expect("source_code_printer not initialized");
            // SAFETY: thread-local owns the leaked Box; only this thread touches it.
            let source_code_printer = unsafe { printer_ptr.as_mut() };
            let mut printer = source_code_printer.clone();
            printer.ctx.reset();

            {
                // SAFETY: per-thread VM; `source_map_handler` stashes the
                // `*mut BufferPrinter` and only reborrows inside
                // `on_source_map_chunk` after the writer's last use retires.
                let mut mapper =
                    unsafe { (*jsc_vm).source_map_handler(&mut printer) };
                let _writeback = scopeguard::guard(
                    (
                        source_code_printer as *mut bun_js_printer::BufferPrinter,
                        &mut printer as *mut _,
                    ),
                    |(dst, src)| {
                        // SAFETY: both pointees outlive this scope; no aliases at drop.
                        unsafe { *dst = (*src).clone() };
                    },
                );
                // SAFETY: per-thread VM.
                let _ = unsafe {
                    (*jsc_vm).transpiler.print_with_source_map(
                        // PORT NOTE: `print_with_source_map` consumes
                        // `ParseResult` by value (it moves `ast` into
                        // `print_ast`). Clone — `self.parse_result` is read
                        // again below for `is_commonjs_module` / `input_fd`.
                        parse_result.clone(),
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
                    // SAFETY: per-thread VM.
                    unsafe { &*jsc_vm },
                    specifier,
                    printer.ctx.get_written(),
                );
            }
            // TODO(port): Environment.dump_source mapped to cfg feature; confirm flag name.

            let is_commonjs_module = parse_result.ast.has_commonjs_export_names
                || parse_result.ast.exports_kind == bun_js_parser::ExportsKind::Cjs;

            // SAFETY: per-thread VM.
            if unsafe { (*jsc_vm).is_watcher_enabled() } {
                // SAFETY: per-thread VM.
                let mut resolved_source = unsafe {
                    (*jsc_vm).ref_counted_resolved_source::<false>(
                        printer.ctx.written(),
                        BunString::init(specifier),
                        path.text,
                        None,
                    )
                };

                if let Some(fd_) = parse_result.input_fd {
                    if bun_paths::is_absolute(path.text)
                        && !strings::contains(path.text, b"node_modules")
                    {
                        // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set
                        // when `is_watcher_enabled()`; cast recovers the
                        // concrete type (matches VirtualMachine.rs:2301).
                        let watcher = unsafe {
                            &mut *((*jsc_vm).bun_watcher
                                as *mut crate::hot_reloader::ImportWatcher)
                        };
                        let _ = watcher.add_file::<true>(
                            fd_,
                            path.text,
                            self.hash,
                            options::Loader::from_api(self.loader),
                            Fd::invalid(),
                            // TODO(port): `&PackageJSON` → `&mut PackageJSON`
                            // mismatch — `ImportWatcher::add_file` takes
                            // `Option<&mut>` but `self.package_json` is
                            // `Option<&>`. Zig passed a `*const`-ish slice
                            // through; the watcher only reads it. Phase B:
                            // relax `add_file`'s param to `Option<&>`.
                            None,
                        );
                    }
                }

                resolved_source.is_commonjs_module = is_commonjs_module;

                return Ok(resolved_source);
            }

            Ok(ResolvedSource {
                allocator: core::ptr::null_mut(),
                source_code: BunString::clone_latin1(printer.ctx.get_written()),
                specifier: BunString::init(specifier),
                source_url: BunString::init(path.text),
                is_commonjs_module,
                ..Default::default()
            })
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/AsyncModule.zig (782 lines)
//   confidence: low
//   todos:      14
//   notes:      Keystone-C un-gate. AsyncModule struct + Queue + InitOpts +
//               error types real. fulfill() real (called from
//               RuntimeTranspilerStore). Queue method bodies / init / done /
//               on_done / resolve_error / download_error /
//               resume_loading_module gated on (a) MultiArrayList column
//               accessors for PendingResolution, (b) VirtualMachine.modules
//               widening to Queue, (c) PackageManager::run_tasks callback
//               shape, (d) KeepAlive ⇄ VirtualMachine bridge. Self-referential
//               string_buf slices need (off,len) restructure. Full Phase-A
//               draft @ 5410a51d85^.
// ──────────────────────────────────────────────────────────────────────────
