use core::ptr::NonNull;

use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsCell, JsResult, SysErrorJsc as _};
use bun_sys_jsc::SystemErrorJsc as _;

use crate::node::ThreadIsolated;
use crate::node::fs::{
    self, AsyncCpTask, AsyncReaddirRecursiveTask, Flavor, FsArgument, FsReturn, NodeFS,
    NodeFSDispatch, NodeFSFunctionEnum, Op, args, async_, ret,
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
    let args = <A as FsArgument>::from_js(global, &mut slice)?;

    // R-2: `JsCell::with_mut` scopes the `&mut NodeFS` to the blocking
    // syscall; `dispatch` never re-enters JS, and `Maybe<R>` is fully owned
    // (`sys::Error.path` is `Box<[u8]>`, not a borrow into `sync_error_buf`).
    let result = this
        .node_fs
        .with_mut(|nfs| NodeFS::dispatch::<R, A, F>(nfs, &args, Flavor::Sync));
    match result {
        Err(err) => Err(global.throw_value(err.to_js(global))),
        Ok(res) => res.fs_to_js(global),
    }
}

/// Which arm of an async binding was called.
#[derive(Clone, Copy)]
enum AsyncArm {
    /// `node:fs/promises`: returns a promise.
    Promise,
    /// Argument 0 is the callback. `fs.promises` forwards user arguments, so a trailing function cannot mark this arm.
    Callback,
}

