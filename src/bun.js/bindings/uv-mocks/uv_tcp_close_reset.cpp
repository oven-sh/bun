#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tcp_close_reset(uv_tcp_t* handle, uv_close_cb close_cb) {
  __bun_throw_not_implemented("uv_tcp_close_reset");
  __builtin_unreachable();
}

#endif