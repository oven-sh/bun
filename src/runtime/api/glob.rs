use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena;
use bun_glob::BunGlobWalker as GlobWalker;
use bun_jsc::{
    ArgumentsSlice, CallFrame, ConcurrentPromiseTask, JSGlobalObject, JSPromise, JSValue, JsResult,
    JsTerminated, ZigString,
};
use bun_paths::{self as resolve_path, PathBuffer, MAX_PATH_BYTES};
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
        arena: &Arena,
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
            if resolve_path::Platform::Auto.is_absolute(cwd_utf8.slice()) {
                break 'cwd_str Box::<[u8]>::from(cwd_utf8.clone_if_borrowed()?.slice());
                // TODO(port): clone_if_borrowed() took arena allocator in Zig.
            }

            // `cwd_utf8` drops at scope exit (was `defer cwd_utf8.deinit()`).
            let mut path_buf2 = [0u8; MAX_PATH_BYTES * 2];

            if !absolute {
                let parts: &[&[u8]] = &[cwd_utf8.slice()];
                let cwd_str = resolve_path::join_string_buf(&mut path_buf2, parts, resolve_path::Platform::Auto);
                break 'cwd_str Box::<[u8]>::from(cwd_str);
            }

            // Convert to an absolute path
            let mut path_buf = PathBuffer::uninit();
            let cwd = match bun_sys::getcwd(&mut path_buf) {
                bun_sys::Result::Ok(cwd) => cwd,
                bun_sys::Result::Err(err) => {
                    let err_js = err.to_js(global_this)?;
                    return global_this.throw_value(err_js);
                }
            };

            let cwd_str = resolve_path::join_string_buf(
                &mut path_buf2,
                &[cwd, cwd_utf8.slice()],
                resolve_path::Platform::Auto,
            );
            break 'cwd_str Box::<[u8]>::from(cwd_str);
        };

        if cwd_str.len() > MAX_PATH_BYTES {
            return global_this.throw(format_args!(
                "{}: invalid `cwd`, longer than {} bytes",
                fn_name, MAX_PATH_BYTES
            ));
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
            return global_this.throw(format_args!(
                "{}: expected first argument to be an object",
                fn_name
            ));
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
                return global_this.throw(format_args!("{}: invalid `cwd`, not a string", fn_name));
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
            WalkTaskErr::Syscall(err) => err.to_js(global_this),
            WalkTaskErr::Unknown(err) => Ok(ZigString::from_bytes(err.name().as_bytes()).to_js(global_this)),
        }
    }
}

pub type AsyncGlobWalkTask<'a> = ConcurrentPromiseTask<WalkTask<'a>>;

impl<'a> WalkTask<'a> {
    pub fn create(
        global_this: &'a JSGlobalObject,
        glob_walker: Box<GlobWalker>,
        has_pending_activity: &'a AtomicUsize,
    ) -> Result<Box<AsyncGlobWalkTask<'a>>, bun_core::Error> {
        // TODO(port): narrow error set
        let walk_task = Box::new(WalkTask {
            walker: glob_walker,
            global: global_this,
            err: None,
            has_pending_activity,
        });
        AsyncGlobWalkTask::create_on_js_thread(global_this, walk_task)
    }

    pub fn run(&mut self) {
        let guard = scopeguard::guard(self.has_pending_activity, |hpa| {
            decr_pending_activity_flag(hpa);
        });
        // PORT NOTE: `defer decrPendingActivityFlag(...)` — runs on all paths.
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

    pub fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated> {
        // TODO(port): Zig `defer this.deinit()` self-destroys (frees walker + self).
        // In Rust, ownership of `Box<WalkTask>` should be consumed here so Drop
        // runs at scope exit. Verify ConcurrentPromiseTask::then signature in Phase B.

        if let Some(err) = &self.err {
            promise.reject_with_async_stack(self.global, err.to_js(self.global))?;
            return Ok(());
        }

        let js_strings = match glob_walk_result_to_js(&mut self.walker, self.global) {
            Ok(v) => v,
            Err(_) => return promise.reject(self.global, bun_core::err!("JSError")),
            // TODO(port): `error.JSError` value passed to promise.reject — verify bun_jsc API.
        };
        promise.resolve(self.global, js_strings)
    }
}

