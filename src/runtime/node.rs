//! Node.js APIs in Bun. Access this namespace with `bun.api.node`

// NOTE: the Zig `comptime { _ = @import(...) }` force-reference block is
// dropped — Rust links what's `pub`.

use core::fmt;

// ─── compiling submodules ─────────────────────────────────────────────────
#[path = "node/nodejs_error_code.rs"]
pub mod nodejs_error_code;
pub use nodejs_error_code::Code as ErrorCode;

// ─── submodule re-exports ─────────────────────────────────────────────────
// All `node/` subdir modules depend heavily on `bun_jsc` (currently broken
// under concurrent B-2 work) — gated until the lower tier is green.
// Phase-A drafts remain on disk; see #[cfg(any())] block below.
#[cfg(any())]
mod _gated_submods {
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

    pub use bun_jsc::MarkedArrayBuffer as Buffer;

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

    pub use crate::node::time_like;
    pub use self::time_like::TimeLike;
    pub use self::time_like::from_js as time_like_from_js;

    use crate::node::stat;
    use crate::node::statfs;
    use crate::node::types;
}

#[cfg(unix)]
pub type uid_t = libc::uid_t;
#[cfg(not(unix))]
pub type uid_t = u32; // TODO(b2-blocked): bun_sys::windows::libuv::uv_uid_t

#[cfg(unix)]
pub type gid_t = libc::gid_t;
#[cfg(not(unix))]
pub type gid_t = u32; // TODO(b2-blocked): bun_sys::windows::libuv::uv_gid_t

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
// Gated: depends on `bun_sys::ErrorInt` (missing), `bun_sys::posix::E::INTR`/
// `SUCCESS` shape, `bun_sys::Tag::access` (missing), `bun_core::errno_to_zig_err`
// (missing), and `bun_jsc::{ArrayBuffer, JSGlobalObject, JSValue}` method
// surface (bun_jsc broken).
#[cfg(any())]
impl<R> Maybe<R, bun_sys::Error> {
    /// This value is technically garbage, but that is okay as `.aborted` is
    /// only meant to be returned in an operation when there is an aborted
    /// `AbortSignal` object associated with the operation.
    pub fn aborted() -> Self {
        // TODO(b2-blocked): bun_sys::Tag::access
        // TODO(b2-blocked): bun_sys::ErrorInt
        Maybe::Err(bun_sys::Error {
            errno: bun_sys::posix::E::INTR as bun_sys::ErrorInt,
            syscall: bun_sys::Tag::access,
            ..Default::default()
        })
    }

    pub fn unwrap(self) -> Result<R, bun_core::Error> {
        // TODO(port): narrow error set
        // TODO(b2-blocked): bun_core::errno_to_zig_err
        match self {
            Maybe::Result(r) => Ok(r),
            Maybe::Err(e) => Err(bun_core::errno_to_zig_err(e.errno)),
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

    pub fn to_array_buffer(self, global_object: &crate::jsc::JSGlobalObject) -> crate::jsc::JSValue
    where
        R: Into<Vec<u8>>,
    {
        // TODO(b2-blocked): bun_jsc::ArrayBuffer::from_bytes
        // TODO(b2-blocked): bun_jsc::TypedArrayType
        match self {
            Maybe::Result(r) => {
                bun_jsc::ArrayBuffer::from_bytes(r.into(), bun_jsc::TypedArrayType::ArrayBuffer)
                    .to_js(global_object, None)
            }
            Maybe::Err(e) => e.to_js(global_object),
        }
    }

    pub fn get_errno(self) -> bun_sys::posix::E {
        match self {
            Maybe::Result(_) => bun_sys::posix::E::SUCCESS,
            Maybe::Err(e) => {
                // SAFETY: `e.errno` was produced from `@intFromEnum(posix.E)` /
                // `translateToErrInt`, so it is always a valid `posix::E`
                // discriminant.
                unsafe { core::mem::transmute::<bun_sys::ErrorInt, bun_sys::posix::E>(e.errno) }
            }
        }
    }

    pub fn errno_sys<Rc: SyscallRc>(rc: Rc, syscall: bun_sys::Tag) -> Option<Self> {
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

    pub fn errno<Er: IntoErrInt>(err: Er, syscall: bun_sys::Tag) -> Self {
        Maybe::Err(bun_sys::Error {
            // always truncate
            errno: translate_to_err_int(err),
            syscall,
            ..Default::default()
        })
    }

    pub fn errno_sys_fd<Rc: SyscallRc>(rc: Rc, syscall: bun_sys::Tag, fd: bun_sys::Fd) -> Option<Self> {
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

    pub fn errno_sys_p<Rc: SyscallRc>(
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
                path: bun_str::as_byte_slice(file_path.as_ref()).into(),
                ..Default::default()
            })),
        }
    }

