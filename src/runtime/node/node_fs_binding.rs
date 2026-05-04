use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::call_frame::ArgumentsSlice;
use bun_runtime::node::fs::{self, NodeFS};

/// Signature of every generated NodeFS host function.
pub type NodeFSFunction =
    fn(this: &mut Binding, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>;

// Zig: `const NodeFSFunctionEnum = std.meta.DeclEnum(node.fs.NodeFS);`
// TODO(port): `DeclEnum` reflects every `pub fn` on `NodeFS` into an enum tag.
// In Rust this is expressed as a trait implemented per operation (see `NodeFsOp`
// below) rather than a runtime enum; the `node_fs_bindings!` macro at the
// bottom of this file enumerates the operations explicitly.

/// Compile-time descriptor of a single `NodeFS` operation.
///
/// Replaces the Zig `@field(NodeFS, @tagName(function_name))` + `@typeInfo`
/// reflection in `Bindings()`. Each operation (access, readFile, …) implements
/// this trait, supplying its `Arguments` type and dispatch fn.
// TODO(port): proc-macro — generate `impl NodeFsOp for ops::Access { ... }` for
// every `pub fn` on `NodeFS` (the `host_fn` reflection pattern).
pub trait NodeFsOp {
    /// `fn_info.params[1].type.?` in the Zig.
    type Arguments: FsArguments;
    /// Return payload of `function(&this.node_fs, args, .sync)` — what
    /// `globalObject.toJS(&result)` is called on in the Zig.
    type Output;
    /// `@field(node.fs.Async, @tagName(function_name))`
    type Task: FsAsyncTask<Self::Arguments>;

    /// `@hasField(Arguments, "signal")`
    const HAS_ABORT_SIGNAL: bool;
    /// `comptime function_name == .cp`
    const IS_CP: bool = false;
    /// `comptime function_name == .readdir`
    const IS_READDIR: bool = false;

    /// `function(&this.node_fs, args, flavor)` — the underlying NodeFS method.
    fn call(
        node_fs: &mut NodeFS,
        args: Self::Arguments,
        flavor: fs::Flavor,
    ) -> bun_sys::Result<Self::Output>;
}

/// Trait over the per-op `Arguments` struct (was `@hasDecl(Arguments, "deinit")`
/// + `Arguments.fromJS`). `()` impls this with all no-ops for the
/// `Arguments == void` arms.
pub trait FsArguments: Sized {
    fn from_js(global: &JSGlobalObject, slice: &mut ArgumentsSlice) -> JsResult<Self>;
    /// `args.signal` — only meaningful when `HAS_ABORT_SIGNAL`.
    fn signal(&self) -> Option<&bun_runtime::webcore::AbortSignal> {
        None
    }
    /// `args.recursive` — only meaningful for `readdir`.
    fn recursive(&self) -> bool {
        false
    }
    // `deinit` → `Drop`; no explicit method.
}

/// `@field(node.fs.Async, @tagName(function_name))` task type.
pub trait FsAsyncTask<A> {
    fn create(
        global: &JSGlobalObject,
        binding: &mut Binding,
        args: A,
        vm: &bun_jsc::VirtualMachine,
    ) -> JsResult<JSValue>;
    /// Only the `.cp` task takes ownership of the arena.
    fn create_with_arena(
        global: &JSGlobalObject,
        binding: &mut Binding,
        args: A,
        vm: &bun_jsc::VirtualMachine,
        arena: bun_alloc::Arena,
    ) -> JsResult<JSValue>;
}

/// Returns bindings to call jsc.Node.fs.NodeFS.<function>.
/// Async calls use a thread pool.
// Zig: `fn Bindings(comptime function_name: NodeFSFunctionEnum) type { return struct { ... } }`
pub struct Bindings<Op: NodeFsOp>(core::marker::PhantomData<Op>);

impl<Op: NodeFsOp> Bindings<Op> {
    // PORT NOTE: no `#[bun_jsc::host_fn(method)]` — `Self` here is `Bindings<Op>`,
    // not the `m_ctx` payload `Binding`, so the macro's downcast shim would be
    // wrong. These coerce directly to `NodeFSFunction`; the codegen-side host
    // shim is wired by `#[bun_jsc::JsClass]` on `Binding`.
    pub fn run_sync(
        this: &mut Binding,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut slice = ArgumentsSlice::init(global.bun_vm(), frame.arguments());
        // `defer slice.deinit()` → Drop

        let args = Op::Arguments::from_js(global, &mut slice)?;
        // `defer if (@hasDecl(Arguments, "deinit")) args.deinit()` → Drop

        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }

        let mut result = Op::call(&mut this.node_fs, args, fs::Flavor::Sync);
        match result {
            bun_sys::Result::Err(err) => global.throw_value(err.to_js(global)?),
            bun_sys::Result::Ok(ref mut res) => global.to_js(res),
        }
    }

    pub fn run_async(
        this: &mut Binding,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut slice = core::mem::ManuallyDrop::new(
            ArgumentsSlice::init(global.bun_vm(), frame.arguments()),
        );
        slice.will_be_async = true;

        // Zig uses a `deinit: bool` flag + conditional `defer` to keep `slice`
        // alive past return when ownership transfers to the Task.
        // PORT NOTE: `slice` is `ManuallyDrop` and only dropped on the
        // early-return error/abort branches (mirrors Zig's `deinit = true`).
        // On the success paths the Task takes ownership of `args` (and, for
        // `.cp`, the arena) and `slice` is intentionally leaked here — its
        // backing storage is freed when the Task completes.

        let args = match Op::Arguments::from_js(global, &mut slice) {
            Ok(a) => a,
            Err(err) => {
                // deinit = true;
                // SAFETY: not yet dropped; only drop site for this path.
                unsafe { core::mem::ManuallyDrop::drop(&mut slice) };
                return Err(err);
            }
        };

        if global.has_exception() {
            // deinit = true;
            drop(args);
            // SAFETY: not yet dropped; only drop site for this path.
            unsafe { core::mem::ManuallyDrop::drop(&mut slice) };
            return Ok(JSValue::ZERO);
        }

        if Op::HAS_ABORT_SIGNAL {
            'check_early_abort: {
                let Some(signal) = args.signal() else {
                    break 'check_early_abort;
                };
                if let Some(reason) = signal.reason_if_aborted(global) {
                    // deinit = true;
                    let promise =
                        bun_jsc::JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global,
                            reason.to_js(global),
                        );
                    drop(args);
                    // SAFETY: not yet dropped; only drop site for this path.
                    unsafe { core::mem::ManuallyDrop::drop(&mut slice) };
                    return Ok(promise);
                }
            }
        }

        // `switch (comptime function_name)`
        if Op::IS_CP {
            // SAFETY: `slice` is not used after this point; arena ownership
            // moves into the Task.
            let arena = unsafe { core::ptr::read(&slice.arena) };
            return Op::Task::create_with_arena(global, this, args, global.bun_vm(), arena);
        }
        if Op::IS_READDIR && args.recursive() {
            return fs::AsyncReaddirRecursiveTask::create(global, args, global.bun_vm());
        }
        Op::Task::create(global, this, args, global.bun_vm())
    }
}

