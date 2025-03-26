#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_os_setenv(const char* name, const char* value) {
  __bun_throw_not_implemented("uv_os_setenv");
  __builtin_unreachable();
}

#endif