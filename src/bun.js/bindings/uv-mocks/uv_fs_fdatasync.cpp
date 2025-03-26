#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_fdatasync(uv_loop_t* loop,
                   uv_fs_t* req,
                   uv_file file,
                   uv_fs_cb cb) {
  __bun_throw_not_implemented("uv_fs_fdatasync");
  __builtin_unreachable();
}

#endif