#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_loop_close(uv_loop_t* loop) {
  __bun_throw_not_implemented("uv_loop_close");
  __builtin_unreachable();
}

#endif