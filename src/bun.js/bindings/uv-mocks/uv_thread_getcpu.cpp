#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_thread_getcpu(void) {
  __bun_throw_not_implemented("uv_thread_getcpu");
  __builtin_unreachable();
}

#endif