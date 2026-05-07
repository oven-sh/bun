//! Node.js APIs in Bun. Access this namespace with `bun.api.node`

// NOTE: the Zig `comptime { _ = @import(...) }` force-reference block is
// dropped — Rust links what's `pub`.

use core::fmt;

// ─── compiling submodules ─────────────────────────────────────────────────
#[path = "node/nodejs_error_code.rs"]
pub mod nodejs_error_code;
pub use nodejs_error_code::Code as ErrorCode;

#[path = "node/assert/myers_diff.rs"]
pub mod myers_diff_impl;
pub mod assert {
    pub use super::myers_diff_impl as myers_diff;
}

// ─── un-gated in B-2 round (type defs real; JSC bodies re-gated inside) ───
#[path = "node/types.rs"]
pub mod types;
pub use types::{
    js_assert_encoding_valid, mode_from_js, BlobOrStringOrBuffer, CallbackTask, Dirent, Encoding,
    FileSystemFlags, PathLike, PathOrBlob, PathOrBuffer, PathOrFileDescriptor, StringOrBuffer,
    Valid, VectorArrayBuffer,
};

pub use bun_jsc::MarkedArrayBuffer as Buffer;

#[path = "node/path.rs"]
pub mod path;

#[path = "node/node_os.rs"]
pub mod os;

#[path = "node/node_process.rs"]
pub mod process;

#[path = "node/node_crypto_binding.rs"]
pub mod crypto;
// codegen (`generated_js2native.rs`) addresses this by its file-stem name.
pub use crypto as node_crypto_binding;

#[path = "node/fs_events.rs"]
pub mod fs_events;
#[allow(non_snake_case)]
pub use fs_events as FSEvents;

// ─── un-gated in B-2 round 2 (node_fs sync paths live; async re-gated inside) ───
// Sibling modules node_fs.rs imports by `super::` path. Stat/StatFS/time_like
// are type-only at the surface; their JSC method bodies are re-gated inside
// each file. dir_iterator + node_fs_constant are JSC-free.
#[path = "node/Stat.rs"]
pub mod stat;
pub use stat::{Stats, StatsBig, StatsSmall};

#[path = "node/StatFS.rs"]
pub mod statfs;
pub use statfs::{StatFS, StatFSBig, StatFSSmall};

#[path = "node/time_like.rs"]
pub mod time_like;
pub use time_like::{from_js as time_like_from_js, TimeLike};

#[path = "node/dir_iterator.rs"]
pub mod dir_iterator;

#[path = "node/node_fs_constant.rs"]
pub mod node_fs_constant;

#[path = "node/util/validators.rs"]
pub mod validators_impl;
pub mod util {
    pub use super::validators_impl as validators;
}
pub use util::validators;

// `crate::node::dirent::Kind` shim for dir_iterator.rs / node_fs.rs — the
// Zig spec exports `Dirent = types.Dirent` and callers reach `.Kind` through
// it. Rust can't hang an associated module off a struct re-export, so expose
// a tiny module mirroring that shape.
pub mod dirent {
    pub use super::types::Dirent;
    pub use super::types::DirentKind as Kind;
}

// node_fs.rs (~4.7kL): async task machinery (AsyncFSTask/UVFSRequest/cp/
// readdir-recursive) is JSC-dense and re-gated *inside* the file with
// ``. Sync `impl NodeFS` (read_file/write_file/stat/mkdir et al.),
// `args::*`, `ret::*` are live.
#[path = "node/node_fs.rs"]
pub mod fs;

// fs.watch() / fs.watchFile() backends — declared here so `fs::watch` /
// `fs::watch_file` can reach the real `Arguments` / `FSWatcher` /
// `StatWatcher` types instead of opaque local stand-ins.
#[path = "node/path_watcher.rs"]
pub mod path_watcher;
#[cfg(windows)]
#[path = "node/win_watcher.rs"]
pub mod win_watcher;
#[path = "node/node_fs_watcher.rs"]
pub mod node_fs_watcher;
#[path = "node/node_fs_stat_watcher.rs"]
pub mod node_fs_stat_watcher;
#[path = "node/node_fs_binding.rs"]
pub mod node_fs_binding;

