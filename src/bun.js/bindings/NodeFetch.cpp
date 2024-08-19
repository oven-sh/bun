#include "root.h"
#include "JSDOMGlobalObjectInlines.h"
#include "ZigGlobalObject.h"

#include "JSFetchHeaders.h"
#include "JSDOMFormData.h"
#include "JavaScriptCore/ObjectConstructor.h"

#include "helpers.h"
#include "BunClientData.h"

#include "JavaScriptCore/AggregateError.h"
#include "JavaScriptCore/JSFunction.h"
#include "JSDOMFile.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

// Ensure overriding globals doesn't impact usages.
JSC::JSValue createNodeFetchInternalBinding(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();

    auto* obj = constructEmptyObject(globalObject);
    obj->putDirectIndex(
        globalObject, 0,
        globalObject->JSResponseConstructor());
    obj->putDirectIndex(
        globalObject, 1,
        globalObject->JSRequestConstructor());
    obj->putDirectIndex(
        globalObject, 2,
        globalObject->JSBlobConstructor());
    obj->putDirectIndex(
        globalObject, 3,
        WebCore::JSFetchHeaders::getConstructor(vm, globalObject));

    obj->putDirectIndex(
        globalObject, 4,
        WebCore::JSDOMFormData::getConstructor(vm, globalObject));
    obj->putDirectIndex(
        globalObject, 5,
        globalObject->JSDOMFileConstructor());

    return obj;
}

}