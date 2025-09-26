#include "BakeAdditionsToGlobalObject.h"
#include "JSBakeResponse.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "ErrorCode.h"

namespace Bun {

void createFrameworkRequestArgsStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto structure = JSC::Structure::create(init.vm, init.global, init.global->objectPrototype(), JSC::TypeInfo(JSC::ObjectType, 0), JSFinalObject::info(), NonArray, 5);

    PropertyOffset offset = 0;
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "routerTypeMain"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "routeModules"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "clientEntryUrl"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "styles"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "params"_s), 0, offset);

    // init.setPrototype(init.global->objectPrototype());
    init.setStructure(structure);
}

extern "C" EncodedJSValue Bake__createFrameworkRequestArgsObject(JSC::JSGlobalObject* globalObject, EncodedJSValue routerTypeMain, EncodedJSValue routeModules, EncodedJSValue clientEntryUrl, EncodedJSValue styles, EncodedJSValue params)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto& vm = globalObject->vm();

    auto* zig = jsCast<Zig::GlobalObject*>(globalObject);
    auto* object = JSFinalObject::create(vm, zig->bakeAdditions().m_FrameworkRequestArgsClassStructure.get(zig));
    RETURN_IF_EXCEPTION(scope, {});

    object->putDirectOffset(vm, 0, JSValue::decode(routerTypeMain));
    RETURN_IF_EXCEPTION(scope, {});
    object->putDirectOffset(vm, 1, JSValue::decode(routeModules));
    RETURN_IF_EXCEPTION(scope, {});
    object->putDirectOffset(vm, 2, JSValue::decode(clientEntryUrl));
    RETURN_IF_EXCEPTION(scope, {});
    object->putDirectOffset(vm, 3, JSValue::decode(styles));
    RETURN_IF_EXCEPTION(scope, {});
    object->putDirectOffset(vm, 4, JSValue::decode(params));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(object);
}

extern "C" JSC::EncodedJSValue Bake__getAsyncLocalStorage(JSC::JSGlobalObject* globalObject)
{
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto value = zig->bakeAdditions().getAsyncLocalStorage(zig);
    return JSValue::encode(value);
}

extern "C" JSC::EncodedJSValue Bake__getEnsureAsyncLocalStorageInstanceJSFunction(JSC::JSGlobalObject* globalObject)
{
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(zig->bakeAdditions().ensureAsyncLocalStorageInstanceJSFunction(globalObject));
}

extern "C" JSC::EncodedJSValue Bake__getSSRResponseConstructor(JSC::JSGlobalObject* globalObject)
{
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(zig->bakeAdditions().JSBakeResponseConstructor(globalObject));
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBakeGetAsyncLocalStorage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(zig->bakeAdditions().getAsyncLocalStorage(zig));
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBakeEnsureAsyncLocalStorage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    if (callframe->argumentCount() < 1) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_MISSING_ARGS, "bakeEnsureAsyncLocalStorage requires at least one argument"_s);
        return {};
    }
    zig->bakeAdditions().ensureAsyncLocalStorageInstance(zig, callframe->argument(0));
    return JSValue::encode(jsUndefined());
}

extern "C" JSC::EncodedJSValue Bake__getBundleNewRouteJSFunction(JSC::JSGlobalObject* globalObject)
{
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto value = zig->bakeAdditions().getBundleNewRouteJSFunction(zig);
    return JSValue::encode(value);
}

extern "C" JSC::EncodedJSValue Bake__bundleNewRouteJSFunctionImpl(JSC::JSGlobalObject* globalObject, void* requestPtr, BunString url);
BUN_DEFINE_HOST_FUNCTION(jsFunctionBakeGetBundleNewRouteJSFunction, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (callframe->argumentCount() < 2) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_MISSING_ARGS, "bundleNewRoute requires at least two arguments"_s);
        return {};
    }

    JSValue requestValue = callframe->argument(0);
    if (requestValue.isEmpty() || requestValue.isUndefinedOrNull() || !requestValue.isObject()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "request must be an object"_s);
        return {};
    }

    JSRequest* request = jsDynamicCast<JSRequest*>(requestValue);
    if (!request) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "request must be a JSRequest"_s);
        return {};
    }

    JSValue urlValue = callframe->argument(1);
    if (urlValue.isEmpty() || urlValue.isUndefinedOrNull() || !urlValue.isString()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "url must be a string"_s);
        return {};
    }

    BunString url = Bun::toString(urlValue.getString(globalObject));

    return Bake__bundleNewRouteJSFunctionImpl(globalObject, request->m_ctx, url);
}

extern "C" JSC::EncodedJSValue Bake__getDevNewRouteParamsJSFunction(JSC::JSGlobalObject* globalObject)
{
    auto* zig = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    auto value = zig->bakeAdditions().getDevNewRouteParamsJSFunction(zig);
    return JSValue::encode(value);
}

} // namespace Bun
