#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_unlink(uv_loop_t* loop,
                 uv_fs_t* req,
                 const char* path,
                 uv_fs_cb cb) {
  __bun_throw_not_implemented("uv_fs_unlink");
  __builtin_unreachable();
}

#endif