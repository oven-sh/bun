#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_ip_name(const struct sockaddr* src, char* dst, size_t size) {
  __bun_throw_not_implemented("uv_ip_name");
  __builtin_unreachable();
}

#endif