#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_barrier_init(uv_barrier_t* barrier, unsigned int count) {
  __bun_throw_not_implemented("uv_barrier_init");
  __builtin_unreachable();
}

#endif