use core::mem::ManuallyDrop;

use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsClass, JsResult, SysErrorJsc};

use crate::node::fs::{self, args, async_, ret, FsArgument, FsReturn, NodeFS};

/// Signature of every generated NodeFS host function.
pub type NodeFSFunction =
    fn(this: &mut Binding, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>;

// Zig: `const NodeFSFunctionEnum = std.meta.DeclEnum(node.fs.NodeFS);`
// Replaced by `fs::NodeFSFunctionEnum` (declared in node_fs.rs); the
// `node_fs_bindings!` macro at the bottom of this file enumerates the
// operations explicitly because Rust has no `std.meta.DeclEnum`.

/// Generates `pub fn $name_{sync,async}` host functions for one `NodeFS`
/// operation. Mirrors Zig's `Bindings(comptime function_name) type { runSync,
/// runAsync }` (node_fs_binding.zig:7-75): `@field` / `@typeInfo` reflection is
/// replaced by passing the concrete `args::*` / NodeFS method / `async_::*`
/// task type at the macro call site.
//
// PORT NOTE: no `#[bun_jsc::host_fn(method)]` on the generated fns — they
// coerce directly to `NodeFSFunction`; the codegen-side host shim is wired by
// `#[bun_jsc::JsClass]` on `Binding`.
macro_rules! bindings {
    // Standard arm: sync + async via thread-pool task.
    (
        $sync:ident, $async:ident, $method:ident,
        $Args:ty, $Ret:ty, $Task:ty
    ) => {
        pub fn $sync(
            this: &mut Binding,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            // SAFETY: `bun_vm()` returns the live per-thread VM owning `global`.
            let vm = unsafe { &*global.bun_vm() };
            let mut slice = ArgumentsSlice::init(vm, frame.arguments());
            // `defer slice.deinit()` → Drop on `slice`.

            let args = <$Args>::from_js(global, &mut slice)?;
            // `defer if (@hasDecl(Arguments, "deinit")) args.deinit()` —
            // every `args::*` type has an inherent `deinit`.
            let _deinit = scopeguard::guard((), |()| <$Args>::deinit(&args));

            if global.has_exception() {
                return Ok(JSValue::ZERO);
            }

            match this.node_fs.$method(&args, fs::Flavor::Sync) {
                Err(err) => Err(global.throw_value(SysErrorJsc::to_js(&err, global))),
                Ok(mut res) => <$Ret as FsReturn>::fs_to_js(&mut res, global),
            }
        }

        pub fn $async(
            this: &mut Binding,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            let vm_ptr = global.bun_vm();
            // SAFETY: `bun_vm()` returns the live per-thread VM owning `global`.
            let mut slice =
                ManuallyDrop::new(ArgumentsSlice::init(unsafe { &*vm_ptr }, frame.arguments()));
            slice.will_be_async = true;

            // Zig uses a `deinit: bool` flag + conditional `defer`. PORT NOTE:
            // `slice` is `ManuallyDrop` and only dropped on the early-return
            // error/abort branches (mirrors `deinit = true`). On success the
            // Task takes ownership of `args` and `slice` is intentionally
            // leaked here — its arena is freed when the Task completes (the
            // arena was bulk-freed in Zig; the Rust port boxes per-arg, see
            // PERF(port) in `NewAsyncCpTask`).
            let args = match <$Args>::from_js(global, &mut slice) {
                Ok(a) => a,
                Err(err) => {
                    // SAFETY: not yet dropped; only drop site for this path.
                    unsafe { ManuallyDrop::drop(&mut slice) };
                    return Err(err);
                }
            };

            if global.has_exception() {
                <$Args>::deinit(&args);
                // SAFETY: not yet dropped; only drop site for this path.
                unsafe { ManuallyDrop::drop(&mut slice) };
                return Ok(JSValue::ZERO);
            }

            // `if @hasField(Arguments, "signal")` — ReadFile/WriteFile only.
            if <$Args as FsArgument>::HAVE_ABORT_SIGNAL {
                if let Some(signal) = FsArgument::signal(&args) {
                    if let Some(reason) = signal.reason_if_aborted(global) {
                        let promise =
                            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                global,
                                reason.to_js(global),
                            );
                        <$Args>::deinit(&args);
                        // SAFETY: not yet dropped; only drop site for this path.
                        unsafe { ManuallyDrop::drop(&mut slice) };
                        return Ok(promise);
                    }
                }
            }

            // `@field(node.fs.Async, @tagName(function_name)).create(...)`
            // SAFETY: `vm_ptr` is the live per-thread VM (re-borrowed mutably for
            // the task's `tracker`/`ref_` init).
            Ok(<$Task>::create(global, this, args, unsafe { &mut *vm_ptr }))
        }
    };

    // Sync-only arm (watch / watchFile / unwatchFile have no async task).
    (
        @sync_only $sync:ident, $method:ident, $Args:ty, $Ret:ty
    ) => {
        pub fn $sync(
            this: &mut Binding,
            global: &JSGlobalObject,
            frame: &CallFrame,
        ) -> JsResult<JSValue> {
            // SAFETY: `bun_vm()` returns the live per-thread VM owning `global`.
            let vm = unsafe { &*global.bun_vm() };
            let mut slice = ArgumentsSlice::init(vm, frame.arguments());

            let args = <$Args>::from_js(global, &mut slice)?;
            let _deinit = scopeguard::guard((), |()| <$Args>::deinit(&args));

            if global.has_exception() {
                return Ok(JSValue::ZERO);
            }

            match this.node_fs.$method(&args, fs::Flavor::Sync) {
                Err(err) => Err(global.throw_value(SysErrorJsc::to_js(&err, global))),
                Ok(mut res) => <$Ret as FsReturn>::fs_to_js(&mut res, global),
            }
        }
    };
}

