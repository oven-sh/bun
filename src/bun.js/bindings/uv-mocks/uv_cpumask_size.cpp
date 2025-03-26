#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_cpumask_size(void) {
  __bun_throw_not_implemented("uv_cpumask_size");
  __builtin_unreachable();
}

#endif