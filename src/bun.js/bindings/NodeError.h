#include "root.h"

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_INVALID_ARG_TYPE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_OUT_OF_RANGE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));

}
