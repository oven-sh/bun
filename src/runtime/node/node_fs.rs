// This file contains the underlying implementation for sync & async functions
// for interacting with the filesystem from JavaScript.
// The top-level functions assume the arguments are already validated

use bun_paths::strings;
use core::ffi::{c_int, c_uint};
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use crate::api::bun::process::event_loop_handle_to_ctx;
use crate::webcore;
use bun_core::Environment;
use bun_core::{String as BunString, Utf8WithString, ZStr};
use bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use bun_io::KeepAlive;
use bun_jsc::AbortSignal;
use bun_jsc::debugger::AsyncTaskTracker;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    ArrayBuffer, EventLoopHandle, JSGlobalObject, JSValue, JsResult, PinnedArrayBuffer,
    StringJsc as _, Utf8WithStringJsc as _,
};
use bun_paths::{self as paths, OSPathBuffer, OSPathChar, OSPathSliceZ, PathBuffer};
use bun_sys::FdExt as _;
use bun_sys::{self as sys, E, Fd as FD, Maybe, Mode, SystemErrno};
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

// ──────────────────────────────────────────────────────────────────────────
// `Maybe(T)` shim — `crate::node::Maybe` is the same `Result<T, Error>` alias
// as `bun_sys::Maybe<T>`, so this is just the file-local extension trait
// surface that lets `Maybe::<T>::errno_sys*` / `.get_errno()` resolve.
// ──────────────────────────────────────────────────────────────────────────
pub trait MaybeSysResultExt<R>: Sized {
    fn get_errno(&self) -> E;
    #[cfg(not(windows))]
    fn errno_sys<Rc: sys::GetErrno>(rc: Rc, syscall: sys::Tag) -> Option<Self>;
    #[cfg(not(windows))]
    fn errno_sys_fd<Rc: sys::GetErrno>(rc: Rc, syscall: sys::Tag, fd: FD) -> Option<Self>;
    #[cfg(not(windows))]
    fn errno_sys_p<Rc: sys::GetErrno>(
        rc: Rc,
        syscall: sys::Tag,
        path: impl AsRef<[u8]>,
    ) -> Option<Self>;
    #[cfg(not(windows))]
    fn errno_sys_pd<Rc: sys::GetErrno>(
        rc: Rc,
        syscall: sys::Tag,
        path: impl AsRef<[u8]>,
        dest: impl AsRef<[u8]>,
    ) -> Option<Self>;
}
impl<R> MaybeSysResultExt<R> for Maybe<R> {
    #[inline]
    fn get_errno(&self) -> E {
        match self {
            Ok(_) => E::SUCCESS,
            Err(e) => e.get_errno(),
        }
    }
    #[cfg(not(windows))]
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
    #[cfg(not(windows))]
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
    #[cfg(not(windows))]
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
    #[cfg(not(windows))]
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
use bun_event_loop::ConcurrentTask;

/// `webcore.Blob.SizeType` — logically a 52-bit unsigned integer.
/// Rust has no native `u52`, so the *storage* width is `u64`, but **never** use
/// `BlobSizeType::MAX` to mean the spec maximum — that yields `u64::MAX`, which
/// wraps to `-1` under `as i64` and silently breaks bounds checks. Use
/// [`BLOB_SIZE_MAX`] instead.
type BlobSizeType = u64;
/// `maxInt(u52)` == 2^52 - 1.
const BLOB_SIZE_MAX: u64 = (1u64 << 52) - 1;

/// `webcore.RefPtr<AbortSignal>` — JSC's intrusive ref-counted pointer.
/// Backed by `bun_ptr::ExternalShared<AbortSignal>` (alias re-exported
/// from `bun_jsc`): `Clone` → `ref()`, `Drop` → `unref()`, `Deref` → `&AbortSignal`.
use bun_jsc::AbortSignalRef;

// Wired to the real sibling modules under `super::` (rather than a
// `bun_jsc::node` re-export shim) so this file compiles standalone.
use super::stat::Stats;
use super::time_like::TimeLike;
use super::types::{
    ArgumentsSlice, Dirent, Encoding, FdArgExt as _, FileSystemFlags, FileSystemFlagsKind,
    NameTooLong, PathLike, PathLikeExt as _, PathOrFdExt as _, StringObjects, StringOrBuffer,
    ThreadIsolated, ThreadIsolatedArg, VectorArrayBuffer,
};
// Re-exported publicly: `crate::node::fs::PathOrFileDescriptor` is the
// canonical path used by `cli/build_command.rs` et al., and `node_fs::Flavor`
// by every caller that runs an operation directly (`read_file(.., Flavor::Sync)`).
pub use super::types::{Flavor, PathOrFileDescriptor};

/// Local alias for the many `node::foo` call sites below, routing to `super::*`.
mod node {
    pub(super) use super::super::statfs::StatFS;
    pub(super) use super::super::time_like::from_js as time_like_from_js;
    pub(super) use super::super::{gid_t, uid_t};

    /// Thin alias to `super::types::mode_from_js` so the dozens of call
    /// sites in `args::*::from_js` keep spelling `node::mode_from_js`.
    #[inline]
    pub(super) fn mode_from_js(
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

// Trait imports for inherent-looking method calls on upstream types:
//   - `bun_sys::FdExt`       → `Fd::close()`
//   - `bun_sys_jsc::ErrorJsc`→ `bun_sys::Error::to_js_with_async_stack()`
use bun_sys_jsc::ErrorJsc as _;

pub use super::node_fs_constant as constants;
// The `Watcher` / `StatWatcher` sibling modules are declared in
// `node.rs`; re-export them under the names the `args::Watch` / `watch()`
// bodies below expect.
pub use super::node_fs_stat_watcher as StatWatcher;
pub use super::node_fs_watcher as Watcher;

/// `Binding` is the JSC-class instance that owns the per-thread `NodeFS`
/// (`super::node_fs_binding::Binding`). Re-exported so the async `create()`
/// entry points keep their `&mut Binding` signature.
pub use super::node_fs_binding::Binding;

/// `jsc.JSPromise.Strong` — re-exported under its Rust crate name:
/// `bun_jsc::js_promise::Strong` / the `JSPromiseStrong` alias.
use bun_jsc::JSPromiseStrong;

use super::dir_iterator as DirIterator;
#[cfg(not(windows))]
use bun_resolver::fs::FileSystem;

// On POSIX the libuv-backed code paths (`UVFSRequest`, `uv_fs_*`) are absent:
// `UVFSRequest` aliases `AsyncFSTask` and every `uv::*` reference is gated
// behind `#[cfg(windows)]`. There is intentionally **no** POSIX stub module
// here so misuse is a compile error, not a silent null.
#[cfg(windows)]
use bun_sys::{
    ReturnCodeExt as _,
    windows::{self, libuv as uv},
};

// Syscall = `bun_sys::sys_uv` on Windows, `bun_sys` otherwise
#[cfg(not(windows))]
use bun_sys as Syscall;
#[cfg(windows)]
use bun_sys::sys_uv as Syscall;

// Kernel limit on iovec count for a single readv(2)/writev(2). libuv's
// `uv__getiovmax()` prefers compile-time `IOV_MAX`; Linux headers spell it
// `UIO_MAXIOV`. Windows has no kernel iovec limit (sys_uv chunks internally).
#[cfg(any(target_os = "linux", target_os = "android"))]
const IOV_MAX: usize = libc::UIO_MAXIOV as usize;
#[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
const IOV_MAX: usize = libc::IOV_MAX as usize;
#[cfg(windows)]
const IOV_MAX: usize = core::ffi::c_uint::MAX as usize;

// ──────────────────────────────────────────────────────────────────────────
// Local cross-crate shims
//
// These wrap symbols whose canonical home moved under the Rust crate split so
// the hundreds of call sites below don't
// have to be rewritten per-line. Each is a thin forwarder.
// ──────────────────────────────────────────────────────────────────────────

/// Strip the NT object-path prefix — forwards to `bun_core::paths`.
#[inline]
fn without_nt_prefix<T: bun_paths::string_paths::Ch>(path: &[T]) -> &[T] {
    bun_paths::string_paths::without_nt_prefix(path)
}

/// Empty `OSPathChar` literal.
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

#[inline]
fn standalone_module_graph() -> Option<&'static bun_standalone_graph::Graph> {
    bun_standalone_graph::Graph::get_ref()
}

/// Local shim for `Maybe(void)::aborted` (node.rs:302). `bun_sys::Maybe` is
/// `core::result::Result`, which has no `aborted()` constructor; inline the
/// sentinel error directly.
#[inline]
fn abort_err() -> sys::Error {
    sys::Error {
        errno: E::EINTR as _,
        syscall: sys::Tag::access,
        ..Default::default()
    }
}

/// `with_path()` for a `PathOrFileDescriptor`.
/// On `Fd`, records the fd; otherwise attach the path
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

/// uv-shaped stat struct. `Stats::init` (from
/// `super::stat`) takes its sibling `PosixStat` by reference, so route through
/// that definition rather than `bun_sys::PosixStat` to keep the parameter
/// type exact. Both are `#[repr(C)]` mirrors of `uv_stat_t`; once
/// `super::stat` swaps to `pub use bun_sys::PosixStat` this alias collapses.
use super::stat::PosixStat;

/// Node `fs.rm` mapping helper — maps an error-set *name* string back to a
/// `crate::Error` variant so the callers' `map_anyerror_to_errno*` tables (which
/// match on `err.name()`) keep round-tripping.
#[inline]
fn err_from_static(name: &'static str) -> crate::Error {
    match name {
        "FileNotFound" => crate::Error::FileNotFound,
        "AccessDenied" => crate::Error::AccessDenied,
        "PermissionDenied" => crate::Error::PermissionDenied,
        "SymLinkLoop" => crate::Error::SymLinkLoop,
        "NameTooLong" => crate::Error::NameTooLong,
        "SystemResources" => crate::Error::SystemResources,
        "ReadOnlyFileSystem" => crate::Error::ReadOnlyFileSystem,
        "FileSystem" => crate::Error::FileSystem,
        "FileBusy" => crate::Error::FileBusy,
        "NotDir" => crate::Error::NotDir,
        "IsDir" => crate::Error::IsDir,
        "DirNotEmpty" => crate::Error::DirNotEmpty,
        "SystemFdQuotaExceeded" => crate::Error::SystemFdQuotaExceeded,
        "ProcessFdQuotaExceeded" => crate::Error::ProcessFdQuotaExceeded,
        "BadPathName" => crate::Error::BadPathName,
        "FileTooBig" => crate::Error::FileTooBig,
        "NoDevice" => crate::Error::NoDevice,
        _ => crate::Error::Unexpected,
    }
}

/// `preallocate_supported` / `preallocate_length` — these consts have
/// no equivalent in `bun_sys` (only `preallocate_file()` exists there), so
/// define them locally so the write-file fast path keeps its 2 MiB guard.
const PREALLOCATE_SUPPORTED: bool = cfg!(any(target_os = "linux", target_os = "android"));
const PREALLOCATE_LENGTH: usize = 2048 * 1024;

/// `CLONE_NOFOLLOW` from `<sys/clonefile.h>` — not re-exported by `bun_sys::c`
/// (or the `libc` crate), so define it locally. `clonefile(2)` then clones a
/// symbolic-link `src` itself rather than the file it points to.
#[cfg(target_os = "macos")]
const CLONE_NOFOLLOW: u32 = 0x0001;

/// Path-length field width.
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

/// Check whether a directory exists at `(fd, path)` — dispatches on path element width. On
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
type GidT = node::gid_t;
type UidT = node::uid_t;

#[cfg(unix)]
pub(crate) const DEFAULT_PERMISSION: Mode = sys::S::IRUSR as Mode
    | sys::S::IWUSR as Mode
    | sys::S::IRGRP as Mode
    | sys::S::IWGRP as Mode
    | sys::S::IROTH as Mode
    | sys::S::IWOTH as Mode;
#[cfg(not(unix))]
// Windows does not have permissions
pub(crate) const DEFAULT_PERMISSION: Mode = 0;

// `AbortSignalRef` (= `ExternalShared<AbortSignal>`) implements `Deref`, so
// `signal.pending_activity_ref()` / `signal.aborted()` resolve directly to the
// `&AbortSignal` inherent methods. `unref()` is handled by `Drop`.

// ──────────────────────────────────────────────────────────────────────────
// Async task type aliases
// ──────────────────────────────────────────────────────────────────────────
// AsyncFSTask / UVFSRequest / NewAsyncCpTask / AsyncReaddirRecursiveTask are
// the thread-pool wrappers that back every `fs.promises.*` call (and the shell
// `cp` builtin).
mod _async_tasks {
    use super::*;

    pub mod async_ {
        use super::*;

        pub(crate) type Access =
            AsyncFSTask<ret::Access, args::Access<'static>, { NodeFSFunctionEnum::Access }>;
        pub(crate) type AppendFile = AsyncFSTask<
            ret::AppendFile,
            args::AppendFile<'static>,
            { NodeFSFunctionEnum::AppendFile },
        >;
        pub(crate) type Chmod =
            AsyncFSTask<ret::Chmod, args::Chmod<'static>, { NodeFSFunctionEnum::Chmod }>;
        pub(crate) type Chown =
            AsyncFSTask<ret::Chown, args::Chown<'static>, { NodeFSFunctionEnum::Chown }>;
        pub(crate) type Close = UVFSRequest<ret::Close, args::Close, { NodeFSFunctionEnum::Close }>;
        pub(crate) type CopyFile =
            AsyncFSTask<ret::CopyFile, args::CopyFile<'static>, { NodeFSFunctionEnum::CopyFile }>;
        pub(crate) type Exists =
            AsyncFSTask<ret::Exists, args::Exists<'static>, { NodeFSFunctionEnum::Exists }>;
        pub(crate) type Fchmod =
            AsyncFSTask<ret::Fchmod, args::FChmod, { NodeFSFunctionEnum::Fchmod }>;
        pub(crate) type Fchown =
            AsyncFSTask<ret::Fchown, args::Fchown, { NodeFSFunctionEnum::Fchown }>;
        pub(crate) type Fdatasync =
            AsyncFSTask<ret::Fdatasync, args::FdataSync, { NodeFSFunctionEnum::Fdatasync }>;
        pub(crate) type Fstat = AsyncFSTask<ret::Fstat, args::Fstat, { NodeFSFunctionEnum::Fstat }>;
        pub(crate) type Fsync = AsyncFSTask<ret::Fsync, args::Fsync, { NodeFSFunctionEnum::Fsync }>;
        pub(crate) type Ftruncate =
            AsyncFSTask<ret::Ftruncate, args::FTruncate, { NodeFSFunctionEnum::Ftruncate }>;
        pub(crate) type Futimes =
            AsyncFSTask<ret::Futimes, args::Futimes, { NodeFSFunctionEnum::Futimes }>;
        pub(crate) type Lchmod =
            AsyncFSTask<ret::Lchmod, args::LCHmod<'static>, { NodeFSFunctionEnum::Lchmod }>;
        pub(crate) type Lchown =
            AsyncFSTask<ret::Lchown, args::LChown<'static>, { NodeFSFunctionEnum::Lchown }>;
        pub(crate) type Link =
            AsyncFSTask<ret::Link, args::Link<'static>, { NodeFSFunctionEnum::Link }>;
        pub(crate) type Lstat =
            AsyncFSTask<ret::Stat, args::Stat<'static>, { NodeFSFunctionEnum::Lstat }>;
        pub(crate) type Lutimes =
            AsyncFSTask<ret::Lutimes, args::Lutimes<'static>, { NodeFSFunctionEnum::Lutimes }>;
        pub(crate) type Mkdir =
            AsyncFSTask<ret::Mkdir, args::Mkdir<'static>, { NodeFSFunctionEnum::Mkdir }>;
        pub(crate) type Mkdtemp =
            AsyncFSTask<ret::Mkdtemp, args::MkdirTemp<'static>, { NodeFSFunctionEnum::Mkdtemp }>;
        pub(crate) type Open =
            UVFSRequest<ret::Open, args::Open<'static>, { NodeFSFunctionEnum::Open }>;
        pub(crate) type Read = UVFSRequest<ret::Read, args::Read, { NodeFSFunctionEnum::Read }>;
        pub(crate) type Readdir =
            AsyncFSTask<ret::Readdir, args::Readdir<'static>, { NodeFSFunctionEnum::Readdir }>;
        pub(crate) type ReadFile = AsyncFSTask<
            ret::ReadFileOffThread,
            args::ReadFile<'static>,
            { NodeFSFunctionEnum::ReadFile },
        >;
        pub(crate) type Readlink =
            AsyncFSTask<ret::Readlink, args::Readlink<'static>, { NodeFSFunctionEnum::Readlink }>;
        pub(crate) type Readv = UVFSRequest<ret::Readv, args::Readv, { NodeFSFunctionEnum::Readv }>;
        pub(crate) type Realpath =
            AsyncFSTask<ret::Realpath, args::Realpath<'static>, { NodeFSFunctionEnum::Realpath }>;
        pub(crate) type RealpathNonNative = AsyncFSTask<
            ret::Realpath,
            args::Realpath<'static>,
            { NodeFSFunctionEnum::RealpathNonNative },
        >;
        pub(crate) type Rename =
            AsyncFSTask<ret::Rename, args::Rename<'static>, { NodeFSFunctionEnum::Rename }>;
        pub(crate) type Rm = AsyncFSTask<ret::Rm, args::Rm<'static>, { NodeFSFunctionEnum::Rm }>;
        pub(crate) type Rmdir =
            AsyncFSTask<ret::Rmdir, args::RmDir<'static>, { NodeFSFunctionEnum::Rmdir }>;
        pub(crate) type Stat =
            AsyncFSTask<ret::Stat, args::Stat<'static>, { NodeFSFunctionEnum::Stat }>;
        pub(crate) type Symlink =
            AsyncFSTask<ret::Symlink, args::Symlink<'static>, { NodeFSFunctionEnum::Symlink }>;
        pub(crate) type Truncate =
            AsyncFSTask<ret::Truncate, args::Truncate<'static>, { NodeFSFunctionEnum::Truncate }>;
        pub(crate) type Unlink =
            AsyncFSTask<ret::Unlink, args::Unlink<'static>, { NodeFSFunctionEnum::Unlink }>;
        pub(crate) type Utimes =
            AsyncFSTask<ret::Utimes, args::Utimes<'static>, { NodeFSFunctionEnum::Utimes }>;
        pub(crate) type Write =
            UVFSRequest<ret::Write, args::Write<'static>, { NodeFSFunctionEnum::Write }>;
        pub(crate) type WriteFile = AsyncFSTask<
            ret::WriteFile,
            args::WriteFile<'static>,
            { NodeFSFunctionEnum::WriteFile },
        >;
        pub(crate) type Writev =
            UVFSRequest<ret::Writev, args::Writev, { NodeFSFunctionEnum::Writev }>;
        pub(crate) type Statfs =
            UVFSRequest<ret::StatFS, args::StatFS<'static>, { NodeFSFunctionEnum::Statfs }>;

        const _: () = assert!(ReadFile::HAVE_ABORT_SIGNAL);
        const _: () = assert!(WriteFile::HAVE_ABORT_SIGNAL);

        #[cfg(windows)]
        /// Used internally. Not from JavaScript.
        pub struct AsyncMkdirp {
            pub(crate) completion_ctx: *mut (),
            /// Pool thread; `ticket` is this task's, for the callee to post its
            /// hop back through.
            pub(crate) completion: fn(*mut (), Maybe<()>, &bun_jsc::Ticket),
            pub path: Box<[u8]>,
            pub(crate) ticket: bun_jsc::Ticket,
            pub task: WorkPoolTask,
        }

        #[cfg(windows)]
        bun_threading::owned_task!(AsyncMkdirp, task);

        #[cfg(windows)]
        impl AsyncMkdirp {
            /// Heap-allocate and hand the task to the work pool, which owns the
            /// allocation and frees it after `run_owned` returns.
            pub(crate) fn schedule(init: AsyncMkdirp) {
                WorkPool::schedule_new(init);
            }

            #[allow(clippy::boxed_local)]
            fn run_owned(self: Box<Self>) {
                let mut node_fs = NodeFS::default();
                let result = node_fs.mkdir_recursive(&args::Mkdir {
                    path: PathLike::borrowed(&self.path),
                    recursive: true,
                    ..Default::default()
                });
                match result {
                    Err(err) => {
                        (self.completion)(
                            self.completion_ctx,
                            // `with_path` already clones into a fresh `Box<[u8]>`; pass the
                            // existing path slice.
                            Err(err.with_path(&err.path)),
                            &self.ticket,
                        );
                    }
                    Ok(_) => {
                        (self.completion)(self.completion_ctx, Ok(()), &self.ticket);
                    }
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

    /// One libuv fs request (Windows): boxed, lent to libuv by
    /// [`bun_io::uv_fs`] while in flight, handed back on the loop thread, then
    /// queued as a [`bun_jsc::Task`] whose dispatch arm runs
    /// [`run_from_js_thread`](Self::run_from_js_thread). Dropping it releases
    /// the keep-alive, the argument protection and the libuv request.
    #[cfg(windows)]
    pub struct UVFSRequest<R, A, const F: NodeFSFunctionEnum> {
        pub(crate) promise: JSPromiseStrong,
        pub args: ThreadIsolated<A>,
        pub(crate) global_object: bun_ptr::BackRef<JSGlobalObject>,
        pub(crate) req: uv::OwnedFsReq,
        pub(crate) result: Maybe<R>,
        pub(crate) r#ref: KeepAlive,
        pub(crate) tracker: AsyncTaskTracker,
    }

    #[cfg(windows)]
    impl<R, A, const F: NodeFSFunctionEnum> Drop for UVFSRequest<R, A, F> {
        fn drop(&mut self) {
            self.r#ref.unref(bun_io::js_vm_ctx());
        }
    }

    // Queued as a box under its per-op tag; an unrun request is released by
    // dropping it (promise handle, argument protection, keep-alive).
    #[cfg(windows)]
    bun_event_loop::boxed_taskable!(
        [R: FsReturn + 'static, A: FsArgument + 'static, const F: NodeFSFunctionEnum]
        UVFSRequest<R, A, F>
        where [Op<{ F }>: NodeFSDispatch<R, A> + UvFsSubmit<R, A, F>]
        => F.task_tag()
    );

    /// How each libuv-backed op submits its boxed request (Windows). One impl
    /// per `async_::*` alias that is a [`UVFSRequest`].
    #[cfg(windows)]
    pub trait UvFsSubmit<R, A, const F: NodeFSFunctionEnum> {
        fn submit(task: Box<UVFSRequest<R, A, F>>, binding: &Binding);
    }

    #[cfg(windows)]
    impl<R: FsReturn + 'static, A: FsArgument + 'static, const F: NodeFSFunctionEnum>
        bun_io::uv_fs::UvFsRequest for UVFSRequest<R, A, F>
    where
        Op<{ F }>: NodeFSDispatch<R, A> + UvFsSubmit<R, A, F>,
    {
        #[inline]
        fn req(&mut self) -> &mut uv::OwnedFsReq {
            &mut self.req
        }
        /// Loop (= JS) thread: libuv is done with the request.
        fn on_complete(mut this: Box<Self>) {
            let mut node_fs = NodeFS::default();
            let rc = this.req.result;
            this.result = if F == NodeFSFunctionEnum::Statfs {
                NodeFS::uv_dispatch_req::<R, A, F>(&mut node_fs, &this.args, &this.req, rc)
            } else {
                NodeFS::uv_dispatch::<R, A, F>(&mut node_fs, &this.args, rc)
            };
            let global_object = this.global_object;
            global_object
                .bun_vm()
                .event_loop_mut()
                .enqueue_task(bun_jsc::Task::from_boxed(this));
        }
    }

    /// The descriptor/buffers/position of a `read`/`write`/`readv`/`writev`
    /// request. The JS buffers behind them are pinned and rooted
    /// (`ThreadIsolated<A>`) for the request's life.
    #[cfg(windows)]
    pub trait UvIoArgs {
        fn io_fd(&self) -> uv::uv_file;
        fn io_bufs(&self) -> bun_io::uv_fs::IoBufs<'_>;
        fn io_position(&self) -> i64;
    }
    #[cfg(windows)]
    impl UvIoArgs for args::Read {
        fn io_fd(&self) -> uv::uv_file {
            self.fd.uv()
        }
        /// One buffer, windowed by `offset`/`length`.
        fn io_bufs(&self) -> bun_io::uv_fs::IoBufs<'_> {
            let buf = self.buffer.slice();
            let off = buf.len().min(self.offset as usize);
            let buf = &buf[off..];
            let buf = &buf[..buf.len().min(self.length as usize)];
            bun_io::uv_fs::IoBufs::One(uv::uv_buf_t::init(buf))
        }
        fn io_position(&self) -> i64 {
            self.position.map(|p| p as i64).unwrap_or(-1)
        }
    }
    #[cfg(windows)]
    impl UvIoArgs for args::Write<'_> {
        fn io_fd(&self) -> uv::uv_file {
            self.fd.uv()
        }
        /// One buffer, windowed by `offset`/`length`.
        fn io_bufs(&self) -> bun_io::uv_fs::IoBufs<'_> {
            let buf = self.buffer.slice();
            let off = buf.len().min(self.offset as usize);
            let buf = &buf[off..];
            let buf = &buf[..buf.len().min(self.length as usize)];
            bun_io::uv_fs::IoBufs::One(uv::uv_buf_t::init(buf))
        }
        fn io_position(&self) -> i64 {
            self.position.map(|p| p as i64).unwrap_or(-1)
        }
    }
    #[cfg(windows)]
    impl UvIoArgs for args::FdVectorIo {
        fn io_fd(&self) -> uv::uv_file {
            self.fd.uv()
        }
        fn io_bufs(&self) -> bun_io::uv_fs::IoBufs<'_> {
            bun_io::uv_fs::IoBufs::Many(&self.buffers.buffers)
        }
        fn io_position(&self) -> i64 {
            self.position.map(|p| p as i64).unwrap_or(-1)
        }
    }
    #[cfg(windows)]
    impl<R: FsReturn + 'static, A: FsArgument + UvIoArgs + 'static, const F: NodeFSFunctionEnum>
        bun_io::uv_fs::UvFsIo for UVFSRequest<R, A, F>
    where
        Op<{ F }>: NodeFSDispatch<R, A> + UvFsSubmit<R, A, F>,
    {
        #[inline]
        fn io_parts(
            &mut self,
        ) -> (
            &mut uv::OwnedFsReq,
            uv::uv_file,
            bun_io::uv_fs::IoBufs<'_>,
            i64,
        ) {
            (
                &mut self.req,
                self.args.io_fd(),
                self.args.io_bufs(),
                self.args.io_position(),
            )
        }
    }

