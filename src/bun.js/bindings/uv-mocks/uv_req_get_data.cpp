#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void* uv_req_get_data(const uv_req_t* req) {
  __bun_throw_not_implemented("uv_req_get_data");
  __builtin_unreachable();
}

#endif