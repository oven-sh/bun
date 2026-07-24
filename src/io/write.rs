//! Byte-oriented `Write` trait + helpers.
//!
//! The byte-writer surface the rest of the codebase actually
//! touches (`writeAll`, `writeByte`, `print`, `splatByteAll`, `writeInt`,
//! `flush`). It is a normal trait
//! whose only required method is [`Write::write_all`]. Everything else is
//! provided in terms of that, so a sink only needs to spell out how to push a
//! byte slice.
//!
//! This module also provides:
//!   * [`FmtAdapter`] — bridge a `core::fmt::Write` sink (e.g. a
//!     `core::fmt::Formatter`) into a byte-level [`Write`], so byte-producing
//!     `print()`/`format()` impls can drive `Display`.
//!
//! Error type is `crate::Error` so `?` composes with the rest of the
//! codebase. [`Result`] is exported as `bun_io::Result` for downstream sigs.

use core::fmt;

/// `bun_io::Result<T>` — alias over `bun_core::Error` (the `Write` trait's
/// error type) so byte-writer fallible paths compose with the trait via `?`.
pub type Result<T = ()> = core::result::Result<T, bun_core::Error>;

// ════════════════════════════════════════════════════════════════════════════
// trait Write — canonical definition lives in `bun_core::io` so leaf crates
// (`bun_core`, `bun_collections`, `bun_url`) can implement it without an
// upward dep on this crate. Re-exported here so downstream keeps spelling it
// `bun_io::Write` / `bun_io::IntLe`.
// ════════════════════════════════════════════════════════════════════════════
pub use bun_core::write::{IntLe, Write};

// ════════════════════════════════════════════════════════════════════════════
// DiscardingWriter — counting null sink
// ════════════════════════════════════════════════════════════════════════════

/// Discards all bytes written to it but tracks how many were written.
#[derive(Default)]
pub struct DiscardingWriter {
    /// Total bytes "written" (discarded) so far.
    pub count: usize,
}

impl DiscardingWriter {
    #[inline]
    pub const fn new() -> Self {
        Self { count: 0 }
    }
}

impl Write for DiscardingWriter {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<()> {
        self.count += buf.len();
        Ok(())
    }
    #[inline]
    fn splat_byte_all(&mut self, _byte: u8, n: usize) -> Result<()> {
        self.count += n;
        Ok(())
    }
    #[inline]
    fn written_len(&self) -> usize {
        self.count
    }
}

// ════════════════════════════════════════════════════════════════════════════
// FixedBufferStream — cursor over an in-memory buffer
// ════════════════════════════════════════════════════════════════════════════

/// A seekable cursor over a byte
/// buffer that can act as both a reader (when `B: AsRef<[u8]>`) and a writer
/// (when `B: AsMut<[u8]>`). `pos` and `buffer` are public.
pub struct FixedBufferStream<B> {
    pub buffer: B,
    pub pos: usize,
}

impl<B> FixedBufferStream<B> {
    /// Construct a stream over `buffer` starting at position 0.
    #[inline]
    pub fn new(buffer: B) -> Self {
        Self { buffer, pos: 0 }
    }

    /// Seek to absolute position `p`.
    #[inline]
    pub fn seek_to(&mut self, p: usize) {
        self.pos = p;
    }

    /// Rewind to position 0.
    #[inline]
    pub fn reset(&mut self) {
        self.pos = 0;
    }
}

impl<'a> FixedBufferStream<&'a mut [u8]> {
    /// Convenience constructor for a writable borrowed slice.
    #[inline]
    pub fn new_mut(buffer: &'a mut [u8]) -> Self {
        Self { buffer, pos: 0 }
    }
}

impl<B: AsRef<[u8]>> FixedBufferStream<B> {
    /// Bytes written so far (the slice `[0..pos]`).
    #[inline]
    pub fn get_written(&self) -> &[u8] {
        &self.buffer.as_ref()[..self.pos]
    }

    /// Current cursor position.
    #[inline]
    pub fn get_pos(&self) -> Result<usize> {
        Ok(self.pos)
    }

