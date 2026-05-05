use core::ffi::{c_int, c_void};
use core::fmt;

use bun_core::Output;
#[cfg(windows)]
use bun_sys::windows::{self, libuv, HANDLE};

// Within the `bun_sys` crate: `crate::Error`, `crate::Tag`, `crate::E`, `crate::syslog`, etc.
use crate as sys;

bun_output::declare_scope!(SYS, visible);
// `log` in the Zig is `bun.sys.syslog`
macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(SYS, $($arg)*) };
}

#[cfg(unix)]
type BackingInt = c_int;
#[cfg(windows)]
type BackingInt = u64;

// TODO(port): Rust has no native `u63`; we store the 63-bit value in a u64 and mask on Windows.
#[cfg(windows)]
type WindowsHandleNumber = u64;

#[cfg(unix)]
type HandleNumber = c_int;
#[cfg(windows)]
type HandleNumber = WindowsHandleNumber;

/// `std.posix.fd_t` — `c_int` on POSIX, `HANDLE` (`*anyopaque`) on Windows.
#[cfg(unix)]
pub type FdT = c_int;
#[cfg(windows)]
pub type FdT = HANDLE;

/// `bun.windows.libuv.uv_file` (c-runtime file descriptor); on POSIX this is also `c_int`.
pub type UvFile = c_int;

/// Abstraction over file descriptors. On POSIX, fd is a wrapper around a "fd_t",
/// and there is no special behavior. In return for using fd, you get access to
/// a 'close' method, and a handful of decl literals like '.cwd()' and '.stdin()'.
///
/// On Windows, a tag differentiates two sources:
/// - system: A "std.os.windows.HANDLE" that windows APIs can interact with.
///           In fd case it is actually just an "*anyopaque" that points to some windows internals.
/// - uv:     A c-runtime file descriptor that looks like a linux file descriptor.
///           ("uv", "uv_file", "c runtime file descriptor", "crt fd" are interchangeable terms)
///
/// When a Windows HANDLE is converted to a UV descriptor, it
/// becomes owned by the C runtime, in which it can only be properly freed by
/// closing it. fd is problematic because it means that calling a libuv
/// function with a windows handle is impossible since the conversion will
/// make it impossible for the caller to close it. In these siutations,
/// the descriptor must be converted much higher up in the call stack.
//
// Zig: `packed struct(backing_int) { value: Value, kind: Kind }`
// Field order in a Zig packed struct is LSB-first: on Windows bits 0..=62 = value, bit 63 = kind.
// On POSIX `Kind` is `enum(u0)` (zero bits) so the whole struct is exactly `fd_t`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct Fd(BackingInt);

#[cfg(unix)]
#[repr(u8)] // u0 in Zig
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Kind {
    System = 0,
}
#[cfg(windows)]
#[repr(u8)] // u1 in Zig
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Kind {
    System = 0,
    Uv = 1,
}

#[cfg(windows)]
const KIND_BIT: u64 = 1 << 63;
#[cfg(windows)]
const VALUE_MASK: u64 = KIND_BIT - 1;

impl Fd {
    // ── packed-struct accessors ───────────────────────────────────────────

    #[cfg(unix)]
    #[inline]
    pub const fn kind(self) -> Kind {
        Kind::System
    }
    #[cfg(windows)]
    #[inline]
    pub const fn kind(self) -> Kind {
        if self.0 & KIND_BIT == 0 { Kind::System } else { Kind::Uv }
    }

    #[cfg(unix)]
    #[inline]
    const fn value_as_system(self) -> FdT {
        self.0
    }
    #[cfg(windows)]
    #[inline]
    const fn value_as_system(self) -> WindowsHandleNumber {
        self.0 & VALUE_MASK
    }
    #[cfg(windows)]
    #[inline]
    const fn value_as_uv(self) -> UvFile {
        // Zig packed-union reinterpret: low bits of the u63 value as c_int.
        (self.0 & VALUE_MASK) as u32 as i32
    }

    #[cfg(unix)]
    #[inline]
    const fn from_system_value(v: FdT) -> Fd {
        Fd(v)
    }
    #[cfg(windows)]
    #[inline]
    const fn from_system_value(v: WindowsHandleNumber) -> Fd {
        Fd(v & VALUE_MASK) // kind bit = 0 (System)
    }
    #[cfg(windows)]
    #[inline]
    const fn from_uv_value(v: UvFile) -> Fd {
        Fd((v as u32 as u64) | KIND_BIT)
    }

