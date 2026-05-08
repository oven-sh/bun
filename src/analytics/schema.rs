// GENERATED: re-run the analytics schema generator (peechy) with .rs output
// source: src/analytics/schema.zig
// TODO(port): regenerate remaining analytics::* types for Rust

use bun_core::Error;

// ──────────────────────────────────────────────────────────────────────────
// Reader / Writer
// ──────────────────────────────────────────────────────────────────────────
//
// Zig's peechy codec exposes a concrete `Reader` struct and a comptime-generic
// `Writer(WritableStream)` struct, but every generated `decode`/`encode` takes
// `reader: anytype` / `writer: anytype` — i.e. structural duck typing. Per
// PORTING.md §Comptime reflection, `anytype` → trait bound: the *protocol* is
// the trait, and the Zig `Reader` struct is one concrete impl (`BufReader`
// below).
//
// Only the primitive-int / byte-slice surface is ported. Zig's
// `readValue(comptime T)` / `writeValue(comptime T, ...)` switch on
// `@typeInfo(T)` to dispatch to enum/packed-struct/`.decode` paths; that
// reflection has no Rust equivalent, so per-type `decode`/`encode` impls call
// the primitive methods directly (which is what the generated schema bodies
// already do).

/// Zig: `Reader.ReadError = error{EOF}`.
// PORT NOTE: peechy's two error cases (`EOF`, `InvalidValue`) are folded into
// the crate-wide `bun_core::Error` so downstream `decode` signatures stay
// `Result<_, bun_core::Error>` without an extra `From` hop.
pub const EOF: Error = Error::TODO; // TODO(b2): Error::from_name("EOF") once name→code table lands

/// Primitive integers encodable in the peechy wire format (native-endian raw
/// bytes). Zig handled this via `comptime T` + `std.mem.readIntSliceNative` /
/// `std.mem.asBytes`; Rust needs an explicit trait bound.
pub trait SchemaInt: Copy + 'static {
    const SIZE: usize;
    fn from_ne_slice(b: &[u8]) -> Self;
    fn encode_ne(self, out: &mut [u8]);
}

macro_rules! impl_schema_int {
    ($($t:ty),* $(,)?) => {$(
        impl SchemaInt for $t {
            const SIZE: usize = core::mem::size_of::<$t>();
            #[inline]
            fn from_ne_slice(b: &[u8]) -> Self {
                let mut a = [0u8; core::mem::size_of::<$t>()];
                a.copy_from_slice(&b[..core::mem::size_of::<$t>()]);
                <$t>::from_ne_bytes(a)
            }
            #[inline]
            fn encode_ne(self, out: &mut [u8]) {
                out[..core::mem::size_of::<$t>()].copy_from_slice(&self.to_ne_bytes());
            }
        }
    )*};
}
impl_schema_int!(u8, i8, u16, i16, u32, i32, u64, i64);

/// Duck-typed reader protocol for peechy `decode` impls.
///
/// Zig: `fn decode(reader: anytype) anyerror!T` — the `anytype` becomes a
/// `R: Reader` bound on the Rust side.
pub trait Reader {
    /// Zig: `fn read(this, count: usize) ![]u8` — borrow `count` bytes,
    /// advancing the cursor. Errors with `EOF` if fewer than `count` remain.
    fn read(&mut self, count: usize) -> Result<&[u8], Error>;

    /// Zig: `readByte`
    #[inline]
    fn read_byte(&mut self) -> Result<u8, Error> {
        Ok(self.read(1)?[0])
    }

    /// Zig: `readBool`
    #[inline]
    fn read_bool(&mut self) -> Result<bool, Error> {
        Ok(self.read_byte()? > 0)
    }

    /// Zig: `readInt(comptime T)` — `std.mem.readIntSliceNative`.
    #[inline]
    fn read_int<T: SchemaInt>(&mut self) -> Result<T, Error> {
        let b = self.read(T::SIZE)?;
        Ok(T::from_ne_slice(b))
    }

    /// Zig: `readValue(comptime T)` for the primitive-int arm. Struct/enum
    /// arms are expressed as per-type `decode(reader)` fns instead (no
    /// `@typeInfo` in Rust).
    #[inline]
    fn read_value<T: SchemaInt>(&mut self) -> Result<T, Error> {
        self.read_int::<T>()
    }

    /// Zig: `readByteArray` — `u32` length prefix + raw bytes.
    #[inline]
    fn read_byte_array(&mut self) -> Result<&[u8], Error> {
        let len = self.read_int::<u32>()? as usize;
        if len == 0 {
            return Ok(&[]);
        }
        self.read(len)
    }
}

