#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fileno(const uv_handle_t* handle, uv_os_fd_t* fd) {
  __bun_throw_not_implemented("uv_fileno");
  __builtin_unreachable();
}

#endif