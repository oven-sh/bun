#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_dlclose(uv_lib_t* lib) {
  __bun_throw_not_implemented("uv_dlclose");
  __builtin_unreachable();
}

#endif