/// `switch (comptime function_name) { .readdir => ... }` — readdir's async path
/// dispatches to `AsyncReaddirRecursiveTask` when `args.recursive`.
fn readdir_async(
    this: &mut Binding,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let vm_ptr = global.bun_vm();
    // SAFETY: live per-thread VM.
    let mut slice =
        ManuallyDrop::new(ArgumentsSlice::init(unsafe { &*vm_ptr }, frame.arguments()));
    slice.will_be_async = true;

    let args = match args::Readdir::from_js(global, &mut slice) {
        Ok(a) => a,
        Err(err) => {
            // SAFETY: only drop site for this path.
            unsafe { ManuallyDrop::drop(&mut slice) };
            return Err(err);
        }
    };

    if global.has_exception() {
        args.deinit();
        // SAFETY: only drop site for this path.
        unsafe { ManuallyDrop::drop(&mut slice) };
        return Ok(JSValue::ZERO);
    }

    // SAFETY: live per-thread VM (re-borrowed mutably for task init).
    let vm = unsafe { &mut *vm_ptr };
    if args.recursive {
        return Ok(fs::AsyncReaddirRecursiveTask::create(global, args, vm));
    }
    Ok(async_::Readdir::create(global, this, args, vm))
}

/// `switch (comptime function_name) { .cp => ... }` — cp's async task takes
/// ownership of the arena in Zig (`slice.arena`). The Rust `AsyncCpTask` owns
/// its paths via `Box` (see PERF(port) in node_fs.rs) so the arena hand-off is
/// dropped; `slice` is still leaked here per the runAsync contract.
fn cp_async(this: &mut Binding, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let vm_ptr = global.bun_vm();
    // SAFETY: live per-thread VM.
    let mut slice =
        ManuallyDrop::new(ArgumentsSlice::init(unsafe { &*vm_ptr }, frame.arguments()));
    slice.will_be_async = true;

    let args = match args::Cp::from_js(global, &mut slice) {
        Ok(a) => a,
        Err(err) => {
            // SAFETY: only drop site for this path.
            unsafe { ManuallyDrop::drop(&mut slice) };
            return Err(err);
        }
    };

    if global.has_exception() {
        args.deinit();
        // SAFETY: only drop site for this path.
        unsafe { ManuallyDrop::drop(&mut slice) };
        return Ok(JSValue::ZERO);
    }

    // SAFETY: live per-thread VM (re-borrowed mutably for task init).
    Ok(fs::AsyncCpTask::create(global, this, args, unsafe {
        &mut *vm_ptr
    }))
}

/// `cpSync` — `args::Cp` does not implement `FsArgument`/`FsReturn`-adjacent
/// traits, so it gets its own sync body (the macro's `$Args: FsArgument` bound
/// would otherwise fail).
fn cp_sync_impl(
    this: &mut Binding,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // SAFETY: live per-thread VM.
    let vm = unsafe { &*global.bun_vm() };
    let mut slice = ArgumentsSlice::init(vm, frame.arguments());

    let args = args::Cp::from_js(global, &mut slice)?;
    let _deinit = scopeguard::guard((), |()| args.deinit());

    if global.has_exception() {
        return Ok(JSValue::ZERO);
    }

    match this.node_fs.cp(&args, fs::Flavor::Sync) {
        Err(err) => Err(global.throw_value(SysErrorJsc::to_js(&err, global))),
        Ok(mut res) => FsReturn::fs_to_js(&mut res, global),
    }
}

