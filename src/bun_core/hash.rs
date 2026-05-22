// ── Hasher trait (Zig "anytype with .update([]const u8)") ─────────────────
// Used by `bun_core::write_any_to_hasher` and bundler/css hashing. Mirrors
// the minimal Zig hasher protocol — *not* `core::hash::Hasher` because Bun's
// hashers (Wyhash, XxHash64, sha1) expose `.update(&[u8])` + `.final()`.
pub trait Hasher {
    fn update(&mut self, bytes: &[u8]);
}
// Blanket: anything that already is a `core::hash::Hasher` also satisfies
// Bun's Hasher (its `.write` IS the byte-feed).
impl<H: core::hash::Hasher> Hasher for H {
    #[inline]
    fn update(&mut self, bytes: &[u8]) {
        self.write(bytes)
    }
}

/// Re-export so downstream crates can write `T: bun_core::NoUninit` without a
/// direct `bytemuck` dep.
/// Port of `bun.writeAnyToHasher`. Zig fed `std.mem.asBytes(&thing)`; Rust
/// can't take a generic by-value-as-bytes safely without `bytemuck`, so this
/// accepts anything that is itself viewable as bytes (covers the actual call
/// sites: `u8` tags, `usize` lengths, `Index` newtypes).
#[inline]
pub fn write_any_to_hasher<H: Hasher + ?Sized, T: AsBytes>(hasher: &mut H, thing: T) {
    hasher.update(thing.as_bytes_for_hash());
}

/// Helper trait for `write_any_to_hasher` — "viewable as raw bytes".
/// Blanket-implemented for all `Copy` plain-data ints and references-to-slices.
pub trait AsBytes {
    fn as_bytes_for_hash(&self) -> &[u8];
}
macro_rules! as_bytes_pod {
    ($($t:ty),* $(,)?) => { $(
        impl AsBytes for $t {
            #[inline] fn as_bytes_for_hash(&self) -> &[u8] {
                bytemuck::bytes_of(self)
            }
        }
    )* }
}
as_bytes_pod!(
    u8, i8, u16, i16, u32, i32, u64, i64, usize, isize, u128, i128
);
impl<T: AsBytes> AsBytes for &T {
    #[inline]
    fn as_bytes_for_hash(&self) -> &[u8] {
        (**self).as_bytes_for_hash()
    }
}

// `bun.hash` (Wyhash) lives in deprecated.rs as RapidHash; this module adds
// the xxhash64 entry point that ETag/bundler need.
pub use bun_hash::XxHash64;
/// `std.hash.XxHash64.hash(seed, bytes)`.
#[inline]
pub fn xxhash64(seed: u64, bytes: &[u8]) -> u64 {
    bun_hash::XxHash64::hash(seed, bytes)
}
/// Wyhash one-shot (Zig `bun.hash`).
#[inline]
pub fn wyhash(bytes: &[u8]) -> u64 {
    crate::deprecated::RapidHash::hash(0, bytes)
}
