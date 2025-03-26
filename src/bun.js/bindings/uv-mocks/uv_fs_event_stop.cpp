#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_event_stop(uv_fs_event_t* handle) {
  __bun_throw_not_implemented("uv_fs_event_stop");
  __builtin_unreachable();
}

#endif