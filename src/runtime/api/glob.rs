use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena;
use bun_core::String as BunString;
use bun_glob::BunGlobWalker as GlobWalker;
use bun_jsc::bun_string_jsc;
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{
    ArgumentsSlice, CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, JsTerminated,
    StringJsc as _, SysErrorJsc as _,
};
use bun_paths::resolve_path::join_string_buf;
use bun_paths::{self as resolve_path, MAX_PATH_BYTES, PathBuffer, platform};
use bun_sys as syscall;

// Codegen hooks (JSGlob): toJS / fromJS / fromJSDirect are provided by the
// generated C++ wrapper. See PORTING.md §JSC ".classes.ts-backed types".
// TODO(port): #[derive(bun_jsc::JsClass)] once codegen is wired for Rust.
#[bun_jsc::JsClass]
pub struct Glob {
    pattern: Box<[u8]>,
    has_pending_activity: AtomicUsize,
}

struct ScanOpts {
    cwd: Option<Box<[u8]>>,
    dot: bool,
    absolute: bool,
    only_files: bool,
    follow_symlinks: bool,
    error_on_broken_symlinks: bool,
}

impl ScanOpts {
    fn parse_cwd(
        global_this: &JSGlobalObject,
        _arena: &Arena,
        cwd_val: JSValue,
        absolute: bool,
        fn_name: &'static str, // PERF(port): was comptime monomorphization — profile in Phase B
    ) -> JsResult<Box<[u8]>> {
        let cwd_string = BunString::from_js(cwd_val, global_this)?;
        // `cwd_string` drops at scope exit (was `defer cwd_string.deref()`).
        if cwd_string.is_empty() {
            return Ok(Box::default());
        }

        let cwd_str: Box<[u8]> = 'cwd_str: {
            let cwd_utf8 = cwd_string.to_utf8_without_ref();

            // If its absolute return as is
            if resolve_path::Platform::AUTO.is_absolute(cwd_utf8.slice()) {
                break 'cwd_str Box::<[u8]>::from(cwd_utf8.slice());
            }

            // `cwd_utf8` drops at scope exit (was `defer cwd_utf8.deinit()`).
            let mut path_buf2 = [0u8; MAX_PATH_BYTES * 2];

            if !absolute {
                let parts: &[&[u8]] = &[cwd_utf8.slice()];
                let cwd_str = join_string_buf::<platform::Auto>(&mut path_buf2, parts);
                break 'cwd_str Box::<[u8]>::from(cwd_str);
            }

            // Convert to an absolute path
            let mut path_buf = PathBuffer::uninit();
            let cwd_len = match bun_sys::getcwd(&mut path_buf[..]) {
                bun_sys::Result::Ok(len) => len,
                bun_sys::Result::Err(err) => {
                    let err_js = err.to_js(global_this);
                    return Err(global_this.throw_value(err_js));
                }
            };

            let cwd_str = join_string_buf::<platform::Auto>(
                &mut path_buf2,
                &[&path_buf[..cwd_len], cwd_utf8.slice()],
            );
            break 'cwd_str Box::<[u8]>::from(cwd_str);
        };

        if cwd_str.len() > MAX_PATH_BYTES {
            return Err(global_this.throw(format_args!(
                "{}: invalid `cwd`, longer than {} bytes",
                fn_name, MAX_PATH_BYTES
            )));
        }

