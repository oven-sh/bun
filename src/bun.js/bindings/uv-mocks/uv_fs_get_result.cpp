#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

ssize_t uv_fs_get_result(const uv_fs_t* req) {
  __bun_throw_not_implemented("uv_fs_get_result");
  __builtin_unreachable();
}

#endif