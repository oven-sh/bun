#pragma once

namespace Bun {

// Zero 32 KiB of stack below the caller. Call it right after a synchronous
// collection, from the same function: the marker's dead frames below hold cell
// addresses that a later frame's unwritten slot would show to the conservative
// scan. A full collection reaches about 20 KiB; JSC reserves 64 KiB for us.
void zeroCollectorStack();

} // namespace Bun
