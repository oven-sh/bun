#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_key_create(uv_key_t* key) {
  __bun_throw_not_implemented("uv_key_create");
  __builtin_unreachable();
}

#endif