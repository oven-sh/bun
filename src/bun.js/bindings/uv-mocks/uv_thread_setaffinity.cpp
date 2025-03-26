#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_thread_setaffinity(uv_thread_t* tid,
                                    char* cpumask,
                                    char* oldmask,
                                    size_t mask_size) {
  __bun_throw_not_implemented("uv_thread_setaffinity");
  __builtin_unreachable();
}

#endif