//! Node.js APIs in Bun. Access this namespace with `bun.api.node`

// NOTE: the Zig `comptime { _ = @import(...) }` force-reference block is
// dropped — Rust links what's `pub`.

use core::fmt;

use bun_jsc::{self as jsc, ArrayBuffer, JSGlobalObject, JSValue, JsResult};
use bun_sys::{self as sys, Fd, SystemErrno};

// ─── submodule re-exports ─────────────────────────────────────────────────
// TODO(port): Phase B wires the `mod` declarations for the `node/` subdir;
// these `pub use` lines mirror the Zig `pub const X = @import("./node/...")`.

/// node:fs
pub use crate::node::node_fs as fs;
/// node:path
pub use crate::node::path;
/// node:crypto
pub use crate::node::node_crypto_binding as crypto;
/// node:os
pub use crate::node::node_os as os;
/// node:process
pub use crate::node::node_process as process;
pub use crate::node::util::validators;
pub use crate::node::nodejs_error_code::Code as ErrorCode;

pub use jsc::MarkedArrayBuffer as Buffer;

pub use self::types::PathOrBlob;
pub use self::types::Dirent;
pub use self::types::FileSystemFlags;
pub use self::types::PathOrFileDescriptor;
pub use self::types::mode_from_js;
pub use self::types::VectorArrayBuffer;
pub use self::types::Valid;
pub use self::types::PathLike;
pub use self::types::CallbackTask;
pub use self::types::PathOrBuffer;
pub use self::types::js_assert_encoding_valid;
pub use self::types::Encoding;
pub use self::types::StringOrBuffer;
pub use self::types::BlobOrStringOrBuffer;

pub use crate::node::fs_events as FSEvents;
pub use self::stat::Stats;
pub use self::stat::StatsBig;
pub use self::stat::StatsSmall;

pub use self::statfs::StatFSSmall;
pub use self::statfs::StatFSBig;
pub use self::statfs::StatFS;

#[cfg(unix)]
pub type uid_t = bun_sys::posix::uid_t;
#[cfg(not(unix))]
pub type uid_t = bun_sys::windows::libuv::uv_uid_t;

#[cfg(unix)]
pub type gid_t = bun_sys::posix::gid_t;
#[cfg(not(unix))]
pub type gid_t = bun_sys::windows::libuv::uv_gid_t;

pub use crate::node::time_like;
pub use self::time_like::TimeLike;
pub use self::time_like::from_js as time_like_from_js;

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
    pub type ErrorType = E;
    pub type ReturnType = R;

    pub type Tag = MaybeTag;

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

impl<R> Maybe<R, sys::Error> {
    /// This value is technically garbage, but that is okay as `.aborted` is
    /// only meant to be returned in an operation when there is an aborted
    /// `AbortSignal` object associated with the operation.
    pub fn aborted() -> Self {
        Maybe::Err(sys::Error {
            errno: sys::posix::E::INTR as sys::ErrorInt,
            syscall: sys::Tag::access,
            ..Default::default()
        })
    }

    pub fn unwrap(self) -> Result<R, bun_core::Error> {
        // TODO(port): narrow error set
        match self {
            Maybe::Result(r) => Ok(r),
            Maybe::Err(e) => Err(bun_core::errno_to_zig_err(e.errno)),
        }
    }

    #[inline]
    pub fn init_err_with_p(
        e: SystemErrno,
        syscall: sys::Tag,
        file_path: impl AsRef<[u8]>,
    ) -> Maybe<R, sys::Error> {
        Maybe::Err(sys::Error {
            errno: e as sys::ErrorInt,
            syscall,
            path: file_path.as_ref().into(),
            ..Default::default()
        })
    }

    pub fn to_array_buffer(self, global_object: &JSGlobalObject) -> JSValue
    where
        R: Into<Vec<u8>>,
    {
        match self {
            Maybe::Result(r) => {
                ArrayBuffer::from_bytes(r.into(), jsc::TypedArrayType::ArrayBuffer)
                    .to_js(global_object, None)
            }
            Maybe::Err(e) => e.to_js(global_object),
        }
    }

    pub fn get_errno(self) -> sys::posix::E {
        match self {
            Maybe::Result(_) => sys::posix::E::SUCCESS,
            Maybe::Err(e) => {
                // SAFETY: `e.errno` was produced from `@intFromEnum(posix.E)` /
                // `translateToErrInt`, so it is always a valid `posix::E`
                // discriminant.
                unsafe { core::mem::transmute::<sys::ErrorInt, sys::posix::E>(e.errno) }
            }
        }
    }

    pub fn errno_sys<Rc: SyscallRc>(rc: Rc, syscall: sys::Tag) -> Option<Self> {
        #[cfg(windows)]
        {
            if !Rc::IS_NTSTATUS {
                if !rc.is_zero() {
                    return None;
                }
            }
        }
        match sys::get_errno(rc) {
            sys::posix::E::SUCCESS => None,
            e => Some(Maybe::Err(sys::Error {
                // always truncate
                errno: translate_to_err_int(e),
                syscall,
                ..Default::default()
            })),
        }
    }

