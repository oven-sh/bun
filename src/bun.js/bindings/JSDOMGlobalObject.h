#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

#include "DOMWrapperWorld.h"

#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/WeakGCMap.h>
#include "ScriptExecutionContext.h"

namespace WebCore {

Zig::GlobalObject* toJSDOMGlobalObject(ScriptExecutionContext& ctx, DOMWrapperWorld& world);
WEBCORE_EXPORT Zig::GlobalObject& callerGlobalObject(JSC::JSGlobalObject&, JSC::CallFrame*);
Zig::GlobalObject& legacyActiveGlobalObjectForAccessor(JSC::JSGlobalObject&, JSC::CallFrame*);

template<class JSClass>
JSClass* toJSDOMGlobalObject(JSC::VM& vm, JSC::JSValue value)
{
    // static_assert(std::is_base_of_v<JSDOMGlobalObject, JSClass>);

    if (auto* object = value.getObject()) {
        if (object->type() == JSC::GlobalProxyType)
            return JSC::jsDynamicCast<JSClass*>(JSC::jsCast<JSC::JSGlobalProxy*>(object)->target());
        if (object->inherits<JSClass>())
            return JSC::jsCast<JSClass*>(object);
    }

    return nullptr;
}

}
