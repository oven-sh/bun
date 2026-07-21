#include "config.h"
#include "JSReadableStreamBYOBReader.h"

#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSDOMBinding.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSReadRequest.h"
#include "JSReadableByteStreamController.h"
#include "JSReadableStream.h"
#include "JSStreamsRuntime.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <wtf/Locker.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSStreamsRuntime;

// The only cast of the erased stream->m_controller slot in this file: a BYOB reader can
// only be attached to a byte-controlled stream (SetUpReadableStreamBYOBReader enforces it).
static WebCore::JSReadableByteStreamController* byteControllerOf(JSReadableStream* stream)
{
    ASSERT(stream->m_controllerKind == ControllerKind::Byte);
    return uncheckedDowncast<WebCore::JSReadableByteStreamController>(stream->m_controller.get());
}

// Detaches [[readIntoRequests]] before dispatch ("set to an empty list, then iterate"): once
// the requests leave the visited deque the MarkedArgumentBuffer is their only root.
static void detachReadIntoRequests(JSC::VM& vm, JSGlobalObject* globalObject, JSReadableStreamBYOBReader* reader, MarkedArgumentBuffer& out)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    {
        WTF::Locker locker { reader->cellLock() };
        for (auto& request : reader->m_readIntoRequests)
            out.append(request.get());
        reader->m_readIntoRequests.clear();
    }
    if (out.hasOverflowed()) [[unlikely]]
        throwOutOfMemoryError(globalObject, scope);
}

// ReadableStreamBYOBReaderErrorReadIntoRequests(reader, e)
void readableStreamBYOBReaderErrorReadIntoRequests(JSGlobalObject* globalObject, JSReadableStreamBYOBReader* reader, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer readIntoRequests;
    detachReadIntoRequests(vm, globalObject, reader, readIntoRequests);
    RETURN_IF_EXCEPTION(scope, void());
    for (size_t i = 0, count = readIntoRequests.size(); i < count; ++i) {
        uncheckedDowncast<WebCore::JSReadIntoRequest>(readIntoRequests.at(i))->errorSteps(globalObject, error);
        RETURN_IF_EXCEPTION(scope, void());
    }
}

// ReadableStreamBYOBReaderRead(reader, view, min, readIntoRequest)
void readableStreamBYOBReaderRead(JSGlobalObject* globalObject, JSReadableStreamBYOBReader* reader, JSArrayBufferView* view, uint64_t min, WebCore::JSReadIntoRequest* readIntoRequest)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = reader->m_stream.get();
    ASSERT(stream);
    stream->m_disturbed = true;
    if (stream->m_state == ReadableStreamState::Errored) {
        JSValue storedError = stream->m_storedError.get();
        RELEASE_AND_RETURN(scope, readIntoRequest->errorSteps(globalObject, storedError ? storedError : jsUndefined()));
    }
    RELEASE_AND_RETURN(scope, readableByteStreamControllerPullInto(globalObject, byteControllerOf(stream), view, min, readIntoRequest));
}

// ReadableStreamBYOBReaderRelease(reader)
void readableStreamBYOBReaderRelease(JSGlobalObject* globalObject, JSReadableStreamBYOBReader* reader)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    readableStreamReaderGenericRelease(globalObject, reader);
    RETURN_IF_EXCEPTION(scope, void());
    JSObject* error = Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Releasing reader"_s);
    RETURN_IF_EXCEPTION(scope, void());
    RELEASE_AND_RETURN(scope, readableStreamBYOBReaderErrorReadIntoRequests(globalObject, reader, error));
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

// WebIDL argument conversion for read(view, options): `min` is [EnforceRange] unsigned long
// long, defaulting to 1. Throws; the promise-returning caller converts that to a rejection.
struct BYOBReadArguments {
    JSC::JSArrayBufferView* view { nullptr };
    uint64_t min { 1 };
};
static BYOBReadArguments convertBYOBReadArguments(JSC::VM& vm, JSGlobalObject* globalObject, JSValue viewValue, JSValue options)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    BYOBReadArguments result;
    result.view = dynamicDowncast<JSArrayBufferView>(viewValue);
    if (!result.view) {
        throwTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.read requires an ArrayBufferView"_s);
        return result;
    }
    if (options.isUndefinedOrNull())
        return result;
    if (!options.isObject()) {
        throwTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.read options must be an object"_s);
        return result;
    }
    JSValue minValue = asObject(options)->get(globalObject, builtinNames(vm).minPublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (minValue.isUndefined())
        return result;
    result.min = convertToIntegerEnforceRange<uint64_t>(*globalObject, minValue);
    RETURN_IF_EXCEPTION(scope, result);
    return result;
}

static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamBYOBReaderPrototypeFunction_cancel);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamBYOBReaderPrototypeFunction_read);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamBYOBReaderPrototypeFunction_releaseLock);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamBYOBReaderPrototype_inspectCustom);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamBYOBReaderPrototypeGetter_closed);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamBYOBReaderPrototypeGetter_constructor);

class JSReadableStreamBYOBReaderPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSReadableStreamBYOBReaderPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSReadableStreamBYOBReaderPrototype* ptr = new (NotNull, JSC::allocateCell<JSReadableStreamBYOBReaderPrototype>(vm)) JSReadableStreamBYOBReaderPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamBYOBReaderPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSReadableStreamBYOBReaderPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamBYOBReaderPrototype, JSReadableStreamBYOBReaderPrototype::Base);

// JSReadableStreamBYOBReaderConstructor = JSStreamConstructor<JSReadableStreamBYOBReader>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamBYOBReaderConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSReadableStreamBYOBReaderConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSReadableStreamBYOBReaderConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSReadableStreamBYOBReaderConstructor::subspaceForImpl(JSC::VM&);
template<> void JSReadableStreamBYOBReaderConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSReadableStreamBYOBReaderConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSReadableStreamBYOBReaderConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSReadableStreamBYOBReaderConstructor::s_info = { "ReadableStreamBYOBReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBReaderConstructor) };

template<> JSValue JSReadableStreamBYOBReaderConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSReadableStreamBYOBReaderConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamBYOBReaderConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSReadableStreamBYOBReaderConstructor);

template<> GCClient::IsoSubspace* JSReadableStreamBYOBReaderConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamBYOBReaderConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableStreamBYOBReaderConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableStreamBYOBReaderConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableStreamBYOBReaderConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableStreamBYOBReaderConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSReadableStreamBYOBReaderConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "ReadableStreamBYOBReader"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSReadableStreamBYOBReader::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    m_instanceStructure.set(vm, this, getDOMStructure<JSReadableStreamBYOBReader>(vm, globalObject));
}

// new ReadableStreamBYOBReader(stream): SetUpReadableStreamBYOBReader(this, stream), which
// throws a TypeError when the stream is locked or is not a byte stream.
template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamBYOBReaderConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSReadableStreamBYOBReaderConstructor>(callFrame->jsCallee());

    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->argument(0));
    if (!stream)
        return throwVMTypeError(lexicalGlobalObject, scope, "ReadableStreamBYOBReader constructor requires a ReadableStream as its first argument"_s);

    // Same as getReader({mode:"byob"}): a lazy native stream materializes into a byte
    // controller before it is locked. A DirectPending stream is left alone so it rejects
    // without running user code.
    if (stream->m_bunMode == BunStreamMode::NativePending) {
        stream->materializeIfNeeded(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    auto* reader = JSReadableStreamBYOBReader::create(vm, structure);
    setUpReadableStreamBYOBReader(lexicalGlobalObject, reader, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(reader);
}
JSC_ANNOTATE_HOST_FUNCTION(JSReadableStreamBYOBReaderConstructorConstruct, JSReadableStreamBYOBReaderConstructor::construct);

// JSReadableStreamBYOBReaderPrototype

static const HashTableValue JSReadableStreamBYOBReaderPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamBYOBReaderPrototypeGetter_constructor, 0 } },
    { "closed"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamBYOBReaderPrototypeGetter_closed, 0 } },
    { "cancel"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamBYOBReaderPrototypeFunction_cancel, 0 } },
    { "read"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamBYOBReaderPrototypeFunction_read, 1 } },
    { "releaseLock"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamBYOBReaderPrototypeFunction_releaseLock, 0 } },
};

const ClassInfo JSReadableStreamBYOBReaderPrototype::s_info = { "ReadableStreamBYOBReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBReaderPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamBYOBReaderPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSReadableStreamBYOBReader>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "stream"_s), thisObject->m_stream.get() ? JSValue(thisObject->m_stream.get()) : jsUndefined(), 0);
    size_t requestCount;
    {
        WTF::Locker locker { thisObject->cellLock() };
        requestCount = thisObject->m_readIntoRequests.size();
    }
    data->putDirect(vm, Identifier::fromString(vm, "readIntoRequests"_s), jsNumber(requestCount), 0);
    data->putDirect(vm, Identifier::fromString(vm, "close"_s), thisObject->m_closedPromise.get() ? JSValue(thisObject->m_closedPromise.get()) : jsUndefined(), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "ReadableStreamBYOBReader"_s, data));
}

void JSReadableStreamBYOBReaderPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSReadableStreamBYOBReader::info(), JSReadableStreamBYOBReaderPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsReadableStreamBYOBReaderPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSReadableStreamBYOBReader

const ClassInfo JSReadableStreamBYOBReader::s_info = { "ReadableStreamBYOBReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBReader) };

JSReadableStreamBYOBReader::JSReadableStreamBYOBReader(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSReadableStreamBYOBReader::~JSReadableStreamBYOBReader() = default;

void JSReadableStreamBYOBReader::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSReadableStreamBYOBReader* JSReadableStreamBYOBReader::create(VM& vm, Structure* structure)
{
    auto* reader = new (NotNull, allocateCell<JSReadableStreamBYOBReader>(vm)) JSReadableStreamBYOBReader(vm, structure);
    reader->finishCreation(vm);
    return reader;
}

void JSReadableStreamBYOBReader::destroy(JSCell* cell)
{
    static_cast<JSReadableStreamBYOBReader*>(cell)->JSReadableStreamBYOBReader::~JSReadableStreamBYOBReader();
}

Structure* JSReadableStreamBYOBReader::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSReadableStreamBYOBReader::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSReadableStreamBYOBReaderPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSReadableStreamBYOBReaderPrototype::create(vm, &globalObject, structure);
}

JSObject* JSReadableStreamBYOBReader::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSReadableStreamBYOBReader>(vm, globalObject);
}

