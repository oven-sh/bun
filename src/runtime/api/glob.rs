use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena;
use bun_core::String as BunString;
use bun_glob::BunGlobWalker as GlobWalker;
use bun_glob::walk::{Iterator as GlobIter, MatchedPath, SyscallAccessor};
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{
    ArgumentsSlice, CallFrame, JSGlobalObject, JSPromise, JSValue, JsCell, JsResult, JsTerminated,
    StringJsc as _, SysErrorJsc as _, bun_string_jsc,
};
use bun_paths::resolve_path::join_string_buf;
use bun_paths::{self as resolve_path, MAX_PATH_BYTES, PathBuffer, platform};
use bun_sys as syscall;

// Codegen hooks (JSGlob): toJS / fromJS / fromJSDirect are provided by the
// generated C++ wrapper. See PORTING.md §JSC ".classes.ts-backed types".
#[bun_jsc::JsClass]
pub struct Glob {
    pattern: Box<[u8]>,
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
        fn_name: &'static str,
    ) -> JsResult<Box<[u8]>> {
        let cwd_string = bun_core::OwnedString::new(BunString::from_js(cwd_val, global_this)?);
        if cwd_string.is_empty() {
            return Ok(Box::default());
        }

        let cwd_str: Box<[u8]> = 'cwd_str: {
            let cwd_utf8 = cwd_string.to_utf8_without_ref();

            if cwd_utf8.slice().len() > MAX_PATH_BYTES {
                return Err(global_this.throw(format_args!(
                    "{}: invalid `cwd`, longer than {} bytes",
                    fn_name, MAX_PATH_BYTES
                )));
            }

            // If its absolute return as is
            if resolve_path::Platform::AUTO.is_absolute(cwd_utf8.slice()) {
                break 'cwd_str Box::<[u8]>::from(cwd_utf8.slice());
            }

            // `cwd_utf8` drops at scope exit.
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
        fn_name: &'static str,
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

pub(crate) enum WalkTaskErr {
    Syscall(syscall::Error),
    Unknown(crate::Error),
}

impl WalkTaskErr {
    pub(crate) fn to_js(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            WalkTaskErr::Syscall(err) => Ok(err.to_js(global_this)),
            WalkTaskErr::Unknown(err) => {
                bun_string_jsc::create_utf8_for_js(global_this, err.name().as_bytes())
            }
        }
    }
}

struct ScanIteratorState {
    /// `Box::into_raw`'d; null once torn down.
    walker: *mut GlobWalker,
    /// Borrows `*walker` (lifetime erased); initialized iff `walker` is non-null.
    iter: MaybeUninit<GlobIter<'static, SyscallAccessor, false>>,
    /// `iter.init()` done (deferred to the first chunk on the async path).
    did_init: bool,
}

enum Step {
    Match(MatchedPath),
    Done,
    Err(WalkTaskErr),
}

impl ScanIteratorState {
    fn new(walker: Box<GlobWalker>) -> Self {
        if walker.pattern_components.is_empty() {
            return Self {
                walker: core::ptr::null_mut(),
                iter: MaybeUninit::uninit(),
                did_init: true,
            };
        }
        let walker_ptr = Box::into_raw(walker);
        // SAFETY: `walker_ptr` is a live, uniquely-owned heap allocation that
        // outlives `iter` (freed only in `teardown`, after `iter` is dropped).
        let iter = GlobIter::new(unsafe { &mut *walker_ptr });
        Self {
            walker: walker_ptr,
            iter: MaybeUninit::new(iter),
            did_init: false,
        }
    }

    fn teardown(&mut self) {
        if self.walker.is_null() {
            return;
        }
        // SAFETY: `walker` non-null implies `iter` is initialized. Drop `iter`
        // first (it borrows the walker allocation and closes any open fds),
        // then free the walker.
        unsafe {
            self.iter.assume_init_drop();
            drop(Box::from_raw(self.walker));
        }
        self.walker = core::ptr::null_mut();
    }

