#pragma once

#include "root.h"

namespace Bun {

// Testing-only entry point for the kernels in highway_jpeg.cpp, exposed via `bun:internal-for-testing` so that a test can
// give each of them rows of every length. Signature:
//   (op: string, n: number, ...rows: (Uint8Array | null)[]) -> boolean
BUN_DECLARE_HOST_FUNCTION(Bun__highwayJpegForTesting);

} // namespace Bun
