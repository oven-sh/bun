//! Byte-oriented `Write` trait + helpers.
//!
//! Port of Zig's `std.Io.Writer` surface that the rest of the codebase actually
//! touches (`writeAll`, `writeByte`, `print`, `splatByteAll`, `writeInt`,
//! `flush`). The Zig writer is a fat-pointer vtable; here it is a normal trait
//! whose only required method is [`Write::write_all`]. Everything else is
//! provided in terms of that, so a sink only needs to spell out how to push a
//! byte slice.
//!
//! This module also provides:
//!   * [`BufWriter`] — `std.fs.File.writerStreaming`-style buffered wrapper
//!     over a borrowed `&mut [u8]` scratch buffer (no heap allocation).
//!   * [`FmtAdapter`] — bridge a `core::fmt::Write` sink (e.g. a
//!     `core::fmt::Formatter`) into a byte-level [`Write`], so byte-producing
//!     `print()`/`format()` impls can drive `Display`.
//!
//! Error type is `bun_core::Error` so `?` composes with the rest of the
//! codebase. [`Result`] is exported as `bun_io::Result` for downstream sigs.

use core::fmt;

/// `bun_io::Result<T>` — alias over `bun_core::Error` so byte-writer fallible
/// paths compose with the rest of the codebase via `?`.
pub type Result<T = ()> = core::result::Result<T, bun_core::Error>;

// ════════════════════════════════════════════════════════════════════════════
// trait Write — canonical definition lives in `bun_core::io` so leaf crates
// (`bun_core`, `bun_collections`, `bun_url`) can implement it without an
// upward dep on this crate. Re-exported here so downstream keeps spelling it
// `bun_io::Write` / `bun_io::IntLe`.
// ════════════════════════════════════════════════════════════════════════════
pub use bun_core::write::{IntBe, IntLe, Write};

// ════════════════════════════════════════════════════════════════════════════
// DiscardingWriter — counting null sink
// ════════════════════════════════════════════════════════════════════════════

/// Discards all bytes written to it but tracks how many were written.
/// Port of Zig `std.Io.Writer.Discarding` / `std.io.countingWriter(null_writer)`.
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

