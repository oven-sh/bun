#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

void uv_fs_req_cleanup(uv_fs_t* req) {
  __bun_throw_not_implemented("uv_fs_req_cleanup");
  __builtin_unreachable();
}

#endif