#include "root.h"

#if USE(SYSTEM_MALLOC)
#include <wtf/OSAllocator.h>
#include <wtf/FastMalloc.h>

extern "C" {
// Core allocation functions
void* bun_libpas_malloc(size_t size)
{
    return FastMalloc::malloc(size);
}

void* bun_libpas_try_malloc(size_t size)
{
    return FastMalloc::tryMalloc(size);
}

void* bun_libpas_calloc(size_t count, size_t size)
{
    return FastMalloc::tryZeroedMalloc(count * size);
}

void* bun_libpas_try_calloc(size_t count, size_t size)
{
    return FastMalloc::tryZeroedMalloc(count * size);
}

void* bun_libpas_realloc(void* ptr, size_t size)
{
    return FastMalloc::realloc(ptr, size);
}

void* bun_libpas_try_realloc(void* ptr, size_t size)
{
    return nullptr;
}

void bun_libpas_free(void* ptr)
{
    WTF::fastAlignedFree(ptr);
}

// Aligned allocation functions
void* bun_libpas_memalign(size_t alignment, size_t size)
{
    return WTF::fastCompactAlignedMalloc(alignment, size);
}

void* bun_libpas_try_memalign(size_t alignment, size_t size)
{
    return WTF::tryFastCompactAlignedMalloc(alignment, size);
}

// Memory size query
size_t bun_libpas_malloc_size(const void* ptr)
{
    return WTF::fastMallocSize(ptr);
}

size_t bun_libpas_malloc_good_size(size_t size)
{
    return WTF::fastMallocGoodSize(size);
}

// Memory management functions
void bun_libpas_scavenge()
{
    // No-op for system malloc
}

void bun_libpas_scavenge_this_thread()
{
    // No-op for system malloc
}

// Virtual memory functions
void* bun_libpas_try_allocate_zeroed_virtual_pages(size_t size)
{
    const size_t pageSize = WTF::pageSize();
    size_t alignedSize = (size + pageSize - 1) & ~(pageSize - 1);
    void* result = OSAllocator::tryReserveAndCommit(alignedSize);
    if (result) {
        memset(result, 0, alignedSize);
    }
    return result;
}

void bun_libpas_free_virtual_pages(void* ptr, size_t size)
{
    if (!ptr) return;
    OSAllocator::decommitAndRelease(ptr, size);
}
}

#else

#include <bmalloc/bmalloc.h>
#include <bmalloc/CompactAllocationMode.h>

extern "C" {
// Core allocation functions
void* bun_libpas_malloc(size_t size)
{
    return bmalloc::api::malloc(size, bmalloc::CompactAllocationMode::Compact);
}

void* bun_libpas_try_malloc(size_t size)
{
    return bmalloc::api::tryMalloc(size, bmalloc::CompactAllocationMode::Compact);
}

void* bun_libpas_calloc(size_t count, size_t size)
{
    return bmalloc::api::zeroedMalloc(count * size, bmalloc::CompactAllocationMode::Compact);
}

void* bun_libpas_try_calloc(size_t count, size_t size)
{
    return bmalloc::api::tryZeroedMalloc(count * size, bmalloc::CompactAllocationMode::Compact);
}

void* bun_libpas_realloc(void* ptr, size_t size)
{
    return bmalloc::api::realloc(ptr, size, bmalloc::CompactAllocationMode::Compact);
}

void* bun_libpas_try_realloc(void* ptr, size_t size)
{
    return bmalloc::api::tryRealloc(ptr, size, bmalloc::CompactAllocationMode::Compact);
}

void bun_libpas_free(void* ptr)
{
    bmalloc::api::free(ptr);
}

// Aligned allocation functions
void* bun_libpas_memalign(size_t alignment, size_t size)
{
    return bmalloc::api::memalign(alignment, size, bmalloc::CompactAllocationMode::Compact);
}

void* bun_libpas_try_memalign(size_t alignment, size_t size)
{
    return bmalloc::api::tryMemalign(alignment, size, bmalloc::CompactAllocationMode::Compact);
}

// Memory size query
size_t bun_libpas_malloc_size(const void* ptr)
{
#if BENABLE(MALLOC_SIZE)
    return bmalloc::api::mallocSize(ptr);
#else
    return 0;
#endif
}

size_t bun_libpas_malloc_good_size(size_t size)
{
#if BENABLE(MALLOC_GOOD_SIZE)
    return bmalloc::api::mallocGoodSize(size);
#else
    return size;
#endif
}

// Memory management functions
void bun_libpas_scavenge()
{
    bmalloc::api::scavenge();
}

void bun_libpas_scavenge_this_thread()
{
    bmalloc::api::scavengeThisThread();
}

// Virtual memory functions
// void* bun_libpas_try_allocate_zeroed_virtual_pages(size_t size)
// {

// }

void bun_libpas_free_virtual_pages(void* ptr, size_t size)
{
    if (!ptr) return;
    bmalloc::api::freeLargeVirtual(ptr, size);
}
}

#endif
