//! What servers are talked to with.

use std::collections::VecDeque;
use std::os::fd::{AsRawFd as _, FromRawFd as _, OwnedFd, RawFd};

/// Reads little-endian numbers, and zero past the end.
pub trait Bytes {
    fn u8(&self, at: usize) -> u8;
    fn u16(&self, at: usize) -> u16;
    fn u32(&self, at: usize) -> u32;
    fn part(&self, at: usize, length: usize) -> &[u8];
    fn i16(&self, at: usize) -> i16 {
        self.u16(at) as i16
    }
    fn i32(&self, at: usize) -> i32 {
        self.u32(at) as i32
    }
    fn words(&self) -> Vec<u32>;
}

impl Bytes for [u8] {
    fn u8(&self, at: usize) -> u8 {
        self.get(at).copied().unwrap_or(0)
    }
    fn u16(&self, at: usize) -> u16 {
        u16::from_le_bytes([self.u8(at), self.u8(at + 1)])
    }
    fn u32(&self, at: usize) -> u32 {
        u32::from_le_bytes([
            self.u8(at),
            self.u8(at + 1),
            self.u8(at + 2),
            self.u8(at + 3),
        ])
    }
    fn part(&self, at: usize, length: usize) -> &[u8] {
        let start = at.min(self.len());
        &self[start..at.saturating_add(length).min(self.len())]
    }
    fn words(&self) -> Vec<u32> {
        self.as_chunks()
            .0
            .iter()
            .map(|it| u32::from_le_bytes(*it))
            .collect()
    }
}

pub fn padded(length: usize) -> usize {
    length.next_multiple_of(4)
}

/// Returns whether `fd` is ready.
pub fn wait(fd: RawFd, events: i16, milliseconds: i32) -> bool {
    let mut entry = libc::pollfd {
        fd,
        events,
        revents: 0,
    };
    // SAFETY: one entry.
    unsafe { libc::poll(&raw mut entry, 1, milliseconds) > 0 }
}

pub const MAX_DESCRIPTORS: usize = 16;

/// Returns how many bytes were sent, along with all of `descriptors`.
pub fn send(socket: RawFd, bytes: &[u8], descriptors: &[OwnedFd]) -> std::io::Result<usize> {
    let mut control = [0u64; 16];
    let mut vector = libc::iovec {
        iov_base: bytes.as_ptr().cast_mut().cast(),
        iov_len: bytes.len(),
    };
    // SAFETY: the header points to locals, and `control` has room for the descriptors that are copied.
    let sent = unsafe {
        let mut header: libc::msghdr = std::mem::zeroed();
        (header.msg_iov, header.msg_iovlen) = (&raw mut vector, 1);
        if !descriptors.is_empty() {
            assert!(descriptors.len() <= MAX_DESCRIPTORS);
            let length = (descriptors.len() * size_of::<RawFd>()) as u32;
            header.msg_control = control.as_mut_ptr().cast();
            header.msg_controllen = libc::CMSG_SPACE(length) as _;
            let message = libc::CMSG_FIRSTHDR(&raw const header);
            (*message).cmsg_level = libc::SOL_SOCKET;
            (*message).cmsg_type = libc::SCM_RIGHTS;
            (*message).cmsg_len = libc::CMSG_LEN(length) as _;
            let data = libc::CMSG_DATA(message).cast::<RawFd>();
            descriptors
                .iter()
                .enumerate()
                .for_each(|(at, fd)| data.add(at).write_unaligned(fd.as_raw_fd()));
        }
        libc::sendmsg(
            socket,
            &raw const header,
            libc::MSG_NOSIGNAL | libc::MSG_DONTWAIT,
        )
    };
    usize::try_from(sent).map_err(|_| std::io::Error::last_os_error())
}

/// Fills the capacity that `into` has to spare, as `recvmsg` does.
pub fn receive(socket: RawFd, into: &mut Vec<u8>, descriptors: &mut VecDeque<OwnedFd>) -> isize {
    let (spare, mut control) = (into.spare_capacity_mut(), [0u64; 16]);
    let mut vector = libc::iovec {
        iov_base: spare.as_mut_ptr().cast(),
        iov_len: spare.len(),
    };
    // SAFETY: the header points to locals. The kernel says how much it wrote, and the descriptors are new.
    unsafe {
        let mut header: libc::msghdr = std::mem::zeroed();
        (header.msg_iov, header.msg_iovlen) = (&raw mut vector, 1);
        (header.msg_control, header.msg_controllen) =
            (control.as_mut_ptr().cast(), size_of_val(&control) as _);
        let flags = libc::MSG_DONTWAIT | libc::MSG_CMSG_CLOEXEC;
        let count = libc::recvmsg(socket, &raw mut header, flags);
        let message = libc::CMSG_FIRSTHDR(&raw const header);
        if count > 0 && !message.is_null() && (*message).cmsg_type == libc::SCM_RIGHTS {
            let length = (*message).cmsg_len as usize - libc::CMSG_LEN(0) as usize;
            let data = libc::CMSG_DATA(message).cast::<RawFd>();
            let received =
                (0..length / 4).map(|at| OwnedFd::from_raw_fd(data.add(at).read_unaligned()));
            descriptors.extend(received);
        }
        into.set_len(into.len() + count.max(0) as usize);
        count
    }
}

/// For pixels that another process reads.
pub struct Memory {
    data: *mut [u8; 4],
    length: usize,
}

// SAFETY: it owns the mapping.
unsafe impl Send for Memory {}

impl Memory {
    pub fn new(length: usize) -> std::io::Result<(Memory, OwnedFd)> {
        // SAFETY: the descriptor is new, and the kernel chooses the address.
        unsafe {
            let fd = libc::memfd_create(c"pixels".as_ptr(), libc::MFD_CLOEXEC);
            if fd < 0 {
                return Err(std::io::Error::last_os_error());
            }
            let owned = OwnedFd::from_raw_fd(fd);
            if libc::ftruncate(fd, (length * 4) as libc::off_t) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            let protection = libc::PROT_READ | libc::PROT_WRITE;
            let data = libc::mmap(
                std::ptr::null_mut(),
                length * 4,
                protection,
                libc::MAP_SHARED,
                fd,
                0,
            );
            if data == libc::MAP_FAILED {
                return Err(std::io::Error::last_os_error());
            }
            Ok((
                Memory {
                    data: data.cast(),
                    length,
                },
                owned,
            ))
        }
    }

    pub fn pixels(&mut self) -> &mut [[u8; 4]] {
        // SAFETY: the mapping has this length, and the server only reads it.
        unsafe { std::slice::from_raw_parts_mut(self.data, self.length) }
    }
}

impl Drop for Memory {
    fn drop(&mut self) {
        // SAFETY: nothing borrows the mapping.
        unsafe { libc::munmap(self.data.cast(), self.length * 4) };
    }
}
