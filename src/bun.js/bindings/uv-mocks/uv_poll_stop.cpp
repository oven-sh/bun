#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_poll_stop(uv_poll_t* handle) {
  __bun_throw_not_implemented("uv_poll_stop");
  __builtin_unreachable();
}

#endif