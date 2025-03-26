#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_os_get_passwd(uv_passwd_t* pwd) {
  __bun_throw_not_implemented("uv_os_get_passwd");
  __builtin_unreachable();
}

#endif