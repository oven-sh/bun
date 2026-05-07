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
// trait Write
// ════════════════════════════════════════════════════════════════════════════

/// Byte-level write sink — port of Zig `std.Io.Writer`.
///
/// Only [`write_all`](Write::write_all) is required; every other method has a
/// default in terms of it. Object-safe: `&mut dyn Write` is used by the CSS
/// printer and friends. Generic helpers that would break object safety carry a
/// `where Self: Sized` bound and are simply unavailable on `dyn Write`.
pub trait Write {
    /// Write the entire buffer. Zig: `writeAll`.
    fn write_all(&mut self, buf: &[u8]) -> Result<()>;

    /// Flush any internal buffer to the underlying sink. Zig: `flush`.
    /// Unbuffered sinks leave the default no-op.
    #[inline]
    fn flush(&mut self) -> Result<()> {
        Ok(())
    }

    /// Total bytes written to this sink so far.
    ///
    /// Port of the Zig pattern of recovering `std.Io.Writer.Allocating` via
    /// `@fieldParentPtr` and calling `.written().len`. Only implemented for
    /// in-memory / counting sinks (`Vec<u8>`, `MutableString`,
    /// `DiscardingWriter`, `FixedBufferStream`); the default panics, matching
    /// the Zig `@panic("css: got bad writer type")` fallthrough for writers
    /// that do not track a byte count.
    #[inline]
    fn written_len(&self) -> usize {
        panic!("bun_io::Write::written_len: writer does not track bytes written");
    }

    // ── provided helpers ────────────────────────────────────────────────────

    /// Zig: `writeByte`.
    #[inline]
    fn write_byte(&mut self, byte: u8) -> Result<()> {
        self.write_all(core::slice::from_ref(&byte))
    }

    /// Convenience for UTF-8 string slices. Zig callers that had a `[]const u8`
    /// of known-text use this; raw bytes go through `write_all`.
    #[inline]
    fn write_str(&mut self, s: &str) -> Result<()> {
        self.write_all(s.as_bytes())
    }

    /// Write `n` copies of `byte`. Zig: `splatByteAll` / `writeByteNTimes`.
    fn splat_byte_all(&mut self, byte: u8, n: usize) -> Result<()> {
        // 256-byte scratch keeps the loop count low without touching the heap.
        let chunk = [byte; 256];
        let mut remain = n;
        while remain > 0 {
            let take = remain.min(chunk.len());
            self.write_all(&chunk[..take])?;
            remain -= take;
        }
        Ok(())
    }

    /// Formatted write. Zig: `print(fmt, args)`. Enables `write!(w, ...)`.
    ///
    /// Bridges `core::fmt` → byte sink by routing `write_str` through
    /// `write_all`. The underlying I/O error (if any) is preserved rather than
    /// flattened into `fmt::Error`.
    fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<()> {
        struct Bridge<'a, W: ?Sized> {
            sink: &'a mut W,
            err: Option<bun_core::Error>,
        }
        impl<W: Write + ?Sized> fmt::Write for Bridge<'_, W> {
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
        let mut bridge = Bridge { sink: self, err: None };
        match fmt::write(&mut bridge, args) {
            Ok(()) => Ok(()),
            Err(_) => Err(bridge
                .err
                .unwrap_or_else(|| bun_core::err!("FmtError"))),
        }
    }

    /// Alias for [`write_fmt`](Write::write_fmt) under the Zig spelling.
    #[inline]
    fn print(&mut self, args: fmt::Arguments<'_>) -> Result<()> {
        self.write_fmt(args)
    }

    /// Write an integer in little-endian byte order.
    /// Zig: `writeInt(T, val, .little)`.
    ///
    /// `where Self: Sized` keeps the trait object-safe; `dyn Write` callers
    /// must go through `write_all(&val.to_le_bytes())` directly.
    #[inline]
    fn write_int_le<I: IntLe>(&mut self, val: I) -> Result<()>
    where
        Self: Sized,
    {
        self.write_all(val.to_le_bytes().as_ref())
    }
}

// ── blanket / std impls ─────────────────────────────────────────────────────

