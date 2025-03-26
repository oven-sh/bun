#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

int uv_cancel(uv_req_t* req) {
  __bun_throw_not_implemented("uv_cancel");
  __builtin_unreachable();
}

#endif