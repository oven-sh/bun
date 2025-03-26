#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

uv_loop_t* uv_default_loop(void) {
  __bun_throw_not_implemented("uv_default_loop");
  __builtin_unreachable();
}

#endif