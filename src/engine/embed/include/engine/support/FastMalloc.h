#pragma once

#include "engine/support/StdLibExtras.h"

#include <algorithm>
#include <cstdlib>
#if USE(MIMALLOC)
#include <mimalloc.h>
#endif

extern "C" NO_RETURN_DUE_TO_CRASH void Support__outOfMemory();
extern "C" size_t engine_max_allocation_size;

namespace WTF {

// The allocator of `bun_alloc::default_alloc`: either language frees what the other has allocated.
struct FastMalloc {
#if ASSERT_ENABLED
    // For tests of what happens when memory runs out.
    static constexpr size_t& maxSingleAllocationSize { engine_max_allocation_size };
#else
    static constexpr size_t maxSingleAllocationSize { SIZE_MAX };
#endif

#if USE(MIMALLOC)
    static ALWAYS_INLINE void* tryMalloc(size_t size)
    {
        if (size > maxSingleAllocationSize)
            return nullptr;
        return __builtin_constant_p(size) ? mi_malloc_csize(size) : mi_malloc(size);
    }
    static void* tryZeroedMalloc(size_t size) { return size > maxSingleAllocationSize ? nullptr : mi_zalloc(size); }
    static void* tryAlignedMalloc(size_t alignment, size_t size) { return size > maxSingleAllocationSize ? nullptr : mi_malloc_aligned(size, alignment); }
    static void* tryRealloc(void* pointer, size_t size) { return size > maxSingleAllocationSize ? nullptr : mi_realloc(pointer, size); }
    static ALWAYS_INLINE void free(void* pointer) { mi_free(pointer); }
#else
    static void* tryMalloc(size_t size) { return size > maxSingleAllocationSize ? nullptr : std::malloc(size); }
    static void* tryZeroedMalloc(size_t size) { return size > maxSingleAllocationSize ? nullptr : std::calloc(1, size); }
    static void* tryAlignedMalloc(size_t alignment, size_t size) { return size > maxSingleAllocationSize ? nullptr : std::aligned_alloc(alignment, (size + alignment - 1) & -alignment); }
    // The C library frees for a size of zero.
    static void* tryRealloc(void* pointer, size_t size) { return size > maxSingleAllocationSize ? nullptr : std::realloc(pointer, std::max<size_t>(size, 1)); }
    static void free(void* pointer) { std::free(pointer); }
#endif

    static ALWAYS_INLINE void* malloc(size_t size) { return crashIfNull(tryMalloc(size)); }
    static void* zeroedMalloc(size_t size) { return crashIfNull(tryZeroedMalloc(size)); }
    static void* alignedMalloc(size_t alignment, size_t size) { return crashIfNull(tryAlignedMalloc(alignment, size)); }
    static void* realloc(void* pointer, size_t size) { return crashIfNull(tryRealloc(pointer, size)); }

    static constexpr size_t nextCapacity(size_t capacity) { return std::max(capacity + capacity / 2, capacity + 1); }

private:
    static ALWAYS_INLINE void* crashIfNull(void* pointer) RETURNS_NONNULL
    {
        if (!pointer) [[unlikely]]
            Support__outOfMemory();
        return pointer;
    }
};

ALWAYS_INLINE void* fastMalloc(size_t size) { return FastMalloc::malloc(size); }
inline void* fastZeroedMalloc(size_t size) { return FastMalloc::zeroedMalloc(size); }
ALWAYS_INLINE void fastFree(void* pointer) { FastMalloc::free(pointer); }

}

using WTF::fastFree;
using WTF::FastMalloc;
using WTF::fastMalloc;
using WTF::fastZeroedMalloc;

#define WTF_REQUIRE_SEMICOLON static_assert(true)

#define WTF_PLACEMENT_NEW_OPERATORS                                   \
    void* operator new(size_t, void* location) { return location; }   \
    void* operator new[](size_t, void* location) { return location; } \
    void* operator new(size_t, NotNullTag, void* location)            \
    {                                                                 \
        ASSERT(location);                                             \
        return location;                                              \
    }

#define WTF_FAST_ALLOCATION_OPERATORS                                                                                                                \
    WTF_PLACEMENT_NEW_OPERATORS                                                                                                                      \
    void* operator new(size_t size) { return ::WTF::FastMalloc::malloc(size); }                                                                      \
    void* operator new[](size_t size) { return ::WTF::FastMalloc::malloc(size); }                                                                    \
    void* operator new(size_t size, std::align_val_t alignment) { return ::WTF::FastMalloc::alignedMalloc(static_cast<size_t>(alignment), size); }   \
    void* operator new[](size_t size, std::align_val_t alignment) { return ::WTF::FastMalloc::alignedMalloc(static_cast<size_t>(alignment), size); } \
    void operator delete(void* pointer) { ::WTF::FastMalloc::free(pointer); }                                                                        \
    void operator delete[](void* pointer) { ::WTF::FastMalloc::free(pointer); }                                                                      \
    void operator delete(void* pointer, std::align_val_t) { ::WTF::FastMalloc::free(pointer); }                                                      \
    void operator delete[](void* pointer, std::align_val_t) { ::WTF::FastMalloc::free(pointer); }                                                    \
    using WTFIsFastMallocAllocated = int;

#define WTF_MAKE_STRUCT_TZONE_ALLOCATED(Struct) \
    WTF_FAST_ALLOCATION_OPERATORS               \
    WTF_REQUIRE_SEMICOLON

#define WTF_MAKE_TZONE_ALLOCATED(Class) \
public:                                 \
    WTF_FAST_ALLOCATION_OPERATORS       \
private:                                \
    WTF_REQUIRE_SEMICOLON

#define WTF_MAKE_TZONE_ALLOCATED_IMPL(Class) WTF_REQUIRE_SEMICOLON

#define WTF_DEPRECATED_MAKE_FAST_ALLOCATED(Class) WTF_MAKE_TZONE_ALLOCATED(Class)
#define WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(Struct) WTF_MAKE_STRUCT_TZONE_ALLOCATED(Struct)
#define WTF_DEPRECATED_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(Class, heap) WTF_MAKE_TZONE_ALLOCATED(Class)

#define DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(Type) using Type##Malloc = ::WTF::FastMalloc
#define DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(Type) WTF_REQUIRE_SEMICOLON

#define WTF_ALLOW_STRUCT_COMPACT_POINTERS \
public:                                   \
    WTF_REQUIRE_SEMICOLON

#define WTF_FORBID_HEAP_ALLOCATION                          \
private:                                                    \
    void* operator new(size_t) = delete;                    \
    void* operator new[](size_t) = delete;                  \
    void* operator new(size_t, void*) = delete;             \
    void* operator new[](size_t, void*) = delete;           \
    void* operator new(size_t, NotNullTag, void*) = delete; \
    using HeapAllocationIsForbidden [[maybe_unused]] = void

#define WTF_FORBID_HEAP_ALLOCATION_ALLOWING_PLACEMENT_NEW \
public:                                                   \
    WTF_PLACEMENT_NEW_OPERATORS                           \
private:                                                  \
    void* operator new(size_t) = delete;                  \
    void* operator new[](size_t) = delete;                \
    WTF_REQUIRE_SEMICOLON
