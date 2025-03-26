#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_fs_event_getpath(uv_fs_event_t* handle, char* buffer, size_t* size) {
  __bun_throw_not_implemented("uv_fs_event_getpath");
  __builtin_unreachable();
}

#endif