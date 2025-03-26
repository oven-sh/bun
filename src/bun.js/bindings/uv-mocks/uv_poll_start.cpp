#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_poll_start(uv_poll_t* handle, int events, uv_poll_cb cb) {
  __bun_throw_not_implemented("uv_poll_start");
  __builtin_unreachable();
}

#endif