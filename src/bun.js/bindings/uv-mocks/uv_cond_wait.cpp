#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_cond_wait(uv_cond_t* cond, uv_mutex_t* mutex) {
  __bun_throw_not_implemented("uv_cond_wait");
  __builtin_unreachable();
}

#endif