// ─── un-gated in B-2 round 3 (net/zlib/buffer; JSC bodies re-gated inside) ───
// Type defs + non-JSC FFI bodies are live; every `#[bun_jsc::host_fn]` /
// `#[bun_jsc::JsClass]` item is wrapped in ` mod _impl` inside
// each file. dgram/tls/tty have no `.rs` ports yet — nothing to wire.
#[path = "node/buffer.rs"]
pub mod buffer;

#[path = "node/node_cluster_binding.rs"]
pub mod node_cluster_binding;

#[path = "node/node_net_binding.rs"]
pub mod node_net_binding;

#[path = "node/node_zlib_binding.rs"]
pub mod node_zlib_binding;

#[path = "node/net/BlockList.rs"]
pub mod block_list_impl;
pub mod net {
    pub use super::block_list_impl as block_list;
}

#[path = "node/zlib/NativeZlib.rs"]
pub mod native_zlib_impl;
#[path = "node/zlib/NativeBrotli.rs"]
pub mod native_brotli_impl;
#[path = "node/zlib/NativeZstd.rs"]
pub mod native_zstd_impl;
pub mod zlib {
    // Re-export so `super::NodeMode` resolves inside the gated NativeZstd body.
    pub use bun_zlib::NodeMode;
    pub use super::native_zlib_impl as native_zlib;
    pub use super::native_brotli_impl as native_brotli;
    pub use super::native_zstd_impl as native_zstd;
    // PORT NOTE: the `NativeZlib` / `NativeBrotli` / `NativeZstd` *struct*
    // re-exports were dropped — those structs live inside each file's private
    // `mod _impl { ... }` (JSC-gated) and are not reachable from here. The only
    // consumers (`node_zlib_binding.rs::_impl::Native*`) are themselves gated
    // behind a private `_impl` and resolve through `crate::api::Native*` once
    // un-gated. Re-add the type re-exports when the `_impl` mods go `pub`.
}

// ─── submodule re-exports ─────────────────────────────────────────────────
// PORT NOTE: the phase-A `_gated_submods` scaffold was removed once every
// re-export it held (fs/path/crypto/os/process/validators/ErrorCode/Buffer/
// types::*/FSEvents/Stats*/StatFS*/time_like*) was promoted to a real
// top-level `pub mod`/`pub use` above. Nothing referenced the private mod.

#[cfg(unix)]
pub type uid_t = libc::uid_t;
#[cfg(not(unix))]
pub type uid_t = bun_sys::windows::libuv::uv_uid_t;

#[cfg(unix)]
pub type gid_t = libc::gid_t;
#[cfg(not(unix))]
pub type gid_t = bun_sys::windows::libuv::uv_gid_t;

/// Node.js expects the error to include contextual information
/// - "syscall"
/// - "path"
/// - "errno"
///
/// We can't really use Zig's error handling for syscalls because Node.js expects the "real" errno to be returned
/// and various issues with std.posix that make it too unstable for arbitrary user input (e.g. how .BADF is marked as unreachable)
pub enum Maybe<R, E> {
    Err(E),
    Result(R),
}

// `union(enum)` → Rust enum is the tagged union; the explicit `Tag` enum is
// kept only for source parity with the Zig.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum MaybeTag {
    Err,
    Result,
}

impl<R, E> Maybe<R, E> {
    // PORT NOTE: Zig `pub const ErrorType = ErrorTypeT` etc. would be inherent
    // associated types in Rust, which are unstable. Dropped — callers use the
    // generic params directly. `Tag` is exposed at module scope as `MaybeTag`.

    #[inline]
    pub fn todo() -> Self
    where
        E: MaybeErrorTodo,
    {
        if cfg!(debug_assertions) {
            // PORT NOTE: Zig branched on `ReturnType == void` only to vary the
            // panic message; collapsed to a single panic + type name.
            panic!("TODO: Maybe({})", core::any::type_name::<R>());
        }
        // TODO(port): Zig used `@hasDecl(E, "todo")` to optionally call
        // `E::todo()` else default-construct. Modeled via `MaybeErrorTodo`
        // trait with a default impl returning `E::default()`.
        Maybe::Err(E::todo())
    }

    #[inline]
    pub fn unwrap_or(self, default_value: R) -> R {
        match self {
            Maybe::Result(v) => v,
            Maybe::Err(_) => default_value,
        }
    }

    #[inline]
    pub fn init_err(e: E) -> Maybe<R, E> {
        Maybe::Err(e)
    }

    #[inline]
    pub fn as_err(&self) -> Option<&E> {
        if let Maybe::Err(e) = self {
            return Some(e);
        }
        None
    }

