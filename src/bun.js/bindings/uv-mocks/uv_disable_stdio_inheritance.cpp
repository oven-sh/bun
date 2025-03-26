#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_disable_stdio_inheritance(void) {
  __bun_throw_not_implemented("uv_disable_stdio_inheritance");
  __builtin_unreachable();
}

#endif