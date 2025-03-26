#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN const char* uv_req_type_name(uv_req_type type) {
  __bun_throw_not_implemented("uv_req_type_name");
  __builtin_unreachable();
}

#endif