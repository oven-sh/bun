#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_backend_fd(const uv_loop_t* loop) {
  __bun_throw_not_implemented("uv_backend_fd");
  __builtin_unreachable();
}

#endif