// Zig: `fn callAsync(comptime FunctionEnum) NodeFSFunction { return Bindings(FunctionEnum).runAsync; }`
// In Rust the fn-pointer is taken directly at the binding site; these aliases
// exist to keep the diff readable.
#[inline(always)]
const fn call_async<Op: NodeFsOp>() -> NodeFSFunction {
    Bindings::<Op>::run_async
}
#[inline(always)]
const fn call_sync<Op: NodeFsOp>() -> NodeFSFunction {
    Bindings::<Op>::run_sync
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
            if core::ptr::eq(vm.node_fs(), &this_ref.node_fs) {
                return;
            }
        }

        // SAFETY: `this` was allocated via `Binding::new` (Box::new) and is
        // not the VM-owned singleton (checked above); reclaim it.
        drop(unsafe { Box::from_raw(this) });
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_dirent(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(bun_runtime::node::Dirent::get_constructor(global))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stats(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(bun_runtime::node::StatsSmall::get_constructor(global))
    }
}

/// Generates `pub const <name>: NodeFSFunction = call_{async,sync}::<ops::<Op>>();`
/// for every NodeFS operation. Mirrors the long block of
/// `pub const access = callAsync(.access);` lines in the Zig.
// TODO(port): proc-macro — the `ops::*` marker types and their `NodeFsOp` impls
// are generated from `NodeFS`'s method list (was `std.meta.DeclEnum`).
macro_rules! node_fs_bindings {
    ( $( $kind:ident $name:ident => $op:ident ; )* ) => {
        impl Binding {
            $( pub const $name: NodeFSFunction = node_fs_bindings!(@call $kind $op); )*
        }
    };
    (@call async $op:ident) => { call_async::<fs::ops::$op>() };
    (@call sync  $op:ident) => { call_sync::<fs::ops::$op>() };
}

