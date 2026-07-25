#include "root.h"

#include "PrimordialsAudit.h"

#include <JavaScriptCore/JSGlobalObject.h>

namespace Bun {

BUN_DEFINE_HOST_FUNCTION(Bun__primordialsAudit, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return JSC::JSValue::encode(JSC::JSGlobalObject::auditPrimordials(globalObject));
}

} // namespace Bun
