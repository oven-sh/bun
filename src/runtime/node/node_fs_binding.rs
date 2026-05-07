use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsClass, JsResult, SysErrorJsc as _};

use crate::node::fs::{
    self, args, async_, ret, AsyncCpTask, AsyncReaddirRecursiveTask, Flavor, FsArgument, FsReturn,
    NodeFS, NodeFSFunctionEnum,
};

/// Signature of every generated NodeFS host function.
pub type NodeFSFunction =
    fn(this: &mut Binding, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>;

// Zig: `const NodeFSFunctionEnum = std.meta.DeclEnum(node.fs.NodeFS);`
// PORT NOTE: Rust has no `DeclEnum`/`@field`/`@typeInfo` reflection. The
// (`args::*`, `ret::*`, `NodeFS::<method>`, `async_::*`) quadruples that the
// Zig comptime block reflected per `function_name` are spelled out once in
// `node_fs.rs` (the `NodeFS::dispatch` table + `async_::*` aliases) and reused
// here via the `node_fs_bindings!` macro at the bottom of this file.

/// Returns bindings to call jsc.Node.fs.NodeFS.<function>.
/// Async calls use a thread pool.
// Zig: `fn Bindings(comptime function_name) type { return struct { runSync, runAsync } }`
// PORT NOTE: collapsed to two free generic fns; the `comptime function_name`
// becomes a `const F: NodeFSFunctionEnum`, and the reflected `Arguments` /
// return type become `A: FsArgument` / `R: FsReturn`.

/// `Bindings(FunctionEnum).runSync`.
fn run_sync<R: FsReturn, A: FsArgument, const F: NodeFSFunctionEnum>(
    this: &mut Binding,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // SAFETY: `bun_vm()` returns the live `*mut VirtualMachine`; borrowed only
    // for the duration of argument parsing on the JS thread.
    let vm: &VirtualMachine = unsafe { &*global.bun_vm() };
    let mut slice = ArgumentsSlice::init(vm, frame.arguments());
    // `defer slice.deinit()` → `Drop for ArgumentsSlice`.

    let args = <A as FsArgument>::from_js(global, &mut slice)?;
    // `defer if (@hasDecl(Arguments, "deinit")) args.deinit()` — every
    // `FsArgument` provides `deinit`; the guard runs on every exit path.
    let args = scopeguard::guard(args, |a| FsArgument::deinit(&a));

    if global.has_exception() {
        return Ok(JSValue::ZERO);
    }

    let mut result = NodeFS::dispatch::<R, A, F>(&mut this.node_fs, &args, Flavor::Sync);
    match result {
        Err(ref err) => Err(global.throw_value(err.to_js(global))),
        Ok(ref mut res) => res.fs_to_js(global),
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
    this: &mut Binding,
    global: &JSGlobalObject,
    frame: &CallFrame,
    create_task: fn(&JSGlobalObject, &mut Binding, A, &mut VirtualMachine) -> JSValue,
) -> JsResult<JSValue> {
    // SAFETY: JS-thread borrow of the per-thread VM; outlives `slice`.
    let vm: &mut VirtualMachine = unsafe { &mut *global.bun_vm() };
    let mut slice = ManuallyDrop::new(ArgumentsSlice::init(vm, frame.arguments()));
    slice.will_be_async = true;

    // Zig uses a `deinit: bool` flag + conditional `defer` to keep `slice`
    // alive past return when ownership transfers to the Task. The Rust port
    // mirrors this with `ManuallyDrop`: dropped only on the early-return
    // error/abort branches; on the success path the Task owns `args` (whose
    // protected JSValues are released by `deinit_and_unprotect()` when the
    // Task completes), and `slice` is intentionally not dropped — its
    // `unprotect()` would race that.

    let args = match <A as FsArgument>::from_js(global, &mut slice) {
        Ok(a) => a,
        Err(err) => {
            // SAFETY: not yet dropped; only drop site for this path.
            unsafe { ManuallyDrop::drop(&mut slice) };
            return Err(err);
        }
    };

    if global.has_exception() {
        FsArgument::deinit(&args);
        // SAFETY: not yet dropped; only drop site for this path.
        unsafe { ManuallyDrop::drop(&mut slice) };
        return Ok(JSValue::ZERO);
    }

    if A::HAVE_ABORT_SIGNAL {
        if let Some(signal) = args.signal() {
            if let Some(reason) = signal.reason_if_aborted(global) {
                let promise = JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global,
                    reason.to_js(global),
                );
                FsArgument::deinit(&args);
                // SAFETY: not yet dropped; only drop site for this path.
                unsafe { ManuallyDrop::drop(&mut slice) };
                return Ok(promise);
            }
        }
    }

    // `switch (comptime function_name) { else => {} }` — the `.cp` /
    // `.readdir` arms are handled by their dedicated bindings below.
    // SAFETY: re-borrow `vm` mutably; the `slice` borrow is no longer used.
    let vm: &mut VirtualMachine = unsafe { &mut *global.bun_vm() };
    Ok(create_task(global, this, args, vm))
}

#[inline(always)]
const fn call_sync<R: FsReturn, A: FsArgument, const F: NodeFSFunctionEnum>() -> NodeFSFunction {
    run_sync::<R, A, F>
}

#[bun_jsc::JsClass]
#[derive(Default)]
pub struct Binding {
    pub node_fs: NodeFS,
}

impl Binding {
    // `pub const js = jsc.Codegen.JSNodeJSFS;` + `toJS`/`fromJS`/`fromJSDirect`
    // → provided by `#[bun_jsc::JsClass]` derive.

    // `pub const new = bun.TrivialNew(@This());`
    pub fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called by codegen `finalize()` on the mutator thread with the
        // `m_ctx` payload pointer; `this` is valid and exclusively owned here.
        let this_ref = unsafe { &mut *this };
        if let Some(vm) = this_ref.node_fs.vm {
            // SAFETY: `vm` is the JSC-owned `VirtualMachine`; live for the
            // process. `node_fs` is a type-erased `*mut NodeFS` (see
            // `RuntimeHooks::create_node_fs`).
            let vm_node_fs = unsafe { vm.as_ref() }.node_fs;
            if vm_node_fs == Some((&this_ref.node_fs as *const NodeFS as *mut NodeFS).cast()) {
                return;
            }
        }

        // SAFETY: `this` was allocated via `Binding::new` (Box::new) and is
        // not the VM-owned singleton (checked above); reclaim it.
        drop(unsafe { Box::from_raw(this) });
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

    /// `callAsync(.cp)` — `.cp`'s `Task.create` (Zig) takes the parser arena as
    /// a 5th arg. The Rust `AsyncCpTask::create` copies its paths via
    /// `to_thread_safe()` instead, so the arena is dropped with `slice`.
    pub fn cp(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM; outlives `slice`.
        let vm: &mut VirtualMachine = unsafe { &mut *global.bun_vm() };
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
            cp_args.deinit();
            // SAFETY: not yet dropped; only drop site for this path.
            unsafe { ManuallyDrop::drop(&mut slice) };
            return Ok(JSValue::ZERO);
        }

        // SAFETY: re-borrow `vm` mutably; the `slice` borrow is no longer used.
        let vm: &mut VirtualMachine = unsafe { &mut *global.bun_vm() };
        Ok(AsyncCpTask::create(global, this, cp_args, vm))
    }

    /// `callSync(.cp)`.
    pub fn cp_sync(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = unsafe { &*global.bun_vm() };
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());

        let cp_args = args::Cp::from_js(global, &mut slice)?;
        let _args = scopeguard::guard(&cp_args, |a| a.deinit());

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        match this.node_fs.cp(&cp_args, Flavor::Sync) {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(()) => Ok(JSValue::UNDEFINED),
        }
    }

    /// `callAsync(.readdir)` — `args.recursive` selects
    /// `AsyncReaddirRecursiveTask` instead of the generic `AsyncFSTask`.
    pub fn readdir(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM; outlives `slice`.
        let vm: &mut VirtualMachine = unsafe { &mut *global.bun_vm() };
        let mut slice = ManuallyDrop::new(ArgumentsSlice::init(vm, frame.arguments()));
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
            rd_args.deinit();
            // SAFETY: not yet dropped; only drop site for this path.
            unsafe { ManuallyDrop::drop(&mut slice) };
            return Ok(JSValue::ZERO);
        }

        // SAFETY: re-borrow `vm` mutably; the `slice` borrow is no longer used.
        let vm: &mut VirtualMachine = unsafe { &mut *global.bun_vm() };
        if rd_args.recursive {
            return Ok(AsyncReaddirRecursiveTask::create(global, rd_args, vm));
        }
        Ok(async_::Readdir::create(global, this, rd_args, vm))
    }

    /// `callSync(.watch)` — `args::Watch` borrows `globalThis` so it can't go
    /// through `FsArgument`/`dispatch`; call the inherent method directly.
    pub fn watch(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = unsafe { &*global.bun_vm() };
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());

        let watch_args = fs::Watcher::Arguments::from_js(global, &mut slice)?;

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        match this.node_fs.watch(watch_args, Flavor::Sync) {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    }

    /// `callSync(.watchFile)`.
    pub fn watch_file(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = unsafe { &*global.bun_vm() };
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());

        let wf_args = fs::StatWatcher::Arguments::from_js(global, &mut slice)?;

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        match this.node_fs.watch_file(wf_args, Flavor::Sync) {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    }

    /// `callSync(.unwatchFile)` — `Arguments == void`.
    pub fn unwatch_file(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: JS-thread borrow of the per-thread VM.
        let vm: &VirtualMachine = unsafe { &*global.bun_vm() };
        let _slice = ArgumentsSlice::init(vm, frame.arguments());

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        match this.node_fs.unwatch_file(&(), Flavor::Sync) {
            Err(ref err) => Err(global.throw_value(err.to_js(global))),
            Ok(()) => Ok(JSValue::UNDEFINED),
        }
    }
}

