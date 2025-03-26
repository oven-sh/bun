#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

const char* uv_dlerror(const uv_lib_t* lib) {
  __bun_throw_not_implemented("uv_dlerror");
  __builtin_unreachable();
}

#endif