    /// libuv reports bad arguments synchronously (and never calls back then);
    /// the ops below pass arguments it cannot reject, so that is a bug here —
    /// in release, settle the request with the error it reported.
    #[cfg(windows)]
    fn debug_assert_submitted<T: bun_io::uv_fs::UvFsRequest>(
        r: Result<(), (Box<T>, uv::ReturnCode)>,
    ) {
        if let Err((task, rc)) = r {
            debug_assert!(false, "uv_fs submit failed synchronously: {}", rc.int());
            T::on_complete(task);
        }
    }

    /// Copy `path` into the binding's scratch buffer (with the Windows
    /// long-path/cwd normalisation `slice_z` applies) and return its length;
    /// the buffer then holds it NUL-terminated. Held only across the submit
    /// (libuv copies the path) and never across a JS re-entry point.
    #[cfg(windows)]
    fn scratch_path_z(path: &PathLike, buf: &mut PathBuffer) -> usize {
        path.slice_z_with_force_copy::<true>(buf).len()
    }

    #[cfg(windows)]
    impl UvFsSubmit<ret::Open, args::Open<'static>, { NodeFSFunctionEnum::Open }>
        for Op<{ NodeFSFunctionEnum::Open }>
    {
        fn submit(task: Box<async_::Open>, binding: &Binding) {
            let mut flags: c_int = task.args.flags.as_int();
            flags = uv::O::from_bun_o(flags);
            let mut mode: c_int = task.args.mode as c_int;
            if mode == 0 {
                mode = 0o644;
            }
            binding.node_fs.with_mut(|node_fs| {
                let path = if strings::eql_comptime(task.args.path.slice(), b"/dev/null") {
                    ZStr::from_static(b"\\\\.\\NUL\0")
                } else {
                    let len = scratch_path_z(&task.args.path, &mut node_fs.sync_error_buf);
                    ZStr::from_buf(&node_fs.sync_error_buf[..], len)
                };
                sys::syslog!(
                    "uv open({}, {}, {}) = scheduled",
                    ::bstr::BStr::new(path.as_bytes()),
                    flags,
                    mode
                );
                debug_assert_submitted(bun_io::uv_fs::open(task, path, flags, mode));
            });
        }
    }

    #[cfg(windows)]
    impl UvFsSubmit<ret::Close, args::Close, { NodeFSFunctionEnum::Close }>
        for Op<{ NodeFSFunctionEnum::Close }>
    {
        fn submit(task: Box<async_::Close>, _binding: &Binding) {
            let fd = task.args.fd.uv();
            debug_assert_submitted(bun_io::uv_fs::close(task, fd));
            sys::syslog!("uv close({}) = scheduled", fd);
        }
    }

    #[cfg(windows)]
    impl UvFsSubmit<ret::Read, args::Read, { NodeFSFunctionEnum::Read }>
        for Op<{ NodeFSFunctionEnum::Read }>
    {
        fn submit(task: Box<async_::Read>, _binding: &Binding) {
            let fd = task.args.fd.uv();
            debug_assert_submitted(bun_io::uv_fs::read(task));
            sys::syslog!("uv read({}) = scheduled", fd);
        }
    }

    #[cfg(windows)]
    impl UvFsSubmit<ret::Write, args::Write<'static>, { NodeFSFunctionEnum::Write }>
        for Op<{ NodeFSFunctionEnum::Write }>
    {
        fn submit(task: Box<async_::Write>, _binding: &Binding) {
            let fd = task.args.fd.uv();
            debug_assert_submitted(bun_io::uv_fs::write(task));
            sys::syslog!("uv write({}) = scheduled", fd);
        }
    }

    #[cfg(windows)]
    impl UvFsSubmit<ret::Readv, args::Readv, { NodeFSFunctionEnum::Readv }>
        for Op<{ NodeFSFunctionEnum::Readv }>
    {
        fn submit(mut task: Box<async_::Readv>, _binding: &Binding) {
            let fd = task.args.fd.uv();
            let nbufs = task.args.buffers.buffers.len();
            if nbufs == 0 {
                task.result = Ok(ret::Read { bytes_read: 0 });
                let global_object = task.global_object;
                global_object
                    .bun_vm()
                    .event_loop_mut()
                    .enqueue_task(bun_jsc::Task::from_boxed(task));
                return;
            }
            let pos = task.args.position.map(|p| p as i64).unwrap_or(-1);
            let sum: u64 = (task.args.buffers.buffers.iter())
                .map(|b| b.slice().len() as u64)
                .sum();
            debug_assert_submitted(bun_io::uv_fs::read(task));
            sys::syslog!(
                "uv readv({}, {}, {}, {} total bytes) = scheduled",
                fd,
                nbufs,
                pos,
                sum
            );
        }
    }

    #[cfg(windows)]
    impl UvFsSubmit<ret::Writev, args::Writev, { NodeFSFunctionEnum::Writev }>
        for Op<{ NodeFSFunctionEnum::Writev }>
    {
        fn submit(mut task: Box<async_::Writev>, _binding: &Binding) {
            let fd = task.args.fd.uv();
            let nbufs = task.args.buffers.buffers.len();
            if nbufs == 0 {
                task.result = Ok(ret::Write { bytes_written: 0 });
                let global_object = task.global_object;
                global_object
                    .bun_vm()
                    .event_loop_mut()
                    .enqueue_task(bun_jsc::Task::from_boxed(task));
                return;
            }
            let pos = task.args.position.map(|p| p as i64).unwrap_or(-1);
            let sum: u64 = (task.args.buffers.buffers.iter())
                .map(|b| b.slice().len() as u64)
                .sum();
            debug_assert_submitted(bun_io::uv_fs::write(task));
            sys::syslog!(
                "uv writev({}, {}, {}, {} total bytes) = scheduled",
                fd,
                nbufs,
                pos,
                sum
            );
        }
    }

    #[cfg(windows)]
    impl UvFsSubmit<ret::StatFS, args::StatFS<'static>, { NodeFSFunctionEnum::Statfs }>
        for Op<{ NodeFSFunctionEnum::Statfs }>
    {
        fn submit(task: Box<async_::Statfs>, binding: &Binding) {
            binding.node_fs.with_mut(|node_fs| {
                let len = scratch_path_z(&task.args.path, &mut node_fs.sync_error_buf);
                let path = ZStr::from_buf(&node_fs.sync_error_buf[..], len);
                sys::syslog!("uv statfs({}) = ~~", ::bstr::BStr::new(path.as_bytes()));
                debug_assert_submitted(bun_io::uv_fs::statfs(task, path));
            });
        }
    }

    #[cfg(windows)]
    impl<R: FsReturn + 'static, A: FsArgument + 'static, const F: NodeFSFunctionEnum>
        UVFSRequest<R, A, F>
    where
        Op<{ F }>: NodeFSDispatch<R, A> + UvFsSubmit<R, A, F>,
    {
        pub(crate) fn create(
            global_object: &JSGlobalObject,
            binding: &Binding,
            task_args: ThreadIsolated<A>,
            vm: &mut VirtualMachine,
        ) -> JSValue {
            let mut task = Box::new(Self {
                promise: JSPromiseStrong::init(global_object),
                args: task_args,
                // Sentinel — overwritten by `on_complete` (or the empty-writev
                // arm) before any read on the JS thread. `Maybe<R>` is
                // `Result<R, sys::Error>` and may be niche-optimised for arbitrary
                // `R`; never construct an all-zero `Result` value.
                result: Err(sys::Error::default()),
                global_object: bun_ptr::BackRef::new(global_object),
                req: uv::OwnedFsReq::new(),
                r#ref: KeepAlive::default(),
                tracker: AsyncTaskTracker::init(vm),
            });
            task.r#ref.ref_(bun_io::js_vm_ctx());
            task.tracker.did_schedule(global_object);
            let promise = task.promise.value();
            <Op<{ F }> as UvFsSubmit<R, A, F>>::submit(task, binding);
            promise
        }

        /// JS thread, from the task queue: settle the promise. `self` drops on
        /// return.
        pub(crate) fn run_from_js_thread(mut self: Box<Self>) -> JsResult<()> {
            let result = core::mem::replace(&mut self.result, Err(sys::Error::default()));
            let global_object: &JSGlobalObject = &self.global_object;
            let success = matches!(result, Ok(_));
            let promise_value = self.promise.value();
            let promise = self.promise.get();
            let result = match result {
                Err(err) => match err.to_js_with_async_stack(global_object, promise) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.reject(global_object, Err(e));
                    }
                },
                Ok(res) => match FsReturn::fs_to_js(res, global_object) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.reject(global_object, Err(e));
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
    }

    // ──────────────────────────────────────────────────────────────────────────
    // NewAsyncFSTask — runs a NodeFS method on the thread pool.
    // ──────────────────────────────────────────────────────────────────────────

    /// One `fs.*` operation's parsed arguments.
    pub trait FsArgument: Sized + ThreadIsolatedArg {
        const HAVE_ABORT_SIGNAL: bool = false;
        /// `Arguments.fromJS(ctx, &slice)` — parse this argument set from a JS
        /// call frame. Every `args::*` struct already exposes an inherent
        /// `from_js`; the trait forwards to it so the generic `Bindings` in
        /// `node_fs_binding.rs` can call it without per-type macro arms.
        fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self>;
        /// [`from_js`](Self::from_js) for a work-pool job: paths and data parse
        /// thread-isolated / pinned and rooted under `will_be_async`.
        fn from_js_async(
            ctx: &JSGlobalObject,
            arguments: &mut ArgumentsSlice,
        ) -> JsResult<ThreadIsolated<Self>> {
            arguments.will_be_async = true;
            let args = Self::from_js(ctx, arguments)?;
            // SAFETY: parsed with `will_be_async`.
            Ok(unsafe { ThreadIsolated::new(args) })
        }
        fn signal(&self) -> Option<&AbortSignal> {
            None
        }
    }

