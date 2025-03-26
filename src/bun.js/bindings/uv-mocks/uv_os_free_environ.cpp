#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_os_free_environ(uv_env_item_t* envitems, int count) {
  __bun_throw_not_implemented("uv_os_free_environ");
  __builtin_unreachable();
}

#endif