        Ok(cwd_str)
    }

    fn from_js(
        global_this: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
        fn_name: &'static str, // PERF(port): was comptime monomorphization — profile in Phase B
        arena: &mut Arena,
    ) -> JsResult<Option<ScanOpts>> {
        let Some(opts_obj) = arguments.next_eat() else {
            return Ok(None);
        };
        let mut out = ScanOpts {
            cwd: None,
            dot: false,
            absolute: false,
            follow_symlinks: false,
            error_on_broken_symlinks: false,
            only_files: true,
        };
        if opts_obj.is_undefined_or_null() {
            return Ok(Some(out));
        }
        if !opts_obj.is_object() {
            if opts_obj.is_string() {
                {
                    let result =
                        Self::parse_cwd(global_this, arena, opts_obj, out.absolute, fn_name)?;
                    if !result.is_empty() {
                        out.cwd = Some(result);
                    }
                }
                return Ok(Some(out));
            }
            return Err(global_this.throw(format_args!(
                "{}: expected first argument to be an object",
                fn_name
            )));
        }

        if let Some(only_files) = opts_obj.get_truthy(global_this, "onlyFiles")? {
            out.only_files = if only_files.is_boolean() {
                only_files.as_boolean()
            } else {
                false
            };
        }

        if let Some(error_on_broken) =
            opts_obj.get_truthy(global_this, "throwErrorOnBrokenSymlink")?
        {
            out.error_on_broken_symlinks = if error_on_broken.is_boolean() {
                error_on_broken.as_boolean()
            } else {
                false
            };
        }

        if let Some(follow_symlinks_val) = opts_obj.get_truthy(global_this, "followSymlinks")? {
            out.follow_symlinks = if follow_symlinks_val.is_boolean() {
                follow_symlinks_val.as_boolean()
            } else {
                false
            };
        }

        if let Some(absolute_val) = opts_obj.get_truthy(global_this, "absolute")? {
            out.absolute = if absolute_val.is_boolean() {
                absolute_val.as_boolean()
            } else {
                false
            };
        }

        if let Some(cwd_val) = opts_obj.get_truthy(global_this, "cwd")? {
            if !cwd_val.is_string() {
                return Err(
                    global_this.throw(format_args!("{}: invalid `cwd`, not a string", fn_name))
                );
            }

            {
                let result = Self::parse_cwd(global_this, arena, cwd_val, out.absolute, fn_name)?;
                if !result.is_empty() {
                    out.cwd = Some(result);
                }
            }
        }

        if let Some(dot) = opts_obj.get_truthy(global_this, "dot")? {
            out.dot = if dot.is_boolean() {
                dot.as_boolean()
            } else {
                false
            };
        }

        Ok(Some(out))
    }
}

pub struct WalkTask<'a> {
    // PORT NOTE: Zig `WalkTask.deinit` did `walker.deinit(true); destroy(walker)`.
    // `Box<GlobWalker>` drop runs `GlobWalker::Drop` (≡ `deinit(true)`) then frees.
    walker: Box<GlobWalker>,
    err: Option<WalkTaskErr>,
    global: &'a JSGlobalObject,
    has_pending_activity: &'a AtomicUsize,
}

pub enum WalkTaskErr {
    Syscall(syscall::Error),
    Unknown(bun_core::Error),
}

impl WalkTaskErr {
    pub fn to_js(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            WalkTaskErr::Syscall(err) => Ok(err.to_js(global_this)),
            WalkTaskErr::Unknown(err) => {
                bun_string_jsc::create_utf8_for_js(global_this, err.name().as_bytes())
            }
        }
    }
}

pub type AsyncGlobWalkTask<'a> = ConcurrentPromiseTask<'a, WalkTask<'a>>;

impl<'a> WalkTask<'a> {
    // PORT NOTE: Zig returned `!*AsyncGlobWalkTask` (the only `try` was the heap
    // allocation). With the global mimalloc allocator `Box::new` is infallible
    // (panics on OOM), so the Rust port returns the boxed task directly.
    pub fn create(
        global_this: &'a JSGlobalObject,
        glob_walker: Box<GlobWalker>,
        has_pending_activity: &'a AtomicUsize,
    ) -> Box<AsyncGlobWalkTask<'a>> {
        // PORT NOTE: Zig returned `!*AsyncGlobWalkTask` (alloc OOM); Rust `Box::new`
        // is infallible (panics on OOM via mimalloc), so no error variant.
        let walk_task = Box::new(WalkTask {
            walker: glob_walker,
            global: global_this,
            err: None,
            has_pending_activity,
        });
        AsyncGlobWalkTask::create_on_js_thread(global_this, walk_task)
    }
}

