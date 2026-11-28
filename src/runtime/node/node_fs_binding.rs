use bun_jsc::bindgen::{JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSPromise, JSValue, JsCell, JsResult, SysErrorJsc as _};
use bun_sys::Maybe;
use bun_sys_jsc::SystemErrorJsc as _;

use crate::generated_bindgen::node_fs_binding::RmOptions;
use crate::node::ThreadIsolated;
use crate::node::fs::{
    self, AsyncCpTask, AsyncReaddirRecursiveTask, Flavor, FsArgument, FsReturn, NodeFS,
    NodeFSDispatch, NodeFSFunctionEnum, Op, args, async_, move_waiting_descriptors, ret,
};
use bun_jsc::test_input_recorder::OwnWrites;

// The (`args::*`, `ret::*`, `NodeFS::<method>`, `async_::*`) quadruples are
// spelled out once in `node_fs.rs` (the `NodeFS::dispatch` table +
// `async_::*` aliases) and reused here via the `node_fs_bindings!` macro at
// the bottom of this file.

/// Returns bindings to call jsc.Node.fs.NodeFS.<function>.
/// Async calls use a thread pool.

/// What a `node:fs` call looks at and writes, for the test input recorder (`bun test --reuse`).
/// Called on the JS thread with the parsed arguments, before the
/// operation runs or is scheduled: looks are noted then, and what the call writes is returned, to be
/// applied with `own_wrote` once it succeeded. Calls on a file descriptor are covered by the `open`
/// that made it.
fn note_own<A: FsArgument + 'static>(
    vm: &VirtualMachine,
    function: NodeFSFunctionEnum,
    args: &A,
) -> Option<bun_jsc::test_input_recorder::OwnWrites> {
    use NodeFSFunctionEnum as F;
    use bun_jsc::test_input_recorder::{self as recorder, OwnWrites, Wrote};
    use bun_jsc::test_own_reads::Look;
    let mut own = OwnWrites::new(vm)?;
    let [first, second] = args.paths();
    let (first, second) = (first.map(|it| it.slice()), second.map(|it| it.slice()));
    let read = |look: Look, path: Option<&[u8]>| {
        if let Some(path) = path {
            recorder::own_read(vm, look, path);
        }
    };
    let write = |own: &mut OwnWrites, path: Option<&[u8]>, wrote: Wrote| {
        if let Some(path) = path {
            own.write(vm, path, wrote);
        }
    };
    let any: &dyn core::any::Any = args;
    // What an open (or a whole-file write) with these flags depends on: the bytes when it reads
    // them or keeps some of them, else whether the path is there when that decides failure. With
    // `O_EXCL` any name fails, a dangling symbolic link too, so that is looked at with `lstat`.
    let open_like = |own: &mut OwnWrites, flags: i32, path: Option<&[u8]>| {
        use bun_sys::O;
        let access = flags & (O::RDONLY | O::WRONLY | O::RDWR);
        if access != O::WRONLY || flags & O::APPEND != 0 || flags & O::TRUNC == 0 {
            read(Look::Content, path);
        } else if flags & O::EXCL != 0 && flags & O::CREAT != 0 {
            read(Look::Lstat, path);
        } else if flags & O::CREAT == 0 {
            read(Look::Exists, path);
        }
        if access != O::RDONLY || flags & (O::CREAT | O::TRUNC | O::APPEND) != 0 {
            write(own, path, Wrote::File);
        }
    };
    match function {
        F::Exists => read(Look::Exists, first),
        F::Access => {
            // `F_OK` asks only whether the path is there.
            let mode = any
                .downcast_ref::<args::Access<'static>>()
                .map_or(0, |it| it.mode.as_int());
            match (mode, first) {
                (0, _) => read(Look::Exists, first),
                (mode, Some(path)) => {
                    recorder::own_read_with(vm, Look::Access, path, mode.to_string().as_bytes())
                }
                (_, None) => {}
            }
        }
        F::Stat => read(Look::Stat, first),
        F::Lstat => read(Look::Lstat, first),
        F::Readlink => read(Look::Readlink, first),
        F::Realpath | F::RealpathNonNative => read(Look::Realpath, first),
        F::Readdir => {
            let recursive = any
                .downcast_ref::<args::Readdir<'static>>()
                .is_some_and(|it| it.recursive);
            read(
                if recursive {
                    Look::ListRecursive
                } else {
                    Look::List
                },
                first,
            );
        }
        F::ReadFile => read(Look::Content, first),
        F::Open => {
            let flags = any
                .downcast_ref::<args::Open<'static>>()
                .map_or(0, |it| it.flags.as_int());
            open_like(&mut own, flags, first);
        }
        F::WriteFile | F::AppendFile => {
            let flags = match any.downcast_ref::<args::WriteFile<'static>>() {
                Some(it) => it.flag.as_int(),
                None => any
                    .downcast_ref::<args::AppendFile<'static>>()
                    .map_or(0, |it| it.0.flag.as_int()),
            };
            open_like(&mut own, flags, first);
        }
        F::CopyFile => {
            read(Look::Content, first);
            let exclusive = any
                .downcast_ref::<args::CopyFile<'static>>()
                .is_some_and(|it| it.mode.0 & 1 != 0);
            if exclusive {
                // Fails on any name, a dangling symbolic link too.
                read(Look::Lstat, second);
            }
            write(&mut own, second, Wrote::File);
        }
        F::Rename => {
            // Moves a symbolic link itself, a dangling one too.
            read(Look::Lstat, first);
            // What moves to the new name is the file's product only if the old name held one;
            // otherwise what it held is looked at now, before it moves.
            if let Some(from) = first
                && !recorder::own_generated(vm, from)
            {
                let zfrom = bun_core::ZBox::from_vec(from.to_vec());
                let is_file = bun_sys::lstat(&zfrom).is_ok_and(|st| {
                    st.st_mode as u32 & bun_sys::S::IFMT as u32 == bun_sys::S::IFREG as u32
                });
                read(if is_file { Look::Content } else { Look::Tree }, first);
            }
            write(&mut own, first, Wrote::Tree);
            write(&mut own, second, Wrote::Tree);
        }
        F::Link => {
            // The new name shares the old one's bytes, so they are looked at now.
            read(Look::Content, first);
            write(&mut own, first, Wrote::Meta);
            // The new name must not be there yet, not even as a dangling symbolic link.
            read(Look::Lstat, second);
            write(&mut own, second, Wrote::File);
        }
        F::Symlink => {
            // The same. What a look through the link reaches is found when the look is made.
            read(Look::Lstat, first);
            write(&mut own, first, Wrote::File);
        }
        F::Mkdtemp => own.created(),
        F::Mkdir => {
            let recursive = any
                .downcast_ref::<args::Mkdir<'static>>()
                .is_some_and(|it| it.recursive);
            // Without `recursive` it fails unless the name is free.
            if !recursive {
                read(Look::Lstat, first);
            }
            write(
                &mut own,
                first,
                if recursive { Wrote::Meta } else { Wrote::Tree },
            );
        }
        F::Rm => {
            let force = any
                .downcast_ref::<args::Rm<'static>>()
                .is_some_and(|it| it.0.force);
            // Removes a symbolic link itself, a dangling one too.
            if !force {
                read(Look::Lstat, first);
            }
            write(&mut own, first, Wrote::Tree);
        }
        F::Truncate => {
            // What is left of the bytes is still there afterwards.
            read(Look::Content, first);
            write(&mut own, first, Wrote::File);
        }
        F::Unlink | F::Rmdir => {
            // These fail when the name is missing; a dangling symbolic link is there.
            read(Look::Lstat, first);
            write(&mut own, first, Wrote::Tree);
        }
        F::Chmod | F::Chown | F::Utimes => {
            read(Look::Exists, first);
            write(&mut own, first, Wrote::Meta);
        }
        F::Lchmod | F::Lchown | F::Lutimes => {
            read(Look::Lstat, first);
            write(&mut own, first, Wrote::Meta);
        }
        F::Statfs
        | F::Close
        | F::Fchmod
        | F::Fchown
        | F::Fdatasync
        | F::Fstat
        | F::Fsync
        | F::Ftruncate
        | F::Futimes
        | F::Read
        | F::Readv
        | F::Write
        | F::Writev => {}
    }
    Some(own)
}

