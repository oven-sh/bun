//! Platform specific APIs for Darwin/macOS
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::sync::atomic::{AtomicU64, Ordering};

/// Non-cancellable versions of various libc functions are undocumented
/// TODO: explain the $NOCANCEL problem
pub mod nocancel {
    use core::ffi::{c_char, c_int, c_uint, c_void};
    use libc::{iovec, off_t, pollfd, sigset_t, sockaddr, socklen_t, timespec};

    // TODO(port): move to platform_sys
    unsafe extern "C" {
        #[link_name = "recvfrom$NOCANCEL"]
        pub fn recvfrom_nocancel(
            sockfd: c_int,
            buf: *mut c_void,
            len: usize,
            flags: u32,
            src_addr: *mut sockaddr,
            addrlen: *mut socklen_t,
        ) -> isize;

        #[link_name = "sendto$NOCANCEL"]
        pub fn sendto_nocancel(
            sockfd: c_int,
            buf: *const c_void,
            len: usize,
            flags: u32,
            dest_addr: *const sockaddr,
            addrlen: socklen_t,
        ) -> isize;

        #[link_name = "fcntl$NOCANCEL"]
        pub fn fcntl_nocancel(fd: c_int, cmd: c_int, ...) -> c_int;

        // #[link_name = "sendmsg$NOCANCEL"]
        // pub fn sendmsg_nocancel(sockfd: c_int, msg: *const msghdr, flags: c_int) -> isize;
        // #[link_name = "recvmsg$NOCANCEL"]
        // pub fn recvmsg_nocancel(sockfd: c_int, msg: *mut msghdr, flags: c_int) -> isize;

        #[link_name = "connect$NOCANCEL"]
        pub fn connect_nocancel(
            sockfd: c_int,
            sock_addr: *const sockaddr,
            addrlen: socklen_t,
        ) -> c_int;

        #[link_name = "accept$NOCANCEL"]
        pub fn accept_nocancel(
            sockfd: c_int,
            addr: *mut sockaddr,
            addrlen: *mut socklen_t,
        ) -> c_int;

        #[link_name = "accept4$NOCANCEL"]
        pub fn accept4_nocancel(
            sockfd: c_int,
            addr: *mut sockaddr,
            addrlen: *mut socklen_t,
            flags: c_uint,
        ) -> c_int;

        #[link_name = "open$NOCANCEL"]
        pub fn open_nocancel(path: *const c_char, oflag: c_uint, ...) -> c_int;

        // https://opensource.apple.com/source/xnu/xnu-7195.81.3/libsyscall/wrappers/open-base.c
        #[link_name = "openat$NOCANCEL"]
        pub fn openat_nocancel(fd: c_int, path: *const c_char, oflag: c_uint, ...) -> c_int;

        #[link_name = "read$NOCANCEL"]
        pub fn read_nocancel(fd: c_int, buf: *mut u8, nbyte: usize) -> isize;

        #[link_name = "pread$NOCANCEL"]
        pub fn pread_nocancel(fd: c_int, buf: *mut u8, nbyte: usize, offset: off_t) -> isize;

        #[link_name = "preadv$NOCANCEL"]
        pub fn preadv_nocancel(fd: c_int, uf: *mut iovec, count: i32, offset: off_t) -> isize;

        #[link_name = "readv$NOCANCEL"]
        pub fn readv_nocancel(fd: c_int, uf: *mut iovec, count: i32) -> isize;

        #[link_name = "write$NOCANCEL"]
        pub fn write_nocancel(fd: c_int, buf: *const u8, nbyte: usize) -> isize;

        #[link_name = "writev$NOCANCEL"]
        pub fn writev_nocancel(fd: c_int, buf: *const iovec, count: i32) -> isize;

        #[link_name = "pwritev$NOCANCEL"]
        pub fn pwritev_nocancel(fd: c_int, buf: *const iovec, count: i32, offset: off_t) -> isize;

        #[link_name = "poll$NOCANCEL"]
        pub fn poll_nocancel(fds: *mut pollfd, nfds: c_int, timeout: c_int) -> isize;

        #[link_name = "ppoll$NOCANCEL"]
        pub fn ppoll_nocancel(
            fds: *mut pollfd,
            nfds: c_int,
            timeout: *const timespec,
            sigmask: *const sigset_t,
        ) -> isize;
    }
}

