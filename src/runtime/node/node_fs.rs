// This file contains the underlying implementation for sync & async functions
// for interacting with the filesystem from JavaScript.
// The top-level functions assume the arguments are already validated

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem::offset_of;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use bun_aio::KeepAlive;
use bun_sys::FdExt as _;
use bun_sys_jsc::ErrorJsc as _;
use bun_jsc::EventLoopTaskPtr;
use crate::api::bun::process::event_loop_handle_to_ctx;
use bun_threading::UnboundedQueue;
use bun_core::Environment;
use bun_jsc::{
    CallFrame, EventLoopHandle, JSGlobalObject, JSPromise, JSValue, JsError,
    JsResult, Task,
};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::AbortSignal;
use bun_jsc::debugger::AsyncTaskTracker;
use bun_event_loop::ConcurrentTask::ConcurrentTask as ConcurrentTaskItem;
use bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use bun_event_loop::MiniEventLoop::MiniEventLoop;
use bun_paths::{self as paths, OSPathBuffer, OSPathChar, OSPathSliceZ, PathBuffer};
use bun_string::{self as bstr, strings, String as BunString, ZStr, PathString, ZigString};
use bun_sys::{self as sys, Fd as FD, Maybe, Mode, SystemErrno, E};
use bun_threading::work_pool::{WorkPool, Task as WorkPoolTask};
use crate::webcore;

// Local namespace shim: dependents in this file spell `ConcurrentTask::create*`
// (the Zig spelling). The Rust crate exports the *struct* as `ConcurrentTask`
// inside a same-named module, so re-export the free constructors here under the
// module name the call sites expect.
mod ConcurrentTask {
    pub use bun_event_loop::ConcurrentTask::ConcurrentTask;
    #[inline] pub fn create(task: bun_jsc::Task) -> *mut ConcurrentTask { ConcurrentTask::create(task) }
    #[inline] pub fn create_from<T>(task: T) -> *mut ConcurrentTask { ConcurrentTask::create_from(task) }
    #[inline] pub fn from_callback<T>(
        ptr: *mut T,
        cb: fn(*mut T) -> core::result::Result<(), *mut ()>,
    ) -> *mut ConcurrentTask {
        ConcurrentTask::from_callback(ptr, cb)
    }
}

/// `webcore.Blob.SizeType` — Zig is `u52` (src/runtime/webcore/Blob.zig:60).
/// Rust has no native `u52`, so the *storage* width is `u64`, but **never** use
/// `BlobSizeType::MAX` to mean the spec maximum — that yields `u64::MAX`, which
/// wraps to `-1` under `as i64` and silently breaks every bounds check that the
/// Zig spec wrote as `std.math.maxInt(jsc.WebCore.Blob.SizeType)`. Use
/// [`BLOB_SIZE_MAX`] instead.
type BlobSizeType = u64;
/// `std.math.maxInt(jsc.WebCore.Blob.SizeType)` == `maxInt(u52)` == 2^52 - 1.
const BLOB_SIZE_MAX: u64 = (1u64 << 52) - 1;

/// `webcore.RefPtr<AbortSignal>` — JSC's intrusive ref-counted pointer. Zig
/// stored this as `?*AbortSignal` and called `.ref()`/`.unref()` manually; the
/// generic `bun_ptr::RefPtr<T>` requires `T: AnyRefCounted` which `AbortSignal`
/// (an opaque FFI struct) does not implement, so model it as the raw pointer
/// shape and keep the manual ref-counting at the call sites (matches the .zig).
type AbortSignalRef = NonNull<AbortSignal>;

// PORT NOTE: Zig referenced these via `bun.api.node.*`. The Phase-A draft
// pulled them through `bun_jsc::node` (a re-export shim that no longer exists
// once `node.rs` owns the module tree). Round 2 wires them to the real
// sibling modules under `super::` so this file compiles standalone.
use super::stat::Stats;
use super::time_like::TimeLike;
use super::types::{
    ArgumentsSlice, Dirent, Encoding, FileSystemFlags, PathLike, StringOrBuffer,
    VectorArrayBuffer,
};
// Re-exported publicly: `crate::node::fs::PathOrFileDescriptor` is the
// canonical path used by `cli/build_command.rs` et al. (mirrors Zig's
// `bun.api.node.fs.PathOrFileDescriptor`).
pub use super::types::PathOrFileDescriptor;

/// Local alias for the many `node::foo` call sites below — keeps the diff
/// against `node_fs.zig` readable while routing to `super::*`.
mod node {
    pub use super::super::types::{Buffer, SliceWithUnderlyingString};
    pub use super::super::statfs::StatFS;
    pub use super::super::time_like::from_js as time_like_from_js;
    pub use super::super::{gid_t, uid_t};

    /// `node::mode_from_js` — forwards to the real impl in
    /// `super::types::mode_from_js` (now un-gated). Kept as a thin alias so
    /// the dozens of call sites in `args::*::from_js` keep spelling
    /// `node::mode_from_js` like the .zig source.
    #[inline]
    pub fn mode_from_js(
        ctx: &bun_jsc::JSGlobalObject,
        value: bun_jsc::JSValue,
    ) -> bun_jsc::JsResult<Option<bun_sys::Mode>> {
        super::super::types::mode_from_js(ctx, value)
    }
}

// `validators::*` — `super::util::validators` is a `pub use` of a
// crate-private module, which trips E0365 if we `pub use` it again. Import it
// privately at file scope instead and call as `validators::foo` directly.
use super::util::validators;
use super::MaybeTodo as _;

// Trait imports for inherent-looking method calls on upstream types:
//   - `bun_sys::FdExt`       → `Fd::close()`
//   - `super::types::FdJsc`  → `Fd::from_js_validated()`
//   - `bun_jsc::SysErrorJsc` → `bun_sys::Error::to_js()`
#[allow(unused_imports)]
use bun_sys::FdExt as _;
#[allow(unused_imports)]
use super::types::FdJsc as _;
#[allow(unused_imports)]
use bun_jsc::SysErrorJsc as _;

/// Local extension shim: `bun_sys::Error::to_js_with_async_stack` lives in the
/// `bun_sys_jsc` crate (`ErrorJsc` trait), which is not yet a dependency of
/// `bun_runtime`. Forward to the synchronous `SysErrorJsc::to_js` for now —
/// the async-stack enrichment is a debug nicety, not load-bearing.
// TODO(b2-blocked): swap to `use bun_sys_jsc::ErrorJsc as _;` once it is a dep.
pub(super) trait SysErrorAsyncJsc {
    fn to_js_with_async_stack(
        &self,
        global: &JSGlobalObject,
        _promise: &bun_jsc::JSPromise,
    ) -> JsResult<JSValue>;
    /// Zig `Error.deinit()` — Rust `bun_sys::Error` frees on `Drop`; no-op shim
    /// kept so the Zig-shaped call sites (`err.deinit()`) compile unchanged.
    fn deinit(&mut self) {}
}
impl SysErrorAsyncJsc for bun_sys::Error {
    fn to_js_with_async_stack(
        &self,
        global: &JSGlobalObject,
        _promise: &bun_jsc::JSPromise,
    ) -> JsResult<JSValue> {
        Ok(bun_jsc::SysErrorJsc::to_js(self, global))
    }
}

/// Local extension shim: `JSValue::get_boolean_strict` (Zig
/// `getBooleanStrict`) is not yet on the upstream `bun_jsc::JSValue`. Mirrors
/// the spec: missing/undefined → `None`; non-boolean → throw
/// `ERR_INVALID_ARG_TYPE`; boolean → `Some(v)`.
pub(super) trait JSValueBooleanStrict: Sized {
    fn get_boolean_strict(
        self,
        global: &JSGlobalObject,
        property: &'static str,
    ) -> JsResult<Option<bool>>;
}
impl JSValueBooleanStrict for JSValue {
    fn get_boolean_strict(
        self,
        global: &JSGlobalObject,
        property: &'static str,
    ) -> JsResult<Option<bool>> {
        let Some(v) = self.get(global, property)? else { return Ok(None) };
        if v.is_undefined() { return Ok(None); }
        if !v.is_boolean() {
            return Err(validators::throw_err_invalid_arg_type(
                global,
                format_args!("options.{}", property),
                "boolean",
                v,
            ));
        }
        Ok(Some(v.to_boolean()))
    }
}

pub use super::node_fs_constant as constants;
// node_fs_watcher / node_fs_stat_watcher are JSC-bound and not yet declared in
// `node.rs`. Their `Arguments` structs are needed by `args::Watch` /
// `args::WatchFile` and the `watch()` / `watch_file()` bodies below, so we
// provide minimal local stand-ins that mirror the real shapes from
// `node_fs_watcher.rs` / `node_fs_stat_watcher.rs`. Swap to
// `pub use super::node_fs_watcher::FSWatcher as Watcher;` /
// `pub use super::node_fs_stat_watcher::StatWatcher;` once the parent
// `node.rs` wires those `#[path = ...]` modules.
#[allow(non_snake_case)]
pub mod Watcher {
    use super::{JSGlobalObject, JSValue, Maybe, PathLike};
    /// Stand-in for `node_fs_watcher::FSWatcher` — only the field read by
    /// [`NodeFS::watch`] (`js_this`) is modeled.
    pub struct FSWatcher {
        pub js_this: JSValue,
    }
    /// Stand-in for `node_fs_watcher::Arguments` — see real struct at
    /// `src/runtime/node/node_fs_watcher.rs`.
    pub struct Arguments {
        pub path: PathLike,
        pub global_this: *const JSGlobalObject,
    }
    impl Arguments {
        pub fn create_fs_watcher(&self) -> Maybe<FSWatcher> {
            todo!("blocked_on: super::node_fs_watcher (module not declared in node.rs)")
        }
    }
}
#[allow(non_snake_case)]
pub mod StatWatcher {
    use super::{JSGlobalObject, JSValue, PathLike};
    /// Stand-in for `node_fs_stat_watcher::Arguments` — see real struct at
    /// `src/runtime/node/node_fs_stat_watcher.rs`.
    pub struct Arguments {
        pub path: PathLike,
        pub global_this: &'static JSGlobalObject,
    }
    impl Arguments {
        pub fn create_stat_watcher(&self) -> Result<JSValue, bun_core::Error> {
            todo!("blocked_on: super::node_fs_stat_watcher (module not declared in node.rs)")
        }
    }
}

// PORT NOTE: `Binding` is `super::node_fs_binding::Binding` in Zig, but that
// module is not yet wired into `node.rs`. The async `create()` entry points
// only thread it through as an unused `_binding: &mut Binding` (the JSC class
// instance that owns the per-thread `NodeFS`). Forward-declare an opaque type
// here so the signatures stay source-compatible; swap to the real re-export
// once `node_fs_binding` is declared.
#[repr(C)]
pub struct Binding {
    _opaque: [u8; 0],
}

/// `jsc.JSPromise.Strong` — re-exported under its Rust crate name. The Zig
/// source spells this `JSPromise.Strong` (a nested decl), which Rust models as
/// `bun_jsc::js_promise::Strong` / the `JSPromiseStrong` alias.
use bun_jsc::JSPromiseStrong;

use super::dir_iterator as DirIterator;
use bun_resolver::fs::FileSystem;

#[cfg(windows)]
use bun_sys::windows::{self, libuv as uv};
/// On POSIX the libuv-backed code paths (`UVFSRequest`, `uv_fs_*`) are dead
/// branches kept for source parity with `node_fs.zig`. `bun_sys` only exports
/// the libuv shim on Windows, so we provide a minimal type-only stub here so
/// the cross-platform signatures (`uv::fs_t`, `uv::Loop`) type-check. Every
/// body that actually *calls* into uv on POSIX is already `#[cfg(windows)]`.
#[cfg(not(windows))]
mod uv {
    #[repr(C)]
    pub struct fs_t { _opaque: [u8; 0] }
    impl fs_t {
        pub const UNINITIALIZED: fs_t = fs_t { _opaque: [] };
        pub fn deinit(&mut self) {}
        pub unsafe fn ptr_as<T>(&self) -> *const T { core::ptr::null() }
    }
    pub struct Loop;
    impl Loop { pub fn get() -> *mut Loop { core::ptr::null_mut() } }
    pub unsafe fn uv_fs_req_cleanup(_req: *mut fs_t) {}
}

// Syscall = bun.sys.sys_uv on Windows, bun.sys otherwise
#[cfg(windows)]
use bun_sys::sys_uv as Syscall;
#[cfg(not(windows))]
use bun_sys as Syscall;

// ──────────────────────────────────────────────────────────────────────────
// Local cross-crate shims
//
// These wrap symbols whose canonical home moved (or hasn't been wired into
// `bun_sys`/`bun_core` yet) so the hundreds of call sites below — which
// mirror `node_fs.zig` 1:1 — don't have to be rewritten per-line. Each is a
// thin forwarder; bodies that are genuinely missing upstream are `todo!` with
// a `blocked_on:` tag.
// ──────────────────────────────────────────────────────────────────────────

/// `bun.strings.withoutNTPrefix` — lives in `bun_string::strings::paths`
/// under the Rust crate split, not at the `strings` root.
#[inline]
fn without_nt_prefix<T: bun_string::strings::paths::Ch>(path: &[T]) -> &[T] {
    bun_string::strings::paths::without_nt_prefix(path)
}

/// `bun.paths.OSPathLiteral("")` — Zig comptime string→`[:0]const OSPathChar`.
/// Only the empty-string case is used in this file. `OSPathSliceZ` is a DST
/// (`ZStr`/`WStr`), so callers borrow it.
#[inline]
fn os_path_literal_empty() -> &'static OSPathSliceZ {
    #[cfg(windows)]
    { static EMPTY: [u16; 1] = [0]; unsafe { core::mem::transmute::<&[u16], &OSPathSliceZ>(&EMPTY[..0]) } }
    #[cfg(not(windows))]
    { ZStr::from_bytes_with_nul(b"\0") }
}

/// `bun.StandaloneModuleGraph::get()` — singleton accessor. The graph type
/// lives in the `bun_standalone_graph` crate which is not a dependency of
/// `bun_runtime` (it sits above us in the link order). The Zig source only
/// uses it to short-circuit `stat`/`exists`/`readFile` for embedded files in
/// compiled binaries; returning `None` here is the correct behaviour for the
/// non-standalone case and keeps the rest of the body live.
#[inline]
fn standalone_module_graph_get() -> Option<&'static StandaloneModuleGraphStub> { None }
struct StandaloneModuleGraphStub;
impl StandaloneModuleGraphStub {
    fn find(&self, _: &[u8]) -> Option<()> { None }
    fn stat(&self, _: &ZStr) -> Option<sys::Stat> { None }
}

/// `bun.getTotalMemorySize()` — Zig (bun.zig:3498) forwards to the linked C++
/// `Bun__ramSize()` (src/jsc/bindings/c-bindings.cpp), which is cgroup/jetsam
/// aware. PORTING.md §Forbidden: never hand-roll a Rust equivalent for linked
/// C/C++ — declare the extern and forward.
#[inline]
fn get_total_memory_size() -> u64 {
    unsafe extern "C" {
        fn Bun__ramSize() -> usize;
    }
    // SAFETY: FFI into bun's C++ bindings; no invariants required.
    unsafe { Bun__ramSize() as u64 }
}

/// `bun.sys.PosixStat` — uv-shaped stat struct. `Stats::init` (from
/// `super::stat`) takes its sibling `PosixStat` by reference, so route through
/// that definition rather than `bun_sys::PosixStat` to keep the parameter
/// type exact. Both are `#[repr(C)]` mirrors of `uv_stat_t`; once
/// `super::stat` swaps to `pub use bun_sys::PosixStat` this alias collapses.
use super::stat::PosixStat;

/// Node `fs.rm` mapping helper — `bun_core::err!("Name")` produces a
/// `bun_core::Error` from a static error-set name; the *reverse* (name →
/// `Error` for return) needs the same constructor. The macro caches per
/// *call site*, but `dt_err` feeds a runtime-selected name from a `match`,
/// so route through the underlying `Error::intern` (process-global string→u16
/// table; idempotent, lock-free after first hit on the SEED set).
#[inline]
fn err_from_static(name: &'static str) -> bun_core::Error {
    bun_core::Error::intern(name)
}

/// `bun.sys.preallocate_supported` / `preallocate_length` — the Zig consts
/// were dropped in the lib.rs port (only `preallocate_file()` remains). Mirror
/// the original values from `sys.zig` so the write-file fast path keeps its
/// guard. 2 MiB matches `node_fs.zig`'s threshold.
const PREALLOCATE_SUPPORTED: bool = cfg!(target_os = "linux");
const PREALLOCATE_LENGTH: usize = 2048 * 1024;

/// `PathString.PathInt` — Zig packed-struct field width. `bun_string::PathString`
/// stores it as `u32` on the Rust side (see `PathString.rs` POINTER_BITS).
type PathInt = u32;

/// `Syscall.mkdirOSPath` / `Syscall.openatOSPath` — on POSIX `OSPathSliceZ` is
/// `&ZStr`, so these are pure forwarders to the byte-path entry points. On
/// Windows they would route through `sys_uv` (handled by `#[cfg(windows)]`
/// branches at the call sites).
#[cfg(not(windows))]
#[inline]
fn mkdir_os_path(path: &OSPathSliceZ, mode: Mode) -> Maybe<()> {
    Syscall::mkdir(path, mode)
}
#[cfg(not(windows))]
#[inline]
fn openat_os_path(dirfd: FD, path: &OSPathSliceZ, flags: i32, mode: Mode) -> Maybe<FD> {
    Syscall::openat(dirfd, path, flags, mode)
}
#[cfg(windows)]
#[inline]
fn mkdir_os_path(path: &OSPathSliceZ, mode: Mode) -> Maybe<()> { Syscall::mkdir_os_path(path, mode) }
#[cfg(windows)]
#[inline]
fn openat_os_path(dirfd: FD, path: &OSPathSliceZ, flags: i32, mode: Mode) -> Maybe<FD> {
    Syscall::openat_os_path(dirfd, path, flags, mode)
}

type ReadPosition = i64;
type Buffer = super::types::Buffer;
type ArrayBuffer = bun_jsc::MarkedArrayBuffer;
type GidT = node::gid_t;
type UidT = node::uid_t;

#[cfg(unix)]
pub const DEFAULT_PERMISSION: Mode = sys::S::IRUSR
    | sys::S::IWUSR
    | sys::S::IRGRP
    | sys::S::IWGRP
    | sys::S::IROTH
    | sys::S::IWOTH;
#[cfg(not(unix))]
// Windows does not have permissions
pub const DEFAULT_PERMISSION: Mode = 0;

/// All async FS functions are run in a thread pool, but some implementations may
/// decide to do something slightly different. For example, reading a file has
/// an extra stack buffer in the async case.
#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum Flavor {
    Sync,
    Async,
}

// ──────────────────────────────────────────────────────────────────────────
// Async task type aliases
// ──────────────────────────────────────────────────────────────────────────
// AsyncFSTask / UVFSRequest / NewAsyncCpTask / AsyncReaddirRecursiveTask are
// the thread-pool wrappers that back every `fs.promises.*` call (and the shell
// `cp` builtin). Un-gated so the sync `impl NodeFS` body — which references
// `AsyncCpTask` / `AsyncReaddirRecursiveTask` directly — type-checks, and so
// `ShellAsyncCpTask` is visible to `crate::shell::builtins::cp`.
mod _async_tasks {
use super::*;

pub mod async_ {
    use super::*;

    pub type Access = AsyncFSTask<ret::Access, args::Access, { NodeFSFunctionEnum::Access }>;
    pub type AppendFile = AsyncFSTask<ret::AppendFile, args::AppendFile, { NodeFSFunctionEnum::AppendFile }>;
    pub type Chmod = AsyncFSTask<ret::Chmod, args::Chmod, { NodeFSFunctionEnum::Chmod }>;
    pub type Chown = AsyncFSTask<ret::Chown, args::Chown, { NodeFSFunctionEnum::Chown }>;
    pub type Close = UVFSRequest<ret::Close, args::Close, { NodeFSFunctionEnum::Close }>;
    pub type CopyFile = AsyncFSTask<ret::CopyFile, args::CopyFile, { NodeFSFunctionEnum::CopyFile }>;
    pub type Exists = AsyncFSTask<ret::Exists, args::Exists, { NodeFSFunctionEnum::Exists }>;
    pub type Fchmod = AsyncFSTask<ret::Fchmod, args::FChmod, { NodeFSFunctionEnum::Fchmod }>;
    pub type Fchown = AsyncFSTask<ret::Fchown, args::Fchown, { NodeFSFunctionEnum::Fchown }>;
    pub type Fdatasync = AsyncFSTask<ret::Fdatasync, args::FdataSync, { NodeFSFunctionEnum::Fdatasync }>;
    pub type Fstat = AsyncFSTask<ret::Fstat, args::Fstat, { NodeFSFunctionEnum::Fstat }>;
    pub type Fsync = AsyncFSTask<ret::Fsync, args::Fsync, { NodeFSFunctionEnum::Fsync }>;
    pub type Ftruncate = AsyncFSTask<ret::Ftruncate, args::FTruncate, { NodeFSFunctionEnum::Ftruncate }>;
    pub type Futimes = AsyncFSTask<ret::Futimes, args::Futimes, { NodeFSFunctionEnum::Futimes }>;
    pub type Lchmod = AsyncFSTask<ret::Lchmod, args::LCHmod, { NodeFSFunctionEnum::Lchmod }>;
    pub type Lchown = AsyncFSTask<ret::Lchown, args::LChown, { NodeFSFunctionEnum::Lchown }>;
    pub type Link = AsyncFSTask<ret::Link, args::Link, { NodeFSFunctionEnum::Link }>;
    pub type Lstat = AsyncFSTask<ret::Stat, args::Stat, { NodeFSFunctionEnum::Lstat }>;
    pub type Lutimes = AsyncFSTask<ret::Lutimes, args::Lutimes, { NodeFSFunctionEnum::Lutimes }>;
    pub type Mkdir = AsyncFSTask<ret::Mkdir, args::Mkdir, { NodeFSFunctionEnum::Mkdir }>;
    pub type Mkdtemp = AsyncFSTask<ret::Mkdtemp, args::MkdirTemp, { NodeFSFunctionEnum::Mkdtemp }>;
    pub type Open = UVFSRequest<ret::Open, args::Open, { NodeFSFunctionEnum::Open }>;
    pub type Read = UVFSRequest<ret::Read, args::Read, { NodeFSFunctionEnum::Read }>;
    pub type Readdir = AsyncFSTask<ret::Readdir, args::Readdir, { NodeFSFunctionEnum::Readdir }>;
    pub type ReadFile = AsyncFSTask<ret::ReadFile, args::ReadFile, { NodeFSFunctionEnum::ReadFile }>;
    pub type Readlink = AsyncFSTask<ret::Readlink, args::Readlink, { NodeFSFunctionEnum::Readlink }>;
    pub type Readv = UVFSRequest<ret::Readv, args::Readv, { NodeFSFunctionEnum::Readv }>;
    pub type Realpath = AsyncFSTask<ret::Realpath, args::Realpath, { NodeFSFunctionEnum::Realpath }>;
    pub type RealpathNonNative = AsyncFSTask<ret::Realpath, args::Realpath, { NodeFSFunctionEnum::RealpathNonNative }>;
    pub type Rename = AsyncFSTask<ret::Rename, args::Rename, { NodeFSFunctionEnum::Rename }>;
    pub type Rm = AsyncFSTask<ret::Rm, args::Rm, { NodeFSFunctionEnum::Rm }>;
    pub type Rmdir = AsyncFSTask<ret::Rmdir, args::RmDir, { NodeFSFunctionEnum::Rmdir }>;
    pub type Stat = AsyncFSTask<ret::Stat, args::Stat, { NodeFSFunctionEnum::Stat }>;
    pub type Symlink = AsyncFSTask<ret::Symlink, args::Symlink, { NodeFSFunctionEnum::Symlink }>;
    pub type Truncate = AsyncFSTask<ret::Truncate, args::Truncate, { NodeFSFunctionEnum::Truncate }>;
    pub type Unlink = AsyncFSTask<ret::Unlink, args::Unlink, { NodeFSFunctionEnum::Unlink }>;
    pub type Utimes = AsyncFSTask<ret::Utimes, args::Utimes, { NodeFSFunctionEnum::Utimes }>;
    pub type Write = UVFSRequest<ret::Write, args::Write, { NodeFSFunctionEnum::Write }>;
    pub type WriteFile = AsyncFSTask<ret::WriteFile, args::WriteFile, { NodeFSFunctionEnum::WriteFile }>;
    pub type Writev = UVFSRequest<ret::Writev, args::Writev, { NodeFSFunctionEnum::Writev }>;
    pub type Statfs = UVFSRequest<ret::StatFS, args::StatFS, { NodeFSFunctionEnum::Statfs }>;

    const _: () = assert!(ReadFile::HAVE_ABORT_SIGNAL);
    const _: () = assert!(WriteFile::HAVE_ABORT_SIGNAL);

    pub type Cp = AsyncCpTask;
    pub type ReaddirRecursive = AsyncReaddirRecursiveTask;

    /// Used internally. Not from JavaScript.
    pub struct AsyncMkdirp {
        pub completion_ctx: *mut (),
        pub completion: fn(*mut (), Maybe<()>),
        /// Memory is not owned by this struct
        pub path: *const [u8], // BORROW: not owned
        pub task: WorkPoolTask,
    }

    impl AsyncMkdirp {
        pub fn new(init: AsyncMkdirp) -> Box<Self> {
            Box::new(init)
        }

        pub fn work_pool_callback(task: *mut WorkPoolTask) {
            // SAFETY: task points to AsyncMkdirp.task
            let this: &mut AsyncMkdirp = unsafe {
                &mut *((task as *mut u8).sub(offset_of!(AsyncMkdirp, task)).cast::<AsyncMkdirp>())
            };

            let mut node_fs = NodeFS::default();
            // SAFETY: caller keeps `path` alive until completion
            let path = unsafe { &*this.path };
            let result = node_fs.mkdir_recursive(args::Mkdir {
                path: PathLike::String(PathString::init(path)),
                recursive: true,
                ..Default::default()
            });
            match result {
                Maybe::Err(err) => {
                    (this.completion)(
                        this.completion_ctx,
                        Maybe::Err(err.with_path(Box::<[u8]>::from(err.path()))),
                    );
                }
                Maybe::Ok(_) => {
                    (this.completion)(this.completion_ctx, Maybe::Ok(()));
                }
            }
        }

        pub fn schedule(&mut self) {
            WorkPool::schedule(&mut self.task);
        }
    }