impl<'a> ConcurrentPromiseTaskContext for WalkTask<'a> {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AsyncGlobWalkTask;
    fn run(&mut self) {
        // PORT NOTE: `defer decrPendingActivityFlag(...)` — runs on all paths.
        let guard = scopeguard::guard(self.has_pending_activity, |hpa| {
            decr_pending_activity_flag(hpa);
        });
        let result = match self.walker.walk() {
            Ok(r) => r,
            Err(err) => {
                self.err = Some(WalkTaskErr::Unknown(err));
                drop(guard);
                return;
            }
        };
        match result {
            bun_sys::Result::Err(err) => {
                self.err = Some(WalkTaskErr::Syscall(err));
            }
            bun_sys::Result::Ok(()) => {}
        }
        drop(guard);
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated> {
        // PORT NOTE: Zig `defer this.deinit()` freed walker + self. Ownership of
        // `Box<WalkTask>` is held by `ConcurrentPromiseTask.ctx`; the wrapper is
        // freed via `ConcurrentPromiseTask::destroy` on the `.manual_deinit` path
        // after `run_from_js` returns, which drops `ctx` (and thus `walker`).

        if let Some(err) = &self.err {
            promise.reject_with_async_stack(self.global, err.to_js(self.global))?;
            return Ok(());
        }

        let js_strings = match glob_walk_result_to_js(&mut self.walker, self.global) {
            Ok(v) => v,
            // PORT NOTE: `error.JSError` → pass the JsError through; reject() pulls the pending exception.
            Err(e) => return promise.reject(self.global, Err(e)),
        };
        promise.resolve(self.global, js_strings)
    }
}

fn glob_walk_result_to_js(
    glob_walk: &mut GlobWalker,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let keys = glob_walk.matched_paths.keys();
    if keys.is_empty() {
        return JSValue::create_empty_array(global_this, 0);
    }

    // PORT NOTE: Zig keyed `MatchedMap` on `bun.String` so it could call
    // `BunString.toJSArray(keys)` directly. The Rust `MatchedMap` is
    // `StringArrayHashMap<()>` (Box<[u8]> keys), so rebuild the JS array here.
    JSValue::create_array_from_iter(global_this, keys.iter(), |key| {
        bun_string_jsc::create_utf8_for_js(global_this, key)
    })
}

impl Glob {
    /// The reference to the arena is not used after the scope because it is copied
    /// by `GlobWalker.init`/`GlobWalker.initWithCwd` if all allocations work and no
    /// errors occur
    fn make_glob_walker(
        &self,
        global_this: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
        fn_name: &'static str, // PERF(port): was comptime monomorphization — profile in Phase B
        arena: &mut Arena,
    ) -> JsResult<Option<Box<GlobWalker>>> {
        let Some(match_opts) = ScanOpts::from_js(global_this, arguments, fn_name, arena)? else {
            return Ok(None);
        };
        let cwd = match_opts.cwd;
        let dot = match_opts.dot;
        let absolute = match_opts.absolute;
        let follow_symlinks = match_opts.follow_symlinks;
        let error_on_broken_symlinks = match_opts.error_on_broken_symlinks;
        let only_files = match_opts.only_files;

        // PORT NOTE: Zig stack-inits `GlobWalker = .{}` then calls `.init()` /
        // `.initWithCwd()` as out-param mutators. The Rust `GlobWalker` reshaped
        // those into associated constructors returning `Result<Maybe<Self>>`, so
        // there is no `Default` and no separate allocation step.
        // `errdefer alloc.destroy(globWalker)` is handled by Box drop on `?` paths.
        let _ = arena; // arena ownership is no longer threaded through GlobWalker init.

        if let Some(cwd) = cwd {
            let glob_walker = match GlobWalker::init_with_cwd(
                &self.pattern,
                &cwd,
                dot,
                absolute,
                follow_symlinks,
                error_on_broken_symlinks,
                only_files,
                None,
            )? {
                bun_sys::Result::Err(err) => {
                    return Err(global_this.throw_value(err.to_js(global_this)));
                }
                bun_sys::Result::Ok(gw) => Box::new(gw),
            };
            return Ok(Some(glob_walker));
        }

        let glob_walker = match GlobWalker::init(
            &self.pattern,
            dot,
            absolute,
            follow_symlinks,
            error_on_broken_symlinks,
            only_files,
            None,
        )? {
            bun_sys::Result::Err(err) => {
                return Err(global_this.throw_value(err.to_js(global_this)));
            }
            bun_sys::Result::Ok(gw) => Box::new(gw),
        };
        Ok(Some(glob_walker))
    }

    // PORT NOTE: no `#[bun_jsc::host_fn]` here — the `#[bun_jsc::JsClass]` derive on
    // the struct already emits the `GlobClass__construct` shim that calls
    // `<Glob>::constructor(..)`. The free-fn `host_fn` expansion can't name an
    // associated fn without a receiver.
    pub fn constructor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<Box<Glob>> {
        let arguments_ = callframe.arguments_old::<1>();
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());
        // `arguments` drops at scope exit (was `defer arguments.deinit()`).
        let Some(pat_arg) = arguments.next_eat() else {
            return Err(global_this.throw(format_args!(
                "Glob.constructor: expected 1 arguments, got 0"
            )));
        };

        if !pat_arg.is_string() {
            return Err(global_this.throw(format_args!(
                "Glob.constructor: first argument is not a string"
            )));
        }

        let pat_str: Box<[u8]> = pat_arg
            .to_slice_clone(global_this)?
            .into_vec()
            .into_boxed_slice();

        Ok(Box::new(Glob {
            pattern: pat_str,
            has_pending_activity: AtomicUsize::new(0),
        }))
    }

    /// Called on the GC thread concurrently with the mutator. Reads only the
    /// atomic counter; never allocates, locks, or touches JS. The codegen shim
    /// (`Glob__hasPendingActivity`) handles the `callconv(.c)` ABI and passes
    /// `&*this`.
    pub fn has_pending_activity(&self) -> bool {
        self.has_pending_activity.load(Ordering::SeqCst) > 0
    }
}

