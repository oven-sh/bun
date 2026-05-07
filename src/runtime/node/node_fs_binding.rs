use core::ptr::NonNull;

use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, SysErrorJsc as _};

use crate::node::fs::{
    self, args, async_, AsyncCpTask, AsyncReaddirRecursiveTask, Flavor, FsArgument, FsReturn,
    NodeFS,
};

/// Signature of every generated NodeFS host function.
pub type NodeFSFunction =
    fn(this: &mut Binding, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>;

// Zig: `const NodeFSFunctionEnum = std.meta.DeclEnum(node.fs.NodeFS);`
// `DeclEnum` reflects every `pub fn` on `NodeFS` into an enum tag and
// `Bindings(tag)` then `@typeInfo`-inspects the chosen method to recover its
// `Arguments` type. Rust has no comptime type reflection, so the
// `node_fs_bindings!` macro below is given the `(method, ArgsTy, RetTy, TaskTy)`
// tuple per operation and expands a monomorphic `run_sync`/`run_async` body
// for each — the same code shape Zig produces post-monomorphisation.

/// `globalObject.bunVM()` — JSGlobalObject hands back a raw pointer; the
/// binding fns hold a unique `&mut` for the duration of the call (matches
/// every other `bun_vm()` consumer in `node_fs.rs`).
#[inline]
fn bun_vm(global: &JSGlobalObject) -> &mut VirtualMachine {
    // SAFETY: JSC guarantees the per-thread VM outlives every host call on
    // that thread; this is the documented `JSC_BORROW` accessor (see
    // `JSGlobalObject::bun_vm`).
    unsafe { &mut *global.bun_vm() }
}

/// Expand one `Bindings(function_name).runSync` body for `(ArgsTy, method)`.
///
/// Mirrors node_fs_binding.zig:16-35 — `Arguments.fromJS` → optional `deinit`
/// guard → call `function(&this.node_fs, args, .sync)` → `globalObject.toJS`.
macro_rules! run_sync_body {
    ($this:ident, $global:ident, $frame:ident; $Args:ty, |$nfs:ident, $a:ident| $call:expr) => {{
        let vm = bun_vm($global);
        let mut slice = ArgumentsSlice::init(vm, $frame.arguments());
        // `defer slice.deinit()` → `Drop for ArgumentsSlice`.

        let args = <$Args>::from_js($global, &mut slice)?;
        // `defer if (@hasDecl(Arguments, "deinit")) args.deinit()` — every
        // `args::*` struct in this table has an inherent `deinit()`; capture by
        // value so `?`/early-return below frees it.
        let args = scopeguard::guard(args, |a| a.deinit());

        if $global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        let $nfs = &mut $this.node_fs;
        let $a = &*args;
        match $call {
            Err(err) => Err($global.throw_value(err.to_js($global))),
            Ok(mut res) => FsReturn::fs_to_js(&mut res, $global),
        }
    }};
}

/// Expand one `Bindings(function_name).runAsync` body for the regular
/// thread-pool path (everything except `cp` / `readdir`).
///
/// Mirrors node_fs_binding.zig:37-73. The Zig used a `var deinit: bool` flag
/// with conditional `defer`s; here `slice` is `ManuallyDrop` and only dropped
/// on the early-return error / abort branches. On the success path `args`
/// moves into `Task::create` (which immediately `to_thread_safe()`-clones any
/// arena-backed slices), so `slice` — and its arena — are intentionally
/// leaked, exactly as in the Zig (`deinit` stays `false`).
// PERF(port): the Zig also leaked `slice.arena` here for non-`cp` ops; revisit
// once `args::*` types own their allocations and the arena can be freed.
macro_rules! run_async_body {
    ($this:ident, $global:ident, $frame:ident; $Args:ty, $Task:ty) => {{
        let vm = bun_vm($global);
        let mut slice =
            core::mem::ManuallyDrop::new(ArgumentsSlice::init(vm, $frame.arguments()));
        slice.will_be_async = true;

        let args: $Args = match <$Args>::from_js($global, &mut slice) {
            Ok(a) => a,
            Err(err) => {
                // SAFETY: not yet dropped; only drop site for this branch.
                unsafe { core::mem::ManuallyDrop::drop(&mut slice) };
                return Err(err);
            }
        };

        if $global.has_exception() {
            args.deinit();
            // SAFETY: not yet dropped; only drop site for this branch.
            unsafe { core::mem::ManuallyDrop::drop(&mut slice) };
            return Ok(JSValue::ZERO);
        }

        // `if (have_abort_signal) check_early_abort: { ... }`
        if <$Args as FsArgument>::HAVE_ABORT_SIGNAL {
            if let Some(signal) = FsArgument::signal(&args) {
                if let Some(reason) = signal.reason_if_aborted($global) {
                    let promise = bun_jsc::JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        $global,
                        reason.to_js($global),
                    );
                    args.deinit();
                    // SAFETY: not yet dropped; only drop site for this branch.
                    unsafe { core::mem::ManuallyDrop::drop(&mut slice) };
                    return Ok(promise);
                }
            }
        }

        // PORT NOTE: reborrow — `slice` (ManuallyDrop) borrows `*vm` immutably;
        // `Task::create` wants `&mut VirtualMachine`. Re-derive the unique
        // borrow now that `slice` is no longer touched.
        let vm = bun_vm($global);
        Ok(<$Task>::create($global, $this, args, vm))
    }};
}