    impl Default for AsyncMkdirp {
        fn default() -> Self {
            Self {
                completion_ctx: core::ptr::null_mut(),
                completion: |_, _| {},
                path: core::ptr::slice_from_raw_parts(core::ptr::null(), 0),
                task: WorkPoolTask { callback: Self::work_pool_callback, ..Default::default() },
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NewUVFSRequest — Windows-only async wrapper around libuv fs requests.
// On non-Windows it is just AsyncFSTask.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub type UVFSRequest<R, A, const F: NodeFSFunctionEnum> = AsyncFSTask<R, A, F>;

#[cfg(windows)]
pub struct UVFSRequest<R, A, const F: NodeFSFunctionEnum> {
    pub promise: JSPromiseStrong,
    pub args: A,
    pub global_object: *const JSGlobalObject,
    pub req: uv::fs_t,
    pub result: Maybe<R>,
    pub r#ref: KeepAlive,
    pub tracker: AsyncTaskTracker,
}

#[cfg(windows)]
impl<R, A: FsArgument, const F: NodeFSFunctionEnum> UVFSRequest<R, A, F> {
    // TODO(port): heap_label = "Async" ++ typeBaseName(A) ++ "UvTask" — needs proc-macro
    pub const HEAP_LABEL: &'static str = "AsyncUvTask";

    pub fn create(
        global_object: &JSGlobalObject,
        binding: &mut Binding,
        task_args: A,
        vm: &mut VirtualMachine,
    ) -> JSValue {
        let mut task = Box::new(Self {
            promise: JSPromiseStrong::init(global_object),
            args: task_args,
            // SAFETY: all-zero is a valid Maybe<R>; written before read
            result: unsafe { core::mem::zeroed() },
            global_object: global_object as *const _,
            // SAFETY: all-zero is a valid uv::fs_t (libuv POD)
            req: unsafe { core::mem::zeroed() },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker::init(vm),
        });
        task.r#ref.ref_(vm);
        task.args.to_thread_safe();
        task.tracker.did_schedule(global_object);

        let log = sys::syslog;
        let loop_ = uv::Loop::get();
        task.req.data = (&mut *task) as *mut Self as *mut c_void;

        // TODO(port): comptime switch on FunctionEnum dispatching to uv_fs_open/close/read/write/readv/writev/statfs.
        // The full body is mechanical libuv plumbing; preserved as a per-variant match below.
        match F {
            NodeFSFunctionEnum::Open => {
                // TODO(port): see node_fs.zig:161-174
            }
            NodeFSFunctionEnum::Close => {
                // TODO(port): see node_fs.zig:175-189
            }
            NodeFSFunctionEnum::Read => { /* TODO(port) */ }
            NodeFSFunctionEnum::Write => { /* TODO(port) */ }
            NodeFSFunctionEnum::Readv => { /* TODO(port) */ }
            NodeFSFunctionEnum::Writev => { /* TODO(port) */ }
            NodeFSFunctionEnum::Statfs => { /* TODO(port) */ }
            _ => unreachable!("UVFSRequest type not implemented"),
        }

        let _ = (log, loop_, binding);
        task.promise.value()
    }

    extern "C" fn uv_callback(req: *mut uv::fs_t) {
        // SAFETY: req.data was set to Box<Self> in create()
        let this: &mut Self = unsafe { &mut *((*req).data as *mut Self) };
        // SAFETY: req points to a live uv::fs_t passed by libuv; cleanup is the documented pair
        let _cleanup = scopeguard::guard((), |_| unsafe { uv::uv_fs_req_cleanup(req) });
        let mut node_fs = NodeFS::default();
        // TODO(port): dispatch to NodeFS::uv_<F>(&node_fs, this.args, req.result as i64)
        // SAFETY: req is the live libuv request passed to this callback
        this.result = NodeFS::uv_dispatch::<R, A, F>(&mut node_fs, &this.args, unsafe { (*req).result } as i64);
        if let Maybe::Err(err) = &mut this.result {
            *err = err.clone();
            core::hint::black_box(&node_fs);
        }
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        unsafe { &*this.global_object }.bun_vm().event_loop().enqueue_task(Task::init(this));
    }

    extern "C" fn uv_callbackreq(req: *mut uv::fs_t) {
        // Same as uv_callback but passes `req` to the dispatch fn (statfs needs req.ptr).
        // TODO(port): mirror node_fs.zig:276-288
        Self::uv_callback(req);
    }

    pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JsTerminated> {
        // SAFETY: self was Box::leak'd in create(); destroy() runs exactly once on scope exit
        let _deinit = scopeguard::guard(self as *mut Self, |p| unsafe { Self::destroy(p) });
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        let global_object = unsafe { &*self.global_object };
        let success = matches!(self.result, Maybe::Ok(_));
        let promise_value = self.promise.value();
        // SAFETY: sole `&mut JSPromise` borrow in this scope (resolver-style accessor).
        let promise = unsafe { self.promise.get() };
        let result = match &mut self.result {
            Maybe::Err(err) => match err.to_js_with_async_stack(global_object, promise) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
            Maybe::Ok(res) => match global_object.to_js(res) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
        };
        promise_value.ensure_still_alive();

        let tracker = self.tracker;
        tracker.will_dispatch(global_object);
        let _did = scopeguard::guard((), |_| tracker.did_dispatch(global_object));

        if success {
            promise.resolve(global_object, result)?;
        } else {
            promise.reject(global_object, Ok(result))?;
        }
        Ok(())
    }

    /// SAFETY: `this` must be the pointer Box::leak'd in `create()`; called exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live Box-leaked allocation
        let this_ref = unsafe { &mut *this };
        if let Maybe::Err(err) = &mut this_ref.result {
            err.deinit();
        }
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        this_ref.r#ref.unref(unsafe { &*this_ref.global_object }.bun_vm());
        this_ref.args.deinit_and_unprotect();
        this_ref.promise = JSPromiseStrong::default();
        // SAFETY: paired with Box::leak in create()
        drop(unsafe { Box::from_raw(this) });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NewAsyncFSTask — runs a NodeFS method on the thread pool.
// ──────────────────────────────────────────────────────────────────────────

/// Trait abstracting over Argument types' deinit/toThreadSafe.
pub trait FsArgument {
    const HAVE_ABORT_SIGNAL: bool = false;
    /// Zig: every Arguments struct defines `toThreadSafe(self: *@This())` —
    /// clone any borrowed JS-backed slices so the work-pool callback may run
    /// off-thread. Default body is a porting stub; per-type overrides land
    /// with each Arguments port.
    fn to_thread_safe(&mut self) {
        // TODO(port): per-Argument toThreadSafe — most are PathLike/slice
        // clones; leave as no-op until each `args::*` is fleshed out.
    }
    /// Zig: `deinitAndUnprotect` — free clones from `to_thread_safe` and
    /// `JSValue.unprotect` any retained handles. Default no-op stub.
    fn deinit_and_unprotect(&mut self) {
        // TODO(port): per-Argument deinitAndUnprotect.
    }
    fn signal(&self) -> Option<&AbortSignal> { None }
}

/// Mass-implement [`FsArgument`] for the `args::*` payload structs so the
/// generic `AsyncFSTask::<R, A, F>::run_from_js_thread` is callable from the
/// high-tier dispatch table. Per-type `to_thread_safe`/`deinit_and_unprotect`
/// bodies override the defaults as each Arguments port lands.
macro_rules! impl_fs_argument_stub {
    ( $( $ty:ty ),+ $(,)? ) => {
        $( impl FsArgument for $ty {} )+
    };
}
impl_fs_argument_stub!(
    args::Rename, args::Truncate, args::Writev, args::Readv, args::FTruncate,
    args::Chown, args::Fchown, args::Lutimes, args::Chmod, args::FChmod,
    args::StatFS, args::Stat, args::Fstat, args::Link, args::Symlink,
    args::Readlink, args::Realpath, args::Unlink, args::RmDir, args::Mkdir,
    args::MkdirTemp, args::Readdir, args::Close, args::Open, args::Futimes,
    args::Write, args::Read, args::ReadFile, args::WriteFile, args::Exists,
    args::Access, args::FdataSync, args::CopyFile, args::Fsync,
);


pub struct AsyncFSTask<R, A, const F: NodeFSFunctionEnum> {
    pub promise: JSPromiseStrong,
    pub args: A,
    pub global_object: *const JSGlobalObject,
    pub task: WorkPoolTask,
    pub result: Maybe<R>,
    pub r#ref: KeepAlive,
    pub tracker: AsyncTaskTracker,
}

impl<R, A: FsArgument, const F: NodeFSFunctionEnum> AsyncFSTask<R, A, F> {
    /// NewAsyncFSTask supports cancelable operations via AbortSignal,
    /// so long as a "signal" field exists. The task wrapper will ensure
    /// a promise rejection happens if signaled, but if `function` is
    /// already called, no guarantees are made. It is recommended for
    /// the functions to check .signal.aborted() for early returns.
    pub const HAVE_ABORT_SIGNAL: bool = A::HAVE_ABORT_SIGNAL;
    // TODO(port): heap_label = "Async" ++ typeBaseName(A) ++ "Task"
    pub const HEAP_LABEL: &'static str = "AsyncFSTask";

    pub fn create(
        global_object: &JSGlobalObject,
        _binding: &mut Binding,
        args: A,
        vm: &mut VirtualMachine,
    ) -> JSValue {
        let mut task = Box::new(Self {
            promise: JSPromiseStrong::init(global_object),
            args,
            result: unsafe { core::mem::zeroed() }, // SAFETY: written before read
            global_object: global_object as *const _,
            task: WorkPoolTask { callback: Self::work_pool_callback, ..Default::default() },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker::init(vm),
        });
        task.r#ref.ref_(vm);
        task.args.to_thread_safe();
        task.tracker.did_schedule(global_object);
        let promise = task.promise.value();
        WorkPool::schedule(&mut Box::leak(task).task);
        promise
    }

    fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to Self.task; container_of via offset_of
        let this: &mut Self = unsafe {
            &mut *((task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>())
        };

        let mut node_fs = NodeFS::default();
        // TODO(port): dispatch via NodeFSFunctionEnum const-generic to the correct NodeFS method
        this.result = NodeFS::dispatch::<R, A, F>(&mut node_fs, &this.args, Flavor::Async);

        if let Maybe::Err(err) = &mut this.result {
            *err = err.clone();
            core::hint::black_box(&node_fs);
        }

        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        unsafe { &*this.global_object }
            .bun_vm_concurrently()
            .event_loop()
            .enqueue_task_concurrent(ConcurrentTask::create_from(this));
    }

    pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JsTerminated> {
        // SAFETY: self was Box::leak'd in create(); destroy() runs exactly once on scope exit
        let _deinit = scopeguard::guard(self as *mut Self, |p| unsafe { Self::destroy(p) });
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        let global_object = unsafe { &*self.global_object };

        let tracker = self.tracker;
        tracker.will_dispatch(global_object);
        let _did = scopeguard::guard((), |_| tracker.did_dispatch(global_object));

        let success = matches!(self.result, Maybe::Ok(_));
        let promise_value = self.promise.value();
        // SAFETY: sole `&mut JSPromise` borrow in this scope (resolver-style accessor).
        let promise = unsafe { self.promise.get() };
        let result = match &mut self.result {
            Maybe::Err(err) => match err.to_js_with_async_stack(global_object, promise) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
            Maybe::Ok(res) => match global_object.to_js(res) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
        };
        promise_value.ensure_still_alive();

        if Self::HAVE_ABORT_SIGNAL {
            if let Some(signal) = self.args.signal() {
                if let Some(reason) = signal.reason_if_aborted(global_object) {
                    return promise.reject(global_object, reason.to_js(global_object));
                }
            }
        }

        if success {
            promise.resolve(global_object, result)?;
        } else {
            promise.reject(global_object, Ok(result))?;
        }
        Ok(())
    }

    /// SAFETY: `this` must be the pointer Box::leak'd in `create()`; called exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live Box-leaked allocation
        let this_ref = unsafe { &mut *this };
        if let Maybe::Err(err) = &mut this_ref.result {
            err.deinit();
        }
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        this_ref.r#ref.unref(unsafe { &*this_ref.global_object }.bun_vm());
        this_ref.args.deinit_and_unprotect();
        this_ref.promise = JSPromiseStrong::default();
        // SAFETY: paired with Box::leak in create()
        drop(unsafe { Box::from_raw(this) });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AsyncCpTask
// ──────────────────────────────────────────────────────────────────────────

pub type AsyncCpTask = NewAsyncCpTask<false>;
pub type ShellAsyncCpTask = NewAsyncCpTask<true>;

// Zig path was `bun.shell.Interpreter.Builtin.Cp.ShellCpTask`. The Rust shell
// port flattens builtins under `crate::shell::builtins::*`.
type ShellCpTask = crate::shell::builtins::cp::ShellCpTask;

/// Callbacks `NewAsyncCpTask<true>` fires back into the owning shell `cp`
/// builtin. In Zig these are inherent methods on `ShellCpTask`
/// (`cpOnCopy` / `cpOnFinish`); the Rust shell port hasn't grown them yet, so
/// they're routed through this extension trait with no-op defaults. Once
/// `shell/builtin/cp.rs` adds inherent `cp_on_copy` / `cp_on_finish`, method
/// resolution will prefer those over the trait defaults automatically.
pub trait ShellCpHooks {
    fn cp_on_copy(&mut self, _src: &[OSPathChar], _dest: &[OSPathChar]) {}
    fn cp_on_finish(&mut self, _result: Maybe<ret::Cp>) {}
}
impl ShellCpHooks for ShellCpTask {}

pub struct NewAsyncCpTask<const IS_SHELL: bool> {
    pub promise: JSPromiseStrong,
    pub args: args::Cp,
    pub evtloop: EventLoopHandle,
    pub task: WorkPoolTask,
    /// Written from any workpool thread (first `finish_concurrently` caller wins via
    /// `has_result` CAS); read on the JS thread in `run_from_js_thread`. Wrapped in
    /// `UnsafeCell` so concurrent subtasks can hold `&Self` without aliased `&mut`.
    pub result: core::cell::UnsafeCell<Maybe<ret::Cp>>,
    /// If this task is called by the shell then we shouldn't call this as
    /// it is not threadsafe and is unnecessary as the process will be kept
    /// alive by the shell instance
    // TODO(port): conditional field — using KeepAlive unconditionally; on shell path it's never ref()'d
    pub r#ref: KeepAlive,
    // PERF(port): was arena bulk-free — profile in Phase B
    pub tracker: AsyncTaskTracker,
    pub has_result: AtomicBool,
    /// Number of in-flight references to `this`. Starts at 1 for the main
    /// directory-scan task; incremented for each `SingleTask` spawned. Every
    /// holder calls `onSubtaskDone` exactly once when finished (regardless of
    /// success or error). `runFromJSThread` — which destroys `this` — is only
    /// enqueued once the count reaches zero, so subtasks still running on the
    /// thread pool never dereference a freed parent.
    pub subtask_count: AtomicUsize,
    // BACKREF: only valid when IS_SHELL
    pub shelltask: *mut ShellCpTask,
}

/// This task is used by `AsyncCpTask/fs.promises.cp` to copy a single file.
/// When clonefile cannot be used, this task is started once per file.
pub struct CpSingleTask<const IS_SHELL: bool> {
    pub cp_task: *mut NewAsyncCpTask<IS_SHELL>,
    // PORT NOTE: Zig `bun.OSPathSliceZ` is a sentinel-terminated slice (fat
    // pointer). The Rust `OSPathSliceZ` alias is a DST (`ZStr`/`WStr`), so the
    // owning struct stores `&'static` borrows into the `Box::leak`'d `path_buf`
    // allocated in `_cp_async_directory`; `destroy()` reconstitutes and frees
    // that allocation from `src.as_ptr()`.
    pub src: &'static OSPathSliceZ,  // points into owned path_buf
    pub dest: &'static OSPathSliceZ, // points into owned path_buf
    pub task: WorkPoolTask,
}

impl<const IS_SHELL: bool> CpSingleTask<IS_SHELL> {
    pub fn create(
        parent: *mut NewAsyncCpTask<IS_SHELL>,
        src: &'static OSPathSliceZ,
        dest: &'static OSPathSliceZ,
    ) {
        let task = Box::new(CpSingleTask {
            cp_task: parent,
            src,
            dest,
            task: WorkPoolTask { callback: Self::work_pool_callback, ..Default::default() },
        });
        WorkPool::schedule(&mut Box::leak(task).task);
    }

    fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to Self.task
        let this: &mut Self = unsafe {
            &mut *((task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>())
        };
        // Preserve the raw `*mut` (Box::leak provenance) so `on_subtask_done`
        // may later promote it to `&mut` once the refcount reaches zero.
        let cp_task = this.cp_task;
        // SAFETY: cp_task is set in create() and the parent outlives all subtasks (subtask_count refcount).
        // Shared borrow only — other workpool threads (and the directory-scan thread) may hold
        // `&Self` to the same parent concurrently; never form `&mut` here.
        let parent = unsafe { &*cp_task };

        // TODO: error strings on node_fs will die
        let mut node_fs = NodeFS::default();

        let args = &parent.args;
        let result = node_fs._copy_single_file_sync(
            this.src,
            this.dest,
            constants::Copyfile::from_raw(
                if args.flags.error_on_exist || !args.flags.force { constants::COPYFILE_EXCL } else { 0i32 },
            ),
            None,
            &parent.args,
        );

        'brk: {
            match result {
                Maybe::Err(ref err) => {
                    if err.errno == E::EEXIST as _ && !args.flags.error_on_exist {
                        break 'brk;
                    }
                    parent.finish_concurrently(result);
                }
                Maybe::Ok(_) => {
                    parent.on_copy(this.src, this.dest);
                }
            }
        }

        // SAFETY: `this` was Box::leak'd in create(); destroyed exactly once here
        unsafe { Self::destroy(this as *mut Self) };
        // Must be the very last use of the parent: when the count reaches
        // zero, runFromJSThread is enqueued and may destroy the parent.
        NewAsyncCpTask::on_subtask_done(cp_task);
    }

    /// SAFETY: `this` must be the pointer Box::leak'd in `create()`; called exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live Box-leaked allocation
        let this_ref = unsafe { &mut *this };
        // There is only one path buffer for both paths. 2 extra bytes are the nulls at the end of each
        let total_len = this_ref.src.len() + this_ref.dest.len() + 2;
        // SAFETY: src.ptr is the start of a heap allocation of `total_len` OSPathChar
        unsafe {
            drop(Box::from_raw(core::slice::from_raw_parts_mut(
                this_ref.src.as_ptr() as *mut OSPathChar,
                total_len,
            )));
        }
        // SAFETY: paired with Box::leak in create()
        drop(unsafe { Box::from_raw(this) });
    }
}

impl<const IS_SHELL: bool> NewAsyncCpTask<IS_SHELL> {
    pub fn on_copy(&self, src: impl AsRef<[OSPathChar]>, dest: impl AsRef<[OSPathChar]>) {
        if !IS_SHELL { return; }
        // SAFETY: when IS_SHELL, shelltask is non-null and outlives this task
        unsafe { &mut *self.shelltask }.cp_on_copy(src.as_ref(), dest.as_ref());
    }

    pub fn on_finish(&mut self, result: Maybe<ret::Cp>) {
        if !IS_SHELL { return; }
        // SAFETY: when IS_SHELL, shelltask is non-null and outlives this task
        unsafe { &mut *self.shelltask }.cp_on_finish(result);
    }

    pub fn create(
        global_object: &JSGlobalObject,
        _binding: &mut Binding,
        cp_args: args::Cp,
        vm: &mut VirtualMachine,
    ) -> JSValue {
        let task = Self::create_with_shell_task(global_object, cp_args, vm, core::ptr::null_mut(), true);
        // SAFETY: create_with_shell_task returns a Box::leak'd pointer; valid until destroy()
        unsafe { &*task }.promise.value()
    }

    pub fn create_with_shell_task(
        global_object: &JSGlobalObject,
        cp_args: args::Cp,
        vm: &mut VirtualMachine,
        shelltask: *mut ShellCpTask,
        enable_promise: bool,
    ) -> *mut Self {
        let mut task = Box::new(Self {
            promise: if enable_promise { JSPromiseStrong::init(global_object) } else { JSPromiseStrong::default() },
            args: cp_args,
            has_result: AtomicBool::new(false),
            // SAFETY: all-zero is a valid Maybe<ret::Cp>; written before read
            result: core::cell::UnsafeCell::new(unsafe { core::mem::zeroed() }),
            evtloop: EventLoopHandle::init(vm.event_loop.cast()),
            task: WorkPoolTask { callback: Self::work_pool_callback, ..Default::default() },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker::init(vm),
            subtask_count: AtomicUsize::new(1),
            shelltask,
        });
        if !IS_SHELL { task.r#ref.ref_(event_loop_handle_to_ctx(task.evtloop)); }
        task.args.src.to_thread_safe();
        task.args.dest.to_thread_safe();
        task.tracker.did_schedule(global_object);

        let raw = Box::leak(task);
        WorkPool::schedule(&mut raw.task);
        raw
    }

    pub fn create_mini(
        cp_args: args::Cp,
        mini: &mut MiniEventLoop,
        shelltask: *mut ShellCpTask,
    ) -> *mut Self {
        let mut task = Box::new(Self {
            promise: JSPromiseStrong::default(),
            args: cp_args,
            has_result: AtomicBool::new(false),
            // SAFETY: all-zero is a valid Maybe<ret::Cp>; written before read
            result: core::cell::UnsafeCell::new(unsafe { core::mem::zeroed() }),
            evtloop: EventLoopHandle::Mini(mini),
            task: WorkPoolTask { callback: Self::work_pool_callback, ..Default::default() },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker { id: 0 },
            subtask_count: AtomicUsize::new(1),
            shelltask,
        });
        if !IS_SHELL { task.r#ref.ref_(event_loop_handle_to_ctx(task.evtloop)); }
        task.args.src.to_thread_safe();
        task.args.dest.to_thread_safe();

        let raw = Box::leak(task);
        WorkPool::schedule(&mut raw.task);
        raw
    }

    fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to Self.task. Kept as a raw pointer — `cp_async`
        // may spawn subtasks that hold `&Self` to the same allocation while
        // this call is still on the stack, so we must not form `&mut Self` here.
        let this: *mut Self = unsafe {
            (task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>()
        };
        let mut node_fs = NodeFS::default();
        Self::cp_async(&mut node_fs, this);
    }

    /// May be called from any thread (the subtasks).
    /// Records the result (first caller wins). Does NOT schedule destruction —
    /// `runFromJSThread` is only enqueued from `onSubtaskDone` once every
    /// in-flight subtask has dropped its reference, so that subtasks still
    /// running on the thread pool don't dereference a freed parent.
    fn finish_concurrently(&self, result: Maybe<ret::Cp>) {
        if self.has_result.compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed).is_err() {
            return;
        }
        // SAFETY: the CAS above guarantees exactly one thread reaches this write;
        // `result` is `UnsafeCell` so writing through `&self` is sound.
        unsafe {
            *self.result.get() = result;
            if let Maybe::Err(err) = &mut *self.result.get() {
                *err = err.clone();
            }
        }
    }

    /// Called exactly once by the main directory-scan task and once by each
    /// `SingleTask` when it is done touching `this`. The last caller (count
    /// drops to zero) enqueues `runFromJSThread`, which resolves the promise
    /// and destroys `this`.
    ///
    /// Takes a raw `*mut Self` (not `&self`) so the pointer retains the
    /// mutable provenance from the original `Box::leak`; the JS-thread
    /// callback later materializes `&mut *this`, which would be UB if the
    /// pointer were derived from a shared reference.
    fn on_subtask_done(this: *mut Self) {
        // SAFETY: `this` is a live Box-leaked task; shared access only here —
        // other workpool threads may concurrently hold `&Self` until the
        // refcount reaches zero below.
        let this_ref = unsafe { &*this };
        let old_count = this_ref.subtask_count.fetch_sub(1, Ordering::AcqRel);
        debug_assert!(old_count > 0);
        if old_count != 1 { return; }

        // All subtasks have finished. If none reported an error, the copy succeeded.
        if !this_ref.has_result.load(Ordering::Relaxed) {
            this_ref.has_result.store(true, Ordering::Relaxed);
            // SAFETY: count reached zero ⇒ this thread now has exclusive access.
            unsafe { *this_ref.result.get() = Maybe::Ok(()); }
        }

        // Count reached zero ⇒ exclusive access. `this` carries mutable
        // provenance from `Box::leak`, so the enqueued callback may safely
        // form `&mut *this` on the JS thread.
        if matches!(this_ref.evtloop, EventLoopHandle::Js { .. }) {
            // PORT NOTE: `ConcurrentTask::from_callback` expects `fn(*mut T) -> JsResult<()>`;
            // Zig accepted `fn(*T) JSError!void` directly. Adapt the signature inline.
            this_ref.evtloop.enqueue_task_concurrent(EventLoopTaskPtr { js: ConcurrentTask::from_callback(
                this,
                |p| unsafe { (&mut *p).run_from_js_thread().map_err(|_| core::ptr::null_mut()) },
            ) });
        } else {
            this_ref.evtloop.enqueue_task_concurrent(EventLoopTaskPtr { mini:
                AnyTaskWithExtraContext::from_callback_auto_deinit(this, |p: *mut Self, ctx| unsafe { (*p).run_from_js_thread_mini(ctx) }),
            });
        }
    }

    pub fn run_from_js_thread_mini(&mut self, _: *mut c_void) {
        let _ = self.run_from_js_thread(); // TODO: properly propagate exception upwards
    }

    fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JsTerminated> {
        if IS_SHELL {
            // SAFETY: shelltask is set by create_with_shell_task/create_mini and outlives this task
            unsafe { &mut *self.shelltask }.cp_on_finish(*self.result.get_mut());
            // SAFETY: self was Box::leak'd in create*(); destroyed exactly once here
            unsafe { Self::destroy(self as *mut Self) };
            return Ok(());
        }
        let go_ptr = self.evtloop.global_object();
        if go_ptr.is_null() {
            panic!("No global object, this indicates a bug in Bun. Please file a GitHub issue.");
        }
        // SAFETY: non-null erased *mut JSGlobalObject from the JS event loop vtable.
        let global_object: &JSGlobalObject = unsafe { &*(go_ptr as *const JSGlobalObject) };
        let success = matches!(*self.result.get_mut(), Maybe::Ok(_));
        let promise_value = self.promise.value();
        // SAFETY: sole `&mut JSPromise` borrow in this scope (resolver-style accessor).
        let promise = unsafe { self.promise.get() };
        let result = match self.result.get_mut() {
            Maybe::Err(err) => match err.to_js_with_async_stack(global_object, promise) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
            Maybe::Ok(res) => match global_object.to_js(res) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, global_object.take_exception(e)),
            },
        };
        promise_value.ensure_still_alive();

        let tracker = self.tracker;
        tracker.will_dispatch(global_object);
        let _did = scopeguard::guard((), |_| tracker.did_dispatch(global_object));

        // SAFETY: self was Box::leak'd in create*(); destroyed exactly once here
        unsafe { Self::destroy(self as *mut Self) };
        if success {
            promise.resolve(global_object, result)?;
        } else {
            promise.reject(global_object, Ok(result))?;
        }
        Ok(())
    }

    /// SAFETY: `this` must be the pointer returned by Box::leak in
    /// `create_with_shell_task()`/`create_mini()`; called exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live Box-leaked allocation
        let this_ref = unsafe { &mut *this };
        // PORT NOTE: Zig `err.deinit()` freed the path slice; Rust `bun_sys::Error`
        // owns `Box<[u8]>` and frees on Drop (in `Box::from_raw` below).
        if !IS_SHELL { this_ref.r#ref.unref(event_loop_handle_to_ctx(this_ref.evtloop)); }
        this_ref.args.deinit();
        this_ref.promise = JSPromiseStrong::default();
        // SAFETY: paired with Box::leak in create_with_shell_task()/create_mini()
        drop(unsafe { Box::from_raw(this) });
    }

    /// Directory scanning + clonefile will block this thread, then each individual file copy (what the sync version
    /// calls "_copySingleFileSync") will be dispatched as a separate task.
    pub fn cp_async(nodefs: &mut NodeFS, this: *mut Self) {
        // The directory-scan task holds one reference in `subtask_count`
        // (initialized to 1 in create*). Drop it on return. `runFromJSThread`
        // (which destroys `this`) is only enqueued once this reference and
        // every spawned SingleTask's reference have been dropped.
        // `this` is the live Box-leaked task; on_subtask_done only enqueues destruction
        // once every reference (including this one) has been dropped.
        let _done = scopeguard::guard(this, |p| Self::on_subtask_done(p));
        // SAFETY: same pointer as above; valid for the duration of this fn.
        // Shared borrow only — once `_cp_async_directory` spawns `CpSingleTask`s,
        // other workpool threads concurrently hold `&Self` to this same allocation.
        let this = unsafe { &**_done };

        let args = &this.args;
        let mut src_buf = OSPathBuffer::uninit();
        let mut dest_buf = OSPathBuffer::uninit();
        let src = args.src.os_path(&mut src_buf);
        let dest = args.dest.os_path(&mut dest_buf);

        #[cfg(windows)]
        {
            // SAFETY: src is NUL-terminated (os_path); GetFileAttributesW is the Win32 FFI
            let attributes = unsafe { bun_sys::c::GetFileAttributesW(src.as_ptr()) };
            if attributes == bun_sys::c::INVALID_FILE_ATTRIBUTES {
                this.finish_concurrently(Maybe::Err(sys::Error {
                    errno: SystemErrno::ENOENT as _,
                    syscall: sys::Tag::copyfile,
                    path: nodefs.os_path_into_sync_error_buf(src),
                    ..Default::default()
                }));
                return;
            }
            let file_or_symlink = (attributes & bun_sys::c::FILE_ATTRIBUTE_DIRECTORY) == 0
                || (attributes & bun_sys::c::FILE_ATTRIBUTE_REPARSE_POINT) != 0;
            if file_or_symlink {
                let r = nodefs._copy_single_file_sync(
                    src,
                    dest,
                    if IS_SHELL {
                        // Shell always forces copy
                        constants::Copyfile::from_raw(constants::Copyfile::FORCE)
                    } else {
                        constants::Copyfile::from_raw(
                            if args.flags.error_on_exist || !args.flags.force { constants::COPYFILE_EXCL } else { 0i32 },
                        )
                    },
                    Some(attributes),
                    &this.args,
                );
                if let Maybe::Err(e) = &r {
                    if e.errno == E::EEXIST as _ && !args.flags.error_on_exist {
                        this.finish_concurrently(Maybe::Ok(()));
                        return;
                    }
                }
                this.on_copy(src, dest);
                this.finish_concurrently(r);
                return;
            }
        }
        #[cfg(not(windows))]
        {
            let stat_ = match Syscall::lstat(src) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => {
                    nodefs.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                    this.finish_concurrently(Maybe::Err(err.with_path(&nodefs.sync_error_buf[..src.len()])));
                    return;
                }
            };

            if !sys::S::ISDIR(stat_.st_mode as _) {
                // This is the only file, there is no point in dispatching subtasks
                let r = nodefs._copy_single_file_sync(
                    src,
                    dest,
                    constants::Copyfile::from_raw(
                        if args.flags.error_on_exist || !args.flags.force { constants::COPYFILE_EXCL } else { 0i32 },
                    ),
                    Some(stat_),
                    &this.args,
                );
                if let Maybe::Err(e) = &r {
                    if e.errno == E::EEXIST as _ && !args.flags.error_on_exist {
                        this.on_copy(src, dest);
                        this.finish_concurrently(Maybe::Ok(()));
                        return;
                    }
                }
                this.on_copy(src, dest);
                this.finish_concurrently(r);
                return;
            }
        }
        if !args.flags.recursive {
            this.finish_concurrently(Maybe::Err(sys::Error {
                errno: E::EISDIR as _,
                syscall: sys::Tag::copyfile,
                path: nodefs.os_path_into_sync_error_buf(src),
                ..Default::default()
            }));
            return;
        }

        let _ = Self::_cp_async_directory(
            nodefs,
            args.flags,
            // Pass the raw `*mut Self` (Box::leak provenance) so spawned
            // `CpSingleTask`s store a pointer that may later be promoted to
            // `&mut` in `on_subtask_done`.
            *_done,
            &mut src_buf,
            PathInt::try_from(src.len()).unwrap(),
            &mut dest_buf,
            PathInt::try_from(dest.len()).unwrap(),
        );
    }

    // returns boolean `should_continue`
    fn _cp_async_directory(
        nodefs: &mut NodeFS,
        args: args::CpFlags,
        this: *mut Self,
        src_buf: &mut OSPathBuffer,
        src_dir_len: PathInt,
        dest_buf: &mut OSPathBuffer,
        dest_dir_len: PathInt,
    ) -> bool {
        // SAFETY: `this` is the live Box-leaked task. Shared borrow only — spawned
        // `CpSingleTask`s on other workpool threads may concurrently hold `&Self`.
        // The raw `*mut` is threaded through (instead of `&Self`) so that the
        // `cp_task` pointers stored in subtasks retain mutable provenance for
        // `on_subtask_done`'s eventual `&mut` promotion.
        let this_ref = unsafe { &*this };
        // SAFETY: callers NUL-terminate at src_dir_len/dest_dir_len before calling
        let src = unsafe { ZStr::from_raw(src_buf.as_ptr().cast(), src_dir_len as usize) };
        // SAFETY: dest_buf[dest_dir_len] == 0 written by caller
        let dest = unsafe { ZStr::from_raw(dest_buf.as_ptr().cast(), dest_dir_len as usize) };

        #[cfg(target_os = "macos")]
        {
            if let Some(err) = Maybe::<ret::Cp>::errno_sys_p(
                // SAFETY: src/dest are NUL-terminated; clonefile is the libc FFI
                unsafe { bun_sys::c::clonefile(src.as_ptr(), dest.as_ptr(), 0) },
                sys::Tag::clonefile,
                src,
            ) {
                match err.get_errno() {
                    E::ACCES | E::ENAMETOOLONG | E::ROFS | E::PERM | E::INVAL => {
                        nodefs.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                        this_ref.finish_concurrently(Maybe::Err(err.err.with_path(&nodefs.sync_error_buf[..src.len()])));
                        return false;
                    }
                    // Other errors may be due to clonefile() not being supported
                    // We'll fall back to other implementations
                    _ => {}
                }
            } else {
                return true;
            }
        }

        let open_flags = sys::O::DIRECTORY | sys::O::RDONLY;
        let fd = match openat_os_path(FD::cwd(), src, open_flags, 0) {
            Maybe::Err(err) => {
                this_ref.finish_concurrently(Maybe::Err(err.with_path(nodefs.os_path_into_sync_error_buf(src))));
                return false;
            }
            Maybe::Ok(fd_) => fd_,
        };
        let _close = scopeguard::guard(fd, |fd| fd.close());

        let mut buf = OSPathBuffer::uninit();
        #[cfg(windows)]
        let normdest: OSPathSliceZ = match sys::normalize_path_windows::<u16>(FD::INVALID, dest, &mut buf, sys::NormalizeOpts { add_nt_prefix: false }) {
            Maybe::Err(err) => { this_ref.finish_concurrently(Maybe::Err(err)); return false; }
            Maybe::Ok(n) => n,
        };
        #[cfg(not(windows))]
        let normdest: OSPathSliceZ = { let _ = &buf; dest };

        let mkdir_ = nodefs.mkdir_recursive_os_path(normdest, args::Mkdir::DEFAULT_MODE, false);
        match mkdir_ {
            Maybe::Err(err) => { this_ref.finish_concurrently(Maybe::Err(err)); return false; }
            Maybe::Ok(_) => { this_ref.on_copy(src, normdest); }
        }

        // PORT NOTE: `DirIterator.iterate(dir, kind)` (Zig runtime arg) maps to a
        // const-generic `PathType` in the Rust port. On POSIX directory entries
        // are always UTF-8, so monomorphise on `PathType::U8` and let the
        // Windows branch (gated above) handle the wide path.
        #[cfg(windows)]
        let mut iterator = DirIterator::iterate::<{ DirIterator::PathType::U16 }>(fd);
        #[cfg(not(windows))]
        let mut iterator = DirIterator::iterate::<{ DirIterator::PathType::U8 }>(fd);
        let mut entry = iterator.next();
        loop {
            let current = match entry {
                Maybe::Err(err) => {
                    this_ref.finish_concurrently(Maybe::Err(err.with_path(nodefs.os_path_into_sync_error_buf(src))));
                    return false;
                }
                Maybe::Ok(ent) => match ent {
                    Some(e) => e,
                    None => break,
                },
            };
            let cname = current.name.slice();

            // The accumulated path for deep directory trees can exceed the fixed
            // OSPathBuffer. Bail out with ENAMETOOLONG instead of writing past the
            // end of the buffer and corrupting the stack.
            if (src_dir_len as usize) + 1 + cname.len() >= src_buf.len()
                || (dest_dir_len as usize) + 1 + cname.len() >= dest_buf.len()
            {
                this_ref.finish_concurrently(Maybe::Err(sys::Error {
                    errno: E::ENAMETOOLONG as _,
                    syscall: sys::Tag::copyfile,
                    path: nodefs.os_path_into_sync_error_buf(&src_buf[..src_dir_len as usize]),
                    ..Default::default()
                }));
                return false;
            }

            match current.kind {
                crate::node::dirent::Kind::Directory => {
                    let sd = src_dir_len as usize;
                    let dd = dest_dir_len as usize;
                    src_buf[sd + 1..sd + 1 + cname.len()].copy_from_slice(cname);
                    src_buf[sd] = paths::SEP as OSPathChar;
                    src_buf[sd + 1 + cname.len()] = 0;
                    dest_buf[dd + 1..dd + 1 + cname.len()].copy_from_slice(cname);
                    dest_buf[dd] = paths::SEP as OSPathChar;
                    dest_buf[dd + 1 + cname.len()] = 0;

                    let should_continue = Self::_cp_async_directory(
                        nodefs, args, this,
                        src_buf, (sd + 1 + cname.len()) as PathInt,
                        dest_buf, (dd + 1 + cname.len()) as PathInt,
                    );
                    if !should_continue { return false; }
                }
                _ => {
                    this_ref.subtask_count.fetch_add(1, Ordering::Relaxed);
                    let sd = src_dir_len as usize;
                    let dd = dest_dir_len as usize;
                    let total = sd + 1 + cname.len() + 1 + dd + 1 + cname.len() + 1;

                    // Allocate a path buffer for the path data
                    let mut path_buf = vec![0 as OSPathChar; total].into_boxed_slice();

                    path_buf[..sd].copy_from_slice(&src_buf[..sd]);
                    path_buf[sd] = paths::SEP as OSPathChar;
                    path_buf[sd + 1..sd + 1 + cname.len()].copy_from_slice(cname);
                    path_buf[sd + 1 + cname.len()] = 0;
                    let dest_off = sd + 1 + cname.len() + 1;
                    path_buf[dest_off..dest_off + dd].copy_from_slice(&dest_buf[..dd]);
                    path_buf[dest_off + dd] = paths::SEP as OSPathChar;
                    path_buf[dest_off + dd + 1..dest_off + dd + 1 + cname.len()].copy_from_slice(cname);
                    path_buf[dest_off + dd + 1 + cname.len()] = 0;

                    let raw = Box::leak(path_buf);
                    // SAFETY: raw[sd+1+cname.len()] == 0 written above
                    let src_z = unsafe { OSPathSliceZ::from_raw(raw.as_ptr(), sd + 1 + cname.len()) };
                    // SAFETY: raw[dest_off+dd+1+cname.len()] == 0 written above
                    let dest_z = unsafe { OSPathSliceZ::from_raw(raw.as_ptr().add(dest_off), dd + 1 + cname.len()) };
                    CpSingleTask::<IS_SHELL>::create(this, src_z, dest_z);
                }
            }
            entry = iterator.next();
        }

        true
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AsyncReaddirRecursiveTask
// ──────────────────────────────────────────────────────────────────────────

pub struct AsyncReaddirRecursiveTask {
    pub promise: JSPromiseStrong,
    pub args: args::Readdir,
    pub global_object: *const JSGlobalObject,
    pub task: WorkPoolTask,
    pub r#ref: KeepAlive,
    pub tracker: AsyncTaskTracker,

    // It's not 100% clear this one is necessary
    pub has_result: AtomicBool,

    pub subtask_count: AtomicUsize,

    /// The final result list
    pub result_list: ResultListEntryValue,

    /// When joining the result list, we use this to preallocate the joined array.
    pub result_list_count: AtomicUsize,

    /// A lockless queue of result lists.
    ///
    /// Using a lockless queue instead of mutex + joining the lists as we go was a meaningful performance improvement
    pub result_list_queue: UnboundedQueue<ResultListEntry>,

    /// All the subtasks will use this fd to open files
    pub root_fd: FD,

    /// This isued when joining the file paths for error messages
    pub root_path: PathString,

    pub pending_err: Option<sys::Error>,
    pub pending_err_mutex: bun_threading::Mutex,
}

pub enum ResultListEntryValue {
    WithFileTypes(Vec<Dirent>),
    Buffers(Vec<Buffer>),
    Files(Vec<BunString>),
}

impl ResultListEntryValue {
    pub fn deinit(&mut self) {
        match self {
            ResultListEntryValue::WithFileTypes(res) => {
                for item in res.iter() { item.deref(); }
                res.clear();
            }
            ResultListEntryValue::Buffers(res) => {
                for item in res.iter() {
                    // TODO(port): free item.buffer.byteSlice() — owned bytes
                    drop(item);
                }
                res.clear();
            }
            ResultListEntryValue::Files(res) => {
                for item in res.iter() { item.deref(); }
                res.clear();
            }
        }
    }
}

pub struct ResultListEntry {
    pub next: *mut ResultListEntry, // INTRUSIVE: UnboundedQueue link
    pub value: ResultListEntryValue,
}

// SAFETY: all four accessors route through the same `next` field; the atomic
// variants reinterpret it in-place as `AtomicPtr<Self>` (identical layout/
// alignment to `*mut Self`). `UnboundedQueue` only ever calls these with a
// live, properly aligned `*mut ResultListEntry` it previously had pushed.
unsafe impl bun_threading::unbounded_queue::Node for ResultListEntry {
    unsafe fn get_next(item: *mut Self) -> *mut Self {
        unsafe { (*item).next }
    }
    unsafe fn set_next(item: *mut Self, ptr: *mut Self) {
        unsafe { (*item).next = ptr };
    }
    unsafe fn atomic_load_next(item: *mut Self, ordering: Ordering) -> *mut Self {
        unsafe {
            (*(core::ptr::addr_of!((*item).next)
                as *const core::sync::atomic::AtomicPtr<Self>))
                .load(ordering)
        }
    }
    unsafe fn atomic_store_next(item: *mut Self, ptr: *mut Self, ordering: Ordering) {
        unsafe {
            (*(core::ptr::addr_of!((*item).next)
                as *const core::sync::atomic::AtomicPtr<Self>))
                .store(ptr, ordering)
        };
    }
}

pub struct ReaddirSubtask {
    pub readdir_task: *mut AsyncReaddirRecursiveTask, // BACKREF
    pub basename: PathString,
    pub task: WorkPoolTask,
}

impl ReaddirSubtask {
    pub fn new(init: ReaddirSubtask) -> Box<Self> { Box::new(init) }

    pub fn call(task: *mut WorkPoolTask) {
        // SAFETY: task points to Self.task
        let this: &mut Self = unsafe {
            &mut *((task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>())
        };
        // SAFETY: `this` is the Box::leak'd subtask; basename was allocator.dupeZ'd in enqueue()
        let _cleanup = scopeguard::guard(this as *mut Self, |p| unsafe {
            // free duped basename + destroy self.
            // basename was allocated as `Box<[u8]>` of len+1 (NUL included) in
            // enqueue(); reconstruct that exact layout for drop.
            let z = (*p).basename.slice_assume_z();
            let len_with_nul = z.len() + 1;
            let ptr = z.as_bytes().as_ptr() as *mut u8;
            drop(Box::<[u8]>::from_raw(core::slice::from_raw_parts_mut(ptr, len_with_nul)));
            drop(Box::from_raw(p));
        });
        let mut buf = PathBuffer::uninit();
        // SAFETY: readdir_task (BACKREF) outlives subtask via subtask_count refcount
        unsafe { &mut *this.readdir_task }.perform_work(this.basename.slice_assume_z(), &mut buf, false);
    }
}

impl AsyncReaddirRecursiveTask {
    pub fn new(init: Self) -> Box<Self> { Box::new(init) }

    pub fn enqueue(&mut self, basename: &ZStr) {
        // Spec (node_fs.zig:1058) does `bun.default_allocator.dupeZ(u8, basename)` —
        // the subtask runs on another thread after the caller's `name_to_copy_z`
        // (which points into a per-iteration buffer) has been overwritten, so we
        // must heap-own the bytes here. Freed in ReaddirSubtask::call's cleanup.
        let mut owned = Vec::with_capacity(basename.len() + 1);
        owned.extend_from_slice(basename.as_bytes());
        owned.push(0);
        let owned: Box<[u8]> = owned.into_boxed_slice();
        let len = owned.len() - 1; // exclude NUL
        let ptr = Box::into_raw(owned) as *mut u8;
        // SAFETY: `ptr[..len]` is the duped bytes; `ptr[len] == 0`. The Box<[u8]>
        // backing is reconstructed and freed in `ReaddirSubtask::call`.
        let basename_ps = PathString::init(unsafe { core::slice::from_raw_parts(ptr, len) });
        let task = ReaddirSubtask::new(ReaddirSubtask {
            readdir_task: self,
            basename: basename_ps,
            task: WorkPoolTask { callback: ReaddirSubtask::call, ..Default::default() },
        });
        debug_assert!(self.subtask_count.fetch_add(1, Ordering::Relaxed) > 0);
        WorkPool::schedule(&mut Box::leak(task).task);
    }

    pub fn create(
        global_object: &JSGlobalObject,
        args: args::Readdir,
        vm: &mut VirtualMachine,
    ) -> JSValue {
        let result_list = match args.tag() {
            ret::ReaddirTag::Files => ResultListEntryValue::Files(Vec::new()),
            ret::ReaddirTag::WithFileTypes => ResultListEntryValue::WithFileTypes(Vec::new()),
            ret::ReaddirTag::Buffers => ResultListEntryValue::Buffers(Vec::new()),
        };
        let root_path = PathString::init(ZStr::from_bytes(args.path.slice()));
        let mut task = Self::new(AsyncReaddirRecursiveTask {
            promise: JSPromiseStrong::init(global_object),
            args,
            has_result: AtomicBool::new(false),
            global_object: global_object as *const _,
            task: WorkPoolTask { callback: Self::work_pool_callback, ..Default::default() },
            r#ref: KeepAlive::default(),
            tracker: AsyncTaskTracker::init(vm),
            subtask_count: AtomicUsize::new(1),
            root_path,
            result_list,
            result_list_count: AtomicUsize::new(0),
            result_list_queue: UnboundedQueue::default(),
            root_fd: FD::INVALID,
            pending_err: None,
            pending_err_mutex: bun_threading::Mutex::default(),
        });
        task.r#ref.ref_(vm);
        task.args.to_thread_safe();
        task.tracker.did_schedule(global_object);
        let promise = task.promise.value();
        WorkPool::schedule(&mut Box::leak(task).task);
        promise
    }

    pub fn perform_work(&mut self, basename: &ZStr, buf: &mut PathBuffer, is_root: bool) {
        // PERF(port): was comptime monomorphization on tag — runtime match here
        // PERF(port): was stack-fallback alloc (8192) for entries
        macro_rules! impl_tag {
            ($T:ty, $variant:ident) => {{
                let mut entries: Vec<$T> = Vec::new();
                let res = NodeFS::readdir_with_entries_recursive_async::<$T>(
                    buf, &self.args, self, basename, &mut entries, is_root,
                );
                match res {
                    Maybe::Err(err) => {
                        for item in &mut entries {
                            // TODO(port): per-type deref/free
                            let _ = item;
                        }
                        {
                            let _lock = self.pending_err_mutex.lock();
                            if self.pending_err.is_none() {
                                let err_path = if !err.path().is_empty() { err.path() } else { self.args.path.slice() };
                                self.pending_err = Some(err.with_path(Box::<[u8]>::from(err_path)));
                            }
                        }
                        if self.subtask_count.fetch_sub(1, Ordering::Relaxed) == 1 {
                            self.finish_concurrently();
                        }
                    }
                    Maybe::Ok(()) => {
                        self.write_results::<$T>(&mut entries);
                    }
                }
            }};
        }
        match self.args.tag() {
            ret::ReaddirTag::Files => impl_tag!(BunString, Files),
            ret::ReaddirTag::WithFileTypes => impl_tag!(Dirent, WithFileTypes),
            ret::ReaddirTag::Buffers => impl_tag!(Buffer, Buffers),
        }
    }

    fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to Self.task; container_of via offset_of
        let this: &mut Self = unsafe {
            &mut *((task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>())
        };
        let mut buf = PathBuffer::uninit();
        this.perform_work(this.root_path.slice_assume_z(), &mut buf, true);
    }

    pub fn write_results<T: IntoResultListEntry>(&mut self, result: &mut Vec<T>) {
        if !result.is_empty() {
            let mut clone: Vec<T> = Vec::with_capacity(result.len());
            // PERF(port): was appendSliceAssumeCapacity
            clone.append(result);
            self.result_list_count.fetch_add(clone.len(), Ordering::Relaxed);
            // TODO(port): @unionInit by ResultType — needs trait dispatch to map T -> variant
            let list = Box::new(ResultListEntry {
                next: core::ptr::null_mut(),
                value: ResultListEntryValue::from_vec(clone),
            });
            self.result_list_queue.push(Box::leak(list));
        }

        if self.subtask_count.fetch_sub(1, Ordering::Relaxed) == 1 {
            self.finish_concurrently();
        }
    }

    /// May be called from any thread (the subtasks)
    pub fn finish_concurrently(&mut self) {
        if self.has_result.compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed).is_err() {
            return;
        }
        debug_assert!(self.subtask_count.load(Ordering::Relaxed) == 0);

        let root_fd = self.root_fd;
        if root_fd != FD::INVALID {
            use bun_sys::FdExt as _;
            self.root_fd = FD::INVALID;
            root_fd.close();
            // free root_path's heap-backed slice
            // TODO(port): self.root_path was allocator.dupeZ; drop owned slice here
            self.root_path = PathString::EMPTY;
        }

        if self.pending_err.is_some() {
            self.clear_result_list();
        }

        {
            let mut list = self.result_list_queue.pop_batch();
            let mut iter = list.iterator();
            // we have to free only the previous one because the next value will
            // be read by the iterator.
            let mut to_destroy: Option<*mut ResultListEntry> = None;

            // TODO(port): match on tag, ensureTotalCapacityPrecise on the correct vec,
            // append each batch's items, then drop the entry box. Mirrors zig:1206-1225.
            let cap = self.result_list_count.swap(0, Ordering::Relaxed);
            self.result_list.reserve_exact(cap);
            loop {
                let val = iter.next();
                if val.is_null() { break; }
                if let Some(dest) = to_destroy {
                    // SAFETY: paired with Box::leak in write_results()
                    unsafe { drop(Box::from_raw(dest)) };
                }
                to_destroy = Some(val);
                // SAFETY: `val` came from the queue and is live until Box::from_raw above on the next iter
                self.result_list.append_from(&mut unsafe { &mut *val }.value);
            }
            if let Some(dest) = to_destroy {
                // SAFETY: paired with Box::leak in write_results()
                unsafe { drop(Box::from_raw(dest)) };
            }
        }

        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv.
        // `bun_vm()` returns the raw `*mut VirtualMachine`; `bun_vm_concurrently`
        // (which only skips the JS-thread assert) is not on the lib.rs surface
        // yet, so deref the pointer directly — safe to call from any thread.
        let vm = unsafe { &mut *unsafe { &*self.global_object }.bun_vm() };
        vm.enqueue_task_concurrent(ConcurrentTask::create(Task::init(self as *mut Self)));
    }

    fn clear_result_list(&mut self) {
        self.result_list.deinit();
        let mut batch = self.result_list_queue.pop_batch();
        let mut iter = batch.iterator();
        let mut to_destroy: Option<*mut ResultListEntry> = None;
        loop {
            let val = iter.next();
            if val.is_null() { break; }
            // SAFETY: `val` is a live queue node until freed below
            unsafe { &mut *val }.value.deinit();
            // SAFETY: paired with Box::leak in write_results()
            if let Some(dest) = to_destroy { unsafe { drop(Box::from_raw(dest)) }; }
            to_destroy = Some(val);
        }
        // SAFETY: paired with Box::leak in write_results()
        if let Some(dest) = to_destroy { unsafe { drop(Box::from_raw(dest)) }; }
        self.result_list_count.store(0, Ordering::Relaxed);
    }

    pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JsTerminated> {
        // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv
        let global_object = unsafe { &*self.global_object };
        let success = self.pending_err.is_none();
        let promise_value = self.promise.value();
        // SAFETY: sole `&mut JSPromise` borrow in this scope (resolver-style accessor).
        let promise = unsafe { self.promise.get() };
        let result = if let Some(err) = &mut self.pending_err {
            match SysErrorAsyncJsc::to_js_with_async_stack(&*err, global_object, promise) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, Ok(global_object.take_exception(e))),
            }
        } else {
            let res = match core::mem::replace(&mut self.result_list, ResultListEntryValue::Files(Vec::new())) {
                ResultListEntryValue::WithFileTypes(v) => ret::Readdir::WithFileTypes(v.into_boxed_slice()),
                ResultListEntryValue::Buffers(v) => ret::Readdir::Buffers(v.into_boxed_slice()),
                ResultListEntryValue::Files(v) => ret::Readdir::Files(v.into_boxed_slice()),
            };
            match res.to_js(global_object) {
                Ok(v) => v,
                Err(e) => return promise.reject(global_object, Ok(global_object.take_exception(e))),
            }
        };
        promise_value.ensure_still_alive();

        let tracker = self.tracker;
        tracker.will_dispatch(global_object);
        let _did = scopeguard::guard((), |_| tracker.did_dispatch(global_object));

        // SAFETY: self was Box::leak'd in create(); destroyed exactly once here
        unsafe { Self::destroy(self as *mut Self) };
        if success {
            promise.resolve(global_object, result)?;
        } else {
            promise.reject(global_object, Ok(result))?;
        }
        Ok(())
    }

    /// SAFETY: `this` must be the pointer Box::leak'd in `create()`; called exactly once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live Box-leaked allocation
        let this_ref = unsafe { &mut *this };
        debug_assert!(this_ref.root_fd == FD::INVALID); // should already have closed it
        // Zig `err.deinit()` — `bun_sys::Error` frees on Drop; nothing to do.
        let _ = this_ref.pending_err.take();
        // Zig passed `bunVM()`; Rust `KeepAlive::unref` takes the type-erased
        // `EventLoopCtx`. Resolve via the global JS-loop hook (single JS thread).
        this_ref.r#ref.unref(bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js));
        this_ref.args.deinit();
        // TODO(port): free root_path slice
        this_ref.clear_result_list();
        // Zig `promise.deinit()` — `JSPromiseStrong` releases on Drop (via Box::from_raw below).
        // SAFETY: paired with Box::leak in create()
        drop(unsafe { Box::from_raw(this) });
    }
}

/// Maps a readdir element type to its `ResultListEntryValue` variant.
///
/// PORT NOTE: Zig used `@unionInit(ResultListEntry.Value, @tagName(tag), clone)`
/// inside `writeResults`, dispatching on `comptime ResultType`. Rust can't
/// switch on a generic `T`, so the per-type wrapping lives on this trait.
pub trait IntoResultListEntry: Sized {
    fn into_variant(v: Vec<Self>) -> ResultListEntryValue;
}
impl IntoResultListEntry for Dirent {
    fn into_variant(v: Vec<Self>) -> ResultListEntryValue { ResultListEntryValue::WithFileTypes(v) }
}
impl IntoResultListEntry for Buffer {
    fn into_variant(v: Vec<Self>) -> ResultListEntryValue { ResultListEntryValue::Buffers(v) }
}
impl IntoResultListEntry for BunString {
    fn into_variant(v: Vec<Self>) -> ResultListEntryValue { ResultListEntryValue::Files(v) }
}

// Route `Task::init(self)` in `finish_concurrently` to the event-loop dispatch
// table. The `task_tag::ReaddirRecursive` arm is wired in
// `crate::dispatch::run_task` to call `run_from_js_thread`.
impl bun_event_loop::Taskable for AsyncReaddirRecursiveTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ReaddirRecursive;
}

impl ResultListEntryValue {
    fn from_vec<T: IntoResultListEntry>(v: Vec<T>) -> Self { T::into_variant(v) }
    fn reserve_exact(&mut self, n: usize) {
        match self {
            Self::WithFileTypes(v) => v.reserve_exact(n),
            Self::Buffers(v) => v.reserve_exact(n),
            Self::Files(v) => v.reserve_exact(n),
        }
    }
    fn append_from(&mut self, other: &mut Self) {
        match (self, other) {
            (Self::WithFileTypes(a), Self::WithFileTypes(b)) => a.append(b),
            (Self::Buffers(a), Self::Buffers(b)) => a.append(b),
            (Self::Files(a), Self::Files(b)) => a.append(b),
            _ => debug_assert!(false, "ResultListEntryValue tag mismatch"),
        }
    }
}

} // mod _async_tasks
pub use _async_tasks::{
    async_, AsyncCpTask, AsyncFSTask, AsyncReaddirRecursiveTask, CpSingleTask, FsArgument,
    IntoResultListEntry, NewAsyncCpTask, ResultListEntry, ResultListEntryValue, ShellAsyncCpTask,
    ShellCpHooks, UVFSRequest,
};

