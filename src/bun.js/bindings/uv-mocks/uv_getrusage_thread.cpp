#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_getrusage_thread(uv_rusage_t* rusage) {
  __bun_throw_not_implemented("uv_getrusage_thread");
  __builtin_unreachable();
}

#endif