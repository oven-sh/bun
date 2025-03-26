#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_signal_init(uv_loop_t* loop, uv_signal_t* handle) {
  __bun_throw_not_implemented("uv_signal_init");
  __builtin_unreachable();
}

#endif