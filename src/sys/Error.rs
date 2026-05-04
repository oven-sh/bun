//! Error type that preserves useful information from the operating system

use core::ffi::c_int;
use core::fmt;

use bun_str::String as BunString;
// TODO(port): SystemError lives in bun_jsc; bun_sys depending on bun_jsc may be a layering
// violation — consider moving to_shell_system_error/to_system_error into bun_sys_jsc.
use bun_jsc::SystemError;

use crate::{coreutils_error_map, libuv_error_map, Fd, SystemErrno, Tag, E};

#[cfg(windows)]
const RETRY_ERRNO: Int = E::INTR as Int;
#[cfg(not(windows))]
const RETRY_ERRNO: Int = E::AGAIN as Int;

const TODO_ERRNO: Int = Int::MAX - 1;

pub type Int = u16;

/// TODO: convert to function
// TODO(port): was `pub const oom` in Zig; Box<[u8]> fields prevent a true `const` item.
#[inline]
pub fn oom() -> Error {
    Error::from_code(E::NOMEM, Tag::read)
}

#[derive(Clone)]
pub struct Error {
    pub errno: Int,
    pub fd: Fd,
    #[cfg(windows)]
    pub from_libuv: bool,
    // TODO(port): in Zig these are borrowed `[]const u8` by default and only owned after
    // `clone()`. Ported as Box<[u8]> per PORTING.md (deinit frees them); `with_path*` now
    // eagerly clones. Revisit if profiling shows regressions.
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

// Zig `pub fn clone(this, allocator)` → covered by `#[derive(Clone)]` (allocator param dropped;
// Box<[u8]> deep-copies on Clone, matching `allocator.dupe`).

// Zig `pub fn deinit` / `deinitWithAllocator` → dropped; Box<[u8]> frees on Drop. Only valid to
// rely on this for owned (cloned) Errors — same caveat as the Zig comment.

impl Error {
    pub fn from_code(errno: E, syscall_tag: Tag) -> Error {
        Error {
            errno: errno as Int,
            syscall: syscall_tag,
            ..Default::default()
        }
    }

    // TODO(port): Zig took `errno: anytype`; narrowed to c_int (covers all call sites in practice).
    pub fn from_code_int(errno: c_int, syscall_tag: Tag) -> Error {
        #[cfg(windows)]
        let n = Int::try_from(errno.unsigned_abs()).unwrap();
        #[cfg(not(windows))]
        let n = u16::try_from(errno).unwrap();
        Error {
            errno: n,
            syscall: syscall_tag,
            ..Default::default()
        }
    }

    #[inline]
    pub fn get_errno(&self) -> E {
        // SAFETY: errno was originally produced from an `E` value (or a libc errno that maps to one).
        // TODO(port): Zig `@enumFromInt` is unchecked; consider `E::from_raw` with debug-assert.
        unsafe { core::mem::transmute::<Int, E>(self.errno) }
    }

    #[inline]
    pub fn is_retry(&self) -> bool {
        self.get_errno() == E::AGAIN
    }

    // TODO(port): was `pub const retry` in Zig; Box<[u8]> fields prevent a true `const` item.
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

    // Zig accepted `path: anytype` (slice or `[*:0]const u8`) and ran `bun.span`; the
    // `@compileError` rejecting `u16` paths is enforced here by the `&[u8]` parameter type.
    #[inline]
    pub fn with_path(&self, path: &[u8]) -> Error {
        Error {
            errno: self.errno,
            syscall: self.syscall,
            // PERF(port): Zig borrowed the slice; we clone into Box — profile in Phase B
            path: Box::from(path),
            ..Default::default()
        }
    }

    #[inline]
    pub fn with_path_and_syscall(&self, path: &[u8], syscall_: Tag) -> Error {
        Error {
            errno: self.errno,
            syscall: syscall_,
            // PERF(port): Zig borrowed the slice; we clone into Box — profile in Phase B
            path: Box::from(path),
            ..Default::default()
        }
    }

