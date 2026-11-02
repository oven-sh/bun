#include "root.h"
#include "JSDOMGlobalObjectInlines.h"
#include "ZigGlobalObject.h"

#include "GeneratedBlob.h"
#include "GeneratedResponse.h"
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
        Bun::Bindgen::constructorForClass<Bun::Bindgen::Generated::JSResponse>(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    obj->putDirectIndex(
        globalObject, 1,
        Bun::Bindgen::constructorForClass<Bun::Bindgen::Generated::JSRequest>(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    obj->putDirectIndex(
        globalObject, 2,
        Bun::Bindgen::constructorForClass<Bun::Bindgen::Generated::JSBlob>(globalObject));
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
