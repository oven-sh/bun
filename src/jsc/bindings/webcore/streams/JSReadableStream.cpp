#include "config.h"
#include "JSReadableStream.h"

#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSAbortSignal.h"
#include "JSDOMBinding.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSReadableStreamAsyncIterator.h"
#include "JSReadableStreamBYOBReader.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSWritableStream.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/DOMAttributeGetterSetter.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_cancel);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_getReader);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_pipeThrough);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_pipeTo);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_tee);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_values);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_text);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_json);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_bytes);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_blob);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamStaticFunction_from);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamPrototypeGetter_locked);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamPrototypeGetter_constructor);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamPrototype_nativePtrGetter);
static JSC_DECLARE_CUSTOM_SETTER(jsReadableStreamPrototype_nativePtrSetter);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamPrototype_nativeTypeGetter);
static JSC_DECLARE_CUSTOM_SETTER(jsReadableStreamPrototype_nativeTypeSetter);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamPrototype_disturbedGetter);
static JSC_DECLARE_CUSTOM_SETTER(jsReadableStreamPrototype_disturbedSetter);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPrototype_inspectCustom);

class JSReadableStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSReadableStreamPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSReadableStreamPrototype* ptr = new (NotNull, JSC::allocateCell<JSReadableStreamPrototype>(vm)) JSReadableStreamPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSReadableStreamPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamPrototype, JSReadableStreamPrototype::Base);

// WebIDL dictionary conversions. Each [[Get]] is observable and happens in alphabetical
// member order; a present, non-callable callback member throws during conversion.

struct ConvertedQueuingStrategy {
    QueuingStrategyDict dict {};
    // Bun deviation from WebIDL: `typeof rawHighWaterMark === "number"` before the ToNumber.
    bool rawHighWaterMarkIsNumber { false };
};

static ConvertedQueuingStrategy convertQueuingStrategy(JSC::VM& vm, JSGlobalObject* globalObject, JSValue strategy)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    ConvertedQueuingStrategy result;
    if (strategy.isUndefinedOrNull())
        return result;
    if (!strategy.isObject()) {
        throwTypeError(globalObject, scope, "ReadableStream constructor takes an object as second argument, if any"_s);
        return result;
    }
    auto* strategyObject = asObject(strategy);
    auto& names = builtinNames(vm);

    JSValue highWaterMark = strategyObject->get(globalObject, names.highWaterMarkPublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!highWaterMark.isUndefined()) {
        result.rawHighWaterMarkIsNumber = highWaterMark.isNumber();
        double value = highWaterMark.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, result);
        result.dict.highWaterMark = value;
    }

    JSValue size = strategyObject->get(globalObject, names.sizePublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!size.isUndefined()) {
        if (!size.isCallable()) {
            throwTypeError(globalObject, scope, "The queuing strategy's 'size' property must be a function"_s);
            return result;
        }
        result.dict.size = size;
    }
    return result;
}

// Bun extends the WebIDL `ReadableStreamType` enum with "direct".
enum class BunUnderlyingSourceType : uint8_t { None,
    Bytes,
    Direct };

struct ConvertedUnderlyingSource {
    UnderlyingSourceDict dict {};
    BunUnderlyingSourceType type { BunUnderlyingSourceType::None };
};

