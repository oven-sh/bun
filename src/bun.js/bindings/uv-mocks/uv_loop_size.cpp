#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN size_t uv_loop_size(void) {
  __bun_throw_not_implemented("uv_loop_size");
  __builtin_unreachable();
}

#endif