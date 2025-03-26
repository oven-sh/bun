#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN uint64_t uv_timer_get_due_in(const uv_timer_t* handle) {
  __bun_throw_not_implemented("uv_timer_get_due_in");
  __builtin_unreachable();
}

#endif