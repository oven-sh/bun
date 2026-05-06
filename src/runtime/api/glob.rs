use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena;
use bun_glob::BunGlobWalker as GlobWalker;
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{
    ArgumentsSlice, CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, JsTerminated,
    StringJsc as _, SysErrorJsc as _,
};
use bun_jsc::bun_string_jsc;
use bun_paths::{self as resolve_path, platform, PathBuffer, MAX_PATH_BYTES};
use bun_paths::resolve_path::join_string_buf;
use bun_str::String as BunString;
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
            // TODO(port): `to_utf8_without_ref` took an allocator (arena) in Zig; bun_str API TBD.

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
                    let result = Self::parse_cwd(global_this, arena, opts_obj, out.absolute, fn_name)?;
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
            out.only_files = if only_files.is_boolean() { only_files.as_boolean() } else { false };
        }

        if let Some(error_on_broken) = opts_obj.get_truthy(global_this, "throwErrorOnBrokenSymlink")? {
            out.error_on_broken_symlinks = if error_on_broken.is_boolean() { error_on_broken.as_boolean() } else { false };
        }

        if let Some(follow_symlinks_val) = opts_obj.get_truthy(global_this, "followSymlinks")? {
            out.follow_symlinks = if follow_symlinks_val.is_boolean() { follow_symlinks_val.as_boolean() } else { false };
        }

        if let Some(absolute_val) = opts_obj.get_truthy(global_this, "absolute")? {
            out.absolute = if absolute_val.is_boolean() { absolute_val.as_boolean() } else { false };
        }

        if let Some(cwd_val) = opts_obj.get_truthy(global_this, "cwd")? {
            if !cwd_val.is_string() {
                return Err(global_this.throw(format_args!("{}: invalid `cwd`, not a string", fn_name)));
            }

            {
                let result = Self::parse_cwd(global_this, arena, cwd_val, out.absolute, fn_name)?;
                if !result.is_empty() {
                    out.cwd = Some(result);
                }
            }
        }

        if let Some(dot) = opts_obj.get_truthy(global_this, "dot")? {
            out.dot = if dot.is_boolean() { dot.as_boolean() } else { false };
        }

        Ok(Some(out))
    }
}

pub struct WalkTask<'a> {
    // TODO(port): confirm bun_glob::BunGlobWalker::Drop ≡ deinit(true) — Zig's
    // WalkTask.deinit called `walker.deinit(true)` explicitly; Box<GlobWalker> drop
    // must carry the same semantics.
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
            WalkTaskErr::Unknown(err) => bun_string_jsc::create_utf8_for_js(global_this, err.name().as_bytes()),
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
        // PORT NOTE: Zig `defer this.deinit()` (free walker + self) is subsumed by
        // `ConcurrentPromiseTask` owning `Box<WalkTask>` — dropped when dispatch
        // calls `AsyncGlobWalkTask::destroy()` after `run_from_js()`.

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

fn glob_walk_result_to_js(glob_walk: &mut GlobWalker, global_this: &JSGlobalObject) -> JsResult<JSValue> {
    let keys = glob_walk.matched_paths.keys();
    if keys.is_empty() {
        return JSValue::create_empty_array(global_this, 0);
    }

    // PORT NOTE: Zig keyed `MatchedMap` on `bun.String` so it could call
    // `BunString.toJSArray(keys)` directly. The Rust `MatchedMap` is
    // `StringArrayHashMap<()>` (Box<[u8]> keys), so rebuild the JS array here.
    let arr = JSValue::create_empty_array(global_this, keys.len())?;
    for (i, key) in keys.iter().enumerate() {
        let s = bun_string_jsc::create_utf8_for_js(global_this, key)?;
        arr.put_index(global_this, i as u32, s)?;
    }
    Ok(arr)
}

impl Glob {
    /// The reference to the arena is not used after the scope because it is copied
    /// by `GlobWalker.init`/`GlobWalker.initWithCwd` if all allocations work and no
    /// errors occur
    fn make_glob_walker(
        &mut self,
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
        let mut arguments = ArgumentsSlice::init(unsafe { &*global_this.bun_vm() }, arguments_.slice());
        // `arguments` drops at scope exit (was `defer arguments.deinit()`).
        let Some(pat_arg) = arguments.next_eat() else {
            return Err(global_this.throw(format_args!("Glob.constructor: expected 1 arguments, got 0")));
        };

        if !pat_arg.is_string() {
            return Err(global_this.throw(format_args!("Glob.constructor: first argument is not a string")));
        }

        let pat_str: Box<[u8]> = pat_arg.to_slice_clone(global_this)?.into_vec().into_boxed_slice();
        // TODO(port): `to_slice_clone` returned a ZigString.Slice in Zig; verify bun_jsc API shape.

        Ok(Box::new(Glob {
            pattern: pat_str,
            has_pending_activity: AtomicUsize::new(0),
        }))
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called once by JSC codegen on the mutator thread during sweep;
        // `this` was produced via Box::into_raw at construction.
        let _ = unsafe { Box::from_raw(this) };
        // `pattern: Box<[u8]>` freed by Drop (was `bun.default_allocator.free(this.pattern)`).
    }

