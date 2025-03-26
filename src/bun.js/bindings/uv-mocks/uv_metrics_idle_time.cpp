#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN uint64_t uv_metrics_idle_time(uv_loop_t* loop) {
  __bun_throw_not_implemented("uv_metrics_idle_time");
  __builtin_unreachable();
}

#endif