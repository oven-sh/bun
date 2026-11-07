#include "root.h"
#include "ZeroCollectorStack.h"

NEVER_INLINE void Bun::zeroCollectorStack()
{
    constexpr size_t bytes = 32 * 1024;
    char region[bytes];
    memset(region, 0, bytes);
    // The address escapes into the asm, so the stores above are not dead.
    __asm__ __volatile__("" : : "r"(region) : "memory");
}
