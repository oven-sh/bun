#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_backend_timeout(const uv_loop_t* loop) {
  __bun_throw_not_implemented("uv_backend_timeout");
  __builtin_unreachable();
}

#endif