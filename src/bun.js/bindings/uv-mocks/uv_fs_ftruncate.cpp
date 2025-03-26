#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_ftruncate(uv_loop_t* loop,
                    uv_fs_t* req,
                    uv_file file,
                    int64_t offset,
                    uv_fs_cb cb) {
  __bun_throw_not_implemented("uv_fs_ftruncate");
  __builtin_unreachable();
}

#endif