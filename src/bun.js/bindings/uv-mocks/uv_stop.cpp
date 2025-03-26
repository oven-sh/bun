#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_stop(uv_loop_t*) {
  __bun_throw_not_implemented("uv_stop");
  __builtin_unreachable();
}

#endif