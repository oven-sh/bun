#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

uv_os_fd_t uv_get_osfhandle(int fd) {
  __bun_throw_not_implemented("uv_get_osfhandle");
  __builtin_unreachable();
}

#endif