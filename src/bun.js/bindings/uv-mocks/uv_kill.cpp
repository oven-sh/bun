#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_kill(int pid, int signum) {
  __bun_throw_not_implemented("uv_kill");
  __builtin_unreachable();
}

#endif