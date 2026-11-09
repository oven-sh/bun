#include "root.h"

namespace Bun {
namespace ProcessBindingUV {

JSC_DECLARE_HOST_FUNCTION(jsErrname);

JSC_DECLARE_HOST_FUNCTION(jsGetErrorMap);

JSC::JSObject* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

/// What `uv_strerror` says about a `UV_E*` code.
WTF::String errorMessage(int err);

} // namespace ProcessBindingUV
} // namespace Bun
