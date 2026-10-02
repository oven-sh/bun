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
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* obj = constructEmptyObject(globalObject);
    obj->putDirectIndex(
        globalObject, 0,
        globalObject->JSResponseConstructor());
    RETURN_IF_EXCEPTION(scope, {});
    obj->putDirectIndex(
        globalObject, 1,
        globalObject->JSRequestConstructor());
    RETURN_IF_EXCEPTION(scope, {});
    obj->putDirectIndex(
        globalObject, 2,
        globalObject->JSBlobConstructor());
    RETURN_IF_EXCEPTION(scope, {});
    obj->putDirectIndex(
        globalObject, 3,
        WebCore::JSFetchHeaders::getConstructor(vm, globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    obj->putDirectIndex(
        globalObject, 4,
        WebCore::JSDOMFormData::getConstructor(vm, globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    obj->putDirectIndex(
        globalObject, 5,
        globalObject->JSDOMFileConstructor());
    RETURN_IF_EXCEPTION(scope, {});

    return obj;
}

}
