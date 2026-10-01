// The one place that names the workspace crates this crate builds on.
pub use bun_collections::{ArrayHashMap, HashMap};
pub use bun_core::StackCheck;

#[inline]
pub fn hash_bytes(bytes: &[u8]) -> u64 {
    bun_wyhash::hash(bytes)
}

// A second 64-bit hash of the same bytes, from the older mixing function, for the 128-bit cache keys.
#[inline]
pub fn hash_bytes_second(bytes: &[u8]) -> u64 {
    bun_wyhash::Wyhash11::hash(0, bytes)
}

#[inline]
pub fn index_of(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    bun_core::strings::index_of(haystack, needle)
}