    fn step(&mut self) -> Step {
        if self.walker.is_null() {
            return Step::Done;
        }
        // SAFETY: `walker` non-null implies `iter` is initialized.
        let iter = unsafe { self.iter.assume_init_mut() };
        if !self.did_init {
            self.did_init = true;
            match iter.init() {
                Err(err) => {
                    self.teardown();
                    return Step::Err(WalkTaskErr::Unknown(err.into()));
                }
                Ok(bun_sys::Result::Err(err)) => {
                    self.teardown();
                    return Step::Err(WalkTaskErr::Syscall(err));
                }
                Ok(bun_sys::Result::Ok(())) => {}
            }
        }
        loop {
            match iter.next() {
                Err(err) => {
                    self.teardown();
                    return Step::Err(WalkTaskErr::Unknown(err.into()));
                }
                Ok(bun_sys::Result::Err(err)) => {
                    self.teardown();
                    return Step::Err(WalkTaskErr::Syscall(err));
                }
                Ok(bun_sys::Result::Ok(None)) => {
                    self.teardown();
                    return Step::Done;
                }
                Ok(bun_sys::Result::Ok(Some(path))) => {
                    // `Iterator::init`'s literal-path arm yields without registering in `matched_paths`; skip those to match the previous result set.
                    if iter.walker.matched_paths.contains_key(&path[..]) {
                        return Step::Match(path);
                    }
                }
            }
        }
    }
}

impl Drop for ScanIteratorState {
    fn drop(&mut self) {
        self.teardown();
    }
}

/// Drives the `GlobWalker` incrementally for one `scan()` / `scanSync()` call.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GlobScanIterator {
    state: JsCell<ScanIteratorState>,
    has_pending_activity: AtomicUsize,
}

impl GlobScanIterator {
    fn new(walker: Box<GlobWalker>) -> Box<Self> {
        Box::new(Self {
            state: JsCell::new(ScanIteratorState::new(walker)),
            has_pending_activity: AtomicUsize::new(0),
        })
    }

    pub fn has_pending_activity(&self) -> bool {
        self.has_pending_activity.load(Ordering::SeqCst) > 0
    }

    /// Eager `iter.init()` so a bad `cwd` still throws at the `scanSync()` call site.
    fn init_sync(&self, global_this: &JSGlobalObject) -> JsResult<()> {
        self.state.with_mut(|state| {
            if state.walker.is_null() || state.did_init {
                return Ok(());
            }
            state.did_init = true;
            // SAFETY: `walker` non-null implies `iter` is initialized.
            let iter = unsafe { state.iter.assume_init_mut() };
            match iter.init() {
                Err(err) => {
                    state.teardown();
                    Err(crate::Error::from(err).into())
                }
                Ok(bun_sys::Result::Err(err)) => {
                    state.teardown();
                    Err(global_this.throw_value(err.to_js(global_this)))
                }
                Ok(bun_sys::Result::Ok(())) => Ok(()),
            }
        })
    }

    #[bun_jsc::host_fn(method)]
    pub fn next_sync(
        &self,
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.state.with_mut(|state| match state.step() {
            Step::Done => Ok(JSValue::NULL),
            Step::Err(WalkTaskErr::Syscall(err)) => {
                Err(global_this.throw_value(err.to_js(global_this)))
            }
            Step::Err(WalkTaskErr::Unknown(err)) => Err(err.into()),
            Step::Match(path) => bun_string_jsc::create_utf8_for_js(global_this, &path),
        })
    }

    /// Early-`break` hook: release open directory fds now rather than at GC.
    #[bun_jsc::host_fn(method)]
    pub fn close(
        &self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.has_pending_activity.load(Ordering::SeqCst) == 0 {
            self.state.with_mut(|state| state.teardown());
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn pull(&self, global_this: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        if self.state.get().walker.is_null() {
            return Ok(JSValue::NULL);
        }
        incr_pending_activity_flag(&self.has_pending_activity);
        let mut task = WalkTask::create(global_this, self);
        let promise = task.promise.value();
        task.schedule();
        // SAFETY: `self` is GC-rooted via `hasPendingActivity()` for the task's
        // duration; `into_raw` erases the stack-tied `'_` and ownership passes
        // to the work pool (freed via `ConcurrentPromiseTask::destroy`).
        let _ = bun_core::heap::into_raw(task);
        Ok(promise)
    }
}

pub(crate) type AsyncGlobWalkTask<'a> = ConcurrentPromiseTask<'a, WalkTask<'a>>;

/// Number of matches collected per thread-pool round-trip by `scan()`.
const ASYNC_CHUNK: usize = 64;

pub(crate) struct WalkTask<'a> {
    /// Inside the `GlobScanIterator`, GC-rooted via `hasPendingActivity`.
    state: *mut ScanIteratorState,
    chunk: Vec<MatchedPath>,
    done: bool,
    err: Option<WalkTaskErr>,
    global: &'a JSGlobalObject,
    has_pending_activity: &'a AtomicUsize,
}

impl<'a> WalkTask<'a> {
    fn create(
        global_this: &'a JSGlobalObject,
        scanner: &'a GlobScanIterator,
    ) -> Box<AsyncGlobWalkTask<'a>> {
        let walk_task = Box::new(WalkTask {
            state: scanner.state.as_ptr(),
            chunk: Vec::new(),
            done: false,
            err: None,
            global: global_this,
            has_pending_activity: &scanner.has_pending_activity,
        });
        AsyncGlobWalkTask::create_on_js_thread(global_this, walk_task)
    }
}

