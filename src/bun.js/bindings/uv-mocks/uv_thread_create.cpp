#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_thread_create(uv_thread_t* tid, uv_thread_cb entry, void* arg) {
  __bun_throw_not_implemented("uv_thread_create");
  __builtin_unreachable();
}

#endif