static ConvertedUnderlyingSource convertUnderlyingSource(JSC::VM& vm, JSGlobalObject* globalObject, JSValue underlyingSource)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    ConvertedUnderlyingSource result;
    if (underlyingSource.isUndefinedOrNull())
        return result;
    auto* sourceObject = asObject(underlyingSource);
    auto& names = builtinNames(vm);

    JSValue autoAllocateChunkSize = sourceObject->get(globalObject, names.autoAllocateChunkSizePublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!autoAllocateChunkSize.isUndefined()) {
        uint64_t value = convertToIntegerEnforceRange<uint64_t>(*globalObject, autoAllocateChunkSize);
        RETURN_IF_EXCEPTION(scope, result);
        result.dict.autoAllocateChunkSize = value;
    }

    JSValue cancel = sourceObject->get(globalObject, names.cancelPublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!cancel.isUndefined()) {
        if (!cancel.isCallable()) {
            throwTypeError(globalObject, scope, "The underlying source's 'cancel' property must be a function"_s);
            return result;
        }
        result.dict.cancel = cancel;
    }

    JSValue pull = sourceObject->get(globalObject, names.pullPublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!pull.isUndefined()) {
        if (!pull.isCallable()) {
            throwTypeError(globalObject, scope, "The underlying source's 'pull' property must be a function"_s);
            return result;
        }
        result.dict.pull = pull;
    }

    JSValue start = sourceObject->get(globalObject, names.startPublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!start.isUndefined()) {
        if (!start.isCallable()) {
            throwTypeError(globalObject, scope, "The underlying source's 'start' property must be a function"_s);
            return result;
        }
        result.dict.start = start;
    }

    JSValue type = sourceObject->get(globalObject, names.typePublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!type.isUndefined()) {
        auto typeString = type.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, result);
        if (typeString == "bytes"_s) {
            result.type = BunUnderlyingSourceType::Bytes;
            result.dict.type = ReadableStreamType::Bytes;
        } else if (typeString == "direct"_s)
            result.type = BunUnderlyingSourceType::Direct;
        else
            throwTypeError(globalObject, scope, makeString("'"_s, typeString, "' is not a valid underlying source 'type'; expected \"bytes\", \"direct\", or undefined"_s));
    }
    return result;
}

struct ConvertedStreamPipeOptions {
    bool preventAbort { false };
    bool preventCancel { false };
    bool preventClose { false };
    JSC::JSObject* signal { nullptr };
};

static ConvertedStreamPipeOptions convertStreamPipeOptions(JSC::VM& vm, JSGlobalObject* globalObject, JSValue options)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    ConvertedStreamPipeOptions result;
    if (options.isUndefinedOrNull())
        return result;
    if (!options.isObject()) {
        throwTypeError(globalObject, scope, "The pipe options must be an object"_s);
        return result;
    }
    auto* optionsObject = asObject(options);

    JSValue preventAbort = optionsObject->get(globalObject, builtinNames(vm).preventAbortPublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!preventAbort.isUndefined())
        result.preventAbort = preventAbort.toBoolean(globalObject);

    JSValue preventCancel = optionsObject->get(globalObject, builtinNames(vm).preventCancelPublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!preventCancel.isUndefined())
        result.preventCancel = preventCancel.toBoolean(globalObject);

    JSValue preventClose = optionsObject->get(globalObject, builtinNames(vm).preventClosePublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!preventClose.isUndefined())
        result.preventClose = preventClose.toBoolean(globalObject);

    JSValue signal = optionsObject->get(globalObject, builtinNames(vm).signalPublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!signal.isUndefined()) {
        auto* abortSignal = dynamicDowncast<JSAbortSignal>(signal);
        if (!abortSignal) {
            throwTypeError(globalObject, scope, "The pipe options' 'signal' property must be an AbortSignal"_s);
            return result;
        }
        result.signal = abortSignal;
    }
    return result;
}

// JSReadableStreamConstructor = JSStreamConstructor<JSReadableStream>.
// Every member specialization is declared before the ClassInfo (whose method table
// instantiates them).

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSReadableStreamConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSReadableStreamConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSReadableStreamConstructor::subspaceForImpl(JSC::VM&);
template<> void JSReadableStreamConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSReadableStreamConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSReadableStreamConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSReadableStreamConstructor::s_info = { "ReadableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamConstructor) };

template<> JSValue JSReadableStreamConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSReadableStreamConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSReadableStreamConstructor);