    #[inline]
    pub fn with_path_dest(&self, path: &[u8], dest: &[u8]) -> Error {
        Error {
            errno: self.errno,
            syscall: self.syscall,
            // PERF(port): Zig borrowed the slices; we clone into Box — profile in Phase B
            path: Box::from(path),
            dest: Box::from(dest),
            ..Default::default()
        }
    }

    #[inline]
    pub fn with_path_like(&self, pathlike: &crate::PathLike) -> Error {
        // TODO(port): exact PathLike enum shape lives elsewhere in bun_sys / bun_runtime::node.
        match pathlike {
            crate::PathLike::Fd(fd) => self.with_fd(*fd),
            crate::PathLike::Path(path) => self.with_path(path.slice()),
        }
    }

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

    pub fn name(&self) -> &'static [u8] {
        #[cfg(windows)]
        {
            // Zig used @setRuntimeSafety(false) + @enumFromInt on a possibly-invalid value, then
            // `bun.tagName` (which returns null for invalid). In Rust transmuting to an invalid
            // enum is UB, so fold both steps into a single fallible lookup.
            let system_errno: Option<SystemErrno> = if self.from_libuv {
                let translated =
                    crate::windows::libuv::translate_uv_error_to_e(-c_int::from(self.errno));
                SystemErrno::from_raw(translated as Int)
            } else {
                SystemErrno::from_raw(self.errno)
            };
            if let Some(errname) = system_errno.and_then(bun_core::tag_name) {
                return errname.as_bytes();
            }
        }
        #[cfg(not(windows))]
        {
            if self.errno > 0 && self.errno < SystemErrno::MAX {
                if let Some(system_errno) = SystemErrno::from_raw(self.errno) {
                    if let Some(errname) = bun_core::tag_name(system_errno) {
                        return errname.as_bytes();
                    }
                }
            }
        }

        b"UNKNOWN"
    }

    pub fn to_zig_err(&self) -> bun_core::Error {
        bun_core::errno_to_err(self.errno)
    }

    /// 1. Convert libuv errno values into libc ones.
    /// 2. Get the tag name as a string for printing.
    pub fn get_error_code_tag_name(&self) -> Option<(&'static str, SystemErrno)> {
        #[cfg(not(windows))]
        {
            if self.errno > 0 && self.errno < SystemErrno::MAX {
                // TODO(port): Zig used unchecked @enumFromInt + @tagName; folded into checked lookup.
                let system_errno = SystemErrno::from_raw(self.errno)?;
                return Some((<&'static str>::from(system_errno), system_errno));
            }
        }
        #[cfg(windows)]
        {
            // Zig used @setRuntimeSafety(false) + @enumFromInt on a possibly-invalid value; see
            // note in `name()` above.
            let system_errno: SystemErrno = 'brk: {
                if self.from_libuv {
                    let translated =
                        crate::windows::libuv::translate_uv_error_to_e(c_int::from(self.errno) * -1);
                    break 'brk SystemErrno::from_raw(translated as Int)?;
                }
                SystemErrno::from_raw(self.errno)?
            };
            if let Some(errname) = bun_core::tag_name(system_errno) {
                return Some((errname, system_errno));
            }
        }
        None
    }

    pub fn msg(&self) -> Option<&'static [u8]> {
        if let Some((code, system_errno)) = self.get_error_code_tag_name() {
            if let Some(label) = coreutils_error_map::get(system_errno) {
                return Some(label);
            }
            return Some(code.as_bytes());
        }
        None
    }

