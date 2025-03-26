#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_poll_start(uv_fs_poll_t* handle,
                     uv_fs_poll_cb poll_cb,
                     const char* path,
                     unsigned int interval) {
  __bun_throw_not_implemented("uv_fs_poll_start");
  __builtin_unreachable();
}

#endif