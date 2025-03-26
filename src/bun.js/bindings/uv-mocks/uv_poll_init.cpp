#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_poll_init(uv_loop_t* loop, uv_poll_t* handle, int fd) {
  __bun_throw_not_implemented("uv_poll_init");
  __builtin_unreachable();
}

#endif