    #[inline]
    pub fn as_value(&self) -> Option<&R> {
        if let Maybe::Result(r) = self {
            return Some(r);
        }
        None
    }

    #[inline]
    pub fn is_ok(&self) -> bool {
        match self {
            Maybe::Result(_) => true,
            Maybe::Err(_) => false,
        }
    }

    #[inline]
    pub fn is_err(&self) -> bool {
        match self {
            Maybe::Result(_) => false,
            Maybe::Err(_) => true,
        }
    }

    #[inline]
    pub fn init_result(result: R) -> Maybe<R, E> {
        Maybe::Result(result)
    }

    #[inline]
    pub fn map_err<E2>(self, err_fn: fn(E) -> E2) -> Maybe<R, E2> {
        match self {
            Maybe::Result(v) => Maybe::Result(v),
            Maybe::Err(e) => Maybe::Err(err_fn(e)),
        }
    }
}

impl<R, E: Default> Maybe<R, E> {
    pub fn success() -> Self
    where
        R: Default,
    {
        // PORT NOTE: Zig used `std.mem.zeroes(ReturnType)`. Mapped to
        // `Default` here since the generic `R` may contain non-POD fields.
        // TODO(port): if any caller relied on literal zero-bytes semantics for
        // a non-`Default` `R`, revisit with `core::mem::zeroed()` + SAFETY note.
        Maybe::Result(R::default())
    }
}

// TODO(port): Zig `pub const retry` was gated on `@hasDecl(ErrorTypeT, "retry")`.
// Modeled via the `MaybeErrorRetry` trait below; types that have a `retry`
// value implement it.
impl<R, E: MaybeErrorRetry> Maybe<R, E> {
    pub fn retry() -> Self {
        Maybe::Err(E::retry())
    }
}

/// `@hasDecl(E, "retry")` shim — implemented by error types that expose a
/// `retry` sentinel (e.g. `bun_sys::Error`).
pub trait MaybeErrorRetry: Sized {
    fn retry() -> Self;
}

/// `@hasDecl(E, "todo")` shim — default falls back to `Default::default()`
/// matching Zig's `ErrorType{}`.
pub trait MaybeErrorTodo: Sized + Default {
    fn todo() -> Self {
        Self::default()
    }
}

/// Extension surface providing `Maybe::todo()` on `bun_sys::Maybe<T>`
/// (= `core::result::Result<T, bun_sys::Error>`). Zig's `Maybe(T).todo()`
/// returns `.{ .err = bun.sys.Error.todo() }`; this is the Rust equivalent for
/// the upstream type-alias form of `Maybe` used throughout `node/`.
pub trait MaybeTodo: Sized {
    fn todo() -> Self;
}

impl<T> MaybeTodo for core::result::Result<T, bun_sys::Error> {
    #[inline]
    fn todo() -> Self {
        Err(bun_sys::Error::todo())
    }
}

impl<E> Maybe<bool, E> {
    pub fn is_true(self) -> bool {
        // Zig: `if (comptime ReturnType != bool) @compileError(...)` — enforced
        // here by the impl bound `R = bool`.
        match self {
            Maybe::Result(r) => r,
            _ => false,
        }
    }
}

// ─── methods that assume `E` carries an errno (i.e. `bun_sys::Error`) ─────
impl<R> Maybe<R, bun_sys::Error> {
    /// This value is technically garbage, but that is okay as `.aborted` is
    /// only meant to be returned in an operation when there is an aborted
    /// `AbortSignal` object associated with the operation.
    pub fn aborted() -> Self {
        Maybe::Err(bun_sys::Error {
            // PORT NOTE: Zig `posix.E.INTR` → `SystemErrno::EINTR` (variants keep `E` prefix).
            errno: bun_sys::posix::E::EINTR as bun_sys::ErrorInt,
            syscall: bun_sys::Tag::access,
            ..Default::default()
        })
    }

    pub fn unwrap(self) -> Result<R, bun_core::Error> {
        // TODO(port): narrow error set
        match self {
            Maybe::Result(r) => Ok(r),
            Maybe::Err(e) => Err(bun_core::errno_to_zig_err(e.errno as i32)),
        }
    }