    // ── invalid ───────────────────────────────────────────────────────────

    /// An invalid file descriptor.
    /// Avoid in new code. Prefer `Fd::Optional` and `.none` instead.
    pub const INVALID: Fd = Fd::from_system_value(INVALID_VALUE);

    // NOTE: there is no universal anytype init function. please annotate at each
    // call site the source of the file descriptor you are initializing. with
    // heavy decl literal usage, it can be confusing if you just see `.from()`,
    // especially since numerical values have very subtle differences on Windows.

    /// Initialize using the native system handle
    #[inline]
    pub fn from_native(value: FdT) -> Fd {
        #[cfg(windows)]
        {
            // the current process fd is max usize
            // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocess
            debug_assert!((value as usize) <= (i64::MAX as usize)); // u63::MAX
        }
        Fd::from_system_value(handle_to_number(value))
    }
    #[inline]
    pub fn from_system(value: FdT) -> Fd {
        Fd::from_native(value)
    }

    /// Initialize using the c-runtime / libuv file descriptor
    #[inline]
    pub const fn from_uv(value: UvFile) -> Fd {
        // Zig has a `@inComptime()` check restricting comptime values to 0..=2.
        // Rust `const fn` can be called at runtime too, so the check is dropped.
        #[cfg(unix)]
        {
            // workaround for https://github.com/ziglang/zig/issues/23307 — not needed in Rust,
            // but keep the matching constants for the comptime stdin/out/err call sites.
            match value {
                0 => COMPTIME_STDIN,
                1 => COMPTIME_STDOUT,
                2 => COMPTIME_STDERR,
                _ => Fd::from_system_value(value),
            }
        }
        #[cfg(windows)]
        {
            Fd::from_uv_value(value)
        }
    }

    #[inline]
    pub fn cwd() -> Fd {
        // TODO(port): `std.fs.cwd().fd` — on POSIX this is AT_FDCWD; on Windows it is the
        // process-parameter CurrentDirectory.Handle. Route through bun_sys, not std::fs.
        #[cfg(unix)]
        {
            Fd::from_native(libc::AT_FDCWD)
        }
        #[cfg(windows)]
        {
            // SAFETY: PEB is process-global; only reading the cached cwd handle.
            Fd::from_native(unsafe { windows::peb().ProcessParameters.CurrentDirectory.Handle })
        }
    }

    #[inline]
    pub fn stdin() -> Fd {
        #[cfg(not(windows))]
        {
            Fd::from_uv(0)
        }
        #[cfg(windows)]
        {
            // windows std handles are not known at build time
            // SAFETY: written once at startup before any reader.
            unsafe { WINDOWS_CACHED_STDIN }
        }
    }

    #[inline]
    pub fn stdout() -> Fd {
        #[cfg(not(windows))]
        {
            Fd::from_uv(1)
        }
        #[cfg(windows)]
        {
            // SAFETY: written once at startup before any reader.
            unsafe { WINDOWS_CACHED_STDOUT }
        }
    }

    #[inline]
    pub fn stderr() -> Fd {
        #[cfg(not(windows))]
        {
            Fd::from_uv(2)
        }
        #[cfg(windows)]
        {
            // SAFETY: written once at startup before any reader.
            unsafe { WINDOWS_CACHED_STDERR }
        }
    }

    // `fromStdFile` / `fromStdDir` / `stdFile` / `stdDir` wrap `std.fs.File` / `std.fs.Dir`.
    // TODO(port): no Rust equivalent for `std.fs.File`/`std.fs.Dir` here (std::fs is banned).
    // Callers should use `Fd::from_native(handle)` / `fd.native()` directly.

    /// Perform different logic for each kind of windows file descriptor
    #[cfg(windows)]
    #[inline]
    pub fn decode_windows(self) -> DecodeWindows {
        match self.kind() {
            Kind::System => DecodeWindows::Windows(number_to_handle(self.value_as_system())),
            Kind::Uv => DecodeWindows::Uv(self.value_as_uv()),
        }
    }

    #[inline]
    pub fn is_valid(self) -> bool {
        #[cfg(not(windows))]
        {
            self.value_as_system() != INVALID_VALUE
        }
        #[cfg(windows)]
        {
            match self.kind() {
                Kind::System => self.value_as_system() != INVALID_VALUE,
                Kind::Uv => true,
            }
        }
    }
    #[inline]
    pub fn unwrap_valid(self) -> Option<Fd> {
        if self.is_valid() { Some(self) } else { None }
    }

