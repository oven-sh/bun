// Statically override malloc and free with mimalloc on Linux and Windows. This
// in theory should work because we statically link the vc runtime on Windows.
//
// We don't do this on macOS because system libraries expect the system malloc
// and free. The proper way to override malloc and free on macOS is to use
// either dyld OR to use malloc_zone_register().

#if defined(WIN32) || defined(__linux__)

#include <mimalloc.h>

extern "C" {

char* wrap_strdup(const char* s) { return mi_strdup(s); }
char* wrap_strndup(const char* s, size_t n) { return mi_strndup(s, n); }
char* wrap_realpath(const char* f, char* n) { return mi_realpath(f, n); }

void* wrap_malloc(size_t n) { return mi_malloc(n); }
void* wrap_calloc(size_t n, size_t c) { return mi_calloc(n, c); }
void* wrap_realloc(void* p, size_t n) { return mi_realloc(p, n); }
void wrap_free(void* p) { mi_free(p); }

void wrap_cfree(void* p) { mi_cfree(p); }
void* wrap__expand(void* p, size_t newsize) { return mi__expand(p, newsize); }
size_t wrap__msize(const void* p) { return mi_malloc_size(p); }
void* wrap_recalloc(void* p, size_t newcount, size_t size) { return mi_recalloc(p, newcount, size); }

size_t wrap_malloc_size(const void* p) { return mi_malloc_size(p); }
size_t wrap_malloc_good_size(size_t size) { return mi_malloc_good_size(size); }
size_t wrap_malloc_usable_size(const void* p) { return mi_malloc_usable_size(p); }

int wrap_posix_memalign(void** p, size_t alignment, size_t size) { return mi_posix_memalign(p, alignment, size); }
void* wrap_memalign(size_t alignment, size_t size) { return mi_memalign(alignment, size); }
void* wrap_valloc(size_t size) { return mi_valloc(size); }
void* wrap_pvalloc(size_t size) { return mi_pvalloc(size); }
void* wrap_aligned_alloc(size_t alignment, size_t size) { return mi_aligned_alloc(alignment, size); }

void* wrap_reallocarray(void* p, size_t count, size_t size) { return mi_reallocarray(p, count, size); }
int wrap_reallocarr(void* p, size_t count, size_t size) { return mi_reallocarr(p, count, size); }
void* wrap_aligned_recalloc(void* p, size_t newcount, size_t size, size_t alignment) { return mi_aligned_recalloc(p, newcount, size, alignment); }
void* wrap_aligned_offset_recalloc(void* p, size_t newcount, size_t size, size_t alignment, size_t offset) { return mi_aligned_offset_recalloc(p, newcount, size, alignment, offset); }

unsigned short* wrap_wcsdup(const unsigned short* s) { return mi_wcsdup(s); }
unsigned char* wrap_mbsdup(const unsigned char* s) { return mi_mbsdup(s); }
int wrap_dupenv_s(char** buf, size_t* size, const char* name) { return mi_dupenv_s(buf, size, name); }
int wrap_wdupenv_s(unsigned short** buf, size_t* size, const unsigned short* name) { return mi_wdupenv_s(buf, size, name); }

void wrap_free_size(void* p, size_t size) { mi_free_size(p, size); }
void wrap_free_size_aligned(void* p, size_t size, size_t alignment) { mi_free_size_aligned(p, size, alignment); }
void wrap_free_aligned(void* p, size_t alignment) { mi_free_aligned(p, alignment); }
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
