// GENERATED: re-run the analytics schema generator (peechy) with .rs output
// TODO: regenerate remaining analytics::* types

use bun_core::Error;

// ──────────────────────────────────────────────────────────────────────────
// Reader / Writer
// ──────────────────────────────────────────────────────────────────────────
//
// The peechy codec is duck-typed: every generated `decode`/`encode` takes a
// reader/writer that just needs to provide a small primitive surface. The
// *protocol* is expressed as the `Reader` trait below; `BufReader` is one
// concrete impl.
//
// Only the primitive-int / byte-slice surface is implemented. Generic
// "read any value" dispatch (enum / packed-struct / nested `.decode`) is
// expressed as per-type `decode`/`encode` impls that call the primitive
// methods directly (which is what the generated schema bodies already do).

// peechy's two error cases (`EOF`, `InvalidValue`) are folded into the
// crate-wide `bun_core::Error` so downstream `decode` signatures stay
// `Result<_, bun_core::Error>` without an extra `From` hop.
pub const EOF: Error = Error::TODO; // TODO(b2): Error::from_name("EOF") once name→code table lands

/// Primitive integers encodable in the peechy wire format (native-endian raw
/// bytes).
pub use bun_core::NativeEndianInt as SchemaInt;

/// Duck-typed reader protocol for peechy `decode` impls.
pub trait Reader {
    /// Borrow `count` bytes, advancing the cursor. Errors with `EOF` if fewer
    /// than `count` remain.
    fn read(&mut self, count: usize) -> Result<&[u8], Error>;

    #[inline]
    fn read_byte(&mut self) -> Result<u8, Error> {
        Ok(self.read(1)?[0])
    }

    #[inline]
    fn read_bool(&mut self) -> Result<bool, Error> {
        Ok(self.read_byte()? > 0)
    }

    /// Read a native-endian integer.
    #[inline]
    fn read_int<T: SchemaInt>(&mut self) -> Result<T, Error> {
        let b = self.read(T::SIZE)?;
        Ok(T::from_ne_slice(b))
    }

    /// Primitive-int arm of value decoding. Struct/enum arms are expressed as
    /// per-type `decode(reader)` fns instead.
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

// peechy `Writer` lives in `bun_options_types::schema::Writer` (the canonical
// `Vec<u8>`-backed struct). This crate keeps only the read side; encode users
// depend on options_types directly.

/// Concrete buffer-backed reader.
///
/// NOTE: callers that need owned sub-arrays allocate at the call site (per
/// PORTING.md §Allocators for non-AST crates) — there is no allocator param.
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

// Hand-ported subset of `analytics::*` needed by lib.rs (OperatingSystem,
// Architecture, Platform). The full encode/decode machinery and the rest of
// the schema (EventKind, EventListHeader, …) are unused at runtime today and
// will be filled in by the peechy regen.
#[allow(dead_code, non_camel_case_types)]
pub mod analytics {
    // NOTE: this enum is closed; the schema decoder is the only producer of
    // unknown discriminants and it is not yet ported.
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

    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum Architecture {
        _none = 0,
        /// x64
        x64,
        /// arm
        arm,
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
