#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_pipe_open(uv_pipe_t*, uv_file file) {
  __bun_throw_not_implemented("uv_pipe_open");
  __builtin_unreachable();
}

#endif