    pub fn errno<Er: IntoErrInt>(err: Er, syscall: sys::Tag) -> Self {
        Maybe::Err(sys::Error {
            // always truncate
            errno: translate_to_err_int(err),
            syscall,
            ..Default::default()
        })
    }

    pub fn errno_sys_fd<Rc: SyscallRc>(rc: Rc, syscall: sys::Tag, fd: Fd) -> Option<Self> {
        #[cfg(windows)]
        {
            if !Rc::IS_NTSTATUS {
                if !rc.is_zero() {
                    return None;
                }
            }
        }
        match sys::get_errno(rc) {
            sys::posix::E::SUCCESS => None,
            e => Some(Maybe::Err(sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                fd,
                ..Default::default()
            })),
        }
    }

    pub fn errno_sys_p<Rc: SyscallRc>(
        rc: Rc,
        syscall: sys::Tag,
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
        match sys::get_errno(rc) {
            sys::posix::E::SUCCESS => None,
            e => Some(Maybe::Err(sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                path: bun_str::as_byte_slice(file_path.as_ref()).into(),
                ..Default::default()
            })),
        }
    }

    pub fn errno_sys_fp<Rc: SyscallRc>(
        rc: Rc,
        syscall: sys::Tag,
        fd: Fd,
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
        match sys::get_errno(rc) {
            sys::posix::E::SUCCESS => None,
            e => Some(Maybe::Err(sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                fd,
                path: bun_str::as_byte_slice(file_path.as_ref()).into(),
                ..Default::default()
            })),
        }
    }

    pub fn errno_sys_pd<Rc: SyscallRc>(
        rc: Rc,
        syscall: sys::Tag,
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
        match sys::get_errno(rc) {
            sys::posix::E::SUCCESS => None,
            e => Some(Maybe::Err(sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                path: bun_str::as_byte_slice(file_path.as_ref()).into(),
                dest: bun_str::as_byte_slice(dest.as_ref()).into(),
                ..Default::default()
            })),
        }
    }
}

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
    pub fn to_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Maybe::Result(r) => r.maybe_to_js(global_object),
            Maybe::Err(e) => e.maybe_to_js(global_object),
        }
    }
}

/// Replaces the Zig `switch (ReturnType) { ... @typeInfo ... }` reflection in
/// `Maybe.toJS`. Each concrete `R`/`E` opts in by implementing this trait.
// TODO(port): proc-macro / blanket impls for numeric & struct types may be
// preferable in Phase B; the explicit impls below cover the arms the Zig
// `switch` handled directly.
pub trait MaybeToJs {
    fn maybe_to_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue>;
}

impl MaybeToJs for JSValue {
    fn maybe_to_js(self, _global_object: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(self)
    }
}

impl MaybeToJs for () {
    fn maybe_to_js(self, _global_object: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
}

impl MaybeToJs for bool {
    fn maybe_to_js(self, _global_object: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::from(self))
    }
}

impl MaybeToJs for ArrayBuffer {
    fn maybe_to_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_js(global_object)
    }
}

impl MaybeToJs for Vec<u8> {
    fn maybe_to_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        ArrayBuffer::from_bytes(self, jsc::TypedArrayType::ArrayBuffer).to_js(global_object)
    }
}

// TODO(port): the Zig fallback arms dispatched on `@typeInfo(ReturnType)`:
//   .int/.float          => JSValue.jsNumber(r)
//   .struct/.enum/.opaque/.union => r.toJS(globalObject)
//   .pointer (zig string) => ZigString.init(..).withEncoding().toJS(..)
//   .pointer (other)     => r.toJS(globalObject)
// In Rust these become per-type `MaybeToJs` impls (or a blanket
// `impl<T: jsc::ToJs> MaybeToJs for T`). Phase B should add the blanket impl
// once `jsc::ToJs` exists; left intentionally un-generated here.

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
    fn into_err_int(self) -> sys::ErrorInt;
}

impl IntoErrInt for sys::posix::E {
    fn into_err_int(self) -> sys::ErrorInt {
        // @truncate(@intFromEnum(err))
        self as sys::ErrorInt
    }
}

#[cfg(windows)]
impl IntoErrInt for bun_sys::windows::NTSTATUS {
    fn into_err_int(self) -> sys::ErrorInt {
        bun_sys::windows::translate_ntstatus_to_errno(self) as sys::ErrorInt
    }
}

fn translate_to_err_int<Er: IntoErrInt>(err: Er) -> sys::ErrorInt {
    err.into_err_int()
}

// ─── private module aliases (mirrors bottom-of-file `@import`s) ───────────

use crate::node::stat;
use crate::node::statfs;
use crate::node::types;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node.zig (367 lines)
//   confidence: medium
//   todos:      8
//   notes:      Maybe<R,E> ported as Rust enum; @hasDecl/@typeInfo dispatch replaced with MaybeErrorRetry/MaybeErrorTodo/MaybeToJs/SyscallRc traits — Phase B must add blanket/per-type impls and wire node/ submodule decls.
// ──────────────────────────────────────────────────────────────────────────
