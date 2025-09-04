#include "root.h"
#include "headers.h"

#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Symbol.h>
#include <JavaScriptCore/SymbolTable.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include "JSBakeResponse.h"
#include "ZigGlobalObject.h"
#include "ZigGeneratedClasses.h"

#if !OS(WINDOWS)
#define JSC_CALLCONV "C"
#else
#define JSC_CALLCONV "C" SYSV_ABI
#endif

namespace Bun {

static JSC_DECLARE_HOST_FUNCTION(jsBakeResponseConstructorRender);
static JSC_DECLARE_HOST_FUNCTION(jsBakeResponseConstructorRedirect);

static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetSymbolFor);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetType);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetKey);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetProps);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetStore);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetOwner);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetDebugInfo);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetDebugStack);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetDebugTask);

extern JSC_CALLCONV void* JSC_HOST_CALL_ATTRIBUTES ResponseClass__constructForSSR(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::EncodedJSValue);
extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ResponseClass__constructError(JSC::JSGlobalObject*, JSC::CallFrame*) SYSV_ABI;
extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ResponseClass__constructJSON(JSC::JSGlobalObject*, JSC::CallFrame*) SYSV_ABI;
extern JSC_CALLCONV size_t Response__estimatedSize(void* ptr);

static const HashTableValue JSBakeResponseConstructorTableValues[] = {
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, ResponseClass__constructError, 0 } },
    { "json"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, ResponseClass__constructJSON, 0 } },

    { "render"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBakeResponseConstructorRender, 1 } },
    { "redirect"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBakeResponseConstructorRedirect, 1 } },

};

static const HashTableValue JSBakeResponsePrototypeTableValues[] = {
    { "$$typeof"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBakeResponsePrototypeGetSymbolFor, nullptr } },
    { "type"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBakeResponsePrototypeGetType, nullptr } },
    { "key"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBakeResponsePrototypeGetKey, nullptr } },
    { "props"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBakeResponsePrototypeGetProps, nullptr } },
    { "_store"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBakeResponsePrototypeGetStore, nullptr } },
    { "_owner"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBakeResponsePrototypeGetOwner, nullptr } },
    { "_debugInfo"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBakeResponsePrototypeGetDebugInfo, nullptr } },
    { "_debugStack"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBakeResponsePrototypeGetDebugStack, nullptr } },
    { "_debugTask"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsBakeResponsePrototypeGetDebugTask, nullptr } }
};

JSBakeResponse* JSBakeResponse::create(JSC::VM& vm, JSC::Structure* structure, void* ctx)
{
    JSBakeResponse* ptr = new (NotNull, JSC::allocateCell<JSBakeResponse>(vm)) JSBakeResponse(vm, structure, ctx);
    ptr->finishCreation(vm);
    return ptr;
}

JSC::Structure* JSBakeResponse::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(0b11101110), StructureFlags), info());
}

JSC::GCClient::IsoSubspace* JSBakeResponse::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSBakeResponse, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForBakeResponse.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBakeResponse = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForBakeResponse.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForBakeResponse = std::forward<decltype(space)>(space); });
}

JSBakeResponse::JSBakeResponse(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr)
    : Base(vm, structure, sinkPtr)
{
}

void JSBakeResponse::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSBakeResponse::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSBakeResponse* thisObject = jsCast<JSBakeResponse*>(cell);
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSBakeResponse);

class JSBakeResponsePrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static JSBakeResponsePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        auto* ptr = new (NotNull, JSC::allocateCell<JSBakeResponsePrototype>(vm)) JSBakeResponsePrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), NonArray);
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBakeResponsePrototype, Base);
        return &vm.plainObjectSpace();
    }

private:
    JSBakeResponsePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSBakeResponse::info(), JSBakeResponsePrototypeTableValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

JSC_DECLARE_HOST_FUNCTION(callBakeResponse);
JSC_DECLARE_HOST_FUNCTION(constructBakeResponse);

class JSBakeResponseConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSBakeResponseConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSBakeResponseConstructor* constructor = new (NotNull, JSC::allocateCell<JSBakeResponseConstructor>(vm)) JSBakeResponseConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    // DECLARE_INFO;
    DECLARE_EXPORT_INFO;

    // Must be defined for each specialization class.
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
    {
        Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
        JSC::VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSObject* newTarget = asObject(callFrame->newTarget());
        auto* constructor = globalObject->JSResponseConstructor();
        Structure* structure = globalObject->JSBakeResponseStructure();
        if (constructor != newTarget) [[unlikely]] {
            auto* functionGlobalObject = defaultGlobalObject(
                // ShadowRealm functions belong to a different global object.
                getFunctionRealm(globalObject, newTarget));
            RETURN_IF_EXCEPTION(scope, {});
            structure = InternalFunction::createSubclassStructure(globalObject, newTarget, functionGlobalObject->JSBakeResponseStructure());
            RETURN_IF_EXCEPTION(scope, {});
        }

        JSBakeResponse* instance = JSBakeResponse::create(vm, structure, nullptr);

        void* ptr = ResponseClass__constructForSSR(globalObject, callFrame, JSValue::encode(instance));
        if (scope.exception()) [[unlikely]] {
            ASSERT_WITH_MESSAGE(!ptr, "Memory leak detected: new SSRResponse() allocated memory without checking for exceptions.");
            return JSValue::encode(JSC::jsUndefined());
        }

        instance->m_ctx = ptr;

        auto size = Response__estimatedSize(ptr);
        vm.heap.reportExtraMemoryAllocated(instance, size);

        auto value = JSValue::encode(instance);
        RELEASE_AND_RETURN(scope, value);
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
    {
        Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
        JSC::VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        Structure* structure = globalObject->JSBakeResponseStructure();
        JSBakeResponse* instance = JSBakeResponse::create(vm, structure, nullptr);

        void* ptr = ResponseClass__constructForSSR(globalObject, callFrame, JSValue::encode(instance));
        if (scope.exception()) [[unlikely]] {
            ASSERT_WITH_MESSAGE(!ptr, "Memory leak detected: new SSRResponse() allocated memory without checking for exceptions.");
            return JSValue::encode(JSC::jsUndefined());
        }

        instance->m_ctx = ptr;

        RETURN_IF_EXCEPTION(scope, {});

        auto size = Response__estimatedSize(ptr);
        vm.heap.reportExtraMemoryAllocated(instance, size);

        RELEASE_AND_RETURN(scope, JSValue::encode(instance));
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSBakeResponseConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, JSBakeResponseConstructor::call, JSBakeResponseConstructor::construct)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 0, "SSRResponse"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
        reifyStaticProperties(vm, info(), JSBakeResponseConstructorTableValues, *this);
    }
};