    /// When calling fd function, you may not be able to close the returned fd.
    /// To close the fd, you have to call `.close()` on the `bun.FD`.
    #[inline]
    pub fn native(self) -> FdT {
        // Do not assert that the fd is valid, as there are many syscalls where
        // we deliberately pass an invalid file descriptor.
        #[cfg(not(windows))]
        {
            self.value_as_system()
        }
        #[cfg(windows)]
        {
            match self.decode_windows() {
                DecodeWindows::Windows(handle) => handle,
                DecodeWindows::Uv(file_number) => uv_get_osfhandle(file_number),
            }
        }
    }
    /// Deprecated: renamed to `native` because it is unclear what `cast` would cast to.
    #[deprecated = "use native()"]
    #[inline]
    pub fn cast(self) -> FdT {
        self.native()
    }

    /// When calling fd function, you should consider the FD struct to now be
    /// invalid. Calling `.close()` on the FD at that point may not work.
    pub fn uv(self) -> UvFile {
        #[cfg(not(windows))]
        {
            self.value_as_system()
        }
        #[cfg(windows)]
        {
            match self.decode_windows() {
                DecodeWindows::Windows(handle) => {
                    // `.stdin()`/`.stdout()`/`.stderr()` hand out the cached
                    // `WINDOWS_CACHED_STD{IN,OUT,ERR}` (snapshotted at startup),
                    // so round-trip against those first. Comparing only against
                    // the live `GetStdHandle` result panics if the process std
                    // handle was swapped after startup via `SetStdHandle`,
                    // `AllocConsole`, `AttachConsole`, etc.
                    // SAFETY: cached statics written once at startup.
                    unsafe {
                        if self == WINDOWS_CACHED_STDIN {
                            return 0;
                        }
                        if self == WINDOWS_CACHED_STDOUT {
                            return 1;
                        }
                        if self == WINDOWS_CACHED_STDERR {
                            return 2;
                        }
                    }
                    if is_stdio_handle(windows::STD_INPUT_HANDLE, handle) {
                        return 0;
                    }
                    if is_stdio_handle(windows::STD_OUTPUT_HANDLE, handle) {
                        return 1;
                    }
                    if is_stdio_handle(windows::STD_ERROR_HANDLE, handle) {
                        return 2;
                    }
                    panic!(
                        "Cast bun.FD.uv({}) makes closing impossible!\n\n\
                         The supplier of fd FD should call 'FD.makeLibUVOwned',\n\
                         probably where open() was called.",
                        self,
                    );
                }
                DecodeWindows::Uv(v) => v,
            }
        }
    }

    #[inline]
    pub fn as_socket_fd(self) -> sys::SocketT {
        #[cfg(windows)]
        {
            // SAFETY: HANDLE → SOCKET pointer reinterpretation; matches Zig @ptrCast.
            self.native() as sys::SocketT
        }
        #[cfg(not(windows))]
        {
            self.native()
        }
    }

    /// Assumes given a valid file descriptor
    /// If error, the handle has not been closed
    pub fn make_lib_uv_owned(self) -> Result<Fd, MakeLibUvOwnedError> {
        if cfg!(debug_assertions) {
            debug_assert!(self.is_valid());
        }
        #[cfg(not(windows))]
        {
            Ok(self)
        }
        #[cfg(windows)]
        {
            match self.kind() {
                Kind::System => {
                    let n = uv_open_osfhandle(number_to_handle(self.value_as_system()))?;
                    Ok(Fd::from_uv(n))
                }
                Kind::Uv => Ok(self),
            }
        }
    }

    pub fn make_lib_uv_owned_for_syscall(
        self,
        // PERF(port): was comptime monomorphization — profile in Phase B
        syscall_tag: sys::Tag,
        // PERF(port): was comptime monomorphization — profile in Phase B
        error_case: ErrorCase,
    ) -> sys::Result<Fd> {
        #[cfg(not(windows))]
        {
            let _ = (syscall_tag, error_case);
            sys::Result::Ok(self)
        }
        #[cfg(windows)]
        {
            match self.make_lib_uv_owned() {
                Ok(fd) => sys::Result::Ok(fd),
                Err(MakeLibUvOwnedError::SystemFdQuotaExceeded) => {
                    if matches!(error_case, ErrorCase::CloseOnFail) {
                        self.close();
                    }
                    sys::Result::Err(sys::Error {
                        errno: sys::E::MFILE as _,
                        syscall: syscall_tag,
                        ..Default::default()
                    })
                }
            }
        }
    }