fn glob_walk_result_to_js(glob_walk: &mut GlobWalker, global_this: &JSGlobalObject) -> JsResult<JSValue> {
    if glob_walk.matched_paths.keys().is_empty() {
        return JSValue::create_empty_array(global_this, 0);
    }

    BunString::to_js_array(global_this, glob_walk.matched_paths.keys())
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

        let mut glob_walker = Box::new(GlobWalker::default());
        // errdefer alloc.destroy(globWalker) — handled by Box drop on `?` paths.

        if let Some(cwd) = cwd {
            match glob_walker.init_with_cwd(
                arena,
                &self.pattern,
                &cwd,
                dot,
                absolute,
                follow_symlinks,
                error_on_broken_symlinks,
                only_files,
            )? {
                bun_sys::Result::Err(err) => {
                    return global_this.throw_value(err.to_js(global_this)?);
                }
                _ => {}
            }
            return Ok(Some(glob_walker));
        }

        match glob_walker.init(
            arena,
            &self.pattern,
            dot,
            absolute,
            follow_symlinks,
            error_on_broken_symlinks,
            only_files,
        )? {
            bun_sys::Result::Err(err) => {
                return global_this.throw_value(err.to_js(global_this)?);
            }
            _ => {}
        }
        Ok(Some(glob_walker))
    }

    #[bun_jsc::host_fn]
    pub fn constructor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<Box<Glob>> {
        let arguments_ = callframe.arguments_old(1);
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());
        // `arguments` drops at scope exit (was `defer arguments.deinit()`).
        let Some(pat_arg) = arguments.next_eat() else {
            return global_this.throw(format_args!("Glob.constructor: expected 1 arguments, got 0"));
        };

        if !pat_arg.is_string() {
            return global_this.throw(format_args!("Glob.constructor: first argument is not a string"));
        }

        let pat_str: Box<[u8]> = pat_arg.to_slice_clone(global_this)?.into_boxed_slice();
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
        let arguments_ = callframe.arguments_old(1);
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());
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
        let task = match WalkTask::create(global_this, glob_walker, &self.has_pending_activity) {
            Ok(t) => t,
            Err(_) => {
                decr_pending_activity_flag(&self.has_pending_activity);
                // TODO(port): Zig also called `globWalker.deinit(true); alloc.destroy(globWalker)` here.
                // In Rust, `glob_walker` was moved into `WalkTask::create`; if create() fails it must
                // drop it internally. Verify bun_jsc::ConcurrentPromiseTask::create_on_js_thread.
                return global_this.throw_out_of_memory();
            }
        };
        // TODO(port): lifetime — WalkTask<'a> borrows &self.has_pending_activity and
        // global_this but outlives this stack frame (scheduled on thread pool).
        // Phase B: likely needs raw `*const AtomicUsize` / `*const JSGlobalObject`
        // despite LIFETIMES.tsv classification, since the task is heap-allocated and
        // kept alive by hasPendingActivity().
        task.schedule();

        Ok(task.promise.value())
    }

    #[bun_jsc::host_fn(method)]
    pub fn __scan_sync(&mut self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old(1);
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());

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
                return global_this.throw_value(err.to_js(global_this)?);
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

        let arguments_ = callframe.arguments_old(1);
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());
        let Some(str_arg) = arguments.next_eat() else {
            return global_this.throw(format_args!("Glob.matchString: expected 1 arguments, got 0"));
        };

        if !str_arg.is_string() {
            return global_this.throw(format_args!("Glob.matchString: first argument is not a string"));
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