    /// Simpler formatting which does not allocate a message
    pub fn to_shell_system_error(&self) -> SystemError {
        let mut err = SystemError {
            errno: c_int::from(self.errno) * -1,
            syscall: BunString::static_(<&'static str>::from(self.syscall)),
            message: BunString::empty(),
            ..Default::default()
        };

        // errno label
        if let Some((code, system_errno)) = self.get_error_code_tag_name() {
            err.code = BunString::static_(code);
            if let Some(label) = coreutils_error_map::get(system_errno) {
                err.message = BunString::static_(label);
            }
        }

        if !self.path.is_empty() {
            err.path = BunString::clone_utf8(&self.path);
        }

        if !self.dest.is_empty() {
            err.dest = BunString::clone_utf8(&self.dest);
        }

        if let Some(valid) = self.fd.unwrap_valid() {
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

        err
    }

    /// More complex formatting to precisely match the printing that Node.js emits.
    /// Use this whenever the error will be sent to JavaScript instead of the shell variant above.
    pub fn to_system_error(&self) -> SystemError {
        let mut err = SystemError {
            errno: c_int::from(self.errno).wrapping_neg(),
            syscall: BunString::static_(<&'static str>::from(self.syscall)),
            message: BunString::empty(),
            ..Default::default()
        };

        // errno label
        let mut maybe_code: Option<&'static str> = None;
        let mut label: Option<&'static str> = None;
        if let Some((code, system_errno)) = self.get_error_code_tag_name() {
            maybe_code = Some(code);
            err.code = BunString::static_(code);
            label = libuv_error_map::get(system_errno);
        }

        // format taken from Node.js 'exceptions.cc'
        // search keyword: `Local<Value> UVException(Isolate* isolate,`
        let mut message_buf = [0u8; 4096];
        let pos = {
            use std::io::Write as _;
            let mut cursor = std::io::Cursor::new(&mut message_buf[..]);
            'brk: {
                if let Some(code) = maybe_code {
                    if cursor.write_all(code.as_bytes()).is_err() { break 'brk; }
                    if cursor.write_all(b": ").is_err() { break 'brk; }
                }
                if cursor.write_all(label.unwrap_or("Unknown Error").as_bytes()).is_err() { break 'brk; }
                if cursor.write_all(b", ").is_err() { break 'brk; }
                if cursor.write_all(<&'static str>::from(self.syscall).as_bytes()).is_err() { break 'brk; }
                if !self.path.is_empty() {
                    if cursor.write_all(b" '").is_err() { break 'brk; }
                    if cursor.write_all(&self.path).is_err() { break 'brk; }
                    if cursor.write_all(b"'").is_err() { break 'brk; }

                    if !self.dest.is_empty() {
                        if cursor.write_all(b" -> '").is_err() { break 'brk; }
                        if cursor.write_all(&self.dest).is_err() { break 'brk; }
                        if cursor.write_all(b"'").is_err() { break 'brk; }
                    }
                }
            }
            usize::try_from(cursor.position()).unwrap()
        };
        let message = &message_buf[..pos];
        err.message = BunString::clone_utf8(message);

        if !self.path.is_empty() {
            err.path = BunString::clone_utf8(&self.path);
        }

        if !self.dest.is_empty() {
            err.dest = BunString::clone_utf8(&self.dest);
        }

        if let Some(valid) = self.fd.unwrap_valid() {
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
        debug_assert!(that.path.tag() != bun_str::Tag::WTFStringImpl);
        debug_assert!(that.dest.tag() != bun_str::Tag::WTFStringImpl);
        that.path = BunString::borrow_utf8(&self.path);
        that.dest = BunString::borrow_utf8(&self.dest);
        debug_assert!(that.path.tag() != bun_str::Tag::WTFStringImpl);
        debug_assert!(that.dest.tag() != bun_str::Tag::WTFStringImpl);

        fmt::Display::fmt(&that, f)
    }
}

// Zig re-exported `toJS` / `toJSWithAsyncStack` / `TestingAPIs` from `../sys_jsc/error_jsc.zig`.
// Per PORTING.md these become extension-trait methods in the `bun_sys_jsc` crate; deleted here.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/Error.zig (337 lines)
//   confidence: medium
//   todos:      8
//   notes:      path/dest retyped Box<[u8]> (Zig mixed borrow/own); oom/retry consts→fns; SystemErrno raw-int lookup folded into safe from_raw; SystemError dep on bun_jsc may need relayering.
// ──────────────────────────────────────────────────────────────────────────