    /// The read methods live directly on `FixedBufferStream`, so this just
    /// returns `self` to keep call-site shape
    /// (`stream.reader().read_int_le::<T>()`).
    #[inline]
    pub fn reader(&mut self) -> &mut Self {
        self
    }

    /// Read up to `out.len()` bytes from the current position, advancing it.
    /// Returns the number of bytes read (may be `< out.len()` at EOF).
    pub fn read_all(&mut self, out: &mut [u8]) -> Result<usize> {
        let buf = self.buffer.as_ref();
        let avail = buf.len().saturating_sub(self.pos);
        let n = avail.min(out.len());
        out[..n].copy_from_slice(&buf[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }

    /// Read exactly `out.len()` bytes from the current position, advancing it.
    /// Errors with `EndOfStream` if fewer bytes remain.
    pub fn read_exact(&mut self, out: &mut [u8]) -> Result<()> {
        let buf = self.buffer.as_ref();
        let end = self
            .pos
            .checked_add(out.len())
            .ok_or(bun_core::Error::EndOfStream)?;
        if end > buf.len() {
            return Err(bun_core::Error::EndOfStream);
        }
        out.copy_from_slice(&buf[self.pos..end]);
        self.pos = end;
        Ok(())
    }

    /// Read a little-endian integer.
    #[inline]
    pub fn read_int_le<I: IntLe>(&mut self) -> Result<I> {
        let mut bytes = I::Bytes::default();
        self.read_exact(bytes.as_mut())?;
        Ok(I::from_le_bytes(bytes))
    }

    /// Read a POD struct.
    ///
    /// SAFETY: caller is responsible for `T` being `#[repr(C)]` POD with no
    /// padding-sensitive invariants.
    pub fn read_struct<T: Copy>(&mut self) -> Result<T> {
        let buf = self.buffer.as_ref();
        let n = core::mem::size_of::<T>();
        let end = self
            .pos
            .checked_add(n)
            .ok_or(bun_core::Error::EndOfStream)?;
        if end > buf.len() {
            return Err(bun_core::Error::EndOfStream);
        }
        // SAFETY: `buf[pos..end]` is exactly `size_of::<T>()` initialized
        // bytes from the safe slice borrow; caller contract guarantees `T` is
        // `#[repr(C)]` POD where every byte pattern is valid.
        // `read_unaligned` tolerates any source alignment.
        let out = unsafe { core::ptr::read_unaligned(buf[self.pos..end].as_ptr().cast::<T>()) };
        self.pos = end;
        Ok(out)
    }
}

impl<B: AsMut<[u8]>> Write for FixedBufferStream<B> {
    fn write_all(&mut self, src: &[u8]) -> Result<()> {
        let buf = self.buffer.as_mut();
        let end = self
            .pos
            .checked_add(src.len())
            .ok_or(bun_core::Error::NoSpaceLeft)?;
        if end > buf.len() {
            return Err(bun_core::Error::NoSpaceLeft);
        }
        buf[self.pos..end].copy_from_slice(src);
        self.pos = end;
        Ok(())
    }
    #[inline]
    fn written_len(&self) -> usize {
        self.pos
    }
}

// ════════════════════════════════════════════════════════════════════════════
// FmtAdapter — core::fmt::Write → bun_io::Write bridge
// ════════════════════════════════════════════════════════════════════════════

/// Wrap a `core::fmt::Write` sink (typically `&mut core::fmt::Formatter`) so it
/// can be passed where a byte-level [`Write`] is expected.
///
/// Bytes are routed through `write_str` after a UTF-8 check; non-UTF-8 input is
/// lossily decoded — it never fails on encoding, only on the underlying writer.
pub struct FmtAdapter<'a, W: ?Sized = fmt::Formatter<'a>> {
    inner: &'a mut W,
}

impl<'a, W: fmt::Write + ?Sized> FmtAdapter<'a, W> {
    #[inline]
    pub fn new(inner: &'a mut W) -> Self {
        Self { inner }
    }
}

impl<W: fmt::Write + ?Sized> fmt::Write for FmtAdapter<'_, W> {
    #[inline]
    fn write_str(&mut self, s: &str) -> fmt::Result {
        self.inner.write_str(s)
    }
}

// `W: Sized` (no `?Sized`) — together with [`AsFmt`] (the inverse adapter),
// `?Sized` here would let rustc probe the infinite tower
// `FmtAdapter<AsFmt<FmtAdapter<AsFmt<…>>>>` when checking `dyn Write: Write`,
// which is E0275. Every caller wraps a concrete sized formatter, so dropping
// `?Sized` on this side breaks the cycle without losing any instantiation.
impl<W: fmt::Write> Write for FmtAdapter<'_, W> {
    fn write_all(&mut self, buf: &[u8]) -> Result<()> {
        // Fast path: valid UTF-8 (overwhelmingly the case for our printers).
        let r = match bun_core::str_utf8(buf) {
            Some(s) => self.inner.write_str(s),
            // Invalid UTF-8 cannot enter a `fmt::Write` sink losslessly;
            // replacement chars are the price of bridging (same output as
            // from_utf8_lossy, without the allocation).
            None => buf.utf8_chunks().try_for_each(|chunk| {
                self.inner.write_str(chunk.valid())?;
                if chunk.invalid().is_empty() {
                    Ok(())
                } else {
                    self.inner.write_str("\u{FFFD}")
                }
            }),
        };
        r.map_err(|_| bun_core::Error::FmtError)
    }

