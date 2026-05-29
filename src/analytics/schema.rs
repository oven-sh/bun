// GENERATED: re-run the analytics schema generator (peechy) with .rs output
// source: src/analytics/schema.zig
// TODO(port): regenerate remaining analytics::* types for Rust

use bun_core::Error;

pub(crate) const EOF: Error = Error::TODO; // TODO(port): Error::from_name("EOF") once name→code table lands

/// Primitive integers encodable in the peechy wire format (native-endian raw
/// bytes). Zig handled this via `comptime T` + `std.mem.readIntSliceNative` /
/// `std.mem.asBytes`; Rust needs an explicit trait bound.
pub use bun_core::NativeEndianInt as SchemaInt;

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

// ──────────────────────────────────────────────────────────────────────────

pub mod analytics {
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum OperatingSystem {
        None = 0,
        /// linux
        Linux,
        /// macos
        Macos,
        /// windows
        Windows,
        /// wsl
        Wsl,
        /// android
        Android,
        /// freebsd
        Freebsd,
    }

    /// Zig: `pub const Architecture = enum(u8) { _none, x64, arm, _ }`
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum Architecture {
        None = 0,
        /// x64
        X64,
        /// arm
        Arm,
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
