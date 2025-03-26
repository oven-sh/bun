#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_scandir_next(uv_fs_t* req,
                       uv_dirent_t* ent) {
  __bun_throw_not_implemented("uv_fs_scandir_next");
  __builtin_unreachable();
}

#endif