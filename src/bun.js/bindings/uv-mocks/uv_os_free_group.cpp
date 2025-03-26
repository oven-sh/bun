#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_os_free_group(uv_group_t* grp) {
  __bun_throw_not_implemented("uv_os_free_group");
  __builtin_unreachable();
}

#endif