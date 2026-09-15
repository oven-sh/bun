#include "root.h"

namespace Bun {
namespace ProcessBindingUV {

JSC_DECLARE_HOST_FUNCTION(jsErrname);

JSC_DECLARE_HOST_FUNCTION(jsGetErrorMap);

JSC::JSObject* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

// libuv's uv_strerror(): the message for a UV_E* number.
WTF::String errorMessage(int err);

} // namespace ProcessBindingUV
} // namespace Bun
