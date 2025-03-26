#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_dlsym(uv_lib_t* lib, const char* name, void** ptr) {
  __bun_throw_not_implemented("uv_dlsym");
  __builtin_unreachable();
}

#endif