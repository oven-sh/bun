#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_async_send(uv_async_t* async) {
  __bun_throw_not_implemented("uv_async_send");
  __builtin_unreachable();
}

#endif