//! IPv4 and IPv6 sockets, for code that speaks a protocol itself rather than through uSockets.

use core::ffi::c_int;

use crate::net::Address;
use crate::{Error, Fd, Maybe, Tag};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Stream,
    Datagram,
}

#[cfg(unix)]
mod imp {
    use super::*;
    use crate::{FdExt as _, last_errno};

    pub use libc::{IPPROTO_TCP, TCP_NODELAY};

    fn check(rc: c_int, tag: Tag) -> Maybe<()> {
        if rc < 0 {
            return Err(Error::from_code_int(last_errno(), tag));
        }
        Ok(())
    }

    pub fn open(peer: &Address, kind: Kind) -> Maybe<Fd> {
        let kind = match kind {
            Kind::Stream => libc::SOCK_STREAM,
            Kind::Datagram => libc::SOCK_DGRAM,
        };
        #[cfg(not(target_os = "macos"))]
        let kind = kind | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC;
        // SAFETY: takes no pointer.
        let rc = unsafe { libc::socket(peer.family(), kind, 0) };
        check(rc, Tag::socket)?;
        let fd = Fd::from_native(rc);
        #[cfg(target_os = "macos")]
        if let Err(error) = crate::set_nonblocking(fd)
            .and_then(|()| crate::set_close_on_exec(fd))
            .and_then(|()| set_option(fd, libc::SOL_SOCKET, libc::SO_NOSIGPIPE, 1))
        {
            close(fd);
            return Err(error);
        }
        Ok(fd)
    }

    pub fn close(fd: Fd) {
        fd.close();
    }

    pub fn set_option(fd: Fd, level: c_int, name: c_int, value: c_int) -> Maybe<()> {
        // SAFETY: `value` is an int that outlives the call, and its size is what is passed.
        let rc = unsafe {
            libc::setsockopt(
                fd.native(),
                level,
                name,
                (&raw const value).cast(),
                size_of::<c_int>() as libc::socklen_t,
            )
        };
        check(rc, Tag::setsockopt)
    }

    pub fn bind(fd: Fd, address: &Address) -> Maybe<()> {
        // SAFETY: `address` holds `socklen()` bytes of a sockaddr.
        let rc = unsafe { libc::bind(fd.native(), address.as_sockaddr(), address.socklen()) };
        check(rc, Tag::bind2)
    }

    pub fn connect(fd: Fd, address: &Address) -> Maybe<()> {
        loop {
            // SAFETY: `address` holds `socklen()` bytes of a sockaddr.
            let rc =
                unsafe { libc::connect(fd.native(), address.as_sockaddr(), address.socklen()) };
            match check(rc, Tag::connect) {
                Err(error) if error.get_errno() == crate::E::EINTR => {}
                result => return result,
            }
        }
    }

    pub fn local_address(fd: Fd) -> Maybe<Address> {
        let mut address = Address::UNSPECIFIED;
        let mut len = size_of::<Address>() as libc::socklen_t;
        // SAFETY: `address` is `len` writable bytes, aligned for any sockaddr.
        let rc = unsafe { libc::getsockname(fd.native(), address.as_sockaddr_mut(), &raw mut len) };
        check(rc, Tag::getsockname)?;
        Ok(address)
    }

