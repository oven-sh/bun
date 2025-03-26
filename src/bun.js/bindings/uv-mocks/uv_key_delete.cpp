#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_key_delete(uv_key_t* key) {
  __bun_throw_not_implemented("uv_key_delete");
  __builtin_unreachable();
}

#endif