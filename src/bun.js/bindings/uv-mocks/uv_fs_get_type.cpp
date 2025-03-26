#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

uv_fs_type uv_fs_get_type(const uv_fs_t* req) {
  __bun_throw_not_implemented("uv_fs_get_type");
  __builtin_unreachable();
}

#endif