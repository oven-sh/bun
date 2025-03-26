#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_metrics_info(uv_loop_t* loop, uv_metrics_t* metrics) {
  __bun_throw_not_implemented("uv_metrics_info");
  __builtin_unreachable();
}

#endif