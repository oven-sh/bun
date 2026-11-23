// On macOS, sends every allocation made by code linked into the executable to mimalloc. System libraries and native
// addons keep the system allocator.
//
// C: malloc, calloc, realloc, free and their relatives are defined here and not exported. Every object in the link
// binds to these definitions; every other image binds to libSystem by name.
//
// C++: operator new and operator delete are defined here and not exported either, so every other image calls those of
// libc++abi.dylib. libc++.1.dylib has the out-of-line members of std::string, and one that grows a string would release
// the executable's buffer there. They are compiled into the executable below, and the check of the linked executable
// names each C++ function that it may still import (cxxImports in scripts/build/binary-expectations.ts).
//
// free, realloc and operator delete look the pointer up and give a block that is not mimalloc's back to the zone that
// owns it. Such blocks also reach the executable from realpath(path, nullptr), getcwd(nullptr, 0), __cxa_demangle,
// backtrace_symbols, getdelim, and native addons that hand over ownership.
//
// The other direction has no such check: never hand a block from malloc to a system API that releases it with its own
// free (kCFAllocatorMalloc, freeWhenDone:YES, DISPATCH_DATA_DESTRUCTOR_FREE, a heap block for _Block_release, a buffer
// for getline). Pass a callback that calls free, or allocate with malloc_zone_malloc(malloc_default_zone(), size).
// The same holds for operator new and an object that a native addon deletes.

#include "root.h"

#if OS(DARWIN) && USE(BUN_MIMALLOC) && !ASAN_ENABLED

#include "mimalloc.h"
#include <algorithm>
#include <cstring>
#include <malloc/malloc.h>
#include <new>
#include <string>

namespace {

NEVER_INLINE void freeSystemBlock(void* block)
{
    malloc_zone_t* zone = malloc_zone_from_ptr(block);
    // No zone owns it: let the default zone report the bad pointer the way free() would.
    malloc_zone_free(zone ? zone : malloc_default_zone(), block);
}

ALWAYS_INLINE void freeBlock(void* block)
{
    if (mi_is_in_heap_region(block)) [[likely]]
        mi_free(block);
    else if (block)
        freeSystemBlock(block);
}

NEVER_INLINE void* moveSystemBlock(void* block, size_t newSize)
{
    void* result = mi_malloc(newSize);
    if (!result)
        return nullptr;
    std::memcpy(result, block, std::min(malloc_size(block), newSize));
    freeSystemBlock(block);
    return result;
}

} // namespace

#define BUN_LINKED_ONLY extern "C" __attribute__((used, visibility("hidden")))

BUN_LINKED_ONLY void* malloc(size_t size) { return mi_malloc(size); }
BUN_LINKED_ONLY void* calloc(size_t count, size_t size) { return mi_calloc(count, size); }
BUN_LINKED_ONLY void free(void* block) { freeBlock(block); }

BUN_LINKED_ONLY void* realloc(void* block, size_t newSize)
{
    if (!block || mi_is_in_heap_region(block)) [[likely]]
        return mi_realloc(block, newSize);
    return moveSystemBlock(block, newSize);
}

BUN_LINKED_ONLY void* reallocf(void* block, size_t newSize)
{
    void* result = realloc(block, newSize);
    if (!result)
        freeBlock(block);
    return result;
}

BUN_LINKED_ONLY void* valloc(size_t size) { return mi_valloc(size); }
BUN_LINKED_ONLY void* aligned_alloc(size_t alignment, size_t size) { return mi_aligned_alloc(alignment, size); }
BUN_LINKED_ONLY int posix_memalign(void** result, size_t alignment, size_t size) { return mi_posix_memalign(result, alignment, size); }
BUN_LINKED_ONLY char* strdup(const char* string) { return mi_strdup(string); }
BUN_LINKED_ONLY char* strndup(const char* string, size_t maxLength) { return mi_strndup(string, maxLength); }

#undef BUN_LINKED_ONLY

// libc++.1.dylib would release the executable's buffer where one of its std::string members grows a string.
template class std::basic_string<char>;

// clang refuses to hide a replaceable operator, so the link does: it exports none of them.
#define BUN_LINKED_ONLY_OPERATOR __attribute__((used))

BUN_LINKED_ONLY_OPERATOR void* operator new(size_t size) { return mi_new(size); }
BUN_LINKED_ONLY_OPERATOR void* operator new[](size_t size) { return mi_new(size); }
BUN_LINKED_ONLY_OPERATOR void* operator new(size_t size, const std::nothrow_t&) noexcept { return mi_new_nothrow(size); }
BUN_LINKED_ONLY_OPERATOR void* operator new[](size_t size, const std::nothrow_t&) noexcept { return mi_new_nothrow(size); }
BUN_LINKED_ONLY_OPERATOR void* operator new(size_t size, std::align_val_t alignment) { return mi_new_aligned(size, static_cast<size_t>(alignment)); }
BUN_LINKED_ONLY_OPERATOR void* operator new[](size_t size, std::align_val_t alignment) { return mi_new_aligned(size, static_cast<size_t>(alignment)); }
BUN_LINKED_ONLY_OPERATOR void* operator new(size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept { return mi_new_aligned_nothrow(size, static_cast<size_t>(alignment)); }
BUN_LINKED_ONLY_OPERATOR void* operator new[](size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept { return mi_new_aligned_nothrow(size, static_cast<size_t>(alignment)); }

BUN_LINKED_ONLY_OPERATOR void operator delete(void* block) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete[](void* block) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete(void* block, size_t) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete[](void* block, size_t) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete(void* block, const std::nothrow_t&) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete[](void* block, const std::nothrow_t&) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete(void* block, std::align_val_t) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete[](void* block, std::align_val_t) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete(void* block, size_t, std::align_val_t) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete[](void* block, size_t, std::align_val_t) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete(void* block, std::align_val_t, const std::nothrow_t&) noexcept { freeBlock(block); }
BUN_LINKED_ONLY_OPERATOR void operator delete[](void* block, std::align_val_t, const std::nothrow_t&) noexcept { freeBlock(block); }

#undef BUN_LINKED_ONLY_OPERATOR

#endif
