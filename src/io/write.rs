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
}

/// In-memory growable sink. Zig: `std.Io.Writer.Allocating`.
impl Write for Vec<u8> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<()> {
        self.extend_from_slice(buf);
        Ok(())
    }
}

// ════════════════════════════════════════════════════════════════════════════
// IntLe — little-endian integer encoding helper
// ════════════════════════════════════════════════════════════════════════════

/// Integers that can be written little-endian via [`Write::write_int_le`].
pub trait IntLe: Copy {
    type Bytes: AsRef<[u8]>;
    fn to_le_bytes(self) -> Self::Bytes;
}

macro_rules! impl_int_le {
    ($($t:ty),* $(,)?) => {$(
        impl IntLe for $t {
            type Bytes = [u8; core::mem::size_of::<$t>()];
            #[inline]
            fn to_le_bytes(self) -> Self::Bytes { <$t>::to_le_bytes(self) }
        }
    )*};
}
impl_int_le!(u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize);

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
