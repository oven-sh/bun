#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_os_get_group(uv_group_t* grp, uv_uid_t gid) {
  __bun_throw_not_implemented("uv_os_get_group");
  __builtin_unreachable();
}

#endif