/// Generates the full `pub const <name>: NodeFSFunction = …;` table on
/// [`Binding`]. Each row supplies the concrete `(method, ArgsTy, TaskTy)`
/// triple that Zig recovered via `@field` / `@typeInfo` reflection.
macro_rules! node_fs_bindings {
    ( $( $async_name:ident / $sync_name:ident => $method:ident, $Args:ty, $Task:ty ; )* ) => {
        impl Binding {
            $(
                pub fn $sync_name(
                    this: &mut Binding,
                    global: &JSGlobalObject,
                    frame: &CallFrame,
                ) -> JsResult<JSValue> {
                    run_sync_body!(this, global, frame; $Args, |nfs, a| nfs.$method(a, Flavor::Sync))
                }

                pub fn $async_name(
                    this: &mut Binding,
                    global: &JSGlobalObject,
                    frame: &CallFrame,
                ) -> JsResult<JSValue> {
                    run_async_body!(this, global, frame; $Args, $Task)
                }
            )*
        }
    };
}

#[bun_jsc::JsClass(name = "NodeJSFS")]
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
        // SAFETY: called by codegen `${T}Class__finalize` on the mutator
        // thread with the `m_ctx` payload pointer; `this` is valid and
        // exclusively owned here.
        let this_ref = unsafe { &mut *this };
        if let Some(vm) = this_ref.node_fs.vm {
            // SAFETY: `vm` is the live per-thread `VirtualMachine` (set in
            // `create_binding`); JSC_BORROW.
            if core::ptr::eq(unsafe { vm.as_ref() }.node_fs(), (&this_ref.node_fs as *const NodeFS).cast()) {
                return;
            }
        }

        // SAFETY: `this` was allocated via `Binding::new` (Box::new) and is
        // not the VM-owned singleton (checked above); reclaim it.
        drop(unsafe { Box::from_raw(this) });
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_dirent(_this: &mut Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(crate::node::types::Dirent::get_constructor(global))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stats(_this: &mut Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(crate::node::StatsSmall::get_constructor(global))
    }
}

