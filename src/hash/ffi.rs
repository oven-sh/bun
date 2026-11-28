//! What C++ calls, as declared in src/jsc/bindings/xxhash3.h.
#![allow(unsafe_code)]

#[unsafe(no_mangle)]
unsafe extern "C" fn bun_hash_xxhash3_64(input: *const u8, len: usize, seed: u64) -> u64 {
    if len == 0 {
        return crate::xxhash3_64(seed, &[]);
    }
    // SAFETY: the caller's, as xxhash3.h has it.
    crate::xxhash3_64(seed, unsafe { core::slice::from_raw_parts(input, len) })
}
