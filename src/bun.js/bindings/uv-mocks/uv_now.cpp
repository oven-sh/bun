#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN uint64_t uv_now(const uv_loop_t*) {
  __bun_throw_not_implemented("uv_now");
  __builtin_unreachable();
}

#endif