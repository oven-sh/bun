// Statically override malloc and free with mimalloc on Linux and Windows. This
// in theory should work because we statically link the vc runtime on Windows.
//
// We don't do this on macOS because system libraries expect the system malloc
// and free. The proper way to override malloc and free on macOS is to use
// either dyld OR to use malloc_zone_register().

#if defined(WIN32) || defined(__linux__)

#include <mimalloc.h>

extern "C" {
void cfree(void* p) { mi_cfree(p); }
void* _expand(void* p, size_t newsize) { return mi__expand(p, newsize); }
size_t malloc_size(const void* p) { return mi_malloc_size(p); }
size_t malloc_good_size(size_t size) { return mi_malloc_good_size(size); }
size_t malloc_usable_size(const void* p) { return mi_malloc_usable_size(p); }

int posix_memalign(void** p, size_t alignment, size_t size) { return mi_posix_memalign(p, alignment, size); }
void* memalign(size_t alignment, size_t size) { return mi_memalign(alignment, size); }
void* valloc(size_t size) { return mi_valloc(size); }
void* pvalloc(size_t size) { return mi_pvalloc(size); }
void* aligned_alloc(size_t alignment, size_t size) { return mi_aligned_alloc(alignment, size); }

void* reallocarray(void* p, size_t count, size_t size) { return mi_reallocarray(p, count, size); }
int reallocarr(void* p, size_t count, size_t size) { return mi_reallocarr(p, count, size); }
void* aligned_recalloc(void* p, size_t newcount, size_t size, size_t alignment) { return mi_aligned_recalloc(p, newcount, size, alignment); }
void* aligned_offset_recalloc(void* p, size_t newcount, size_t size, size_t alignment, size_t offset) { return mi_aligned_offset_recalloc(p, newcount, size, alignment, offset); }

unsigned short* wcsdup(const unsigned short* s) { return mi_wcsdup(s); }
unsigned char* mbsdup(const unsigned char* s) { return mi_mbsdup(s); }
int dupenv_s(char** buf, size_t* size, const char* name) { return mi_dupenv_s(buf, size, name); }
int wdupenv_s(unsigned short** buf, size_t* size, const unsigned short* name) { return mi_wdupenv_s(buf, size, name); }

void free_size(void* p, size_t size) { mi_free_size(p, size); }
void free_size_aligned(void* p, size_t size, size_t alignment) { mi_free_size_aligned(p, size, alignment); }
void free_aligned(void* p, size_t alignment) { mi_free_aligned(p, alignment); }
}

void* operator new(size_t size) { return mi_new(size); }
void* operator new[](size_t size) { return mi_new(size); }
void* operator new(size_t size, std::align_val_t alignment) { return mi_new_aligned(size, static_cast<size_t>(alignment)); }
void* operator new[](size_t size, std::align_val_t alignment) { return mi_new_aligned(size, static_cast<size_t>(alignment)); }
void* operator new(size_t size, const std::nothrow_t&) noexcept { return mi_new_nothrow(size); }
void* operator new[](size_t size, const std::nothrow_t&) noexcept { return mi_new_nothrow(size); }
void* operator new(size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept { return mi_new_aligned_nothrow(size, static_cast<size_t>(alignment)); }
void* operator new[](size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept { return mi_new_aligned_nothrow(size, static_cast<size_t>(alignment)); }

void operator delete(void* p) noexcept { mi_free(p); }
void operator delete[](void* p) noexcept { mi_free(p); }
void operator delete(void* p, std::align_val_t) noexcept { mi_free(p); }
void operator delete[](void* p, std::align_val_t) noexcept { mi_free(p); }
void operator delete(void* p, size_t) noexcept { mi_free(p); }
void operator delete[](void* p, size_t) noexcept { mi_free(p); }
void operator delete(void* p, size_t, std::align_val_t) noexcept { mi_free(p); }
void operator delete[](void* p, size_t, std::align_val_t) noexcept { mi_free(p); }

#endif
