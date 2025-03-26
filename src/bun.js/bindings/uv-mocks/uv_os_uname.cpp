#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_os_uname(uv_utsname_t* buffer) {
  __bun_throw_not_implemented("uv_os_uname");
  __builtin_unreachable();
}

#endif