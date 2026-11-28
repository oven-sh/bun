#pragma once

#include "root.h"

namespace Bun {

// Testing-only entry point for the runtime-dispatched SIMD xxHash3 kernel
// (src/hash/xxhash3.rs), exposed via `bun:internal-for-testing` so a
// test can exercise `bun_hash_xxhash3_64` directly rather than relying on the
// Bun.hash.xxHash3 wiring. Signature: (view: ArrayBufferView, seed?:
// number | bigint) -> bigint.
BUN_DECLARE_HOST_FUNCTION(Bun__xxhash3_64_forTesting);

} // namespace Bun
