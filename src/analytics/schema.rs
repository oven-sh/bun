// GENERATED: re-run the analytics schema generator (peechy) with .rs output
// Hand-ported subset — the remaining analytics::* types are unused at runtime
// and come back with the next peechy regen (see the `analytics` mod below).

use crate::Error;

// ──────────────────────────────────────────────────────────────────────────
// Reader / Writer
// ──────────────────────────────────────────────────────────────────────────
//
// The peechy codec protocol is the `Reader` trait below; `BufReader` is one
// concrete impl. Only the primitive-int / byte-slice surface is implemented;
// per-type `decode`/`encode` impls call the primitive methods directly
// (which is what the generated schema bodies already do).

#[inline]
fn eof() -> Error {
    crate::Error::EOF
}

/// Primitive integers encodable in the peechy wire format (native-endian raw
/// bytes).
pub use bun_core::NativeEndianInt as SchemaInt;

/// Duck-typed reader protocol for peechy `decode` impls.
pub trait Reader {
    /// Borrow `count` bytes, advancing the cursor. Errors with `EOF` if
    /// fewer than `count` remain.
    fn read(&mut self, count: usize) -> Result<&[u8], Error>;

    #[inline]
    fn read_byte(&mut self) -> Result<u8, Error> {
        Ok(self.read(1)?[0])
    }

    #[inline]
    fn read_bool(&mut self) -> Result<bool, Error> {
        Ok(self.read_byte()? > 0)
    }

    #[inline]
    fn read_int<T: SchemaInt>(&mut self) -> Result<T, Error> {
        let b = self.read(T::SIZE)?;
        Ok(T::from_ne_slice(b))
    }

    /// Primitive-int read; struct/enum cases are expressed as per-type
    /// `decode(reader)` fns instead.
    #[inline]
    fn read_value<T: SchemaInt>(&mut self) -> Result<T, Error> {
        self.read_int::<T>()
    }

    /// `u32` length prefix + raw bytes.
    #[inline]
    fn read_byte_array(&mut self) -> Result<&[u8], Error> {
        let len = self.read_int::<u32>()? as usize;
        if len == 0 {
            return Ok(&[]);
        }
        self.read(len)
    }
}

// peechy `Writer` lives in `bun_options_types::schema::Writer`. This crate
// keeps only the read side; encode users depend on options_types directly.

/// Concrete buffer-backed reader.
///
/// Callers that need owned sub-arrays allocate at the call site.
pub struct BufReader<'a> {
    pub buf: &'a [u8],
    pub(crate) remain: &'a [u8],
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
            return Err(eof());
        }
        let (slice, rest) = self.remain.split_at(read_count);
        self.remain = rest;
        Ok(slice)
    }
}

// ──────────────────────────────────────────────────────────────────────────

// Hand-ported subset of `analytics::*` needed by lib.rs (OperatingSystem,
// Architecture, Platform). The full encode/decode machinery and the rest of
// the schema (EventKind, EventListHeader, …) are unused at runtime today and
// will be filled in by the peechy regen.
pub mod analytics {
    // Closed enum: the schema decoder is the only producer of unknown
    // discriminants and it is not yet implemented.
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

    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum Architecture {
        None = 0,
        /// x64
        X64,
        /// arm
        Arm,
    }

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
