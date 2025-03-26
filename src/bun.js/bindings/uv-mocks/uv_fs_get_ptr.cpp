#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void* uv_fs_get_ptr(const uv_fs_t* req) {
  __bun_throw_not_implemented("uv_fs_get_ptr");
  __builtin_unreachable();
}

#endif