    #[inline]
    pub fn init_err_with_p(
        e: bun_sys::SystemErrno,
        syscall: bun_sys::Tag,
        file_path: impl AsRef<[u8]>,
    ) -> Maybe<R, bun_sys::Error> {
        Maybe::Err(bun_sys::Error {
            errno: e as bun_sys::ErrorInt,
            syscall,
            path: file_path.as_ref().into(),
            ..Default::default()
        })
    }

    pub fn to_array_buffer(
        self,
        global_object: &crate::jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<crate::jsc::JSValue>
    where
        R: Into<Vec<u8>>,
    {
        use bun_jsc::SysErrorJsc as _;
        match self {
            Maybe::Result(r) => {
                // PORT NOTE: Zig hands the result slice straight to
                // `ArrayBuffer.fromBytes` and ownership transfers to JSC — the
                // GC-installed deallocator (`MarkedArrayBuffer_deallocator`)
                // calls `mi_free` on the buffer when the JS object is
                // collected. Leak the `Vec` here to hand the allocation to
                // JSC; Bun's global allocator is mimalloc, so `to_js`'s
                // `mi_is_in_heap_region` check succeeds and the buffer is
                // freed by JSC, not Rust.
                let bytes: &mut [u8] = Vec::leak(r.into());
                bun_jsc::ArrayBuffer::from_bytes(bytes, bun_jsc::JSType::ArrayBuffer)
                    .to_js(global_object)
            }
            Maybe::Err(e) => Ok(e.to_js(global_object)),
        }
    }

    pub fn get_errno(self) -> bun_sys::posix::E {
        match self {
            Maybe::Result(_) => bun_sys::posix::E::SUCCESS,
            Maybe::Err(e) => {
                // Checked conversion: `errno` originates from raw syscalls/libc
                // and is not guaranteed to map to a `SystemErrno` variant on
                // every platform; transmuting an out-of-range discriminant into
                // a Rust enum is UB. Mirrors Zig debug-mode `@enumFromInt`
                // (panics on bad value) without the UB.
                bun_sys::posix::E::init(i64::from(e.errno)).expect("errno out of range")
            }
        }
    }

    pub fn errno<Er: IntoErrInt>(err: Er, syscall: bun_sys::Tag) -> Self {
        Maybe::Err(bun_sys::Error {
            // always truncate
            errno: translate_to_err_int(err),
            syscall,
            ..Default::default()
        })
    }
}

// `errno_sys*` family: bound `Rc: bun_sys::GetErrno` so the per-platform
// `bun_sys::get_errno` accepts it (Zig used `rc: anytype`).
impl<R> Maybe<R, bun_sys::Error> {
    pub fn errno_sys<Rc: SyscallRc + bun_sys::GetErrno>(rc: Rc, syscall: bun_sys::Tag) -> Option<Self> {
        #[cfg(windows)]
        {
            if !Rc::IS_NTSTATUS {
                if !rc.is_zero() {
                    return None;
                }
            }
        }
        match bun_sys::get_errno(rc) {
            bun_sys::posix::E::SUCCESS => None,
            e => Some(Maybe::Err(bun_sys::Error {
                // always truncate
                errno: translate_to_err_int(e),
                syscall,
                ..Default::default()
            })),
        }
    }

    pub fn errno_sys_fd<Rc: SyscallRc + bun_sys::GetErrno>(rc: Rc, syscall: bun_sys::Tag, fd: bun_sys::Fd) -> Option<Self> {
        #[cfg(windows)]
        {
            if !Rc::IS_NTSTATUS {
                if !rc.is_zero() {
                    return None;
                }
            }
        }
        match bun_sys::get_errno(rc) {
            bun_sys::posix::E::SUCCESS => None,
            e => Some(Maybe::Err(bun_sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                fd,
                ..Default::default()
            })),
        }
    }

