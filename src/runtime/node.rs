//! Node.js APIs in Bun. Access this namespace with `bun.api.node`

// ─── compiling submodules ─────────────────────────────────────────────────
#[path = "node/nodejs_error_code.rs"]
pub mod nodejs_error_code;
pub use nodejs_error_code::Code as ErrorCode;

#[path = "node/assert/myers_diff.rs"]
pub mod myers_diff_impl;
pub mod assert {
    pub use super::myers_diff_impl as myers_diff;
}

#[path = "node/types.rs"]
pub mod types;
pub use types::{
    BlobOrStringOrBuffer, CallbackTask, Dirent, Encoding, FileSystemFlags, PathLike, PathOrBlob,
    PathOrBuffer, PathOrFileDescriptor, StringOrBuffer, Valid, VectorArrayBuffer,
    js_assert_encoding_valid, mode_from_js,
};

pub use bun_jsc::MarkedArrayBuffer as Buffer;

#[path = "node/path.rs"]
pub mod path;

#[path = "node/node_os.rs"]
pub mod os;
// codegen (`generated_js2native.rs`) addresses this by its file-stem name.
pub use os as node_os;

#[path = "node/node_process.rs"]
pub mod process;

#[path = "node/node_crypto_binding.rs"]
pub mod crypto;
// codegen (`generated_js2native.rs`) addresses this by its file-stem name.
pub use crypto as node_crypto_binding;

#[path = "node/fs_events.rs"]
pub mod fs_events;
pub use fs_events as FSEvents;

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
pub use time_like::{TimeLike, from_js as time_like_from_js};

#[path = "node/dir_iterator.rs"]
pub mod dir_iterator;

#[path = "node/node_fs_constant.rs"]
pub mod node_fs_constant;

#[path = "node/util/parse_args.rs"]
pub mod parse_args_impl;
#[path = "node/util/parse_args_utils.rs"]
pub mod parse_args_utils;
#[path = "node/util/validators.rs"]
pub mod validators_impl;
pub mod util {
    pub use super::parse_args_impl as parse_args;
    pub use super::parse_args_utils;
    pub use super::validators_impl as validators;
}
pub use util::validators;

pub mod dirent {
    pub use super::types::Dirent;
    pub use super::types::DirentKind as Kind;
}

#[path = "node/node_fs.rs"]
pub mod fs;

// fs.watch() / fs.watchFile() backends — declared here so `fs::watch` /
// `fs::watch_file` can reach the real `Arguments` / `FSWatcher` /
// `StatWatcher` types instead of opaque local stand-ins.
#[path = "node/node_fs_binding.rs"]
pub mod node_fs_binding;
#[path = "node/node_fs_stat_watcher.rs"]
pub mod node_fs_stat_watcher;
#[path = "node/node_fs_watcher.rs"]
pub mod node_fs_watcher;
#[path = "node/path_watcher.rs"]
pub mod path_watcher;
#[cfg(windows)]
#[path = "node/uv_signal_handle_windows.rs"]
pub mod uv_signal_handle_windows;
#[cfg(windows)]
#[path = "node/win_watcher.rs"]
pub mod win_watcher;

// Type defs + non-JSC FFI bodies are live; every `#[bun_jsc::host_fn]` /
// `#[bun_jsc::JsClass]` item is wrapped in ` mod _impl` inside
// each file. dgram/tls/tty have no `.rs` ports yet — nothing to wire.
#[path = "node/buffer.rs"]
pub mod buffer;

#[path = "node/node_cluster_binding.rs"]
pub mod node_cluster_binding;

#[path = "node/node_net_binding.rs"]
pub mod node_net_binding;

#[path = "node/node_http_binding.rs"]
pub mod node_http_binding;

#[path = "node/node_util_binding.rs"]
pub mod node_util_binding;

#[path = "node/node_assert.rs"]
pub mod node_assert;

#[path = "node/node_assert_binding.rs"]
pub mod node_assert_binding;

#[path = "node/node_error_binding.rs"]
pub mod node_error_binding;

#[path = "node/node_zlib_binding.rs"]
pub mod node_zlib_binding;

#[path = "node/net/BlockList.rs"]
pub mod block_list_impl;
pub mod net {
    pub use super::block_list_impl as block_list;
}

