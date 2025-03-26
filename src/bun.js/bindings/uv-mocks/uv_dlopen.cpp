#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_dlopen(const char* filename, uv_lib_t* lib) {
  __bun_throw_not_implemented("uv_dlopen");
  __builtin_unreachable();
}

#endif