/// Generates the `pub const <name> = call{Async,Sync}(.<fn>)` block from the
/// Zig. Each row supplies the `(args, ret, NodeFSFunctionEnum)` triple that the
/// Zig comptime reflection derived from `@typeInfo(NodeFS.<fn>)`.
macro_rules! node_fs_bindings {
    ( $( $sync:ident / $async_:ident => $F:ident, $Args:ty, $Ret:ty ; )* ) => {
        impl Binding {
            $(
                pub const $sync: NodeFSFunction =
                    call_sync::<$Ret, $Args, { NodeFSFunctionEnum::$F }>();
                pub fn $async_(
                    this: &mut Self,
                    global: &JSGlobalObject,
                    frame: &CallFrame,
                ) -> JsResult<JSValue> {
                    run_async::<$Args>(this, global, frame, async_::$F::create)
                }
            )*
        }
    };
}

#[rustfmt::skip]
node_fs_bindings! {
    access_sync       / access            => Access,            args::Access,    ret::Access;
    append_file_sync  / append_file       => AppendFile,        args::AppendFile,ret::AppendFile;
    close_sync        / close             => Close,             args::Close,     ret::Close;
    copy_file_sync    / copy_file         => CopyFile,          args::CopyFile,  ret::CopyFile;
    exists_sync       / exists            => Exists,            args::Exists,    ret::Exists;
    chown_sync        / chown             => Chown,             args::Chown,     ret::Chown;
    chmod_sync        / chmod             => Chmod,             args::Chmod,     ret::Chmod;
    fchmod_sync       / fchmod            => Fchmod,            args::FChmod,    ret::Fchmod;
    fchown_sync       / fchown            => Fchown,            args::Fchown,    ret::Fchown;
    fstat_sync        / fstat             => Fstat,             args::Fstat,     ret::Fstat;
    fsync_sync        / fsync             => Fsync,             args::Fsync,     ret::Fsync;
    ftruncate_sync    / ftruncate         => Ftruncate,         args::FTruncate, ret::Ftruncate;
    futimes_sync      / futimes           => Futimes,           args::Futimes,   ret::Futimes;
    lchmod_sync       / lchmod            => Lchmod,            args::LCHmod,    ret::Lchmod;
    lchown_sync       / lchown            => Lchown,            args::LChown,    ret::Lchown;
    link_sync         / link              => Link,              args::Link,      ret::Link;
    lstat_sync        / lstat             => Lstat,             args::Lstat,     ret::Lstat;
    mkdir_sync        / mkdir             => Mkdir,             args::Mkdir,     ret::Mkdir;
    mkdtemp_sync      / mkdtemp           => Mkdtemp,           args::MkdirTemp, ret::Mkdtemp;
    open_sync         / open              => Open,              args::Open,      ret::Open;
    read_sync         / read              => Read,              args::Read,      ret::Read;
    write_sync        / write             => Write,             args::Write,     ret::Write;
    read_file_sync    / read_file         => ReadFile,          args::ReadFile,  ret::ReadFile;
    write_file_sync   / write_file        => WriteFile,         args::WriteFile, ret::WriteFile;
    readlink_sync     / readlink          => Readlink,          args::Readlink,  ret::Readlink;
    rm_sync           / rm                => Rm,                args::Rm,        ret::Rm;
    rmdir_sync        / rmdir             => Rmdir,             args::RmDir,     ret::Rmdir;
    realpath_sync     / realpath          => RealpathNonNative, args::Realpath,  ret::Realpath;
    realpath_native_sync / realpath_native => Realpath,         args::Realpath,  ret::Realpath;
    rename_sync       / rename            => Rename,            args::Rename,    ret::Rename;
    stat_sync         / stat              => Stat,              args::Stat,      ret::Stat;
    statfs_sync       / statfs            => Statfs,            args::StatFS,    ret::StatFS;
    symlink_sync      / symlink           => Symlink,           args::Symlink,   ret::Symlink;
    truncate_sync     / truncate          => Truncate,          args::Truncate,  ret::Truncate;
    unlink_sync       / unlink            => Unlink,            args::Unlink,    ret::Unlink;
    utimes_sync       / utimes            => Utimes,            args::Utimes,    ret::Utimes;
    lutimes_sync      / lutimes           => Lutimes,           args::Lutimes,   ret::Lutimes;
    writev_sync       / writev            => Writev,            args::Writev,    ret::Writev;
    readv_sync        / readv             => Readv,             args::Readv,     ret::Readv;
    fdatasync_sync    / fdatasync         => Fdatasync,         args::FdataSync, ret::Fdatasync;
}