    #[bun_jsc::host_call]
    pub extern "C" fn has_pending_activity(this: *mut Self) -> bool {
        // SAFETY: GC-thread read of an atomic field only; `this` is valid while wrapper is live.
        unsafe { (*this).has_pending_activity.load(Ordering::SeqCst) > 0 }
    }
}

fn incr_pending_activity_flag(has_pending_activity: &AtomicUsize) {
    let _ = has_pending_activity.fetch_add(1, Ordering::SeqCst);
}

fn decr_pending_activity_flag(has_pending_activity: &AtomicUsize) {
    let _ = has_pending_activity.fetch_sub(1, Ordering::SeqCst);
}

impl Glob {
    #[bun_jsc::host_fn(method)]
    pub fn __scan(&mut self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old::<1>();
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(unsafe { &*global_this.bun_vm() }, arguments_.slice());
        // `arguments` drops at scope exit.

        let mut arena = Arena::new();
        // TODO(port): arena is moved into GlobWalker via init/init_with_cwd (per doc comment).
        // Non-AST crate would normally delete the arena, but bun_glob::BunGlobWalker
        // consumes it. Verify ownership transfer in Phase B.
        let glob_walker = match self.make_glob_walker(global_this, &mut arguments, "scan", &mut arena) {
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
        // PORT NOTE: Zig's `WalkTask.create(...) catch { decr; deinit; throwOOM }`
        // path is unreachable in Rust — `Box::new` panics on OOM and
        // `create_on_js_thread` is otherwise infallible.
        let mut task = WalkTask::create(global_this, glob_walker, &self.has_pending_activity);
        task.schedule();

        let promise_value = task.promise.value();
        // SAFETY: ownership of the heap-allocated task transfers to the
        // thread-pool → event-loop chain. The intrusive `WorkPoolTask` /
        // `ConcurrentTask` fields keep it reachable until dispatch reclaims it
        // via `AsyncGlobWalkTask::destroy()` (see `runtime/dispatch.rs`).
        // The borrowed `&self.has_pending_activity` / `global_this` inside the
        // task remain valid for that duration because the JS `Glob` wrapper is
        // held live via `hasPendingActivity()` until `run()` decrements it.
        let _ = Box::into_raw(task);
        Ok(promise_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn __scan_sync(&mut self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old::<1>();
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(unsafe { &*global_this.bun_vm() }, arguments_.slice());

        let mut arena = Arena::new();
        let mut glob_walker = match self.make_glob_walker(global_this, &mut arguments, "scanSync", &mut arena) {
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
        // drops at scope exit.
        // TODO(port): confirm bun_glob::BunGlobWalker::Drop ≡ deinit(true) (bool-arg semantics).

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
    pub fn r#match(&mut self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        // PERF(port): was arena bulk-free — Zig used a local ArenaAllocator for the
        // toSlice() temp allocation. Dropped here; to_slice() owns its buffer.

        let arguments_ = callframe.arguments_old::<1>();
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(unsafe { &*global_this.bun_vm() }, arguments_.slice());
        let Some(str_arg) = arguments.next_eat() else {
            return Err(global_this.throw(format_args!("Glob.matchString: expected 1 arguments, got 0")));
        };

        if !str_arg.is_string() {
            return Err(global_this.throw(format_args!("Glob.matchString: first argument is not a string")));
        }

        let str = str_arg.to_slice(global_this)?;
        // `str` drops at scope exit (was `defer str.deinit()`).

        Ok(JSValue::from(bun_glob::r#match(&self.pattern, str.slice()).matches()))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/glob.zig (397 lines)
//   confidence: medium
//   todos:      12
//   notes:      WalkTask<'a> borrows outlive stack frame (scheduled task) — likely needs raw ptrs; arena ownership flows into bun_glob::BunGlobWalker; GlobWalker::deinit(true) vs Drop semantics unresolved.
// ──────────────────────────────────────────────────────────────────────────
