#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_loadavg(double avg[3]) {
  __bun_throw_not_implemented("uv_loadavg");
  __builtin_unreachable();
}

#endif