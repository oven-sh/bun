#pragma once

#include "root.h"

namespace Bun {

// Testing-only entry point for the runtime-dispatched byte-search kernels in
// src/simd_kernels, exposed via `bun:internal-for-testing` so a test can
// drive each kernel directly across lengths/alignments instead of only through
// whichever runtime path happens to call it. Signature:
//   (op: string, haystack: Uint8Array, arg: number | Uint8Array) -> number
BUN_DECLARE_HOST_FUNCTION(Bun__simdStringsForTesting);

} // namespace Bun
