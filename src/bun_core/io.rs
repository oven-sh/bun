// ─── io::Writer (from bun_io) ─────────────────────────────────────────────
// TYPE_ONLY: output.rs holds `*mut io::Writer` opaquely (erased adapter head);
// real write/flush/print dispatch lives in bun_sys via the OutputSinkVTable.
/// Opaque writer interface header. bun_sys guarantees this is the first
/// `repr(C)` field of every concrete adapter, so `&mut Adapter as &mut Writer`
/// is sound (see output.rs `QuietWriterAdapter::new_interface`).
#[repr(C)]
pub struct Writer {
    pub write_all: unsafe fn(*mut Writer, &[u8]) -> Result<(), crate::Error>,
    pub flush: unsafe fn(*mut Writer) -> Result<(), crate::Error>,
}
impl Writer {
    #[inline]
    pub fn write_all(&mut self, bytes: &[u8]) -> Result<(), crate::Error> {
        // SAFETY: `Writer` is the `repr(C)` head of every concrete adapter
        // (see type doc); `self` was produced by upcasting `&mut Adapter`,
        // so the vtable fn receives the same pointer it was registered with.
        unsafe { (self.write_all)(std::ptr::from_mut(self), bytes) }
    }
    #[inline]
    pub fn flush(&mut self) -> Result<(), crate::Error> {
        // SAFETY: `Writer` is the `repr(C)` head of every concrete adapter;
        // `self` is the same pointer the adapter registered its vtable with,
        // so the callee's downcast back to the concrete type is sound.
        unsafe { (self.flush)(std::ptr::from_mut(self)) }
    }
    /// Alias for `print` so `write!(w, ...)` works.
    #[inline]
    pub fn write_fmt(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), crate::Error> {
        self.print(args)
    }
    #[inline]
    pub fn print(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), crate::Error> {
        use core::fmt::Write;
        struct A<'a>(&'a mut Writer, Result<(), crate::Error>);
        impl core::fmt::Write for A<'_> {
            fn write_str(&mut self, s: &str) -> core::fmt::Result {
                self.1 = self.0.write_all(s.as_bytes());
                if self.1.is_err() {
                    Err(core::fmt::Error)
                } else {
                    Ok(())
                }
            }
        }
        let mut a = A(self, Ok(()));
        let _ = a.write_fmt(args);
        a.1
    }
}
/// WASM-only StreamType (output.rs `#[cfg(wasm32)]`).
#[repr(C)]
pub struct FixedBufferStream {
    pub buf: *mut u8,
    pub len: usize,
    pub pos: usize,
}

// ════════════════════════════════════════════════════════════════════════
// trait Write — canonical byte-level write sink (port of Zig
// `std.Io.Writer`). Lives in `bun_core` (not `bun_io`) so leaf crates
// below `bun_io` in the dep graph — `bun_string`, `bun_collections`,
// `bun_url` — can implement it without an upward dep. `bun_io` re-exports
// this verbatim as `bun_io::Write`.
// ════════════════════════════════════════════════════════════════════════
use core::fmt;

/// Byte-level write sink — port of Zig `std.Io.Writer`.
///
/// Only [`write_all`](Write::write_all) is required; every other method has
/// a default in terms of it. Object-safe: `&mut dyn Write` works. Generic
/// helpers that would break object safety carry `where Self: Sized`.
pub trait Write {
    /// Write the entire buffer. Zig: `writeAll`.
    fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error>;

    /// Flush any internal buffer to the underlying sink. Zig: `flush`.
    /// Unbuffered sinks leave the default no-op.
    #[inline]
    fn flush(&mut self) -> Result<(), crate::Error> {
        Ok(())
    }

    /// Total bytes written to this sink so far.
    ///
    /// Only implemented for in-memory / counting sinks; the default panics,
    /// matching the Zig `@panic("css: got bad writer type")` fallthrough.
    #[inline]
    fn written_len(&self) -> usize {
        panic!("io::Write::written_len: writer does not track bytes written");
    }

    // ── provided helpers ────────────────────────────────────────────────

