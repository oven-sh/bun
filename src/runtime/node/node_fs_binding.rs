use core::ptr::NonNull;

use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, SysErrorJsc as _};

use crate::node::fs::{self, args, async_, FsArgument, FsReturn, NodeFS};

/// Signature of every generated NodeFS host function.
pub type NodeFSFunction =
    fn(this: &mut Binding, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>;

// Zig: `const NodeFSFunctionEnum = std.meta.DeclEnum(node.fs.NodeFS);`
// `DeclEnum` reflects every `pub fn` on `NodeFS` into an enum tag. The Rust
// port already materialised that enum as `fs::NodeFSFunctionEnum` (used as a
// const-generic on `AsyncFSTask`/`UVFSRequest`/`NodeFS::dispatch`); the
// `node_fs_bindings!` macro below enumerates the operations explicitly.

/// Returns bindings to call jsc.Node.fs.NodeFS.<function>.
/// Async calls use a thread pool.
//
// Zig: `fn Bindings(comptime function_name: NodeFSFunctionEnum) type { return struct { runSync, runAsync } }`.
// The Zig version monomorphises a `runSync`/`runAsync` pair per `function_name`
// via `@typeInfo(@TypeOf(function))` reflection. Rust has no `@typeInfo`, so
// the macro arms below spell out the `(args::*, NodeFS::method, async_::*)`
// triple per operation and expand to a dedicated fn body — same monomorphisation,
// no vtable.
macro_rules! run_sync {
    ($Args:ty, $method:ident) => {
        |this: &mut Binding, global: &JSGlobalObject, frame: &CallFrame| -> JsResult<JSValue> {
            // SAFETY: `bun_vm()` returns the live JS-thread VM; ArgumentsSlice
            // borrows it immutably for the call duration only.
            let vm = unsafe { &*global.bun_vm() };
            let mut slice = ArgumentsSlice::init(vm, frame.arguments());
            // `defer slice.deinit()` → ArgumentsSlice: Drop.

            let args = <$Args>::from_js(global, &mut slice)?;
            // `defer if (@hasDecl(Arguments, "deinit")) args.deinit()` — every
            // `args::*` in the dispatch table defines an inherent `deinit()`.
            if global.has_exception() {
                args.deinit();
                return Ok(JSValue::ZERO);
            }
            let result = this.node_fs.$method(&args, fs::Flavor::Sync);
            args.deinit();
            match result {
                Err(err) => Err(global.throw_value(err.to_js(global))),
                Ok(mut res) => FsReturn::fs_to_js(&mut res, global),
            }
        }
    };
}

macro_rules! run_async {
    ($Args:ty, $Task:ty) => {
        |this: &mut Binding, global: &JSGlobalObject, frame: &CallFrame| -> JsResult<JSValue> {
            let vm_ptr = global.bun_vm();
            // SAFETY: `bun_vm()` returns the live JS-thread VM.
            let mut slice = ArgumentsSlice::init(unsafe { &*vm_ptr }, frame.arguments());
            slice.will_be_async = true;

            // Zig uses a `deinit: bool` flag + conditional `defer` to keep the
            // `slice` arena alive past return when ownership transfers to the
            // Task. In Rust `ArgumentsSlice: Drop` and the `cp` task no longer
            // adopts the arena (the Rust `args::Cp` does not borrow from it),
            // so `slice` may drop normally on every path.
            let args = <$Args>::from_js(global, &mut slice)?;

            if global.has_exception() {
                args.deinit();
                return Ok(JSValue::ZERO);
            }

            // `if (@hasField(Arguments, "signal")) check_early_abort: { ... }`
            if <$Args as FsArgument>::HAVE_ABORT_SIGNAL {
                if let Some(signal) = FsArgument::signal(&args) {
                    if let Some(reason) = signal.reason_if_aborted(global) {
                        let promise =
                            JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                global,
                                reason.to_js(global),
                            );
                        args.deinit();
                        return Ok(promise);
                    }
                }
            }

            drop(slice);
            // SAFETY: `vm_ptr` is the live JS-thread VM; sole `&mut` at this
            // point (`slice`'s shared borrow released above).
            Ok(<$Task>::create(global, this, args, unsafe { &mut *vm_ptr }))
        }
    };
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
        if let Some(mut vm) = this_ref.node_fs.vm {
            // SAFETY: `vm` was stashed by `create_binding`; the VM outlives its
            // global's finalizer pass. `node_fs()` only mutates to lazily box
            // the singleton (idempotent here — it's already populated).
            if core::ptr::eq(unsafe { vm.as_mut() }.node_fs(), (&this_ref.node_fs as *const NodeFS).cast()) {
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

/// Generates `pub const <name>: NodeFSFunction = ...` for every NodeFS
/// operation. Mirrors the long block of `pub const access = callAsync(.access);`
/// lines in the Zig.
macro_rules! node_fs_bindings {
    (
        $( async $a_name:ident => ($a_args:ty, $a_task:ty); )*
        ---
        $( sync $s_name:ident => ($s_args:ty, $s_method:ident); )*
    ) => {
        impl Binding {
            $(
                #[allow(non_upper_case_globals)]
                pub const $a_name: NodeFSFunction = run_async!($a_args, $a_task);
            )*
            $(
                #[allow(non_upper_case_globals)]
                pub const $s_name: NodeFSFunction = run_sync!($s_args, $s_method);
            )*
        }
    };
}

#[rustfmt::skip]
node_fs_bindings! {
    async access            => (args::Access,    async_::Access);
    async append_file       => (args::AppendFile,async_::AppendFile);
    async close             => (args::Close,     async_::Close);
    async copy_file         => (args::CopyFile,  async_::CopyFile);
    async exists            => (args::Exists,    async_::Exists);
    async chown             => (args::Chown,     async_::Chown);
    async chmod             => (args::Chmod,     async_::Chmod);
    async fchmod            => (args::FChmod,    async_::Fchmod);
    async fchown            => (args::Fchown,    async_::Fchown);
    async fstat             => (args::Fstat,     async_::Fstat);
    async fsync             => (args::Fsync,     async_::Fsync);
    async ftruncate         => (args::FTruncate, async_::Ftruncate);
    async futimes           => (args::Futimes,   async_::Futimes);
    async lchmod            => (args::LCHmod,    async_::Lchmod);
    async lchown            => (args::LChown,    async_::Lchown);
    async link              => (args::Link,      async_::Link);
    async lstat             => (args::Lstat,     async_::Lstat);
    async mkdir             => (args::Mkdir,     async_::Mkdir);
    async mkdtemp           => (args::MkdirTemp, async_::Mkdtemp);
    async open              => (args::Open,      async_::Open);
    async read              => (args::Read,      async_::Read);
    async write             => (args::Write,     async_::Write);
    async read_file         => (args::ReadFile,  async_::ReadFile);
    async write_file        => (args::WriteFile, async_::WriteFile);
    async readlink          => (args::Readlink,  async_::Readlink);
    async rm                => (args::Rm,        async_::Rm);
    async rmdir             => (args::RmDir,     async_::Rmdir);
    async realpath          => (args::Realpath,  async_::RealpathNonNative);
    async realpath_native   => (args::Realpath,  async_::Realpath);
    async rename            => (args::Rename,    async_::Rename);
    async stat              => (args::Stat,      async_::Stat);
    async statfs            => (args::StatFS,    async_::Statfs);
    async symlink           => (args::Symlink,   async_::Symlink);
    async truncate          => (args::Truncate,  async_::Truncate);
    async unlink            => (args::Unlink,    async_::Unlink);
    async utimes            => (args::Utimes,    async_::Utimes);
    async lutimes           => (args::Lutimes,   async_::Lutimes);
    async writev            => (args::Writev,    async_::Writev);
    async readv             => (args::Readv,     async_::Readv);
    async fdatasync         => (args::FdataSync, async_::Fdatasync);
    ---
    sync  access_sync       => (args::Access,    access);
    sync  append_file_sync  => (args::AppendFile,append_file);
    sync  close_sync        => (args::Close,     close);
    sync  cp_sync           => (args::Cp,        cp);
    sync  copy_file_sync    => (args::CopyFile,  copy_file);
    sync  exists_sync       => (args::Exists,    exists);
    sync  chown_sync        => (args::Chown,     chown);
    sync  chmod_sync        => (args::Chmod,     chmod);
    sync  fchmod_sync       => (args::FChmod,    fchmod);
    sync  fchown_sync       => (args::Fchown,    fchown);
    sync  fstat_sync        => (args::Fstat,     fstat);
    sync  fsync_sync        => (args::Fsync,     fsync);
    sync  ftruncate_sync    => (args::FTruncate, ftruncate);
    sync  futimes_sync      => (args::Futimes,   futimes);
    sync  lchmod_sync       => (args::LCHmod,    lchmod);
    sync  lchown_sync       => (args::LChown,    lchown);
    sync  link_sync         => (args::Link,      link);
    sync  lstat_sync        => (args::Lstat,     lstat);
    sync  mkdir_sync        => (args::Mkdir,     mkdir);
    sync  mkdtemp_sync      => (args::MkdirTemp, mkdtemp);
    sync  open_sync         => (args::Open,      open);
    sync  read_sync         => (args::Read,      read);
    sync  write_sync        => (args::Write,     write);
    sync  readdir_sync      => (args::Readdir,   readdir);
    sync  read_file_sync    => (args::ReadFile,  read_file);
    sync  write_file_sync   => (args::WriteFile, write_file);
    sync  readlink_sync     => (args::Readlink,  readlink);
    sync  realpath_sync     => (args::Realpath,  realpath_non_native);
    sync  realpath_native_sync => (args::Realpath, realpath);
    sync  rename_sync       => (args::Rename,    rename);
    sync  stat_sync         => (args::Stat,      stat);
    sync  statfs_sync       => (args::StatFS,    statfs);
    sync  symlink_sync      => (args::Symlink,   symlink);
    sync  truncate_sync     => (args::Truncate,  truncate);
    sync  unlink_sync       => (args::Unlink,    unlink);
    sync  utimes_sync       => (args::Utimes,    utimes);
    sync  lutimes_sync      => (args::Lutimes,   lutimes);
    sync  rm_sync           => (args::Rm,        rm);
    sync  rmdir_sync        => (args::RmDir,     rmdir);
    sync  writev_sync       => (args::Writev,    writev);
    sync  readv_sync        => (args::Readv,     readv);
    sync  fdatasync_sync    => (args::FdataSync, fdatasync);
    // pub const statfs = callAsync(.statfs);
    // pub const statfsSync = callSync(.statfs);
}

// ──────────────────────────────────────────────────────────────────────────
// Special-case bindings — Zig's `switch (comptime function_name)` arms.
// `cp` / `readdir` need bespoke async dispatch; `watch` / `watchFile` /
// `unwatchFile` are sync-only and their `Arguments` carry a borrow lifetime
// that the generic table can't express.
// ──────────────────────────────────────────────────────────────────────────
impl Binding {
    /// `callAsync(.cp)` — `Task = node.fs.Async.cp` takes ownership of `args`
    /// (and, in Zig, the slice arena). The Rust `AsyncCpTask::create` does not
    /// adopt an arena because `args::Cp` owns its `PathLike`s outright, so the
    /// arena-transfer arm collapses to the plain `create` call.
    #[allow(non_upper_case_globals)]
    pub const cp: NodeFSFunction = |this, global, frame| {
        let vm_ptr = global.bun_vm();
        // SAFETY: `bun_vm()` returns the live JS-thread VM.
        let mut slice = ArgumentsSlice::init(unsafe { &*vm_ptr }, frame.arguments());
        slice.will_be_async = true;
        let args = args::Cp::from_js(global, &mut slice)?;
        if global.has_exception() {
            args.deinit();
            return Ok(JSValue::ZERO);
        }
        drop(slice);
        // SAFETY: sole `&mut VirtualMachine` borrow at this point.
        Ok(fs::AsyncCpTask::create(global, this, args, unsafe { &mut *vm_ptr }))
    };

    /// `callAsync(.readdir)` — recursive readdir gets its own task type.
    #[allow(non_upper_case_globals)]
    pub const readdir: NodeFSFunction = |this, global, frame| {
        let vm_ptr = global.bun_vm();
        // SAFETY: `bun_vm()` returns the live JS-thread VM.
        let mut slice = ArgumentsSlice::init(unsafe { &*vm_ptr }, frame.arguments());
        slice.will_be_async = true;
        let args = args::Readdir::from_js(global, &mut slice)?;
        if global.has_exception() {
            args.deinit();
            return Ok(JSValue::ZERO);
        }
        drop(slice);
        // SAFETY: sole `&mut VirtualMachine` borrow at this point.
        let vm = unsafe { &mut *vm_ptr };
        if args.recursive {
            return Ok(fs::AsyncReaddirRecursiveTask::create(global, args, vm));
        }
        Ok(async_::Readdir::create(global, this, args, vm))
    };

    /// `callSync(.watch)` — `Arguments` borrows from `global` and is consumed
    /// by value, so it can't go through `run_sync!`.
    #[allow(non_upper_case_globals)]
    pub const watch: NodeFSFunction = |this, global, frame| {
        // SAFETY: `bun_vm()` returns the live JS-thread VM.
        let vm = unsafe { &*global.bun_vm() };
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());
        let args = fs::Watcher::Arguments::from_js(global, &mut slice)?;
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        match this.node_fs.watch(args, fs::Flavor::Sync) {
            Err(err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    };

    /// `callSync(.watchFile)`.
    #[allow(non_upper_case_globals)]
    pub const watch_file: NodeFSFunction = |this, global, frame| {
        // SAFETY: `bun_vm()` returns the live JS-thread VM.
        let vm = unsafe { &*global.bun_vm() };
        let mut slice = ArgumentsSlice::init(vm, frame.arguments());
        let args = fs::StatWatcher::Arguments::from_js(global, &mut slice)?;
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        match this.node_fs.watch_file(args, fs::Flavor::Sync) {
            Err(err) => Err(global.throw_value(err.to_js(global))),
            Ok(res) => Ok(res),
        }
    };

    /// `callSync(.unwatchFile)` — `Arguments == void`.
    #[allow(non_upper_case_globals)]
    pub const unwatch_file: NodeFSFunction = |this, global, _frame| {
        match this.node_fs.unwatch_file(&(), fs::Flavor::Sync) {
            Err(err) => Err(global.throw_value(err.to_js(global))),
            Ok(()) => Ok(JSValue::UNDEFINED),
        }
    };
}

pub fn create_binding(global: &JSGlobalObject) -> JSValue {
    let mut module = Binding::new(Binding::default());

    let vm = global.bun_vm();
    module.node_fs.vm = NonNull::new(vm);

    // SAFETY: `module` is the freshly-boxed payload; ownership transfers to the
    // GC wrapper (freed via `Binding::finalize`).
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
        return Err(global.throw(format_args!("memfd_create is not implemented on this platform")));
    }

    #[cfg(target_os = "linux")]
    {
        let size = arguments.ptr[0].to_int64();
        match bun_sys::memfd_create(c"my_memfd", bun_sys::MemfdFlags::NonExecutable) {
            Ok(fd) => {
                let _ = bun_sys::ftruncate(fd, size);
                Ok(JSValue::js_number(fd.native() as f64))
            }
            Err(err) => Err(global.throw_value(err.to_js(global))),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_fs_binding.zig (240 lines)
//   confidence: high
//   todos:      0
//   notes:      `Bindings(comptime fn_name)` reflection lowered onto two
//               macros (`run_sync!`/`run_async!`) over the existing
//               `fs::{args, async_, FsArgument, FsReturn}` machinery — no
//               separate `ops::*` marker types needed. `cp`/`readdir`/`watch*`
//               are hand-written (the Zig comptime `switch` arms).
// ──────────────────────────────────────────────────────────────────────────
