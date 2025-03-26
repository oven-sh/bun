#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_chdir(const char* dir) {
  __bun_throw_not_implemented("uv_chdir");
  __builtin_unreachable();
}

#endif