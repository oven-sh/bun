#include "config.h"
#include "JSByteLengthQueuingStrategy.h"

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

static JSC_DECLARE_CUSTOM_GETTER(jsByteLengthQueuingStrategyPrototypeGetter_constructor);
static JSC_DECLARE_CUSTOM_GETTER(jsByteLengthQueuingStrategyPrototypeGetter_highWaterMark);
static JSC_DECLARE_CUSTOM_GETTER(jsByteLengthQueuingStrategyPrototypeGetter_size);
static JSC_DECLARE_HOST_FUNCTION(jsByteLengthQueuingStrategyPrototype_inspectCustom);

class JSByteLengthQueuingStrategyPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSByteLengthQueuingStrategyPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSByteLengthQueuingStrategyPrototype* ptr = new (NotNull, JSC::allocateCell<JSByteLengthQueuingStrategyPrototype>(vm)) JSByteLengthQueuingStrategyPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSByteLengthQueuingStrategyPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSByteLengthQueuingStrategyPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSByteLengthQueuingStrategyPrototype, JSByteLengthQueuingStrategyPrototype::Base);

// JSByteLengthQueuingStrategyConstructor = JSStreamConstructor<JSByteLengthQueuingStrategy>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSByteLengthQueuingStrategyConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSByteLengthQueuingStrategyConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSByteLengthQueuingStrategyConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSByteLengthQueuingStrategyConstructor::subspaceForImpl(JSC::VM&);
template<> void JSByteLengthQueuingStrategyConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSByteLengthQueuingStrategyConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSByteLengthQueuingStrategyConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSByteLengthQueuingStrategyConstructor::s_info = { "ByteLengthQueuingStrategy"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSByteLengthQueuingStrategyConstructor) };

template<> JSValue JSByteLengthQueuingStrategyConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSByteLengthQueuingStrategyConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSByteLengthQueuingStrategyConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSByteLengthQueuingStrategyConstructor);

template<> GCClient::IsoSubspace* JSByteLengthQueuingStrategyConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSByteLengthQueuingStrategyConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForByteLengthQueuingStrategyConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForByteLengthQueuingStrategyConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForByteLengthQueuingStrategyConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForByteLengthQueuingStrategyConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSByteLengthQueuingStrategyConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "ByteLengthQueuingStrategy"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSByteLengthQueuingStrategy::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    m_instanceStructure.set(vm, this, getDOMStructure<JSByteLengthQueuingStrategy>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSByteLengthQueuingStrategyConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSByteLengthQueuingStrategyConstructor>(callFrame->jsCallee());

    if (callFrame->argumentCount() < 1)
        return throwVMError(lexicalGlobalObject, scope, createNotEnoughArgumentsError(lexicalGlobalObject));

    double highWaterMark = convertQueuingStrategyInit(vm, lexicalGlobalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(scope, {});

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(JSByteLengthQueuingStrategy::create(vm, structure, highWaterMark));
}
JSC_ANNOTATE_HOST_FUNCTION(JSByteLengthQueuingStrategyConstructorConstruct, JSByteLengthQueuingStrategyConstructor::construct);

// JSByteLengthQueuingStrategyPrototype

static const HashTableValue JSByteLengthQueuingStrategyPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsByteLengthQueuingStrategyPrototypeGetter_constructor, 0 } },
    { "highWaterMark"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsByteLengthQueuingStrategyPrototypeGetter_highWaterMark, 0 } },
    { "size"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsByteLengthQueuingStrategyPrototypeGetter_size, 0 } },
};

const ClassInfo JSByteLengthQueuingStrategyPrototype::s_info = { "ByteLengthQueuingStrategy"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSByteLengthQueuingStrategyPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsByteLengthQueuingStrategyPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSByteLengthQueuingStrategy>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "highWaterMark"_s), jsNumber(thisObject->m_highWaterMark), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "ByteLengthQueuingStrategy"_s, data));
}

void JSByteLengthQueuingStrategyPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSByteLengthQueuingStrategy::info(), JSByteLengthQueuingStrategyPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsByteLengthQueuingStrategyPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSByteLengthQueuingStrategy

const ClassInfo JSByteLengthQueuingStrategy::s_info = { "ByteLengthQueuingStrategy"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSByteLengthQueuingStrategy) };

JSByteLengthQueuingStrategy::JSByteLengthQueuingStrategy(VM& vm, Structure* structure, double highWaterMark)
    : Base(vm, structure)
    , m_highWaterMark(highWaterMark)
{
}

void JSByteLengthQueuingStrategy::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSByteLengthQueuingStrategy* JSByteLengthQueuingStrategy::create(VM& vm, Structure* structure, double highWaterMark)
{
    auto* strategy = new (NotNull, allocateCell<JSByteLengthQueuingStrategy>(vm)) JSByteLengthQueuingStrategy(vm, structure, highWaterMark);
    strategy->finishCreation(vm);
    return strategy;
}

Structure* JSByteLengthQueuingStrategy::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSByteLengthQueuingStrategy::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSByteLengthQueuingStrategyPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSByteLengthQueuingStrategyPrototype::create(vm, &globalObject, structure);
}

JSObject* JSByteLengthQueuingStrategy::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSByteLengthQueuingStrategy>(vm, globalObject);
}

JSValue JSByteLengthQueuingStrategy::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSByteLengthQueuingStrategyConstructor, DOMConstructorID::ByteLengthQueuingStrategy>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSByteLengthQueuingStrategy::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSByteLengthQueuingStrategy, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForByteLengthQueuingStrategy.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForByteLengthQueuingStrategy = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForByteLengthQueuingStrategy.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForByteLengthQueuingStrategy = std::forward<decltype(space)>(space); });
}

// Prototype accessors

JSC_DEFINE_CUSTOM_GETTER(jsByteLengthQueuingStrategyPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSByteLengthQueuingStrategyPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSByteLengthQueuingStrategy::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsByteLengthQueuingStrategyPrototypeGetter_highWaterMark, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* strategy = dynamicDowncast<JSByteLengthQueuingStrategy>(JSValue::decode(thisValue));
    if (!strategy) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ByteLengthQueuingStrategy"_s);
    return JSValue::encode(jsDoubleNumber(strategy->m_highWaterMark));
}

JSC_DEFINE_CUSTOM_GETTER(jsByteLengthQueuingStrategyPrototypeGetter_size, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* strategy = dynamicDowncast<JSByteLengthQueuingStrategy>(JSValue::decode(thisValue));
    if (!strategy) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ByteLengthQueuingStrategy"_s);
    // The same per-realm function object for every instance of this's realm.
    auto* globalObject = strategy->globalObject();
    return JSValue::encode(JSStreamsRuntime::from(globalObject)->byteLengthQueuingStrategySizeFunction(defaultGlobalObject(globalObject)));
}

} // namespace WebCore
