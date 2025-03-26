#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_pipe_init(uv_loop_t*, uv_pipe_t* handle, int ipc) {
  __bun_throw_not_implemented("uv_pipe_init");
  __builtin_unreachable();
}

#endif