#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_timer_init(uv_loop_t*, uv_timer_t* handle) {
  __bun_throw_not_implemented("uv_timer_init");
  __builtin_unreachable();
}

#endif