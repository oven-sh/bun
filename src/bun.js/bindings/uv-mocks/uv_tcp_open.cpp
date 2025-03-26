#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tcp_open(uv_tcp_t* handle, uv_os_sock_t sock) {
  __bun_throw_not_implemented("uv_tcp_open");
  __builtin_unreachable();
}

#endif