    /// Forward [`FsArgument`] to the inherent `from_js` each `args::*` struct
    /// already defines.
    macro_rules! impl_fs_argument {
    ( $( $ty:ty ),+ $(,)? ) => {
        $(
        // SAFETY: `from_js_async` parses paths and data thread-isolated / pinned
        // and rooted; the remaining fields are plain data.
        unsafe impl ThreadIsolatedArg for $ty {}
        impl FsArgument for $ty {
            #[inline] fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> { <$ty>::from_js(ctx, arguments) }
        } )+
    };
}
    impl_fs_argument!(
        args::Rename<'static>,
        args::Truncate<'static>,
        args::FdVectorIo,
        args::FTruncate,
        args::Chown<'static>,
        args::Lutimes<'static>,
        args::Chmod<'static>,
        args::StatFS<'static>,
        args::Stat<'static>,
        args::Link<'static>,
        args::Symlink<'static>,
        args::Readlink<'static>,
        args::Realpath<'static>,
        args::Unlink<'static>,
        args::Rm<'static>,
        args::RmDir<'static>,
        args::Mkdir<'static>,
        args::MkdirTemp<'static>,
        args::Readdir<'static>,
        args::Open<'static>,
        args::Write<'static>,
        args::Read,
        args::Exists<'static>,
        args::Access<'static>,
        args::CopyFile<'static>,
        args::Cp<'static>,
        args::Fchown,
        args::FChmod,
        args::Fstat,
        args::Close,
        args::Futimes,
        args::FdataSync,
        args::Fsync,
    );
    // `ReadFile`/`WriteFile` carry an `AbortSignal` field — opt them in so the
    // `const _ = assert!(…::HAVE_ABORT_SIGNAL)` invariants in `async_` hold and
    // `signal()` exposes it to `AsyncFSTask::run_from_js_thread`.
    // SAFETY: as for `impl_fs_argument!`; the `AbortSignal` ref is thread-safe.
    unsafe impl ThreadIsolatedArg for args::ReadFile<'static> {}
    // SAFETY: see above.
    unsafe impl ThreadIsolatedArg for args::WriteFile<'static> {}
    // SAFETY: see above.
    unsafe impl ThreadIsolatedArg for args::AppendFile<'static> {}
    impl FsArgument for args::ReadFile<'static> {
        const HAVE_ABORT_SIGNAL: bool = true;
        #[inline]
        fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            args::ReadFile::from_js(ctx, arguments)
        }
        #[inline]
        fn signal(&self) -> Option<&AbortSignal> {
            self.signal.as_deref()
        }
    }
    impl FsArgument for args::WriteFile<'static> {
        const HAVE_ABORT_SIGNAL: bool = true;
        #[inline]
        fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            args::WriteFile::from_js(ctx, arguments)
        }
        #[inline]
        fn signal(&self) -> Option<&AbortSignal> {
            self.signal.as_deref()
        }
    }
    impl FsArgument for args::AppendFile<'static> {
        const HAVE_ABORT_SIGNAL: bool = true;
        #[inline]
        fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            args::WriteFile::from_js_with_default_flag(ctx, arguments, FileSystemFlags::A)
                .map(args::AppendFile)
        }
        #[inline]
        fn signal(&self) -> Option<&AbortSignal> {
            self.0.signal.as_deref()
        }
    }

    /// Convert an async-FS result payload to a `JSValue`.
    /// Each `ret::*` type implements this by forwarding to its inherent method.
    pub trait FsReturn {
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue>;
    }
    impl FsReturn for JSValue {
        #[inline]
        fn fs_to_js(self, _global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(self)
        }
    }
    impl FsReturn for () {
        #[inline]
        fn fs_to_js(self, _global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(JSValue::UNDEFINED)
        }
    }
    impl FsReturn for bool {
        #[inline]
        fn fs_to_js(self, _global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(JSValue::js_boolean(self))
        }
    }
    impl FsReturn for Null {
        #[inline]
        fn fs_to_js(self, _global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(JSValue::NULL)
        }
    }
    impl FsReturn for Stats {
        #[inline]
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.to_js_newly_created(global)
        }
    }
    impl FsReturn for FD {
        #[inline]
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(crate::node::types::FdJsc::to_js(self, global))
        }
    }
    impl FsReturn for StringOrBuffer<'_> {
        #[inline]
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.into_js(global)
        }
    }
    impl FsReturn for StringOrUndefined {
        #[inline]
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.into_js(global)
        }
    }
    impl FsReturn for StringOrBytes {
        #[inline]
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.into_js(global)
        }
    }
    impl FsReturn for ret::Read {
        #[inline]
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(self.to_js(global))
        }
    }
    impl FsReturn for ret::Write {
        #[inline]
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(self.to_js(global))
        }
    }
    impl FsReturn for node::StatFS {
        #[inline]
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.to_js_newly_created(global)
        }
    }
    impl FsReturn for ret::Readdir {
        #[inline]
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.to_js(global)
        }
    }
    impl FsReturn for StatOrNotFound {
        #[inline]
        fn fs_to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
            self.to_js_newly_created(global)
        }
    }

    /// One `fs.promises.*` operation on the work pool. The arguments' JS-backed
    /// buffers are pinned and rooted (`ThreadIsolated`) and read under the job's ticket;
    /// the result is plain data (`R: Send`) turned into JS values in `then`.
    pub struct AsyncFSTask<R, A, const F: NodeFSFunctionEnum> {
        pub args: ThreadIsolated<A>,
        pub(crate) result: Maybe<R>,
    }

    /// The JS-thread half of an async fs operation.
    #[derive(bun_jsc::JsAffine)]
    pub struct AsyncFSJs {
        pub(crate) promise: JSPromiseStrong,
        pub(crate) tracker: AsyncTaskTracker,
    }

    impl<R: FsReturn + Send + 'static, A: FsArgument + 'static, const F: NodeFSFunctionEnum>
        bun_jsc::JobContext for AsyncFSTask<R, A, F>
    where
        Op<{ F }>: NodeFSDispatch<R, A>,
    {
        type OffThread = Self;
        type Js = AsyncFSJs;

        fn run(
            this: &mut Self,
            done: bun_jsc::Completion<Self>,
        ) -> Option<bun_jsc::Completion<Self>> {
            let mut node_fs = NodeFS::default();
            this.result = NodeFS::dispatch::<R, A, F>(&mut node_fs, &this.args, Flavor::Async);
            Some(done)
        }

        fn then(
            mut this: Self,
            js: AsyncFSJs,
            cx: &bun_jsc::JsThread<'_>,
        ) -> bun_jsc::JsResult<()> {
            let global_object = cx.global();
            let _dispatch = js.tracker.dispatch(global_object);

            let success = this.result.is_ok();
            let promise_value = js.promise.value();
            let promise = js.promise.get();
            let result = match core::mem::replace(&mut this.result, Err(sys::Error::default())) {
                Err(err) => match err.to_js_with_async_stack(global_object, promise) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.reject(global_object, Err(e));
                    }
                },
                Ok(res) => match FsReturn::fs_to_js(res, global_object) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.reject(global_object, Err(e));
                    }
                },
            };
            promise_value.ensure_still_alive();

            if Self::HAVE_ABORT_SIGNAL {
                if let Some(signal) = this.args.signal() {
                    if let Some(abort_error) = signal.node_abort_error_if_aborted(global_object) {
                        return promise.reject(global_object, Ok(abort_error));
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
    }

    impl<R: FsReturn + Send + 'static, A: FsArgument + 'static, const F: NodeFSFunctionEnum>
        AsyncFSTask<R, A, F>
    where
        Op<{ F }>: NodeFSDispatch<R, A>,
    {
        /// NewAsyncFSTask supports cancelable operations via AbortSignal,
        /// so long as a "signal" field exists. The task wrapper will ensure
        /// a promise rejection happens if signaled, but if `function` is
        /// already called, no guarantees are made. It is recommended for
        /// the functions to check .signal.aborted() for early returns.
        pub(crate) const HAVE_ABORT_SIGNAL: bool = A::HAVE_ABORT_SIGNAL;

        pub(crate) fn create(
            global_object: &JSGlobalObject,
            _binding: &Binding,
            args: ThreadIsolated<A>,
            vm: &mut VirtualMachine,
        ) -> JSValue {
            let tracker = AsyncTaskTracker::init(vm);
            tracker.did_schedule(global_object);
            let promise = JSPromiseStrong::init(global_object);
            let value = promise.value();
            bun_jsc::Job::<Self>::schedule(
                &global_object.js_thread(),
                Self {
                    args,
                    // Sentinel — overwritten by `run` before any read. `Maybe<R>`
                    // may be niche-optimised; never construct an all-zero `Result`.
                    result: Err(sys::Error::default()),
                },
                AsyncFSJs { promise, tracker },
            );
            value
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // AsyncCpTask
    // ──────────────────────────────────────────────────────────────────────────

    pub type AsyncCpTask = NewAsyncCpTask<false>;
    pub type ShellAsyncCpTask = NewAsyncCpTask<true>;

    // The shell flattens builtins under `crate::shell::builtins::*`. Progress
    // and completion are reported through the `ShellCpHandle` the builtin
    // hands over (cp.rs) — no trait indirection.
    pub(crate) use crate::shell::builtins::cp::ShellCpHandle;

    /// One `fs.cp` / `fs.promises.cp` (or shell `cp`) operation. Shared through
    /// [`CpTaskRef`] by the directory-scan task and every per-file subtask;
    /// dropping the last reference posts it to its loop, which runs
    /// [`run_from_js_thread`](Self::run_from_js_thread) (or
    /// [`finish_shell`](Self::finish_shell)) and drops it.
    pub struct NewAsyncCpTask<const IS_SHELL: bool> {
        pub(crate) promise: JSPromiseStrong,
        pub args: ThreadIsolated<args::Cp<'static>>,
        /// Owning-thread uses (global object, keep-alive context).
        pub(crate) evtloop: EventLoopHandle,
        /// How the last reference's thread delivers the completion. For a JS
        /// loop this is the ticket its VM waits for — the arguments may point
        /// into JS buffers and the promise lives on the JS heap.
        pub(crate) poster: Option<bun_jsc::ConcurrentPoster>,
        /// The first result any subtask reports (first writer wins); `None`
        /// until then. Read on the owning thread once every subtask is done.
        pub(crate) result: bun_threading::Guarded<Option<Maybe<ret::Cp>>>,
        /// If this task is called by the shell then we shouldn't call this as
        /// it is not threadsafe and is unnecessary as the process will be kept
        /// alive by the shell instance.
        // The field exists unconditionally; the `IS_SHELL` path simply skips
        // `ref_()`/`unref()` (`KeepAlive::default()` is inert until ref'd).
        pub(crate) r#ref: KeepAlive,
        pub(crate) tracker: AsyncTaskTracker,
        /// `Some` iff `IS_SHELL`: the shell `cp` builtin this copy reports to.
        pub(crate) shelltask: Option<ShellCpHandle>,
    }

    impl<const IS_SHELL: bool> Drop for NewAsyncCpTask<IS_SHELL> {
        fn drop(&mut self) {
            if !IS_SHELL {
                self.r#ref.unref(event_loop_handle_to_ctx(self.evtloop));
            }
        }
    }

    // Queued as a box by `on_all_done`; an unrun completion is released by
    // dropping it (promise handle, protected arguments, keep-alive).
    bun_event_loop::boxed_taskable!(
        [const IS_SHELL: bool] NewAsyncCpTask<IS_SHELL>
        => if IS_SHELL {
            bun_event_loop::task_tag::ShellAsyncCpTask
        } else {
            bun_event_loop::task_tag::AsyncCpTask
        }
    );

    /// A share of an in-flight [`NewAsyncCpTask`]. The directory-scan task
    /// holds one and each [`CpSingleTask`] holds one; whichever thread drops
    /// the last hands the task back to its loop, so subtasks still running on
    /// the pool never see a freed parent.
    pub struct CpTaskRef<const IS_SHELL: bool>(Option<std::sync::Arc<NewAsyncCpTask<IS_SHELL>>>);

    impl<const IS_SHELL: bool> CpTaskRef<IS_SHELL> {
        fn new(task: NewAsyncCpTask<IS_SHELL>) -> Self {
            // Shared with the pool by design (its carriers are `owned_task!`s).
            // Pool threads touch only `args` (`ThreadIsolated`), `result`
            // (locked) and `shelltask.on_copy` (locked inside); `promise`,
            // `tracker`, `r#ref`, `evtloop` and `poster` are touched only by
            // `on_all_done` (exclusive by then) and by `run_from_js_thread` /
            // `finish_shell` / `Drop`, which run from the posted box on the
            // owning thread.
            #[allow(clippy::arc_with_non_send_sync)]
            Self(Some(std::sync::Arc::new(task)))
        }
    }
    impl<const IS_SHELL: bool> Clone for CpTaskRef<IS_SHELL> {
        fn clone(&self) -> Self {
            Self(self.0.clone())
        }
    }
    impl<const IS_SHELL: bool> core::ops::Deref for CpTaskRef<IS_SHELL> {
        type Target = NewAsyncCpTask<IS_SHELL>;
        fn deref(&self) -> &Self::Target {
            self.0.as_deref().expect("live cp task share")
        }
    }
    impl<const IS_SHELL: bool> Drop for CpTaskRef<IS_SHELL> {
        fn drop(&mut self) {
            if let Some(task) = self.0.take().and_then(std::sync::Arc::into_inner) {
                task.on_all_done();
            }
        }
    }

    /// The pool task that scans the source tree (and tries `clonefile`),
    /// fanning out one [`CpSingleTask`] per file.
    pub(super) struct CpDirTask<const IS_SHELL: bool> {
        cp_task: CpTaskRef<IS_SHELL>,
        task: WorkPoolTask,
    }

    bun_threading::owned_task!([const IS_SHELL: bool] CpDirTask<IS_SHELL>, task);

    impl<const IS_SHELL: bool> CpDirTask<IS_SHELL> {
        #[allow(clippy::boxed_local)]
        fn run_owned(self: Box<Self>) {
            let mut node_fs = NodeFS::default();
            NewAsyncCpTask::cp_async(&mut node_fs, &self.cp_task);
        }
    }

    /// This task is used by `AsyncCpTask/fs.promises.cp` to copy a single file.
    /// When clonefile cannot be used, this task is started once per file.
    pub struct CpSingleTask<const IS_SHELL: bool> {
        pub(crate) cp_task: CpTaskRef<IS_SHELL>,
        /// Single owned allocation laid out as `<src>\0<dest>\0`. Ownership is
        /// encoded directly as `Box<[OSPathChar]>` and
        /// the two NUL-terminated views are reconstructed via `src()` / `dest()`.
        path_buf: Box<[OSPathChar]>,
        src_len: usize,
        dest_len: usize,
        pub task: WorkPoolTask,
    }

    bun_threading::owned_task!([const IS_SHELL: bool] CpSingleTask<IS_SHELL>, task);

    impl<const IS_SHELL: bool> CpSingleTask<IS_SHELL> {
        /// `path_buf` layout: `[src @ ..src_len][0][dest @ ..dest_len][0]`.
        pub(crate) fn create(
            parent: CpTaskRef<IS_SHELL>,
            path_buf: Box<[OSPathChar]>,
            src_len: usize,
            dest_len: usize,
        ) {
            debug_assert_eq!(path_buf.len(), src_len + 1 + dest_len + 1);
            debug_assert_eq!(path_buf[src_len], 0);
            debug_assert_eq!(path_buf[src_len + 1 + dest_len], 0);
            WorkPool::schedule_new(CpSingleTask {
                cp_task: parent,
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

        /// Drops `self` — and with it possibly the last [`CpTaskRef`] — on return.
        #[allow(clippy::boxed_local)]
        fn run_owned(self: Box<Self>) {
            let parent: &NewAsyncCpTask<IS_SHELL> = &self.cp_task;

            // TODO: error strings on node_fs will die
            let mut node_fs = NodeFS::default();

            let args = &parent.args;
            let result = node_fs.copy_single_file_sync(
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
        }
    }

    impl<const IS_SHELL: bool> NewAsyncCpTask<IS_SHELL> {
        pub(crate) fn on_copy(
            &self,
            src: impl AsRef<[OSPathChar]>,
            dest: impl AsRef<[OSPathChar]>,
        ) {
            if !IS_SHELL {
                return;
            }
            // Concurrent subtasks may call this in parallel; `on_copy`
            // serialises via the shell task's internal mutex.
            self.shelltask
                .as_ref()
                .expect("IS_SHELL ⇒ shelltask")
                .on_copy(src.as_ref(), dest.as_ref());
        }

        /// `fs.cp` / `fs.promises.cp` (JS thread): a promise, an async-stack
        /// tracker, and this VM's loop.
        pub(crate) fn create(
            global_object: &JSGlobalObject,
            _binding: &Binding,
            cp_args: ThreadIsolated<args::Cp<'static>>,
            vm: &mut VirtualMachine,
        ) -> JSValue {
            let tracker = AsyncTaskTracker::init(vm);
            tracker.did_schedule(global_object);
            let promise = JSPromiseStrong::init(global_object);
            let value = promise.value();
            Self::schedule_new(
                promise,
                cp_args,
                EventLoopHandle::init(vm.event_loop.cast()),
                bun_jsc::ConcurrentPoster::Js(vm.ticket()),
                tracker,
                None,
            );
            value
        }

        /// The shell's `cp` builtin, from its pool task (any thread): no VM or
        /// global is touched — the loop and poster are the ones the shell task
        /// already captured on its own thread.
        pub(crate) fn create_for_shell(
            cp_args: ThreadIsolated<args::Cp<'static>>,
            evtloop: EventLoopHandle,
            poster: bun_jsc::ConcurrentPoster,
            shelltask: ShellCpHandle,
        ) {
            Self::schedule_new(
                JSPromiseStrong::default(),
                cp_args,
                evtloop,
                poster,
                AsyncTaskTracker { id: 0 },
                Some(shelltask),
            );
        }

        fn schedule_new(
            promise: JSPromiseStrong,
            cp_args: ThreadIsolated<args::Cp<'static>>,
            evtloop: EventLoopHandle,
            poster: bun_jsc::ConcurrentPoster,
            tracker: AsyncTaskTracker,
            shelltask: Option<ShellCpHandle>,
        ) {
            let mut task = Self {
                promise,
                args: cp_args,
                result: bun_threading::Guarded::new(None),
                evtloop,
                poster: Some(poster),
                r#ref: KeepAlive::default(),
                tracker,
                shelltask,
            };
            if !IS_SHELL {
                task.r#ref.ref_(event_loop_handle_to_ctx(task.evtloop));
            }
            WorkPool::schedule_new(CpDirTask {
                cp_task: CpTaskRef::new(task),
                task: WorkPoolTask::default(),
            });
        }

        /// May be called from any thread (the subtasks).
        /// Records the result (first caller wins). Does NOT schedule completion —
        /// that happens when the last [`CpTaskRef`] is dropped, so that subtasks
        /// still running on the thread pool don't dereference a freed parent.
        fn finish_concurrently(&self, result: Maybe<ret::Cp>) {
            let mut slot = self.result.lock();
            if slot.is_none() {
                *slot = Some(result);
            }
        }

        /// The thread that dropped the last [`CpTaskRef`]: hand the task to
        /// its loop. If no subtask reported an error, the copy succeeded.
        fn on_all_done(mut self) {
            self.result.get_mut().get_or_insert(Ok(()));
            let poster = self
                .poster
                .take()
                .expect("fs.cp in flight holds its poster");
            if poster.is_js() {
                poster.post_js(ConcurrentTask::ConcurrentTask::create(
                    bun_jsc::Task::from_boxed(Box::new(self)),
                ));
            } else {
                poster.post_mini(AnyTaskWithExtraContext::from_value(self, |this, _ctx| {
                    this.finish_shell()
                }));
            }
            // The pool side is done (the task may already be freed by its loop).
            drop(poster);
        }

        /// The shell builtin's loop thread: report the result to the builtin,
        /// which continues (and may free what `args` points into) in place.
        pub(crate) fn finish_shell(mut self) {
            debug_assert!(IS_SHELL);
            let result = self.result.get_mut().take().unwrap_or(Ok(()));
            let src = core::mem::take(&mut self.args.src);
            let dest = core::mem::take(&mut self.args.dest);
            let shelltask = self.shelltask.take().expect("IS_SHELL ⇒ shelltask");
            shelltask.finish(src, dest, result);
            drop(self);
        }

        /// JS thread, from the task queue: settle the promise (or, for the
        /// shell's copy, report to the builtin). `self` is dropped here.
        pub(crate) fn run_from_js_thread(
            mut self: Box<Self>,
            global_object: &JSGlobalObject,
        ) -> JsResult<()> {
            if IS_SHELL {
                (*self).finish_shell();
                return Ok(());
            }
            let result = self.result.get_mut().take().unwrap_or(Ok(()));
            let success = result.is_ok();
            let promise_value = self.promise.value();
            let promise = self.promise.take();
            let tracker = self.tracker;
            let result = match result {
                Err(err) => match err.to_js_with_async_stack(global_object, promise.get()) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.get().reject(global_object, Err(e));
                    }
                },
                Ok(res) => match FsReturn::fs_to_js(res, global_object) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.get().reject(global_object, Err(e));
                    }
                },
            };
            promise_value.ensure_still_alive();

            let _dispatch = tracker.dispatch(global_object);

            drop(self);
            if success {
                promise.get().resolve(global_object, result)?;
            } else {
                promise.get().reject(global_object, Ok(result))?;
            }
            Ok(())
        }

        /// Directory scanning + clonefile will block this thread, then each individual file copy (what the sync version
        /// calls "copy_single_file_sync") will be dispatched as a separate task.
        /// `task` is the directory scan's share; every `CpSingleTask` it
        /// spawns gets a clone, and the completion runs once all are dropped.
        pub(crate) fn cp_async(nodefs: &mut NodeFS, task: &CpTaskRef<IS_SHELL>) {
            let this: &Self = task;
            let args = &this.args;
            let mut src_buf = OSPathBuffer::uninit();
            let mut dest_buf = OSPathBuffer::uninit();
            let name_too_long = |path: &PathLike| sys::Error {
                errno: E::ENAMETOOLONG as _,
                syscall: sys::Tag::copyfile,
                path: path.slice().into(),
                ..Default::default()
            };
            let src = match args.src.os_path(&mut src_buf) {
                Ok(p) => p,
                Err(NameTooLong) => {
                    this.finish_concurrently(Err(name_too_long(&args.src)));
                    return;
                }
            };
            let dest = match args.dest.os_path(&mut dest_buf) {
                Ok(p) => p,
                Err(NameTooLong) => {
                    this.finish_concurrently(Err(name_too_long(&args.dest)));
                    return;
                }
            };

            #[cfg(windows)]
            {
                let attributes = sys::windows::get_file_attributes(src);
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
                    let r = nodefs.copy_single_file_sync(
                        src,
                        dest,
                        if IS_SHELL {
                            // Shell always forces copy (overwrite allowed).
                            // `Copyfile::force` is `COPYFILE_FICLONE_FORCE`, and
                            // `copy_single_file_sync` has an ENOSYS guard for
                            // `is_force_clone()` on Windows (see the comment at
                            // the top of that branch), so passing `FORCE` would
                            // make every shell `cp file dest` fail with ENOSYS.
                            // Mode `0` yields the intended behaviour:
                            // `shouldnt_overwrite()`
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
                    let r = nodefs.copy_single_file_sync(
                        src,
                        dest,
                        constants::Copyfile::from_raw(
                            if args.flags.error_on_exist || !args.flags.force {
                                constants::COPYFILE_EXCL
                            } else {
                                0i32
                            },
                        ),
                        Some(&stat_),
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
            let _ = Self::cp_async_directory(
                nodefs,
                args.flags,
                task,
                &mut src_buf,
                src_len,
                &mut dest_buf,
                dest_len,
            );
        }

        // returns boolean `should_continue`
        fn cp_async_directory(
            nodefs: &mut NodeFS,
            args: args::CpFlags,
            this: &CpTaskRef<IS_SHELL>,
            src_buf: &mut OSPathBuffer,
            src_dir_len: PathInt,
            dest_buf: &mut OSPathBuffer,
            dest_dir_len: PathInt,
        ) -> bool {
            let this_ref: &Self = this;
            // Callers NUL-terminate at `src_dir_len`/`dest_dir_len` before calling.
            let src = OSPathSliceZ::from_buf(&src_buf[..], src_dir_len as usize);
            let dest = OSPathSliceZ::from_buf(&dest_buf[..], dest_dir_len as usize);

            #[cfg(target_os = "macos")]
            {
                // CLONE_NOFOLLOW: `src` was classified as a directory via lstat, so
                // mirror the O_NOFOLLOW directory open below instead of dereferencing.
                if let Some(err) = Maybe::<ret::Cp>::errno_sys_p(
                    bun_sys::c::clonefile_rc(src, dest, CLONE_NOFOLLOW),
                    sys::Tag::clonefile,
                    src.as_bytes(),
                ) {
                    match err.get_errno() {
                        E::EACCES | E::ENAMETOOLONG | E::EROFS | E::EPERM | E::EINVAL => {
                            // `errno_sys_p`
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

            let open_flags = sys::O::DIRECTORY | sys::O::RDONLY | sys::O::NOFOLLOW;
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

            #[cfg(windows)]
            let mut buf = OSPathBuffer::uninit();
            #[cfg(windows)]
            let normdest: &OSPathSliceZ = match sys::normalize_path_windows_opts(
                FD::INVALID,
                dest.as_slice(),
                &mut buf[..],
                // No NT prefix — `normdest` feeds
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
            let normdest: &OSPathSliceZ = dest;

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

            // On POSIX directory entries are always UTF-8, so monomorphise the
            // const-generic path type on `U8` and let the Windows branch (gated
            // above) handle the wide path.
            #[cfg(windows)]
            let mut iterator = DirIterator::iterate::<true>(fd);
            #[cfg(not(windows))]
            let mut iterator = DirIterator::iterate::<false>(fd);
            let mut entry = iterator.next();
            loop {
                let current = match entry {
                    Err(err) => {
                        this_ref.finish_concurrently(Err(err.with_path(
                            nodefs.os_path_into_sync_error_buf(&src_buf[..src_dir_len as usize]),
                        )));
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

                        let should_continue = Self::cp_async_directory(
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
                            this.clone(),
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

    /// `readdir(.., { recursive: true })`: the job's off-thread part. The scan
    /// itself is [`ReaddirScan`], shared with the pool subtasks it fans out to;
    /// those touch only owned data there — never the JS-backed `args`.
    pub struct AsyncReaddirRecursiveTask {
        /// Async-parsed arguments; their JS-backed path is not read off-thread
        /// (`ReaddirScan::root_path` is the owned copy).
        pub args: ThreadIsolated<args::Readdir<'static>>,
        pub(crate) scan: std::sync::Arc<ReaddirScan>,
    }

    /// One recursive directory scan, shared by [`AsyncReaddirRecursiveTask`]
    /// and every [`ReaddirSubtask`]. Each directory listed counts one in
    /// `subtask_count`; whichever thread brings it to zero finishes the scan.
    pub struct ReaddirScan {
        pub(crate) tag: ret::ReaddirTag,
        pub(crate) encoding: Encoding,
        /// The completion token, parked by `run` and finished by whichever
        /// thread ends the scan.
        pub(crate) done:
            bun_threading::Guarded<Option<bun_jsc::Completion<AsyncReaddirRecursiveTask>>>,

        // It's not 100% clear this one is necessary
        pub(crate) has_result: AtomicBool,

        pub(crate) subtask_count: AtomicUsize,

        /// Set once `pending_err` is. From then on `enqueue` schedules nothing
        /// and a subtask that starts skips its directory, so the scan settles as
        /// soon as the subtasks already in flight return instead of draining the
        /// whole frontier. Two directory symlinks back to the same tree make
        /// that frontier 2^41 paths deep before the kernel reports ELOOP.
        pub(crate) has_error: AtomicBool,

        /// The final result list, joined from `result_list_queue` at the end.
        pub(crate) result_list: bun_threading::Guarded<ResultListEntryValue>,

        /// When joining the result list, we use this to preallocate the joined array.
        pub(crate) result_list_count: AtomicUsize,

        /// A lockless queue of result lists, one per directory listed.
        ///
        /// Using a lockless queue instead of mutex + joining the lists as we go was a meaningful performance improvement
        pub(crate) result_list_queue: bun_threading::BoxQueue<ResultListEntryValue>,

        /// All the subtasks will use this fd to open files
        pub(crate) root_fd: SharedFd,

        /// This is used when joining the file paths for error messages.
        /// Heap-owned, NUL-terminated (`[path.., 0]`).
        pub(crate) root_path: Box<[u8]>,

        pub(crate) pending_err: bun_threading::Guarded<Option<sys::Error>>,
    }

    /// A descriptor published once (by the thread that opens it, before any
    /// other thread can look) and taken once (by the thread that closes it).
    pub(crate) struct SharedFd(core::sync::atomic::AtomicU64);
    impl SharedFd {
        #[cfg(windows)]
        fn encode(fd: FD) -> u64 {
            fd.0
        }
        #[cfg(windows)]
        fn decode(v: u64) -> FD {
            FD::from_native(v)
        }
        #[cfg(not(windows))]
        fn encode(fd: FD) -> u64 {
            u64::from(fd.0 as u32)
        }
        #[cfg(not(windows))]
        fn decode(v: u64) -> FD {
            FD::from_native(v as u32 as i32)
        }
        pub(crate) fn new(fd: FD) -> Self {
            Self(core::sync::atomic::AtomicU64::new(Self::encode(fd)))
        }
        pub(crate) fn get(&self) -> FD {
            Self::decode(self.0.load(Ordering::Acquire))
        }
        pub(crate) fn set(&self, fd: FD) {
            self.0.store(Self::encode(fd), Ordering::Release);
        }
        /// Swap in `FD::INVALID` and return what was there.
        pub(crate) fn take(&self) -> FD {
            Self::decode(self.0.swap(Self::encode(FD::INVALID), Ordering::AcqRel))
        }
    }

    impl Drop for ReaddirScan {
        fn drop(&mut self) {
            debug_assert!(
                self.root_fd.get() == FD::INVALID,
                "scan still owns its root fd"
            );
            self.clear_result_list();
        }
    }

    impl bun_jsc::JobContext for AsyncReaddirRecursiveTask {
        type OffThread = Self;
        type Js = AsyncFSJs;

        fn run(
            this: &mut Self,
            done: bun_jsc::Completion<Self>,
        ) -> Option<bun_jsc::Completion<Self>> {
            *this.scan.done.lock() = Some(done);
            let mut buf = PathBuffer::uninit();
            // Subtasks reach the scan through their own `Arc`s; this thread's
            // borrow of the job is not what they alias.
            let scan = std::sync::Arc::clone(&this.scan);
            let root_path_z = ZStr::from_buf(&scan.root_path[..], scan.root_path.len() - 1);
            // May finish synchronously (no subdirectories) or fan out; the last
            // subtask finishes the token.
            scan.perform_work(root_path_z, &mut buf, true);
            None
        }

        fn then(this: Self, js: AsyncFSJs, cx: &bun_jsc::JsThread<'_>) -> bun_jsc::JsResult<()> {
            let global_object = cx.global();
            let mut pending_err = this.scan.pending_err.lock().take();
            let success = pending_err.is_none();
            let promise_value = js.promise.value();
            let promise = js.promise.get();
            let result = if let Some(err) = &mut pending_err {
                match err.to_js_with_async_stack(global_object, promise) {
                    Ok(v) => v,
                    Err(e) => {
                        return promise.reject(global_object, Err(e));
                    }
                }
            } else {
                let res = match core::mem::replace(
                    &mut *this.scan.result_list.lock(),
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
                        return promise.reject(global_object, Err(e));
                    }
                }
            };
            promise_value.ensure_still_alive();
            let _dispatch = js.tracker.dispatch(global_object);
            drop(this);
            if success {
                promise.resolve(global_object, result)?;
            } else {
                promise.reject(global_object, Ok(result))?;
            }
            Ok(())
        }
    }

    pub enum ResultListEntryValue {
        WithFileTypes(Vec<Dirent>),
        Buffers(Vec<Box<[u8]>>),
        Files(Vec<BunString>),
    }

    pub(super) struct ReaddirSubtask {
        pub scan: std::sync::Arc<ReaddirScan>,
        /// Heap-owned, NUL-terminated (`[basename.., 0]`); freed on drop.
        pub basename: Box<[u8]>,
        pub task: WorkPoolTask,
    }

    bun_threading::owned_task!(ReaddirSubtask, task);

    impl ReaddirSubtask {
        // `owned_task!` requires `fn run_owned(self: Box<Self>)`; clippy::boxed_local
        // is a false positive on this macro contract.
        #[allow(clippy::boxed_local)]
        fn run_owned(self: Box<Self>) {
            let ReaddirSubtask {
                scan,
                basename,
                task: _,
            } = *self;
            // `enqueue()` built `basename` with a trailing NUL at `[len]`.
            let basename_z = ZStr::from_buf(&basename, basename.len() - 1);
            let mut buf = PathBuffer::uninit();
            scan.perform_work(basename_z, &mut buf, false);
        }
    }

    impl ReaddirScan {
        pub(crate) fn enqueue(self: &std::sync::Arc<Self>, basename: &ZStr) {
            if self.has_error.load(Ordering::Relaxed) {
                return;
            }
            // The subtask runs on another thread after the caller's `name_to_copy_z`
            // (which points into a per-iteration buffer) has been overwritten, so we
            // must heap-own the bytes here.
            let mut owned = Vec::with_capacity(basename.len() + 1);
            owned.extend_from_slice(basename.as_bytes());
            owned.push(0);
            // NUL-terminated `[bytes.., 0]`; moved into the subtask and freed
            // when `ReaddirSubtask` drops.
            let basename_owned: Box<[u8]> = owned.into_boxed_slice();
            // The fetch_add is load-bearing (refcounts the in-flight subtask). It
            // MUST run in release builds; only the `> 0` invariant check is debug-only.
            let prev = self.subtask_count.fetch_add(1, Ordering::Relaxed);
            debug_assert!(prev > 0);
            WorkPool::schedule_new(ReaddirSubtask {
                scan: std::sync::Arc::clone(self),
                basename: basename_owned,
                task: WorkPoolTask::default(),
            });
        }
    }

    impl AsyncReaddirRecursiveTask {
        pub(crate) fn create(
            global_object: &JSGlobalObject,
            args: ThreadIsolated<args::Readdir<'static>>,
            vm: &mut VirtualMachine,
        ) -> JSValue {
            let tag = args.tag();
            let encoding = args.encoding;
            let result_list = match tag {
                ret::ReaddirTag::Files => ResultListEntryValue::Files(Vec::new()),
                ret::ReaddirTag::WithFileTypes => ResultListEntryValue::WithFileTypes(Vec::new()),
                ret::ReaddirTag::Buffers => ResultListEntryValue::Buffers(Vec::new()),
            };
            // Subtasks read the root path after `run` has returned its borrow of the
            // arguments, so it must be an owned copy. NUL-terminated.
            let root_path = {
                let src = args.path.slice();
                let mut owned = Vec::with_capacity(src.len() + 1);
                owned.extend_from_slice(src);
                owned.push(0);
                owned.into_boxed_slice()
            };
            let tracker = AsyncTaskTracker::init(vm);
            tracker.did_schedule(global_object);
            let promise = JSPromiseStrong::init(global_object);
            let value = promise.value();
            bun_jsc::Job::<Self>::schedule(
                &global_object.js_thread(),
                AsyncReaddirRecursiveTask {
                    args,
                    scan: std::sync::Arc::new(ReaddirScan {
                        tag,
                        encoding,
                        done: bun_threading::Guarded::new(None),
                        has_result: AtomicBool::new(false),
                        subtask_count: AtomicUsize::new(1),
                        has_error: AtomicBool::new(false),
                        root_path,
                        result_list: bun_threading::Guarded::new(result_list),
                        result_list_count: AtomicUsize::new(0),
                        result_list_queue: bun_threading::BoxQueue::default(),
                        root_fd: SharedFd::new(FD::INVALID),
                        pending_err: bun_threading::Guarded::new(None),
                    }),
                },
                AsyncFSJs { promise, tracker },
            );
            value
        }
    }

    impl ReaddirScan {
        pub(crate) fn perform_work(
            self: &std::sync::Arc<Self>,
            basename: &ZStr,
            buf: &mut PathBuffer,
            is_root: bool,
        ) {
            if self.has_error.load(Ordering::Relaxed) {
                self.on_subtask_done();
                return;
            }
            macro_rules! impl_tag {
                ($T:ty, $variant:ident) => {{
                    // A bare `Vec::new()` here
                    // grew through every power-of-two size class on the
                    // heap; under mimalloc-debug each fresh-page realloc runs
                    // `mi_mem_is_zero` over the whole arena page, which dominated
                    // the recursive-readdir perf profile (~15% self-time).
                    // Pre-reserve the same 8 KiB budget so we take a single
                    // size-class allocation per subtask.
                    let mut entries: Vec<$T> =
                        Vec::with_capacity(8192usize / core::mem::size_of::<$T>());
                    let res = NodeFS::readdir_with_entries_recursive_async::<$T>(
                        buf,
                        self,
                        basename,
                        &mut entries,
                        is_root,
                    );
                    match res {
                        Err(err) => {
                            {
                                let mut pending_err = self.pending_err.lock();
                                if pending_err.is_none() {
                                    let err_path: &[u8] = if !err.path.is_empty() {
                                        &err.path[..]
                                    } else {
                                        &self.root_path[..self.root_path.len() - 1]
                                    };
                                    *pending_err = Some(err.with_path(err_path));
                                }
                            }
                            self.has_error.store(true, Ordering::Relaxed);
                            self.on_subtask_done();
                        }
                        Ok(()) => {
                            self.write_results::<$T>(&mut entries);
                        }
                    }
                }};
            }
            match self.tag {
                ret::ReaddirTag::Files => impl_tag!(BunString, Files),
                ret::ReaddirTag::WithFileTypes => impl_tag!(Dirent, WithFileTypes),
                ret::ReaddirTag::Buffers => impl_tag!(Box<[u8]>, Buffers),
            }
        }

        pub(crate) fn write_results<T: IntoResultListEntry>(&self, result: &mut Vec<T>) {
            if !result.is_empty() {
                // `result` is already a heap `Vec`, so cloning would be a redundant
                // alloc+memcpy; just take ownership and trim the over-reservation
                // from `perform_work` so the queued entry holds exact capacity.
                let mut clone: Vec<T> = core::mem::take(result);
                clone.shrink_to_fit();
                self.result_list_count
                    .fetch_add(clone.len(), Ordering::Relaxed);
                let list = ResultListEntryValue::from_vec(clone);
                self.result_list_queue.push(list);
            }

            self.on_subtask_done();
        }

        /// Drops this subtask's `subtask_count` reference. The last one finishes
        /// the scan; `AcqRel` publishes every subtask's `pending_err` and queued
        /// results to it.
        fn on_subtask_done(&self) {
            if self.subtask_count.fetch_sub(1, Ordering::AcqRel) == 1 {
                self.finish_concurrently();
            }
        }

        /// May be called from any thread (the subtasks)
        pub(crate) fn finish_concurrently(&self) {
            if self
                .has_result
                .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
                .is_err()
            {
                return;
            }
            debug_assert!(self.subtask_count.load(Ordering::Relaxed) == 0);

            let root_fd = self.root_fd.take();
            if root_fd != FD::INVALID {
                use bun_sys::FdExt as _;
                root_fd.close();
            }

            if self.pending_err.lock().is_some() {
                self.clear_result_list();
            }

            {
                let mut result_list = self.result_list.lock();
                let cap = self.result_list_count.swap(0, Ordering::Relaxed);
                result_list.reserve_exact(cap);
                for mut list in self.result_list_queue.drain() {
                    result_list.append_from(&mut list);
                }
            }

            // Hand the scan back to its VM (or, if that is gone, to the release
            // that frees this off-thread part). Last touch of `self` on this thread.
            let done = self.done.lock().take();
            done.expect("scan finished twice").finish();
        }

        fn clear_result_list(&self) {
            self.result_list.lock().clear();
            drop(self.result_list_queue.drain());
            self.result_list_count.store(0, Ordering::Relaxed);
        }
    }

    /// Maps a readdir element type to its `ResultListEntryValue` variant.
    ///
    /// Rust can't switch on a generic `T` inside `write_results`, so the
    /// per-type `ResultListEntryValue` wrapping lives on this trait.
    pub trait IntoResultListEntry: Sized {
        fn into_variant(v: Vec<Self>) -> ResultListEntryValue;
    }
    impl IntoResultListEntry for Dirent {
        fn into_variant(v: Vec<Self>) -> ResultListEntryValue {
            ResultListEntryValue::WithFileTypes(v)
        }
    }
    impl IntoResultListEntry for Box<[u8]> {
        fn into_variant(v: Vec<Self>) -> ResultListEntryValue {
            ResultListEntryValue::Buffers(v)
        }
    }
    impl IntoResultListEntry for BunString {
        fn into_variant(v: Vec<Self>) -> ResultListEntryValue {
            ResultListEntryValue::Files(v)
        }
    }

    impl ResultListEntryValue {
        fn from_vec<T: IntoResultListEntry>(v: Vec<T>) -> Self {
            T::into_variant(v)
        }
        fn clear(&mut self) {
            match self {
                Self::WithFileTypes(v) => v.clear(),
                Self::Buffers(v) => v.clear(),
                Self::Files(v) => v.clear(),
            }
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
#[cfg(windows)]
pub use _async_tasks::UvFsSubmit;
pub use _async_tasks::{
    AsyncCpTask, AsyncFSTask, AsyncReaddirRecursiveTask, CpSingleTask, CpTaskRef, FsArgument,
    FsReturn, IntoResultListEntry, NewAsyncCpTask, ReaddirScan, ResultListEntryValue,
    ShellAsyncCpTask, UVFSRequest, async_,
};

// ──────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────
// TODO: to improve performance for all of these, the tagged unions for each
// type could become untagged unions with the tag passed as a const generic to
// the functions performing the syscalls. This would reduce stack size, at the
// cost of instruction cache misses.
pub mod args {
    use super::*;

    pub struct Rename<'a> {
        pub(crate) old_path: PathLike<'a>,
        pub(crate) new_path: PathLike<'a>,
    }
    impl Rename<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let old_path = PathLike::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_argument_type_value(
                    b"oldPath",
                    b"string or an instance of Buffer or URL",
                    arguments.next().unwrap_or(JSValue::UNDEFINED),
                )
            })?;
            // `Drop for PathLike` runs on early return.
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

    #[derive(Default)]
    pub struct Truncate<'a> {
        /// Passing a file descriptor is deprecated and may result in an error being thrown in the future.
        pub path: PathOrFileDescriptor<'a>,
        pub(crate) len: u64, // u63
        pub(crate) flags: i32,
    }
    impl Truncate<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_arguments(format_args!("path must be a string or TypedArray"))
            })?;
            // Node treats an explicit `undefined` len the same as a missing one: 0.
            let len_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let len: u64 = if len_value.is_undefined() {
                0
            } else {
                validators::validate_integer(ctx, len_value, "len", None, None)?.max(0) as u64
            };
            Ok(Truncate {
                path,
                len,
                flags: 0,
            })
        }
    }

    /// Shared layout for `fs.writev` / `fs.readv` arguments. One concrete
    /// struct; we re-export both
    /// names as type aliases so every `args::Writev` / `args::Readv` caller
    /// (UVFSRequest params, `readv`/`writev`/`preadv_inner`/`pwritev_inner`,
    /// uv dispatch arms) is untouched.
    pub struct FdVectorIo {
        pub(crate) fd: FD,
        pub(crate) buffers: VectorArrayBuffer,
        pub(crate) position: Option<u64>, // u52
    }
    impl FdVectorIo {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let fd = FD::from_js_required(ctx, arguments)?;
            let buffers = VectorArrayBuffer::from_js(
                ctx,
                arguments.next_eat().ok_or_else(|| {
                    ctx.throw_invalid_arguments(format_args!("Expected an ArrayBufferView[]"))
                })?,
                // The iovec pointers outlive this call on the async path; root
                // each element and pin its backing store until completion.
                arguments.will_be_async,
            )?;
            let position: Option<u64> = arguments
                .next_eat()
                .and_then(i52::offset_from_js)
                .and_then(|p| u64::try_from(p).ok());
            Ok(Self {
                fd,
                buffers,
                position,
            })
        }
    }
    pub(crate) type Writev = FdVectorIo;
    pub(crate) type Readv = FdVectorIo;

    pub struct FTruncate {
        pub(crate) fd: FD,
        pub(crate) len: Option<BlobSizeType>,
    }
    impl FTruncate {
        pub fn from_js(
            ctx: &JSGlobalObject,
            arguments: &mut ArgumentsSlice,
        ) -> JsResult<FTruncate> {
            let fd = FD::from_js_required(ctx, arguments)?;
            // Node treats an explicit `undefined` len the same as a missing one: 0.
            let len_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
            let len: BlobSizeType = if len_value.is_undefined() {
                0
            } else {
                BlobSizeType::try_from(
                    validators::validate_integer(
                        ctx,
                        len_value,
                        "len",
                        Some(i52::MIN),
                        Some(BLOB_SIZE_MAX as i64),
                    )?
                    .max(0),
                )
                .expect("infallible: validated range")
            };
            Ok(FTruncate { fd, len: Some(len) })
        }
    }

    pub struct Chown<'a> {
        pub path: PathLike<'a>,
        pub(crate) uid: UidT,
        pub(crate) gid: GidT,
    }
    impl Chown<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            // `Drop for PathLike` covers every
            // error return below (including `validate_integer`).
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
        pub(crate) fd: FD,
        pub(crate) uid: UidT,
        pub(crate) gid: GidT,
    }
    impl Fchown {
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

    /// Only ever instantiated with `uid_t`/`gid_t` — `u32` on POSIX, `u8` on
    /// Windows (libuv's `uv_uid_t`/`uv_gid_t` are `unsigned char`). Hard-code
    /// the per-platform wrap rather than pulling `num_traits`.
    #[cfg(not(windows))]
    #[inline]
    fn wrap_to<T: From<u32>>(in_: i64) -> T {
        T::from(in_ as u32)
    }
    #[cfg(windows)]
    #[inline]
    fn wrap_to<T: From<u8>>(in_: i64) -> T {
        T::from(in_ as u8)
    }

    pub(crate) type LChown<'a> = Chown<'a>;

    pub struct Lutimes<'a> {
        pub path: PathLike<'a>,
        pub(crate) atime: TimeLike,
        pub(crate) mtime: TimeLike,
    }
    impl Lutimes<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            // `Drop for PathLike` covers the
            // `time_like_from_js` throws below.
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

    pub struct Chmod<'a> {
        pub path: PathLike<'a>,
        pub(crate) mode: Mode,
    }
    impl Chmod<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            // `Drop for PathLike` covers the
            // `mode_from_js` throw below.
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
        pub(crate) fd: FD,
        pub(crate) mode: Mode,
    }
    impl FChmod {
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

    pub(crate) type LCHmod<'a> = Chmod<'a>;

    pub struct StatFS<'a> {
        pub path: PathLike<'a>,
        pub(crate) big_int: bool,
    }
    impl StatFS<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            // `Drop for PathLike` covers the
            // `get_boolean_strict` throw below.
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

    pub struct Stat<'a> {
        pub path: PathLike<'a>,
        pub(crate) big_int: bool,
        pub(crate) throw_if_no_entry: bool,
    }
    impl Stat<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            // `Drop for PathLike` covers the error returns below.
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

        /// `fs.stat(path)` of Rust-owned bytes, for a work-pool job.
        pub fn owned(path: Vec<u8>) -> ThreadIsolated<Self> {
            // SAFETY: owned path only.
            unsafe {
                ThreadIsolated::new(Stat {
                    path: PathLike::owned(path),
                    big_int: false,
                    throw_if_no_entry: true,
                })
            }
        }
    }

    pub struct Fstat {
        pub(crate) fd: FD,
        pub(crate) big_int: bool,
    }
    impl Fstat {
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

        /// `fs.fstat(fd)`, for a work-pool job.
        pub fn for_fd(fd: FD) -> ThreadIsolated<Self> {
            // SAFETY: no JS-backed fields.
            unsafe { ThreadIsolated::new(Fstat { fd, big_int: false }) }
        }
    }

    pub(crate) type Lstat<'a> = Stat<'a>;

    pub struct Link<'a> {
        pub(crate) old_path: PathLike<'a>,
        pub(crate) new_path: PathLike<'a>,
    }
    impl Link<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let old_path = PathLike::from_js_required(ctx, arguments, "oldPath")?;
            // `Drop for PathLike` runs on early return.
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

    pub struct Symlink<'a> {
        /// Where the symbolic link is targetting.
        pub(crate) target_path: PathLike<'a>,
        /// The path to create the symbolic link at.
        pub(crate) new_path: PathLike<'a>,
        /// Windows has multiple link types. By default, only junctions can be created by non-admin.
        #[cfg(windows)]
        pub(crate) link_type: SymlinkLinkType,
    }
    impl Symlink<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            // `Drop for PathLike` covers the error returns below.
            let old_path = PathLike::from_js_required(ctx, arguments, "target")?;
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
                        if str.eq_ascii(b"dir") {
                            break 'link_type SymlinkLinkType::Dir;
                        }
                        if str.eq_ascii(b"file") {
                            break 'link_type SymlinkLinkType::File;
                        }
                        if str.eq_ascii(b"junction") {
                            break 'link_type SymlinkLinkType::Junction;
                        }
                        return Err(ctx.err(bun_jsc::ErrorCode::ERR_INVALID_ARG_VALUE, format_args!("Symlink type must be one of \"dir\", \"file\", or \"junction\". Received \"{}\"", str)).throw());
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
            #[cfg(not(windows))]
            let _ = link_type;
            Ok(Symlink {
                target_path: old_path,
                new_path,
                #[cfg(windows)]
                link_type,
            })
        }
    }

    pub struct Readlink<'a> {
        pub path: PathLike<'a>,
        pub(crate) encoding: Encoding,
    }
    impl Readlink<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let encoding = parse_encoding_arg(ctx, arguments, Encoding::Utf8)?;
            Ok(Readlink { path, encoding })
        }
    }

    pub struct Realpath<'a> {
        pub path: PathLike<'a>,
        pub(crate) encoding: Encoding,
    }
    impl Realpath<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let encoding = parse_encoding_arg(ctx, arguments, Encoding::Utf8)?;
            Ok(Realpath { path, encoding })
        }
    }

    fn get_encoding(
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
    /// Shared by `Readlink`/`Realpath`/`MkdirTemp::from_js`.
    fn parse_encoding_arg(
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

    pub struct Unlink<'a> {
        pub path: PathLike<'a>,
    }
    impl Unlink<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            Ok(Unlink { path })
        }

        /// `fs.unlink(path)` of Rust-owned bytes, for a work-pool job.
        pub fn owned(path: Vec<u8>) -> ThreadIsolated<Self> {
            // SAFETY: owned path only.
            unsafe {
                ThreadIsolated::new(Unlink {
                    path: PathLike::owned(path),
                })
            }
        }
    }

    /// `fs.rm` shares `RmDir`'s option set but validates it the way node's
    /// `validateRmOptions` does: an own `recursive`/`force` key holding
    /// `undefined` overwrites the default and is rejected, where `fs.rmdir`
    /// silently keeps the default for it.
    pub struct Rm<'a>(pub(crate) RmDir<'a>);
    impl<'a> std::ops::Deref for Rm<'a> {
        type Target = RmDir<'a>;
        fn deref(&self) -> &RmDir<'a> {
            &self.0
        }
    }
    impl Rm<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            Ok(Rm(RmDir::from_js_impl(ctx, arguments, true)?))
        }
    }

    pub struct RmDir<'a> {
        pub path: PathLike<'a>,
        pub(crate) force: bool,
        pub(crate) max_retries: u32,
        pub(crate) recursive: bool,
        pub(crate) retry_delay: c_uint,
    }
    impl RmDir<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            Self::from_js_impl(ctx, arguments, false)
        }
        /// `strict_booleans` selects node's `validateRmOptions` behavior (used by
        /// `fs.rm`): a present-but-`undefined` `recursive`/`force` is a type
        /// error. `fs.rmdir` treats `undefined` as absent.
        fn from_js_impl(
            ctx: &JSGlobalObject,
            arguments: &mut ArgumentsSlice,
            strict_booleans: bool,
        ) -> JsResult<Self> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let mut recursive = false;
            let mut force = false;
            let mut max_retries: u32 = 0;
            let mut retry_delay: c_uint = 100;
            if let Some(val) = arguments.next() {
                arguments.eat();
                if val.is_object() {
                    let get_option = |name: &'static str| -> JsResult<Option<JSValue>> {
                        if strict_booleans {
                            let key = bun_core::String::borrow_utf8(name.as_bytes());
                            val.get_own(ctx, &key)
                        } else {
                            val.get(ctx, name)
                        }
                    };
                    if let Some(boolean) = get_option("recursive")? {
                        if boolean.is_boolean() {
                            recursive = boolean.to_boolean();
                        } else {
                            return Err(ctx.throw_invalid_arguments(format_args!(
                                "The \"options.recursive\" property must be of type boolean."
                            )));
                        }
                    }
                    if let Some(boolean) = get_option("force")? {
                        if boolean.is_boolean() {
                            force = boolean.to_boolean();
                        } else {
                            return Err(ctx.throw_invalid_arguments(format_args!(
                                "The \"options.force\" property must be of type boolean."
                            )));
                        }
                    }
                    if let Some(delay) = get_option("retryDelay")? {
                        retry_delay = c_uint::try_from(validators::validate_integer(
                            ctx,
                            delay,
                            "options.retryDelay",
                            Some(0),
                            Some(c_uint::MAX as i64),
                        )?)
                        .expect("infallible: validated range");
                    }
                    if let Some(retries) = get_option("maxRetries")? {
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
    pub struct Mkdir<'a> {
        pub path: PathLike<'a>,
        /// Indicates whether parent folders should be created.
        /// If a folder was created, the path to the first created folder will be returned.
        /// @default false
        pub(crate) recursive: bool,
        /// A file mode. If a string is passed, it is parsed as an octal integer. If not specified
        pub(crate) mode: Mode,
        /// If set to true, the return value is never set to a string
        pub(crate) always_return_none: bool,
    }
    impl Mkdir<'_> {
        pub(crate) const DEFAULT_MODE: Mode = 0o777;
    }
    impl Default for Mkdir<'_> {
        fn default() -> Self {
            Self {
                path: PathLike::default(),
                recursive: false,
                mode: Self::DEFAULT_MODE,
                always_return_none: false,
            }
        }
    }
    impl Mkdir<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
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
                // Node branches on `typeof options === 'object'`, so a `String`
                // wrapper is an options bag (the block above), never a positional
                // mode; the string-like `is_string()` would route it through both.
                if val.is_number() || val.is_string_literal() {
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

    pub struct MkdirTemp<'a> {
        pub(crate) prefix: PathLike<'a>,
        pub(crate) encoding: Encoding,
    }
    impl MkdirTemp<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
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

    pub struct Readdir<'a> {
        pub path: PathLike<'a>,
        pub(crate) encoding: Encoding,
        pub(crate) with_file_types: bool,
        pub(crate) recursive: bool,
    }
    impl Readdir<'_> {
        pub(crate) fn tag(&self) -> ret::ReaddirTag {
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
    }
    impl Readdir<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
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
        pub(crate) fd: FD,
    }
    impl Close {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Close> {
            let fd = FD::from_js_required(ctx, arguments)?;
            Ok(Close { fd })
        }
    }

    pub struct Open<'a> {
        pub path: PathLike<'a>,
        pub(crate) flags: FileSystemFlags,
        pub(crate) mode: Mode,
    }
    impl Open<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let path = PathLike::from_js_required(ctx, arguments, "path")?;
            let mut flags = FileSystemFlags::R;
            let mut mode: Mode = DEFAULT_PERMISSION;
            if let Some(val) = arguments.next() {
                arguments.eat();
                if !val.is_empty() {
                    if !val.is_undefined_or_null() {
                        // Node has no options-object form here: the second argument is
                        // always the flags, so `{}` is an invalid flags value.
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
    pub(crate) type Utimes<'a> = Lutimes<'a>;

    pub struct Futimes {
        pub(crate) fd: FD,
        pub(crate) atime: TimeLike,
        pub(crate) mtime: TimeLike,
    }
    impl Futimes {
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
    /// It is not safe to use `fs.write()` multiple times on the same file without waiting
    /// for the callback. For this scenario, {@link createWriteStream} is
    /// recommended.
    ///
    /// On Linux, positional writes don't work when the file is opened in append mode.
    /// The kernel ignores the position argument and always appends the data to
    /// the end of the file.
    /// @since v0.0.2
    pub struct Write<'a> {
        pub(crate) fd: FD,
        pub(crate) buffer: StringOrBuffer<'a>,
        // pub buffer_val: JSValue,
        pub offset: u64,
        pub(crate) length: u64,
        pub(crate) position: Option<ReadPosition>,
        pub(crate) encoding: Encoding,
    }
    impl Default for Write<'_> {
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
    impl Write<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let fd = FD::from_js_required(ctx, arguments)?;
            let buffer_value = arguments.next();
            let bv = buffer_value
                .ok_or_else(|| ctx.throw_invalid_arguments(format_args!("data is required")))?;
            let flavor = if arguments.will_be_async {
                Flavor::Async
            } else {
                Flavor::Sync
            };
            let buffer =
                StringOrBuffer::from_js_maybe_async(ctx, bv, flavor, StringObjects::Allow)?
                    .ok_or_else(|| {
                        ctx.throw_invalid_argument_type_value(
                            b"buffer",
                            b"string or TypedArray",
                            bv,
                        )
                    })?;
            if bv.is_string() && !bv.is_string_literal() {
                return Err(ctx.throw_invalid_argument_type_value(
                    b"buffer",
                    b"string or TypedArray",
                    bv,
                ));
            }
            let encoding = match buffer {
                StringOrBuffer::Buffer(_) | StringOrBuffer::PinnedBuffer(_) => Encoding::Buffer,
                _ => Encoding::Utf8,
            };
            // `Drop for StringOrBuffer`
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
                    StringOrBuffer::Buffer(_) | StringOrBuffer::PinnedBuffer(_) => {
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
                        // Node bounds `offset` by the buffer whether or not a
                        // `length` follows (`length` defaults to the rest).
                        let buf_len = args.buffer.slice().len();
                        let max_offset = buf_len as i64;
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
                        let Some(next) = arguments.next() else {
                            break 'parse;
                        };
                        current = next;
                        if !(current.is_number() || current.is_big_int()) {
                            break 'parse;
                        }
                        let length = current.to_int64();
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
                        if let Some(position @ 0..) = i52::offset_from_js(current) {
                            args.position = Some(position);
                        }
                        arguments.eat();
                    }
                    // fs.write(fd, string[, position[, encoding]], callback)
                    _ => {
                        if let Some(position @ 0..) = i52::offset_from_js(current) {
                            args.position = Some(position);
                        }
                        // Node consumes the position slot whatever its type
                        // (null, undefined, a non-number); the encoding is
                        // strictly the next argument.
                        arguments.eat();
                        let Some(next) = arguments.next() else {
                            break 'parse;
                        };
                        current = next;
                        if current.is_string() {
                            args.encoding = Encoding::assert(current, ctx, args.encoding)?;
                            arguments.eat();
                            // `bv` was converted to UTF-8 before the encoding
                            // argument was parsed; re-encode it now. Node
                            // treats the "buffer" encoding name as UTF-8 here.
                            if !matches!(args.encoding, Encoding::Utf8 | Encoding::Buffer) {
                                if let Some(encoded) =
                                    StringOrBuffer::from_js_with_encoding_maybe_async(
                                        ctx,
                                        bv,
                                        args.encoding,
                                        flavor,
                                        StringObjects::Allow,
                                    )?
                                {
                                    args.buffer = encoded;
                                }
                            }
                        }
                    }
                }
            }
            Ok(args)
        }
    }

    /// `fs.read`'s target: borrowed for a sync call, pinned and rooted for an async one.
    pub(crate) enum ReadBuffer {
        Buffer(ArrayBuffer),
        PinnedBuffer(PinnedArrayBuffer),
    }
    impl core::ops::Deref for ReadBuffer {
        type Target = ArrayBuffer;
        #[inline]
        fn deref(&self) -> &ArrayBuffer {
            match self {
                Self::Buffer(buffer) => buffer,
                Self::PinnedBuffer(buffer) => buffer,
            }
        }
    }

    pub struct Read {
        pub(crate) fd: FD,
        pub(crate) buffer: ReadBuffer,
        pub offset: u64,
        pub(crate) length: u64,
        pub(crate) position: Option<ReadPosition>,
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
            let buffer = buffer_value.as_array_buffer(ctx).ok_or_else(|| {
                ctx.throw_invalid_argument_type_value(b"buffer", b"TypedArray", buffer_value)
            })?;
            let buffer = if arguments.will_be_async {
                ReadBuffer::PinnedBuffer(
                    PinnedArrayBuffer::root(ctx, buffer_value)
                        .ok_or_else(|| ctx.throw_out_of_memory())?,
                )
            } else {
                ReadBuffer::Buffer(buffer)
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
            // Negative `length_int` must fall through to the `< 0` arm
            // below. Guard the `as usize` cast so it doesn't wrap-to-huge here.
            if length_int > 0 && length_int as usize > buf_len {
                return Err(ctx.throw_range_error(
                    length_float,
                    bun_jsc::RangeErrorOptions {
                        field_name: b"length",
                        max: buf_len as i64,
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
                    let position_bytes = position.to_string(ctx)?.to_owned_slice();
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
    pub struct ReadFile<'a> {
        pub path: PathOrFileDescriptor<'a>,
        pub(crate) encoding: Encoding,
        pub offset: BlobSizeType,
        pub(crate) max_size: Option<BlobSizeType>,
        pub(crate) limit_size_for_javascript: bool,
        pub(crate) flag: FileSystemFlags,
        pub(crate) signal: Option<AbortSignalRef>,
    }
    impl Default for ReadFile<'_> {
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
    impl Drop for ReadFile<'_> {
        fn drop(&mut self) {
            // Release the AbortSignal ref taken in `from_js`.
            if let Some(signal) = self.signal.take() {
                signal.pending_activity_unref();
            }
        }
    }
    impl ReadFile<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            // `Drop` on `path` covers every
            // `?`-propagated JsError below.
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
                        flag = FileSystemFlags::from_js(ctx, flag_)?.unwrap_or(flag);
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
    }
    impl ReadFile<'_> {
        pub(crate) fn aborted(&self) -> bool {
            if let Some(signal) = &self.signal {
                return signal.aborted();
            }
            false
        }
    }

    pub struct WriteFile<'a> {
        pub(crate) flag: FileSystemFlags,
        pub(crate) mode: Mode,
        pub(crate) file: PathOrFileDescriptor<'a>,
        pub flush: bool,
        /// Encoded at the time of construction.
        pub(crate) data: StringOrBuffer<'a>,
        pub(crate) dirfd: FD,
        pub(crate) signal: Option<AbortSignalRef>,
    }
    impl Drop for WriteFile<'_> {
        fn drop(&mut self) {
            // Release the AbortSignal ref taken in `from_js`.
            if let Some(signal) = self.signal.take() {
                signal.pending_activity_unref();
            }
        }
    }
    impl WriteFile<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            Self::from_js_with_default_flag(ctx, arguments, FileSystemFlags::W)
        }
        pub(crate) fn from_js_with_default_flag(
            ctx: &JSGlobalObject,
            arguments: &mut ArgumentsSlice,
            default_flag: FileSystemFlags,
        ) -> JsResult<Self> {
            // `Drop` on `path` covers every
            // `?`-propagated JsError below.
            let path = PathOrFileDescriptor::from_js(ctx, arguments)?.ok_or_else(|| {
                ctx.throw_invalid_arguments(format_args!(
                    "path must be a string or a file descriptor"
                ))
            })?;
            let data_value = arguments
                .next_eat()
                .ok_or_else(|| ctx.throw_invalid_arguments(format_args!("data is required")))?;
            let mut encoding = Encoding::Buffer;
            let mut flag = default_flag;
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
                        flag = FileSystemFlags::from_js(ctx, flag_)?.unwrap_or(flag);
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
            let flavor = if arguments.will_be_async {
                Flavor::Async
            } else {
                Flavor::Sync
            };
            // String objects not allowed (typeof new String("hi") === "object")
            // https://github.com/nodejs/node/blob/6f946c95b9da75c70e868637de8161bc8d048379/lib/internal/fs/utils.js#L916
            let data = StringOrBuffer::from_js_with_encoding_maybe_async(ctx, data_value, encoding, flavor, StringObjects::Reject)?
                .ok_or_else(|| validators::throw_err_invalid_arg_type_with_message(ctx, format_args!("The \"data\" argument must be of type string or an instance of Buffer, TypedArray, or DataView")))?;
            let abort_signal = scopeguard::ScopeGuard::into_inner(abort_signal);
            Ok(WriteFile {
                file: path,
                flag,
                mode,
                data,
                dirfd: FD::cwd(),
                signal: abort_signal,
                flush,
            })
        }
    }
    impl WriteFile<'_> {
        pub(crate) fn aborted(&self) -> bool {
            if let Some(signal) = &self.signal {
                return signal.aborted();
            }
            false
        }
    }

    /// Same fields as `WriteFile`; distinct type so `FsArgument::from_js` can
    /// default `flag` to `a` (Node: `if (!options.flag) options.flag = 'a'`)
    /// while still honoring an explicit `flag` the caller passed.
    pub struct AppendFile<'a>(pub(crate) WriteFile<'a>);

    pub struct Exists<'a> {
        pub path: Option<PathLike<'a>>,
    }
    impl Exists<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            Ok(Exists {
                path: PathLike::from_js(ctx, arguments)?,
            })
        }
    }

    pub struct Access<'a> {
        pub path: PathLike<'a>,
        pub(crate) mode: FileSystemFlags,
    }
    impl Access<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
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
        pub(crate) fd: FD,
    }
    impl FdataSync {
        pub fn from_js(
            ctx: &JSGlobalObject,
            arguments: &mut ArgumentsSlice,
        ) -> JsResult<FdataSync> {
            let fd = FD::from_js_required(ctx, arguments)?;
            Ok(FdataSync { fd })
        }
    }

    pub struct CopyFile<'a> {
        pub(crate) src: PathLike<'a>,
        pub(crate) dest: PathLike<'a>,
        pub(crate) mode: constants::Copyfile,
    }
    impl CopyFile<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let src = PathLike::from_js_required(ctx, arguments, "src")?;
            // `Drop for PathLike` runs on early return.
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

    #[derive(Copy, Clone, Default)]
    pub struct CpFlags {
        pub(crate) recursive: bool,
        pub(crate) error_on_exist: bool,
        pub(crate) force: bool,
    }

    pub struct Cp<'a> {
        pub(crate) src: PathLike<'a>,
        pub(crate) dest: PathLike<'a>,
        pub(crate) flags: CpFlags,
    }
    impl Cp<'static> {
        pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
            let src = PathLike::from_js_required(ctx, arguments, "src")?;
            // `Drop for PathLike` runs on early return.
            let dest = PathLike::from_js_required(ctx, arguments, "dest")?;
            let mut recursive = false;
            let mut error_on_exist = false;
            let mut force = true;
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
                    arg.coerce::<i32>(ctx)?;
                }
            }
            Ok(Cp {
                src,
                dest,
                flags: CpFlags {
                    recursive,
                    error_on_exist,
                    force,
                },
            })
        }

        /// `fs.cp(src, dest)` of Rust-owned bytes, for a work-pool job.
        pub fn owned(src: Vec<u8>, dest: Vec<u8>, flags: CpFlags) -> ThreadIsolated<Self> {
            // SAFETY: owned paths only.
            unsafe {
                ThreadIsolated::new(Cp {
                    src: PathLike::owned(src),
                    dest: PathLike::owned(dest),
                    flags,
                })
            }
        }
    }

    pub(crate) type Watch<'a> = super::Watcher::Arguments<'a>;
    // `StatWatcher::Arguments` owns its `PathLike` (no borrowed slice), so it
    // has no lifetime parameter — unlike `Watcher::Arguments<'a>` above.
    pub(crate) type WatchFile = super::StatWatcher::Arguments;

    pub struct Fsync {
        pub(crate) fd: FD,
    }
    impl Fsync {
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
    Stats(Box<Stats>),
    NotFound,
}
impl StatOrNotFound {
    pub(crate) fn to_js_newly_created(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
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
    fn into_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            StringOrUndefined::String(s) => s.into_js(global_object),
            StringOrUndefined::None => Ok(JSValue::UNDEFINED),
        }
    }
}