template<> GCClient::IsoSubspace* JSReadableStreamConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableStreamConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableStreamConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSReadableStreamConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "ReadableStream"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSReadableStream::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);

    auto* fromFunction = JSFunction::create(vm, &globalObject, 1, "from"_s, jsReadableStreamStaticFunction_from, ImplementationVisibility::Public, NoIntrinsic);
    putDirect(vm, vm.propertyNames->from, fromFunction, 0);

    m_instanceStructure.set(vm, this, getDOMStructure<JSReadableStream>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSReadableStreamConstructor>(callFrame->jsCallee());

    // `optional object underlyingSource`: missing => null; a present non-object is a TypeError.
    JSValue underlyingSource = callFrame->argument(0);
    if (underlyingSource.isUndefined())
        underlyingSource = jsNull();
    else if (!underlyingSource.isObject())
        return throwVMTypeError(lexicalGlobalObject, scope, "ReadableStream constructor takes an object as first argument"_s);

    // WebIDL converts the strategy ARGUMENT before the constructor steps convert the source.
    auto strategy = convertQueuingStrategy(vm, lexicalGlobalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    auto* stream = JSReadableStream::create(vm, structure);

    auto source = convertUnderlyingSource(vm, lexicalGlobalObject, underlyingSource);
    RETURN_IF_EXCEPTION(scope, {});

    initializeReadableStream(stream);
    stream->m_bunHighWaterMarkIsNumber = strategy.rawHighWaterMarkIsNumber;
    if (strategy.dict.highWaterMark)
        stream->m_bunHighWaterMark = *strategy.dict.highWaterMark;

    switch (source.type) {
    case BunUnderlyingSourceType::Direct: {
        // A direct stream has no controller yet; materializeIfNeeded() builds it on first use.
        stream->m_bunMode = BunStreamMode::DirectPending;
        stream->m_directUnderlyingSource.set(vm, stream, asObject(underlyingSource));
        break;
    }
    case BunUnderlyingSourceType::Bytes: {
        if (strategy.dict.size)
            return throwVMRangeError(lexicalGlobalObject, scope, "The queuing strategy of a readable byte stream cannot have a size function"_s);
        double highWaterMark = extractHighWaterMark(lexicalGlobalObject, strategy.dict, 0);
        RETURN_IF_EXCEPTION(scope, {});
        setUpReadableByteStreamControllerFromUnderlyingSource(lexicalGlobalObject, stream, underlyingSource, source.dict, highWaterMark);
        RETURN_IF_EXCEPTION(scope, {});
        break;
    }
    case BunUnderlyingSourceType::None: {
        auto* sizeAlgorithm = extractSizeAlgorithm(strategy.dict);
        double highWaterMark = extractHighWaterMark(lexicalGlobalObject, strategy.dict, 1);
        RETURN_IF_EXCEPTION(scope, {});
        setUpReadableStreamDefaultControllerFromUnderlyingSource(lexicalGlobalObject, stream, underlyingSource, source.dict, highWaterMark, sizeAlgorithm);
        RETURN_IF_EXCEPTION(scope, {});
        break;
    }
    }
    return JSValue::encode(stream);
}
JSC_ANNOTATE_HOST_FUNCTION(JSReadableStreamConstructorConstruct, JSReadableStreamConstructor::construct);

// JSReadableStreamPrototype

static const HashTableValue JSReadableStreamPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamPrototypeGetter_constructor, 0 } },
    { "locked"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamPrototypeGetter_locked, 0 } },
    { "cancel"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamPrototypeFunction_cancel, 0 } },
    { "getReader"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamPrototypeFunction_getReader, 0 } },
    { "pipeThrough"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamPrototypeFunction_pipeThrough, 1 } },
    { "pipeTo"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamPrototypeFunction_pipeTo, 1 } },
    { "tee"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamPrototypeFunction_tee, 0 } },
    { "values"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamPrototypeFunction_values, 0 } },
    { "blob"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamPrototypeFunction_blob, 0 } },
    { "bytes"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamPrototypeFunction_bytes, 0 } },
    { "json"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamPrototypeFunction_json, 0 } },
    { "text"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamPrototypeFunction_text, 0 } },
};

const ClassInfo JSReadableStreamPrototype::s_info = { "ReadableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSReadableStream>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "locked"_s), jsBoolean(isReadableStreamLocked(thisObject)), 0);
    ASCIILiteral state;
    switch (thisObject->m_state) {
    case ReadableStreamState::Readable:
        state = "readable"_s;
        break;
    case ReadableStreamState::Closed:
        state = "closed"_s;
        break;
    case ReadableStreamState::Errored:
        state = "errored"_s;
        break;
    }
    data->putDirect(vm, Identifier::fromString(vm, "state"_s), jsNontrivialString(vm, state), 0);
    data->putDirect(vm, Identifier::fromString(vm, "supportsBYOB"_s), jsBoolean(thisObject->m_controllerKind == ControllerKind::Byte), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "ReadableStream"_s, data));
}

void JSReadableStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSReadableStream::info(), JSReadableStreamPrototypeTableValues, *this);

    // @@asyncIterator is the SAME function object as values() (WebIDL async_iterable).
    JSValue valuesFunction = getDirect(vm, vm.propertyNames->builtinNames().valuesPublicName());
    putDirectWithoutTransition(vm, vm.propertyNames->asyncIteratorSymbol, valuesFunction, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));

    // Bun private-name accessors read by surviving builtins (`stream.$bunNativePtr`, ...).
    auto& names = builtinNames(vm);
    putDirectCustomAccessor(vm, names.bunNativePtrPrivateName(), DOMAttributeGetterSetter::create(vm, jsReadableStreamPrototype_nativePtrGetter, jsReadableStreamPrototype_nativePtrSetter, DOMAttributeAnnotation { JSReadableStream::info(), nullptr }), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute | JSC::PropertyAttribute::DontDelete);
    putDirectCustomAccessor(vm, names.bunNativeTypePrivateName(), DOMAttributeGetterSetter::create(vm, jsReadableStreamPrototype_nativeTypeGetter, jsReadableStreamPrototype_nativeTypeSetter, DOMAttributeAnnotation { JSReadableStream::info(), nullptr }), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute | JSC::PropertyAttribute::DontDelete);
    putDirectCustomAccessor(vm, names.disturbedPrivateName(), DOMAttributeGetterSetter::create(vm, jsReadableStreamPrototype_disturbedGetter, jsReadableStreamPrototype_disturbedSetter, DOMAttributeAnnotation { JSReadableStream::info(), nullptr }), JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute | JSC::PropertyAttribute::DontDelete);

    Bun::WebStreams::installInspectCustom(vm, this, jsReadableStreamPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSReadableStream

const ClassInfo JSReadableStream::s_info = { "ReadableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStream) };

JSReadableStream::JSReadableStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSReadableStream::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    // Bun snapshots the ambient AsyncContext at construction; source callbacks restore it.
    if (auto* asyncContextData = globalObject()->m_asyncContextData.get())
        m_asyncContext.set(vm, this, asyncContextData->getInternalField(0));
}

JSReadableStream* JSReadableStream::create(VM& vm, Structure* structure)
{
    auto* stream = new (NotNull, allocateCell<JSReadableStream>(vm)) JSReadableStream(vm, structure);
    stream->finishCreation(vm);
    return stream;
}

Structure* JSReadableStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSReadableStream::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSReadableStreamPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSReadableStreamPrototype::create(vm, &globalObject, structure);
}

JSObject* JSReadableStream::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSReadableStream>(vm, globalObject);
}

JSValue JSReadableStream::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSReadableStreamConstructor, DOMConstructorID::ReadableStream>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSReadableStream::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStream, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableStream = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableStream = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSReadableStream);

template<typename Visitor>
void JSReadableStream::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableStream>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_reader);
    visitor.appendHidden(thisObject->m_storedError);
    visitor.appendHidden(thisObject->m_controller);
    visitor.appendHidden(thisObject->m_nativePtr);
    visitor.appendHidden(thisObject->m_directUnderlyingSource);
    visitor.appendHidden(thisObject->m_asyncContext);
    visitor.appendHidden(thisObject->m_closedPromise);
}

void JSReadableStream::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSReadableStream>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_reader, "reader"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_storedError, "storedError"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_controller, "controller"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_nativePtr, "bunNativePtr"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_directUnderlyingSource, "underlyingSource"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_asyncContext, "asyncContext"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_closedPromise, "closedPromise"_s);
}

void JSReadableStream::materializeIfNeeded(JSGlobalObject* globalObject)
{
    const auto mode = m_bunMode;
    if (mode == BunStreamMode::Default) [[likely]]
        return;
    // Clear the mode BEFORE running the thunk so re-entrant consumers see it done.
    m_bunMode = BunStreamMode::Default;
    if (mode == BunStreamMode::DirectPending)
        setUpDirectStreamController(globalObject, this, DirectSinkKind::ArrayBuffer, m_bunHighWaterMark);
    else
        materializeNativeSource(globalObject, this);
}

