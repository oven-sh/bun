/**
 * Working SystemHeap implementation for Windows using mimalloc.
 *
 * bmalloc's SystemHeap is unimplemented on Windows — all methods crash with
 * RELEASE_BASSERT_NOT_REACHED. This file provides a functional replacement
 * that uses mimalloc for allocations.
 *
 * Combined with setting the "Malloc" environment variable at process startup,
 * this causes bmalloc/libpas to redirect all allocations through SystemHeap
 * instead of using libpas directly, avoiding GC crashes on Windows.
 *
 * See: https://github.com/oven-sh/bun/issues/22349
 *      https://github.com/oven-sh/bun/issues/21569
 *
 * How it works:
 *   1. Bun sets Malloc=1 env var early in main() (see src/main.zig)
 *   2. bmalloc's Environment reads Malloc=1 and enables SystemHeap
 *   3. All bmalloc allocations route through SystemHeap
 *   4. This file provides SystemHeap using mimalloc instead of crashing
 *
 * Link-time override:
 *   This object file defines the same symbols as bmalloc.lib's
 *   SystemHeap.cpp.o. Since object files are processed before static
 *   libraries, the linker uses these definitions and skips bmalloc.lib's
 *   unimplemented stubs.
 */

#include <bmalloc/BPlatform.h>

#if BOS(WINDOWS)

// We are providing the implementation of bmalloc's SystemHeap, so we need
// BEXPORT to resolve to __declspec(dllexport) rather than dllimport.
#define BUILDING_bmalloc

#include <bmalloc/SystemHeap.h>
#include <bmalloc/Algorithm.h>
#include <bmalloc/BAssert.h>
#include <bmalloc/VMAllocate.h>
#include "mimalloc.h"

#if BENABLE(LIBPAS)
#include <bmalloc/pas_system_heap.h>
#endif

namespace bmalloc {

SystemHeap* systemHeapCache { nullptr };

BALLOW_DEPRECATED_DECLARATIONS_BEGIN
DEFINE_STATIC_PER_PROCESS_STORAGE(SystemHeap);
BALLOW_DEPRECATED_DECLARATIONS_END

SystemHeap::SystemHeap(const LockHolder&)
    : m_pageSize(vmPageSize())
{
}

void* SystemHeap::malloc(size_t size, FailureAction action)
{
    void* result = mi_malloc(size);
    RELEASE_BASSERT(action == FailureAction::ReturnNull || result);
    return result;
}

void* SystemHeap::memalign(size_t alignment, size_t size, FailureAction action)
{
    void* result = mi_malloc_aligned(size, alignment);
    RELEASE_BASSERT(action == FailureAction::ReturnNull || result);
    return result;
}

void* SystemHeap::realloc(void* object, size_t size, FailureAction action)
{
    void* result = mi_realloc(object, size);
    RELEASE_BASSERT(action == FailureAction::ReturnNull || result);
    return result;
}

void SystemHeap::free(void* object)
{
    mi_free(object);
}

void SystemHeap::scavenge()
{
    mi_collect(false);
}

void SystemHeap::dump()
{
}

void* SystemHeap::memalignLarge(size_t alignment, size_t size)
{
    alignment = roundUpToMultipleOf(m_pageSize, alignment);
    size = roundUpToMultipleOf(m_pageSize, size);
    void* result = tryVMAllocate(alignment, size);
    if (!result)
        return nullptr;
    {
        LockHolder locker(mutex());
        m_sizeMap[result] = size;
    }
    return result;
}

void SystemHeap::freeLarge(void* base)
{
    if (!base)
        return;

    size_t size;
    {
        LockHolder locker(mutex());
        size = m_sizeMap[base];
        size_t numErased = m_sizeMap.erase(base);
        RELEASE_BASSERT(numErased == 1);
    }

    vmDeallocate(base, size);
}

SystemHeap* SystemHeap::tryGetSlow()
{
    SystemHeap* result;
    if (Environment::get()->isSystemHeapEnabled()) {
        systemHeapCache = SystemHeap::get();
        result = systemHeapCache;
    } else {
        systemHeapCache = systemHeapDisabled();
        result = nullptr;
    }
    RELEASE_BASSERT(systemHeapCache);
    return result;
}

} // namespace bmalloc

