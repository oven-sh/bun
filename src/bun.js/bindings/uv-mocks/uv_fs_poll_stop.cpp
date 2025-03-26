#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_poll_stop(uv_fs_poll_t* handle) {
  __bun_throw_not_implemented("uv_fs_poll_stop");
  __builtin_unreachable();
}

#endif