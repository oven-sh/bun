#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_thread_create_ex(uv_thread_t* tid,
                                  const uv_thread_options_t* params,
                                  uv_thread_cb entry,
                                  void* arg) {
  __bun_throw_not_implemented("uv_thread_create_ex");
  __builtin_unreachable();
}

#endif