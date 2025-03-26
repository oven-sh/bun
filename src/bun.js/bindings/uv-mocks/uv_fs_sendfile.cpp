#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_sendfile(uv_loop_t* loop,
                   uv_fs_t* req,
                   uv_file out_fd,
                   uv_file in_fd,
                   int64_t in_offset,
                   size_t length,
                   uv_fs_cb cb) {
  __bun_throw_not_implemented("uv_fs_sendfile");
  __builtin_unreachable();
}

#endif