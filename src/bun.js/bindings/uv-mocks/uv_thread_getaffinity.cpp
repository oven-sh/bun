#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_thread_getaffinity(uv_thread_t* tid,
                                    char* cpumask,
                                    size_t mask_size) {
  __bun_throw_not_implemented("uv_thread_getaffinity");
  __builtin_unreachable();
}

#endif