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

static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetSymbolFor);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetType);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetKey);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetProps);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetStore);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetOwner);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetDebugInfo);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetDebugStack);
static JSC_DECLARE_CUSTOM_GETTER(jsBakeResponsePrototypeGetDebugTask);

extern JSC_CALLCONV void* JSC_HOST_CALL_ATTRIBUTES BakeResponseClass__constructForSSR(JSC::JSGlobalObject*, JSC::CallFrame*, int*, JSC::EncodedJSValue);
extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ResponseClass__constructError(JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ResponseClass__constructJSON(JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES BakeResponseClass__constructRender(JSC::JSGlobalObject*, JSC::CallFrame*);
extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES BakeResponseClass__constructRedirect(JSC::JSGlobalObject*, JSC::CallFrame*);
extern JSC_CALLCONV size_t Response__estimatedSize(void* ptr);

bool isJSXElement(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject)
{

    auto* zigGlobal = static_cast<Zig::GlobalObject*>(globalObject);
    auto& vm = JSC::getVM(globalObject);

    // React does this:
    // export const REACT_LEGACY_ELEMENT_TYPE: symbol = Symbol.for('react.element');
    // export const REACT_ELEMENT_TYPE: symbol = renameElementSymbol
    //   ? Symbol.for('react.transitional.element')
    //   : REACT_LEGACY_ELEMENT_TYPE;

    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    // TODO: primitive values (strings, numbers, booleans, null, undefined) are also valid
    if (value.isObject()) {
        auto scope = DECLARE_THROW_SCOPE(vm);

        JSC::JSObject* object = value.getObject();
        auto typeofProperty = JSC::Identifier::fromString(vm, "$$typeof"_s);
        JSC::JSValue typeofValue = object->get(globalObject, typeofProperty);
        RETURN_IF_EXCEPTION(scope, false);

        if (typeofValue.isSymbol() && (typeofValue == zigGlobal->bakeAdditions().reactLegacyElementSymbol(zigGlobal) || typeofValue == zigGlobal->bakeAdditions().reactElementSymbol(zigGlobal))) {
            return true;
        }
    }

    return false;
}

extern "C" bool JSC__JSValue__isJSXElement(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject)
{
    return isJSXElement(JSValue0, globalObject);
}

extern JSC_CALLCONV JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES BakeResponse__createForSSR(Zig::GlobalObject* globalObject, void* ptr, uint8_t kind)
{
    Structure* structure = globalObject->bakeAdditions().JSBakeResponseStructure(globalObject);

    JSBakeResponse* instance = JSBakeResponse::create(globalObject->vm(), globalObject, structure, ptr);

    if (kind == JSBakeResponseKind::Render) {
        instance->kind(JSBakeResponseKind::Render);
    } else if (kind == JSBakeResponseKind::Redirect) {
        instance->kind(JSBakeResponseKind::Redirect);
    } else {
        // Should not be called with JSBakeResponseKind::Regular or anything
        // else
        UNREACHABLE();
    }

    instance->setToThrow(globalObject, globalObject->vm());

    return JSValue::encode(instance);
}

static const HashTableValue JSBakeResponseConstructorTableValues[] = {
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, ResponseClass__constructError, 0 } },
    { "json"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, ResponseClass__constructJSON, 0 } },

    { "redirect"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, BakeResponseClass__constructRedirect, 0 } },
    { "render"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, BakeResponseClass__constructRender, 0 } }

};

