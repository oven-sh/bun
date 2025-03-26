#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_poll_init(uv_loop_t* loop, uv_fs_poll_t* handle) {
  __bun_throw_not_implemented("uv_fs_poll_init");
  __builtin_unreachable();
}

#endif