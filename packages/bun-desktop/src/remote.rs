//! Pages in processes of their own. `guest` is this library in such a process, which has fonts, images and canvases, and
//! `pages` is what shows their surfaces. It trusts nothing that it is sent.

pub mod guest;
pub mod pages;
mod ring;
mod valid;

use std::io::{self, Read};
use std::os::fd::{AsRawFd as _, FromRawFd as _, OwnedFd};
use std::os::unix::net::UnixStream;

use self::valid::Valid;
use crate::gfx::Pixmap;
use crate::protocol::LENT_IMAGE as LENT;

macro_rules! kinds {
    ($($Name:ident { $($kind:ident),* })*) => {$(
        #[derive(Clone, Copy)]
        enum $Name {
            $($kind,)*
        }

        impl $Name {
            fn of(number: u8) -> Option<$Name> {
                [$($Name::$kind,)*].get(usize::from(number)).copied()
            }
        }
    )*};
}

kinds! {
    Sent {
        Message, Scene, Scrollers, Accessibility, RequestFrame, Cursor, Canvas, Field, PasswordField, BeginDrag, Bounds, Mirror, Handled, File, Face,
        Bitmap, Recording, Pixels, Release, Question
    }
    Told { Message, Frame, Scroll }
    Asked { Named, Generic, Fonts, Fallback, Local, Names, Open, Stored, Store }
}

/// A `Told`, whether a descriptor belongs to it, the length of what follows, how many frames and sizes were told, and
/// what `bridge::edits_taken` was.
type Header = [u32; 6];
/// The ticket, the image, a size or zeros for all frames, and whether it has to be that size.
type Fetch = [u32; 5];

const UP: usize = 0;
const DOWN: [usize; 2] = [1, 2];

fn bytes_of<T: Valid>(values: &[T]) -> libc::iovec {
    libc::iovec {
        iov_base: values.as_ptr().cast_mut().cast(),
        iov_len: size_of_val(values),
    }
}

#[derive(Default)]
struct Writer(Vec<u8>);

impl Writer {
    fn all<T: Valid>(&mut self, values: &[T]) -> &mut Writer {
        let (length, more) = (self.0.len(), size_of_val(values));
        self.0.reserve(more);
        // SAFETY: there is room. What pads the values is only ever copied.
        unsafe {
            self.0
                .as_mut_ptr()
                .add(length)
                .copy_from_nonoverlapping(values.as_ptr().cast(), more);
            self.0.set_len(length + more);
        }
        self
    }

    fn put<T: Valid>(&mut self, value: T) -> &mut Writer {
        self.all(&[value])
    }

    fn flag(&mut self, value: bool) -> &mut Writer {
        self.put(u8::from(value))
    }

    fn list<T: Valid>(&mut self, values: &[T]) -> &mut Writer {
        self.put(values.len() as u32).all(values)
    }
}

trait Source {
    /// # Safety
    /// That many bytes are writable.
    unsafe fn fill(&mut self, to: *mut u8, length: usize) -> Option<()>;
}

impl<R: Read> Source for R {
    unsafe fn fill(&mut self, to: *mut u8, length: usize) -> Option<()> {
        // SAFETY: the caller's contract. They are initialized first.
        self.read_exact(unsafe {
            to.write_bytes(0, length);
            std::slice::from_raw_parts_mut(to, length)
        })
        .ok()
    }
}

struct Reader<S>(S);

impl<S: Source> Reader<S> {
    fn get<T: Valid>(&mut self) -> Option<T> {
        let mut value = std::mem::MaybeUninit::<T>::uninit();
        // SAFETY: the bytes are written, and then they are checked.
        unsafe {
            self.0.fill(value.as_mut_ptr().cast(), size_of::<T>())?;
            T::is_valid(std::slice::from_raw_parts(
                value.as_ptr().cast(),
                size_of::<T>(),
            ))
            .then(|| value.assume_init())
        }
    }

    fn flag(&mut self) -> Option<bool> {
        [false, true].get(usize::from(self.get::<u8>()?)).copied()
    }

    fn all_into<T: Valid>(
        &mut self,
        into: &mut Vec<T>,
        count: u32,
        most_bytes: usize,
    ) -> Option<()> {
        (count as usize <= most_bytes / size_of::<T>()).then_some(())?;
        // SAFETY: it does, and there is room for that many.
        unsafe { valid::read_into(into, count as usize, |to, length| self.0.fill(to, length)) }
    }

    fn list<T: Valid>(&mut self, most_bytes: usize) -> Option<Vec<T>> {
        let (count, mut all) = (self.get()?, Vec::new());
        self.all_into(&mut all, count, most_bytes)?;
        Some(all)
    }