fn run_sync_with<R: FsReturn, A: FsArgument + 'static>(
    cx: &mut JsScope<'_>,
    args: &[JsLocal<'_>],
    function: NodeFSFunctionEnum,
    dispatch: impl FnOnce(&A) -> Maybe<R>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let vm: &VirtualMachine = global.bun_vm();
    let mut slice = ArgumentsSlice::init(vm, JsLocal::to_js_slice(args));
    let args = <A as FsArgument>::from_js(global, &mut slice)?;
    let own = note_own(vm, function, &args);
    move_waiting_descriptors();
    match dispatch(&args) {
        Err(err) => Err(global.throw_value(err.to_js(global))),
        Ok(res) => {
            if let Some(own) = own {
                bun_jsc::test_input_recorder::own_wrote(vm, own, res.returned_path());
            }
            res.fs_to_js(global)
        }
    }
}

/// `Bindings(FunctionEnum).runSync`.
fn run_sync<R: FsReturn, A: FsArgument + 'static, const F: NodeFSFunctionEnum>(
    this: &Binding,
    cx: &mut JsScope<'_>,
    args: &[JsLocal<'_>],
) -> JsResult<JSValue>
where
    Op<{ F }>: NodeFSDispatch<R, A>,
{
    // R-2: `JsCell::with_mut` scopes the `&mut NodeFS` to the blocking
    // syscall; `dispatch` never re-enters JS, and `Maybe<R>` is fully owned
    // (`sys::Error.path` is `Box<[u8]>`, not a borrow into `sync_error_buf`).
    run_sync_with::<R, A>(cx, args, F, |args| {
        this.node_fs
            .with_mut(|nfs| NodeFS::dispatch::<R, A, F>(nfs, args, Flavor::Sync))
    })
}

