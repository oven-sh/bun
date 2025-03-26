#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN uv_loop_t* uv_loop_new(void) {
  __bun_throw_not_implemented("uv_loop_new");
  __builtin_unreachable();
}

#endif