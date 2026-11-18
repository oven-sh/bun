//! Pages in processes of their own. `guest` is this library in such a process, which has fonts, images and canvases, and
//! `pages` is what shows their surfaces. It trusts nothing that it is sent.

#[cfg(target_os = "linux")]
pub mod gpu;
pub mod guest;
pub mod pages;
mod ring;
#[cfg(unix)]
pub mod sandbox;
#[cfg_attr(unix, path = "remote/unix.rs")]
#[cfg_attr(windows, path = "remote/absent.rs")]
pub mod system;
mod valid;

#[cfg(windows)]
pub use self::system::sandbox;

use self::system::{
    BorrowedFd, Part, UnixStream, WITHOUT_WAITING, clock, receive, receive_into, send_some,
};
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
    Told { Message, Input, Motion, Frame, Scroll }
    Asked { Named, Generic, Fonts, Fallback, Local, Names, Open, Stored, Store, Native, Gpu }
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn has_gpu_for_page() -> bool {
    #[cfg(target_os = "linux")]
    return gpu::APP.get().is_some();
    #[cfg(not(target_os = "linux"))]
    false
}

/// A `Told`, the length of what follows, how many frames and sizes were told, and what `bridge::edits_taken` was.
type Header = [u32; 5];
/// The ticket, the image, a size or zeros for all frames, and whether it has to be that size.
type Fetch = [u32; 5];

const UP: usize = 0;
const DOWN: [usize; 2] = [1, 2];

fn bytes_of<T: Valid>(values: &[T]) -> Part {
    Part {
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

impl Source for &[u8] {
    unsafe fn fill(&mut self, to: *mut u8, length: usize) -> Option<()> {
        // SAFETY: the caller's contract.
        unsafe { to.copy_from_nonoverlapping(self.split_off(..length)?.as_ptr(), length) };
        Some(())
    }
}

impl Source for &UnixStream {
    unsafe fn fill(&mut self, mut to: *mut u8, mut length: usize) -> Option<()> {
        while length > 0 {
            // SAFETY: the caller's contract.
            let (received, _) = unsafe { receive_into(self, to, length, 0) }.ok()?;
            (to, length) = (to.wrapping_add(received), length - received);
        }
        Some(())
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

fn send_all(
    socket: &UnixStream,
    mut parts: &mut [Part],
    mut descriptor: Option<BorrowedFd<'_>>,
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

/// A byte that carries the descriptor, and a list.
fn send_answer(
    socket: &UnixStream,
    bytes: &[u8],
    descriptor: Option<BorrowedFd<'_>>,
) -> Option<()> {
    send_all(
        socket,
        &mut [
            bytes_of(&[0u8]),
            bytes_of(&[bytes.len() as u32]),
            bytes_of(bytes),
        ],
        descriptor,
    )
}

/// Wakes whoever waits for the other end. If it is full, that is readable anyway.
fn ring(bell: &UnixStream) {
    drop(send_some(bell, &[bytes_of(&[0u8])], None, WITHOUT_WAITING));
}
