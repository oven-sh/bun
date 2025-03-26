#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_translate_sys_error(int sys_errno) {
  __bun_throw_not_implemented("uv_translate_sys_error");
  __builtin_unreachable();
}

#endif