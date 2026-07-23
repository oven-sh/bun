use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsCell, JsResult, SysErrorJsc as _};

use crate::node::fs::{
    self, AsyncCpTask, AsyncReaddirRecursiveTask, Flavor, FsArgument, FsCompletion, FsReturn,
    NodeFS, NodeFSDispatch, NodeFSFunctionEnum, Op, args, async_, ret,
};

/// Signature of every generated NodeFS host function.
pub(crate) type NodeFSFunction =
    fn(this: &Binding, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>;

// The (`args::*`, `ret::*`, `NodeFS::<method>`, `async_::*`) quadruples are
// spelled out once in `node_fs.rs` (the `NodeFS::dispatch` table +
// `async_::*` aliases) and reused here via the `node_fs_bindings!` macro at
// the bottom of this file.

/// Returns bindings to call jsc.Node.fs.NodeFS.<function>.
/// Async calls use a thread pool.

/// `Bindings(FunctionEnum).runSync`.
fn run_sync<R: FsReturn, A: FsArgument, const F: NodeFSFunctionEnum>(
    this: &Binding,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue>
where
    Op<{ F }>: NodeFSDispatch<R, A>,
{
    // SAFETY: `bun_vm()` returns the live `*mut VirtualMachine`; borrowed only
    // for the duration of argument parsing on the JS thread.
    let vm: &VirtualMachine = global.bun_vm();
    let mut slice = ArgumentsSlice::init(vm, frame.arguments());
    // `defer slice.deinit()` → `Drop for ArgumentsSlice`.

    // `defer if (@hasDecl(Arguments, "deinit")) args.deinit()` → `Drop for A`
    // (every `args::*` field type — `PathLike`, `StringOrBuffer`, `Vec`, … —
    // releases its own resources; the wrapper structs need no manual hook).
    let args = <A as FsArgument>::from_js(global, &mut slice)?;

    if global.has_exception() {
        return Ok(JSValue::ZERO);
    }

    // R-2: `JsCell::with_mut` scopes the `&mut NodeFS` to the blocking
    // syscall; `dispatch` never re-enters JS, and `Maybe<R>` is fully owned
    // (`sys::Error.path` is `Box<[u8]>`, not a borrow into `sync_error_buf`).
    let mut result = this
        .node_fs
        .with_mut(|nfs| NodeFS::dispatch::<R, A, F>(nfs, &args, Flavor::Sync));
    match result {
        Err(ref err) => Err(global.throw_value(err.to_js(global))),
        Ok(ref mut res) => res.fs_to_js(global),
    }
}

/// Which flavour of entry point was called.
///
/// The `*Cb` entry points take the completion callback as their final argument
/// *by contract*, never by sniffing for a trailing function: fs operations do
/// accept functions in positional slots (`fs.read(fd, buf, 0, 4, fn)` has to
/// reject `fn` as an invalid `position`), so a callable last argument says
/// nothing about what the caller meant.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum CallShape {
    /// `node:fs/promises` — every argument is positional; returns a promise.
    Promise,
    /// `node:fs` — the last argument is the completion callback.
    Callback,
}

/// Splits the completion callback off the positional arguments. What remains is
/// exactly the argument list the `args::*` parsers see in promise mode.
fn split_callback(frame: &CallFrame, shape: CallShape) -> (&[JSValue], Option<JSValue>) {
    let arguments = frame.arguments();
    match shape {
        CallShape::Promise => (arguments, None),
        // `node:fs` runs `ensureCallback` before it reaches us, so the split is
        // total for every real caller; a zero-argument call falls through to
        // promise mode and the argument parser reports the missing path/fd.
        CallShape::Callback => match arguments.split_last() {
            Some((callback, rest)) => (rest, Some(*callback)),
            None => (arguments, None),
        },
    }
}

/// `Bindings(FunctionEnum).runAsync` for every operation except `.cp` /
/// `.readdir` (those have bespoke entry points below).
///
/// `create_task` is `async_::<FunctionName>::create` — passed in because the
/// Windows path picks `UVFSRequest` for a handful of fds-only ops while
/// everything else uses `AsyncFSTask`, and that choice is encoded in the
/// `async_::*` type aliases rather than derivable from `F` alone.
fn run_async<A: FsArgument>(
    this: &Binding,
    global: &JSGlobalObject,
    frame: &CallFrame,
    create_task: fn(&JSGlobalObject, &Binding, A, &mut VirtualMachine, FsCompletion) -> JSValue,
    shape: CallShape,
) -> JsResult<JSValue> {
    // SAFETY: JS-thread borrow of the per-thread VM; outlives `slice`.
    let vm: &mut VirtualMachine = global.bun_vm().as_mut();
    let (arguments, callback) = split_callback(frame, shape);
    let mut slice = ManuallyDrop::new(ArgumentsSlice::init(vm, arguments));
    slice.will_be_async = true;

    // `ManuallyDrop` keeps `slice` alive past return when ownership transfers
    // to the Task: dropped only on the early-return
    // error/abort branches; on the success path the Task owns `args` (whose
    // protected JSValues are released by `Drop for ThreadSafe<A>` when the
    // Task completes), and `slice` is intentionally not dropped — its
    // `Drop`-unprotect would race that.

    let mut args = match <A as FsArgument>::from_js(global, &mut slice) {
        Ok(a) => a,
        Err(err) => {
            // SAFETY: not yet dropped; only drop site for this path.
            unsafe { ManuallyDrop::drop(&mut slice) };
            return Err(err);
        }
    };

    if global.has_exception() {
        args.unprotect();
        drop(args);
        // SAFETY: not yet dropped; only drop site for this path.
        unsafe { ManuallyDrop::drop(&mut slice) };
        return Ok(JSValue::ZERO);
    }

    if A::HAVE_ABORT_SIGNAL {
        if let Some(signal) = args.signal() {
            if let Some(abort_error) = signal.node_abort_error_if_aborted(global) {
                args.unprotect();
                drop(args);
                // SAFETY: not yet dropped; only drop site for this path.
                unsafe { ManuallyDrop::drop(&mut slice) };
                // The callback must not fire synchronously; node defers it to the
                // next tick, same as the rejected promise does for `fs.promises`.
                let Some(callback) = callback else {
                    return Ok(
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global,
                            abort_error,
                        ),
                    );
                };
                JSValue::call_next_tick_1(callback, global, abort_error)?;
                return Ok(JSValue::UNDEFINED);
            }
        }
    }

    // The `cp` / `readdir` operations are handled by their dedicated
    // bindings below.
    // SAFETY: re-borrow `vm` mutably; the `slice` borrow is no longer used.
    let vm: &mut VirtualMachine = global.bun_vm().as_mut();
    let completion = FsCompletion::init(global, callback);
    Ok(create_task(global, this, args, vm, completion))
}

