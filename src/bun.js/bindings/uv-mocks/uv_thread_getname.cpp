#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_thread_getname(uv_thread_t* tid, char* name, size_t size) {
  __bun_throw_not_implemented("uv_thread_getname");
  __builtin_unreachable();
}

#endif