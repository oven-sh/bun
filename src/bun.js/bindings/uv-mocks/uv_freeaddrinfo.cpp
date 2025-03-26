#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_freeaddrinfo(struct addrinfo* ai) {
  __bun_throw_not_implemented("uv_freeaddrinfo");
  __builtin_unreachable();
}

#endif