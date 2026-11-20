#pragma once

namespace Bun {

// Zero 32 KiB of stack below the caller, right after a synchronous collection,
// so the marker's dead frames cannot feed the next conservative stack scan.
void zeroCollectorStack();

} // namespace Bun