/// A synchronous `node:fs` function for compiled code. It has no binding object and uses the `NodeFS` of the VM.
fn run_sync_function<R: FsReturn, A: FsArgument + 'static, const F: NodeFSFunctionEnum>(
    cx: &mut JsScope<'_>,
    args: &[JsLocal<'_>],
) -> JsResult<JSValue>
where
    Op<{ F }>: NodeFSDispatch<R, A>,
{
    let vm = cx.global().bun_vm();
    run_sync_with::<R, A>(cx, args, F, |args| {
        crate::jsc_hooks::with_node_fs(vm, |node_fs| {
            node_fs.vm = Some(vm);
            NodeFS::dispatch::<R, A, F>(node_fs, args, Flavor::Sync)
        })
    })
}

macro_rules! sync_functions {
    ( $( $name:ident => $F:ident, $Args:ty, $Ret:ty ; )* ) => {
        $(
            pub(crate) fn $name(cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
                run_sync_function::<$Ret, $Args, { NodeFSFunctionEnum::$F }>(cx, args)
            }
        )*
    };
}

sync_functions! {
    append_file_sync => AppendFile, args::AppendFile<'static>, ret::AppendFile;
    chmod_sync       => Chmod,      args::Chmod<'static>,      ret::Chmod;
    close_sync       => Close,      args::Close,               ret::Close;
    exists_sync      => Exists,     args::Exists<'static>,     ret::Exists;
    fstat_sync       => Fstat,      args::Fstat,               ret::Fstat;
    lstat_sync       => Lstat,      args::Lstat<'static>,      ret::Lstat;
    readdir_sync     => Readdir,    args::Readdir<'static>,    ret::Readdir;
    read_file_sync   => ReadFile,   args::ReadFile<'static>,   ret::ReadFile;
    stat_sync        => Stat,       args::Stat<'static>,       ret::Stat;
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
    args: &'a [JsLocal<'_>],
    arm: AsyncArm,
) -> JsResult<(Option<JSValue>, &'a [JSValue])> {
    let arguments = JsLocal::to_js_slice(args);
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
fn run_async<A: FsArgument + 'static>(
    this: &Binding,
    cx: &mut JsScope<'_>,
    args: &[JsLocal<'_>],
    function: NodeFSFunctionEnum,
    arm: AsyncArm,
    create_task: fn(
        &bun_jsc::JsThread<'_>,
        &Binding,
        ThreadIsolated<A>,
        &VirtualMachine,
        Option<JSValue>,
        Option<OwnWrites>,
    ) -> JSValue,
) -> JsResult<JSValue> {
    let cx = cx.js_thread();
    let global = cx.global();
    let (callback, arguments) = split_callback(global, args, arm)?;
    let args = match parse_async_args::<A>(global, arguments)? {
        ParsedAsyncArgs::Args(args) => args,
        ParsedAsyncArgs::Rejected(error) => return reject_before_schedule(global, callback, error),
    };
    let vm: &VirtualMachine = global.bun_vm();
    let own = note_own(vm, function, &*args);
    move_waiting_descriptors();
    Ok(create_task(&cx, this, args, vm, callback, own))
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

// Every JS-exposed binding takes `&self`; the
// single mutable field `node_fs` is wrapped in `JsCell` so the
// `sync_error_buf` scratch buffer and `&mut NodeFS` syscall dispatches are
// projected through interior mutability instead of `&mut Binding`.
pub(crate) struct Binding {
    pub(crate) node_fs: JsCell<NodeFS>,
}

impl Drop for Binding {
    fn drop(&mut self) {
        let path = &self.node_fs.get().sync_error_buf;
        bun_core::asan::unregister_root_region((&raw const *path).cast(), size_of_val(path));
    }
}

impl Binding {
    pub(crate) fn get_dirent(&self, cx: &mut JsScope<'_>) -> JSValue {
        crate::node::Dirent::get_constructor(cx.global())
    }

    pub(crate) fn get_stats(&self, cx: &mut JsScope<'_>) -> JSValue {
        crate::node::StatsSmall::get_constructor(cx.global())
    }

    // ── Hand-written bindings for ops outside `NodeFSFunctionEnum` ────────

    /// `callAsync(.cp)`.
    pub(crate) fn cp(&self, cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let arguments = JsLocal::to_js_slice(args);
        let cp_args = match parse_async_args::<args::Cp<'static>>(global, arguments)? {
            ParsedAsyncArgs::Args(args) => args,
            ParsedAsyncArgs::Rejected(error) => return reject_before_schedule(global, None, error),
        };
        let vm: &VirtualMachine = global.bun_vm();
        let own = note_cp(vm, &cp_args);
        Ok(AsyncCpTask::create(&cx, self, cp_args, vm, own))
    }

    /// `callSync(.cp)`.
    pub(crate) fn cp_sync(&self, cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let global = cx.global();
        let vm: &VirtualMachine = global.bun_vm();
        let mut slice = ArgumentsSlice::init(vm, JsLocal::to_js_slice(args));

        // `defer args.deinit()` → `Drop` on `cp_args` (its `PathLike` fields).
        let cp_args = args::Cp::from_js(global, &mut slice)?;
        let own = note_cp(vm, &cp_args);

        // R-2: blocking syscall — `&mut NodeFS` scoped to the call, no JS re-entry.
        match self.node_fs.with_mut(|nfs| nfs.cp(&cp_args, Flavor::Sync)) {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(()) => {
                if let Some(own) = own {
                    bun_jsc::test_input_recorder::own_wrote(vm, own, None);
                }
                Ok(JSValue::UNDEFINED)
            }
        }
    }

    /// `callAsync(.readdir)` — `args.recursive` selects
    /// `AsyncReaddirRecursiveTask` instead of the generic `AsyncFSTask`.
    pub(crate) fn readdir(&self, cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        self.run_readdir(cx, args, AsyncArm::Promise)
    }

    pub(crate) fn readdir_cb(
        &self,
        cx: &mut JsScope<'_>,
        args: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        self.run_readdir(cx, args, AsyncArm::Callback)
    }

    fn run_readdir(
        &self,
        cx: &mut JsScope<'_>,
        args: &[JsLocal<'_>],
        arm: AsyncArm,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let (callback, arguments) = split_callback(global, args, arm)?;
        let rd_args = match parse_async_args::<args::Readdir<'static>>(global, arguments)? {
            ParsedAsyncArgs::Args(args) => args,
            ParsedAsyncArgs::Rejected(error) => {
                return reject_before_schedule(global, callback, error);
            }
        };
        let vm: &VirtualMachine = global.bun_vm();
        // A listing writes nothing.
        let _ = note_own(vm, NodeFSFunctionEnum::Readdir, &*rd_args);
        // /$bunfs/ is in-memory; readdir_inner handles it (recursive included).
        let is_bunfs = bun_standalone_graph::Graph::get_ref()
            .is_some_and(|graph| graph.owns_directory(rd_args.path.slice()));
        if rd_args.recursive && !is_bunfs {
            return Ok(AsyncReaddirRecursiveTask::create(
                &cx, &rd_args, vm, callback,
            ));
        }
        Ok(async_::Readdir::create(
            &cx, self, rd_args, vm, callback, None,
        ))
    }

    /// `callSync(.watch)` — `args::Watch` borrows `globalThis` so it can't go
    /// through `FsArgument`/`dispatch`; call the inherent method directly.
    pub(crate) fn watch(&self, cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let mut slice = ArgumentsSlice::init(cx.vm(), JsLocal::to_js_slice(args));

        let watch_args = fs::Watcher::Arguments::from_js(&cx, &mut slice)?;
        bun_jsc::test_input_recorder::own_read(
            cx.vm(),
            bun_jsc::test_own_reads::Look::Exists,
            watch_args.path.slice(),
        );

        // R-2: `NodeFS::watch` only reads `self.vm` (no scratch-buffer write);
        // scoped via `with_mut` so the borrow cannot outlive the call.
        match self
            .node_fs
            .with_mut(|nfs| nfs.watch(watch_args, Flavor::Sync))
        {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    }

    /// `callSync(.watchFile)`.
    pub(crate) fn watch_file(
        &self,
        cx: &mut JsScope<'_>,
        args: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let mut slice = ArgumentsSlice::init(cx.vm(), JsLocal::to_js_slice(args));

        let wf_args = fs::StatWatcher::Arguments::from_js(&cx, &mut slice)?;
        bun_jsc::test_input_recorder::own_read(
            cx.vm(),
            bun_jsc::test_own_reads::Look::Stat,
            wf_args.path.slice(),
        );

        match self
            .node_fs
            .with_mut(|nfs| nfs.watch_file(wf_args, Flavor::Sync))
        {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    }
}

/// Generates the sync, promise and callback member of each op.
/// Each row supplies the `(args, ret, NodeFSFunctionEnum)` triple for one op.
macro_rules! node_fs_bindings {
    ( $( $sync:ident / $async_:ident / $callback:ident => $F:ident, $Args:ty, $Ret:ty ; )* ) => {
        impl Binding {
            $(
                pub(crate) fn $sync(
                    &self,
                    cx: &mut JsScope<'_>,
                    args: &[JsLocal<'_>],
                ) -> JsResult<JSValue> {
                    run_sync::<$Ret, $Args, { NodeFSFunctionEnum::$F }>(self, cx, args)
                }
                pub(crate) fn $async_(
                    &self,
                    cx: &mut JsScope<'_>,
                    args: &[JsLocal<'_>],
                ) -> JsResult<JSValue> {
                    run_async::<$Args>(self, cx, args, NodeFSFunctionEnum::$F, AsyncArm::Promise, async_::$F::create)
                }
                pub(crate) fn $callback(
                    &self,
                    cx: &mut JsScope<'_>,
                    args: &[JsLocal<'_>],
                ) -> JsResult<JSValue> {
                    run_async::<$Args>(self, cx, args, NodeFSFunctionEnum::$F, AsyncArm::Callback, async_::$F::create)
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
    pub(crate) fn readdir_sync(
        &self,
        cx: &mut JsScope<'_>,
        args: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        run_sync::<ret::Readdir, args::Readdir<'static>, { NodeFSFunctionEnum::Readdir }>(
            self, cx, args,
        )
    }
    // pub const statfs = callAsync(.statfs);
    // pub const statfsSync = callSync(.statfs);
}

/// `fs.cp`: what is below the source, and the destination, for the test input recorder. A copy
/// into a directory that is there and is not the file's product merges into it, so what was there
/// stays an input; otherwise everything at the destination is the file's product.
fn note_cp(vm: &VirtualMachine, args: &args::Cp<'static>) -> Option<OwnWrites> {
    use bun_jsc::test_input_recorder as recorder;
    use bun_jsc::test_own_reads::Look;
    let mut own = OwnWrites::new(vm)?;
    let look = if args.flags.recursive {
        Look::Tree
    } else {
        Look::Content
    };
    recorder::own_read(vm, look, args.src.slice());
    if args.flags.error_on_exist && !args.flags.force {
        recorder::own_read(vm, Look::Exists, args.dest.slice());
    }
    own.write_tree(vm, args.dest.slice());
    Some(own)
}

pub(crate) fn binding<'a>(cx: &mut JsScope<'a>) -> JsWrapper<'a, Binding> {
    let wrapper = Binding {
        node_fs: JsCell::new(NodeFS {
            vm: Some(cx.global().bun_vm()),
            ..Default::default()
        }),
    }
    .into_js(&cx.heap);
    let binding = wrapper.payload_guard();
    let path = &binding.node_fs.get().sync_error_buf;
    // LSAN does not scan the JS heap, and the VM that runs macros is never torn down.
    bun_core::asan::register_root_region((&raw const *path).cast(), size_of_val(path));
    wrapper
}

/// Test-only (`bun:internal-for-testing`): run `(path, options)` through the
/// exact argument parser `fs.rm` uses and return the parsed options, so node's
/// `internal/fs/utils` `validateRmOptionsSync` tests exercise the production
/// validation (including its rejection of own-but-`undefined` booleans).
pub(crate) fn rm_options_for_testing(
    cx: &mut JsScope<'_>,
    args: &[JsLocal<'_>],
) -> JsResult<RmOptions> {
    let global = cx.global();
    let vm: &VirtualMachine = global.bun_vm();
    let mut slice = ArgumentsSlice::init(vm, JsLocal::to_js_slice(args));
    let parsed = args::Rm::from_js(global, &mut slice)?;
    Ok(RmOptions {
        retry_delay: parsed.retry_delay,
        max_retries: parsed.max_retries,
        recursive: parsed.recursive,
        force: parsed.force,
    })
}

/// Wraps a raw Win32 `HANDLE` in a CRT fd that takes ownership of it. On error
/// the caller still owns the `HANDLE`.
/// https://github.com/nodejs/node/blob/98dbf6070e8439e530f1678b11962a0f3719e1f6/src/node_file.cc#L5691
pub(crate) fn windows_handle_to_fd(cx: &mut JsScope<'_>, handle: JsLocal<'_>) -> JsResult<i32> {
    let global = cx.global();

    #[cfg(not(windows))]
    {
        let _ = handle;
        return Err(global.throw(format_args!(
            "windowsHandle is not implemented on this platform"
        )));
    }

    #[cfg(windows)]
    {
        // `streams.ts` has already checked `typeof handle === "bigint"`.
        let value = handle.to_js();
        if !value.is_big_int_in_int64_range(i64::MIN, i64::MAX) {
            return Err(global
                .err(
                    bun_jsc::ErrorCode::ERR_OUT_OF_RANGE,
                    format_args!("windowsHandle does not fit into 64 bits"),
                )
                .throw());
        }
        let handle =
            bun_jsc::JSBigInt::from_js(value).expect("windowsHandle is validated as a bigint");
        let fd =
            bun_core::fd::uv_open_osfhandle(handle.to_int64() as isize as *mut core::ffi::c_void);
        if fd == -1 {
            let err =
                bun_sys::Error::from_code_int(bun_sys::last_errno(), bun_sys::Tag::_open_osfhandle);
            return Err(global.throw_value(err.to_js(global)));
        }
        Ok(fd)
    }
}

/// Test-only (`bun:internal-for-testing`): run a flags value through the same
/// parser `fs.open` uses and return the numeric O_* mask, so node's
/// `internal/fs/utils` `stringToFlags` tests can assert the production mapping.
pub(crate) fn string_to_flags_for_testing(
    cx: &mut JsScope<'_>,
    flags: JsLocal<'_>,
) -> JsResult<i32> {
    use crate::node::types::FileSystemFlags;
    let flags = FileSystemFlags::from_js(cx.global(), flags.to_js())?.unwrap_or(FileSystemFlags::R);
    // On Windows the internal bun.O bits are POSIX-shaped and translated to the
    // MSVCRT `_O_*` values at the open boundary; node's stringToFlags and
    // fs.constants both speak MSVCRT, so translate here too.
    #[cfg(windows)]
    let bits = bun_sys::windows::libuv::O::from_bun_o(flags.as_int());
    #[cfg(not(windows))]
    let bits = flags.as_int();
    Ok(bits)
}

pub(crate) fn create_memfd_for_testing(
    cx: &mut JsScope<'_>,
    size: Option<f64>,
) -> JsResult<Option<i32>> {
    let global = cx.global();
    let Some(size) = size else {
        return Ok(None);
    };

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = size;
        return Err(global.throw(format_args!(
            "memfd_create is not implemented on this platform"
        )));
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        match bun_sys::memfd_create(c"my_memfd".into(), bun_sys::MemfdFlags::NonExecutable) {
            Ok(fd) => {
                let _ = bun_sys::ftruncate(fd, size as i64);
                Ok(Some(fd.native() as i32))
            }
            Err(err) => Err(global.throw_value(err.to_js(global))),
        }
    }
}
