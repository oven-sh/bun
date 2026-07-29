#include "config.h"
#include "JSCountQueuingStrategy.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSStreamsRuntime.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_CUSTOM_GETTER(jsCountQueuingStrategyPrototypeGetter_constructor);
static JSC_DECLARE_CUSTOM_GETTER(jsCountQueuingStrategyPrototypeGetter_highWaterMark);
static JSC_DECLARE_CUSTOM_GETTER(jsCountQueuingStrategyPrototypeGetter_size);
static JSC_DECLARE_HOST_FUNCTION(jsCountQueuingStrategyPrototype_inspectCustom);

class JSCountQueuingStrategyPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSCountQueuingStrategyPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSCountQueuingStrategyPrototype* ptr = new (NotNull, JSC::allocateCell<JSCountQueuingStrategyPrototype>(vm)) JSCountQueuingStrategyPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSCountQueuingStrategyPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSCountQueuingStrategyPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSCountQueuingStrategyPrototype, JSCountQueuingStrategyPrototype::Base);

// JSCountQueuingStrategyConstructor = JSStreamConstructor<JSCountQueuingStrategy>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSCountQueuingStrategyConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSCountQueuingStrategyConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSCountQueuingStrategyConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSCountQueuingStrategyConstructor::subspaceForImpl(JSC::VM&);
template<> void JSCountQueuingStrategyConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSCountQueuingStrategyConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSCountQueuingStrategyConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSCountQueuingStrategyConstructor::s_info = { "CountQueuingStrategy"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCountQueuingStrategyConstructor) };

template<> JSValue JSCountQueuingStrategyConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSCountQueuingStrategyConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSCountQueuingStrategyConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSCountQueuingStrategyConstructor);

template<> GCClient::IsoSubspace* JSCountQueuingStrategyConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSCountQueuingStrategyConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForCountQueuingStrategyConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCountQueuingStrategyConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForCountQueuingStrategyConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForCountQueuingStrategyConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSCountQueuingStrategyConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "CountQueuingStrategy"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSCountQueuingStrategy::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    m_instanceStructure.set(vm, this, getDOMStructure<JSCountQueuingStrategy>(vm, globalObject));
}

// `QueuingStrategyInit init` — `highWaterMark` is a required `unrestricted double` member.
static double convertQueuingStrategyInit(JSC::VM& vm, JSGlobalObject* globalObject, JSValue init)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!init.isObject()) {
        if (!init.isUndefinedOrNull()) {
            throwTypeError(globalObject, scope, "The QueuingStrategyInit argument must be an object"_s);
            return 0;
        }
        throwTypeError(globalObject, scope, "QueuingStrategyInit requires a 'highWaterMark' member"_s);
        return 0;
    }
    JSValue highWaterMark = asObject(init)->get(globalObject, builtinNames(vm).highWaterMarkPublicName());
    RETURN_IF_EXCEPTION(scope, 0);
    if (highWaterMark.isUndefined()) {
        throwTypeError(globalObject, scope, "QueuingStrategyInit requires a 'highWaterMark' member"_s);
        return 0;
    }
    RELEASE_AND_RETURN(scope, highWaterMark.toNumber(globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSCountQueuingStrategyConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSCountQueuingStrategyConstructor>(callFrame->jsCallee());

    if (callFrame->argumentCount() < 1)
        return throwVMError(lexicalGlobalObject, scope, createNotEnoughArgumentsError(lexicalGlobalObject));

    double highWaterMark = convertQueuingStrategyInit(vm, lexicalGlobalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(scope, {});

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(JSCountQueuingStrategy::create(vm, structure, highWaterMark));
}
JSC_ANNOTATE_HOST_FUNCTION(JSCountQueuingStrategyConstructorConstruct, JSCountQueuingStrategyConstructor::construct);

// JSCountQueuingStrategyPrototype

static const HashTableValue JSCountQueuingStrategyPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsCountQueuingStrategyPrototypeGetter_constructor, 0 } },
    { "highWaterMark"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCountQueuingStrategyPrototypeGetter_highWaterMark, 0 } },
    { "size"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCountQueuingStrategyPrototypeGetter_size, 0 } },
};

const ClassInfo JSCountQueuingStrategyPrototype::s_info = { "CountQueuingStrategy"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCountQueuingStrategyPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsCountQueuingStrategyPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSCountQueuingStrategy>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "highWaterMark"_s), jsNumber(thisObject->m_highWaterMark), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "CountQueuingStrategy"_s, data));
}

void JSCountQueuingStrategyPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSCountQueuingStrategy::info(), JSCountQueuingStrategyPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsCountQueuingStrategyPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSCountQueuingStrategy

const ClassInfo JSCountQueuingStrategy::s_info = { "CountQueuingStrategy"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCountQueuingStrategy) };

JSCountQueuingStrategy::JSCountQueuingStrategy(VM& vm, Structure* structure, double highWaterMark)
    : Base(vm, structure)
    , m_highWaterMark(highWaterMark)
{
}

void JSCountQueuingStrategy::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSCountQueuingStrategy* JSCountQueuingStrategy::create(VM& vm, Structure* structure, double highWaterMark)
{
    auto* strategy = new (NotNull, allocateCell<JSCountQueuingStrategy>(vm)) JSCountQueuingStrategy(vm, structure, highWaterMark);
    strategy->finishCreation(vm);
    return strategy;
}

Structure* JSCountQueuingStrategy::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSCountQueuingStrategy::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSCountQueuingStrategyPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSCountQueuingStrategyPrototype::create(vm, &globalObject, structure);
}

JSObject* JSCountQueuingStrategy::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSCountQueuingStrategy>(vm, globalObject);
}

JSValue JSCountQueuingStrategy::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSCountQueuingStrategyConstructor, DOMConstructorID::CountQueuingStrategy>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSCountQueuingStrategy::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSCountQueuingStrategy, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForCountQueuingStrategy.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCountQueuingStrategy = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForCountQueuingStrategy.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForCountQueuingStrategy = std::forward<decltype(space)>(space); });
}

// Prototype accessors

JSC_DEFINE_CUSTOM_GETTER(jsCountQueuingStrategyPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSCountQueuingStrategyPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSCountQueuingStrategy::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsCountQueuingStrategyPrototypeGetter_highWaterMark, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* strategy = dynamicDowncast<JSCountQueuingStrategy>(JSValue::decode(thisValue));
    if (!strategy) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "CountQueuingStrategy"_s);
    return JSValue::encode(jsDoubleNumber(strategy->m_highWaterMark));
}

JSC_DEFINE_CUSTOM_GETTER(jsCountQueuingStrategyPrototypeGetter_size, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* strategy = dynamicDowncast<JSCountQueuingStrategy>(JSValue::decode(thisValue));
    if (!strategy) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "CountQueuingStrategy"_s);
    // The same per-realm function object for every instance of this's realm.
    auto* globalObject = strategy->globalObject();
    return JSValue::encode(JSStreamsRuntime::from(globalObject)->countQueuingStrategySizeFunction(defaultGlobalObject(globalObject)));
}

} // namespace WebCore
