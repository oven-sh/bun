#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {
namespace ProcessBindingUV {

JSC_DECLARE_HOST_FUNCTION(jsErrname);

JSC_DECLARE_HOST_FUNCTION(jsGetErrorMap);

JSC::JSObject* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace ProcessBindingUV

// The object process.binding("uv") returns, for builtins: $cpp("ProcessBindingUV.cpp", "getProcessBindingUV").
JSC::JSValue getProcessBindingUV(Zig::GlobalObject*);

} // namespace Bun
