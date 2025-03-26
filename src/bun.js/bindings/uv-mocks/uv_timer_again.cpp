#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_timer_again(uv_timer_t* handle) {
  __bun_throw_not_implemented("uv_timer_again");
  __builtin_unreachable();
}

#endif