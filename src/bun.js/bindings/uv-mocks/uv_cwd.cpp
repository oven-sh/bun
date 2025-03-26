#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_cwd(char* buffer, size_t* size) {
  __bun_throw_not_implemented("uv_cwd");
  __builtin_unreachable();
}

#endif