#[inline(always)]
const fn call_sync<R: FsReturn, A: FsArgument, const F: NodeFSFunctionEnum>() -> NodeFSFunction
where
    Op<{ F }>: NodeFSDispatch<R, A>,
{
    run_sync::<R, A, F>
}

// R-2 (host-fn re-entrancy): every JS-exposed binding takes `&self`; the
// single mutable field `node_fs` is wrapped in `JsCell` so the
// `sync_error_buf` scratch buffer and `&mut NodeFS` syscall dispatches are
// projected through interior mutability instead of `&mut Binding`. The
// codegen shim still emits `this: &mut NodeJSFS` — `&mut T` auto-coerces to
// `&T` so the impls below compile against either.
#[bun_jsc::JsClass(name = "NodeJSFS", no_constructor)]
#[derive(Default)]
pub struct Binding {
    pub node_fs: JsCell<NodeFS>,
}

impl Binding {
    // `pub const js = jsc.Codegen.JSNodeJSFS;` + `toJS`/`fromJS`/`fromJSDirect`
    // → provided by `#[bun_jsc::JsClass]` derive.

    // `pub const new = bun.TrivialNew(@This());`
    pub fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    pub fn finalize(self: Box<Self>) {
        if self.node_fs.get().vm.is_some() {
            // `node_fs.vm` is always the per-thread VM when set; route the
            // read through the safe singleton accessor.
            let vm_node_fs = VirtualMachine::get().node_fs;
            // `JsCell` is `repr(transparent)` over `UnsafeCell<NodeFS>`, so
            // `as_ptr()` yields the same address the VM stored at init time.
            if vm_node_fs == Some(self.node_fs.as_ptr().cast()) {
                // VM-owned singleton — keep alive.
                let _ = bun_core::heap::release(self);
                return;
            }
        }
        drop(self);
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_dirent(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(crate::node::Dirent::get_constructor(global))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stats(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(crate::node::StatsSmall::get_constructor(global))
    }

    // ── Hand-written bindings for ops outside `NodeFSFunctionEnum` ────────

    /// `callAsync(.cp)` — `AsyncCpTask::create` copies its paths via
    /// `to_thread_safe()`, so the arena is dropped with `slice`.
    pub fn cp(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM; outlives `slice`.
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        let mut slice = ManuallyDrop::new(ArgumentsSlice::init(vm, frame.arguments()));
        slice.will_be_async = true;

        let cp_args = match args::Cp::from_js(global, &mut slice) {
            Ok(a) => a,
            Err(err) => {
                // SAFETY: not yet dropped; only drop site for this path.
                unsafe { ManuallyDrop::drop(&mut slice) };
                return Err(err);
            }
        };

        if global.has_exception() {
            drop(cp_args);
            // SAFETY: not yet dropped; only drop site for this path.
            unsafe { ManuallyDrop::drop(&mut slice) };
            return Ok(JSValue::ZERO);
        }

        // SAFETY: re-borrow `vm` mutably; the `slice` borrow is no longer used.
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        let completion = FsCompletion::init(global, None);
        Ok(AsyncCpTask::create(global, this, cp_args, vm, completion))
    }

    /// `callSync(.cp)`.
    pub fn cp_sync(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = global.bun_vm();
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());

        // `defer args.deinit()` → `Drop` on `cp_args` (its `PathLike` fields).
        let cp_args = args::Cp::from_js(global, &mut slice)?;

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        // R-2: blocking syscall — `&mut NodeFS` scoped to the call, no JS re-entry.
        match this.node_fs.with_mut(|nfs| nfs.cp(&cp_args, Flavor::Sync)) {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(()) => Ok(JSValue::UNDEFINED),
        }
    }

    /// `callAsync(.readdir)` — `args.recursive` selects
    /// `AsyncReaddirRecursiveTask` instead of the generic `AsyncFSTask`.
    pub fn readdir(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        Self::readdir_impl(this, global, frame, CallShape::Promise)
    }

    /// `readdir` with a trailing completion callback. See [`CallShape`].
    pub fn readdir_cb(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::readdir_impl(this, global, frame, CallShape::Callback)
    }

    fn readdir_impl(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        shape: CallShape,
    ) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM; outlives `slice`.
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        let (arguments, callback) = split_callback(frame, shape);
        let mut slice = ManuallyDrop::new(ArgumentsSlice::init(vm, arguments));
        slice.will_be_async = true;

        let rd_args = match args::Readdir::from_js(global, &mut slice) {
            Ok(a) => a,
            Err(err) => {
                // SAFETY: not yet dropped; only drop site for this path.
                unsafe { ManuallyDrop::drop(&mut slice) };
                return Err(err);
            }
        };

        if global.has_exception() {
            drop(rd_args);
            // SAFETY: not yet dropped; only drop site for this path.
            unsafe { ManuallyDrop::drop(&mut slice) };
            return Ok(JSValue::ZERO);
        }

        // SAFETY: re-borrow `vm` mutably; the `slice` borrow is no longer used.
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        let completion = FsCompletion::init(global, callback);
        if rd_args.recursive {
            return Ok(AsyncReaddirRecursiveTask::create(
                global, rd_args, vm, completion,
            ));
        }
        Ok(async_::Readdir::create(
            global, this, rd_args, vm, completion,
        ))
    }