    #[inline]
    fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<()> {
        // Skip the byte round-trip entirely when we already have a fmt sink.
        self.inner
            .write_fmt(args)
            .map_err(|_| bun_core::Error::FmtError)
    }
}

// ════════════════════════════════════════════════════════════════════════════
// AsFmt — bun_io::Write → core::fmt::Write bridge
// ════════════════════════════════════════════════════════════════════════════

/// View a byte sink (`W: bun_io::Write`) as a `core::fmt::Write`.
///
/// Inverse of [`FmtAdapter`]. Use this when a callee is typed against
/// `impl core::fmt::Write` (e.g. `Display`, const-generic colour formatters,
/// `Msg::write_format`) but you hold a `bun_io::Write` byte sink — `Vec<u8>`,
/// `bun_core::io::Writer`, `&mut dyn Write`, etc.
///
/// `write_str` routes through `write_all(s.as_bytes())`.
///
/// Erased to `dyn Write` (not generic over `W`) so this type does not pair
/// with [`FmtAdapter`]'s `impl Write` to form an infinite
/// `FmtAdapter<AsFmt<…>>` tower (E0275) — see the note on that impl.
pub struct AsFmt<'a> {
    sink: &'a mut dyn Write,
}

impl<'a> AsFmt<'a> {
    /// Wrap any `bun_io::Write` sink. Takes `&mut dyn Write` directly so the
    /// unsize coercion happens at the call site (where the concrete `W` is
    /// known) rather than inside a `?Sized` generic — that lets both `&mut Vec`
    /// (auto-coerced) and an existing `&mut dyn Write` pass with one signature.
    #[inline]
    pub fn new(sink: &'a mut dyn Write) -> Self {
        Self { sink }
    }
}

impl fmt::Write for AsFmt<'_> {
    #[inline]
    fn write_str(&mut self, s: &str) -> fmt::Result {
        self.sink.write_all(s.as_bytes()).map_err(|_| fmt::Error)
    }
}

// ════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vec_sink() {
        let mut v = Vec::new();
        v.write_all(b"hello").unwrap();
        v.write_byte(b' ').unwrap();
        v.splat_byte_all(b'!', 3).unwrap();
        v.write_int_le::<u16>(0x0201).unwrap();
        assert_eq!(v, b"hello !!!\x01\x02");
    }

    #[test]
    fn fmt_adapter() {
        let mut s = String::new();
        {
            let mut a = FmtAdapter::new(&mut s);
            a.write_all(b"hi ").unwrap();
            write!(a, "{}", 42).expect("infallible: in-memory write");
        }
        assert_eq!(s, "hi 42");
    }
}