// ──────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────
// TODO: to improve performance for all of these
// The tagged unions for each type should become regular unions
// and the tags should be passed in as comptime arguments to the functions performing the syscalls
// This would reduce stack size, at the cost of instruction cache misses
pub mod args {
    use super::*;

    pub struct Rename {
        pub old_path: PathLike,
        pub new_path: PathLike,
    }
    impl Rename {
        pub fn deinit(&self) { self.old_path.deinit(); self.new_path.deinit(); }
        pub fn deinit_and_unprotect(&self) { self.old_path.deinit_and_unprotect(); self.new_path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.old_path.to_thread_safe(); self.new_path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Rename> {
            let old_path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_argument_type_value("oldPath", "string or an instance of Buffer or URL", arguments.next().unwrap_or(JSValue::UNDEFINED))
            })?;
            let new_path = match PathLike::from_js(ctx, arguments)? {
                Some(p) => p,
                None => { old_path.deinit(); return Err(ctx.throw_invalid_argument_type_value("newPath", "string or an instance of Buffer or URL", arguments.next().unwrap_or(JSValue::UNDEFINED))); }
            };
            Ok(Rename { old_path, new_path })
        }
    }

    pub struct Truncate {
        /// Passing a file descriptor is deprecated and may result in an error being thrown in the future.
        pub path: PathOrFileDescriptor,
        pub len: u64, // u63
        pub flags: i32,
    }
    impl Default for Truncate {
        fn default() -> Self { Self { path: PathOrFileDescriptor::default(), len: 0, flags: 0 } }
    }
    impl Truncate {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Truncate> {
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_arguments("path must be a string or TypedArray")
            })?;
            let len: u64 = 'brk: {
                let Some(len_value) = arguments.next() else { break 'brk 0 };
                validators::validate_integer(ctx, len_value, "len", None, None)?.max(0) as u64
            };
            Ok(Truncate { path, len, flags: 0 })
        }
    }

    pub struct Writev {
        pub fd: FD,
        pub buffers: VectorArrayBuffer,
        pub position: Option<u64>, // u52
    }
    impl Writev {
        pub fn deinit(&self) {}
        pub fn deinit_and_unprotect(&self) {
            self.buffers.value.unprotect();
            self.buffers.buffers.deinit();
        }
        pub fn to_thread_safe(&mut self) {
            self.buffers.value.protect();
            let clone: Vec<sys::PlatformIoVecConst> = self.buffers.buffers.as_slice().to_vec();
            self.buffers.buffers = clone;
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Writev> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let buffers = VectorArrayBuffer::from_js(
                ctx,
                arguments.protect_eat_next().ok_or_else(|| ctx.throw_invalid_arguments("Expected an ArrayBufferView[]"))?,
                arguments.arena.allocator(),
            )?;
            let mut position: Option<u64> = None;
            if let Some(pos_value) = arguments.next_eat() {
                if !pos_value.is_undefined_or_null() {
                    if pos_value.is_number() {
                        position = Some(pos_value.to::<u64>());
                    } else {
                        return Err(ctx.throw_invalid_arguments("position must be a number"));
                    }
                }
            }
            Ok(Writev { fd, buffers, position })
        }
    }

    pub struct Readv {
        pub fd: FD,
        pub buffers: VectorArrayBuffer,
        pub position: Option<u64>, // u52
    }
    impl Readv {
        pub fn deinit(&self) {}
        pub fn deinit_and_unprotect(&self) {
            self.buffers.value.unprotect();
            self.buffers.buffers.deinit();
        }
        pub fn to_thread_safe(&mut self) {
            self.buffers.value.protect();
            let clone: Vec<sys::PlatformIoVecConst> = self.buffers.buffers.as_slice().to_vec();
            self.buffers.buffers = clone;
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Readv> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let buffers = VectorArrayBuffer::from_js(
                ctx,
                arguments.protect_eat_next().ok_or_else(|| ctx.throw_invalid_arguments("Expected an ArrayBufferView[]"))?,
                arguments.arena.allocator(),
            )?;
            let mut position: Option<u64> = None;
            if let Some(pos_value) = arguments.next_eat() {
                if !pos_value.is_undefined_or_null() {
                    if pos_value.is_number() {
                        position = Some(pos_value.to::<u64>());
                    } else {
                        return Err(ctx.throw_invalid_arguments("position must be a number"));
                    }
                }
            }
            Ok(Readv { fd, buffers, position })
        }
    }

    pub struct FTruncate {
        pub fd: FD,
        pub len: Option<BlobSizeType>,
    }
    impl FTruncate {
        pub fn deinit(&self) {}
        pub fn deinit_and_unprotect(&mut self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<FTruncate> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let len: BlobSizeType = BlobSizeType::try_from(
                validators::validate_integer(
                    ctx,
                    arguments.next().unwrap_or(JSValue::js_number(0)),
                    "len",
                    Some(i64::from(i52::MIN)),
                    Some(BLOB_SIZE_MAX as i64),
                )?
                .max(0),
            )
            .unwrap();
            Ok(FTruncate { fd, len: Some(len) })
        }
    }

    pub struct Chown {
        pub path: PathLike,
        pub uid: UidT,
        pub gid: GidT,
    }
    impl Chown {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Chown> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            // Zig: `errdefer path.deinit()` — fires on every error return, including
            // `try validateInteger`. Model with scopeguard, defused on success.
            let path = scopeguard::guard(path, |p| p.deinit());
            let uid: UidT = 'brk: {
                let Some(uid_value) = arguments.next() else { return Err(ctx.throw_invalid_arguments("uid is required")); };
                arguments.eat();
                break 'brk wrap_to::<UidT>(validators::validate_integer(ctx, uid_value, "uid", Some(-1), Some(u32::MAX as i64))?);
            };
            let gid: GidT = 'brk: {
                let Some(gid_value) = arguments.next() else { return Err(ctx.throw_invalid_arguments("gid is required")); };
                arguments.eat();
                break 'brk wrap_to::<GidT>(validators::validate_integer(ctx, gid_value, "gid", Some(-1), Some(u32::MAX as i64))?);
            };
            Ok(Chown { path: scopeguard::ScopeGuard::into_inner(path), uid, gid })
        }
    }

    pub struct Fchown {
        pub fd: FD,
        pub uid: UidT,
        pub gid: GidT,
    }
    impl Fchown {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Fchown> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let uid: UidT = 'brk: {
                let Some(uid_value) = arguments.next() else { return Err(ctx.throw_invalid_arguments("uid is required")); };
                arguments.eat();
                break 'brk wrap_to::<UidT>(validators::validate_integer(ctx, uid_value, "uid", Some(-1), Some(u32::MAX as i64))?);
            };
            let gid: GidT = 'brk: {
                let Some(gid_value) = arguments.next() else { return Err(ctx.throw_invalid_arguments("gid is required")); };
                arguments.eat();
                break 'brk wrap_to::<GidT>(validators::validate_integer(ctx, gid_value, "gid", Some(-1), Some(u32::MAX as i64))?);
            };
            Ok(Fchown { fd, uid, gid })
        }
    }

    /// Zig: `fn wrapTo(comptime T: type, in: i64) T` where `T` is unsigned.
    /// Only ever instantiated with `uid_t`/`gid_t` (= `u32`), so drop the
    /// `num_traits` dependency and hard-code the wrap.
    #[inline]
    fn wrap_to<T: From<u32>>(in_: i64) -> T {
        // Zig spec (node_fs.zig:1586): `@intCast(@mod(in, std.math.maxInt(T)))`
        // — i.e. modulus is `u32::MAX` (2^32 - 1), **not** 2^32. So `-1 → 4294967294`
        // and `4294967295 → 0`. Match the spec exactly.
        T::from(in_.rem_euclid(u32::MAX as i64) as u32)
    }

    pub type LChown = Chown;

    pub struct Lutimes {
        pub path: PathLike,
        pub atime: TimeLike,
        pub mtime: TimeLike,
    }
    impl Lutimes {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Lutimes> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            // Zig: `errdefer path.deinit()` — also covers the `try timeLikeFromJS` throws.
            let path = scopeguard::guard(path, |p| p.deinit());
            let atime = node::time_like_from_js(ctx, arguments.next().ok_or_else(|| ctx.throw_invalid_arguments("atime is required"))?)?
                .ok_or_else(|| ctx.throw_invalid_arguments("atime must be a number or a Date"))?;
            arguments.eat();
            let mtime = node::time_like_from_js(ctx, arguments.next().ok_or_else(|| ctx.throw_invalid_arguments("mtime is required"))?)?
                .ok_or_else(|| ctx.throw_invalid_arguments("mtime must be a number or a Date"))?;
            arguments.eat();
            Ok(Lutimes { path: scopeguard::ScopeGuard::into_inner(path), atime, mtime })
        }
    }

    pub struct Chmod {
        pub path: PathLike,
        pub mode: Mode,
    }
    impl Default for Chmod { fn default() -> Self { Self { path: PathLike::default(), mode: 0x777 } } }
    impl Chmod {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Chmod> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            // Zig: `errdefer path.deinit()` — also covers the `try modeFromJS` throw.
            let path = scopeguard::guard(path, |p| p.deinit());
            let mode_arg = arguments.next().unwrap_or(JSValue::UNDEFINED);
            let mode: Mode = match node::mode_from_js(ctx, mode_arg)? {
                Some(m) => m,
                None => { return Err(validators::throw_err_invalid_arg_type(ctx, "mode", "number", mode_arg)); }
            };
            arguments.eat();
            Ok(Chmod { path: scopeguard::ScopeGuard::into_inner(path), mode })
        }
    }

    pub struct FChmod {
        pub fd: FD,
        pub mode: Mode,
    }
    impl Default for FChmod { fn default() -> Self { Self { fd: FD::INVALID, mode: 0x777 } } }
    impl FChmod {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<FChmod> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let mode_arg = arguments.next().unwrap_or(JSValue::UNDEFINED);
            let mode: Mode = node::mode_from_js(ctx, mode_arg)?.ok_or_else(|| validators::throw_err_invalid_arg_type(ctx, "mode", "number", mode_arg))?;
            arguments.eat();
            Ok(FChmod { fd, mode })
        }
    }

    pub type LCHmod = Chmod;

    pub struct StatFS {
        pub path: PathLike,
        pub big_int: bool,
    }
    impl StatFS {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<StatFS> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let big_int = 'brk: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_object() {
                        if next_val.is_callable() { break 'brk false; }
                        arguments.eat();
                        if let Some(b) = next_val.get_boolean_strict(ctx, "bigint")? { break 'brk b; }
                    }
                }
                false
            };
            Ok(StatFS { path, big_int })
        }
    }

    pub struct Stat {
        pub path: PathLike,
        pub big_int: bool,
        pub throw_if_no_entry: bool,
    }
    impl Default for Stat { fn default() -> Self { Self { path: PathLike::default(), big_int: false, throw_if_no_entry: true } } }
    impl Stat {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Stat> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut throw_if_no_entry = true;
            let big_int = 'brk: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_object() {
                        if next_val.is_callable() { break 'brk false; }
                        arguments.eat();
                        if let Some(v) = next_val.get_boolean_strict(ctx, "throwIfNoEntry")? { throw_if_no_entry = v; }
                        if let Some(b) = next_val.get_boolean_strict(ctx, "bigint")? { break 'brk b; }
                    }
                }
                false
            };
            Ok(Stat { path, big_int, throw_if_no_entry })
        }
    }

    pub struct Fstat {
        pub fd: FD,
        pub big_int: bool,
    }
    impl Fstat {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&mut self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Fstat> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let big_int = 'brk: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_object() {
                        if next_val.is_callable() { break 'brk false; }
                        arguments.eat();
                        if let Some(b) = next_val.get_boolean_strict(ctx, "bigint")? { break 'brk b; }
                    }
                }
                false
            };
            Ok(Fstat { fd, big_int })
        }
    }

    pub type Lstat = Stat;

    pub struct Link {
        pub old_path: PathLike,
        pub new_path: PathLike,
    }
    impl Link {
        pub fn deinit(&self) { self.old_path.deinit(); self.new_path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.old_path.deinit_and_unprotect(); self.new_path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.old_path.to_thread_safe(); self.new_path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Link> {
            let old_path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("oldPath must be a string or TypedArray"))?;
            let new_path = match PathLike::from_js(ctx, arguments)? {
                Some(p) => p,
                None => { old_path.deinit(); return Err(ctx.throw_invalid_arguments("newPath must be a string or TypedArray")); }
            };
            Ok(Link { old_path, new_path })
        }
    }

    #[derive(Copy, Clone)]
    pub enum SymlinkLinkType { Unspecified, File, Dir, Junction }

    pub struct Symlink {
        /// Where the symbolic link is targetting.
        pub target_path: PathLike,
        /// The path to create the symbolic link at.
        pub new_path: PathLike,
        /// Windows has multiple link types. By default, only junctions can be created by non-admin.
        #[cfg(windows)]
        pub link_type: SymlinkLinkType,
        #[cfg(not(windows))]
        pub link_type: (),
    }
    impl Symlink {
        pub fn deinit(&self) { self.target_path.deinit(); self.new_path.deinit(); }
        pub fn deinit_and_unprotect(&self) { self.target_path.deinit_and_unprotect(); self.new_path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.target_path.to_thread_safe(); self.new_path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Symlink> {
            let old_path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("target must be a string or TypedArray"))?;
            let new_path = match PathLike::from_js(ctx, arguments)? {
                Some(p) => p,
                None => { old_path.deinit(); return Err(ctx.throw_invalid_arguments("path must be a string or TypedArray")); }
            };
            // The type argument is only available on Windows and
            // ignored on other platforms. It can be set to 'dir',
            // 'file', or 'junction'. If the type argument is not set,
            // Node.js will autodetect target type and use 'file' or
            // 'dir'. If the target does not exist, 'file' will be used.
            // Windows junction points require the destination path to
            // be absolute. When using 'junction', the target argument
            // will automatically be normalized to absolute path.
            let link_type: SymlinkLinkType = 'link_type: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_undefined_or_null() { break 'link_type SymlinkLinkType::Unspecified; }
                    if next_val.is_string() {
                        arguments.eat();
                        let str = next_val.to_bun_string(ctx)?;
                        let lt = if str.eql_comptime("dir") { SymlinkLinkType::Dir }
                            else if str.eql_comptime("file") { SymlinkLinkType::File }
                            else if str.eql_comptime("junction") { SymlinkLinkType::Junction }
                            else {
                                // Build the error before deref() so the format observes a live string
                                // (Zig used `defer str.deref()` — node_fs.zig:1905-1910).
                                let err = ctx.err_invalid_arg_value(format_args!("Symlink type must be one of \"dir\", \"file\", or \"junction\". Received \"{}\"", str)).throw();
                                str.deref();
                                old_path.deinit(); new_path.deinit();
                                return Err(err);
                            };
                        str.deref();
                        break 'link_type lt;
                    }
                    // not a string. fallthrough to auto detect.
                    old_path.deinit(); new_path.deinit();
                    return Err(ctx.err_invalid_arg_value("Symlink type must be one of \"dir\", \"file\", or \"junction\".").throw());
                }
                SymlinkLinkType::Unspecified
            };
            Ok(Symlink {
                target_path: old_path,
                new_path,
                #[cfg(windows)] link_type,
                #[cfg(not(windows))] link_type: { let _ = link_type; () },
            })
        }
    }

    pub struct Readlink {
        pub path: PathLike,
        pub encoding: Encoding,
    }
    impl Readlink {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Readlink> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut encoding = Encoding::Utf8;
            if let Some(val) = arguments.next() {
                arguments.eat();
                match val.js_type() {
                    bun_jsc::JSType::String | bun_jsc::JSType::StringObject | bun_jsc::JSType::DerivedStringObject => {
                        encoding = Encoding::assert(val, ctx, encoding)?;
                    }
                    _ => if val.is_object() { encoding = get_encoding(val, ctx, encoding)?; }
                }
            }
            Ok(Readlink { path, encoding })
        }
    }

    pub struct Realpath {
        pub path: PathLike,
        pub encoding: Encoding,
    }
    impl Realpath {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Realpath> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut encoding = Encoding::Utf8;
            if let Some(val) = arguments.next() {
                arguments.eat();
                match val.js_type() {
                    bun_jsc::JSType::String | bun_jsc::JSType::StringObject | bun_jsc::JSType::DerivedStringObject => {
                        encoding = Encoding::assert(val, ctx, encoding)?;
                    }
                    _ => if val.is_object() { encoding = get_encoding(val, ctx, encoding)?; }
                }
            }
            Ok(Realpath { path, encoding })
        }
    }

    pub(super) fn get_encoding(object: JSValue, global_object: &JSGlobalObject, default: Encoding) -> JsResult<Encoding> {
        if let Some(value) = object.fast_get(global_object, bun_jsc::BuiltinName::Encoding)? {
            return Encoding::assert(value, global_object, default);
        }
        Ok(default)
    }

    pub struct Unlink {
        pub path: PathLike,
    }
    impl Unlink {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Unlink> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            Ok(Unlink { path })
        }
    }

    pub type Rm = RmDir;

    pub struct RmDir {
        pub path: PathLike,
        pub force: bool,
        pub max_retries: u32,
        pub recursive: bool,
        pub retry_delay: c_uint,
    }
    impl Default for RmDir {
        fn default() -> Self { Self { path: PathLike::default(), force: false, max_retries: 0, recursive: false, retry_delay: 100 } }
    }
    impl RmDir {
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<RmDir> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut recursive = false;
            let mut force = false;
            let mut max_retries: u32 = 0;
            let mut retry_delay: c_uint = 100;
            if let Some(val) = arguments.next() {
                arguments.eat();
                if val.is_object() {
                    if let Some(boolean) = val.get(ctx, "recursive")? {
                        if boolean.is_boolean() { recursive = boolean.to_boolean(); }
                        else { path.deinit(); return Err(ctx.throw_invalid_arguments("The \"options.recursive\" property must be of type boolean.")); }
                    }
                    if let Some(boolean) = val.get(ctx, "force")? {
                        if boolean.is_boolean() { force = boolean.to_boolean(); }
                        else { path.deinit(); return Err(ctx.throw_invalid_arguments("The \"options.force\" property must be of type boolean.")); }
                    }
                    if let Some(delay) = val.get(ctx, "retryDelay")? {
                        retry_delay = c_uint::try_from(validators::validate_integer(ctx, delay, "options.retryDelay", Some(0), Some(c_uint::MAX as i64))?).unwrap();
                    }
                    if let Some(retries) = val.get(ctx, "maxRetries")? {
                        max_retries = u32::try_from(validators::validate_integer(ctx, retries, "options.maxRetries", Some(0), Some(u32::MAX as i64))?).unwrap();
                    }
                } else if !val.is_undefined() {
                    path.deinit();
                    return Err(ctx.throw_invalid_arguments("The \"options\" argument must be of type object."));
                }
            }
            Ok(RmDir { path, recursive, force, max_retries, retry_delay })
        }
    }

    /// https://github.com/nodejs/node/blob/master/lib/fs.js#L1285
    pub struct Mkdir {
        pub path: PathLike,
        /// Indicates whether parent folders should be created.
        /// If a folder was created, the path to the first created folder will be returned.
        /// @default false
        pub recursive: bool,
        /// A file mode. If a string is passed, it is parsed as an octal integer. If not specified
        pub mode: Mode,
        /// If set to true, the return value is never set to a string
        pub always_return_none: bool,
    }
    impl Mkdir {
        pub const DEFAULT_MODE: Mode = 0o777;
    }
    impl Default for Mkdir {
        fn default() -> Self { Self { path: PathLike::default(), recursive: false, mode: Self::DEFAULT_MODE, always_return_none: false } }
    }
    impl Mkdir {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Mkdir> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut recursive = false;
            let mut mode: Mode = 0o777;
            if let Some(val) = arguments.next() {
                arguments.eat();
                if val.is_object() {
                    if let Some(b) = val.get_boolean_strict(ctx, "recursive")? { recursive = b; }
                    if let Some(mode_) = val.get(ctx, "mode")? {
                        mode = node::mode_from_js(ctx, mode_)?.unwrap_or(mode);
                    }
                }
                if val.is_number() || val.is_string() {
                    mode = node::mode_from_js(ctx, val)?.unwrap_or(mode);
                }
            }
            Ok(Mkdir { path, recursive, mode, always_return_none: false })
        }
    }

    pub struct MkdirTemp {
        pub prefix: PathLike,
        pub encoding: Encoding,
    }
    impl Default for MkdirTemp {
        fn default() -> Self { Self { prefix: PathLike::Buffer(Buffer { buffer: bun_jsc::ArrayBuffer::EMPTY }), encoding: Encoding::Utf8 } }
    }
    impl MkdirTemp {
        pub fn deinit(&self) { self.prefix.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.prefix.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.prefix.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<MkdirTemp> {
            let prefix = PathLike::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_argument_type_value("prefix", "string, Buffer, or URL", arguments.next().unwrap_or(JSValue::UNDEFINED))
            })?;
            let mut encoding = Encoding::Utf8;
            if let Some(val) = arguments.next() {
                arguments.eat();
                match val.js_type() {
                    bun_jsc::JSType::String | bun_jsc::JSType::StringObject | bun_jsc::JSType::DerivedStringObject => {
                        encoding = Encoding::assert(val, ctx, encoding)?;
                    }
                    _ => if val.is_object() { encoding = get_encoding(val, ctx, encoding)?; }
                }
            }
            Ok(MkdirTemp { prefix, encoding })
        }
    }

    pub struct Readdir {
        pub path: PathLike,
        pub encoding: Encoding,
        pub with_file_types: bool,
        pub recursive: bool,
    }
    impl Readdir {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn tag(&self) -> ret::ReaddirTag {
            match self.encoding {
                Encoding::Buffer => ret::ReaddirTag::Buffers,
                _ => if self.with_file_types { ret::ReaddirTag::WithFileTypes } else { ret::ReaddirTag::Files },
            }
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Readdir> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut encoding = Encoding::Utf8;
            let mut with_file_types = false;
            let mut recursive = false;
            if let Some(val) = arguments.next() {
                arguments.eat();
                match val.js_type() {
                    bun_jsc::JSType::String | bun_jsc::JSType::StringObject | bun_jsc::JSType::DerivedStringObject => {
                        encoding = Encoding::assert(val, ctx, encoding)?;
                    }
                    _ => if val.is_object() {
                        encoding = get_encoding(val, ctx, encoding)?;
                        if let Some(r) = val.get_boolean_strict(ctx, "recursive")? { recursive = r; }
                        if let Some(w) = val.get_boolean_strict(ctx, "withFileTypes")? { with_file_types = w; }
                    }
                }
            }
            Ok(Readdir { path, encoding, with_file_types, recursive })
        }
    }

    pub struct Close { pub fd: FD }
    impl Close {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Close> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            Ok(Close { fd })
        }
    }

    pub struct Open {
        pub path: PathLike,
        pub flags: FileSystemFlags,
        pub mode: Mode,
    }
    impl Default for Open { fn default() -> Self { Self { path: PathLike::default(), flags: FileSystemFlags::R, mode: DEFAULT_PERMISSION } } }
    impl Open {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn deinit_and_unprotect(&self) { self.path.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Open> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut flags = FileSystemFlags::R;
            let mut mode: Mode = DEFAULT_PERMISSION;
            if let Some(val) = arguments.next() {
                arguments.eat();
                if val.is_object() {
                    if let Some(flags_) = val.get_truthy(ctx, "flags")? {
                        flags = FileSystemFlags::from_js(ctx, flags_)?.unwrap_or(flags);
                    }
                    if let Some(mode_) = val.get_truthy(ctx, "mode")? {
                        mode = node::mode_from_js(ctx, mode_)?.unwrap_or(mode);
                    }
                } else if !val.is_empty() {
                    if !val.is_undefined_or_null() {
                        // error is handled below
                        flags = FileSystemFlags::from_js(ctx, val)?.unwrap_or(flags);
                    }
                    if let Some(next) = arguments.next_eat() {
                        mode = node::mode_from_js(ctx, next)?.unwrap_or(mode);
                    }
                }
            }
            Ok(Open { path, flags, mode })
        }
    }

    /// Change the file system timestamps of the object referenced by `path`.
    ///
    /// The `atime` and `mtime` arguments follow these rules:
    ///
    /// * Values can be either numbers representing Unix epoch time in seconds,`Date`s, or a numeric string like `'123456789.0'`.
    /// * If the value can not be converted to a number, or is `NaN`, `Infinity` or`-Infinity`, an `Error` will be thrown.
    /// @since v0.4.2
    pub type Utimes = Lutimes;

    pub struct Futimes {
        pub fd: FD,
        pub atime: TimeLike,
        pub mtime: TimeLike,
    }
    impl Futimes {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Futimes> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let atime = node::time_like_from_js(ctx, arguments.next().ok_or_else(|| ctx.throw_invalid_arguments("atime is required"))?)?
                .ok_or_else(|| ctx.throw_invalid_arguments("atime must be a number or a Date"))?;
            arguments.eat();
            let mtime = node::time_like_from_js(ctx, arguments.next().ok_or_else(|| ctx.throw_invalid_arguments("mtime is required"))?)?
                .ok_or_else(|| ctx.throw_invalid_arguments("mtime must be a number or a Date"))?;
            arguments.eat();
            Ok(Futimes { fd, atime, mtime })
        }
    }

    /// Write `buffer` to the file specified by `fd`. If `buffer` is a normal object, it
    /// must have an own `toString` function property.
    ///
    /// `offset` determines the part of the buffer to be written, and `length` is
    /// an integer specifying the number of bytes to write.
    ///
    /// `position` refers to the offset from the beginning of the file where this data
    /// should be written. If `typeof position !== 'number'`, the data will be written
    /// at the current position. See [`pwrite(2)`](http://man7.org/linux/man-pages/man2/pwrite.2.html).
    ///
    /// The callback will be given three arguments `(err, bytesWritten, buffer)` where`bytesWritten` specifies how many _bytes_ were written from `buffer`.
    ///
    /// If this method is invoked as its `util.promisify()` ed version, it returns
    /// a promise for an `Object` with `bytesWritten` and `buffer` properties.
    ///
    /// It is unsafe to use `fs.write()` multiple times on the same file without waiting
    /// for the callback. For this scenario, {@link createWriteStream} is
    /// recommended.
    ///
    /// On Linux, positional writes don't work when the file is opened in append mode.
    /// The kernel ignores the position argument and always appends the data to
    /// the end of the file.
    /// @since v0.0.2
    pub struct Write {
        pub fd: FD,
        pub buffer: StringOrBuffer,
        // pub buffer_val: JSValue,
        pub offset: u64,
        pub length: u64,
        pub position: Option<ReadPosition>,
        pub encoding: Encoding,
    }
    impl Default for Write {
        fn default() -> Self { Self { fd: FD::INVALID, buffer: StringOrBuffer::default(), offset: 0, length: u64::MAX, position: None, encoding: Encoding::Buffer } }
    }
    impl Write {
        pub fn deinit(&self) { self.buffer.deinit(); }
        pub fn deinit_and_unprotect(&mut self) { self.buffer.deinit_and_unprotect(); }
        pub fn to_thread_safe(&mut self) { self.buffer.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Write> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            let buffer_value = arguments.next();
            let bv = buffer_value.ok_or_else(|| ctx.throw_invalid_arguments("data is required"))?;
            let buffer = StringOrBuffer::from_js(ctx, bv)?.ok_or_else(|| ctx.throw_invalid_argument_type_value("buffer", "string or TypedArray", bv))?;
            if bv.is_string() && !bv.is_string_literal() {
                return Err(ctx.throw_invalid_argument_type_value("buffer", "string or TypedArray", bv));
            }
            let mut args = Write {
                fd, buffer,
                encoding: if matches!(buffer, StringOrBuffer::Buffer(_)) { Encoding::Buffer } else { Encoding::Utf8 },
                ..Default::default()
            };
            arguments.eat();
            'parse: {
                let Some(mut current) = arguments.next() else { break 'parse };
                match &args.buffer {
                    // fs.write(fd, buffer[, offset[, length[, position]]], callback)
                    StringOrBuffer::Buffer(_) => {
                        if current.is_undefined_or_null() || current.is_function() { break 'parse; }
                        args.offset = u64::try_from(validators::validate_integer(ctx, current, "offset", Some(0), Some(9007199254740991))?).unwrap();
                        arguments.eat();
                        let Some(next) = arguments.next() else { break 'parse }; current = next;
                        if !(current.is_number() || current.is_big_int()) { break 'parse; }
                        let length = current.to::<i64>();
                        let buf_len = args.buffer.buffer().slice().len();
                        let max_offset = (buf_len as i64).min(i64::MAX);
                        if args.offset as i64 > max_offset {
                            return Err(ctx.throw_range_error(args.offset as f64, bun_jsc::RangeErrorOptions { field_name: b"offset", max: max_offset, ..Default::default() }));
                        }
                        let max_len = ((buf_len as u64 - args.offset) as i64).min(i32::MAX as i64);
                        if length > max_len || length < 0 {
                            return Err(ctx.throw_range_error(length as f64, bun_jsc::RangeErrorOptions { field_name: b"length", min: 0, max: max_len, ..Default::default() }));
                        }
                        args.length = u64::try_from(length).unwrap();
                        arguments.eat();
                        let Some(next) = arguments.next() else { break 'parse }; current = next;
                        if !(current.is_number() || current.is_big_int()) { break 'parse; }
                        let position = current.to::<i64>();
                        if position >= 0 { args.position = Some(position); }
                        arguments.eat();
                    }
                    // fs.write(fd, string[, position[, encoding]], callback)
                    _ => {
                        if current.is_number() {
                            args.position = Some(current.to::<i64>());
                            arguments.eat();
                            let Some(next) = arguments.next() else { break 'parse }; current = next;
                        }
                        if current.is_string() {
                            args.encoding = Encoding::assert(current, ctx, args.encoding)?;
                            arguments.eat();
                        }
                    }
                }
            }
            Ok(args)
        }
    }

    pub struct Read {
        pub fd: FD,
        pub buffer: Buffer,
        pub offset: u64,
        pub length: u64,
        pub position: Option<ReadPosition>,
    }
    impl Read {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) { self.buffer.buffer.value.protect(); }
        pub fn deinit_and_unprotect(&mut self) { self.buffer.buffer.value.unprotect(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Read> {
            // About half of the normalization has already been done. The second half is done in the native code.
            // fs_binding.read(fd, buffer, offset, length, position)

            // fd = getValidatedFd(fd);
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;

            //  validateBuffer(buffer);
            let buffer_value = arguments.next_eat().ok_or_else(||
                // theoretically impossible, argument has been passed already
                ctx.throw_invalid_arguments("buffer is required"))?;
            let buffer: bun_jsc::MarkedArrayBuffer = Buffer::from_js(ctx, buffer_value)
                .ok_or_else(|| ctx.throw_invalid_argument_type_value("buffer", "TypedArray", buffer_value))?;

            let offset_value = arguments.next_eat().unwrap_or(JSValue::NULL);
            // if (offset == null) {
            //   offset = 0;
            // } else {
            //   validateInteger(offset, 'offset', 0);
            // }
            let offset: u64 = if offset_value.is_undefined_or_null() {
                0
            } else {
                u64::try_from(validators::validate_integer(ctx, offset_value, "offset", Some(0), Some(bun_jsc::MAX_SAFE_INTEGER))?).unwrap()
            };

            // length |= 0;
            let length_float: f64 = if let Some(arg) = arguments.next_eat() { arg.to_number(ctx)? } else { 0.0 };

            //   if (length === 0) {
            //     return process.nextTick(function tick() {
            //       callback(null, 0, buffer);
            //     });
            //   }
            if length_float == 0.0 {
                return Ok(Read { fd, buffer, length: 0, offset: 0, position: None });
            }

            let buf_len = buffer.slice().len();
            if buf_len == 0 {
                return Err(ctx.err_invalid_arg_value("The argument 'buffer' is empty and cannot be written.").throw());
            }
            // validateOffsetLengthRead(offset, length, buffer.byteLength);
            if length_float % 1.0 != 0.0 {
                return Err(ctx.throw_range_error(length_float, bun_jsc::RangeErrorOptions { field_name: b"length", msg: b"an integer", ..Default::default() }));
            }
            let length_int: i64 = length_float as i64;
            // Zig (node_fs.zig:2621) compares `i64 > usize` with sign-aware peer
            // widening, so negative `length_int` falls through to the `< 0` arm
            // below. Guard the `as usize` cast so it doesn't wrap-to-huge here.
            if length_int > 0 && length_int as usize > buf_len {
                return Err(ctx.throw_range_error(length_float, bun_jsc::RangeErrorOptions { field_name: b"length", max: (buf_len as i64).min(i64::MAX), ..Default::default() }));
            }
            if i64::try_from(offset).unwrap().saturating_add(length_int) > buf_len as i64 {
                return Err(ctx.throw_range_error(length_float, bun_jsc::RangeErrorOptions { field_name: b"length", max: (buf_len as u64).saturating_sub(offset) as i64, ..Default::default() }));
            }
            if length_int < 0 {
                return Err(ctx.throw_range_error(length_float, bun_jsc::RangeErrorOptions { field_name: b"length", min: 0, ..Default::default() }));
            }
            let length: u64 = length_int as u64;

            // if (position == null) {
            //   position = -1;
            // } else {
            //   validatePosition(position, 'position', length);
            // }
            let position_value = arguments.next_eat().unwrap_or(JSValue::NULL);
            let position_int: i64 = if position_value.is_undefined_or_null() {
                -1
            } else if position_value.is_number() {
                validators::validate_integer(ctx, position_value, "position", Some(-1), Some(bun_jsc::MAX_SAFE_INTEGER))?
            } else if let Some(position) = bun_jsc::JSBigInt::from_js(position_value) {
                // const maxPosition = 2n ** 63n - 1n - BigInt(length)
                let max_position = i64::MAX - length_int;
                if position.order(-1i64) == core::cmp::Ordering::Less || position.order(max_position) == core::cmp::Ordering::Greater {
                    let position_str = position.to_string(ctx)?;
                    let r = Err(ctx.throw_range_error(position_str, bun_jsc::RangeErrorOptions { field_name: b"position", min: -1, max: max_position, ..Default::default() }));
                    position_str.deref();
                    return r;
                }
                position.to_int64()
            } else {
                return Err(ctx.throw_invalid_argument_type_value("position", "number or bigint", position_value));
            };

            // Bun needs `null` to tell the native function if to use pread or read
            let position: Option<ReadPosition> = if position_int >= 0 { Some(position_int) } else { None };

            Ok(Read { fd, buffer, offset, length, position })
        }
    }

    /// Asynchronously reads the entire contents of a file.
    /// @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
    /// If a file descriptor is provided, the underlying file will _not_ be closed automatically.
    /// @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
    /// If a flag is not provided, it defaults to `'r'`.
    pub struct ReadFile {
        pub path: PathOrFileDescriptor,
        pub encoding: Encoding,
        pub offset: BlobSizeType,
        pub max_size: Option<BlobSizeType>,
        pub limit_size_for_javascript: bool,
        pub flag: FileSystemFlags,
        pub signal: Option<AbortSignalRef>,
    }
    impl Default for ReadFile {
        fn default() -> Self {
            Self { path: PathOrFileDescriptor::default(), encoding: Encoding::Utf8, offset: 0, max_size: None, limit_size_for_javascript: false, flag: FileSystemFlags::R, signal: None }
        }
    }
    impl ReadFile {
        pub fn deinit(&self) {
            self.path.deinit();
            if let Some(signal) = &self.signal { signal.pending_activity_unref(); signal.unref(); }
        }
        pub fn deinit_and_unprotect(&self) {
            self.path.deinit_and_unprotect();
            if let Some(signal) = &self.signal { signal.pending_activity_unref(); signal.unref(); }
        }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<ReadFile> {
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or a file descriptor"))?;
            let mut encoding = Encoding::Buffer;
            let mut flag = FileSystemFlags::R;
            let mut abort_signal = scopeguard::guard(None::<AbortSignalRef>, |s| {
                if let Some(signal) = s { signal.pending_activity_unref(); signal.unref(); }
            });
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_string() {
                    encoding = Encoding::assert(arg, ctx, encoding)?;
                } else if arg.is_object() {
                    encoding = get_encoding(arg, ctx, encoding)?;
                    if let Some(flag_) = arg.get_truthy(ctx, "flag")? {
                        flag = FileSystemFlags::from_js(ctx, flag_)?.ok_or_else(|| { path.deinit(); ctx.throw_invalid_arguments("Invalid flag") })?;
                    }
                    if let Some(value) = arg.get_truthy(ctx, "signal")? {
                        if let Some(signal) = AbortSignal::from_js(value) {
                            *abort_signal = Some(signal.ref_());
                            signal.pending_activity_ref();
                        } else {
                            path.deinit();
                            return Err(ctx.throw_invalid_argument_type_value("signal", "AbortSignal", value));
                        }
                    }
                }
            }
            let abort_signal = scopeguard::ScopeGuard::into_inner(abort_signal);
            Ok(ReadFile { path, encoding, flag, limit_size_for_javascript: true, signal: abort_signal, ..Default::default() })
        }
        pub fn aborted(&self) -> bool {
            if let Some(signal) = &self.signal { return signal.aborted(); }
            false
        }
    }

    pub struct WriteFile {
        pub encoding: Encoding,
        pub flag: FileSystemFlags,
        pub mode: Mode,
        pub file: PathOrFileDescriptor,
        pub flush: bool,
        /// Encoded at the time of construction.
        pub data: StringOrBuffer,
        pub dirfd: FD,
        pub signal: Option<AbortSignalRef>,
    }
    impl WriteFile {
        pub fn deinit(&self) {
            self.file.deinit();
            self.data.deinit();
            if let Some(signal) = &self.signal { signal.pending_activity_unref(); signal.unref(); }
        }
        pub fn to_thread_safe(&mut self) { self.file.to_thread_safe(); self.data.to_thread_safe(); }
        pub fn deinit_and_unprotect(&mut self) {
            self.file.deinit_and_unprotect();
            self.data.deinit_and_unprotect();
            if let Some(signal) = &self.signal { signal.pending_activity_unref(); signal.unref(); }
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<WriteFile> {
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or a file descriptor"))?;
            let data_value = arguments.next_eat().ok_or_else(|| { path.deinit(); ctx.throw_invalid_arguments("data is required") })?;
            let mut encoding = Encoding::Buffer;
            let mut flag = FileSystemFlags::W;
            let mut mode: Mode = DEFAULT_PERMISSION;
            let mut abort_signal = scopeguard::guard(None::<AbortSignalRef>, |s| {
                if let Some(signal) = s { signal.pending_activity_unref(); signal.unref(); }
            });
            let mut flush = false;
            if data_value.is_string() { encoding = Encoding::Utf8; }
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_string() {
                    encoding = Encoding::assert(arg, ctx, encoding)?;
                } else if arg.is_object() {
                    encoding = get_encoding(arg, ctx, encoding)?;
                    if let Some(flag_) = arg.get_truthy(ctx, "flag")? {
                        flag = FileSystemFlags::from_js(ctx, flag_)?.ok_or_else(|| { path.deinit(); ctx.throw_invalid_arguments("Invalid flag") })?;
                    }
                    if let Some(mode_) = arg.get_truthy(ctx, "mode")? {
                        mode = node::mode_from_js(ctx, mode_)?.unwrap_or(mode);
                    }
                    if let Some(value) = arg.get_truthy(ctx, "signal")? {
                        if let Some(signal) = AbortSignal::from_js(value) {
                            *abort_signal = Some(signal.ref_());
                            signal.pending_activity_ref();
                        } else {
                            path.deinit();
                            return Err(ctx.throw_invalid_argument_type_value("signal", "AbortSignal", value));
                        }
                    }
                    if let Some(flush_) = arg.get_optional::<JSValue>(ctx, "flush")? {
                        if flush_.is_boolean() || flush_.is_undefined_or_null() {
                            flush = flush_ == JSValue::TRUE;
                        } else {
                            path.deinit();
                            return Err(ctx.throw_invalid_argument_type_value("flush", "boolean", flush_));
                        }
                    }
                }
            }
            // String objects not allowed (typeof new String("hi") === "object")
            // https://github.com/nodejs/node/blob/6f946c95b9da75c70e868637de8161bc8d048379/lib/internal/fs/utils.js#L916
            let allow_string_object = false;
            // the pattern in node_fs.zig is to call toThreadSafe after Arguments.*.fromJS
            let is_async = false;
            let data = StringOrBuffer::from_js_with_encoding_maybe_async(ctx, data_value, encoding, is_async, allow_string_object)?
                .ok_or_else(|| { path.deinit(); ctx.err_invalid_arg_type("The \"data\" argument must be of type string or an instance of Buffer, TypedArray, or DataView").throw() })?;
            let abort_signal = scopeguard::ScopeGuard::into_inner(abort_signal);
            Ok(WriteFile { file: path, encoding, flag, mode, data, dirfd: FD::cwd(), signal: abort_signal, flush })
        }
        pub fn aborted(&self) -> bool {
            if let Some(signal) = &self.signal { return signal.aborted(); }
            false
        }
    }

    pub type AppendFile = WriteFile;

    pub struct OpenDir {
        pub path: PathLike,
        pub encoding: Encoding,
        /// Number of directory entries that are buffered internally when reading from the directory. Higher values lead to better performance but higher memory usage. Default: 32
        pub buffer_size: c_int,
    }
    impl OpenDir {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<OpenDir> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut encoding = Encoding::Buffer;
            let mut buffer_size: c_int = 32;
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_string() {
                    encoding = Encoding::assert(arg, ctx, encoding).unwrap_or(encoding);
                } else if arg.is_object() {
                    // TODO(port): Zig calls getEncoding(arg, ctx) with 2 args here (bug?); preserve behavior
                    if let Ok(e) = get_encoding(arg, ctx, encoding) { encoding = e; }
                    if let Some(bs) = arg.get(ctx, "bufferSize")? {
                        buffer_size = bs.to_int32();
                        if buffer_size < 0 { path.deinit(); return Err(ctx.throw_invalid_arguments("bufferSize must be > 0")); }
                    }
                }
            }
            Ok(OpenDir { path, encoding, buffer_size })
        }
    }

    pub struct Exists { pub path: Option<PathLike> }
    impl Exists {
        pub fn deinit(&self) { if let Some(p) = &self.path { p.deinit(); } }
        pub fn to_thread_safe(&mut self) { if let Some(p) = &mut self.path { p.to_thread_safe(); } }
        pub fn deinit_and_unprotect(&mut self) { if let Some(p) = &mut self.path { p.deinit_and_unprotect(); } }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Exists> {
            Ok(Exists { path: PathLike::from_js(ctx, arguments)? })
        }
    }

    pub struct Access {
        pub path: PathLike,
        pub mode: FileSystemFlags,
    }
    impl Access {
        pub fn deinit(&self) { self.path.deinit(); }
        pub fn to_thread_safe(&mut self) { self.path.to_thread_safe(); }
        pub fn deinit_and_unprotect(&mut self) { self.path.deinit_and_unprotect(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Access> {
            let path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("path must be a string or TypedArray"))?;
            let mut mode = FileSystemFlags::R;
            if let Some(arg) = arguments.next() {
                arguments.eat();
                mode = FileSystemFlags::from_js_number_only(ctx, arg, FileSystemFlags::Kind::Access)?;
            }
            Ok(Access { path, mode })
        }
    }

    pub struct FdataSync { pub fd: FD }
    impl FdataSync {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<FdataSync> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            Ok(FdataSync { fd })
        }
    }

    pub struct CopyFile {
        pub src: PathLike,
        pub dest: PathLike,
        pub mode: constants::Copyfile,
    }
    impl CopyFile {
        pub fn deinit(&self) { self.src.deinit(); self.dest.deinit(); }
        pub fn to_thread_safe(&mut self) { self.src.to_thread_safe(); self.dest.to_thread_safe(); }
        pub fn deinit_and_unprotect(&self) { self.src.deinit_and_unprotect(); self.dest.deinit_and_unprotect(); }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<CopyFile> {
            let src = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("src must be a string or TypedArray"))?;
            let dest = match PathLike::from_js(ctx, arguments)? {
                Some(p) => p,
                None => { src.deinit(); return Err(ctx.throw_invalid_arguments("dest must be a string or TypedArray")); }
            };
            let mut mode = constants::Copyfile::from_raw(0);
            if let Some(arg) = arguments.next() {
                arguments.eat();
                mode = constants::Copyfile::from_raw(FileSystemFlags::from_js_number_only(ctx, arg, FileSystemFlags::Kind::CopyFile)?.as_int());
            }
            Ok(CopyFile { src, dest, mode })
        }
    }

    #[derive(Copy, Clone)]
    pub struct CpFlags {
        pub mode: constants::Copyfile,
        pub recursive: bool,
        pub error_on_exist: bool,
        pub force: bool,
        pub deinit_paths: bool,
    }
    impl Default for CpFlags {
        fn default() -> Self { Self { mode: constants::Copyfile::from_raw(0), recursive: false, error_on_exist: false, force: false, deinit_paths: true } }
    }

    pub struct Cp {
        pub src: PathLike,
        pub dest: PathLike,
        pub flags: CpFlags,
    }
    impl Cp {
        pub fn deinit(&self) {
            if self.flags.deinit_paths { self.src.deinit(); self.dest.deinit(); }
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Cp> {
            let src = PathLike::from_js(ctx, arguments)?.ok_or_else(|| ctx.throw_invalid_arguments("src must be a string or TypedArray"))?;
            let dest = match PathLike::from_js(ctx, arguments)? {
                Some(p) => p,
                None => { src.deinit(); return Err(ctx.throw_invalid_arguments("dest must be a string or TypedArray")); }
            };
            let mut recursive = false;
            let mut error_on_exist = false;
            let mut force = true;
            let mut mode: i32 = 0;
            if let Some(arg) = arguments.next() { arguments.eat(); recursive = arg.to_boolean(); }
            if let Some(arg) = arguments.next() { arguments.eat(); error_on_exist = arg.to_boolean(); }
            if let Some(arg) = arguments.next() { arguments.eat(); force = arg.to_boolean(); }
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_number() { mode = arg.coerce::<i32>(ctx)?; }
            }
            Ok(Cp { src, dest, flags: CpFlags {
                mode: constants::Copyfile::from_raw(mode),
                recursive, error_on_exist, force, deinit_paths: true,
            } })
        }
    }

    pub struct WriteEv {
        pub fd: FD,
        pub buffers: Box<[ArrayBuffer]>,
        pub position: ReadPosition,
    }

    pub struct ReadEv {
        pub fd: FD,
        pub buffers: Box<[ArrayBuffer]>,
        pub position: ReadPosition,
    }

    pub type UnwatchFile = ();
    // Watcher / StatWatcher are local stand-in modules until `node.rs` wires
    // the real `node_fs_watcher` / `node_fs_stat_watcher` siblings; see the
    // module docs at the top of this file.
    pub type Watch = super::Watcher::Arguments;
    pub type WatchFile = super::StatWatcher::Arguments;

    pub struct Fsync { pub fd: FD }
    impl Fsync {
        pub fn deinit(&self) {}
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Fsync> {
            let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let fd = FD::from_js_validated(fd_value, ctx)?.ok_or_else(|| throw_invalid_fd_error(ctx, fd_value))?;
            Ok(Fsync { fd })
        }
    }
}
pub use args as Arguments;

// ──────────────────────────────────────────────────────────────────────────
// Return types
// ──────────────────────────────────────────────────────────────────────────

pub enum StatOrNotFound {
    Stats(Stats),
    NotFound,
}
impl StatOrNotFound {
    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JSValue {
        match self {
            StatOrNotFound::Stats(s) => s.to_js(global_object),
            StatOrNotFound::NotFound => JSValue::UNDEFINED,
        }
    }
    pub fn to_js_newly_created(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            StatOrNotFound::Stats(s) => s.to_js_newly_created(global_object),
            StatOrNotFound::NotFound => Ok(JSValue::UNDEFINED),
        }
    }
}

pub enum StringOrUndefined {
    String(BunString),
    None,
}
impl StringOrUndefined {
    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            StringOrUndefined::String(s) => s.transfer_to_js(global_object),
            StringOrUndefined::None => Ok(JSValue::UNDEFINED),
        }
    }
}

