#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

const char* uv_fs_get_path(const uv_fs_t* req) {
  __bun_throw_not_implemented("uv_fs_get_path");
  __builtin_unreachable();
}

#endif