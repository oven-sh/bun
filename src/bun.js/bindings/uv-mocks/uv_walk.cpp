#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_walk(uv_loop_t* loop, uv_walk_cb walk_cb, void* arg) {
  __bun_throw_not_implemented("uv_walk");
  __builtin_unreachable();
}

#endif