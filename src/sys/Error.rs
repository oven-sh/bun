//! Error type that preserves useful information from the operating system

use core::ffi::c_int;
use core::fmt;

use crate::SystemError;
use bun_core::String as BunString;

use crate::{E, Fd, SystemErrno, Tag, coreutils_error_map, libuv_error_map};

/// `Fd::unwrap_valid` — Some(fd) if fd != invalid_fd. Port of `bun.FD.unwrapValid`.
#[inline]
fn fd_unwrap_valid(fd: Fd) -> Option<Fd> {
    if fd == Fd::INVALID { None } else { Some(fd) }
}

#[cfg(windows)]
const RETRY_ERRNO: Int = E::EINTR as Int;
#[cfg(not(windows))]
const RETRY_ERRNO: Int = E::EAGAIN as Int;

const TODO_ERRNO: Int = Int::MAX - 1;

pub(crate) type Int = u16;

#[derive(Clone, Debug)]
pub struct Error {
    pub errno: Int,
    pub fd: Fd,
    #[cfg(windows)]
    pub from_libuv: bool,
    // Box<[u8]> per PORTING.md; `with_path*` eagerly clones. Revisit if
    // profiling shows regressions.
    pub path: Box<[u8]>,
    pub syscall: Tag,
    pub dest: Box<[u8]>,
}

impl Default for Error {
    fn default() -> Self {
        Self {
            errno: TODO_ERRNO,
            fd: Fd::INVALID,
            #[cfg(windows)]
            from_libuv: false,
            path: Box::default(),
            syscall: Tag::TODO,
            dest: Box::default(),
        }
    }
}

// `#[derive(Clone)]` deep-copies the Box<[u8]> fields; Box<[u8]> frees on Drop.

/// Anything that names an OS errno value. Used by
/// `Error::from_code`/`Error::new`.
pub trait IntoErrnoInt {
    fn into_errno_int(self) -> Int;
}
impl IntoErrnoInt for E {
    #[inline]
    fn into_errno_int(self) -> Int {
        self as Int
    }
}
// On POSIX `E` is a `type` alias for `SystemErrno` (same type → duplicate impl);
// on Windows they are distinct enums, so the second impl is required.
#[cfg(windows)]
impl IntoErrnoInt for SystemErrno {
    #[inline]
    fn into_errno_int(self) -> Int {
        self as Int
    }
}
impl IntoErrnoInt for u16 {
    #[inline]
    fn into_errno_int(self) -> Int {
        self
    }
}
impl IntoErrnoInt for i32 {
    #[inline]
    fn into_errno_int(self) -> Int {
        // Only Windows
        // (libuv negative codes) takes the absolute value; on POSIX a negative errno is
        // a caller bug, so panic.
        #[cfg(windows)]
        {
            self.unsigned_abs() as Int
        }
        #[cfg(not(windows))]
        {
            Int::try_from(self).expect("errno must be non-negative on POSIX")
        }
    }
}

impl Error {
    /// `Error::new(errno, tag)` — dispatches via `IntoErrnoInt` so a single
    /// constructor covers `E`, `SystemErrno`, raw `u16` (libuv `ReturnCode::errno`)
    /// and `i32`.
    #[inline]
    pub fn new<C: IntoErrnoInt>(errno: C, syscall_tag: Tag) -> Error {
        Error {
            errno: errno.into_errno_int(),
            syscall: syscall_tag,
            ..Default::default()
        }
    }

    /// `Some(err)` when a libuv `ReturnCode` is negative; `None` on success.
    /// `ReturnCode::errno()` already maps the `UV_E*` code to the POSIX `E`
    /// discriminant, so `from_libuv` stays at its default `false`.
    #[cfg(windows)]
    #[inline]
    pub fn from_uv_rc(rc: crate::windows::libuv::ReturnCode, syscall_tag: Tag) -> Option<Error> {
        rc.errno().map(|e| Error {
            errno: e,
            syscall: syscall_tag,
            ..Default::default()
        })
    }

    /// `Some(err)` when a libuv `ReturnCodeI64` is negative; `None` on success.
    /// `from_libuv` left at default `false`.
    #[cfg(windows)]
    #[inline]
    pub fn from_uv_rc64(
        rc: crate::windows::libuv::ReturnCodeI64,
        syscall_tag: Tag,
    ) -> Option<Error> {
        rc.errno().map(|e| Error {
            errno: e,
            syscall: syscall_tag,
            ..Default::default()
        })
    }