/// A path or file-contents result built off-thread: an already-encoded
/// string, or bytes that become a node `Buffer` on the JS thread.
pub enum StringOrBytes {
    String(Utf8WithString),
    Bytes(Box<[u8]>),
}
impl StringOrBytes {
    #[inline]
    pub fn string(s: BunString) -> Self {
        Self::String(Utf8WithString::js_only(s))
    }
    pub fn into_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            StringOrBytes::String(s) => s.into_js(global_object),
            StringOrBytes::Bytes(bytes) => {
                bun_jsc::MarkedArrayBuffer::from_owned_bytes(bytes, bun_jsc::JSType::Uint8Array)
                    .to_node_buffer(global_object)
            }
        }
    }
}

/// For use in `Return`'s definitions to act as `void` while returning `null` to JavaScript
pub struct Null;

pub mod ret {
    use super::*;

    pub(crate) type Access = Null;
    pub(crate) type AppendFile = ();
    pub type Close = ();
    pub(crate) type CopyFile = ();
    pub type Cp = ();
    pub(crate) type Exists = bool;
    pub(crate) type Fchmod = ();
    pub(crate) type Chmod = ();
    pub(crate) type Fchown = ();
    pub(crate) type Fdatasync = ();
    pub(crate) type Fstat = Stats;
    pub(crate) type Rm = ();
    pub(crate) type Fsync = ();
    pub(crate) type Ftruncate = ();
    pub(crate) type Futimes = ();
    pub(crate) type Lchmod = ();
    pub(crate) type Lchown = ();
    pub(crate) type Link = ();
    pub(crate) type Lstat = StatOrNotFound;
    pub(crate) type Mkdir = StringOrUndefined;
    pub(crate) type Mkdtemp = StringOrBytes;
    pub(crate) type Open = FD;
    pub(crate) type WriteFile = ();
    pub(crate) type Readv = Read;
    pub(crate) type StatFS = node::StatFS;