    /// fd function will NOT CLOSE stdin/stdout/stderr.
    /// Expects a VALID file descriptor object.
    ///
    /// Do not use fd on JS-provided file descriptors (e.g. in
    /// `fs.closeSync`). For those cases, the developer may provide a faulty
    /// value, and we must forward EBADF to them. For internal situations, we
    /// should never hit EBADF since it means we could have replaced the file
    /// descriptor, closing something completely unrelated; fd would cause
    /// weird behavior as you see EBADF errors in unrelated places.
    ///
    /// One day, we can add code to track file descriptor allocations and frees.
    /// In debug, fd assertion failure can print where the FD was actually
    /// closed.
    pub fn close(self) {
        let err = self.close_allowing_bad_file_descriptor(bun_core::return_address());
        debug_assert!(err.is_none()); // use after close!
    }

    /// fd function will NOT CLOSE stdin/stdout/stderr.
    ///
    /// Use fd API to implement `node:fs` close.
    /// Prefer asserting that EBADF does not happen with `.close()`
    pub fn close_allowing_bad_file_descriptor(self, return_address: Option<usize>) -> Option<sys::Error> {
        if self.stdio_tag().is_some() {
            log!("close({}) SKIPPED", self);
            return None;
        }
        self.close_allowing_standard_io(return_address.or_else(|| bun_core::return_address()))
    }

    /// fd allows you to close standard io. It also returns the error.
    /// Consider fd the raw close method.
    pub fn close_allowing_standard_io(self, return_address: Option<usize>) -> Option<sys::Error> {
        if cfg!(debug_assertions) {
            debug_assert!(self.is_valid()); // probably a UAF
        }

        // Format the file descriptor for logging BEFORE closing it.
        // Otherwise the file descriptor is always invalid after closing it.
        #[cfg(debug_assertions)]
        let fd_fmt = {
            let mut buf = [0u8; 1050];
            // TODO(port): bufPrint into a stack buffer; using a small heap Vec for now.
            // PERF(port): was stack bufPrint — profile in Phase B
            use std::io::Write as _;
            let mut cursor = std::io::Cursor::new(&mut buf[..]);
            let _ = write!(cursor, "{}", self);
            let len = cursor.position() as usize;
            // Copy out so the borrow on buf ends; debug-only.
            buf[..len].to_vec()
        };

        let result: Option<sys::Error> = {
            #[cfg(any(target_os = "linux", target_os = "freebsd"))]
            {
                debug_assert!(self.native() >= 0);
                match sys::get_errno(sys::syscall::close(self.native())) {
                    sys::E::BADF => Some(sys::Error {
                        errno: sys::E::BADF as _,
                        syscall: sys::Tag::Close,
                        fd: self,
                        ..Default::default()
                    }),
                    _ => None,
                }
            }
            #[cfg(target_os = "macos")]
            {
                debug_assert!(self.native() >= 0);
                match sys::get_errno(sys::syscall::close_nocancel(self.native())) {
                    sys::E::BADF => Some(sys::Error {
                        errno: sys::E::BADF as _,
                        syscall: sys::Tag::Close,
                        fd: self,
                        ..Default::default()
                    }),
                    _ => None,
                }
            }
            #[cfg(windows)]
            {
                match self.decode_windows() {
                    DecodeWindows::Uv(file_number) => {
                        let mut req = libuv::fs_t::uninitialized();
                        // `defer req.deinit()` → Drop on libuv::fs_t handles deinit.
                        let rc = libuv::uv_fs_close(libuv::Loop::get(), &mut req, file_number, None);
                        if let Some(errno) = rc.errno() {
                            Some(sys::Error {
                                errno,
                                syscall: sys::Tag::Close,
                                fd: self,
                                from_libuv: true,
                                ..Default::default()
                            })
                        } else {
                            None
                        }
                    }
                    DecodeWindows::Windows(handle) => match sys::c::NtClose(handle) {
                        windows::NTSTATUS::SUCCESS => None,
                        rc => Some(sys::Error {
                            errno: windows::Win32Error::from_nt_status(rc)
                                .to_system_errno()
                                .map(|e| e as _)
                                .unwrap_or(1),
                            syscall: sys::Tag::CloseHandle,
                            fd: self,
                            ..Default::default()
                        }),
                    },
                }
            }
            #[cfg(target_arch = "wasm32")]
            {
                compile_error!("FD.close() not implemented for fd platform");
            }
        };

        #[cfg(debug_assertions)]
        {
            if let Some(ref err) = result {
                if err.errno == sys::E::BADF as _ {
                    Output::debug_warn(format_args!(
                        "close({}) = EBADF. This is an indication of a file descriptor UAF",
                        bstr::BStr::new(&fd_fmt),
                    ));
                    crate::dump_stack_trace(
                        return_address.or_else(|| bun_core::return_address()),
                        4,
                        true,
                    );
                } else {
                    log!("close({}) = {}", bstr::BStr::new(&fd_fmt), err);
                }
            } else {
                log!("close({})", bstr::BStr::new(&fd_fmt));
            }
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = return_address;
        }
        result
    }

