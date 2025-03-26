#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_cond_signal(uv_cond_t* cond) {
  __bun_throw_not_implemented("uv_cond_signal");
  __builtin_unreachable();
}

#endif