    pub fn from_code(errno: E, syscall_tag: Tag) -> Error {
        Error {
            errno: errno as Int,
            syscall: syscall_tag,
            ..Default::default()
        }
    }

    // c_int covers all call sites in practice.
    pub fn from_code_int(errno: c_int, syscall_tag: Tag) -> Error {
        #[cfg(windows)]
        let n = Int::try_from(errno.unsigned_abs()).unwrap();
        #[cfg(not(windows))]
        let n = u16::try_from(errno).expect("int cast");
        Error {
            errno: n,
            syscall: syscall_tag,
            ..Default::default()
        }
    }

    #[inline]
    pub fn get_errno(&self) -> E {
        // Transmuting an out-of-range discriminant
        // (e.g. TODO_ERRNO = u16::MAX-1) into a #[repr(u16)] enum is immediate UB. Use the checked
        // discriminant constructor and fall back to SUCCESS for unmapped values.
        #[cfg(windows)]
        {
            // `self.errno` already stores an E/SystemErrno *discriminant* (set via `E as Int`),
            // so a direct discriminant cast is what's wanted. Do NOT
            // route through `SystemErrno::init`: on Windows its u16/i32 entry points are the
            // Win32/WSA/uv-error→errno *mapper*, not a discriminant validator, and would
            // corrupt the value (e.g. EPERM=1 → Win32 INVALID_FUNCTION → EISDIR).
            E::try_from_raw(self.errno).unwrap_or(E::SUCCESS)
        }
        #[cfg(not(windows))]
        {
            SystemErrno::init(self.errno as i64).unwrap_or(SystemErrno::SUCCESS)
        }
    }

    #[inline]
    pub fn is_retry(&self) -> bool {
        self.get_errno() == E::EAGAIN
    }

    /// `bun.sys.Error.oom` — `ENOMEM` with no syscall context. (The `Box<[u8]>`
    /// fields prevent a true `const` item.)
    #[inline]
    pub fn oom() -> Error {
        Error {
            errno: E::ENOMEM as Int,
            syscall: Tag::read,
            ..Default::default()
        }
    }

    /// `bun.sys.Error.retry`. (The `Box<[u8]>`
    /// fields prevent a true `const` item.)
    #[inline]
    pub fn retry() -> Error {
        Error {
            errno: RETRY_ERRNO,
            syscall: Tag::read,
            ..Default::default()
        }
    }

    #[inline]
    pub fn with_fd(&self, fd: Fd) -> Error {
        debug_assert!(fd != Fd::INVALID);
        Error {
            errno: self.errno,
            syscall: self.syscall,
            fd,
            ..Default::default()
        }
    }

    // The `&[u8]` parameter type rejects `u16` paths at compile time.
    #[inline]
    pub fn with_path(&self, path: &[u8]) -> Error {
        Error {
            errno: self.errno,
            syscall: self.syscall,
            // PERF: clones the slice into a Box — profile if hot.
            path: Box::from(path),
            ..Default::default()
        }
    }

    #[inline]
    pub fn with_path_and_syscall(&self, path: &[u8], syscall_: Tag) -> Error {
        Error {
            errno: self.errno,
            syscall: syscall_,
            // PERF: clones the slice into a Box — profile if hot.
            path: Box::from(path),
            ..Default::default()
        }
    }

    /// Unlike `with_path`/`with_path_dest` (which
    /// reset `fd`/`from_libuv`), this only overlays `dest` and
    /// preserves every other field — chained on a libuv-sourced error
    /// (`from_libuv=true`, errno in the 4000-range) it must keep `from_libuv`
    /// so `name()`/`msg()` still route through the uv→errno mapper.
    #[inline]
    pub fn with_dest(&self, dest: &[u8]) -> Error {
        Error {
            errno: self.errno,
            syscall: self.syscall,
            fd: self.fd,
            #[cfg(windows)]
            from_libuv: self.from_libuv,
            path: self.path.clone(),
            dest: Box::from(dest),
        }
    }