    /// `callSync(.watch)` — `args::Watch` borrows `globalThis` so it can't go
    /// through `FsArgument`/`dispatch`; call the inherent method directly.
    pub fn watch(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = global.bun_vm();
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());

        let watch_args = fs::Watcher::Arguments::from_js(global, &mut slice)?;

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        // R-2: `NodeFS::watch` only reads `self.vm` (no scratch-buffer write);
        // scoped via `with_mut` so the borrow cannot outlive the call.
        match this
            .node_fs
            .with_mut(|nfs| nfs.watch(&watch_args, Flavor::Sync))
        {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    }

    /// `callSync(.watchFile)`.
    pub fn watch_file(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = global.bun_vm();
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());

        let wf_args = fs::StatWatcher::Arguments::from_js(global, &mut slice)?;

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        match this
            .node_fs
            .with_mut(|nfs| nfs.watch_file(wf_args, Flavor::Sync))
        {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    }

    /// `callSync(.unwatchFile)` — `Arguments == void`.
    pub fn unwatch_file(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = global.bun_vm();
        let _slice = ArgumentsSlice::init(vm, frame.arguments());

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        match this
            .node_fs
            .with_mut(|nfs| nfs.unwatch_file((), Flavor::Sync))
        {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(()) => Ok(JSValue::UNDEFINED),
        }
    }
}