impl<'a> ConcurrentPromiseTaskContext for WalkTask<'a> {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AsyncGlobWalkTask;

    fn run(&mut self) {
        // SAFETY: the owning `GlobScanIterator` is GC-rooted via
        // `hasPendingActivity` until `then()` decrements, and no JS-thread code
        // touches `state` while a pull is in flight (the builtin generator
        // awaits each chunk before the next call).
        let state = unsafe { &mut *self.state };
        self.chunk.reserve(ASYNC_CHUNK);
        while self.chunk.len() < ASYNC_CHUNK {
            match state.step() {
                Step::Match(path) => self.chunk.push(path),
                Step::Done => {
                    self.done = true;
                    break;
                }
                Step::Err(err) => {
                    self.err = Some(err);
                    break;
                }
            }
        }
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated> {
        let guard = scopeguard::guard(self.has_pending_activity, |hpa| {
            decr_pending_activity_flag(hpa);
        });

        if let Some(err) = self.err.take() {
            drop(guard);
            promise.reject_with_async_stack(self.global, err.to_js(self.global))?;
            return Ok(());
        }

        if self.chunk.is_empty() && self.done {
            drop(guard);
            return promise.resolve(self.global, JSValue::NULL);
        }

        let js_strings = JSValue::create_array_from_iter(
            self.global,
            core::mem::take(&mut self.chunk).into_iter(),
            |path| bun_string_jsc::create_utf8_for_js(self.global, &path),
        );
        drop(guard);
        match js_strings {
            Ok(v) => promise.resolve(self.global, v),
            Err(e) => promise.reject(self.global, Err(e)),
        }
    }
}

impl Glob {
    /// The reference to the arena is not used after the scope because it is copied
    /// by `GlobWalker.init`/`GlobWalker.initWithCwd` if all allocations work and no
    /// errors occur
    fn make_glob_walker(
        &self,
        global_this: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
        fn_name: &'static str,
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
            )
            .map_err(crate::Error::from)?
            {
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
        )
        .map_err(crate::Error::from)?
        {
            bun_sys::Result::Err(err) => {
                return Err(global_this.throw_value(err.to_js(global_this)));
            }
            bun_sys::Result::Ok(gw) => Box::new(gw),
        };
        Ok(Some(glob_walker))
    }

    // No `#[bun_jsc::host_fn]` here — the `#[bun_jsc::JsClass]` derive on
    // the struct already emits the `GlobClass__construct` shim that calls
    // `<Glob>::constructor(..)`. The free-fn `host_fn` expansion can't name an
    // associated fn without a receiver.
    pub fn constructor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<Box<Glob>> {
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), callframe.arguments());
        // `arguments` drops at scope exit.
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

        Ok(Box::new(Glob { pattern: pat_str }))
    }
}

fn incr_pending_activity_flag(has_pending_activity: &AtomicUsize) {
    let _ = has_pending_activity.fetch_add(1, Ordering::SeqCst);
}

fn decr_pending_activity_flag(has_pending_activity: &AtomicUsize) {
    let _ = has_pending_activity.fetch_sub(1, Ordering::SeqCst);
}

impl Glob {
    fn make_scanner(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        fn_name: &'static str,
    ) -> JsResult<Option<Box<GlobScanIterator>>> {
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), callframe.arguments());
        let mut arena = Arena::new();
        Ok(self
            .make_glob_walker(global_this, &mut arguments, fn_name, &mut arena)?
            .map(GlobScanIterator::new))
    }

    #[bun_jsc::host_fn(method)]
    pub fn __scan(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        match self.make_scanner(global_this, callframe, "scan")? {
            None => Ok(JSValue::UNDEFINED),
            Some(scanner) => Ok(GlobScanIterator::to_js_boxed(scanner, global_this)),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn __scan_sync(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        match self.make_scanner(global_this, callframe, "scanSync")? {
            None => Ok(JSValue::UNDEFINED),
            Some(scanner) => {
                scanner.init_sync(global_this)?;
                Ok(GlobScanIterator::to_js_boxed(scanner, global_this))
            }
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn r#match(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), callframe.arguments());
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
        // `str` drops at scope exit.

        Ok(JSValue::from(
            bun_glob::r#match(&self.pattern, str.slice()).matches(),
        ))
    }
}
