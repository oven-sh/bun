#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

uv_loop_t* uv_handle_get_loop(const uv_handle_t* handle) {
  __bun_throw_not_implemented("uv_handle_get_loop");
  __builtin_unreachable();
}

#endif