#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_async_init(uv_loop_t* loop, uv_async_t* async, uv_async_cb async_cb) {
  __bun_throw_not_implemented("uv_async_init");
  __builtin_unreachable();
}

#endif