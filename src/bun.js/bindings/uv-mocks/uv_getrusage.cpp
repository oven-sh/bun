#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_getrusage(uv_rusage_t* rusage) {
  __bun_throw_not_implemented("uv_getrusage");
  __builtin_unreachable();
}

#endif