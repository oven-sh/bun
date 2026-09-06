#pragma once

namespace Bun {

// Zero the stack below the caller's frame after a synchronous collection that
// ran on this thread. Call it right after the collectNow / collectSync call,
// from the same function.
//
// The collector's frames held the address of every cell the marker visited.
// Those frames are gone when the collection returns, but the memory keeps the
// addresses until something overwrites them. A later callee whose frame has a
// slot it never writes (alignment padding, a local of a branch it does not
// take) then exposes one of them to the next conservative stack scan, and a
// dead object survives an explicit gc(). JSC's own sanitizeStackForVM does not
// cover this: it zeroes only between the last sanitize point, which the
// collector sets above its marking frames, and the current stack pointer.
//
// A synchronous full collection reaches about 20 KiB below its caller. 32 KiB
// covers that and stays inside JSC's 64 KiB reservedZoneSize, so this is safe
// from a gc() call near the JS stack limit.
void zeroCollectorStack();

} // namespace Bun
