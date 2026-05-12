//! Canonical byte-oriented `Write` trait — single port of Zig `std.Io.Writer`.
//!
//! HOSTED IN `bun_string` so the trait sits *below* every consumer in the dep
//! DAG: `bun_io → bun_string` already exists, and `bun_string` already depends
//! on `bun_core` (error type), `bun_alloc` (`ArenaVec`), and `bun_collections`
//! (`BoundedArray`). The trait body itself was pushed one level lower into
//! `crate::io` (that crate has zero upward deps) so even `bun_collections`
//! can implement it; this module re-exports it verbatim and adds the
//! big-endian integer helper. `bun_io` re-exports this module
//! (`pub use bun_core::write::*;`) and layers its sink types
//! (`FixedBufferStream`, `BufWriter`, `FmtAdapter`, `DiscardingWriter`) on top,
//! so the existing `bun_io::Write` importers are unaffected.

/// `Result<T>` over `crate::Error` so `?` composes everywhere.
pub type Result<T = ()> = core::result::Result<T, crate::Error>;

pub use crate::io::{IntLe, Write};

// ════════════════════════════════════════════════════════════════════════════
// IntBe — big-endian (network-order) integer encoding helper
// ════════════════════════════════════════════════════════════════════════════

/// Integers that can be written/read in big-endian (network) byte order.
/// Mirrors [`IntLe`]; used by `bun_io::FixedBufferStream::read_int_be` and the
/// HTTP/2 wire-format writers.
pub trait IntBe: Copy {
    type Bytes: AsRef<[u8]> + AsMut<[u8]> + Default;
    fn to_be_bytes(self) -> Self::Bytes;
    fn from_be_bytes(bytes: Self::Bytes) -> Self;
}

macro_rules! impl_int_be {
    ($($t:ty),* $(,)?) => {$(
        impl IntBe for $t {
            type Bytes = [u8; core::mem::size_of::<$t>()];
            #[inline]
            fn to_be_bytes(self) -> Self::Bytes { <$t>::to_be_bytes(self) }
            #[inline]
            fn from_be_bytes(bytes: Self::Bytes) -> Self { <$t>::from_be_bytes(bytes) }
        }
    )*};
}
impl_int_be!(
    u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize
);
