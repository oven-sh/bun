#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_ip6_name(const struct sockaddr_in6* src, char* dst, size_t size) {
  __bun_throw_not_implemented("uv_ip6_name");
  __builtin_unreachable();
}

#endif