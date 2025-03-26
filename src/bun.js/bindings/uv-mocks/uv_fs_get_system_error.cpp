#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_get_system_error(const uv_fs_t* req) {
  __bun_throw_not_implemented("uv_fs_get_system_error");
  __builtin_unreachable();
}

#endif