    /// Zig: `writeByte`.
    #[inline]
    fn write_byte(&mut self, byte: u8) -> Result<(), crate::Error> {
        self.write_all(core::slice::from_ref(&byte))
    }

    /// Convenience for UTF-8 string slices.
    #[inline]
    fn write_str(&mut self, s: &str) -> Result<(), crate::Error> {
        self.write_all(s.as_bytes())
    }

    /// Write `n` copies of `byte`. Zig: `splatByteAll` / `writeByteNTimes`.
    fn splat_byte_all(&mut self, byte: u8, n: usize) -> Result<(), crate::Error> {
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
    fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<(), crate::Error> {
        struct Bridge<'a, W: ?Sized> {
            sink: &'a mut W,
            err: Option<crate::Error>,
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
        let mut bridge = Bridge {
            sink: self,
            err: None,
        };
        match fmt::write(&mut bridge, args) {
            Ok(()) => Ok(()),
            Err(_) => Err(bridge.err.unwrap_or_else(|| crate::err!("FmtError"))),
        }
    }

    /// Alias for [`write_fmt`](Write::write_fmt) under the Zig spelling.
    #[inline]
    fn print(&mut self, args: fmt::Arguments<'_>) -> Result<(), crate::Error> {
        self.write_fmt(args)
    }

    /// Write an integer in little-endian byte order.
    /// Zig: `writeInt(T, val, .little)`.
    #[inline]
    fn write_int_le<I: IntLe>(&mut self, val: I) -> Result<(), crate::Error>
    where
        Self: Sized,
    {
        self.write_all(val.to_le_bytes().as_ref())
    }
}

// ── blanket / std impls ─────────────────────────────────────────────────

/// Forward through `&mut W` so `&mut dyn Write` / `&mut impl Write` nest.
impl<W: Write + ?Sized> Write for &mut W {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
        (**self).write_all(buf)
    }
    #[inline]
    fn flush(&mut self) -> Result<(), crate::Error> {
        (**self).flush()
    }
    #[inline]
    fn write_byte(&mut self, byte: u8) -> Result<(), crate::Error> {
        (**self).write_byte(byte)
    }
    #[inline]
    fn splat_byte_all(&mut self, byte: u8, n: usize) -> Result<(), crate::Error> {
        (**self).splat_byte_all(byte, n)
    }
    #[inline]
    fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<(), crate::Error> {
        (**self).write_fmt(args)
    }
    #[inline]
    fn written_len(&self) -> usize {
        (**self).written_len()
    }
}

impl<W: Write + ?Sized> Write for Box<W> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
        (**self).write_all(buf)
    }
    #[inline]
    fn flush(&mut self) -> Result<(), crate::Error> {
        (**self).flush()
    }
    #[inline]
    fn written_len(&self) -> usize {
        (**self).written_len()
    }
}

/// In-memory growable sink. Zig: `std.Io.Writer.Allocating`.
impl<A: core::alloc::Allocator> Write for Vec<u8, A> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
        self.extend_from_slice(buf);
        Ok(())
    }
    #[inline]
    fn written_len(&self) -> usize {
        self.len()
    }
}

impl<'a> Write for bun_alloc::BabyVec<'a, u8> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
        self.extend_from_slice(buf);
        Ok(())
    }
    #[inline]
    fn written_len(&self) -> usize {
        self.len()
    }
}

/// Bridge the type-erased vtable header into the generic `Write` trait so
/// printers taking `W: io::Write` accept process stdout/stderr sinks.
impl Write for Writer {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
        // SAFETY: `self` is the `repr(C)` adapter head; the vtable fn
        // receives the same pointer it was registered with (see type doc).
        unsafe { (self.write_all)(core::ptr::from_mut(self), buf) }
    }
    #[inline]
    fn flush(&mut self) -> Result<(), crate::Error> {
        // SAFETY: `self` is the `repr(C)` adapter head; the vtable fn
        // receives the same pointer it was registered with (see type doc).
        unsafe { (self.flush)(core::ptr::from_mut(self)) }
    }
}

// ── IntLe — little-endian integer encoding helper ───────────────────────

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
impl_int_le!(
    u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize
);