/// For use in `Return`'s definitions to act as `void` while returning `null` to JavaScript
pub struct Null;
impl Null {
    pub fn to_js(&self, _: &JSGlobalObject) -> JSValue { JSValue::NULL }
}

pub mod ret {
    use super::*;

    pub type Access = Null;
    pub type AppendFile = ();
    pub type Close = ();
    pub type CopyFile = ();
    pub type Cp = ();
    pub type Exists = bool;
    pub type Fchmod = ();
    pub type Chmod = ();
    pub type Fchown = ();
    pub type Fdatasync = ();
    pub type Fstat = Stats;
    pub type Rm = ();
    pub type Fsync = ();
    pub type Ftruncate = ();
    pub type Futimes = ();
    pub type Lchmod = ();
    pub type Lchown = ();
    pub type Link = ();
    pub type Lstat = StatOrNotFound;
    pub type Mkdir = StringOrUndefined;
    pub type Mkdtemp = ZigString;
    pub type Open = FD;
    pub type WriteFile = ();
    pub type Readv = Read;
    pub type StatFS = node::StatFS;

    pub struct Read { pub bytes_read: u64 /* u52 */ }
    impl Read {
        pub fn to_js(&self, _: &JSGlobalObject) -> JSValue { JSValue::js_number_from_uint64(self.bytes_read) }
    }

    pub struct ReadPromise {
        pub bytes_read: u64,
        pub buffer_val: JSValue,
    }
    impl ReadPromise {
        const FIELD_BYTES_READ: ZigString = ZigString::init_static(b"bytesRead");
        const FIELD_BUFFER: ZigString = ZigString::init_static(b"buffer");
        pub fn to_js(&self, ctx: &JSGlobalObject) -> JsResult<JSValue> {
            let _unprotect = scopeguard::guard(self.buffer_val, |v| if !v.is_empty_or_undefined_or_null() { v.unprotect() });
            JSValue::create_object_2(
                ctx,
                &Self::FIELD_BYTES_READ,
                &Self::FIELD_BUFFER,
                JSValue::js_number_from_uint64(self.bytes_read.min((1u64 << 52) - 1)),
                self.buffer_val,
            )
        }
    }

    pub struct WritePromise {
        pub bytes_written: u64,
        pub buffer: StringOrBuffer,
        pub buffer_val: JSValue,
    }
    impl WritePromise {
        const FIELD_BYTES_WRITTEN: ZigString = ZigString::init_static(b"bytesWritten");
        const FIELD_BUFFER: ZigString = ZigString::init_static(b"buffer");
        // Excited for the issue that's like "cannot read file bigger than 2 GB"
        pub fn to_js(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            let _unprotect = scopeguard::guard(self.buffer_val, |v| if !v.is_empty_or_undefined_or_null() { v.unprotect() });
            JSValue::create_object_2(
                global_object,
                &Self::FIELD_BYTES_WRITTEN,
                &Self::FIELD_BUFFER,
                JSValue::js_number_from_uint64(self.bytes_written.min((1u64 << 52) - 1)),
                if matches!(self.buffer, StringOrBuffer::Buffer(_)) { self.buffer_val } else { self.buffer.to_js(global_object) },
            )
        }
    }

    pub struct Write { pub bytes_written: u64 /* u52 */ }
    impl Write {
        // Excited for the issue that's like "cannot read file bigger than 2 GB"
        pub fn to_js(&self, _: &JSGlobalObject) -> JSValue { JSValue::js_number_from_uint64(self.bytes_written) }
    }

    #[derive(Copy, Clone, PartialEq, Eq)]
    pub enum ReaddirTag { WithFileTypes, Buffers, Files }

    pub enum Readdir {
        WithFileTypes(Box<[Dirent]>),
        Buffers(Box<[Buffer]>),
        Files(Box<[BunString]>),
    }
    impl Readdir {
        pub fn to_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            match self {
                Readdir::WithFileTypes(items) => {
                    let array = JSValue::create_empty_array(global_object, items.len())?;
                    let mut previous_jsstring: Option<*mut bun_jsc::JSString> = None;
                    for (i, item) in items.iter().enumerate() {
                        let res = item.to_js_newly_created(global_object, &mut previous_jsstring)?;
                        array.put_index(global_object, i as u32, res)?;
                    }
                    // items dropped here (auto free)
                    Ok(array)
                }
                Readdir::Buffers(items) => {
                    let v = JSValue::from_any(global_object, &items[..]);
                    drop(items);
                    v
                }
                Readdir::Files(items) => {
                    // automatically freed
                    JSValue::from_any(global_object, &items[..])
                }
            }
        }
    }

    pub type ReadFile = StringOrBuffer;

    pub enum ReadFileWithOptions {
        String(Box<[u8]>),
        TranscodedString(BunString),
        Buffer(Buffer),
        NullTerminated(bun_core::ZBox), // [:0]const u8 owned
    }

    pub type Readlink = StringOrBuffer;
    pub type Realpath = StringOrBuffer;
    pub type RealpathNative = Realpath;
    pub type Rename = ();
    pub type Rmdir = ();
    pub type Stat = StatOrNotFound;
    pub type Symlink = ();
    pub type Truncate = ();
    pub type Unlink = ();
    pub type UnwatchFile = ();
    pub type Watch = JSValue;
    pub type WatchFile = JSValue;
    pub type Utimes = ();
    pub type Chown = ();
    pub type Lutimes = ();
    pub type Writev = Write;
}
pub use ret as Return;

// ──────────────────────────────────────────────────────────────────────────
// NodeFS — Bun's implementation of the Node.js "fs" module
// https://nodejs.org/api/fs.html
// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/fs.d.ts
// ──────────────────────────────────────────────────────────────────────────

pub struct NodeFS {
    /// Buffer to store a temporary file path that might appear in a returned error message.
    ///
    /// We want to avoid allocating a new path buffer for every error message so that jsc can clone + GC it.
    /// That means a stack-allocated buffer won't suffice. Instead, we re-use
    /// the heap allocated buffer on the NodeFS struct
    pub sync_error_buf: PathBuffer, // align(@alignOf(u16))
    pub vm: Option<NonNull<VirtualMachine>>,
}

impl Default for NodeFS {
    fn default() -> Self { Self { sync_error_buf: PathBuffer::uninit(), vm: None } }
}

// `pub type ReturnType = ret;` (Zig: `pub const ReturnType = Return;`) — Rust
// inherent `type` aliases can't name a module. Expose it as a `pub use` at the
// containing module level instead so `NodeFS::ReturnType::Foo` callers (none
// yet in-tree) keep working via `node::fs::ReturnType::Foo`.
pub use ret as ReturnType;

