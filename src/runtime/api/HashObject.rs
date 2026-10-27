use crate::generated_bindgen::hash_object::HashSeed;

/// Each hasher truncates it to its native seed width.
fn seed_of(seed: HashSeed<'_>) -> u64 {
    match seed {
        HashSeed::Number(seed) => seed.to_js().to_uint64_no_truncate(),
        HashSeed::BigInt(seed) => seed.to_js().to_uint64_no_truncate(),
        HashSeed::Other => 0,
    }
}

// Each must produce output **bit-identical** to previous Bun releases (pinned by the vector suite in
// test/js/bun/util/hash.test.js).

pub(crate) fn wyhash(data: &[u8], seed: HashSeed<'_>) -> u64 {
    bun_wyhash::Wyhash::hash(seed_of(seed), data)
}

pub(crate) fn adler32(data: &[u8]) -> u32 {
    bun_hash::Adler32::hash(data)
}

/// Hardware-accelerated, from zlib.
pub(crate) fn crc32(data: &[u8], seed: HashSeed<'_>) -> u32 {
    bun_zlib::crc32_bytes(seed_of(seed) as u32, data)
}

pub(crate) fn city_hash32(data: &[u8]) -> u32 {
    bun_hash::CityHash32::hash(data)
}

pub(crate) fn city_hash64(data: &[u8], seed: HashSeed<'_>) -> u64 {
    bun_hash::CityHash64::hash_with_seed(data, seed_of(seed))
}

pub(crate) fn xx_hash32(data: &[u8], seed: HashSeed<'_>) -> u32 {
    bun_hash::XxHash32::hash(seed_of(seed) as u32, data)
}

pub(crate) fn xx_hash64(data: &[u8], seed: HashSeed<'_>) -> u64 {
    bun_hash::XxHash64::hash(seed_of(seed), data)
}

/// Runtime-dispatched SIMD (Highway): src/jsc/bindings/xxhash3.cpp. The seed is truncated to 32 bits.
pub(crate) fn xx_hash3(data: &[u8], seed: HashSeed<'_>) -> u64 {
    bun_highway::xxhash3_64(u64::from(seed_of(seed) as u32), data)
}

pub(crate) fn murmur32v2(data: &[u8], seed: HashSeed<'_>) -> u32 {
    bun_hash::Murmur2_32::hash_with_seed(data, seed_of(seed) as u32)
}

pub(crate) fn murmur32v3(data: &[u8], seed: HashSeed<'_>) -> u32 {
    bun_hash::Murmur3_32::hash_with_seed(data, seed_of(seed) as u32)
}

pub(crate) fn murmur64v2(data: &[u8], seed: HashSeed<'_>) -> u64 {
    bun_hash::Murmur2_64::hash_with_seed(data, seed_of(seed))
}

pub(crate) fn rapidhash(data: &[u8], seed: HashSeed<'_>) -> u64 {
    bun_hash::RapidHash::hash(seed_of(seed), data)
}
