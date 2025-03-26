#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_thread_setname(const char* name) {
  __bun_throw_not_implemented("uv_thread_setname");
  __builtin_unreachable();
}

#endif