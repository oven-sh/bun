#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN void uv_req_set_data(uv_req_t* req, void* data) {
  __bun_throw_not_implemented("uv_req_set_data");
  __builtin_unreachable();
}

#endif