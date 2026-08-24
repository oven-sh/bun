use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::Arena;
use bun_core::String as BunString;
use bun_glob::BunGlobWalker as GlobWalker;
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    ArgumentsSlice, CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, Job, JobContext, JsPtr,
    JsResult, JsThread, StringJsc as _, SysErrorJsc as _,
};
use bun_paths::resolve_path::join_string_buf;
use bun_paths::{self as resolve_path, MAX_PATH_BYTES, PathBuffer, platform};
use bun_sys as syscall;

// Codegen hooks (JSGlob): toJS / fromJS / fromJSDirect are provided by the
// generated C++ wrapper. See PORTING.md §JSC ".classes.ts-backed types".
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
        fn_name: &'static str,
    ) -> JsResult<Box<[u8]>> {
        let cwd_string = BunString::from_js(cwd_val, global_this)?;
        if cwd_string.is_empty() {
            return Ok(Box::default());
        }

        let cwd_str: Box<[u8]> = 'cwd_str: {
            let cwd_utf8 = cwd_string.to_utf8();

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

/// `Glob.scan()` off the JS thread.
pub(crate) struct WalkTask {
    // `Box<GlobWalker>` drop runs `GlobWalker::Drop` then frees the box.
    walker: Box<GlobWalker>,
    err: Option<WalkTaskErr>,
}
// SAFETY: the walker owns its pattern/arena; nothing in it is thread-affine.
unsafe impl Send for WalkTask {}

/// While a scan is pending the `Glob` wrapper reports `hasPendingActivity`
/// (so it is not collected); released on the JS thread with the completion.
pub(crate) struct PendingScan(JsPtr<AtomicUsize>);
// JS-thread state: a counter inside the Glob's native part, which its wrapper owns.
impl bun_jsc::job::JsAffine for PendingScan {}
impl PendingScan {
    fn new(counter: &AtomicUsize) -> Self {
        let _ = counter.fetch_add(1, Ordering::SeqCst);
        // SAFETY: the Glob's m_ctx, kept alive by hasPendingActivity while > 0.
        Self(unsafe { JsPtr::new(core::ptr::NonNull::from(counter)) })
    }
}
impl Drop for PendingScan {
    fn drop(&mut self) {
        // Only ever dropped on the JS thread (a job's Js side); the pointer is
        // live because the count we hold kept the wrapper alive.
        // SAFETY: as above.
        let _ = unsafe { &*self.0.as_ptr() }.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(bun_jsc::JsAffine)]
pub(crate) struct WalkJs {
    promise: JSPromiseStrong,
    _pending: PendingScan,
}

pub(crate) enum WalkTaskErr {
    Syscall(syscall::Error),
    Unknown(crate::Error),
}

impl WalkTaskErr {
    fn to_js(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            WalkTaskErr::Syscall(err) => Ok(err.to_js(global_this)),
            WalkTaskErr::Unknown(err) => {
                bun_string_jsc::create_utf8_for_js(global_this, err.name().as_bytes())
            }
        }
    }
}

impl JobContext for WalkTask {
    type OffThread = Self;
    type Js = WalkJs;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        let result = match this.walker.walk() {
            Ok(r) => r,
            Err(err) => {
                this.err = Some(WalkTaskErr::Unknown(err.into()));
                return Some(done);
            }
        };
        if let bun_sys::Result::Err(err) = result {
            this.err = Some(WalkTaskErr::Syscall(err));
        }
        Some(done)
    }

    fn then(mut this: Self, mut js: WalkJs, cx: &JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        let promise = js.promise.swap();
        if let Some(err) = &this.err {
            promise.reject_with_async_stack(global, err.to_js(global))?;
            return Ok(());
        }
        let js_strings = match glob_walk_result_to_js(&mut this.walker, global) {
            Ok(v) => v,
            Err(e) => return promise.reject(global, Err(e)),
        };
        promise.resolve(global, js_strings)
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
    pub(crate) fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<Glob>> {
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
            .to_bun_string(global_this)?
            .to_owned_slice()
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
    pub(crate) fn has_pending_activity(&self) -> bool {
        self.has_pending_activity.load(Ordering::SeqCst) > 0
    }
}

impl Glob {
    // R-2 (host-fn re-entrancy): all JS-exposed methods take `&self`. `Glob`'s
    // fields are read-only after construction (`pattern`) or already atomic
    // (`has_pending_activity`), so no `Cell`/`JsCell` wrapping is needed — the
    // `&mut self` receivers were vestigial. The codegen shim still emits
    // `this: &mut Glob`; `&mut T` auto-derefs to `&T`.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn __scan(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), callframe.arguments());
        // `arguments` drops at scope exit.

        let mut arena = Arena::new();
        // GlobWalker::init/init_with_cwd own their allocations (Box); the
        // arena here is vestigial.
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

        let cx = global_this.js_thread();
        let promise = JSPromiseStrong::init(global_this);
        let value = promise.value();
        Job::<WalkTask>::schedule(
            &cx,
            WalkTask {
                walker: glob_walker,
                err: None,
            },
            WalkJs {
                promise,
                _pending: PendingScan::new(&self.has_pending_activity),
            },
        );
        Ok(value)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn __scan_sync(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns a non-null *mut to the live VirtualMachine for this global.
        let mut arguments = ArgumentsSlice::init(global_this.bun_vm(), callframe.arguments());

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
        // Box<GlobWalker> drops at scope exit.

        match glob_walker.walk().map_err(crate::Error::from)? {
            bun_sys::Result::Err(err) => {
                return Err(global_this.throw_value(err.to_js(global_this)));
            }
            bun_sys::Result::Ok(()) => {}
        }

        glob_walk_result_to_js(&mut glob_walker, global_this)
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

        let str = str_arg.to_utf8(global_this)?;

        Ok(JSValue::from(
            bun_glob::r#match(&self.pattern, str.slice()).matches(),
        ))
    }
}
