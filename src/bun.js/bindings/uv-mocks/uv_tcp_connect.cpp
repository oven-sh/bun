#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tcp_connect(uv_connect_t* req,
                             uv_tcp_t* handle,
                             const struct sockaddr* addr,
                             uv_connect_cb cb) {
  __bun_throw_not_implemented("uv_tcp_connect");
  __builtin_unreachable();
}

#endif