/// Port of Zig `std.io.FixedBufferStream(B)` — a seekable cursor over a byte
/// buffer that can act as both a reader (when `B: AsRef<[u8]>`) and a writer
/// (when `B: AsMut<[u8]>`). `pos` and `buffer` are public to mirror the Zig
/// struct fields.
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

    /// Seek to absolute position `p`. Zig: `seekTo`.
    #[inline]
    pub fn seek_to(&mut self, p: usize) {
        self.pos = p;
    }

    /// Rewind to position 0. Zig: `reset`.
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
    /// Bytes written so far (the slice `[0..pos]`). Zig: `getWritten()`.
    #[inline]
    pub fn get_written(&self) -> &[u8] {
        &self.buffer.as_ref()[..self.pos]
    }

    /// Current cursor position. Zig: `getPos()`.
    #[inline]
    pub fn get_pos(&self) -> Result<usize> {
        Ok(self.pos)
    }

    /// Zig `reader()` returns a `Reader` view over the same buffer; the read
    /// methods here live directly on `FixedBufferStream`, so this just returns
    /// `self` to keep call-site shape (`stream.reader().read_int_le::<T>()`).
    #[inline]
    pub fn reader(&mut self) -> &mut Self {
        self
    }

    /// Read up to `out.len()` bytes from the current position, advancing it.
    /// Returns the number of bytes read (may be `< out.len()` at EOF).
    /// Zig: `reader().readAll(buf)`.
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
            .ok_or_else(|| bun_core::err!("EndOfStream"))?;
        if end > buf.len() {
            return Err(bun_core::err!("EndOfStream"));
        }
        out.copy_from_slice(&buf[self.pos..end]);
        self.pos = end;
        Ok(())
    }

    /// Read a little-endian integer. Zig: `reader().readInt(T, .little)`.
    #[inline]
    pub fn read_int_le<I: IntLe>(&mut self) -> Result<I> {
        let mut bytes = I::Bytes::default();
        self.read_exact(bytes.as_mut())?;
        Ok(I::from_le_bytes(bytes))
    }

    /// Read a big-endian (network-order) integer. Zig: `reader().readInt(T, .big)`.
    #[inline]
    pub fn read_int_be<I: IntBe>(&mut self) -> Result<I> {
        let mut bytes = I::Bytes::default();
        self.read_exact(bytes.as_mut())?;
        Ok(I::from_be_bytes(bytes))
    }

    /// Read a POD struct. Zig: `reader().readStruct(T)`.
    ///
    /// SAFETY: caller is responsible for `T` being `#[repr(C)]` POD with no
    /// padding-sensitive invariants — same contract as Zig's `readStruct`.
    pub fn read_struct<T: Copy>(&mut self) -> Result<T> {
        let buf = self.buffer.as_ref();
        let n = core::mem::size_of::<T>();
        let end = self
            .pos
            .checked_add(n)
            .ok_or_else(|| bun_core::err!("EndOfStream"))?;
        if end > buf.len() {
            return Err(bun_core::err!("EndOfStream"));
        }
        // SAFETY: `buf[pos..end]` is exactly `size_of::<T>()` initialized
        // bytes from the safe slice borrow; caller contract guarantees `T` is
        // `#[repr(C)]` POD where every byte pattern is valid (same as Zig
        // `readStruct`). `read_unaligned` tolerates any source alignment.
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
            .ok_or_else(|| bun_core::err!("NoSpaceLeft"))?;
        if end > buf.len() {
            return Err(bun_core::err!("NoSpaceLeft"));
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
// BufWriter — borrowed-buffer buffered writer
// ════════════════════════════════════════════════════════════════════════════

/// Buffered writer over a caller-provided scratch slice.
///
/// Port of Zig `std.fs.File.writerStreaming(&buf)` / `std.io.BufferedWriter`:
/// the caller owns the byte buffer (typically a stack `[0u8; 4096]`), so this
/// type performs **no heap allocation**. Writes accumulate into `buf` and are
/// flushed to `inner` when full or on explicit [`flush`](Write::flush).
///
/// `Drop` does **not** flush — matching Zig semantics, where forgetting to
/// `flush()` is a bug the caller owns (and flushing in `Drop` would swallow the
/// error). Callers must `writer.flush()?` before the buffer goes out of scope.
pub struct BufWriter<'a, W: Write> {
    buf: &'a mut [u8],
    pos: usize,
    inner: W,
}

impl<'a, W: Write> BufWriter<'a, W> {
    /// Wrap `inner` with `buf` as the staging buffer.
    #[inline]
    pub fn with_buffer(buf: &'a mut [u8], inner: W) -> Self {
        Self { buf, pos: 0, inner }
    }

    /// Bytes currently buffered (not yet flushed).
    #[inline]
    pub fn buffered(&self) -> &[u8] {
        &self.buf[..self.pos]
    }

    /// Recover the inner writer. Buffered bytes are **discarded**; call
    /// `flush()` first if they matter.
    #[inline]
    pub fn into_inner(self) -> W {
        self.inner
    }

    /// Borrow the inner writer.
    #[inline]
    pub fn inner(&mut self) -> &mut W {
        &mut self.inner
    }

    #[inline]
    fn flush_buf(&mut self) -> Result<()> {
        if self.pos > 0 {
            self.inner.write_all(&self.buf[..self.pos])?;
            self.pos = 0;
        }
        Ok(())
    }
}

impl<'a, W: Write> Write for BufWriter<'a, W> {
    fn write_all(&mut self, mut src: &[u8]) -> Result<()> {
        // Degenerate zero-capacity buffer: pass straight through.
        if self.buf.is_empty() {
            return self.inner.write_all(src);
        }
        // Large write that won't fit even after a flush: drain then bypass.
        if src.len() >= self.buf.len() {
            self.flush_buf()?;
            return self.inner.write_all(src);
        }
        // Fill remaining capacity; flush on overflow; copy the tail.
        let avail = self.buf.len() - self.pos;
        if src.len() > avail {
            self.buf[self.pos..].copy_from_slice(&src[..avail]);
            self.pos = self.buf.len();
            self.flush_buf()?;
            src = &src[avail..];
        }
        self.buf[self.pos..self.pos + src.len()].copy_from_slice(src);
        self.pos += src.len();
        Ok(())
    }

    #[inline]
    fn flush(&mut self) -> Result<()> {
        self.flush_buf()?;
        self.inner.flush()
    }
}

// ════════════════════════════════════════════════════════════════════════════
// FmtAdapter — core::fmt::Write → bun_io::Write bridge
// ════════════════════════════════════════════════════════════════════════════

/// Wrap a `core::fmt::Write` sink (typically `&mut core::fmt::Formatter`) so it
/// can be passed where a byte-level [`Write`] is expected.
///
/// Bytes are routed through `write_str` after a UTF-8 check; non-UTF-8 input is
/// lossily decoded (same behaviour as Zig's `{s}` formatter on arbitrary
/// bytes — it never fails on encoding, only on the underlying writer).
pub struct FmtAdapter<'a, W: ?Sized = fmt::Formatter<'a>> {
    inner: &'a mut W,
}

impl<'a, W: fmt::Write + ?Sized> FmtAdapter<'a, W> {
    #[inline]
    pub fn new(inner: &'a mut W) -> Self {
        Self { inner }
    }

    /// Borrow the wrapped `fmt::Write` sink.
    #[inline]
    pub fn inner(&mut self) -> &mut W {
        self.inner
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
            // PERF(port): lossy alloc only on invalid UTF-8; Zig had no
            // text/bytes split so this branch is the price of bridging.
            None => self.inner.write_str(&String::from_utf8_lossy(buf)),
        };
        r.map_err(|_| bun_core::err!("FmtError"))
    }

    #[inline]
    fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<()> {
        // Skip the byte round-trip entirely when we already have a fmt sink.
        self.inner
            .write_fmt(args)
            .map_err(|_| bun_core::err!("FmtError"))
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
/// `write_str` routes through `write_all(s.as_bytes())`; the underlying I/O
/// error is stashed in [`err`](AsFmt::err) so callers that care can recover it
/// instead of seeing only the unit `fmt::Error`. Callers that don't care just
/// drop the wrapper.
///
/// Erased to `dyn Write` (not generic over `W`) so this type does not pair
/// with [`FmtAdapter`]'s `impl Write` to form an infinite
/// `FmtAdapter<AsFmt<…>>` tower (E0275) — see the note on that impl.
pub struct AsFmt<'a> {
    sink: &'a mut dyn Write,
    /// Last I/O error from the underlying sink, if `write_str` failed.
    pub err: Option<bun_core::Error>,
}

impl<'a> AsFmt<'a> {
    /// Wrap any `bun_io::Write` sink. Takes `&mut dyn Write` directly so the
    /// unsize coercion happens at the call site (where the concrete `W` is
    /// known) rather than inside a `?Sized` generic — that lets both `&mut Vec`
    /// (auto-coerced) and an existing `&mut dyn Write` pass with one signature.
    #[inline]
    pub fn new(sink: &'a mut dyn Write) -> Self {
        Self { sink, err: None }
    }
}

impl fmt::Write for AsFmt<'_> {
    #[inline]
    fn write_str(&mut self, s: &str) -> fmt::Result {
        match self.sink.write_all(s.as_bytes()) {
            Ok(()) => Ok(()),
            Err(e) => {
                self.err = Some(e);
                Err(fmt::Error)
            }
        }
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
    fn buf_writer_basic() {
        let mut sink = Vec::new();
        let mut scratch = [0u8; 4];
        {
            let mut w = BufWriter::with_buffer(&mut scratch, &mut sink);
            w.write_all(b"ab").unwrap();
            w.write_all(b"cd").unwrap(); // exactly fills
            w.write_all(b"e").unwrap(); // forces flush of "abcd"
            w.flush().unwrap();
        }
        assert_eq!(sink, b"abcde");
    }

    #[test]
    fn buf_writer_large_bypass() {
        let mut sink = Vec::new();
        let mut scratch = [0u8; 4];
        let mut w = BufWriter::with_buffer(&mut scratch, &mut sink);
        w.write_all(b"x").unwrap();
        w.write_all(b"0123456789").unwrap(); // > capacity → flush + bypass
        w.flush().unwrap();
        assert_eq!(sink, b"x0123456789");
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