    // `fromJS` / `fromJSValidated` / `toJS` / `toJSWithoutMakingLibUVOwned` are `*_jsc` aliases.
    // Deleted per porting guide — they live as extension-trait methods in `bun_sys_jsc`.

    pub fn stdio_tag(self) -> Option<Stdio> {
        #[cfg(windows)]
        {
            match self.decode_windows() {
                DecodeWindows::Windows(handle) => {
                    // SAFETY: PEB is process-global, read-only access.
                    let process = unsafe { &windows::peb().ProcessParameters };
                    if handle == process.hStdInput {
                        Some(Stdio::StdIn)
                    } else if handle == process.hStdOutput {
                        Some(Stdio::StdOut)
                    } else if handle == process.hStdError {
                        Some(Stdio::StdErr)
                    } else {
                        None
                    }
                }
                DecodeWindows::Uv(file_number) => match file_number {
                    0 => Some(Stdio::StdIn),
                    1 => Some(Stdio::StdOut),
                    2 => Some(Stdio::StdErr),
                    _ => None,
                },
            }
        }
        #[cfg(not(windows))]
        {
            match self.value_as_system() {
                0 => Some(Stdio::StdIn),
                1 => Some(Stdio::StdOut),
                2 => Some(Stdio::StdErr),
                _ => None,
            }
        }
    }

    /// Properly converts Fd::INVALID into Optional::NONE
    #[inline]
    pub const fn to_optional(self) -> Optional {
        Optional(self.0)
    }

    pub fn make_path_u8(self, subpath: &[u8]) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        bun_core::make_path(self, subpath)
    }
    pub fn make_path_u16(self, subpath: &[u16]) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        bun_core::make_path_w(self, subpath)
    }

    // TODO: make our own version of deleteTree
    pub fn delete_tree(self, subpath: &[u8]) -> Result<(), bun_core::Error> {
        // TODO(port): Zig calls `dir.stdDir().deleteTree(subpath)`. No std::fs allowed —
        // route through bun_sys once a Rust deleteTree exists.
        let _ = (self, subpath);
        Err(bun_core::err!("Unimplemented"))
    }

    // The following functions are from bun.sys but with the 'f' prefix dropped
    // where it is relevant. These functions all take FD as the first argument,
    // so that makes them Zig methods, even when declared in a separate file.
    //
    // TODO(port): In Rust, free functions cannot be aliased as inherent methods.
    // Phase B: add `impl Fd { pub fn chmod(...) ... }` blocks in the files where
    // `sys::fchmod` etc. are defined (Rust allows multiple `impl Fd` blocks across
    // a crate). The list (Zig name → target):
    //   chmod→fchmod, chmodat→fchmodat, chown→fchown, directoryExistsAt, dup,
    //   dupWithFlags, existsAt, existsAtType, fcntl, getFcntlFlags, getFileSize,
    //   linkat, linkatTmpfile, lseek, mkdirat, mkdiratA, mkdiratW, mkdiratZ,
    //   openat, pread, preadv, pwrite, pwritev, read, readNonblocking, readlinkat,
    //   readv, recv, recvNonBlock, renameat, renameat2, send, sendNonBlock,
    //   sendfile, stat→fstat, statat→fstatat, symlinkat, truncate→ftruncate,
    //   unlinkat, updateNonblocking, write, writeNonblocking, writev,
    //   getFdPath, getFdPathW, getFdPathZ.

    // TODO: move these methods defined in bun.sys.File to bun.sys. follow
    // similar pattern as above. then delete bun.sys.File
    pub fn quiet_writer(self) -> sys::File_QuietWriter {
        // TODO(port): `bun.sys.File.QuietWriter` wraps `{ handle: fd }`.
        sys::File_QuietWriter::new(sys::File { handle: self })
    }
}