// Prototype host functions

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSReadableStreamPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSReadableStream::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamPrototypeGetter_locked, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStream"_s);
    return JSValue::encode(jsBoolean(isReadableStreamLocked(stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_cancel, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "ReadableStream.prototype.cancel can only be called on a ReadableStream"_s))));
    if (isReadableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "Cannot cancel a locked ReadableStream"_s))));
    auto* promise = readableStreamCancel(lexicalGlobalObject, stream, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_getReader, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStream"_s);

    // ReadableStreamGetReaderOptions { ReadableStreamReaderMode mode; }
    bool isBYOB = false;
    JSValue options = callFrame->argument(0);
    if (!options.isUndefinedOrNull()) {
        if (!options.isObject())
            return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "options"_s, "object"_s, options);
        JSValue mode = asObject(options)->get(lexicalGlobalObject, builtinNames(vm).modePublicName());
        RETURN_IF_EXCEPTION(scope, {});
        if (!mode.isUndefined()) {
            auto modeString = mode.toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (modeString != "byob"_s)
                return Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "options.mode"_s, mode);
            isBYOB = true;
        }
    }

    if (isBYOB) {
        // A lazy native stream is a byte stream; materialize it so the BYOB reader attaches.
        // A DirectPending stream can never satisfy BYOB, so leave it unmaterialized and let
        // SetUpReadableStreamBYOBReader reject it without running user code.
        if (stream->m_bunMode == BunStreamMode::NativePending) {
            stream->materializeIfNeeded(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        auto* reader = acquireReadableStreamBYOBReader(lexicalGlobalObject, stream);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(reader);
    }

    stream->materializeIfNeeded(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* reader = acquireReadableStreamDefaultReader(lexicalGlobalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(reader);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_pipeThrough, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStream"_s);

    // ReadableWritablePair { required ReadableStream readable; required WritableStream writable; }
    JSValue transform = callFrame->argument(0);
    if (!transform.isObject())
        return throwVMTypeError(lexicalGlobalObject, scope, "pipeThrough() expects an object with 'readable' and 'writable' properties"_s);
    auto* transformObject = asObject(transform);
    JSValue readableValue = transformObject->get(lexicalGlobalObject, builtinNames(vm).readablePublicName());
    RETURN_IF_EXCEPTION(scope, {});
    auto* transformReadable = dynamicDowncast<JSReadableStream>(readableValue);
    if (!transformReadable)
        return throwVMTypeError(lexicalGlobalObject, scope, "The transform's 'readable' property must be a ReadableStream"_s);
    JSValue writableValue = transformObject->get(lexicalGlobalObject, builtinNames(vm).writablePublicName());
    RETURN_IF_EXCEPTION(scope, {});
    auto* transformWritable = dynamicDowncast<JSWritableStream>(writableValue);
    if (!transformWritable)
        return throwVMTypeError(lexicalGlobalObject, scope, "The transform's 'writable' property must be a WritableStream"_s);

    auto options = convertStreamPipeOptions(vm, lexicalGlobalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});

    if (isReadableStreamLocked(stream))
        return throwVMTypeError(lexicalGlobalObject, scope, "Cannot pipe a locked ReadableStream"_s);
    if (isWritableStreamLocked(transformWritable))
        return throwVMTypeError(lexicalGlobalObject, scope, "Cannot pipe to a locked WritableStream"_s);

    auto* promise = readableStreamPipeTo(lexicalGlobalObject, stream, transformWritable, options.preventClose, options.preventAbort, options.preventCancel, options.signal);
    RETURN_IF_EXCEPTION(scope, {});
    markPromiseAsHandled(vm, promise);
    return JSValue::encode(transformReadable);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_pipeTo, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "ReadableStream.prototype.pipeTo can only be called on a ReadableStream"_s))));
    auto* destination = dynamicDowncast<JSWritableStream>(callFrame->argument(0));
    if (!destination)
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "ReadableStream.prototype.pipeTo requires a WritableStream destination"_s))));

    ConvertedStreamPipeOptions options;
    {
        // WebIDL: a promise-returning operation turns an argument-conversion failure into a rejection.
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        options = convertStreamPipeOptions(vm, lexicalGlobalObject, callFrame->argument(1));
        if (catchScope.exception()) [[unlikely]] {
            JSValue thrown = takeAbruptCompletion(lexicalGlobalObject, catchScope);
            if (thrown.isEmpty())
                return {};
            RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, thrown)));
        }
    }

    if (isReadableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "Cannot pipe a locked ReadableStream"_s))));
    if (isWritableStreamLocked(destination))
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "Cannot pipe to a locked WritableStream"_s))));

    auto* promise = readableStreamPipeTo(lexicalGlobalObject, stream, destination, options.preventClose, options.preventAbort, options.preventCancel, options.signal);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_tee, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStream"_s);
    auto branches = readableStreamTee(lexicalGlobalObject, stream, false);
    RETURN_IF_EXCEPTION(scope, {});
    auto* array = constructEmptyArray(lexicalGlobalObject, nullptr, 2);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(lexicalGlobalObject, 0, branches.first);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(lexicalGlobalObject, 1, branches.second);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(array);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_values, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStream"_s);

    // ReadableStreamIteratorOptions { boolean preventCancel = false; }
    bool preventCancel = false;
    JSValue options = callFrame->argument(0);
    if (!options.isUndefinedOrNull()) {
        if (!options.isObject())
            return throwVMTypeError(lexicalGlobalObject, scope, "values() options must be an object"_s);
        JSValue preventCancelValue = asObject(options)->get(lexicalGlobalObject, builtinNames(vm).preventCancelPublicName());
        RETURN_IF_EXCEPTION(scope, {});
        if (!preventCancelValue.isUndefined())
            preventCancel = preventCancelValue.toBoolean(lexicalGlobalObject);
    }

    stream->materializeIfNeeded(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto* domGlobalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* iterator = JSReadableStreamAsyncIterator::create(vm, getDOMStructure<JSReadableStreamAsyncIterator>(vm, *domGlobalObject));
    auto* reader = acquireReadableStreamDefaultReader(lexicalGlobalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    iterator->m_reader.set(vm, iterator, reader);
    iterator->m_preventCancel = preventCancel;
    return JSValue::encode(iterator);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamStaticFunction_from, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = readableStreamFromIterable(lexicalGlobalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stream);
}

// Bun-only prototype methods. Each is a one-line delegation.

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_text, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStream"_s);
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamToText(lexicalGlobalObject, stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_json, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStream"_s);
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamToJSON(lexicalGlobalObject, stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_bytes, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStream"_s);
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamToBytes(lexicalGlobalObject, stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPrototypeFunction_blob, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStream"_s);
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamToBlob(lexicalGlobalObject, stream)));
}

// Bun private-name accessors ($bunNativePtr / $bunNativeType / $disturbed).

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamPrototype_nativePtrGetter, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* stream = uncheckedDowncast<JSReadableStream>(JSValue::decode(thisValue));
    JSValue nativePtr = stream->nativePtrForJS();
    return JSValue::encode(nativePtr.isEmpty() ? jsUndefined() : nativePtr);
}