#if BENABLE(LIBPAS)

#if BUSE(LIBPAS)

using namespace bmalloc;

bool pas_system_heap_is_enabled(pas_heap_config_kind kind)
{
    switch (kind) {
    case pas_heap_config_kind_bmalloc:
        return !!SystemHeap::tryGet();
    case pas_heap_config_kind_jit:
    case pas_heap_config_kind_pas_utility:
        return false;
    default:
        BCRASH();
        return false;
    }
}

bool pas_system_heap_should_supplant_bmalloc(pas_heap_config_kind kind)
{
    SystemHeap* heap;
    switch (kind) {
    case pas_heap_config_kind_bmalloc:
        heap = SystemHeap::tryGet();
        if (!heap)
            return false;
        return heap->shouldSupplantBmalloc();
    case pas_heap_config_kind_jit:
    case pas_heap_config_kind_pas_utility:
        return false;
    default:
        BCRASH();
        return false;
    }
}

void* pas_system_heap_malloc(size_t size)
{
    return SystemHeap::getExisting()->malloc(size, FailureAction::ReturnNull);
}

void* pas_system_heap_memalign(size_t alignment, size_t size)
{
    return SystemHeap::getExisting()->memalign(alignment, size, FailureAction::ReturnNull);
}

void* pas_system_heap_realloc(void* ptr, size_t size)
{
    return SystemHeap::getExisting()->realloc(ptr, size, FailureAction::ReturnNull);
}

void pas_system_heap_free(void* ptr)
{
    SystemHeap::getExisting()->free(ptr);
}

void* pas_system_heap_malloc_compact(size_t size)
{
    return SystemHeap::getExisting()->malloc(size, FailureAction::ReturnNull);
}

void* pas_system_heap_memalign_compact(size_t alignment, size_t size)
{
    return SystemHeap::getExisting()->memalign(alignment, size, FailureAction::ReturnNull);
}

void* pas_system_heap_realloc_compact(void* ptr, size_t size)
{
    return SystemHeap::getExisting()->realloc(ptr, size, FailureAction::ReturnNull);
}

#else // !BUSE(LIBPAS)

bool pas_system_heap_is_enabled(pas_heap_config_kind kind)
{
    BUNUSED_PARAM(kind);
    return false;
}

bool pas_system_heap_should_supplant_bmalloc(pas_heap_config_kind kind)
{
    BUNUSED_PARAM(kind);
    return false;
}

void* pas_system_heap_malloc(size_t size)
{
    BUNUSED_PARAM(size);
    RELEASE_BASSERT_NOT_REACHED();
    return nullptr;
}

void* pas_system_heap_memalign(size_t alignment, size_t size)
{
    BUNUSED_PARAM(size);
    BUNUSED_PARAM(alignment);
    RELEASE_BASSERT_NOT_REACHED();
    return nullptr;
}

void* pas_system_heap_realloc(void* ptr, size_t size)
{
    BUNUSED_PARAM(ptr);
    BUNUSED_PARAM(size);
    RELEASE_BASSERT_NOT_REACHED();
    return nullptr;
}

void* pas_system_heap_malloc_compact(size_t size)
{
    BUNUSED_PARAM(size);
    RELEASE_BASSERT_NOT_REACHED();
    return nullptr;
}

void* pas_system_heap_memalign_compact(size_t alignment, size_t size)
{
    BUNUSED_PARAM(size);
    BUNUSED_PARAM(alignment);
    RELEASE_BASSERT_NOT_REACHED();
    return nullptr;
}

void* pas_system_heap_realloc_compact(void* ptr, size_t size)
{
    BUNUSED_PARAM(ptr);
    BUNUSED_PARAM(size);
    RELEASE_BASSERT_NOT_REACHED();
    return nullptr;
}

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wmissing-noreturn"
void pas_system_heap_free(void* ptr)
{
    BUNUSED_PARAM(ptr);
    RELEASE_BASSERT_NOT_REACHED();
}
#pragma clang diagnostic pop

#endif // BUSE(LIBPAS)

#endif // BENABLE(LIBPAS)

#endif // BOS(WINDOWS)