// Zig `comptime { ... }` static layout assertion (Windows-only).
#[cfg(windows)]
const _: () = {
    // The conversion from FD to fd_t should be an integer truncate
    // @as(FD, @bitCast(@as(u64, 512))).value.as_system == 512
    assert!(Fd(512u64).value_as_system() == 512);
};

#[cfg(unix)]
const INVALID_VALUE: FdT = c_int::MIN;
#[cfg(windows)]
const INVALID_VALUE: WindowsHandleNumber = 0; // minInt(u63) == 0

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ErrorCase {
    CloseOnFail,
    LeakFdOnFail,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum MakeLibUvOwnedError {
    #[error("SystemFdQuotaExceeded")]
    SystemFdQuotaExceeded,
}
impl From<MakeLibUvOwnedError> for bun_core::Error {
    fn from(e: MakeLibUvOwnedError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Stdio {
    StdIn = 0,
    StdOut = 1,
    StdErr = 2,
}
impl Stdio {
    #[inline]
    pub fn fd(self) -> Fd {
        match self {
            Stdio::StdIn => Fd::stdin(),
            Stdio::StdOut => Fd::stdout(),
            Stdio::StdErr => Fd::stderr(),
        }
    }
    #[inline]
    pub fn from_int(value: i32) -> Option<Stdio> {
        if !(0..=2).contains(&value) {
            return None;
        }
        // SAFETY: range-checked to 0..=2 above; #[repr(u8)] discriminants match.
        Some(unsafe { core::mem::transmute::<u8, Stdio>(value as u8) })
    }
    #[inline]
    pub fn to_int(self) -> i32 {
        self as i32
    }
}

/// Hash context for `Fd` keys (matches Zig `HashMapContext`).
pub struct HashMapContext;
impl HashMapContext {
    #[inline]
    pub fn hash(fd: Fd) -> u64 {
        // a file descriptor is i32 on linux, u64 on windows
        // the goal here is to do zero work and widen the 32 bit type to 64
        #[cfg(unix)]
        {
            // @bitCast c_int → u32, then widen.
            fd.0 as u32 as u64
        }
        #[cfg(windows)]
        {
            fd.0
        }
    }
    #[inline]
    pub fn eql(a: Fd, b: Fd) -> bool {
        a == b
    }
    #[inline]
    pub fn pre(input: Fd) -> Prehashed {
        Prehashed { value: Self::hash(input), input }
    }
}

pub struct Prehashed {
    pub value: u64,
    pub input: Fd,
}
impl Prehashed {
    #[inline]
    pub fn hash(&self, fd: Fd) -> u64 {
        if fd == self.input {
            return self.value;
        }
        // Zig: `return fd;` — implicit coercion of FD (packed struct) to u64.
        HashMapContext::hash(fd)
    }
    #[inline]
    pub fn eql(&self, a: Fd, b: Fd) -> bool {
        a == b
    }
}

impl fmt::Display for Fd {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let fd = *self;
        if !fd.is_valid() {
            return writer.write_str("[invalid_fd]");
        }

        #[cfg(not(windows))]
        {
            let fd_native = fd.native();
            write!(writer, "{}", fd_native)?;
            #[cfg(debug_assertions)]
            if fd_native >= 3 {
                'print_with_path: {
                    let mut path_buf = bun_paths::PathBuffer::uninit();
                    // NOTE: Bun's `fd.getFdPath`, while supporting some
                    // situations the standard library does not, hits EINVAL
                    // instead of gracefully handling invalid file descriptors.
                    // It is assumed that debug builds are ran on systems that
                    // support the standard library functions (since they would
                    // likely have run the Zig compiler, and it's not the end of
                    // the world if this fails.
                    // TODO(port): `std.os.getFdPath` — use a bun_sys helper that
                    // gracefully handles invalid FDs (debug-only path printing).
                    match sys::get_fd_path_debug(fd_native, &mut path_buf) {
                        Ok(path) => write!(writer, "[{}]", bstr::BStr::new(path))?,
                        Err(e) if e == bun_core::err!("FileNotFound") => {
                            writer.write_str("[BADF]")?;
                            break 'print_with_path;
                        }
                        Err(e) => {
                            write!(writer, "[unknown: error.{}]", e.name())?;
                            break 'print_with_path;
                        }
                    }
                }
            }
            Ok(())
        }
        #[cfg(windows)]
        {
            match fd.decode_windows() {
                DecodeWindows::Windows(handle) => {
                    #[cfg(debug_assertions)]
                    {
                        // SAFETY: PEB read-only access.
                        let peb = unsafe { windows::peb() };
                        if handle == peb.ProcessParameters.hStdInput {
                            return write!(writer, "{}[stdin handle]", fd.value_as_system());
                        } else if handle == peb.ProcessParameters.hStdOutput {
                            return write!(writer, "{}[stdout handle]", fd.value_as_system());
                        } else if handle == peb.ProcessParameters.hStdError {
                            return write!(writer, "{}[stderr handle]", fd.value_as_system());
                        } else if handle == peb.ProcessParameters.CurrentDirectory.Handle {
                            return write!(writer, "{}[cwd handle]", fd.value_as_system());
                        } else {
                            'print_with_path: {
                                let mut fd_path = bun_paths::WPathBuffer::uninit();
                                let Ok(path) = windows::get_final_path_name_by_handle(
                                    handle,
                                    windows::GetFinalPathNameByHandleOptions { volume_name: windows::VolumeName::Nt },
                                    &mut fd_path,
                                ) else {
                                    break 'print_with_path;
                                };
                                return write!(
                                    writer,
                                    "{}[{}]",
                                    fd.value_as_system(),
                                    bun_core::fmt::utf16(path),
                                );
                            }
                        }
                    }
                    write!(writer, "{}[handle]", fd.value_as_system())
                }
                DecodeWindows::Uv(file_number) => write!(writer, "{}[libuv]", file_number),
            }
        }
    }
}

