#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tcp_init(uv_loop_t*, uv_tcp_t* handle) {
  __bun_throw_not_implemented("uv_tcp_init");
  __builtin_unreachable();
}

#endif