#[path = "node/zlib/NativeBrotli.rs"]
pub mod native_brotli_impl;
#[path = "node/zlib/NativeZlib.rs"]
pub mod native_zlib_impl;
#[path = "node/zlib/NativeZstd.rs"]
pub mod native_zstd_impl;
pub mod zlib {
    // Re-export so `super::NodeMode` resolves inside the gated NativeZstd body.
    pub use super::native_brotli_impl as native_brotli;
    pub use super::native_zlib_impl as native_zlib;
    pub use super::native_zstd_impl as native_zstd;
    pub use bun_zlib::NodeMode;
}

// ─── submodule re-exports ─────────────────────────────────────────────────

#[cfg(unix)]
pub type uid_t = libc::uid_t;
#[cfg(not(unix))]
pub type uid_t = bun_sys::windows::libuv::uv_uid_t;

#[cfg(unix)]
pub type gid_t = libc::gid_t;
#[cfg(not(unix))]
pub type gid_t = bun_sys::windows::libuv::uv_gid_t;

pub type Maybe<R, E = bun_sys::Error> = core::result::Result<R, E>;

// `union(enum)` → Rust enum is the tagged union; the explicit `Tag` enum is
// kept only for source parity with the Zig.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum MaybeTag {
    Err,
    Result,
}

/// Generic helper surface that the Zig `Maybe(R, E)` carried as inherent
/// methods. `unwrap_or`/`is_ok`/`is_err`/`map_err` are already provided by
/// `core::result::Result`, so only the Zig-specific constructors remain here.
pub trait MaybeExt<R, E>: Sized {
    fn todo() -> Self
    where
        E: MaybeErrorTodo;
    fn init_err(e: E) -> Self;
    fn init_result(result: R) -> Self;
    fn as_err(&self) -> Option<&E>;
    fn as_value(&self) -> Option<&R>;
    fn success() -> Self
    where
        R: Default;
    fn retry() -> Self
    where
        E: MaybeErrorRetry;
}

impl<R, E> MaybeExt<R, E> for Maybe<R, E> {
    #[inline]
    fn todo() -> Self
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
        Err(E::todo())
    }

    #[inline]
    fn init_err(e: E) -> Self {
        Err(e)
    }

    #[inline]
    fn init_result(result: R) -> Self {
        Ok(result)
    }

    #[inline]
    fn as_err(&self) -> Option<&E> {
        self.as_ref().err()
    }

    #[inline]
    fn as_value(&self) -> Option<&R> {
        self.as_ref().ok()
    }

    #[inline]
    fn success() -> Self
    where
        R: Default,
    {
        // PORT NOTE: Zig used `std.mem.zeroes(ReturnType)`. Mapped to
        // `Default` here since the generic `R` may contain non-POD fields.
        Ok(R::default())
    }

    #[inline]
    fn retry() -> Self
    where
        E: MaybeErrorRetry,
    {
        Err(E::retry())
    }
}

