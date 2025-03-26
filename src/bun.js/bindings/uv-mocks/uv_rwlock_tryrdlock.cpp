#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_rwlock_tryrdlock(uv_rwlock_t* rwlock) {
  __bun_throw_not_implemented("uv_rwlock_tryrdlock");
  __builtin_unreachable();
}

#endif