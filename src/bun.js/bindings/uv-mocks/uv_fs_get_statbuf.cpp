#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

uv_stat_t* uv_fs_get_statbuf(uv_fs_t* req) {
  __bun_throw_not_implemented("uv_fs_get_statbuf");
  __builtin_unreachable();
}

#endif