/// `Maybe<bool, E>::is_true()` — Zig `if (comptime ReturnType != bool)
/// @compileError(...)` enforced by impl bound.
pub trait MaybeBoolExt {
    fn is_true(self) -> bool;
}
impl<E> MaybeBoolExt for Maybe<bool, E> {
    #[inline]
    fn is_true(self) -> bool {
        matches!(self, Ok(true))
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

pub trait MaybeTodo: Sized {
    fn todo() -> Self;
}

impl<T> MaybeTodo for core::result::Result<T, bun_sys::Error> {
    #[inline]
    fn todo() -> Self {
        Err(bun_sys::Error::todo())
    }
}

// ─── methods that assume `E` carries an errno (i.e. `bun_sys::Error`) ─────

pub trait MaybeSysExt<R>: Sized {
    fn aborted() -> Self;
    fn init_err_with_p(
        e: bun_sys::SystemErrno,
        syscall: bun_sys::Tag,
        file_path: impl AsRef<[u8]>,
    ) -> Self;
    fn to_array_buffer(
        self,
        global_object: &crate::jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<crate::jsc::JSValue>
    where
        R: Into<Vec<u8>>;
    fn errno<Er: IntoErrInt>(err: Er, syscall: bun_sys::Tag) -> Self;
    fn errno_sys<Rc: SyscallRc>(rc: Rc, syscall: bun_sys::Tag) -> Option<Self>;
    fn errno_sys_fd<Rc: SyscallRc>(rc: Rc, syscall: bun_sys::Tag, fd: bun_sys::Fd) -> Option<Self>;
    fn errno_sys_p<Rc: SyscallRc>(
        rc: Rc,
        syscall: bun_sys::Tag,
        file_path: impl AsRef<[u8]>,
    ) -> Option<Self>;
    fn errno_sys_fp<Rc: SyscallRc>(
        rc: Rc,
        syscall: bun_sys::Tag,
        fd: bun_sys::Fd,
        file_path: impl AsRef<[u8]>,
    ) -> Option<Self>;
    fn errno_sys_pd<Rc: SyscallRc>(
        rc: Rc,
        syscall: bun_sys::Tag,
        file_path: impl AsRef<[u8]>,
        dest: impl AsRef<[u8]>,
    ) -> Option<Self>;
}

impl<R> MaybeSysExt<R> for Maybe<R, bun_sys::Error> {
    /// This value is technically garbage, but that is okay as `.aborted` is
    /// only meant to be returned in an operation when there is an aborted
    /// `AbortSignal` object associated with the operation.
    #[inline]
    fn aborted() -> Self {
        Err(bun_sys::Error {
            // PORT NOTE: Zig `posix.E.INTR` → `SystemErrno::EINTR` (variants keep `E` prefix).
            errno: bun_sys::posix::E::EINTR as bun_sys::ErrorInt,
            syscall: bun_sys::Tag::access,
            ..Default::default()
        })
    }

    #[inline]
    fn init_err_with_p(
        e: bun_sys::SystemErrno,
        syscall: bun_sys::Tag,
        file_path: impl AsRef<[u8]>,
    ) -> Self {
        Err(bun_sys::Error {
            errno: e as bun_sys::ErrorInt,
            syscall,
            path: file_path.as_ref().into(),
            ..Default::default()
        })
    }

    fn to_array_buffer(
        self,
        global_object: &crate::jsc::JSGlobalObject,
    ) -> bun_jsc::JsResult<crate::jsc::JSValue>
    where
        R: Into<Vec<u8>>,
    {
        use bun_jsc::SysErrorJsc as _;
        match self {
            Ok(r) => {
                let bytes: &mut [u8] = Vec::leak(r.into());
                bun_jsc::ArrayBuffer::from_bytes(bytes, bun_jsc::JSType::ArrayBuffer)
                    .to_js(global_object)
            }
            Err(e) => Ok(e.to_js(global_object)),
        }
    }

    #[inline]
    fn errno<Er: IntoErrInt>(err: Er, syscall: bun_sys::Tag) -> Self {
        Err(bun_sys::Error {
            // always truncate
            errno: translate_to_err_int(err),
            syscall,
            ..Default::default()
        })
    }

    fn errno_sys<Rc: SyscallRc>(rc: Rc, syscall: bun_sys::Tag) -> Option<Self> {
        #[cfg(windows)]
        {
            if !Rc::IS_NTSTATUS {
                if !rc.is_zero() {
                    return None;
                }
            }
        }
        match rc.syscall_errno() {
            bun_sys::posix::E::SUCCESS => None,
            e => Some(Err(bun_sys::Error {
                // always truncate
                errno: translate_to_err_int(e),
                syscall,
                ..Default::default()
            })),
        }
    }

    fn errno_sys_fd<Rc: SyscallRc>(rc: Rc, syscall: bun_sys::Tag, fd: bun_sys::Fd) -> Option<Self> {
        #[cfg(windows)]
        {
            if !Rc::IS_NTSTATUS {
                if !rc.is_zero() {
                    return None;
                }
            }
        }
        match rc.syscall_errno() {
            bun_sys::posix::E::SUCCESS => None,
            e => Some(Err(bun_sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                fd,
                ..Default::default()
            })),
        }
    }

    fn errno_sys_p<Rc: SyscallRc>(
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
        match rc.syscall_errno() {
            bun_sys::posix::E::SUCCESS => None,
            e => Some(Err(bun_sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                path: file_path.as_ref().into(),
                ..Default::default()
            })),
        }
    }

    fn errno_sys_fp<Rc: SyscallRc>(
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
        match rc.syscall_errno() {
            bun_sys::posix::E::SUCCESS => None,
            e => Some(Err(bun_sys::Error {
                // Always truncate
                errno: translate_to_err_int(e),
                syscall,
                fd,
                path: file_path.as_ref().into(),
                ..Default::default()
            })),
        }
    }

    fn errno_sys_pd<Rc: SyscallRc>(
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
        match rc.syscall_errno() {
            bun_sys::posix::E::SUCCESS => None,
            e => Some(Err(bun_sys::Error {
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

pub trait MaybeCssExt<R>: Sized {
    fn to_css_result(self) -> Maybe<R, bun_css::ParseError<bun_css::ParserError>>;
}
impl<R> MaybeCssExt<R> for Maybe<R, bun_css::BasicParseError> {
    #[inline]
    fn to_css_result(self) -> Maybe<R, bun_css::ParseError<bun_css::ParserError>> {
        // Zig comptime-switched on `ErrorTypeT`; in Rust we express each arm
        // as a separate trait impl. The `ParseError(ParserError)` and
        // catch-all arms were `@compileError`s and need no Rust body.
        self.map_err(|e| e.into_default_parse_error())
    }
}

// ─── to_js: comptime @typeInfo dispatch → trait ───────────────────────────

/// `Maybe::to_js` — extension trait now that `Maybe` is a `Result` alias.
pub trait MaybeToJsExt {
    fn to_js(self, global_object: &bun_jsc::JSGlobalObject) -> bun_jsc::JsResult<bun_jsc::JSValue>;
}

impl<R, E> MaybeToJsExt for Maybe<R, E>
where
    R: MaybeToJs,
    E: MaybeToJs,
{
    fn to_js(self, global_object: &bun_jsc::JSGlobalObject) -> bun_jsc::JsResult<bun_jsc::JSValue> {
        match self {
            Ok(r) => r.maybe_to_js(global_object),
            Err(e) => e.maybe_to_js(global_object),
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
        // `MaybeSysExt::to_array_buffer` above for the full rationale.
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
        Ok(bun_core::ZigString::init(self)
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

// PORT NOTE: the Zig `Maybe.format` (Display) impl is dropped — `Maybe` is now
// `core::result::Result`, which already has `Debug`, and a foreign `Display`
// impl on a foreign type is not expressible. No call sites depended on it.

// ─── helpers ──────────────────────────────────────────────────────────────

pub trait SyscallRc: Copy {
    const IS_NTSTATUS: bool = false;
    fn is_zero(self) -> bool;
    fn syscall_errno(self) -> bun_sys::posix::E;
}

// Integer rc types: Windows path applies the `rc != 0 → None` short-circuit
// (Zig spec: `if (rc != 0) return null;` in the non-NTSTATUS arm).
macro_rules! impl_syscall_rc_int {
    ($($t:ty),* $(,)?) => {$(
        impl SyscallRc for $t {
            #[inline] fn is_zero(self) -> bool { self == 0 }
            #[inline] fn syscall_errno(self) -> bun_sys::posix::E {
                // Trait-method dispatch (NOT the Windows free fn) so the
                // per-OS `GetErrno for $t` impl is selected.
                <$t as bun_sys::GetErrno>::get_errno(self)
            }
        }
    )*};
}
impl_syscall_rc_int!(i32, i64, isize, u32, usize);
#[cfg(windows)]
impl_syscall_rc_int!(u64);

#[cfg(windows)]
impl SyscallRc for bun_sys::windows::NTSTATUS {
    const IS_NTSTATUS: bool = true;
    #[inline]
    fn is_zero(self) -> bool {
        self.0 == 0
    }
    #[inline]
    fn syscall_errno(self) -> bun_sys::posix::E {
        // Zig windows_errno.zig:286: NTSTATUS arm of `getErrno` →
        // `bun.windows.translateNTStatusToErrno(rc)`. Do NOT fall through to
        // `GetLastError()`.
        bun_sys::windows::translate_ntstatus_to_errno(self)
    }
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

// ported from: src/runtime/node.zig