JSC_DEFINE_CUSTOM_SETTER(jsReadableStreamPrototype_nativePtrSetter, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* stream = uncheckedDowncast<JSReadableStream>(JSValue::decode(thisValue));
    stream->m_nativePtr.set(vm, stream, JSValue::decode(encodedValue));
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamPrototype_nativeTypeGetter, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    const auto* stream = uncheckedDowncast<JSReadableStream>(JSValue::decode(thisValue));
    return JSValue::encode(jsNumber(stream->m_nativeType));
}

JSC_DEFINE_CUSTOM_SETTER(jsReadableStreamPrototype_nativeTypeSetter, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = uncheckedDowncast<JSReadableStream>(JSValue::decode(thisValue));
    int32_t nativeType = JSValue::decode(encodedValue).toInt32(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, false);
    stream->m_nativeType = nativeType;
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamPrototype_disturbedGetter, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    const auto* stream = uncheckedDowncast<JSReadableStream>(JSValue::decode(thisValue));
    return JSValue::encode(jsBoolean(stream->m_disturbed));
}

JSC_DEFINE_CUSTOM_SETTER(jsReadableStreamPrototype_disturbedSetter, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto* stream = uncheckedDowncast<JSReadableStream>(JSValue::decode(thisValue));
    stream->m_disturbed = JSValue::decode(encodedValue).toBoolean(lexicalGlobalObject);
    return true;
}

} // namespace WebCore