    #[inline]
    pub fn with_path_dest(&self, path: &[u8], dest: &[u8]) -> Error {
        Error {
            errno: self.errno,
            syscall: self.syscall,
            // PERF: clones the slices into Boxes — profile if hot.
            path: Box::from(path),
            dest: Box::from(dest),
            ..Default::default()
        }
    }

    // `with_path_like` lives in `bun_runtime::node` as an extension method on
    // `bun_sys::Error` — `PathLike` is a tier-6 type and cannot be named from tier-1 `bun_sys`.

    /// When the memory of the path/dest buffer is unsafe to use, call this function to clone the error without the path/dest.
    pub fn without_path(&self) -> Error {
        Error {
            errno: self.errno,
            fd: self.fd,
            #[cfg(windows)]
            from_libuv: self.from_libuv,
            syscall: self.syscall,
            path: Box::default(),
            dest: Box::default(),
        }
    }

    /// Decode `self.errno` (+ `from_libuv` on Windows) into a validated `SystemErrno`.
    /// Shared by `name()` / `get_error_code_tag_name()`; a fallible discriminant lookup.
    #[inline]
    fn resolve_system_errno(&self) -> Option<SystemErrno> {
        #[cfg(windows)]
        {
            if self.from_libuv {
                // `self.errno` is the positive `UV_E*` magnitude; negate back to the signed
                // uv code, map to `E`, then to `SystemErrno` via the shared #[repr(u16)]
                // discriminant table.
                let translated = crate::windows::translate_uv_error_to_e(-c_int::from(self.errno));
                return Some(SystemErrno::from_raw(translated as u16));
            }
            // `self.errno` may be out-of-range (TODO_ERRNO etc.); validate first.
            // Do NOT call `SystemErrno::init` here — on Windows its u16/i32 entry points map
            // Win32/WSA error codes to errnos and would corrupt a value that is already a
            // SystemErrno discriminant (e.g. discriminant 1/EPERM → Win32(1) → EISDIR).
            E::try_from_raw(self.errno).map(|e| SystemErrno::from_raw(e as u16))
        }
        #[cfg(not(windows))]
        {
            if self.errno > 0 && self.errno < SystemErrno::MAX {
                SystemErrno::init(self.errno as i64)
            } else {
                None
            }
        }
    }

