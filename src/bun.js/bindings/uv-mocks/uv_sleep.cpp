#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_sleep(unsigned int msec) {
  __bun_throw_not_implemented("uv_sleep");
  __builtin_unreachable();
}

#endif