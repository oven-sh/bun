#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_os_get_passwd2(uv_passwd_t* pwd, uv_uid_t uid) {
  __bun_throw_not_implemented("uv_os_get_passwd2");
  __builtin_unreachable();
}

#endif