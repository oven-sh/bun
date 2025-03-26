#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_os_setpriority(uv_pid_t pid, int priority) {
  __bun_throw_not_implemented("uv_os_setpriority");
  __builtin_unreachable();
}

#endif