fn incr_pending_activity_flag(has_pending_activity: &AtomicUsize) {
    let _ = has_pending_activity.fetch_add(1, Ordering::SeqCst);
}

fn decr_pending_activity_flag(has_pending_activity: &AtomicUsize) {
    let _ = has_pending_activity.fetch_sub(1, Ordering::SeqCst);
}

impl Glob {
    // R-2 (host-fn re-entrancy): all JS-exposed methods take `&self`. `Glob`'s
    // fields are read-only after construction (`pattern`) or already atomic
    // (`has_pending_activity`), so no `Cell`/`JsCell` wrapping is needed — the
    // `&mut self` receivers were vestigial. The codegen shim still emits
    // `this: &mut Glob` until Phase 1 lands; `&mut T` auto-derefs to `&T`.
    #[bun_jsc::host_fn(method)]
    pub fn __scan(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old::<1>();
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());
        // `arguments` drops at scope exit.

        let mut arena = Arena::new();
        // PORT NOTE: GlobWalker::init/init_with_cwd own their allocations (Box) in
        // the Rust port; the arena here is vestigial and only mirrors Zig structure.
        let glob_walker =
            match self.make_glob_walker(global_this, &mut arguments, "scan", &mut arena) {
                Err(err) => {
                    drop(arena);
                    return Err(err);
                }
                Ok(None) => {
                    drop(arena);
                    return Ok(JSValue::UNDEFINED);
                }
                Ok(Some(gw)) => gw,
            };

        incr_pending_activity_flag(&self.has_pending_activity);
        // PORT NOTE: Zig `catch { decr; deinit; throwOOM }` handled alloc failure.
        // Rust `Box::new` is infallible (panics via mimalloc on OOM), so the error
        // arm collapses; `glob_walker` is moved in and dropped on unwind.
        let mut task = WalkTask::create(global_this, glob_walker, &self.has_pending_activity);
        let promise = task.promise.value();
        task.schedule();
        // Ownership passes to the work pool / event loop; freed via
        // `ConcurrentPromiseTask::destroy` on the `.manual_deinit` path.
        // PORT NOTE: lifetime — WalkTask<'_> borrows `&self.has_pending_activity`
        // and `global_this`. Both referents outlive the task: `Glob` is GC-rooted
        // via `hasPendingActivity()`, and `JSGlobalObject` lives until VM teardown.
        // `into_raw` erases the stack-tied `'_` once the heap allocation escapes.
        let _ = bun_core::heap::into_raw(task);
        Ok(promise)
    }

    #[bun_jsc::host_fn(method)]
    pub fn __scan_sync(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old::<1>();
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());

        let mut arena = Arena::new();
        let mut glob_walker =
            match self.make_glob_walker(global_this, &mut arguments, "scanSync", &mut arena) {
                Err(err) => {
                    drop(arena);
                    return Err(err);
                }
                Ok(None) => {
                    drop(arena);
                    return Ok(JSValue::UNDEFINED);
                }
                Ok(Some(gw)) => gw,
            };
        // Zig: `defer { globWalker.deinit(true); alloc.destroy(globWalker); }` — Box<GlobWalker>
        // drops at scope exit (`GlobWalker::Drop` ≡ `deinit(true)`).

        match glob_walker.walk()? {
            bun_sys::Result::Err(err) => {
                return Err(global_this.throw_value(err.to_js(global_this)));
            }
            bun_sys::Result::Ok(()) => {}
        }

        let matched_paths = glob_walk_result_to_js(&mut glob_walker, global_this);

        matched_paths
    }

    #[bun_jsc::host_fn(method)]
    pub fn r#match(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // PERF(port): was arena bulk-free — Zig used a local ArenaAllocator for the
        // toSlice() temp allocation. Dropped here; to_slice() owns its buffer.

        let arguments_ = callframe.arguments_old::<1>();
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());
        let Some(str_arg) = arguments.next_eat() else {
            return Err(global_this.throw(format_args!(
                "Glob.matchString: expected 1 arguments, got 0"
            )));
        };

        if !str_arg.is_string() {
            return Err(global_this.throw(format_args!(
                "Glob.matchString: first argument is not a string"
            )));
        }

        let str = str_arg.to_slice(global_this)?;
        // `str` drops at scope exit (was `defer str.deinit()`).

        Ok(JSValue::from(
            bun_glob::r#match(&self.pattern, str.slice()).matches(),
        ))
    }
}

// ported from: src/runtime/api/glob.zig
