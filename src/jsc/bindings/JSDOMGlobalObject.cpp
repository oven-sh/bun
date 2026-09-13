#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSCast.h>
#include "ZigGlobalObject.h"

namespace WebCore {

Zig::GlobalObject* toJSDOMGlobalObject(ScriptExecutionContext& ctx, DOMWrapperWorld& world)
{
    return uncheckedDowncast<Zig::GlobalObject>(ctx.jsGlobalObject());
}

}
