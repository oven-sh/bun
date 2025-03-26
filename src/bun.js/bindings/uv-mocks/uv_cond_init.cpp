#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_cond_init(uv_cond_t* cond) {
  __bun_throw_not_implemented("uv_cond_init");
  __builtin_unreachable();
}

#endif