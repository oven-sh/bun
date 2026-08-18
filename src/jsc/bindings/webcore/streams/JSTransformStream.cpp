#include "config.h"
#include "JSTransformStream.h"

#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSReadableStream.h"
#include "JSTransformStreamDefaultController.h"
#include "JSWritableStream.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_CUSTOM_GETTER(jsTransformStreamPrototypeGetter_readable);
static JSC_DECLARE_CUSTOM_GETTER(jsTransformStreamPrototypeGetter_writable);
static JSC_DECLARE_CUSTOM_GETTER(jsTransformStreamPrototypeGetter_constructor);
static JSC_DECLARE_HOST_FUNCTION(jsTransformStreamPrototype_inspectCustom);

class JSTransformStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSTransformStreamPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSTransformStreamPrototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSTransformStreamPrototype))) JSTransformStreamPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTransformStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSTransformStreamPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTransformStreamPrototype, JSTransformStreamPrototype::Base);

// JSTransformStreamConstructor = JSStreamConstructor<JSTransformStream>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSTransformStreamConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSTransformStreamConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSTransformStreamConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSTransformStreamConstructor::subspaceForImpl(JSC::VM&);
template<> void JSTransformStreamConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSTransformStreamConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSTransformStreamConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSTransformStreamConstructor::s_info = { "TransformStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamConstructor) };

template<> JSValue JSTransformStreamConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSTransformStreamConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSTransformStreamConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSTransformStreamConstructor);

template<> GCClient::IsoSubspace* JSTransformStreamConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSTransformStreamConstructor, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForTransformStreamConstructor, m_subspaceForTransformStreamConstructor));
}

template<> void JSTransformStreamConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    initializeBaseProperties(vm, 0, "TransformStream"_s, JSTransformStream::prototype(vm, globalObject));
    m_instanceStructure.set(vm, this, getDOMStructure<JSTransformStream>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSTransformStreamConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSTransformStreamConstructor>(callFrame->jsCallee());

    // `optional object transformer`: missing => null; a present non-object is a TypeError.
    JSValue transformer = callFrame->argument(0);
    if (transformer.isUndefined())
        transformer = jsNull();
    else if (!transformer.isObject())
        return throwVMTypeError(lexicalGlobalObject, scope, "TransformStream constructor takes an object as first argument"_s);

    // The two QueuingStrategy ARGUMENTS convert (left to right) before the constructor steps.
    auto writableStrategy = convertQueuingStrategyDict(lexicalGlobalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    auto readableStrategy = convertQueuingStrategyDict(lexicalGlobalObject, callFrame->argument(2));
    RETURN_IF_EXCEPTION(scope, {});

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    auto* stream = JSTransformStream::create(vm, structure);

    auto transformerDict = convertTransformerDict(lexicalGlobalObject, transformer);
    RETURN_IF_EXCEPTION(scope, {});
    if (transformerDict.hasReadableType)
        return throwVMRangeError(lexicalGlobalObject, scope, "The transformer's 'readableType' property is reserved and must not be present"_s);
    if (transformerDict.hasWritableType)
        return throwVMRangeError(lexicalGlobalObject, scope, "The transformer's 'writableType' property is reserved and must not be present"_s);

    double readableHighWaterMark = extractHighWaterMark(lexicalGlobalObject, readableStrategy, 0);
    RETURN_IF_EXCEPTION(scope, {});
    auto* readableSizeAlgorithm = extractSizeAlgorithm(readableStrategy);
    double writableHighWaterMark = extractHighWaterMark(lexicalGlobalObject, writableStrategy, 1);
    RETURN_IF_EXCEPTION(scope, {});
    auto* writableSizeAlgorithm = extractSizeAlgorithm(writableStrategy);

    auto* startPromise = JSPromise::create(vm, lexicalGlobalObject->promiseStructure());
    initializeTransformStream(lexicalGlobalObject, stream, startPromise, writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm);
    RETURN_IF_EXCEPTION(scope, {});
    setUpTransformStreamDefaultControllerFromTransformer(lexicalGlobalObject, stream, transformer, transformerDict);
    RETURN_IF_EXCEPTION(scope, {});

    // A sync throw from the user `start` propagates out of the constructor (startPromise is
    // never resolved); otherwise startPromise is resolved with start's return value.
    JSValue startResult = jsUndefined();
    if (transformerDict.start) {
        auto callData = JSC::getCallData(transformerDict.start);
        ASSERT(callData.type != CallData::Type::None);
        MarkedArgumentBuffer args;
        args.append(stream->m_controller.get());
        ASSERT(!args.hasOverflowed());
        startResult = JSC::call(lexicalGlobalObject, transformerDict.start, callData, transformer, args);
        RETURN_IF_EXCEPTION(scope, {});
    }
    resolvePromise(lexicalGlobalObject, startPromise, startResult);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stream);
}
JSC_ANNOTATE_HOST_FUNCTION(JSTransformStreamConstructorConstruct, JSTransformStreamConstructor::construct);

