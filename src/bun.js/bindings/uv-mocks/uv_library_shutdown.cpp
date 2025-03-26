#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_library_shutdown(void) {
  __bun_throw_not_implemented("uv_library_shutdown");
  __builtin_unreachable();
}

#endif