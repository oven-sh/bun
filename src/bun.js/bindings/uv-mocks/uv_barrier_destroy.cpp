#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_barrier_destroy(uv_barrier_t* barrier) {
  __bun_throw_not_implemented("uv_barrier_destroy");
  __builtin_unreachable();
}

#endif