/// The arguments of the operation, and the callback for [`AsyncArm::Callback`].
fn split_callback<'a>(
    global: &JSGlobalObject,
    frame: &'a CallFrame,
    arm: AsyncArm,
) -> JsResult<(Option<JSValue>, &'a [JSValue])> {
    let arguments = frame.arguments();
    match arm {
        AsyncArm::Promise => Ok((None, arguments)),
        AsyncArm::Callback => match arguments.split_first() {
            Some((callback, rest)) if callback.is_callable() => Ok((Some(*callback), rest)),
            _ => Err(global.throw_invalid_arguments(format_args!("callback must be a function"))),
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
    arm: AsyncArm,
    create_task: fn(
        &bun_jsc::JsThread<'_>,
        &Binding,
        ThreadIsolated<A>,
        &mut VirtualMachine,
        Option<JSValue>,
    ) -> JSValue,
) -> JsResult<JSValue> {
    let (callback, arguments) = split_callback(global, frame, arm)?;
    let args = match parse_async_args::<A>(global, arguments)? {
        ParsedAsyncArgs::Args(args) => args,
        ParsedAsyncArgs::Rejected(error) => return reject_before_schedule(global, callback, error),
    };
    let vm: &mut VirtualMachine = global.bun_vm().as_mut();
    Ok(create_task(
        &global.js_thread_of_caller(frame),
        this,
        args,
        vm,
        callback,
    ))
}

enum ParsedAsyncArgs<A> {
    Args(ThreadIsolated<A>),
    /// The operation fails without being scheduled (an aborted signal, a path that is too long).
    Rejected(JSValue),
}

/// Parses an async binding's arguments. A validation error is thrown, as node does for both arms.
fn parse_async_args<A: FsArgument>(
    global: &JSGlobalObject,
    arguments: &[JSValue],
) -> JsResult<ParsedAsyncArgs<A>> {
    let vm: &VirtualMachine = global.bun_vm();
    let mut slice = ArgumentsSlice::init(vm, arguments);
    let args = A::from_js_async(global, &mut slice)?;

    if A::HAVE_ABORT_SIGNAL {
        if let Some(abort_error) = args
            .signal()
            .and_then(|signal| signal.node_abort_error_if_aborted(global))
        {
            return Ok(ParsedAsyncArgs::Rejected(abort_error));
        }
    }
    if let Some(err) = slice.deferred_error.take() {
        return Ok(ParsedAsyncArgs::Rejected((*err).to_error_instance(global)));
    }
    Ok(ParsedAsyncArgs::Args(args))
}

/// An error found before scheduling. The callback goes to nextTick bare: it asserts against an `AsyncContextFrame`.
fn reject_before_schedule(
    global: &JSGlobalObject,
    callback: Option<JSValue>,
    error: JSValue,
) -> JsResult<JSValue> {
    match callback {
        None => Ok(JSPromise::rejected_promise(global, error).to_js()),
        Some(callback) => {
            JSValue::call_next_tick_1(callback, global, error)?;
            Ok(JSValue::UNDEFINED)
        }
    }
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
pub(crate) struct Binding {
    pub(crate) node_fs: JsCell<NodeFS>,
}

impl Binding {
    // `pub const js = jsc.Codegen.JSNodeJSFS;` + `toJS`/`fromJS`/`fromJSDirect`
    // → provided by `#[bun_jsc::JsClass]` derive.

    // `pub const new = bun.TrivialNew(@This());`
    pub(crate) fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    pub(crate) fn finalize(self: Box<Self>) {
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
    pub(crate) fn get_dirent(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(crate::node::Dirent::get_constructor(global))
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_stats(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(crate::node::StatsSmall::get_constructor(global))
    }

    // ── Hand-written bindings for ops outside `NodeFSFunctionEnum` ────────

    /// `callAsync(.cp)`.
    pub(crate) fn cp(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let cp_args = match parse_async_args::<args::Cp<'static>>(global, frame.arguments())? {
            ParsedAsyncArgs::Args(args) => args,
            ParsedAsyncArgs::Rejected(error) => return reject_before_schedule(global, None, error),
        };
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        Ok(AsyncCpTask::create(
            &global.js_thread_of_caller(frame),
            this,
            cp_args,
            vm,
        ))
    }

    /// `callSync(.cp)`.
    pub(crate) fn cp_sync(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = global.bun_vm();
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());

        // `defer args.deinit()` → `Drop` on `cp_args` (its `PathLike` fields).
        let cp_args = args::Cp::from_js(global, &mut slice)?;

        // R-2: blocking syscall — `&mut NodeFS` scoped to the call, no JS re-entry.
        match this.node_fs.with_mut(|nfs| nfs.cp(&cp_args, Flavor::Sync)) {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(()) => Ok(JSValue::UNDEFINED),
        }
    }

    /// `callAsync(.readdir)` — `args.recursive` selects
    /// `AsyncReaddirRecursiveTask` instead of the generic `AsyncFSTask`.
    pub(crate) fn readdir(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::run_readdir(this, global, frame, AsyncArm::Promise)
    }

    pub(crate) fn readdir_cb(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::run_readdir(this, global, frame, AsyncArm::Callback)
    }

    fn run_readdir(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        arm: AsyncArm,
    ) -> JsResult<JSValue> {
        let (callback, arguments) = split_callback(global, frame, arm)?;
        let rd_args = match parse_async_args::<args::Readdir<'static>>(global, arguments)? {
            ParsedAsyncArgs::Args(args) => args,
            ParsedAsyncArgs::Rejected(error) => {
                return reject_before_schedule(global, callback, error);
            }
        };
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        // /$bunfs/ is in-memory; readdir_inner handles it (recursive included).
        let is_bunfs = bun_standalone_graph::Graph::get_ref().is_some()
            && bun_standalone_graph::is_bun_standalone_file_path(rd_args.path.slice());
        if rd_args.recursive && !is_bunfs {
            return Ok(AsyncReaddirRecursiveTask::create(
                &global.js_thread_of_caller(frame),
                rd_args,
                vm,
                callback,
            ));
        }
        Ok(async_::Readdir::create(
            &global.js_thread_of_caller(frame),
            this,
            rd_args,
            vm,
            callback,
        ))
    }

    /// `callSync(.watch)` — `args::Watch` borrows `globalThis` so it can't go
    /// through `FsArgument`/`dispatch`; call the inherent method directly.
    pub(crate) fn watch(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = global.bun_vm();
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());

        let watch_args = fs::Watcher::Arguments::from_js(
            &global.js_thread(vm.context_of_caller(frame)),
            &mut slice,
        )?;

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
    pub(crate) fn watch_file(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = global.bun_vm();
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());

        let wf_args = fs::StatWatcher::Arguments::from_js(
            &global.js_thread(vm.context_of_caller(frame)),
            &mut slice,
        )?;

        match this
            .node_fs
            .with_mut(|nfs| nfs.watch_file(wf_args, Flavor::Sync))
        {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    }
}

/// Generates the `pub const <name> = call{Async,Sync}(.<fn>)` block.
/// Each row supplies the `(args, ret, NodeFSFunctionEnum)` triple for one op.
macro_rules! node_fs_bindings {
    ( $( $sync:ident / $async_:ident / $callback:ident => $F:ident, $Args:ty, $Ret:ty ; )* ) => {
        impl Binding {
            $(
                pub(crate) const $sync: NodeFSFunction =
                    call_sync::<$Ret, $Args, { NodeFSFunctionEnum::$F }>();
                pub(crate) fn $async_(
                    this: &Self,
                    global: &JSGlobalObject,
                    frame: &CallFrame,
                ) -> JsResult<JSValue> {
                    run_async::<$Args>(this, global, frame, AsyncArm::Promise, async_::$F::create)
                }
                pub(crate) fn $callback(
                    this: &Self,
                    global: &JSGlobalObject,
                    frame: &CallFrame,
                ) -> JsResult<JSValue> {
                    run_async::<$Args>(this, global, frame, AsyncArm::Callback, async_::$F::create)
                }
            )*
        }
    };
}

#[rustfmt::skip]
node_fs_bindings! {
    access_sync          / access          / access_cb          => Access,            args::Access<'static>,     ret::Access;
    append_file_sync     / append_file     / append_file_cb     => AppendFile,        args::AppendFile<'static>, ret::AppendFile;
    close_sync           / close           / close_cb           => Close,             args::Close,               ret::Close;
    copy_file_sync       / copy_file       / copy_file_cb       => CopyFile,          args::CopyFile<'static>,   ret::CopyFile;
    exists_sync          / exists          / exists_cb          => Exists,            args::Exists<'static>,     ret::Exists;
    chown_sync           / chown           / chown_cb           => Chown,             args::Chown<'static>,      ret::Chown;
    chmod_sync           / chmod           / chmod_cb           => Chmod,             args::Chmod<'static>,      ret::Chmod;
    fchmod_sync          / fchmod          / fchmod_cb          => Fchmod,            args::FChmod,              ret::Fchmod;
    fchown_sync          / fchown          / fchown_cb          => Fchown,            args::Fchown,              ret::Fchown;
    fstat_sync           / fstat           / fstat_cb           => Fstat,             args::Fstat,               ret::Fstat;
    fsync_sync           / fsync           / fsync_cb           => Fsync,             args::Fsync,               ret::Fsync;
    ftruncate_sync       / ftruncate       / ftruncate_cb       => Ftruncate,         args::FTruncate,           ret::Ftruncate;
    futimes_sync         / futimes         / futimes_cb         => Futimes,           args::Futimes,             ret::Futimes;
    lchmod_sync          / lchmod          / lchmod_cb          => Lchmod,            args::LCHmod<'static>,     ret::Lchmod;
    lchown_sync          / lchown          / lchown_cb          => Lchown,            args::LChown<'static>,     ret::Lchown;
    link_sync            / link            / link_cb            => Link,              args::Link<'static>,       ret::Link;
    lstat_sync           / lstat           / lstat_cb           => Lstat,             args::Lstat<'static>,      ret::Lstat;
    mkdir_sync           / mkdir           / mkdir_cb           => Mkdir,             args::Mkdir<'static>,      ret::Mkdir;
    mkdtemp_sync         / mkdtemp         / mkdtemp_cb         => Mkdtemp,           args::MkdirTemp<'static>,  ret::Mkdtemp;
    open_sync            / open            / open_cb            => Open,              args::Open<'static>,       ret::Open;
    read_sync            / read            / read_cb            => Read,              args::Read,                ret::Read;
    write_sync           / write           / write_cb           => Write,             args::Write<'static>,      ret::Write;
    read_file_sync       / read_file       / read_file_cb       => ReadFile,          args::ReadFile<'static>,   ret::ReadFile;
    write_file_sync      / write_file      / write_file_cb      => WriteFile,         args::WriteFile<'static>,  ret::WriteFile;
    readlink_sync        / readlink        / readlink_cb        => Readlink,          args::Readlink<'static>,   ret::Readlink;
    rm_sync              / rm              / rm_cb              => Rm,                args::Rm<'static>,         ret::Rm;
    rmdir_sync           / rmdir           / rmdir_cb           => Rmdir,             args::RmDir<'static>,      ret::Rmdir;
    realpath_sync        / realpath        / realpath_cb        => RealpathNonNative, args::Realpath<'static>,   ret::Realpath;
    realpath_native_sync / realpath_native / realpath_native_cb => Realpath,          args::Realpath<'static>,   ret::Realpath;
    rename_sync          / rename          / rename_cb          => Rename,            args::Rename<'static>,     ret::Rename;
    stat_sync            / stat            / stat_cb            => Stat,              args::Stat<'static>,       ret::Stat;
    statfs_sync          / statfs          / statfs_cb          => Statfs,            args::StatFS<'static>,     ret::StatFS;
    symlink_sync         / symlink         / symlink_cb         => Symlink,           args::Symlink<'static>,    ret::Symlink;
    truncate_sync        / truncate        / truncate_cb        => Truncate,          args::Truncate<'static>,   ret::Truncate;
    unlink_sync          / unlink          / unlink_cb          => Unlink,            args::Unlink<'static>,     ret::Unlink;
    utimes_sync          / utimes          / utimes_cb          => Utimes,            args::Utimes<'static>,     ret::Utimes;
    lutimes_sync         / lutimes         / lutimes_cb         => Lutimes,           args::Lutimes<'static>,    ret::Lutimes;
    writev_sync          / writev          / writev_cb          => Writev,            args::Writev,              ret::Writev;
    readv_sync           / readv           / readv_cb           => Readv,             args::Readv,               ret::Readv;
    fdatasync_sync       / fdatasync       / fdatasync_cb       => Fdatasync,         args::FdataSync,           ret::Fdatasync;
}

// `readdirSync` goes through the generic sync path; only the async side is
// special-cased above.
impl Binding {
    pub(crate) const readdir_sync: NodeFSFunction =
        call_sync::<ret::Readdir, args::Readdir<'static>, { NodeFSFunctionEnum::Readdir }>();
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
    let [val] = frame.arguments_as_array::<1>();
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
    let [size_arg] = frame.arguments_as_array::<1>();

    if frame.arguments_count() < 1 {
        return Ok(JSValue::UNDEFINED);
    }

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = size_arg;
        return Err(global.throw(format_args!(
            "memfd_create is not implemented on this platform"
        )));
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let size = size_arg.to_int64();
        match bun_sys::memfd_create(c"my_memfd", bun_sys::MemfdFlags::NonExecutable) {
            Ok(fd) => {
                let _ = bun_sys::ftruncate(fd, size);
                Ok(JSValue::js_number_from_int32(fd.native() as i32))
            }
            Err(err) => Err(global.throw_value(err.to_js(global))),
        }
    }
}
