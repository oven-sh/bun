#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_idle_init(uv_loop_t*, uv_idle_t* idle) {
  __bun_throw_not_implemented("uv_idle_init");
  __builtin_unreachable();
}

#endif