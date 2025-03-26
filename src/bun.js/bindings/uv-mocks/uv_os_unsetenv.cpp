#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_os_unsetenv(const char* name) {
  __bun_throw_not_implemented("uv_os_unsetenv");
  __builtin_unreachable();
}

#endif