    pub fn errno_sys_p<Rc: SyscallRc + bun_sys::GetErrno>(
        rc: Rc,
        syscall: bun_sys::Tag,
        file_path: impl AsRef<[u8]>,
    ) -> Option<Self> {
        // PORT NOTE: Zig `@compileError` on `u16` paths is enforced by the
        // `AsRef<[u8]>` bound — UTF-16 slices won't satisfy it.
        #[cfg(windows)]
        {
            if !Rc::IS_NTSTATUS {
                if !rc.is_zero() {
                    return None;
                }
            }
        }
        match bun_sys::get_errno(rc) {
            bun_sys::posix::E::SUCCESS => None,
            e => Some(Maybe::Err(bun_sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                path: file_path.as_ref().into(),
                ..Default::default()
            })),
        }
    }

    pub fn errno_sys_fp<Rc: SyscallRc + bun_sys::GetErrno>(
        rc: Rc,
        syscall: bun_sys::Tag,
        fd: bun_sys::Fd,
        file_path: impl AsRef<[u8]>,
    ) -> Option<Self> {
        #[cfg(windows)]
        {
            if !Rc::IS_NTSTATUS {
                if !rc.is_zero() {
                    return None;
                }
            }
        }
        match bun_sys::get_errno(rc) {
            bun_sys::posix::E::SUCCESS => None,
            e => Some(Maybe::Err(bun_sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                fd,
                path: file_path.as_ref().into(),
                ..Default::default()
            })),
        }
    }

    pub fn errno_sys_pd<Rc: SyscallRc + bun_sys::GetErrno>(
        rc: Rc,
        syscall: bun_sys::Tag,
        file_path: impl AsRef<[u8]>,
        dest: impl AsRef<[u8]>,
    ) -> Option<Self> {
        // PORT NOTE: Zig `@compileError` on `u16` paths enforced by `AsRef<[u8]>`.
        #[cfg(windows)]
        {
            if !Rc::IS_NTSTATUS {
                if !rc.is_zero() {
                    return None;
                }
            }
        }
        match bun_sys::get_errno(rc) {
            bun_sys::posix::E::SUCCESS => None,
            e => Some(Maybe::Err(bun_sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                path: file_path.as_ref().into(),
                dest: dest.as_ref().into(),
                ..Default::default()
            })),
        }
    }
}

// phase-c: bun_css is feature-gated off the bun_bin dep graph; this inherent
// impl only exists when the `css` feature is enabled.
#[cfg(feature = "css")]
impl<R> Maybe<R, bun_css::BasicParseError> {
    #[inline]
    pub fn to_css_result(self) -> Maybe<R, bun_css::ParseError<bun_css::ParserError>> {
        // Zig comptime-switched on `ErrorTypeT`; in Rust we express each arm
        // as a separate inherent impl. The `ParseError(ParserError)` and
        // catch-all arms were `@compileError`s and need no Rust body.
        match self {
            Maybe::Result(v) => Maybe::Result(v),
            Maybe::Err(e) => Maybe::Err(e.into_default_parse_error()),
        }
    }
}

// ─── to_js: comptime @typeInfo dispatch → trait ───────────────────────────

