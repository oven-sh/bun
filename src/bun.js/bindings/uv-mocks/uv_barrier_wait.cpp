#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_barrier_wait(uv_barrier_t* barrier) {
  __bun_throw_not_implemented("uv_barrier_wait");
  __builtin_unreachable();
}

#endif