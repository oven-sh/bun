#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_process_kill(uv_process_t*, int signum) {
  __bun_throw_not_implemented("uv_process_kill");
  __builtin_unreachable();
}

#endif