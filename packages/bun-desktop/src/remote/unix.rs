use std::io;
pub use std::os::fd::{AsFd, BorrowedFd, OwnedFd};
use std::os::fd::{AsRawFd as _, FromRawFd as _, IntoRawFd as _};
pub use std::os::unix::net::UnixStream;
use std::time::Duration;

pub use libc::{MSG_DONTWAIT as WITHOUT_WAITING, iovec as Part};

#[cfg(target_os = "linux")]
const NO_SIGNAL: i32 = libc::MSG_NOSIGNAL;
#[cfg(not(target_os = "linux"))]
const NO_SIGNAL: i32 = 0;

#[repr(C)]
pub struct WithDescriptors<const N: usize> {
    pub header: libc::cmsghdr,
    pub descriptors: [i32; N],
}

/// Returns how much was sent. A page may not send descriptors.
pub fn send_some(
    socket: &UnixStream,
    parts: &[Part],
    descriptor: Option<BorrowedFd<'_>>,
    flags: i32,
) -> io::Result<usize> {
    // SAFETY: zeros are messages without parts, which then get some that outlive the call.
    unsafe {
        while super::guest::is_on() {
            match usize::try_from(libc::send(
                socket.as_raw_fd(),
                parts[0].iov_base,
                parts[0].iov_len,
                flags | NO_SIGNAL,
            )) {
                Err(_) if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted => {}
                sent => return sent.map_err(|_| io::Error::last_os_error()),
            }
        }
        let (mut message, mut control): (libc::msghdr, WithDescriptors<2>) =
            (std::mem::zeroed(), std::mem::zeroed());
        (message.msg_iov, message.msg_iovlen) = (parts.as_ptr().cast_mut(), parts.len() as _);
        if let Some(descriptor) = descriptor {
            (
                control.header.cmsg_len,
                control.header.cmsg_level,
                control.header.cmsg_type,
            ) = (libc::CMSG_LEN(4) as _, libc::SOL_SOCKET, libc::SCM_RIGHTS);
            control.descriptors[0] = descriptor.as_raw_fd();
            (message.msg_control, message.msg_controllen) =
                ((&raw mut control).cast(), libc::CMSG_SPACE(4) as _);
        }
        loop {
            match usize::try_from(libc::sendmsg(
                socket.as_raw_fd(),
                &message,
                flags | NO_SIGNAL,
            )) {
                Ok(sent) => return Ok(sent),
                Err(_) if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return Err(io::Error::last_os_error()),
            }
        }
    }
}

/// How many bytes, and the first descriptor that came with them. An error if there are none.
///
/// # Safety
/// That many bytes are writable.
pub unsafe fn receive_into(
    socket: &UnixStream,
    to: *mut u8,
    length: usize,
    flags: i32,
) -> io::Result<(usize, Option<OwnedFd>)> {
    #[cfg(target_os = "linux")]
    const FLAGS: i32 = libc::MSG_CMSG_CLOEXEC;
    #[cfg(not(target_os = "linux"))]
    const FLAGS: i32 = 0;
    /// macOS gives the process those that there is no room for, too.
    const MOST_IN_MESSAGE: usize = 512;
    let mut part = Part {
        iov_base: to.cast(),
        iov_len: length,
    };
    let mut control = std::mem::MaybeUninit::<WithDescriptors<MOST_IN_MESSAGE>>::uninit();
    // SAFETY: as above. The system has written as much as it says. A descriptor that was received is nobody else's.
    unsafe {
        let mut message: libc::msghdr = std::mem::zeroed();
        (message.msg_iov, message.msg_iovlen) = (&raw mut part, 1);
        let received = loop {
            (message.msg_control, message.msg_controllen) =
                (control.as_mut_ptr().cast(), size_of_val(&control) as _);
            match libc::recvmsg(socket.as_raw_fd(), &mut message, flags | FLAGS) {
                0 => return Err(io::ErrorKind::UnexpectedEof.into()),
                received @ 1.. => break received as usize,
                _ if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted => {}
                _ => return Err(io::Error::last_os_error()),
            }
        };
        let (mut first, mut header) = (None, libc::CMSG_FIRSTHDR(&message));
        while let Some(it) = header.as_ref() {
            if (it.cmsg_level, it.cmsg_type) == (libc::SOL_SOCKET, libc::SCM_RIGHTS) {
                let length: usize = it.cmsg_len as _;
                for at in 0..(length - libc::CMSG_LEN(0) as usize) / size_of::<i32>() {
                    let descriptor = OwnedFd::from_raw_fd(
                        libc::CMSG_DATA(header)
                            .cast::<i32>()
                            .add(at)
                            .read_unaligned(),
                    );
                    #[cfg(not(target_os = "linux"))]
                    libc::fcntl(descriptor.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC);
                    first.get_or_insert(descriptor);
                }
            }
            header = libc::CMSG_NXTHDR(&message, header);
        }
        Ok((received, first))
    }
}