    pub struct Read {
        pub(crate) bytes_read: u64, /* u52 */
    }
    impl Read {
        pub fn to_js(&self, _: &JSGlobalObject) -> JSValue {
            JSValue::js_number_from_uint64(self.bytes_read)
        }
    }

    pub struct Write {
        pub(crate) bytes_written: u64, /* u52 */
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
        /// Entry names as bytes; each becomes a node `Buffer` in `to_js`.
        Buffers(Box<[Box<[u8]>]>),
        Files(Box<[BunString]>),
    }
    impl Readdir {
        pub fn to_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            match self {
                Readdir::WithFileTypes(items) => {
                    let array = JSValue::create_empty_array(global_object, items.len())?;
                    let mut previous_jsstring: *mut bun_jsc::JSString = core::ptr::null_mut();
                    for (i, item) in items.into_vec().into_iter().enumerate() {
                        let res = item.into_js(global_object, Some(&mut previous_jsstring))?;
                        array.put_index(global_object, i as u32, res)?;
                    }
                    Ok(array)
                }
                Readdir::Buffers(mut items) => {
                    // Node returns `Buffer[]` for `{ encoding: "buffer" }`, not
                    // `Uint8Array[]`. Ownership of every entry's bytes
                    // transfers to JSC via `to_node_buffer`; the boxed slice
                    // itself is freed when `items` drops.
                    let array = JSValue::create_empty_array(global_object, items.len())?;
                    for (i, item) in items.iter_mut().enumerate() {
                        let res = bun_jsc::MarkedArrayBuffer::from_owned_bytes(
                            core::mem::take(item),
                            bun_jsc::JSType::Uint8Array,
                        )
                        .to_node_buffer(global_object)?;
                        array.put_index(global_object, i as u32, res)?;
                    }
                    Ok(array)
                }
                Readdir::Files(items) => {
                    // Converted to a JS array, then every element is
                    // deref'd and the slice freed (handled by the `FromAny
                    // for Box<[bun_core::String]>` impl).
                    JSValue::from_any(global_object, items)
                }
            }
        }
    }

    pub(crate) type ReadFile = StringOrBuffer<'static>;
    /// What `fs.promises.readFile` carries back from the pool: never the
    /// JSC-heap buffer the sync path can produce, so it is `Send`.
    pub(crate) type ReadFileOffThread = StringOrBytes;

    pub(crate) enum ReadFileWithOptions {
        String(Box<[u8]>),
        TranscodedString(BunString),
        /// File contents to hand to JS as a `Buffer`.
        Bytes(Box<[u8]>),
        /// `Flavor::Sync` with a VM only: the contents already copied into a
        /// JSC-heap buffer (kept alive by the caller's stack until returned).
        JsBuffer(Buffer),
        NullTerminated(bun_core::ZBox), // [:0]const u8 owned
    }

    pub(crate) type Readlink = StringOrBytes;
    pub(crate) type Realpath = StringOrBytes;
    pub(crate) type Rename = ();
    pub(crate) type Rmdir = ();
    pub(crate) type Stat = StatOrNotFound;
    pub(crate) type Symlink = ();
    pub(crate) type Truncate = ();
    pub(crate) type Unlink = ();
    pub(crate) type Watch = JSValue;
    pub(crate) type WatchFile = JSValue;
    pub(crate) type Utimes = ();
    pub(crate) type Chown = ();
    pub(crate) type Lutimes = ();
    pub(crate) type Writev = Write;
}

// ──────────────────────────────────────────────────────────────────────────
// NodeFS — Bun's implementation of the Node.js "fs" module
// https://nodejs.org/api/fs.html
// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/fs.d.ts
// ──────────────────────────────────────────────────────────────────────────

// `#[repr(C)]` pins `sync_error_buf` (a `[u8; N]`, nominal align = 1) at
// offset 0. The struct's overall alignment is ≥ `align_of::<*const ()>()`
// (from the `vm` field), so the buffer's address inherits that alignment.
// This is load-bearing on Windows where `sync_error_buf` is reinterpreted as
// `&mut [u16]` / `&mut WPathBuffer` by the `os_path_kernel32` callers
// (`bytemuck` checks the alignment at runtime).
#[repr(C)]
pub struct NodeFS {
    /// Buffer to store a temporary file path that might appear in a returned error message.
    ///
    /// We want to avoid allocating a new path buffer for every error message so that jsc can clone + GC it.
    /// That means a stack-allocated buffer won't suffice. Instead, we re-use
    /// the heap allocated buffer on the NodeFS struct
    pub(crate) sync_error_buf: PathBuffer, // must be align_of::<u16>()-aligned — enforced via #[repr(C)] + field order, see above
    /// The VM whose `fs` binding owns this (the sync path); `None` for the
    /// pool's and other ad-hoc instances.
    pub(crate) vm: Option<bun_ptr::BackRef<VirtualMachine>>,
}

impl Default for NodeFS {
    fn default() -> Self {
        Self {
            sync_error_buf: PathBuffer::uninit(),
            vm: None,
        }
    }
}

/// Encode a path returned by the OS (`mkdtemp`/`readlink`/`realpath`) using the
/// caller's `encoding` option, matching Node.js: `"buffer"` yields a `Buffer`
/// of the raw bytes, any other encoding is `Buffer.from(bytes).toString(enc)`.
fn encode_path_result(bytes: &[u8], encoding: Encoding) -> StringOrBytes {
    match encoding {
        Encoding::Buffer => StringOrBytes::Bytes(bytes.into()),
        Encoding::Utf8 => StringOrBytes::string(BunString::clone_utf8(bytes)),
        enc => StringOrBytes::string(webcore::encoding::to_bun_string(bytes, enc)),
    }
}

