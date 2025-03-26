#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_signal_stop(uv_signal_t* handle) {
  __bun_throw_not_implemented("uv_signal_stop");
  __builtin_unreachable();
}

#endif