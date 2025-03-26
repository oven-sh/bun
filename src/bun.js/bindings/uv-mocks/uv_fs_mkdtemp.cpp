#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_mkdtemp(uv_loop_t* loop,
                  uv_fs_t* req,
                  const char* tpl,
                  uv_fs_cb cb) {
  __bun_throw_not_implemented("uv_fs_mkdtemp");
  __builtin_unreachable();
}

#endif