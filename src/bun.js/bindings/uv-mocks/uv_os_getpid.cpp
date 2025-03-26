#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN uv_pid_t uv_os_getpid(void) {
  __bun_throw_not_implemented("uv_os_getpid");
  __builtin_unreachable();
}

#endif