/// `watch` (sync-only). `NodeFS::watch` consumes `args` by value (the watcher
/// takes ownership of `path`/`listener`), so no `deinit` guard.
fn watch_impl(this: &mut Binding, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: live per-thread VM.
    let vm = unsafe { &*global.bun_vm() };
    let mut slice = ArgumentsSlice::init(vm, frame.arguments());

    let args = fs::Watcher::Arguments::from_js(global, &mut slice)?;

    if global.has_exception() {
        return Ok(JSValue::ZERO);
    }

    match this.node_fs.watch(args, fs::Flavor::Sync) {
        Err(err) => Err(global.throw_value(SysErrorJsc::to_js(&err, global))),
        Ok(mut res) => FsReturn::fs_to_js(&mut res, global),
    }
}

/// `watchFile` (sync-only). `NodeFS::watch_file` consumes `args` by value.
fn watch_file_impl(
    this: &mut Binding,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // SAFETY: live per-thread VM.
    let vm = unsafe { &*global.bun_vm() };
    let mut slice = ArgumentsSlice::init(vm, frame.arguments());

    let args = fs::StatWatcher::Arguments::from_js(global, &mut slice)?;

    if global.has_exception() {
        return Ok(JSValue::ZERO);
    }

    match this.node_fs.watch_file(args, fs::Flavor::Sync) {
        Err(err) => Err(global.throw_value(SysErrorJsc::to_js(&err, global))),
        Ok(mut res) => FsReturn::fs_to_js(&mut res, global),
    }
}

/// `unwatchFile` (sync-only). `Arguments == void`.
fn unwatch_file_impl(
    this: &mut Binding,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    if global.has_exception() {
        return Ok(JSValue::ZERO);
    }
    match this.node_fs.unwatch_file(&(), fs::Flavor::Sync) {
        Err(err) => Err(global.throw_value(SysErrorJsc::to_js(&err, global))),
        Ok(mut res) => FsReturn::fs_to_js(&mut res, global),
    }
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
            // SAFETY: `vm` is the live per-thread VM stashed in `create_binding`.
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
}

/// Generates `pub const <name>: NodeFSFunction = …` for every NodeFS
/// operation. Mirrors the long block of `pub const access = callAsync(.access);`
/// lines in the Zig.
macro_rules! node_fs_bindings {
    (
        $(
            ( $sync:ident, $async:ident, $method:ident, $Args:ty, $Ret:ty, $Task:ty )
        ),+ $(,)?
    ) => {
        // Generate the per-op `run_sync` / `run_async` bodies once each.
        mod __ops {
            use super::*;
            $( bindings!($sync, $async, $method, $Args, $Ret, $Task); )+
        }
        impl Binding {
            $(
                #[allow(non_upper_case_globals)]
                pub const $async: NodeFSFunction = __ops::$async;
                #[allow(non_upper_case_globals)]
                pub const $sync: NodeFSFunction = __ops::$sync;
            )+

            // Special-cased operations.
            #[allow(non_upper_case_globals)]
            pub const readdir: NodeFSFunction = readdir_async;
            #[allow(non_upper_case_globals)]
            pub const cp: NodeFSFunction = cp_async;
            #[allow(non_upper_case_globals)]
            pub const cp_sync: NodeFSFunction = cp_sync_impl;
            #[allow(non_upper_case_globals)]
            pub const watch: NodeFSFunction = watch_impl;
            #[allow(non_upper_case_globals)]
            pub const watch_file: NodeFSFunction = watch_file_impl;
            #[allow(non_upper_case_globals)]
            pub const unwatch_file: NodeFSFunction = unwatch_file_impl;
        }
    };
}

// `readdirSync` goes through the standard sync arm (no recursion special-case
// in sync), so it lives in the table; `readdir` (async) is hand-written above.
mod __readdir_sync {
    use super::*;
    bindings!(@sync_only readdir_sync, readdir, args::Readdir, ret::Readdir);
}
impl Binding {
    #[allow(non_upper_case_globals)]
    pub const readdir_sync: NodeFSFunction = __readdir_sync::readdir_sync;
}