impl<R, E> Maybe<R, E>
where
    R: MaybeToJs,
    E: MaybeToJs,
{
    pub fn to_js(
        self,
        global_object: &bun_jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<bun_jsc::JSValue> {
        match self {
            Maybe::Result(r) => r.maybe_to_js(global_object),
            Maybe::Err(e) => e.maybe_to_js(global_object),
        }
    }
}

/// Replaces the Zig `switch (ReturnType) { ... @typeInfo ... }` reflection in
/// `Maybe.toJS`. Each concrete `R`/`E` opts in by implementing this trait;
/// the Zig comptime `@typeInfo` arms map to per-type impls below.
pub trait MaybeToJs {
    fn maybe_to_js(
        self,
        global_object: &bun_jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<bun_jsc::JSValue>;
}

impl MaybeToJs for bun_jsc::JSValue {
    fn maybe_to_js(
        self,
        _global_object: &bun_jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<bun_jsc::JSValue> {
        Ok(self)
    }
}

impl MaybeToJs for () {
    fn maybe_to_js(
        self,
        _global_object: &bun_jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<bun_jsc::JSValue> {
        Ok(bun_jsc::JSValue::UNDEFINED)
    }
}

impl MaybeToJs for bool {
    fn maybe_to_js(
        self,
        _global_object: &bun_jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<bun_jsc::JSValue> {
        Ok(bun_jsc::JSValue::js_boolean(self))
    }
}

impl MaybeToJs for bun_jsc::ArrayBuffer {
    fn maybe_to_js(
        self,
        global_object: &bun_jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<bun_jsc::JSValue> {
        self.to_js(global_object)
    }
}

impl MaybeToJs for Vec<u8> {
    fn maybe_to_js(
        self,
        global_object: &bun_jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<bun_jsc::JSValue> {
        // PORT NOTE: ownership transfers to JSC (freed via
        // `MarkedArrayBuffer_deallocator` → `mi_free`); see
        // `Maybe::to_array_buffer` above for the full rationale.
        let bytes: &mut [u8] = Vec::leak(self);
        bun_jsc::ArrayBuffer::from_bytes(bytes, bun_jsc::JSType::ArrayBuffer).to_js(global_object)
    }
}

// `.int, .float` arm — `JSValue.jsNumber(r)`.
macro_rules! impl_maybe_to_js_number {
    ($($t:ty),* $(,)?) => {$(
        impl MaybeToJs for $t {
            #[inline]
            fn maybe_to_js(
                self,
                _global_object: &bun_jsc::JSGlobalObject,
            ) -> bun_jsc::JsResult<bun_jsc::JSValue> {
                Ok(bun_jsc::JSValue::from(self))
            }
        }
    )*};
}
impl_maybe_to_js_number!(i32, u32, f64, u64, usize);

// `.pointer` (zig string) arm — `ZigString.init(..).withEncoding().toJS(..)`.
impl MaybeToJs for &[u8] {
    fn maybe_to_js(
        self,
        global_object: &bun_jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<bun_jsc::JSValue> {
        use bun_jsc::ZigStringJsc as _;
        Ok(bun_str::ZigString::init(self)
            .with_encoding()
            .to_js(global_object))
    }
}

// `.err => |e| e.toJS(globalObject)` arm for the canonical `bun_sys::Error`.
impl MaybeToJs for bun_sys::Error {
    fn maybe_to_js(
        self,
        global_object: &bun_jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<bun_jsc::JSValue> {
        use bun_jsc::SysErrorJsc as _;
        Ok(self.to_js(global_object))
    }
}

// PORT NOTE: the Zig `.@"struct" / .@"enum" / .@"opaque" / .@"union"` and
// non-string `.pointer` arms forwarded to `r.toJS(globalObject)`. In Rust each
// such `R` implements `MaybeToJs` directly at its definition site (no blanket
// `@typeInfo` reflection available); add per-type impls alongside the type.

// ─── Display ──────────────────────────────────────────────────────────────

impl<R, E: fmt::Debug> fmt::Display for Maybe<R, E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Maybe::Result(_) => write!(f, "Result(...)"),
            // PORT NOTE: Zig used `bun.deprecated.autoFormatLabelFallback(E, "{any}")`,
            // which is effectively `Debug`.
            Maybe::Err(e) => write!(f, "Error({:?})", e),
        }
    }
}

// ─── helpers ──────────────────────────────────────────────────────────────

/// Abstracts over the `rc: anytype` parameter of the `errnoSys*` family.
/// On Windows the Zig checked `@TypeOf(rc) == std.os.windows.NTSTATUS` to
/// skip the `rc != 0 → null` early-out; that comptime type-compare is
/// expressed here as the `IS_NTSTATUS` associated const.
// TODO(port): impls for `isize`, `c_int`, `usize`, and (on Windows)
// `bun_sys::windows::NTSTATUS` belong in `bun_sys`.
pub trait SyscallRc: Copy {
    const IS_NTSTATUS: bool = false;
    fn is_zero(self) -> bool;
}

/// Abstracts over the `err: anytype` parameter of `translateToErrInt`.
pub trait IntoErrInt: Copy {
    fn into_err_int(self) -> u16;
}

impl IntoErrInt for bun_sys::posix::E {
    fn into_err_int(self) -> bun_sys::ErrorInt {
        // @truncate(@intFromEnum(err)) — SystemErrno is #[repr(u16)], ErrorInt = u16.
        self as bun_sys::ErrorInt
    }
}

#[cfg(windows)]
impl IntoErrInt for bun_sys::windows::NTSTATUS {
    fn into_err_int(self) -> bun_sys::ErrorInt {
        // Zig: `@intFromEnum(bun.windows.translateNTStatusToErrno(err))`
        bun_sys::windows::translate_ntstatus_to_errno(self) as bun_sys::ErrorInt
    }
}

fn translate_to_err_int<Er: IntoErrInt>(err: Er) -> u16 {
    err.into_err_int()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node.zig (367 lines)
//   notes:      Maybe<R,E> ported as Rust enum; @hasDecl/@typeInfo dispatch
//               replaced with MaybeErrorRetry/MaybeErrorTodo/MaybeToJs/
//               SyscallRc/IntoErrInt traits. All node/ submodules wired.
// ──────────────────────────────────────────────────────────────────────────
