#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_uptime(double* uptime) {
  __bun_throw_not_implemented("uv_uptime");
  __builtin_unreachable();
}

#endif