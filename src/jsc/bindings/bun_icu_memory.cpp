// ICU reports a failed allocation through a UErrorCode when it can, but its
// copy constructors and assignment operators have nowhere to report one, so a
// null from malloc inside udat_clone / ucal_clone / ubrk_clone (which JSC's
// Intl.DateTimeFormat and Intl.Segmenter call per format/segment) either
// segfaults inside ICU or yields a formatter that silently produces wrong
// output. Routing ICU's heap through these wrappers turns every such failure
// into Bun's regular out-of-memory crash report instead.
//
// The wrappers call the same malloc/realloc/free ICU uses by default
// (cmemory.cpp), so anything ICU allocated before JSCInitialize installed them
// is still freed by the matching function. ICU serves zero-byte requests
// itself and only calls out for non-zero sizes, so a null here is a failure.

#include "root.h"
#include "bun_icu_memory.h"
#include "headers-handwritten.h"

#if !OS(DARWIN)

#include <unicode/uclean.h>

#include <atomic>
#include <cstdlib>

namespace Bun {

// Negative when disarmed; otherwise how many more allocations succeed before
// one is failed.
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
    s_allocationsUntilInjectedFailure.store(static_cast<int64_t>(skip), std::memory_order_relaxed);
}

} // namespace Bun

#else

// macOS links the SDK's libicucore, which every framework in the process
// shares, so its allocator is left alone.
namespace Bun {

void installICUMemoryFunctions()
{
}

void failICUAllocationForTesting(size_t)
{
}

} // namespace Bun

#endif