#[rustfmt::skip]
node_fs_bindings! {
    access          / access_sync          => access,              args::Access,    async_::Access;
    append_file     / append_file_sync     => append_file,         args::AppendFile,async_::AppendFile;
    close           / close_sync           => close,               args::Close,     async_::Close;
    copy_file       / copy_file_sync       => copy_file,           args::CopyFile,  async_::CopyFile;
    exists          / exists_sync          => exists,              args::Exists,    async_::Exists;
    chown           / chown_sync           => chown,               args::Chown,     async_::Chown;
    chmod           / chmod_sync           => chmod,               args::Chmod,     async_::Chmod;
    fchmod          / fchmod_sync          => fchmod,              args::FChmod,    async_::Fchmod;
    fchown          / fchown_sync          => fchown,              args::Fchown,    async_::Fchown;
    fstat           / fstat_sync           => fstat,               args::Fstat,     async_::Fstat;
    fsync           / fsync_sync           => fsync,               args::Fsync,     async_::Fsync;
    ftruncate       / ftruncate_sync       => ftruncate,           args::FTruncate, async_::Ftruncate;
    futimes         / futimes_sync         => futimes,             args::Futimes,   async_::Futimes;
    lchmod          / lchmod_sync          => lchmod,              args::LCHmod,    async_::Lchmod;
    lchown          / lchown_sync          => lchown,              args::LChown,    async_::Lchown;
    link            / link_sync            => link,                args::Link,      async_::Link;
    lstat           / lstat_sync           => lstat,               args::Lstat,     async_::Lstat;
    mkdir           / mkdir_sync           => mkdir,               args::Mkdir,     async_::Mkdir;
    mkdtemp         / mkdtemp_sync         => mkdtemp,             args::MkdirTemp, async_::Mkdtemp;
    open            / open_sync            => open,                args::Open,      async_::Open;
    read            / read_sync            => read,                args::Read,      async_::Read;
    write           / write_sync           => write,               args::Write,     async_::Write;
    read_file       / read_file_sync       => read_file,           args::ReadFile,  async_::ReadFile;
    write_file      / write_file_sync      => write_file,          args::WriteFile, async_::WriteFile;
    readlink        / readlink_sync        => readlink,            args::Readlink,  async_::Readlink;
    rm              / rm_sync              => rm,                  args::Rm,        async_::Rm;
    rmdir           / rmdir_sync           => rmdir,               args::RmDir,     async_::Rmdir;
    realpath        / realpath_sync        => realpath_non_native, args::Realpath,  async_::RealpathNonNative;
    realpath_native / realpath_native_sync => realpath,            args::Realpath,  async_::Realpath;
    rename          / rename_sync          => rename,              args::Rename,    async_::Rename;
    stat            / stat_sync            => stat,                args::Stat,      async_::Stat;
    statfs          / statfs_sync          => statfs,              args::StatFS,    async_::Statfs;
    symlink         / symlink_sync         => symlink,             args::Symlink,   async_::Symlink;
    truncate        / truncate_sync        => truncate,            args::Truncate,  async_::Truncate;
    unlink          / unlink_sync          => unlink,              args::Unlink,    async_::Unlink;
    utimes          / utimes_sync          => utimes,              args::Utimes,    async_::Utimes;
    lutimes         / lutimes_sync         => lutimes,             args::Lutimes,   async_::Lutimes;
    writev          / writev_sync          => writev,              args::Writev,    async_::Writev;
    readv           / readv_sync           => readv,               args::Readv,     async_::Readv;
    fdatasync       / fdatasync_sync       => fdatasync,           args::FdataSync, async_::Fdatasync;
}

// ── Ops the macro can't cover (special async dispatch / by-value args /
//    `Arguments == void`) ────────────────────────────────────────────────────

impl Binding {
    // `cp` — async path hands ownership to `AsyncCpTask::create` (Zig also
    // forwarded `slice.arena`; the Rust `NewAsyncCpTask` no longer stores it,
    // see `// PERF(port): was arena bulk-free` in node_fs.rs).
    pub fn cp_sync(
        this: &mut Binding,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        run_sync_body!(this, global, frame; args::Cp, |nfs, a| nfs.cp(a, Flavor::Sync))
    }

    pub fn cp(
        this: &mut Binding,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let vm = bun_vm(global);
        let mut slice =
            core::mem::ManuallyDrop::new(ArgumentsSlice::init(vm, frame.arguments()));
        slice.will_be_async = true;

        let args = match args::Cp::from_js(global, &mut slice) {
            Ok(a) => a,
            Err(err) => {
                // SAFETY: not yet dropped; only drop site for this branch.
                unsafe { core::mem::ManuallyDrop::drop(&mut slice) };
                return Err(err);
            }
        };

        if global.has_exception() {
            args.deinit();
            // SAFETY: not yet dropped; only drop site for this branch.
            unsafe { core::mem::ManuallyDrop::drop(&mut slice) };
            return Ok(JSValue::ZERO);
        }

        let vm = bun_vm(global);
        Ok(AsyncCpTask::create(global, this, args, vm))
    }

