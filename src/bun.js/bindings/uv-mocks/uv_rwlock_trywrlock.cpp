#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_rwlock_trywrlock(uv_rwlock_t* rwlock) {
  __bun_throw_not_implemented("uv_rwlock_trywrlock");
  __builtin_unreachable();
}

#endif