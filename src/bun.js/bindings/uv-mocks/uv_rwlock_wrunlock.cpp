#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_rwlock_wrunlock(uv_rwlock_t* rwlock) {
  __bun_throw_not_implemented("uv_rwlock_wrunlock");
  __builtin_unreachable();
}

#endif