    // `readdir` — async path forks on `args.recursive` (`.readdir => if
    // (args.recursive) return AsyncReaddirRecursiveTask.create(...)`).
    pub fn readdir_sync(
        this: &mut Binding,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        run_sync_body!(this, global, frame; args::Readdir, |nfs, a| nfs.readdir(a, Flavor::Sync))
    }

    pub fn readdir(
        this: &mut Binding,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let vm = bun_vm(global);
        let mut slice =
            core::mem::ManuallyDrop::new(ArgumentsSlice::init(vm, frame.arguments()));
        slice.will_be_async = true;

        let args = match args::Readdir::from_js(global, &mut slice) {
            Ok(a) => a,
            Err(err) => {
                // SAFETY: not yet dropped; only drop site for this branch.
                unsafe { core::mem::ManuallyDrop::drop(&mut slice) };
                return Err(err);
            }
        };

        if global.has_exception() {
            args.deinit();
            // SAFETY: not yet dropped; only drop site for this branch.
            unsafe { core::mem::ManuallyDrop::drop(&mut slice) };
            return Ok(JSValue::ZERO);
        }

        let vm = bun_vm(global);
        if args.recursive {
            return Ok(AsyncReaddirRecursiveTask::create(global, args, vm));
        }
        Ok(async_::Readdir::create(global, this, args, vm))
    }

    // `watch` / `watchFile` — sync-only; `NodeFS::watch{,_file}` consume
    // `Arguments` by value and return `JSValue` directly (no `FsReturn`).
    pub fn watch(
        this: &mut Binding,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let vm = bun_vm(global);
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());
        let args = fs::Watcher::Arguments::from_js(global, &mut slice)?;
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        match this.node_fs.watch(args, Flavor::Sync) {
            Err(err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    }

    pub fn watch_file(
        this: &mut Binding,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let vm = bun_vm(global);
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());
        let args = fs::StatWatcher::Arguments::from_js(global, &mut slice)?;
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        match this.node_fs.watch_file(args, Flavor::Sync) {
            Err(err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    }

    // `unwatchFile` — `Arguments == void` arm (Zig: `if (Arguments != void)`
    // skipped, `args` is `void`, body just calls through).
    pub fn unwatch_file(
        this: &mut Binding,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let vm = bun_vm(global);
        let _slice = ArgumentsSlice::init(vm, frame.arguments());
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        match this.node_fs.unwatch_file(&(), Flavor::Sync) {
            Err(err) => Err(global.throw_value(err.to_js(global))),
            Ok(mut res) => FsReturn::fs_to_js(&mut res, global),
        }
    }
}

pub fn create_binding(global: &JSGlobalObject) -> JSValue {
    let mut module = Binding::new(Binding::default());

    let vm = global.bun_vm();
    module.node_fs.vm = NonNull::new(vm);

    // SAFETY: `module` was `Box::new`'d in `Binding::new`; ownership transfers
    // to the JS GC wrapper (freed via `Binding::finalize`).
    unsafe { Binding::to_js_ptr(Box::into_raw(module), global) }
}

#[bun_jsc::host_fn]
pub fn create_memfd_for_testing(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>();

    if arguments.len < 1 {
        return Ok(JSValue::UNDEFINED);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = arguments;
        return Err(global.throw(format_args!("memfd_create is not implemented on this platform")));
    }

    #[cfg(target_os = "linux")]
    {
        let size = arguments.ptr[0].to_int64();
        match bun_sys::memfd_create(c"my_memfd", bun_sys::MemfdFlags::NonExecutable) {
            Ok(fd) => {
                let _ = bun_sys::ftruncate(fd, size);
                Ok(JSValue::js_number(fd.cast() as f64))
            }
            Err(err) => Err(global.throw_value(err.to_js(global))),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_fs_binding.zig (240 lines)
//   confidence: medium
//   notes:      Zig's `Bindings(comptime fn_name)` + `@typeInfo` reflection is
//               replaced by the `node_fs_bindings!` table — each row supplies
//               the (method, ArgsTy, TaskTy) triple Zig recovered at comptime
//               and expands the identical monomorphic `runSync`/`runAsync`
//               body. `cp`/`readdir` keep their bespoke async dispatch;
//               `watch`/`watchFile`/`unwatchFile` are sync-only and bypass
//               `FsReturn` (their `ret::*` is `JSValue`/`()`).
// ──────────────────────────────────────────────────────────────────────────