JSValue JSReadableStreamBYOBReader::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSReadableStreamBYOBReaderConstructor, DOMConstructorID::ReadableStreamBYOBReader>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSReadableStreamBYOBReader::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamBYOBReader, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableStreamBYOBReader.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableStreamBYOBReader = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableStreamBYOBReader.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableStreamBYOBReader = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSReadableStreamBYOBReader);

template<typename Visitor>
void JSReadableStreamBYOBReader::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamBYOBReader>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_closedPromise);
    WTF::Locker locker { thisObject->cellLock() };
    for (auto& request : thisObject->m_readIntoRequests)
        visitor.appendHidden(request);
}

void JSReadableStreamBYOBReader::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamBYOBReader>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_closedPromise, "closedPromise"_s);
    {
        WTF::Locker locker { thisObject->cellLock() };
        uint32_t i = 0;
        for (auto& entry : thisObject->m_readIntoRequests) {
            if (auto* request = entry.get())
                analyzer.analyzeIndexEdge(cell, request, i);
            ++i;
        }
    }
}

// Prototype accessors and host functions

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamBYOBReaderPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSReadableStreamBYOBReaderPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSReadableStreamBYOBReader::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamBYOBReaderPrototypeGetter_closed, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    const auto* reader = dynamicDowncast<JSReadableStreamBYOBReader>(JSValue::decode(thisValue));
    if (!reader) [[unlikely]]
        return JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "The 'closed' getter can only be used on a ReadableStreamBYOBReader"_s)));
    return JSValue::encode(reader->m_closedPromise.get());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamBYOBReaderPrototypeFunction_cancel, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = dynamicDowncast<JSReadableStreamBYOBReader>(callFrame->thisValue());
    if (!reader) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "ReadableStreamBYOBReader.prototype.cancel can only be called on a ReadableStreamBYOBReader"_s))));
    if (!reader->m_stream)
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The reader is not attached to a stream"_s))));
    auto* promise = readableStreamReaderGenericCancel(lexicalGlobalObject, reader, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamBYOBReaderPrototypeFunction_read, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = dynamicDowncast<JSReadableStreamBYOBReader>(callFrame->thisValue());
    if (!reader) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "ReadableStreamBYOBReader.prototype.read can only be called on a ReadableStreamBYOBReader"_s))));

    // A promise-returning operation turns argument-conversion failures into rejections.
    BYOBReadArguments arguments;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        arguments = convertBYOBReadArguments(vm, lexicalGlobalObject, callFrame->argument(0), callFrame->argument(1));
        if (catchScope.exception()) [[unlikely]] {
            JSValue thrown = takeAbruptCompletion(lexicalGlobalObject, catchScope);
            if (thrown.isEmpty())
                return {};
            RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, thrown)));
        }
    }
    JSArrayBufferView* view = arguments.view;
    uint64_t minRequested = arguments.min;

    if (!view->byteLength())
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The view passed to read() must have a non-zero byteLength"_s))));
    RefPtr<ArrayBuffer> viewedBuffer = view->possiblySharedBuffer();
    if (!viewedBuffer || !viewedBuffer->byteLength())
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The view passed to read() is backed by a zero-length ArrayBuffer"_s))));
    if (viewedBuffer->isDetached() || view->isDetached())
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The view passed to read() is backed by a detached ArrayBuffer"_s))));
    if (!minRequested)
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "The 'min' option must be greater than 0"_s))));
    TypedArrayType viewType = typedArrayType(view->type());
    uint64_t minLimit = viewType == TypeDataView ? static_cast<uint64_t>(view->byteLength()) : static_cast<uint64_t>(view->length());
    if (minRequested > minLimit)
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createRangeError(lexicalGlobalObject, "The 'min' option cannot be larger than the view passed to read()"_s))));
    if (!reader->m_stream)
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The reader is not attached to a stream"_s))));

    auto* domGlobalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* runtime = JSStreamsRuntime::from(lexicalGlobalObject);
    auto* promise = JSPromise::create(vm, lexicalGlobalObject->promiseStructure());
    auto* readIntoRequest = JSReadIntoRequest::create(vm, runtime->readIntoRequestStructure(domGlobalObject), ReadIntoRequestKind::Promise, promise);
    readableStreamBYOBReaderRead(lexicalGlobalObject, reader, view, minRequested, readIntoRequest);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamBYOBReaderPrototypeFunction_releaseLock, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = dynamicDowncast<JSReadableStreamBYOBReader>(callFrame->thisValue());
    if (!reader) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStreamBYOBReader"_s);
    if (!reader->m_stream)
        return JSValue::encode(jsUndefined());
    readableStreamBYOBReaderRelease(lexicalGlobalObject, reader);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore
