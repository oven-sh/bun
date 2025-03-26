#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_open_osfhandle(uv_os_fd_t os_fd) {
  __bun_throw_not_implemented("uv_open_osfhandle");
  __builtin_unreachable();
}

#endif