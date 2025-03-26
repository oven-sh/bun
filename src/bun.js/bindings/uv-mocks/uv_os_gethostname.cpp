#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_os_gethostname(char* buffer, size_t* size) {
  __bun_throw_not_implemented("uv_os_gethostname");
  __builtin_unreachable();
}

#endif