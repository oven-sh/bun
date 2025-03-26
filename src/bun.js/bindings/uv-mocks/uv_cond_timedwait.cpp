#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_cond_timedwait(uv_cond_t* cond,
                      uv_mutex_t* mutex,
                      uint64_t timeout) {
  __bun_throw_not_implemented("uv_cond_timedwait");
  __builtin_unreachable();
}

#endif