// `readdirSync` goes through the generic sync path; only the async side is
// special-cased above.
impl Binding {
    pub const readdir_sync: NodeFSFunction =
        call_sync::<ret::Readdir, args::Readdir, { NodeFSFunctionEnum::Readdir }>();
    // pub const statfs = callAsync(.statfs);
    // pub const statfsSync = callSync(.statfs);
}

pub fn create_binding(global: &JSGlobalObject) -> JSValue {
    let mut module = Binding::new(Binding::default());

    let vm = global.bun_vm();
    module.node_fs.vm = NonNull::new(vm);

    // SAFETY: `module` was `Box::new`-allocated; ownership transfers to the GC
    // wrapper, which calls `Binding::finalize` to reclaim it.
    unsafe { Binding::to_js_ptr(Box::into_raw(module), global) }
}

#[bun_jsc::host_fn]
pub fn create_memfd_for_testing(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>();

    if arguments.len < 1 {
        return Ok(JSValue::UNDEFINED);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = arguments;
        return Err(global.throw(format_args!(
            "memfd_create is not implemented on this platform"
        )));
    }

    #[cfg(target_os = "linux")]
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_fs_binding.zig (240 lines)
//   confidence: medium-high
//   notes:      Zig comptime `@field`/`@typeInfo` reflection replaced by the
//               (FsArgument, FsReturn, NodeFS::dispatch, async_::*) quadruple
//               already established in node_fs.rs; cp/readdir/watch/watchFile/
//               unwatchFile hand-written because they fall outside
//               NodeFSFunctionEnum or take borrowed-lifetime args.
// ──────────────────────────────────────────────────────────────────────────
