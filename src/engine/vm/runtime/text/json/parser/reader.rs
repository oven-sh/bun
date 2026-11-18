//! The text as bytes, of which those that are ASCII stand for themselves whatever the encoding is.

use core::marker::PhantomData;
use core::mem::MaybeUninit;

use bun_engine_text::Text;

use crate::json::Source;

/// So many bytes can be looked at without asking where the text ends.
pub(super) const WINDOW: usize = 64;
const PIECE: usize = 8 * WINDOW;

pub(super) type Buffer = [MaybeUninit<u8>; PIECE + WINDOW];

/// Where a `Reader` is, apart from it so that it stays in a register. Only the reader moves it back.
#[repr(transparent)]
pub(crate) struct Cursor<'a>(*const u8, PhantomData<&'a [u8]>);

impl Cursor<'_> {
    /// The reader finds out if that is too far.
    #[inline(always)]
    pub(super) fn advance(&mut self, count: u32) {
        self.0 = self.0.wrapping_add(count as usize);
    }
}

/// Bytes are read where they are. Wide units, and the end of the text, are read from a copy. A window of zeros follows
/// the end.
#[repr(C)]
pub(super) struct Reader<'a> {
    /// The address of the last window in the memory that the cursor is in, or zero.
    last_window: usize,
    /// The address that the cursor would have had at the start.
    origin: usize,
    source: Source<'a>,
    buffer: &'a mut Buffer,
}

impl<'a> Reader<'a> {
    #[inline(always)]
    pub(super) fn new(source: Source<'a>, buffer: &'a mut Buffer) -> (Reader<'a>, Cursor<'a>) {
        let bytes = match source {
            Source::Text(Text::Latin1(bytes)) | Source::Utf8(bytes) => bytes,
            Source::Text(Text::Utf16(_)) => &[],
        };
        let reader = Reader {
            last_window: (bytes.last_chunk::<WINDOW>()).map_or(0, |last| last.as_ptr().addr()),
            origin: bytes.as_ptr().addr(),
            source,
            buffer,
        };
        (reader, Cursor(bytes.as_ptr(), PhantomData))
    }

    #[inline(always)]
    pub(super) fn window(&mut self, cursor: &mut Cursor<'a>) -> &[u8; WINDOW] {
        if cursor.0.addr() > self.last_window {
            cursor.0 = self.refill(cursor.0);
        }
        // SAFETY: inside the text or what has been written of the buffer, which stays borrowed.
        unsafe { &*cursor.0.cast() }
    }

    #[cold]
    #[inline(never)]
    extern "rust-cold" fn refill(&mut self, cursor: *const u8) -> *const u8 {
        let position = cursor.addr().wrapping_sub(self.origin);
        let copy = bun_engine_text::Cursor::fill_uninit(self.buffer, |copy| {
            let left = match self.source {
                Source::Text(Text::Latin1(bytes)) | Source::Utf8(bytes) => {
                    copy.push_slice(&bytes[position..]);
                    0
                }
                Source::Text(Text::Utf16(units)) => {
                    let rest = &units[position..];
                    let (piece, left) = rest.split_at(rest.len().min(PIECE));
                    // SAFETY: the loop writes all of them.
                    let bytes = unsafe { copy.take_uninit(piece.len()) };
                    for (byte, &unit) in bytes.iter_mut().zip(piece) {
                        byte.write(unit.min(0xff) as u8);
                    }
                    left.len()
                }
            };
            if left == 0 {
                copy.push_array([0; WINDOW]);
            }
        });
        self.last_window = copy[copy.len() - WINDOW..].as_ptr().addr();
        self.origin = copy.as_ptr().addr().wrapping_sub(position);
        copy.as_ptr()
    }

    #[inline(always)]
    pub(super) fn source(&self) -> Source<'a> {
        self.source
    }

    #[inline(always)]
    pub(super) fn position(&self, cursor: &Cursor<'a>) -> usize {
        cursor.0.addr().wrapping_sub(self.origin)
    }

    /// By the length of a part of the text that starts there.
    #[inline(always)]
    pub(super) fn skip<T>(&self, cursor: &mut Cursor<'a>, rest: &[T], count: usize) {
        assert!(count <= rest.len());
        cursor.0 = cursor.0.wrapping_add(count);
    }
}
