#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_loop_configure(uv_loop_t* loop, uv_loop_option option, ...) {
  __bun_throw_not_implemented("uv_loop_configure");
  __builtin_unreachable();
}

#endif