#[rustfmt::skip]
node_fs_bindings! {
    (access_sync,          access,           access,             args::Access,    ret::Access,    async_::Access),
    (append_file_sync,     append_file,      append_file,        args::AppendFile,ret::AppendFile,async_::AppendFile),
    (close_sync,           close,            close,              args::Close,     ret::Close,     async_::Close),
    (copy_file_sync,       copy_file,        copy_file,          args::CopyFile,  ret::CopyFile,  async_::CopyFile),
    (exists_sync,          exists,           exists,             args::Exists,    ret::Exists,    async_::Exists),
    (chown_sync,           chown,            chown,              args::Chown,     ret::Chown,     async_::Chown),
    (chmod_sync,           chmod,            chmod,              args::Chmod,     ret::Chmod,     async_::Chmod),
    (fchmod_sync,          fchmod,           fchmod,             args::FChmod,    ret::Fchmod,    async_::Fchmod),
    (fchown_sync,          fchown,           fchown,             args::Fchown,    ret::Fchown,    async_::Fchown),
    (fstat_sync,           fstat,            fstat,              args::Fstat,     ret::Fstat,     async_::Fstat),
    (fsync_sync,           fsync,            fsync,              args::Fsync,     ret::Fsync,     async_::Fsync),
    (ftruncate_sync,       ftruncate,        ftruncate,          args::FTruncate, ret::Ftruncate, async_::Ftruncate),
    (futimes_sync,         futimes,          futimes,            args::Futimes,   ret::Futimes,   async_::Futimes),
    (lchmod_sync,          lchmod,           lchmod,             args::LCHmod,    ret::Lchmod,    async_::Lchmod),
    (lchown_sync,          lchown,           lchown,             args::LChown,    ret::Lchown,    async_::Lchown),
    (link_sync,            link,             link,               args::Link,      ret::Link,      async_::Link),
    (lstat_sync,           lstat,            lstat,              args::Lstat,     ret::Lstat,     async_::Lstat),
    (mkdir_sync,           mkdir,            mkdir,              args::Mkdir,     ret::Mkdir,     async_::Mkdir),
    (mkdtemp_sync,         mkdtemp,          mkdtemp,            args::MkdirTemp, ret::Mkdtemp,   async_::Mkdtemp),
    (open_sync,            open,             open,               args::Open,      ret::Open,      async_::Open),
    (read_sync,            read,             read,               args::Read,      ret::Read,      async_::Read),
    (write_sync,           write,            write,              args::Write,     ret::Write,     async_::Write),
    (read_file_sync,       read_file,        read_file,          args::ReadFile,  ret::ReadFile,  async_::ReadFile),
    (write_file_sync,      write_file,       write_file,         args::WriteFile, ret::WriteFile, async_::WriteFile),
    (readlink_sync,        readlink,         readlink,           args::Readlink,  ret::Readlink,  async_::Readlink),
    (rm_sync,              rm,               rm,                 args::Rm,        ret::Rm,        async_::Rm),
    (rmdir_sync,           rmdir,            rmdir,              args::RmDir,     ret::Rmdir,     async_::Rmdir),
    (realpath_sync,        realpath,         realpath_non_native,args::Realpath,  ret::Realpath,  async_::RealpathNonNative),
    (realpath_native_sync, realpath_native,  realpath,           args::Realpath,  ret::Realpath,  async_::Realpath),
    (rename_sync,          rename,           rename,             args::Rename,    ret::Rename,    async_::Rename),
    (stat_sync,            stat,             stat,               args::Stat,      ret::Stat,      async_::Stat),
    (statfs_sync,          statfs,           statfs,             args::StatFS,    ret::StatFS,    async_::Statfs),
    (symlink_sync,         symlink,          symlink,            args::Symlink,   ret::Symlink,   async_::Symlink),
    (truncate_sync,        truncate,         truncate,           args::Truncate,  ret::Truncate,  async_::Truncate),
    (unlink_sync,          unlink,           unlink,             args::Unlink,    ret::Unlink,    async_::Unlink),
    (utimes_sync,          utimes,           utimes,             args::Utimes,    ret::Utimes,    async_::Utimes),
    (lutimes_sync,         lutimes,          lutimes,            args::Lutimes,   ret::Lutimes,   async_::Lutimes),
    (writev_sync,          writev,           writev,             args::Writev,    ret::Writev,    async_::Writev),
    (readv_sync,           readv,            readv,              args::Readv,     ret::Readv,     async_::Readv),
    (fdatasync_sync,       fdatasync,        fdatasync,          args::FdataSync, ret::Fdatasync, async_::Fdatasync),
    // pub const statfs = callAsync(.statfs);
    // pub const statfsSync = callSync(.statfs);
}

pub fn create_binding(global: &JSGlobalObject) -> JSValue {
    let mut module = Binding::new(Binding::default());

    // SAFETY: `bun_vm()` returns the live per-thread VM owning `global`.
    let vm = unsafe { core::ptr::NonNull::new_unchecked(global.bun_vm()) };
    module.node_fs.vm = Some(vm);

    module.to_js(global)
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
                Ok(JSValue::js_number(fd.native() as f64))
            }
            Err(err) => Err(global.throw_value(SysErrorJsc::to_js(&err, global))),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_fs_binding.zig (240 lines)
//   confidence: medium
//   todos:      0
//   notes:      Zig's @field/@typeInfo/DeclEnum reflection lowered onto a
//               table-driven macro (`bindings!` + `node_fs_bindings!`) keyed
//               by concrete (args, ret, NodeFS method, async_ task) tuples.
//               cp/readdir/watch/watchFile/unwatchFile hand-written (special
//               control flow / by-value args). runAsync's conditional
//               `slice.deinit()` modelled with ManuallyDrop.
// ──────────────────────────────────────────────────────────────────────────
