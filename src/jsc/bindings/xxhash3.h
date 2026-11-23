#pragma once

#include <cstddef>
#include <cstdint>

// Runtime-dispatched XXH3_64bits_withSeed (src/hash/ffi.rs). `input` may be null
// only when `len == 0`, and stays as it is. `seed` is the full 64-bit
// seed. Output is bit-identical to the xxHash reference.
extern "C" uint64_t bun_hash_xxhash3_64(const uint8_t* input, size_t len, uint64_t seed);
