#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_signal_start_oneshot(uv_signal_t* handle,
                                      uv_signal_cb signal_cb,
                                      int signum) {
  __bun_throw_not_implemented("uv_signal_start_oneshot");
  __builtin_unreachable();
}

#endif