    fn text(&mut self, most_bytes: usize) -> Option<String> {
        String::from_utf8(self.list(most_bytes)?).ok()
    }

    /// Premultiplied, whatever was sent.
    fn pixels(&mut self, [width, height]: [u32; 2]) -> Option<Pixmap> {
        let (count, mut bytes) = (
            u32::try_from(u64::from(width) * u64::from(height) * 4).ok()?,
            Vec::<u8>::new(),
        );
        self.all_into(&mut bytes, count, 1 << 30)?;
        for [r, g, b, a] in bytes.as_chunks_mut().0 {
            (*r, *g, *b) = ((*r).min(*a), (*g).min(*a), (*b).min(*a));
        }
        Pixmap::from_vec(bytes, width, height)
    }
}

#[cfg(target_os = "linux")]
const NO_SIGNAL: i32 = libc::MSG_NOSIGNAL;
#[cfg(not(target_os = "linux"))]
const NO_SIGNAL: i32 = 0;

#[repr(C)]
struct WithDescriptor {
    header: libc::cmsghdr,
    descriptor: i32,
    padding: i32,
}

/// Returns how much was sent.
fn send_some(
    socket: &UnixStream,
    parts: &[libc::iovec],
    descriptor: Option<&OwnedFd>,
    flags: i32,
) -> io::Result<usize> {
    // SAFETY: zeros are messages without parts, which then get some that outlive the call.
    unsafe {
        let (mut message, mut control): (libc::msghdr, WithDescriptor) =
            (std::mem::zeroed(), std::mem::zeroed());
        (message.msg_iov, message.msg_iovlen) = (parts.as_ptr().cast_mut(), parts.len() as _);
        if let Some(descriptor) = descriptor {
            (
                control.header.cmsg_len,
                control.header.cmsg_level,
                control.header.cmsg_type,
            ) = (libc::CMSG_LEN(4) as _, libc::SOL_SOCKET, libc::SCM_RIGHTS);
            control.descriptor = descriptor.as_raw_fd();
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

fn send_all(
    socket: &UnixStream,
    mut parts: &mut [libc::iovec],
    mut descriptor: Option<&OwnedFd>,
) -> Option<()> {
    while !parts.is_empty() {
        let mut sent = send_some(socket, parts, descriptor.take(), 0).ok()?;
        while let Some(first) = parts.first_mut() {
            if first.iov_len > sent {
                (first.iov_base, first.iov_len) =
                    (first.iov_base.wrapping_byte_add(sent), first.iov_len - sent);
                break;
            }
            sent -= first.iov_len;
            parts = &mut parts[1..];
        }
    }
    Some(())
}

/// Wakes whoever waits for the other end. If it is full, that is readable anyway.
fn ring(bell: &UnixStream) {
    drop(send_some(
        bell,
        &[bytes_of(&[0u8])],
        None,
        libc::MSG_DONTWAIT,
    ));
}

/// Some bytes, and the descriptor that came with them. An error if there are none.
fn receive(socket: &UnixStream, bytes: &mut [u8], flags: i32) -> io::Result<Option<OwnedFd>> {
    #[cfg(target_os = "linux")]
    const FLAGS: i32 = libc::MSG_CMSG_CLOEXEC;
    #[cfg(not(target_os = "linux"))]
    const FLAGS: i32 = 0;
    let mut part = libc::iovec {
        iov_base: bytes.as_mut_ptr().cast(),
        iov_len: bytes.len(),
    };
    // SAFETY: as above. A descriptor that was received is nobody else's.
    unsafe {
        let (mut message, mut control): (libc::msghdr, WithDescriptor) =
            (std::mem::zeroed(), std::mem::zeroed());
        (message.msg_iov, message.msg_iovlen) = (&raw mut part, 1);
        (message.msg_control, message.msg_controllen) =
            ((&raw mut control).cast(), libc::CMSG_SPACE(4) as _);
        loop {
            match libc::recvmsg(socket.as_raw_fd(), &mut message, flags | FLAGS) {
                0 => return Err(io::ErrorKind::UnexpectedEof.into()),
                1.. => break,
                _ if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted => {}
                _ => return Err(io::Error::last_os_error()),
            }
        }
        let has_one = message.msg_controllen > 0 && control.header.cmsg_type == libc::SCM_RIGHTS;
        Ok(has_one.then(|| OwnedFd::from_raw_fd(control.descriptor)))
    }
}

/// In nanoseconds, the same in all processes.
fn clock() -> u64 {
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
