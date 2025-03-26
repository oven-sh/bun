#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_getaddrinfo(uv_loop_t* loop,
                  uv_getaddrinfo_t* req,
                  uv_getaddrinfo_cb getaddrinfo_cb,
                  const char* node,
                  const char* service,
                  const struct addrinfo* hints) {
  __bun_throw_not_implemented("uv_getaddrinfo");
  __builtin_unreachable();
}

#endif