const JSC::ClassInfo JSBakeResponsePrototype::s_info = { "SSRResponse"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBakeResponsePrototype) };
const JSC::ClassInfo JSBakeResponse::s_info = { "SSRResponse"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBakeResponse) };
const JSC::ClassInfo JSBakeResponseConstructor::s_info = { "SSRResponse"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBakeResponseConstructor) };

JSC_DEFINE_CUSTOM_GETTER(jsBakeResponsePrototypeGetSymbolFor, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSBakeResponse* response = jsDynamicCast<JSBakeResponse*>(JSValue::decode(thisValue));
    if (!response)
        return JSValue::encode(jsUndefined());

    auto& vm = globalObject->vm();
    auto symbolKey = "react.transitional.element"_s;
    return JSValue::encode(JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey(symbolKey)));
}

JSC_DEFINE_CUSTOM_GETTER(jsBakeResponsePrototypeGetType, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSBakeResponse* response = jsDynamicCast<JSBakeResponse*>(JSValue::decode(thisValue));
    if (!response)
        return JSValue::encode(jsUndefined());

    printf("m_ctx: %p\n", response->m_ctx);

    // auto& type = response->type();
    // auto typeValue = type.get();
    // return JSValue::encode(typeValue);
    String wtfstring = "Hello"_s;
    auto* jsstring = JSC::jsString(globalObject->vm(), wtfstring);
    return JSValue::encode(jsstring);
}

JSC_DEFINE_CUSTOM_GETTER(jsBakeResponsePrototypeGetKey, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    return JSValue::encode(jsNull());
}

JSC_DEFINE_CUSTOM_GETTER(jsBakeResponsePrototypeGetProps, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSBakeResponse* response = jsDynamicCast<JSBakeResponse*>(JSValue::decode(thisValue));
    if (!response)
        return JSValue::encode(jsUndefined());

    return JSValue::encode(JSC::constructEmptyObject(globalObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsBakeResponsePrototypeGetStore, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSBakeResponse* response = jsDynamicCast<JSBakeResponse*>(JSValue::decode(thisValue));
    if (!response)
        return JSValue::encode(jsUndefined());

    auto& vm = globalObject->vm();
    JSObject* storeObject = JSC::constructEmptyObject(globalObject);
    auto validatedIdent = JSC::Identifier::fromString(vm, "validated"_s);
    storeObject->putDirect(vm, validatedIdent, jsNumber(0), 0);
    return JSValue::encode(storeObject);
}

JSC_DEFINE_CUSTOM_GETTER(jsBakeResponsePrototypeGetOwner, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    return JSValue::encode(jsNull());
}

JSC_DEFINE_CUSTOM_GETTER(jsBakeResponsePrototypeGetDebugInfo, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    return JSValue::encode(jsNull());
}

JSC_DEFINE_CUSTOM_GETTER(jsBakeResponsePrototypeGetDebugStack, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    return JSValue::encode(jsNull());
}

JSC_DEFINE_CUSTOM_GETTER(jsBakeResponsePrototypeGetDebugTask, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    return JSValue::encode(jsNull());
}

JSC_DEFINE_HOST_FUNCTION(jsBakeResponseConstructorRender, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsBakeResponseConstructorRedirect, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(callBakeResponse, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    throwScope.throwException(globalObject, createTypeError(globalObject, "BakeResponse constructor cannot be called as a function"_s));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(constructBakeResponse, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto* zigGlobalObject = defaultGlobalObject(globalObject);

    auto* structure = createJSBakeResponseStructure(vm, zigGlobalObject);

    return JSValue::encode(JSBakeResponse::create(vm, structure, nullptr));
}

void setupJSBakeResponseClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* zigGlobal = reinterpret_cast<Zig::GlobalObject*>(init.global);
    auto* prototypeStructure = JSBakeResponsePrototype::createStructure(init.vm, init.global, zigGlobal->JSResponsePrototype());
    auto* prototype = JSBakeResponsePrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSBakeResponseConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSBakeResponseConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSBakeResponse::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

Structure* createJSBakeResponseStructure(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    return globalObject->JSBakeResponseStructure();
}

} // namespace Bun
