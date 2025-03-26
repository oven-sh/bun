#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_pipe(uv_file fds[2], int read_flags, int write_flags) {
  __bun_throw_not_implemented("uv_pipe");
  __builtin_unreachable();
}

#endif