/// Duck-typed writer protocol for peechy `encode` impls.
///
/// Zig: `fn Writer(comptime WritableStream: type) type` — the comptime stream
/// parameter becomes the trait implementor; `encode(writer: anytype)` becomes
/// a `W: Writer` bound.
pub trait Writer {
    /// Zig: `fn write(this, bytes) !void` — append all bytes or error.
    fn write(&mut self, bytes: &[u8]) -> Result<(), Error>;

    /// Zig: `writeByte`
    #[inline]
    fn write_byte(&mut self, byte: u8) -> Result<(), Error> {
        self.write(&[byte])
    }

    /// Zig: `writeInt(int: anytype)` — `std.mem.asBytes(&int)`.
    #[inline]
    fn write_int<T: SchemaInt>(&mut self, v: T) -> Result<(), Error> {
        // Max SchemaInt width is 8 bytes (u64/i64).
        let mut buf = [0u8; 8];
        v.encode_ne(&mut buf);
        self.write(&buf[..T::SIZE])
    }

    /// Zig: `writeFieldID(comptime id: comptime_int)`
    #[inline]
    fn write_field_id(&mut self, id: u8) -> Result<(), Error> {
        self.write_byte(id)
    }

    /// Zig: `writeEnum(val: anytype)` — `writeInt(@intFromEnum(val))`. Callers
    /// pass the discriminant explicitly (`e as u8` / `e as u32`).
    #[inline]
    fn write_enum<T: SchemaInt>(&mut self, discriminant: T) -> Result<(), Error> {
        self.write_int(discriminant)
    }

    /// Zig: `writeArray(u8, slice)` — `u32` length prefix + raw bytes.
    #[inline]
    fn write_byte_array(&mut self, slice: &[u8]) -> Result<(), Error> {
        self.write_int(slice.len() as u32)?;
        self.write(slice)
    }

    /// Zig: `endMessage`
    #[inline]
    fn end_message(&mut self) -> Result<(), Error> {
        self.write_byte(0)
    }
}

/// Concrete buffer-backed reader — direct port of Zig's `pub const Reader = struct`.
///
/// PORT NOTE: the Zig struct also carries `std.mem.Allocator param` for
/// `readArray`'s nested-slice case; per PORTING.md §Allocators (non-AST crate)
/// the allocator param is dropped — callers that need owned sub-arrays
/// allocate at the call site.
pub struct BufReader<'a> {
    pub buf: &'a [u8],
    pub remain: &'a [u8],
}

impl<'a> BufReader<'a> {
    #[inline]
    pub fn init(buf: &'a [u8]) -> Self {
        Self { buf, remain: buf }
    }
}

impl<'a> Reader for BufReader<'a> {
    fn read(&mut self, count: usize) -> Result<&[u8], Error> {
        let read_count = core::cmp::min(count, self.remain.len());
        if read_count < count {
            return Err(EOF);
        }
        let (slice, rest) = self.remain.split_at(read_count);
        self.remain = rest;
        Ok(slice)
    }
}

// Zig: `pub const ByteWriter = Writer(*std.io.FixedBufferStream([]u8))`
// The natural Rust equivalent is `impl Writer for Vec<u8>`; held back to avoid
// method-resolution ambiguity with `std::io::Write::write` at call sites.
// Downstream `encode` users supply their own `W: Writer` impl.

// ──────────────────────────────────────────────────────────────────────────

// Hand-ported subset of `analytics::*` needed by lib.rs (OperatingSystem,
// Architecture, Platform). The full encode/decode machinery and the rest of
// the schema (EventKind, EventListHeader, …) are unused at runtime today and
// will be filled in by the peechy regen.
#[allow(dead_code, non_camel_case_types)]
pub mod analytics {
    /// Zig: `pub const OperatingSystem = enum(u8) { _none, linux, macos, windows, wsl, android, freebsd, _ }`
    // PORT NOTE: Zig's open enum (`_`) is dropped — Rust enums are closed; the
    // schema decoder is the only producer of unknown discriminants and it is
    // not yet ported.
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum OperatingSystem {
        _none = 0,
        /// linux
        linux,
        /// macos
        macos,
        /// windows
        windows,
        /// wsl
        wsl,
        /// android
        android,
        /// freebsd
        freebsd,
    }

    /// Zig: `pub const Architecture = enum(u8) { _none, x64, arm, _ }`
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum Architecture {
        _none = 0,
        /// x64
        x64,
        /// arm
        arm,
    }

    /// Zig: `pub const Platform = struct { os, arch, version: []const u8 }`
    #[derive(Copy, Clone)]
    pub struct Platform {
        /// os
        pub os: OperatingSystem,
        /// arch
        pub arch: Architecture,
        /// version
        pub version: &'static [u8],
    }
}

// ported from: src/analytics/schema.zig