// JSTransformStreamPrototype

static const HashTableValue JSTransformStreamPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsTransformStreamPrototypeGetter_constructor, 0 } },
    { "readable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTransformStreamPrototypeGetter_readable, 0 } },
    { "writable"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTransformStreamPrototypeGetter_writable, 0 } },
};

const ClassInfo JSTransformStreamPrototype::s_info = { "TransformStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue().toThis(lexicalGlobalObject, JSC::ECMAMode::strict());
    auto* thisObject = dynamicDowncast<JSTransformStream>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    Bun::putDirectNamed(vm, data, "readable"_s, thisObject->m_readable.get() ? JSValue(thisObject->m_readable.get()) : jsUndefined());
    Bun::putDirectNamed(vm, data, "writable"_s, thisObject->m_writable.get() ? JSValue(thisObject->m_writable.get()) : jsUndefined());
    Bun::putDirectNamed(vm, data, "backpressure"_s, jsBoolean(thisObject->m_backpressure));
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "TransformStream"_s, data));
}

void JSTransformStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSTransformStream::info(), JSTransformStreamPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsTransformStreamPrototype_inspectCustom);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

// JSTransformStream

const ClassInfo JSTransformStream::s_info = { "TransformStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStream) };

JSTransformStream::JSTransformStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSTransformStream::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSTransformStream* JSTransformStream::create(VM& vm, Structure* structure)
{
    auto* stream = new (NotNull, allocateCell<JSTransformStream>(vm)) JSTransformStream(vm, structure);
    stream->finishCreation(vm);
    return stream;
}

Structure* JSTransformStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSTransformStream::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSTransformStreamPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSTransformStreamPrototype::create(vm, &globalObject, structure);
}

JSObject* JSTransformStream::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSTransformStream>(vm, globalObject);
}

JSValue JSTransformStream::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSTransformStreamConstructor, DOMConstructorID::TransformStream>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSTransformStream::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSTransformStream, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForTransformStream, m_subspaceForTransformStream));
}

DEFINE_VISIT_CHILDREN(JSTransformStream);

template<typename Visitor>
void JSTransformStream::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSTransformStream>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_readable);
    visitor.appendHidden(thisObject->m_writable);
    visitor.appendHidden(thisObject->m_controller);
    visitor.appendHidden(thisObject->m_backpressureChangePromise);
    visitor.appendHidden(thisObject->m_pendingWriteChunk);
    visitor.appendHidden(thisObject->m_nativeSinkCell);
    visitor.appendHidden(thisObject->m_nativeSinkReadyPromise);
    visitor.appendHidden(thisObject->m_codecPromise);
}

void JSTransformStream::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSTransformStream>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_readable, "readable"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_writable, "writable"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_controller, "controller"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_backpressureChangePromise, "backpressureChangePromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_pendingWriteChunk, "pendingWriteChunk"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_nativeSinkCell, "nativeSinkCell"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_nativeSinkReadyPromise, "nativeSinkReadyPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_codecPromise, "codecPromise"_s);
}

// Prototype host functions

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSTransformStreamPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSTransformStream::getConstructor(vm, prototype->globalObject()));
}

// Web IDL brand check: exact classInfo match, not a chain walk, so the native
// C++ subclasses (JSCompressionStream etc.) are rejected like Chrome/Node do.
static ALWAYS_INLINE JSTransformStream* toTransformStreamExact(JSValue thisValue)
{
    if (!thisValue.isCell()) [[unlikely]]
        return nullptr;
    auto* cell = thisValue.asCell();
    if (cell->classInfo() != JSTransformStream::info()) [[unlikely]]
        return nullptr;
    return static_cast<JSTransformStream*>(cell);
}

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamPrototypeGetter_readable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = toTransformStreamExact(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TransformStream"_s);
    return JSValue::encode(stream->m_readable.get());
}

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamPrototypeGetter_writable, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = toTransformStreamExact(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "TransformStream"_s);
    return JSValue::encode(stream->m_writable.get());
}

} // namespace WebCore