JSBakeResponse* JSBakeResponse::create(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::Structure* structure, void* ctx)
{
    JSBakeResponse* ptr = new (NotNull, JSC::allocateCell<JSBakeResponse>(vm)) JSBakeResponse(vm, structure, ctx);
    ptr->finishCreation(vm);

    auto builtinNames = WebCore::builtinNames(vm);

    // $$typeof = Symbol.for("react.transitional.element")
    ptr->putDirect(vm, builtinNames.$$typeofPublicName(), JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey("react.transitional.element"_s)), 0);
    // type = false
    ptr->putDirect(vm, builtinNames.typePublicName(), JSC::jsNull(), 0);
    // key = null
    ptr->putDirect(vm, builtinNames.keyPublicName(), JSC::jsNull(), 0);
    // props = {}
    ptr->putDirect(vm, builtinNames.propsPublicName(), JSC::constructEmptyObject(globalObject), 0);

    // _store = { _validated: 0 }
    JSObject* storeObject = JSC::constructEmptyObject(globalObject);
    auto validatedIdent = JSC::Identifier::fromString(vm, "validated"_s);
    storeObject->putDirect(vm, builtinNames.validatedPublicName(), jsNumber(0), 0);
    ptr->putDirect(vm, builtinNames._storePublicName(), storeObject, 0);

    // _owner = null
    ptr->putDirect(vm, builtinNames._ownerPublicName(), JSC::jsNull(), 0);
    // _debugInfo = null
    ptr->putDirect(vm, builtinNames._debugInfoPublicName(), JSC::jsNull(), 0);
    // _debugStack = null
    ptr->putDirect(vm, builtinNames._debugStackPublicName(), JSC::jsNull(), 0);
    // _debugTask = null
    ptr->putDirect(vm, builtinNames._debugTaskPublicName(), JSC::jsNull(), 0);

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

    DECLARE_INFO;
    // DECLARE_EXPORT_INFO;

    // Must be defined for each specialization class.
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
    {
        Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
        JSC::VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSObject* newTarget = asObject(callFrame->newTarget());
        auto* constructor = globalObject->bakeAdditions().JSBakeResponseConstructor(globalObject);
        Structure* structure = globalObject->bakeAdditions().JSBakeResponseStructure(globalObject);
        if (constructor != newTarget) [[unlikely]] {
            auto* functionGlobalObject = defaultGlobalObject(
                // ShadowRealm functions belong to a different global object.
                getFunctionRealm(globalObject, newTarget));
            RETURN_IF_EXCEPTION(scope, {});
            structure = InternalFunction::createSubclassStructure(globalObject, newTarget, functionGlobalObject->bakeAdditions().JSBakeResponseStructure(functionGlobalObject));
            RETURN_IF_EXCEPTION(scope, {});
        }

        JSBakeResponse* instance = JSBakeResponse::create(vm, globalObject, structure, nullptr);

        int arg_was_jsx = 0;
        void* ptr = BakeResponseClass__constructForSSR(globalObject, callFrame, &arg_was_jsx, JSValue::encode(instance));
        if (scope.exception()) [[unlikely]] {
            ASSERT_WITH_MESSAGE(!ptr, "Memory leak detected: new Response() allocated memory without checking for exceptions.");
            return JSValue::encode(JSC::jsUndefined());
        }

        instance->m_ctx = ptr;

        if (arg_was_jsx == 1 && callFrame->argumentCount() > 0) {
            JSValue arg = callFrame->argument(0);
            JSValue responseOptions = callFrame->argumentCount() > 1 ? callFrame->argument(1) : JSC::jsUndefined();
            instance->wrapInnerComponent(globalObject, vm, arg, responseOptions);
        }

        auto size = Response__estimatedSize(ptr);
        vm.heap.reportExtraMemoryAllocated(instance, size);

        auto value = JSValue::encode(instance);
        RELEASE_AND_RETURN(scope, value);
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
    {
        Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
        JSC::VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        Structure* structure = globalObject->bakeAdditions().JSBakeResponseStructure(globalObject);
        JSBakeResponse* instance = JSBakeResponse::create(vm, globalObject, structure, nullptr);

        void* ptr = BakeResponseClass__constructForSSR(globalObject, callFrame, nullptr, JSValue::encode(instance));
        if (scope.exception()) [[unlikely]] {
            ASSERT_WITH_MESSAGE(!ptr, "Memory leak detected: new Response() allocated memory without checking for exceptions.");
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
        Base::finishCreation(vm, 0, "Response"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
        reifyStaticProperties(vm, info(), JSBakeResponseConstructorTableValues, *this);
    }
};

const JSC::ClassInfo JSBakeResponse::s_info = { "Response"_s, &JSResponse::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBakeResponse) };
const JSC::ClassInfo JSBakeResponseConstructor::s_info = { ""_s, &JSC::InternalFunction::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBakeResponseConstructor) };

Structure* createJSBakeResponseStructure(JSC::VM& vm, Zig::GlobalObject* globalObject, JSObject* prototype)
{

    auto structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, 0), JSBakeResponse::info(), NonArray, 0);

    // Unfortunately we cannot use structure->addPropertyTransition as it does
    // not with with JSC::JSNonFinalObject

    return structure;
}

void setupJSBakeResponseClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* zigGlobal = static_cast<Zig::GlobalObject*>(init.global);
    auto* prototype = JSC::constructEmptyObject(zigGlobal, zigGlobal->JSResponsePrototype());

    auto* constructorStructure = JSBakeResponseConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSBakeResponseConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = createJSBakeResponseStructure(init.vm, zigGlobal, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