#[cfg(windows)]
pub enum DecodeWindows {
    Windows(HANDLE),
    Uv(UvFile),
}

/// Note that currently FD can encode the invalid file descriptor value.
/// Obviously, prefer fd instead of that.
//
// Zig: `enum(backing_int) { none = @bitCast(invalid), _ }` — a niche-packed Option<Fd>.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Optional(BackingInt);

impl Optional {
    pub const NONE: Optional = Optional(Fd::INVALID.0);

    #[inline]
    pub const fn init(maybe: Option<Fd>) -> Optional {
        match maybe {
            Some(fd) => fd.to_optional(),
            None => Optional::NONE,
        }
    }
    #[inline]
    pub fn close(self) {
        if let Some(fd) = self.unwrap() {
            fd.close();
        }
    }
    #[inline]
    pub const fn unwrap(self) -> Option<Fd> {
        if self.0 == Optional::NONE.0 { None } else { Some(Fd(self.0)) }
    }
    #[inline]
    pub fn take(&mut self) -> Option<Fd> {
        let r = self.unwrap();
        *self = Optional::NONE;
        r
    }
}

#[cfg(windows)]
fn is_stdio_handle(id: windows::DWORD, handle: HANDLE) -> bool {
    let Ok(h) = windows::get_std_handle(id) else { return false };
    handle == h
}

#[inline]
fn handle_to_number(handle: FdT) -> HandleNumber {
    #[cfg(unix)]
    {
        handle
    }
    #[cfg(windows)]
    {
        // intCast fails if 'fd > 2^62'
        // possible with handleToNumber(GetCurrentProcess());
        u64::try_from(handle as usize).unwrap()
    }
}

#[cfg(windows)]
#[inline]
fn number_to_handle(handle: HandleNumber) -> FdT {
    if handle == 0 {
        return windows::INVALID_HANDLE_VALUE;
    }
    handle as usize as FdT
}
#[cfg(unix)]
#[inline]
const fn number_to_handle(handle: HandleNumber) -> FdT {
    handle
}

#[cfg(windows)]
pub fn uv_get_osfhandle(in_: c_int) -> libuv::uv_os_fd_t {
    // SAFETY: FFI call into libuv.
    unsafe { libuv_private::uv_get_osfhandle(in_) }
}

#[cfg(windows)]
pub fn uv_open_osfhandle(in_: libuv::uv_os_fd_t) -> Result<c_int, MakeLibUvOwnedError> {
    // SAFETY: FFI call into libuv.
    let out = unsafe { libuv_private::uv_open_osfhandle(in_) };
    debug_assert!(out >= -1);
    if out == -1 {
        return Err(MakeLibUvOwnedError::SystemFdQuotaExceeded);
    }
    Ok(out)
}

