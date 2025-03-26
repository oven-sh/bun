#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN uv_req_type uv_req_get_type(const uv_req_t* req) {
  __bun_throw_not_implemented("uv_req_get_type");
  __builtin_unreachable();
}

#endif