    pub fn recv_from(fd: Fd, buffer: &mut [u8]) -> Maybe<(usize, Address)> {
        let mut address = Address::UNSPECIFIED;
        let mut len = size_of::<Address>() as libc::socklen_t;
        loop {
            // SAFETY: `buffer` is `buffer.len()` writable bytes; `address` as in `local_address`.
            let rc = unsafe {
                libc::recvfrom(
                    fd.native(),
                    buffer.as_mut_ptr().cast(),
                    buffer.len(),
                    libc::MSG_DONTWAIT,
                    address.as_sockaddr_mut(),
                    &raw mut len,
                )
            };
            if let Ok(received) = usize::try_from(rc) {
                return Ok((received, address));
            }
            let errno = last_errno();
            if errno != libc::EINTR {
                return Err(Error::from_code_int(errno, Tag::recv));
            }
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use bun_windows_sys::{Win32Error, ws2_32};

    pub use ws2_32::{IPPROTO_TCP, TCP_NODELAY};

    fn check(rc: c_int, tag: Tag) -> Maybe<()> {
        if rc != 0 {
            return Err(Error::from_win32(Win32Error::get(), tag));
        }
        Ok(())
    }

    fn socket_of(fd: Fd) -> usize {
        fd.native() as usize
    }

    pub fn open(peer: &Address, kind: Kind) -> Maybe<Fd> {
        let kind = match kind {
            Kind::Stream => ws2_32::SOCK_STREAM,
            Kind::Datagram => ws2_32::SOCK_DGRAM,
        };
        // SAFETY: the null pointer asks for the default provider.
        let socket = unsafe {
            ws2_32::WSASocketW(
                peer.family(),
                kind,
                0,
                core::ptr::null_mut(),
                0,
                ws2_32::WSA_FLAG_OVERLAPPED | ws2_32::WSA_FLAG_NO_HANDLE_INHERIT,
            )
        };
        if socket == ws2_32::INVALID_SOCKET {
            return Err(Error::from_win32(Win32Error::get(), Tag::socket));
        }
        let fd = Fd::from_system(socket as *mut core::ffi::c_void);
        let mut nonblocking: u32 = 1;
        // SAFETY: FIONBIO reads one u32.
        let rc = unsafe { ws2_32::ioctlsocket(socket, ws2_32::FIONBIO, &raw mut nonblocking) };
        if let Err(error) = check(rc, Tag::ioctl) {
            close(fd);
            return Err(error);
        }
        Ok(fd)
    }

    pub fn close(fd: Fd) {
        // SAFETY: takes no pointer.
        unsafe { ws2_32::closesocket(socket_of(fd)) };
    }

    pub fn set_option(fd: Fd, level: c_int, name: c_int, value: c_int) -> Maybe<()> {
        // SAFETY: `value` is an int that outlives the call, and its size is what is passed.
        let rc = unsafe {
            ws2_32::setsockopt(
                socket_of(fd),
                level,
                name,
                (&raw const value).cast(),
                size_of::<c_int>() as c_int,
            )
        };
        check(rc, Tag::setsockopt)
    }

    pub fn bind(fd: Fd, address: &Address) -> Maybe<()> {
        // SAFETY: `address` holds `socklen()` bytes of a sockaddr.
        let rc = unsafe {
            ws2_32::bind(
                socket_of(fd),
                address.as_sockaddr().cast(),
                address.socklen() as c_int,
            )
        };
        check(rc, Tag::bind2)
    }

    pub fn connect(fd: Fd, address: &Address) -> Maybe<()> {
        // SAFETY: `address` holds `socklen()` bytes of a sockaddr.
        let rc = unsafe {
            ws2_32::connect(
                socket_of(fd),
                address.as_sockaddr().cast(),
                address.socklen() as c_int,
            )
        };
        check(rc, Tag::connect)
    }

    pub fn local_address(fd: Fd) -> Maybe<Address> {
        let mut address = Address::UNSPECIFIED;
        let mut len = size_of::<Address>() as c_int;
        // SAFETY: `address` is `len` writable bytes, aligned for any sockaddr.
        let rc = unsafe {
            ws2_32::getsockname(
                socket_of(fd),
                address.as_sockaddr_mut().cast(),
                &raw mut len,
            )
        };
        check(rc, Tag::getsockname)?;
        Ok(address)
    }

    pub fn recv_from(fd: Fd, buffer: &mut [u8]) -> Maybe<(usize, Address)> {
        let mut address = Address::UNSPECIFIED;
        let mut len = size_of::<Address>() as c_int;
        // SAFETY: `buffer` is at least the length passed; `address` as in `local_address`.
        let rc = unsafe {
            ws2_32::recvfrom(
                socket_of(fd),
                buffer.as_mut_ptr().cast(),
                buffer.len().min(c_int::MAX as usize) as c_int,
                0,
                address.as_sockaddr_mut().cast(),
                &raw mut len,
            )
        };
        match usize::try_from(rc) {
            Ok(received) => Ok((received, address)),
            Err(_) => Err(Error::from_win32(Win32Error::get(), Tag::recv)),
        }
    }
}

/// `Err` with `EINPROGRESS` or `EAGAIN` if the connection is still being made.
pub use imp::connect;
/// The address the system gave the socket, or it was bound to.
pub use imp::local_address;
/// A non-blocking socket of `peer`'s family that child processes do not inherit and that raises no `SIGPIPE`.
pub use imp::open;
pub use imp::{IPPROTO_TCP, TCP_NODELAY, bind, close, recv_from, set_option};
