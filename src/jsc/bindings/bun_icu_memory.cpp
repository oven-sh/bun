// ICU's copy constructors and clone() have no UErrorCode to report a failed
// allocation through, so a null from malloc inside udat_format/udat_clone/
// ucal_clone/ubrk_clone segfaults inside ICU or yields a formatter that prints
// the wrong thing. These wrappers turn it into Bun's out-of-memory report.
//
// They call the same malloc/realloc/free ICU defaults to (cmemory.cpp), so the
// install point does not matter, and ICU serves zero-byte requests itself, so
// a null here is always a failure.

#include "root.h"
#include "bun_icu_memory.h"
#include "headers-handwritten.h"

#if !OS(DARWIN)

#include <unicode/uclean.h>

#include <atomic>
#include <cstdlib>

extern "C" void CrashHandler__suppressCoreDumps();

namespace Bun {

// Negative while disarmed.
static std::atomic<int64_t> s_allocationsUntilInjectedFailure { -1 };

static bool shouldInjectFailure()
{
    if (s_allocationsUntilInjectedFailure.load(std::memory_order_relaxed) < 0) [[likely]]
        return false;
    return s_allocationsUntilInjectedFailure.fetch_sub(1, std::memory_order_relaxed) == 0;
}

static void* checkedICUAllocation(void* ptr)
{
    if (!ptr) [[unlikely]]
        Bun__outOfMemory();
    return ptr;
}

static void* U_CALLCONV icuMalloc(const void*, size_t size)
{
    return checkedICUAllocation(shouldInjectFailure() ? nullptr : ::malloc(size));
}

static void* U_CALLCONV icuRealloc(const void*, void* ptr, size_t size)
{
    return checkedICUAllocation(shouldInjectFailure() ? nullptr : ::realloc(ptr, size));
}

static void U_CALLCONV icuFree(const void*, void* ptr)
{
    ::free(ptr);
}

void installICUMemoryFunctions()
{
    UErrorCode status = U_ZERO_ERROR;
    u_setMemoryFunctions(nullptr, icuMalloc, icuRealloc, icuFree, &status);
    RELEASE_ASSERT(U_SUCCESS(status));
}

void failICUAllocationForTesting(size_t skip)
{
    // Intended crash: keep the coredump-collecting CI lanes from flagging it.
    CrashHandler__suppressCoreDumps();
    s_allocationsUntilInjectedFailure.store(static_cast<int64_t>(skip), std::memory_order_relaxed);
}

} // namespace Bun

#else

// macOS uses the system libicucore, shared with every framework in the process.
namespace Bun {

void installICUMemoryFunctions()
{
}

void failICUAllocationForTesting(size_t)
{
}

} // namespace Bun

#endif
