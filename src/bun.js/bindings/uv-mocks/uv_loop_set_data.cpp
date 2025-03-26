#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_loop_set_data(uv_loop_t*, void* data) {
  __bun_throw_not_implemented("uv_loop_set_data");
  __builtin_unreachable();
}

#endif