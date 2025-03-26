#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_update_time(uv_loop_t*) {
  __bun_throw_not_implemented("uv_update_time");
  __builtin_unreachable();
}

#endif