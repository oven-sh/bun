#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_timer_start(uv_timer_t* handle,
                             uv_timer_cb cb,
                             uint64_t timeout,
                             uint64_t repeat) {
  __bun_throw_not_implemented("uv_timer_start");
  __builtin_unreachable();
}

#endif