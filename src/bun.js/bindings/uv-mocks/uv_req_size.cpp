#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN size_t uv_req_size(uv_req_type type) {
  __bun_throw_not_implemented("uv_req_size");
  __builtin_unreachable();
}

#endif