#[rustfmt::skip]
node_fs_bindings! {
    async access            => Access;
    async append_file       => AppendFile;
    async close             => Close;
    async copy_file         => CopyFile;
    async cp                => Cp;
    async exists            => Exists;
    async chown             => Chown;
    async chmod             => Chmod;
    async fchmod            => Fchmod;
    async fchown            => Fchown;
    async fstat             => Fstat;
    async fsync             => Fsync;
    async ftruncate         => Ftruncate;
    async futimes           => Futimes;
    async lchmod            => Lchmod;
    async lchown            => Lchown;
    async link              => Link;
    async lstat             => Lstat;
    async mkdir             => Mkdir;
    async mkdtemp           => Mkdtemp;
    async open              => Open;
    async read              => Read;
    async write             => Write;
    async readdir           => Readdir;
    async read_file         => ReadFile;
    async write_file        => WriteFile;
    async readlink          => Readlink;
    async rm                => Rm;
    async rmdir             => Rmdir;
    async realpath          => RealpathNonNative;
    async realpath_native   => Realpath;
    async rename            => Rename;
    async stat              => Stat;
    async statfs            => Statfs;
    async symlink           => Symlink;
    async truncate          => Truncate;
    async unlink            => Unlink;
    async utimes            => Utimes;
    async lutimes           => Lutimes;
    sync  access_sync       => Access;
    sync  append_file_sync  => AppendFile;
    sync  close_sync        => Close;
    sync  cp_sync           => Cp;
    sync  copy_file_sync    => CopyFile;
    sync  exists_sync       => Exists;
    sync  chown_sync        => Chown;
    sync  chmod_sync        => Chmod;
    sync  fchmod_sync       => Fchmod;
    sync  fchown_sync       => Fchown;
    sync  fstat_sync        => Fstat;
    sync  fsync_sync        => Fsync;
    sync  ftruncate_sync    => Ftruncate;
    sync  futimes_sync      => Futimes;
    sync  lchmod_sync       => Lchmod;
    sync  lchown_sync       => Lchown;
    sync  link_sync         => Link;
    sync  lstat_sync        => Lstat;
    sync  mkdir_sync        => Mkdir;
    sync  mkdtemp_sync      => Mkdtemp;
    sync  open_sync         => Open;
    sync  read_sync         => Read;
    sync  write_sync        => Write;
    sync  readdir_sync      => Readdir;
    sync  read_file_sync    => ReadFile;
    sync  write_file_sync   => WriteFile;
    sync  readlink_sync     => Readlink;
    sync  realpath_sync     => RealpathNonNative;
    sync  realpath_native_sync => Realpath;
    sync  rename_sync       => Rename;
    sync  stat_sync         => Stat;
    sync  statfs_sync       => Statfs;
    sync  symlink_sync      => Symlink;
    sync  truncate_sync     => Truncate;
    sync  unlink_sync       => Unlink;
    sync  utimes_sync       => Utimes;
    sync  lutimes_sync      => Lutimes;
    sync  rm_sync           => Rm;
    sync  rmdir_sync        => Rmdir;
    async writev            => Writev;
    sync  writev_sync       => Writev;
    async readv             => Readv;
    sync  readv_sync        => Readv;
    sync  fdatasync_sync    => Fdatasync;
    async fdatasync         => Fdatasync;
    sync  watch             => Watch;
    sync  watch_file        => WatchFile;
    sync  unwatch_file      => UnwatchFile;
    // pub const statfs = callAsync(.statfs);
    // pub const statfsSync = callSync(.statfs);
}

pub fn create_binding(global: &JSGlobalObject) -> JSValue {
    let mut module = Binding::new(Binding::default());

    let vm = global.bun_vm();
    module.node_fs.vm = Some(vm);

    module.to_js(global)
}

#[bun_jsc::host_fn]
pub fn create_memfd_for_testing(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments_old(1);

    if arguments.len() < 1 {
        return Ok(JSValue::UNDEFINED);
    }

    #[cfg(not(target_os = "linux"))]
    {
        return global.throw("memfd_create is not implemented on this platform", format_args!(""));
    }

    #[cfg(target_os = "linux")]
    {
        let size = arguments.ptr[0].to_int64();
        match bun_sys::memfd_create(b"my_memfd", bun_sys::MemfdFlags::NonExecutable) {
            bun_sys::Result::Ok(fd) => {
                let _ = bun_sys::ftruncate(fd, size);
                Ok(JSValue::js_number(fd.cast()))
            }
            bun_sys::Result::Err(err) => {
                global.throw_value(err.to_js(global)?)
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_fs_binding.zig (240 lines)
//   confidence: medium
//   todos:      3
//   notes:      heavy comptime reflection (@typeInfo/@field/DeclEnum) replaced by NodeFsOp trait + macro; ops::* marker types need proc-macro generation in Phase B; run_async uses ManuallyDrop to mirror Zig's conditional `slice.deinit()`
// ──────────────────────────────────────────────────────────────────────────
