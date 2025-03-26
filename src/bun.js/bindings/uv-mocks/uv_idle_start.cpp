#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_idle_start(uv_idle_t* idle, uv_idle_cb cb) {
  __bun_throw_not_implemented("uv_idle_start");
  __builtin_unreachable();
}

#endif