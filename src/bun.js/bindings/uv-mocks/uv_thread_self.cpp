#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN uv_thread_t uv_thread_self(void) {
  __bun_throw_not_implemented("uv_thread_self");
  __builtin_unreachable();
}

#endif