    pub fn name(&self) -> &'static [u8] {
        self.get_error_code_tag_name()
            .map(|(n, _)| n.as_bytes())
            .unwrap_or(b"UNKNOWN")
    }

    pub fn to_zig_err(&self) -> SystemErrno {
        self.resolve_system_errno().unwrap_or(SystemErrno::EIO)
    }

    /// 1. Convert libuv errno values into libc ones.
    /// 2. Get the tag name as a string for printing.
    pub fn get_error_code_tag_name(&self) -> Option<(&'static str, SystemErrno)> {
        let e = self.resolve_system_errno()?;
        // strum::IntoStaticStr — variant name (e.g., "ENOENT").
        Some((<&'static str>::from(e), e))
    }

    /// (code, uv_strerror label) pair, e.g. `("ENOENT", "no such file or
    /// directory")` — the pieces of Node's `UVException` message.
    pub fn uv_code_label(&self) -> Option<(&'static str, &'static str)> {
        let (code, system_errno) = self.get_error_code_tag_name()?;
        Some((code, libuv_error_map::LIBUV_ERROR_MAP[system_errno]))
    }

    pub fn msg(&self) -> Option<&'static [u8]> {
        let (_code, system_errno) = self.get_error_code_tag_name()?;
        // Both error maps are total (`initFull("unknown error")`), so the
        // lookup always yields a label.
        Some(coreutils_error_map::COREUTILS_ERROR_MAP[system_errno].as_bytes())
    }

    /// Shared scaffolding for [`to_shell_system_error`] and [`to_system_error`].
    /// Fills `errno`/`syscall`/`code`/`path`/`dest`/`fd`, leaves `message` empty,
    /// and returns the looked-up `(code, label)` so each caller can build its own
    /// `message` (shell: static label; node: formatted stack buffer).
    fn fill_system_error_common(
        &self,
        map: &enum_map::EnumMap<SystemErrno, &'static str>,
    ) -> (SystemError, Option<(&'static str, &'static str)>) {
        // Node reports libuv's codes in `err.errno` on every platform. On POSIX
        // that is just the negated host errno. On Windows `self.errno` may be
        // either an `E` discriminant or a raw libuv magnitude regardless of
        // `from_libuv` (callers are inconsistent), so always try the
        // discriminant→UV table first; a raw magnitude falls through to plain
        // negation and lands on the same value.
        #[cfg(windows)]
        let js_errno = crate::windows::libuv::e_discriminant_to_uv(self.errno)
            .unwrap_or_else(|| c_int::from(self.errno).wrapping_neg());
        #[cfg(not(windows))]
        let js_errno = c_int::from(self.errno).wrapping_neg();

        let mut err = SystemError {
            errno: js_errno,
            syscall: BunString::static_(<&'static str>::from(self.syscall).as_bytes()),
            message: BunString::empty(),
            ..Default::default()
        };

        // both maps are total (`initFull("unknown error")`).
        let looked_up = self.get_error_code_tag_name().map(|(code, system_errno)| {
            err.code = BunString::static_(code.as_bytes());
            (code, map[system_errno])
        });

        if !self.path.is_empty() {
            err.path = BunString::clone_utf8(&self.path);
        }

        if !self.dest.is_empty() {
            err.dest = BunString::clone_utf8(&self.dest);
        }

        if let Some(valid) = fd_unwrap_valid(self.fd) {
            // When the FD is a windows handle, there is no sane way to report this.
            #[cfg(windows)]
            if valid.kind() == crate::FdKind::Uv {
                err.fd = valid.uv();
            }
            #[cfg(not(windows))]
            {
                err.fd = valid.uv();
            }
        }

        (err, looked_up)
    }

    /// Simpler formatting which does not allocate a message
    pub fn to_shell_system_error(&self) -> SystemError {
        let (mut err, looked_up) =
            self.fill_system_error_common(&coreutils_error_map::COREUTILS_ERROR_MAP);
        if let Some((_, label)) = looked_up {
            err.message = BunString::static_(label.as_bytes());
        }
        err
    }

    /// More complex formatting to precisely match the printing that Node.js emits.
    /// Use this whenever the error will be sent to JavaScript instead of the shell variant above.
    pub fn to_system_error(&self) -> SystemError {
        let (mut err, looked_up) = self.fill_system_error_common(&libuv_error_map::LIBUV_ERROR_MAP);

        // format taken from Node.js 'exceptions.cc'
        // search keyword: `Local<Value> UVException(Isolate* isolate,`
        let mut message_buf = [0u8; 4096];
        let pos = {
            use std::io::Write as _;
            let mut cursor = std::io::Cursor::new(&mut message_buf[..]);
            'brk: {
                if let Some((code, _)) = looked_up {
                    if cursor.write_all(code.as_bytes()).is_err() {
                        break 'brk;
                    }
                    if cursor.write_all(b": ").is_err() {
                        break 'brk;
                    }
                }
                let label = looked_up.map(|(_, l)| l).unwrap_or("Unknown Error");
                if cursor.write_all(label.as_bytes()).is_err() {
                    break 'brk;
                }
                if cursor.write_all(b", ").is_err() {
                    break 'brk;
                }
                if cursor
                    .write_all(<&'static str>::from(self.syscall).as_bytes())
                    .is_err()
                {
                    break 'brk;
                }
                if !self.path.is_empty() {
                    if cursor.write_all(b" '").is_err() {
                        break 'brk;
                    }
                    if cursor.write_all(&self.path).is_err() {
                        break 'brk;
                    }
                    if cursor.write_all(b"'").is_err() {
                        break 'brk;
                    }

                    if !self.dest.is_empty() {
                        if cursor.write_all(b" -> '").is_err() {
                            break 'brk;
                        }
                        if cursor.write_all(&self.dest).is_err() {
                            break 'brk;
                        }
                        if cursor.write_all(b"'").is_err() {
                            break 'brk;
                        }
                    }
                }
            }
            usize::try_from(cursor.position()).expect("int cast")
        };
        err.message = BunString::clone_utf8(&message_buf[..pos]);

        err
    }

    #[inline]
    pub fn todo() -> Error {
        if cfg!(debug_assertions) {
            panic!("Error.todo() was called");
        }
        Error {
            errno: TODO_ERRNO,
            syscall: Tag::TODO,
            ..Default::default()
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // We want to reuse the code from SystemError for formatting.
        // But, we do not want to call String.createUTF8 on the path/dest strings
        // because we're intending to pass them to writer.print()
        // which will convert them back into UTF*.
        let mut that = self.without_path().to_shell_system_error();
        debug_assert!(that.path.tag() != bun_core::Tag::WTFStringImpl);
        debug_assert!(that.dest.tag() != bun_core::Tag::WTFStringImpl);
        that.path = BunString::borrow_utf8(&self.path);
        that.dest = BunString::borrow_utf8(&self.dest);
        debug_assert!(that.path.tag() != bun_core::Tag::WTFStringImpl);
        debug_assert!(that.dest.tag() != bun_core::Tag::WTFStringImpl);

        fmt::Display::fmt(&that, f)
    }
}

// `toJS` / `toJSWithAsyncStack` / `TestingAPIs` live as extension-trait
// methods in the `bun_sys_jsc` crate per PORTING.md.

// ──────────────────────────────────────────────────────────────────────────
// `bun_core::output::ErrName` impls — orphan rule lets the higher tier (sys)
// implement the lower-tier trait for its own types.
// ──────────────────────────────────────────────────────────────────────────
impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        Error::name(self)
    }
    fn as_sys_err_info(&self) -> Option<bun_core::output::SysErrInfo> {
        Some(bun_core::output::SysErrInfo {
            tag_name: Error::name(self),
            errno: i32::from(self.errno),
            syscall: <&'static str>::from(self.syscall),
        })
    }
}
// `&Error` — lets callers print-then-propagate without a clone
// (`Output::err(&e, …); return Err(e.into())`).
impl bun_core::output::ErrName for &Error {
    fn name(&self) -> &[u8] {
        Error::name(self)
    }
    fn as_sys_err_info(&self) -> Option<bun_core::output::SysErrInfo> {
        (**self).as_sys_err_info()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `ReturnCodeExt` — `ReturnCode::to_error(tag) -> Option<Error>` lives here (not
// in `bun_libuv_sys`) because `Error`/`Tag` are higher-tier types.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(windows)]
pub trait ReturnCodeExt: Sized {
    /// `Some(err)` when negative; `None` on success.
    /// `from_libuv` stays at default `false`.
    fn to_error(self, syscall_tag: Tag) -> Option<Error>;
    /// `Ok(())` on success, `Err` on negative rc.
    /// `bun_libuv_sys` returns the raw
    /// `ReturnCode` for layering; this trait promotes it.
    #[inline]
    fn to_result(self, syscall_tag: Tag) -> crate::Result<()> {
        match self.to_error(syscall_tag) {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
    /// Alias for [`to_error`].
    #[inline]
    fn as_err(self, syscall_tag: Tag) -> Option<Error> {
        self.to_error(syscall_tag)
    }
    /// Translate the negative libuv errno to `bun.sys.E`.
    /// `bun_libuv_sys::ReturnCode::err_enum()` only yields the raw `u16`
    /// (layering: it can't name `E`); this overlay yields the typed enum.
    fn err_enum_e(self) -> Option<crate::E>;
}
#[cfg(windows)]
impl ReturnCodeExt for crate::windows::libuv::ReturnCode {
    #[inline]
    fn to_error(self, syscall_tag: Tag) -> Option<Error> {
        Error::from_uv_rc(self, syscall_tag)
    }
    #[inline]
    fn err_enum_e(self) -> Option<crate::E> {
        if self.int() < 0 {
            Some(crate::windows::translate_uv_error_to_e(self.int()))
        } else {
            None
        }
    }
}
#[cfg(windows)]
impl ReturnCodeExt for crate::windows::libuv::ReturnCodeI64 {
    #[inline]
    fn to_error(self, syscall_tag: Tag) -> Option<Error> {
        Error::from_uv_rc64(self, syscall_tag)
    }
    #[inline]
    fn err_enum_e(self) -> Option<crate::E> {
        if self.int() < 0 {
            Some(crate::windows::translate_uv_error_to_e(
                self.int() as core::ffi::c_int
            ))
        } else {
            None
        }
    }
}
