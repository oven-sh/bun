#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_os_homedir(char* buffer, size_t* size) {
  __bun_throw_not_implemented("uv_os_homedir");
  __builtin_unreachable();
}

#endif