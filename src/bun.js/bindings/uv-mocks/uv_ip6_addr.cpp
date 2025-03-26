#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_ip6_addr(const char* ip, int port, struct sockaddr_in6* addr) {
  __bun_throw_not_implemented("uv_ip6_addr");
  __builtin_unreachable();
}

#endif