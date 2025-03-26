#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_timer_set_repeat(uv_timer_t* handle, uint64_t repeat) {
  __bun_throw_not_implemented("uv_timer_set_repeat");
  __builtin_unreachable();
}

#endif