//! `Zeroable` for the foreign C structs Bun zero-initializes. The orphan rule puts these impls here.

use crate::{Zeroable, impl_zeroable};

macro_rules! has_pointers {
    ($($T:ty),+ $(,)?) => {$(
        // SAFETY: integers, raw pointers and `Option<fn>` only; the pointers are what stop `impl_zeroable!`.
        unsafe impl Zeroable for $T {}
    )+};
}

#[cfg(unix)]
mod unix {
    use super::*;

    impl_zeroable!(
        libc::utsname,
        libc::winsize,
        libc::rlimit,
        libc::stat,
        libc::rusage,
        libc::timespec,
        libc::timeval,
        libc::pollfd,
        libc::sockaddr,
        libc::sockaddr_in,
        libc::sockaddr_in6,
        libc::sockaddr_storage,
        libc::sockaddr_un,
    );
    // A `u32` on Darwin, which the primitive impl covers.
    #[cfg(not(target_vendor = "apple"))]
    impl_zeroable!(libc::sigset_t);
    #[cfg(any(target_os = "linux", target_os = "android"))]
    impl_zeroable!(libc::sysinfo, libc::epoll_event, libc::signalfd_siginfo);
    #[cfg(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "freebsd"
    ))]
    impl_zeroable!(libc::statfs);
    #[cfg(target_os = "macos")]
    impl_zeroable!(libc::kevent64_s, libc::rusage_info_v4);
    #[cfg(target_os = "freebsd")]
    impl_zeroable!(libc::_umtx_time);

    has_pointers!(
        libc::sigaction,
        libc::passwd,
        libc::tm,
        libc::Dl_info,
        libc::addrinfo
    );
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    has_pointers!(libc::kevent);
}

#[cfg(windows)]
mod windows {
    use super::*;
    use bun_windows_sys::externs::{self as w, ws2_32};

    impl_zeroable!(
        w::FILE_BASIC_INFORMATION,
        w::FILE_ALL_INFORMATION,
        w::FILE_FS_DEVICE_INFORMATION,
        w::FILE_FS_VOLUME_INFORMATION,
        w::BY_HANDLE_FILE_INFORMATION,
        w::CONSOLE_SCREEN_BUFFER_INFO,
        w::WIN32_FILE_ATTRIBUTE_DATA,
        w::WIN32_FIND_DATAW,
        w::FILETIME,
        w::IO_COUNTERS,
        w::IO_STATUS_BLOCK,
        w::JOBOBJECT_BASIC_LIMIT_INFORMATION,
        w::JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        ws2_32::sockaddr_storage,
        ws2_32::sockaddr_in,
        ws2_32::sockaddr_in6,
    );

    has_pointers!(
        w::OBJECT_ATTRIBUTES,
        w::UNICODE_STRING,
        w::SECURITY_ATTRIBUTES,
        w::OVERLAPPED,
        w::PROCESS_INFORMATION,
        ws2_32::addrinfo,
    );
}
