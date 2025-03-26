#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_event_start(uv_fs_event_t* handle, uv_fs_event_cb cb, const char* path, unsigned int flags) {
  __bun_throw_not_implemented("uv_fs_event_start");
  __builtin_unreachable();
}

#endif