impl NodeFS {
    pub fn access(&mut self, args: &args::Access, _: Flavor) -> Maybe<ret::Access> {
        let path: OSPathSliceZ = if args.path.slice().is_empty() {
            os_path_literal_empty()
        } else {
            args.path.os_path_kernel32(&mut self.sync_error_buf)
        };
        match Syscall::access(path, args.mode.as_int()) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(_) => Maybe::Ok(Null),
        }
    }

    pub fn append_file(&mut self, args: &args::AppendFile, _: Flavor) -> Maybe<ret::AppendFile> {
        let mut data = args.data.slice();
        match &args.file {
            PathOrFileDescriptor::Fd(fd) => {
                while !data.is_empty() {
                    let written = match Syscall::write(*fd, data) {
                        Maybe::Ok(result) => result,
                        Maybe::Err(err) => return Maybe::Err(err),
                    };
                    data = &data[written..];
                }
                Maybe::Ok(())
            }
            PathOrFileDescriptor::Path(path_) => {
                let path = path_.slice_z(&mut self.sync_error_buf);
                let fd = match Syscall::open(path, FileSystemFlags::A.as_int(), args.mode) {
                    Maybe::Ok(result) => result,
                    Maybe::Err(err) => return Maybe::Err(err),
                };
                let _close = scopeguard::guard(fd, |fd| fd.close());
                while !data.is_empty() {
                    let written = match Syscall::write(fd, data) {
                        Maybe::Ok(result) => result,
                        Maybe::Err(err) => return Maybe::Err(err),
                    };
                    data = &data[written..];
                }
                Maybe::Ok(())
            }
        }
    }

    pub fn close(&mut self, args: &args::Close, _: Flavor) -> Maybe<ret::Close> {
        if let Some(err) = args.fd.close_allowing_bad_file_descriptor(None) {
            Maybe::Err(err)
        } else {
            Maybe::Ok(())
        }
    }

    pub fn uv_close(&mut self, args: &args::Close, rc: i64) -> Maybe<ret::Close> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::close, fd: args.fd, from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(())
    }

    // since we use a 64 KB stack buffer, we should not let this function get inlined
    #[inline(never)]
    pub fn copy_file_using_read_write_loop(
        src: &ZStr, dest: &ZStr, src_fd: FD, dest_fd: FD, stat_size: usize, wrote: &mut u64,
    ) -> Maybe<ret::CopyFile> {
        let mut stack_buf = [0u8; 64 * 1024];
        let mut buf_to_free: Vec<u8> = Vec::new();
        let mut buf: &mut [u8] = &mut stack_buf;

        'maybe_allocate_large_temp_buf: {
            if stat_size > stack_buf.len() * 16 {
                // Don't allocate more than 8 MB at a time
                let clamped_size: usize = stat_size.min(8 * 1024 * 1024);
                let Ok(()) = (|| { buf_to_free.try_reserve_exact(clamped_size)?; buf_to_free.resize(clamped_size, 0); Ok::<(), std::collections::TryReserveError>(()) })()
                    else { break 'maybe_allocate_large_temp_buf };
                buf = &mut buf_to_free[..];
            }
        }
        // buf_to_free dropped at scope exit

        let mut remain = stat_size.max(0) as u64;
        // VERIFY-FIX(round1): Zig `while (cond) {} else {}` runs the else only when
        // the loop exits because `cond` became false — never on `break`. The
        // `if remain == 0` check below was wrong: `break 'toplevel` after
        // `remain` had already saturated to 0 would still enter the else. Track
        // an explicit `broke` flag instead.
        let mut broke = false;
        'toplevel: while remain > 0 {
            let amt = match Syscall::read(src_fd, &mut buf[..(buf.len() as u64).min(remain) as usize]) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(if !src.is_empty() { err.with_path(src) } else { err }),
            };
            // 0 == EOF
            if amt == 0 { broke = true; break 'toplevel; }
            *wrote += amt as u64;
            remain = remain.saturating_sub(amt as u64);

            let mut slice = &buf[..amt];
            while !slice.is_empty() {
                let written = match Syscall::write(dest_fd, slice) {
                    Maybe::Ok(result) => result,
                    Maybe::Err(err) => return Maybe::Err(if !dest.is_empty() { err.with_path(dest) } else { err }),
                };
                if written == 0 { broke = true; break 'toplevel; }
                slice = &slice[written..];
            }
        }
        if !broke {
            'outer: loop {
                let amt = match Syscall::read(src_fd, buf) {
                    Maybe::Ok(result) => result,
                    Maybe::Err(err) => return Maybe::Err(if !src.is_empty() { err.with_path(src) } else { err }),
                };
                // we don't know the size
                // so we just go forever until we get an EOF
                if amt == 0 { break; }
                *wrote += amt as u64;

                let mut slice = &buf[..amt];
                while !slice.is_empty() {
                    let written = match Syscall::write(dest_fd, slice) {
                        Maybe::Ok(result) => result,
                        Maybe::Err(err) => return Maybe::Err(if !dest.is_empty() { err.with_path(dest) } else { err }),
                    };
                    slice = &slice[written..];
                    if written == 0 { break 'outer; }
                }
            }
        }

        Maybe::Ok(())
    }

    // copy_file_range() is frequently not supported across devices, such as tmpfs.
    // This is relevant for `bun install`
    // However, sendfile() is supported across devices.
    // Only on Linux. There are constraints though. It cannot be used if the file type does not support
    #[inline(never)]
    pub fn copy_file_using_sendfile_on_linux_with_read_write_fallback(
        src: &ZStr, dest: &ZStr, src_fd: FD, dest_fd: FD, stat_size: usize, wrote: &mut u64,
    ) -> Maybe<ret::CopyFile> {
        loop {
            let amt = match sys::sendfile(src_fd, dest_fd, i32::MAX as usize - 1) {
                Maybe::Err(_) => {
                    return Self::copy_file_using_read_write_loop(src, dest, src_fd, dest_fd, stat_size, wrote);
                }
                Maybe::Ok(amount) => amount,
            };
            *wrote += amt as u64;
            if amt == 0 { break; }
        }
        Maybe::Ok(())
    }

    pub fn copy_file(&mut self, args: &args::CopyFile, _: Flavor) -> Maybe<ret::CopyFile> {
        match self.copy_file_inner(args) {
            Maybe::Ok(_) => Maybe::Ok(()),
            Maybe::Err(err) => Maybe::Err(sys::Error {
                errno: err.errno,
                syscall: sys::Tag::copyfile,
                path: args.src.slice().into(),
                dest: args.dest.slice().into(),
                ..Default::default()
            }),
        }
    }

    /// https://github.com/libuv/libuv/pull/2233
    /// https://github.com/pnpm/pnpm/issues/2761
    /// https://github.com/libuv/libuv/pull/2578
    /// https://github.com/nodejs/node/issues/34624
    fn copy_file_inner(&mut self, args: &args::CopyFile) -> Maybe<ret::CopyFile> {
        // TODO: do we need to fchown?
        #[cfg(target_os = "macos")]
        {
            let mut src_buf = PathBuffer::uninit();
            let mut dest_buf = PathBuffer::uninit();
            let src = args.src.slice_z(&mut src_buf);
            let dest = args.dest.slice_z(&mut dest_buf);

            if args.mode.is_force_clone() {
                // https://www.manpagez.com/man/2/clonefile/
                // SAFETY: src/dest are NUL-terminated; clonefile is the libc FFI
                return Maybe::<ret::CopyFile>::errno_sys_p(unsafe { bun_sys::c::clonefile(src.as_ptr(), dest.as_ptr(), 0) }, sys::Tag::copyfile, src)
                    .unwrap_or(Maybe::Ok(()));
            } else {
                let stat_ = match Syscall::stat(src) {
                    Maybe::Ok(result) => result,
                    Maybe::Err(err) => return Maybe::Err(err.with_path(src)),
                };

                if !sys::S::ISREG(stat_.mode) {
                    return Maybe::Err(sys::Error { errno: SystemErrno::ENOTSUP as _, syscall: sys::Tag::copyfile, ..Default::default() });
                }

                // 64 KB is about the break-even point for clonefile() to be worth it
                // at least, on an M1 with an NVME SSD.
                if stat_.size > 128 * 1024 {
                    if !args.mode.shouldnt_overwrite() {
                        // clonefile() will fail if it already exists
                        let _ = Syscall::unlink(dest);
                    }
                    // SAFETY: src/dest are NUL-terminated; clonefile is the libc FFI
                    if Maybe::<ret::CopyFile>::errno_sys_p(unsafe { bun_sys::c::clonefile(src.as_ptr(), dest.as_ptr(), 0) }, sys::Tag::copyfile, src).is_none() {
                        let _ = Syscall::chmod(dest, stat_.mode);
                        return Maybe::Ok(());
                    }
                } else {
                    let src_fd = match Syscall::open(src, sys::O::RDONLY, 0o644) {
                        Maybe::Ok(result) => result,
                        Maybe::Err(err) => return Maybe::Err(err.with_path(args.src.slice())),
                    };
                    let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

                    let mut flags: Mode = sys::O::CREAT | sys::O::WRONLY;
                    // VERIFY-FIX(round1): was `usize` then passed as `&mut (wrote as u64)` —
                    // that wrote into a discarded temporary so the deferred ftruncate
                    // always saw 0. The scopeguard variant also double-borrowed `wrote`.
                    // The Zig `defer` runs after `copy_file_using_read_write_loop` returns
                    // into this scope; there are no early returns between open(dest) and
                    // that call, so inlining the cleanup after is equivalent.
                    let mut wrote: u64 = 0;
                    if args.mode.shouldnt_overwrite() { flags |= sys::O::EXCL; }

                    let dest_fd = match Syscall::open(dest, flags, DEFAULT_PERMISSION) {
                        Maybe::Ok(result) => result,
                        Maybe::Err(err) => return Maybe::Err(err.with_path(args.dest.slice())),
                    };

                    let result = Self::copy_file_using_read_write_loop(src, dest, src_fd, dest_fd, stat_.size.max(0) as usize, &mut wrote);
                    let _ = Syscall::ftruncate(dest_fd, (wrote & ((1u64 << 63) - 1)) as i64);
                    let _ = Syscall::fchmod(dest_fd, stat_.mode);
                    dest_fd.close();
                    return result;
                }
            }

            // we fallback to copyfile() when the file is > 128 KB and clonefile fails
            // clonefile() isn't supported on all devices
            // nor is it supported across devices
            let mut mode: u32 = bun_sys::c::COPYFILE_ACL | bun_sys::c::COPYFILE_DATA;
            if args.mode.shouldnt_overwrite() { mode |= bun_sys::c::COPYFILE_EXCL; }
            // SAFETY: src/dest are NUL-terminated; copyfile(3) is the libc FFI
            return Maybe::<ret::CopyFile>::errno_sys_p(unsafe { bun_sys::c::copyfile(src.as_ptr(), dest.as_ptr(), core::ptr::null_mut(), mode) }, sys::Tag::copyfile, src)
                .unwrap_or(Maybe::Ok(()));
        }

        #[cfg(target_os = "freebsd")]
        {
            let mut src_buf = PathBuffer::uninit();
            let mut dest_buf = PathBuffer::uninit();
            let src = args.src.slice_z(&mut src_buf);
            let dest = args.dest.slice_z(&mut dest_buf);

            if args.mode.is_force_clone() {
                return Maybe::Err(sys::Error { errno: SystemErrno::EOPNOTSUPP as _, syscall: sys::Tag::copyfile, ..Default::default() });
            }

            let src_fd = match Syscall::open(src, sys::O::RDONLY, 0) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err.with_path(args.src.slice())),
            };
            let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

            let stat_ = match Syscall::fstat(src_fd) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err),
            };
            if !sys::S::ISREG(stat_.mode) {
                return Maybe::Err(sys::Error { errno: SystemErrno::EOPNOTSUPP as _, syscall: sys::Tag::copyfile, ..Default::default() });
            }

            let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
            if args.mode.shouldnt_overwrite() { flags |= sys::O::EXCL; }
            let dest_fd = match Syscall::open(dest, flags, DEFAULT_PERMISSION) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err),
            };
            let _close_dest = scopeguard::guard(dest_fd, |fd| fd.close());

            // Don't O_TRUNC at open: if src and dest resolve to the same
            // inode, that would zero the file before the first read. Match
            // Node by checking inodes after both are open and refusing.
            if let Maybe::Ok(dst_stat) = Syscall::fstat(dest_fd) {
                if stat_.ino == dst_stat.ino && stat_.dev == dst_stat.dev {
                    return Maybe::Err(sys::Error {
                        errno: SystemErrno::EINVAL as _, syscall: sys::Tag::copyfile,
                        path: args.src.slice().into(), ..Default::default()
                    });
                }
            }
            let _ = Syscall::ftruncate(dest_fd, 0);

            // FreeBSD 13+ has copy_file_range(2). Try the kernel-side copy
            // first; fall back to read/write on cross-device or unsupported
            // fd types. std.c declares it returning usize on FreeBSD, so
            // bitcast to isize before getErrno.
            let mut off_in: i64 = 0;
            let mut off_out: i64 = 0;
            'cfr: loop {
                // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                let rc: isize = unsafe { sys::freebsd::copy_file_range(src_fd.native(), &mut off_in, dest_fd.native(), &mut off_out, (i32::MAX - 1) as usize, 0) } as isize;
                match sys::get_errno(rc) {
                    E::SUCCESS => {
                        if rc == 0 {
                            let _ = Syscall::fchmod(dest_fd, stat_.mode);
                            return Maybe::Ok(());
                        }
                    }
                    E::INTR => continue,
                    E::XDEV | E::INVAL | E::OPNOTSUPP | E::BADF => break 'cfr,
                    e => {
                        let _ = sys::unlink(dest);
                        return Maybe::Err(sys::Error { errno: e as _, syscall: sys::Tag::copyfile, ..Default::default() });
                    }
                }
            }

            let mut wrote: u64 = 0;
            if let Maybe::Err(err) = Self::copy_file_using_read_write_loop(src, dest, src_fd, dest_fd, stat_.size.max(0) as usize, &mut wrote) {
                let _ = sys::unlink(dest);
                return Maybe::Err(err);
            }
            let _ = Syscall::fchmod(dest_fd, stat_.mode);
            return Maybe::Ok(());
        }

        #[cfg(target_os = "linux")]
        {
            let mut src_buf = PathBuffer::uninit();
            let mut dest_buf = PathBuffer::uninit();
            let src = args.src.slice_z(&mut src_buf);
            let dest = args.dest.slice_z(&mut dest_buf);

            let src_fd = match Syscall::open(src, sys::O::RDONLY, 0o644) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err),
            };
            let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

            let stat_ = match Syscall::fstat(src_fd) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err),
            };

            if !sys::S::ISREG(stat_.mode) {
                return Maybe::Err(sys::Error { errno: SystemErrno::ENOTSUP as _, syscall: sys::Tag::copyfile, ..Default::default() });
            }

            let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
            // VERIFY-FIX(round1): `wrote` is read by the deferred-close scopeguard
            // *after* the copy loops below mutate it. As a `usize` captured by-copy
            // the guard always saw 0, and the `&mut (wrote as u64)` call sites
            // wrote into discarded temporaries. `Cell<u64>` lets the guard borrow
            // by reference while the loops `get`/`set`, matching Zig's `var wrote: u64`
            // observed by `defer` at scope-exit time.
            let wrote: core::cell::Cell<u64> = core::cell::Cell::new(0);
            if args.mode.shouldnt_overwrite() { flags |= sys::O::EXCL; }

            let dest_fd = match Syscall::open(dest, flags, DEFAULT_PERMISSION) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err),
            };

            let mut size: usize = stat_.size.max(0) as usize;

            // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
            if args.mode.is_force_clone() {
                if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(sys::linux::ioctl_ficlone(dest_fd, src_fd), sys::Tag::ioctl_ficlone, dest) {
                    dest_fd.close();
                    // This is racey, but it's the best we can do
                    let _ = sys::unlink(dest);
                    return err;
                }
                let _ = Syscall::fchmod(dest_fd, stat_.mode);
                dest_fd.close();
                return Maybe::Ok(());
            }

            // If we know it's a regular file and ioctl_ficlone is available, attempt to use it.
            if sys::S::ISREG(stat_.mode) && sys::copy_file::can_use_ioctl_ficlone() {
                let rc = sys::linux::ioctl_ficlone(dest_fd, src_fd);
                if rc == 0 {
                    let _ = Syscall::fchmod(dest_fd, stat_.mode);
                    dest_fd.close();
                    return Maybe::Ok(());
                }
                // If this fails for any reason, we say it's disabled
                // We don't want to add the system call overhead of running this function on a lot of files that don't support it
                sys::copy_file::disable_ioctl_ficlone();
            }

            let _close_dest = scopeguard::guard((dest_fd, stat_.mode, &wrote), |(fd, m, wrote)| {
                // SAFETY: fd is a valid open dest_fd; ftruncate/fchmod are libc FFI
                let _ = unsafe { libc::ftruncate(fd.cast(), (wrote.get() & ((1u64 << 63) - 1)) as i64) };
                // SAFETY: same fd as above
                let _ = unsafe { libc::fchmod(fd.cast(), m) };
                fd.close();
            });

            let mut off_in_copy: i64 = 0;
            let mut off_out_copy: i64 = 0;

            if !sys::copy_file::can_use_copy_file_range_syscall() {
                let mut w = wrote.get();
                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut w);
                wrote.set(w);
                return r;
            }

            if size == 0 {
                // copy until EOF
                loop {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                    let written = unsafe { sys::linux::copy_file_range(src_fd.cast(), &mut off_in_copy, dest_fd.cast(), &mut off_out_copy, sys::page_size(), 0) };
                    if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(written, sys::Tag::copy_file_range, dest) {
                        match err.get_errno() {
                            E::INTR => continue,
                            E::XDEV | E::NOSYS | E::INVAL | E::OPNOTSUPP => {
                                if matches!(err.get_errno(), E::NOSYS | E::OPNOTSUPP) { sys::copy_file::disable_copy_file_range_syscall(); }
                                let mut w = wrote.get();
                                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut w);
                                wrote.set(w);
                                return r;
                            }
                            _ => return err,
                        }
                    }
                    // wrote zero bytes means EOF
                    if written == 0 { break; }
                    wrote.set(wrote.get().saturating_add(written as u64));
                }
            } else {
                while size > 0 {
                    // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                    let written = unsafe { sys::linux::copy_file_range(src_fd.cast(), &mut off_in_copy, dest_fd.cast(), &mut off_out_copy, size, 0) };
                    if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(written, sys::Tag::copy_file_range, dest) {
                        match err.get_errno() {
                            E::INTR => continue,
                            E::XDEV | E::NOSYS | E::INVAL | E::OPNOTSUPP => {
                                if matches!(err.get_errno(), E::NOSYS | E::OPNOTSUPP) { sys::copy_file::disable_copy_file_range_syscall(); }
                                let mut w = wrote.get();
                                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut w);
                                wrote.set(w);
                                return r;
                            }
                            _ => return err,
                        }
                    }
                    if written == 0 { break; }
                    wrote.set(wrote.get().saturating_add(written as u64));
                    size = size.saturating_sub(written as usize);
                }
            }

            return Maybe::Ok(());
        }

        #[cfg(windows)]
        {
            let dest_buf = paths::os_path_buffer_pool().get();
            let src = strings::to_kernel32_path(bun_core::reinterpret_slice::<u16>(&mut self.sync_error_buf), args.src.slice());
            let dest = strings::to_kernel32_path(&mut *dest_buf, args.dest.slice());
            // SAFETY: src/dest are NUL-terminated wide paths; CopyFileW is the Win32 FFI
            if unsafe { windows::CopyFileW(src.as_ptr(), dest.as_ptr(), if args.mode.shouldnt_overwrite() { 1 } else { 0 }) } == windows::FALSE {
                if let Some(rest) = Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, args.src.slice()) {
                    return Self::should_ignore_ebusy(&args.src, &args.dest, rest);
                }
            }
            return Maybe::Ok(());
        }

        #[allow(unreachable_code)]
        { unreachable!() }
    }

    pub fn exists(&mut self, args: &args::Exists, _: Flavor) -> Maybe<ret::Exists> {
        // NOTE: exists cannot return an error
        let Some(path) = &args.path else { return Maybe::Ok(false) };

        if let Some(graph) = standalone_module_graph_get() {
            if graph.find(path.slice()).is_some() {
                return Maybe::Ok(true);
            }
        }

        let slice = if path.slice().is_empty() {
            os_path_literal_empty()
        } else {
            path.os_path_kernel32(&mut self.sync_error_buf)
        };

        Maybe::Ok(sys::exists_os_path(slice, false))
    }

    pub fn chown(&mut self, args: &args::Chown, _: Flavor) -> Maybe<ret::Chown> {
        #[cfg(windows)]
        {
            return match Syscall::chown(args.path.slice_z(&mut self.sync_error_buf), args.uid, args.gid) {
                Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
                Maybe::Ok(res) => Maybe::Ok(res),
            };
        }
        let path = args.path.slice_z(&mut self.sync_error_buf);
        Syscall::chown(path, args.uid, args.gid)
    }

    pub fn chmod(&mut self, args: &args::Chmod, _: Flavor) -> Maybe<ret::Chmod> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        #[cfg(windows)]
        {
            return match Syscall::chmod(path, args.mode) {
                Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
                Maybe::Ok(res) => Maybe::Ok(res),
            };
        }
        match Syscall::chmod(path, args.mode) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(_) => Maybe::Ok(()),
        }
    }

    pub fn fchmod(&mut self, args: &args::FChmod, _: Flavor) -> Maybe<ret::Fchmod> {
        Syscall::fchmod(args.fd, args.mode)
    }

    pub fn fchown(&mut self, args: &args::Fchown, _: Flavor) -> Maybe<ret::Fchown> {
        Syscall::fchown(args.fd, args.uid, args.gid)
    }

    pub fn fdatasync(&mut self, args: &args::FdataSync, _: Flavor) -> Maybe<ret::Fdatasync> {
        #[cfg(windows)]
        { return Syscall::fdatasync(args.fd); }
        // SAFETY: args.fd.native() is a valid open fd; fdatasync is the libc FFI
        Maybe::<ret::Fdatasync>::errno_sys_fd(unsafe { libc::fdatasync(args.fd.native()) }, sys::Tag::fdatasync, args.fd)
            .unwrap_or(Maybe::Ok(()))
    }

    pub fn fstat(&mut self, args: &args::Fstat, _: Flavor) -> Maybe<ret::Fstat> {
        // TODO(port): `Syscall::fstatx` / `SUPPORTS_STATX_ON_LINUX` —
        // blocked_on: bun_sys::statx (the statx fast-path is not yet wired
        // into `bun_sys`; falls through to the plain `fstat` path, which is
        // exactly what the Zig code does when statx is unavailable).
        match Syscall::fstat(args.fd) {
            Maybe::Ok(result) => Maybe::Ok(Stats::init(&PosixStat::init(&result), args.big_int)),
            Maybe::Err(err) => Maybe::Err(err),
        }
    }

    pub fn fsync(&mut self, args: &args::Fsync, _: Flavor) -> Maybe<ret::Fsync> {
        #[cfg(windows)]
        { return Syscall::fsync(args.fd); }
        Maybe::<ret::Fsync>::errno_sys(unsafe { libc::fsync(args.fd.native()) }, sys::Tag::fsync)
            .unwrap_or(Maybe::Ok(()))
    }

    pub fn ftruncate(&mut self, args: &args::FTruncate, _: Flavor) -> Maybe<ret::Ftruncate> {
        Syscall::ftruncate(args.fd, args.len.unwrap_or(0))
    }

    pub fn futimes(&mut self, args: &args::Futimes, _: Flavor) -> Maybe<ret::Futimes> {
        #[cfg(windows)]
        {
            let mut req = uv::fs_t::UNINITIALIZED;
            let _d = scopeguard::guard(&mut req, |r| r.deinit());
            let rc = unsafe { uv::uv_fs_futime(uv::Loop::get(), &mut req, args.fd.uv(), args.atime, args.mtime, None) };
            return if let Some(e) = rc.errno() {
                Maybe::Err(sys::Error { errno: e, syscall: sys::Tag::futime, fd: args.fd, ..Default::default() })
            } else { Maybe::Ok(()) };
        }
        match Syscall::futimens(args.fd, args.atime, args.mtime) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(_) => Maybe::Ok(()),
        }
    }

    pub fn lchmod(&mut self, args: &args::LCHmod, _: Flavor) -> Maybe<ret::Lchmod> {
        #[cfg(windows)]
        { return Maybe::<ret::Lchmod>::todo(); }
        #[cfg(target_os = "android")]
        {
            // bionic has no lchmod(); symlink modes are meaningless on Linux
            // anyway. Match glibc's stub behaviour.
            return Maybe::Err(sys::Error { errno: E::OPNOTSUPP as _, syscall: sys::Tag::lchmod, path: args.path.slice().into(), ..Default::default() });
        }
        let path = args.path.slice_z(&mut self.sync_error_buf);
        match Syscall::lchmod(path, args.mode) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(_) => Maybe::Ok(()),
        }
    }

    pub fn lchown(&mut self, args: &args::LChown, _: Flavor) -> Maybe<ret::Lchown> {
        #[cfg(windows)]
        { return Maybe::<ret::Lchown>::todo(); }
        let path = args.path.slice_z(&mut self.sync_error_buf);
        match Syscall::lchown(path, args.uid, args.gid) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(_) => Maybe::Ok(()),
        }
    }

    pub fn link(&mut self, args: &args::Link, _: Flavor) -> Maybe<ret::Link> {
        let mut to_buf = PathBuffer::uninit();
        let from = args.old_path.slice_z(&mut self.sync_error_buf);
        let to = args.new_path.slice_z(&mut to_buf);
        #[cfg(windows)]
        {
            return match Syscall::link(from, to) {
                Maybe::Err(err) => Maybe::Err(err.with_path_dest(args.old_path.slice(), args.new_path.slice())),
                Maybe::Ok(result) => Maybe::Ok(result),
            };
        }
        // SAFETY: `from`/`to` are NUL-terminated by `slice_z`; `link(2)` is the libc FFI.
        Maybe::<ret::Link>::errno_sys_pd(unsafe { libc::link(from.as_ptr().cast(), to.as_ptr().cast()) }, sys::Tag::link, args.old_path.slice(), args.new_path.slice())
            .unwrap_or(Maybe::Ok(()))
    }

    pub fn lstat(&mut self, args: &args::Lstat, _: Flavor) -> Maybe<ret::Lstat> {
        // TODO(port): `Syscall::lstatx` — blocked_on: bun_sys::statx (see fstat).
        match Syscall::lstat(args.path.slice_z(&mut self.sync_error_buf)) {
            Maybe::Ok(result) => Maybe::Ok(StatOrNotFound::Stats(Stats::init(&PosixStat::init(&result), args.big_int))),
            Maybe::Err(err) => {
                if !args.throw_if_no_entry && err.get_errno() == E::NOENT {
                    return Maybe::Ok(StatOrNotFound::NotFound);
                }
                Maybe::Err(err.with_path(args.path.slice()))
            }
        }
    }

    pub fn mkdir(&mut self, args: &args::Mkdir, _: Flavor) -> Maybe<ret::Mkdir> {
        if args.path.slice().is_empty() {
            return Maybe::Err(sys::Error { errno: E::NOENT as _, syscall: sys::Tag::mkdir, path: b"".as_slice().into(), ..Default::default() });
        }
        if args.recursive { self.mkdir_recursive(args.clone()) } else { self.mkdir_non_recursive(args) }
    }

    // Node doesn't absolute the path so we don't have to either
    pub fn mkdir_non_recursive(&mut self, args: &args::Mkdir) -> Maybe<ret::Mkdir> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        match Syscall::mkdir(path, args.mode) {
            Maybe::Ok(_) => Maybe::Ok(StringOrUndefined::None),
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
        }
    }

    pub fn mkdir_recursive(&mut self, args: args::Mkdir) -> Maybe<ret::Mkdir> {
        self.mkdir_recursive_impl::<()>(args, ())
    }

    pub fn mkdir_recursive_impl<Ctx: MkdirCtx>(&mut self, args: args::Mkdir, ctx: Ctx) -> Maybe<ret::Mkdir> {
        let mut buf = paths::path_buffer_pool::get();
        let path = args.path.os_path_kernel32(&mut *buf);
        if args.always_return_none {
            self.mkdir_recursive_os_path_impl::<Ctx, false>(ctx, path, args.mode)
        } else {
            self.mkdir_recursive_os_path_impl::<Ctx, true>(ctx, path, args.mode)
        }
    }

    pub fn _is_sep(ch: OSPathChar) -> bool {
        if cfg!(windows) { ch == b'/' as OSPathChar || ch == b'\\' as OSPathChar } else { ch == b'/' as OSPathChar }
    }

    pub fn mkdir_recursive_os_path(&mut self, path: OSPathSliceZ, mode: Mode, return_path: bool) -> Maybe<ret::Mkdir> {
        // PERF(port): was comptime bool — runtime branch here
        if return_path {
            self.mkdir_recursive_os_path_impl::<(), true>((), path, mode)
        } else {
            self.mkdir_recursive_os_path_impl::<(), false>((), path, mode)
        }
    }

    pub fn mkdir_recursive_os_path_impl<Ctx: MkdirCtx, const RETURN_PATH: bool>(
        &mut self,
        ctx: Ctx,
        path: OSPathSliceZ,
        mode: Mode,
    ) -> Maybe<ret::Mkdir> {
        let len: u16 = path.len() as u16;

        // First, attempt to create the desired directory
        // If that fails, then walk back up the path until we have a match
        match mkdir_os_path(path, mode) {
            Maybe::Err(err) => match err.get_errno() {
                // `mkpath_np` in macOS also checks for `EISDIR`.
                // it is unclear if macOS lies about if the existing item is
                // a directory or not, so it is checked.
                E::EISDIR | E::EEXIST => {
                    return match sys::directory_exists_at(FD::INVALID, path) {
                        Maybe::Err(_) => Maybe::Err(sys::Error {
                            errno: err.errno, syscall: sys::Tag::mkdir,
                            path: self.os_path_into_sync_error_buf(without_nt_prefix(path.as_slice())).into(),
                            ..Default::default()
                        }),
                        // if is a directory, OK. otherwise failure
                        Maybe::Ok(result) => if result {
                            Maybe::Ok(StringOrUndefined::None)
                        } else {
                            Maybe::Err(sys::Error {
                                errno: err.errno, syscall: sys::Tag::mkdir,
                                path: self.os_path_into_sync_error_buf(without_nt_prefix(path.as_slice())).into(),
                                ..Default::default()
                            })
                        },
                    };
                }
                // continue
                E::NOENT => {
                    if len == 0 {
                        // no path to copy
                        return Maybe::Err(err);
                    }
                }
                _ => {
                    return Maybe::Err(err.with_path(self.os_path_into_sync_error_buf(&path.as_slice()[..len as usize])));
                }
            },
            Maybe::Ok(_) => {
                ctx.on_create_dir(path);
                if !RETURN_PATH { return Maybe::Ok(StringOrUndefined::None); }
                return Maybe::Ok(StringOrUndefined::String(BunString::create_from_os_path(path)));
            }
        }

        // SAFETY: sync_error_buf is align(u16); reinterpret as OSPathBuffer.
        // Keep the raw `*mut PathBuffer` so error-return paths can re-derive a fresh
        // `&mut PathBuffer` without reborrowing `&mut self` (which would alias
        // `working_mem` under stacked borrows). On every such path `working_mem` is
        // not used afterward, so the re-derive is sound.
        let sync_error_buf_ptr: *mut PathBuffer = &mut self.sync_error_buf;
        let working_mem: &mut OSPathBuffer = unsafe { &mut *(sync_error_buf_ptr as *mut OSPathBuffer) };
        working_mem[..len as usize].copy_from_slice(&path.as_slice()[..len as usize]);

        let mut i: u16 = len - 1;

        // iterate backwards until creating the directory works successfully
        while i > 0 {
            if Self::_is_sep(path.as_slice()[i as usize]) {
                working_mem[i as usize] = 0;
                let parent = unsafe { OSPathSliceZ::from_raw(working_mem.as_ptr(), i as usize) };
                match mkdir_os_path(parent, mode) {
                    Maybe::Err(err) => {
                        working_mem[i as usize] = paths::SEP as OSPathChar;
                        match err.get_errno() {
                            E::EEXIST => {
                                // On Windows, this may happen if trying to mkdir replacing a file
                                #[cfg(windows)]
                                {
                                    if let Maybe::Ok(res) = sys::directory_exists_at(FD::INVALID, parent) {
                                        // is a directory. break.
                                        if !res {
                                            // SAFETY: `working_mem` is not used after this return; re-derive
                                            // the &mut PathBuffer from the stored raw ptr instead of `&mut self`.
                                            let buf = unsafe { &mut *sync_error_buf_ptr };
                                            return Maybe::Err(sys::Error {
                                                errno: E::NOTDIR as _, syscall: sys::Tag::mkdir,
                                                path: Self::os_path_into_buf(buf, without_nt_prefix(&path.as_slice()[..len as usize])).into(),
                                                ..Default::default()
                                            });
                                        }
                                    }
                                }
                                // Handle race condition
                                break;
                            }
                            E::NOENT => { i -= 1; continue; }
                            _ => {
                                #[cfg(windows)]
                                let p = {
                                    // `parent` aliases `working_mem` (== sync_error_buf). Copy it
                                    // out to a temp before re-deriving `&mut PathBuffer` so we
                                    // never hold `&mut buf` and `&buf[..]` simultaneously.
                                    let stripped = without_nt_prefix(parent.as_slice());
                                    let n = stripped.len();
                                    let tmp = paths::os_path_buffer_pool().get();
                                    tmp[..n].copy_from_slice(stripped);
                                    // SAFETY: `working_mem`/`parent` are not used after this return.
                                    Self::os_path_into_buf(unsafe { &mut *sync_error_buf_ptr }, &tmp[..n])
                                };
                                #[cfg(not(windows))]
                                let p = without_nt_prefix(parent.as_slice());
                                return Maybe::Err(err.with_path(p));
                            }
                        }
                    }
                    Maybe::Ok(_) => {
                        ctx.on_create_dir(parent);
                        // We found a parent that worked
                        working_mem[i as usize] = paths::SEP as OSPathChar;
                        break;
                    }
                }
            }
            i -= 1;
        }
        let first_match: u16 = i;
        i += 1;
        // after we find one that works, we go forward _after_ the first working directory
        while i < len {
            if Self::_is_sep(path.as_slice()[i as usize]) {
                working_mem[i as usize] = 0;
                let parent = unsafe { OSPathSliceZ::from_raw(working_mem.as_ptr(), i as usize) };
                match mkdir_os_path(parent, mode) {
                    Maybe::Err(err) => {
                        working_mem[i as usize] = paths::SEP as OSPathChar;
                        match err.get_errno() {
                            // handle the race condition
                            E::EEXIST => {}
                            // NOENT shouldn't happen here
                            _ => {
                                // SAFETY: `working_mem` is not used after this return.
                                let buf = unsafe { &mut *sync_error_buf_ptr };
                                return Maybe::Err(err.with_path(Self::os_path_into_buf(buf, without_nt_prefix(path.as_slice()))));
                            }
                        }
                    }
                    Maybe::Ok(_) => {
                        ctx.on_create_dir(parent);
                        working_mem[i as usize] = paths::SEP as OSPathChar;
                    }
                }
            }
            i += 1;
        }

        working_mem[len as usize] = 0;

        // Our final directory will not have a trailing separator
        // so we have to create it once again
        let final_ = unsafe { OSPathSliceZ::from_raw(working_mem.as_ptr(), len as usize) };
        match mkdir_os_path(final_, mode) {
            Maybe::Err(err) => match err.get_errno() {
                E::EEXIST => {}
                _ => {
                    // SAFETY: `working_mem` is not used after this return.
                    let buf = unsafe { &mut *sync_error_buf_ptr };
                    return Maybe::Err(err.with_path(Self::os_path_into_buf(buf, without_nt_prefix(path.as_slice()))));
                }
            },
            Maybe::Ok(_) => {}
        }

        ctx.on_create_dir(final_);
        if !RETURN_PATH { return Maybe::Ok(StringOrUndefined::None); }
        Maybe::Ok(StringOrUndefined::String(BunString::create_from_os_path(&working_mem[..first_match as usize])))
    }

    pub fn mkdtemp(&mut self, args: &args::MkdirTemp, _: Flavor) -> Maybe<ret::Mkdtemp> {
        let prefix_buf = &mut self.sync_error_buf;
        let prefix_slice = args.prefix.slice();
        let len = prefix_slice.len().min(prefix_buf.len().saturating_sub(7));
        if len > 0 {
            prefix_buf[..len].copy_from_slice(&prefix_slice[..len]);
        }
        prefix_buf[len..len + 6].copy_from_slice(b"XXXXXX");
        prefix_buf[len + 6] = 0;

        // The mkdtemp() function returns  a  pointer  to  the  modified  template
        // string  on  success, and NULL on failure, in which case errno is set to
        // indicate the error

        #[cfg(windows)]
        {
            let mut req = uv::fs_t::UNINITIALIZED;
            let _d = scopeguard::guard(&mut req, |r| r.deinit());
            let rc = unsafe { uv::uv_fs_mkdtemp(bun_aio::Loop::get(), &mut req, prefix_buf.as_ptr().cast(), None) };
            if let Some(errno) = rc.errno() {
                return Maybe::Err(sys::Error { errno, syscall: sys::Tag::mkdtemp, path: prefix_buf[..len + 6].into(), ..Default::default() });
            }
            return Maybe::Ok(ZigString::dupe_for_js(unsafe { bun_string::slice_to_nul(req.path) }).expect("oom"));
        }

        // SAFETY: `prefix_buf` is NUL-terminated and writable; mkdtemp(3) writes the
        // generated name back into the buffer in-place.
        let rc = unsafe { libc::mkdtemp(prefix_buf.as_mut_ptr().cast()) };
        if !rc.is_null() {
            return Maybe::Ok(ZigString::dupe_for_js(unsafe { core::ffi::CStr::from_ptr(rc) }.to_bytes()).expect("oom"));
        }

        // c.getErrno(rc) returns SUCCESS if rc is -1 so we call std.c._errno() directly
        let errno = unsafe { *bun_sys::c::errno_location() };
        Maybe::Err(sys::Error {
            errno: errno as _,
            syscall: sys::Tag::mkdtemp,
            path: prefix_buf[..len + 6].into(),
            ..Default::default()
        })
    }

    pub fn open(&mut self, args: &args::Open, _: Flavor) -> Maybe<ret::Open> {
        let path = if cfg!(windows) && args.path.slice() == b"/dev/null" {
            ZStr::from_static(b"\\\\.\\NUL\0")
        } else {
            args.path.slice_z(&mut self.sync_error_buf)
        };
        match Syscall::open(path, args.flags.as_int(), args.mode) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(fd) => Maybe::Ok(fd),
        }
    }

    pub fn uv_open(&mut self, args: &args::Open, rc: i64) -> Maybe<ret::Open> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::open, path: args.path.slice().into(), from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(FD::from_uv(rc as _))
    }

    pub fn uv_statfs(&mut self, args: &args::StatFS, req: &mut uv::fs_t, rc: i64) -> Maybe<ret::StatFS> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::open, path: args.path.slice().into(), from_libuv: true, ..Default::default() });
        }
        // node_fs.zig:4333 — `req.ptrAs(*align(1) bun.StatFS).*`: libuv stores
        // a `uv_statfs_t*` in `req.ptr` on success. The struct is unaligned in
        // the request buffer, hence `read_unaligned`.
        // SAFETY: `rc >= 0` ⇒ libuv populated `req.ptr` with a valid
        // `uv_statfs_t` (= `RawStatFS` on Windows); we copy it out by value
        // before `uv_fs_req_cleanup` releases the backing storage.
        let statfs_: super::statfs::RawStatFS =
            unsafe { core::ptr::read_unaligned(req.ptr_as::<super::statfs::RawStatFS>()) };
        Maybe::Ok(ret::StatFS::init(&statfs_, args.big_int))
    }

    pub fn open_dir(&mut self, _: &args::OpenDir, _: Flavor) -> Maybe<()> {
        Maybe::todo()
    }

    fn read_inner(&mut self, args: &args::Read) -> Maybe<ret::Read> {
        debug_assert!(args.position.is_none());
        let mut buf = args.buffer.slice();
        let off = (args.offset as usize).min(buf.len());
        buf = &mut buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &mut buf[..l];
        match Syscall::read(args.fd, buf) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Read { bytes_read: amt as u64 }),
        }
    }

    fn pread_inner(&mut self, args: &args::Read) -> Maybe<ret::Read> {
        let mut buf = args.buffer.slice();
        let off = (args.offset as usize).min(buf.len());
        buf = &mut buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &mut buf[..l];
        match Syscall::pread(args.fd, buf, args.position.unwrap()) {
            Maybe::Err(err) => Maybe::Err(sys::Error { errno: err.errno, fd: args.fd, syscall: sys::Tag::read, ..Default::default() }),
            Maybe::Ok(amt) => Maybe::Ok(ret::Read { bytes_read: amt as u64 }),
        }
    }

    pub fn read(&mut self, args: &args::Read, _: Flavor) -> Maybe<ret::Read> {
        let len1 = args.buffer.slice().len();
        let len2 = args.length;
        if len1 == 0 || len2 == 0 {
            return Maybe::Ok(ret::Read { bytes_read: 0 });
        }
        if args.position.is_some() { self.pread_inner(args) } else { self.read_inner(args) }
    }

    pub fn uv_read(&mut self, args: &args::Read, rc: i64) -> Maybe<ret::Read> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::read, fd: args.fd, from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(ret::Read { bytes_read: rc as u64 })
    }

    pub fn uv_readv(&mut self, args: &args::Readv, rc: i64) -> Maybe<ret::Readv> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::readv, fd: args.fd, from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(ret::Readv { bytes_read: rc as u64 })
    }

    pub fn readv(&mut self, args: &args::Readv, _: Flavor) -> Maybe<ret::Readv> {
        if args.buffers.buffers.is_empty() {
            return Maybe::Ok(ret::Readv { bytes_read: 0 });
        }
        if args.position.is_some() { self.preadv_inner(args) } else { self.readv_inner(args) }
    }

    pub fn writev(&mut self, args: &args::Writev, _: Flavor) -> Maybe<ret::Writev> {
        if args.buffers.buffers.is_empty() {
            return Maybe::Ok(ret::Writev { bytes_written: 0 });
        }
        if args.position.is_some() { self.pwritev_inner(args) } else { self.writev_inner(args) }
    }

    pub fn write(&mut self, args: &args::Write, _: Flavor) -> Maybe<ret::Write> {
        if args.position.is_some() { self.pwrite_inner(args) } else { self.write_inner(args) }
    }

    pub fn uv_write(&mut self, args: &args::Write, rc: i64) -> Maybe<ret::Write> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::write, fd: args.fd, from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(ret::Write { bytes_written: rc as u64 })
    }

    pub fn uv_writev(&mut self, args: &args::Writev, rc: i64) -> Maybe<ret::Writev> {
        if rc < 0 {
            return Maybe::Err(sys::Error { errno: (-rc) as _, syscall: sys::Tag::writev, fd: args.fd, from_libuv: true, ..Default::default() });
        }
        Maybe::Ok(ret::Writev { bytes_written: rc as u64 })
    }

    fn write_inner(&mut self, args: &args::Write) -> Maybe<ret::Write> {
        let mut buf = args.buffer.slice();
        let off = (args.offset as usize).min(buf.len());
        buf = &buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &buf[..l];
        match Syscall::write(args.fd, buf) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Write { bytes_written: amt as u64 }),
        }
    }

    fn pwrite_inner(&mut self, args: &args::Write) -> Maybe<ret::Write> {
        let position = args.position.unwrap();
        let mut buf = args.buffer.slice();
        let off = (args.offset as usize).min(buf.len());
        buf = &buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &buf[..l];
        match Syscall::pwrite(args.fd, buf, position) {
            Maybe::Err(err) => Maybe::Err(sys::Error { errno: err.errno, fd: args.fd, syscall: sys::Tag::write, ..Default::default() }),
            Maybe::Ok(amt) => Maybe::Ok(ret::Write { bytes_written: amt as u64 }),
        }
    }

    fn preadv_inner(&mut self, args: &args::Readv) -> Maybe<ret::Readv> {
        let position = args.position.unwrap();
        match Syscall::preadv(args.fd, args.buffers.buffers.as_slice(), position as i64) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Readv { bytes_read: amt as u64 }),
        }
    }

    fn readv_inner(&mut self, args: &args::Readv) -> Maybe<ret::Readv> {
        match Syscall::readv(args.fd, args.buffers.buffers.as_slice()) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Readv { bytes_read: amt as u64 }),
        }
    }

    fn pwritev_inner(&mut self, args: &args::Writev) -> Maybe<ret::Write> {
        let position = args.position.unwrap();
        match Syscall::pwritev(args.fd, args.buffers.buffers.as_slice(), position as i64) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Write { bytes_written: amt as u64 }),
        }
    }

    fn writev_inner(&mut self, args: &args::Writev) -> Maybe<ret::Write> {
        // node_fs.zig:4526 — `@ptrCast(args.buffers.buffers.items)` reinterprets
        // the mutable iovec slice as `iovec_const` for writev(2); the kernel
        // never writes through `iov_base`. `PlatformIoVec` and
        // `PlatformIoVecConst` are layout-identical (`{ *void, usize }`), so
        // pass the slice through `Syscall::writev` as-is.
        match Syscall::writev(args.fd, args.buffers.buffers.as_slice()) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(amt) => Maybe::Ok(ret::Write { bytes_written: amt as u64 }),
        }
    }

    pub fn readdir(&mut self, args: &args::Readdir, flavor: Flavor) -> Maybe<ret::Readdir> {
        // PERF(port): `flavor` was comptime monomorphization — profile in Phase B
        if flavor != Flavor::Sync {
            if args.recursive {
                panic!("Assertion failure: this code path should never be reached.");
            }
        }
        // PERF(port): was comptime monomorphization on (recursive, tag)
        let maybe = match args.tag() {
            ret::ReaddirTag::Buffers => Self::readdir_inner::<Buffer>(&mut self.sync_error_buf, args, args.recursive, flavor),
            ret::ReaddirTag::WithFileTypes => Self::readdir_inner::<Dirent>(&mut self.sync_error_buf, args, args.recursive, flavor),
            ret::ReaddirTag::Files => Self::readdir_inner::<BunString>(&mut self.sync_error_buf, args, args.recursive, flavor),
        };
        match maybe {
            Maybe::Err(err) => Maybe::Err(sys::Error {
                syscall: sys::Tag::scandir, errno: err.errno, path: args.path.slice().into(), ..Default::default()
            }),
            Maybe::Ok(result) => Maybe::Ok(result),
        }
    }

    fn readdir_with_entries<T: ReaddirEntry>(
        args: &args::Readdir, fd: FD, basename: &ZStr, entries: &mut Vec<T>,
    ) -> Maybe<()> {
        // PORT NOTE: Zig branched on `comptime is_u16 = isWindows && (T == String || T == Dirent)`
        // to use the UTF-16 dir iterator on Windows. The u16 branch is gated for round 3;
        // POSIX is always u8, and Windows-u8 (Buffer encoding) also uses the u8 path.
        // TODO(port-windows): wire `is_u16` once `DirIterator::IteratorW` + the
        // `re_encoding_buffer` transcoding path are real.

        let mut dirent_path = BunString::DEAD;
        let _drop_dirent = scopeguard::guard((), |()| dirent_path.deref());
        // ^ Zig `defer dirent_path.deref()` — cannot capture `&mut dirent_path` past the
        //   loop body in Rust; deref is idempotent on DEAD/EMPTY so do it inline below.
        core::mem::forget(_drop_dirent);

        let mut iterator = DirIterator::WrappedIterator::init(fd);
        loop {
            let current = match iterator.next() {
                Err(err) => {
                    for item in entries.iter_mut() { item.destroy_entry(); }
                    // PORT NOTE: Zig also `entries.deinit()` here; the caller owns the
                    // Vec in Rust, but matching the Zig contract we drain it so the
                    // caller's `T::into_readdir` never sees freed entries.
                    entries.clear();
                    dirent_path.deref();
                    return Maybe::Err(err.with_path(args.path.slice()));
                }
                Ok(None) => break,
                Ok(Some(ent)) => ent,
            };

            if T::IS_DIRENT && dirent_path.is_empty() {
                dirent_path = webcore::encoding::to_bun_string(
                    without_nt_prefix::<u8>(basename.as_bytes()),
                    args.encoding,
                );
            }

            let utf8_name = current.name.slice();
            // On filesystems that return DT_UNKNOWN (e.g. FUSE, bind mounts),
            // fall back to lstat to determine the real file kind.
            let kind = if T::IS_DIRENT && current.kind == sys::FileKind::Unknown {
                match sys::lstatat(fd, current.name.slice_assume_z()) {
                    Ok(st) => sys::kind_from_mode(st.mode as Mode),
                    Err(_) => current.kind,
                }
            } else {
                current.kind
            };
            T::append_entry(entries, utf8_name, &dirent_path, kind, args.encoding);
        }

        dirent_path.deref();
        Maybe::Ok(())
    }

    pub fn readdir_with_entries_recursive_async<T: ReaddirEntry>(
        buf: &mut PathBuffer, args: &args::Readdir, async_task: &mut AsyncReaddirRecursiveTask,
        basename: &ZStr, entries: &mut Vec<T>, is_root: bool,
    ) -> Maybe<()> {
        let root_basename = async_task.root_path.slice();
        let flags = sys::O::DIRECTORY | sys::O::RDONLY;
        let atfd = if is_root { FD::cwd() } else { async_task.root_fd };
        #[cfg(not(windows))]
        let open_res = Syscall::openat(atfd, basename, flags, 0);
        #[cfg(windows)]
        // windows bun.sys.open does not pass iterable=true
        let open_res = sys::open_dir_at_windows_a(atfd, basename.as_bytes(),
            sys::WindowsOpenDirOptions { no_follow: true, iterable: true, read_only: true, ..Default::default() });
        let fd = match open_res {
            Maybe::Err(err) => {
                if !is_root {
                    match err.get_errno() {
                        // These things can happen and there's nothing we can do about it.
                        //
                        // This is different than what Node does, at the time of writing.
                        // Node doesn't gracefully handle errors like these. It fails the entire operation.
                        E::NOENT | E::NOTDIR | E::PERM => return Maybe::Ok(()),
                        _ => {}
                    }
                    let joined = paths::resolve_path::join_z_buf::<paths::platform::Auto>(
                        &mut buf[..],
                        &[root_basename, basename.as_bytes()],
                    );
                    return Maybe::Err(err.with_path(joined.as_bytes()));
                }
                return Maybe::Err(err.with_path(args.path.slice()));
            }
            Maybe::Ok(fd_) => fd_,
        };

        if is_root {
            async_task.root_fd = fd;
        }
        let _close = scopeguard::guard((fd, is_root), |(fd, is_root)| {
            if !is_root { fd.close(); }
        });

        let mut iterator = DirIterator::WrappedIterator::init(fd);
        let mut dirent_path_prev = BunString::EMPTY;

        loop {
            let current = match iterator.next() {
                Err(err) => {
                    dirent_path_prev.deref();
                    if !is_root {
                        let joined = paths::resolve_path::join_z_buf::<paths::platform::Auto>(
                            &mut buf[..],
                            &[root_basename, basename.as_bytes()],
                        );
                        return Maybe::Err(err.with_path(joined.as_bytes()));
                    }
                    return Maybe::Err(err.with_path(args.path.slice()));
                }
                Ok(None) => break,
                Ok(Some(ent)) => ent,
            };
            let utf8_name = current.name.slice();

            // PORT NOTE: Zig compared `root_path.sliceAssumeZ().ptr == basename.ptr` to
            // detect "this subtask is the root". The Rust caller passes `is_root`
            // explicitly, which is the same predicate (root subtask's basename *is*
            // root_path).
            let name_to_copy: &[u8] = if is_root {
                utf8_name
            } else {
                paths::resolve_path::join_z_buf::<paths::platform::Auto>(
                    &mut buf[..],
                    &[basename.as_bytes(), utf8_name],
                ).as_bytes()
            };
            // SAFETY: both branches yield NUL-terminated storage — `utf8_name` is a
            // `PathString` slice over the iterator's NUL-terminated dirent name, and
            // `join_z_buf` writes a sentinel.
            let name_to_copy_z = unsafe { ZStr::from_raw(name_to_copy.as_ptr(), name_to_copy.len()) };

            // Track effective kind - may be resolved from .unknown via stat
            let mut effective_kind = current.kind;

            'enqueue: {
                match current.kind {
                    // a symlink might be a directory or might not be
                    // if it's not a directory, the task will fail at that point.
                    sys::FileKind::SymLink |
                    // we know for sure it's a directory
                    sys::FileKind::Directory => {
                        // if the name is too long, we can't enqueue it regardless
                        // the operating system would just return ENAMETOOLONG
                        //
                        // Technically, we could work around that due to the
                        // usage of openat, but then we risk leaving too many
                        // file descriptors open.
                        if utf8_name.len() + 1 + name_to_copy.len() > paths::MAX_PATH_BYTES { break 'enqueue; }
                        async_task.enqueue(name_to_copy_z);
                    }
                    // Some filesystems (e.g., Docker bind mounts, FUSE, NFS) return
                    // DT_UNKNOWN for d_type. Use lstatat to determine the actual type.
                    sys::FileKind::Unknown => {
                        if utf8_name.len() + 1 + name_to_copy.len() > paths::MAX_PATH_BYTES { break 'enqueue; }
                        // Lazy stat to determine the actual kind (lstatat to not follow symlinks)
                        match sys::lstatat(fd, current.name.slice_assume_z()) {
                            Ok(st) => {
                                let real_kind = sys::kind_from_mode(st.mode as Mode);
                                effective_kind = real_kind;
                                if matches!(real_kind, sys::FileKind::Directory | sys::FileKind::SymLink) {
                                    async_task.enqueue(name_to_copy_z);
                                }
                            }
                            Err(_) => {} // Skip entries we can't stat
                        }
                    }
                    _ => {}
                }
            }

            if T::IS_DIRENT {
                let joined = paths::resolve_path::join::<paths::platform::Auto>(
                    &[root_basename, name_to_copy],
                );
                let path_u8 = paths::resolve_path::dirname::<paths::platform::Auto>(joined);
                if dirent_path_prev.is_empty() || dirent_path_prev.byte_slice() != path_u8 {
                    dirent_path_prev.deref();
                    dirent_path_prev = BunString::clone_utf8(path_u8);
                }
            }
            // async path: spec uses raw `bun.String.cloneUTF8` (node_fs.zig:4810/4819) — do not apply encoding.
            T::append_entry_recursive(entries, utf8_name, name_to_copy, &dirent_path_prev, effective_kind, args.encoding, false);
        }

        dirent_path_prev.deref();
        Maybe::Ok(())
    }

    fn readdir_with_entries_recursive_sync<T: ReaddirEntry>(
        buf: &mut PathBuffer, args: &args::Readdir, root_basename: &ZStr, entries: &mut Vec<T>,
    ) -> Maybe<()> {
        use std::collections::VecDeque;
        // PERF(port): Zig used `std.heap.stackFallback(128)` for the fifo and
        // `stackFallback(8192*2)` for basename storage. Rust has no portable
        // stack-fallback allocator; VecDeque<Vec<u8>> heap-allocates from the
        // first push. Revisit with `smallvec`/arena once profiled.
        let mut stack: VecDeque<Vec<u8>> = VecDeque::new();
        // Sentinel: an item whose ptr == root_basename.ptr means "root". We
        // can't compare `Vec<u8>` ptrs against `root_basename` the way Zig
        // compared `[:0]const u8.ptr`, so use Option: `None` = root.
        stack.push_back(Vec::new()); // empty == root marker (handled below)
        let mut first_is_root = true;

        let mut root_fd = FD::INVALID;
        let _close_root = scopeguard::guard(&mut root_fd, |root_fd| {
            // all other paths are relative to the root directory
            // so we can only close it once we're 100% done
            if *root_fd != FD::INVALID { root_fd.close(); }
        });
        // Re-borrow through the guard so `root_fd` stays observable at drop.
        let root_fd: &mut FD = &mut *_close_root;
        // PORT NOTE: Zig kept `root_fd` as a plain local and closed it in a
        // bare `defer`. Rust's guard captures `&mut`, so all reads below go
        // through the same place.

        while let Some(item) = stack.pop_front() {
            let is_root = first_is_root && item.is_empty();
            first_is_root = false;
            // basename: root_basename for the first iteration, else the queued
            // relative path (NUL-terminated by construction).
            // PORT NOTE: Zig stored `[:0]const u8` slices and freed them via
            // `basename_allocator`; here `item` is an owned Vec<u8> (with
            // trailing NUL stripped below) and is dropped at end-of-loop.
            // Exclude the trailing NUL we appended at the push site — Zig's `[:0]const u8.len`
            // already excludes the sentinel, so `joinZBuf` there saw clean bytes.
            let basename_bytes: &[u8] = if is_root { root_basename.as_bytes() } else { &item[..item.len().saturating_sub(1)] };

            let flags = sys::O::DIRECTORY | sys::O::RDONLY;
            let atfd = if *root_fd == FD::INVALID { FD::cwd() } else { *root_fd };
            // SAFETY: root_basename is already NUL-terminated; queued items are
            // pushed below with the join_z_buf NUL kept intact.
            let basename_z: &ZStr = if is_root {
                root_basename
            } else {
                // item was stored with trailing NUL (see push site).
                unsafe { ZStr::from_raw(item.as_ptr(), item.len().saturating_sub(1)) }
            };
            let fd = match Syscall::openat(atfd, basename_z, flags, 0) {
                Maybe::Err(err) => {
                    if *root_fd == FD::INVALID {
                        return Maybe::Err(err.with_path(args.path.slice()));
                    }
                    match err.get_errno() {
                        // These things can happen and there's nothing we can do about it.
                        //
                        // This is different than what Node does, at the time of writing.
                        // Node doesn't gracefully handle errors like these. It fails the entire operation.
                        E::NOENT | E::NOTDIR | E::PERM => continue,
                        _ => {
                            // TODO: propagate file path (removed previously because it leaked the path)
                            return Maybe::Err(err);
                        }
                    }
                }
                Maybe::Ok(fd_) => fd_,
            };
            if *root_fd == FD::INVALID {
                *root_fd = fd;
            }
            let _close_fd = scopeguard::guard((fd, *root_fd), |(fd, rfd)| {
                if fd != rfd { fd.close(); }
            });

            let mut iterator = DirIterator::WrappedIterator::init(fd);
            let mut dirent_path_prev = BunString::DEAD;

            loop {
                let current = match iterator.next() {
                    Err(err) => {
                        dirent_path_prev.deref();
                        return Maybe::Err(err.with_path(args.path.slice()));
                    }
                    Ok(None) => break,
                    Ok(Some(ent)) => ent,
                };
                let utf8_name = current.name.slice();

                // name_to_copy: bare name at root, else `basename/utf8_name` joined into `buf`.
                let name_to_copy: &[u8] = if is_root {
                    utf8_name
                } else {
                    paths::resolve_path::join_z_buf::<paths::platform::Auto>(
                        &mut buf[..],
                        &[basename_bytes, utf8_name],
                    ).as_bytes()
                };

                // Track effective kind - may be resolved from .unknown via stat
                let mut effective_kind = current.kind;

                'enqueue: {
                    match current.kind {
                        // a symlink might be a directory or might not be
                        // if it's not a directory, the task will fail at that point.
                        sys::FileKind::SymLink |
                        // we know for sure it's a directory
                        sys::FileKind::Directory => {
                            if utf8_name.len() + 1 + name_to_copy.len() > paths::MAX_PATH_BYTES { break 'enqueue; }
                            // PORT NOTE: Zig `basename_allocator.dupeZ` — store with trailing NUL
                            // so the next iteration can hand it to `openat` as a `&ZStr`.
                            let mut owned = Vec::with_capacity(name_to_copy.len() + 1);
                            owned.extend_from_slice(name_to_copy);
                            owned.push(0);
                            stack.push_back(owned);
                        }
                        // Some filesystems (e.g., Docker bind mounts, FUSE, NFS) return
                        // DT_UNKNOWN for d_type. Use lstatat to determine the actual type.
                        sys::FileKind::Unknown => {
                            if utf8_name.len() + 1 + name_to_copy.len() > paths::MAX_PATH_BYTES { break 'enqueue; }
                            match sys::lstatat(fd, current.name.slice_assume_z()) {
                                Ok(st) => {
                                    let real_kind = sys::kind_from_mode(st.mode as Mode);
                                    effective_kind = real_kind;
                                    if matches!(real_kind, sys::FileKind::Directory | sys::FileKind::SymLink) {
                                        let mut owned = Vec::with_capacity(name_to_copy.len() + 1);
                                        owned.extend_from_slice(name_to_copy);
                                        owned.push(0);
                                        stack.push_back(owned);
                                    }
                                }
                                Err(_) => {} // Skip entries we can't stat
                            }
                        }
                        _ => {}
                    }
                }

                if T::IS_DIRENT {
                    let joined = paths::resolve_path::join::<paths::platform::Auto>(
                        &[root_basename.as_bytes(), name_to_copy],
                    );
                    let path_u8 = paths::resolve_path::dirname::<paths::platform::Auto>(joined);
                    if dirent_path_prev.is_empty() || dirent_path_prev.byte_slice() != path_u8 {
                        dirent_path_prev.deref();
                        dirent_path_prev = webcore::encoding::to_bun_string(
                            without_nt_prefix::<u8>(path_u8),
                            args.encoding,
                        );
                    }
                }
                // sync path: spec uses `WebCore.encoding.toBunString(.., args.encoding)` (node_fs.zig:4962-4982).
                T::append_entry_recursive(entries, utf8_name, name_to_copy, &dirent_path_prev, effective_kind, args.encoding, true);
            }
            dirent_path_prev.deref();
        }

        Maybe::Ok(())
    }

    fn should_throw_out_of_memory_early_for_javascript(encoding: Encoding, size: usize, syscall: sys::Tag) -> Option<sys::Error> {
        // Strings & typed arrays max out at 4.7 GB.
        // But, it's **string length**
        // So you can load an 8 GB hex string, for example, it should be fine.
        let adjusted_size = match encoding {
            Encoding::Utf16le | Encoding::Ucs2 | Encoding::Utf8 => (size / 4).saturating_sub(1),
            Encoding::Hex => (size / 2).saturating_sub(1),
            Encoding::Base64 | Encoding::Base64url => (size / 3).saturating_sub(1),
            Encoding::Ascii | Encoding::Latin1 | Encoding::Buffer => size,
        };
        if adjusted_size > VirtualMachine::SYNTHETIC_ALLOCATION_LIMIT
            // If they do not have enough memory to open the file and they're on Linux, let's throw an error instead of dealing with the OOM killer.
            || (cfg!(target_os = "linux") && size as u64 >= get_total_memory_size())
        {
            return Some(sys::Error::from_code(E::NOMEM, syscall));
        }
        None
    }

    fn readdir_inner<T: ReaddirEntry>(
        buf: &mut PathBuffer, args: &args::Readdir, recursive: bool, flavor: Flavor,
    ) -> Maybe<ret::Readdir> {
        let path = args.path.slice_z(buf);

        if recursive && flavor == Flavor::Sync {
            let mut buf_to_pass = PathBuffer::uninit();
            let mut entries: Vec<T> = Vec::new();
            return match Self::readdir_with_entries_recursive_sync::<T>(&mut buf_to_pass, args, path, &mut entries) {
                Maybe::Err(err) => {
                    for result in &mut entries { result.destroy_entry(); }
                    Maybe::Err(err)
                }
                Maybe::Ok(()) => Maybe::Ok(T::into_readdir(entries)),
            };
        }

        if recursive {
            panic!("This code path should never be reached. It should only go through readdirWithEntriesRecursiveAsync.");
        }

        let flags = sys::O::DIRECTORY | sys::O::RDONLY;
        #[cfg(not(windows))]
        let open_res = Syscall::open(path, flags, 0);
        #[cfg(windows)]
        let open_res = sys::open_dir_at_windows_a(FD::cwd(), path, sys::OpenDirOpts { iterable: true, read_only: true, ..Default::default() });
        let fd = match open_res {
            Maybe::Err(err) => return Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(fd_) => fd_,
        };
        let _close = scopeguard::guard(fd, |fd| fd.close());

        let mut entries: Vec<T> = Vec::new();
        match Self::readdir_with_entries::<T>(args, fd, path, &mut entries) {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(()) => Maybe::Ok(T::into_readdir(entries)),
        }
    }

    pub fn read_file(&mut self, args: &args::ReadFile, flavor: Flavor) -> Maybe<ret::ReadFile> {
        // PERF(port): `flavor` was comptime monomorphization — profile in Phase B
        let result = self.read_file_with_options(args, flavor, ReadFileStringType::Default);
        match result {
            Maybe::Err(err) => Maybe::Err(err),
            Maybe::Ok(result) => match result {
                ret::ReadFileWithOptions::Buffer(buffer) => Maybe::Ok(StringOrBuffer::Buffer(buffer)),
                ret::ReadFileWithOptions::TranscodedString(str) => {
                    if str.tag == BunString::Tag::Dead {
                        return Maybe::Err(sys::Error::from_code(E::NOMEM, sys::Tag::read).with_path_like(&args.path));
                    }
                    Maybe::Ok(StringOrBuffer::String(node::SliceWithUnderlyingString { underlying: str, ..Default::default() }))
                }
                ret::ReadFileWithOptions::String(s) => {
                    let str = node::SliceWithUnderlyingString::transcode_from_owned_slice(s, args.encoding);
                    if str.underlying.tag == BunString::Tag::Dead && str.utf8.is_empty() {
                        return Maybe::Err(sys::Error::from_code(E::NOMEM, sys::Tag::read).with_path_like(&args.path));
                    }
                    Maybe::Ok(StringOrBuffer::String(str))
                }
                _ => unreachable!(),
            },
        }
    }

    pub fn read_file_with_options(&mut self, args: &args::ReadFile, flavor: Flavor, string_type: ReadFileStringType) -> Maybe<ret::ReadFileWithOptions> {
        // PERF(port): `flavor`/`string_type` were comptime monomorphization in Zig.
        let path_is_path = matches!(args.path, PathOrFileDescriptor::Path(_));
        let fd_maybe_windows: FD = match &args.path {
            PathOrFileDescriptor::Path(p) => {
                let path = p.slice_z(&mut self.sync_error_buf);

                if let Some(graph) = standalone_module_graph_get() {
                    if let Some(file) = graph.find(path.as_bytes()) {
                        let contents = file.contents.as_bytes();
                        return if args.encoding == Encoding::Buffer {
                            // PORTING.md §Forbidden bans `Vec::leak()`; round-trip through
                            // `into_boxed_slice()` so the allocation layout JSC frees with
                            // matches what we hand it (capacity == len).
                            let raw = Box::into_raw(contents.to_vec().into_boxed_slice());
                            // SAFETY: ownership of the allocation is transferred to JSC; the
                            // ArrayBuffer finalizer reconstructs the Box and frees it
                            // (PORTING.md:348 — `Box::into_raw`/`from_raw` across FFI).
                            Maybe::Ok(ret::ReadFileWithOptions::Buffer(
                                Buffer::from_bytes(unsafe { &mut *raw }, bun_jsc::JSType::Uint8Array),
                            ))
                        } else if string_type == ReadFileStringType::Default {
                            Maybe::Ok(ret::ReadFileWithOptions::String(contents.to_vec().into_boxed_slice()))
                        } else {
                            let mut z = contents.to_vec();
                            z.push(0);
                            Maybe::Ok(ret::ReadFileWithOptions::NullTerminated(
                                bun_core::ZBox::from_vec_with_nul(z),
                            ))
                        };
                    }
                }

                match sys::open(path, args.flag.as_int() | sys::O::NOCTTY, DEFAULT_PERMISSION) {
                    Maybe::Err(err) => return Maybe::Err(err.with_path(p.slice())),
                    Maybe::Ok(fd) => fd,
                }
            }
            PathOrFileDescriptor::Fd(fd) => *fd,
        };
        let fd = match fd_maybe_windows.make_libuv_owned() {
            Ok(fd) => fd,
            Err(_) => {
                if path_is_path { fd_maybe_windows.close(); }
                return Maybe::Err(sys::Error { errno: E::MFILE as _, syscall: sys::Tag::open, ..Default::default() });
            }
        };
        let _close = scopeguard::guard((fd, path_is_path), |(fd, is_path)| {
            if is_path { fd.close(); }
        });

        if args.aborted() { return Maybe::<ret::ReadFileWithOptions>::aborted(); }

        // Only used in DOMFormData
        if args.offset > 0 {
            let _ = sys::set_file_offset(fd, args.offset as u64);
        }

        let mut did_succeed = false;
        let mut total: usize = 0;

        // --- Optimization: attempt to read up to 256 KB before calling stat()
        // If we manage to read the entire file, we don't need to call stat() at all.
        // This will make it slightly slower to read e.g. 512 KB files, but usually the OS won't return a full 512 KB in one read anyway.
        //
        // PORT NOTE: Zig used a 256 KB *stack* buffer in the async case and the
        // VM's `rareData().pipeReadBuffer()` (a per-VM 256 KB heap slab) in the
        // sync case. Rust can't put 256 KB on the stack portably, and the
        // RareData accessor is ``-gated (b2-cycle), so for round 3
        // both flavors use a transient heap buffer. Same observable behaviour;
        // revisit once `rare_data().pipe_read_buffer()` is real.
        let mut tmp_read_backing: Vec<u8> = vec![0u8; 256 * 1024];
        let temporary_read_buffer_before_stat_call: &[u8] = {
            let mut available: &mut [u8] = &mut tmp_read_backing[..];
            while !available.is_empty() {
                match Syscall::read(fd, available) {
                    Maybe::Err(err) => return Maybe::Err(err),
                    Maybe::Ok(amt) => {
                        if amt == 0 { did_succeed = true; break; }
                        total += amt;
                        available = &mut available[amt..];
                    }
                }
            }
            &tmp_read_backing[..total]
        };

        if did_succeed {
            return match args.encoding {
                Encoding::Buffer => {
                    // PORT NOTE: Zig's sync+default fast-path went through
                    // `jsc.ArrayBuffer.createBuffer(vm.global, ..)` to land the bytes
                    // directly in JSC's heap (avoids a WastefulTypedArray). That
                    // path needs `self.vm` + `as_array_buffer`, both gated; fall back
                    // to the `Buffer::from_bytes(dupe)` branch which Zig also uses
                    // when `this.vm == null`.
                    // TODO(port-jsc): re-introduce the create_buffer fast-path.
                    let raw = Box::into_raw(
                        temporary_read_buffer_before_stat_call.to_vec().into_boxed_slice(),
                    );
                    // SAFETY: ownership transferred to JSC; freed via ArrayBuffer finalizer
                    // (PORTING.md:348 — `Box::into_raw`/`from_raw` across FFI).
                    Maybe::Ok(ret::ReadFileWithOptions::Buffer(
                        Buffer::from_bytes(unsafe { &mut *raw }, bun_jsc::JSType::Uint8Array),
                    ))
                }
                _ => {
                    if string_type == ReadFileStringType::Default {
                        Maybe::Ok(ret::ReadFileWithOptions::TranscodedString(
                            webcore::encoding::to_bun_string(temporary_read_buffer_before_stat_call, args.encoding),
                        ))
                    } else {
                        let mut z = temporary_read_buffer_before_stat_call.to_vec();
                        z.push(0);
                        Maybe::Ok(ret::ReadFileWithOptions::NullTerminated(
                            bun_core::ZBox::from_vec_with_nul(z),
                        ))
                    }
                }
            };
        }
        // ----------------------------

        if args.aborted() { return Maybe::<ret::ReadFileWithOptions>::aborted(); }

        let stat_ = match Syscall::fstat(fd) {
            Maybe::Err(err) => return Maybe::Err(err),
            Maybe::Ok(stat_) => stat_,
        };

        // For certain files, the size might be 0 but the file might still have contents.
        // https://github.com/oven-sh/bun/issues/1220
        let max_size: u64 = args.max_size.map(|v| v as u64).unwrap_or(BLOB_SIZE_MAX);
        let has_max_size = args.max_size.is_some();

        let size: u64 = (stat_.size as i64)
            .min(max_size as i64) // Only used in DOMFormData
            .max(total as i64)
            .max(0) as u64
            + (string_type == ReadFileStringType::NullTerminated) as u64;

        if args.limit_size_for_javascript &&
            // assume that anything more than 40 bits is not trustworthy.
            size < (1u64 << 40)
        {
            if let Some(err) = Self::should_throw_out_of_memory_early_for_javascript(args.encoding, size as usize, sys::Tag::read) {
                return Maybe::Err(err.with_path_like(&args.path));
            }
        }

        let mut buf: Vec<u8> = Vec::new();
        let initial_cap = (temporary_read_buffer_before_stat_call.len() as u64)
            .max(size)
            .saturating_add(16)
            .min(max_size)
            .min(1024 * 1024 * 1024 * 8) as usize;
        if buf.try_reserve_exact(initial_cap).is_err() {
            return Maybe::Err(sys::Error::from_code(E::NOMEM, sys::Tag::read).with_path_like(&args.path));
        }
        if !temporary_read_buffer_before_stat_call.is_empty() {
            buf.extend_from_slice(temporary_read_buffer_before_stat_call);
        }
        // PORT NOTE: Zig `buf.expandToCapacity()` then indexed `buf.items.ptr[total..cap]`
        // to read into uninitialised tail. Rust forbids indexing past `len`, so we
        // `resize` to capacity (zero-filling the tail). Slightly more work than the Zig,
        // but keeps the slice handed to `Syscall::read` valid.
        let cap = buf.capacity();
        buf.resize(cap, 0);
        drop(tmp_read_backing);

        // Two-phase read: first up to `size`, then keep going until EOF.
        // PORT NOTE: Zig spelled this as `while (total < size) { ... } else { while (true) { ... } }`.
        // Rust has no while/else; use an explicit `phase` flag — `phase == 0` is the
        // size-bounded loop, `phase == 1` is the unbounded tail.
        let mut phase: u8 = if (total as u64) < size { 0 } else { 1 };
        loop {
            if args.aborted() { return Maybe::<ret::ReadFileWithOptions>::aborted(); }
            // Spec parity (node_fs.zig:5327-5377): when `total == min(buf.capacity, max_size)`
            // the next read receives an empty slice → returns 0 → `did_succeed = true; break`.
            // Do NOT pre-grow here; growth happens only in the `total > size && amt != 0 &&
            // !has_max_size` arm below.
            let upper = (buf.capacity() as u64).min(max_size) as usize;
            match Syscall::read(fd, &mut buf[total..upper]) {
                Maybe::Err(err) => return Maybe::Err(err),
                Maybe::Ok(amt) => {
                    total += amt;

                    if args.limit_size_for_javascript {
                        if let Some(err) = Self::should_throw_out_of_memory_early_for_javascript(args.encoding, total, sys::Tag::read) {
                            return Maybe::Err(err.with_path_like(&args.path));
                        }
                    }

                    // There are cases where stat()'s size is wrong or out of date
                    if (total as u64) > size && amt != 0 && !has_max_size {
                        if buf.try_reserve(8192).is_err() {
                            return Maybe::Err(sys::Error::from_code(E::NOMEM, sys::Tag::read).with_path_like(&args.path));
                        }
                        let cap = buf.capacity();
                        buf.resize(cap, 0);
                        continue;
                    }

                    if amt == 0 { did_succeed = true; break; }

                    if phase == 0 && (total as u64) >= size {
                        // fall through into the unbounded tail loop
                        phase = 1;
                    }
                }
            }
        }
        let _ = phase; // phase only mirrors Zig's while/else split for source parity

        let final_len = if string_type == ReadFileStringType::NullTerminated { total + 1 } else { total };
        if total == 0 {
            drop(buf);
            return match args.encoding {
                Encoding::Buffer => Maybe::Ok(ret::ReadFileWithOptions::Buffer(Buffer::EMPTY)),
                _ => {
                    if string_type == ReadFileStringType::Default {
                        Maybe::Ok(ret::ReadFileWithOptions::String(Box::<[u8]>::default()))
                    } else {
                        Maybe::Ok(ret::ReadFileWithOptions::NullTerminated(bun_core::ZBox::from_vec_with_nul(vec![0u8])))
                    }
                }
            };
        }
        let _ = did_succeed; // Zig used this only to gate the `defer buf.clearAndFree()`;
                             // Rust drops `buf` on every error-return above.

        match args.encoding {
            Encoding::Buffer => {
                buf.truncate(final_len);
                let raw = Box::into_raw(buf.into_boxed_slice());
                // SAFETY: ownership transferred to JSC; freed via ArrayBuffer finalizer
                // (PORTING.md:348 — `Box::into_raw`/`from_raw` across FFI).
                Maybe::Ok(ret::ReadFileWithOptions::Buffer(
                    Buffer::from_bytes(unsafe { &mut *raw }, bun_jsc::JSType::Uint8Array),
                ))
            }
            _ => {
                if string_type == ReadFileStringType::Default {
                    buf.truncate(final_len);
                    Maybe::Ok(ret::ReadFileWithOptions::String(buf.into_boxed_slice()))
                } else {
                    // null_terminated: ensure buf[total] == 0 and hand back as ZBox.
                    if buf.len() < total + 1 {
                        if buf.try_reserve_exact(1).is_err() {
                            return Maybe::Err(sys::Error::from_code(E::NOMEM, sys::Tag::read).with_path_like(&args.path));
                        }
                        buf.push(0);
                    } else {
                        buf[total] = 0;
                    }
                    buf.truncate(total + 1);
                    Maybe::Ok(ret::ReadFileWithOptions::NullTerminated(
                        bun_core::ZBox::from_vec_with_nul(buf),
                    ))
                }
            }
        }
    }

    pub fn write_file_with_path_buffer(pathbuf: &mut PathBuffer, args: &args::WriteFile) -> Maybe<ret::WriteFile> {
        let fd = match &args.file {
            PathOrFileDescriptor::Path(p) => {
                let path = p.slice_z_with_force_copy(pathbuf, true);
                match sys::openat(args.dirfd, path, args.flag.as_int(), args.mode) {
                    Maybe::Err(err) => return Maybe::Err(err.with_path(p.slice())),
                    Maybe::Ok(fd) => fd,
                }
            }
            PathOrFileDescriptor::Fd(fd) => *fd,
        };
        let _close = scopeguard::guard((fd, matches!(args.file, PathOrFileDescriptor::Path(_))), |(fd, is_path)| {
            if is_path { fd.close(); }
        });

        if args.aborted() { return Maybe::<ret::WriteFile>::ABORTED; }

        let mut buf = args.data.slice();
        let mut written: usize = 0;

        // Attempt to pre-allocate large files
        // Worthwhile after 6 MB at least on ext4 linux
        if PREALLOCATE_SUPPORTED && buf.len() >= PREALLOCATE_LENGTH {
            'preallocate: {
                let offset: usize = if matches!(args.file, PathOrFileDescriptor::Path(_)) {
                    // on mac, it's relatively positioned
                    0
                } else {
                    // on linux, it's absolutely positioned
                    match Syscall::lseek(fd, 0, libc::SEEK_CUR) {
                        Maybe::Err(_) => break 'preallocate,
                        Maybe::Ok(pos) => usize::try_from(pos).unwrap(),
                    }
                };
                let _ = sys::preallocate_file(
                    fd.cast(),
                    i64::try_from(offset).unwrap(),
                    i64::try_from(buf.len()).unwrap(),
                );
            }
        }

        while !buf.is_empty() {
            match sys::write(fd, buf) {
                Maybe::Err(err) => return Maybe::Err(err),
                Maybe::Ok(amt) => {
                    buf = &buf[amt..];
                    written += amt;
                    if amt == 0 { break; }
                }
            }
        }

        // https://github.com/oven-sh/bun/issues/2931
        // https://github.com/oven-sh/bun/issues/10222
        // Only truncate if we're not appending and writing to a path
        if (args.flag.as_int() & sys::O::APPEND) == 0 && !matches!(args.file, PathOrFileDescriptor::Fd(_)) {
            // If this errors, we silently ignore it.
            // Not all files are seekable (and thus, not all files can be truncated).
            #[cfg(windows)] { let _ = unsafe { windows::SetEndOfFile(fd.cast()) }; }
            #[cfg(not(windows))] { let _ = Syscall::ftruncate(fd, (written as u64 & ((1u64 << 63) - 1)) as i64); }
        }

        if args.flush {
            #[cfg(windows)] { let _ = unsafe { windows::kernel32::FlushFileBuffers(fd.cast()) }; }
            #[cfg(not(windows))] { let _ = unsafe { libc::fsync(fd.cast()) }; }
        }

        Maybe::Ok(())
    }

    pub fn write_file(&mut self, args: &args::WriteFile, _: Flavor) -> Maybe<ret::WriteFile> {
        Self::write_file_with_path_buffer(&mut self.sync_error_buf, args)
    }

    pub fn readlink(&mut self, args: &args::Readlink, _: Flavor) -> Maybe<ret::Readlink> {
        let mut outbuf = PathBuffer::uninit();
        let inbuf = &mut self.sync_error_buf;
        let path = args.path.slice_z(inbuf);
        let link_path = match Syscall::readlink(path, &mut outbuf) {
            Maybe::Err(err) => return Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(result) => result,
        };
        Maybe::Ok(match args.encoding {
            Encoding::Buffer => StringOrBuffer::Buffer(Buffer::from_string(link_path).expect("unreachable")),
            _ => {
                if let PathLike::SliceWithUnderlyingString(s) = &args.path {
                    if strings::eql_long(s.slice(), link_path, true) {
                        return Maybe::Ok(StringOrBuffer::String(s.dupe_ref()));
                    }
                }
                StringOrBuffer::String(node::SliceWithUnderlyingString { utf8: Default::default(), underlying: BunString::clone_utf8(link_path) })
            }
        })
    }

    pub fn realpath_non_native(&mut self, args: &args::Realpath, _: Flavor) -> Maybe<ret::Realpath> {
        match self.realpath_inner(args, RealpathVariant::Emulated) {
            Maybe::Ok(res) => Maybe::Ok(res),
            Maybe::Err(err) => Maybe::Err(sys::Error { errno: err.errno, syscall: sys::Tag::lstat, path: args.path.slice().into(), ..Default::default() }),
        }
    }

    pub fn realpath(&mut self, args: &args::Realpath, _: Flavor) -> Maybe<ret::Realpath> {
        match self.realpath_inner(args, RealpathVariant::Native) {
            Maybe::Ok(res) => Maybe::Ok(res),
            Maybe::Err(err) => Maybe::Err(sys::Error { errno: err.errno, syscall: sys::Tag::realpath, path: args.path.slice().into(), ..Default::default() }),
        }
    }

    // For `fs.realpath`, Node.js uses `lstat`, exposing the native system call under
    // `fs.realpath.native`. In Bun, the system call is the default, but the error
    // code must be changed to make it seem like it is using lstat (tests expect this),
    // in addition, some more subtle things depend on the variant.
    pub fn realpath_inner(&mut self, args: &args::Realpath, variant: RealpathVariant) -> Maybe<ret::Realpath> {
        #[cfg(windows)]
        {
            let mut req = uv::fs_t::UNINITIALIZED;
            let _d = scopeguard::guard(&mut req, |r| r.deinit());
            let rc = unsafe { uv::uv_fs_realpath(bun_aio::Loop::get(), &mut req, args.path.slice_z(&mut self.sync_error_buf).as_ptr(), None) };
            if let Some(errno) = rc.errno() {
                return Maybe::Err(sys::Error { errno, syscall: sys::Tag::realpath, path: args.path.slice().into(), ..Default::default() });
            }
            let result_ptr: Option<*const c_char> = req.ptr_as::<Option<*const c_char>>();
            let Some(ptr) = result_ptr else {
                return Maybe::Err(sys::Error { errno: E::NOENT as _, syscall: sys::Tag::realpath, path: args.path.slice().into(), ..Default::default() });
            };
            let mut buf = unsafe { core::ffi::CStr::from_ptr(ptr) }.to_bytes();
            if variant == RealpathVariant::Emulated {
                // remove the trailing slash
                if buf.last() == Some(&b'\\') {
                    // SAFETY: req.path is mutable
                    unsafe { *(ptr as *mut u8).add(buf.len() - 1) = 0; }
                    buf = &buf[..buf.len() - 1];
                }
            }
            return Maybe::Ok(match args.encoding {
                Encoding::Buffer => StringOrBuffer::Buffer(Buffer::from_string(buf).expect("unreachable")),
                Encoding::Utf8 => {
                    if let PathLike::SliceWithUnderlyingString(s) = &args.path {
                        if strings::eql_long(s.slice(), buf, true) {
                            return Maybe::Ok(StringOrBuffer::String(s.dupe_ref()));
                        }
                    }
                    StringOrBuffer::String(node::SliceWithUnderlyingString { utf8: Default::default(), underlying: BunString::clone_utf8(buf) })
                }
                enc => StringOrBuffer::String(node::SliceWithUnderlyingString { utf8: Default::default(), underlying: webcore::encoding::to_bun_string(buf, enc) }),
            });
        }

        #[cfg(not(windows))]
        {
            let mut outbuf = PathBuffer::uninit();
            let inbuf = &mut self.sync_error_buf;
            debug_assert!(FileSystem::INSTANCE_LOADED.load(Ordering::Relaxed));

            let path_slice = args.path.slice();
            let parts = [FileSystem::instance().top_level_dir, path_slice];
            let path_ = FileSystem::instance().abs_buf(&parts, inbuf);
            inbuf[path_.len()] = 0;
            let path = unsafe { ZStr::from_raw(inbuf.as_ptr(), path_.len()) };

            #[cfg(target_os = "linux")]
            let flags = sys::O::PATH; // O_PATH is faster
            #[cfg(not(target_os = "linux"))]
            let flags = sys::O::RDONLY | sys::O::NONBLOCK | sys::O::NOCTTY;

            let fd = match sys::open(path, flags, 0) {
                Maybe::Err(err) => return Maybe::Err(err.with_path(path)),
                Maybe::Ok(fd_) => fd_,
            };
            let _close = scopeguard::guard(fd, |fd| fd.close());

            let buf = match Syscall::get_fd_path(fd, &mut outbuf) {
                Maybe::Err(err) => return Maybe::Err(err.with_path(path)),
                Maybe::Ok(buf_) => buf_,
            };

            let _ = variant;
            Maybe::Ok(match args.encoding {
                Encoding::Buffer => StringOrBuffer::Buffer(Buffer::from_string(buf).expect("unreachable")),
                Encoding::Utf8 => {
                    if let PathLike::SliceWithUnderlyingString(s) = &args.path {
                        if strings::eql_long(s.slice(), buf, true) {
                            return Maybe::Ok(StringOrBuffer::String(s.dupe_ref()));
                        }
                    }
                    StringOrBuffer::String(node::SliceWithUnderlyingString { utf8: Default::default(), underlying: BunString::clone_utf8(buf) })
                }
                enc => StringOrBuffer::String(node::SliceWithUnderlyingString { utf8: Default::default(), underlying: webcore::encoding::to_bun_string(buf, enc) }),
            })
        }
    }

    pub const realpath_native: fn(&mut NodeFS, &args::Realpath, Flavor) -> Maybe<ret::Realpath> = Self::realpath;

    pub fn rename(&mut self, args: &args::Rename, _: Flavor) -> Maybe<ret::Rename> {
        let from_buf = &mut self.sync_error_buf;
        let mut to_buf = PathBuffer::uninit();
        let from = args.old_path.slice_z(from_buf);
        let to = args.new_path.slice_z(&mut to_buf);
        match Syscall::rename(from, to) {
            Maybe::Ok(result) => Maybe::Ok(result),
            Maybe::Err(err) => Maybe::Err(err.with_path_dest(args.old_path.slice(), args.new_path.slice())),
        }
    }

    pub fn rmdir(&mut self, args: &args::RmDir, _: Flavor) -> Maybe<ret::Rmdir> {
        if args.recursive {
            if let Err(err) = zig_delete_tree(sys::Dir::cwd(), args.path.slice(), sys::FileKind::Directory) {
                let mut errno: E = map_anyerror_to_errno(err);
                if cfg!(windows) && errno == E::NOTDIR { errno = E::NOENT; }
                return Maybe::Err(sys::Error::from_code(errno, sys::Tag::rmdir));
            }
            return Maybe::Ok(());
        }
        #[cfg(windows)]
        {
            return match Syscall::rmdir(args.path.slice_z(&mut self.sync_error_buf)) {
                Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
                Maybe::Ok(result) => Maybe::Ok(result),
            };
        }
        // SAFETY: path is NUL-terminated by slice_z; rmdir(2) is the libc FFI
        Maybe::<ret::Rmdir>::errno_sys_p(unsafe { libc::rmdir(args.path.slice_z(&mut self.sync_error_buf).as_ptr().cast()) }, sys::Tag::rmdir, args.path.slice())
            .unwrap_or(Maybe::Ok(()))
    }

    pub fn rm(&mut self, args: &args::Rm, _: Flavor) -> Maybe<ret::Rm> {
        // We cannot use removefileat() on macOS because it does not handle write-protected files as expected.
        if args.recursive {
            if let Err(err) = zig_delete_tree(sys::Dir::cwd(), args.path.slice(), sys::FileKind::File) {
                let errno = if err == bun_core::err!("FileNotFound") {
                    if args.force { return Maybe::Ok(()); }
                    E::NOENT
                } else {
                    map_anyerror_to_errno_rm_tree(err)
                };
                return Maybe::Err(sys::Error::from_code(errno, sys::Tag::rm).with_path(args.path.slice()));
            }
            return Maybe::Ok(());
        }

        let dest = args.path.slice_z(&mut self.sync_error_buf);
        // PORT NOTE: Zig used `std.posix.unlinkZ/rmdirZ` (which return Zig error
        // sets). The Rust port goes straight to `bun_sys::unlink/rmdir` returning
        // `Maybe<()>` with a `sys::Error` carrying the errno, so the
        // `bun_core::err!("…")`/`map_anyerror_to_errno*` round-trip collapses to
        // a direct errno match — semantically identical, fewer allocations.
        if let Maybe::Err(err1) = sys::unlink(dest) {
            let e1 = err1.get_errno();
            // empirically, it seems to return AccessDenied when the
            // file is actually a directory on macOS.
            if args.recursive && matches!(e1, E::EISDIR | E::NOTDIR | E::ACCES | E::PERM) {
                // SAFETY: `dest` is NUL-terminated by `slice_z`; rmdir(2) is the libc FFI.
                if let Some(err2) = Maybe::<()>::errno_sys_p(unsafe { libc::rmdir(dest.as_ptr().cast()) }, sys::Tag::rmdir, args.path.slice()) {
                    let Maybe::Err(err2) = err2 else { return Maybe::Ok(()) };
                    if err2.get_errno() == E::NOENT && args.force { return Maybe::Ok(()); }
                    return Maybe::Err(err2.with_path_and_syscall(args.path.slice(), sys::Tag::rm));
                }
                return Maybe::Ok(());
            }
            if e1 == E::NOENT && args.force { return Maybe::Ok(()); }
            return Maybe::Err(err1.with_path_and_syscall(args.path.slice(), sys::Tag::rm));
        }
        Maybe::Ok(())
    }

    pub fn statfs(&mut self, args: &args::StatFS, _: Flavor) -> Maybe<ret::StatFS> {
        match Syscall::statfs(args.path.slice_z(&mut self.sync_error_buf)) {
            Maybe::Ok(result) => Maybe::Ok(ret::StatFS::init(&result, args.big_int)),
            Maybe::Err(err) => Maybe::Err(err),
        }
    }

    pub fn stat(&mut self, args: &args::Stat, _: Flavor) -> Maybe<ret::Stat> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        if let Some(graph) = standalone_module_graph_get() {
            if let Some(result) = graph.stat(path) {
                return Maybe::Ok(StatOrNotFound::Stats(Stats::init(&PosixStat::init(&result), args.big_int)));
            }
        }
        // TODO(port): `Syscall::statx` — blocked_on: bun_sys::statx (see fstat).
        match Syscall::stat(path) {
            Maybe::Ok(result) => Maybe::Ok(StatOrNotFound::Stats(Stats::init(&PosixStat::init(&result), args.big_int))),
            Maybe::Err(err) => {
                if !args.throw_if_no_entry && err.get_errno() == E::NOENT {
                    return Maybe::Ok(StatOrNotFound::NotFound);
                }
                Maybe::Err(err.with_path(args.path.slice()))
            }
        }
    }

    pub fn symlink(&mut self, args: &args::Symlink, _: Flavor) -> Maybe<ret::Symlink> {
        let mut to_buf = PathBuffer::uninit();
        #[cfg(windows)]
        {
            // node_fs.zig:5943-6014.
            const UV_FS_SYMLINK_DIR: c_int = 0x0001;
            const UV_FS_SYMLINK_JUNCTION: c_int = 0x0002;
            #[derive(Clone, Copy, PartialEq, Eq)]
            enum ResolvedLinkType { File, Dir, Junction }

            let target_path = args.target_path.slice();
            let new_path = args.new_path.slice();
            // Note: to_buf and sync_error_buf hold intermediate states, but the
            // ending state is:
            //    - new_path is in &sync_error_buf
            //    - target_path is in &to_buf

            // Stat target if unspecified.
            let resolved_link_type: ResolvedLinkType = match args.link_type {
                args::SymlinkLinkType::File => ResolvedLinkType::File,
                args::SymlinkLinkType::Dir => ResolvedLinkType::Dir,
                args::SymlinkLinkType::Junction => ResolvedLinkType::Junction,
                args::SymlinkLinkType::Unspecified => 'auto_detect: {
                    let cwd = match sys::getcwd(&mut to_buf) {
                        Maybe::Ok(c) => c,
                        Maybe::Err(_) => panic!("failed to resolve current working directory"),
                    };
                    let dir = bun_core::dirname(new_path).unwrap_or(new_path);
                    let src_len = paths::resolve_path::join_abs_string_buf::<paths::platform::Windows>(
                        cwd,
                        &mut self.sync_error_buf[..],
                        &[dir, target_path],
                    ).len();
                    self.sync_error_buf[src_len] = 0;
                    // SAFETY: NUL just written at [src_len].
                    let src_z = unsafe { ZStr::from_raw(self.sync_error_buf.as_ptr(), src_len) };
                    break 'auto_detect match sys::directory_exists_at(FD::INVALID, src_z) {
                        Maybe::Err(_) => ResolvedLinkType::File,
                        Maybe::Ok(is_dir) => if is_dir { ResolvedLinkType::Dir } else { ResolvedLinkType::File },
                    };
                }
            };
            // preprocessSymlinkDestination
            // - junctions: make absolute with long path prefix
            // - absolute paths: add long path prefix
            // - all: no forward slashes
            let processed_target: &ZStr = 'target: {
                if resolved_link_type == ResolvedLinkType::Junction {
                    // this is similar to the `const src` above, but these cases
                    // are mutually exclusive, so it isn't repeating any work.
                    let cwd = match sys::getcwd(&mut to_buf) {
                        Maybe::Ok(c) => c,
                        Maybe::Err(_) => panic!("failed to resolve current working directory"),
                    };
                    let dir = bun_core::dirname(new_path).unwrap_or(new_path);
                    let target_len = paths::resolve_path::join_abs_string_buf::<paths::platform::Windows>(
                        cwd,
                        &mut self.sync_error_buf[4..],
                        &[dir, target_path],
                    ).len();
                    self.sync_error_buf[0..4].copy_from_slice(&paths::windows::LONG_PATH_PREFIX_U8);
                    self.sync_error_buf[4 + target_len] = 0;
                    // SAFETY: NUL written; bytes [0..4+target_len] initialised above.
                    break 'target unsafe { ZStr::from_raw(self.sync_error_buf.as_ptr(), 4 + target_len) };
                }
                if paths::is_absolute(target_path) {
                    // This normalizes slashes and adds the long path prefix
                    break 'target args.target_path.slice_z_with_force_copy::<true>(&mut self.sync_error_buf);
                }
                self.sync_error_buf[..target_path.len()].copy_from_slice(target_path);
                self.sync_error_buf[target_path.len()] = 0;
                paths::resolve_path::dangerously_convert_path_to_windows_in_place::<u8>(
                    &mut self.sync_error_buf[..target_path.len()],
                );
                // SAFETY: NUL written at [target_path.len()].
                break 'target unsafe { ZStr::from_raw(self.sync_error_buf.as_ptr(), target_path.len()) };
            };
            return match Syscall::symlink_uv(
                processed_target,
                args.new_path.slice_z(&mut to_buf),
                match resolved_link_type {
                    ResolvedLinkType::File => 0,
                    ResolvedLinkType::Dir => UV_FS_SYMLINK_DIR,
                    ResolvedLinkType::Junction => UV_FS_SYMLINK_JUNCTION,
                },
            ) {
                Maybe::Err(err) => Maybe::Err(err.with_path_dest(args.target_path.slice(), args.new_path.slice())),
                Maybe::Ok(result) => Maybe::Ok(result),
            };
        }
        #[cfg(not(windows))]
        match Syscall::symlink(
            args.target_path.slice_z(&mut self.sync_error_buf),
            args.new_path.slice_z(&mut to_buf),
        ) {
            Maybe::Ok(result) => Maybe::Ok(result),
            Maybe::Err(err) => Maybe::Err(err.with_path_dest(args.target_path.slice(), args.new_path.slice())),
        }
    }

    fn truncate_inner(&mut self, path: &PathLike, len: u64, flags: i32) -> Maybe<ret::Truncate> {
        #[cfg(windows)]
        {
            let file = sys::open(path.slice_z(&mut self.sync_error_buf), sys::O::WRONLY | flags, 0o644);
            let Maybe::Ok(fd) = file else {
                let Maybe::Err(e) = file else { unreachable!() };
                return Maybe::Err(sys::Error { errno: e.errno, path: path.slice().into(), syscall: sys::Tag::truncate, ..Default::default() });
            };
            let _close = scopeguard::guard(fd, |fd| fd.close());
            return match Syscall::ftruncate(fd, i64::try_from(len).unwrap()) {
                Maybe::Ok(r) => Maybe::Ok(r),
                Maybe::Err(err) => Maybe::Err(err.with_path_and_syscall(path.slice(), sys::Tag::truncate)),
            };
        }
        let _ = flags;
        // SAFETY: path is NUL-terminated by slice_z; truncate(2) is the libc FFI
        Maybe::<ret::Truncate>::errno_sys_p(unsafe { libc::truncate(path.slice_z(&mut self.sync_error_buf).as_ptr().cast(), i64::try_from(len).unwrap()) }, sys::Tag::truncate, path.slice())
            .unwrap_or(Maybe::Ok(()))
    }

    pub fn truncate(&mut self, args: &args::Truncate, _: Flavor) -> Maybe<ret::Truncate> {
        match &args.path {
            PathOrFileDescriptor::Fd(fd) => Syscall::ftruncate(*fd, i64::try_from(args.len).unwrap()),
            PathOrFileDescriptor::Path(p) => self.truncate_inner(p, args.len, args.flags),
        }
    }

    pub fn unlink(&mut self, args: &args::Unlink, _: Flavor) -> Maybe<ret::Unlink> {
        #[cfg(windows)]
        {
            return match Syscall::unlink(args.path.slice_z(&mut self.sync_error_buf)) {
                Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
                Maybe::Ok(result) => Maybe::Ok(result),
            };
        }
        // SAFETY: path is NUL-terminated by slice_z; unlink(2) is the libc FFI
        Maybe::<ret::Unlink>::errno_sys_p(unsafe { libc::unlink(args.path.slice_z(&mut self.sync_error_buf).as_ptr().cast()) }, sys::Tag::unlink, args.path.slice())
            .unwrap_or(Maybe::Ok(()))
    }

    // TODO(b2-blocked): args::WatchFile = StatWatcher::Arguments — module gated.
    
    pub fn watch_file(&mut self, args: &args::WatchFile, flavor: Flavor) -> Maybe<ret::WatchFile> {
        debug_assert!(flavor == Flavor::Sync);
        let watcher = match args.create_stat_watcher() {
            Ok(w) => w,
            Err(err) => {
                let mut buf = Vec::new();
                use std::io::Write as _;
                let _ = write!(&mut buf, "Failed to watch file {}", bun_core::fmt::QuotedFormatter { text: args.path.slice() });
                let _ = args.global_this.throw_value(bun_jsc::SystemError {
                    message: BunString::init(&buf),
                    code: BunString::init(err.name()),
                    path: BunString::init(args.path.slice()),
                    ..Default::default()
                }.to_error_instance(args.global_this));
                return Maybe::Ok(JSValue::UNDEFINED);
            }
        };
        Maybe::Ok(watcher)
    }

    pub fn unwatch_file(&mut self, _: &args::UnwatchFile, _: Flavor) -> Maybe<ret::UnwatchFile> {
        Maybe::<ret::UnwatchFile>::todo()
    }

    pub fn utimes(&mut self, args: &args::Utimes, _: Flavor) -> Maybe<ret::Utimes> {
        #[cfg(windows)]
        {
            let mut req = uv::fs_t::UNINITIALIZED;
            let _d = scopeguard::guard(&mut req, |r| r.deinit());
            let rc = unsafe { uv::uv_fs_utime(bun_aio::Loop::get(), &mut req, args.path.slice_z(&mut self.sync_error_buf).as_ptr(), args.atime, args.mtime, None) };
            return if let Some(errno) = rc.errno() {
                Maybe::Err(sys::Error { errno, syscall: sys::Tag::utime, path: args.path.slice().into(), ..Default::default() })
            } else { Maybe::Ok(()) };
        }
        match Syscall::utimens(args.path.slice_z(&mut self.sync_error_buf), args.atime, args.mtime) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(_) => Maybe::Ok(()),
        }
    }

    pub fn lutimes(&mut self, args: &args::Lutimes, _: Flavor) -> Maybe<ret::Lutimes> {
        #[cfg(windows)]
        {
            let mut req = uv::fs_t::UNINITIALIZED;
            let _d = scopeguard::guard(&mut req, |r| r.deinit());
            let rc = unsafe { uv::uv_fs_lutime(bun_aio::Loop::get(), &mut req, args.path.slice_z(&mut self.sync_error_buf).as_ptr(), args.atime, args.mtime, None) };
            return if let Some(errno) = rc.errno() {
                Maybe::Err(sys::Error { errno, syscall: sys::Tag::utime, path: args.path.slice().into(), ..Default::default() })
            } else { Maybe::Ok(()) };
        }
        match Syscall::lutimens(args.path.slice_z(&mut self.sync_error_buf), args.atime, args.mtime) {
            Maybe::Err(err) => Maybe::Err(err.with_path(args.path.slice())),
            Maybe::Ok(_) => Maybe::Ok(()),
        }
    }

    // TODO(b2-blocked): args::Watch = Watcher::Arguments — module gated.
    
    pub fn watch(&mut self, args: &args::Watch, _: Flavor) -> Maybe<ret::Watch> {
        match args.create_fs_watcher() {
            Maybe::Ok(result) => Maybe::Ok(result.js_this),
            Maybe::Err(err) => Maybe::Err(err),
        }
    }

    /// This function is `cpSync`, but only if you pass `{ recursive: ..., force: ..., errorOnExist: ..., mode: ... }'
    /// The other options like `filter` use a JS fallback, see `src/js/internal/fs/cp.ts`
    pub fn cp(&mut self, args: &args::Cp, _: Flavor) -> Maybe<ret::Cp> {
        let mut src_buf = OSPathBuffer::uninit();
        let mut dest_buf = OSPathBuffer::uninit();
        let src = args.src.os_path(&mut src_buf);
        let dest = args.dest.os_path(&mut dest_buf);
        self.cp_sync_inner(
            &mut src_buf,
            PathInt::try_from(src.len()).unwrap(),
            &mut dest_buf,
            PathInt::try_from(dest.len()).unwrap(),
            args,
        )
    }

    pub fn os_path_into_sync_error_buf(&mut self, slice: &[OSPathChar]) -> &[u8] {
        Self::os_path_into_buf(&mut self.sync_error_buf, slice)
    }

    /// Free-function form of [`os_path_into_sync_error_buf`] that does not borrow
    /// `&mut self`. Needed by `mkdir_recursive_os_path_impl`, which holds a long-lived
    /// `&mut OSPathBuffer` reinterpreted from `sync_error_buf` and so must not reborrow
    /// `&mut self` on its error-return paths (PORTING.md §Forbidden aliased `&mut`).
    fn os_path_into_buf<'a>(buf: &'a mut PathBuffer, slice: &[OSPathChar]) -> &'a [u8] {
        #[cfg(windows)]
        { return strings::from_wpath(buf, slice); }
        #[cfg(not(windows))]
        {
            buf[..slice.len()].copy_from_slice(slice);
            &buf[..slice.len()]
        }
    }

    pub fn os_path_into_sync_error_buf_overlap(&mut self, slice: &[OSPathChar]) -> &[u8] {
        #[cfg(windows)]
        {
            let tmp = paths::os_path_buffer_pool().get();
            tmp[..slice.len()].copy_from_slice(slice);
            return strings::from_wpath(&mut self.sync_error_buf, &tmp[..slice.len()]);
        }
        #[cfg(not(windows))]
        { let _ = slice; &[] } // TODO(port): zig fn has no posix branch (returns void?)
    }

    fn cp_sync_inner(
        &mut self,
        src_buf: &mut OSPathBuffer, src_dir_len: PathInt,
        dest_buf: &mut OSPathBuffer, dest_dir_len: PathInt,
        args: &args::Cp,
    ) -> Maybe<ret::Cp> {
        let cp_flags = &args.flags;
        let sd = src_dir_len as usize;
        let dd = dest_dir_len as usize;
        // SAFETY: caller wrote NUL at [len]; constructing the sentinel slices.
        src_buf[sd] = 0;
        dest_buf[dd] = 0;
        let src = unsafe { OSPathSliceZ::from_raw(src_buf.as_ptr(), sd) };
        let dest = unsafe { OSPathSliceZ::from_raw(dest_buf.as_ptr(), dd) };

        #[cfg(windows)]
        {
            let attributes = unsafe { sys::c::GetFileAttributesW(src.as_ptr()) };
            if attributes == sys::c::INVALID_FILE_ATTRIBUTES {
                return Maybe::Err(sys::Error {
                    errno: SystemErrno::ENOENT as _,
                    syscall: sys::Tag::copyfile,
                    path: self.os_path_into_sync_error_buf(src.as_slice()).into(),
                    ..Default::default()
                });
            }
            if attributes & sys::c::FILE_ATTRIBUTE_DIRECTORY == 0 {
                let r = self._copy_single_file_sync(
                    src, dest,
                    constants::Copyfile::from_raw(if cp_flags.error_on_exist || !cp_flags.force { constants::COPYFILE_EXCL } else { 0i32 }),
                    Some(attributes),
                    args,
                );
                if let Maybe::Err(ref e) = r {
                    if e.errno == E::EEXIST as _ && !cp_flags.error_on_exist { return Maybe::Ok(()); }
                }
                return r;
            }
        }
        #[cfg(not(windows))]
        {
            let stat_ = match Syscall::lstat(src) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => {
                    self.sync_error_buf[..sd].copy_from_slice(src.as_bytes());
                    return Maybe::Err(err.with_path(&self.sync_error_buf[..sd]));
                }
            };
            if !sys::S::ISDIR(stat_.st_mode as _) {
                let r = self._copy_single_file_sync(
                    src, dest,
                    constants::Copyfile::from_raw(if cp_flags.error_on_exist || !cp_flags.force { constants::COPYFILE_EXCL } else { 0i32 }),
                    Some(stat_),
                    args,
                );
                if let Maybe::Err(ref e) = r {
                    if e.errno == E::EEXIST as _ && !cp_flags.error_on_exist { return Maybe::Ok(()); }
                }
                return r;
            }
        }

        if !cp_flags.recursive {
            return Maybe::Err(sys::Error {
                errno: E::EISDIR as _,
                syscall: sys::Tag::copyfile,
                path: self.os_path_into_sync_error_buf(src.as_slice()).into(),
                ..Default::default()
            });
        }

        #[cfg(target_os = "macos")]
        'try_with_clonefile: {
            if let Some(err) = Maybe::<ret::Cp>::errno_sys_p(
                unsafe { bun_sys::c::clonefile(src.as_ptr(), dest.as_ptr(), 0) },
                sys::Tag::clonefile, src.as_bytes(),
            ) {
                match err.get_errno() {
                    E::ENAMETOOLONG | E::ROFS | E::INVAL | E::ACCES | E::PERM => {
                        if matches!(err.get_errno(), E::ACCES | E::PERM) && args.flags.force {
                            break 'try_with_clonefile;
                        }
                        self.sync_error_buf[..sd].copy_from_slice(src.as_bytes());
                        return Maybe::Err(err.err.with_path(&self.sync_error_buf[..sd]));
                    }
                    // Other errors may be due to clonefile() not being supported
                    // We'll fall back to other implementations
                    _ => {}
                }
            } else {
                return Maybe::Ok(());
            }
        }

        let fd = match openat_os_path(FD::cwd(), src, sys::O::DIRECTORY | sys::O::RDONLY, 0) {
            Maybe::Err(err) => return Maybe::Err(err.with_path(self.os_path_into_sync_error_buf(src.as_slice()))),
            Maybe::Ok(fd_) => fd_,
        };
        let _close = scopeguard::guard(fd, |fd| fd.close());

        match self.mkdir_recursive_os_path(dest, args::Mkdir::DEFAULT_MODE, false) {
            Maybe::Err(err) => return Maybe::Err(err),
            Maybe::Ok(_) => {}
        }

        // PORT NOTE: Zig used `.u16` iterator on Windows so `name.slice()` is `[]u16`.
        // The OSPathBuffer copy below is generic over `OSPathChar`, so on Windows
        // this needs the wide iterator. Gated until `DirIterator::WrappedIteratorW`
        // is wired; the u8 path is correct for POSIX.
        #[cfg(windows)]
        let mut iterator = DirIterator::WrappedIteratorW::init(fd);
        #[cfg(not(windows))]
        let mut iterator = DirIterator::WrappedIterator::init(fd);

        loop {
            let current = match iterator.next() {
                Err(err) => return Maybe::Err(err.with_path(self.os_path_into_sync_error_buf(src.as_slice()))),
                Ok(None) => break,
                Ok(Some(ent)) => ent,
            };
            let name_slice = current.name.slice();

            // The accumulated path for deep directory trees can exceed the fixed
            // OSPathBuffer. Bail out with ENAMETOOLONG instead of writing past the
            // end of the buffer and corrupting the stack.
            if sd + 1 + name_slice.len() >= src_buf.len()
                || dd + 1 + name_slice.len() >= dest_buf.len()
            {
                return Maybe::Err(sys::Error {
                    errno: E::ENAMETOOLONG as _,
                    syscall: sys::Tag::copyfile,
                    path: self.os_path_into_sync_error_buf(&src_buf[..sd]).into(),
                    ..Default::default()
                });
            }

            src_buf[sd + 1..sd + 1 + name_slice.len()].copy_from_slice(name_slice);
            src_buf[sd] = paths::SEP as OSPathChar;
            src_buf[sd + 1 + name_slice.len()] = 0;

            dest_buf[dd + 1..dd + 1 + name_slice.len()].copy_from_slice(name_slice);
            dest_buf[dd] = paths::SEP as OSPathChar;
            dest_buf[dd + 1 + name_slice.len()] = 0;

            match current.kind {
                sys::FileKind::Directory => {
                    let r = self.cp_sync_inner(
                        src_buf, (sd + 1 + name_slice.len()) as PathInt,
                        dest_buf, (dd + 1 + name_slice.len()) as PathInt,
                        args,
                    );
                    if let Maybe::Err(_) = r { return r; }
                }
                _ => {
                    // SAFETY: NUL written at [len] above.
                    let src_z = unsafe { OSPathSliceZ::from_raw(src_buf.as_ptr(), sd + 1 + name_slice.len()) };
                    let dest_z = unsafe { OSPathSliceZ::from_raw(dest_buf.as_ptr(), dd + 1 + name_slice.len()) };
                    let r = self._copy_single_file_sync(
                        src_z, dest_z,
                        constants::Copyfile::from_raw(if cp_flags.error_on_exist || !cp_flags.force { constants::COPYFILE_EXCL } else { 0i32 }),
                        None,
                        args,
                    );
                    if let Maybe::Err(ref e) = r {
                        if e.errno == E::EEXIST as _ && !cp_flags.error_on_exist { continue; }
                        return r;
                    }
                }
            }
        }
        Maybe::Ok(())
    }

    /// On Windows, copying a file onto itself will return EBUSY, which is an
    /// unintuitive and cryptic error to return to the user for an operation
    /// that should seemingly be a no-op.
    ///
    /// So we check if the source and destination are the same file, and if they
    /// are, we return success.
    ///
    /// This is copied directly from libuv's implementation of `uv_fs_copyfile`
    /// for Windows:
    ///
    /// https://github.com/libuv/libuv/blob/497f3168d13ea9a92ad18c28e8282777ec2acf73/src/win/fs.c#L2069
    ///
    /// **This function does nothing on non-Windows platforms**.
    fn should_ignore_ebusy(src: &PathLike, dest: &PathLike, result: Maybe<ret::CopyFile>) -> Maybe<ret::CopyFile> {
        #[cfg(not(windows))] { let _ = (src, dest); return result; }
        #[cfg(windows)]
        {
            let Maybe::Err(ref e) = result else { return result };
            if e.get_errno() != E::BUSY { return result; }
            let mut buf = PathBuffer::uninit();
            let Maybe::Ok(statbuf) = Syscall::stat(src.slice_z(&mut buf)) else { return result };
            let Maybe::Ok(new_statbuf) = Syscall::stat(dest.slice_z(&mut buf)) else { return result };
            if statbuf.dev == new_statbuf.dev && statbuf.ino == new_statbuf.ino {
                return Maybe::Ok(());
            }
            result
        }
    }

    fn _cp_symlink(&mut self, src: &ZStr, dest: &ZStr) -> Maybe<ret::CopyFile> {
        let mut target_buf = PathBuffer::uninit();
        let link_target = match Syscall::readlink(src, &mut target_buf) {
            Maybe::Ok(result) => result,
            Maybe::Err(err) => {
                self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                return Maybe::Err(err.with_path(&self.sync_error_buf[..src.len()]));
            }
        };
        if paths::is_absolute(link_target) {
            return Syscall::symlink(link_target, dest);
        }
        let mut cwd_buf = PathBuffer::uninit();
        let mut resolved_buf = PathBuffer::uninit();
        let src_dir = paths::resolve_path::dirname(src.as_bytes(), paths::Platform::Posix);
        let Ok(cwd) = sys::getcwd(&mut cwd_buf) else {
            // If we can't resolve cwd, preserve the link target as-is rather
            // than pointing the copied link back at the source path.
            return Syscall::symlink(link_target, dest);
        };
        let Some(resolved) = paths::resolve_path::join_abs_string_buf_checked(
            cwd, &mut resolved_buf[..resolved_buf.len() - 1], &[src_dir, link_target], paths::Platform::Posix,
        ) else {
            self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
            return Maybe::Err(sys::Error { errno: E::ENAMETOOLONG as _, syscall: sys::Tag::symlink, path: self.sync_error_buf[..src.len()].into(), ..Default::default() });
        };
        resolved_buf[resolved.len()] = 0;
        Syscall::symlink(unsafe { ZStr::from_raw(resolved_buf.as_ptr(), resolved.len()) }, dest)
    }

    /// This is `copyFile`, but it copies symlinks as-is
    pub fn _copy_single_file_sync(
        &mut self,
        src: &OSPathSliceZ, dest: &OSPathSliceZ, mode: constants::Copyfile,
        /// Stat on posix, file attributes on windows
        #[cfg(windows)] reuse_stat: Option<windows::DWORD>,
        #[cfg(not(windows))] reuse_stat: Option<sys::Stat>,
        args: &args::Cp,
    ) -> Maybe<ret::CopyFile> {
        let _ = args; // only the Windows branch consults `args` (shouldIgnoreEbusy)

        // TODO: do we need to fchown?
        #[cfg(target_os = "macos")]
        {
            if mode.is_force_clone() {
                // https://www.manpagez.com/man/2/clonefile/
                return Maybe::<ret::CopyFile>::errno_sys_p(
                    unsafe { bun_sys::c::clonefile(src.as_ptr(), dest.as_ptr(), 0) },
                    sys::Tag::clonefile, src.as_bytes(),
                ).unwrap_or(Maybe::Ok(()));
            }
            let stat_ = match reuse_stat {
                Some(s) => s,
                None => match Syscall::lstat(src) {
                    Maybe::Ok(result) => result,
                    Maybe::Err(err) => {
                        self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                        return Maybe::Err(err.with_path(&self.sync_error_buf[..src.len()]));
                    }
                },
            };

            if !sys::S::ISREG(stat_.mode) {
                if sys::S::islnk(stat_.mode) {
                    let mut mode_: u32 = bun_sys::c::COPYFILE_ACL | bun_sys::c::COPYFILE_DATA | bun_sys::c::COPYFILE_NOFOLLOW_SRC;
                    if mode.shouldnt_overwrite() { mode_ |= bun_sys::c::COPYFILE_EXCL; }
                    return Maybe::<ret::CopyFile>::errno_sys_p(
                        unsafe { bun_sys::c::copyfile(src.as_ptr(), dest.as_ptr(), core::ptr::null_mut(), mode_) },
                        sys::Tag::copyfile, src.as_bytes(),
                    ).unwrap_or(Maybe::Ok(()));
                }
                self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                return Maybe::Err(sys::Error {
                    errno: SystemErrno::ENOTSUP as _,
                    path: self.sync_error_buf[..src.len()].into(),
                    syscall: sys::Tag::copyfile,
                    ..Default::default()
                });
            }

            // 64 KB is about the break-even point for clonefile() to be worth it
            // at least, on an M1 with an NVME SSD.
            if stat_.size > 128 * 1024 {
                if !mode.shouldnt_overwrite() {
                    // clonefile() will fail if it already exists
                    let _ = Syscall::unlink(dest);
                }
                if Maybe::<ret::CopyFile>::errno_sys_p(
                    unsafe { bun_sys::c::clonefile(src.as_ptr(), dest.as_ptr(), 0) },
                    sys::Tag::clonefile, src.as_bytes(),
                ).is_none() {
                    let _ = Syscall::chmod(dest, stat_.mode);
                    return Maybe::Ok(());
                }
            } else {
                let src_fd = match Syscall::open(src, sys::O::RDONLY, 0o644) {
                    Maybe::Ok(result) => result,
                    Maybe::Err(err) => {
                        self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                        return Maybe::Err(err.with_path(&self.sync_error_buf[..src.len()]));
                    }
                };
                let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

                let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
                let wrote: core::cell::Cell<u64> = core::cell::Cell::new(0);
                if mode.shouldnt_overwrite() { flags |= sys::O::EXCL; }

                let dest_fd = match Self::_cp_open_dest_with_mkdir(self, dest, flags) {
                    Maybe::Ok(fd) => fd,
                    Maybe::Err(e) => return Maybe::Err(e),
                };
                let _close_dest = scopeguard::guard((dest_fd, stat_.mode, &wrote), |(fd, m, wrote)| {
                    let _ = Syscall::ftruncate(fd, (wrote.get() & ((1u64 << 63) - 1)) as i64);
                    let _ = Syscall::fchmod(fd, m);
                    fd.close();
                });

                let mut w = wrote.get();
                let r = Self::copy_file_using_read_write_loop(src, dest, src_fd, dest_fd, stat_.size.max(0) as usize, &mut w);
                wrote.set(w);
                return r;
            }

            // we fallback to copyfile() when the file is > 128 KB and clonefile fails
            // clonefile() isn't supported on all devices
            // nor is it supported across devices
            let mut mode_: u32 = bun_sys::c::COPYFILE_ACL | bun_sys::c::COPYFILE_DATA | bun_sys::c::COPYFILE_NOFOLLOW_SRC;
            if mode.shouldnt_overwrite() { mode_ |= bun_sys::c::COPYFILE_EXCL; }

            let first_try = Maybe::<ret::CopyFile>::errno_sys_p(
                unsafe { bun_sys::c::copyfile(src.as_ptr(), dest.as_ptr(), core::ptr::null_mut(), mode_) },
                sys::Tag::copyfile, src.as_bytes(),
            );
            match first_try {
                None => return Maybe::Ok(()),
                Some(err) if err.get_errno() == E::NOENT => {
                    let _ = sys::Dir::cwd().make_path(paths::resolve_path::dirname::<paths::platform::Auto>(dest.as_bytes()));
                    return Maybe::<ret::CopyFile>::errno_sys_p(
                        unsafe { bun_sys::c::copyfile(src.as_ptr(), dest.as_ptr(), core::ptr::null_mut(), mode_) },
                        sys::Tag::copyfile, src.as_bytes(),
                    ).unwrap_or(Maybe::Ok(()));
                }
                Some(err) => return err,
            }
        }

        #[cfg(target_os = "linux")]
        {
            let _ = reuse_stat;
            // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
            if mode.is_force_clone() {
                return Maybe::<ret::CopyFile>::todo();
            }

            let src_fd = match Syscall::open(src, sys::O::RDONLY | sys::O::NOFOLLOW, 0o644) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => {
                    if err.get_errno() == E::LOOP {
                        // ELOOP is returned when you open a symlink with NOFOLLOW.
                        // as in, it does not actually let you open it.
                        return self._cp_symlink(src, dest);
                    }
                    return Maybe::Err(err);
                }
            };
            let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

            let stat_ = match Syscall::fstat(src_fd) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err.with_fd(src_fd)),
            };

            if !sys::S::ISREG(stat_.mode) {
                return Maybe::Err(sys::Error { errno: SystemErrno::ENOTSUP as _, syscall: sys::Tag::copyfile, ..Default::default() });
            }

            let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
            let wrote: core::cell::Cell<u64> = core::cell::Cell::new(0);
            if mode.shouldnt_overwrite() { flags |= sys::O::EXCL; }

            let dest_fd = match Self::_cp_open_dest_with_mkdir(self, dest, flags) {
                Maybe::Ok(fd) => fd,
                Maybe::Err(e) => return Maybe::Err(e),
            };

            let mut size: usize = stat_.size.max(0) as usize;

            if sys::S::ISREG(stat_.mode) && sys::copy_file::can_use_ioctl_ficlone() {
                let rc = sys::linux::ioctl_ficlone(dest_fd, src_fd);
                if rc == 0 {
                    let _ = Syscall::fchmod(dest_fd, stat_.mode);
                    dest_fd.close();
                    return Maybe::Ok(());
                }
                sys::copy_file::disable_ioctl_ficlone();
            }

            let _close_dest = scopeguard::guard((dest_fd, stat_.mode, &wrote), |(fd, m, wrote)| {
                let _ = Syscall::ftruncate(fd, (wrote.get() & ((1u64 << 63) - 1)) as i64);
                let _ = Syscall::fchmod(fd, m);
                fd.close();
            });

            let mut off_in_copy: i64 = 0;
            let mut off_out_copy: i64 = 0;

            if !sys::copy_file::can_use_copy_file_range_syscall() {
                let mut w = wrote.get();
                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut w);
                wrote.set(w);
                return r;
            }

            if size == 0 {
                // copy until EOF
                loop {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                    let written = unsafe { sys::linux::copy_file_range(src_fd.cast(), &mut off_in_copy, dest_fd.cast(), &mut off_out_copy, sys::page_size(), 0) };
                    if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(written, sys::Tag::copy_file_range, dest.as_bytes()) {
                        match err.get_errno() {
                            // EINVAL: eCryptfs and other filesystems may not support copy_file_range
                            // XDEV: cross-device copy not supported
                            // NOSYS: syscall not available
                            // OPNOTSUPP: filesystem doesn't support this operation
                            E::XDEV | E::NOSYS | E::INVAL | E::OPNOTSUPP => {
                                if matches!(err.get_errno(), E::NOSYS | E::OPNOTSUPP) { sys::copy_file::disable_copy_file_range_syscall(); }
                                let mut w = wrote.get();
                                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut w);
                                wrote.set(w);
                                return r;
                            }
                            _ => return err,
                        }
                    }
                    // wrote zero bytes means EOF
                    if written == 0 { break; }
                    wrote.set(wrote.get().saturating_add(written as u64));
                }
            } else {
                while size > 0 {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                    let written = unsafe { sys::linux::copy_file_range(src_fd.cast(), &mut off_in_copy, dest_fd.cast(), &mut off_out_copy, size, 0) };
                    if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(written, sys::Tag::copy_file_range, dest.as_bytes()) {
                        match err.get_errno() {
                            // EINVAL: eCryptfs and other filesystems may not support copy_file_range
                            // XDEV: cross-device copy not supported
                            // NOSYS: syscall not available
                            // OPNOTSUPP: filesystem doesn't support this operation
                            E::XDEV | E::NOSYS | E::INVAL | E::OPNOTSUPP => {
                                if matches!(err.get_errno(), E::NOSYS | E::OPNOTSUPP) { sys::copy_file::disable_copy_file_range_syscall(); }
                                let mut w = wrote.get();
                                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut w);
                                wrote.set(w);
                                return r;
                            }
                            _ => return err,
                        }
                    }
                    // wrote zero bytes means EOF
                    if written == 0 { break; }
                    wrote.set(wrote.get().saturating_add(written as u64));
                    size = size.saturating_sub(written as usize);
                }
            }

            return Maybe::Ok(());
        }

        #[cfg(target_os = "freebsd")]
        {
            let _ = reuse_stat;
            if mode.is_force_clone() {
                return Maybe::Err(sys::Error { errno: SystemErrno::EOPNOTSUPP as _, syscall: sys::Tag::copyfile, ..Default::default() });
            }

            let src_fd = match Syscall::open(src, sys::O::RDONLY | sys::O::NOFOLLOW, 0o644) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => {
                    // O_NOFOLLOW on a symlink → recreate the link. FreeBSD's
                    // open(2) returns EMLINK for this case, though POSIX
                    // specifies ELOOP; accept either.
                    if matches!(err.get_errno(), E::MLINK | E::LOOP) {
                        return self._cp_symlink(src, dest);
                    }
                    return Maybe::Err(err);
                }
            };
            let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

            let stat_ = match Syscall::fstat(src_fd) {
                Maybe::Ok(result) => result,
                Maybe::Err(err) => return Maybe::Err(err.with_fd(src_fd)),
            };
            if !sys::S::ISREG(stat_.mode) {
                return Maybe::Err(sys::Error { errno: SystemErrno::EOPNOTSUPP as _, syscall: sys::Tag::copyfile, ..Default::default() });
            }

            let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
            let wrote: core::cell::Cell<u64> = core::cell::Cell::new(0);
            if mode.shouldnt_overwrite() { flags |= sys::O::EXCL; }

            let dest_fd = match Self::_cp_open_dest_with_mkdir(self, dest, flags) {
                Maybe::Ok(fd) => fd,
                Maybe::Err(e) => return Maybe::Err(e),
            };

            // No O_TRUNC at open: if src and dest resolve to the same inode,
            // that would zero the file before the first read.
            if let Maybe::Ok(dst_stat) = Syscall::fstat(dest_fd) {
                if stat_.ino == dst_stat.ino && stat_.dev == dst_stat.dev {
                    dest_fd.close();
                    self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                    return Maybe::Err(sys::Error {
                        errno: SystemErrno::EINVAL as _, syscall: sys::Tag::copyfile,
                        path: self.sync_error_buf[..src.len()].into(), ..Default::default()
                    });
                }
            }

            let _close_dest = scopeguard::guard((dest_fd, stat_.mode, &wrote), |(fd, m, wrote)| {
                let _ = Syscall::ftruncate(fd, (wrote.get() & ((1u64 << 63) - 1)) as i64);
                let _ = Syscall::fchmod(fd, m);
                fd.close();
            });

            let size: usize = stat_.size.max(0) as usize;

            // FreeBSD 13+ has copy_file_range(2). std.c declares it returning
            // usize on FreeBSD, so bitcast to isize before getErrno.
            let mut off_in: i64 = 0;
            let mut off_out: i64 = 0;
            'cfr: loop {
                let want = if size == 0 { (i32::MAX - 1) as usize } else { size.saturating_sub(wrote.get() as usize) };
                // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                let rc: isize = unsafe { sys::freebsd::copy_file_range(src_fd.native(), &mut off_in, dest_fd.native(), &mut off_out, want, 0) } as isize;
                match sys::get_errno(rc) {
                    E::SUCCESS => {
                        if rc == 0 { return Maybe::Ok(()); }
                        wrote.set(wrote.get().saturating_add(rc as u64));
                        if size != 0 && wrote.get() >= size as u64 { return Maybe::Ok(()); }
                    }
                    E::INTR => continue,
                    E::XDEV | E::INVAL | E::OPNOTSUPP | E::NOSYS | E::BADF => break 'cfr,
                    e => {
                        self.sync_error_buf[..dest.len()].copy_from_slice(dest.as_bytes());
                        return Maybe::Err(sys::Error {
                            errno: e as _, syscall: sys::Tag::copyfile,
                            path: self.sync_error_buf[..dest.len()].into(), ..Default::default()
                        });
                    }
                }
            }

            let mut w = wrote.get();
            let r = Self::copy_file_using_read_write_loop(src, dest, src_fd, dest_fd, size, &mut w);
            wrote.set(w);
            return r;
        }

        #[cfg(windows)]
        {
            let _ = mode;
            // Spec (node_fs.zig:6837-6838) precomputes both ENOENT fallbacks once,
            // before any branch. Re-deriving them inline inside `unwrap_or_else`
            // double-borrows `&mut self` (the outer `errno_sys_p` arg already holds
            // a borrow into `sync_error_buf`).
            let src_enoent_maybe = Maybe::<ret::CopyFile>::init_err_with_p(E::NOENT, sys::Tag::copyfile, self.os_path_into_sync_error_buf(src.as_slice()));
            let dst_enoent_maybe = Maybe::<ret::CopyFile>::init_err_with_p(E::NOENT, sys::Tag::copyfile, self.os_path_into_sync_error_buf(dest.as_slice()));
            let stat_ = match reuse_stat {
                Some(a) => a,
                None => {
                    let a = unsafe { sys::c::GetFileAttributesW(src.as_ptr()) };
                    if a == sys::c::INVALID_FILE_ATTRIBUTES {
                        let p = self.os_path_into_sync_error_buf(src.as_slice());
                        return Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, p).unwrap();
                    }
                    a
                }
            };
            if stat_ & sys::c::FILE_ATTRIBUTE_REPARSE_POINT == 0 {
                if unsafe { sys::c::CopyFileW(src.as_ptr(), dest.as_ptr(), mode.shouldnt_overwrite() as i32) } == 0 {
                    let mut err = unsafe { windows::GetLastError() };
                    match err {
                        windows::Win32Error::FILE_EXISTS | windows::Win32Error::ALREADY_EXISTS => {}
                        windows::Win32Error::PATH_NOT_FOUND => {
                            let _ = sys::make_path::make_path_u16(sys::Dir::cwd(), paths::dirname_w(dest.as_slice()));
                            let second_try = unsafe { sys::c::CopyFileW(src.as_ptr(), dest.as_ptr(), mode.shouldnt_overwrite() as i32) };
                            if second_try > 0 { return Maybe::Ok(()); }
                            err = unsafe { windows::GetLastError() };
                        }
                        _ => {}
                    }
                    let _ = err;
                    let p = self.os_path_into_sync_error_buf(dest.as_slice());
                    let result = Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, p).unwrap_or(src_enoent_maybe);
                    return Self::should_ignore_ebusy(&args.src, &args.dest, result);
                }
                return Maybe::Ok(());
            } else {
                let handle = match sys::openat_windows(FD::INVALID, src, sys::O::RDONLY, 0) {
                    Maybe::Err(err) => return Maybe::Err(err),
                    Maybe::Ok(fd) => fd,
                };
                let _close = scopeguard::guard(handle, |fd| fd.close());
                let wbuf = paths::os_path_buffer_pool().get();
                let len = unsafe { windows::GetFinalPathNameByHandleW(handle.cast(), wbuf.as_mut_ptr(), wbuf.len() as u32, 0) } as usize;
                if len == 0 || len >= wbuf.len() {
                    let p = self.os_path_into_sync_error_buf(dest.as_slice());
                    return Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, p).unwrap_or(dst_enoent_maybe);
                }
                let flags = if stat_ & windows::FILE_ATTRIBUTE_DIRECTORY != 0 { windows::SYMBOLIC_LINK_FLAG_DIRECTORY } else { 0 };
                wbuf[len] = 0;
                if unsafe { windows::CreateSymbolicLinkW(dest.as_ptr(), wbuf.as_ptr(), flags) } == 0 {
                    let p = self.os_path_into_sync_error_buf(dest.as_slice());
                    return Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, p).unwrap_or(dst_enoent_maybe);
                }
                return Maybe::Ok(());
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "freebsd", windows)))]
        #[allow(unreachable_code)]
        { let _ = (src, dest, mode, reuse_stat); Maybe::<ret::CopyFile>::todo() }
    }

    /// Shared `dest_fd:` block from the mac/linux/freebsd branches of
    /// `_copySingleFileSync` (node_fs.zig:6528-6555 / 6624-6651 / 6770-6794).
    /// Tries `open(dest, flags, default_permission)`; on ENOENT creates the
    /// parent directory and retries once. Any other error is annotated with
    /// `dest` copied into `sync_error_buf`.
    fn _cp_open_dest_with_mkdir(&mut self, dest: OSPathSliceZ, flags: i32) -> Maybe<FD> {
        match Syscall::open(dest, flags, DEFAULT_PERMISSION) {
            Maybe::Ok(result) => Maybe::Ok(result),
            Maybe::Err(err) => {
                if err.get_errno() == E::NOENT {
                    // Create the parent directory if it doesn't exist
                    let bytes = dest.as_bytes();
                    let mut len = bytes.len();
                    while len > 0 && bytes[len - 1] != paths::SEP { len -= 1; }
                    let mkdir_result = self.mkdir_recursive(args::Mkdir {
                        path: PathLike::String(PathString::init(&bytes[..len])),
                        recursive: true,
                        ..Default::default()
                    });
                    if let Maybe::Err(e) = mkdir_result { return Maybe::Err(e); }
                    if let Maybe::Ok(result) = Syscall::open(dest, flags, DEFAULT_PERMISSION) {
                        return Maybe::Ok(result);
                    }
                }
                self.sync_error_buf[..dest.len()].copy_from_slice(dest.as_bytes());
                Maybe::Err(err.with_path(&self.sync_error_buf[..dest.len()]))
            }
        }
    }

    /// Directory scanning + clonefile will block this thread, then each individual file copy (what the sync version
    /// calls "_copySingleFileSync") will be dispatched as a separate task.
    pub fn cp_async(&mut self, task: *mut AsyncCpTask) {
        AsyncCpTask::cp_async(self, task);
    }

    // returns boolean `should_continue`
    fn _cp_async_directory(
        &mut self, args: args::CpFlags, task: *mut AsyncCpTask,
        src_buf: &mut OSPathBuffer, src_dir_len: PathInt,
        dest_buf: &mut OSPathBuffer, dest_dir_len: PathInt,
    ) -> bool {
        AsyncCpTask::_cp_async_directory(self, args, task, src_buf, src_dir_len, dest_buf, dest_dir_len)
    }

    /// Const-generic dispatch from `NodeFSFunctionEnum` to the matching
    /// `NodeFS::<method>`.
    ///
    /// PORT NOTE: Zig spells this `@field(NodeFS, @tagName(FunctionEnum))(self,
    /// args, .async)`. Rust has no field-by-string reflection, so we match on
    /// the const-generic `F` and route each arm to the concrete method. The
    /// `(R, A, F)` triple is fixed by the `async_::*` type aliases — every
    /// monomorphisation of `AsyncFSTask<R, A, {F}>` picks exactly one arm whose
    /// `args::*` / `ret::*` are the same types as `A` / `R`, so the
    /// `transmute_copy` calls below are identity casts.
    pub fn dispatch<R, A, const F: NodeFSFunctionEnum>(&mut self, args: &A, flavor: Flavor) -> Maybe<R> {
        macro_rules! call {
            ($method:ident, $Args:ty, $Ret:ty) => {{
                debug_assert_eq!(core::mem::size_of::<A>(), core::mem::size_of::<$Args>());
                debug_assert_eq!(core::mem::size_of::<Maybe<R>>(), core::mem::size_of::<Maybe<$Ret>>());
                // SAFETY: per the `async_::*` aliases, `A == $Args` and `R == $Ret`
                // for this `F`; both casts are between identical types.
                let args: &$Args = unsafe { &*(args as *const A as *const $Args) };
                let r: Maybe<$Ret> = self.$method(args, flavor);
                let r = core::mem::ManuallyDrop::new(r);
                unsafe { core::mem::transmute_copy::<Maybe<$Ret>, Maybe<R>>(&r) }
            }};
        }
        match F {
            NodeFSFunctionEnum::Access => call!(access, args::Access, ret::Access),
            NodeFSFunctionEnum::AppendFile => call!(append_file, args::AppendFile, ret::AppendFile),
            NodeFSFunctionEnum::Chmod => call!(chmod, args::Chmod, ret::Chmod),
            NodeFSFunctionEnum::Chown => call!(chown, args::Chown, ret::Chown),
            NodeFSFunctionEnum::Close => call!(close, args::Close, ret::Close),
            NodeFSFunctionEnum::CopyFile => call!(copy_file, args::CopyFile, ret::CopyFile),
            NodeFSFunctionEnum::Exists => call!(exists, args::Exists, ret::Exists),
            NodeFSFunctionEnum::Fchmod => call!(fchmod, args::FChmod, ret::Fchmod),
            NodeFSFunctionEnum::Fchown => call!(fchown, args::Fchown, ret::Fchown),
            NodeFSFunctionEnum::Fdatasync => call!(fdatasync, args::FdataSync, ret::Fdatasync),
            NodeFSFunctionEnum::Fstat => call!(fstat, args::Fstat, ret::Fstat),
            NodeFSFunctionEnum::Fsync => call!(fsync, args::Fsync, ret::Fsync),
            NodeFSFunctionEnum::Ftruncate => call!(ftruncate, args::FTruncate, ret::Ftruncate),
            NodeFSFunctionEnum::Futimes => call!(futimes, args::Futimes, ret::Futimes),
            NodeFSFunctionEnum::Lchmod => call!(lchmod, args::LCHmod, ret::Lchmod),
            NodeFSFunctionEnum::Lchown => call!(lchown, args::LChown, ret::Lchown),
            NodeFSFunctionEnum::Link => call!(link, args::Link, ret::Link),
            NodeFSFunctionEnum::Lstat => call!(lstat, args::Lstat, ret::Lstat),
            NodeFSFunctionEnum::Lutimes => call!(lutimes, args::Lutimes, ret::Lutimes),
            NodeFSFunctionEnum::Mkdir => call!(mkdir, args::Mkdir, ret::Mkdir),
            NodeFSFunctionEnum::Mkdtemp => call!(mkdtemp, args::MkdirTemp, ret::Mkdtemp),
            NodeFSFunctionEnum::Open => call!(open, args::Open, ret::Open),
            NodeFSFunctionEnum::Read => call!(read, args::Read, ret::Read),
            NodeFSFunctionEnum::Readdir => call!(readdir, args::Readdir, ret::Readdir),
            NodeFSFunctionEnum::ReadFile => call!(read_file, args::ReadFile, ret::ReadFile),
            NodeFSFunctionEnum::Readlink => call!(readlink, args::Readlink, ret::Readlink),
            NodeFSFunctionEnum::Readv => call!(readv, args::Readv, ret::Readv),
            NodeFSFunctionEnum::Realpath => call!(realpath, args::Realpath, ret::Realpath),
            NodeFSFunctionEnum::RealpathNonNative => call!(realpath_non_native, args::Realpath, ret::Realpath),
            NodeFSFunctionEnum::Rename => call!(rename, args::Rename, ret::Rename),
            NodeFSFunctionEnum::Rm => call!(rm, args::Rm, ret::Rm),
            NodeFSFunctionEnum::Rmdir => call!(rmdir, args::RmDir, ret::Rmdir),
            NodeFSFunctionEnum::Stat => call!(stat, args::Stat, ret::Stat),
            NodeFSFunctionEnum::Statfs => call!(statfs, args::StatFS, ret::StatFS),
            NodeFSFunctionEnum::Symlink => call!(symlink, args::Symlink, ret::Symlink),
            NodeFSFunctionEnum::Truncate => call!(truncate, args::Truncate, ret::Truncate),
            NodeFSFunctionEnum::Unlink => call!(unlink, args::Unlink, ret::Unlink),
            NodeFSFunctionEnum::Utimes => call!(utimes, args::Utimes, ret::Utimes),
            NodeFSFunctionEnum::Write => call!(write, args::Write, ret::Write),
            NodeFSFunctionEnum::WriteFile => call!(write_file, args::WriteFile, ret::WriteFile),
            NodeFSFunctionEnum::Writev => call!(writev, args::Writev, ret::Writev),
        }
    }

    #[cfg(windows)]
    pub fn uv_dispatch<R, A, const F: NodeFSFunctionEnum>(&mut self, args: &A, rc: i64) -> Maybe<R> {
        macro_rules! call {
            ($method:ident, $Args:ty, $Ret:ty) => {{
                debug_assert_eq!(core::mem::size_of::<A>(), core::mem::size_of::<$Args>());
                debug_assert_eq!(core::mem::size_of::<Maybe<R>>(), core::mem::size_of::<Maybe<$Ret>>());
                // SAFETY: identity cast — see `dispatch` above.
                let args: &$Args = unsafe { &*(args as *const A as *const $Args) };
                let r: Maybe<$Ret> = self.$method(args, rc);
                let r = core::mem::ManuallyDrop::new(r);
                unsafe { core::mem::transmute_copy::<Maybe<$Ret>, Maybe<R>>(&r) }
            }};
        }
        match F {
            NodeFSFunctionEnum::Open => call!(uv_open, args::Open, ret::Open),
            NodeFSFunctionEnum::Close => call!(uv_close, args::Close, ret::Close),
            NodeFSFunctionEnum::Read => call!(uv_read, args::Read, ret::Read),
            NodeFSFunctionEnum::Write => call!(uv_write, args::Write, ret::Write),
            NodeFSFunctionEnum::Readv => call!(uv_readv, args::Readv, ret::Readv),
            NodeFSFunctionEnum::Writev => call!(uv_writev, args::Writev, ret::Writev),
            // Statfs takes `req` too — handled via uv_callbackreq, not this path.
            _ => unreachable!("uv_dispatch: not a UVFSRequest variant"),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum RealpathVariant { Native, Emulated }

// PORT NOTE: was `pub enum StringType` inside `impl NodeFS` (Zig allowed
// nested type decls in struct bodies). Hoisted out — Rust forbids enums in
// inherent impls.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ReadFileStringType { Default, NullTerminated }

/// Trait for `mkdirRecursiveImpl` Ctx parameter (`void` does nothing).
pub trait MkdirCtx {
    fn on_create_dir(&self, _path: OSPathSliceZ) {}
}
impl MkdirCtx for () {}

/// Trait abstracting over the three readdir entry types.
///
/// PORT NOTE: Zig dispatched on `comptime ExpectedType` inside the loop body
/// (`switch (ExpectedType) { Dirent => …, Buffer => …, bun.String => … }`).
/// Rust can't switch on a generic `T` at runtime, so the per-type append
/// logic is moved onto this trait. `IS_DIRENT` mirrors the
/// `ExpectedType == jsc.Node.Dirent` predicate so the caller knows whether
/// it must compute/maintain `dirent_path`.
pub trait ReaddirEntry: Sized {
    /// `ExpectedType == jsc.Node.Dirent` — whether the caller needs to track
    /// a cached `dirent_path` BunString.
    const IS_DIRENT: bool;
    fn destroy_entry(&mut self);
    fn into_readdir(v: Vec<Self>) -> ret::Readdir;
    /// Non-recursive readdir: append one entry given the bare entry name.
    /// `dirent_path` is the basename's directory (encoded once per dir).
    fn append_entry(
        entries: &mut Vec<Self>, utf8_name: &[u8], dirent_path: &BunString,
        kind: sys::FileKind, encoding: Encoding,
    );
    /// Recursive readdir: `utf8_name` is the bare entry name, `name_to_copy`
    /// is the path *relative to the recursion root* (what Node returns).
    /// `apply_encoding` distinguishes the sync path (node_fs.zig:4962-4982,
    /// which honours `args.encoding` via `WebCore.encoding.toBunString`) from
    /// the async path (node_fs.zig:4800-4821, which uses raw
    /// `bun.String.cloneUTF8` and ignores the requested encoding).
    fn append_entry_recursive(
        entries: &mut Vec<Self>, utf8_name: &[u8], name_to_copy: &[u8],
        dirent_path: &BunString, kind: sys::FileKind, encoding: Encoding,
        apply_encoding: bool,
    );
}
impl ReaddirEntry for BunString {
    const IS_DIRENT: bool = false;
    fn destroy_entry(&mut self) { self.deref(); }
    fn into_readdir(v: Vec<Self>) -> ret::Readdir { ret::Readdir::Files(v.into_boxed_slice()) }
    fn append_entry(entries: &mut Vec<Self>, utf8_name: &[u8], _dirent_path: &BunString, _kind: sys::FileKind, encoding: Encoding) {
        entries.push(webcore::encoding::to_bun_string(utf8_name, encoding));
    }
    fn append_entry_recursive(entries: &mut Vec<Self>, _utf8_name: &[u8], name_to_copy: &[u8], _dirent_path: &BunString, _kind: sys::FileKind, encoding: Encoding, apply_encoding: bool) {
        let bytes = without_nt_prefix::<u8>(name_to_copy);
        entries.push(if apply_encoding {
            webcore::encoding::to_bun_string(bytes, encoding)
        } else {
            BunString::clone_utf8(bytes)
        });
    }
}
impl ReaddirEntry for Dirent {
    const IS_DIRENT: bool = true;
    fn destroy_entry(&mut self) { self.deref(); }
    fn into_readdir(v: Vec<Self>) -> ret::Readdir { ret::Readdir::WithFileTypes(v.into_boxed_slice()) }
    fn append_entry(entries: &mut Vec<Self>, utf8_name: &[u8], dirent_path: &BunString, kind: sys::FileKind, encoding: Encoding) {
        entries.push(Dirent {
            name: webcore::encoding::to_bun_string(utf8_name, encoding),
            path: dirent_path.dupe_ref(),
            kind,
        });
    }
    fn append_entry_recursive(entries: &mut Vec<Self>, utf8_name: &[u8], _name_to_copy: &[u8], dirent_path: &BunString, kind: sys::FileKind, encoding: Encoding, apply_encoding: bool) {
        entries.push(Dirent {
            name: if apply_encoding {
                webcore::encoding::to_bun_string(utf8_name, encoding)
            } else {
                BunString::clone_utf8(utf8_name)
            },
            path: dirent_path.dupe_ref(),
            kind,
        });
    }
}
impl ReaddirEntry for Buffer {
    const IS_DIRENT: bool = false;
    fn destroy_entry(&mut self) { self.destroy(); }
    fn into_readdir(v: Vec<Self>) -> ret::Readdir { ret::Readdir::Buffers(v.into_boxed_slice()) }
    fn append_entry(entries: &mut Vec<Self>, utf8_name: &[u8], _dirent_path: &BunString, _kind: sys::FileKind, _encoding: Encoding) {
        entries.push(Buffer::from_string(utf8_name).expect("oom"));
    }
    fn append_entry_recursive(entries: &mut Vec<Self>, _utf8_name: &[u8], name_to_copy: &[u8], _dirent_path: &BunString, _kind: sys::FileKind, _encoding: Encoding, _apply_encoding: bool) {
        entries.push(Buffer::from_string(without_nt_prefix::<u8>(name_to_copy)).expect("oom"));
    }
}

// VERIFY-FIX(round1): the Zig source has three distinct error→errno tables for
// rmdir-recursive (node_fs.zig:5757-5788), rm-recursive (node_fs.zig:5789-5824),
// and rm non-recursive unlinkZ/rmdirZ (node_fs.zig:5842-5887). Phase-A collapsed
// them into one, which silently mapped AccessDenied→EPERM for `rm` (Node returns
// EACCES there) and widened the narrow table. Split back out per call site.
fn map_anyerror_to_errno(err: bun_core::Error) -> E {
    match err.name() {
        "AccessDenied" => E::PERM,
        "FileTooBig" => E::FBIG,
        "SymLinkLoop" => E::LOOP,
        "ProcessFdQuotaExceeded" => E::NFILE,
        "NameTooLong" => E::ENAMETOOLONG,
        "SystemFdQuotaExceeded" => E::MFILE,
        "SystemResources" => E::NOMEM,
        "ReadOnlyFileSystem" => E::ROFS,
        "FileSystem" => E::IO,
        "FileBusy" | "DeviceBusy" => E::BUSY,
        "NotDir" => E::NOTDIR,
        "InvalidUtf8" | "InvalidWtf8" | "BadPathName" => E::INVAL,
        "FileNotFound" => E::NOENT,
        "IsDir" => E::EISDIR,
        _ => E::FAULT,
    }
}

// `rm` recursive (zigDeleteTree) — same shape as the rmdir table above except
// AccessDenied maps to EACCES, not EPERM (node_fs.zig:5789-5824).
fn map_anyerror_to_errno_rm_tree(err: bun_core::Error) -> E {
    match err.name() {
        "AccessDenied" => E::ACCES,
        "FileTooBig" => E::FBIG,
        "SymLinkLoop" => E::LOOP,
        "ProcessFdQuotaExceeded" => E::NFILE,
        "NameTooLong" => E::ENAMETOOLONG,
        "SystemFdQuotaExceeded" => E::MFILE,
        "SystemResources" => E::NOMEM,
        "ReadOnlyFileSystem" => E::ROFS,
        "FileSystem" => E::IO,
        "FileBusy" | "DeviceBusy" => E::BUSY,
        "NotDir" => E::NOTDIR,
        "InvalidUtf8" | "InvalidWtf8" | "BadPathName" => E::INVAL,
        "FileNotFound" => E::NOENT,
        "IsDir" => E::EISDIR,
        _ => E::FAULT,
    }
}

// `rm` non-recursive unlinkZ/rmdirZ fallback — narrower table; anything not
// listed here falls through to EFAULT (node_fs.zig:5842-5859 / 5870-5887).
fn map_anyerror_to_errno_rm_narrow(err: bun_core::Error) -> E {
    match err.name() {
        "AccessDenied" => E::ACCES,
        "SymLinkLoop" => E::LOOP,
        "NameTooLong" => E::ENAMETOOLONG,
        "SystemResources" => E::NOMEM,
        "ReadOnlyFileSystem" => E::ROFS,
        "FileBusy" => E::BUSY,
        "InvalidUtf8" | "InvalidWtf8" | "BadPathName" => E::INVAL,
        "FileNotFound" => E::NOENT,
        _ => E::FAULT,
    }
}

fn throw_invalid_fd_error(global: &JSGlobalObject, value: JSValue) -> JsError {
    if value.is_number() {
        return global.err_out_of_range(format_args!(
            "The value of \"fd\" is out of range. It must be an integer. Received {}",
            bun_core::fmt::double(value.as_number())
        )).throw();
    }
    global.throw_invalid_argument_type_value("fd", "number", value)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__mkdirp(global_this: *mut JSGlobalObject, path: *const c_char) -> bool {
    // SAFETY: caller (C++) passes a valid JSGlobalObject*
    let global_this = unsafe { &*global_this };
    // SAFETY: caller passes a NUL-terminated C string
    let path_bytes = unsafe { core::ffi::CStr::from_ptr(path) }.to_bytes();
    !matches!(
        global_this.bun_vm().node_fs().mkdir_recursive(args::Mkdir {
            path: PathLike::String(PathString::init(path_bytes)),
            recursive: true,
            ..Default::default()
        }),
        Maybe::Err(_)
    )
}

// ──────────────────────────────────────────────────────────────────────────
// zigDeleteTree — copied from std.fs.Dir.deleteTree. Returns `FileNotFound`
// instead of ignoring it, which is required to match the behavior of Node.js's
// `fs.rm` { recursive: true, force: false }.
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: the Zig original is a near-verbatim copy of `std.fs.Dir.deleteTree`
// operating on `std.fs.Dir` and Zig's named error sets. PORTING.md bans `std::fs`,
// so this re-implements the same algorithm on top of `bun_sys` primitives
// (`openat` + `unlinkat`) and *errno* values, then maps the errno back to the
// Zig-error-set name strings the callers' `map_anyerror_to_errno*` tables expect.
// The structure (16-slot stack, treat_as_dir flip-flop, close-then-deleteDir,
// retry-on-DirNotEmpty) is preserved exactly.

#[inline]
fn dt_err(errno: E) -> bun_core::Error {
    // Reverse of the `map_anyerror_to_errno*` tables above — round-trip through
    // the Zig error-set name so existing callers don't have to change.
    err_from_static(match errno {
        E::NOENT => "FileNotFound",
        E::ACCES => "AccessDenied",
        E::PERM => "PermissionDenied",
        E::LOOP => "SymLinkLoop",
        E::ENAMETOOLONG => "NameTooLong",
        E::NOMEM => "SystemResources",
        E::ROFS => "ReadOnlyFileSystem",
        E::IO => "FileSystem",
        E::BUSY => "FileBusy",
        E::NOTDIR => "NotDir",
        E::EISDIR => "IsDir",
        E::NOTEMPTY => "DirNotEmpty",
        E::MFILE => "SystemFdQuotaExceeded",
        E::NFILE => "ProcessFdQuotaExceeded",
        E::INVAL => "BadPathName",
        E::FBIG => "FileTooBig",
        E::NODEV => "NoDevice",
        _ => "Unexpected",
    })
}

#[inline]
fn dt_open_dir(parent: sys::Dir, name: &[u8]) -> Result<sys::Dir, E> {
    let mut path_buf = PathBuffer::uninit();
    let len = name.len().min(path_buf.len() - 1);
    path_buf[..len].copy_from_slice(&name[..len]);
    path_buf[len] = 0;
    // SAFETY: NUL written at [len].
    let z = unsafe { ZStr::from_raw(path_buf.as_ptr(), len) };
    match Syscall::openat(parent.fd, z, sys::O::DIRECTORY | sys::O::RDONLY | sys::O::NOFOLLOW, 0) {
        Maybe::Ok(fd) => Ok(sys::Dir::from_fd(fd)),
        Maybe::Err(e) => Err(e.get_errno()),
    }
}

#[inline]
fn dt_delete_file(parent: sys::Dir, name: &[u8]) -> Result<(), E> {
    let mut path_buf = PathBuffer::uninit();
    let len = name.len().min(path_buf.len() - 1);
    path_buf[..len].copy_from_slice(&name[..len]);
    path_buf[len] = 0;
    // SAFETY: NUL written at [len].
    let z = unsafe { ZStr::from_raw(path_buf.as_ptr(), len) };
    match Syscall::unlinkat(parent.fd, z, 0) {
        Maybe::Ok(()) => Ok(()),
        Maybe::Err(e) => Err(e.get_errno()),
    }
}

#[inline]
fn dt_delete_dir(parent: sys::Dir, name: &[u8]) -> Result<(), E> {
    let mut path_buf = PathBuffer::uninit();
    let len = name.len().min(path_buf.len() - 1);
    path_buf[..len].copy_from_slice(&name[..len]);
    path_buf[len] = 0;
    // SAFETY: NUL written at [len].
    let z = unsafe { ZStr::from_raw(path_buf.as_ptr(), len) };
    #[cfg(unix)]
    let flags = libc::AT_REMOVEDIR;
    #[cfg(not(unix))]
    let flags = 0x200; // AT_REMOVEDIR — Windows path goes through sys_uv which maps this.
    match Syscall::unlinkat(parent.fd, z, flags) {
        Maybe::Ok(()) => Ok(()),
        Maybe::Err(e) => Err(e.get_errno()),
    }
}

struct DeleteTreeStackItem {
    /// Owned copy of the entry name (lives until popped). The very first item
    /// borrows `sub_path` instead — see `name_is_borrowed`.
    name: Vec<u8>,
    name_is_borrowed: bool,
    parent_dir: sys::Dir,
    iter: DirIterator::WrappedIterator,
}

pub fn zig_delete_tree(self_: sys::Dir, sub_path: &[u8], kind_hint: sys::FileKind) -> Result<(), bun_core::Error> {
    let initial_iterable_dir = match zig_delete_tree_open_initial_subpath(self_, sub_path, kind_hint)? {
        Some(d) => d,
        None => return Ok(()),
    };

    // PERF(port): Zig used a fixed `[16]StackItem` array + `initBuffer`. Rust's
    // Vec gives the same cap behaviour (`unusedCapacitySlice().len >= 1`) when
    // pre-reserved to 16, with the bonus that the iterator buffers (8 KB each)
    // live on the heap instead of the stack.
    let mut stack: Vec<DeleteTreeStackItem> = Vec::with_capacity(16);
    let close_all = |stack: &mut Vec<DeleteTreeStackItem>| {
        for item in stack.drain(..) { item.iter.iter.dir.close(); }
    };
    let _close_all = scopeguard::guard(&mut stack, |s| close_all(s));
    let stack: &mut Vec<DeleteTreeStackItem> = &mut *_close_all;

    stack.push(DeleteTreeStackItem {
        name: Vec::new(),
        name_is_borrowed: true,
        parent_dir: self_,
        iter: DirIterator::WrappedIterator::init(initial_iterable_dir.fd),
    });

    'process_stack: while !stack.is_empty() {
        let top_idx = stack.len() - 1;
        loop {
            // Re-borrow `top` each iteration so pushing to `stack` below is allowed.
            let entry = match stack[top_idx].iter.next() {
                Ok(Some(e)) => e,
                Ok(None) => break,
                Err(err) => return Err(dt_err(err.get_errno())),
            };
            // PORT NOTE: `entry.name` borrows the iterator's internal buffer and
            // is invalidated by the next `next()` call. We copy it once here so
            // it survives both the push-onto-stack and the deleteDir-after-close
            // paths — Zig got away with a borrow because its `StackItem.name`
            // pointed straight into the parent iterator's still-live buffer.
            let entry_name: Vec<u8> = entry.name.slice().to_vec();
            let mut treat_as_dir = entry.kind == sys::FileKind::Directory;
            'handle_entry: loop {
                if treat_as_dir {
                    if stack.len() < stack.capacity() {
                        let top_dir = sys::Dir::from_fd(stack[top_idx].iter.iter.dir);
                        match dt_open_dir(top_dir, &entry_name) {
                            Ok(iterable_dir) => {
                                stack.push(DeleteTreeStackItem {
                                    name: entry_name,
                                    name_is_borrowed: false,
                                    parent_dir: top_dir,
                                    iter: DirIterator::WrappedIterator::init(iterable_dir.fd),
                                });
                                continue 'process_stack;
                            }
                            Err(E::NOTDIR) => { treat_as_dir = false; continue 'handle_entry; }
                            Err(e) => return Err(dt_err(e)),
                        }
                    } else {
                        let top_dir = sys::Dir::from_fd(stack[top_idx].iter.iter.dir);
                        zig_delete_tree_min_stack_size_with_kind_hint(top_dir, &entry_name, entry.kind)?;
                        break 'handle_entry;
                    }
                } else {
                    let top_dir = sys::Dir::from_fd(stack[top_idx].iter.iter.dir);
                    match dt_delete_file(top_dir, &entry_name) {
                        Ok(()) => break 'handle_entry,
                        Err(E::EISDIR) => { treat_as_dir = true; continue 'handle_entry; }
                        // PORT NOTE: Zig's std.fs error set distinguishes IsDir
                        // from "EPERM because it's a directory" (Linux returns
                        // EISDIR; macOS returns EPERM). We only get errno, so
                        // forward EPERM as PermissionDenied — caller maps it.
                        Err(e) => return Err(dt_err(e)),
                    }
                }
            }
        }

        // On Windows, we can't delete until the dir's handle has been closed, so
        // close it before we try to delete.
        let top = stack.pop().unwrap();
        top.iter.iter.dir.close();

        // In order to avoid double-closing the directory when cleaning up
        // the stack in the case of an error, we save the relevant portions and
        // pop the value from the stack.
        let parent_dir = top.parent_dir;
        let name: &[u8] = if top.name_is_borrowed { sub_path } else { &top.name };

        let mut need_to_retry = false;
        match dt_delete_dir(parent_dir, name) {
            Ok(()) => {}
            Err(E::NOENT) => {}
            Err(E::NOTEMPTY) => need_to_retry = true,
            // PORT NOTE: Zig also matched `error.EXIST` → DirNotEmpty here via
            // std.fs's deleteDir; mirror that for OSes that report EEXIST.
            Err(E::EEXIST) => need_to_retry = true,
            Err(e) => return Err(dt_err(e)),
        }

        if need_to_retry {
            // Since we closed the handle that the previous iterator used, we
            // need to re-open the dir and re-create the iterator.
            let mut treat_as_dir = true;
            let iterable_dir = 'handle_entry: loop {
                if treat_as_dir {
                    match dt_open_dir(parent_dir, name) {
                        Ok(d) => break 'handle_entry d,
                        Err(E::NOTDIR) => { treat_as_dir = false; continue 'handle_entry; }
                        Err(E::NOENT) => {
                            // That's fine, we were trying to remove this directory anyway.
                            continue 'process_stack;
                        }
                        Err(e) => return Err(dt_err(e)),
                    }
                } else {
                    match dt_delete_file(parent_dir, name) {
                        Ok(()) => continue 'process_stack,
                        Err(E::NOENT) => continue 'process_stack,
                        Err(E::EISDIR) => { treat_as_dir = true; continue 'handle_entry; }
                        Err(E::NOTDIR) => {
                            #[cfg(debug_assertions)] unreachable!();
                            #[cfg(not(debug_assertions))] return Err(dt_err(E::IO));
                        }
                        Err(e) => return Err(dt_err(e)),
                    }
                }
            };
            // We know there is room on the stack since we are just re-adding
            // the StackItem that we previously popped.
            stack.push(DeleteTreeStackItem {
                name: top.name,
                name_is_borrowed: top.name_is_borrowed,
                parent_dir,
                iter: DirIterator::WrappedIterator::init(iterable_dir.fd),
            });
            continue 'process_stack;
        }
    }
    Ok(())
}

fn zig_delete_tree_open_initial_subpath(self_: sys::Dir, sub_path: &[u8], kind_hint: sys::FileKind) -> Result<Option<sys::Dir>, bun_core::Error> {
    // Treat as a file by default
    let mut treat_as_dir = kind_hint == sys::FileKind::Directory;
    loop {
        if treat_as_dir {
            return match dt_open_dir(self_, sub_path) {
                Ok(d) => Ok(Some(d)),
                // PORT NOTE: Zig surfaced NotDir/FileNotFound here (no fall-
                // through to deleteFile) — that's the deliberate divergence
                // from std.fs.Dir.deleteTree this copy exists for.
                Err(e) => Err(dt_err(e)),
            };
        } else {
            match dt_delete_file(self_, sub_path) {
                Ok(()) => return Ok(None),
                Err(E::EISDIR) => { treat_as_dir = true; continue; }
                Err(e) => return Err(dt_err(e)),
            }
        }
    }
}

fn zig_delete_tree_min_stack_size_with_kind_hint(self_: sys::Dir, sub_path: &[u8], kind_hint: sys::FileKind) -> Result<(), bun_core::Error> {
    'start_over: loop {
        let mut dir = match zig_delete_tree_open_initial_subpath(self_, sub_path, kind_hint)? {
            Some(d) => d,
            None => return Ok(()),
        };
        let mut cleanup_dir_parent: Option<sys::Dir> = None;
        let mut cleanup_dir = true;

        // Valid use of MAX_PATH_BYTES because dir_name_buf will only
        // ever store a single path component that was returned from the
        // filesystem.
        let mut dir_name_buf = PathBuffer::uninit();
        let mut dir_name_len = sub_path.len().min(dir_name_buf.len());
        dir_name_buf[..dir_name_len].copy_from_slice(&sub_path[..dir_name_len]);
        // PORT NOTE: Zig kept `dir_name: []const u8` aliasing either `sub_path`
        // or `dir_name_buf`. Rust's borrow checker won't let that alias survive
        // the `@memcpy` reassignment below, so track `(is_sub_path, len)` and
        // re-slice on each use.
        let mut dir_name_is_sub_path = true;

        // Here we must avoid recursion, in order to provide O(1) memory guarantee of this function.
        // Go through each entry and if it is not a directory, delete it. If it is a directory,
        // open it, and close the original directory. Repeat. Then start the entire operation over.
        let result: Result<(), bun_core::Error> = 'scan_dir: loop {
            let mut dir_it = DirIterator::WrappedIterator::init(dir.fd);
            'dir_it: loop {
                let entry = match dir_it.next() {
                    Ok(Some(e)) => e,
                    Ok(None) => break 'dir_it,
                    Err(err) => break 'scan_dir Err(dt_err(err.get_errno())),
                };
                let entry_name: Vec<u8> = entry.name.slice().to_vec();
                let mut treat_as_dir = entry.kind == sys::FileKind::Directory;
                'handle_entry: loop {
                    if treat_as_dir {
                        match dt_open_dir(dir, &entry_name) {
                            Ok(new_dir) => {
                                if let Some(d) = cleanup_dir_parent.take() { d.close(); }
                                cleanup_dir_parent = Some(dir);
                                dir = new_dir;
                                let n = entry_name.len().min(dir_name_buf.len());
                                dir_name_buf[..n].copy_from_slice(&entry_name[..n]);
                                dir_name_len = n;
                                dir_name_is_sub_path = false;
                                continue 'scan_dir;
                            }
                            Err(E::NOTDIR) => { treat_as_dir = false; continue 'handle_entry; }
                            Err(E::NOENT) => {
                                // That's fine, we were trying to remove this directory anyway.
                                continue 'dir_it;
                            }
                            Err(e) => break 'scan_dir Err(dt_err(e)),
                        }
                    } else {
                        match dt_delete_file(dir, &entry_name) {
                            Ok(()) => continue 'dir_it,
                            Err(E::NOENT) => continue 'dir_it,
                            Err(E::EISDIR) => { treat_as_dir = true; continue 'handle_entry; }
                            Err(E::NOTDIR) => {
                                #[cfg(debug_assertions)] unreachable!();
                                #[cfg(not(debug_assertions))] break 'scan_dir Err(dt_err(E::IO));
                            }
                            Err(e) => break 'scan_dir Err(dt_err(e)),
                        }
                    }
                }
            }
            // Reached the end of the directory entries, which means we successfully deleted all of them.
            // Now to remove the directory itself.
            dir.close();
            cleanup_dir = false;

            let dir_name: &[u8] = if dir_name_is_sub_path { sub_path } else { &dir_name_buf[..dir_name_len] };
            if let Some(d) = cleanup_dir_parent {
                match dt_delete_dir(d, dir_name) {
                    Ok(()) | Err(E::NOENT) | Err(E::NOTEMPTY) | Err(E::EEXIST) => {
                        // These two things can happen due to file system race conditions.
                        d.close();
                        continue 'start_over;
                    }
                    Err(e) => { d.close(); return Err(dt_err(e)); }
                }
            } else {
                match dt_delete_dir(self_, sub_path) {
                    Ok(()) | Err(E::NOENT) => return Ok(()),
                    Err(E::NOTEMPTY) | Err(E::EEXIST) => continue 'start_over,
                    Err(e) => return Err(dt_err(e)),
                }
            }
        };
        // defers
        if let Some(d) = cleanup_dir_parent { d.close(); }
        if cleanup_dir { dir.close(); }
        return result;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NodeFSFunctionEnum — std.meta.DeclEnum(NodeFS)
// ──────────────────────────────────────────────────────────────────────────
#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum NodeFSFunctionEnum {
    Access, AppendFile, Chmod, Chown, Close, CopyFile, Exists, Fchmod, Fchown,
    Fdatasync, Fstat, Fsync, Ftruncate, Futimes, Lchmod, Lchown, Link, Lstat,
    Lutimes, Mkdir, Mkdtemp, Open, Read, Readdir, ReadFile, Readlink, Readv,
    Realpath, RealpathNonNative, Rename, Rm, Rmdir, Stat, Statfs, Symlink,
    Truncate, Unlink, Utimes, Write, WriteFile, Writev,
}

// TODO(port): i52 marker type — Zig `i52` used for ReadPosition coercion bounds
#[allow(non_camel_case_types)]
struct i52;
impl i52 { const MIN: i64 = -(1i64 << 51); }

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_fs.zig (7344 lines)
//   confidence: low
//   todos:      50
//   notes:      Very large file. Full structure preserved. Round-3 ports: read_file_with_options, _copy_single_file_sync (mac/linux/freebsd/win), cp_sync_inner, readdir_with_entries{,_recursive_{sync,async}}, zig_delete_tree* — all real bodies; comptime ExpectedType dispatch lowered onto ReaddirEntry trait. Remaining stubs: Windows UVFSRequest::create branches, Windows symlink, readdir is_u16 path, RareData pipe_read_buffer fast-path. Const-generic dispatch (NodeFSFunctionEnum) needs Phase-B wiring. Task types use `unsafe fn destroy(*mut Self)` (FFI-style). args::*::deinit kept as inherent fns pending PathLike: Drop (cross-file). errdefer cleanup in args::*::from_js partially inlined.
// ──────────────────────────────────────────────────────────────────────────
