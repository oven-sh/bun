#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_getnameinfo(uv_loop_t* loop,
                  uv_getnameinfo_t* req,
                  uv_getnameinfo_cb getnameinfo_cb,
                  const struct sockaddr* addr,
                  int flags) {
  __bun_throw_not_implemented("uv_getnameinfo");
  __builtin_unreachable();
}

#endif