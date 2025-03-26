#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_thread_equal(const uv_thread_t* t1, const uv_thread_t* t2) {
  __bun_throw_not_implemented("uv_thread_equal");
  __builtin_unreachable();
}

#endif