/// On Windows we use libuv and often pass file descriptors to functions
/// like `uv_pipe_open`, `uv_tty_init`.
///
/// But `uv_pipe` and `uv_tty` **take ownership of the file descriptor**.
///
/// This can easily cause use-after-frees, double closing the FD, etc.
///
/// So this type represents an FD that could possibly be moved to libuv.
///
/// Note that on Posix, this is just a wrapper over FD and does nothing.
pub struct MovableIfWindowsFd {
    #[cfg(windows)]
    inner: Option<Fd>,
    #[cfg(not(windows))]
    inner: Fd,
}

impl MovableIfWindowsFd {
    #[inline]
    pub fn init(fd: Fd) -> Self {
        #[cfg(windows)]
        {
            Self { inner: Some(fd) }
        }
        #[cfg(not(windows))]
        {
            Self { inner: fd }
        }
    }

    #[inline]
    pub fn get(&self) -> Option<Fd> {
        #[cfg(windows)]
        {
            self.inner
        }
        #[cfg(not(windows))]
        {
            Some(self.inner)
        }
    }

    #[cfg(not(windows))]
    #[inline]
    pub fn get_posix(&self) -> Fd {
        self.inner
    }
    // Windows: `getPosix` is a `@compileError` — not provided.

    pub fn close(&mut self) {
        #[cfg(unix)]
        {
            self.inner.close();
            self.inner = Fd::INVALID;
        }
        #[cfg(windows)]
        {
            if let Some(fd) = self.inner {
                fd.close();
                self.inner = None;
            }
        }
    }

    #[inline]
    pub fn is_valid(&self) -> bool {
        #[cfg(unix)]
        {
            self.inner.is_valid()
        }
        #[cfg(windows)]
        {
            self.inner.is_some_and(|fd| fd.is_valid())
        }
    }

    #[inline]
    pub fn is_owned(&self) -> bool {
        #[cfg(unix)]
        {
            true
        }
        #[cfg(windows)]
        {
            self.inner.is_some()
        }
    }

    /// Takes the FD, leaving `self` in a "moved-from" state. Only available on Windows.
    #[cfg(windows)]
    pub fn take(&mut self) -> Option<Fd> {
        self.inner.take()
    }
    // POSIX: `take` is a `@compileError` — not provided.
}

impl fmt::Display for MovableIfWindowsFd {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        #[cfg(unix)]
        {
            write!(writer, "{}", self.get().unwrap())
        }
        #[cfg(windows)]
        {
            if let Some(fd) = self.inner {
                write!(writer, "{}", fd)
            } else {
                writer.write_str("[moved]")
            }
        }
    }
}

#[cfg(debug_assertions)]
pub static mut WINDOWS_CACHED_FD_SET: bool = false;
// SAFETY (for the three statics below): written once during startup
// (`bun.windows` init) before any concurrent reader exists; treated as
// read-only thereafter. Zig uses plain `var ... = undefined`.
pub static mut WINDOWS_CACHED_STDIN: Fd = Fd::INVALID;
pub static mut WINDOWS_CACHED_STDOUT: Fd = Fd::INVALID;
pub static mut WINDOWS_CACHED_STDERR: Fd = Fd::INVALID;

// workaround for https://github.com/ziglang/zig/issues/23307
// we can construct these values as decls, but not as a function's return value
#[cfg(not(windows))]
const COMPTIME_STDIN: Fd = Fd::from_system_value(0);
#[cfg(not(windows))]
const COMPTIME_STDOUT: Fd = Fd::from_system_value(1);
#[cfg(not(windows))]
const COMPTIME_STDERR: Fd = Fd::from_system_value(2);

// TODO(port): move to bun_sys::windows::libuv (sys crate FFI surface).
#[cfg(windows)]
mod libuv_private {
    use super::{c_int, FdT};
    unsafe extern "C" {
        pub fn uv_get_osfhandle(fd: c_int) -> FdT;
        pub fn uv_open_osfhandle(os_fd: FdT) -> c_int;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/fd.zig (720 lines)
//   confidence: medium
//   todos:      11
//   notes:      Packed-struct bit layout reproduced via #[repr(transparent)] + shift accessors; std.fs interop (stdFile/stdDir/deleteTree) and the bun.sys method-alias block are stubbed for Phase B; mutable WINDOWS_CACHED_* statics need a once-init wrapper.
// ──────────────────────────────────────────────────────────────────────────
