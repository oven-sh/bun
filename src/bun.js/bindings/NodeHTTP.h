#include "config.h"

namespace Bun {
  
JSC_DECLARE_HOST_FUNCTION(jsHTTPAssignHeaders);
JSC_DECLARE_HOST_FUNCTION(jsHTTPGetHeader);
JSC_DECLARE_HOST_FUNCTION(jsHTTPSetHeader);

JSC::JSValue createNodeHTTPInternalBinding(Zig::GlobalObject*);

}