/// Opaque `os_log_t` handle.
#[repr(C)]
pub struct OSLog {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Category {
    PointsOfInterest = 0,
    Dynamicity = 1,
    SizeAndThroughput = 2,
    TimeProfile = 3,
    SystemReporting = 4,
    UserCustom = 5,
}

/// Common subsystems that Instruments recognizes
pub struct Subsystem;
impl Subsystem {
    pub const NETWORK: &'static CStr = c"com.apple.network";
    pub const FILE_IO: &'static CStr = c"com.apple.disk_io";
    pub const GRAPHICS: &'static CStr = c"com.apple.graphics";
    pub const MEMORY: &'static CStr = c"com.apple.memory";
    pub const PERFORMANCE: &'static CStr = c"com.apple.performance";
}

unsafe extern "C" {
    fn os_log_create(subsystem: *const c_char, category: *const c_char) -> *mut OSLog;

    #[link_name = "Bun__signpost_emit"]
    pub fn bun_signpost_emit(
        log: *const OSLog,
        id: u64,
        signpost_type: SignpostType,
        name: i32,
        category: u8,
    );
}

// anything except 0 and ~0 is a valid signpost id
static SIGNPOST_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
enum SignpostType {
    Event = 0,
    IntervalBegin = 1,
    IntervalEnd = 2,
}

impl OSLog {
    pub fn init() -> Option<&'static OSLog> {
        // SAFETY: os_log_create returns either a valid os_log_t handle (process-lifetime)
        // or null; the literals are NUL-terminated.
        unsafe {
            let ptr = os_log_create(c"com.bun.bun".as_ptr(), c"PointsOfInterest".as_ptr());
            if ptr.is_null() {
                None
            } else {
                Some(&*ptr)
            }
        }
    }

    pub fn signpost(&self, name: i32) -> Signpost<'_> {
        Signpost {
            id: SIGNPOST_ID_COUNTER.fetch_add(1, Ordering::Relaxed),
            name,
            log: self,
        }
    }
}

#[derive(Copy, Clone)]
pub struct Signpost<'a> {
    pub id: u64,
    pub name: i32,
    pub log: &'a OSLog,
}

impl<'a> Signpost<'a> {
    pub fn emit(&self, category: Category) {
        // SAFETY: self.log is a valid os_log_t handle for 'a.
        unsafe {
            bun_signpost_emit(self.log, self.id, SignpostType::Event, self.name, category as u8);
        }
    }

    pub fn interval(self, category: Category) -> Interval<'a> {
        // SAFETY: self.log is a valid os_log_t handle for 'a.
        unsafe {
            bun_signpost_emit(
                self.log,
                self.id,
                SignpostType::IntervalBegin,
                self.name,
                category as u8,
            );
        }
        Interval { signpost: self, category }
    }
}

#[derive(Copy, Clone)]
pub struct Interval<'a> {
    pub signpost: Signpost<'a>,
    pub category: Category,
}

impl<'a> Interval<'a> {
    pub fn end(&self) {
        // SAFETY: self.signpost.log is a valid os_log_t handle for 'a.
        unsafe {
            bun_signpost_emit(
                self.signpost.log,
                self.signpost.id,
                SignpostType::IntervalEnd,
                self.signpost.name,
                self.category as u8,
            );
        }
    }
}

use core::ffi::CStr;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/platform/darwin.zig (105 lines)
//   confidence: high
//   todos:      1
//   notes:      $NOCANCEL externs renamed via #[link_name]; libc crate used for sockaddr/iovec/pollfd/etc.; Signpost gets <'a> per LIFETIMES.tsv; nested OSLog decls flattened to module scope.
// ──────────────────────────────────────────────────────────────────────────
