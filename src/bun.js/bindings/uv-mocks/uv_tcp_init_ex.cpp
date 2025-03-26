#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tcp_init_ex(uv_loop_t*, uv_tcp_t* handle, unsigned int flags) {
  __bun_throw_not_implemented("uv_tcp_init_ex");
  __builtin_unreachable();
}

#endif