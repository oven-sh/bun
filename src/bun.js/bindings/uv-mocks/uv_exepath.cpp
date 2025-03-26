#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_exepath(char* buffer, size_t* size) {
  __bun_throw_not_implemented("uv_exepath");
  __builtin_unreachable();
}

#endif