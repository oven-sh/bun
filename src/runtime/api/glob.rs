use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena;
use bun_core::String as BunString;
use bun_glob::BunGlobIterator as GlobIterator;
use bun_glob::BunGlobWalker as GlobWalker;
use bun_jsc::bun_string_jsc;
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{
    ArgumentsSlice, CallFrame, JSGlobalObject, JSPromise, JSValue, JsCell, JsResult, JsTerminated,
    StringJsc as _, SysErrorJsc as _,
};
use bun_paths::resolve_path::join_string_buf;
use bun_paths::{self as resolve_path, MAX_PATH_BYTES, PathBuffer, platform};
use bun_sys as syscall;

const BATCH_SIZE: usize = 256;

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

/// Drive `iter` for up to [`BATCH_SIZE`] matches, initializing it on the
/// first call. Returns `Ok(false)` once the iterator is exhausted so the
/// caller can drop it and short-circuit the next batch call.
fn drive_batch(
    iter: &mut GlobIterator,
    inited: &mut bool,
    batch: &mut Vec<Box<[u8]>>,
) -> Result<bool, WalkTaskErr> {
    if !*inited {
        *inited = true;
        match iter.init() {
            Ok(Ok(())) => {}
            Ok(Err(err)) => return Err(WalkTaskErr::Syscall(err)),
            Err(err) => return Err(WalkTaskErr::Unknown(err.into())),
        }
    }
    while batch.len() < BATCH_SIZE {
        match iter.next() {
            Ok(Ok(Some(path))) => batch.push(path),
            Ok(Ok(None)) => return Ok(false),
            Ok(Err(err)) => return Err(WalkTaskErr::Syscall(err)),
            Err(err) => return Err(WalkTaskErr::Unknown(err.into())),
        }
    }
    Ok(true)
}

fn batch_to_js(batch: &[Box<[u8]>], global_this: &JSGlobalObject) -> JsResult<JSValue> {
    if batch.is_empty() {
        return Ok(JSValue::NULL);
    }
    JSValue::create_array_from_iter(global_this, batch.iter(), |path| {
        bun_string_jsc::create_utf8_for_js(global_this, path)
    })
}

/// Incremental scan state behind `Glob.scan`/`scanSync`. Owns the walker via
/// an owning `Iterator<Box<GlobWalker>, ..>`; dropping the iterator closes any
/// open directory fds and drains the work stack.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GlobScanHandle {
    iter: JsCell<Option<Box<GlobIterator>>>,
    inited: JsCell<bool>,
    has_pending_activity: AtomicUsize,
}

impl GlobScanHandle {
    fn open(walker: Box<GlobWalker>, global_this: &JSGlobalObject) -> JSValue {
        let handle = Box::new(GlobScanHandle {
            iter: JsCell::new(Some(Box::new(GlobIterator::new(walker)))),
            inited: JsCell::new(false),
            has_pending_activity: AtomicUsize::new(0),
        });
        GlobScanHandle::to_js_boxed(handle, global_this)
    }

    pub fn has_pending_activity(&self) -> bool {
        self.has_pending_activity.load(Ordering::SeqCst) > 0
    }

    #[bun_jsc::host_fn(method)]
    pub fn __batch(
        &self,
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(iter) = self.iter.replace(None) else {
            return Ok(JSValue::NULL);
        };

        self.has_pending_activity.fetch_add(1, Ordering::SeqCst);
        let ctx = Box::new(WalkTask {
            iter: Some(iter),
            inited: self.inited.replace(true),
            batch: Vec::new(),
            err: None,
            global: global_this,
            handle: core::ptr::from_ref(self).cast_mut(),
        });
        let mut task = AsyncGlobWalkTask::create_on_js_thread(global_this, ctx);
        let promise = task.promise.value();
        task.schedule();
        // WalkTask<'_> borrows `global_this` and holds a raw pointer to `self`.
        // Both referents outlive the task: `GlobScanHandle` is GC-rooted via
        // `hasPendingActivity()`, and `JSGlobalObject` lives until VM teardown.
        let _ = bun_core::heap::into_raw(task);
        Ok(promise)
    }

    #[bun_jsc::host_fn(method)]
    pub fn __batch_sync(
        &self,
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(mut iter) = self.iter.replace(None) else {
            return Ok(JSValue::NULL);
        };

        let mut batch: Vec<Box<[u8]>> = Vec::new();
        let mut inited = self.inited.replace(true);
        match drive_batch(&mut iter, &mut inited, &mut batch) {
            Ok(more) => {
                if more {
                    self.iter.set(Some(iter));
                }
                batch_to_js(&batch, global_this)
            }
            Err(err) => Err(global_this.throw_value(err.to_js(global_this)?)),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn __close(
        &self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.iter.set(None);
        Ok(JSValue::UNDEFINED)
    }
}

pub(crate) struct WalkTask<'a> {
    iter: Option<Box<GlobIterator>>,
    inited: bool,
    batch: Vec<Box<[u8]>>,
    err: Option<WalkTaskErr>,
    global: &'a JSGlobalObject,
    /// The GC-owned handle this batch was taken from. The handle is kept alive
    /// while the task is in flight via `has_pending_activity`.
    handle: *mut GlobScanHandle,
}

pub(crate) type AsyncGlobWalkTask<'a> = ConcurrentPromiseTask<'a, WalkTask<'a>>;

impl<'a> ConcurrentPromiseTaskContext for WalkTask<'a> {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AsyncGlobWalkTask;

    fn run(&mut self) {
        let iter = self.iter.as_deref_mut().expect("iter taken before run");
        match drive_batch(iter, &mut self.inited, &mut self.batch) {
            Ok(more) => {
                if !more {
                    self.iter = None;
                }
            }
            Err(err) => {
                self.iter = None;
                self.err = Some(err);
            }
        }
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated> {
        // SAFETY: `handle` points at the live `m_ctx` payload of a JS wrapper
        // kept reachable by `has_pending_activity > 0` for the duration of
        // this task; `then` runs on the JS thread so no concurrent access.
        let handle = unsafe { &*self.handle };
        handle.iter.set(self.iter.take());
        handle.has_pending_activity.fetch_sub(1, Ordering::SeqCst);

        if let Some(err) = &self.err {
            promise.reject_with_async_stack(self.global, err.to_js(self.global))?;
            return Ok(());
        }

        let js = match batch_to_js(&self.batch, self.global) {
            Ok(v) => v,
            Err(e) => return promise.reject(self.global, Err(e)),
        };
        promise.resolve(self.global, js)
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

impl Glob {
    // R-2 (host-fn re-entrancy): all JS-exposed methods take `&self`. `Glob`'s
    // only field (`pattern`) is read-only after construction, so no
    // `Cell`/`JsCell` wrapping is needed.
    fn open_scan_handle(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        fn_name: &'static str,
    ) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), callframe.arguments());

        let mut arena = Arena::new();
        let glob_walker =
            match self.make_glob_walker(global_this, &mut arguments, fn_name, &mut arena) {
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

        Ok(GlobScanHandle::open(glob_walker, global_this))
    }

    #[bun_jsc::host_fn(method)]
    pub fn __scan(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.open_scan_handle(global_this, callframe, "scan")
    }

    #[bun_jsc::host_fn(method)]
    pub fn __scan_sync(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.open_scan_handle(global_this, callframe, "scanSync")
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