    pub fn errno_sys_fp<Rc: SyscallRc>(
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
                path: bun_str::as_byte_slice(file_path.as_ref()).into(),
                ..Default::default()
            })),
        }
    }

    pub fn errno_sys_pd<Rc: SyscallRc>(
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
                path: bun_str::as_byte_slice(file_path.as_ref()).into(),
                dest: bun_str::as_byte_slice(dest.as_ref()).into(),
                ..Default::default()
            })),
        }
    }
}

// Gated: bun_css::BasicParseError lacks `into_default_parse_error`.
#[cfg(any())]
impl<R> Maybe<R, bun_css::BasicParseError> {
    #[inline]
    pub fn to_css_result(self) -> Maybe<R, bun_css::ParseError<bun_css::ParserError>> {
        // TODO(b2-blocked): bun_css::BasicParseError::into_default_parse_error
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
// Gated: bun_jsc broken; JSValue/ArrayBuffer have no methods on stub.
#[cfg(any())]
mod _gated_to_js {
    use super::*;
    use bun_jsc::{ArrayBuffer, JSGlobalObject, JSValue, JsResult};

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
            // TODO(b2-blocked): bun_jsc::JSValue::UNDEFINED
            Ok(JSValue::UNDEFINED)
        }
    }

    impl MaybeToJs for bool {
        fn maybe_to_js(self, _global_object: &JSGlobalObject) -> JsResult<JSValue> {
            // TODO(b2-blocked): bun_jsc::JSValue::from(bool)
            Ok(JSValue::from(self))
        }
    }

    impl MaybeToJs for ArrayBuffer {
        fn maybe_to_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            // TODO(b2-blocked): bun_jsc::ArrayBuffer::to_js
            self.to_js(global_object)
        }
    }

    impl MaybeToJs for Vec<u8> {
        fn maybe_to_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
            ArrayBuffer::from_bytes(self, bun_jsc::TypedArrayType::ArrayBuffer).to_js(global_object)
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
}

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

// Gated: depends on bun_sys::posix::E enum repr matching ErrorInt and
// bun_sys::windows::translate_ntstatus_to_errno.
#[cfg(any())]
mod _gated_err_int {
    use super::*;
    impl IntoErrInt for bun_sys::posix::E {
        fn into_err_int(self) -> bun_sys::ErrorInt {
            // @truncate(@intFromEnum(err))
            // TODO(b2-blocked): bun_sys::ErrorInt
            self as bun_sys::ErrorInt
        }
    }

    #[cfg(windows)]
    impl IntoErrInt for bun_sys::windows::NTSTATUS {
        fn into_err_int(self) -> bun_sys::ErrorInt {
            // TODO(b2-blocked): bun_sys::windows::translate_ntstatus_to_errno
            bun_sys::windows::translate_ntstatus_to_errno(self) as bun_sys::ErrorInt
        }
    }
}

fn translate_to_err_int<Er: IntoErrInt>(err: Er) -> u16 {
    err.into_err_int()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node.zig (367 lines)
//   confidence: medium
//   todos:      8
//   notes:      Maybe<R,E> ported as Rust enum; @hasDecl/@typeInfo dispatch replaced with MaybeErrorRetry/MaybeErrorTodo/MaybeToJs/SyscallRc traits — Phase B must add blanket/per-type impls and wire node/ submodule decls.
// ──────────────────────────────────────────────────────────────────────────
