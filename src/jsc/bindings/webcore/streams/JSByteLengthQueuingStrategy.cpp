#include "config.h"
#include "JSByteLengthQueuingStrategy.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMPrototype.h"
#include "JSDOMWrapperCache.h"
#include "JSStreamsRuntime.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_CUSTOM_GETTER(jsByteLengthQueuingStrategyPrototypeGetter_highWaterMark);
static JSC_DECLARE_CUSTOM_GETTER(jsByteLengthQueuingStrategyPrototypeGetter_size);
static JSC_DECLARE_HOST_FUNCTION(jsByteLengthQueuingStrategyPrototype_inspectCustom);

using JSByteLengthQueuingStrategyPrototype = JSDOMPrototype<JSByteLengthQueuingStrategy>;

// JSByteLengthQueuingStrategyConstructor = JSStreamConstructor<JSByteLengthQueuingStrategy>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSByteLengthQueuingStrategyConstructor::construct(JSGlobalObject*, CallFrame*);
template<> void JSByteLengthQueuingStrategyConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSByteLengthQueuingStrategyConstructor::subspaceForImpl(JSC::VM&);

template<> const ClassInfo JSByteLengthQueuingStrategyConstructor::s_info = { "ByteLengthQueuingStrategy"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSByteLengthQueuingStrategyConstructor) };

template<> GCClient::IsoSubspace* JSByteLengthQueuingStrategyConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSByteLengthQueuingStrategyConstructor, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForByteLengthQueuingStrategyConstructor, m_subspaceForByteLengthQueuingStrategyConstructor));
}

template<> void JSByteLengthQueuingStrategyConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    initializeBaseProperties(vm, 1, "ByteLengthQueuingStrategy"_s, JSByteLengthQueuingStrategy::prototype(vm, globalObject));
    m_instanceStructure.set(vm, this, getDOMStructure<JSByteLengthQueuingStrategy>(vm, globalObject));
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
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, JSByteLengthQueuingStrategyPrototype::constructorGetter, 0 } },
    { "highWaterMark"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsByteLengthQueuingStrategyPrototypeGetter_highWaterMark, 0 } },
    { "size"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsByteLengthQueuingStrategyPrototypeGetter_size, 0 } },
};

template<> const ClassInfo JSByteLengthQueuingStrategyPrototype::s_info = { "ByteLengthQueuingStrategy"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSByteLengthQueuingStrategyPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsByteLengthQueuingStrategyPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue().toThis(lexicalGlobalObject, JSC::ECMAMode::strict());
    auto* thisObject = dynamicDowncast<JSByteLengthQueuingStrategy>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    Bun::putDirectNamed(vm, data, "highWaterMark"_s, jsNumber(thisObject->m_highWaterMark));
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "ByteLengthQueuingStrategy"_s, data));
}

template<> void JSByteLengthQueuingStrategyPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSByteLengthQueuingStrategy::info(), JSByteLengthQueuingStrategyPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsByteLengthQueuingStrategyPrototype_inspectCustom);
    Bun::putToStringTagWithoutTransition(vm, this, info());
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
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSByteLengthQueuingStrategy::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSByteLengthQueuingStrategyPrototype::create(vm, globalObject, globalObject.objectPrototype());
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
    return WebCore::subspaceForImpl<JSByteLengthQueuingStrategy, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForByteLengthQueuingStrategy, m_subspaceForByteLengthQueuingStrategy));
}

// Prototype accessors

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
