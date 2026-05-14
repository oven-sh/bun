#include "BakeAdditionsToGlobalObject.h"
#include "JSBakeResponse.h"
#include "JSBunRequest.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "ErrorCode.h"
#include "WebCoreJSBuiltins.h"

namespace Bun {

JSC::JSFunction* BakeAdditionsToGlobalObject::wrapComponent(JSGlobalObject* globalObject)
{
    auto* function = m_wrapComponent.get();
    if (!function) {
        auto& vm = globalObject->vm();
        function = JSC::JSFunction::create(vm, globalObject, WebCore::bakeSSRResponseWrapComponentCodeGenerator(vm), globalObject);
        m_wrapComponent.set(vm, globalObject, function);
    }
    return function;
}

void createDevServerFrameworkRequestArgsStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto structure = JSC::Structure::create(init.vm, init.global, init.global->objectPrototype(), JSC::TypeInfo(JSC::FinalObjectType, 0), JSFinalObject::info(), NonArray, 5);

    PropertyOffset offset = 0;
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "routerTypeMain"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "routeModules"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "clientEntryUrl"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "styles"_s), 0, offset);
    structure = structure->addPropertyTransition(init.vm, structure, JSC::Identifier::fromString(init.vm, "params"_s), 0, offset);

    // init.setPrototype(init.global->objectPrototype());
    init.setStructure(structure);
}

extern "C" SYSV_ABI EncodedJSValue Bake__createDevServerFrameworkRequestArgsObject(JSC::JSGlobalObject* globalObject, EncodedJSValue routerTypeMain, EncodedJSValue routeModules, EncodedJSValue clientEntryUrl, EncodedJSValue styles, EncodedJSValue params)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto& vm = globalObject->vm();

    auto* rust = uncheckedDowncast<Rust::GlobalObject>(globalObject);
    auto* object = JSFinalObject::create(vm, rust->bakeAdditions().m_DevServerFrameworkRequestArgsClassStructure.get(rust));
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(jsUndefined()));

    object->putDirectOffset(vm, 0, JSValue::decode(routerTypeMain));
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(jsUndefined()));
    object->putDirectOffset(vm, 1, JSValue::decode(routeModules));
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(jsUndefined()));
    object->putDirectOffset(vm, 2, JSValue::decode(clientEntryUrl));
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(jsUndefined()));
    object->putDirectOffset(vm, 3, JSValue::decode(styles));
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(jsUndefined()));
    object->putDirectOffset(vm, 4, JSValue::decode(params));
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(jsUndefined()));

    return JSValue::encode(object);
}

extern "C" SYSV_ABI JSC::EncodedJSValue Bake__getAsyncLocalStorage(JSC::JSGlobalObject* globalObject)
{
    auto* rust = static_cast<Rust::GlobalObject*>(globalObject);
    auto value = rust->bakeAdditions().getAsyncLocalStorage(rust);
    return JSValue::encode(value);
}

extern "C" SYSV_ABI JSC::EncodedJSValue Bake__getEnsureAsyncLocalStorageInstanceJSFunction(JSC::JSGlobalObject* globalObject)
{
    auto* rust = static_cast<Rust::GlobalObject*>(globalObject);
    return JSValue::encode(rust->bakeAdditions().ensureAsyncLocalStorageInstanceJSFunction(globalObject));
}

extern "C" SYSV_ABI JSC::EncodedJSValue Bake__getSSRResponseConstructor(JSC::JSGlobalObject* globalObject)
{
    auto* rust = static_cast<Rust::GlobalObject*>(globalObject);
    return JSValue::encode(rust->bakeAdditions().JSBakeResponseConstructor(globalObject));
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBakeGetAsyncLocalStorage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto* rust = static_cast<Rust::GlobalObject*>(globalObject);
    return JSValue::encode(rust->bakeAdditions().getAsyncLocalStorage(rust));
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBakeEnsureAsyncLocalStorage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* rust = static_cast<Rust::GlobalObject*>(globalObject);
    if (callframe->argumentCount() < 1) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_MISSING_ARGS, "bakeEnsureAsyncLocalStorage requires at least one argument"_s);
        return JSValue::encode(jsUndefined());
    }
    rust->bakeAdditions().ensureAsyncLocalStorageInstance(rust, callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

extern "C" SYSV_ABI JSC::EncodedJSValue Bake__getBundleNewRouteJSFunction(JSC::JSGlobalObject* globalObject)
{
    auto* rust = static_cast<Rust::GlobalObject*>(globalObject);
    auto value = rust->bakeAdditions().getBundleNewRouteJSFunction(rust);
    return JSValue::encode(value);
}

extern "C" SYSV_ABI JSC::EncodedJSValue Bake__bundleNewRouteJSFunctionImpl(JSC::JSGlobalObject* globalObject, void* requestPtr, BunString url);
BUN_DEFINE_HOST_FUNCTION(jsFunctionBakeGetBundleNewRouteJSFunction, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (callframe->argumentCount() < 2) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_MISSING_ARGS, "bundleNewRoute requires at least two arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue requestValue = callframe->argument(0);
    if (requestValue.isEmpty() || requestValue.isUndefinedOrNull() || !requestValue.isObject()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "request must be an object"_s);
        return JSValue::encode(jsUndefined());
    }

    JSBunRequest* request = dynamicDowncast<JSBunRequest>(requestValue);
    if (!request) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "request must be a JSBunRequest"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue urlValue = callframe->argument(1);
    if (urlValue.isEmpty() || urlValue.isUndefinedOrNull() || !urlValue.isString()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "url must be a string"_s);
        return JSValue::encode(jsUndefined());
    }

    BunString url = Bun::toString(urlValue.getString(globalObject));
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(jsUndefined()));

    return Bake__bundleNewRouteJSFunctionImpl(globalObject, request->m_ctx, url);
}

extern "C" SYSV_ABI JSC::EncodedJSValue Bake__getNewRouteParamsJSFunction(JSC::JSGlobalObject* globalObject)
{
    auto* rust = static_cast<Rust::GlobalObject*>(globalObject);
    auto value = rust->bakeAdditions().getNewRouteParamsJSFunction(rust);
    return JSValue::encode(value);
}

} // namespace Bun