pub fn receive(socket: &UnixStream, bytes: &mut [u8], flags: i32) -> io::Result<Option<OwnedFd>> {
    // SAFETY: a slice.
    unsafe { receive_into(socket, bytes.as_mut_ptr(), bytes.len(), flags) }.map(|it| it.1)
}

/// In nanoseconds, the same in all processes.
pub fn clock() -> u64 {
    #[cfg(target_os = "macos")]
    const OF_INSTANT: libc::clockid_t = libc::CLOCK_UPTIME_RAW;
    #[cfg(not(target_os = "macos"))]
    const OF_INSTANT: libc::clockid_t = libc::CLOCK_MONOTONIC;
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: it is written to.
    unsafe { libc::clock_gettime(OF_INSTANT, &mut time) };
    time.tv_sec as u64 * 1_000_000_000 + time.tv_nsec as u64
}

#[cfg(not(target_os = "macos"))]
pub fn share(size: usize) -> Option<OwnedFd> {
    // SAFETY: a C string. The descriptor is nobody else's.
    unsafe {
        let file = libc::memfd_create(
            c"bun:desktop".as_ptr(),
            libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
        );
        let file = (file >= 0).then(|| OwnedFd::from_raw_fd(file))?;
        let seals = libc::F_SEAL_SHRINK | libc::F_SEAL_GROW | libc::F_SEAL_SEAL;
        (libc::ftruncate(file.as_raw_fd(), size as _) == 0
            && libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, seals) == 0)
            .then_some(file)
    }
}

/// Its size can only be set once.
#[cfg(target_os = "macos")]
pub fn share(size: usize) -> Option<OwnedFd> {
    let name =
        std::ffi::CString::new(format!("/bun{:x}.{:x}", std::process::id(), clock())).ok()?;
    // SAFETY: as above.
    unsafe {
        let file = libc::shm_open(
            name.as_ptr(),
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL,
            0o600,
        );
        let file = (file >= 0).then(|| OwnedFd::from_raw_fd(file))?;
        libc::shm_unlink(name.as_ptr());
        (libc::ftruncate(file.as_raw_fd(), size as _) == 0).then_some(file)
    }
}

pub fn map(file: &OwnedFd, size: usize) -> Option<*mut u8> {
    // SAFETY: a new mapping of a file that has this size for good.
    let start = unsafe {
        libc::mmap(
            std::ptr::null_mut(),
            size,
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_SHARED,
            file.as_raw_fd(),
            0,
        )
    };
    (start != libc::MAP_FAILED).then_some(start.cast())
}

/// # Safety
/// Nothing refers to it any more.
pub unsafe fn unmap(start: *mut u8, size: usize) {
    // SAFETY: the caller's contract.
    unsafe { libc::munmap(start.cast(), size) };
}

pub fn give_away(descriptor: OwnedFd) -> i32 {
    descriptor.into_raw_fd()
}

/// # Safety
/// It is nobody else's, or negative.
pub unsafe fn adopt(descriptor: i32) -> Option<OwnedFd> {
    // SAFETY: the caller's contract.
    (descriptor >= 0).then(|| unsafe {
        libc::fcntl(descriptor, libc::F_SETFD, libc::FD_CLOEXEC);
        OwnedFd::from_raw_fd(descriptor)
    })
}

/// # Safety
/// It stays open, or is negative.
pub unsafe fn borrow<'a>(descriptor: i32) -> Option<BorrowedFd<'a>> {
    // SAFETY: the caller's contract.
    (descriptor >= 0).then(|| unsafe { BorrowedFd::borrow_raw(descriptor) })
}

pub fn wait_for(source: Option<isize>, socket: &UnixStream, timeout: Option<Duration>) -> bool {
    crate::host::wait_for(source, socket.as_raw_fd(), timeout)
}

pub fn exit() -> ! {
    // SAFETY: nothing is left to do.
    unsafe { libc::_exit(0) }
}
