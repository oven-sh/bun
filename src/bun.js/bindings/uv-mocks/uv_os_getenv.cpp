#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_os_getenv(const char* name, char* buffer, size_t* size) {
  __bun_throw_not_implemented("uv_os_getenv");
  __builtin_unreachable();
}

#endif