/// Generates the `pub const <name> = call{Async,Sync}(.<fn>)` block.
/// Each row supplies the `(args, ret, NodeFSFunctionEnum)` triple for one op.
macro_rules! node_fs_bindings {
    ( $( $sync:ident / $async_:ident / $async_cb:ident => $F:ident, $Args:ty, $Ret:ty ; )* ) => {
        impl Binding {
            $(
                pub const $sync: NodeFSFunction =
                    call_sync::<$Ret, $Args, { NodeFSFunctionEnum::$F }>();
                pub fn $async_(
                    this: &Self,
                    global: &JSGlobalObject,
                    frame: &CallFrame,
                ) -> JsResult<JSValue> {
                    run_async::<$Args>(this, global, frame, async_::$F::create, CallShape::Promise)
                }
                pub fn $async_cb(
                    this: &Self,
                    global: &JSGlobalObject,
                    frame: &CallFrame,
                ) -> JsResult<JSValue> {
                    run_async::<$Args>(this, global, frame, async_::$F::create, CallShape::Callback)
                }
            )*
        }
    };
}

#[rustfmt::skip]
node_fs_bindings! {
    access_sync          / access          / access_cb          => Access,            args::Access,     ret::Access;
    append_file_sync     / append_file     / append_file_cb     => AppendFile,        args::AppendFile, ret::AppendFile;
    close_sync           / close           / close_cb           => Close,             args::Close,      ret::Close;
    copy_file_sync       / copy_file       / copy_file_cb       => CopyFile,          args::CopyFile,   ret::CopyFile;
    exists_sync          / exists          / exists_cb          => Exists,            args::Exists,     ret::Exists;
    chown_sync           / chown           / chown_cb           => Chown,             args::Chown,      ret::Chown;
    chmod_sync           / chmod           / chmod_cb           => Chmod,             args::Chmod,      ret::Chmod;
    fchmod_sync          / fchmod          / fchmod_cb          => Fchmod,            args::FChmod,     ret::Fchmod;
    fchown_sync          / fchown          / fchown_cb          => Fchown,            args::Fchown,     ret::Fchown;
    fstat_sync           / fstat           / fstat_cb           => Fstat,             args::Fstat,      ret::Fstat;
    fsync_sync           / fsync           / fsync_cb           => Fsync,             args::Fsync,      ret::Fsync;
    ftruncate_sync       / ftruncate       / ftruncate_cb       => Ftruncate,         args::FTruncate,  ret::Ftruncate;
    futimes_sync         / futimes         / futimes_cb         => Futimes,           args::Futimes,    ret::Futimes;
    lchmod_sync          / lchmod          / lchmod_cb          => Lchmod,            args::LCHmod,     ret::Lchmod;
    lchown_sync          / lchown          / lchown_cb          => Lchown,            args::LChown,     ret::Lchown;
    link_sync            / link            / link_cb            => Link,              args::Link,       ret::Link;
    lstat_sync           / lstat           / lstat_cb           => Lstat,             args::Lstat,      ret::Lstat;
    mkdir_sync           / mkdir           / mkdir_cb           => Mkdir,             args::Mkdir,      ret::Mkdir;
    mkdtemp_sync         / mkdtemp         / mkdtemp_cb         => Mkdtemp,           args::MkdirTemp,  ret::Mkdtemp;
    open_sync            / open            / open_cb            => Open,              args::Open,       ret::Open;
    read_sync            / read            / read_cb            => Read,              args::Read,       ret::Read;
    write_sync           / write           / write_cb           => Write,             args::Write,      ret::Write;
    read_file_sync       / read_file       / read_file_cb       => ReadFile,          args::ReadFile,   ret::ReadFile;
    write_file_sync      / write_file      / write_file_cb      => WriteFile,         args::WriteFile,  ret::WriteFile;
    readlink_sync        / readlink        / readlink_cb        => Readlink,          args::Readlink,   ret::Readlink;
    rm_sync              / rm              / rm_cb              => Rm,                args::Rm,         ret::Rm;
    rmdir_sync           / rmdir           / rmdir_cb           => Rmdir,             args::RmDir,      ret::Rmdir;
    realpath_sync        / realpath        / realpath_cb        => RealpathNonNative, args::Realpath,   ret::Realpath;
    realpath_native_sync / realpath_native / realpath_native_cb => Realpath,          args::Realpath,   ret::Realpath;
    rename_sync          / rename          / rename_cb          => Rename,            args::Rename,     ret::Rename;
    stat_sync            / stat            / stat_cb            => Stat,              args::Stat,       ret::Stat;
    statfs_sync          / statfs          / statfs_cb          => Statfs,            args::StatFS,     ret::StatFS;
    symlink_sync         / symlink         / symlink_cb         => Symlink,           args::Symlink,    ret::Symlink;
    truncate_sync        / truncate        / truncate_cb        => Truncate,          args::Truncate,   ret::Truncate;
    unlink_sync          / unlink          / unlink_cb          => Unlink,            args::Unlink,     ret::Unlink;
    utimes_sync          / utimes          / utimes_cb          => Utimes,            args::Utimes,     ret::Utimes;
    lutimes_sync         / lutimes         / lutimes_cb         => Lutimes,           args::Lutimes,    ret::Lutimes;
    writev_sync          / writev          / writev_cb          => Writev,            args::Writev,     ret::Writev;
    readv_sync           / readv           / readv_cb           => Readv,             args::Readv,      ret::Readv;
    fdatasync_sync       / fdatasync       / fdatasync_cb       => Fdatasync,         args::FdataSync,  ret::Fdatasync;
}

