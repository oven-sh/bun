#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_cond_destroy(uv_cond_t* cond) {
  __bun_throw_not_implemented("uv_cond_destroy");
  __builtin_unreachable();
}

#endif