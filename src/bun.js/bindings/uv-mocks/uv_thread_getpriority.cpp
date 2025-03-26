#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_thread_getpriority(uv_thread_t tid, int* priority) {
  __bun_throw_not_implemented("uv_thread_getpriority");
  __builtin_unreachable();
}

#endif