// `readdirSync` goes through the generic sync path; only the async side is
// special-cased above.
impl Binding {
    pub const readdir_sync: NodeFSFunction =
        call_sync::<ret::Readdir, args::Readdir, { NodeFSFunctionEnum::Readdir }>();
    // pub const statfs = callAsync(.statfs);
    // pub const statfsSync = callSync(.statfs);
}

pub(crate) fn create_binding(global: &JSGlobalObject) -> JSValue {
    let module = Binding::new(Binding::default());

    let vm = global.bun_vm_ptr();
    // R-2: init-time write before the JS wrapper exists; `with_mut` here is
    // trivially un-aliased (sole owner of the fresh `Box`).
    module.node_fs.with_mut(|nfs| nfs.vm = NonNull::new(vm));

    // `module` was `Box::new`-allocated; ownership transfers to the GC
    // wrapper, which calls `Binding::finalize` to reclaim it.
    Binding::to_js_boxed(module, global)
}

/// Test-only (`bun:internal-for-testing`): run `(path, options)` through the
/// exact argument parser `fs.rm` uses and return the parsed options, so node's
/// `internal/fs/utils` `validateRmOptionsSync` tests exercise the production
/// validation (including its rejection of own-but-`undefined` booleans).
#[bun_jsc::host_fn]
pub(crate) fn rm_options_for_testing(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // SAFETY: `bun_vm()` returns the live VM; borrowed only while parsing on
    // the JS thread (same contract as `run_sync` above).
    let vm: &VirtualMachine = global.bun_vm();
    let mut slice = ArgumentsSlice::init(vm, frame.arguments());
    let parsed = args::Rm::from_js(global, &mut slice)?;
    let obj = JSValue::create_empty_object(global, 4);
    obj.put(
        global,
        b"retryDelay",
        JSValue::js_number(parsed.retry_delay as f64),
    );
    obj.put(
        global,
        b"maxRetries",
        JSValue::js_number(parsed.max_retries as f64),
    );
    obj.put(global, b"recursive", JSValue::js_boolean(parsed.recursive));
    obj.put(global, b"force", JSValue::js_boolean(parsed.force));
    Ok(obj)
}

/// Test-only (`bun:internal-for-testing`): run a flags value through the same
/// parser `fs.open` uses and return the numeric O_* mask, so node's
/// `internal/fs/utils` `stringToFlags` tests can assert the production mapping.
#[bun_jsc::host_fn]
pub(crate) fn string_to_flags_for_testing(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    use crate::node::types::FileSystemFlags;
    let arguments = frame.arguments_old::<1>();
    let val = if arguments.len < 1 {
        JSValue::UNDEFINED
    } else {
        arguments.ptr[0]
    };
    let flags = FileSystemFlags::from_js(global, val)?.unwrap_or(FileSystemFlags::R);
    // On Windows the internal bun.O bits are POSIX-shaped and translated to the
    // MSVCRT `_O_*` values at the open boundary; node's stringToFlags and
    // fs.constants both speak MSVCRT, so translate here too.
    #[cfg(windows)]
    let bits = bun_sys::windows::libuv::O::from_bun_o(flags.as_int());
    #[cfg(not(windows))]
    let bits = flags.as_int();
    Ok(JSValue::js_number_from_int32(bits))
}

#[bun_jsc::host_fn]
pub(crate) fn create_memfd_for_testing(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>();

    if arguments.len < 1 {
        return Ok(JSValue::UNDEFINED);
    }

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = arguments;
        return Err(global.throw(format_args!(
            "memfd_create is not implemented on this platform"
        )));
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let size = arguments.ptr[0].to_int64();
        match bun_sys::memfd_create(c"my_memfd", bun_sys::MemfdFlags::NonExecutable) {
            Ok(fd) => {
                let _ = bun_sys::ftruncate(fd, size);
                Ok(JSValue::js_number_from_int32(fd.native() as i32))
            }
            Err(err) => Err(global.throw_value(err.to_js(global))),
        }
    }
}
