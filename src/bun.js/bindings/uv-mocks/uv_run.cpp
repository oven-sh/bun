#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_run(uv_loop_t*, uv_run_mode mode) {
  __bun_throw_not_implemented("uv_run");
  __builtin_unreachable();
}

#endif