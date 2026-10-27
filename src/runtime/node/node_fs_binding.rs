use core::ptr::NonNull;

use bun_jsc::bindgen::{
    BufferSource, Callable, Deferred, JsLocal, JsPayload as _, JsScope, JsWrapper, StringLike,
};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSArray, JSGlobalObject, JSPromise, JSValue, JsCell, JsResult, SysErrorJsc as _};
use bun_sys_jsc::SystemErrorJsc as _;

use crate::generated_bindgen::node_fs_binding::{self as schema, RmOptions};
use crate::node::ThreadIsolated;
use crate::node::fs::{
    self, AsyncCpTask, AsyncReaddirRecursiveTask, Flavor, FsArgument, FsReturn, NodeFS,
    NodeFSDispatch, NodeFSFunctionEnum, Op, args, async_, ret,
};
use crate::node::types::Parsing;

// The (`args::*`, `ret::*`, `NodeFS::<method>`, `async_::*`) quadruples are
// spelled out once in `node_fs.rs` (the `NodeFS::dispatch` table +
// `async_::*` aliases) and reused here via the `node_fs_bindings!` macro at
// the bottom of this file.

/// Returns bindings to call jsc.Node.fs.NodeFS.<function>.
/// Async calls use a thread pool.

/// `Bindings(FunctionEnum).runSync`.
fn run_sync<R: FsReturn, A: FsArgument, const F: NodeFSFunctionEnum>(
    this: &Binding,
    cx: &mut JsScope<'_>,
    from_js: impl FnOnce(&JSGlobalObject, &mut Parsing) -> JsResult<A>,
) -> JsResult<JSValue>
where
    Op<{ F }>: NodeFSDispatch<R, A>,
{
    let global = cx.global();
    let args = from_js(global, &mut Parsing::new(Flavor::Sync))?;

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

/// `Bindings(FunctionEnum).runAsync` for every operation except `.cp` /
/// `.readdir` (those have bespoke entry points below).
///
/// Without `callback` it is `node:fs/promises` and returns a promise.
///
/// `create_task` is `async_::<FunctionName>::create` — passed in because the
/// Windows path picks `UVFSRequest` for a handful of fds-only ops while
/// everything else uses `AsyncFSTask`, and that choice is encoded in the
/// `async_::*` type aliases rather than derivable from `F` alone.
fn run_async<A: FsArgument>(
    this: &Binding,
    cx: &mut JsScope<'_>,
    callback: Option<JsLocal<'_, Callable>>,
    from_js: impl FnOnce(&JSGlobalObject, &mut Parsing) -> JsResult<A>,
    create_task: CreateTask<A>,
) -> JsResult<JSValue> {
    /// Does not depend on `from_js`, so the two forms of an operation share one copy.
    #[inline(never)]
    fn schedule<A: FsArgument>(
        this: &Binding,
        cx: &mut JsScope<'_>,
        callback: Option<JsLocal<'_, Callable>>,
        args: A,
        parsing: Parsing,
        create_task: CreateTask<A>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let callback = callback.map(JsLocal::to_js);
        let args = match parsed_async_args(global, args, parsing) {
            ParsedAsyncArgs::Args(args) => args,
            ParsedAsyncArgs::Rejected(error) => {
                return reject_before_schedule(global, callback, error);
            }
        };
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        Ok(create_task(&cx, this, args, vm, callback))
    }
    let mut parsing = Parsing::new(Flavor::Async);
    let args = from_js(cx.global(), &mut parsing)?;
    schedule(this, cx, callback, args, parsing, create_task)
}

type CreateTask<A> = fn(
    &bun_jsc::JsThread<'_>,
    &Binding,
    ThreadIsolated<A>,
    &mut VirtualMachine,
    Option<JSValue>,
) -> JSValue;

enum ParsedAsyncArgs<A> {
    Args(ThreadIsolated<A>),
    /// The operation fails without being scheduled (an aborted signal, a path that is too long).
    Rejected(JSValue),
}

/// Parses an async binding's arguments. A validation error is thrown, as node does for both arms.
fn parse_async_args<A: FsArgument>(
    global: &JSGlobalObject,
    from_js: impl FnOnce(&JSGlobalObject, &mut Parsing) -> JsResult<A>,
) -> JsResult<ParsedAsyncArgs<A>> {
    let mut parsing = Parsing::new(Flavor::Async);
    let args = from_js(global, &mut parsing)?;
    Ok(parsed_async_args(global, args, parsing))
}

/// `args` were parsed with `parsing`, under [`Flavor::Async`].
fn parsed_async_args<A: FsArgument>(
    global: &JSGlobalObject,
    args: A,
    mut parsing: Parsing,
) -> ParsedAsyncArgs<A> {
    // SAFETY: parsed under [`Flavor::Async`]: its strings are thread-safe and its buffers pinned.
    let args = unsafe { ThreadIsolated::new(args) };

    if A::HAVE_ABORT_SIGNAL {
        if let Some(abort_error) = args
            .signal()
            .and_then(|signal| signal.node_abort_error_if_aborted(global))
        {
            return ParsedAsyncArgs::Rejected(abort_error);
        }
    }
    if let Some(err) = parsing.deferred_error.take() {
        return ParsedAsyncArgs::Rejected((*err).to_error_instance(global));
    }
    ParsedAsyncArgs::Args(args)
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
#[derive(Default)]
pub(crate) struct Binding {
    pub(crate) node_fs: JsCell<NodeFS>,
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
    pub(crate) fn cp(
        &self,
        cx: &mut JsScope<'_>,
        src: schema::PathLike<'_>,
        dest: schema::PathLike<'_>,
        recursive: bool,
        error_on_exist: bool,
        force: Option<bool>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let cp_args = match parse_async_args(global, |global, parsing| {
            args::Cp::from_js(global, parsing, src, dest, recursive, error_on_exist, force)
        })? {
            ParsedAsyncArgs::Args(args) => args,
            ParsedAsyncArgs::Rejected(error) => return reject_before_schedule(global, None, error),
        };
        let vm: &mut VirtualMachine = global.bun_vm().as_mut();
        Ok(AsyncCpTask::create(&cx, self, cp_args, vm))
    }

    /// `callSync(.cp)`.
    pub(crate) fn cp_sync(
        &self,
        cx: &mut JsScope<'_>,
        src: schema::PathLike<'_>,
        dest: schema::PathLike<'_>,
        recursive: bool,
        error_on_exist: bool,
        force: Option<bool>,
    ) -> JsResult<()> {
        let global = cx.global();

        // `defer args.deinit()` → `Drop` on `cp_args` (its `PathLike` fields).
        let cp_args = args::Cp::from_js(
            global,
            &mut Parsing::new(Flavor::Sync),
            src,
            dest,
            recursive,
            error_on_exist,
            force,
        )?;

        // R-2: blocking syscall — `&mut NodeFS` scoped to the call, no JS re-entry.
        match self.node_fs.with_mut(|nfs| nfs.cp(&cp_args, Flavor::Sync)) {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(()) => Ok(()),
        }
    }

    /// `callAsync(.readdir)` — `args.recursive` selects
    /// `AsyncReaddirRecursiveTask` instead of the generic `AsyncFSTask`.
    pub(crate) fn readdir(
        &self,
        cx: &mut JsScope<'_>,
        path: schema::PathLike<'_>,
        options: schema::EncodingOrReaddirOptions<'_>,
    ) -> JsResult<JSValue> {
        self.run_readdir(cx, None, path, options)
    }

    pub(crate) fn readdir_cb(
        &self,
        cx: &mut JsScope<'_>,
        callback: JsLocal<'_, Callable>,
        path: schema::PathLike<'_>,
        options: schema::EncodingOrReaddirOptions<'_>,
    ) -> JsResult<()> {
        self.run_readdir(cx, Some(callback), path, options)?;
        Ok(())
    }

    fn run_readdir(
        &self,
        cx: &mut JsScope<'_>,
        callback: Option<JsLocal<'_, Callable>>,
        path: schema::PathLike<'_>,
        options: schema::EncodingOrReaddirOptions<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let callback = callback.map(JsLocal::to_js);
        let rd_args = match parse_async_args(global, |global, parsing| {
            args::Readdir::from_js(global, parsing, path, options)
        })? {
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
                &cx, rd_args, vm, callback,
            ));
        }
        Ok(async_::Readdir::create(&cx, self, rd_args, vm, callback))
    }

    /// `callSync(.watch)` — `args::Watch` borrows `globalThis` so it can't go
    /// through `FsArgument`/`dispatch`; call the inherent method directly.
    pub(crate) fn watch(
        &self,
        cx: &mut JsScope<'_>,
        filename: schema::PathLike<'_>,
        options: Option<schema::WatchOptions<'_>>,
        listener: Option<JsLocal<'_, Callable>>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();

        let watch_args = fs::Watcher::Arguments::from_js(&cx, filename, options, listener)?;

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
        filename: schema::PathLike<'_>,
        options: Deferred<'_, schema::WatchFileOptions>,
        listener: Option<JsLocal<'_, Callable>>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();

        let wf_args = fs::StatWatcher::Arguments::from_js(&cx, filename, options, listener)?;

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
/// Each row supplies the `(args, ret, NodeFSFunctionEnum)` triple for one op, the arguments its
/// schema declares, and how `args` is parsed from them.
macro_rules! node_fs_bindings {
    ( $( $sync:ident / $async_:ident / $callback:ident => $F:ident, $Args:ty, $Ret:ty,
         ( $( $arg:ident : $Arg:ty ),* ), $from_js:expr ; )* ) => {
        impl Binding {
            $(
                pub(crate) fn $sync(
                    &self,
                    cx: &mut JsScope<'_>,
                    $( $arg: $Arg, )*
                ) -> JsResult<JSValue> {
                    run_sync::<$Ret, $Args, { NodeFSFunctionEnum::$F }>(self, cx, $from_js)
                }
                pub(crate) fn $async_(
                    &self,
                    cx: &mut JsScope<'_>,
                    $( $arg: $Arg, )*
                ) -> JsResult<JSValue> {
                    run_async::<$Args>(self, cx, None, $from_js, async_::$F::create)
                }
                pub(crate) fn $callback(
                    &self,
                    cx: &mut JsScope<'_>,
                    callback: JsLocal<'_, Callable>,
                    $( $arg: $Arg, )*
                ) -> JsResult<()> {
                    run_async::<$Args>(self, cx, Some(callback), $from_js, async_::$F::create)?;
                    Ok(())
                }
            )*
        }
    };
}

#[rustfmt::skip]
node_fs_bindings! {
    access_sync / access / access_cb => Access, args::Access<'static>, ret::Access,
        (path: schema::PathLike<'_>, mode: Deferred<'_, Option<f64>>),
        |global, parsing| args::Access::from_js(global, parsing, path, mode);
    append_file_sync / append_file / append_file_cb => AppendFile, args::AppendFile<'static>, ret::AppendFile,
        (path: schema::PathOrFileDescriptor<'_>, data: schema::WriteFileData<'_>, options: schema::EncodingOrWriteFileOptions<'_>),
        |global, parsing| args::WriteFile::from_js_with_default_flag(global, parsing, path, data, options, crate::node::types::FileSystemFlags::A).map(args::AppendFile);
    close_sync / close / close_cb => Close, args::Close, ret::Close,
        (fd: i32),
        |_, _| Ok(args::Close::from_js(fd));
    copy_file_sync / copy_file / copy_file_cb => CopyFile, args::CopyFile<'static>, ret::CopyFile,
        (src: schema::PathLike<'_>, dest: schema::PathLike<'_>, mode: Deferred<'_, Option<f64>>),
        |global, parsing| args::CopyFile::from_js(global, parsing, src, dest, mode);
    exists_sync / exists / exists_cb => Exists, args::Exists<'static>, ret::Exists,
        (path: schema::PathLike<'_>),
        |global, parsing| args::Exists::from_js(global, parsing, path);
    chown_sync / chown / chown_cb => Chown, args::Chown<'static>, ret::Chown,
        (path: schema::PathLike<'_>, uid: Deferred<'_, i64>, gid: Deferred<'_, i64>),
        |global, parsing| args::Chown::from_js(global, parsing, path, uid, gid);
    chmod_sync / chmod / chmod_cb => Chmod, args::Chmod<'static>, ret::Chmod,
        (path: schema::PathLike<'_>, mode: Deferred<'_, schema::FileMode<'_>>),
        |global, parsing| args::Chmod::from_js(global, parsing, path, mode);
    fchmod_sync / fchmod / fchmod_cb => Fchmod, args::FChmod, ret::Fchmod,
        (fd: i32, mode: schema::FileMode<'_>),
        |global, _| args::FChmod::from_js(global, fd, mode);
    fchown_sync / fchown / fchown_cb => Fchown, args::Fchown, ret::Fchown,
        (fd: i32, uid: i64, gid: i64),
        |_, _| Ok(args::Fchown::from_js(fd, uid, gid));
    fstat_sync / fstat / fstat_cb => Fstat, args::Fstat, ret::Fstat,
        (fd: i32, options: &schema::BigIntOptions),
        |_, _| Ok(args::Fstat::from_js(fd, options));
    fsync_sync / fsync / fsync_cb => Fsync, args::Fsync, ret::Fsync,
        (fd: i32),
        |_, _| Ok(args::Fsync::from_js(fd));
    ftruncate_sync / ftruncate / ftruncate_cb => Ftruncate, args::FTruncate, ret::Ftruncate,
        (fd: i32, len: i64),
        |_, _| Ok(args::FTruncate::from_js(fd, len));
    futimes_sync / futimes / futimes_cb => Futimes, args::Futimes, ret::Futimes,
        (fd: i32, atime: schema::TimeLike<'_>, mtime: schema::TimeLike<'_>),
        |global, _| args::Futimes::from_js(global, fd, atime, mtime);
    lchmod_sync / lchmod / lchmod_cb => Lchmod, args::LCHmod<'static>, ret::Lchmod,
        (path: schema::PathLike<'_>, mode: Deferred<'_, schema::FileMode<'_>>),
        |global, parsing| args::LCHmod::from_js(global, parsing, path, mode);
    lchown_sync / lchown / lchown_cb => Lchown, args::LChown<'static>, ret::Lchown,
        (path: schema::PathLike<'_>, uid: Deferred<'_, i64>, gid: Deferred<'_, i64>),
        |global, parsing| args::LChown::from_js(global, parsing, path, uid, gid);
    link_sync / link / link_cb => Link, args::Link<'static>, ret::Link,
        (old_path: schema::PathLike<'_>, new_path: schema::PathLike<'_>),
        |global, parsing| args::Link::from_js(global, parsing, old_path, new_path);
    lstat_sync / lstat / lstat_cb => Lstat, args::Lstat<'static>, ret::Lstat,
        (path: schema::PathLike<'_>, options: Deferred<'_, schema::StatOptions>),
        |global, parsing| args::Lstat::from_js(global, parsing, path, options);
    mkdir_sync / mkdir / mkdir_cb => Mkdir, args::Mkdir<'static>, ret::Mkdir,
        (path: schema::PathLike<'_>, options: Deferred<'_, schema::MkdirOptionsOrMode<'_>>),
        |global, parsing| args::Mkdir::from_js(global, parsing, path, options);
    mkdtemp_sync / mkdtemp / mkdtemp_cb => Mkdtemp, args::MkdirTemp<'static>, ret::Mkdtemp,
        (prefix: schema::PathLike<'_>, options: Deferred<'_, schema::EncodingOrOptions<'_>>),
        |global, parsing| args::MkdirTemp::from_js(global, parsing, prefix, options);
    open_sync / open / open_cb => Open, args::Open<'static>, ret::Open,
        (path: schema::PathLike<'_>, flags: Deferred<'_, Option<schema::FileFlags<'_>>>, mode: Deferred<'_, Option<schema::FileMode<'_>>>),
        |global, parsing| args::Open::from_js(global, parsing, path, flags, mode);
    read_sync / read / read_cb => Read, args::Read, ret::Read,
        (fd: i32, buffer: JsLocal<'_, BufferSource>, offset: u64, length: Option<f64>, position: Deferred<'_, schema::ReadPosition>),
        |global, parsing| args::Read::from_js(global, parsing, fd, buffer, offset, length, position);
    write_buffer_sync / write_buffer / write_buffer_cb => Write, args::Write<'static>, ret::Write,
        (fd: i32, buffer: JsLocal<'_, BufferSource>, offset: schema::WriteOffset<'_>, length: schema::WriteLength, position: Option<f64>),
        |global, parsing| args::Write::from_buffer(global, parsing, fd, buffer, offset, length, position);
    write_string_sync / write_string / write_string_cb => Write, args::Write<'static>, ret::Write,
        (fd: i32, buffer: (schema::WriteString, JsLocal<'_>), position: Option<f64>, encoding: Option<JsLocal<'_, StringLike>>),
        |global, parsing| args::Write::from_string(global, parsing, fd, buffer, position, encoding);
    read_file_sync / read_file / read_file_cb => ReadFile, args::ReadFile<'static>, ret::ReadFile,
        (path: schema::PathOrFileDescriptor<'_>, options: schema::EncodingOrReadFileOptions<'_>),
        |global, parsing| args::ReadFile::from_js(global, parsing, path, options);
    write_file_sync / write_file / write_file_cb => WriteFile, args::WriteFile<'static>, ret::WriteFile,
        (path: schema::PathOrFileDescriptor<'_>, data: schema::WriteFileData<'_>, options: schema::EncodingOrWriteFileOptions<'_>),
        |global, parsing| args::WriteFile::from_js(global, parsing, path, data, options);
    readlink_sync / readlink / readlink_cb => Readlink, args::Readlink<'static>, ret::Readlink,
        (path: schema::PathLike<'_>, options: Deferred<'_, schema::EncodingOrOptions<'_>>),
        |global, parsing| args::Readlink::from_js(global, parsing, path, options);
    rm_sync / rm / rm_cb => Rm, args::Rm<'static>, ret::Rm,
        (path: schema::PathLike<'_>, options: Deferred<'_, schema::RmOptionsArgument>),
        |global, parsing| args::Rm::from_js(global, parsing, path, options);
    rmdir_sync / rmdir / rmdir_cb => Rmdir, args::RmDir<'static>, ret::Rmdir,
        (path: schema::PathLike<'_>, options: Deferred<'_, schema::RmdirOptions>),
        |global, parsing| args::RmDir::from_js(global, parsing, path, options);
    realpath_sync / realpath / realpath_cb => RealpathNonNative, args::Realpath<'static>, ret::Realpath,
        (path: schema::PathLike<'_>, options: Deferred<'_, schema::EncodingOrOptions<'_>>),
        |global, parsing| args::Realpath::from_js(global, parsing, path, options);
    realpath_native_sync / realpath_native / realpath_native_cb => Realpath, args::Realpath<'static>, ret::Realpath,
        (path: schema::PathLike<'_>, options: Deferred<'_, schema::EncodingOrOptions<'_>>),
        |global, parsing| args::Realpath::from_js(global, parsing, path, options);
    rename_sync / rename / rename_cb => Rename, args::Rename<'static>, ret::Rename,
        (old_path: schema::PathLike<'_>, new_path: schema::PathLike<'_>),
        |global, parsing| args::Rename::from_js(global, parsing, old_path, new_path);
    stat_sync / stat / stat_cb => Stat, args::Stat<'static>, ret::Stat,
        (path: schema::PathLike<'_>, options: Deferred<'_, schema::StatOptions>),
        |global, parsing| args::Stat::from_js(global, parsing, path, options);
    statfs_sync / statfs / statfs_cb => Statfs, args::StatFS<'static>, ret::StatFS,
        (path: schema::PathLike<'_>, options: Deferred<'_, schema::BigIntOptions>),
        |global, parsing| args::StatFS::from_js(global, parsing, path, options);
    symlink_sync / symlink / symlink_cb => Symlink, args::Symlink<'static>, ret::Symlink,
        (target: schema::PathLike<'_>, path: schema::PathLike<'_>, r#type: Deferred<'_, schema::SymlinkType>),
        |global, parsing| args::Symlink::from_js(global, parsing, target, path, r#type);
    truncate_sync / truncate / truncate_cb => Truncate, args::Truncate<'static>, ret::Truncate,
        (path: schema::PathOrFileDescriptor<'_>, len: Deferred<'_, i64>),
        |global, parsing| args::Truncate::from_js(global, parsing, path, len);
    unlink_sync / unlink / unlink_cb => Unlink, args::Unlink<'static>, ret::Unlink,
        (path: schema::PathLike<'_>),
        |global, parsing| args::Unlink::from_js(global, parsing, path);
    utimes_sync / utimes / utimes_cb => Utimes, args::Utimes<'static>, ret::Utimes,
        (path: schema::PathLike<'_>, atime: schema::TimeLike<'_>, mtime: schema::TimeLike<'_>),
        |global, parsing| args::Utimes::from_js(global, parsing, path, atime, mtime);
    lutimes_sync / lutimes / lutimes_cb => Lutimes, args::Lutimes<'static>, ret::Lutimes,
        (path: schema::PathLike<'_>, atime: schema::TimeLike<'_>, mtime: schema::TimeLike<'_>),
        |global, parsing| args::Lutimes::from_js(global, parsing, path, atime, mtime);
    writev_sync / writev / writev_cb => Writev, args::Writev, ret::Writev,
        (fd: i32, buffers: JsLocal<'_, JSArray>, position: Option<f64>),
        |global, parsing| args::Writev::from_js(global, parsing, fd, buffers, position);
    readv_sync / readv / readv_cb => Readv, args::Readv, ret::Readv,
        (fd: i32, buffers: JsLocal<'_, JSArray>, position: Option<f64>),
        |global, parsing| args::Readv::from_js(global, parsing, fd, buffers, position);
    fdatasync_sync / fdatasync / fdatasync_cb => Fdatasync, args::FdataSync, ret::Fdatasync,
        (fd: i32),
        |_, _| Ok(args::FdataSync::from_js(fd));
}

// `readdirSync` goes through the generic sync path; only the async side is
// special-cased above.
impl Binding {
    pub(crate) fn readdir_sync(
        &self,
        cx: &mut JsScope<'_>,
        path: schema::PathLike<'_>,
        options: schema::EncodingOrReaddirOptions<'_>,
    ) -> JsResult<JSValue> {
        run_sync::<ret::Readdir, args::Readdir<'static>, { NodeFSFunctionEnum::Readdir }>(
            self,
            cx,
            |global, parsing| args::Readdir::from_js(global, parsing, path, options),
        )
    }
    // pub const statfs = callAsync(.statfs);
    // pub const statfsSync = callSync(.statfs);
}

pub(crate) fn binding<'a>(cx: &mut JsScope<'a>) -> JsWrapper<'a, Binding> {
    Binding {
        node_fs: JsCell::new(NodeFS {
            vm: NonNull::new(cx.global().bun_vm_ptr()),
            ..Default::default()
        }),
    }
    .into_js(&cx.heap)
}

/// Test-only (`bun:internal-for-testing`): run `(path, options)` through the
/// exact argument parser `fs.rm` uses and return the parsed options, so node's
/// `internal/fs/utils` `validateRmOptionsSync` tests exercise the production
/// validation (including its rejection of own-but-`undefined` booleans).
pub(crate) fn rm_options_for_testing(
    cx: &mut JsScope<'_>,
    path: schema::PathLike<'_>,
    options: Deferred<'_, schema::RmOptionsArgument>,
) -> JsResult<RmOptions> {
    let global = cx.global();
    let parsed = args::Rm::from_js(global, &mut Parsing::new(Flavor::Sync), path, options)?;
    Ok(RmOptions {
        retry_delay: parsed.retry_delay,
        max_retries: parsed.max_retries,
        recursive: parsed.recursive,
        force: parsed.force,
    })
}

/// Test-only (`bun:internal-for-testing`): run a flags value through the same
/// parser `fs.open` uses and return the numeric O_* mask, so node's
/// `internal/fs/utils` `stringToFlags` tests can assert the production mapping.
pub(crate) fn string_to_flags_for_testing(
    cx: &mut JsScope<'_>,
    flags: Option<schema::FileFlags<'_>>,
) -> JsResult<i32> {
    use crate::node::types::FileSystemFlags;
    let flags = FileSystemFlags::from_js(cx.global(), flags)?.unwrap_or(FileSystemFlags::R);
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
        match bun_sys::memfd_create(c"my_memfd", bun_sys::MemfdFlags::NonExecutable) {
            Ok(fd) => {
                let _ = bun_sys::ftruncate(fd, size as i64);
                Ok(Some(fd.native() as i32))
            }
            Err(err) => Err(global.throw_value(err.to_js(global))),
        }
    }
}