impl NodeFS {
    pub(crate) fn access(&mut self, args: &args::Access, _: Flavor) -> Maybe<ret::Access> {
        if let Some(graph) = standalone_module_graph() {
            let p = args.path.slice();
            let is_dir = graph.find_dir(p);
            if is_dir || graph.contains_file(p) {
                let mode = args.mode.as_int();
                if (mode & sys::posix::W_OK) != 0 || ((mode & sys::posix::X_OK) != 0 && !is_dir) {
                    return Err(sys::Error::from_code(E::EACCES, sys::Tag::access).with_path(p));
                }
                return Ok(Null);
            }
        }
        // The `bun_sys::access` Windows
        // arm takes `&ZStr` and performs the kernel32 widening internally
        // (sys/lib.rs `windows_impl::access`), so feed it the UTF-8 path on
        // every platform.
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

    pub(crate) fn append_file(
        &mut self,
        args: &args::AppendFile,
        _: Flavor,
    ) -> Maybe<ret::AppendFile> {
        let args = &args.0;
        let mut data = args.data.slice();
        match &args.file {
            PathOrFileDescriptor::Fd(fd) => {
                while !data.is_empty() {
                    let written = Syscall::write(*fd, data)?;
                    data = &data[written..];
                }
                Ok(())
            }
            PathOrFileDescriptor::Path(path_) => {
                let path = path_.slice_z(&mut self.sync_error_buf);
                let fd = Syscall::open(path, args.flag.as_int(), args.mode)?;
                let _close = scopeguard::guard(fd, |fd| fd.close());
                while !data.is_empty() {
                    let written = Syscall::write(fd, data)?;
                    data = &data[written..];
                }
                Ok(())
            }
        }
    }

    pub fn close(&mut self, args: &args::Close, _: Flavor) -> Maybe<ret::Close> {
        // Explicit `fs.close`/`fs.closeSync` must close the descriptor the user
        // asked for, including stdio (0/1/2), and surface EBADF like Node does.
        // The stdio guard only applies to Bun's own internal closes.
        if let Some(err) = args.fd.close_allowing_standard_io(None) {
            Err(err)
        } else {
            Ok(())
        }
    }

    #[cfg(windows)]
    pub(crate) fn uv_close(
        &mut self,
        args: &args::Close,
        rc: uv::ReturnCodeI64,
    ) -> Maybe<ret::Close> {
        if let Some(err) = rc.to_error(sys::Tag::close) {
            return Err(err.with_fd(args.fd));
        }
        Ok(())
    }

    // since we use a 64 KB stack buffer, we should not let this function get inlined
    #[inline(never)]
    #[cfg(not(windows))]
    pub(crate) fn copy_file_using_read_write_loop(
        src: &ZStr,
        dest: &ZStr,
        src_fd: FD,
        dest_fd: FD,
        stat_size: usize,
        wrote: &mut u64,
    ) -> Maybe<ret::CopyFile> {
        // Kernel-side fast paths have already bailed; double the readahead
        // window for the sequential read()s below. Best-effort.
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        {
            let _ = sys::posix_fadvise(src_fd, 0, 0, libc::POSIX_FADV_SEQUENTIAL);
        }

        // The slab stays uninitialised (write-only: `read` fills it from the
        // kernel and hands back the filled prefix). Zero-filling it was a
        // debug-build hot path.
        const STACK_BUF_LEN: usize = 64 * 1024;
        let mut stack_buf = bun_core::vec::UninitBuf::<STACK_BUF_LEN>::uninit();
        let mut buf_to_free: Vec<u8> = Vec::new();
        let mut buf: &mut [core::mem::MaybeUninit<u8>] = stack_buf.as_uninit_mut();

        'maybe_allocate_large_temp_buf: {
            if stat_size > STACK_BUF_LEN * 16 {
                // Don't allocate more than 8 MB at a time
                let clamped_size: usize = stat_size.min(8 * 1024 * 1024);
                if buf_to_free.try_reserve_exact(clamped_size).is_err() {
                    break 'maybe_allocate_large_temp_buf;
                }
                buf = buf_to_free.spare_capacity_mut();
            }
        }
        // buf_to_free dropped at scope exit

        let mut remain = stat_size as u64;
        // VERIFY-FIX(round1): the
        // `if remain == 0` check below was wrong: `break 'toplevel` after
        // `remain` had already saturated to 0 would still enter the else. Track
        // an explicit `broke` flag instead.
        let mut broke = false;
        'toplevel: while remain > 0 {
            let read_len = (buf.len() as u64).min(remain) as usize;
            let filled: &[u8] = match sys::read_uninit(src_fd, &mut buf[..read_len]) {
                Ok(result) => result,
                Err(err) => {
                    return Err(if !src.is_empty() {
                        err.with_path(src)
                    } else {
                        err
                    });
                }
            };
            let amt = filled.len();
            // 0 == EOF
            if amt == 0 {
                broke = true;
                break 'toplevel;
            }
            *wrote += amt as u64;
            remain = remain.saturating_sub(amt as u64);

            let mut slice = filled;
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
                let filled: &[u8] = match sys::read_uninit(src_fd, buf) {
                    Ok(result) => result,
                    Err(err) => {
                        return Err(if !src.is_empty() {
                            err.with_path(src)
                        } else {
                            err
                        });
                    }
                };
                let amt = filled.len();
                // we don't know the size
                // so we just go forever until we get an EOF
                if amt == 0 {
                    break;
                }
                *wrote += amt as u64;

                let mut slice = filled;
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
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) fn copy_file_using_sendfile_on_linux_with_read_write_fallback(
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

    pub(crate) fn copy_file(&mut self, args: &args::CopyFile, _: Flavor) -> Maybe<ret::CopyFile> {
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
                    // There are no early returns between open(dest) and the
                    // `copy_file_using_read_write_loop` call, so inlining the
                    // cleanup after it is equivalent.
                    let mut wrote: u64 = 0;
                    if args.mode.shouldnt_overwrite() {
                        flags |= sys::O::EXCL;
                    }

                    let dest_fd = match Syscall::open(dest, flags, stat_.st_mode as Mode) {
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
            let dest_fd = match Syscall::open(dest, flags, stat_.st_mode as Mode) {
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
            // fd types.
            'cfr: loop {
                // No offsets so the kernel advances the file's seek position, keeping the
                // read/write fallback (which uses the seek position) coherent if we ever
                // break mid-loop.
                let rc: isize = sys::freebsd::copy_file_range_fd(
                    src_fd,
                    None,
                    dest_fd,
                    None,
                    (i32::MAX - 1) as usize,
                    0,
                ) as isize;
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

            let src_fd = Syscall::open(src, sys::O::RDONLY, 0o644)?;
            let _close_src = scopeguard::guard(src_fd, |fd| fd.close());

            let stat_ = Syscall::fstat(src_fd)?;

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
            // by reference while the loops `get`/`set`, so the value observed at
            // scope-exit time is the final one.
            let wrote: core::cell::Cell<u64> = core::cell::Cell::new(0);
            if args.mode.shouldnt_overwrite() {
                flags |= sys::O::EXCL;
            }

            let dest_fd = Syscall::open(dest, flags, stat_.st_mode as Mode)?;

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
                    let written = sys::linux::copy_file_range_fd(
                        src_fd,
                        Some(&mut off_in_copy),
                        dest_fd,
                        Some(&mut off_out_copy),
                        sys::page_size(),
                        0,
                    );
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
                    let written = sys::linux::copy_file_range_fd(
                        src_fd,
                        Some(&mut off_in_copy),
                        dest_fd,
                        Some(&mut off_out_copy),
                        size,
                        0,
                    );
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
            // Paths whose UTF-16 form exceeds the wide buffers can't exist on
            // disk; reject instead of overflowing the conversion below.
            for path in [&args.src, &args.dest] {
                if !strings::fits_in_wide_path_buffer(path.slice()) {
                    return Err(sys::Error {
                        errno: E::ENAMETOOLONG as _,
                        syscall: sys::Tag::copyfile,
                        path: path.slice().into(),
                        ..Default::default()
                    });
                }
            }
            let mut dest_buf = paths::os_path_buffer_pool::get();
            let src = strings::to_kernel32_path(
                bun_core::cast_slice_mut::<u8, u16>(&mut self.sync_error_buf),
                args.src.slice(),
            );
            let dest = strings::to_kernel32_path(&mut *dest_buf, args.dest.slice());
            if !windows::copy_file(src, dest, args.mode.shouldnt_overwrite()) {
                return Self::should_ignore_ebusy(
                    &args.src,
                    &args.dest,
                    Err(sys::Error::from_win32(
                        windows::Win32Error::get(),
                        sys::Tag::copyfile,
                    )),
                );
            }
            return Ok(());
        }

        #[cfg(not(any(
            target_os = "macos",
            target_os = "freebsd",
            target_os = "linux",
            target_os = "android",
            windows
        )))]
        unreachable!()
    }

    pub(crate) fn exists(&mut self, args: &args::Exists, _: Flavor) -> Maybe<ret::Exists> {
        // NOTE: exists cannot return an error
        let Some(path) = &args.path else {
            return Ok(false);
        };

        if let Some(graph) = standalone_module_graph() {
            if graph.contains_file(path.slice()) || graph.find_dir(path.slice()) {
                return Ok(true);
            }
        }

        let slice = if path.slice().is_empty() {
            os_path_literal_empty()
        } else {
            match path.os_path_kernel32(&mut self.sync_error_buf) {
                Ok(p) => p,
                // Over PATH_MAX_WIDE — such a path can't exist on disk.
                Err(NameTooLong) => return Ok(false),
            }
        };

        Ok(sys::exists_os_path(slice, false))
    }

    pub(crate) fn chown(&mut self, args: &args::Chown, _: Flavor) -> Maybe<ret::Chown> {
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
        #[cfg(not(windows))]
        {
            let path = args.path.slice_z(&mut self.sync_error_buf);
            Syscall::chown(path, args.uid, args.gid)
        }
    }

    pub(crate) fn chmod(&mut self, args: &args::Chmod, _: Flavor) -> Maybe<ret::Chmod> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        #[cfg(windows)]
        {
            return match Syscall::chmod(path, args.mode) {
                Err(err) => Err(err.with_path(args.path.slice())),
                Ok(res) => Ok(res),
            };
        }
        #[cfg(not(windows))]
        match Syscall::chmod(path, args.mode) {
            Err(err) => Err(err.with_path(args.path.slice())),
            Ok(_) => Ok(()),
        }
    }

    pub(crate) fn fchmod(&mut self, args: &args::FChmod, _: Flavor) -> Maybe<ret::Fchmod> {
        Syscall::fchmod(args.fd, args.mode)
    }

    pub(crate) fn fchown(&mut self, args: &args::Fchown, _: Flavor) -> Maybe<ret::Fchown> {
        Syscall::fchown(args.fd, args.uid, args.gid)
    }

    pub(crate) fn fdatasync(&mut self, args: &args::FdataSync, _: Flavor) -> Maybe<ret::Fdatasync> {
        #[cfg(windows)]
        {
            return Syscall::fdatasync(args.fd);
        }
        #[cfg(not(windows))]
        {
            Maybe::<ret::Fdatasync>::errno_sys_fd(
                sys::safe_libc::fdatasync(args.fd.native()),
                sys::Tag::fdatasync,
                args.fd,
            )
            .unwrap_or(Ok(()))
        }
    }

    pub(crate) fn fstat(&mut self, args: &args::Fstat, _: Flavor) -> Maybe<ret::Fstat> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
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

    pub(crate) fn fsync(&mut self, args: &args::Fsync, _: Flavor) -> Maybe<ret::Fsync> {
        #[cfg(windows)]
        {
            return Syscall::fsync(args.fd);
        }
        #[cfg(not(windows))]
        {
            Maybe::<ret::Fsync>::errno_sys(sys::safe_libc::fsync(args.fd.native()), sys::Tag::fsync)
                .unwrap_or(Ok(()))
        }
    }

    pub(crate) fn ftruncate(&mut self, args: &args::FTruncate, _: Flavor) -> Maybe<ret::Ftruncate> {
        Syscall::ftruncate(args.fd, args.len.unwrap_or(0) as i64)
    }

    pub(crate) fn futimes(&mut self, args: &args::Futimes, _: Flavor) -> Maybe<ret::Futimes> {
        #[cfg(windows)]
        {
            return sys::sys_uv::futime(args.fd, args.atime, args.mtime);
        }
        #[cfg(not(windows))]
        match Syscall::futimens(
            args.fd,
            to_sys_time_like(args.atime),
            to_sys_time_like(args.mtime),
        ) {
            // `err.syscall` must be node's operation name, not `futimens(2)`.
            Err(mut err) => {
                err.syscall = sys::Tag::futime;
                Err(err)
            }
            Ok(_) => Ok(()),
        }
    }

    pub(crate) fn lchmod(&mut self, args: &args::LCHmod, _: Flavor) -> Maybe<ret::Lchmod> {
        #[cfg(windows)]
        {
            let _ = args;
            return Err(sys::Error::todo());
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

    pub(crate) fn lchown(&mut self, args: &args::LChown, _: Flavor) -> Maybe<ret::Lchown> {
        // On Windows `Syscall::lchown` routes through uv_fs_lchown, which is
        // a no-op success, matching Node.
        let path = args.path.slice_z(&mut self.sync_error_buf);
        match Syscall::lchown(path, args.uid, args.gid) {
            Err(err) => Err(err.with_path(args.path.slice())),
            Ok(_) => Ok(()),
        }
    }

    pub(crate) fn link(&mut self, args: &args::Link, _: Flavor) -> Maybe<ret::Link> {
        let mut to_buf = PathBuffer::uninit();
        let from = args.old_path.slice_z(&mut self.sync_error_buf);
        let to = args.new_path.slice_z(&mut to_buf);
        match Syscall::link(from, to) {
            Err(err) => Err(err.with_path_dest(args.old_path.slice(), args.new_path.slice())),
            Ok(result) => Ok(result),
        }
    }

    pub(crate) fn lstat(&mut self, args: &args::Lstat, _: Flavor) -> Maybe<ret::Lstat> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        if let Some(graph) = standalone_module_graph() {
            if let Some(result) = graph.stat(path.as_bytes()) {
                return Ok(StatOrNotFound::Stats(Box::new(Stats::init(
                    &PosixStat::init(&result),
                    args.big_int,
                ))));
            }
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if sys::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
            return match sys::lstatx(path, sys::STATX_MASK_FOR_STATS) {
                Ok(result) => Ok(StatOrNotFound::Stats(Box::new(Stats::init(
                    &result,
                    args.big_int,
                )))),
                Err(err) => {
                    if !args.throw_if_no_entry && err.get_errno() == E::ENOENT {
                        return Ok(StatOrNotFound::NotFound);
                    }
                    Err(err.with_path(args.path.slice()))
                }
            };
        }
        match Syscall::lstat(path) {
            Ok(result) => Ok(StatOrNotFound::Stats(Box::new(Stats::init(
                &PosixStat::init(&result),
                args.big_int,
            )))),
            Err(err) => {
                if !args.throw_if_no_entry && err.get_errno() == E::ENOENT {
                    return Ok(StatOrNotFound::NotFound);
                }
                Err(err.with_path(args.path.slice()))
            }
        }
    }

    pub(crate) fn mkdir(&mut self, args: &args::Mkdir, _: Flavor) -> Maybe<ret::Mkdir> {
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
    pub(crate) fn mkdir_non_recursive(&mut self, args: &args::Mkdir) -> Maybe<ret::Mkdir> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        match Syscall::mkdir(path, args.mode) {
            Ok(_) => Ok(StringOrUndefined::None),
            Err(err) => Err(err.with_path(args.path.slice())),
        }
    }

    pub(crate) fn mkdir_recursive(&mut self, args: &args::Mkdir) -> Maybe<ret::Mkdir> {
        self.mkdir_recursive_impl::<()>(args, &())
    }

    pub(crate) fn mkdir_recursive_impl<Ctx: MkdirCtx>(
        &mut self,
        args: &args::Mkdir,
        ctx: &Ctx,
    ) -> Maybe<ret::Mkdir> {
        let mut buf = paths::path_buffer_pool::get();
        let path = match args.path.os_path_kernel32(&mut *buf) {
            Ok(p) => p,
            Err(NameTooLong) => {
                return Err(sys::Error {
                    errno: E::ENAMETOOLONG as _,
                    syscall: sys::Tag::mkdir,
                    path: args.path.slice().into(),
                    ..Default::default()
                });
            }
        };
        if args.always_return_none {
            self.mkdir_recursive_os_path_impl::<Ctx, false>(ctx, path, args.mode)
        } else {
            self.mkdir_recursive_os_path_impl::<Ctx, true>(ctx, path, args.mode)
        }
    }

    pub(crate) fn mkdir_recursive_os_path(
        &mut self,
        path: &OSPathSliceZ,
        mode: Mode,
        return_path: bool,
    ) -> Maybe<ret::Mkdir> {
        if return_path {
            self.mkdir_recursive_os_path_impl::<(), true>(&(), path, mode)
        } else {
            self.mkdir_recursive_os_path_impl::<(), false>(&(), path, mode)
        }
    }

    pub(crate) fn mkdir_recursive_os_path_impl<Ctx: MkdirCtx, const RETURN_PATH: bool>(
        &mut self,
        ctx: &Ctx,
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
                                .os_path_into_sync_error_buf(without_nt_prefix(&path[..]))
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
                                        .os_path_into_sync_error_buf(without_nt_prefix(&path[..]))
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

        let mut working_mem = paths::os_path_buffer_pool::get();
        let working_mem: &mut OSPathBuffer = &mut working_mem;
        working_mem[..len as usize].copy_from_slice(&(&path[..])[..len as usize]);

        let mut i: u16 = len - 1;

        // iterate backwards until creating the directory works successfully
        while i > 0 {
            if bun_paths::is_sep_native_t::<OSPathChar>((&path[..])[i as usize]) {
                working_mem[i as usize] = 0;
                let parent = OSPathSliceZ::from_buf(&working_mem[..], i as usize);
                match mkdir_os_path(parent, mode) {
                    Err(err) => {
                        // The SEP-restore must NOT happen before the errno match:
                        // `OSPathSliceZ` (`WStr`/`ZStr`) carries a hard
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
                                            return Err(sys::Error {
                                                errno: E::ENOTDIR as _,
                                                syscall: sys::Tag::mkdir,
                                                path: self
                                                    .os_path_into_sync_error_buf(without_nt_prefix(
                                                        &(&path[..])[..len as usize],
                                                    ))
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
                                return Err(err.with_path(
                                    self.os_path_into_sync_error_buf(without_nt_prefix(
                                        &parent[..],
                                    )),
                                ));
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
                let parent = OSPathSliceZ::from_buf(&working_mem[..], i as usize);
                match mkdir_os_path(parent, mode) {
                    Err(err) => {
                        working_mem[i as usize] = paths::SEP as OSPathChar;
                        match err.get_errno() {
                            // handle the race condition
                            E::EEXIST => {}
                            // NOENT shouldn't happen here
                            _ => {
                                return Err(err.with_path(
                                    self.os_path_into_sync_error_buf(without_nt_prefix(&path[..])),
                                ));
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
        let final_ = OSPathSliceZ::from_buf(&working_mem[..], len as usize);
        match mkdir_os_path(final_, mode) {
            Err(err) => match err.get_errno() {
                E::EEXIST => {}
                _ => {
                    return Err(err.with_path(
                        self.os_path_into_sync_error_buf(without_nt_prefix(&path[..])),
                    ));
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

    pub(crate) fn mkdtemp(&mut self, args: &args::MkdirTemp, _: Flavor) -> Maybe<ret::Mkdtemp> {
        let prefix_buf = &mut self.sync_error_buf;
        let prefix_slice = args.prefix.slice();
        // Node rejects an empty prefix with EINVAL (its snprintf builds a
        // five-X template here); otherwise we'd create a random dir in cwd.
        if prefix_slice.is_empty() {
            return Err(sys::Error {
                errno: SystemErrno::EINVAL as _,
                syscall: sys::Tag::mkdtemp,
                path: [b'X'; 5].into(),
                ..Default::default()
            });
        }
        let len = prefix_slice.len().min(prefix_buf.len().saturating_sub(7));
        prefix_buf[..len].copy_from_slice(&prefix_slice[..len]);
        prefix_buf[len..len + 6].copy_from_slice(b"XXXXXX");
        prefix_buf[len + 6] = 0;

        // The created name is written back over the template in `prefix_buf`.
        match sys::mkdtemp(&mut prefix_buf[..]) {
            Ok(n) => Ok(encode_path_result(&prefix_buf[..n], args.encoding)),
            Err(err) => Err(sys::Error {
                errno: err.errno,
                syscall: sys::Tag::mkdtemp,
                path: prefix_buf[..len + 6].into(),
                ..Default::default()
            }),
        }
    }

    pub(crate) fn open(&mut self, args: &args::Open, _: Flavor) -> Maybe<ret::Open> {
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

    #[cfg(windows)]
    pub(crate) fn uv_open(&mut self, args: &args::Open, rc: uv::ReturnCodeI64) -> Maybe<ret::Open> {
        if let Some(err) = rc.to_error(sys::Tag::open) {
            return Err(err.with_path(args.path.slice()));
        }
        Ok(FD::from_uv(rc.to_fd()))
    }

    #[cfg(windows)]
    pub(crate) fn uv_statfs(
        &mut self,
        args: &args::StatFS,
        req: &uv::fs_t,
        rc: uv::ReturnCodeI64,
    ) -> Maybe<ret::StatFS> {
        if let Some(err) = rc.to_error(sys::Tag::statfs) {
            return Err(err.with_path(args.path.slice()));
        }
        // `rc >= 0` ⇒ libuv populated `req.ptr` with a `uv_statfs_t`
        // (= `RawStatFS` on Windows); copied out before cleanup frees it.
        let statfs_: super::statfs::RawStatFS =
            req.statfs_result().expect("uv_fs_statfs succeeded");
        Ok(ret::StatFS::init(&statfs_, args.big_int))
    }

    fn read_inner(&mut self, args: &args::Read) -> Maybe<ret::Read> {
        debug_assert!(args.position.is_none());
        // `ArrayBuffer` is a `Copy` descriptor over JSC-owned heap bytes; copy the
        // descriptor locally and use the existing safe `byte_slice_mut` accessor
        // instead of rebuilding a `&mut [u8]` from a `&[u8]` borrow by hand.
        let mut view = *args.buffer;
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
        let mut view = *args.buffer;
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

    pub(crate) fn read(&mut self, args: &args::Read, _: Flavor) -> Maybe<ret::Read> {
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

    #[cfg(windows)]
    pub(crate) fn uv_read(&mut self, args: &args::Read, rc: uv::ReturnCodeI64) -> Maybe<ret::Read> {
        if let Some(err) = rc.to_error(sys::Tag::read) {
            return Err(err.with_fd(args.fd));
        }
        Ok(ret::Read {
            bytes_read: rc.int() as u64,
        })
    }

    #[cfg(windows)]
    pub(crate) fn uv_readv(
        &mut self,
        args: &args::Readv,
        rc: uv::ReturnCodeI64,
    ) -> Maybe<ret::Readv> {
        if let Some(err) = rc.to_error(sys::Tag::readv) {
            return Err(err.with_fd(args.fd));
        }
        Ok(ret::Readv {
            bytes_read: rc.int() as u64,
        })
    }

    pub(crate) fn readv(&mut self, args: &args::Readv, _: Flavor) -> Maybe<ret::Readv> {
        if args.buffers.buffers.is_empty() {
            return Ok(ret::Readv { bytes_read: 0 });
        }
        if args.position.is_some() {
            self.preadv_inner(args)
        } else {
            self.readv_inner(args)
        }
    }

    pub(crate) fn writev(&mut self, args: &args::Writev, _: Flavor) -> Maybe<ret::Writev> {
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

    #[cfg(windows)]
    pub(crate) fn uv_write(
        &mut self,
        args: &args::Write,
        rc: uv::ReturnCodeI64,
    ) -> Maybe<ret::Write> {
        if let Some(err) = rc.to_error(sys::Tag::write) {
            return Err(err.with_fd(args.fd));
        }
        Ok(ret::Write {
            bytes_written: rc.int() as u64,
        })
    }

    #[cfg(windows)]
    pub(crate) fn uv_writev(
        &mut self,
        args: &args::Writev,
        rc: uv::ReturnCodeI64,
    ) -> Maybe<ret::Writev> {
        if let Some(err) = rc.to_error(sys::Tag::writev) {
            return Err(err.with_fd(args.fd));
        }
        Ok(ret::Writev {
            bytes_written: rc.int() as u64,
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
        let bufs = args.buffers.buffers.as_slice();
        // libuv `uv__fs_read`: cap `nbufs` at IOV_MAX and issue one syscall.
        let bufs = &bufs[..bufs.len().min(IOV_MAX)];
        match Syscall::preadv(args.fd, bufs, position as i64) {
            Err(err) => Err(err),
            Ok(amt) => Ok(ret::Readv {
                bytes_read: amt as u64,
            }),
        }
    }

    fn readv_inner(&mut self, args: &args::Readv) -> Maybe<ret::Readv> {
        let bufs = args.buffers.buffers.as_slice();
        // libuv `uv__fs_read`: cap `nbufs` at IOV_MAX and issue one syscall.
        let bufs = &bufs[..bufs.len().min(IOV_MAX)];
        match Syscall::readv(args.fd, bufs) {
            Err(err) => Err(err),
            Ok(amt) => Ok(ret::Readv {
                bytes_read: amt as u64,
            }),
        }
    }

    fn pwritev_inner(&mut self, args: &args::Writev) -> Maybe<ret::Write> {
        let mut position = args.position.unwrap() as i64;
        // The kernel never writes through `iov_base` for pwritev(2).
        let vecs: &[sys::PlatformIoVecConst] = sys::iovecs_as_const(&args.buffers.buffers);
        // libuv `uv__fs_write_all`: loop IOV_MAX-sized batches until every
        // buffer is written; an error after the first batch returns the
        // accumulated total instead of the error.
        let mut remaining = vecs;
        let mut total: u64 = 0;
        while !remaining.is_empty() {
            let chunk_len = remaining.len().min(IOV_MAX);
            let chunk = &remaining[..chunk_len];
            match Syscall::pwritev(args.fd, chunk, position) {
                Err(err) if total == 0 => return Err(err),
                Err(_) => break,
                Ok(0) => break,
                Ok(amt) => {
                    total += amt as u64;
                    position = position.wrapping_add(amt as i64);
                    let chunk_capacity: usize = chunk.iter().map(|b| b.len as usize).sum();
                    if amt < chunk_capacity {
                        break;
                    }
                    remaining = &remaining[chunk_len..];
                }
            }
        }
        Ok(ret::Write {
            bytes_written: total,
        })
    }

    fn writev_inner(&mut self, args: &args::Writev) -> Maybe<ret::Write> {
        // The mutable iovec slice doubles as `iovec_const` for writev(2); the kernel
        // never writes through `iov_base`. `PlatformIoVec` and
        // `PlatformIoVecConst` are layout-identical (`{ *void, usize }`), so
        // pass the slice through `Syscall::writev` as-is.
        // libuv `uv__fs_write_all`: loop IOV_MAX-sized batches until every
        // buffer is written; an error after the first batch returns the
        // accumulated total instead of the error.
        let mut remaining = args.buffers.buffers.as_slice();
        let mut total: u64 = 0;
        while !remaining.is_empty() {
            let chunk_len = remaining.len().min(IOV_MAX);
            let chunk = &remaining[..chunk_len];
            match Syscall::writev(args.fd, chunk) {
                Err(err) if total == 0 => return Err(err),
                Err(_) => break,
                Ok(0) => break,
                Ok(amt) => {
                    total += amt as u64;
                    let chunk_capacity: usize = chunk.iter().map(sys::platform_iovec_len).sum();
                    if amt < chunk_capacity {
                        break;
                    }
                    remaining = &remaining[chunk_len..];
                }
            }
        }
        Ok(ret::Write {
            bytes_written: total,
        })
    }

    pub(crate) fn readdir(&mut self, args: &args::Readdir, flavor: Flavor) -> Maybe<ret::Readdir> {
        if flavor != Flavor::Sync && args.recursive {
            debug_assert!(
                standalone_module_graph().is_some()
                    && bun_standalone_graph::is_bun_standalone_file_path(args.path.slice()),
                "async recursive readdir must go through AsyncReaddirRecursiveTask"
            );
        }
        let maybe = match args.tag() {
            ret::ReaddirTag::Buffers => Self::readdir_inner::<Box<[u8]>>(
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
        // On Windows, String/Dirent results read native UTF-16 entry names via the
        // wide iterator so surrogate pairs survive; Buffer results (and all POSIX)
        // use the u8 iterator.
        #[cfg(windows)]
        if T::IS_U16 {
            return Self::readdir_with_entries_u16::<T>(args, fd, basename, entries);
        }

        let mut dirent_path = BunString::DEAD;

        let mut iterator = DirIterator::WrappedIterator::init(fd);
        loop {
            let current = match iterator.next() {
                Err(err) => return Err(err.with_path(args.path.slice())),
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
                match sys::lstatat(fd, current.name_assume_z()) {
                    Ok(st) => sys::kind_from_mode(st.st_mode as Mode),
                    Err(_) => current.kind,
                }
            } else {
                current.kind
            };
            T::append_entry(entries, utf8_name, &dirent_path, kind, args.encoding);
        }

        Ok(())
    }

    /// Windows UTF-16 arm of `readdir_with_entries`.
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

        // Only allocated when the requested encoding isn't
        // utf8: the wide name is transcoded to UTF-8 first (matching libuv) and
        // then re-encoded.
        let mut re_encoding_buffer = if args.encoding != Encoding::Utf8 {
            Some(paths::path_buffer_pool::get())
        } else {
            None
        };

        loop {
            let current = match iterator.next() {
                Err(err) => return Err(err.with_path(args.path.slice())),
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
            // The u16 Dirent arm uses `current.kind`
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

        Ok(())
    }

    /// Gone or not enterable since the parent listed it. Reading a gone directory gives ENOENT too.
    fn readdir_skips_subdir(errno: E) -> bool {
        matches!(errno, E::ENOENT | E::ENOTDIR | E::EPERM)
    }

    pub(crate) fn readdir_with_entries_recursive_async<T: ReaddirEntry>(
        buf: &mut PathBuffer,
        async_task: &std::sync::Arc<ReaddirScan>,
        basename: &ZStr,
        entries: &mut Vec<T>,
        is_root: bool,
    ) -> Maybe<()> {
        // `root_path` is NUL-terminated (`[path.., 0]`); the basename
        // excludes the trailing NUL.
        let root_basename: &[u8] = &async_task.root_path[..async_task.root_path.len() - 1];
        #[cfg(not(windows))]
        let flags = sys::O::DIRECTORY | sys::O::RDONLY;
        let atfd = if is_root {
            FD::cwd()
        } else {
            async_task.root_fd.get()
        };
        #[cfg(not(windows))]
        let open_res = Syscall::openat(atfd, basename, flags, 0);
        #[cfg(windows)]
        // the plain Windows open wrapper does not pass iterable=true
        let open_res = sys::open_dir_at_windows_a(
            atfd,
            basename.as_bytes(),
            sys::WindowsOpenDirOptions {
                no_follow: true,
                iterable: true,
                ..Default::default()
            },
        );
        let fd = match open_res {
            Err(err) => {
                if !is_root {
                    if Self::readdir_skips_subdir(err.get_errno()) {
                        return Ok(());
                    }
                    if root_basename.len() + 1 + basename.as_bytes().len() + 1
                        < paths::MAX_PATH_BYTES
                    {
                        let joined = paths::resolve_path::join_z_buf::<paths::platform::Auto>(
                            &mut buf[..],
                            &[root_basename, basename.as_bytes()],
                        );
                        return Err(err.with_path(joined.as_bytes()));
                    }
                }
                return Err(err.with_path(root_basename));
            }
            Ok(fd_) => fd_,
        };

        if is_root {
            async_task.root_fd.set(fd);
        }
        let _close = scopeguard::guard((fd, is_root), |(fd, is_root)| {
            if !is_root {
                fd.close();
            }
        });

        let mut iterator = DirIterator::WrappedIterator::init(fd);
        let mut dirent_path_prev = BunString::EMPTY;
        let mut spill: Vec<u8> = Vec::new();
        let mut dirent_spill: Vec<u8> = Vec::new();

        loop {
            let current = match iterator.next() {
                Ok(Some(ent)) => ent,
                Ok(None) => break,
                Err(err) if !is_root && Self::readdir_skips_subdir(err.get_errno()) => break,
                Err(err) => {
                    if !is_root
                        && root_basename.len() + 1 + basename.as_bytes().len() + 1
                            < paths::MAX_PATH_BYTES
                    {
                        let joined = paths::resolve_path::join_z_buf::<paths::platform::Auto>(
                            &mut buf[..],
                            &[root_basename, basename.as_bytes()],
                        );
                        return Err(err.with_path(joined.as_bytes()));
                    }
                    return Err(err.with_path(root_basename));
                }
            };
            let utf8_name = current.name.slice();

            // The root subtask's basename *is* root_path; the caller passes
            // `is_root` explicitly.
            let name_to_copy_z: &ZStr = if is_root {
                current.name_assume_z()
            } else {
                paths::resolve_path::join_z_buf_spill::<paths::platform::Auto>(
                    &mut buf[..],
                    &mut spill,
                    &[basename.as_bytes(), utf8_name],
                )
            };
            let name_to_copy: &[u8] = name_to_copy_z.as_bytes();

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
                        match sys::lstatat(fd, current.name_assume_z()) {
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
                let joined = paths::resolve_path::join_spill::<paths::platform::Auto>(
                    &mut dirent_spill,
                    &[root_basename, name_to_copy],
                );
                let path_u8 = paths::resolve_path::dirname::<paths::platform::Auto>(joined);
                if dirent_path_prev.is_empty() || dirent_path_prev.byte_slice() != path_u8 {
                    dirent_path_prev = BunString::clone_utf8(path_u8);
                }
            }
            // async path: uses raw `BunString::clone_utf8` — do not apply encoding.
            T::append_entry_recursive(
                entries,
                utf8_name,
                name_to_copy,
                &dirent_path_prev,
                effective_kind,
                async_task.encoding,
                false,
            );
        }

        Ok(())
    }

    fn readdir_with_entries_recursive_sync<T: ReaddirEntry>(
        buf: &mut PathBuffer,
        args: &args::Readdir,
        root_basename: &ZStr,
        entries: &mut Vec<T>,
    ) -> Maybe<()> {
        use std::collections::VecDeque;
        // PERF: VecDeque<Vec<u8>> heap-allocates from the
        // first push. Revisit with `smallvec`/arena once profiled.
        let mut stack: VecDeque<Vec<u8>> = VecDeque::new();
        // Sentinel: an empty item means "root" (handled below).
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
        let root_fd: &mut FD = *_close_root;
        // The close guard captures `&mut root_fd`, so all reads below go
        // through the same place.

        let mut spill: Vec<u8> = Vec::new();
        let mut dirent_spill: Vec<u8> = Vec::new();

        while let Some(item) = stack.pop_front() {
            let is_root = first_is_root && item.is_empty();
            first_is_root = false;
            // basename: root_basename for the first iteration, else the queued
            // relative path (NUL-terminated by construction).
            // `item` is an owned Vec<u8> dropped at end-of-loop. Exclude the
            // trailing NUL we appended at the push site so the join below sees
            // clean bytes.
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
                        errno if Self::readdir_skips_subdir(errno) => continue,
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
                    Ok(Some(ent)) => ent,
                    Ok(None) => break,
                    Err(err) if !is_root && Self::readdir_skips_subdir(err.get_errno()) => break,
                    Err(err) => {
                        return Err(err.with_path(args.path.slice()));
                    }
                };
                let utf8_name = current.name.slice();

                let name_to_copy: &[u8] = if is_root {
                    utf8_name
                } else {
                    paths::resolve_path::join_z_buf_spill::<paths::platform::Auto>(
                        &mut buf[..],
                        &mut spill,
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
                            // Store with trailing NUL so the next iteration can
                            // hand it to `openat` as a `&ZStr`.
                            let mut owned = Vec::with_capacity(name_to_copy.len() + 1);
                            owned.extend_from_slice(name_to_copy);
                            owned.push(0);
                            stack.push_back(owned);
                        }
                        // Some filesystems (e.g., Docker bind mounts, FUSE, NFS) return
                        // DT_UNKNOWN for d_type. Use lstatat to determine the actual type.
                        sys::FileKind::Unknown => {
                            if utf8_name.len() + 1 + name_to_copy.len() > paths::MAX_PATH_BYTES { break 'enqueue; }
                            match sys::lstatat(fd, current.name_assume_z()) {
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
                    let joined = paths::resolve_path::join_spill::<paths::platform::Auto>(
                        &mut dirent_spill,
                        &[root_basename.as_bytes(), name_to_copy],
                    );
                    let path_u8 = paths::resolve_path::dirname::<paths::platform::Auto>(joined);
                    if dirent_path_prev.is_empty() || dirent_path_prev.byte_slice() != path_u8 {
                        dirent_path_prev = webcore::encoding::to_bun_string(
                            without_nt_prefix::<u8>(path_u8),
                            encoding_to_node(args.encoding),
                        );
                    }
                }
                // sync path: uses `webcore::encoding::to_bun_string(.., args.encoding)`.
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

        if let Some(graph) = standalone_module_graph() {
            if bun_standalone_graph::is_bun_standalone_file_path(path.as_bytes()) {
                return Self::readdir_standalone::<T>(
                    graph,
                    path.as_bytes(),
                    args,
                    recursive,
                    flavor,
                );
            }
        }

        if recursive && flavor == Flavor::Sync {
            let mut buf_to_pass = PathBuffer::uninit();
            let mut entries: Vec<T> = Vec::new();
            return Self::readdir_with_entries_recursive_sync::<T>(
                &mut buf_to_pass,
                args,
                path,
                &mut entries,
            )
            .map(|()| T::into_readdir(entries));
        }

        if recursive {
            panic!(
                "This code path should never be reached. It should only go through readdirWithEntriesRecursiveAsync."
            );
        }

        #[cfg(not(windows))]
        let flags = sys::O::DIRECTORY | sys::O::RDONLY;
        #[cfg(not(windows))]
        let open_res = Syscall::open(path, flags, 0);
        #[cfg(windows)]
        let open_res = sys::open_dir_at_windows_a(
            FD::cwd(),
            path.as_bytes(),
            sys::WindowsOpenDirOptions {
                iterable: true,
                ..Default::default()
            },
        );
        let fd = match open_res {
            Err(err) => return Err(err.with_path(args.path.slice())),
            Ok(fd_) => fd_,
        };
        let _close = scopeguard::guard(fd, |fd| fd.close());

        let mut entries: Vec<T> = Vec::new();
        Self::readdir_with_entries::<T>(args, fd, path, &mut entries)
            .map(|()| T::into_readdir(entries))
    }

    /// Caller has already checked `is_bun_standalone_file_path(path)`.
    fn readdir_standalone<T: ReaddirEntry>(
        graph: &bun_standalone_graph::Graph,
        path: &[u8],
        args: &args::Readdir,
        recursive: bool,
        flavor: Flavor,
    ) -> Maybe<ret::Readdir> {
        let Some(list) = graph.readdir(path, recursive) else {
            let code = if graph.contains_file(path) {
                E::ENOTDIR
            } else {
                E::ENOENT
            };
            return Err(sys::Error::from_code(code, sys::Tag::scandir).with_path(args.path.slice()));
        };

        let mut entries: Vec<T> = Vec::with_capacity(list.len());
        let input_path = args.path.slice();
        let root_path = if T::IS_DIRENT {
            BunString::clone_utf8(input_path)
        } else {
            BunString::EMPTY
        };
        let mut joined: Vec<u8> = Vec::new();
        #[allow(unused_mut)]
        for (mut name, is_dir) in list {
            let kind = if is_dir {
                sys::FileKind::Directory
            } else {
                sys::FileKind::File
            };
            if recursive {
                #[cfg(windows)]
                for b in name.iter_mut() {
                    if *b == b'/' {
                        *b = paths::SEP;
                    }
                }
                let (base, parent) = match strings::last_index_of_char(&name, paths::SEP) {
                    Some(i) => (&name[i + 1..], &name[..i]),
                    None => (&name[..], b"".as_slice()),
                };
                let joined_path;
                let dirent_path = if T::IS_DIRENT && !parent.is_empty() {
                    joined.clear();
                    joined.extend_from_slice(input_path);
                    if !matches!(joined.last(), Some(&b'/') | Some(&b'\\')) {
                        joined.push(paths::SEP);
                    }
                    joined.extend_from_slice(parent);
                    joined_path = BunString::clone_utf8(&joined);
                    &joined_path
                } else {
                    &root_path
                };
                T::append_entry_recursive(
                    &mut entries,
                    base,
                    &name,
                    dirent_path,
                    kind,
                    args.encoding,
                    flavor == Flavor::Sync,
                );
            } else {
                T::append_entry(&mut entries, &name, &root_path, kind, args.encoding);
            }
        }
        Ok(T::into_readdir(entries))
    }

    pub(crate) fn read_file(
        &mut self,
        args: &args::ReadFile,
        flavor: Flavor,
    ) -> Maybe<ret::ReadFile> {
        match self.read_file_with_options(args, flavor, ReadFileStringType::Default)? {
            ret::ReadFileWithOptions::JsBuffer(buffer) => Ok(StringOrBuffer::Buffer(buffer)),
            ret::ReadFileWithOptions::Bytes(bytes) => Ok(StringOrBuffer::Buffer(
                bun_jsc::MarkedArrayBuffer::from_owned_bytes(bytes, bun_jsc::JSType::Uint8Array),
            )),
            string => Ok(StringOrBuffer::String(Utf8WithString::js_only(
                Self::read_file_string(args, string)?,
            ))),
        }
    }

    /// [`read_file`](Self::read_file) with a `Send` result: what
    /// `fs.promises.readFile` runs on the pool (no VM there, so never the
    /// JSC-heap buffer case).
    pub(crate) fn read_file_off_thread(
        &mut self,
        args: &args::ReadFile,
        flavor: Flavor,
    ) -> Maybe<ret::ReadFileOffThread> {
        match self.read_file_with_options(args, flavor, ReadFileStringType::Default)? {
            ret::ReadFileWithOptions::Bytes(bytes) => Ok(StringOrBytes::Bytes(bytes)),
            string => Ok(StringOrBytes::string(Self::read_file_string(args, string)?)),
        }
    }

    /// The string cases of a `ReadFileStringType::Default` read, encoded per
    /// `args.encoding`.
    fn read_file_string(
        args: &args::ReadFile,
        result: ret::ReadFileWithOptions,
    ) -> Maybe<BunString> {
        match result {
            ret::ReadFileWithOptions::TranscodedString(str) => {
                if str.is_dead() {
                    return Err(with_path_like(
                        sys::Error::from_code(E::ENOMEM, sys::Tag::read),
                        &args.path,
                    ));
                }
                Ok(str)
            }
            ret::ReadFileWithOptions::String(s) => {
                let str = if s.is_empty() {
                    BunString::EMPTY
                } else {
                    webcore::encoding::to_bun_string_from_owned_slice(s.into_vec(), args.encoding)
                };
                if str.is_dead() {
                    return Err(with_path_like(
                        sys::Error::from_code(E::ENOMEM, sys::Tag::read),
                        &args.path,
                    ));
                }
                Ok(str)
            }
            _ => unreachable!(),
        }
    }

    pub(crate) fn read_file_with_options(
        &mut self,
        args: &args::ReadFile,
        flavor: Flavor,
        string_type: ReadFileStringType,
    ) -> Maybe<ret::ReadFileWithOptions> {
        let path_is_path = matches!(args.path, PathOrFileDescriptor::Path(_));
        let fd_maybe_windows: FD = match &args.path {
            PathOrFileDescriptor::Path(p) => {
                let path = p.slice_z(&mut self.sync_error_buf);

                if let Some(graph) = standalone_module_graph() {
                    if let Some(file) = graph.find_ref(path.as_bytes()) {
                        let contents: &[u8] = file.utf8_contents();
                        return if args.encoding == Encoding::Buffer {
                            Ok(ret::ReadFileWithOptions::Bytes(contents.into()))
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
                    if graph.find_dir(path.as_bytes()) {
                        return Err(
                            sys::Error::from_code(E::EISDIR, sys::Tag::read).with_path(p.slice())
                        );
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
        // The sync case claims the per-VM pipe-read scratch when it is free;
        // otherwise (async, no VM, or a read further up the stack holds it)
        // a heap buffer stands in. It stays uninitialised: it is write-only,
        // `Syscall::read` hands it straight to the kernel.
        let vm = self.vm;
        let mut scratch = match &vm {
            Some(vm) if flavor == Flavor::Sync => {
                vm.get().as_mut().rare_data().pipe_read_scratch.claim()
            }
            _ => None,
        };
        let mut heap_buffer: Vec<u8> = Vec::new();
        if scratch.is_none() {
            let _ = heap_buffer.try_reserve_exact(256 * 1024);
        }
        let max_len = args.max_size.map_or(usize::MAX, |v| v as usize);
        let temporary_read_buffer_before_stat_call: &[u8] = match scratch.as_mut() {
            Some(scratch) => {
                let pre_stat_len = scratch.len().min(max_len);
                let pre_stat_buf = &mut scratch[..pre_stat_len];
                let mut filled = 0usize;
                while filled < pre_stat_buf.len() {
                    let amt = Syscall::read(fd, &mut pre_stat_buf[filled..])?;
                    if amt == 0 {
                        did_succeed = true;
                        break;
                    }
                    total += amt;
                    filled += amt;
                }
                &pre_stat_buf[..total]
            }
            None => {
                let pre_stat_len = heap_buffer.capacity().min(max_len);
                while heap_buffer.len() < pre_stat_len {
                    let want = pre_stat_len - heap_buffer.len();
                    let amt = sys::read_into_vec(fd, &mut heap_buffer, want)?;
                    if amt == 0 {
                        did_succeed = true;
                        break;
                    }
                    total += amt;
                }
                &heap_buffer[..]
            }
        };

        if did_succeed {
            return match args.encoding {
                Encoding::Buffer => {
                    if flavor == Flavor::Sync && string_type == ReadFileStringType::Default {
                        if let Some(vm) = vm {
                            // Attempt to create the buffer in JSC's heap.
                            // This avoids creating a WastefulTypedArray.
                            // `self.vm` is the live owning `VirtualMachine` (per-thread singleton) — `BackRef` invariant holds.
                            let global = vm.global();
                            let Ok(array_buffer) = bun_jsc::ArrayBuffer::create_buffer(
                                global,
                                temporary_read_buffer_before_stat_call,
                            ) else {
                                // OOM / a termination request: that JS exception
                                // is pending and wins — the binding's `throw_value`
                                // yields to it and drops this errno.
                                return Err(with_path_like(
                                    sys::Error::from_code(E::ENOMEM, sys::Tag::read),
                                    &args.path,
                                ));
                            };
                            array_buffer.ensure_still_alive();
                            return match array_buffer.as_array_buffer(global) {
                                Some(buffer) => Ok(ret::ReadFileWithOptions::JsBuffer(
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
                    Ok(ret::ReadFileWithOptions::Bytes(
                        temporary_read_buffer_before_stat_call.into(),
                    ))
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

        let stat_ = Syscall::fstat(fd)?;

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
        // Read into the uninitialised spare capacity (`buf.len() == total`
        // throughout). `Vec::resize(cap, 0)` is *not* equivalent in debug
        // builds: it goes through `extend_with`'s byte-by-byte loop (no memset
        // specialisation), which dominated `readFileSync` of large files.

        // Two-phase read: first up to `size`, then keep going until EOF.
        // `phase == 0` is the size-bounded loop, `phase == 1` is the unbounded tail.
        let mut phase: u8 = if (total as u64) < size { 0 } else { 1 };
        loop {
            if args.aborted() {
                return Err(abort_err());
            }
            // When `total == min(buf.capacity, max_size)`
            // the next read receives an empty slice → returns 0 → `did_succeed = true; break`.
            // Do NOT pre-grow here; growth happens only in the `total > size && amt != 0 &&
            // !has_max_size` arm below.
            let upper = (buf.capacity() as u64).min(max_size) as usize;
            let amt = sys::read_into_vec(fd, &mut buf, upper.saturating_sub(total))?;
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
                // `buf.len() == total` here, so this grows by (amortised) 8 KiB
                // rather than doubling from a stale `len == capacity` (a >256 KB
                // FIFO / proc file would otherwise balloon to multi-GB RSS).
                if buf.try_reserve(8192).is_err() {
                    return Err(with_path_like(
                        sys::Error::from_code(E::ENOMEM, sys::Tag::read),
                        &args.path,
                    ));
                }
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
        let _ = phase; // silence the unused-assignment lint on the final phase value

        let final_len = if string_type == ReadFileStringType::NullTerminated {
            total + 1
        } else {
            total
        };
        if total == 0 {
            drop(buf);
            return match args.encoding {
                Encoding::Buffer => Ok(ret::ReadFileWithOptions::Bytes(Box::default())),
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
        let _ = did_succeed; // `buf` is dropped on every error-return above.

        match args.encoding {
            Encoding::Buffer => {
                buf.truncate(final_len);
                Ok(ret::ReadFileWithOptions::Bytes(buf.into_boxed_slice()))
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

    pub(crate) fn write_file_with_path_buffer(
        pathbuf: &mut PathBuffer,
        args: &args::WriteFile,
    ) -> Maybe<ret::WriteFile> {
        let fd = match &args.file {
            PathOrFileDescriptor::Path(p) => {
                let path = p.slice_z_with_force_copy::<true>(pathbuf);
                // O_TRUNC is dropped on purpose: keeping the existing blocks
                // allocated makes rewriting a large file cheaper, and the resize
                // below sets the final size. O_APPEND writes at EOF, so it keeps it.
                let mut flags = args.flag.as_int();
                if (flags & sys::O::APPEND) == 0 {
                    flags &= !sys::O::TRUNC;
                }
                match sys::openat(args.dirfd, path, flags, args.mode) {
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
        #[cfg(not(windows))]
        let mut written: usize = 0;

        // Attempt to pre-allocate large files
        // Worthwhile after 6 MB at least on ext4 linux
        if PREALLOCATE_SUPPORTED && buf.len() >= PREALLOCATE_LENGTH {
            'preallocate: {
                let is_path = matches!(args.file, PathOrFileDescriptor::Path(_));
                // Preallocating grows the file, so skip it when the kernel picks
                // the write offset at write() time: an O_APPEND write would land
                // after the grown end, leaving a hole where the data belongs.
                let appends = if is_path {
                    (args.flag.as_int() & sys::O::APPEND) != 0
                } else {
                    // `flag` is the option, not how the caller opened this fd.
                    match sys::get_fcntl_flags(fd) {
                        Ok(open_flags) => (open_flags as c_int & sys::O::APPEND) != 0,
                        Err(_) => break 'preallocate,
                    }
                };
                if appends {
                    break 'preallocate;
                }
                let offset: usize = if is_path {
                    0
                } else {
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

        // A write error is held back rather than returned, so the resize below
        // still runs: a partial write must not leave the old tail sitting behind
        // the bytes that did land.
        let mut write_err: Option<sys::Error> = None;
        while !buf.is_empty() {
            match sys::write(fd, buf) {
                Err(err) => {
                    write_err = Some(err);
                    break;
                }
                Ok(amt) => {
                    buf = &buf[amt..];
                    #[cfg(not(windows))]
                    {
                        written += amt;
                    }
                    if amt == 0 {
                        break;
                    }
                }
            }
        }

        // https://github.com/oven-sh/bun/issues/2931
        // https://github.com/oven-sh/bun/issues/10222
        // Resize only when the flags asked to truncate (the open above dropped
        // O_TRUNC): `r+` & co. overwrite in place, and Node never resizes a
        // descriptor it was handed.
        if (args.flag.as_int() & sys::O::TRUNC) != 0
            && matches!(args.file, PathOrFileDescriptor::Path(_))
        {
            // If this errors, we silently ignore it.
            // Not all files are seekable (and thus, not all files can be truncated).
            #[cfg(windows)]
            {
                let _ = windows::set_end_of_file(fd);
            }
            #[cfg(not(windows))]
            {
                let _ = Syscall::ftruncate(fd, (written as u64 & ((1u64 << 63) - 1)) as i64);
            }
        }

        if let Some(err) = write_err {
            return Err(err);
        }

        if args.flush {
            #[cfg(windows)]
            {
                let _ = windows::flush_file_buffers(fd);
            }
            #[cfg(not(windows))]
            {
                let _ = Syscall::fsync(fd);
            }
        }

        Ok(())
    }

    pub(crate) fn write_file(
        &mut self,
        args: &args::WriteFile,
        _: Flavor,
    ) -> Maybe<ret::WriteFile> {
        Self::write_file_with_path_buffer(&mut self.sync_error_buf, args)
    }

    pub(crate) fn readlink(&mut self, args: &args::Readlink, _: Flavor) -> Maybe<ret::Readlink> {
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
        if args.encoding == Encoding::Utf8 {
            if let PathLike::String(s) = &args.path {
                if strings::eql_long(s.slice(), link_path, true) {
                    return Ok(StringOrBytes::String(s.clone()));
                }
            }
        }
        Ok(encode_path_result(link_path, args.encoding))
    }

    pub(crate) fn realpath_non_native(
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

    pub(crate) fn realpath(&mut self, args: &args::Realpath, _: Flavor) -> Maybe<ret::Realpath> {
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
    pub(crate) fn realpath_inner(
        &mut self,
        args: &args::Realpath,
        variant: RealpathVariant,
    ) -> Maybe<ret::Realpath> {
        #[cfg(windows)]
        {
            let mut outbuf = paths::path_buffer_pool::get();
            let mut buf: &[u8] = match sys::sys_uv::realpath(
                args.path.slice_z(&mut self.sync_error_buf),
                &mut outbuf[..],
            ) {
                Ok(resolved) => resolved,
                Err(err) => return Err(err.with_path(args.path.slice())),
            };
            if variant == RealpathVariant::Emulated {
                // remove the trailing slash
                if buf.last() == Some(&b'\\') {
                    buf = &buf[..buf.len() - 1];
                }
            }
            if args.encoding == Encoding::Utf8 {
                if let PathLike::String(s) = &args.path {
                    if strings::eql_long(s.slice(), buf, true) {
                        return Ok(StringOrBytes::String(s.clone()));
                    }
                }
            }
            return Ok(encode_path_result(buf, args.encoding));
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
            let inbuf_len = inbuf.len();
            let Some(joined) = fs.abs_buf_checked(&parts, &mut inbuf[..inbuf_len - 1]) else {
                return Err(sys::Error {
                    errno: E::ENAMETOOLONG as _,
                    syscall: sys::Tag::realpath,
                    path: args.path.slice().into(),
                    ..Default::default()
                });
            };
            let path_len = joined.len();
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
            if args.encoding == Encoding::Utf8 {
                if let PathLike::String(s) = &args.path {
                    if strings::eql_long(s.slice(), buf, true) {
                        return Ok(StringOrBytes::String(s.clone()));
                    }
                }
            }
            Ok(encode_path_result(buf, args.encoding))
        }
    }

    pub(crate) fn rename(&mut self, args: &args::Rename, _: Flavor) -> Maybe<ret::Rename> {
        let from_buf = &mut self.sync_error_buf;
        let mut to_buf = PathBuffer::uninit();
        let from = args.old_path.slice_z(from_buf);
        let to = args.new_path.slice_z(&mut to_buf);
        match Syscall::rename(from, to) {
            Ok(result) => Ok(result),
            Err(err) => Err(err.with_path_dest(args.old_path.slice(), args.new_path.slice())),
        }
    }

    pub(crate) fn rmdir(&mut self, args: &args::RmDir, _: Flavor) -> Maybe<ret::Rmdir> {
        if args.recursive {
            // On Windows a rooted-but-driveless path ("/tmp/foo") must resolve
            // against the cwd drive.
            // Our dt_* helpers go through Syscall::*at → to_nt_path /
            // normalize_path_windows, which do NOT add the cwd drive, turning
            // "/tmp/foo" into a nonexistent NT name (ENOENT). Pre-resolve with
            // slice_z so the path already carries a drive letter, the same way
            // existsSync/statSync/unlinkSync see it.
            #[cfg(windows)]
            let resolved = args.path.slice_z(&mut self.sync_error_buf).as_bytes();
            #[cfg(not(windows))]
            let resolved = args.path.slice();
            if let Err(err) = zig_delete_tree(&sys::Dir::cwd(), resolved, sys::FileKind::Directory)
            {
                let mut errno: E = map_anyerror_to_errno(&err);
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
        #[cfg(not(windows))]
        match sys::posix_rmdir(args.path.slice_z(&mut self.sync_error_buf)) {
            Err(err) => Err(err.with_path(args.path.slice())),
            Ok(()) => Ok(()),
        }
    }

    pub(crate) fn rm(&mut self, args: &args::Rm, _: Flavor) -> Maybe<ret::Rm> {
        // We cannot use removefileat() on macOS because it does not handle write-protected files as expected.
        if args.recursive {
            // See the matching comment in `rmdir`: pre-resolve the path on
            // Windows so rooted-but-driveless paths ("/tmp/foo") get the cwd
            // drive prepended before reaching the dt_* / Syscall::*at helpers,
            // which do not do that themselves.
            #[cfg(windows)]
            let resolved = args.path.slice_z(&mut self.sync_error_buf).as_bytes();
            #[cfg(not(windows))]
            let resolved = args.path.slice();
            if let Err(err) = zig_delete_tree(&sys::Dir::cwd(), resolved, sys::FileKind::File) {
                if matches!(err, crate::Error::FileNotFound) {
                    if args.force {
                        return Ok(());
                    }
                    // Node reaches a missing path through the lstat() that
                    // validateRmOptions performs before removing anything, so the
                    // ENOENT it reports is tagged `lstat`, not `rm`.
                    return Err(sys::Error::from_code(E::ENOENT, sys::Tag::lstat)
                        .with_path(args.path.slice()));
                }
                return Err(sys::Error::from_code(
                    map_anyerror_to_errno_rm_tree(&err),
                    sys::Tag::rm,
                )
                .with_path(args.path.slice()));
            }
            return Ok(());
        }

        let dest = args.path.slice_z(&mut self.sync_error_buf);
        if let Err(err1) = sys::unlink(dest) {
            let e1 = err1.get_errno();
            if e1 == E::ENOENT {
                if args.force {
                    return Ok(());
                }
                // See the recursive branch: node's ENOENT for rm comes from the
                // lstat() in validateRmOptions.
                return Err(
                    sys::Error::from_code(E::ENOENT, sys::Tag::lstat).with_path(args.path.slice())
                );
            }
            return Err(sys::Error::from_code(map_rm_errno_narrow(e1), sys::Tag::rm)
                .with_path(args.path.slice()));
        }
        Ok(())
    }

    pub(crate) fn statfs(&mut self, args: &args::StatFS, _: Flavor) -> Maybe<ret::StatFS> {
        match Syscall::statfs(args.path.slice_z(&mut self.sync_error_buf)) {
            Ok(result) => Ok(ret::StatFS::init(&result, args.big_int)),
            Err(err) => Err(err),
        }
    }

    pub(crate) fn stat(&mut self, args: &args::Stat, _: Flavor) -> Maybe<ret::Stat> {
        let path = args.path.slice_z(&mut self.sync_error_buf);
        if let Some(graph) = standalone_module_graph() {
            if let Some(result) = graph.stat(path.as_bytes()) {
                return Ok(StatOrNotFound::Stats(Box::new(Stats::init(
                    &PosixStat::init(&result),
                    args.big_int,
                ))));
            }
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if sys::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
            return match sys::statx(path, sys::STATX_MASK_FOR_STATS) {
                Ok(result) => Ok(StatOrNotFound::Stats(Box::new(Stats::init(
                    &result,
                    args.big_int,
                )))),
                Err(err) => {
                    if !args.throw_if_no_entry && err.get_errno() == E::ENOENT {
                        return Ok(StatOrNotFound::NotFound);
                    }
                    Err(err.with_path(args.path.slice()))
                }
            };
        }
        match Syscall::stat(path) {
            Ok(result) => Ok(StatOrNotFound::Stats(Box::new(Stats::init(
                &PosixStat::init(&result),
                args.big_int,
            )))),
            Err(err) => {
                if !args.throw_if_no_entry && err.get_errno() == E::ENOENT {
                    return Ok(StatOrNotFound::NotFound);
                }
                Err(err.with_path(args.path.slice()))
            }
        }
    }

    pub(crate) fn symlink(&mut self, args: &args::Symlink, _: Flavor) -> Maybe<ret::Symlink> {
        let mut to_buf = PathBuffer::uninit();
        #[cfg(windows)]
        {
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
        // Mask `len` to a `u63` envelope so the `i64` cast is always in range,
        // rather than `try_from().unwrap()`-panicking
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
            match sys::truncate(path.slice_z(&mut self.sync_error_buf), len_i64) {
                Err(err) => Err(err.with_path(path.slice())),
                Ok(()) => Ok(()),
            }
        }
    }

    pub(crate) fn truncate(&mut self, args: &args::Truncate, _: Flavor) -> Maybe<ret::Truncate> {
        match &args.path {
            // Mask off the top bit so the i64 cast can't panic.
            PathOrFileDescriptor::Fd(fd) => {
                Syscall::ftruncate(*fd, (args.len & ((1u64 << 63) - 1)) as i64)
            }
            PathOrFileDescriptor::Path(p) => self.truncate_inner(p, args.len, args.flags),
        }
    }

    pub(crate) fn unlink(&mut self, args: &args::Unlink, _: Flavor) -> Maybe<ret::Unlink> {
        #[cfg(windows)]
        {
            return match Syscall::unlink(args.path.slice_z(&mut self.sync_error_buf)) {
                Err(err) => Err(err.with_path(args.path.slice())),
                Ok(result) => Ok(result),
            };
        }
        #[cfg(not(windows))]
        match sys::unlink(args.path.slice_z(&mut self.sync_error_buf)) {
            Err(err) => Err(err.with_path(args.path.slice())),
            Ok(()) => Ok(()),
        }
    }

    pub(crate) fn watch_file(
        &mut self,
        args: args::WatchFile,
        flavor: Flavor,
    ) -> Maybe<ret::WatchFile> {
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
                        message: BunString::from_bytes(&buf[..]),
                        code: BunString::static_(err.name()),
                        path: BunString::from_bytes(path.as_slice()),
                        ..Default::default()
                    }
                    .to_error_instance(&global_this),
                );
                Ok(JSValue::UNDEFINED)
            }
        }
    }

    pub(crate) fn utimes(&mut self, args: &args::Utimes, _: Flavor) -> Maybe<ret::Utimes> {
        #[cfg(windows)]
        {
            return match sys::sys_uv::utime(
                args.path.slice_z(&mut self.sync_error_buf),
                args.atime,
                args.mtime,
            ) {
                Err(err) => Err(err.with_path(args.path.slice())),
                Ok(()) => Ok(()),
            };
        }
        #[cfg(not(windows))]
        match Syscall::utimens(
            args.path.slice_z(&mut self.sync_error_buf),
            to_sys_time_like(args.atime),
            to_sys_time_like(args.mtime),
        ) {
            // `err.syscall` must be node's operation name, not `utimensat(2)`.
            Err(err) => Err(err.with_path_and_syscall(args.path.slice(), sys::Tag::utime)),
            Ok(_) => Ok(()),
        }
    }

    pub(crate) fn lutimes(&mut self, args: &args::Lutimes, _: Flavor) -> Maybe<ret::Lutimes> {
        #[cfg(windows)]
        {
            return match sys::sys_uv::lutime(
                args.path.slice_z(&mut self.sync_error_buf),
                args.atime,
                args.mtime,
            ) {
                Err(err) => Err(err.with_path(args.path.slice())),
                Ok(()) => Ok(()),
            };
        }
        #[cfg(not(windows))]
        match Syscall::lutimens(
            args.path.slice_z(&mut self.sync_error_buf),
            to_sys_time_like(args.atime),
            to_sys_time_like(args.mtime),
        ) {
            // `err.syscall` must be node's operation name, not `utimensat(2)`.
            Err(err) => Err(err.with_path_and_syscall(args.path.slice(), sys::Tag::lutime)),
            Ok(_) => Ok(()),
        }
    }

    pub(crate) fn watch(&mut self, args: &args::Watch<'_>, _: Flavor) -> Maybe<ret::Watch> {
        match args.create_fs_watcher() {
            // SAFETY: `create_fs_watcher` returns a freshly-heap-allocated
            // `*mut FSWatcher` whose ownership is held by the JS wrapper
            // (`js_this`); only `js_this` is read here.
            Ok(result) => Ok(unsafe { (*result).js_this() }),
            Err(err) => Err(err),
        }
    }

    /// This function is `cpSync`, but only if you pass `{ recursive: ..., force: ..., errorOnExist: ..., mode: ... }'
    /// The other options like `filter` use a JS fallback, see `src/js/internal/fs/cp.ts`
    pub(crate) fn cp(&mut self, args: &args::Cp, _: Flavor) -> Maybe<ret::Cp> {
        let mut src_buf = OSPathBuffer::uninit();
        let mut dest_buf = OSPathBuffer::uninit();
        let name_too_long = |path: &PathLike| sys::Error {
            errno: E::ENAMETOOLONG as _,
            syscall: sys::Tag::copyfile,
            path: path.slice().into(),
            ..Default::default()
        };
        let src_len = match args.src.os_path(&mut src_buf) {
            Ok(p) => p.len(),
            Err(NameTooLong) => return Err(name_too_long(&args.src)),
        };
        let dest_len = match args.dest.os_path(&mut dest_buf) {
            Ok(p) => p.len(),
            Err(NameTooLong) => return Err(name_too_long(&args.dest)),
        };
        self.cp_sync_inner(
            &mut src_buf,
            PathInt::try_from(src_len).expect("int cast"),
            &mut dest_buf,
            PathInt::try_from(dest_len).expect("int cast"),
            args,
        )
    }

    pub(crate) fn os_path_into_sync_error_buf(&mut self, slice: &[OSPathChar]) -> &[u8] {
        let buf = &mut self.sync_error_buf;
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
        src_buf[sd] = 0;
        dest_buf[dd] = 0;
        let src = OSPathSliceZ::from_buf(&src_buf[..], sd);
        let dest = OSPathSliceZ::from_buf(&dest_buf[..], dd);

        #[cfg(windows)]
        {
            let attributes = sys::windows::get_file_attributes(src);
            if attributes == sys::c::INVALID_FILE_ATTRIBUTES {
                return Err(sys::Error {
                    errno: SystemErrno::ENOENT as _,
                    syscall: sys::Tag::copyfile,
                    path: self.os_path_into_sync_error_buf(src.as_slice()).into(),
                    ..Default::default()
                });
            }
            if attributes & sys::c::FILE_ATTRIBUTE_DIRECTORY == 0
                || attributes & sys::c::FILE_ATTRIBUTE_REPARSE_POINT != 0
            {
                let r = self.copy_single_file_sync(
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
                let r = self.copy_single_file_sync(
                    src,
                    dest,
                    constants::Copyfile::from_raw(if cp_flags.error_on_exist || !cp_flags.force {
                        constants::COPYFILE_EXCL
                    } else {
                        0i32
                    }),
                    Some(&stat_),
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
            // CLONE_NOFOLLOW: `src` was classified as a directory via lstat, so
            // mirror the O_NOFOLLOW directory open below instead of dereferencing.
            if let Some(err) = Maybe::<ret::Cp>::errno_sys_p(
                bun_sys::c::clonefile_rc(src, dest, CLONE_NOFOLLOW),
                sys::Tag::clonefile,
                src.as_bytes(),
            ) {
                match err.get_errno() {
                    E::ENAMETOOLONG | E::EROFS | E::EINVAL | E::EACCES | E::EPERM => {
                        if matches!(err.get_errno(), E::EACCES | E::EPERM) && args.flags.force {
                            break 'try_with_clonefile;
                        }
                        // `errno_sys_p` already boxed
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

        let fd = match openat_os_path(
            FD::cwd(),
            src,
            sys::O::DIRECTORY | sys::O::RDONLY | sys::O::NOFOLLOW,
            0,
        ) {
            Err(err) => return Err(err.with_path(self.os_path_into_sync_error_buf(&src_buf[..sd]))),
            Ok(fd_) => fd_,
        };
        let _close = scopeguard::guard(fd, |fd| fd.close());

        match self.mkdir_recursive_os_path(dest, args::Mkdir::DEFAULT_MODE, false) {
            Err(err) => return Err(err),
            Ok(_) => {}
        }

        // The OSPathBuffer copy below is generic over `OSPathChar`, so on Windows
        // this needs the wide (u16) iterator; the u8 path is correct for POSIX.
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
                    r?;
                }
                _ => {
                    // NUL written at [len] above; `from_buf` debug-asserts it.
                    let src_z = OSPathSliceZ::from_buf(&src_buf[..], sd + 1 + name_slice.len());
                    let dest_z = OSPathSliceZ::from_buf(&dest_buf[..], dd + 1 + name_slice.len());
                    let r = self.copy_single_file_sync(
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
    #[cfg(windows)]
    fn should_ignore_ebusy(
        src: &PathLike,
        dest: &PathLike,
        result: Maybe<ret::CopyFile>,
    ) -> Maybe<ret::CopyFile> {
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

    #[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
    fn cp_symlink(&mut self, src: &ZStr, dest: &ZStr) -> Maybe<ret::CopyFile> {
        let mut target_buf = PathBuffer::uninit();
        // `bun_sys::readlink` returns the byte length on every
        // platform (the `Syscall` alias = `sys_uv` on Windows would return the
        // slice itself); reconstruct the NUL-terminated view from `target_buf`.
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
    pub(crate) fn copy_single_file_sync(
        &mut self,
        src: &OSPathSliceZ,
        dest: &OSPathSliceZ,
        mode: constants::Copyfile,
        // Stat on posix, file attributes on windows
        #[cfg(windows)] reuse_stat: Option<windows::DWORD>,
        #[cfg(not(windows))] reuse_stat: Option<&sys::Stat>,
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
                Some(s) => *s,
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

                let dest_fd =
                    Self::cp_open_dest_with_mkdir(self, dest, flags, stat_.st_mode as Mode)?;
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
                return Err(sys::Error::todo());
            }

            let src_fd = match Syscall::open(src, sys::O::RDONLY | sys::O::NOFOLLOW, 0o644) {
                Ok(result) => result,
                Err(err) => {
                    if err.get_errno() == E::ELOOP {
                        // ELOOP is returned when you open a symlink with NOFOLLOW.
                        // as in, it does not actually let you open it.
                        return self.cp_symlink(src, dest);
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

            let dest_fd = Self::cp_open_dest_with_mkdir(self, dest, flags, stat_.st_mode as Mode)?;

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
                    let written = sys::linux::copy_file_range_fd(
                        src_fd,
                        Some(&mut off_in_copy),
                        dest_fd,
                        Some(&mut off_out_copy),
                        sys::page_size(),
                        0,
                    );
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
                    let written = sys::linux::copy_file_range_fd(
                        src_fd,
                        Some(&mut off_in_copy),
                        dest_fd,
                        Some(&mut off_out_copy),
                        size,
                        0,
                    );
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
                        return self.cp_symlink(src, dest);
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

            let dest_fd =
                match Self::cp_open_dest_with_mkdir(self, dest, flags, stat_.st_mode as Mode) {
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

            // FreeBSD 13+ has copy_file_range(2).
            let mut off_in: i64 = 0;
            let mut off_out: i64 = 0;
            'cfr: loop {
                let want = if size == 0 {
                    (i32::MAX - 1) as usize
                } else {
                    size.saturating_sub(wrote.get() as usize)
                };
                let rc: isize = sys::freebsd::copy_file_range_fd(
                    src_fd,
                    Some(&mut off_in),
                    dest_fd,
                    Some(&mut off_out),
                    want,
                    0,
                ) as isize;
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
                // fall back to a non-CoW `CopyFileW`, per
                // Node.js' documented FICLONE_FORCE contract and matching the
                // Linux/FreeBSD arms above. Return a concrete ENOSYS rather
                // than `sys::Error::todo()` so debug builds do not panic.
                return Err(sys::Error {
                    errno: SystemErrno::ENOSYS as _,
                    syscall: sys::Tag::copyfile,
                    ..Default::default()
                });
            }
            let stat_ = match reuse_stat {
                Some(a) => a,
                None => {
                    let a = sys::windows::get_file_attributes(src);
                    if a == sys::c::INVALID_FILE_ATTRIBUTES {
                        return Err(sys::Error::from_win32(
                            windows::Win32Error::get(),
                            sys::Tag::copyfile,
                        )
                        .with_path(self.os_path_into_sync_error_buf(src.as_slice())));
                    }
                    a
                }
            };
            if stat_ & sys::c::FILE_ATTRIBUTE_REPARSE_POINT == 0 {
                if !sys::windows::copy_file(src, dest, mode.shouldnt_overwrite()) {
                    let mut err = windows::Win32Error::get();
                    if err == windows::Win32Error::PATH_NOT_FOUND {
                        let _ = sys::make_path::make_path_u16(
                            &sys::Dir::cwd(),
                            paths::dirname_w(dest.as_slice()),
                        );
                        if sys::windows::copy_file(src, dest, mode.shouldnt_overwrite()) {
                            return Ok(());
                        }
                        err = windows::Win32Error::get();
                    }
                    return Self::should_ignore_ebusy(
                        &args.src,
                        &args.dest,
                        Err(sys::Error::from_win32(err, sys::Tag::copyfile)
                            .with_path(self.os_path_into_sync_error_buf(dest.as_slice()))),
                    );
                }
                return Ok(());
            } else {
                let handle = match sys::openat_windows(FD::INVALID, src, sys::O::RDONLY, 0) {
                    Err(err) => return Err(err),
                    Ok(fd) => fd,
                };
                let _close = scopeguard::guard(handle, |fd| fd.close());
                let mut wbuf = paths::os_path_buffer_pool::get();
                let len = windows::get_final_path_name_by_handle(handle, &mut wbuf[..], 0);
                if len == 0 || len >= wbuf.len() {
                    let err = if len == 0 {
                        sys::Error::from_win32(windows::Win32Error::get(), sys::Tag::copyfile)
                    } else {
                        sys::Error::from_code(E::ENAMETOOLONG, sys::Tag::copyfile)
                    };
                    return Err(err.with_path(self.os_path_into_sync_error_buf(src.as_slice())));
                }
                wbuf[len] = 0;
                // `GetFinalPathNameByHandleW(VOLUME_NAME_DOS)` spells network
                // targets as `\\?\UNC\server\share\…`; rewrite in place to the
                // absolute `\\server\share\…` form (libuv `fs__realpath_handle`).
                let is_unc = strings::has_prefix_comptime_utf16(&wbuf[..len], b"\\\\?\\UNC\\");
                let target = if is_unc {
                    let skip = b"\\\\?\\UN".len();
                    wbuf[skip] = u16::from(b'\\');
                    bun_core::WStr::from_buf(&wbuf[skip..], len - skip)
                } else {
                    bun_core::WStr::from_buf(&wbuf[..], len)
                };
                let is_dir = stat_ & windows::FILE_ATTRIBUTE_DIRECTORY != 0;
                // `symlink_w`/`symlink_or_junction` (not raw `CreateSymbolicLinkW`)
                // so unprivileged creation is requested. UNC targets skip the junction
                // fallback: libuv's `fs__create_junction` only accepts drive-letter targets.
                let link_result = if is_dir && !is_unc {
                    let mut dest8 = paths::path_buffer_pool::get();
                    let mut target8 = paths::path_buffer_pool::get();
                    sys::symlink_or_junction(
                        strings::from_wpath(&mut dest8[..], dest.as_slice()),
                        strings::from_wpath(&mut target8[..], target.as_slice()),
                        None,
                    )
                } else {
                    sys::symlink_w(
                        dest,
                        target,
                        sys::WindowsSymlinkOptions { directory: is_dir },
                    )
                };
                if let Err(err) = link_result {
                    let p = self.os_path_into_sync_error_buf(dest.as_slice());
                    return Err(err.with_path(p));
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
        {
            let _ = (src, dest, mode, reuse_stat);
            Err(sys::Error::todo())
        }
    }

    /// Shared `dest_fd:` block from the mac/linux/freebsd branches of
    /// `copy_single_file_sync`.
    /// Tries `open(dest, flags, mode)`; on ENOENT creates the
    /// parent directory and retries once. Any other error is annotated with
    /// `dest` copied into `sync_error_buf`.
    #[cfg_attr(windows, allow(dead_code))]
    fn cp_open_dest_with_mkdir(&mut self, dest: &ZStr, flags: i32, mode: Mode) -> Maybe<FD> {
        // PORT: extracted from the mac/linux/freebsd arms of `copy_single_file_sync`
        // only — there `OSPathSliceZ == ZStr`. Taking `&ZStr` keeps the body
        // monomorphic (and lets it type-check on Windows where it's dead code).
        match Syscall::open(dest, flags, mode) {
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
                        path: PathLike::borrowed(&bytes[..len]),
                        recursive: true,
                        ..Default::default()
                    });
                    mkdir_result?;
                    if let Ok(result) = Syscall::open(dest, flags, mode) {
                        return Ok(result);
                    }
                }
                self.sync_error_buf[..dest.len()].copy_from_slice(dest.as_bytes());
                Err(err.with_path(&self.sync_error_buf[..dest.len()]))
            }
        }
    }

    /// Const-generic dispatch from `NodeFSFunctionEnum` to the matching
    /// `NodeFS::<method>`.
    ///
    /// The `(R, A, F)` triple is bound by [`NodeFSDispatch`] impls (one per
    /// `NodeFSFunctionEnum` variant); the `where Op<{F}>: NodeFSDispatch<R, A>`
    /// bound proves `R == ret::*` / `A == args::*` for this `F` so no identity
    /// cast is needed.
    #[inline]
    pub(crate) fn dispatch<R, A, const F: NodeFSFunctionEnum>(
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
    pub(crate) fn uv_dispatch<R, A, const F: NodeFSFunctionEnum>(
        &mut self,
        args: &A,
        rc: uv::ReturnCodeI64,
    ) -> Maybe<R>
    where
        Op<{ F }>: NodeFSDispatch<R, A>,
    {
        <Op<{ F }> as NodeFSDispatch<R, A>>::run_uv(self, args, rc)
    }

    /// Variant of [`Self::uv_dispatch`] that passes the completed `uv::fs_t`
    /// through so the handler can read its result payload (only `statfs`
    /// needs it).
    #[cfg(windows)]
    #[inline]
    pub(crate) fn uv_dispatch_req<R, A, const F: NodeFSFunctionEnum>(
        &mut self,
        args: &A,
        req: &uv::fs_t,
        rc: uv::ReturnCodeI64,
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
    fn run_uv(_fs: &mut NodeFS, _args: &A, _rc: uv::ReturnCodeI64) -> Maybe<R> {
        unreachable!("uv_dispatch: not a UVFSRequest variant")
    }
    #[cfg(windows)]
    fn run_uv_req(
        _fs: &mut NodeFS,
        _args: &A,
        _req: &uv::fs_t,
        _rc: uv::ReturnCodeI64,
    ) -> Maybe<R> {
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
                    fn run_uv(fs: &mut NodeFS, args: &$Args, rc: uv::ReturnCodeI64) -> Maybe<$Ret> {
                        fs.$uv_method(args, rc)
                    }
                )?
                $(
                    #[cfg(windows)]
                    #[inline]
                    fn run_uv_req(fs: &mut NodeFS, args: &$Args, req: &uv::fs_t, rc: uv::ReturnCodeI64) -> Maybe<$Ret> {
                        fs.$uv_req_method(args, req, rc)
                    }
                )?
            }
        )+
    };
}

node_fs_ops! {
    Access => access, args::Access<'static>, ret::Access;
    AppendFile => append_file, args::AppendFile<'static>, ret::AppendFile;
    Chmod => chmod, args::Chmod<'static>, ret::Chmod;
    Chown => chown, args::Chown<'static>, ret::Chown;
    Close => close, args::Close, ret::Close, uv = uv_close;
    CopyFile => copy_file, args::CopyFile<'static>, ret::CopyFile;
    Exists => exists, args::Exists<'static>, ret::Exists;
    Fchmod => fchmod, args::FChmod, ret::Fchmod;
    Fchown => fchown, args::Fchown, ret::Fchown;
    Fdatasync => fdatasync, args::FdataSync, ret::Fdatasync;
    Fstat => fstat, args::Fstat, ret::Fstat;
    Fsync => fsync, args::Fsync, ret::Fsync;
    Ftruncate => ftruncate, args::FTruncate, ret::Ftruncate;
    Futimes => futimes, args::Futimes, ret::Futimes;
    Lchmod => lchmod, args::LCHmod<'static>, ret::Lchmod;
    Lchown => lchown, args::LChown<'static>, ret::Lchown;
    Link => link, args::Link<'static>, ret::Link;
    Lstat => lstat, args::Lstat<'static>, ret::Lstat;
    Lutimes => lutimes, args::Lutimes<'static>, ret::Lutimes;
    Mkdir => mkdir, args::Mkdir<'static>, ret::Mkdir;
    Mkdtemp => mkdtemp, args::MkdirTemp<'static>, ret::Mkdtemp;
    Open => open, args::Open<'static>, ret::Open, uv = uv_open;
    Read => read, args::Read, ret::Read, uv = uv_read;
    Readdir => readdir, args::Readdir<'static>, ret::Readdir;
    ReadFile => read_file, args::ReadFile<'static>, ret::ReadFile;
    Readlink => readlink, args::Readlink<'static>, ret::Readlink;
    Readv => readv, args::Readv, ret::Readv, uv = uv_readv;
    Realpath => realpath, args::Realpath<'static>, ret::Realpath;
    RealpathNonNative => realpath_non_native, args::Realpath<'static>, ret::Realpath;
    Rename => rename, args::Rename<'static>, ret::Rename;
    Rm => rm, args::Rm<'static>, ret::Rm;
    Rmdir => rmdir, args::RmDir<'static>, ret::Rmdir;
    Stat => stat, args::Stat<'static>, ret::Stat;
    Statfs => statfs, args::StatFS<'static>, ret::StatFS, uv_req = uv_statfs;
    Symlink => symlink, args::Symlink<'static>, ret::Symlink;
    Truncate => truncate, args::Truncate<'static>, ret::Truncate;
    Unlink => unlink, args::Unlink<'static>, ret::Unlink;
    Utimes => utimes, args::Utimes<'static>, ret::Utimes;
    Write => write, args::Write<'static>, ret::Write, uv = uv_write;
    WriteFile => write_file, args::WriteFile<'static>, ret::WriteFile;
    Writev => writev, args::Writev, ret::Writev, uv = uv_writev;
}

/// `fs.promises.readFile`: the pool runs the `Send`-result variant.
impl NodeFSDispatch<ret::ReadFileOffThread, args::ReadFile<'static>>
    for Op<{ NodeFSFunctionEnum::ReadFile }>
{
    #[inline]
    fn run(
        fs: &mut NodeFS,
        args: &args::ReadFile<'static>,
        flavor: Flavor,
    ) -> Maybe<ret::ReadFileOffThread> {
        fs.read_file_off_thread(args, flavor)
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum RealpathVariant {
    Native,
    Emulated,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ReadFileStringType {
    Default,
    NullTerminated,
}

/// Trait for `mkdirRecursiveImpl` Ctx parameter (`void` does nothing).
pub(crate) trait MkdirCtx {
    fn on_create_dir(&self, _path: &OSPathSliceZ) {}
}
impl MkdirCtx for () {}

/// Trait abstracting over the three readdir entry types.
///
/// Rust can't switch on a generic `T` at runtime, so the per-type append
/// logic (Dirent / Buffer / String) lives on this trait. `IS_DIRENT` tells
/// the caller whether it must compute/maintain `dirent_path`.
pub trait ReaddirEntry: Sized {
    /// `ExpectedType == jsc.Node.Dirent` — whether the caller needs to track
    /// a cached `dirent_path` BunString.
    const IS_DIRENT: bool;
    /// Windows: entry names arrive as UTF-16 (`append_entry_w`).
    const IS_U16: bool;
    /// Windows-only: append from a UTF-16 directory entry name.
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
    /// `apply_encoding` distinguishes the sync path (which honours
    /// `args.encoding` via `webcore::encoding::to_bun_string`) from
    /// the async path (which uses raw
    /// `BunString::clone_utf8` and ignores the requested encoding).
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
            path: dirent_path.clone(),
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
        // Windows Dirent always clones the raw UTF-16
        // name (no re-encoding) and skips the lstatat() DT_UNKNOWN fallback.
        entries.push(Dirent {
            name: BunString::clone_utf16(utf16_name),
            path: dirent_path.clone(),
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
            path: dirent_path.clone(),
            kind,
        });
    }
}
impl ReaddirEntry for Box<[u8]> {
    const IS_DIRENT: bool = false;
    const IS_U16: bool = false;
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
        entries.push(utf8_name.into());
    }
    fn append_entry_w(
        _: &mut Vec<Self>,
        _: &[u16],
        _: &BunString,
        _: sys::FileKind,
        _: Encoding,
        _: Option<&mut PathBuffer>,
    ) {
        // Byte entries never
        // take the u16 iterator (`IS_U16 = false`); the call site is gated on
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
        entries.push(without_nt_prefix::<u8>(name_to_copy).into());
    }
}

// There are three distinct error→errno tables: rmdir-recursive,
// rm-recursive, and rm non-recursive unlink/rmdir. An earlier draft
// collapsed them into one, which silently mapped AccessDenied→EPERM for `rm`
// (Node returns EACCES there) and widened the narrow table. Split back out
// per call site.
fn map_anyerror_to_errno(err: &crate::Error) -> E {
    match err.name() {
        "AccessDenied" => E::EPERM,
        "PermissionDenied" => E::EPERM,
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

// `rm` recursive (zig_delete_tree) — same shape as the rmdir table above except
// AccessDenied maps to EACCES, not EPERM.
fn map_anyerror_to_errno_rm_tree(err: &crate::Error) -> E {
    match err.name() {
        "AccessDenied" => E::EACCES,
        "PermissionDenied" => E::EPERM,
        "DirNotEmpty" => E::ENOTEMPTY,
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

// `rm` non-recursive unlink — narrower table; anything not listed here falls
// through to EFAULT.
//
// `bun_sys::unlink` yields a raw errno. Notably raw EPERM — like
// EISDIR/ENOTDIR/ENOTEMPTY — intentionally falls through to EFAULT here.
fn map_rm_errno_narrow(e: E) -> E {
    match e {
        E::EACCES => E::EACCES,
        E::ELOOP | E::ENAMETOOLONG | E::ENOMEM | E::EROFS | E::EBUSY | E::ENOENT => e,
        _ => E::EFAULT,
    }
}

// HOST_EXPORT(Bun__mkdirp, c)
pub fn mkdirp(_global_this: &JSGlobalObject, path: Option<&core::ffi::CStr>) -> bool {
    let Some(path) = path else {
        return false;
    };
    let mut node_fs = NodeFS::default();
    node_fs
        .mkdir_recursive(&args::Mkdir {
            path: PathLike::borrowed(path.to_bytes()),
            recursive: true,
            ..Default::default()
        })
        .is_ok()
}

// ──────────────────────────────────────────────────────────────────────────
// zig_delete_tree — recursive delete-tree. Returns `FileNotFound`
// instead of ignoring it, which is required to match the behavior of Node.js's
// `fs.rm` { recursive: true, force: false }.
// ──────────────────────────────────────────────────────────────────────────

// Implemented on top of
// `bun_sys` primitives (`openat` + `unlinkat`) and *errno* values, mapping the
// errno back to the error-set name strings the callers'
// `map_anyerror_to_errno*` tables expect. The structure: 16-slot stack,
// treat_as_dir flip-flop, close-then-deleteDir, retry-on-DirNotEmpty.

#[inline]
fn dt_err(errno: E) -> crate::Error {
    // Reverse of the `map_anyerror_to_errno*` tables above — round-trip through
    // the error-set name so existing callers don't have to change.
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
fn dt_open_dir(parent: &sys::Dir, name: &[u8]) -> Result<sys::Dir, E> {
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
fn dt_delete_file(parent: &sys::Dir, name: &[u8]) -> Result<(), E> {
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
            // Non-Linux POSIX (macOS/BSD) returns
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
                // No-follow stat — don't follow symlinks, to match unlinkat.
                // `z` (a `&ZStr`, `Copy`) is still valid — `unlinkat` only borrowed it.
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
fn dt_delete_dir(parent: &sys::Dir, name: &[u8]) -> Result<(), E> {
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
    /// Non-owning alias of either `self_` (first item) or the previous stack
    /// frame's `iter.iter.dir`. Ownership of the descriptor stays with the
    /// owner; this is just the raw fd for `Dir::borrow` at call sites.
    parent_dir: FD,
    iter: DirIterator::WrappedIterator,
}

pub(crate) fn zig_delete_tree(
    self_: &sys::Dir,
    sub_path: &[u8],
    kind_hint: sys::FileKind,
) -> crate::Result<()> {
    let initial_iterable_dir =
        match zig_delete_tree_open_initial_subpath(self_, sub_path, kind_hint)? {
            Some(d) => d,
            None => return Ok(()),
        };

    // PERF: a Vec
    // pre-reserved to 16 caps the depth the same way a fixed array would,
    // with the bonus that the iterator buffers (8 KB each)
    // live on the heap instead of the stack.
    let mut stack: Vec<DeleteTreeStackItem> = Vec::with_capacity(16);
    let close_all = |stack: &mut Vec<DeleteTreeStackItem>| {
        for item in stack.drain(..) {
            item.iter.iter.dir.close();
        }
    };
    let mut _close_all = scopeguard::guard(&mut stack, close_all);
    let stack: &mut Vec<DeleteTreeStackItem> = *_close_all;

    stack.push(DeleteTreeStackItem {
        name: Vec::new(),
        name_is_borrowed: true,
        parent_dir: self_.fd,
        iter: DirIterator::WrappedIterator::init(initial_iterable_dir.into_raw()),
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
            // `entry.name` borrows the iterator's internal buffer and
            // is invalidated by the next `next()` call. Copy it once here so
            // it survives both the push-onto-stack and the deleteDir-after-close
            // paths.
            let entry_name: Vec<u8> = entry.name.slice().to_vec();
            let mut treat_as_dir = entry.kind == sys::FileKind::Directory;
            'handle_entry: loop {
                if treat_as_dir {
                    if stack.len() < stack.capacity() {
                        let top_fd = stack[top_idx].iter.iter.dir;
                        match dt_open_dir(sys::Dir::borrow(&top_fd), &entry_name) {
                            Ok(iterable_dir) => {
                                stack.push(DeleteTreeStackItem {
                                    name: entry_name,
                                    name_is_borrowed: false,
                                    parent_dir: top_fd,
                                    iter: DirIterator::WrappedIterator::init(
                                        iterable_dir.into_raw(),
                                    ),
                                });
                                continue 'process_stack;
                            }
                            Err(E::ENOTDIR) => {
                                treat_as_dir = false;
                                continue 'handle_entry;
                            }
                            #[cfg(target_os = "macos")]
                            Err(e @ (E::EACCES | E::EPERM)) => {
                                // Same as the pop-delete site below: node's rimraf
                                // retries rmdir on the directory whose child could
                                // not be opened and reports its ENOTEMPTY on macOS.
                                let ancestor = &stack[top_idx];
                                let ancestor_name: &[u8] = if ancestor.name_is_borrowed {
                                    sub_path
                                } else {
                                    &ancestor.name
                                };
                                if matches!(
                                    dt_delete_dir(
                                        sys::Dir::borrow(&ancestor.parent_dir),
                                        ancestor_name
                                    ),
                                    Err(E::ENOTEMPTY | E::EEXIST)
                                ) {
                                    return Err(dt_err(E::ENOTEMPTY));
                                }
                                return Err(dt_err(e));
                            }
                            Err(e) => return Err(dt_err(e)),
                        }
                    } else {
                        let top_fd = stack[top_idx].iter.iter.dir;
                        zig_delete_tree_min_stack_size_with_kind_hint(
                            sys::Dir::borrow(&top_fd),
                            &entry_name,
                            entry.kind,
                        )?;
                        break 'handle_entry;
                    }
                } else {
                    let top_fd = stack[top_idx].iter.iter.dir;
                    match dt_delete_file(sys::Dir::borrow(&top_fd), &entry_name) {
                        Ok(()) => break 'handle_entry,
                        Err(E::EISDIR) => {
                            treat_as_dir = true;
                            continue 'handle_entry;
                        }
                        #[cfg(target_os = "macos")]
                        Err(e @ E::EACCES) => {
                            // Same ancestor-rmdir retry as the directory sites:
                            // node reports the containing directory's ENOTEMPTY on
                            // macOS when a file child cannot be unlinked. EPERM is
                            // NOT converted -- on macOS it can mean "target is a
                            // directory" and must keep flowing to the caller.
                            let ancestor = &stack[top_idx];
                            let ancestor_name: &[u8] = if ancestor.name_is_borrowed {
                                sub_path
                            } else {
                                &ancestor.name
                            };
                            if matches!(
                                dt_delete_dir(
                                    sys::Dir::borrow(&ancestor.parent_dir),
                                    ancestor_name
                                ),
                                Err(E::ENOTEMPTY | E::EEXIST)
                            ) {
                                return Err(dt_err(E::ENOTEMPTY));
                            }
                            return Err(dt_err(e));
                        }
                        // "EPERM because it's a directory" is OS-dependent
                        // (Linux returns EISDIR; macOS returns EPERM). We only
                        // get errno, so forward EPERM as PermissionDenied —
                        // caller maps it.
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
        match dt_delete_dir(sys::Dir::borrow(&parent_dir), name) {
            Ok(()) => {}
            Err(E::ENOENT) => {}
            Err(E::ENOTEMPTY) => need_to_retry = true,
            // Some OSes report EEXIST instead of ENOTEMPTY for a non-empty
            // directory; treat it the same.
            Err(E::EEXIST) => need_to_retry = true,
            #[cfg(target_os = "macos")]
            Err(e @ (E::EACCES | E::EPERM)) => {
                // Node's rimraf keeps going after a child deletion is denied and
                // retries rmdir on the ancestor, so on macOS the error it reports
                // for a read-only-but-searchable directory is the ancestor's
                // ENOTEMPTY, not the child's EACCES. (On Linux node surfaces the
                // child's EACCES, which the plain return below produces.)
                if let Some(ancestor) = stack.last() {
                    let ancestor_name: &[u8] = if ancestor.name_is_borrowed {
                        sub_path
                    } else {
                        &ancestor.name
                    };
                    if matches!(
                        dt_delete_dir(sys::Dir::borrow(&ancestor.parent_dir), ancestor_name),
                        Err(E::ENOTEMPTY | E::EEXIST)
                    ) {
                        return Err(dt_err(E::ENOTEMPTY));
                    }
                }
                return Err(dt_err(e));
            }
            Err(e) => return Err(dt_err(e)),
        }

        if need_to_retry {
            // Since we closed the handle that the previous iterator used, we
            // need to re-open the dir and re-create the iterator.
            let mut treat_as_dir = true;
            let iterable_dir = 'handle_entry: loop {
                if treat_as_dir {
                    match dt_open_dir(sys::Dir::borrow(&parent_dir), name) {
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
                    match dt_delete_file(sys::Dir::borrow(&parent_dir), name) {
                        Ok(()) => continue 'process_stack,
                        Err(E::ENOENT) => continue 'process_stack,
                        Err(E::EISDIR) => {
                            treat_as_dir = true;
                            continue 'handle_entry;
                        }
                        Err(E::ENOTDIR) => {
                            #[cfg(debug_assertions)]
                            unreachable!();
                            // "Unexpected" → caller's fallthrough arm = EFAULT.
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
                iter: DirIterator::WrappedIterator::init(iterable_dir.into_raw()),
            });
            continue 'process_stack;
        }
    }
    Ok(())
}

fn zig_delete_tree_open_initial_subpath(
    self_: &sys::Dir,
    sub_path: &[u8],
    kind_hint: sys::FileKind,
) -> crate::Result<Option<sys::Dir>> {
    // Treat as a file by default
    let mut treat_as_dir = kind_hint == sys::FileKind::Directory;
    loop {
        if treat_as_dir {
            return match dt_open_dir(self_, sub_path) {
                Ok(d) => Ok(Some(d)),
                // NotDir/FileNotFound surface here (no fall-through to
                // deleteFile) — deliberate, so `FileNotFound` propagates
                // (see the zig_delete_tree banner above).
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
    self_: &sys::Dir,
    sub_path: &[u8],
    kind_hint: sys::FileKind,
) -> crate::Result<()> {
    'start_over: loop {
        let mut dir = match zig_delete_tree_open_initial_subpath(self_, sub_path, kind_hint)? {
            Some(d) => d,
            None => return Ok(()),
        };
        let mut cleanup_dir_parent: Option<sys::Dir> = None;

        // Valid use of MAX_PATH_BYTES because dir_name_buf will only
        // ever store a single path component that was returned from the
        // filesystem.
        let mut dir_name_buf = PathBuffer::uninit();
        let mut dir_name_len = sub_path.len().min(dir_name_buf.len());
        dir_name_buf[..dir_name_len].copy_from_slice(&sub_path[..dir_name_len]);
        // `dir_name` conceptually aliases either `sub_path` or `dir_name_buf`;
        // the borrow checker won't let that alias survive the copy/reassignment
        // below, so track `(is_sub_path, len)` and re-slice on each use.
        let mut dir_name_is_sub_path = true;

        // Here we must avoid recursion, in order to provide O(1) memory guarantee of this function.
        // Go through each entry and if it is not a directory, delete it. If it is a directory,
        // open it, and close the original directory. Repeat. Then start the entire operation over.
        let result: crate::Result<()> = 'scan_dir: loop {
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
                        match dt_open_dir(&dir, &entry_name) {
                            Ok(new_dir) => {
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
                        match dt_delete_file(&dir, &entry_name) {
                            Ok(()) => continue 'dir_it,
                            Err(E::ENOENT) => continue 'dir_it,
                            Err(E::EISDIR) => {
                                treat_as_dir = true;
                                continue 'handle_entry;
                            }
                            Err(E::ENOTDIR) => {
                                #[cfg(debug_assertions)]
                                unreachable!();
                                // "Unexpected" → caller's fallthrough arm = EFAULT.
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

            let dir_name: &[u8] = if dir_name_is_sub_path {
                sub_path
            } else {
                &dir_name_buf[..dir_name_len]
            };
            if let Some(d) = cleanup_dir_parent {
                match dt_delete_dir(&d, dir_name) {
                    Ok(()) | Err(E::ENOENT) | Err(E::ENOTEMPTY) | Err(E::EEXIST) => {
                        // These two things can happen due to file system race conditions.
                        continue 'start_over;
                    }
                    Err(e) => {
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
        return result;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NodeFSFunctionEnum — one variant per NodeFS method
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
    /// The event-loop [`TaskTag`] of the ops that are libuv requests on
    /// Windows (`UVFSRequest`) and so re-enter through the task queue; every
    /// other async op is a `bun_jsc::Job` and needs none.
    #[cfg(windows)]
    pub const fn task_tag(self) -> bun_event_loop::TaskTag {
        use bun_event_loop::task_tag;
        match self {
            NodeFSFunctionEnum::Open => task_tag::Open,
            NodeFSFunctionEnum::Close => task_tag::Close,
            NodeFSFunctionEnum::Read => task_tag::Read,
            NodeFSFunctionEnum::Write => task_tag::Write,
            NodeFSFunctionEnum::Readv => task_tag::Readv,
            NodeFSFunctionEnum::Writev => task_tag::Writev,
            NodeFSFunctionEnum::Statfs => task_tag::StatFS,
            _ => panic!("not a libuv-request fs op"),
        }
    }
}

/// `i52` — 52-bit integer used for `ReadPosition` coercion bounds.
#[allow(non_camel_case_types)]
struct i52;
impl i52 {
    const MIN: i64 = -(1i64 << 51);
    /// Node's `GetOffset`: only a safe JS integer selects positional I/O.
    #[inline]
    fn offset_from_js(v: JSValue) -> Option<i64> {
        let n = v.get_number()?;
        (n.is_finite() && n.trunc() == n && n.abs() <= bun_jsc::MAX_SAFE_INTEGER as f64)
            .then_some(n as i64)
    }
}
