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

template<class JSClass>
JSClass* toJSDOMGlobalObject(JSC::VM& vm, JSC::JSValue value)
{
    if (auto* object = value.getObject()) {
        if (object->type() == JSC::GlobalProxyType)
            return dynamicDowncast<JSClass>(uncheckedDowncast<JSC::JSGlobalProxy>(object)->target());
        if (object->inherits<JSClass>())
            return uncheckedDowncast<JSClass>(object);
    }

    return nullptr;
}

}
