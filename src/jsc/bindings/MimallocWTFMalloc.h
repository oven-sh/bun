#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdlib>
#include <wtf/Assertions.h>
#include <wtf/Compiler.h>
#include <wtf/PlatformOS.h>
#include "mimalloc.h"
#include "mimalloc/types.h"

namespace Bun {

/// Free a pointer that came from Rust's **default allocator** (a `Vec`/`Box`/
/// `String` owned by the `#[global_allocator]`). Must mirror
/// `bun_alloc::default_alloc::free`:
///   - normally the global allocator is mimalloc → `mi_free`
///   - under ASAN the global allocator is `std::alloc::System` (libc malloc)
///     so the ASAN interceptor sees every Rust allocation → `::free`
///
/// Use this wherever a C++ deallocator/finalizer is registered against a raw
/// pointer handed over by Rust. Going through `mi_free` directly there is
/// wrong under ASAN because the buffer was allocated by `System`, not mimalloc.
ALWAYS_INLINE void defaultAllocatorFree(void* p)
{
#if ASAN_ENABLED
    ::free(p);
#else
    mi_free(p);
#endif
}
// For use with WTF types like WTF::Vector.
struct MimallocMalloc {
#if USE(BUN_MIMALLOC)
    static constexpr std::size_t maxAlign = MI_MAX_ALIGN_SIZE;
#else
    static constexpr std::size_t maxAlign = alignof(std::max_align_t);
#endif

    static void* malloc(std::size_t size)
    {
        void* result = tryMalloc(size);
        if (!result) CRASH();
        return result;
    }

    static void* tryMalloc(std::size_t size)
    {
#if USE(BUN_MIMALLOC)
        return mi_malloc(size);
#else
        return std::malloc(size);
#endif
    }

    static void* zeroedMalloc(std::size_t size)
    {
        void* result = tryZeroedMalloc(size);
        if (!result) CRASH();
        return result;
    }

    static void* tryZeroedMalloc(std::size_t size)
    {
#if USE(BUN_MIMALLOC)
        return mi_zalloc(size);
#else
        return std::calloc(size, 1);
#endif
    }

    static void* alignedMalloc(std::size_t size, std::size_t alignment)
    {
        void* result = tryAlignedMalloc(size, alignment);
        if (!result) CRASH();
        return result;
    }

    static void* tryAlignedMalloc(std::size_t size, std::size_t alignment)
    {
        ASSERT(alignment > 0);
        ASSERT((alignment & (alignment - 1)) == 0); // ensure power of two
        ASSERT(((alignment - 1) & size) == 0); // ensure size multiple of alignment
#if USE(BUN_MIMALLOC)
        return mi_malloc_aligned(size, alignment);
#elif !OS(WINDOWS)
        return std::aligned_alloc(alignment, size);
#else
        LOG_ERROR("cannot allocate memory with alignment %zu", alignment);
        return nullptr;
#endif
    }

    static void* realloc(void* p, std::size_t size)
    {
        void* result = tryRealloc(p, size);
        if (!result) CRASH();
        return result;
    }

    static void* tryRealloc(void* p, std::size_t size)
    {
#if USE(BUN_MIMALLOC)
        return mi_realloc(p, size);
#else
        return std::realloc(p, size);
#endif
    }

    static void free(void* p)
    {
#if USE(BUN_MIMALLOC)
        mi_free(p);
#else
        std::free(p);
#endif
    }

    static constexpr ALWAYS_INLINE std::size_t nextCapacity(std::size_t capacity)
    {
        return std::max(capacity + capacity / 2, capacity + 1);
    }
};
}
