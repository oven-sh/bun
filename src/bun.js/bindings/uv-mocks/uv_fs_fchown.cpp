#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_fchown(uv_loop_t* loop,
                uv_fs_t* req,
                uv_file file,
                uv_uid_t uid,
                uv_gid_t gid,
                uv_fs_cb cb) {
  __bun_throw_not_implemented("uv_fs_fchown");
  __builtin_unreachable();
}

#endif