// This file contains the underlying implementation for sync & async functions
// for interacting with the filesystem from JavaScript.
// The top-level functions assume the arguments are already validated

use bun_paths::strings;
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use crate::api::bun::process::event_loop_handle_to_ctx;
use crate::webcore;
use bun_core::Environment;
use bun_core::{self as bstr, PathString, String as BunString, ZStr, ZigString};
use bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use bun_event_loop::ConcurrentTask::ConcurrentTask as ConcurrentTaskItem;
use bun_event_loop::MiniEventLoop::MiniEventLoop;
use bun_io::KeepAlive;
use bun_jsc::AbortSignal;
use bun_jsc::EventLoopTaskPtr;
use bun_jsc::debugger::AsyncTaskTracker;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    CallFrame, EventLoopHandle, JSGlobalObject, JSPromise, JSValue, JsError, JsResult, Task,
    ThreadSafe, Unprotect,
};
use bun_paths::{self as paths, OSPathBuffer, OSPathChar, OSPathSliceZ, PathBuffer};
use bun_sys::FdExt as _;
use bun_sys::{self as sys, E, Fd as FD, FdExt as _, Maybe, Mode, SystemErrno};
use bun_threading::UnboundedQueue;
use bun_threading::work_pool::{IntrusiveWorkTask as _, Task as WorkPoolTask, WorkPool};

// ──────────────────────────────────────────────────────────────────────────
// `Maybe(T)` shim — Zig's `bun.jsc.Maybe(T)` provides associated helpers
// (`.success`, `.errnoSys*`, `.getErrno`) on top of the bare `Result<T, Error>`
// alias that `bun_sys::Maybe<T>` is. `crate::node::Maybe` is now the same
// `Result` alias (Phase F), so this is just the file-local extension trait
// surface that lets `Maybe::<T>::errno_sys*` / `.get_errno()` resolve.
// ──────────────────────────────────────────────────────────────────────────
pub trait MaybeSysResultExt<R>: Sized {
    fn get_errno(&self) -> E;
    fn errno_sys<Rc: sys::GetErrno>(rc: Rc, syscall: sys::Tag) -> Option<Self>;
    fn errno_sys_fd<Rc: sys::GetErrno>(rc: Rc, syscall: sys::Tag, fd: FD) -> Option<Self>;
    fn errno_sys_p<Rc: sys::GetErrno>(
        rc: Rc,
        syscall: sys::Tag,
        path: impl AsRef<[u8]>,
    ) -> Option<Self>;
    fn errno_sys_pd<Rc: sys::GetErrno>(
        rc: Rc,
        syscall: sys::Tag,
        path: impl AsRef<[u8]>,
        dest: impl AsRef<[u8]>,
    ) -> Option<Self>;
    fn init_err_with_p(e: SystemErrno, syscall: sys::Tag, path: impl AsRef<[u8]>) -> Self;
}
impl<R> MaybeSysResultExt<R> for Maybe<R> {
    #[inline]
    fn get_errno(&self) -> E {
        match self {
            Ok(_) => E::SUCCESS,
            Err(e) => e.get_errno(),
        }
    }
    #[inline]
    fn init_err_with_p(e: SystemErrno, syscall: sys::Tag, path: impl AsRef<[u8]>) -> Self {
        Err(sys::Error {
            errno: (e as u16),
            syscall,
            path: path.as_ref().into(),
            ..Default::default()
        })
    }
    #[inline]
    fn errno_sys<Rc: sys::GetErrno>(rc: Rc, syscall: sys::Tag) -> Option<Self> {
        match sys::get_errno(rc) {
            E::SUCCESS => None,
            e => Some(Err(sys::Error {
                errno: (e as u16),
                syscall,
                ..Default::default()
            })),
        }
    }
    #[inline]
    fn errno_sys_fd<Rc: sys::GetErrno>(rc: Rc, syscall: sys::Tag, fd: FD) -> Option<Self> {
        match sys::get_errno(rc) {
            E::SUCCESS => None,
            e => Some(Err(sys::Error {
                errno: (e as u16),
                syscall,
                fd,
                ..Default::default()
            })),
        }
    }
    #[inline]
    fn errno_sys_p<Rc: sys::GetErrno>(
        rc: Rc,
        syscall: sys::Tag,
        path: impl AsRef<[u8]>,
    ) -> Option<Self> {
        match sys::get_errno(rc) {
            E::SUCCESS => None,
            e => Some(Err(sys::Error {
                errno: (e as u16),
                syscall,
                path: path.as_ref().into(),
                ..Default::default()
            })),
        }
    }
    #[inline]
    fn errno_sys_pd<Rc: sys::GetErrno>(
        rc: Rc,
        syscall: sys::Tag,
        path: impl AsRef<[u8]>,
        dest: impl AsRef<[u8]>,
    ) -> Option<Self> {
        match sys::get_errno(rc) {
            E::SUCCESS => None,
            e => Some(Err(sys::Error {
                errno: (e as u16),
                syscall,
                path: path.as_ref().into(),
                dest: dest.as_ref().into(),
                ..Default::default()
            })),
        }
    }
}

/// `bun.jsc.Maybe(void).success` — Zig's unit-success constructor. Only the
/// `()` instantiation needs the constant, so bound it separately.
pub trait MaybeSuccess: Sized {
    const SUCCESS: Self;
}
impl MaybeSuccess for Maybe<()> {
    const SUCCESS: Self = Ok(());
}

/// Convert the runtime `node::time_like::TimeLike` (== `libc::timespec` on
/// POSIX) into the `bun_sys::TimeLike` data shape that the `Syscall::*utimens`
/// wrappers consume. On Windows both are `f64`.
#[cfg(not(windows))]
#[inline]
fn to_sys_time_like(t: super::time_like::TimeLike) -> sys::TimeLike {
    sys::TimeLike {
        sec: t.tv_sec as i64,
        nsec: t.tv_nsec as i64,
    }
}
#[cfg(windows)]
#[inline]
fn to_sys_time_like(t: super::time_like::TimeLike) -> sys::TimeLike {
    // Windows `time_like::TimeLike` is `f64` seconds (libuv's `uv_fs_futime`
    // takes doubles directly). The few callers that round-trip through
    // `sys::TimeLike` (e.g. `lutimes` ENOENT fallback to `utimens`) need the
    // `{sec, nsec}` split. Use `floor` so `nsec` stays in `[0, 1e9)` for
    // negative non-integer `t` (e.g. `-1.5` → `{-2, 500_000_000}`, not
    // `{-1, -500_000_000}` which `trunc` would yield).
    let sec = t.floor();
    sys::TimeLike {
        sec: sec as i64,
        nsec: ((t - sec) * 1e9).round() as i64,
    }
}

// Local namespace shim: dependents in this file spell `ConcurrentTask::create*`
// (the Zig spelling). The Rust crate exports the *struct* as `ConcurrentTask`
// inside a same-named module, so re-export the free constructors here under the
// module name the call sites expect.
mod ConcurrentTask {
    pub use bun_event_loop::ConcurrentTask::ConcurrentTask;
    #[inline]
    pub fn create(task: bun_jsc::Task) -> *mut ConcurrentTask {
        ConcurrentTask::create(task)
    }
    #[inline]
    pub fn create_from<T: bun_event_loop::Taskable>(task: *mut T) -> *mut ConcurrentTask {
        ConcurrentTask::create_from(task)
    }
    #[inline]
    pub fn from_callback<T>(
        ptr: *mut T,
        cb: fn(*mut T) -> bun_event_loop::JsResult<()>,
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
/// stored this as `?*AbortSignal` and called `.ref()`/`.unref()` manually.
/// Now backed by `bun_ptr::ExternalShared<AbortSignal>` (alias re-exported
/// from `bun_jsc`): `Clone` → `ref()`, `Drop` → `unref()`, `Deref` → `&AbortSignal`.
use bun_jsc::AbortSignalRef;

// PORT NOTE: Zig referenced these via `bun.api.node.*`. The Phase-A draft
// pulled them through `bun_jsc::node` (a re-export shim that no longer exists
// once `node.rs` owns the module tree). Round 2 wires them to the real
// sibling modules under `super::` so this file compiles standalone.
use super::stat::Stats;
use super::time_like::TimeLike;
use super::types::{
    ArgumentsSlice, Dirent, Encoding, FdArgExt as _, FdJsc as _, FileSystemFlags,
    FileSystemFlagsKind, PathLike, PathLikeExt as _, PathOrFdExt as _, StringOrBuffer,
    VectorArrayBuffer,
};
// Re-exported publicly: `crate::node::fs::PathOrFileDescriptor` is the
// canonical path used by `cli/build_command.rs` et al. (mirrors Zig's
// `bun.api.node.fs.PathOrFileDescriptor`).
pub use super::types::PathOrFileDescriptor;

/// Local alias for the many `node::foo` call sites below — keeps the diff
/// against `node_fs.zig` readable while routing to `super::*`.
mod node {
    pub use super::super::statfs::StatFS;
    pub use super::super::time_like::from_js as time_like_from_js;
    pub use super::super::types::{Buffer, SliceWithUnderlyingString};
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
use super::MaybeTodo as _;
use super::util::validators;

// Trait imports for inherent-looking method calls on upstream types:
//   - `bun_sys::FdExt`       → `Fd::close()`
//   - `super::types::FdJsc`  → `Fd::from_js_validated()`
//   - `bun_jsc::SysErrorJsc` → `bun_sys::Error::to_js()`
//   - `bun_sys_jsc::ErrorJsc`→ `bun_sys::Error::to_js_with_async_stack()`
#[allow(unused_imports)]
use super::types::FdJsc as _;
#[allow(unused_imports)]
use bun_jsc::SysErrorJsc as _;
use bun_sys_jsc::ErrorJsc as _;

/// `WorkPoolTask` (aka `bun_threading::thread_pool::Task`) does not derive
/// `Default` (its `callback` field has no sensible default). Build one with
/// the intrusive `node` zeroed and the supplied callback. Mirrors Zig's
/// `.{ .callback = ... }` struct init where unset fields default.
#[inline]
fn work_pool_task(callback: unsafe fn(*mut WorkPoolTask)) -> WorkPoolTask {
    WorkPoolTask {
        node: bun_threading::thread_pool::Node::default(),
        callback,
    }
}

pub use super::node_fs_constant as constants;
// `Watcher` / `StatWatcher` mirror Zig's `pub const Watcher = @import(
// "./node_fs_watcher.zig");` / `pub const StatWatcher = @import(
// "./node_fs_stat_watcher.zig");`. The sibling modules are declared in
// `node.rs`; re-export them under the names the `args::Watch` / `watch()`
// bodies below expect.
#[allow(non_snake_case)]
pub use super::node_fs_stat_watcher as StatWatcher;
#[allow(non_snake_case)]
pub use super::node_fs_watcher as Watcher;

/// `Binding` is the JSC-class instance that owns the per-thread `NodeFS`
/// (`super::node_fs_binding::Binding`). Re-exported so the async `create()`
/// entry points keep their `&mut Binding` signature source-compatible with
/// `node_fs.zig`.
pub use super::node_fs_binding::Binding;

/// `jsc.JSPromise.Strong` — re-exported under its Rust crate name. The Zig
/// source spells this `JSPromise.Strong` (a nested decl), which Rust models as
/// `bun_jsc::js_promise::Strong` / the `JSPromiseStrong` alias.
use bun_jsc::JSPromiseStrong;

use super::dir_iterator as DirIterator;
use bun_resolver::fs::FileSystem;

// On POSIX the libuv-backed code paths (`UVFSRequest`, `uv_fs_*`) are absent:
// `UVFSRequest` aliases `AsyncFSTask` and every `uv::*` reference is gated
// behind `#[cfg(windows)]`. There is intentionally **no** POSIX stub module
// here so misuse is a compile error, not a silent null.
#[cfg(windows)]
use bun_sys::windows::{self, libuv as uv};

// Syscall = bun.sys.sys_uv on Windows, bun.sys otherwise
#[cfg(not(windows))]
use bun_sys as Syscall;
#[cfg(windows)]
use bun_sys::sys_uv as Syscall;

/// In-place RAII wrapper for a libuv `fs_t` request (Zig: `var req: uv.fs_t =
/// uv.fs_t.uninitialized; defer req.deinit();`).
///
/// `scopeguard::guard(fs_t, |mut r| r.deinit())` is *wrong* here: its `Drop`
/// `ManuallyDrop::take`s the value into the closure parameter, relocating the
/// ~440-byte request to a new stack address before `uv_fs_req_cleanup` runs.
/// libuv stores self-referential pointers (`req->fs.info.bufs` may point at
/// `req->fs.info.bufsml`), so the request must not move between init and
/// cleanup. A real `Drop` impl runs in place at the original address.
#[cfg(windows)]
#[repr(transparent)]
struct UvFsReq(uv::fs_t);
#[cfg(windows)]
impl UvFsReq {
    #[inline]
    fn new() -> Self {
        Self(uv::fs_t::uninitialized())
    }
}
#[cfg(windows)]
impl Drop for UvFsReq {
    #[inline]
    fn drop(&mut self) {
        self.0.deinit();
    }
}
#[cfg(windows)]
impl core::ops::Deref for UvFsReq {
    type Target = uv::fs_t;
    #[inline]
    fn deref(&self) -> &uv::fs_t {
        &self.0
    }
}
#[cfg(windows)]
impl core::ops::DerefMut for UvFsReq {
    #[inline]
    fn deref_mut(&mut self) -> &mut uv::fs_t {
        &mut self.0
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Local cross-crate shims
//
// These wrap symbols whose canonical home moved under the Rust crate split so
// the hundreds of call sites below — which mirror `node_fs.zig` 1:1 — don't
// have to be rewritten per-line. Each is a thin forwarder.
// ──────────────────────────────────────────────────────────────────────────

/// `bun.strings.withoutNTPrefix` — lives in `bun_core::paths`
/// under the Rust crate split, not at the `strings` root.
#[inline]
fn without_nt_prefix<T: bun_paths::string_paths::Ch>(path: &[T]) -> &[T] {
    bun_paths::string_paths::without_nt_prefix(path)
}

/// `bun.paths.OSPathLiteral("")` — Zig comptime string→`[:0]const OSPathChar`.
/// Only the empty-string case is used in this file. `OSPathSliceZ` is a DST
/// (`ZStr`/`WStr`), so callers borrow it.
#[inline]
fn os_path_literal_empty() -> &'static OSPathSliceZ {
    #[cfg(windows)]
    {
        bun_core::WStr::EMPTY
    }
    #[cfg(not(windows))]
    {
        ZStr::EMPTY
    }
}

/// `bun.StandaloneModuleGraph::get()` — singleton accessor. Short-circuits
/// `stat`/`exists`/`readFile` for files embedded in `bun build --compile`
/// binaries (under `/$bunfs/` / `B:\~BUN\`). Returns `None` outside a
/// standalone executable. The graph stores per-`File` lazy fields under
/// interior mutability, so `get()` hands out a raw `*mut`; we re-borrow it
/// `&mut` for the duration of each lookup (single-threaded JS / workpool
/// callers never overlap on the same `File`).
#[inline]
fn standalone_module_graph_get() -> Option<*mut bun_standalone_graph::Graph> {
    bun_standalone_graph::Graph::get()
}

/// Local shim for `Maybe(void)::aborted` (node.rs:302). `bun_sys::Maybe` is
/// `core::result::Result`, which has no `aborted()` constructor; inline the
/// sentinel error directly so call sites stay shaped like the Zig source.
#[inline]
fn abort_err() -> sys::Error {
    sys::Error {
        errno: E::EINTR as _,
        syscall: sys::Tag::access,
        ..Default::default()
    }
}

/// Local shim for `Maybe(R).errnoSysP` (node.rs `MaybeSysExt`). Kept as a free
/// function with return shape `Option<Maybe<()>>` so `.unwrap_or(Ok(()))`
/// chaining keeps working without a turbofish at every call site.
#[inline]
fn errno_sys_p_maybe(rc: c_int, syscall: sys::Tag, file_path: &[u8]) -> Option<Maybe<()>> {
    let e = sys::get_errno(rc);
    if e == sys::posix::E::SUCCESS {
        return None;
    }
    Some(Err(sys::Error::from_code(e, syscall).with_path(file_path)))
}

/// `bun.sys.Error.withPathLike` — `with_path()` for a `PathOrFileDescriptor`.
/// On `Fd`, the upstream Zig records the fd; here we just attach the path
/// slice when available (matches the read/write callers in this file, which
/// only reach this with `Path`).
#[inline]
fn with_path_like(err: sys::Error, p: &PathOrFileDescriptor) -> sys::Error {
    match p {
        PathOrFileDescriptor::Path(p) => err.with_path(p.slice()),
        PathOrFileDescriptor::Fd(fd) => sys::Error { fd: *fd, ..err },
    }
}

/// `node::Encoding` → `bun_core::NodeEncoding`. Both are `#[repr(u8)]` with the
/// identical discriminant layout (`Utf8..Buffer`); `webcore::encoding` was ported
/// against the upstream copy, so adapt at the boundary instead of changing
/// either definition.
#[inline]
fn encoding_to_node(e: Encoding) -> bun_core::NodeEncoding {
    use bun_core::NodeEncoding as N;
    match e {
        Encoding::Utf8 => N::Utf8,
        Encoding::Ucs2 => N::Ucs2,
        Encoding::Utf16le => N::Utf16le,
        Encoding::Latin1 => N::Latin1,
        Encoding::Ascii => N::Ascii,
        Encoding::Base64 => N::Base64,
        Encoding::Base64url => N::Base64url,
        Encoding::Hex => N::Hex,
        Encoding::Buffer => N::Buffer,
    }
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
const PREALLOCATE_SUPPORTED: bool = cfg!(any(target_os = "linux", target_os = "android"));
const PREALLOCATE_LENGTH: usize = 2048 * 1024;

/// `PathString.PathInt` — Zig packed-struct field width. `bun_core::PathString`
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
fn mkdir_os_path(path: &OSPathSliceZ, mode: Mode) -> Maybe<()> {
    let _ = mode;
    sys::mkdir_w(path)
}
#[cfg(windows)]
#[inline]
fn openat_os_path(dirfd: FD, path: &OSPathSliceZ, flags: i32, mode: Mode) -> Maybe<FD> {
    sys::openat_windows(dirfd, path.as_slice(), flags, mode)
}

/// `bun.sys.directoryExistsAt` — Zig dispatches on `anytype` element width
/// (sys.zig:3601 → `existsAtType` picks `toNTPath16` for `[*]const u16`). On
/// Windows `OSPathSliceZ` is already `&WStr`, so forward to the wide overload
/// instead of narrowing to UTF-8 and re-widening. POSIX is a forwarder.
#[inline]
fn directory_exists_at_os_path(dir: FD, path: &OSPathSliceZ) -> Maybe<bool> {
    #[cfg(not(windows))]
    {
        sys::directory_exists_at(dir, path)
    }
    #[cfg(windows)]
    {
        sys::directory_exists_at_w(dir, path.as_slice())
    }
}

type ReadPosition = i64;
type Buffer = super::types::Buffer;
type ArrayBuffer = bun_jsc::MarkedArrayBuffer;
type GidT = node::gid_t;
type UidT = node::uid_t;

#[cfg(unix)]
pub const DEFAULT_PERMISSION: Mode = sys::S::IRUSR as Mode
    | sys::S::IWUSR as Mode
    | sys::S::IRGRP as Mode
    | sys::S::IWGRP as Mode
    | sys::S::IROTH as Mode
    | sys::S::IWOTH as Mode;
#[cfg(not(unix))]
// Windows does not have permissions
pub const DEFAULT_PERMISSION: Mode = 0;

// `AbortSignalRef` (= `ExternalShared<AbortSignal>`) implements `Deref`, so
// `signal.pending_activity_ref()` / `signal.aborted()` resolve directly to the
// `&AbortSignal` inherent methods — the former `AbortSignalRefExt` shim with
// per-call `unsafe { self.as_ref() }` is gone. `unref()` is handled by `Drop`.

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
        pub type AppendFile =
            AsyncFSTask<ret::AppendFile, args::AppendFile, { NodeFSFunctionEnum::AppendFile }>;
        pub type Chmod = AsyncFSTask<ret::Chmod, args::Chmod, { NodeFSFunctionEnum::Chmod }>;
        pub type Chown = AsyncFSTask<ret::Chown, args::Chown, { NodeFSFunctionEnum::Chown }>;
        pub type Close = UVFSRequest<ret::Close, args::Close, { NodeFSFunctionEnum::Close }>;
        pub type CopyFile =
            AsyncFSTask<ret::CopyFile, args::CopyFile, { NodeFSFunctionEnum::CopyFile }>;
        pub type Exists = AsyncFSTask<ret::Exists, args::Exists, { NodeFSFunctionEnum::Exists }>;
        pub type Fchmod = AsyncFSTask<ret::Fchmod, args::FChmod, { NodeFSFunctionEnum::Fchmod }>;
        pub type Fchown = AsyncFSTask<ret::Fchown, args::Fchown, { NodeFSFunctionEnum::Fchown }>;
        pub type Fdatasync =
            AsyncFSTask<ret::Fdatasync, args::FdataSync, { NodeFSFunctionEnum::Fdatasync }>;
        pub type Fstat = AsyncFSTask<ret::Fstat, args::Fstat, { NodeFSFunctionEnum::Fstat }>;
        pub type Fsync = AsyncFSTask<ret::Fsync, args::Fsync, { NodeFSFunctionEnum::Fsync }>;
        pub type Ftruncate =
            AsyncFSTask<ret::Ftruncate, args::FTruncate, { NodeFSFunctionEnum::Ftruncate }>;
        pub type Futimes =
            AsyncFSTask<ret::Futimes, args::Futimes, { NodeFSFunctionEnum::Futimes }>;
        pub type Lchmod = AsyncFSTask<ret::Lchmod, args::LCHmod, { NodeFSFunctionEnum::Lchmod }>;
        pub type Lchown = AsyncFSTask<ret::Lchown, args::LChown, { NodeFSFunctionEnum::Lchown }>;
        pub type Link = AsyncFSTask<ret::Link, args::Link, { NodeFSFunctionEnum::Link }>;
        pub type Lstat = AsyncFSTask<ret::Stat, args::Stat, { NodeFSFunctionEnum::Lstat }>;
        pub type Lutimes =
            AsyncFSTask<ret::Lutimes, args::Lutimes, { NodeFSFunctionEnum::Lutimes }>;
        pub type Mkdir = AsyncFSTask<ret::Mkdir, args::Mkdir, { NodeFSFunctionEnum::Mkdir }>;
        pub type Mkdtemp =
            AsyncFSTask<ret::Mkdtemp, args::MkdirTemp, { NodeFSFunctionEnum::Mkdtemp }>;
        pub type Open = UVFSRequest<ret::Open, args::Open, { NodeFSFunctionEnum::Open }>;
        pub type Read = UVFSRequest<ret::Read, args::Read, { NodeFSFunctionEnum::Read }>;
        pub type Readdir =
            AsyncFSTask<ret::Readdir, args::Readdir, { NodeFSFunctionEnum::Readdir }>;
        pub type ReadFile =
            AsyncFSTask<ret::ReadFile, args::ReadFile, { NodeFSFunctionEnum::ReadFile }>;
        pub type Readlink =
            AsyncFSTask<ret::Readlink, args::Readlink, { NodeFSFunctionEnum::Readlink }>;
        pub type Readv = UVFSRequest<ret::Readv, args::Readv, { NodeFSFunctionEnum::Readv }>;
        pub type Realpath =
            AsyncFSTask<ret::Realpath, args::Realpath, { NodeFSFunctionEnum::Realpath }>;
        pub type RealpathNonNative =
            AsyncFSTask<ret::Realpath, args::Realpath, { NodeFSFunctionEnum::RealpathNonNative }>;
        pub type Rename = AsyncFSTask<ret::Rename, args::Rename, { NodeFSFunctionEnum::Rename }>;
        pub type Rm = AsyncFSTask<ret::Rm, args::Rm, { NodeFSFunctionEnum::Rm }>;
        pub type Rmdir = AsyncFSTask<ret::Rmdir, args::RmDir, { NodeFSFunctionEnum::Rmdir }>;
        pub type Stat = AsyncFSTask<ret::Stat, args::Stat, { NodeFSFunctionEnum::Stat }>;
        pub type Symlink =
            AsyncFSTask<ret::Symlink, args::Symlink, { NodeFSFunctionEnum::Symlink }>;
        pub type Truncate =
            AsyncFSTask<ret::Truncate, args::Truncate, { NodeFSFunctionEnum::Truncate }>;
        pub type Unlink = AsyncFSTask<ret::Unlink, args::Unlink, { NodeFSFunctionEnum::Unlink }>;
        pub type Utimes = AsyncFSTask<ret::Utimes, args::Utimes, { NodeFSFunctionEnum::Utimes }>;
        pub type Write = UVFSRequest<ret::Write, args::Write, { NodeFSFunctionEnum::Write }>;
        pub type WriteFile =
            AsyncFSTask<ret::WriteFile, args::WriteFile, { NodeFSFunctionEnum::WriteFile }>;
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

        bun_threading::intrusive_work_task!(AsyncMkdirp, task);

        impl AsyncMkdirp {
            pub fn new(init: AsyncMkdirp) -> Box<Self> {
                Box::new(init)
            }

            pub fn work_pool_callback(task: *mut WorkPoolTask) {
                // SAFETY: task points to AsyncMkdirp.task
                let this = unsafe { &mut *AsyncMkdirp::from_task_ptr(task) };

                let mut node_fs = NodeFS::default();
                // SAFETY: caller keeps `path` alive until completion
                let path = unsafe { &*this.path };
                let result = node_fs.mkdir_recursive(&args::Mkdir {
                    path: PathLike::String(PathString::init(path)),
                    recursive: true,
                    ..Default::default()
                });
                match result {
                    Err(err) => {
                        (this.completion)(
                            this.completion_ctx,
                            // `with_path` already clones into a fresh `Box<[u8]>`; pass the
                            // existing path slice (Zig duped it explicitly).
                            Err(err.with_path(&err.path)),
                        );
                    }
                    Ok(_) => {
                        (this.completion)(this.completion_ctx, Ok(()));
                    }
                }
            }

            pub fn schedule(&mut self) {
                WorkPool::schedule(&raw mut self.task);
            }
        }

        impl Default for AsyncMkdirp {
            fn default() -> Self {
                Self {
                    completion_ctx: core::ptr::null_mut(),
                    completion: |_, _| {},
                    path: core::ptr::slice_from_raw_parts(core::ptr::null(), 0),
                    task: work_pool_task(Self::work_pool_callback),
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
    pub struct UVFSRequest<R, A: Unprotect, const F: NodeFSFunctionEnum> {
        pub promise: JSPromiseStrong,
        /// Wrapped in [`ThreadSafe`] so the paired `unprotect()` runs on drop.
        pub args: ThreadSafe<A>,
        pub global_object: bun_ptr::BackRef<JSGlobalObject>,
        pub req: uv::fs_t,
        pub result: Maybe<R>,
        pub r#ref: KeepAlive,
        pub tracker: AsyncTaskTracker,
    }

    #[cfg(windows)]
    impl<R: FsReturn, A: FsArgument, const F: NodeFSFunctionEnum> UVFSRequest<R, A, F>
    where
        Op<{ F }>: NodeFSDispatch<R, A>,
    {
        pub const HEAP_LABEL: &'static str = F.heap_label_uv();

        /// Deref the raw `global_object` pointer.
        ///
        /// Invariant: set from a live `&JSGlobalObject` in `create()` and never
        /// null; the JSC global outlives every task (JSC_BORROW per LIFETIMES.tsv).
        #[inline]
        pub fn global_object(&self) -> &JSGlobalObject {
            self.global_object.get()
        }

        pub fn create(
            global_object: &JSGlobalObject,
            binding: &Binding,
            task_args: A,
            vm: &mut VirtualMachine,
        ) -> JSValue {
            let task = Box::new(Self {
                promise: JSPromiseStrong::init(global_object),
                args: task_args.into_thread_safe(),
                // Sentinel — overwritten by `uv_callback` (or the early-return arms
                // below) before any read on the JS thread. `Maybe<R>` is
                // `Result<R, sys::Error>` and may be niche-optimised for arbitrary
                // `R`; never construct an all-zero `Result` value.
                result: Err(sys::Error::default()),
                global_object: bun_ptr::BackRef::new(global_object),
                req: bun_core::ffi::zeroed(),
                r#ref: KeepAlive::default(),
                tracker: AsyncTaskTracker::init(vm),
            });
            // Transfer ownership to libuv: the box outlives the async request and is
            // reclaimed in `destroy()` (run_from_js_thread → scopeguard). `heap::release`
            // names that hand-off — it is `Box::leak` under the hood; the reclaim
            // happens in `destroy()`, not in this scope.
            let task: &mut Self = bun_core::heap::release(task);
            // KeepAlive::ref_ now takes the type-erased aio EventLoopCtx; the JS
            // event loop is the only one that owns AsyncFSTask/UVFSRequest.
            task.r#ref.ref_(bun_io::js_vm_ctx());
            let _ = vm;
            task.tracker.did_schedule(global_object);

            let loop_ = uv::Loop::get();
            task.req.data = core::ptr::from_mut::<Self>(task).cast::<c_void>();

            // PORT NOTE: Zig's `comptime switch (FunctionEnum)` monomorphises this
            // to a single arm. Rust resolves the match at compile time too (`F` is
            // a const generic), but each arm's body needs `A` re-asserted to its
            // concrete `args::*` type — same identity-cast pattern as
            // `NodeFS::dispatch` (per the `async_::*` aliases, `A == $Args` for the
            // matched `F`).
            macro_rules! args_as {
                ($Args:ty) => {{
                    debug_assert_eq!(core::mem::size_of::<A>(), core::mem::size_of::<$Args>());
                    // SAFETY: identity cast — `A == $Args` for this `F` (see `async_::*`).
                    // `ThreadSafe<A>` is `repr(transparent)`; deref through it for the inner `A`.
                    unsafe { &*(&*task.args as *const A as *const $Args) }
                }};
            }
            match F {
                NodeFSFunctionEnum::Open => {
                    let args: &args::Open = args_as!(args::Open);
                    let path = if strings::eql_comptime(args.path.slice(), b"/dev/null") {
                        ZStr::from_static(b"\\\\.\\NUL\0")
                    } else {
                        // SAFETY (R-2): single-JS-thread `JsCell` projection of the
                        // scratch path buffer; the borrow is held only across the
                        // libuv enqueue below (which copies `path` internally) and
                        // never across a JS re-entry point.
                        args.path
                            .slice_z(unsafe { &mut binding.node_fs.get_mut().sync_error_buf })
                    };
                    let mut flags: c_int = args.flags.as_int();
                    flags = uv::O::from_bun_o(flags);
                    let mut mode: c_int = args.mode as c_int;
                    if mode == 0 {
                        mode = 0o644;
                    }
                    // SAFETY: libuv async request; `task.req` and `path` outlive the
                    // call (path is copied internally by libuv before return).
                    let rc = unsafe {
                        uv::uv_fs_open(
                            loop_,
                            &mut task.req,
                            path.as_ptr(),
                            flags,
                            mode,
                            Some(Self::uv_callback),
                        )
                    };
                    debug_assert!(rc == uv::ReturnCode::ZERO);
                    sys::syslog!(
                        "uv open({}, {}, {}) = scheduled",
                        ::bstr::BStr::new(path.as_bytes()),
                        flags,
                        mode
                    );
                }
                NodeFSFunctionEnum::Close => {
                    let args: &args::Close = args_as!(args::Close);
                    let fd = args.fd.uv();
                    if fd == 1 || fd == 2 {
                        sys::syslog!("uv close({}) SKIPPED", fd);
                        // SAFETY: identity write — `R == ret::Close == ()` for this `F`.
                        unsafe {
                            core::ptr::write(
                                &mut task.result as *mut Maybe<R> as *mut Maybe<ret::Close>,
                                Ok(()),
                            )
                        };
                        let task_ptr: *mut Self = task;
                        task.global_object()
                            .bun_vm()
                            .event_loop_mut()
                            .enqueue_task(Task::init(task_ptr));
                        return task.promise.value();
                    }
                    // SAFETY: libuv async request.
                    let rc = unsafe {
                        uv::uv_fs_close(loop_, &mut task.req, fd, Some(Self::uv_callback))
                    };
                    debug_assert!(rc == uv::ReturnCode::ZERO);
                    sys::syslog!("uv close({}) = scheduled", fd);
                }
                NodeFSFunctionEnum::Read => {
                    let args: &args::Read = args_as!(args::Read);
                    let fd = args.fd.uv();
                    let buf = args.buffer.slice();
                    let off = (buf.len()).min(args.offset as usize);
                    let buf = &buf[off..];
                    let buf = &buf[..buf.len().min(args.length as usize)];
                    let bufs = [uv::uv_buf_t::init(buf)];
                    // SAFETY: libuv copies the iovec descriptor before return; the
                    // backing Buffer is JS-protected via `to_thread_safe`.
                    let rc = unsafe {
                        uv::uv_fs_read(
                            loop_,
                            &mut task.req,
                            fd,
                            bufs.as_ptr(),
                            1,
                            args.position.map(|p| p as i64).unwrap_or(-1),
                            Some(Self::uv_callback),
                        )
                    };
                    debug_assert!(rc == uv::ReturnCode::ZERO);
                    sys::syslog!("uv read({}) = scheduled", fd);
                }
                NodeFSFunctionEnum::Write => {
                    let args: &args::Write = args_as!(args::Write);
                    let fd = args.fd.uv();
                    let buf = args.buffer.slice();
                    let off = (buf.len()).min(args.offset as usize);
                    let buf = &buf[off..];
                    let buf = &buf[..buf.len().min(args.length as usize)];
                    let bufs = [uv::uv_buf_t::init(buf)];
                    // SAFETY: see Read arm.
                    let rc = unsafe {
                        uv::uv_fs_write(
                            loop_,
                            &mut task.req,
                            fd,
                            bufs.as_ptr(),
                            1,
                            args.position.map(|p| p as i64).unwrap_or(-1),
                            Some(Self::uv_callback),
                        )
                    };
                    debug_assert!(rc == uv::ReturnCode::ZERO);
                    sys::syslog!("uv write({}) = scheduled", fd);
                }
                NodeFSFunctionEnum::Readv => {
                    let args: &args::Readv = args_as!(args::Readv);
                    let fd = args.fd.uv();
                    let bufs = &args.buffers.buffers;
                    let pos: i64 = args.position.map(|p| p as i64).unwrap_or(-1);
                    let sum: u64 = bufs.iter().map(|b| b.slice().len() as u64).sum();
                    // SAFETY: `bufs` (Vec<PlatformIoVec> == Vec<uv_buf_t>) lives in
                    // the leaked task; libuv copies the array before return.
                    let rc = unsafe {
                        uv::uv_fs_read(
                            loop_,
                            &mut task.req,
                            fd,
                            bufs.as_ptr().cast(),
                            c_uint::try_from(bufs.len()).expect("int cast"),
                            pos,
                            Some(Self::uv_callback),
                        )
                    };
                    debug_assert!(rc == uv::ReturnCode::ZERO);
                    sys::syslog!(
                        "uv readv({}, {:p}, {}, {}, {} total bytes) = scheduled",
                        fd,
                        bufs.as_ptr(),
                        bufs.len(),
                        pos,
                        sum
                    );
                }
                NodeFSFunctionEnum::Writev => {
                    let args: &args::Writev = args_as!(args::Writev);
                    let fd = args.fd.uv();
                    let bufs = &args.buffers.buffers;
                    if bufs.is_empty() {
                        // SAFETY: identity write — `R == ret::Writev == ret::Write` for this `F`.
                        unsafe {
                            core::ptr::write(
                                &mut task.result as *mut Maybe<R> as *mut Maybe<ret::Writev>,
                                Ok(ret::Write { bytes_written: 0 }),
                            )
                        };
                        let task_ptr: *mut Self = task;
                        task.global_object()
                            .bun_vm()
                            .event_loop_mut()
                            .enqueue_task(Task::init(task_ptr));
                        return task.promise.value();
                    }
                    let pos: i64 = args.position.map(|p| p as i64).unwrap_or(-1);
                    let sum: u64 = bufs.iter().map(|b| b.slice().len() as u64).sum();
                    // SAFETY: see Readv arm.
                    let rc = unsafe {
                        uv::uv_fs_write(
                            loop_,
                            &mut task.req,
                            fd,
                            bufs.as_ptr().cast(),
                            c_uint::try_from(bufs.len()).expect("int cast"),
                            pos,
                            Some(Self::uv_callback),
                        )
                    };
                    debug_assert!(rc == uv::ReturnCode::ZERO);
                    sys::syslog!(
                        "uv writev({}, {:p}, {}, {}, {} total bytes) = scheduled",
                        fd,
                        bufs.as_ptr(),
                        bufs.len(),
                        pos,
                        sum
                    );
                }
                NodeFSFunctionEnum::Statfs => {
                    let args: &args::StatFS = args_as!(args::StatFS);
                    // SAFETY (R-2): single-JS-thread `JsCell` projection; held only
                    // across the libuv enqueue (copies `path` internally).
                    let path = args
                        .path
                        .slice_z(unsafe { &mut binding.node_fs.get_mut().sync_error_buf });
                    // SAFETY: libuv copies `path` internally before return.
                    let rc = unsafe {
                        uv::uv_fs_statfs(
                            loop_,
                            &mut task.req,
                            path.as_ptr(),
                            Some(Self::uv_callbackreq),
                        )
                    };
                    debug_assert!(rc == uv::ReturnCode::ZERO);
                    sys::syslog!("uv statfs({}) = ~~", ::bstr::BStr::new(path.as_bytes()));
                }
                _ => unreachable!("UVFSRequest type not implemented"),
            }

            task.promise.value()
        }

        extern "C" fn uv_callback(req: *mut uv::fs_t) {
            // SAFETY: req points to a live uv::fs_t passed by libuv; cleanup is the documented pair
            scopeguard::defer! { unsafe { uv::uv_fs_req_cleanup(req) } };
            // SAFETY: req.data was set to the Box::leak'd `*mut Self` in create()
            let this: &mut Self = unsafe { bun_ptr::callback_ctx::<Self>((*req).data) };
            let mut node_fs = NodeFS::default();
            // `req` aliases `this.req` (see create(): `task.req.data = from_mut(task)`); once
            // `this: &mut Self` is live, re-deriving through the raw `req` would create a
            // second overlapping `&mut` (Stacked-Borrows UB). Go through `this.req` instead.
            this.result =
                NodeFS::uv_dispatch::<R, A, F>(&mut node_fs, &this.args, this.req.result.int());
            // Zig clones `err` here so its `.path` outlives the stack `node_fs.sync_error_buf`
            // it borrowed from. In Rust `sys::Error::path` is `Box<[u8]>` boxed at the
            // `errno_sys_p` construction site, so no clone is needed — `node_fs` may drop.
            let this_ptr: *mut Self = this;
            this.global_object()
                .bun_vm()
                .event_loop_mut()
                .enqueue_task(Task::init(this_ptr));
        }

        extern "C" fn uv_callbackreq(req: *mut uv::fs_t) {
            // Same as uv_callback but passes `req` through to the dispatch fn (statfs needs req.ptr).
            // SAFETY: req points to a live uv::fs_t passed by libuv; cleanup is the documented pair
            scopeguard::defer! { unsafe { uv::uv_fs_req_cleanup(req) } };
            // SAFETY: req.data was set to the Box::leak'd `*mut Self` in create()
            let this: &mut Self = unsafe { bun_ptr::callback_ctx::<Self>((*req).data) };
            let mut node_fs = NodeFS::default();
            // `req` aliases `this.req`; once `this: &mut Self` is live, re-deriving `&mut *req`
            // would overlap it (Stacked-Borrows UB). Go through `this.req` instead — disjoint-field
            // borrow alongside `&this.args` / `this.result =`. Hoist the result read so it isn't
            // evaluated after `&mut this.req` is formed in the same call expression.
            let rc = this.req.result.int();
            this.result =
                NodeFS::uv_dispatch_req::<R, A, F>(&mut node_fs, &this.args, &mut this.req, rc);
            // No `err.clone()` needed — see `uv_callback` above.
            let this_ptr: *mut Self = this;
            this.global_object()
                .bun_vm()
                .event_loop_mut()
                .enqueue_task(Task::init(this_ptr));
        }

        pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JsTerminated> {
            // SAFETY: self was Box::leak'd in create(); destroy() runs exactly once on scope exit
            let _deinit =
                scopeguard::guard(core::ptr::from_mut(self), |p| unsafe { Self::destroy(p) });
            // Move `result` out so the `global_object()` `&self` borrow can coexist
            // with `&mut result` below; the sentinel left behind is dropped in `destroy()`.
            let mut result = core::mem::replace(&mut self.result, Err(sys::Error::default()));
            let global_object = self.global_object();
            let success = matches!(result, Ok(_));
            let promise_value = self.promise.value();
            let promise = self.promise.get();
            let result = match &mut result {
                Err(err) => match err.to_js_with_async_stack(global_object, promise) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.reject(global_object, Ok(global_object.take_exception(e)));
                    }
                },
                Ok(res) => match FsReturn::fs_to_js(res, global_object) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.reject(global_object, Ok(global_object.take_exception(e)));
                    }
                },
            };
            promise_value.ensure_still_alive();

            let _dispatch = self.tracker.dispatch(global_object);

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
            // Zig: `result.err.deinit()` — `bun_sys::Error` frees its path on Drop.
            // Zig passed `*VirtualMachine`; Rust's KeepAlive takes `EventLoopCtx`.
            this_ref.r#ref.unref(bun_io::js_vm_ctx());
            // `args: ThreadSafe<A>` unprotects + drops via `heap::take` below.
            this_ref.promise = JSPromiseStrong::default();
            // SAFETY: paired with Box::leak in create()
            drop(unsafe { bun_core::heap::take(this) });
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // NewAsyncFSTask — runs a NodeFS method on the thread pool.
    // ──────────────────────────────────────────────────────────────────────────

    /// Trait abstracting over Argument types' deinit/toThreadSafe.
    ///
    /// Zig: every Arguments struct defines `toThreadSafe(self: *@This())` (clone
    /// any borrowed JS-backed slices so the work-pool callback may run off-thread)
    /// and most define `deinitAndUnprotect` (free those clones and `unprotect` any
    /// retained `JSValue`s). The Zig spec dispatches via `@hasDecl`; in Rust the
    /// trait methods are **required** so missing impls are a compile error rather
    /// than a silent UAF/leak.
    pub trait FsArgument: Sized + Unprotect {
        const HAVE_ABORT_SIGNAL: bool = false;
        /// `Arguments.fromJS(ctx, &slice)` — parse this argument set from a JS
        /// call frame. Every `args::*` struct already exposes an inherent
        /// `from_js`; the trait forwards to it so the generic `Bindings` in
        /// `node_fs_binding.rs` can call it without per-type macro arms.
        fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self>;
        fn to_thread_safe(&mut self);
        /// Consume `self`, protect any JS-backed buffers, and return a guard that
        /// unprotects on drop. The Rust replacement for Zig's
        /// `args.toThreadSafe()` / `defer args.deinitAndUnprotect()` pair —
        /// string/slice ownership is handled by each field's `Drop` (PathLike,
        /// StringOrBuffer, Vec); only the JS-side `unprotect()` needs the guard.
        #[inline]
        fn into_thread_safe(mut self) -> ThreadSafe<Self> {
            self.to_thread_safe();
            ThreadSafe::adopt(self)
        }
        fn signal(&self) -> Option<&AbortSignal> {
            None
        }
    }

    /// Forward [`FsArgument`] to the inherent `from_js` / `to_thread_safe`
    /// methods each `args::*` struct already defines (1:1 with `Arguments.*` in
    /// `node_fs.zig`). [`Unprotect`] is implemented per-type alongside.
    macro_rules! impl_fs_argument {
    ( $( $ty:ty ),+ $(,)? ) => {
        $( impl FsArgument for $ty {
            #[inline] fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> { <$ty>::from_js(ctx, arguments) }
            #[inline] fn to_thread_safe(&mut self) { <$ty>::to_thread_safe(self) }
        } )+
    };
    // Fd-only types — Zig has only `toThreadSafe(_: *const @This()) void {}`
    // and no `deinitAndUnprotect`; spec node_fs.zig:325 falls back to
    // `deinit()` (a no-op — these hold only `FD`/scalars).
    ( @fd $( $ty:ty ),+ $(,)? ) => {
        $( impl FsArgument for $ty {
            #[inline] fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> { <$ty>::from_js(ctx, arguments) }
            #[inline] fn to_thread_safe(&mut self) { <$ty>::to_thread_safe(self) }
        }
        impl Unprotect for $ty {
            #[inline] fn unprotect(&mut self) {}
        } )+
    };
}
    impl_fs_argument!(
        args::Rename,
        args::Truncate,
        args::FdVectorIo,
        args::FTruncate,
        args::Chown,
        args::Lutimes,
        args::Chmod,
        args::StatFS,
        args::Stat,
        args::Link,
        args::Symlink,
        args::Readlink,
        args::Realpath,
        args::Unlink,
        args::RmDir,
        args::Mkdir,
        args::MkdirTemp,
        args::Readdir,
        args::Open,
        args::Write,
        args::Read,
        args::Exists,
        args::Access,
        args::CopyFile,
    );
    impl_fs_argument!(@fd
        args::Fchown, args::FChmod, args::Fstat, args::Close, args::Futimes,
        args::FdataSync, args::Fsync,
    );
    // `ReadFile`/`WriteFile` carry an `AbortSignal` field — opt them in so the
    // `const _ = assert!(…::HAVE_ABORT_SIGNAL)` invariants in `async_` hold and
    // `signal()` exposes it to `AsyncFSTask::run_from_js_thread`.
    impl FsArgument for args::ReadFile {
        const HAVE_ABORT_SIGNAL: bool = true;
        #[inline]
        fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            args::ReadFile::from_js(ctx, arguments)
        }
        #[inline]
        fn to_thread_safe(&mut self) {
            args::ReadFile::to_thread_safe(self)
        }
        #[inline]
        fn signal(&self) -> Option<&AbortSignal> {
            self.signal.as_deref()
        }
    }
    impl FsArgument for args::WriteFile {
        const HAVE_ABORT_SIGNAL: bool = true;
        #[inline]
        fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            args::WriteFile::from_js(ctx, arguments)
        }
        #[inline]
        fn to_thread_safe(&mut self) {
            args::WriteFile::to_thread_safe(self)
        }
        #[inline]
        fn signal(&self) -> Option<&AbortSignal> {
            self.signal.as_deref()
        }
    }

    /// Convert an async-FS result payload to a `JSValue`. Mirrors Zig's
    /// `globalObject.toJS(res)` (a generic `anytype` dispatcher that calls
    /// `res.toJSNewlyCreated(globalObject)` if it exists, else `res.toJS(...)`).
    /// Each `ret::*` type implements this by forwarding to its inherent method.
    pub trait FsReturn {
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue>;
    }
    impl FsReturn for JSValue {
        #[inline]
        fn fs_to_js(&mut self, _global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(*self)
        }
    }
    impl FsReturn for () {
        #[inline]
        fn fs_to_js(&mut self, _global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(JSValue::UNDEFINED)
        }
    }
    impl FsReturn for bool {
        #[inline]
        fn fs_to_js(&mut self, _global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(JSValue::js_boolean(*self))
        }
    }
    impl FsReturn for Null {
        #[inline]
        fn fs_to_js(&mut self, _global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(JSValue::NULL)
        }
    }
    impl FsReturn for Stats {
        #[inline]
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.to_js_newly_created(global)
        }
    }
    impl FsReturn for FD {
        #[inline]
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(crate::node::types::FdJsc::to_js(*self, global))
        }
    }
    impl FsReturn for ZigString {
        #[inline]
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(bun_jsc::ZigStringJsc::to_js(self, global))
        }
    }
    impl FsReturn for StringOrBuffer {
        #[inline]
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.to_js(global)
        }
    }
    impl FsReturn for StringOrUndefined {
        #[inline]
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.to_js(global)
        }
    }
    impl FsReturn for ret::Read {
        #[inline]
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(self.to_js(global))
        }
    }
    impl FsReturn for ret::Write {
        #[inline]
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(self.to_js(global))
        }
    }
    impl FsReturn for node::StatFS {
        #[inline]
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.to_js_newly_created(global)
        }
    }
    impl FsReturn for ret::Readdir {
        #[inline]
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
            // `Readdir::to_js` consumes by value (the boxed slices are handed to
            // JS). Swap in an empty `Files` payload so `&mut self` stays valid.
            let owned = core::mem::replace(self, ret::Readdir::Files(Box::default()));
            owned.to_js(global)
        }
    }
    impl FsReturn for StatOrNotFound {
        #[inline]
        fn fs_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.to_js_newly_created(global)
        }
    }

    /// `Taskable` glue so `ConcurrentTask::create_from(this)` resolves on the
    /// generic `AsyncFSTask<R, A, F>`. The Zig source mapped each instantiation to
    /// a distinct `task_tag::*` via the comptime type-name lookup; the const-
    /// generic `F` carries that information and `NodeFSFunctionEnum::task_tag()`
    /// is `const fn`, so the per-`F` tag is computed at monomorphisation time.
    impl<R, A: Unprotect, const F: NodeFSFunctionEnum> bun_event_loop::Taskable
        for AsyncFSTask<R, A, F>
    {
        const TAG: bun_event_loop::TaskTag = F.task_tag();
    }
    #[cfg(windows)]
    impl<R, A: Unprotect, const F: NodeFSFunctionEnum> bun_event_loop::Taskable
        for UVFSRequest<R, A, F>
    {
        const TAG: bun_event_loop::TaskTag = F.task_tag();
    }

    pub struct AsyncFSTask<R, A: Unprotect, const F: NodeFSFunctionEnum> {
        pub promise: JSPromiseStrong,
        /// Wrapped in [`ThreadSafe`] so the paired `unprotect()` runs on drop —
        /// replaces Zig's explicit `args.deinitAndUnprotect()` in `destroy()`.
        pub args: ThreadSafe<A>,
        pub global_object: bun_ptr::BackRef<JSGlobalObject>,
        pub task: WorkPoolTask,
        pub result: Maybe<R>,
        pub r#ref: KeepAlive,
        pub tracker: AsyncTaskTracker,
    }

    bun_threading::intrusive_work_task!([R, A: Unprotect, const F: NodeFSFunctionEnum] AsyncFSTask<R, A, F>, task);

    impl<R: FsReturn, A: FsArgument, const F: NodeFSFunctionEnum> AsyncFSTask<R, A, F>
    where
        Op<{ F }>: NodeFSDispatch<R, A>,
    {
        /// NewAsyncFSTask supports cancelable operations via AbortSignal,
        /// so long as a "signal" field exists. The task wrapper will ensure
        /// a promise rejection happens if signaled, but if `function` is
        /// already called, no guarantees are made. It is recommended for
        /// the functions to check .signal.aborted() for early returns.
        pub const HAVE_ABORT_SIGNAL: bool = A::HAVE_ABORT_SIGNAL;
        pub const HEAP_LABEL: &'static str = F.heap_label();

        /// Deref the raw `global_object` pointer.
        ///
        /// Invariant: set from a live `&JSGlobalObject` in `create()` and never
        /// null; the JSC global outlives every task (JSC_BORROW per LIFETIMES.tsv).
        /// Safe to call from the work-pool thread for `bun_vm_concurrently()`.
        #[inline]
        pub fn global_object(&self) -> &JSGlobalObject {
            self.global_object.get()
        }

        pub fn create(
            global_object: &JSGlobalObject,
            _binding: &Binding,
            args: A,
            vm: &mut VirtualMachine,
        ) -> JSValue {
            let mut task = Box::new(Self {
                promise: JSPromiseStrong::init(global_object),
                args: args.into_thread_safe(),
                // Sentinel — overwritten by `work_pool_callback` before any read on
                // the JS thread. `Maybe<R>` is `Result<R, sys::Error>` and may be
                // niche-optimised; never construct an all-zero `Result` value.
                result: Err(sys::Error::default()),
                global_object: bun_ptr::BackRef::new(global_object),
                task: work_pool_task(Self::work_pool_callback),
                r#ref: KeepAlive::default(),
                tracker: AsyncTaskTracker::init(vm),
            });
            // KeepAlive::ref_ now takes the type-erased aio EventLoopCtx; the JS
            // event loop is the only one that owns AsyncFSTask/UVFSRequest.
            task.r#ref.ref_(bun_io::js_vm_ctx());
            let _ = vm;
            task.tracker.did_schedule(global_object);
            let promise = task.promise.value();
            WorkPool::schedule(&raw mut bun_core::heap::release(task).task);
            promise
        }

        fn work_pool_callback(task: *mut WorkPoolTask) {
            // SAFETY: task points to Self.task
            let this = unsafe { &mut *Self::from_task_ptr(task) };

            let mut node_fs = NodeFS::default();
            this.result = NodeFS::dispatch::<R, A, F>(&mut node_fs, &this.args, Flavor::Async);
            // Zig clones `err` here so its `.path` outlives the stack `node_fs.sync_error_buf`
            // it borrowed from. In Rust `sys::Error::path` is `Box<[u8]>` boxed at the
            // `errno_sys_p` construction site, so no clone is needed — `node_fs` may drop.

            // `bun_vm_concurrently()` skips the JS-thread debug assert and is the
            // documented accessor for off-thread (work-pool) callers; the
            // event-loop's concurrent queue is MPSC-safe.
            let vm = this.global_object().bun_vm_concurrently();
            // SAFETY: VirtualMachine and its event loop are process-static
            // (LIFETIMES.tsv); the concurrent queue is MPSC-safe.
            unsafe {
                (*(*vm).event_loop()).enqueue_task_concurrent(ConcurrentTask::create_from(
                    std::ptr::from_mut::<Self>(this),
                ));
            }
        }

        pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JsTerminated> {
            // SAFETY: self was Box::leak'd in create(); destroy() runs exactly once on scope exit
            let _deinit = scopeguard::guard(std::ptr::from_mut::<Self>(self), |p| unsafe {
                Self::destroy(p)
            });
            // Move `result` out so the `global_object()` `&self` borrow can coexist
            // with `&mut result` below; the sentinel left behind is dropped in `destroy()`.
            let mut result = core::mem::replace(&mut self.result, Err(sys::Error::default()));
            let global_object = self.global_object();

            let _dispatch = self.tracker.dispatch(global_object);

            let success = matches!(result, Ok(_));
            let promise_value = self.promise.value();
            let promise = self.promise.get();
            let result = match &mut result {
                Err(err) => match err.to_js_with_async_stack(global_object, promise) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.reject(global_object, Ok(global_object.take_exception(e)));
                    }
                },
                Ok(res) => match FsReturn::fs_to_js(res, global_object) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.reject(global_object, Ok(global_object.take_exception(e)));
                    }
                },
            };
            promise_value.ensure_still_alive();

            if Self::HAVE_ABORT_SIGNAL {
                if let Some(signal) = self.args.signal() {
                    if let Some(reason) = signal.reason_if_aborted(global_object) {
                        return promise.reject(global_object, Ok(reason.to_js(global_object)));
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
            // Zig: `result.err.deinit()` — `bun_sys::Error` frees its path on Drop.
            // SAFETY: global_object outlives task; JSC_BORROW per LIFETIMES.tsv.
            // Zig passed `*VirtualMachine`; Rust's KeepAlive takes `EventLoopCtx`.
            this_ref.r#ref.unref(bun_io::js_vm_ctx());
            // `args: ThreadSafe<A>` unprotects + drops via `heap::take` below.
            this_ref.promise = JSPromiseStrong::default();
            // SAFETY: paired with Box::leak in create()
            drop(unsafe { bun_core::heap::take(this) });
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // AsyncCpTask
    // ──────────────────────────────────────────────────────────────────────────

    pub type AsyncCpTask = NewAsyncCpTask<false>;
    pub type ShellAsyncCpTask = NewAsyncCpTask<true>;

    // Zig path was `bun.shell.Interpreter.Builtin.Cp.ShellCpTask`. The Rust shell
    // port flattens builtins under `crate::shell::builtins::*`. The
    // `cp_on_copy`/`cp_on_finish` hooks are inherent methods on that type
    // (cp.rs), called directly below — no trait indirection.
    type ShellCpTask = crate::shell::builtins::cp::ShellCpTask;

    pub struct NewAsyncCpTask<const IS_SHELL: bool> {
        pub promise: JSPromiseStrong,
        /// Wrapped in [`ThreadSafe`] so the paired `unprotect()` runs on drop.
        pub args: ThreadSafe<args::Cp>,
        pub evtloop: EventLoopHandle,
        pub task: WorkPoolTask,
        /// Written from any workpool thread (first `finish_concurrently` caller wins via
        /// `has_result` CAS); read on the JS thread in `run_from_js_thread`. Wrapped in
        /// `Cell` so concurrent subtasks can hold `&Self` and `.set()` without aliased
        /// `&mut`. Cross-thread soundness is provided by the `has_result` CAS (single
        /// writer) + `subtask_count` AcqRel fence (happens-before for the JS-thread
        /// read), not by `Cell` itself — `Cell` is `repr(transparent)` over
        /// `UnsafeCell` and `set()` is exactly the prior `*ptr = val` open-coded.
        pub result: core::cell::Cell<Maybe<ret::Cp>>,
        /// If this task is called by the shell then we shouldn't call this as
        /// it is not threadsafe and is unnecessary as the process will be kept
        /// alive by the shell instance.
        // PORT NOTE: Zig made the field conditional via `if (!is_shell) … else void`.
        // Rust keeps the field unconditionally and simply skips `ref_()`/`unref()`
        // on the `IS_SHELL` path (`KeepAlive::default()` is inert until ref'd).
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
        /// BACKREF — `Some` iff `IS_SHELL`. The shell `ShellCpTask` owns and
        /// outlives this task; `ParentRef` gives a safe `&ShellCpTask` projection
        /// for `cp_on_copy` and round-trips the `*mut` for `cp_on_finish`.
        pub shelltask: Option<bun_ptr::ParentRef<ShellCpTask>>,
    }

    bun_threading::intrusive_work_task!([const IS_SHELL: bool] NewAsyncCpTask<IS_SHELL>, task);

    /// This task is used by `AsyncCpTask/fs.promises.cp` to copy a single file.
    /// When clonefile cannot be used, this task is started once per file.
    pub struct CpSingleTask<const IS_SHELL: bool> {
        /// BACKREF — the parent `NewAsyncCpTask` is `Box::leak`'d and outlives every
        /// subtask via the `subtask_count` refcount (see `on_subtask_done`). Stored
        /// as `ParentRef` (constructed from the `*mut` with `Box::leak` provenance)
        /// so shared reads are safe-projected and `as_mut_ptr()` round-trips the
        /// original write provenance for `on_subtask_done`'s `&mut` promotion.
        pub cp_task: bun_ptr::ParentRef<NewAsyncCpTask<IS_SHELL>>,
        /// Single owned allocation laid out as `<src>\0<dest>\0`. Zig stores two
        /// `bun.OSPathSliceZ` (sentinel slices) into a single `default_allocator`
        /// buffer; here ownership is encoded directly as `Box<[OSPathChar]>` and
        /// the two NUL-terminated views are reconstructed via `src()` / `dest()`.
        path_buf: Box<[OSPathChar]>,
        src_len: usize,
        dest_len: usize,
        pub task: WorkPoolTask,
    }

    bun_threading::owned_task!([const IS_SHELL: bool] CpSingleTask<IS_SHELL>, task);

    impl<const IS_SHELL: bool> CpSingleTask<IS_SHELL> {
        /// `path_buf` layout: `[src @ ..src_len][0][dest @ ..dest_len][0]`.
        pub fn create(
            parent: *mut NewAsyncCpTask<IS_SHELL>,
            path_buf: Box<[OSPathChar]>,
            src_len: usize,
            dest_len: usize,
        ) {
            debug_assert_eq!(path_buf.len(), src_len + 1 + dest_len + 1);
            debug_assert_eq!(path_buf[src_len], 0);
            debug_assert_eq!(path_buf[src_len + 1 + dest_len], 0);
            WorkPool::schedule_new(CpSingleTask {
                // `parent` is the `Box::leak`'d task — never null; `NonNull → ParentRef`
                // preserves the mutable provenance for `on_subtask_done`.
                cp_task: bun_ptr::ParentRef::from(
                    core::ptr::NonNull::new(parent).expect("cp parent"),
                ),
                path_buf,
                src_len,
                dest_len,
                task: WorkPoolTask::default(),
            });
        }

        #[inline]
        fn src(&self) -> &OSPathSliceZ {
            // `create()` invariant — `path_buf[src_len] == 0` (debug-asserted there
            // and again by `from_buf`).
            OSPathSliceZ::from_buf(&self.path_buf, self.src_len)
        }
        #[inline]
        fn dest(&self) -> &OSPathSliceZ {
            // `create()` invariant — `path_buf[src_len + 1 + dest_len] == 0`
            // (debug-asserted there and again by `from_buf`).
            OSPathSliceZ::from_buf(&self.path_buf[self.src_len + 1..], self.dest_len)
        }

        fn run_owned(self: Box<Self>) {
            // `ParentRef` preserves the `Box::leak` mutable provenance so
            // `on_subtask_done` may later promote it to `&mut` via `as_mut_ptr()`
            // once the refcount reaches zero.
            let cp_task = self.cp_task;
            // Shared borrow only — other workpool threads (and the directory-scan
            // thread) may hold `&Self` to the same parent concurrently; `ParentRef`
            // invariant: the parent outlives all subtasks (subtask_count refcount).
            let parent = cp_task.get();

            // TODO: error strings on node_fs will die
            let mut node_fs = NodeFS::default();

            let args = &parent.args;
            let result = node_fs._copy_single_file_sync(
                self.src(),
                self.dest(),
                constants::Copyfile::from_raw(if args.flags.error_on_exist || !args.flags.force {
                    constants::COPYFILE_EXCL
                } else {
                    0i32
                }),
                None,
                &parent.args,
            );

            'brk: {
                match result {
                    Err(ref err) => {
                        if err.errno == E::EEXIST as _ && !args.flags.error_on_exist {
                            break 'brk;
                        }
                        parent.finish_concurrently(result);
                    }
                    Ok(_) => {
                        parent.on_copy(self.src(), self.dest());
                    }
                }
            }

            // `self: Box<Self>` drops here (frees the owned `path_buf`).
            drop(self);
            // Must be the very last use of the parent: when the count reaches
            // zero, runFromJSThread is enqueued and may destroy the parent.
            NewAsyncCpTask::on_subtask_done(cp_task.as_mut_ptr());
        }
    }

    impl<const IS_SHELL: bool> NewAsyncCpTask<IS_SHELL> {
        pub fn on_copy(&self, src: impl AsRef<[OSPathChar]>, dest: impl AsRef<[OSPathChar]>) {
            if !IS_SHELL {
                return;
            }
            // When IS_SHELL, `shelltask` is `Some` (ParentRef invariant: owner
            // outlives this task). Shared borrow only — concurrent subtasks may
            // call this in parallel; `cp_on_copy` serialises via its internal mutex.
            self.shelltask
                .expect("IS_SHELL ⇒ shelltask")
                .cp_on_copy(src.as_ref(), dest.as_ref());
        }

        pub fn on_finish(&mut self, result: Maybe<ret::Cp>) {
            if !IS_SHELL {
                return;
            }
            let shelltask = self.shelltask.expect("IS_SHELL ⇒ shelltask").as_mut_ptr();
            // SAFETY: when IS_SHELL, shelltask is non-null and outlives this task;
            // `cp_on_finish` enqueues it onto the main-thread concurrent queue.
            unsafe { ShellCpTask::cp_on_finish(shelltask, result) };
        }

        pub fn create(
            global_object: &JSGlobalObject,
            _binding: &Binding,
            cp_args: args::Cp,
            vm: &mut VirtualMachine,
        ) -> JSValue {
            let task = Self::create_with_shell_task(
                global_object,
                cp_args,
                vm,
                core::ptr::null_mut(),
                true,
            );
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
                promise: if enable_promise {
                    JSPromiseStrong::init(global_object)
                } else {
                    JSPromiseStrong::default()
                },
                args: cp_args.into_thread_safe(),
                has_result: AtomicBool::new(false),
                // Sentinel — overwritten by `finish_concurrently` (gated by the
                // `has_result` CAS) before any read on the JS thread.
                result: core::cell::Cell::new(Ok(())),
                evtloop: EventLoopHandle::init(vm.event_loop.cast()),
                task: work_pool_task(Self::work_pool_callback),
                r#ref: KeepAlive::default(),
                tracker: AsyncTaskTracker::init(vm),
                subtask_count: AtomicUsize::new(1),
                shelltask: core::ptr::NonNull::new(shelltask).map(bun_ptr::ParentRef::from),
            });
            if !IS_SHELL {
                task.r#ref.ref_(event_loop_handle_to_ctx(task.evtloop));
            }
            task.tracker.did_schedule(global_object);

            let raw = bun_core::heap::release(task);
            WorkPool::schedule(&raw mut raw.task);
            raw
        }

        pub fn create_mini(
            cp_args: args::Cp,
            // PORT NOTE: `EventLoopHandle::Mini` stores `*mut MiniEventLoop<'static>` (a
            // non-owning erased backref, see `bun_event_loop::AnyEventLoop`). Taking the
            // raw pointer here avoids forcing every caller's `MiniEventLoop` borrow to be
            // `'static` — Zig passed `*MiniEventLoop` and the task never outlives it.
            mini: *mut MiniEventLoop<'static>,
            shelltask: *mut ShellCpTask,
        ) -> *mut Self {
            let mut task = Box::new(Self {
                promise: JSPromiseStrong::default(),
                args: cp_args.into_thread_safe(),
                has_result: AtomicBool::new(false),
                // Sentinel — overwritten by `finish_concurrently` (gated by the
                // `has_result` CAS) before any read on the JS thread.
                result: core::cell::Cell::new(Ok(())),
                evtloop: EventLoopHandle::init_mini(mini),
                task: work_pool_task(Self::work_pool_callback),
                r#ref: KeepAlive::default(),
                tracker: AsyncTaskTracker { id: 0 },
                subtask_count: AtomicUsize::new(1),
                shelltask: core::ptr::NonNull::new(shelltask).map(bun_ptr::ParentRef::from),
            });
            if !IS_SHELL {
                task.r#ref.ref_(event_loop_handle_to_ctx(task.evtloop));
            }

            let raw = bun_core::heap::release(task);
            WorkPool::schedule(&raw mut raw.task);
            raw
        }

        fn work_pool_callback(task: *mut WorkPoolTask) {
            // SAFETY: task points to Self.task. Kept as a raw pointer — `cp_async`
            // may spawn subtasks that hold `&Self` to the same allocation while
            // this call is still on the stack, so we must not form `&mut Self` here.
            let this = unsafe { Self::from_task_ptr(task) };
            let mut node_fs = NodeFS::default();
            Self::cp_async(&mut node_fs, this);
        }

        /// May be called from any thread (the subtasks).
        /// Records the result (first caller wins). Does NOT schedule destruction —
        /// `runFromJSThread` is only enqueued from `onSubtaskDone` once every
        /// in-flight subtask has dropped its reference, so that subtasks still
        /// running on the thread pool don't dereference a freed parent.
        fn finish_concurrently(&self, result: Maybe<ret::Cp>) {
            if self
                .has_result
                .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
                .is_err()
            {
                return;
            }
            // The CAS above guarantees exactly one thread reaches this write; the
            // `subtask_count` AcqRel fence in `on_subtask_done` publishes it to the
            // JS-thread reader. (Zig clones `err.path` here to outlive the caller's
            // stack buffer; in Rust `sys::Error::path` is already `Box<[u8]>`, so
            // move-assign suffices.)
            self.result.set(result);
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
            if old_count != 1 {
                return;
            }

            // All subtasks have finished. If none reported an error, the copy succeeded.
            if !this_ref.has_result.load(Ordering::Relaxed) {
                this_ref.has_result.store(true, Ordering::Relaxed);
                // count reached zero ⇒ this thread now has exclusive access.
                this_ref.result.set(Ok(()));
            }

            // Count reached zero ⇒ exclusive access. `this` carries mutable
            // provenance from `Box::leak`, so the enqueued callback may safely
            // form `&mut *this` on the JS thread.
            if matches!(this_ref.evtloop, EventLoopHandle::Js { .. }) {
                // PORT NOTE: `ConcurrentTask::from_callback` expects `fn(*mut T) -> JsResult<()>`;
                // Zig accepted `fn(*T) JSError!void` directly. Adapt the signature inline.
                this_ref.evtloop.enqueue_task_concurrent(EventLoopTaskPtr {
                    js: ConcurrentTask::from_callback(this, |p| unsafe {
                        (&mut *p).run_from_js_thread().map_err(Into::into)
                    }),
                });
            } else {
                this_ref.evtloop.enqueue_task_concurrent(EventLoopTaskPtr {
                    mini: AnyTaskWithExtraContext::from_callback_auto_deinit(
                        this,
                        |p: *mut Self, ctx| unsafe { (*p).run_from_js_thread_mini(ctx) },
                    ),
                });
            }
        }

        pub fn run_from_js_thread_mini(&mut self, _: *mut c_void) {
            let _ = self.run_from_js_thread(); // TODO: properly propagate exception upwards
        }

        fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JsTerminated> {
            if IS_SHELL {
                // SAFETY: shelltask is set by create_with_shell_task/create_mini and outlives this task
                // Move the result out — `Maybe<ret::Cp>` (= `Maybe<()>`) has a cheap
                // `Ok(())` placeholder, mirroring Zig which read the union value once.
                let result = core::mem::replace(self.result.get_mut(), Ok(()));
                let shelltask = self.shelltask.expect("IS_SHELL ⇒ shelltask").as_mut_ptr();
                // SAFETY: shelltask is non-null in the IS_SHELL specialization and
                // outlives this task; `cp_on_finish` enqueues it concurrently.
                unsafe { ShellCpTask::cp_on_finish(shelltask, result) };
                // SAFETY: self was Box::leak'd in create*(); destroyed exactly once here
                unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };
                return Ok(());
            }
            let go_ptr = self.evtloop.global_object();
            if go_ptr.is_null() {
                panic!(
                    "No global object, this indicates a bug in Bun. Please file a GitHub issue."
                );
            }
            // SAFETY: non-null erased *mut JSGlobalObject from the JS event loop vtable.
            let global_object: &JSGlobalObject = unsafe { &*go_ptr.cast::<JSGlobalObject>() };
            let success = matches!(*self.result.get_mut(), Ok(_));
            let promise_value = self.promise.value();
            // Captured as a raw pointer because `Self::destroy(self)` runs *before* the
            // resolve/reject (matching Zig). The `JSPromise` itself lives on the JS heap
            // and is kept alive past `destroy` by `promise_value.ensure_still_alive()`.
            let promise: *mut bun_jsc::JSPromise = self.promise.get();
            let result = match self.result.get_mut() {
                // SAFETY: `promise` is the sole live reference to the heap `JSPromise`.
                Err(err) => match err.to_js_with_async_stack(global_object, unsafe { &*promise }) {
                    Ok(v) => v,
                    Err(e) => {
                        return unsafe { &mut *promise }
                            .reject(global_object, Ok(global_object.take_exception(e)));
                    }
                },
                Ok(res) => match FsReturn::fs_to_js(res, global_object) {
                    Ok(v) => v,
                    Err(e) => {
                        return unsafe { &mut *promise }
                            .reject(global_object, Ok(global_object.take_exception(e)));
                    }
                },
            };
            promise_value.ensure_still_alive();

            let _dispatch = self.tracker.dispatch(global_object);

            // SAFETY: self was Box::leak'd in create*(); destroyed exactly once here
            unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };
            // SAFETY: `promise` points at a GC-rooted JS heap cell (see above), still
            // valid after `destroy` dropped only the `Strong` wrapper.
            let promise = unsafe { &mut *promise };
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
            // owns `Box<[u8]>` and frees on Drop (in `heap::take` below).
            if !IS_SHELL {
                this_ref
                    .r#ref
                    .unref(event_loop_handle_to_ctx(this_ref.evtloop));
            }
            // `args.deinit()` → `Drop` on `args::Cp` (via `heap::take` below).
            // PORT NOTE: intentional spec divergence — Zig `NewAsyncCpTask.deinit` only
            // calls `args.deinit()` (no-op for `.buffer`), leaking the `protect()` taken by
            // `args.toThreadSafe()` when `src`/`dest` are Buffers. `Drop for ThreadSafe<args::Cp>`
            // releases that protect here, fixing the leak.
            this_ref.promise = JSPromiseStrong::default();
            // SAFETY: paired with Box::leak in create_with_shell_task()/create_mini()
            drop(unsafe { bun_core::heap::take(this) });
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
                    this.finish_concurrently(Err(sys::Error {
                        errno: SystemErrno::ENOENT as _,
                        syscall: sys::Tag::copyfile,
                        path: nodefs.os_path_into_sync_error_buf(src).into(),
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
                            // Shell always forces copy (overwrite allowed). Spec
                            // (node_fs.zig:758) passes `Copyfile.force` here, but
                            // that value is `COPYFILE_FICLONE_FORCE` and was a
                            // no-op in Zig's Windows `_copySingleFileSync` (which
                            // never checks `isForceClone`). The Rust port added an
                            // ENOSYS guard for `is_force_clone()` on Windows (see
                            // the comment at the top of that branch), so passing
                            // `FORCE` would make every shell `cp file dest` fail
                            // with ENOSYS. Mode `0` yields the same effective
                            // behaviour the Zig path had: `shouldnt_overwrite()`
                            // is false and `CopyFileW` overwrites.
                            constants::Copyfile::from_raw(0)
                        } else {
                            constants::Copyfile::from_raw(
                                if args.flags.error_on_exist || !args.flags.force {
                                    constants::COPYFILE_EXCL
                                } else {
                                    0i32
                                },
                            )
                        },
                        Some(attributes),
                        &this.args,
                    );
                    if let Err(e) = &r {
                        if e.errno == E::EEXIST as _ && !args.flags.error_on_exist {
                            this.finish_concurrently(Ok(()));
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
                    Ok(result) => result,
                    Err(err) => {
                        nodefs.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                        this.finish_concurrently(Err(
                            err.with_path(&nodefs.sync_error_buf[..src.len()])
                        ));
                        return;
                    }
                };

                if !sys::S::ISDIR(stat_.st_mode as _) {
                    // This is the only file, there is no point in dispatching subtasks
                    let r = nodefs._copy_single_file_sync(
                        src,
                        dest,
                        constants::Copyfile::from_raw(
                            if args.flags.error_on_exist || !args.flags.force {
                                constants::COPYFILE_EXCL
                            } else {
                                0i32
                            },
                        ),
                        Some(stat_),
                        &this.args,
                    );
                    if let Err(e) = &r {
                        if e.errno == E::EEXIST as _ && !args.flags.error_on_exist {
                            this.on_copy(src, dest);
                            this.finish_concurrently(Ok(()));
                            return;
                        }
                    }
                    this.on_copy(src, dest);
                    this.finish_concurrently(r);
                    return;
                }
            }
            if !args.flags.recursive {
                this.finish_concurrently(Err(sys::Error {
                    errno: E::EISDIR as _,
                    syscall: sys::Tag::copyfile,
                    path: nodefs.os_path_into_sync_error_buf(src).into(),
                    ..Default::default()
                }));
                return;
            }

            // Capture lengths *before* re-borrowing the path buffers — `src`/`dest`
            // are slices into `src_buf`/`dest_buf` and must end their borrow first.
            let src_len = PathInt::try_from(src.len()).expect("int cast");
            let dest_len = PathInt::try_from(dest.len()).expect("int cast");
            let _ = Self::_cp_async_directory(
                nodefs,
                args.flags,
                // Pass the raw `*mut Self` (Box::leak provenance) so spawned
                // `CpSingleTask`s store a pointer that may later be promoted to
                // `&mut` in `on_subtask_done`.
                *_done,
                &mut src_buf,
                src_len,
                &mut dest_buf,
                dest_len,
            );
        }

        // returns boolean `should_continue`
        pub(super) fn _cp_async_directory(
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
            // SAFETY: callers NUL-terminate at src_dir_len/dest_dir_len before calling.
            // Platform-generic — `OSPathBuffer` is `[u16;N]` on Windows, `[u8;N]` on POSIX,
            // so reconstruct as `&OSPathSliceZ` (Zig: `src_buf[0..src_dir_len :0]`).
            let src = unsafe { OSPathSliceZ::from_raw(src_buf.as_ptr(), src_dir_len as usize) };
            // SAFETY: dest_buf[dest_dir_len] == 0 written by caller
            let dest = unsafe { OSPathSliceZ::from_raw(dest_buf.as_ptr(), dest_dir_len as usize) };

            #[cfg(target_os = "macos")]
            {
                if let Some(err) = Maybe::<ret::Cp>::errno_sys_p(
                    bun_sys::c::clonefile_rc(src, dest, 0),
                    sys::Tag::clonefile,
                    src.as_bytes(),
                ) {
                    match err.get_errno() {
                        E::EACCES | E::ENAMETOOLONG | E::EROFS | E::EPERM | E::EINVAL => {
                            // Zig copies `src` into `sync_error_buf` and `.withPath()`s it so
                            // the borrowed slice outlives the stack frame. `errno_sys_p`
                            // already boxed `src.as_bytes()` into `err.path`, so just forward.
                            this_ref.finish_concurrently(err);
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
                Err(err) => {
                    this_ref.finish_concurrently(Err(
                        err.with_path(nodefs.os_path_into_sync_error_buf(src))
                    ));
                    return false;
                }
                Ok(fd_) => fd_,
            };
            let _close = scopeguard::guard(fd, |fd| fd.close());

            let mut buf = OSPathBuffer::uninit();
            #[cfg(windows)]
            let normdest: &OSPathSliceZ = match sys::normalize_path_windows_opts(
                FD::INVALID,
                dest.as_slice(),
                &mut buf[..],
                // node_fs.zig:861 `.{ .add_nt_prefix = false }` — `normdest` feeds
                // `mkdirRecursiveOSPath` / `CopyFileW` which expect Win32 paths,
                // not `\??\` NT object paths.
                sys::NormalizePathWindowsOpts {
                    add_nt_prefix: false,
                },
            ) {
                Err(err) => {
                    this_ref.finish_concurrently(Err(err));
                    return false;
                }
                Ok(n) => n,
            };
            #[cfg(not(windows))]
            let normdest: &OSPathSliceZ = {
                let _ = &buf;
                dest
            };

            let mkdir_ = nodefs.mkdir_recursive_os_path(normdest, args::Mkdir::DEFAULT_MODE, false);
            match mkdir_ {
                Err(err) => {
                    this_ref.finish_concurrently(Err(err));
                    return false;
                }
                Ok(_) => {
                    this_ref.on_copy(src, normdest);
                }
            }

            // PORT NOTE: `DirIterator.iterate(dir, kind)` (Zig runtime arg) maps to a
            // const-generic `PathType` in the Rust port. On POSIX directory entries
            // are always UTF-8, so monomorphise on `PathType::U8` and let the
            // Windows branch (gated above) handle the wide path.
            #[cfg(windows)]
            let mut iterator = DirIterator::iterate::<true>(fd);
            #[cfg(not(windows))]
            let mut iterator = DirIterator::iterate::<false>(fd);
            let mut entry = iterator.next();
            loop {
                let current = match entry {
                    Err(err) => {
                        this_ref.finish_concurrently(Err(
                            err.with_path(nodefs.os_path_into_sync_error_buf(src))
                        ));
                        return false;
                    }
                    Ok(ent) => match ent {
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
                    this_ref.finish_concurrently(Err(sys::Error {
                        errno: E::ENAMETOOLONG as _,
                        syscall: sys::Tag::copyfile,
                        path: nodefs
                            .os_path_into_sync_error_buf(&src_buf[..src_dir_len as usize])
                            .into(),
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
                            nodefs,
                            args,
                            this,
                            src_buf,
                            (sd + 1 + cname.len()) as PathInt,
                            dest_buf,
                            (dd + 1 + cname.len()) as PathInt,
                        );
                        if !should_continue {
                            return false;
                        }
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
                        path_buf[dest_off + dd + 1..dest_off + dd + 1 + cname.len()]
                            .copy_from_slice(cname);
                        path_buf[dest_off + dd + 1 + cname.len()] = 0;

                        CpSingleTask::<IS_SHELL>::create(
                            this,
                            path_buf,
                            sd + 1 + cname.len(),
                            dd + 1 + cname.len(),
                        );
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
        /// Wrapped in [`ThreadSafe`] so the paired `unprotect()` runs on drop.
        pub args: ThreadSafe<args::Readdir>,
        pub global_object: bun_ptr::BackRef<JSGlobalObject>,
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

    bun_threading::intrusive_work_task!(AsyncReaddirRecursiveTask, task);

    pub enum ResultListEntryValue {
        WithFileTypes(Vec<Dirent>),
        Buffers(Vec<Buffer>),
        Files(Vec<BunString>),
    }

    impl ResultListEntryValue {
        pub fn deinit(&mut self) {
            match self {
                ResultListEntryValue::WithFileTypes(res) => {
                    for item in res.iter() {
                        item.deref();
                    }
                    res.clear();
                }
                ResultListEntryValue::Buffers(res) => {
                    // Zig: `bun.default_allocator.free(item.buffer.byteSlice())`.
                    // `MarkedArrayBuffer::destroy` frees the owned byte slice when
                    // `owns_buffer` (set by `Buffer::from_string` in
                    // `ReaddirEntry::append_entry*`).
                    for item in res.iter_mut() {
                        item.destroy();
                    }
                    res.clear();
                }
                ResultListEntryValue::Files(res) => {
                    for item in res.iter() {
                        item.deref();
                    }
                    res.clear();
                }
            }
        }
    }

    pub struct ResultListEntry {
        pub next: bun_threading::Link<ResultListEntry>, // INTRUSIVE: UnboundedQueue link
        pub value: ResultListEntryValue,
    }

    // SAFETY: all four accessors route through the same `next` field; the atomic
    // variants reinterpret it in-place as `AtomicPtr<Self>` (identical layout/
    // alignment to `*mut Self`). `UnboundedQueue` only ever calls these with a
    // live, properly aligned `*mut ResultListEntry` it previously had pushed.
    unsafe impl bun_threading::Linked for ResultListEntry {
        #[inline]
        unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
            // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
            unsafe { core::ptr::addr_of!((*item).next) }
        }
    }

    pub struct ReaddirSubtask {
        pub readdir_task: bun_ptr::ParentRef<AsyncReaddirRecursiveTask>,
        pub basename: PathString,
        pub task: WorkPoolTask,
    }

    bun_threading::owned_task!(ReaddirSubtask, task);

    impl ReaddirSubtask {
        fn run_owned(self: Box<Self>) {
            let ReaddirSubtask {
                readdir_task,
                basename,
                task: _,
            } = *self;
            // basename was allocated as `Box<[u8]>` of len+1 (NUL included) in
            // enqueue(); reconstruct that exact layout for drop on scope exit.
            let basename = scopeguard::guard(basename, |basename| {
                let z = basename.slice_assume_z();
                let len_with_nul = z.len() + 1;
                let ptr = z.as_bytes().as_ptr().cast_mut();
                // SAFETY: paired with the `Box::leak(owned.into_boxed_slice())` in
                // `AsyncReaddirRecursiveTask::enqueue`; same (ptr, len) layout,
                // reconstructed exactly once. Build the `*mut [u8]` fat pointer
                // safely — no need to materialize an intermediate `&mut` reference.
                unsafe {
                    drop(Box::<[u8]>::from_raw(core::ptr::slice_from_raw_parts_mut(
                        ptr,
                        len_with_nul,
                    )));
                }
            });
            let mut buf = PathBuffer::uninit();
            // SAFETY: readdir_task (ParentRef) outlives subtask via subtask_count
            // refcount. `from_raw_mut` was used at enqueue, so write provenance is
            // present; this work-pool callback is the sole holder of `&mut` to the
            // parent's per-result fields (it pushes to a lock-free queue).
            unsafe { readdir_task.assume_mut() }.perform_work(
                basename.slice_assume_z(),
                &mut buf,
                false,
            );
        }
    }

    impl AsyncReaddirRecursiveTask {
        pub fn new(init: Self) -> Box<Self> {
            Box::new(init)
        }

        /// Borrow the owning `JSGlobalObject`.
        ///
        /// SAFETY: `global_object` is set from a live `&JSGlobalObject` in
        /// `create()` (never null) and the JSC_BORROW invariant (LIFETIMES.tsv)
        /// guarantees the global outlives every task it spawns. The pointee is a
        /// pinned JSC heap object; `bun_vm_concurrently()` is the only method we
        /// call off-thread and it reads init-immutable state, so a shared borrow
        /// is sound from both the JS thread and the work pool.
        #[inline]
        pub fn global_object(&self) -> &JSGlobalObject {
            self.global_object.get()
        }

        /// `bun.default_allocator.free(this.root_path.slice())` — paired with the
        /// `dupeZ` in `create()`. Idempotent (`PathString::EMPTY` after first call).
        fn free_root_path(&mut self) {
            let rp = core::mem::replace(&mut self.root_path, PathString::EMPTY);
            let bytes = rp.slice();
            if bytes.is_empty() {
                return;
            }
            // SAFETY: `bytes.as_ptr()` is the start of a `Box<[u8]>` allocation of
            // `bytes.len() + 1` (NUL) made in `create()`; reconstructed exactly once.
            // Build the `*mut [u8]` fat pointer safely — no intermediate `&mut` ref.
            unsafe {
                drop(Box::<[u8]>::from_raw(core::ptr::slice_from_raw_parts_mut(
                    bytes.as_ptr().cast_mut(),
                    bytes.len() + 1,
                )));
            }
        }

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
            // Leak the boxed `[bytes.., 0]` allocation; the Box<[u8]> backing is
            // reconstructed and freed in `ReaddirSubtask::run_owned`.
            let leaked: &'static mut [u8] = Box::leak(owned);
            let basename_ps = PathString::init(&leaked[..len]);
            // Spec (node_fs.zig:1061) `bun.assert(subtask_count.fetchAdd(1, .monotonic) > 0)`
            // — the fetch_add is load-bearing (refcounts the in-flight subtask). It
            // MUST run in release builds; only the `> 0` invariant check is debug-only.
            let prev = self.subtask_count.fetch_add(1, Ordering::Relaxed);
            debug_assert!(prev > 0);
            WorkPool::schedule_new(ReaddirSubtask {
                // SAFETY: `self` is a `Box<AsyncReaddirRecursiveTask>` (stable
                // address) and outlives every subtask via the `subtask_count`
                // refcount it just bumped. Write provenance from `&mut self`.
                readdir_task: unsafe {
                    bun_ptr::ParentRef::from_raw_mut(core::ptr::from_mut(self))
                },
                basename: basename_ps,
                task: WorkPoolTask::default(),
            });
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
            // Zig: `bun.default_allocator.dupeZ(u8, args.path.slice())`. The
            // subtasks call `root_path.slice_assume_z()` from the work pool after
            // `args.to_thread_safe()` may have rehomed the original slice, so we
            // must own a NUL-terminated copy. Freed in `finish_concurrently()` or
            // `destroy()` via `free_root_path()`.
            let root_path = {
                let src = args.path.slice();
                let mut owned = Vec::with_capacity(src.len() + 1);
                owned.extend_from_slice(src);
                owned.push(0);
                let len = src.len();
                // Leak the boxed `[bytes.., 0]` allocation; reconstructed and freed
                // in `free_root_path()`.
                let leaked: &'static mut [u8] = Box::leak(owned.into_boxed_slice());
                PathString::init(&leaked[..len])
            };
            let mut task = Self::new(AsyncReaddirRecursiveTask {
                promise: JSPromiseStrong::init(global_object),
                args: FsArgument::into_thread_safe(args),
                has_result: AtomicBool::new(false),
                global_object: bun_ptr::BackRef::new(global_object),
                task: work_pool_task(Self::work_pool_callback),
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
            task.r#ref.ref_(bun_io::js_vm_ctx());
            task.tracker.did_schedule(global_object);
            let promise = task.promise.value();
            WorkPool::schedule(&raw mut bun_core::heap::release(task).task);
            promise
        }

        pub fn perform_work(&mut self, basename: &ZStr, buf: &mut PathBuffer, is_root: bool) {
            // PERF(port): was comptime monomorphization on tag — runtime match here
            // SAFETY: `readdir_with_entries_recursive_async` takes `args` and
            // `async_task` separately even though `args == &async_task.args`. The
            // callee never mutates `args` (only `async_task.{root_fd, enqueue}`),
            // so erase the field borrow through a raw pointer to satisfy borrowck —
            // mirrors the Zig spec, which passed both freely.
            let args_ptr: *const args::Readdir = &raw const *self.args;
            macro_rules! impl_tag {
                ($T:ty, $variant:ident) => {{
                    // Zig: `var stack = std.heap.stackFallback(8192, …)` — the
                    // first ~8 KiB of entries lived on the stack so small
                    // directories (the common case) never touched the heap until
                    // `writeResults` cloned with exact capacity. `Vec::new()` here
                    // instead grew through every power-of-two size class on the
                    // heap; under mimalloc-debug each fresh-page realloc runs
                    // `mi_mem_is_zero` over the whole arena page, which dominated
                    // the recursive-readdir perf profile (~15% self-time).
                    // Pre-reserve the same 8 KiB budget so we take a single
                    // size-class allocation per subtask.
                    let mut entries: Vec<$T> =
                        Vec::with_capacity(8192usize / core::mem::size_of::<$T>());
                    let res = NodeFS::readdir_with_entries_recursive_async::<$T>(
                        buf,
                        unsafe { &*args_ptr },
                        self,
                        basename,
                        &mut entries,
                        is_root,
                    );
                    match res {
                        Err(err) => {
                            for item in &mut entries {
                                <$T as ReaddirEntry>::destroy_entry(item);
                            }
                            {
                                let _lock = self.pending_err_mutex.lock();
                                if self.pending_err.is_none() {
                                    let err_path: &[u8] = if !err.path.is_empty() {
                                        &err.path[..]
                                    } else {
                                        self.args.path.slice()
                                    };
                                    self.pending_err = Some(err.with_path(err_path));
                                }
                            }
                            if self.subtask_count.fetch_sub(1, Ordering::Relaxed) == 1 {
                                self.finish_concurrently();
                            }
                        }
                        Ok(()) => {
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
            // SAFETY: task points to Self.task
            let this = unsafe { &mut *Self::from_task_ptr(task) };
            let mut buf = PathBuffer::uninit();
            let root_path = this.root_path;
            this.perform_work(root_path.slice_assume_z(), &mut buf, true);
        }

        pub fn write_results<T: IntoResultListEntry>(&mut self, result: &mut Vec<T>) {
            if !result.is_empty() {
                // Zig cloned because `result` was backed by a stack-fallback
                // allocator and could not outlive `perform_work`'s frame. In Rust
                // `result` is already a heap `Vec`, so cloning is a redundant
                // alloc+memcpy; just take ownership and trim the over-reservation
                // from `perform_work` so the queued entry holds exact capacity
                // (matches Zig's `initCapacity(len)` semantics).
                let mut clone: Vec<T> = core::mem::take(result);
                clone.shrink_to_fit();
                self.result_list_count
                    .fetch_add(clone.len(), Ordering::Relaxed);
                // Zig `@unionInit(Value, @tagName(Field), clone)` →
                // `IntoResultListEntry::into_variant` (trait dispatch on `T`).
                let list = Box::new(ResultListEntry {
                    next: bun_threading::Link::new(),
                    value: ResultListEntryValue::from_vec(clone),
                });
                self.result_list_queue.push(bun_core::heap::into_raw(list));
            }

            if self.subtask_count.fetch_sub(1, Ordering::Relaxed) == 1 {
                self.finish_concurrently();
            }
        }

        /// May be called from any thread (the subtasks)
        pub fn finish_concurrently(&mut self) {
            if self
                .has_result
                .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
                .is_err()
            {
                return;
            }
            debug_assert!(self.subtask_count.load(Ordering::Relaxed) == 0);

            let root_fd = self.root_fd;
            if root_fd != FD::INVALID {
                use bun_sys::FdExt as _;
                self.root_fd = FD::INVALID;
                root_fd.close();
                self.free_root_path();
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

                // Zig: `inline else => |tag| { var results = &@field(result_list, @tagName(tag));
                // results.ensureTotalCapacityPrecise(count); … results.appendSliceAssumeCapacity(field) }`.
                // `reserve_exact`/`append_from` dispatch on the runtime tag.
                let cap = self.result_list_count.swap(0, Ordering::Relaxed);
                self.result_list.reserve_exact(cap);
                loop {
                    let val = iter.next();
                    if val.is_null() {
                        break;
                    }
                    if let Some(dest) = to_destroy {
                        // SAFETY: paired with heap::alloc in write_results()
                        unsafe { drop(bun_core::heap::take(dest)) };
                    }
                    to_destroy = Some(val);
                    // SAFETY: `val` came from the queue and is live until heap::take above on the next iter
                    self.result_list
                        .append_from(&mut unsafe { &mut *val }.value);
                }
                if let Some(dest) = to_destroy {
                    // SAFETY: paired with heap::alloc in write_results()
                    unsafe { drop(bun_core::heap::take(dest)) };
                }
            }

            // `bun_vm_concurrently()` skips the JS-thread debug assert and is the
            // documented accessor for off-thread (work-pool) callers.
            // SAFETY: `bun_vm_concurrently()` returns the process-singleton VM;
            // sole `&mut` borrow at this point on the work-pool thread.
            let vm = unsafe { &mut *self.global_object().bun_vm_concurrently() };
            vm.enqueue_task_concurrent(ConcurrentTask::create(Task::init(std::ptr::from_mut::<
                Self,
            >(self))));
        }

        fn clear_result_list(&mut self) {
            self.result_list.deinit();
            let mut batch = self.result_list_queue.pop_batch();
            let mut iter = batch.iterator();
            let mut to_destroy: Option<*mut ResultListEntry> = None;
            loop {
                let val = iter.next();
                if val.is_null() {
                    break;
                }
                // SAFETY: `val` is a live queue node until freed below
                unsafe { &mut *val }.value.deinit();
                // SAFETY: paired with heap::alloc in write_results()
                if let Some(dest) = to_destroy {
                    unsafe { drop(bun_core::heap::take(dest)) };
                }
                to_destroy = Some(val);
            }
            // SAFETY: paired with heap::alloc in write_results()
            if let Some(dest) = to_destroy {
                unsafe { drop(bun_core::heap::take(dest)) };
            }
            self.result_list_count.store(0, Ordering::Relaxed);
        }

        pub fn run_from_js_thread(&mut self) -> Result<(), bun_jsc::JsTerminated> {
            // NOTE: cannot route through `self.global_object()` here -- the returned
            // borrow would be tied to `&self` and conflict with the `&mut self.*`
            // field accesses below, and it must also stay valid past `Self::destroy`.
            // BackRef is `Copy`; copy it to a local so the borrow is detached from `self`.
            let global_object = self.global_object;
            let global_object = global_object.get();
            let success = self.pending_err.is_none();
            let promise_value = self.promise.value();
            // Raw-pointer capture: see `AsyncCpTask::run_from_js_thread` for rationale —
            // `Self::destroy` must run before resolve/reject, and the `JSPromise` cell
            // outlives the `Strong` wrapper via `promise_value.ensure_still_alive()`.
            let promise: *mut bun_jsc::JSPromise = self.promise.get();
            let result = if let Some(err) = &mut self.pending_err {
                // SAFETY: `promise` is the sole live reference to the heap `JSPromise`.
                match err.to_js_with_async_stack(global_object, unsafe { &*promise }) {
                    Ok(v) => v,
                    Err(e) => {
                        return unsafe { &mut *promise }
                            .reject(global_object, Ok(global_object.take_exception(e)));
                    }
                }
            } else {
                let res = match core::mem::replace(
                    &mut self.result_list,
                    ResultListEntryValue::Files(Vec::new()),
                ) {
                    ResultListEntryValue::WithFileTypes(v) => {
                        ret::Readdir::WithFileTypes(v.into_boxed_slice())
                    }
                    ResultListEntryValue::Buffers(v) => ret::Readdir::Buffers(v.into_boxed_slice()),
                    ResultListEntryValue::Files(v) => ret::Readdir::Files(v.into_boxed_slice()),
                };
                match res.to_js(global_object) {
                    Ok(v) => v,
                    Err(e) => {
                        return unsafe { &mut *promise }
                            .reject(global_object, Ok(global_object.take_exception(e)));
                    }
                }
            };
            promise_value.ensure_still_alive();

            let _dispatch = self.tracker.dispatch(global_object);

            // SAFETY: self was Box::leak'd in create(); destroyed exactly once here
            unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };
            // SAFETY: GC-rooted JS heap cell, valid past `destroy` (see above).
            let promise = unsafe { &mut *promise };
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
            this_ref.r#ref.unref(bun_io::js_vm_ctx());
            // `args.deinit()` → `Drop` on `args::Readdir` (via `heap::take` below).
            this_ref.free_root_path();
            this_ref.clear_result_list();
            // Zig `promise.deinit()` — `JSPromiseStrong` releases on Drop (via heap::take below).
            // SAFETY: paired with Box::leak in create()
            drop(unsafe { bun_core::heap::take(this) });
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
        fn into_variant(v: Vec<Self>) -> ResultListEntryValue {
            ResultListEntryValue::WithFileTypes(v)
        }
    }
    impl IntoResultListEntry for Buffer {
        fn into_variant(v: Vec<Self>) -> ResultListEntryValue {
            ResultListEntryValue::Buffers(v)
        }
    }
    impl IntoResultListEntry for BunString {
        fn into_variant(v: Vec<Self>) -> ResultListEntryValue {
            ResultListEntryValue::Files(v)
        }
    }

    // Route `Task::init(self)` in `finish_concurrently` to the event-loop dispatch
    // table. The `task_tag::ReaddirRecursive` arm is wired in
    // `crate::dispatch::run_task` to call `run_from_js_thread`.
    impl bun_event_loop::Taskable for AsyncReaddirRecursiveTask {
        const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ReaddirRecursive;
    }

    impl ResultListEntryValue {
        fn from_vec<T: IntoResultListEntry>(v: Vec<T>) -> Self {
            T::into_variant(v)
        }
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
    AsyncCpTask, AsyncFSTask, AsyncReaddirRecursiveTask, CpSingleTask, FsArgument, FsReturn,
    IntoResultListEntry, NewAsyncCpTask, ResultListEntry, ResultListEntryValue, ShellAsyncCpTask,
    UVFSRequest, async_,
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

    /// Derive the `Unprotect` impl + inherent `to_thread_safe` for an `args::*`
    /// struct whose only JS-backed state is one-or-more path-like fields. Each
    /// listed `$field` must expose `.unprotect()` and `.to_thread_safe()` (i.e.
    /// `PathLike` or `PathOrFileDescriptor`); the expansion is byte-identical to
    /// the hand-written boilerplate it replaces, so `impl_fs_argument!`'s
    /// `<$ty>::to_thread_safe(self)` forwarder and `ThreadSafe<T>`'s drop-guard
    /// keep working unchanged. Structs with non-path JS state (`Read`, `Write`,
    /// `Writev`, `Readv`, `Exists`, `ReadFile`, `WriteFile`) keep bespoke impls.
    macro_rules! fs_args_path_forwarders {
        ($ty:ident; $($field:ident),+ $(,)?) => {
            impl Unprotect for $ty {
                #[inline] fn unprotect(&mut self) { $( self.$field.unprotect(); )+ }
            }
            impl $ty {
                pub fn to_thread_safe(&mut self) { $( self.$field.to_thread_safe(); )+ }
            }
        };
    }

    pub struct Rename {
        pub old_path: PathLike,
        pub new_path: PathLike,
    }
    fs_args_path_forwarders!(Rename; old_path, new_path);
    impl Rename {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Rename> {
            let old_path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_argument_type_value(
                    b"oldPath",
                    b"string or an instance of Buffer or URL",
                    arguments.next().unwrap_or(JSValue::UNDEFINED),
                )
            })?;
            // `errdefer old_path.deinit()` → `Drop for PathLike` on early return.
            let new_path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_argument_type_value(
                    b"newPath",
                    b"string or an instance of Buffer or URL",
                    arguments.next().unwrap_or(JSValue::UNDEFINED),
                )
            })?;
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
        fn default() -> Self {
            Self {
                path: PathOrFileDescriptor::default(),
                len: 0,
                flags: 0,
            }
        }
    }
    fs_args_path_forwarders!(Truncate; path);
    impl Truncate {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Truncate> {
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_arguments(format_args!("path must be a string or TypedArray"))
            })?;
            let len: u64 = 'brk: {
                let Some(len_value) = arguments.next() else {
                    break 'brk 0;
                };
                validators::validate_integer(ctx, len_value, "len", None, None)?.max(0) as u64
            };
            Ok(Truncate {
                path,
                len,
                flags: 0,
            })
        }
    }

    /// Shared layout for `fs.writev` / `fs.readv` arguments. Zig keeps two
    /// byte-identical copy-pasted structs (`Arguments.Writev` / `Arguments.Readv`,
    /// node_fs.zig:1364-1468); we keep one concrete struct and re-export both
    /// names as type aliases so every `args::Writev` / `args::Readv` caller
    /// (UVFSRequest params, `readv`/`writev`/`preadv_inner`/`pwritev_inner`,
    /// uv dispatch arms) is untouched.
    pub struct FdVectorIo {
        pub fd: FD,
        pub buffers: VectorArrayBuffer,
        pub position: Option<u64>, // u52
    }
    impl Unprotect for FdVectorIo {
        #[inline]
        fn unprotect(&mut self) {
            self.buffers.value.unprotect();
            // Zig: `self.buffers.buffers.deinit()` — `Vec` frees on drop.
        }
    }
    impl FdVectorIo {
        pub fn to_thread_safe(&mut self) {
            self.buffers.value.protect();
            self.buffers.buffers = self.buffers.buffers.as_slice().to_vec();
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let fd = FD::from_js_required(ctx, arguments)?;
            let buffers = VectorArrayBuffer::from_js(
                ctx,
                arguments.protect_eat_next().ok_or_else(|| {
                    ctx.throw_invalid_arguments(format_args!("Expected an ArrayBufferView[]"))
                })?,
            )?;
            let mut position: Option<u64> = None;
            if let Some(pos_value) = arguments.next_eat() {
                if !pos_value.is_undefined_or_null() {
                    if pos_value.is_number() {
                        position = Some(pos_value.to_int64() as u64);
                    } else {
                        return Err(
                            ctx.throw_invalid_arguments(format_args!("position must be a number"))
                        );
                    }
                }
            }
            Ok(Self {
                fd,
                buffers,
                position,
            })
        }
    }
    pub type Writev = FdVectorIo;
    pub type Readv = FdVectorIo;

    pub struct FTruncate {
        pub fd: FD,
        pub len: Option<BlobSizeType>,
    }
    impl Unprotect for FTruncate {
        #[inline]
        fn unprotect(&mut self) {}
    }
    impl FTruncate {
        pub fn to_thread_safe(&self) {}
        pub fn from_js(
            ctx: &JSGlobalObject,
            arguments: &mut ArgumentsSlice,
        ) -> JsResult<FTruncate> {
            let fd = FD::from_js_required(ctx, arguments)?;
            let len: BlobSizeType = BlobSizeType::try_from(
                validators::validate_integer(
                    ctx,
                    arguments.next().unwrap_or(JSValue::js_number(0.0)),
                    "len",
                    Some(i64::from(i52::MIN)),
                    Some(BLOB_SIZE_MAX as i64),
                )?
                .max(0),
            )
            .expect("infallible: validated range");
            Ok(FTruncate { fd, len: Some(len) })
        }
    }

    pub struct Chown {
        pub path: PathLike,
        pub uid: UidT,
        pub gid: GidT,
    }
    fs_args_path_forwarders!(Chown; path);
    impl Chown {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Chown> {
            // Zig: `errdefer path.deinit()` — `Drop for PathLike` covers every
            // error return below (including `try validateInteger`).
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let uid: UidT = 'brk: {
                let Some(uid_value) = arguments.next() else {
                    return Err(ctx.throw_invalid_arguments(format_args!("uid is required")));
                };
                arguments.eat();
                break 'brk wrap_to::<UidT>(validators::validate_integer(
                    ctx,
                    uid_value,
                    "uid",
                    Some(-1),
                    Some(u32::MAX as i64),
                )?);
            };
            let gid: GidT = 'brk: {
                let Some(gid_value) = arguments.next() else {
                    return Err(ctx.throw_invalid_arguments(format_args!("gid is required")));
                };
                arguments.eat();
                break 'brk wrap_to::<GidT>(validators::validate_integer(
                    ctx,
                    gid_value,
                    "gid",
                    Some(-1),
                    Some(u32::MAX as i64),
                )?);
            };
            Ok(Chown { path, uid, gid })
        }
    }

    pub struct Fchown {
        pub fd: FD,
        pub uid: UidT,
        pub gid: GidT,
    }
    impl Fchown {
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Fchown> {
            let fd = FD::from_js_required(ctx, arguments)?;
            let uid: UidT = 'brk: {
                let Some(uid_value) = arguments.next() else {
                    return Err(ctx.throw_invalid_arguments(format_args!("uid is required")));
                };
                arguments.eat();
                break 'brk wrap_to::<UidT>(validators::validate_integer(
                    ctx,
                    uid_value,
                    "uid",
                    Some(-1),
                    Some(u32::MAX as i64),
                )?);
            };
            let gid: GidT = 'brk: {
                let Some(gid_value) = arguments.next() else {
                    return Err(ctx.throw_invalid_arguments(format_args!("gid is required")));
                };
                arguments.eat();
                break 'brk wrap_to::<GidT>(validators::validate_integer(
                    ctx,
                    gid_value,
                    "gid",
                    Some(-1),
                    Some(u32::MAX as i64),
                )?);
            };
            Ok(Fchown { fd, uid, gid })
        }
    }

    /// Zig: `fn wrapTo(comptime T: type, in: i64) T` where `T` is unsigned.
    /// Only ever instantiated with `uid_t`/`gid_t` — `u32` on POSIX, `u8` on
    /// Windows (libuv's `uv_uid_t`/`uv_gid_t` are `unsigned char`). Hard-code
    /// the per-platform wrap rather than pulling `num_traits`.
    #[cfg(not(windows))]
    #[inline]
    fn wrap_to<T: From<u32>>(in_: i64) -> T {
        // Zig spec (node_fs.zig:1586): `@intCast(@mod(in, std.math.maxInt(T)))`
        // — modulus is `u32::MAX` (2^32 - 1), **not** 2^32. So `-1 → 4294967294`
        // and `4294967295 → 0`. Match the spec exactly.
        T::from(in_.rem_euclid(u32::MAX as i64) as u32)
    }
    #[cfg(windows)]
    #[inline]
    fn wrap_to<T: From<u8>>(in_: i64) -> T {
        // Same `@mod(in, maxInt(T))` semantics with `T = u8`.
        T::from(in_.rem_euclid(u8::MAX as i64) as u8)
    }

    pub type LChown = Chown;

    pub struct Lutimes {
        pub path: PathLike,
        pub atime: TimeLike,
        pub mtime: TimeLike,
    }
    fs_args_path_forwarders!(Lutimes; path);
    impl Lutimes {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Lutimes> {
            // Zig: `errdefer path.deinit()` — `Drop for PathLike` covers the
            // `try timeLikeFromJS` throws below.
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let atime = node::time_like_from_js(
                ctx,
                arguments.next().ok_or_else(|| {
                    ctx.throw_invalid_arguments(format_args!("atime is required"))
                })?,
            )?
            .ok_or_else(|| {
                ctx.throw_invalid_arguments(format_args!("atime must be a number or a Date"))
            })?;
            arguments.eat();
            let mtime = node::time_like_from_js(
                ctx,
                arguments.next().ok_or_else(|| {
                    ctx.throw_invalid_arguments(format_args!("mtime is required"))
                })?,
            )?
            .ok_or_else(|| {
                ctx.throw_invalid_arguments(format_args!("mtime must be a number or a Date"))
            })?;
            arguments.eat();
            Ok(Lutimes { path, atime, mtime })
        }
    }

    pub struct Chmod {
        pub path: PathLike,
        pub mode: Mode,
    }
    impl Default for Chmod {
        fn default() -> Self {
            Self {
                path: PathLike::default(),
                mode: 0x777,
            }
        }
    }
    fs_args_path_forwarders!(Chmod; path);
    impl Chmod {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Chmod> {
            // Zig: `errdefer path.deinit()` — `Drop for PathLike` covers the
            // `try modeFromJS` throw below.
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let mode_arg = arguments.next().unwrap_or(JSValue::UNDEFINED);
            let mode: Mode = match node::mode_from_js(ctx, mode_arg)? {
                Some(m) => m,
                None => {
                    return Err(validators::throw_err_invalid_arg_type(
                        ctx,
                        format_args!("mode"),
                        "number",
                        mode_arg,
                    ));
                }
            };
            arguments.eat();
            Ok(Chmod { path, mode })
        }
    }

    pub struct FChmod {
        pub fd: FD,
        pub mode: Mode,
    }
    impl Default for FChmod {
        fn default() -> Self {
            Self {
                fd: FD::INVALID,
                mode: 0x777,
            }
        }
    }
    impl FChmod {
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<FChmod> {
            let fd = FD::from_js_required(ctx, arguments)?;
            let mode_arg = arguments.next().unwrap_or(JSValue::UNDEFINED);
            let mode: Mode = node::mode_from_js(ctx, mode_arg)?.ok_or_else(|| {
                validators::throw_err_invalid_arg_type(
                    ctx,
                    format_args!("mode"),
                    "number",
                    mode_arg,
                )
            })?;
            arguments.eat();
            Ok(FChmod { fd, mode })
        }
    }

    pub type LCHmod = Chmod;

    pub struct StatFS {
        pub path: PathLike,
        pub big_int: bool,
    }
    fs_args_path_forwarders!(StatFS; path);
    impl StatFS {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<StatFS> {
            // Zig: `errdefer path.deinit()` — `Drop for PathLike` covers the
            // `try get_boolean_strict` throw below.
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let big_int = 'brk: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_object() {
                        if next_val.is_callable() {
                            break 'brk false;
                        }
                        arguments.eat();
                        if let Some(b) = next_val.get_boolean_strict(ctx, "bigint")? {
                            break 'brk b;
                        }
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
    impl Default for Stat {
        fn default() -> Self {
            Self {
                path: PathLike::default(),
                big_int: false,
                throw_if_no_entry: true,
            }
        }
    }
    fs_args_path_forwarders!(Stat; path);
    impl Stat {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Stat> {
            // Zig: `errdefer path.deinit()` (node_fs.zig:1756) → `Drop for PathLike`.
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let mut throw_if_no_entry = true;
            let big_int = 'brk: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_object() {
                        if next_val.is_callable() {
                            break 'brk false;
                        }
                        arguments.eat();
                        if let Some(v) = next_val.get_boolean_strict(ctx, "throwIfNoEntry")? {
                            throw_if_no_entry = v;
                        }
                        if let Some(b) = next_val.get_boolean_strict(ctx, "bigint")? {
                            break 'brk b;
                        }
                    }
                }
                false
            };
            Ok(Stat {
                path,
                big_int,
                throw_if_no_entry,
            })
        }
    }

    pub struct Fstat {
        pub fd: FD,
        pub big_int: bool,
    }
    impl Fstat {
        pub fn to_thread_safe(&mut self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Fstat> {
            let fd = FD::from_js_required(ctx, arguments)?;
            let big_int = 'brk: {
                if let Some(next_val) = arguments.next() {
                    if next_val.is_object() {
                        if next_val.is_callable() {
                            break 'brk false;
                        }
                        arguments.eat();
                        if let Some(b) = next_val.get_boolean_strict(ctx, "bigint")? {
                            break 'brk b;
                        }
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
    fs_args_path_forwarders!(Link; old_path, new_path);
    impl Link {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Link> {
            let old_path = PathLike::from_js_required(ctx, arguments, "oldPath")?;
            // `errdefer old_path.deinit()` → `Drop for PathLike` on early return.
            let new_path = PathLike::from_js_required(ctx, arguments, "newPath")?;
            Ok(Link { old_path, new_path })
        }
    }

    #[derive(Copy, Clone)]
    pub enum SymlinkLinkType {
        Unspecified,
        File,
        Dir,
        Junction,
    }

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
    fs_args_path_forwarders!(Symlink; target_path, new_path);
    impl Symlink {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Symlink> {
            // Zig: `errdefer old_path.deinit()` (node_fs.zig:1883) → `Drop for PathLike`.
            let old_path = PathLike::from_js_required(ctx, arguments, "target")?;
            // Zig: `errdefer new_path.deinit()` (node_fs.zig:1888) → `Drop for PathLike`.
            let new_path = PathLike::from_js_required(ctx, arguments, "path")?;
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
                    if next_val.is_undefined_or_null() {
                        break 'link_type SymlinkLinkType::Unspecified;
                    }
                    if next_val.is_string() {
                        arguments.eat();
                        let str = next_val.to_bun_string(ctx)?;
                        let str = scopeguard::guard(str, |s| s.deref());
                        if str.eql_comptime("dir") {
                            break 'link_type SymlinkLinkType::Dir;
                        }
                        if str.eql_comptime("file") {
                            break 'link_type SymlinkLinkType::File;
                        }
                        if str.eql_comptime("junction") {
                            break 'link_type SymlinkLinkType::Junction;
                        }
                        return Err(ctx.err(bun_jsc::ErrorCode::ERR_INVALID_ARG_VALUE, format_args!("Symlink type must be one of \"dir\", \"file\", or \"junction\". Received \"{}\"", &*str)).throw());
                    }
                    // not a string. fallthrough to auto detect.
                    return Err(ctx
                        .err(
                            bun_jsc::ErrorCode::ERR_INVALID_ARG_VALUE,
                            format_args!(
                                "Symlink type must be one of \"dir\", \"file\", or \"junction\"."
                            ),
                        )
                        .throw());
                }
                SymlinkLinkType::Unspecified
            };
            Ok(Symlink {
                target_path: old_path,
                new_path,
                #[cfg(windows)]
                link_type,
                #[cfg(not(windows))]
                link_type: {
                    let _ = link_type;
                    ()
                },
            })
        }
    }

    pub struct Readlink {
        pub path: PathLike,
        pub encoding: Encoding,
    }
    fs_args_path_forwarders!(Readlink; path);
    impl Readlink {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Readlink> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let encoding = parse_encoding_arg(ctx, arguments, Encoding::Utf8)?;
            Ok(Readlink { path, encoding })
        }
    }

    pub struct Realpath {
        pub path: PathLike,
        pub encoding: Encoding,
    }
    fs_args_path_forwarders!(Realpath; path);
    impl Realpath {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Realpath> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let encoding = parse_encoding_arg(ctx, arguments, Encoding::Utf8)?;
            Ok(Realpath { path, encoding })
        }
    }

    pub(super) fn get_encoding(
        object: JSValue,
        global_object: &JSGlobalObject,
        default: Encoding,
    ) -> JsResult<Encoding> {
        if let Some(value) = object.fast_get(global_object, bun_jsc::BuiltinName::Encoding)? {
            return Encoding::assert(value, global_object, default);
        }
        Ok(default)
    }

    /// Consume the next positional argument as a Node.js fs `encoding` option.
    /// Accepts either an encoding string (`"utf8"`, `"buffer"`, ...) or an options
    /// object with an `.encoding` property. Any other value (including `undefined`
    /// / `null` / numbers / functions) is silently ignored and `default` is returned.
    /// Mirrors the copy-pasted block in Zig's `Readlink/Realpath/MkdirTemp.fromJS`.
    pub(super) fn parse_encoding_arg(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
        default: Encoding,
    ) -> JsResult<Encoding> {
        let mut encoding = default;
        if let Some(val) = arguments.next() {
            arguments.eat();
            match val.js_type() {
                bun_jsc::JSType::String
                | bun_jsc::JSType::StringObject
                | bun_jsc::JSType::DerivedStringObject => {
                    encoding = Encoding::assert(val, ctx, encoding)?;
                }
                _ => {
                    if val.is_object() {
                        encoding = get_encoding(val, ctx, encoding)?;
                    }
                }
            }
        }
        Ok(encoding)
    }

    pub struct Unlink {
        pub path: PathLike,
    }
    fs_args_path_forwarders!(Unlink; path);
    impl Unlink {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Unlink> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
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
        fn default() -> Self {
            Self {
                path: PathLike::default(),
                force: false,
                max_retries: 0,
                recursive: false,
                retry_delay: 100,
            }
        }
    }
    fs_args_path_forwarders!(RmDir; path);
    impl RmDir {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<RmDir> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let mut recursive = false;
            let mut force = false;
            let mut max_retries: u32 = 0;
            let mut retry_delay: c_uint = 100;
            if let Some(val) = arguments.next() {
                arguments.eat();
                if val.is_object() {
                    if let Some(boolean) = val.get(ctx, "recursive")? {
                        if boolean.is_boolean() {
                            recursive = boolean.to_boolean();
                        } else {
                            return Err(ctx.throw_invalid_arguments(format_args!(
                                "The \"options.recursive\" property must be of type boolean."
                            )));
                        }
                    }
                    if let Some(boolean) = val.get(ctx, "force")? {
                        if boolean.is_boolean() {
                            force = boolean.to_boolean();
                        } else {
                            return Err(ctx.throw_invalid_arguments(format_args!(
                                "The \"options.force\" property must be of type boolean."
                            )));
                        }
                    }
                    if let Some(delay) = val.get(ctx, "retryDelay")? {
                        retry_delay = c_uint::try_from(validators::validate_integer(
                            ctx,
                            delay,
                            "options.retryDelay",
                            Some(0),
                            Some(c_uint::MAX as i64),
                        )?)
                        .expect("infallible: validated range");
                    }
                    if let Some(retries) = val.get(ctx, "maxRetries")? {
                        max_retries = u32::try_from(validators::validate_integer(
                            ctx,
                            retries,
                            "options.maxRetries",
                            Some(0),
                            Some(u32::MAX as i64),
                        )?)
                        .expect("infallible: validated range");
                    }
                } else if !val.is_undefined() {
                    return Err(ctx.throw_invalid_arguments(format_args!(
                        "The \"options\" argument must be of type object."
                    )));
                }
            }
            Ok(RmDir {
                path,
                recursive,
                force,
                max_retries,
                retry_delay,
            })
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
        fn default() -> Self {
            Self {
                path: PathLike::default(),
                recursive: false,
                mode: Self::DEFAULT_MODE,
                always_return_none: false,
            }
        }
    }
    fs_args_path_forwarders!(Mkdir; path);
    impl Mkdir {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Mkdir> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let mut recursive = false;
            let mut mode: Mode = 0o777;
            if let Some(val) = arguments.next() {
                arguments.eat();
                if val.is_object() {
                    if let Some(b) = val.get_boolean_strict(ctx, "recursive")? {
                        recursive = b;
                    }
                    if let Some(mode_) = val.get(ctx, "mode")? {
                        mode = node::mode_from_js(ctx, mode_)?.unwrap_or(mode);
                    }
                }
                if val.is_number() || val.is_string() {
                    mode = node::mode_from_js(ctx, val)?.unwrap_or(mode);
                }
            }
            Ok(Mkdir {
                path,
                recursive,
                mode,
                always_return_none: false,
            })
        }
    }

    pub struct MkdirTemp {
        pub prefix: PathLike,
        pub encoding: Encoding,
    }
    impl Default for MkdirTemp {
        fn default() -> Self {
            Self {
                prefix: PathLike::Buffer(Buffer {
                    buffer: bun_jsc::ArrayBuffer::EMPTY,
                    owns_buffer: false,
                }),
                encoding: Encoding::Utf8,
            }
        }
    }
    fs_args_path_forwarders!(MkdirTemp; prefix);
    impl MkdirTemp {
        pub fn from_js(
            ctx: &JSGlobalObject,
            arguments: &mut ArgumentsSlice,
        ) -> JsResult<MkdirTemp> {
            let prefix = PathLike::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_argument_type_value(
                    b"prefix",
                    b"string, Buffer, or URL",
                    arguments.next().unwrap_or(JSValue::UNDEFINED),
                )
            })?;
            let encoding = parse_encoding_arg(ctx, arguments, Encoding::Utf8)?;
            Ok(MkdirTemp { prefix, encoding })
        }
    }

    pub struct Readdir {
        pub path: PathLike,
        pub encoding: Encoding,
        pub with_file_types: bool,
        pub recursive: bool,
    }
    fs_args_path_forwarders!(Readdir; path);
    impl Readdir {
        pub fn tag(&self) -> ret::ReaddirTag {
            match self.encoding {
                Encoding::Buffer => ret::ReaddirTag::Buffers,
                _ => {
                    if self.with_file_types {
                        ret::ReaddirTag::WithFileTypes
                    } else {
                        ret::ReaddirTag::Files
                    }
                }
            }
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Readdir> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let mut encoding = Encoding::Utf8;
            let mut with_file_types = false;
            let mut recursive = false;
            if let Some(val) = arguments.next() {
                arguments.eat();
                match val.js_type() {
                    bun_jsc::JSType::String
                    | bun_jsc::JSType::StringObject
                    | bun_jsc::JSType::DerivedStringObject => {
                        encoding = Encoding::assert(val, ctx, encoding)?;
                    }
                    _ => {
                        if val.is_object() {
                            encoding = get_encoding(val, ctx, encoding)?;
                            if let Some(r) = val.get_boolean_strict(ctx, "recursive")? {
                                recursive = r;
                            }
                            if let Some(w) = val.get_boolean_strict(ctx, "withFileTypes")? {
                                with_file_types = w;
                            }
                        }
                    }
                }
            }
            Ok(Readdir {
                path,
                encoding,
                with_file_types,
                recursive,
            })
        }
    }

    pub struct Close {
        pub fd: FD,
    }
    impl Close {
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Close> {
            let fd = FD::from_js_required(ctx, arguments)?;
            Ok(Close { fd })
        }
    }

    pub struct Open {
        pub path: PathLike,
        pub flags: FileSystemFlags,
        pub mode: Mode,
    }
    impl Default for Open {
        fn default() -> Self {
            Self {
                path: PathLike::default(),
                flags: FileSystemFlags::R,
                mode: DEFAULT_PERMISSION,
            }
        }
    }
    fs_args_path_forwarders!(Open; path);
    impl Open {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Open> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
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
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Futimes> {
            let fd = FD::from_js_required(ctx, arguments)?;
            let atime = node::time_like_from_js(
                ctx,
                arguments.next().ok_or_else(|| {
                    ctx.throw_invalid_arguments(format_args!("atime is required"))
                })?,
            )?
            .ok_or_else(|| {
                ctx.throw_invalid_arguments(format_args!("atime must be a number or a Date"))
            })?;
            arguments.eat();
            let mtime = node::time_like_from_js(
                ctx,
                arguments.next().ok_or_else(|| {
                    ctx.throw_invalid_arguments(format_args!("mtime is required"))
                })?,
            )?
            .ok_or_else(|| {
                ctx.throw_invalid_arguments(format_args!("mtime must be a number or a Date"))
            })?;
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
        fn default() -> Self {
            Self {
                fd: FD::INVALID,
                buffer: StringOrBuffer::default(),
                offset: 0,
                length: u64::MAX,
                position: None,
                encoding: Encoding::Buffer,
            }
        }
    }
    impl Unprotect for Write {
        #[inline]
        fn unprotect(&mut self) {
            self.buffer.unprotect();
        }
    }
    impl Write {
        pub fn to_thread_safe(&mut self) {
            self.buffer.to_thread_safe();
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Write> {
            let fd = FD::from_js_required(ctx, arguments)?;
            let buffer_value = arguments.next();
            let bv = buffer_value
                .ok_or_else(|| ctx.throw_invalid_arguments(format_args!("data is required")))?;
            let buffer = StringOrBuffer::from_js(ctx, bv)?.ok_or_else(|| {
                ctx.throw_invalid_argument_type_value(b"buffer", b"string or TypedArray", bv)
            })?;
            if bv.is_string() && !bv.is_string_literal() {
                return Err(ctx.throw_invalid_argument_type_value(
                    b"buffer",
                    b"string or TypedArray",
                    bv,
                ));
            }
            let encoding = if matches!(buffer, StringOrBuffer::Buffer(_)) {
                Encoding::Buffer
            } else {
                Encoding::Utf8
            };
            // `errdefer args.deinit()` (node_fs.zig:2491) → `Drop for StringOrBuffer`
            // on `args.buffer` releases the slice on any `?`-propagated JsError.
            let mut args = Write {
                fd,
                buffer,
                encoding,
                ..Default::default()
            };
            arguments.eat();
            'parse: {
                let Some(mut current) = arguments.next() else {
                    break 'parse;
                };
                match &args.buffer {
                    // fs.write(fd, buffer[, offset[, length[, position]]], callback)
                    StringOrBuffer::Buffer(_) => {
                        if current.is_undefined_or_null() || current.is_function() {
                            break 'parse;
                        }
                        args.offset = u64::try_from(validators::validate_integer(
                            ctx,
                            current,
                            "offset",
                            Some(0),
                            Some(9007199254740991),
                        )?)
                        .expect("infallible: validated range");
                        arguments.eat();
                        let Some(next) = arguments.next() else {
                            break 'parse;
                        };
                        current = next;
                        if !(current.is_number() || current.is_big_int()) {
                            break 'parse;
                        }
                        let length = current.to_int64();
                        let buf_len = args.buffer.buffer().map(|b| b.slice().len()).unwrap_or(0);
                        let max_offset = (buf_len as i64).min(i64::MAX);
                        if args.offset as i64 > max_offset {
                            return Err(ctx.throw_range_error(
                                args.offset as f64,
                                bun_jsc::RangeErrorOptions {
                                    field_name: b"offset",
                                    max: max_offset,
                                    ..Default::default()
                                },
                            ));
                        }
                        let max_len = ((buf_len as u64 - args.offset) as i64).min(i32::MAX as i64);
                        if length > max_len || length < 0 {
                            return Err(ctx.throw_range_error(
                                length as f64,
                                bun_jsc::RangeErrorOptions {
                                    field_name: b"length",
                                    min: 0,
                                    max: max_len,
                                    ..Default::default()
                                },
                            ));
                        }
                        args.length = u64::try_from(length).expect("int cast");
                        arguments.eat();
                        let Some(next) = arguments.next() else {
                            break 'parse;
                        };
                        current = next;
                        if !(current.is_number() || current.is_big_int()) {
                            break 'parse;
                        }
                        let position = i52::from_js(current);
                        if position >= 0 {
                            args.position = Some(position);
                        }
                        arguments.eat();
                    }
                    // fs.write(fd, string[, position[, encoding]], callback)
                    _ => {
                        if current.is_number() {
                            args.position = Some(i52::from_js(current));
                            arguments.eat();
                            let Some(next) = arguments.next() else {
                                break 'parse;
                            };
                            current = next;
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
        pub fn to_thread_safe(&self) {
            self.buffer.buffer.value.protect();
        }
    }
    impl Unprotect for Read {
        #[inline]
        fn unprotect(&mut self) {
            self.buffer.buffer.value.unprotect();
        }
    }
    impl Read {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Read> {
            // About half of the normalization has already been done. The second half is done in the native code.
            // fs_binding.read(fd, buffer, offset, length, position)

            // fd = getValidatedFd(fd);
            let fd = FD::from_js_required(ctx, arguments)?;

            //  validateBuffer(buffer);
            let buffer_value = arguments.next_eat().ok_or_else(||
                // theoretically impossible, argument has been passed already
                ctx.throw_invalid_arguments(format_args!("buffer is required")))?;
            let buffer = Buffer::from_js(ctx, buffer_value).ok_or_else(|| {
                ctx.throw_invalid_argument_type_value(b"buffer", b"TypedArray", buffer_value)
            })?;

            let offset_value = arguments.next_eat().unwrap_or(JSValue::NULL);
            // if (offset == null) {
            //   offset = 0;
            // } else {
            //   validateInteger(offset, 'offset', 0);
            // }
            let offset: u64 = if offset_value.is_undefined_or_null() {
                0
            } else {
                u64::try_from(validators::validate_integer(
                    ctx,
                    offset_value,
                    "offset",
                    Some(0),
                    Some(bun_jsc::MAX_SAFE_INTEGER),
                )?)
                .expect("infallible: validated range")
            };

            // length |= 0;
            let length_float: f64 = if let Some(arg) = arguments.next_eat() {
                arg.to_number(ctx)?
            } else {
                0.0
            };

            //   if (length === 0) {
            //     return process.nextTick(function tick() {
            //       callback(null, 0, buffer);
            //     });
            //   }
            if length_float == 0.0 {
                return Ok(Read {
                    fd,
                    buffer,
                    length: 0,
                    offset: 0,
                    position: None,
                });
            }

            let buf_len = buffer.slice().len();
            if buf_len == 0 {
                return Err(validators::throw_err_invalid_arg_value(
                    ctx,
                    format_args!("The argument 'buffer' is empty and cannot be written."),
                ));
            }
            // validateOffsetLengthRead(offset, length, buffer.byteLength);
            if length_float % 1.0 != 0.0 {
                return Err(ctx.throw_range_error(
                    length_float,
                    bun_jsc::RangeErrorOptions {
                        field_name: b"length",
                        msg: b"an integer",
                        ..Default::default()
                    },
                ));
            }
            let length_int: i64 = length_float as i64;
            // Zig (node_fs.zig:2621) compares `i64 > usize` with sign-aware peer
            // widening, so negative `length_int` falls through to the `< 0` arm
            // below. Guard the `as usize` cast so it doesn't wrap-to-huge here.
            if length_int > 0 && length_int as usize > buf_len {
                return Err(ctx.throw_range_error(
                    length_float,
                    bun_jsc::RangeErrorOptions {
                        field_name: b"length",
                        max: (buf_len as i64).min(i64::MAX),
                        ..Default::default()
                    },
                ));
            }
            if i64::try_from(offset)
                .expect("int cast")
                .saturating_add(length_int)
                > buf_len as i64
            {
                return Err(ctx.throw_range_error(
                    length_float,
                    bun_jsc::RangeErrorOptions {
                        field_name: b"length",
                        max: (buf_len as u64).saturating_sub(offset) as i64,
                        ..Default::default()
                    },
                ));
            }
            if length_int < 0 {
                return Err(ctx.throw_range_error(
                    length_float,
                    bun_jsc::RangeErrorOptions {
                        field_name: b"length",
                        min: 0,
                        ..Default::default()
                    },
                ));
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
                validators::validate_integer(
                    ctx,
                    position_value,
                    "position",
                    Some(-1),
                    Some(bun_jsc::MAX_SAFE_INTEGER),
                )?
            } else if let Some(position) = bun_jsc::JSBigInt::from_js(position_value) {
                // const maxPosition = 2n ** 63n - 1n - BigInt(length)
                let max_position = i64::MAX - length_int;
                if position.order(-1i64) == core::cmp::Ordering::Less
                    || position.order(max_position) == core::cmp::Ordering::Greater
                {
                    let position_str = position.to_string(ctx)?;
                    let position_bytes = position_str.to_owned_slice();
                    position_str.deref();
                    return Err(ctx.throw_range_error(
                        &position_bytes[..],
                        bun_jsc::RangeErrorOptions {
                            field_name: b"position",
                            min: -1,
                            max: max_position,
                            ..Default::default()
                        },
                    ));
                }
                position.to_int64()
            } else {
                return Err(ctx.throw_invalid_argument_type_value(
                    b"position",
                    b"number or bigint",
                    position_value,
                ));
            };

            // Bun needs `null` to tell the native function if to use pread or read
            let position: Option<ReadPosition> = if position_int >= 0 {
                Some(position_int)
            } else {
                None
            };

            Ok(Read {
                fd,
                buffer,
                offset,
                length,
                position,
            })
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
            Self {
                path: PathOrFileDescriptor::default(),
                encoding: Encoding::Utf8,
                offset: 0,
                max_size: None,
                limit_size_for_javascript: false,
                flag: FileSystemFlags::R,
                signal: None,
            }
        }
    }
    impl Drop for ReadFile {
        fn drop(&mut self) {
            // Zig `deinit()`: release the AbortSignal ref taken in `from_js`.
            // `path: PathOrFileDescriptor` releases via its inner `PathLike` Drop.
            if let Some(signal) = self.signal.take() {
                signal.pending_activity_unref();
                // `signal.unref()` — handled by `AbortSignalRef::Drop`.
            }
        }
    }
    impl Unprotect for ReadFile {
        #[inline]
        fn unprotect(&mut self) {
            self.path.unprotect();
            // Signal unref handled by `Drop` (idempotent via `.take()`).
        }
    }
    impl ReadFile {
        pub fn to_thread_safe(&mut self) {
            self.path.to_thread_safe();
        }
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<ReadFile> {
            // `errdefer path.deinit()` → `Drop` on `path` covers every
            // `?`-propagated JsError below (matches node_fs.zig).
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_arguments(format_args!(
                    "path must be a string or a file descriptor"
                ))
            })?;
            let mut encoding = Encoding::Buffer;
            let mut flag = FileSystemFlags::R;
            let mut abort_signal = scopeguard::guard(None::<AbortSignalRef>, |s| {
                if let Some(signal) = s {
                    signal.pending_activity_unref(); /* unref via Drop */
                }
            });
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_string() {
                    encoding = Encoding::assert(arg, ctx, encoding)?;
                } else if arg.is_object() {
                    encoding = get_encoding(arg, ctx, encoding)?;
                    if let Some(flag_) = arg.get_truthy(ctx, "flag")? {
                        flag = FileSystemFlags::from_js(ctx, flag_)?.ok_or_else(|| {
                            ctx.throw_invalid_arguments(format_args!("Invalid flag"))
                        })?;
                    }
                    if let Some(value) = arg.get_truthy(ctx, "signal")? {
                        if let Some(signal) = AbortSignal::ref_from_js(value) {
                            signal.pending_activity_ref();
                            *abort_signal = Some(signal);
                        } else {
                            return Err(ctx.throw_invalid_argument_type_value(
                                b"signal",
                                b"AbortSignal",
                                value,
                            ));
                        }
                    }
                }
            }
            let abort_signal = scopeguard::ScopeGuard::into_inner(abort_signal);
            Ok(ReadFile {
                path,
                encoding,
                flag,
                limit_size_for_javascript: true,
                signal: abort_signal,
                ..Default::default()
            })
        }
        pub fn aborted(&self) -> bool {
            if let Some(signal) = &self.signal {
                return signal.aborted();
            }
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
    impl Drop for WriteFile {
        fn drop(&mut self) {
            // Zig `deinit()`: release the AbortSignal ref taken in `from_js`.
            // `file`/`data` release via their own `Drop` (PathLike/StringOrBuffer).
            if let Some(signal) = self.signal.take() {
                signal.pending_activity_unref();
                // `signal.unref()` — handled by `AbortSignalRef::Drop`.
            }
        }
    }
    impl WriteFile {
        pub fn to_thread_safe(&mut self) {
            self.file.to_thread_safe();
            self.data.to_thread_safe();
        }
    }
    impl Unprotect for WriteFile {
        #[inline]
        fn unprotect(&mut self) {
            self.file.unprotect();
            self.data.unprotect();
            // Signal unref handled by `Drop` (idempotent via `.take()`).
        }
    }
    impl WriteFile {
        pub fn from_js(
            ctx: &JSGlobalObject,
            arguments: &mut ArgumentsSlice,
        ) -> JsResult<WriteFile> {
            // `errdefer path.deinit()` → `Drop` on `path` covers every
            // `?`-propagated JsError below (matches node_fs.zig).
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_arguments(format_args!(
                    "path must be a string or a file descriptor"
                ))
            })?;
            let data_value = arguments
                .next_eat()
                .ok_or_else(|| ctx.throw_invalid_arguments(format_args!("data is required")))?;
            let mut encoding = Encoding::Buffer;
            let mut flag = FileSystemFlags::W;
            let mut mode: Mode = DEFAULT_PERMISSION;
            let mut abort_signal = scopeguard::guard(None::<AbortSignalRef>, |s| {
                if let Some(signal) = s {
                    signal.pending_activity_unref(); /* unref via Drop */
                }
            });
            let mut flush = false;
            if data_value.is_string() {
                encoding = Encoding::Utf8;
            }
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_string() {
                    encoding = Encoding::assert(arg, ctx, encoding)?;
                } else if arg.is_object() {
                    encoding = get_encoding(arg, ctx, encoding)?;
                    if let Some(flag_) = arg.get_truthy(ctx, "flag")? {
                        flag = FileSystemFlags::from_js(ctx, flag_)?.ok_or_else(|| {
                            ctx.throw_invalid_arguments(format_args!("Invalid flag"))
                        })?;
                    }
                    if let Some(mode_) = arg.get_truthy(ctx, "mode")? {
                        mode = node::mode_from_js(ctx, mode_)?.unwrap_or(mode);
                    }
                    if let Some(value) = arg.get_truthy(ctx, "signal")? {
                        if let Some(signal) = AbortSignal::ref_from_js(value) {
                            signal.pending_activity_ref();
                            *abort_signal = Some(signal);
                        } else {
                            return Err(ctx.throw_invalid_argument_type_value(
                                b"signal",
                                b"AbortSignal",
                                value,
                            ));
                        }
                    }
                    if let Some(flush_) = arg.get(ctx, "flush")? {
                        if flush_.is_boolean() || flush_.is_undefined_or_null() {
                            flush = flush_ == JSValue::TRUE;
                        } else {
                            return Err(
                                ctx.throw_invalid_argument_type_value(b"flush", b"boolean", flush_)
                            );
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
                .ok_or_else(|| validators::throw_err_invalid_arg_type_with_message(ctx, format_args!("The \"data\" argument must be of type string or an instance of Buffer, TypedArray, or DataView")))?;
            let abort_signal = scopeguard::ScopeGuard::into_inner(abort_signal);
            Ok(WriteFile {
                file: path,
                encoding,
                flag,
                mode,
                data,
                dirfd: FD::cwd(),
                signal: abort_signal,
                flush,
            })
        }
        pub fn aborted(&self) -> bool {
            if let Some(signal) = &self.signal {
                return signal.aborted();
            }
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
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<OpenDir> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let mut encoding = Encoding::Buffer;
            let mut buffer_size: c_int = 32;
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_string() {
                    encoding = Encoding::assert(arg, ctx, encoding).unwrap_or(encoding);
                } else if arg.is_object() {
                    // PORT NOTE: Zig calls `getEncoding(arg, ctx)` (two args) — relies on
                    // Zig's default-param coercion to `Encoding.utf8`. Preserve behaviour.
                    if let Ok(e) = get_encoding(arg, ctx, encoding) {
                        encoding = e;
                    }
                    if let Some(bs) = arg.get(ctx, "bufferSize")? {
                        buffer_size = bs.to_int32();
                        if buffer_size < 0 {
                            return Err(
                                ctx.throw_invalid_arguments(format_args!("bufferSize must be > 0"))
                            );
                        }
                    }
                }
            }
            Ok(OpenDir {
                path,
                encoding,
                buffer_size,
            })
        }
    }

    pub struct Exists {
        pub path: Option<PathLike>,
    }
    impl Exists {
        pub fn to_thread_safe(&mut self) {
            if let Some(p) = &mut self.path {
                p.to_thread_safe();
            }
        }
    }
    impl Unprotect for Exists {
        #[inline]
        fn unprotect(&mut self) {
            if let Some(p) = &mut self.path {
                p.unprotect();
            }
        }
    }
    impl Exists {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Exists> {
            Ok(Exists {
                path: PathLike::from_js(ctx, arguments)?,
            })
        }
    }

    pub struct Access {
        pub path: PathLike,
        pub mode: FileSystemFlags,
    }
    fs_args_path_forwarders!(Access; path);
    impl Access {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Access> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let mut mode = FileSystemFlags::R;
            if let Some(arg) = arguments.next() {
                arguments.eat();
                mode = FileSystemFlags::from_js_number_only(ctx, arg, FileSystemFlagsKind::Access)?;
            }
            Ok(Access { path, mode })
        }
    }

    pub struct FdataSync {
        pub fd: FD,
    }
    impl FdataSync {
        pub fn to_thread_safe(&self) {}
        pub fn from_js(
            ctx: &JSGlobalObject,
            arguments: &mut ArgumentsSlice,
        ) -> JsResult<FdataSync> {
            let fd = FD::from_js_required(ctx, arguments)?;
            Ok(FdataSync { fd })
        }
    }

    pub struct CopyFile {
        pub src: PathLike,
        pub dest: PathLike,
        pub mode: constants::Copyfile,
    }
    fs_args_path_forwarders!(CopyFile; src, dest);
    impl CopyFile {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<CopyFile> {
            let src = PathLike::from_js_required(ctx, arguments, "src")?;
            // `errdefer src.deinit()` → `Drop for PathLike` on early return.
            let dest = PathLike::from_js_required(ctx, arguments, "dest")?;
            let mut mode = constants::Copyfile::from_raw(0);
            if let Some(arg) = arguments.next() {
                arguments.eat();
                mode = constants::Copyfile::from_raw(
                    FileSystemFlags::from_js_number_only(ctx, arg, FileSystemFlagsKind::CopyFile)?
                        .as_int(),
                );
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
        fn default() -> Self {
            Self {
                mode: constants::Copyfile::from_raw(0),
                recursive: false,
                error_on_exist: false,
                force: false,
                deinit_paths: true,
            }
        }
    }

    pub struct Cp {
        pub src: PathLike,
        pub dest: PathLike,
        pub flags: CpFlags,
    }
    fs_args_path_forwarders!(Cp; src, dest);
    impl Cp {
        #[inline]
        pub fn into_thread_safe(mut self) -> ThreadSafe<Self> {
            self.to_thread_safe();
            ThreadSafe::adopt(self)
        }
        // Zig `deinit()` was gated on `flags.deinit_paths`; in Rust the
        // `PathLike::String` arm's `Drop` is a no-op for borrowed `PathString`
        // payloads (the only `deinit_paths: false` caller — shell `cp`), so the
        // flag is vestigial and the explicit hook is gone.
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Cp> {
            let src = PathLike::from_js_required(ctx, arguments, "src")?;
            // `errdefer src.deinit()` → `Drop for PathLike` on early return.
            let dest = PathLike::from_js_required(ctx, arguments, "dest")?;
            let mut recursive = false;
            let mut error_on_exist = false;
            let mut force = true;
            let mut mode: i32 = 0;
            if let Some(arg) = arguments.next() {
                arguments.eat();
                recursive = arg.to_boolean();
            }
            if let Some(arg) = arguments.next() {
                arguments.eat();
                error_on_exist = arg.to_boolean();
            }
            if let Some(arg) = arguments.next() {
                arguments.eat();
                force = arg.to_boolean();
            }
            if let Some(arg) = arguments.next() {
                arguments.eat();
                if arg.is_number() {
                    mode = arg.coerce::<i32>(ctx)?;
                }
            }
            Ok(Cp {
                src,
                dest,
                flags: CpFlags {
                    mode: constants::Copyfile::from_raw(mode),
                    recursive,
                    error_on_exist,
                    force,
                    deinit_paths: true,
                },
            })
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
    pub type Watch<'a> = super::Watcher::Arguments<'a>;
    // `StatWatcher::Arguments` owns its `PathLike` (no borrowed slice), so it
    // has no lifetime parameter — unlike `Watcher::Arguments<'a>` above.
    pub type WatchFile = super::StatWatcher::Arguments;

    pub struct Fsync {
        pub fd: FD,
    }
    impl Fsync {
        pub fn to_thread_safe(&self) {}
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Fsync> {
            let fd = FD::from_js_required(ctx, arguments)?;
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
    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            StatOrNotFound::Stats(s) => s.to_js_newly_created(global_object),
            StatOrNotFound::NotFound => Ok(JSValue::UNDEFINED),
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
            StringOrUndefined::String(s) => {
                bun_jsc::bun_string_jsc::transfer_to_js(s, global_object)
            }
            StringOrUndefined::None => Ok(JSValue::UNDEFINED),
        }
    }
}

/// For use in `Return`'s definitions to act as `void` while returning `null` to JavaScript
pub struct Null;
impl Null {
    pub fn to_js(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::NULL
    }
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

    pub struct Read {
        pub bytes_read: u64, /* u52 */
    }
    impl Read {
        pub fn to_js(&self, _: &JSGlobalObject) -> JSValue {
            JSValue::js_number_from_uint64(self.bytes_read)
        }
    }

    pub struct ReadPromise {
        pub bytes_read: u64,
        pub buffer_val: JSValue,
    }
    impl ReadPromise {
        const FIELD_BYTES_READ: ZigString = ZigString::init_static(b"bytesRead");
        const FIELD_BUFFER: ZigString = ZigString::init_static(b"buffer");
        pub fn to_js(&self, ctx: &JSGlobalObject) -> JsResult<JSValue> {
            let _unprotect = scopeguard::guard(self.buffer_val, |v| {
                if !v.is_empty_or_undefined_or_null() {
                    v.unprotect()
                }
            });
            JSValue::create_object2(
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
        pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            let _unprotect = scopeguard::guard(self.buffer_val, |v| {
                if !v.is_empty_or_undefined_or_null() {
                    v.unprotect()
                }
            });
            let buffer_js = if matches!(self.buffer, StringOrBuffer::Buffer(_)) {
                self.buffer_val
            } else {
                self.buffer.to_js(global_object)?
            };
            JSValue::create_object2(
                global_object,
                &Self::FIELD_BYTES_WRITTEN,
                &Self::FIELD_BUFFER,
                JSValue::js_number_from_uint64(self.bytes_written.min((1u64 << 52) - 1)),
                buffer_js,
            )
        }
    }

    pub struct Write {
        pub bytes_written: u64, /* u52 */
    }
    impl Write {
        // Excited for the issue that's like "cannot read file bigger than 2 GB"
        pub fn to_js(&self, _: &JSGlobalObject) -> JSValue {
            JSValue::js_number_from_uint64(self.bytes_written)
        }
    }

    #[derive(Copy, Clone, PartialEq, Eq)]
    pub enum ReaddirTag {
        WithFileTypes,
        Buffers,
        Files,
    }

    pub enum Readdir {
        WithFileTypes(Box<[Dirent]>),
        Buffers(Box<[Buffer]>),
        Files(Box<[BunString]>),
    }
    impl Readdir {
        pub fn to_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            match self {
                Readdir::WithFileTypes(mut items) => {
                    let array = JSValue::create_empty_array(global_object, items.len())?;
                    let mut previous_jsstring: *mut bun_jsc::JSString = core::ptr::null_mut();
                    for (i, item) in items.iter_mut().enumerate() {
                        let res =
                            item.to_js_newly_created(global_object, Some(&mut previous_jsstring))?;
                        array.put_index(global_object, i as u32, res)?;
                    }
                    // items dropped here (auto free)
                    Ok(array)
                }
                Readdir::Buffers(items) => {
                    // `JSValue.fromAny(_, []Buffer, _)` — generic-slice arm:
                    // build an empty array, push `item.toJS(globalObject)` for
                    // each. Ownership of every `Buffer`'s bytes transfers to
                    // JSC via `MarkedArrayBuffer::to_js`; the boxed slice
                    // itself is freed when `items` drops (Zig: `defer
                    // bun.default_allocator.free(this.buffers)`).
                    let array = JSValue::create_empty_array(global_object, items.len())?;
                    for (i, item) in items.iter().enumerate() {
                        let res = item.to_js(global_object)?;
                        if res == JSValue::ZERO {
                            return Ok(JSValue::ZERO);
                        }
                        array.put_index(global_object, i as u32, res)?;
                    }
                    Ok(array)
                }
                Readdir::Files(items) => {
                    // `JSValue.fromAny(_, []const bun.String, _)` — dedicated
                    // arm: `bun.String.toJSArray` then deref every element +
                    // free the slice (handled by the `FromAny for
                    // Box<[bun_core::String]>` impl).
                    JSValue::from_any(global_object, items)
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

// `#[repr(C)]` pins `sync_error_buf` (a `[u8; N]`, nominal align = 1) at
// offset 0. The struct's overall alignment is ≥ `align_of::<*const ()>()`
// (from the `vm` field), so the buffer's address inherits that alignment —
// the Rust equivalent of Zig's `sync_error_buf: bun.PathBuffer align(@alignOf(u16))`.
// This is load-bearing on Windows where `sync_error_buf` is reinterpreted as
// `&mut [u16]` / `&mut WPathBuffer` (see `mkdir_recursive_os_path_impl` and
// the `os_path_kernel32` callers); a misaligned `&mut [u16]` is instant UB.
#[repr(C)]
pub struct NodeFS {
    /// Buffer to store a temporary file path that might appear in a returned error message.
    ///
    /// We want to avoid allocating a new path buffer for every error message so that jsc can clone + GC it.
    /// That means a stack-allocated buffer won't suffice. Instead, we re-use
    /// the heap allocated buffer on the NodeFS struct
    pub sync_error_buf: PathBuffer, // align(@alignOf(u16)) — enforced via #[repr(C)] + field order, see above
    pub vm: Option<NonNull<VirtualMachine>>,
}

impl Default for NodeFS {
    fn default() -> Self {
        Self {
            sync_error_buf: PathBuffer::uninit(),
            vm: None,
        }
    }
}

// `pub type ReturnType = ret;` (Zig: `pub const ReturnType = Return;`) — Rust
// inherent `type` aliases can't name a module. Expose it as a `pub use` at the
// containing module level instead so `NodeFS::ReturnType::Foo` callers (none
// yet in-tree) keep working via `node::fs::ReturnType::Foo`.
pub use ret as ReturnType;

impl NodeFS {
    pub fn access(&mut self, args: &args::Access, _: Flavor) -> Maybe<ret::Access> {
        // PORT: Zig passes `osPathKernel32(...)` (wide on Windows) into
        // `Syscall.access(OSPathSliceZ)`. The Rust `bun_sys::access` Windows
        // arm takes `&ZStr` and performs the kernel32 widening internally
        // (sys/lib.rs `windows_impl::access`), so feed it the UTF-8 path on
        // every platform — net behaviour is identical.
        let path: &ZStr = if args.path.slice().is_empty() {
            ZStr::EMPTY
        } else {
            args.path.slice_z(&mut self.sync_error_buf)
        };
        match Syscall::access(path, args.mode.as_int()) {
            Err(err) => Err(err.with_path(args.path.slice())),
            Ok(_) => Ok(Null),
        }
    }

    pub fn append_file(&mut self, args: &args::AppendFile, _: Flavor) -> Maybe<ret::AppendFile> {
        let mut data = args.data.slice();
        match &args.file {
            PathOrFileDescriptor::Fd(fd) => {
                while !data.is_empty() {
                    let written = match Syscall::write(*fd, data) {
                        Ok(result) => result,
                        Err(err) => return Err(err),
                    };
                    data = &data[written..];
                }
                Ok(())
            }
            PathOrFileDescriptor::Path(path_) => {
                let path = path_.slice_z(&mut self.sync_error_buf);
                let fd = match Syscall::open(path, FileSystemFlags::A.as_int(), args.mode) {
                    Ok(result) => result,
                    Err(err) => return Err(err),
                };
                let _close = scopeguard::guard(fd, |fd| fd.close());
                while !data.is_empty() {
                    let written = match Syscall::write(fd, data) {
                        Ok(result) => result,
                        Err(err) => return Err(err),
                    };
                    data = &data[written..];
                }
                Ok(())
            }
        }
    }

    pub fn close(&mut self, args: &args::Close, _: Flavor) -> Maybe<ret::Close> {
        if let Some(err) = args.fd.close_allowing_bad_file_descriptor(None) {
            Err(err)
        } else {
            Ok(())
        }
    }

    pub fn uv_close(&mut self, args: &args::Close, rc: i64) -> Maybe<ret::Close> {
        if rc < 0 {
            // `from_libuv` is `#[cfg(windows)]`-only on `bun_sys::Error`; build the
            // base value first and set it conditionally so this body compiles on all
            // targets (`uv_close` is reached via the cross-platform UVFSRequest path).
            #[allow(unused_mut)]
            let mut e = sys::Error {
                errno: (-rc) as _,
                syscall: sys::Tag::close,
                fd: args.fd,
                ..Default::default()
            };
            #[cfg(windows)]
            {
                e.from_libuv = true;
            }
            return Err(e);
        }
        Ok(())
    }

    // since we use a 64 KB stack buffer, we should not let this function get inlined
    #[inline(never)]
    pub fn copy_file_using_read_write_loop(
        src: &ZStr,
        dest: &ZStr,
        src_fd: FD,
        dest_fd: FD,
        stat_size: usize,
        wrote: &mut u64,
    ) -> Maybe<ret::CopyFile> {
        let mut stack_buf = [0u8; 64 * 1024];
        let stack_buf_len = stack_buf.len();
        let mut buf_to_free: Vec<u8> = Vec::new();
        let mut buf: &mut [u8] = &mut stack_buf;

        'maybe_allocate_large_temp_buf: {
            if stat_size > stack_buf_len * 16 {
                // Don't allocate more than 8 MB at a time
                let clamped_size: usize = stat_size.min(8 * 1024 * 1024);
                // PORT NOTE: Zig used `bun.default_allocator.alloc(u8, clamped_size)` —
                // uninitialised heap. `Vec::resize` here was a debug-build hot path
                // (byte-by-byte `extend_with`); use `expand_to_capacity` to match the spec
                // (the slab is write-only — `Syscall::read` fills it from the kernel).
                use bun_collections::vec_ext::VecExt as _;
                if buf_to_free.try_reserve_exact(clamped_size).is_err() {
                    break 'maybe_allocate_large_temp_buf;
                }
                // SAFETY: `u8` has no validity invariant; the buffer is handed
                // straight to the kernel which only stores into it.
                unsafe { buf_to_free.expand_to_capacity() };
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
            let read_len = (buf.len() as u64).min(remain) as usize;
            let amt = match Syscall::read(src_fd, &mut buf[..read_len]) {
                Ok(result) => result,
                Err(err) => {
                    return Err(if !src.is_empty() {
                        err.with_path(src)
                    } else {
                        err
                    });
                }
            };
            // 0 == EOF
            if amt == 0 {
                broke = true;
                break 'toplevel;
            }
            *wrote += amt as u64;
            remain = remain.saturating_sub(amt as u64);

            let mut slice = &buf[..amt];
            while !slice.is_empty() {
                let written = match Syscall::write(dest_fd, slice) {
                    Ok(result) => result,
                    Err(err) => {
                        return Err(if !dest.is_empty() {
                            err.with_path(dest)
                        } else {
                            err
                        });
                    }
                };
                if written == 0 {
                    broke = true;
                    break 'toplevel;
                }
                slice = &slice[written..];
            }
        }
        if !broke {
            'outer: loop {
                let amt = match Syscall::read(src_fd, buf) {
                    Ok(result) => result,
                    Err(err) => {
                        return Err(if !src.is_empty() {
                            err.with_path(src)
                        } else {
                            err
                        });
                    }
                };
                // we don't know the size
                // so we just go forever until we get an EOF
                if amt == 0 {
                    break;
                }
                *wrote += amt as u64;

                let mut slice = &buf[..amt];
                while !slice.is_empty() {
                    let written = match Syscall::write(dest_fd, slice) {
                        Ok(result) => result,
                        Err(err) => {
                            return Err(if !dest.is_empty() {
                                err.with_path(dest)
                            } else {
                                err
                            });
                        }
                    };
                    slice = &slice[written..];
                    if written == 0 {
                        break 'outer;
                    }
                }
            }
        }

        Ok(())
    }

    // copy_file_range() is frequently not supported across devices, such as tmpfs.
    // This is relevant for `bun install`
    // However, sendfile() is supported across devices.
    // Only on Linux. There are constraints though. It cannot be used if the file type does not support
    #[inline(never)]
    pub fn copy_file_using_sendfile_on_linux_with_read_write_fallback(
        src: &ZStr,
        dest: &ZStr,
        src_fd: FD,
        dest_fd: FD,
        stat_size: usize,
        wrote: &mut u64,
    ) -> Maybe<ret::CopyFile> {
        loop {
            let amt = match sys::sendfile(src_fd, dest_fd, i32::MAX as usize - 1) {
                Err(_) => {
                    return Self::copy_file_using_read_write_loop(
                        src, dest, src_fd, dest_fd, stat_size, wrote,
                    );
                }
                Ok(amount) => amount,
            };
            *wrote += amt as u64;
            if amt == 0 {
                break;
            }
        }
        Ok(())
    }

    pub fn copy_file(&mut self, args: &args::CopyFile, _: Flavor) -> Maybe<ret::CopyFile> {
        match self.copy_file_inner(args) {
            Ok(_) => Ok(()),
            Err(err) => Err(sys::Error {
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
                return Maybe::<ret::CopyFile>::errno_sys_p(
                    bun_sys::c::clonefile_rc(src, dest, 0),
                    sys::Tag::copyfile,
                    src,
                )
                .unwrap_or(Ok(()));
            } else {
                let stat_ = match Syscall::stat(src) {
                    Ok(result) => result,
                    Err(err) => return Err(err.with_path(src)),
                };

                if !sys::S::ISREG(stat_.st_mode as u32) {
                    return Err(sys::Error {
                        errno: SystemErrno::ENOTSUP as _,
                        syscall: sys::Tag::copyfile,
                        ..Default::default()
                    });
                }

                // 64 KB is about the break-even point for clonefile() to be worth it
                // at least, on an M1 with an NVME SSD.
                if stat_.st_size > 128 * 1024 {
                    if !args.mode.shouldnt_overwrite() {
                        // clonefile() will fail if it already exists
                        let _ = Syscall::unlink(dest);
                    }
                    if Maybe::<ret::CopyFile>::errno_sys_p(
                        bun_sys::c::clonefile_rc(src, dest, 0),
                        sys::Tag::copyfile,
                        src,
                    )
                    .is_none()
                    {
                        let _ = Syscall::chmod(dest, stat_.st_mode as u32);
                        return Ok(());
                    }
                } else {
                    let src_fd = match Syscall::open(src, sys::O::RDONLY, 0o644) {
                        Ok(result) => result,
                        Err(err) => return Err(err.with_path(args.src.slice())),
                    };
                    let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

                    let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
                    // VERIFY-FIX(round1): was `usize` then passed as `&mut (wrote as u64)` —
                    // that wrote into a discarded temporary so the deferred ftruncate
                    // always saw 0. The scopeguard variant also double-borrowed `wrote`.
                    // The Zig `defer` runs after `copy_file_using_read_write_loop` returns
                    // into this scope; there are no early returns between open(dest) and
                    // that call, so inlining the cleanup after is equivalent.
                    let mut wrote: u64 = 0;
                    if args.mode.shouldnt_overwrite() {
                        flags |= sys::O::EXCL;
                    }

                    let dest_fd = match Syscall::open(dest, flags, DEFAULT_PERMISSION) {
                        Ok(result) => result,
                        Err(err) => return Err(err.with_path(args.dest.slice())),
                    };

                    let result = Self::copy_file_using_read_write_loop(
                        src,
                        dest,
                        src_fd,
                        dest_fd,
                        stat_.st_size.max(0) as usize,
                        &mut wrote,
                    );
                    let _ = Syscall::ftruncate(dest_fd, (wrote & ((1u64 << 63) - 1)) as i64);
                    let _ = Syscall::fchmod(dest_fd, stat_.st_mode as u32);
                    dest_fd.close();
                    return result;
                }
            }

            // we fallback to copyfile() when the file is > 128 KB and clonefile fails
            // clonefile() isn't supported on all devices
            // nor is it supported across devices
            let mut mode: u32 = bun_sys::c::COPYFILE_ACL | bun_sys::c::COPYFILE_DATA;
            if args.mode.shouldnt_overwrite() {
                mode |= bun_sys::c::COPYFILE_EXCL;
            }
            return Maybe::<ret::CopyFile>::errno_sys_p(
                bun_sys::c::copyfile_rc(src, dest, mode),
                sys::Tag::copyfile,
                src,
            )
            .unwrap_or(Ok(()));
        }

        #[cfg(target_os = "freebsd")]
        {
            let mut src_buf = PathBuffer::uninit();
            let mut dest_buf = PathBuffer::uninit();
            let src = args.src.slice_z(&mut src_buf);
            let dest = args.dest.slice_z(&mut dest_buf);

            if args.mode.is_force_clone() {
                return Err(sys::Error {
                    errno: SystemErrno::EOPNOTSUPP as _,
                    syscall: sys::Tag::copyfile,
                    ..Default::default()
                });
            }

            let src_fd = match Syscall::open(src, sys::O::RDONLY, 0) {
                Ok(result) => result,
                Err(err) => return Err(err.with_path(args.src.slice())),
            };
            let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

            let stat_ = match Syscall::fstat(src_fd) {
                Ok(result) => result,
                Err(err) => return Err(err),
            };
            if !sys::S::ISREG(stat_.st_mode as u32) {
                return Err(sys::Error {
                    errno: SystemErrno::EOPNOTSUPP as _,
                    syscall: sys::Tag::copyfile,
                    ..Default::default()
                });
            }

            let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
            if args.mode.shouldnt_overwrite() {
                flags |= sys::O::EXCL;
            }
            let dest_fd = match Syscall::open(dest, flags, DEFAULT_PERMISSION) {
                Ok(result) => result,
                Err(err) => return Err(err),
            };
            let _close_dest = scopeguard::guard(dest_fd, |fd| fd.close());

            // Don't O_TRUNC at open: if src and dest resolve to the same
            // inode, that would zero the file before the first read. Match
            // Node by checking inodes after both are open and refusing.
            if let Ok(dst_stat) = Syscall::fstat(dest_fd) {
                if stat_.st_ino == dst_stat.st_ino && stat_.st_dev == dst_stat.st_dev {
                    return Err(sys::Error {
                        errno: SystemErrno::EINVAL as _,
                        syscall: sys::Tag::copyfile,
                        path: args.src.slice().into(),
                        ..Default::default()
                    });
                }
            }
            let _ = Syscall::ftruncate(dest_fd, 0);

            // FreeBSD 13+ has copy_file_range(2). Try the kernel-side copy
            // first; fall back to read/write on cross-device or unsupported
            // fd types. std.c declares it returning usize on FreeBSD, so
            // bitcast to isize before getErrno.
            'cfr: loop {
                // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI.
                // Null offsets so the kernel advances the file's seek position — matches
                // `std.c.copy_file_range(..., null, ..., null, ...)` and keeps the read/write
                // fallback (which uses the seek position) coherent if we ever break mid-loop.
                let rc: isize = unsafe {
                    sys::freebsd::copy_file_range(
                        src_fd.native(),
                        core::ptr::null_mut(),
                        dest_fd.native(),
                        core::ptr::null_mut(),
                        (i32::MAX - 1) as usize,
                        0,
                    )
                } as isize;
                match sys::get_errno(rc) {
                    E::SUCCESS => {
                        if rc == 0 {
                            let _ = Syscall::fchmod(dest_fd, stat_.st_mode as Mode);
                            return Ok(());
                        }
                    }
                    E::EINTR => continue,
                    E::EXDEV | E::EINVAL | E::EOPNOTSUPP | E::EBADF => break 'cfr,
                    e => {
                        let _ = sys::unlink(dest);
                        return Err(sys::Error {
                            errno: e as _,
                            syscall: sys::Tag::copyfile,
                            ..Default::default()
                        });
                    }
                }
            }

            let mut wrote: u64 = 0;
            if let Err(err) = Self::copy_file_using_read_write_loop(
                src,
                dest,
                src_fd,
                dest_fd,
                stat_.st_size.max(0) as usize,
                &mut wrote,
            ) {
                let _ = sys::unlink(dest);
                return Err(err);
            }
            let _ = Syscall::fchmod(dest_fd, stat_.st_mode as Mode);
            return Ok(());
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let mut src_buf = PathBuffer::uninit();
            let mut dest_buf = PathBuffer::uninit();
            let src = args.src.slice_z(&mut src_buf);
            let dest = args.dest.slice_z(&mut dest_buf);

            let src_fd = match Syscall::open(src, sys::O::RDONLY, 0o644) {
                Ok(result) => result,
                Err(err) => return Err(err),
            };
            let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

            let stat_ = match Syscall::fstat(src_fd) {
                Ok(result) => result,
                Err(err) => return Err(err),
            };

            if !sys::S::ISREG(stat_.st_mode as u32) {
                return Err(sys::Error {
                    errno: SystemErrno::ENOTSUP as _,
                    syscall: sys::Tag::copyfile,
                    ..Default::default()
                });
            }

            let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
            // VERIFY-FIX(round1): `wrote` is read by the deferred-close scopeguard
            // *after* the copy loops below mutate it. As a `usize` captured by-copy
            // the guard always saw 0, and the `&mut (wrote as u64)` call sites
            // wrote into discarded temporaries. `Cell<u64>` lets the guard borrow
            // by reference while the loops `get`/`set`, matching Zig's `var wrote: u64`
            // observed by `defer` at scope-exit time.
            let wrote: core::cell::Cell<u64> = core::cell::Cell::new(0);
            if args.mode.shouldnt_overwrite() {
                flags |= sys::O::EXCL;
            }

            let dest_fd = match Syscall::open(dest, flags, DEFAULT_PERMISSION) {
                Ok(result) => result,
                Err(err) => return Err(err),
            };

            let mut size: usize = stat_.st_size.max(0) as usize;

            // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
            if args.mode.is_force_clone() {
                if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(
                    sys::linux::ioctl_ficlone(dest_fd, src_fd),
                    sys::Tag::ioctl_ficlone,
                    dest,
                ) {
                    dest_fd.close();
                    // This is racey, but it's the best we can do
                    let _ = sys::unlink(dest);
                    return err;
                }
                let _ = Syscall::fchmod(dest_fd, stat_.st_mode as u32);
                dest_fd.close();
                return Ok(());
            }

            // If we know it's a regular file and ioctl_ficlone is available, attempt to use it.
            if sys::S::ISREG(stat_.st_mode as u32) && sys::copy_file::can_use_ioctl_ficlone() {
                let rc = sys::linux::ioctl_ficlone(dest_fd, src_fd);
                if rc == 0 {
                    let _ = Syscall::fchmod(dest_fd, stat_.st_mode as u32);
                    dest_fd.close();
                    return Ok(());
                }
                // If this fails for any reason, we say it's disabled
                // We don't want to add the system call overhead of running this function on a lot of files that don't support it
                sys::copy_file::disable_ioctl_ficlone();
            }

            let _close_dest =
                scopeguard::guard((dest_fd, stat_.st_mode, &wrote), |(fd, m, wrote)| {
                    // ftruncate/fchmod take only ints — no memory-safety preconditions; route
                    // through the existing `bun_sys` safe wrappers (same as lines above).
                    let _ = Syscall::ftruncate(fd, (wrote.get() & ((1u64 << 63) - 1)) as i64);
                    let _ = Syscall::fchmod(fd, m as u32);
                    fd.close();
                });

            let mut off_in_copy: i64 = 0;
            let mut off_out_copy: i64 = 0;

            if !sys::copy_file::can_use_copy_file_range_syscall() {
                let mut w = wrote.get();
                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(
                    src, dest, src_fd, dest_fd, size, &mut w,
                );
                wrote.set(w);
                return r;
            }

            if size == 0 {
                // copy until EOF
                loop {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                    let written = unsafe {
                        sys::linux::copy_file_range(
                            src_fd.native(),
                            &raw mut off_in_copy,
                            dest_fd.native(),
                            &raw mut off_out_copy,
                            sys::page_size(),
                            0,
                        )
                    };
                    if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(
                        written,
                        sys::Tag::copy_file_range,
                        dest,
                    ) {
                        match err.get_errno() {
                            E::EINTR => continue,
                            E::EXDEV | E::ENOSYS | E::EINVAL | E::EOPNOTSUPP => {
                                if matches!(err.get_errno(), E::ENOSYS | E::EOPNOTSUPP) {
                                    sys::copy_file::disable_copy_file_range_syscall();
                                }
                                let mut w = wrote.get();
                                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut w);
                                wrote.set(w);
                                return r;
                            }
                            _ => return err,
                        }
                    }
                    // wrote zero bytes means EOF
                    if written == 0 {
                        break;
                    }
                    wrote.set(wrote.get().saturating_add(written as u64));
                }
            } else {
                while size > 0 {
                    // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                    let written = unsafe {
                        sys::linux::copy_file_range(
                            src_fd.native(),
                            &raw mut off_in_copy,
                            dest_fd.native(),
                            &raw mut off_out_copy,
                            size,
                            0,
                        )
                    };
                    if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(
                        written,
                        sys::Tag::copy_file_range,
                        dest,
                    ) {
                        match err.get_errno() {
                            E::EINTR => continue,
                            E::EXDEV | E::ENOSYS | E::EINVAL | E::EOPNOTSUPP => {
                                if matches!(err.get_errno(), E::ENOSYS | E::EOPNOTSUPP) {
                                    sys::copy_file::disable_copy_file_range_syscall();
                                }
                                let mut w = wrote.get();
                                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut w);
                                wrote.set(w);
                                return r;
                            }
                            _ => return err,
                        }
                    }
                    if written == 0 {
                        break;
                    }
                    wrote.set(wrote.get().saturating_add(written as u64));
                    size = size.saturating_sub(written as usize);
                }
            }

            return Ok(());
        }

        #[cfg(windows)]
        {
            let mut dest_buf = paths::os_path_buffer_pool::get();
            let src = strings::to_kernel32_path(
                bun_core::cast_slice_mut::<u8, u16>(&mut self.sync_error_buf),
                args.src.slice(),
            );
            let dest = strings::to_kernel32_path(&mut *dest_buf, args.dest.slice());
            // SAFETY: src/dest are NUL-terminated wide paths; CopyFileW is the Win32 FFI
            if unsafe {
                windows::CopyFileW(
                    src.as_ptr(),
                    dest.as_ptr(),
                    if args.mode.shouldnt_overwrite() { 1 } else { 0 },
                )
            } == windows::FALSE
            {
                if let Some(rest) =
                    Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, args.src.slice())
                {
                    return Self::should_ignore_ebusy(&args.src, &args.dest, rest);
                }
            }
            return Ok(());
        }

        #[allow(unreachable_code)]
        {
            unreachable!()
        }
    }

    pub fn exists(&mut self, args: &args::Exists, _: Flavor) -> Maybe<ret::Exists> {
        // NOTE: exists cannot return an error
        let Some(path) = &args.path else {
            return Ok(false);
        };

        if let Some(graph) = standalone_module_graph_get() {
            // SAFETY: see `standalone_module_graph_get` — exclusive lookup on
            // the per-process singleton; `find` only mutates lazy per-`File`
            // fields.
            if unsafe { &mut *graph }.find(path.slice()).is_some() {
                return Ok(true);
            }
        }

        let slice = if path.slice().is_empty() {
            os_path_literal_empty()
        } else {
            path.os_path_kernel32(&mut self.sync_error_buf)
        };

        Ok(sys::exists_os_path(slice, false))
    }

    pub fn chown(&mut self, args: &args::Chown, _: Flavor) -> Maybe<ret::Chown> {
        #[cfg(windows)]
        {
            return match Syscall::chown(
                args.path.slice_z(&mut self.sync_error_buf),
                args.uid,
                args.gid,
            ) {
                Err(err) => Err(err.with_path(args.path.slice())),
                Ok(res) => Ok(res),
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
                Err(err) => Err(err.with_path(args.path.slice())),
                Ok(res) => Ok(res),
            };
        }
        match Syscall::chmod(path, args.mode) {
            Err(err) => Err(err.with_path(args.path.slice())),
            Ok(_) => Ok(()),
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
        {
            return Syscall::fdatasync(args.fd);
        }
        #[cfg(not(windows))]
        {
            // `fdatasync(int)` has no memory-safety preconditions (a bad fd just
            // yields EBADF), so declare it `safe fn` for all unix instead of
            // routing through `libc::fdatasync` (which is blanket-`unsafe`).
            // `libc` also omits the Darwin binding (fdatasync exists since 10.7).
            unsafe extern "C" {
                safe fn fdatasync(fd: libc::c_int) -> libc::c_int;
            }
            Maybe::<ret::Fdatasync>::errno_sys_fd(
                fdatasync(args.fd.native()),
                sys::Tag::fdatasync,
                args.fd,
            )
            .unwrap_or(Ok(()))
        }
    }

    pub fn fstat(&mut self, args: &args::Fstat, _: Flavor) -> Maybe<ret::Fstat> {
        #[cfg(target_os = "linux")]
        if sys::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
            return match sys::fstatx(args.fd, sys::STATX_MASK_FOR_STATS) {
                Ok(result) => Ok(Stats::init(&result, args.big_int)),
                Err(err) => Err(err),
            };
        }
        match Syscall::fstat(args.fd) {
            Ok(result) => Ok(Stats::init(&PosixStat::init(&result), args.big_int)),
            Err(err) => Err(err),
        }
    }

    pub fn fsync(&mut self, args: &args::Fsync, _: Flavor) -> Maybe<ret::Fsync> {
        #[cfg(windows)]
        {
            return Syscall::fsync(args.fd);
        }
        #[cfg(not(windows))]
        {
            // `fsync(int)` has no memory-safety preconditions (a bad fd just yields
            // EBADF), so declare it `safe fn` instead of routing through
            // `libc::fsync` (which is blanket-`unsafe`). Mirrors `fdatasync` above.
            unsafe extern "C" {
                safe fn fsync(fd: libc::c_int) -> libc::c_int;
            }
            Maybe::<ret::Fsync>::errno_sys(fsync(args.fd.native()), sys::Tag::fsync)
                .unwrap_or(Ok(()))
        }
    }

    pub fn ftruncate(&mut self, args: &args::FTruncate, _: Flavor) -> Maybe<ret::Ftruncate> {
        Syscall::ftruncate(args.fd, args.len.unwrap_or(0) as i64)
    }

    pub fn futimes(&mut self, args: &args::Futimes, _: Flavor) -> Maybe<ret::Futimes> {
        #[cfg(windows)]
        {
            let mut req = UvFsReq::new();
            let rc = unsafe {
                uv::uv_fs_futime(
                    uv::Loop::get(),
                    &mut *req,
                    args.fd.uv(),
                    args.atime,
                    args.mtime,
                    None,
                )
            };
            return if let Some(e) = rc.errno() {
                Err(sys::Error {
                    errno: e,
                    syscall: sys::Tag::futime,
                    fd: args.fd,
                    ..Default::default()
                })
            } else {
                Ok(())
            };
        }
        #[cfg(not(windows))]
        match Syscall::futimens(
            args.fd,
            to_sys_time_like(args.atime),
            to_sys_time_like(args.mtime),
        ) {
            Err(err) => Err(err),
            Ok(_) => Ok(()),
        }
    }

    pub fn lchmod(&mut self, args: &args::LCHmod, _: Flavor) -> Maybe<ret::Lchmod> {
        #[cfg(windows)]
        {
            return Maybe::<ret::Lchmod>::todo();
        }
        #[cfg(target_os = "android")]
        {
            // bionic has no lchmod(); symlink modes are meaningless on Linux
            // anyway. Match glibc's stub behaviour.
            return Err(sys::Error {
                errno: E::EOPNOTSUPP as _,
                syscall: sys::Tag::lchmod,
                path: args.path.slice().into(),
                ..Default::default()
            });
        }
        #[cfg(not(any(windows, target_os = "android")))]
        {
            let path = args.path.slice_z(&mut self.sync_error_buf);
            match Syscall::lchmod(path, args.mode) {
                Err(err) => Err(err.with_path(args.path.slice())),
                Ok(_) => Ok(()),
            }
        }
    }

    pub fn lchown(&mut self, args: &args::LChown, _: Flavor) -> Maybe<ret::Lchown> {
        #[cfg(windows)]
        {
            return Maybe::<ret::Lchown>::todo();
        }
        #[cfg(not(windows))]
        {
            let path = args.path.slice_z(&mut self.sync_error_buf);
            match Syscall::lchown(path, args.uid, args.gid) {
                Err(err) => Err(err.with_path(args.path.slice())),
                Ok(_) => Ok(()),
            }
        }
    }

    pub fn link(&mut self, args: &args::Link, _: Flavor) -> Maybe<ret::Link> {
        let mut to_buf = PathBuffer::uninit();
        let from = args.old_path.slice_z(&mut self.sync_error_buf);
        let to = args.new_path.slice_z(&mut to_buf);
        #[cfg(windows)]
        {
            return match Syscall::link(from, to) {
                Err(err) => Err(err.with_path_dest(args.old_path.slice(), args.new_path.slice())),
                Ok(result) => Ok(result),
            };
        }
        // SAFETY: `from`/`to` are NUL-terminated by `slice_z`; `link(2)` is the libc FFI.
        #[cfg(not(windows))]
        Maybe::<ret::Link>::errno_sys_pd(
            unsafe { libc::link(from.as_ptr().cast(), to.as_ptr().cast()) },
            sys::Tag::link,
            args.old_path.slice(),
            args.new_path.slice(),
        )
        .unwrap_or(Ok(()))
    }

    pub fn lstat(&mut self, args: &args::Lstat, _: Flavor) -> Maybe<ret::Lstat> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        #[cfg(target_os = "linux")]
        if sys::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
            return match sys::lstatx(path, sys::STATX_MASK_FOR_STATS) {
                Ok(result) => Ok(StatOrNotFound::Stats(Stats::init(&result, args.big_int))),
                Err(err) => {
                    if !args.throw_if_no_entry && err.get_errno() == E::ENOENT {
                        return Ok(StatOrNotFound::NotFound);
                    }
                    Err(err.with_path(args.path.slice()))
                }
            };
        }
        match Syscall::lstat(path) {
            Ok(result) => Ok(StatOrNotFound::Stats(Stats::init(
                &PosixStat::init(&result),
                args.big_int,
            ))),
            Err(err) => {
                if !args.throw_if_no_entry && err.get_errno() == E::ENOENT {
                    return Ok(StatOrNotFound::NotFound);
                }
                Err(err.with_path(args.path.slice()))
            }
        }
    }

    pub fn mkdir(&mut self, args: &args::Mkdir, _: Flavor) -> Maybe<ret::Mkdir> {
        if args.path.slice().is_empty() {
            return Err(sys::Error {
                errno: E::ENOENT as _,
                syscall: sys::Tag::mkdir,
                path: b"".as_slice().into(),
                ..Default::default()
            });
        }
        if args.recursive {
            self.mkdir_recursive(args)
        } else {
            self.mkdir_non_recursive(args)
        }
    }

    // Node doesn't absolute the path so we don't have to either
    pub fn mkdir_non_recursive(&mut self, args: &args::Mkdir) -> Maybe<ret::Mkdir> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        match Syscall::mkdir(path, args.mode) {
            Ok(_) => Ok(StringOrUndefined::None),
            Err(err) => Err(err.with_path(args.path.slice())),
        }
    }

    pub fn mkdir_recursive(&mut self, args: &args::Mkdir) -> Maybe<ret::Mkdir> {
        self.mkdir_recursive_impl::<()>(args, ())
    }

    pub fn mkdir_recursive_impl<Ctx: MkdirCtx>(
        &mut self,
        args: &args::Mkdir,
        ctx: Ctx,
    ) -> Maybe<ret::Mkdir> {
        let mut buf = paths::path_buffer_pool::get();
        let path = args.path.os_path_kernel32(&mut *buf);
        if args.always_return_none {
            self.mkdir_recursive_os_path_impl::<Ctx, false>(ctx, path, args.mode)
        } else {
            self.mkdir_recursive_os_path_impl::<Ctx, true>(ctx, path, args.mode)
        }
    }

    pub fn mkdir_recursive_os_path(
        &mut self,
        path: &OSPathSliceZ,
        mode: Mode,
        return_path: bool,
    ) -> Maybe<ret::Mkdir> {
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
        path: &OSPathSliceZ,
        mode: Mode,
    ) -> Maybe<ret::Mkdir> {
        let len: u16 = path.len() as u16;

        // First, attempt to create the desired directory
        // If that fails, then walk back up the path until we have a match
        match mkdir_os_path(path, mode) {
            Err(err) => match err.get_errno() {
                // `mkpath_np` in macOS also checks for `EISDIR`.
                // it is unclear if macOS lies about if the existing item is
                // a directory or not, so it is checked.
                E::EISDIR | E::EEXIST => {
                    return match directory_exists_at_os_path(FD::INVALID, path) {
                        Err(_) => Err(sys::Error {
                            errno: err.errno,
                            syscall: sys::Tag::mkdir,
                            path: self
                                .os_path_into_sync_error_buf(without_nt_prefix((&path[..])))
                                .into(),
                            ..Default::default()
                        }),
                        // if is a directory, OK. otherwise failure
                        Ok(result) => {
                            if result {
                                Ok(StringOrUndefined::None)
                            } else {
                                Err(sys::Error {
                                    errno: err.errno,
                                    syscall: sys::Tag::mkdir,
                                    path: self
                                        .os_path_into_sync_error_buf(without_nt_prefix((&path[..])))
                                        .into(),
                                    ..Default::default()
                                })
                            }
                        }
                    };
                }
                // continue
                E::ENOENT => {
                    if len == 0 {
                        // no path to copy
                        return Err(err);
                    }
                }
                _ => {
                    return Err(err.with_path(
                        self.os_path_into_sync_error_buf(&(&path[..])[..len as usize]),
                    ));
                }
            },
            Ok(_) => {
                ctx.on_create_dir(path);
                if !RETURN_PATH {
                    return Ok(StringOrUndefined::None);
                }
                return Ok(StringOrUndefined::String(BunString::create_from_os_path(
                    &path[..],
                )));
            }
        }

        // SAFETY: `NodeFS` is `#[repr(C)]` with `sync_error_buf` at offset 0 and
        // struct alignment ≥ pointer-align (from `vm`), so this address is
        // ≥ `align_of::<OSPathChar>()`-aligned (the Rust spelling of Zig's
        // `align(@alignOf(u16))` field annotation). On Windows
        // `OSPathBuffer = [u16; PATH_MAX_WIDE]` (65 534 B) which fits inside
        // `PathBuffer` (`MAX_PATH_BYTES` = 98 302 B); on POSIX it is the same
        // type. The `assert!` below mirrors Zig's `@alignCast` safety check.
        // Keep the raw `*mut PathBuffer` so error-return paths can re-derive a fresh
        // `&mut PathBuffer` without reborrowing `&mut self` (which would alias
        // `working_mem` under stacked borrows). On every such path `working_mem` is
        // not used afterward, so the re-derive is sound.
        let sync_error_buf_ptr: *mut PathBuffer = &raw mut self.sync_error_buf;
        assert!(
            sync_error_buf_ptr.cast::<OSPathChar>().is_aligned(),
            "NodeFS.sync_error_buf misaligned for OSPathChar",
        );
        let working_mem: &mut OSPathBuffer =
            unsafe { &mut *sync_error_buf_ptr.cast::<OSPathBuffer>() };
        working_mem[..len as usize].copy_from_slice(&(&path[..])[..len as usize]);

        let mut i: u16 = len - 1;

        // iterate backwards until creating the directory works successfully
        while i > 0 {
            if bun_paths::is_sep_native_t::<OSPathChar>((&path[..])[i as usize]) {
                working_mem[i as usize] = 0;
                let parent = unsafe { OSPathSliceZ::from_raw(working_mem.as_ptr(), i as usize) };
                match mkdir_os_path(parent, mode) {
                    Err(err) => {
                        // PORT NOTE: Zig restores `working_mem[i] = SEP` here, *before*
                        // the errno match, but Zig's `[:0]u16` sentinel is advisory.
                        // Rust's `OSPathSliceZ` (`WStr`/`ZStr`) carries a hard
                        // `ptr[len] == 0` invariant, and the EEXIST/`_` arms below still
                        // read `parent`. Defer the SEP-restore into each arm so `parent`
                        // is never observed with its terminator clobbered.
                        match err.get_errno() {
                            E::EEXIST => {
                                // On Windows, this may happen if trying to mkdir replacing a file
                                #[cfg(windows)]
                                {
                                    if let Ok(res) =
                                        directory_exists_at_os_path(FD::INVALID, parent)
                                    {
                                        // is a directory. break.
                                        if !res {
                                            // SAFETY: `working_mem` is not used after this return; re-derive
                                            // the &mut PathBuffer from the stored raw ptr instead of `&mut self`.
                                            let buf = unsafe { &mut *sync_error_buf_ptr };
                                            return Err(sys::Error {
                                                errno: E::ENOTDIR as _,
                                                syscall: sys::Tag::mkdir,
                                                path: Self::os_path_into_buf(
                                                    buf,
                                                    without_nt_prefix(&(&path[..])[..len as usize]),
                                                )
                                                .into(),
                                                ..Default::default()
                                            });
                                        }
                                    }
                                }
                                working_mem[i as usize] = paths::SEP as OSPathChar;
                                // Handle race condition
                                break;
                            }
                            E::ENOENT => {
                                working_mem[i as usize] = paths::SEP as OSPathChar;
                                i -= 1;
                                continue;
                            }
                            _ => {
                                #[cfg(windows)]
                                let p = {
                                    // `parent` aliases `working_mem` (== sync_error_buf). Copy it
                                    // out to a temp before re-deriving `&mut PathBuffer` so we
                                    // never hold `&mut buf` and `&buf[..]` simultaneously.
                                    let stripped = without_nt_prefix((&parent[..]));
                                    let n = stripped.len();
                                    let mut tmp = paths::os_path_buffer_pool::get();
                                    tmp[..n].copy_from_slice(stripped);
                                    // SAFETY: `working_mem`/`parent` are not used after this return.
                                    Self::os_path_into_buf(
                                        unsafe { &mut *sync_error_buf_ptr },
                                        &tmp[..n],
                                    )
                                };
                                #[cfg(not(windows))]
                                let p = without_nt_prefix((&parent[..]));
                                return Err(err.with_path(p));
                            }
                        }
                    }
                    Ok(_) => {
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
            if bun_paths::is_sep_native_t::<OSPathChar>((&path[..])[i as usize]) {
                working_mem[i as usize] = 0;
                let parent = unsafe { OSPathSliceZ::from_raw(working_mem.as_ptr(), i as usize) };
                match mkdir_os_path(parent, mode) {
                    Err(err) => {
                        working_mem[i as usize] = paths::SEP as OSPathChar;
                        match err.get_errno() {
                            // handle the race condition
                            E::EEXIST => {}
                            // NOENT shouldn't happen here
                            _ => {
                                // SAFETY: `working_mem` is not used after this return.
                                let buf = unsafe { &mut *sync_error_buf_ptr };
                                return Err(err.with_path(Self::os_path_into_buf(
                                    buf,
                                    without_nt_prefix((&path[..])),
                                )));
                            }
                        }
                    }
                    Ok(_) => {
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
            Err(err) => match err.get_errno() {
                E::EEXIST => {}
                _ => {
                    // SAFETY: `working_mem` is not used after this return.
                    let buf = unsafe { &mut *sync_error_buf_ptr };
                    return Err(
                        err.with_path(Self::os_path_into_buf(buf, without_nt_prefix((&path[..]))))
                    );
                }
            },
            Ok(_) => {}
        }

        ctx.on_create_dir(final_);
        if !RETURN_PATH {
            return Ok(StringOrUndefined::None);
        }
        Ok(StringOrUndefined::String(BunString::create_from_os_path(
            &working_mem[..first_match as usize],
        )))
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
            let mut req = UvFsReq::new();
            let rc = unsafe {
                uv::uv_fs_mkdtemp(
                    bun_io::Loop::get(),
                    &mut *req,
                    prefix_buf.as_ptr().cast(),
                    None,
                )
            };
            if let Some(errno) = rc.errno() {
                return Err(sys::Error {
                    errno,
                    syscall: sys::Tag::mkdtemp,
                    path: prefix_buf[..len + 6].into(),
                    ..Default::default()
                });
            }
            // SAFETY: on success libuv populates `req.path` with a NUL-terminated
            // UTF-8 string owned by the request; `UvFsReq::drop` runs
            // `uv_fs_req_cleanup` in place after we've copied the bytes out.
            return Ok(
                ZigString::dupe_for_js(unsafe { bun_core::ffi::cstr(req.path) }.to_bytes())
                    .expect("oom"),
            );
        }

        #[cfg(not(windows))]
        {
            // SAFETY: `prefix_buf` is NUL-terminated and writable; mkdtemp(3) writes the
            // generated name back into the buffer in-place.
            let rc = unsafe { libc::mkdtemp(prefix_buf.as_mut_ptr().cast()) };
            if !rc.is_null() {
                return Ok(
                    ZigString::dupe_for_js(unsafe { bun_core::ffi::cstr(rc) }.to_bytes())
                        .expect("oom"),
                );
            }

            // c.getErrno(rc) returns SUCCESS if rc is -1 so we call std.c._errno() directly
            let errno = sys::last_errno();
            Err(sys::Error {
                errno: errno as _,
                syscall: sys::Tag::mkdtemp,
                path: prefix_buf[..len + 6].into(),
                ..Default::default()
            })
        }
    }

    pub fn open(&mut self, args: &args::Open, _: Flavor) -> Maybe<ret::Open> {
        let path = if cfg!(windows) && args.path.slice() == b"/dev/null" {
            // SAFETY: literal is NUL-terminated; len excludes the sentinel.
            ZStr::from_static(b"\\\\.\\NUL\0")
        } else {
            args.path.slice_z(&mut self.sync_error_buf)
        };
        match Syscall::open(path, args.flags.as_int(), args.mode) {
            Err(err) => Err(err.with_path(args.path.slice())),
            Ok(fd) => Ok(fd),
        }
    }

    pub fn uv_open(&mut self, args: &args::Open, rc: i64) -> Maybe<ret::Open> {
        if rc < 0 {
            return Err(sys::Error {
                errno: (-rc) as _,
                syscall: sys::Tag::open,
                path: args.path.slice().into(),
                #[cfg(windows)]
                from_libuv: true,
                ..Default::default()
            });
        }
        Ok(FD::from_uv(rc as _))
    }

    #[cfg(windows)]
    pub fn uv_statfs(
        &mut self,
        args: &args::StatFS,
        req: &mut uv::fs_t,
        rc: i64,
    ) -> Maybe<ret::StatFS> {
        if rc < 0 {
            return Err(sys::Error {
                errno: (-rc) as _,
                syscall: sys::Tag::open,
                path: args.path.slice().into(),
                #[cfg(windows)]
                from_libuv: true,
                ..Default::default()
            });
        }
        // node_fs.zig:4333 — `req.ptrAs(*align(1) bun.StatFS).*`: libuv stores
        // a `uv_statfs_t*` in `req.ptr` on success. The struct is unaligned in
        // the request buffer, hence `read_unaligned`.
        // SAFETY: `rc >= 0` ⇒ libuv populated `req.ptr` with a valid
        // `uv_statfs_t` (= `RawStatFS` on Windows); we copy it out by value
        // before `uv_fs_req_cleanup` releases the backing storage.
        let statfs_: super::statfs::RawStatFS =
            unsafe { core::ptr::read_unaligned(req.ptr_as::<super::statfs::RawStatFS>()) };
        Ok(ret::StatFS::init(&statfs_, args.big_int))
    }

    pub fn open_dir(&mut self, _: &args::OpenDir, _: Flavor) -> Maybe<()> {
        Maybe::<()>::todo()
    }

    fn read_inner(&mut self, args: &args::Read) -> Maybe<ret::Read> {
        debug_assert!(args.position.is_none());
        // `ArrayBuffer` is a `Copy` descriptor over JSC-owned heap bytes; copy the
        // descriptor locally and use the existing safe `byte_slice_mut` accessor
        // instead of rebuilding a `&mut [u8]` from a `&[u8]` borrow by hand
        // (matches Zig's `args.buffer.slice()` returning `[]u8`).
        let mut view = args.buffer.buffer;
        let mut buf = view.byte_slice_mut();
        let off = (args.offset as usize).min(buf.len());
        buf = &mut buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &mut buf[..l];
        match Syscall::read(args.fd, buf) {
            Err(err) => Err(err),
            Ok(amt) => Ok(ret::Read {
                bytes_read: amt as u64,
            }),
        }
    }

    fn pread_inner(&mut self, args: &args::Read) -> Maybe<ret::Read> {
        // See `read_inner` — copy the `ArrayBuffer` descriptor and use its safe accessor.
        let mut view = args.buffer.buffer;
        let mut buf = view.byte_slice_mut();
        let off = (args.offset as usize).min(buf.len());
        buf = &mut buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &mut buf[..l];
        match Syscall::pread(args.fd, buf, args.position.unwrap()) {
            Err(err) => Err(sys::Error {
                errno: err.errno,
                fd: args.fd,
                syscall: sys::Tag::read,
                ..Default::default()
            }),
            Ok(amt) => Ok(ret::Read {
                bytes_read: amt as u64,
            }),
        }
    }

    pub fn read(&mut self, args: &args::Read, _: Flavor) -> Maybe<ret::Read> {
        let len1 = args.buffer.slice().len();
        let len2 = args.length;
        if len1 == 0 || len2 == 0 {
            return Ok(ret::Read { bytes_read: 0 });
        }
        if args.position.is_some() {
            self.pread_inner(args)
        } else {
            self.read_inner(args)
        }
    }

    pub fn uv_read(&mut self, args: &args::Read, rc: i64) -> Maybe<ret::Read> {
        if rc < 0 {
            return Err(sys::Error {
                errno: (-rc) as _,
                syscall: sys::Tag::read,
                fd: args.fd,
                #[cfg(windows)]
                from_libuv: true,
                ..Default::default()
            });
        }
        Ok(ret::Read {
            bytes_read: rc as u64,
        })
    }

    pub fn uv_readv(&mut self, args: &args::Readv, rc: i64) -> Maybe<ret::Readv> {
        if rc < 0 {
            return Err(sys::Error {
                errno: (-rc) as _,
                syscall: sys::Tag::readv,
                fd: args.fd,
                #[cfg(windows)]
                from_libuv: true,
                ..Default::default()
            });
        }
        Ok(ret::Readv {
            bytes_read: rc as u64,
        })
    }

    pub fn readv(&mut self, args: &args::Readv, _: Flavor) -> Maybe<ret::Readv> {
        if args.buffers.buffers.is_empty() {
            return Ok(ret::Readv { bytes_read: 0 });
        }
        if args.position.is_some() {
            self.preadv_inner(args)
        } else {
            self.readv_inner(args)
        }
    }

    pub fn writev(&mut self, args: &args::Writev, _: Flavor) -> Maybe<ret::Writev> {
        if args.buffers.buffers.is_empty() {
            return Ok(ret::Writev { bytes_written: 0 });
        }
        if args.position.is_some() {
            self.pwritev_inner(args)
        } else {
            self.writev_inner(args)
        }
    }

    pub fn write(&mut self, args: &args::Write, _: Flavor) -> Maybe<ret::Write> {
        if args.position.is_some() {
            self.pwrite_inner(args)
        } else {
            self.write_inner(args)
        }
    }

    pub fn uv_write(&mut self, args: &args::Write, rc: i64) -> Maybe<ret::Write> {
        if rc < 0 {
            return Err(sys::Error {
                errno: (-rc) as _,
                syscall: sys::Tag::write,
                fd: args.fd,
                #[cfg(windows)]
                from_libuv: true,
                ..Default::default()
            });
        }
        Ok(ret::Write {
            bytes_written: rc as u64,
        })
    }

    pub fn uv_writev(&mut self, args: &args::Writev, rc: i64) -> Maybe<ret::Writev> {
        if rc < 0 {
            return Err(sys::Error {
                errno: (-rc) as _,
                syscall: sys::Tag::writev,
                fd: args.fd,
                #[cfg(windows)]
                from_libuv: true,
                ..Default::default()
            });
        }
        Ok(ret::Writev {
            bytes_written: rc as u64,
        })
    }

    fn write_inner(&mut self, args: &args::Write) -> Maybe<ret::Write> {
        let mut buf = args.buffer.slice();
        let off = (args.offset as usize).min(buf.len());
        buf = &buf[off..];
        let l = (args.length as usize).min(buf.len());
        buf = &buf[..l];
        match Syscall::write(args.fd, buf) {
            Err(err) => Err(err),
            Ok(amt) => Ok(ret::Write {
                bytes_written: amt as u64,
            }),
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
            Err(err) => Err(sys::Error {
                errno: err.errno,
                fd: args.fd,
                syscall: sys::Tag::write,
                ..Default::default()
            }),
            Ok(amt) => Ok(ret::Write {
                bytes_written: amt as u64,
            }),
        }
    }

    fn preadv_inner(&mut self, args: &args::Readv) -> Maybe<ret::Readv> {
        let position = args.position.unwrap();
        match Syscall::preadv(args.fd, args.buffers.buffers.as_slice(), position as i64) {
            Err(err) => Err(err),
            Ok(amt) => Ok(ret::Readv {
                bytes_read: amt as u64,
            }),
        }
    }

    fn readv_inner(&mut self, args: &args::Readv) -> Maybe<ret::Readv> {
        match Syscall::readv(args.fd, args.buffers.buffers.as_slice()) {
            Err(err) => Err(err),
            Ok(amt) => Ok(ret::Readv {
                bytes_read: amt as u64,
            }),
        }
    }

    fn pwritev_inner(&mut self, args: &args::Writev) -> Maybe<ret::Write> {
        let position = args.position.unwrap();
        // node_fs.zig:4511 — `@ptrCast(args.buffers.buffers.items)`: `PlatformIoVec`
        // and `PlatformIoVecConst` are layout-identical (`{ *void, usize }`); the
        // kernel never writes through `iov_base` for pwritev(2).
        // SAFETY: layout-compatible reinterpretation, asserted in `bun_sys`.
        let vecs: &[sys::PlatformIoVecConst] = unsafe {
            core::slice::from_raw_parts(
                args.buffers
                    .buffers
                    .as_ptr()
                    .cast::<sys::PlatformIoVecConst>(),
                args.buffers.buffers.len(),
            )
        };
        match Syscall::pwritev(args.fd, vecs, position as i64) {
            Err(err) => Err(err),
            Ok(amt) => Ok(ret::Write {
                bytes_written: amt as u64,
            }),
        }
    }

    fn writev_inner(&mut self, args: &args::Writev) -> Maybe<ret::Write> {
        // node_fs.zig:4526 — `@ptrCast(args.buffers.buffers.items)` reinterprets
        // the mutable iovec slice as `iovec_const` for writev(2); the kernel
        // never writes through `iov_base`. `PlatformIoVec` and
        // `PlatformIoVecConst` are layout-identical (`{ *void, usize }`), so
        // pass the slice through `Syscall::writev` as-is.
        match Syscall::writev(args.fd, args.buffers.buffers.as_slice()) {
            Err(err) => Err(err),
            Ok(amt) => Ok(ret::Write {
                bytes_written: amt as u64,
            }),
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
            ret::ReaddirTag::Buffers => Self::readdir_inner::<Buffer>(
                &mut self.sync_error_buf,
                args,
                args.recursive,
                flavor,
            ),
            ret::ReaddirTag::WithFileTypes => Self::readdir_inner::<Dirent>(
                &mut self.sync_error_buf,
                args,
                args.recursive,
                flavor,
            ),
            ret::ReaddirTag::Files => Self::readdir_inner::<BunString>(
                &mut self.sync_error_buf,
                args,
                args.recursive,
                flavor,
            ),
        };
        match maybe {
            Err(err) => Err(sys::Error {
                syscall: sys::Tag::scandir,
                errno: err.errno,
                path: args.path.slice().into(),
                ..Default::default()
            }),
            Ok(result) => Ok(result),
        }
    }

    fn readdir_with_entries<T: ReaddirEntry>(
        args: &args::Readdir,
        fd: FD,
        basename: &ZStr,
        entries: &mut Vec<T>,
    ) -> Maybe<()> {
        // node_fs.zig:4568 — `comptime is_u16 = isWindows && (T == bun.String || T == Dirent)`.
        // On Windows, String/Dirent results read native UTF-16 entry names via the
        // wide iterator so surrogate pairs survive; Buffer results (and all POSIX)
        // use the u8 iterator.
        #[cfg(windows)]
        if T::IS_U16 {
            return Self::readdir_with_entries_u16::<T>(args, fd, basename, entries);
        }

        let mut dirent_path = BunString::DEAD;
        // Zig `defer dirent_path.deref()` — cannot express as a scope guard in Rust
        // (the loop body needs `&mut dirent_path`); deref is idempotent on DEAD/EMPTY
        // so it is called inline on every exit path below instead.

        let mut iterator = DirIterator::WrappedIterator::init(fd);
        loop {
            let current = match iterator.next() {
                Err(err) => {
                    for item in entries.iter_mut() {
                        item.destroy_entry();
                    }
                    // PORT NOTE: Zig also `entries.deinit()` here; the caller owns the
                    // Vec in Rust, but matching the Zig contract we drain it so the
                    // caller's `T::into_readdir` never sees freed entries.
                    entries.clear();
                    dirent_path.deref();
                    return Err(err.with_path(args.path.slice()));
                }
                Ok(None) => break,
                Ok(Some(ent)) => ent,
            };

            if T::IS_DIRENT && dirent_path.is_empty() {
                dirent_path = webcore::encoding::to_bun_string(
                    without_nt_prefix::<u8>(basename.as_bytes()),
                    encoding_to_node(args.encoding),
                );
            }

            let utf8_name = current.name.slice();
            // On filesystems that return DT_UNKNOWN (e.g. FUSE, bind mounts),
            // fall back to lstat to determine the real file kind.
            let kind = if T::IS_DIRENT && current.kind == sys::FileKind::Unknown {
                match sys::lstatat(fd, current.name.slice_assume_z()) {
                    Ok(st) => sys::kind_from_mode(st.st_mode as Mode),
                    Err(_) => current.kind,
                }
            } else {
                current.kind
            };
            T::append_entry(entries, utf8_name, &dirent_path, kind, args.encoding);
        }

        dirent_path.deref();
        Ok(())
    }

    /// Windows UTF-16 arm of `readdir_with_entries` (node_fs.zig:4644-4660).
    /// Only reachable when `T::IS_U16` (String/Dirent); Buffer is `IS_U16 = false`.
    #[cfg(windows)]
    fn readdir_with_entries_u16<T: ReaddirEntry>(
        args: &args::Readdir,
        fd: FD,
        basename: &ZStr,
        entries: &mut Vec<T>,
    ) -> Maybe<()> {
        let mut dirent_path = BunString::DEAD;

        let mut iterator = DirIterator::WrappedIteratorW::init(fd);

        // node_fs.zig:4578 — only allocated when the requested encoding isn't
        // utf8: the wide name is transcoded to UTF-8 first (matching libuv) and
        // then re-encoded.
        let mut re_encoding_buffer = if args.encoding != Encoding::Utf8 {
            Some(paths::path_buffer_pool::get())
        } else {
            None
        };

        loop {
            let current = match iterator.next() {
                Err(err) => {
                    for item in entries.iter_mut() {
                        item.destroy_entry();
                    }
                    entries.clear();
                    dirent_path.deref();
                    return Err(err.with_path(args.path.slice()));
                }
                Ok(None) => break,
                Ok(Some(ent)) => ent,
            };

            if T::IS_DIRENT && dirent_path.is_empty() {
                dirent_path = webcore::encoding::to_bun_string(
                    without_nt_prefix::<u8>(basename.as_bytes()),
                    encoding_to_node(args.encoding),
                );
            }

            let utf16_name = current.name.slice();
            // Spec (node_fs.zig:4649): the u16 Dirent arm uses `current.kind`
            // directly — no lstatat fallback (NTFS never returns DT_UNKNOWN).
            T::append_entry_w(
                entries,
                utf16_name,
                &dirent_path,
                current.kind,
                args.encoding,
                re_encoding_buffer.as_deref_mut(),
            );
        }

        dirent_path.deref();
        Ok(())
    }

    pub fn readdir_with_entries_recursive_async<T: ReaddirEntry>(
        buf: &mut PathBuffer,
        args: &args::Readdir,
        async_task: &mut AsyncReaddirRecursiveTask,
        basename: &ZStr,
        entries: &mut Vec<T>,
        is_root: bool,
    ) -> Maybe<()> {
        // PORT NOTE: `root_path` is never mutated for the lifetime of the task, but
        // borrowck can't see that across `async_task.enqueue(&mut self, …)`. Detach
        // the slice via raw-pointer round-trip — same bytes Zig's `[]const u8` saw.
        // SAFETY: `async_task.root_path`'s backing storage is fixed at `create()` and
        // outlives every `enqueue` call below.
        let root_basename: &[u8] =
            unsafe { bun_ptr::detach_lifetime(async_task.root_path.slice()) };
        let flags = sys::O::DIRECTORY | sys::O::RDONLY;
        let atfd = if is_root {
            FD::cwd()
        } else {
            async_task.root_fd
        };
        #[cfg(not(windows))]
        let open_res = Syscall::openat(atfd, basename, flags, 0);
        #[cfg(windows)]
        // windows bun.sys.open does not pass iterable=true
        let open_res = sys::open_dir_at_windows_a(
            atfd,
            basename.as_bytes(),
            sys::WindowsOpenDirOptions {
                no_follow: true,
                iterable: true,
                read_only: true,
                ..Default::default()
            },
        );
        let fd = match open_res {
            Err(err) => {
                if !is_root {
                    match err.get_errno() {
                        // These things can happen and there's nothing we can do about it.
                        //
                        // This is different than what Node does, at the time of writing.
                        // Node doesn't gracefully handle errors like these. It fails the entire operation.
                        E::ENOENT | E::ENOTDIR | E::EPERM => return Ok(()),
                        _ => {}
                    }
                    let joined = paths::resolve_path::join_z_buf::<paths::platform::Auto>(
                        &mut buf[..],
                        &[root_basename, basename.as_bytes()],
                    );
                    return Err(err.with_path(joined.as_bytes()));
                }
                return Err(err.with_path(args.path.slice()));
            }
            Ok(fd_) => fd_,
        };

        if is_root {
            async_task.root_fd = fd;
        }
        let _close = scopeguard::guard((fd, is_root), |(fd, is_root)| {
            if !is_root {
                fd.close();
            }
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
                        return Err(err.with_path(joined.as_bytes()));
                    }
                    return Err(err.with_path(args.path.slice()));
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
                )
                .as_bytes()
            };
            // SAFETY: both branches yield NUL-terminated storage — `utf8_name` is a
            // `PathString` slice over the iterator's NUL-terminated dirent name, and
            // `join_z_buf` writes a sentinel.
            let name_to_copy_z =
                unsafe { ZStr::from_raw(name_to_copy.as_ptr(), name_to_copy.len()) };

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
                                let real_kind = sys::kind_from_mode(st.st_mode as Mode);
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
                let joined = paths::resolve_path::join::<paths::platform::Auto>(&[
                    root_basename,
                    name_to_copy,
                ]);
                let path_u8 = paths::resolve_path::dirname::<paths::platform::Auto>(joined);
                if dirent_path_prev.is_empty() || dirent_path_prev.byte_slice() != path_u8 {
                    dirent_path_prev.deref();
                    dirent_path_prev = BunString::clone_utf8(path_u8);
                }
            }
            // async path: spec uses raw `bun.String.cloneUTF8` (node_fs.zig:4810/4819) — do not apply encoding.
            T::append_entry_recursive(
                entries,
                utf8_name,
                name_to_copy,
                &dirent_path_prev,
                effective_kind,
                args.encoding,
                false,
            );
        }

        dirent_path_prev.deref();
        Ok(())
    }

    fn readdir_with_entries_recursive_sync<T: ReaddirEntry>(
        buf: &mut PathBuffer,
        args: &args::Readdir,
        root_basename: &ZStr,
        entries: &mut Vec<T>,
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
        let mut _close_root = scopeguard::guard(&mut root_fd, |root_fd| {
            // all other paths are relative to the root directory
            // so we can only close it once we're 100% done
            if *root_fd != FD::INVALID {
                root_fd.close();
            }
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
            let basename_bytes: &[u8] = if is_root {
                root_basename.as_bytes()
            } else {
                &item[..item.len().saturating_sub(1)]
            };

            let flags = sys::O::DIRECTORY | sys::O::RDONLY;
            let atfd = if *root_fd == FD::INVALID {
                FD::cwd()
            } else {
                *root_fd
            };
            // root_basename is already NUL-terminated; queued items are pushed
            // below with the join_z_buf NUL kept intact (`from_slice_with_nul`
            // debug-asserts the trailing NUL).
            let basename_z: &ZStr = if is_root {
                root_basename
            } else {
                // item was stored with trailing NUL (see push site).
                ZStr::from_slice_with_nul(&item)
            };
            let fd = match Syscall::openat(atfd, basename_z, flags, 0) {
                Err(err) => {
                    if *root_fd == FD::INVALID {
                        return Err(err.with_path(args.path.slice()));
                    }
                    match err.get_errno() {
                        // These things can happen and there's nothing we can do about it.
                        //
                        // This is different than what Node does, at the time of writing.
                        // Node doesn't gracefully handle errors like these. It fails the entire operation.
                        E::ENOENT | E::ENOTDIR | E::EPERM => continue,
                        _ => {
                            // TODO: propagate file path (removed previously because it leaked the path)
                            return Err(err);
                        }
                    }
                }
                Ok(fd_) => fd_,
            };
            if *root_fd == FD::INVALID {
                *root_fd = fd;
            }
            let _close_fd = scopeguard::guard((fd, *root_fd), |(fd, rfd)| {
                if fd != rfd {
                    fd.close();
                }
            });

            let mut iterator = DirIterator::WrappedIterator::init(fd);
            let mut dirent_path_prev = BunString::DEAD;

            loop {
                let current = match iterator.next() {
                    Err(err) => {
                        dirent_path_prev.deref();
                        return Err(err.with_path(args.path.slice()));
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
                    )
                    .as_bytes()
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
                                    let real_kind = sys::kind_from_mode(st.st_mode as Mode);
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
                    let joined = paths::resolve_path::join::<paths::platform::Auto>(&[
                        root_basename.as_bytes(),
                        name_to_copy,
                    ]);
                    let path_u8 = paths::resolve_path::dirname::<paths::platform::Auto>(joined);
                    if dirent_path_prev.is_empty() || dirent_path_prev.byte_slice() != path_u8 {
                        dirent_path_prev.deref();
                        dirent_path_prev = webcore::encoding::to_bun_string(
                            without_nt_prefix::<u8>(path_u8),
                            encoding_to_node(args.encoding),
                        );
                    }
                }
                // sync path: spec uses `WebCore.encoding.toBunString(.., args.encoding)` (node_fs.zig:4962-4982).
                T::append_entry_recursive(
                    entries,
                    utf8_name,
                    name_to_copy,
                    &dirent_path_prev,
                    effective_kind,
                    args.encoding,
                    true,
                );
            }
            dirent_path_prev.deref();
        }

        Ok(())
    }

    fn should_throw_out_of_memory_early_for_javascript(
        encoding: Encoding,
        size: usize,
        syscall: sys::Tag,
    ) -> Option<sys::Error> {
        // Strings & typed arrays max out at 4.7 GB.
        // But, it's **string length**
        // So you can load an 8 GB hex string, for example, it should be fine.
        let adjusted_size = match encoding {
            Encoding::Utf16le | Encoding::Ucs2 | Encoding::Utf8 => (size / 4).saturating_sub(1),
            Encoding::Hex => (size / 2).saturating_sub(1),
            Encoding::Base64 | Encoding::Base64url => (size / 3).saturating_sub(1),
            Encoding::Ascii | Encoding::Latin1 | Encoding::Buffer => size,
        };
        if adjusted_size > bun_jsc::virtual_machine::synthetic_allocation_limit()
            // If they do not have enough memory to open the file and they're on Linux, let's throw an error instead of dealing with the OOM killer.
            || (cfg!(any(target_os = "linux", target_os = "android")) && size as u64 >= bun_core::get_total_memory_size() as u64)
        {
            return Some(sys::Error::from_code(E::ENOMEM, syscall));
        }
        None
    }

    fn readdir_inner<T: ReaddirEntry>(
        buf: &mut PathBuffer,
        args: &args::Readdir,
        recursive: bool,
        flavor: Flavor,
    ) -> Maybe<ret::Readdir> {
        let path = args.path.slice_z(buf);

        if recursive && flavor == Flavor::Sync {
            let mut buf_to_pass = PathBuffer::uninit();
            let mut entries: Vec<T> = Vec::new();
            return match Self::readdir_with_entries_recursive_sync::<T>(
                &mut buf_to_pass,
                args,
                path,
                &mut entries,
            ) {
                Err(err) => {
                    for result in &mut entries {
                        result.destroy_entry();
                    }
                    Err(err)
                }
                Ok(()) => Ok(T::into_readdir(entries)),
            };
        }

        if recursive {
            panic!(
                "This code path should never be reached. It should only go through readdirWithEntriesRecursiveAsync."
            );
        }

        let flags = sys::O::DIRECTORY | sys::O::RDONLY;
        #[cfg(not(windows))]
        let open_res = Syscall::open(path, flags, 0);
        #[cfg(windows)]
        let open_res = sys::open_dir_at_windows_a(
            FD::cwd(),
            path.as_bytes(),
            sys::WindowsOpenDirOptions {
                iterable: true,
                read_only: true,
                ..Default::default()
            },
        );
        let fd = match open_res {
            Err(err) => return Err(err.with_path(args.path.slice())),
            Ok(fd_) => fd_,
        };
        let _close = scopeguard::guard(fd, |fd| fd.close());

        let mut entries: Vec<T> = Vec::new();
        match Self::readdir_with_entries::<T>(args, fd, path, &mut entries) {
            Err(err) => Err(err),
            Ok(()) => Ok(T::into_readdir(entries)),
        }
    }

    pub fn read_file(&mut self, args: &args::ReadFile, flavor: Flavor) -> Maybe<ret::ReadFile> {
        // PERF(port): `flavor` was comptime monomorphization — profile in Phase B
        let result = self.read_file_with_options(args, flavor, ReadFileStringType::Default);
        match result {
            Err(err) => Err(err),
            Ok(result) => match result {
                ret::ReadFileWithOptions::Buffer(buffer) => Ok(StringOrBuffer::Buffer(buffer)),
                ret::ReadFileWithOptions::TranscodedString(str) => {
                    if str.is_dead() {
                        return Err(with_path_like(
                            sys::Error::from_code(E::ENOMEM, sys::Tag::read),
                            &args.path,
                        ));
                    }
                    Ok(StringOrBuffer::String(node::SliceWithUnderlyingString {
                        underlying: str,
                        ..Default::default()
                    }))
                }
                ret::ReadFileWithOptions::String(s) => {
                    // `SliceWithUnderlyingString::transcodeFromOwnedSlice` lives in
                    // bun_string but depends on `webcore::encoding` (higher tier).
                    // Inline its body here to keep the layering clean.
                    let str = if s.is_empty() {
                        node::SliceWithUnderlyingString::default()
                    } else {
                        node::SliceWithUnderlyingString {
                            underlying: webcore::encoding::to_bun_string_from_owned_slice(
                                s.into_vec(),
                                args.encoding,
                            ),
                            ..Default::default()
                        }
                    };
                    if str.underlying.is_dead() && str.utf8.slice().is_empty() {
                        return Err(with_path_like(
                            sys::Error::from_code(E::ENOMEM, sys::Tag::read),
                            &args.path,
                        ));
                    }
                    Ok(StringOrBuffer::String(str))
                }
                _ => unreachable!(),
            },
        }
    }

    pub fn read_file_with_options(
        &mut self,
        args: &args::ReadFile,
        flavor: Flavor,
        string_type: ReadFileStringType,
    ) -> Maybe<ret::ReadFileWithOptions> {
        // PERF(port): `flavor`/`string_type` were comptime monomorphization in Zig.
        let path_is_path = matches!(args.path, PathOrFileDescriptor::Path(_));
        let fd_maybe_windows: FD = match &args.path {
            PathOrFileDescriptor::Path(p) => {
                let path = p.slice_z(&mut self.sync_error_buf);

                if let Some(graph) = standalone_module_graph_get() {
                    // SAFETY: see `standalone_module_graph_get`.
                    if let Some(file) = unsafe { &mut *graph }.find(path.as_bytes()) {
                        let contents: &[u8] = file.contents.as_bytes();
                        return if args.encoding == Encoding::Buffer {
                            // PORTING.md §Forbidden bans `Vec::leak()`; round-trip through
                            // `into_boxed_slice()` so the allocation layout JSC frees with
                            // matches what we hand it (capacity == len).
                            let raw =
                                bun_core::heap::into_raw(contents.to_vec().into_boxed_slice());
                            // SAFETY: ownership of the allocation is transferred to JSC; the
                            // ArrayBuffer finalizer reconstructs the Box and frees it
                            // (PORTING.md:348 — `heap::alloc`/`from_raw` across FFI).
                            Ok(ret::ReadFileWithOptions::Buffer(Buffer::from_bytes(
                                unsafe { &mut *raw },
                                bun_jsc::JSType::Uint8Array,
                            )))
                        } else if string_type == ReadFileStringType::Default {
                            Ok(ret::ReadFileWithOptions::String(
                                contents.to_vec().into_boxed_slice(),
                            ))
                        } else {
                            let mut z = contents.to_vec();
                            z.push(0);
                            Ok(ret::ReadFileWithOptions::NullTerminated(
                                bun_core::ZBox::from_vec_with_nul(z),
                            ))
                        };
                    }
                }

                match sys::open(
                    path,
                    args.flag.as_int() | sys::O::NOCTTY,
                    DEFAULT_PERMISSION,
                ) {
                    Err(err) => return Err(err.with_path(p.slice())),
                    Ok(fd) => fd,
                }
            }
            PathOrFileDescriptor::Fd(fd) => *fd,
        };
        let fd: FD = match fd_maybe_windows.make_lib_uv_owned() {
            Ok(fd) => fd,
            Err(_) => {
                if path_is_path {
                    fd_maybe_windows.close();
                }
                return Err(sys::Error {
                    errno: E::EMFILE as _,
                    syscall: sys::Tag::open,
                    ..Default::default()
                });
            }
        };
        let _close = scopeguard::guard((fd, path_is_path), |(fd, is_path)| {
            if is_path {
                fd.close();
            }
        });

        if args.aborted() {
            return Err(abort_err());
        }

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
        // Zig: `var async_stack_buffer: [if (flavor == .sync) 0 else 256*1024]u8`,
        // and in the sync case borrows `vm.rareData().pipeReadBuffer()` (a per-VM
        // 256 KB heap slab) when a VM is present, otherwise leaves the buffer
        // zero-length so the loop is skipped and we fall through to fstat.
        // Rust can't put 256 KB on the stack portably, so the async path
        // heap-allocates instead — same observable behaviour.
        let mut async_stack_buffer: Vec<u8> = if flavor == Flavor::Sync {
            Vec::new()
        } else {
            vec![0u8; 256 * 1024]
        };
        let pre_stat_buf: &mut [u8] = if flavor == Flavor::Sync {
            match self.vm {
                // SAFETY: `self.vm` is the live owning `*mut VirtualMachine`;
                // `rare_data()` lazily inits the heap slab and the returned
                // `&mut [u8; 256*1024]` outlives this call (single-threaded VM).
                Some(vm) => unsafe { &mut (*vm.as_ptr()).rare_data().pipe_read_buffer()[..] },
                None => &mut [][..],
            }
        } else {
            &mut async_stack_buffer[..]
        };
        let temporary_read_buffer_before_stat_call: &[u8] = {
            let mut available: &mut [u8] = &mut pre_stat_buf[..];
            while !available.is_empty() {
                match Syscall::read(fd, available) {
                    Err(err) => return Err(err),
                    Ok(amt) => {
                        if amt == 0 {
                            did_succeed = true;
                            break;
                        }
                        total += amt;
                        available = &mut available[amt..];
                    }
                }
            }
            &pre_stat_buf[..total]
        };

        if did_succeed {
            return match args.encoding {
                Encoding::Buffer => {
                    if flavor == Flavor::Sync && string_type == ReadFileStringType::Default {
                        if let Some(vm) = self.vm.map(bun_ptr::BackRef::from) {
                            // Attempt to create the buffer in JSC's heap.
                            // This avoids creating a WastefulTypedArray.
                            // `self.vm` is the live owning `VirtualMachine`
                            // (per-thread singleton; see `pipe_read_buffer`
                            // above) — `BackRef` invariant holds.
                            let global = vm.global();
                            let array_buffer = bun_jsc::ArrayBuffer::create_buffer(
                                global,
                                temporary_read_buffer_before_stat_call,
                            )
                            // TODO: properly propagate exception upwards
                            .unwrap_or(JSValue::ZERO);
                            array_buffer.ensure_still_alive();
                            return match array_buffer.as_array_buffer(global) {
                                Some(buffer) => Ok(ret::ReadFileWithOptions::Buffer(
                                    bun_jsc::MarkedArrayBuffer {
                                        buffer,
                                        owns_buffer: false,
                                    },
                                )),
                                // This case shouldn't really happen.
                                None => Err(with_path_like(
                                    sys::Error::from_code(E::ENOMEM, sys::Tag::read),
                                    &args.path,
                                )),
                            };
                        }
                    }
                    let raw = bun_core::heap::into_raw(
                        temporary_read_buffer_before_stat_call
                            .to_vec()
                            .into_boxed_slice(),
                    );
                    // SAFETY: ownership transferred to JSC; freed via ArrayBuffer finalizer
                    // (PORTING.md:348 — `heap::alloc`/`from_raw` across FFI).
                    Ok(ret::ReadFileWithOptions::Buffer(Buffer::from_bytes(
                        unsafe { &mut *raw },
                        bun_jsc::JSType::Uint8Array,
                    )))
                }
                _ => {
                    if string_type == ReadFileStringType::Default {
                        Ok(ret::ReadFileWithOptions::TranscodedString(
                            webcore::encoding::to_bun_string(
                                temporary_read_buffer_before_stat_call,
                                args.encoding,
                            ),
                        ))
                    } else {
                        let mut z = temporary_read_buffer_before_stat_call.to_vec();
                        z.push(0);
                        Ok(ret::ReadFileWithOptions::NullTerminated(
                            bun_core::ZBox::from_vec_with_nul(z),
                        ))
                    }
                }
            };
        }
        // ----------------------------

        if args.aborted() {
            return Err(abort_err());
        }

        let stat_ = match Syscall::fstat(fd) {
            Err(err) => return Err(err),
            Ok(stat_) => stat_,
        };

        // For certain files, the size might be 0 but the file might still have contents.
        // https://github.com/oven-sh/bun/issues/1220
        let max_size: u64 = args.max_size.map(|v| v as u64).unwrap_or(BLOB_SIZE_MAX);
        let has_max_size = args.max_size.is_some();

        let size: u64 = (stat_.st_size as i64)
            .min(max_size as i64) // Only used in DOMFormData
            .max(total as i64)
            .max(0) as u64
            + (string_type == ReadFileStringType::NullTerminated) as u64;

        if args.limit_size_for_javascript &&
            // assume that anything more than 40 bits is not trustworthy.
            size < (1u64 << 40)
        {
            if let Some(err) = Self::should_throw_out_of_memory_early_for_javascript(
                args.encoding,
                size as usize,
                sys::Tag::read,
            ) {
                return Err(with_path_like(err, &args.path));
            }
        }

        let mut buf: Vec<u8> = Vec::new();
        let initial_cap = (temporary_read_buffer_before_stat_call.len() as u64)
            .max(size)
            .saturating_add(16)
            .min(max_size)
            .min(1024 * 1024 * 1024 * 8) as usize;
        if buf.try_reserve_exact(initial_cap).is_err() {
            return Err(with_path_like(
                sys::Error::from_code(E::ENOMEM, sys::Tag::read),
                &args.path,
            ));
        }
        if !temporary_read_buffer_before_stat_call.is_empty() {
            buf.extend_from_slice(temporary_read_buffer_before_stat_call);
        }
        // PORT NOTE: Zig `buf.expandToCapacity()` then indexed `buf.items.ptr[total..cap]`
        // to read into uninitialised tail. `Vec::resize(cap, 0)` is *not* equivalent in
        // debug builds: it goes through `extend_with`'s byte-by-byte loop (no memset
        // specialisation), which dominated `readFileSync` of large files. Match the spec
        // exactly via `VecExt::expand_to_capacity` (the tail is write-only — `Syscall::read`
        // hands it straight to the kernel, which only stores into it).
        use bun_collections::vec_ext::VecExt as _;
        // SAFETY: `u8` has no validity invariant; the buffer is handed straight
        // to the kernel which only stores into it.
        unsafe { buf.expand_to_capacity() };

        // Two-phase read: first up to `size`, then keep going until EOF.
        // PORT NOTE: Zig spelled this as `while (total < size) { ... } else { while (true) { ... } }`.
        // Rust has no while/else; use an explicit `phase` flag — `phase == 0` is the
        // size-bounded loop, `phase == 1` is the unbounded tail.
        let mut phase: u8 = if (total as u64) < size { 0 } else { 1 };
        loop {
            if args.aborted() {
                return Err(abort_err());
            }
            // Spec parity (node_fs.zig:5327-5377): when `total == min(buf.capacity, max_size)`
            // the next read receives an empty slice → returns 0 → `did_succeed = true; break`.
            // Do NOT pre-grow here; growth happens only in the `total > size && amt != 0 &&
            // !has_max_size` arm below.
            let upper = (buf.capacity() as u64).min(max_size) as usize;
            match Syscall::read(fd, &mut buf[total..upper]) {
                Err(err) => return Err(err),
                Ok(amt) => {
                    total += amt;

                    if args.limit_size_for_javascript {
                        if let Some(err) = Self::should_throw_out_of_memory_early_for_javascript(
                            args.encoding,
                            total,
                            sys::Tag::read,
                        ) {
                            return Err(with_path_like(err, &args.path));
                        }
                    }

                    // There are cases where stat()'s size is wrong or out of date
                    if (total as u64) > size && amt != 0 && !has_max_size {
                        if buf.try_reserve(8192).is_err() {
                            return Err(with_path_like(
                                sys::Error::from_code(E::ENOMEM, sys::Tag::read),
                                &args.path,
                            ));
                        }
                        // SAFETY: `u8` has no validity invariant; kernel only stores.
                        unsafe { buf.expand_to_capacity() };
                        continue;
                    }

                    if amt == 0 {
                        did_succeed = true;
                        break;
                    }

                    if phase == 0 && (total as u64) >= size {
                        // fall through into the unbounded tail loop
                        phase = 1;
                    }
                }
            }
        }
        let _ = phase; // phase only mirrors Zig's while/else split for source parity

        let final_len = if string_type == ReadFileStringType::NullTerminated {
            total + 1
        } else {
            total
        };
        if total == 0 {
            drop(buf);
            return match args.encoding {
                Encoding::Buffer => Ok(ret::ReadFileWithOptions::Buffer(Buffer::EMPTY)),
                _ => {
                    if string_type == ReadFileStringType::Default {
                        Ok(ret::ReadFileWithOptions::String(Box::<[u8]>::default()))
                    } else {
                        Ok(ret::ReadFileWithOptions::NullTerminated(
                            bun_core::ZBox::from_vec_with_nul(vec![0u8]),
                        ))
                    }
                }
            };
        }
        let _ = did_succeed; // Zig used this only to gate the `defer buf.clearAndFree()`;
        // Rust drops `buf` on every error-return above.

        match args.encoding {
            Encoding::Buffer => {
                buf.truncate(final_len);
                let raw = bun_core::heap::into_raw(buf.into_boxed_slice());
                // SAFETY: ownership transferred to JSC; freed via ArrayBuffer finalizer
                // (PORTING.md:348 — `heap::alloc`/`from_raw` across FFI).
                Ok(ret::ReadFileWithOptions::Buffer(Buffer::from_bytes(
                    unsafe { &mut *raw },
                    bun_jsc::JSType::Uint8Array,
                )))
            }
            _ => {
                if string_type == ReadFileStringType::Default {
                    buf.truncate(final_len);
                    Ok(ret::ReadFileWithOptions::String(buf.into_boxed_slice()))
                } else {
                    // null_terminated: ensure buf[total] == 0 and hand back as ZBox.
                    if buf.len() < total + 1 {
                        if buf.try_reserve_exact(1).is_err() {
                            return Err(with_path_like(
                                sys::Error::from_code(E::ENOMEM, sys::Tag::read),
                                &args.path,
                            ));
                        }
                        buf.push(0);
                    } else {
                        buf[total] = 0;
                    }
                    buf.truncate(total + 1);
                    Ok(ret::ReadFileWithOptions::NullTerminated(
                        bun_core::ZBox::from_vec_with_nul(buf),
                    ))
                }
            }
        }
    }

    pub fn write_file_with_path_buffer(
        pathbuf: &mut PathBuffer,
        args: &args::WriteFile,
    ) -> Maybe<ret::WriteFile> {
        let fd = match &args.file {
            PathOrFileDescriptor::Path(p) => {
                let path = p.slice_z_with_force_copy::<true>(pathbuf);
                match sys::openat(args.dirfd, path, args.flag.as_int(), args.mode) {
                    Err(err) => return Err(err.with_path(p.slice())),
                    Ok(fd) => fd,
                }
            }
            PathOrFileDescriptor::Fd(fd) => *fd,
        };
        let _close = scopeguard::guard(
            (fd, matches!(args.file, PathOrFileDescriptor::Path(_))),
            |(fd, is_path)| {
                if is_path {
                    fd.close();
                }
            },
        );

        if args.aborted() {
            return Err(abort_err());
        }

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
                        Err(_) => break 'preallocate,
                        Ok(pos) => usize::try_from(pos).expect("int cast"),
                    }
                };
                let _ = sys::preallocate_file(
                    fd.native(),
                    i64::try_from(offset).expect("int cast"),
                    i64::try_from(buf.len()).expect("int cast"),
                );
            }
        }

        while !buf.is_empty() {
            match sys::write(fd, buf) {
                Err(err) => return Err(err),
                Ok(amt) => {
                    buf = &buf[amt..];
                    written += amt;
                    if amt == 0 {
                        break;
                    }
                }
            }
        }

        // https://github.com/oven-sh/bun/issues/2931
        // https://github.com/oven-sh/bun/issues/10222
        // Only truncate if we're not appending and writing to a path
        if (args.flag.as_int() & sys::O::APPEND) == 0
            && !matches!(args.file, PathOrFileDescriptor::Fd(_))
        {
            // If this errors, we silently ignore it.
            // Not all files are seekable (and thus, not all files can be truncated).
            #[cfg(windows)]
            {
                let _ = unsafe { windows::SetEndOfFile(fd.native()) };
            }
            #[cfg(not(windows))]
            {
                let _ = Syscall::ftruncate(fd, (written as u64 & ((1u64 << 63) - 1)) as i64);
            }
        }

        if args.flush {
            #[cfg(windows)]
            {
                let _ = unsafe { windows::kernel32::FlushFileBuffers(fd.native()) };
            }
            #[cfg(not(windows))]
            {
                let _ = Syscall::fsync(fd);
            }
        }

        Ok(())
    }

    pub fn write_file(&mut self, args: &args::WriteFile, _: Flavor) -> Maybe<ret::WriteFile> {
        Self::write_file_with_path_buffer(&mut self.sync_error_buf, args)
    }

    pub fn readlink(&mut self, args: &args::Readlink, _: Flavor) -> Maybe<ret::Readlink> {
        let mut outbuf = PathBuffer::uninit();
        let inbuf = &mut self.sync_error_buf;
        let path = args.path.slice_z(inbuf);
        // PORT: `Syscall` (= `sys_uv` on Windows) returns the link slice
        // directly there but `usize` on POSIX. `bun_sys::readlink` is the
        // length-normalised wrapper on every platform.
        let link_len = match sys::readlink(path, &mut outbuf[..]) {
            Err(err) => return Err(err.with_path(args.path.slice())),
            Ok(result) => result,
        };
        let link_path: &[u8] = &outbuf[..link_len];
        Ok(match args.encoding {
            Encoding::Buffer => {
                StringOrBuffer::Buffer(Buffer::from_string(link_path).expect("unreachable"))
            }
            _ => {
                if let PathLike::SliceWithUnderlyingString(s) = &args.path {
                    if strings::eql_long(s.slice(), link_path, true) {
                        return Ok(StringOrBuffer::String(s.dupe_ref()));
                    }
                }
                StringOrBuffer::String(node::SliceWithUnderlyingString {
                    underlying: BunString::clone_utf8(link_path),
                    ..Default::default()
                })
            }
        })
    }

    pub fn realpath_non_native(
        &mut self,
        args: &args::Realpath,
        _: Flavor,
    ) -> Maybe<ret::Realpath> {
        match self.realpath_inner(args, RealpathVariant::Emulated) {
            Ok(res) => Ok(res),
            Err(err) => Err(sys::Error {
                errno: err.errno,
                syscall: sys::Tag::lstat,
                path: args.path.slice().into(),
                ..Default::default()
            }),
        }
    }

    pub fn realpath(&mut self, args: &args::Realpath, _: Flavor) -> Maybe<ret::Realpath> {
        match self.realpath_inner(args, RealpathVariant::Native) {
            Ok(res) => Ok(res),
            Err(err) => Err(sys::Error {
                errno: err.errno,
                syscall: sys::Tag::realpath,
                path: args.path.slice().into(),
                ..Default::default()
            }),
        }
    }

    // For `fs.realpath`, Node.js uses `lstat`, exposing the native system call under
    // `fs.realpath.native`. In Bun, the system call is the default, but the error
    // code must be changed to make it seem like it is using lstat (tests expect this),
    // in addition, some more subtle things depend on the variant.
    pub fn realpath_inner(
        &mut self,
        args: &args::Realpath,
        variant: RealpathVariant,
    ) -> Maybe<ret::Realpath> {
        #[cfg(windows)]
        {
            let mut req = UvFsReq::new();
            let rc = unsafe {
                uv::uv_fs_realpath(
                    bun_io::Loop::get(),
                    &mut *req,
                    args.path.slice_z(&mut self.sync_error_buf).as_ptr(),
                    None,
                )
            };
            if let Some(errno) = rc.errno() {
                return Err(sys::Error {
                    errno,
                    syscall: sys::Tag::realpath,
                    path: args.path.slice().into(),
                    ..Default::default()
                });
            }
            // Zig: `req.ptrAs(?[*:0]u8)` — `fs_t.ptr` *is* the nullable C
            // string pointer (libuv stores the realpath result directly), so
            // `ptr_as::<c_char>()` yields the value, not a pointer-to-Option.
            // SAFETY: `rc.errno()` was None ⇒ libuv populated `req.ptr`.
            let ptr: *const c_char = unsafe { req.ptr_as::<c_char>() };
            if ptr.is_null() {
                return Err(sys::Error {
                    errno: E::ENOENT as _,
                    syscall: sys::Tag::realpath,
                    path: args.path.slice().into(),
                    ..Default::default()
                });
            }
            let mut buf = unsafe { bun_core::ffi::cstr(ptr) }.to_bytes();
            if variant == RealpathVariant::Emulated {
                // remove the trailing slash
                //
                // PORT NOTE: Zig (`buf[buf.len-1] = 0; buf.len -= 1;`) writes the
                // NUL back to keep its `[:0]u8` sentinel invariant. In Rust `buf`
                // is an immutable view and every consumer below copies by length,
                // so we just shrink the slice — writing through `ptr.cast_mut()`
                // while `buf` is live would be Stacked-Borrows UB.
                if buf.last() == Some(&b'\\') {
                    buf = &buf[..buf.len() - 1];
                }
            }
            return Ok(match args.encoding {
                Encoding::Buffer => {
                    StringOrBuffer::Buffer(Buffer::from_string(buf).expect("unreachable"))
                }
                Encoding::Utf8 => {
                    if let PathLike::SliceWithUnderlyingString(s) = &args.path {
                        if strings::eql_long(s.slice(), buf, true) {
                            return Ok(StringOrBuffer::String(s.dupe_ref()));
                        }
                    }
                    StringOrBuffer::String(node::SliceWithUnderlyingString {
                        underlying: BunString::clone_utf8(buf),
                        ..Default::default()
                    })
                }
                enc => StringOrBuffer::String(node::SliceWithUnderlyingString {
                    underlying: webcore::encoding::to_bun_string(buf, enc),
                    ..Default::default()
                }),
            });
        }

        #[cfg(not(windows))]
        {
            let mut outbuf = PathBuffer::uninit();
            let inbuf = &mut self.sync_error_buf;
            // SAFETY: single-threaded init flag (resolver/fs.rs).
            debug_assert!(
                bun_resolver::fs::INSTANCE_LOADED.load(core::sync::atomic::Ordering::Relaxed)
            );

            let path_slice = args.path.slice();
            // SAFETY: instance() returns the leaked singleton; INSTANCE_LOADED checked above.
            let fs = FileSystem::get();
            let parts = [fs.top_level_dir, path_slice];
            let path_len = fs.abs_buf(&parts, &mut inbuf[..]).len();
            inbuf[path_len] = 0;
            let path = ZStr::from_buf(&inbuf[..], path_len);

            #[cfg(any(target_os = "linux", target_os = "android"))]
            let flags = sys::O::PATH; // O_PATH is faster
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            let flags = sys::O::RDONLY | sys::O::NONBLOCK | sys::O::NOCTTY;

            let fd = match sys::open(path, flags, 0) {
                Err(err) => return Err(err.with_path(path)),
                Ok(fd_) => fd_,
            };
            let _close = scopeguard::guard(fd, |fd| fd.close());

            let buf = match Syscall::get_fd_path(fd, &mut outbuf) {
                Err(err) => return Err(err.with_path(path)),
                Ok(buf_) => buf_,
            };

            let _ = variant;
            Ok(match args.encoding {
                Encoding::Buffer => {
                    StringOrBuffer::Buffer(Buffer::from_string(buf).expect("unreachable"))
                }
                Encoding::Utf8 => {
                    if let PathLike::SliceWithUnderlyingString(s) = &args.path {
                        if strings::eql_long(s.slice(), buf, true) {
                            return Ok(StringOrBuffer::String(s.dupe_ref()));
                        }
                    }
                    StringOrBuffer::String(node::SliceWithUnderlyingString {
                        underlying: BunString::clone_utf8(buf),
                        ..Default::default()
                    })
                }
                enc => StringOrBuffer::String(node::SliceWithUnderlyingString {
                    underlying: webcore::encoding::to_bun_string(buf, enc),
                    ..Default::default()
                }),
            })
        }
    }

    pub const realpath_native: fn(&mut NodeFS, &args::Realpath, Flavor) -> Maybe<ret::Realpath> =
        Self::realpath;

    pub fn rename(&mut self, args: &args::Rename, _: Flavor) -> Maybe<ret::Rename> {
        let from_buf = &mut self.sync_error_buf;
        let mut to_buf = PathBuffer::uninit();
        let from = args.old_path.slice_z(from_buf);
        let to = args.new_path.slice_z(&mut to_buf);
        match Syscall::rename(from, to) {
            Ok(result) => Ok(result),
            Err(err) => Err(err.with_path_dest(args.old_path.slice(), args.new_path.slice())),
        }
    }

    pub fn rmdir(&mut self, args: &args::RmDir, _: Flavor) -> Maybe<ret::Rmdir> {
        if args.recursive {
            // Zig passed args.path.slice() to std.fs.Dir.openDir/deleteFile/deleteDir,
            // which on Windows resolve a rooted-but-driveless path ("/tmp/foo")
            // against the cwd drive via wToPrefixedFileW → RtlGetFullPathName_U.
            // Our dt_* helpers go through Syscall::*at → to_nt_path /
            // normalize_path_windows, which do NOT add the cwd drive, turning
            // "/tmp/foo" into a nonexistent NT name (ENOENT). Pre-resolve with
            // slice_z so the path already carries a drive letter, the same way
            // existsSync/statSync/unlinkSync see it.
            #[cfg(windows)]
            let resolved = args.path.slice_z(&mut self.sync_error_buf).as_bytes();
            #[cfg(not(windows))]
            let resolved = args.path.slice();
            if let Err(err) =
                zig_delete_tree(sys::Dir::cwd(), resolved, sys::FileKind::Directory)
            {
                let mut errno: E = map_anyerror_to_errno(err);
                if cfg!(windows) && errno == E::ENOTDIR {
                    errno = E::ENOENT;
                }
                return Err(sys::Error::from_code(errno, sys::Tag::rmdir));
            }
            return Ok(());
        }
        #[cfg(windows)]
        {
            return match Syscall::rmdir(args.path.slice_z(&mut self.sync_error_buf)) {
                Err(err) => Err(err.with_path(args.path.slice())),
                Ok(result) => Ok(result),
            };
        }
        // SAFETY: path is NUL-terminated by slice_z; rmdir(2) is the libc FFI
        Maybe::<ret::Rmdir>::errno_sys_p(
            unsafe { libc::rmdir(args.path.slice_z(&mut self.sync_error_buf).as_ptr().cast()) },
            sys::Tag::rmdir,
            args.path.slice(),
        )
        .unwrap_or(Ok(()))
    }

    pub fn rm(&mut self, args: &args::Rm, _: Flavor) -> Maybe<ret::Rm> {
        // We cannot use removefileat() on macOS because it does not handle write-protected files as expected.
        if args.recursive {
            // See the matching comment in `rmdir`: pre-resolve the path on
            // Windows so rooted-but-driveless paths ("/tmp/foo") get the cwd
            // drive prepended before reaching the dt_* / Syscall::*at helpers,
            // which (unlike Zig's std.fs.Dir.*) do not do that themselves.
            #[cfg(windows)]
            let resolved = args.path.slice_z(&mut self.sync_error_buf).as_bytes();
            #[cfg(not(windows))]
            let resolved = args.path.slice();
            if let Err(err) =
                zig_delete_tree(sys::Dir::cwd(), resolved, sys::FileKind::File)
            {
                let errno = if err == bun_core::err!("FileNotFound") {
                    if args.force {
                        return Ok(());
                    }
                    E::ENOENT
                } else {
                    map_anyerror_to_errno_rm_tree(err)
                };
                return Err(sys::Error::from_code(errno, sys::Tag::rm).with_path(args.path.slice()));
            }
            return Ok(());
        }

        let dest = args.path.slice_z(&mut self.sync_error_buf);
        // PORT NOTE: Zig used `std.posix.unlinkZ/rmdirZ` (which return Zig error
        // sets) and then mapped that error set through a *narrow* table to an
        // errno, defaulting to `EFAULT`. The Rust port goes straight to
        // `bun_sys::unlink`/`libc::rmdir` (raw errno), so route the result
        // through `map_rm_errno_narrow` to preserve the EFAULT fallthrough
        // (e.g. `EISDIR` with `recursive=false` must surface as `EFAULT`).
        if let Err(err1) = sys::unlink(dest) {
            let e1 = err1.get_errno();
            // empirically, it seems to return AccessDenied when the
            // file is actually a directory on macOS.
            // PORT NOTE: Zig checks `error.IsDir|NotDir|AccessDenied`; the
            // vendored std.posix.unlinkZ maps `.PERM => PermissionDenied`
            // (not AccessDenied), so raw EPERM is *not* in this set.
            if args.recursive && matches!(e1, E::EISDIR | E::ENOTDIR | E::EACCES) {
                // SAFETY: `dest` is NUL-terminated by `slice_z`; rmdir(2) is the libc FFI.
                if let Some(Err(err2)) = Maybe::<()>::errno_sys_p(
                    unsafe { libc::rmdir(dest.as_ptr().cast()) },
                    sys::Tag::rmdir,
                    args.path.slice(),
                ) {
                    let e2 = err2.get_errno();
                    if e2 == E::ENOENT && args.force {
                        return Ok(());
                    }
                    return Err(sys::Error::from_code(map_rm_errno_narrow(e2), sys::Tag::rm)
                        .with_path(args.path.slice()));
                }
                return Ok(());
            }
            if e1 == E::ENOENT && args.force {
                return Ok(());
            }
            return Err(sys::Error::from_code(map_rm_errno_narrow(e1), sys::Tag::rm)
                .with_path(args.path.slice()));
        }
        Ok(())
    }

    pub fn statfs(&mut self, args: &args::StatFS, _: Flavor) -> Maybe<ret::StatFS> {
        match Syscall::statfs(args.path.slice_z(&mut self.sync_error_buf)) {
            Ok(result) => Ok(ret::StatFS::init(&result, args.big_int)),
            Err(err) => Err(err),
        }
    }

    pub fn stat(&mut self, args: &args::Stat, _: Flavor) -> Maybe<ret::Stat> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        if let Some(graph) = standalone_module_graph_get() {
            // SAFETY: see `standalone_module_graph_get`.
            if let Some(result) = unsafe { &mut *graph }.stat(path.as_bytes()) {
                return Ok(StatOrNotFound::Stats(Stats::init(
                    &PosixStat::init(&result),
                    args.big_int,
                )));
            }
        }
        #[cfg(target_os = "linux")]
        if sys::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
            return match sys::statx(path, sys::STATX_MASK_FOR_STATS) {
                Ok(result) => Ok(StatOrNotFound::Stats(Stats::init(&result, args.big_int))),
                Err(err) => {
                    if !args.throw_if_no_entry && err.get_errno() == E::ENOENT {
                        return Ok(StatOrNotFound::NotFound);
                    }
                    Err(err.with_path(args.path.slice()))
                }
            };
        }
        match Syscall::stat(path) {
            Ok(result) => Ok(StatOrNotFound::Stats(Stats::init(
                &PosixStat::init(&result),
                args.big_int,
            ))),
            Err(err) => {
                if !args.throw_if_no_entry && err.get_errno() == E::ENOENT {
                    return Ok(StatOrNotFound::NotFound);
                }
                Err(err.with_path(args.path.slice()))
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
            enum ResolvedLinkType {
                File,
                Dir,
                Junction,
            }

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
                    let cwd_len = match sys::getcwd(&mut to_buf[..]) {
                        Ok(c) => c,
                        Err(_) => panic!("failed to resolve current working directory"),
                    };
                    let dir = bun_core::dirname(new_path).unwrap_or(new_path);
                    let src_len =
                        paths::resolve_path::join_abs_string_buf::<paths::platform::Windows>(
                            &to_buf[..cwd_len],
                            &mut self.sync_error_buf[..],
                            &[dir, target_path],
                        )
                        .len();
                    self.sync_error_buf[src_len] = 0;
                    let src_z = ZStr::from_buf(&self.sync_error_buf[..], src_len);
                    break 'auto_detect match sys::directory_exists_at(FD::INVALID, src_z) {
                        Err(_) => ResolvedLinkType::File,
                        Ok(is_dir) => {
                            if is_dir {
                                ResolvedLinkType::Dir
                            } else {
                                ResolvedLinkType::File
                            }
                        }
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
                    let cwd_len = match sys::getcwd(&mut to_buf[..]) {
                        Ok(c) => c,
                        Err(_) => panic!("failed to resolve current working directory"),
                    };
                    let dir = bun_core::dirname(new_path).unwrap_or(new_path);
                    let target_len =
                        paths::resolve_path::join_abs_string_buf::<paths::platform::Windows>(
                            &to_buf[..cwd_len],
                            &mut self.sync_error_buf[4..],
                            &[dir, target_path],
                        )
                        .len();
                    self.sync_error_buf[0..4].copy_from_slice(&paths::windows::LONG_PATH_PREFIX_U8);
                    self.sync_error_buf[4 + target_len] = 0;
                    break 'target ZStr::from_buf(&self.sync_error_buf[..], 4 + target_len);
                }
                if paths::is_absolute(target_path) {
                    // This normalizes slashes and adds the long path prefix
                    break 'target args
                        .target_path
                        .slice_z_with_force_copy::<true>(&mut self.sync_error_buf);
                }
                self.sync_error_buf[..target_path.len()].copy_from_slice(target_path);
                self.sync_error_buf[target_path.len()] = 0;
                paths::resolve_path::dangerously_convert_path_to_windows_in_place::<u8>(
                    &mut self.sync_error_buf[..target_path.len()],
                );
                break 'target ZStr::from_buf(&self.sync_error_buf[..], target_path.len());
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
                Err(err) => {
                    Err(err.with_path_dest(args.target_path.slice(), args.new_path.slice()))
                }
                Ok(result) => Ok(result),
            };
        }
        #[cfg(not(windows))]
        match Syscall::symlink(
            args.target_path.slice_z(&mut self.sync_error_buf),
            args.new_path.slice_z(&mut to_buf),
        ) {
            Ok(result) => Ok(result),
            Err(err) => Err(err.with_path_dest(args.target_path.slice(), args.new_path.slice())),
        }
    }

    fn truncate_inner(&mut self, path: &PathLike, len: u64, flags: i32) -> Maybe<ret::Truncate> {
        // Zig stores `len` as `u63` so the `i64` cast is always in range; mask to
        // the same `u63` envelope here rather than `try_from().unwrap()`-panicking
        // on a hostile `> i64::MAX` value.
        let len_i64 = (len & ((1u64 << 63) - 1)) as i64;
        #[cfg(windows)]
        {
            let file = sys::open(
                path.slice_z(&mut self.sync_error_buf),
                sys::O::WRONLY | flags,
                0o644,
            );
            let Ok(fd) = file else {
                let Err(e) = file else { unreachable!() };
                return Err(sys::Error {
                    errno: e.errno,
                    path: path.slice().into(),
                    syscall: sys::Tag::truncate,
                    ..Default::default()
                });
            };
            let _close = scopeguard::guard(fd, |fd| fd.close());
            return match Syscall::ftruncate(fd, len_i64) {
                Ok(r) => Ok(r),
                Err(err) => Err(err.with_path_and_syscall(path.slice(), sys::Tag::truncate)),
            };
        }
        #[cfg(not(windows))]
        {
            let _ = flags;
            // SAFETY: path is NUL-terminated by slice_z; truncate(2) is the libc FFI
            Maybe::<ret::Truncate>::errno_sys_p(
                unsafe {
                    libc::truncate(
                        path.slice_z(&mut self.sync_error_buf).as_ptr().cast(),
                        len_i64,
                    )
                },
                sys::Tag::truncate,
                path.slice(),
            )
            .unwrap_or(Ok(()))
        }
    }

    pub fn truncate(&mut self, args: &args::Truncate, _: Flavor) -> Maybe<ret::Truncate> {
        match &args.path {
            // Zig: `args.len` is `u63`; mask off the top bit so the i64 cast can't panic.
            PathOrFileDescriptor::Fd(fd) => {
                Syscall::ftruncate(*fd, (args.len & ((1u64 << 63) - 1)) as i64)
            }
            PathOrFileDescriptor::Path(p) => self.truncate_inner(p, args.len, args.flags),
        }
    }

    pub fn unlink(&mut self, args: &args::Unlink, _: Flavor) -> Maybe<ret::Unlink> {
        #[cfg(windows)]
        {
            return match Syscall::unlink(args.path.slice_z(&mut self.sync_error_buf)) {
                Err(err) => Err(err.with_path(args.path.slice())),
                Ok(result) => Ok(result),
            };
        }
        // SAFETY: path is NUL-terminated by slice_z; unlink(2) is the libc FFI
        Maybe::<ret::Unlink>::errno_sys_p(
            unsafe { libc::unlink(args.path.slice_z(&mut self.sync_error_buf).as_ptr().cast()) },
            sys::Tag::unlink,
            args.path.slice(),
        )
        .unwrap_or(Ok(()))
    }

    pub fn watch_file(&mut self, args: args::WatchFile, flavor: Flavor) -> Maybe<ret::WatchFile> {
        debug_assert!(flavor == Flavor::Sync);
        // `create_stat_watcher` consumes `args` (the `PathLike` is moved into
        // the new `StatWatcher`); capture what the error path needs first.
        // `BackRef` is `Copy` — copy out so the borrow detaches from `args`.
        let global_this = args.global_this;
        let path: Vec<u8> = args.path.slice().to_vec();
        match args.create_stat_watcher() {
            Ok(watcher) => Ok(watcher),
            Err(err) => {
                let mut buf = Vec::new();
                use std::io::Write as _;
                let _ = write!(
                    &mut buf,
                    "Failed to watch file {}",
                    bun_core::fmt::QuotedFormatter { text: &path }
                );
                let _ = global_this.throw_value(
                    bun_jsc::SystemError {
                        errno: 0,
                        message: BunString::init(&buf[..]),
                        code: BunString::init(err.name()),
                        path: BunString::init(path.as_slice()),
                        syscall: BunString::default(),
                        hostname: BunString::default(),
                        fd: -1,
                        dest: BunString::default(),
                    }
                    .to_error_instance(&global_this),
                );
                Ok(JSValue::UNDEFINED)
            }
        }
    }

    pub fn unwatch_file(&mut self, _: &args::UnwatchFile, _: Flavor) -> Maybe<ret::UnwatchFile> {
        Maybe::<ret::UnwatchFile>::todo()
    }

    pub fn utimes(&mut self, args: &args::Utimes, _: Flavor) -> Maybe<ret::Utimes> {
        #[cfg(windows)]
        {
            let mut req = UvFsReq::new();
            let rc = unsafe {
                uv::uv_fs_utime(
                    bun_io::Loop::get(),
                    &mut *req,
                    args.path.slice_z(&mut self.sync_error_buf).as_ptr(),
                    args.atime,
                    args.mtime,
                    None,
                )
            };
            return if let Some(errno) = rc.errno() {
                Err(sys::Error {
                    errno,
                    syscall: sys::Tag::utime,
                    path: args.path.slice().into(),
                    ..Default::default()
                })
            } else {
                Ok(())
            };
        }
        #[cfg(not(windows))]
        match Syscall::utimens(
            args.path.slice_z(&mut self.sync_error_buf),
            to_sys_time_like(args.atime),
            to_sys_time_like(args.mtime),
        ) {
            Err(err) => Err(err.with_path(args.path.slice())),
            Ok(_) => Ok(()),
        }
    }

    pub fn lutimes(&mut self, args: &args::Lutimes, _: Flavor) -> Maybe<ret::Lutimes> {
        #[cfg(windows)]
        {
            let mut req = UvFsReq::new();
            let rc = unsafe {
                uv::uv_fs_lutime(
                    bun_io::Loop::get(),
                    &mut *req,
                    args.path.slice_z(&mut self.sync_error_buf).as_ptr(),
                    args.atime,
                    args.mtime,
                    None,
                )
            };
            return if let Some(errno) = rc.errno() {
                Err(sys::Error {
                    errno,
                    syscall: sys::Tag::utime,
                    path: args.path.slice().into(),
                    ..Default::default()
                })
            } else {
                Ok(())
            };
        }
        #[cfg(not(windows))]
        match Syscall::lutimens(
            args.path.slice_z(&mut self.sync_error_buf),
            to_sys_time_like(args.atime),
            to_sys_time_like(args.mtime),
        ) {
            Err(err) => Err(err.with_path(args.path.slice())),
            Ok(_) => Ok(()),
        }
    }

    pub fn watch(&mut self, args: args::Watch<'_>, _: Flavor) -> Maybe<ret::Watch> {
        match args.create_fs_watcher() {
            // SAFETY: `create_fs_watcher` returns a freshly-heap-allocated
            // `*mut FSWatcher` whose ownership is held by the JS wrapper
            // (`js_this`); reading `js_this` here mirrors Zig's
            // `result.js_this` field access on the by-value return.
            Ok(result) => Ok(unsafe { (*result).js_this() }),
            Err(err) => Err(err),
        }
    }

    /// This function is `cpSync`, but only if you pass `{ recursive: ..., force: ..., errorOnExist: ..., mode: ... }'
    /// The other options like `filter` use a JS fallback, see `src/js/internal/fs/cp.ts`
    pub fn cp(&mut self, args: &args::Cp, _: Flavor) -> Maybe<ret::Cp> {
        let mut src_buf = OSPathBuffer::uninit();
        let mut dest_buf = OSPathBuffer::uninit();
        let src_len = args.src.os_path(&mut src_buf).len();
        let dest_len = args.dest.os_path(&mut dest_buf).len();
        self.cp_sync_inner(
            &mut src_buf,
            PathInt::try_from(src_len).expect("int cast"),
            &mut dest_buf,
            PathInt::try_from(dest_len).expect("int cast"),
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
        {
            return strings::from_wpath(buf, slice);
        }
        #[cfg(not(windows))]
        {
            buf[..slice.len()].copy_from_slice(slice);
            &buf[..slice.len()]
        }
    }

    pub fn os_path_into_sync_error_buf_overlap<'a>(
        &'a mut self,
        slice: &'a [OSPathChar],
    ) -> &'a [u8] {
        #[cfg(windows)]
        {
            let mut tmp = paths::os_path_buffer_pool::get();
            tmp[..slice.len()].copy_from_slice(slice);
            return strings::from_wpath(&mut self.sync_error_buf, &tmp[..slice.len()]);
        }
        #[cfg(not(windows))]
        {
            // PORT NOTE: Zig has no POSIX arm here — every call site is inside
            // an `if (Environment.isWindows)` branch. On POSIX `OSPathChar == u8`,
            // so the input is already the canonical byte slice; tie both inputs
            // to the same `'a` so the borrow checker accepts the passthrough.
            let _ = &mut self.sync_error_buf;
            slice
        }
    }

    fn cp_sync_inner(
        &mut self,
        src_buf: &mut OSPathBuffer,
        src_dir_len: PathInt,
        dest_buf: &mut OSPathBuffer,
        dest_dir_len: PathInt,
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
                return Err(sys::Error {
                    errno: SystemErrno::ENOENT as _,
                    syscall: sys::Tag::copyfile,
                    path: self.os_path_into_sync_error_buf(src.as_slice()).into(),
                    ..Default::default()
                });
            }
            if attributes & sys::c::FILE_ATTRIBUTE_DIRECTORY == 0 {
                let r = self._copy_single_file_sync(
                    src,
                    dest,
                    constants::Copyfile::from_raw(if cp_flags.error_on_exist || !cp_flags.force {
                        constants::COPYFILE_EXCL
                    } else {
                        0i32
                    }),
                    Some(attributes),
                    args,
                );
                if let Err(ref e) = r {
                    if e.errno == E::EEXIST as _ && !cp_flags.error_on_exist {
                        return Ok(());
                    }
                }
                return r;
            }
        }
        #[cfg(not(windows))]
        {
            let stat_ = match Syscall::lstat(src) {
                Ok(result) => result,
                Err(err) => {
                    self.sync_error_buf[..sd].copy_from_slice(src.as_bytes());
                    return Err(err.with_path(&self.sync_error_buf[..sd]));
                }
            };
            if !sys::S::ISDIR(stat_.st_mode as _) {
                let r = self._copy_single_file_sync(
                    src,
                    dest,
                    constants::Copyfile::from_raw(if cp_flags.error_on_exist || !cp_flags.force {
                        constants::COPYFILE_EXCL
                    } else {
                        0i32
                    }),
                    Some(stat_),
                    args,
                );
                if let Err(ref e) = r {
                    if e.errno == E::EEXIST as _ && !cp_flags.error_on_exist {
                        return Ok(());
                    }
                }
                return r;
            }
        }

        if !cp_flags.recursive {
            return Err(sys::Error {
                errno: E::EISDIR as _,
                syscall: sys::Tag::copyfile,
                path: self.os_path_into_sync_error_buf(&src_buf[..sd]).into(),
                ..Default::default()
            });
        }

        #[cfg(target_os = "macos")]
        'try_with_clonefile: {
            if let Some(err) = Maybe::<ret::Cp>::errno_sys_p(
                bun_sys::c::clonefile_rc(src, dest, 0),
                sys::Tag::clonefile,
                src.as_bytes(),
            ) {
                match err.get_errno() {
                    E::ENAMETOOLONG | E::EROFS | E::EINVAL | E::EACCES | E::EPERM => {
                        if matches!(err.get_errno(), E::EACCES | E::EPERM) && args.flags.force {
                            break 'try_with_clonefile;
                        }
                        // Zig copies `src` into `sync_error_buf` and `.withPath()`s it so
                        // the borrowed slice outlives `src_buf`. `errno_sys_p` already boxed
                        // `src.as_bytes()` into the inner `Error::path`, so just propagate.
                        return err;
                    }
                    // Other errors may be due to clonefile() not being supported
                    // We'll fall back to other implementations
                    _ => {}
                }
            } else {
                return Ok(());
            }
        }

        let fd = match openat_os_path(FD::cwd(), src, sys::O::DIRECTORY | sys::O::RDONLY, 0) {
            Err(err) => return Err(err.with_path(self.os_path_into_sync_error_buf(&src_buf[..sd]))),
            Ok(fd_) => fd_,
        };
        let _close = scopeguard::guard(fd, |fd| fd.close());

        match self.mkdir_recursive_os_path(dest, args::Mkdir::DEFAULT_MODE, false) {
            Err(err) => return Err(err),
            Ok(_) => {}
        }

        // PORT NOTE: Zig used `.u16` iterator on Windows so `name.slice()` is `[]u16`.
        // The OSPathBuffer copy below is generic over `OSPathChar`, so on Windows
        // this needs the wide iterator; the u8 path is correct for POSIX.
        #[cfg(windows)]
        let mut iterator = DirIterator::WrappedIteratorW::init(fd);
        #[cfg(not(windows))]
        let mut iterator = DirIterator::WrappedIterator::init(fd);

        loop {
            let current = match iterator.next() {
                Err(err) => {
                    return Err(err.with_path(self.os_path_into_sync_error_buf(&src_buf[..sd])));
                }
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
                return Err(sys::Error {
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
                        src_buf,
                        (sd + 1 + name_slice.len()) as PathInt,
                        dest_buf,
                        (dd + 1 + name_slice.len()) as PathInt,
                        args,
                    );
                    if let Err(_) = r {
                        return r;
                    }
                }
                _ => {
                    // NUL written at [len] above; `from_buf` debug-asserts it.
                    let src_z = OSPathSliceZ::from_buf(&src_buf[..], sd + 1 + name_slice.len());
                    let dest_z = OSPathSliceZ::from_buf(&dest_buf[..], dd + 1 + name_slice.len());
                    let r = self._copy_single_file_sync(
                        src_z,
                        dest_z,
                        constants::Copyfile::from_raw(
                            if cp_flags.error_on_exist || !cp_flags.force {
                                constants::COPYFILE_EXCL
                            } else {
                                0i32
                            },
                        ),
                        None,
                        args,
                    );
                    if let Err(ref e) = r {
                        if e.errno == E::EEXIST as _ && !cp_flags.error_on_exist {
                            continue;
                        }
                        return r;
                    }
                }
            }
        }
        Ok(())
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
    fn should_ignore_ebusy(
        src: &PathLike,
        dest: &PathLike,
        result: Maybe<ret::CopyFile>,
    ) -> Maybe<ret::CopyFile> {
        #[cfg(not(windows))]
        {
            let _ = (src, dest);
            return result;
        }
        #[cfg(windows)]
        {
            let Err(ref e) = result else { return result };
            if e.get_errno() != E::BUSY {
                return result;
            }
            let mut buf = PathBuffer::uninit();
            let Ok(statbuf) = Syscall::stat(src.slice_z(&mut buf)) else {
                return result;
            };
            let Ok(new_statbuf) = Syscall::stat(dest.slice_z(&mut buf)) else {
                return result;
            };
            if statbuf.st_dev == new_statbuf.st_dev && statbuf.st_ino == new_statbuf.st_ino {
                return Ok(());
            }
            result
        }
    }

    fn _cp_symlink(&mut self, src: &ZStr, dest: &ZStr) -> Maybe<ret::CopyFile> {
        let mut target_buf = PathBuffer::uninit();
        // PORT NOTE: `bun_sys::readlink` returns the byte length on every
        // platform (the `Syscall` alias = `sys_uv` on Windows would return the
        // slice itself); reconstruct the `[:0]const u8` view from `target_buf`.
        let link_len = match sys::readlink(src, &mut target_buf[..]) {
            Ok(result) => result,
            Err(err) => {
                self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                return Err(err.with_path(&self.sync_error_buf[..src.len()]));
            }
        };
        target_buf[link_len] = 0;
        // SAFETY: NUL written at `target_buf[link_len]`.
        let link_target = ZStr::from_buf(&target_buf[..], link_len);
        if paths::is_absolute(link_target.as_bytes()) {
            return Syscall::symlink(link_target, dest);
        }
        let mut cwd_buf = PathBuffer::uninit();
        let mut resolved_buf = PathBuffer::uninit();
        let src_dir = paths::resolve_path::dirname::<paths::platform::Posix>(src.as_bytes());
        let Ok(cwd_len) = sys::getcwd(&mut cwd_buf[..]) else {
            // If we can't resolve cwd, preserve the link target as-is rather
            // than pointing the copied link back at the source path.
            return Syscall::symlink(link_target, dest);
        };
        let cwd = &cwd_buf[..cwd_len];
        let resolved_buf_len = resolved_buf.len();
        let Some(resolved) =
            paths::resolve_path::join_abs_string_buf_checked::<paths::platform::Posix>(
                cwd,
                &mut resolved_buf[..resolved_buf_len - 1],
                &[src_dir, link_target.as_bytes()],
            )
        else {
            self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
            return Err(sys::Error {
                errno: E::ENAMETOOLONG as _,
                syscall: sys::Tag::symlink,
                path: self.sync_error_buf[..src.len()].into(),
                ..Default::default()
            });
        };
        let resolved_len = resolved.len();
        resolved_buf[resolved_len] = 0;
        // SAFETY: NUL written at `resolved_buf[resolved_len]`.
        Syscall::symlink(ZStr::from_buf(&resolved_buf[..], resolved_len), dest)
    }

    /// This is `copyFile`, but it copies symlinks as-is
    pub fn _copy_single_file_sync(
        &mut self,
        src: &OSPathSliceZ,
        dest: &OSPathSliceZ,
        mode: constants::Copyfile,
        // Stat on posix, file attributes on windows
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
                    bun_sys::c::clonefile_rc(src, dest, 0),
                    sys::Tag::clonefile,
                    src.as_bytes(),
                )
                .unwrap_or(Ok(()));
            }
            let stat_ = match reuse_stat {
                Some(s) => s,
                None => match Syscall::lstat(src) {
                    Ok(result) => result,
                    Err(err) => {
                        self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                        return Err(err.with_path(&self.sync_error_buf[..src.len()]));
                    }
                },
            };

            if !sys::S::ISREG(stat_.st_mode as u32) {
                if sys::S::ISLNK(stat_.st_mode as u32) {
                    let mut mode_: u32 = bun_sys::c::COPYFILE_ACL
                        | bun_sys::c::COPYFILE_DATA
                        | bun_sys::c::COPYFILE_NOFOLLOW_SRC;
                    if mode.shouldnt_overwrite() {
                        mode_ |= bun_sys::c::COPYFILE_EXCL;
                    }
                    return Maybe::<ret::CopyFile>::errno_sys_p(
                        bun_sys::c::copyfile_rc(src, dest, mode_),
                        sys::Tag::copyfile,
                        src.as_bytes(),
                    )
                    .unwrap_or(Ok(()));
                }
                self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                return Err(sys::Error {
                    errno: SystemErrno::ENOTSUP as _,
                    path: self.sync_error_buf[..src.len()].into(),
                    syscall: sys::Tag::copyfile,
                    ..Default::default()
                });
            }

            // 64 KB is about the break-even point for clonefile() to be worth it
            // at least, on an M1 with an NVME SSD.
            if stat_.st_size > 128 * 1024 {
                if !mode.shouldnt_overwrite() {
                    // clonefile() will fail if it already exists
                    let _ = Syscall::unlink(dest);
                }
                if Maybe::<ret::CopyFile>::errno_sys_p(
                    bun_sys::c::clonefile_rc(src, dest, 0),
                    sys::Tag::clonefile,
                    src.as_bytes(),
                )
                .is_none()
                {
                    let _ = Syscall::chmod(dest, stat_.st_mode as u32);
                    return Ok(());
                }
            } else {
                let src_fd = match Syscall::open(src, sys::O::RDONLY, 0o644) {
                    Ok(result) => result,
                    Err(err) => {
                        self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                        return Err(err.with_path(&self.sync_error_buf[..src.len()]));
                    }
                };
                let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

                let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
                let wrote: core::cell::Cell<u64> = core::cell::Cell::new(0);
                if mode.shouldnt_overwrite() {
                    flags |= sys::O::EXCL;
                }

                let dest_fd = match Self::_cp_open_dest_with_mkdir(self, dest, flags) {
                    Ok(fd) => fd,
                    Err(e) => return Err(e),
                };
                let _close_dest =
                    scopeguard::guard((dest_fd, stat_.st_mode, &wrote), |(fd, m, wrote)| {
                        let _ = Syscall::ftruncate(fd, (wrote.get() & ((1u64 << 63) - 1)) as i64);
                        let _ = Syscall::fchmod(fd, m as u32);
                        fd.close();
                    });

                let mut w = wrote.get();
                let r = Self::copy_file_using_read_write_loop(
                    src,
                    dest,
                    src_fd,
                    dest_fd,
                    stat_.st_size.max(0) as usize,
                    &mut w,
                );
                wrote.set(w);
                return r;
            }

            // we fallback to copyfile() when the file is > 128 KB and clonefile fails
            // clonefile() isn't supported on all devices
            // nor is it supported across devices
            let mut mode_: u32 = bun_sys::c::COPYFILE_ACL
                | bun_sys::c::COPYFILE_DATA
                | bun_sys::c::COPYFILE_NOFOLLOW_SRC;
            if mode.shouldnt_overwrite() {
                mode_ |= bun_sys::c::COPYFILE_EXCL;
            }

            let first_try = Maybe::<ret::CopyFile>::errno_sys_p(
                bun_sys::c::copyfile_rc(src, dest, mode_),
                sys::Tag::copyfile,
                src.as_bytes(),
            );
            match first_try {
                None => return Ok(()),
                Some(err) if err.get_errno() == E::ENOENT => {
                    let _ = sys::Dir::cwd().make_path(paths::resolve_path::dirname::<
                        paths::platform::Auto,
                    >(dest.as_bytes()));
                    return Maybe::<ret::CopyFile>::errno_sys_p(
                        bun_sys::c::copyfile_rc(src, dest, mode_),
                        sys::Tag::copyfile,
                        src.as_bytes(),
                    )
                    .unwrap_or(Ok(()));
                }
                Some(err) => return err,
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let _ = reuse_stat;
            // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
            if mode.is_force_clone() {
                return Maybe::<ret::CopyFile>::todo();
            }

            let src_fd = match Syscall::open(src, sys::O::RDONLY | sys::O::NOFOLLOW, 0o644) {
                Ok(result) => result,
                Err(err) => {
                    if err.get_errno() == E::ELOOP {
                        // ELOOP is returned when you open a symlink with NOFOLLOW.
                        // as in, it does not actually let you open it.
                        return self._cp_symlink(src, dest);
                    }
                    return Err(err);
                }
            };
            let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

            let stat_ = match Syscall::fstat(src_fd) {
                Ok(result) => result,
                Err(err) => return Err(err.with_fd(src_fd)),
            };

            if !sys::S::ISREG(stat_.st_mode as u32) {
                return Err(sys::Error {
                    errno: SystemErrno::ENOTSUP as _,
                    syscall: sys::Tag::copyfile,
                    ..Default::default()
                });
            }

            let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
            let wrote: core::cell::Cell<u64> = core::cell::Cell::new(0);
            if mode.shouldnt_overwrite() {
                flags |= sys::O::EXCL;
            }

            let dest_fd = match Self::_cp_open_dest_with_mkdir(self, dest, flags) {
                Ok(fd) => fd,
                Err(e) => return Err(e),
            };

            let mut size: usize = stat_.st_size.max(0) as usize;

            if sys::S::ISREG(stat_.st_mode as u32) && sys::copy_file::can_use_ioctl_ficlone() {
                let rc = sys::linux::ioctl_ficlone(dest_fd, src_fd);
                if rc == 0 {
                    let _ = Syscall::fchmod(dest_fd, stat_.st_mode as u32);
                    dest_fd.close();
                    return Ok(());
                }
                sys::copy_file::disable_ioctl_ficlone();
            }

            let _close_dest = scopeguard::guard(
                (dest_fd, stat_.st_mode as Mode, &wrote),
                |(fd, m, wrote)| {
                    let _ = Syscall::ftruncate(fd, (wrote.get() & ((1u64 << 63) - 1)) as i64);
                    let _ = Syscall::fchmod(fd, m);
                    fd.close();
                },
            );

            let mut off_in_copy: i64 = 0;
            let mut off_out_copy: i64 = 0;

            if !sys::copy_file::can_use_copy_file_range_syscall() {
                let mut w = wrote.get();
                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(
                    src, dest, src_fd, dest_fd, size, &mut w,
                );
                wrote.set(w);
                return r;
            }

            if size == 0 {
                // copy until EOF
                loop {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                    let written = unsafe {
                        sys::linux::copy_file_range(
                            src_fd.native(),
                            &raw mut off_in_copy,
                            dest_fd.native(),
                            &raw mut off_out_copy,
                            sys::page_size(),
                            0,
                        )
                    };
                    if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(
                        written,
                        sys::Tag::copy_file_range,
                        dest.as_bytes(),
                    ) {
                        match err.get_errno() {
                            // EINVAL: eCryptfs and other filesystems may not support copy_file_range
                            // XDEV: cross-device copy not supported
                            // NOSYS: syscall not available
                            // OPNOTSUPP: filesystem doesn't support this operation
                            E::EXDEV | E::ENOSYS | E::EINVAL | E::EOPNOTSUPP => {
                                if matches!(err.get_errno(), E::ENOSYS | E::EOPNOTSUPP) {
                                    sys::copy_file::disable_copy_file_range_syscall();
                                }
                                let mut w = wrote.get();
                                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut w);
                                wrote.set(w);
                                return r;
                            }
                            _ => return err,
                        }
                    }
                    // wrote zero bytes means EOF
                    if written == 0 {
                        break;
                    }
                    wrote.set(wrote.get().saturating_add(written as u64));
                }
            } else {
                while size > 0 {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                    let written = unsafe {
                        sys::linux::copy_file_range(
                            src_fd.native(),
                            &raw mut off_in_copy,
                            dest_fd.native(),
                            &raw mut off_out_copy,
                            size,
                            0,
                        )
                    };
                    if let Some(err) = Maybe::<ret::CopyFile>::errno_sys_p(
                        written,
                        sys::Tag::copy_file_range,
                        dest.as_bytes(),
                    ) {
                        match err.get_errno() {
                            // EINVAL: eCryptfs and other filesystems may not support copy_file_range
                            // XDEV: cross-device copy not supported
                            // NOSYS: syscall not available
                            // OPNOTSUPP: filesystem doesn't support this operation
                            E::EXDEV | E::ENOSYS | E::EINVAL | E::EOPNOTSUPP => {
                                if matches!(err.get_errno(), E::ENOSYS | E::EOPNOTSUPP) {
                                    sys::copy_file::disable_copy_file_range_syscall();
                                }
                                let mut w = wrote.get();
                                let r = Self::copy_file_using_sendfile_on_linux_with_read_write_fallback(src, dest, src_fd, dest_fd, size, &mut w);
                                wrote.set(w);
                                return r;
                            }
                            _ => return err,
                        }
                    }
                    // wrote zero bytes means EOF
                    if written == 0 {
                        break;
                    }
                    wrote.set(wrote.get().saturating_add(written as u64));
                    size = size.saturating_sub(written as usize);
                }
            }

            return Ok(());
        }

        #[cfg(target_os = "freebsd")]
        {
            let _ = reuse_stat;
            if mode.is_force_clone() {
                return Err(sys::Error {
                    errno: SystemErrno::EOPNOTSUPP as _,
                    syscall: sys::Tag::copyfile,
                    ..Default::default()
                });
            }

            let src_fd = match Syscall::open(src, sys::O::RDONLY | sys::O::NOFOLLOW, 0o644) {
                Ok(result) => result,
                Err(err) => {
                    // O_NOFOLLOW on a symlink → recreate the link. FreeBSD's
                    // open(2) returns EMLINK for this case, though POSIX
                    // specifies ELOOP; accept either.
                    if matches!(err.get_errno(), E::EMLINK | E::ELOOP) {
                        return self._cp_symlink(src, dest);
                    }
                    return Err(err);
                }
            };
            let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

            let stat_ = match Syscall::fstat(src_fd) {
                Ok(result) => result,
                Err(err) => return Err(err.with_fd(src_fd)),
            };
            if !sys::S::ISREG(stat_.st_mode as u32) {
                return Err(sys::Error {
                    errno: SystemErrno::EOPNOTSUPP as _,
                    syscall: sys::Tag::copyfile,
                    ..Default::default()
                });
            }

            let mut flags: i32 = sys::O::CREAT | sys::O::WRONLY;
            let wrote: core::cell::Cell<u64> = core::cell::Cell::new(0);
            if mode.shouldnt_overwrite() {
                flags |= sys::O::EXCL;
            }

            let dest_fd = match Self::_cp_open_dest_with_mkdir(self, dest, flags) {
                Ok(fd) => fd,
                Err(e) => return Err(e),
            };

            // No O_TRUNC at open: if src and dest resolve to the same inode,
            // that would zero the file before the first read.
            if let Ok(dst_stat) = Syscall::fstat(dest_fd) {
                if stat_.st_ino == dst_stat.st_ino && stat_.st_dev == dst_stat.st_dev {
                    dest_fd.close();
                    self.sync_error_buf[..src.len()].copy_from_slice(src.as_bytes());
                    return Err(sys::Error {
                        errno: SystemErrno::EINVAL as _,
                        syscall: sys::Tag::copyfile,
                        path: self.sync_error_buf[..src.len()].into(),
                        ..Default::default()
                    });
                }
            }

            let _close_dest = scopeguard::guard(
                (dest_fd, stat_.st_mode as Mode, &wrote),
                |(fd, m, wrote)| {
                    let _ = Syscall::ftruncate(fd, (wrote.get() & ((1u64 << 63) - 1)) as i64);
                    let _ = Syscall::fchmod(fd, m);
                    fd.close();
                },
            );

            let size: usize = stat_.st_size.max(0) as usize;

            // FreeBSD 13+ has copy_file_range(2). std.c declares it returning
            // usize on FreeBSD, so bitcast to isize before getErrno.
            let mut off_in: i64 = 0;
            let mut off_out: i64 = 0;
            'cfr: loop {
                let want = if size == 0 {
                    (i32::MAX - 1) as usize
                } else {
                    size.saturating_sub(wrote.get() as usize)
                };
                // SAFETY: src_fd/dest_fd are valid open fds; copy_file_range is the libc FFI
                let rc: isize = unsafe {
                    sys::freebsd::copy_file_range(
                        src_fd.native(),
                        &mut off_in,
                        dest_fd.native(),
                        &mut off_out,
                        want,
                        0,
                    )
                } as isize;
                match sys::get_errno(rc) {
                    E::SUCCESS => {
                        if rc == 0 {
                            return Ok(());
                        }
                        wrote.set(wrote.get().saturating_add(rc as u64));
                        if size != 0 && wrote.get() >= size as u64 {
                            return Ok(());
                        }
                    }
                    E::EINTR => continue,
                    E::EXDEV | E::EINVAL | E::EOPNOTSUPP | E::ENOSYS | E::EBADF => break 'cfr,
                    e => {
                        self.sync_error_buf[..dest.len()].copy_from_slice(dest.as_bytes());
                        return Err(sys::Error {
                            errno: e as _,
                            syscall: sys::Tag::copyfile,
                            path: self.sync_error_buf[..dest.len()].into(),
                            ..Default::default()
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
            if mode.is_force_clone() {
                // Windows has no copy-on-write `clonefile` equivalent surfaced
                // here; `COPYFILE_FICLONE_FORCE` must fail rather than silently
                // fall back to a non-CoW `CopyFileW`. NOTE: the Zig Windows
                // block (node_fs.zig:6836+) has no such guard and falls through
                // to `CopyFileW`; this is an intentional divergence to match
                // Node.js' documented FICLONE_FORCE contract and the
                // Linux/FreeBSD arms above. Return a concrete ENOSYS rather
                // than `Maybe::todo()` so debug builds do not panic.
                return Err(sys::Error {
                    errno: SystemErrno::ENOSYS as _,
                    syscall: sys::Tag::copyfile,
                    ..Default::default()
                });
            }
            // Spec (node_fs.zig:6837-6838) precomputes both ENOENT fallbacks once,
            // before any branch. Re-deriving them inline inside `unwrap_or_else`
            // double-borrows `&mut self` (the outer `errno_sys_p` arg already holds
            // a borrow into `sync_error_buf`).
            let src_enoent_maybe = Maybe::<ret::CopyFile>::init_err_with_p(
                SystemErrno::ENOENT,
                sys::Tag::copyfile,
                self.os_path_into_sync_error_buf(src.as_slice()),
            );
            let dst_enoent_maybe = Maybe::<ret::CopyFile>::init_err_with_p(
                SystemErrno::ENOENT,
                sys::Tag::copyfile,
                self.os_path_into_sync_error_buf(dest.as_slice()),
            );
            let stat_ = match reuse_stat {
                Some(a) => a,
                None => {
                    let a = unsafe { sys::c::GetFileAttributesW(src.as_ptr()) };
                    if a == sys::c::INVALID_FILE_ATTRIBUTES {
                        // `errno_sys_p(0, …)` re-reads `GetLastError()` after
                        // `os_path_into_sync_error_buf` (a non-trivial transcode on
                        // Windows). If anything in that path ever clears the
                        // thread-local last-error, fall back to ENOENT instead of
                        // panicking on `.unwrap()` (matches the neighbouring sites).
                        let p = self.os_path_into_sync_error_buf(src.as_slice());
                        return Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, p)
                            .unwrap_or(src_enoent_maybe);
                    }
                    a
                }
            };
            if stat_ & sys::c::FILE_ATTRIBUTE_REPARSE_POINT == 0 {
                if unsafe {
                    sys::c::CopyFileW(
                        src.as_ptr(),
                        dest.as_ptr(),
                        mode.shouldnt_overwrite() as i32,
                    )
                } == 0
                {
                    // Zig `windows.GetLastError()` returns the `Win32Error`
                    // enum, not the raw DWORD — use the typed wrapper so the
                    // associated-const match arms type-check.
                    let mut err = windows::Win32Error::get();
                    match err {
                        windows::Win32Error::FILE_EXISTS | windows::Win32Error::ALREADY_EXISTS => {}
                        windows::Win32Error::PATH_NOT_FOUND => {
                            let _ = sys::make_path::make_path_u16(
                                sys::Dir::cwd(),
                                paths::dirname_w(dest.as_slice()),
                            );
                            let second_try = unsafe {
                                sys::c::CopyFileW(
                                    src.as_ptr(),
                                    dest.as_ptr(),
                                    mode.shouldnt_overwrite() as i32,
                                )
                            };
                            if second_try > 0 {
                                return Ok(());
                            }
                            err = windows::Win32Error::get();
                        }
                        _ => {}
                    }
                    let _ = err;
                    let p = self.os_path_into_sync_error_buf(dest.as_slice());
                    let result = Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, p)
                        .unwrap_or(src_enoent_maybe);
                    return Self::should_ignore_ebusy(&args.src, &args.dest, result);
                }
                return Ok(());
            } else {
                let handle = match sys::openat_windows(FD::INVALID, src, sys::O::RDONLY, 0) {
                    Err(err) => return Err(err),
                    Ok(fd) => fd,
                };
                let _close = scopeguard::guard(handle, |fd| fd.close());
                let mut wbuf = paths::os_path_buffer_pool::get();
                let len = unsafe {
                    windows::GetFinalPathNameByHandleW(
                        handle.native(),
                        wbuf.as_mut_ptr(),
                        wbuf.len() as u32,
                        0,
                    )
                } as usize;
                if len == 0 || len >= wbuf.len() {
                    let p = self.os_path_into_sync_error_buf(dest.as_slice());
                    return Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, p)
                        .unwrap_or(dst_enoent_maybe);
                }
                let flags = if stat_ & windows::FILE_ATTRIBUTE_DIRECTORY != 0 {
                    windows::SYMBOLIC_LINK_FLAG_DIRECTORY
                } else {
                    0
                };
                wbuf[len] = 0;
                if unsafe { windows::CreateSymbolicLinkW(dest.as_ptr(), wbuf.as_ptr(), flags) } == 0
                {
                    let p = self.os_path_into_sync_error_buf(dest.as_slice());
                    return Maybe::<ret::CopyFile>::errno_sys_p(0, sys::Tag::copyfile, p)
                        .unwrap_or(dst_enoent_maybe);
                }
                return Ok(());
            }
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "linux",
            target_os = "android",
            target_os = "freebsd",
            windows
        )))]
        #[allow(unreachable_code)]
        {
            let _ = (src, dest, mode, reuse_stat);
            Maybe::<ret::CopyFile>::todo()
        }
    }

    /// Shared `dest_fd:` block from the mac/linux/freebsd branches of
    /// `_copySingleFileSync` (node_fs.zig:6528-6555 / 6624-6651 / 6770-6794).
    /// Tries `open(dest, flags, default_permission)`; on ENOENT creates the
    /// parent directory and retries once. Any other error is annotated with
    /// `dest` copied into `sync_error_buf`.
    fn _cp_open_dest_with_mkdir(&mut self, dest: &ZStr, flags: i32) -> Maybe<FD> {
        // PORT: extracted from the mac/linux/freebsd arms of `_copySingleFileSync`
        // only — there `OSPathSliceZ == ZStr`. Taking `&ZStr` keeps the body
        // monomorphic (and lets it type-check on Windows where it's dead code).
        match Syscall::open(dest, flags, DEFAULT_PERMISSION) {
            Ok(result) => Ok(result),
            Err(err) => {
                if err.get_errno() == E::ENOENT {
                    // Create the parent directory if it doesn't exist
                    let bytes = dest.as_bytes();
                    let mut len = bytes.len();
                    while len > 0 && bytes[len - 1] != paths::SEP {
                        len -= 1;
                    }
                    let mkdir_result = self.mkdir_recursive(&args::Mkdir {
                        path: PathLike::String(PathString::init(&bytes[..len])),
                        recursive: true,
                        ..Default::default()
                    });
                    if let Err(e) = mkdir_result {
                        return Err(e);
                    }
                    if let Ok(result) = Syscall::open(dest, flags, DEFAULT_PERMISSION) {
                        return Ok(result);
                    }
                }
                self.sync_error_buf[..dest.len()].copy_from_slice(dest.as_bytes());
                Err(err.with_path(&self.sync_error_buf[..dest.len()]))
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
        &mut self,
        args: args::CpFlags,
        task: *mut AsyncCpTask,
        src_buf: &mut OSPathBuffer,
        src_dir_len: PathInt,
        dest_buf: &mut OSPathBuffer,
        dest_dir_len: PathInt,
    ) -> bool {
        AsyncCpTask::_cp_async_directory(
            self,
            args,
            task,
            src_buf,
            src_dir_len,
            dest_buf,
            dest_dir_len,
        )
    }

    /// Const-generic dispatch from `NodeFSFunctionEnum` to the matching
    /// `NodeFS::<method>`.
    ///
    /// PORT NOTE: Zig spells this `@field(NodeFS, @tagName(FunctionEnum))(self,
    /// args, .async)`. Rust has no field-by-string reflection, so the
    /// `(R, A, F)` triple is bound by [`NodeFSDispatch`] impls (one per
    /// `NodeFSFunctionEnum` variant); the `where Op<{F}>: NodeFSDispatch<R, A>`
    /// bound proves `R == ret::*` / `A == args::*` for this `F` so no identity
    /// cast is needed.
    #[inline]
    pub fn dispatch<R, A, const F: NodeFSFunctionEnum>(
        &mut self,
        args: &A,
        flavor: Flavor,
    ) -> Maybe<R>
    where
        Op<{ F }>: NodeFSDispatch<R, A>,
    {
        <Op<{ F }> as NodeFSDispatch<R, A>>::run(self, args, flavor)
    }

    #[cfg(windows)]
    #[inline]
    pub fn uv_dispatch<R, A, const F: NodeFSFunctionEnum>(&mut self, args: &A, rc: i64) -> Maybe<R>
    where
        Op<{ F }>: NodeFSDispatch<R, A>,
    {
        <Op<{ F }> as NodeFSDispatch<R, A>>::run_uv(self, args, rc)
    }

    /// Variant of [`Self::uv_dispatch`] for `uv_callbackreq` — passes the live
    /// `uv::fs_t` through so the handler can read `req.ptr` (only `statfs`
    /// needs it; node_fs.zig:276-288).
    #[cfg(windows)]
    #[inline]
    pub fn uv_dispatch_req<R, A, const F: NodeFSFunctionEnum>(
        &mut self,
        args: &A,
        req: &mut uv::fs_t,
        rc: i64,
    ) -> Maybe<R>
    where
        Op<{ F }>: NodeFSDispatch<R, A>,
    {
        <Op<{ F }> as NodeFSDispatch<R, A>>::run_uv_req(self, args, req, rc)
    }
}

/// Type-level marker for [`NodeFSDispatch`] — one ZST per `NodeFSFunctionEnum`
/// variant. Exists so the `(R, A) ↔ F` binding can be proved by a `where`
/// bound instead of pointer-cast identity casts.
pub struct Op<const F: NodeFSFunctionEnum>;

/// Per-`F` binding from `(R, A)` to its `NodeFS` method. Every
/// `AsyncFSTask<R, A, {F}>` / `UVFSRequest<R, A, {F}>` instantiation in
/// `async_::*` has exactly one impl, so the `where Op<{F}>: NodeFSDispatch<R, A>`
/// bound is always satisfied at every monomorphised call site.
pub trait NodeFSDispatch<R, A> {
    fn run(fs: &mut NodeFS, args: &A, flavor: Flavor) -> Maybe<R>;
    #[cfg(windows)]
    fn run_uv(_fs: &mut NodeFS, _args: &A, _rc: i64) -> Maybe<R> {
        unreachable!("uv_dispatch: not a UVFSRequest variant")
    }
    #[cfg(windows)]
    fn run_uv_req(_fs: &mut NodeFS, _args: &A, _req: &mut uv::fs_t, _rc: i64) -> Maybe<R> {
        unreachable!("uv_dispatch_req: not a req-passing UVFSRequest variant")
    }
}

macro_rules! node_fs_ops {
    ($(
        $Variant:ident => $method:ident, $Args:ty, $Ret:ty
        $(, uv = $uv_method:ident)?
        $(, uv_req = $uv_req_method:ident)?
    );+ $(;)?) => {
        $(
            impl NodeFSDispatch<$Ret, $Args> for Op<{ NodeFSFunctionEnum::$Variant }> {
                #[inline]
                fn run(fs: &mut NodeFS, args: &$Args, flavor: Flavor) -> Maybe<$Ret> {
                    fs.$method(args, flavor)
                }
                $(
                    #[cfg(windows)]
                    #[inline]
                    fn run_uv(fs: &mut NodeFS, args: &$Args, rc: i64) -> Maybe<$Ret> {
                        fs.$uv_method(args, rc)
                    }
                )?
                $(
                    #[cfg(windows)]
                    #[inline]
                    fn run_uv_req(fs: &mut NodeFS, args: &$Args, req: &mut uv::fs_t, rc: i64) -> Maybe<$Ret> {
                        fs.$uv_req_method(args, req, rc)
                    }
                )?
            }
        )+
    };
}

node_fs_ops! {
    Access => access, args::Access, ret::Access;
    AppendFile => append_file, args::AppendFile, ret::AppendFile;
    Chmod => chmod, args::Chmod, ret::Chmod;
    Chown => chown, args::Chown, ret::Chown;
    Close => close, args::Close, ret::Close, uv = uv_close;
    CopyFile => copy_file, args::CopyFile, ret::CopyFile;
    Exists => exists, args::Exists, ret::Exists;
    Fchmod => fchmod, args::FChmod, ret::Fchmod;
    Fchown => fchown, args::Fchown, ret::Fchown;
    Fdatasync => fdatasync, args::FdataSync, ret::Fdatasync;
    Fstat => fstat, args::Fstat, ret::Fstat;
    Fsync => fsync, args::Fsync, ret::Fsync;
    Ftruncate => ftruncate, args::FTruncate, ret::Ftruncate;
    Futimes => futimes, args::Futimes, ret::Futimes;
    Lchmod => lchmod, args::LCHmod, ret::Lchmod;
    Lchown => lchown, args::LChown, ret::Lchown;
    Link => link, args::Link, ret::Link;
    Lstat => lstat, args::Lstat, ret::Lstat;
    Lutimes => lutimes, args::Lutimes, ret::Lutimes;
    Mkdir => mkdir, args::Mkdir, ret::Mkdir;
    Mkdtemp => mkdtemp, args::MkdirTemp, ret::Mkdtemp;
    Open => open, args::Open, ret::Open, uv = uv_open;
    Read => read, args::Read, ret::Read, uv = uv_read;
    Readdir => readdir, args::Readdir, ret::Readdir;
    ReadFile => read_file, args::ReadFile, ret::ReadFile;
    Readlink => readlink, args::Readlink, ret::Readlink;
    Readv => readv, args::Readv, ret::Readv, uv = uv_readv;
    Realpath => realpath, args::Realpath, ret::Realpath;
    RealpathNonNative => realpath_non_native, args::Realpath, ret::Realpath;
    Rename => rename, args::Rename, ret::Rename;
    Rm => rm, args::Rm, ret::Rm;
    Rmdir => rmdir, args::RmDir, ret::Rmdir;
    Stat => stat, args::Stat, ret::Stat;
    Statfs => statfs, args::StatFS, ret::StatFS, uv_req = uv_statfs;
    Symlink => symlink, args::Symlink, ret::Symlink;
    Truncate => truncate, args::Truncate, ret::Truncate;
    Unlink => unlink, args::Unlink, ret::Unlink;
    Utimes => utimes, args::Utimes, ret::Utimes;
    Write => write, args::Write, ret::Write, uv = uv_write;
    WriteFile => write_file, args::WriteFile, ret::WriteFile;
    Writev => writev, args::Writev, ret::Writev, uv = uv_writev;
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum RealpathVariant {
    Native,
    Emulated,
}

// PORT NOTE: was `pub enum StringType` inside `impl NodeFS` (Zig allowed
// nested type decls in struct bodies). Hoisted out — Rust forbids enums in
// inherent impls.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ReadFileStringType {
    Default,
    NullTerminated,
}

/// Trait for `mkdirRecursiveImpl` Ctx parameter (`void` does nothing).
pub trait MkdirCtx {
    fn on_create_dir(&self, _path: &OSPathSliceZ) {}
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
    /// `Environment.isWindows && (T == String || T == Dirent)` — selects the
    /// UTF-16 `DirIterator` arm on Windows (`readdir_with_entries` only).
    const IS_U16: bool;
    fn destroy_entry(&mut self);
    /// Windows-only: append from a UTF-16 directory entry name (node_fs.zig:4644-4660).
    /// Non-recursive readdir; `re_encoding_buffer` is the pooled scratch for
    /// `strings::from_w_path` when `encoding != utf8`. Only ever invoked when
    /// `IS_U16` is true — `Buffer`'s impl is a `@compileError`-equivalent
    /// `unreachable!()`.
    fn append_entry_w(
        entries: &mut Vec<Self>,
        utf16_name: &[u16],
        dirent_path: &BunString,
        kind: sys::FileKind,
        encoding: Encoding,
        re_encoding_buffer: Option<&mut PathBuffer>,
    );
    fn into_readdir(v: Vec<Self>) -> ret::Readdir;
    /// Non-recursive readdir: append one entry given the bare entry name.
    /// `dirent_path` is the basename's directory (encoded once per dir).
    fn append_entry(
        entries: &mut Vec<Self>,
        utf8_name: &[u8],
        dirent_path: &BunString,
        kind: sys::FileKind,
        encoding: Encoding,
    );
    /// Recursive readdir: `utf8_name` is the bare entry name, `name_to_copy`
    /// is the path *relative to the recursion root* (what Node returns).
    /// `apply_encoding` distinguishes the sync path (node_fs.zig:4962-4982,
    /// which honours `args.encoding` via `WebCore.encoding.toBunString`) from
    /// the async path (node_fs.zig:4800-4821, which uses raw
    /// `bun.String.cloneUTF8` and ignores the requested encoding).
    fn append_entry_recursive(
        entries: &mut Vec<Self>,
        utf8_name: &[u8],
        name_to_copy: &[u8],
        dirent_path: &BunString,
        kind: sys::FileKind,
        encoding: Encoding,
        apply_encoding: bool,
    );
}
impl ReaddirEntry for BunString {
    const IS_DIRENT: bool = false;
    const IS_U16: bool = Environment::IS_WINDOWS;
    fn destroy_entry(&mut self) {
        self.deref();
    }
    fn into_readdir(v: Vec<Self>) -> ret::Readdir {
        ret::Readdir::Files(v.into_boxed_slice())
    }
    fn append_entry(
        entries: &mut Vec<Self>,
        utf8_name: &[u8],
        _dirent_path: &BunString,
        _kind: sys::FileKind,
        encoding: Encoding,
    ) {
        entries.push(webcore::encoding::to_bun_string(utf8_name, encoding));
    }
    fn append_entry_w(
        entries: &mut Vec<Self>,
        utf16_name: &[u16],
        _dirent_path: &BunString,
        _kind: sys::FileKind,
        encoding: Encoding,
        re_encoding_buffer: Option<&mut PathBuffer>,
    ) {
        // node_fs.zig:4655-4662
        match encoding {
            Encoding::Buffer => unreachable!(),
            // in node.js, libuv converts to utf8 before node.js converts those bytes into other stuff
            // all encodings besides hex, base64, and base64url are mis-interpreting filesystem bytes.
            Encoding::Utf8 => entries.push(BunString::clone_utf16(utf16_name)),
            enc => {
                let utf8_path =
                    strings::paths::from_w_path(&mut re_encoding_buffer.unwrap()[..], utf16_name);
                entries.push(webcore::encoding::to_bun_string(utf8_path.as_bytes(), enc));
            }
        }
    }
    fn append_entry_recursive(
        entries: &mut Vec<Self>,
        _utf8_name: &[u8],
        name_to_copy: &[u8],
        _dirent_path: &BunString,
        _kind: sys::FileKind,
        encoding: Encoding,
        apply_encoding: bool,
    ) {
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
    const IS_U16: bool = Environment::IS_WINDOWS;
    fn destroy_entry(&mut self) {
        self.deref();
    }
    fn into_readdir(v: Vec<Self>) -> ret::Readdir {
        ret::Readdir::WithFileTypes(v.into_boxed_slice())
    }
    fn append_entry(
        entries: &mut Vec<Self>,
        utf8_name: &[u8],
        dirent_path: &BunString,
        kind: sys::FileKind,
        encoding: Encoding,
    ) {
        entries.push(Dirent {
            name: webcore::encoding::to_bun_string(utf8_name, encoding),
            path: dirent_path.dupe_ref(),
            kind,
        });
    }
    fn append_entry_w(
        entries: &mut Vec<Self>,
        utf16_name: &[u16],
        dirent_path: &BunString,
        kind: sys::FileKind,
        _encoding: Encoding,
        _re_encoding_buffer: Option<&mut PathBuffer>,
    ) {
        // node_fs.zig:4648-4654 — Windows Dirent always clones the raw UTF-16
        // name (no re-encoding) and skips the lstatat() DT_UNKNOWN fallback.
        entries.push(Dirent {
            name: BunString::clone_utf16(utf16_name),
            path: dirent_path.dupe_ref(),
            kind,
        });
    }
    fn append_entry_recursive(
        entries: &mut Vec<Self>,
        utf8_name: &[u8],
        _name_to_copy: &[u8],
        dirent_path: &BunString,
        kind: sys::FileKind,
        encoding: Encoding,
        apply_encoding: bool,
    ) {
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
    const IS_U16: bool = false;
    fn destroy_entry(&mut self) {
        self.destroy();
    }
    fn into_readdir(v: Vec<Self>) -> ret::Readdir {
        ret::Readdir::Buffers(v.into_boxed_slice())
    }
    fn append_entry(
        entries: &mut Vec<Self>,
        utf8_name: &[u8],
        _dirent_path: &BunString,
        _kind: sys::FileKind,
        _encoding: Encoding,
    ) {
        entries.push(Buffer::from_string(utf8_name).expect("oom"));
    }
    fn append_entry_w(
        _: &mut Vec<Self>,
        _: &[u16],
        _: &BunString,
        _: sys::FileKind,
        _: Encoding,
        _: Option<&mut PathBuffer>,
    ) {
        // node_fs.zig:4660 `else => @compileError("unreachable")` — Buffer never
        // takes the u16 iterator (`IS_U16 = false`); the call site is gated on
        // `T::IS_U16` so this arm is statically dead.
        unreachable!()
    }
    fn append_entry_recursive(
        entries: &mut Vec<Self>,
        _utf8_name: &[u8],
        name_to_copy: &[u8],
        _dirent_path: &BunString,
        _kind: sys::FileKind,
        _encoding: Encoding,
        _apply_encoding: bool,
    ) {
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
        "AccessDenied" => E::EPERM,
        "FileTooBig" => E::EFBIG,
        "SymLinkLoop" => E::ELOOP,
        "ProcessFdQuotaExceeded" => E::ENFILE,
        "NameTooLong" => E::ENAMETOOLONG,
        "SystemFdQuotaExceeded" => E::EMFILE,
        "SystemResources" => E::ENOMEM,
        "ReadOnlyFileSystem" => E::EROFS,
        "FileSystem" => E::EIO,
        "FileBusy" | "DeviceBusy" => E::EBUSY,
        "NotDir" => E::ENOTDIR,
        "InvalidUtf8" | "InvalidWtf8" | "BadPathName" => E::EINVAL,
        "FileNotFound" => E::ENOENT,
        "IsDir" => E::EISDIR,
        _ => E::EFAULT,
    }
}

// `rm` recursive (zigDeleteTree) — same shape as the rmdir table above except
// AccessDenied maps to EACCES, not EPERM (node_fs.zig:5789-5824).
fn map_anyerror_to_errno_rm_tree(err: bun_core::Error) -> E {
    match err.name() {
        "AccessDenied" => E::EACCES,
        "FileTooBig" => E::EFBIG,
        "SymLinkLoop" => E::ELOOP,
        "ProcessFdQuotaExceeded" => E::ENFILE,
        "NameTooLong" => E::ENAMETOOLONG,
        "SystemFdQuotaExceeded" => E::EMFILE,
        "SystemResources" => E::ENOMEM,
        "ReadOnlyFileSystem" => E::EROFS,
        "FileSystem" => E::EIO,
        "FileBusy" | "DeviceBusy" => E::EBUSY,
        "NotDir" => E::ENOTDIR,
        "InvalidUtf8" | "InvalidWtf8" | "BadPathName" => E::EINVAL,
        "FileNotFound" => E::ENOENT,
        "IsDir" => E::EISDIR,
        _ => E::EFAULT,
    }
}

// `rm` non-recursive unlinkZ/rmdirZ fallback — narrower table; anything not
// listed here falls through to EFAULT (node_fs.zig:5842-5859 / 5870-5887).
//
// The Rust port calls `bun_sys::unlink`/`libc::rmdir` which yield a raw errno
// rather than a Zig error name, so this composes `std.posix.unlinkZ`'s
// errno→error map with the Zig switch above. Notably the vendored stdlib maps
// `.PERM => error.PermissionDenied` (NOT `error.AccessDenied`), and
// `PermissionDenied` is absent from the narrow Zig switch, so raw EPERM —
// like EISDIR/ENOTDIR/ENOTEMPTY — falls through to EFAULT here to match the
// composed Zig behavior bit-for-bit.
fn map_rm_errno_narrow(e: E) -> E {
    match e {
        E::EACCES => E::EACCES,
        E::ELOOP | E::ENAMETOOLONG | E::ENOMEM | E::EROFS | E::EBUSY | E::ENOENT => e,
        _ => E::EFAULT,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__mkdirp(global_this: &JSGlobalObject, path: *const c_char) -> bool {
    // SAFETY: caller passes a NUL-terminated C string
    let path_bytes = unsafe { bun_core::ffi::cstr(path) }.to_bytes();
    // SAFETY: `bun_vm()` returns the live VM; `node_fs()` returns its cached
    // `*NodeFS` (type-erased to `*mut c_void` in `bun_jsc` to break the dep cycle).
    let node_fs: &mut NodeFS =
        unsafe { &mut *global_this.bun_vm().as_mut().node_fs().cast::<NodeFS>() };
    !matches!(
        node_fs.mkdir_recursive(&args::Mkdir {
            path: PathLike::String(PathString::init(path_bytes)),
            recursive: true,
            ..Default::default()
        }),
        Err(_)
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
        E::ENOENT => "FileNotFound",
        E::EACCES => "AccessDenied",
        E::EPERM => "PermissionDenied",
        E::ELOOP => "SymLinkLoop",
        E::ENAMETOOLONG => "NameTooLong",
        E::ENOMEM => "SystemResources",
        E::EROFS => "ReadOnlyFileSystem",
        E::EIO => "FileSystem",
        E::EBUSY => "FileBusy",
        E::ENOTDIR => "NotDir",
        E::EISDIR => "IsDir",
        E::ENOTEMPTY => "DirNotEmpty",
        E::EMFILE => "SystemFdQuotaExceeded",
        E::ENFILE => "ProcessFdQuotaExceeded",
        E::EINVAL => "BadPathName",
        E::EFBIG => "FileTooBig",
        E::ENODEV => "NoDevice",
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
    let z = ZStr::from_buf(&path_buf[..], len);
    match Syscall::openat(
        parent.fd,
        z,
        sys::O::DIRECTORY | sys::O::RDONLY | sys::O::NOFOLLOW,
        0,
    ) {
        Ok(fd) => Ok(sys::Dir::from_fd(fd)),
        Err(e) => Err(e.get_errno()),
    }
}

#[inline]
fn dt_delete_file(parent: sys::Dir, name: &[u8]) -> Result<(), E> {
    let mut path_buf = PathBuffer::uninit();
    let len = name.len().min(path_buf.len() - 1);
    path_buf[..len].copy_from_slice(&name[..len]);
    path_buf[len] = 0;
    // SAFETY: NUL written at [len].
    let z = ZStr::from_buf(&path_buf[..], len);
    match Syscall::unlinkat(parent.fd, z) {
        Ok(()) => Ok(()),
        Err(e) => {
            let errno = e.get_errno();
            // Mirror `std.fs.Dir.deleteFileZ`: non-Linux POSIX (macOS/BSD) returns
            // a *permission* error (EPERM, occasionally EACCES) from `unlinkat(2)`
            // without `AT_REMOVEDIR` when the target is a directory — Linux returns
            // EISDIR directly. Stat to disambiguate so the recursive-rm dir fallback
            // (`Err(EISDIR) => treat_as_dir`) fires; a genuine permission error
            // (immutable file, unwritable parent dir, …) still propagates.
            #[cfg(any(
                target_os = "macos",
                target_os = "ios",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd",
                target_os = "dragonfly",
            ))]
            if matches!(errno, E::EPERM | E::EACCES) {
                // No-follow stat — exactly `std.fs.Dir.deleteFileZ`'s
                // `fstatatZ(self.fd, sub_path_c, posix.AT.SYMLINK_NOFOLLOW)`
                // ("don't follow symlinks to match unlinkat"). `z` (a `&ZStr`,
                // `Copy`) is still valid — `unlinkat` only borrowed it.
                if let Ok(st) = Syscall::lstatat(parent.fd, z) {
                    if sys::S::ISDIR(st.st_mode as u32) {
                        return Err(E::EISDIR);
                    }
                }
            }
            Err(errno)
        }
    }
}

#[inline]
fn dt_delete_dir(parent: sys::Dir, name: &[u8]) -> Result<(), E> {
    let mut path_buf = PathBuffer::uninit();
    let len = name.len().min(path_buf.len() - 1);
    path_buf[..len].copy_from_slice(&name[..len]);
    path_buf[len] = 0;
    // SAFETY: NUL written at [len].
    let z = ZStr::from_buf(&path_buf[..], len);
    #[cfg(unix)]
    let flags: i32 = libc::AT_REMOVEDIR;
    #[cfg(not(unix))]
    let flags = 0x200; // AT_REMOVEDIR — Windows path goes through sys_uv which maps this.
    match Syscall::unlinkat_with_flags(parent.fd, z, flags) {
        Ok(()) => Ok(()),
        Err(e) => Err(e.get_errno()),
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

pub fn zig_delete_tree(
    self_: sys::Dir,
    sub_path: &[u8],
    kind_hint: sys::FileKind,
) -> Result<(), bun_core::Error> {
    let initial_iterable_dir =
        match zig_delete_tree_open_initial_subpath(self_, sub_path, kind_hint)? {
            Some(d) => d,
            None => return Ok(()),
        };

    // PERF(port): Zig used a fixed `[16]StackItem` array + `initBuffer`. Rust's
    // Vec gives the same cap behaviour (`unusedCapacitySlice().len >= 1`) when
    // pre-reserved to 16, with the bonus that the iterator buffers (8 KB each)
    // live on the heap instead of the stack.
    let mut stack: Vec<DeleteTreeStackItem> = Vec::with_capacity(16);
    let close_all = |stack: &mut Vec<DeleteTreeStackItem>| {
        for item in stack.drain(..) {
            item.iter.iter.dir.close();
        }
    };
    let mut _close_all = scopeguard::guard(&mut stack, |s| close_all(s));
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
                            Err(E::ENOTDIR) => {
                                treat_as_dir = false;
                                continue 'handle_entry;
                            }
                            Err(e) => return Err(dt_err(e)),
                        }
                    } else {
                        let top_dir = sys::Dir::from_fd(stack[top_idx].iter.iter.dir);
                        zig_delete_tree_min_stack_size_with_kind_hint(
                            top_dir,
                            &entry_name,
                            entry.kind,
                        )?;
                        break 'handle_entry;
                    }
                } else {
                    let top_dir = sys::Dir::from_fd(stack[top_idx].iter.iter.dir);
                    match dt_delete_file(top_dir, &entry_name) {
                        Ok(()) => break 'handle_entry,
                        Err(E::EISDIR) => {
                            treat_as_dir = true;
                            continue 'handle_entry;
                        }
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
        let name: &[u8] = if top.name_is_borrowed {
            sub_path
        } else {
            &top.name
        };

        let mut need_to_retry = false;
        match dt_delete_dir(parent_dir, name) {
            Ok(()) => {}
            Err(E::ENOENT) => {}
            Err(E::ENOTEMPTY) => need_to_retry = true,
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
                        Err(E::ENOTDIR) => {
                            treat_as_dir = false;
                            continue 'handle_entry;
                        }
                        Err(E::ENOENT) => {
                            // That's fine, we were trying to remove this directory anyway.
                            continue 'process_stack;
                        }
                        Err(e) => return Err(dt_err(e)),
                    }
                } else {
                    match dt_delete_file(parent_dir, name) {
                        Ok(()) => continue 'process_stack,
                        Err(E::ENOENT) => continue 'process_stack,
                        Err(E::EISDIR) => {
                            treat_as_dir = true;
                            continue 'handle_entry;
                        }
                        Err(E::ENOTDIR) => {
                            #[cfg(debug_assertions)]
                            unreachable!();
                            // Zig: `else => return error.Unexpected` → caller's `else =>` arm = EFAULT.
                            #[cfg(not(debug_assertions))]
                            return Err(err_from_static("Unexpected"));
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

fn zig_delete_tree_open_initial_subpath(
    self_: sys::Dir,
    sub_path: &[u8],
    kind_hint: sys::FileKind,
) -> Result<Option<sys::Dir>, bun_core::Error> {
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
                Err(E::EISDIR) => {
                    treat_as_dir = true;
                    continue;
                }
                Err(e) => return Err(dt_err(e)),
            }
        }
    }
}

fn zig_delete_tree_min_stack_size_with_kind_hint(
    self_: sys::Dir,
    sub_path: &[u8],
    kind_hint: sys::FileKind,
) -> Result<(), bun_core::Error> {
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
                                if let Some(d) = cleanup_dir_parent.take() {
                                    d.close();
                                }
                                cleanup_dir_parent = Some(dir);
                                dir = new_dir;
                                let n = entry_name.len().min(dir_name_buf.len());
                                dir_name_buf[..n].copy_from_slice(&entry_name[..n]);
                                dir_name_len = n;
                                dir_name_is_sub_path = false;
                                continue 'scan_dir;
                            }
                            Err(E::ENOTDIR) => {
                                treat_as_dir = false;
                                continue 'handle_entry;
                            }
                            Err(E::ENOENT) => {
                                // That's fine, we were trying to remove this directory anyway.
                                continue 'dir_it;
                            }
                            Err(e) => break 'scan_dir Err(dt_err(e)),
                        }
                    } else {
                        match dt_delete_file(dir, &entry_name) {
                            Ok(()) => continue 'dir_it,
                            Err(E::ENOENT) => continue 'dir_it,
                            Err(E::EISDIR) => {
                                treat_as_dir = true;
                                continue 'handle_entry;
                            }
                            Err(E::ENOTDIR) => {
                                #[cfg(debug_assertions)]
                                unreachable!();
                                // Zig: `else => return error.Unexpected` → caller's `else =>` arm = EFAULT.
                                #[cfg(not(debug_assertions))]
                                break 'scan_dir Err(err_from_static("Unexpected"));
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

            let dir_name: &[u8] = if dir_name_is_sub_path {
                sub_path
            } else {
                &dir_name_buf[..dir_name_len]
            };
            if let Some(d) = cleanup_dir_parent {
                match dt_delete_dir(d, dir_name) {
                    Ok(()) | Err(E::ENOENT) | Err(E::ENOTEMPTY) | Err(E::EEXIST) => {
                        // These two things can happen due to file system race conditions.
                        d.close();
                        continue 'start_over;
                    }
                    Err(e) => {
                        d.close();
                        return Err(dt_err(e));
                    }
                }
            } else {
                match dt_delete_dir(self_, sub_path) {
                    Ok(()) | Err(E::ENOENT) => return Ok(()),
                    Err(E::ENOTEMPTY) | Err(E::EEXIST) => continue 'start_over,
                    Err(e) => return Err(dt_err(e)),
                }
            }
        };
        // defers
        if let Some(d) = cleanup_dir_parent {
            d.close();
        }
        if cleanup_dir {
            dir.close();
        }
        return result;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NodeFSFunctionEnum — std.meta.DeclEnum(NodeFS)
// ──────────────────────────────────────────────────────────────────────────
#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum NodeFSFunctionEnum {
    Access,
    AppendFile,
    Chmod,
    Chown,
    Close,
    CopyFile,
    Exists,
    Fchmod,
    Fchown,
    Fdatasync,
    Fstat,
    Fsync,
    Ftruncate,
    Futimes,
    Lchmod,
    Lchown,
    Link,
    Lstat,
    Lutimes,
    Mkdir,
    Mkdtemp,
    Open,
    Read,
    Readdir,
    ReadFile,
    Readlink,
    Readv,
    Realpath,
    RealpathNonNative,
    Rename,
    Rm,
    Rmdir,
    Stat,
    Statfs,
    Symlink,
    Truncate,
    Unlink,
    Utimes,
    Write,
    WriteFile,
    Writev,
}

impl NodeFSFunctionEnum {
    /// Maps each async-FS function to its event-loop [`TaskTag`]. The Zig
    /// source did this via comptime `@typeName` lookup against the
    /// `Task.Tag.@"NameOfTask"` table; Rust spells it out (the `tags!` macro
    /// in `bun_event_loop::task_tag` declares one constant per variant).
    pub const fn task_tag(self) -> bun_event_loop::TaskTag {
        use bun_event_loop::task_tag;
        match self {
            Self::Access => task_tag::Access,
            Self::AppendFile => task_tag::AppendFile,
            Self::Chmod => task_tag::Chmod,
            Self::Chown => task_tag::Chown,
            Self::Close => task_tag::Close,
            Self::CopyFile => task_tag::CopyFile,
            Self::Exists => task_tag::Exists,
            Self::Fchmod => task_tag::Fchmod,
            Self::Fchown => task_tag::FChown,
            Self::Fdatasync => task_tag::Fdatasync,
            Self::Fstat => task_tag::Fstat,
            Self::Fsync => task_tag::Fsync,
            Self::Ftruncate => task_tag::FTruncate,
            Self::Futimes => task_tag::Futimes,
            Self::Lchmod => task_tag::Lchmod,
            Self::Lchown => task_tag::Lchown,
            Self::Link => task_tag::Link,
            Self::Lstat => task_tag::Lstat,
            Self::Lutimes => task_tag::Lutimes,
            Self::Mkdir => task_tag::Mkdir,
            Self::Mkdtemp => task_tag::Mkdtemp,
            Self::Open => task_tag::Open,
            Self::Read => task_tag::Read,
            Self::Readdir => task_tag::Readdir,
            Self::ReadFile => task_tag::ReadFile,
            Self::Readlink => task_tag::Readlink,
            Self::Readv => task_tag::Readv,
            Self::Realpath => task_tag::Realpath,
            Self::RealpathNonNative => task_tag::RealpathNonNative,
            Self::Rename => task_tag::Rename,
            Self::Rm => task_tag::Rm,
            Self::Rmdir => task_tag::Rmdir,
            Self::Stat => task_tag::Stat,
            Self::Statfs => task_tag::StatFS,
            Self::Symlink => task_tag::Symlink,
            Self::Truncate => task_tag::Truncate,
            Self::Unlink => task_tag::Unlink,
            Self::Utimes => task_tag::Utimes,
            Self::Write => task_tag::Write,
            Self::WriteFile => task_tag::WriteFile,
            Self::Writev => task_tag::Writev,
        }
    }

    /// `"Async" ++ typeBaseName(ArgumentType) ++ "Task"` — Zig built this via
    /// comptime string concat on `@typeName(ArgumentType)`. Rust has no
    /// `type_name::<T>()` in `const`, so key off the `F` discriminant instead
    /// (each `F` is bound to exactly one `args::*` type via `async_::*`).
    pub const fn heap_label(self) -> &'static str {
        macro_rules! lbl { ($($v:ident),+ $(,)?) => { match self { $(Self::$v => concat!("Async", stringify!($v), "Task"),)+ } } }
        lbl!(
            Access,
            AppendFile,
            Chmod,
            Chown,
            Close,
            CopyFile,
            Exists,
            Fchmod,
            Fchown,
            Fdatasync,
            Fstat,
            Fsync,
            Ftruncate,
            Futimes,
            Lchmod,
            Lchown,
            Link,
            Lstat,
            Lutimes,
            Mkdir,
            Mkdtemp,
            Open,
            Read,
            Readdir,
            ReadFile,
            Readlink,
            Readv,
            Realpath,
            RealpathNonNative,
            Rename,
            Rm,
            Rmdir,
            Stat,
            Statfs,
            Symlink,
            Truncate,
            Unlink,
            Utimes,
            Write,
            WriteFile,
            Writev
        )
    }
    pub const fn heap_label_uv(self) -> &'static str {
        match self {
            Self::Open => "AsyncOpenUvTask",
            Self::Close => "AsyncCloseUvTask",
            Self::Read => "AsyncReadUvTask",
            Self::Write => "AsyncWriteUvTask",
            Self::Readv => "AsyncReadvUvTask",
            Self::Writev => "AsyncWritevUvTask",
            Self::Statfs => "AsyncStatfsUvTask",
            _ => "AsyncUvTask",
        }
    }
}

/// `i52` — Zig's odd-width integer used for `ReadPosition` coercion bounds and
/// `JSValue.to(i52)` (JSValue.zig:199).
#[allow(non_camel_case_types)]
struct i52;
impl i52 {
    const MIN: i64 = -(1i64 << 51);
    #[allow(dead_code)]
    const MAX: i64 = (1i64 << 51) - 1;
    /// `JSValue.to(i52)` — `@truncate(@intCast(toInt64()))`. Truncate to the low
    /// 52 bits and sign-extend bit 51 (matches Zig `@truncate` semantics).
    #[inline]
    fn from_js(v: JSValue) -> i64 {
        (v.to_int64() << 12) >> 12
    }
}

// ported from: src/runtime/node/node_fs.zig
