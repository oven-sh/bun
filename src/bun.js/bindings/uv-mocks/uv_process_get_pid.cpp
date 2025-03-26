#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN uv_pid_t uv_process_get_pid(const uv_process_t*) {
  __bun_throw_not_implemented("uv_process_get_pid");
  __builtin_unreachable();
}

#endif