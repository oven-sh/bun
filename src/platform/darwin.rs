//! Platform specific APIs for Darwin/macOS
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

/// Non-cancellable versions of various libc functions are undocumented
/// TODO: explain the $NOCANCEL problem
pub mod nocancel {
    use core::ffi::{c_char, c_int, c_uint, c_void};
    use libc::{iovec, off_t, pollfd, sigset_t, sockaddr, socklen_t, timespec};

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