/// Forward through `&mut W` so `&mut dyn Write` / `&mut impl Write` nest.
impl<W: Write + ?Sized> Write for &mut W {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<()> {
        (**self).write_all(buf)
    }
    #[inline]
    fn flush(&mut self) -> Result<()> {
        (**self).flush()
    }
    #[inline]
    fn write_byte(&mut self, byte: u8) -> Result<()> {
        (**self).write_byte(byte)
    }
    #[inline]
    fn splat_byte_all(&mut self, byte: u8, n: usize) -> Result<()> {
        (**self).splat_byte_all(byte, n)
    }
    #[inline]
    fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<()> {
        (**self).write_fmt(args)
    }
    #[inline]
    fn written_len(&self) -> usize {
        (**self).written_len()
    }
}

impl<W: Write + ?Sized> Write for Box<W> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<()> {
        (**self).write_all(buf)
    }
    #[inline]
    fn flush(&mut self) -> Result<()> {
        (**self).flush()
    }
    #[inline]
    fn written_len(&self) -> usize {
        (**self).written_len()
    }
}

/// In-memory growable sink. Zig: `std.Io.Writer.Allocating`.
impl Write for Vec<u8> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<()> {
        self.extend_from_slice(buf);
        Ok(())
    }
    #[inline]
    fn written_len(&self) -> usize {
        self.len()
    }
}

/// `bun_core::io::Writer` is the type-erased vtable header behind
/// `Output::writer()` / `Output::error_writer()`. Bridge it into `bun_io::Write`
/// so generic printers (`W: bun_io::Write`) accept the process stdout/stderr
/// sinks the same way Zig's `std.Io.Writer.Generic` did.
impl Write for bun_core::io::Writer {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<()> {
        bun_core::io::Writer::write_all(self, buf)
    }
    #[inline]
    fn flush(&mut self) -> Result<()> {
        bun_core::io::Writer::flush(self)
    }
}

/// Growable string sink. Zig: `MutableString.writer()`.
impl Write for bun_string::MutableString {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<()> {
        self.append(buf)?;
        Ok(())
    }
    #[inline]
    fn written_len(&self) -> usize {
        self.len()
    }
}

// ════════════════════════════════════════════════════════════════════════════
// IntLe — little-endian integer encoding helper
// ════════════════════════════════════════════════════════════════════════════

/// Integers that can be written little-endian via [`Write::write_int_le`].
pub trait IntLe: Copy {
    type Bytes: AsRef<[u8]> + AsMut<[u8]> + Default;
    fn to_le_bytes(self) -> Self::Bytes;
    fn from_le_bytes(bytes: Self::Bytes) -> Self;
}

macro_rules! impl_int_le {
    ($($t:ty),* $(,)?) => {$(
        impl IntLe for $t {
            type Bytes = [u8; core::mem::size_of::<$t>()];
            #[inline]
            fn to_le_bytes(self) -> Self::Bytes { <$t>::to_le_bytes(self) }
            #[inline]
            fn from_le_bytes(bytes: Self::Bytes) -> Self { <$t>::from_le_bytes(bytes) }
        }
    )*};
}
impl_int_le!(u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize);

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

    /// Read a POD struct. Zig: `reader().readStruct(T)`.
    ///
    /// SAFETY: caller is responsible for `T` being `#[repr(C)]` POD with no
    /// padding-sensitive invariants — same contract as Zig's `readStruct`.
    pub fn read_struct<T: Copy>(&mut self) -> Result<T> {
        let mut out = core::mem::MaybeUninit::<T>::uninit();
        // SAFETY: writing `size_of::<T>()` bytes into MaybeUninit<T> storage.
        let bytes = unsafe {
            core::slice::from_raw_parts_mut(
                out.as_mut_ptr() as *mut u8,
                core::mem::size_of::<T>(),
            )
        };
        self.read_exact(bytes)?;
        // SAFETY: fully initialized by read_exact above.
        Ok(unsafe { out.assume_init() })
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

impl<W: fmt::Write + ?Sized> Write for FmtAdapter<'_, W> {
    fn write_all(&mut self, buf: &[u8]) -> Result<()> {
        // Fast path: valid UTF-8 (overwhelmingly the case for our printers).
        let r = match core::str::from_utf8(buf) {
            Ok(s) => self.inner.write_str(s),
            // PERF(port): lossy alloc only on invalid UTF-8; Zig had no
            // text/bytes split so this branch is the price of bridging.
            Err(_) => self.inner.write_str(&String::from_utf8_lossy(buf)),
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
            write!(a, "{}", 42).unwrap();
        }
        assert_eq!(s, "hi 42");
    }
}
