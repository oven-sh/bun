// Points ICU's heap (uprv_malloc and friends, which also back UMemory::operator new) at mimalloc.

#include "root.h"

// ASAN keeps ICU on the sanitizer's allocator; macOS ICU is the system libicucore, shared with frameworks.
#if USE(BUN_MIMALLOC) && !ASAN_ENABLED && !OS(DARWIN)

#include "mimalloc.h"
#include <unicode/uclean.h>

namespace Bun {
namespace ICUMalloc {

static void* U_CALLCONV icuAlloc(const void*, size_t size)
{
    return mi_malloc(size);
}

static void* U_CALLCONV icuRealloc(const void*, void* p, size_t size)
{
    // Anything ICU allocated before install() would still be on the CRT heap.
    ASSERT_WITH_MESSAGE(!p || mi_is_in_heap_region(p), "ICU realloc of a non-mimalloc pointer %p", p);
    return mi_realloc(p, size);
}

static void U_CALLCONV icuFree(const void*, void* p)
{
    ASSERT_WITH_MESSAGE(!p || mi_is_in_heap_region(p), "ICU free of a non-mimalloc pointer %p", p);
    mi_free(p);
}

} // namespace ICUMalloc
} // namespace Bun

// Called from main() before anything can use ICU; u_setMemoryFunctions only affects later allocations.
extern "C" void Bun__useMimallocForICU()
{
    UErrorCode status = U_ZERO_ERROR;
    u_setMemoryFunctions(nullptr, Bun::ICUMalloc::icuAlloc, Bun::ICUMalloc::icuRealloc, Bun::ICUMalloc::icuFree, &status);
    RELEASE_ASSERT(U_SUCCESS(status));
}

#else

extern "C" void Bun__useMimallocForICU()
{
}

#endif
