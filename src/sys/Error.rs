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

impl Error {
    /// `Error::new(errno, tag)` — dispatches via `IntoErrnoInt` so a single
    /// constructor covers `E`, `SystemErrno` and (Windows) `NTSTATUS`.
    #[inline]
    pub fn new<C: IntoErrnoInt>(errno: C, syscall_tag: Tag) -> Error {
        Error {
            errno: errno.into_errno_int(),
            syscall: syscall_tag,
            ..Default::default()
        }
    }

    /// The error for a Win32 call that returned its failure value; `code` is
    /// its `GetLastError()` (see `Win32ErrorExt::to_e` for the mapping).
    #[cfg(windows)]
    #[inline]
    pub fn from_win32(code: crate::windows::Win32Error, syscall_tag: Tag) -> Error {
        use crate::windows::Win32ErrorExt as _;
        Error::from_code(code.to_e(), syscall_tag)
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
        debug_assert!((0..=c_int::from(u16::MAX)).contains(&errno));
        Error {
            errno: errno as Int,
            syscall: syscall_tag,
            ..Default::default()
        }
    }

    /// `self.errno` is an `E`/`SystemErrno` discriminant on every platform (not
    /// a Win32 or libuv code); one the enum does not declare is `EUNKNOWN`.
    #[inline]
    pub fn get_errno(&self) -> E {
        E::from_raw(self.errno)
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

    /// Unlike `with_path`/`with_path_dest` (which reset `fd`), this only
    /// overlays `dest`.
    #[cfg(windows)]
    #[inline]
    pub(crate) fn with_dest(&self, dest: &[u8]) -> Error {
        Error {
            errno: self.errno,
            syscall: self.syscall,
            fd: self.fd,
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
            syscall: self.syscall,
            path: Box::default(),
            dest: Box::default(),
        }
    }

    /// Decode `self.errno` into a validated `SystemErrno`; `None` for 0 and
    /// for values outside the enum (`TODO_ERRNO` etc.).
    #[inline]
    fn resolve_system_errno(&self) -> Option<SystemErrno> {
        if self.errno == 0 {
            return None;
        }
        SystemErrno::from_repr(self.errno)
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
        // that is just the negated host errno; on Windows the discriminant maps
        // back to its `UV_E*` value.
        #[cfg(windows)]
        let js_errno = crate::windows::libuv::e_discriminant_to_uv(self.errno)
            .unwrap_or_else(|| c_int::from(self.errno).wrapping_neg());
        #[cfg(not(windows))]
        let js_errno = c_int::from(self.errno).wrapping_neg();

        let mut err = SystemError {
            errno: js_errno,
            syscall: BunString::static_(<&'static str>::from(self.syscall).as_bytes()),
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
                err.fd = Some(valid.uv());
            }
            #[cfg(not(windows))]
            {
                err.fd = Some(valid.uv());
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
    /// `Some(errno)` when the return code is negative; `None` on success.
    fn errno(self) -> Option<crate::E>;
    #[inline]
    fn to_error(self, syscall_tag: Tag) -> Option<Error> {
        self.errno().map(|e| Error::from_code(e, syscall_tag))
    }
    #[inline]
    fn to_result(self, syscall_tag: Tag) -> crate::Result<()> {
        match self.to_error(syscall_tag) {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
}
#[cfg(windows)]
impl ReturnCodeExt for crate::windows::libuv::ReturnCode {
    #[inline]
    fn errno(self) -> Option<crate::E> {
        (self.int() < 0).then(|| crate::windows::translate_uv_error_to_e(self.int()))
    }
}
#[cfg(windows)]
impl ReturnCodeExt for crate::windows::libuv::ReturnCodeI64 {
    #[inline]
    fn errno(self) -> Option<crate::E> {
        (self.int() < 0).then(|| crate::windows::translate_uv_error_to_e(self.int() as c_int))
    }
}
