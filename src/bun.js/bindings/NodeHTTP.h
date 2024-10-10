#include "config.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsHTTPAssignHeaders);
JSC_DECLARE_HOST_FUNCTION(jsHTTPGetHeader);
JSC_DECLARE_HOST_FUNCTION(jsHTTPSetHeader);

JSC::Structure* createNodeHTTPServerSocketStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
JSC::JSValue createNodeHTTPInternalBinding(Zig::GlobalObject*);

}
