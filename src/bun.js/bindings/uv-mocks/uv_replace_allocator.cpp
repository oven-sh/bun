#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_replace_allocator(uv_malloc_func malloc_func,
                                   uv_realloc_func realloc_func,
                                   uv_calloc_func calloc_func,
                                   uv_free_func free_func) {
  __bun_throw_not_implemented("uv_replace_allocator");
  __builtin_unreachable();
}

#endif