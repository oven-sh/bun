#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN unsigned int uv_version(void) {
  __bun_throw_not_implemented("uv_version");
  __builtin_unreachable();
}

#endif