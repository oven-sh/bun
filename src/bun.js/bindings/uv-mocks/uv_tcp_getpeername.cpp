#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tcp_getpeername(const uv_tcp_t* handle,
                                 struct sockaddr* name,
                                 int* namelen) {
  __bun_throw_not_implemented("uv_tcp_getpeername");
  __builtin_unreachable();
}

#endif