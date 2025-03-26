#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void* uv_loop_get_data(const uv_loop_t*) {
  __bun_throw_not_implemented("uv_loop_get_data");
  __builtin_unreachable();
}

#endif