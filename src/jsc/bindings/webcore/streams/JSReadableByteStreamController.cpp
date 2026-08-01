#include "config.h"
#include "JSReadableByteStreamController.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSPullIntoDescriptor.h"
#include "JSReadRequest.h"
#include "JSReadableStream.h"
#include "JSReadableStreamBYOBRequest.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSStreamTeeState.h"
#include "JSStreamsRuntime.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ExceptionHelpers.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSDataView.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/TypedArrayType.h>
#include <algorithm>
#include <cstring>
#include <wtf/Locker.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;

// CloneArrayBuffer(buffer, byteOffset, byteLength, %ArrayBuffer%): null ⇒ exception pending.
static RefPtr<JSC::ArrayBuffer> cloneArrayBuffer(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::ArrayBuffer& buffer, size_t byteOffset, size_t byteLength)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    RefPtr<JSC::ArrayBuffer> cloned = JSC::ArrayBuffer::tryCreate(buffer.span().subspan(byteOffset, byteLength));
    if (!cloned) [[unlikely]]
        JSC::throwRangeError(globalObject, scope, "Cannot allocate the cloned ArrayBuffer required by the readable byte stream"_s);
    return cloned;
}

// Construct(viewConstructor, « buffer, byteOffset, length »). `length` is an element count for
// typed arrays and a byte length for %DataView% (elementSize(TypeDataView) == 1).
static JSC::JSArrayBufferView* constructViewOfType(JSC::JSGlobalObject* globalObject, JSC::TypedArrayType type, RefPtr<JSC::ArrayBuffer> buffer, size_t byteOffset, size_t length)
{
    JSC::Structure* structure = globalObject->typedArrayStructure(type, buffer->isResizableOrGrowableShared());
    switch (type) {
    case JSC::TypeInt8:
        return JSC::JSInt8Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeUint8:
        return JSC::JSUint8Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeUint8Clamped:
        return JSC::JSUint8ClampedArray::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeInt16:
        return JSC::JSInt16Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeUint16:
        return JSC::JSUint16Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeInt32:
        return JSC::JSInt32Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeUint32:
        return JSC::JSUint32Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeFloat16:
        return JSC::JSFloat16Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeFloat32:
        return JSC::JSFloat32Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeFloat64:
        return JSC::JSFloat64Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeBigInt64:
        return JSC::JSBigInt64Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeBigUint64:
        return JSC::JSBigUint64Array::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::TypeDataView:
        return JSC::JSDataView::create(globalObject, structure, WTF::move(buffer), byteOffset, length);
    case JSC::NotTypedArray:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
    return nullptr;
}

// WebIDL "invoke a callback function" with a Promise<T> return type: an abrupt completion is
// converted into a rejected promise (a completion-record conversion), never a synchronous throw.
static JSC::JSPromise* invokePromiseReturningMethod(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* method, JSC::JSValue thisValue, const JSC::MarkedArgumentBuffer& args)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue result;
    JSC::JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto callData = JSC::getCallData(method);
        ASSERT(callData.type != JSC::CallData::Type::None);
        result = JSC::call(globalObject, method, callData, thisValue, args);
        if (catchScope.exception()) [[unlikely]]
            thrown = takeAbruptCompletion(globalObject, catchScope);
    }
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    if (result.isEmpty())
        return nullptr;
    RELEASE_AND_RETURN(scope, promiseResolvedWith(globalObject, result));
}

// The [[pullAlgorithm]] dispatch. The reachable kind set on a byte controller is exactly
// {JavaScript, Nothing, ByteTeeBranch}; the switch is total over SourceKind.
// Returns nullptr with no exception pending when the pull completed synchronously with a
// non-thenable result: the caller queues the upon-fulfillment handler without a wrapper promise.
static JSC::JSPromise* performByteControllerPullAlgorithm(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSReadableByteStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (controller->m_algorithms.kind) {
    case SourceKind::JavaScript: {
        JSC::JSObject* pullMethod = controller->m_algorithms.method1.get();
        if (!pullMethod)
            return nullptr;
        JSC::MarkedArgumentBuffer args;
        args.append(controller);
        if (args.hasOverflowed()) [[unlikely]] {
            JSC::throwOutOfMemoryError(globalObject, scope);
            return nullptr;
        }
        StreamAsyncContextScope asyncContextScope(globalObject, controller->m_stream.get());
        JSC::JSValue result;
        JSC::JSValue thrown;
        {
            auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            auto callData = JSC::getCallData(pullMethod);
            ASSERT(callData.type != JSC::CallData::Type::None);
            result = JSC::call(globalObject, pullMethod, callData, controller->m_algorithms.underlyingObject.get(), args);
            if (catchScope.exception()) [[unlikely]]
                thrown = takeAbruptCompletion(globalObject, catchScope);
        }
        if (!thrown.isEmpty()) [[unlikely]]
            RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
        if (result.isEmpty()) [[unlikely]]
            return nullptr;
        if (!result.isObject()) [[likely]]
            return nullptr;
        if (auto* resultPromise = dynamicDowncast<JSC::JSPromise>(result); resultPromise && resultPromise->isThenFastAndNonObservable())
            return resultPromise;
        RELEASE_AND_RETURN(scope, promiseResolvedWith(globalObject, result));
    }
    case SourceKind::Nothing:
        return nullptr;
    case SourceKind::ByteTeeBranch:
        RELEASE_AND_RETURN(scope, byteTeePullAlgorithm(globalObject, uncheckedDowncast<JSStreamTeeState>(controller->m_algorithms.algorithmContext.get()), controller->m_algorithms.teeBranchIndex));
    case SourceKind::Transform:
    case SourceKind::TeeBranch:
    case SourceKind::FromIterable:
    case SourceKind::CrossRealm:
    case SourceKind::Native:
    case SourceKind::TextDecode:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
    return nullptr;
}

// The [[cancelAlgorithm]] dispatch. Same reachable kind set as the pull dispatch.
static JSC::JSPromise* performByteControllerCancelAlgorithm(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSReadableByteStreamController* controller, JSC::JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (controller->m_algorithms.kind) {
    case SourceKind::JavaScript: {
        JSC::JSObject* cancelMethod = controller->m_algorithms.method2.get();
        if (!cancelMethod)
            RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
        JSC::MarkedArgumentBuffer args;
        args.append(reason);
        if (args.hasOverflowed()) [[unlikely]] {
            JSC::throwOutOfMemoryError(globalObject, scope);
            return nullptr;
        }
        StreamAsyncContextScope asyncContextScope(globalObject, controller->m_stream.get());
        RELEASE_AND_RETURN(scope, invokePromiseReturningMethod(vm, globalObject, cancelMethod, controller->m_algorithms.underlyingObject.get(), args));
    }
    case SourceKind::Nothing:
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    case SourceKind::ByteTeeBranch:
        RELEASE_AND_RETURN(scope, byteTeeCancelAlgorithm(globalObject, uncheckedDowncast<JSStreamTeeState>(controller->m_algorithms.algorithmContext.get()), controller->m_algorithms.teeBranchIndex, reason));
    case SourceKind::Transform:
    case SourceKind::TeeBranch:
    case SourceKind::FromIterable:
    case SourceKind::CrossRealm:
    case SourceKind::Native:
    case SourceKind::TextDecode:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
    return nullptr;
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_CUSTOM_GETTER(jsReadableByteStreamControllerConstructorGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableByteStreamControllerPrototypeGetter_byobRequest);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableByteStreamControllerPrototypeGetter_desiredSize);
static JSC_DECLARE_HOST_FUNCTION(jsReadableByteStreamControllerPrototypeFunction_close);
static JSC_DECLARE_HOST_FUNCTION(jsReadableByteStreamControllerPrototypeFunction_enqueue);
static JSC_DECLARE_HOST_FUNCTION(jsReadableByteStreamControllerPrototypeFunction_error);
static JSC_DECLARE_HOST_FUNCTION(jsReadableByteStreamControllerPrototype_inspectCustom);

class JSReadableByteStreamControllerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSReadableByteStreamControllerPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSReadableByteStreamControllerPrototype* ptr = new (NotNull, JSC::allocateCell<JSReadableByteStreamControllerPrototype>(vm)) JSReadableByteStreamControllerPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableByteStreamControllerPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSReadableByteStreamControllerPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableByteStreamControllerPrototype, JSReadableByteStreamControllerPrototype::Base);

static const HashTableValue JSReadableByteStreamControllerPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableByteStreamControllerConstructorGetter, 0 } },
    { "byobRequest"_s, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor, NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableByteStreamControllerPrototypeGetter_byobRequest, 0 } },
    { "desiredSize"_s, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor, NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableByteStreamControllerPrototypeGetter_desiredSize, 0 } },
    { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableByteStreamControllerPrototypeFunction_close, 0 } },
    { "enqueue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableByteStreamControllerPrototypeFunction_enqueue, 1 } },
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableByteStreamControllerPrototypeFunction_error, 0 } },
};

const ClassInfo JSReadableByteStreamControllerPrototype::s_info = { "ReadableByteStreamController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableByteStreamControllerPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsReadableByteStreamControllerPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSReadableByteStreamController>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    (void)thisObject;
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "ReadableByteStreamController"_s, data));
}

void JSReadableByteStreamControllerPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSReadableByteStreamController::info(), JSReadableByteStreamControllerPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsReadableByteStreamControllerPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

template<> const ClassInfo JSReadableByteStreamControllerConstructor::s_info = { "ReadableByteStreamController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableByteStreamControllerConstructor) };

template<> JSValue JSReadableByteStreamControllerConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    UNUSED_PARAM(vm);
    return globalObject.functionPrototype();
}

template<> void JSReadableByteStreamControllerConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "ReadableByteStreamController"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSReadableByteStreamController::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

const ClassInfo JSReadableByteStreamController::s_info = { "ReadableByteStreamController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableByteStreamController) };

JSReadableByteStreamController::JSReadableByteStreamController(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSReadableByteStreamController::~JSReadableByteStreamController() = default;

void JSReadableByteStreamController::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSReadableByteStreamController* JSReadableByteStreamController::create(VM& vm, Structure* structure)
{
    JSReadableByteStreamController* controller = new (NotNull, JSC::allocateCell<JSReadableByteStreamController>(vm)) JSReadableByteStreamController(vm, structure);
    controller->finishCreation(vm);
    return controller;
}

void JSReadableByteStreamController::destroy(JSCell* cell)
{
    static_cast<JSReadableByteStreamController*>(cell)->JSReadableByteStreamController::~JSReadableByteStreamController();
}

Structure* JSReadableByteStreamController::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSReadableByteStreamController::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSReadableByteStreamControllerPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSReadableByteStreamControllerPrototype::create(vm, &globalObject, structure);
}

JSObject* JSReadableByteStreamController::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSReadableByteStreamController>(vm, globalObject);
}

JSValue JSReadableByteStreamController::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSReadableByteStreamControllerConstructor, DOMConstructorID::ReadableByteStreamController>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSReadableByteStreamController::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableByteStreamController, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableByteStreamController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableByteStreamController = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableByteStreamController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableByteStreamController = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSReadableByteStreamController::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableByteStreamController>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_byobRequest);
    visitor.appendHidden(thisObject->m_algorithms.underlyingObject);
    visitor.appendHidden(thisObject->m_algorithms.method1);
    visitor.appendHidden(thisObject->m_algorithms.method2);
    visitor.appendHidden(thisObject->m_algorithms.algorithmContext);
    // ONE non-recursive cellLock scope covers BOTH barrier containers (StreamQueue.h).
    WTF::Locker locker { thisObject->cellLock() };
    thisObject->m_queue.visit(locker, visitor);
    for (auto& descriptor : thisObject->m_pendingPullIntos)
        visitor.appendHidden(descriptor);
}

DEFINE_VISIT_CHILDREN(JSReadableByteStreamController);

void JSReadableByteStreamController::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSReadableByteStreamController>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_byobRequest, "byobRequest"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.underlyingObject, "underlyingSource"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.method1, "pullAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.method2, "cancelAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.algorithmContext, "algorithmContext"_s);
    {
        WTF::Locker locker { thisObject->cellLock() };
        uint32_t i = 0;
        for (auto& entry : thisObject->m_pendingPullIntos) {
            if (auto* descriptor = entry.get())
                analyzer.analyzeIndexEdge(cell, descriptor, i);
            ++i;
        }
    }
}

// [[CancelSteps]](reason)
JSPromise* JSReadableByteStreamController::cancelSteps(JSGlobalObject* globalObject, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    readableByteStreamControllerClearPendingPullIntos(this);
    {
        WTF::Locker locker { cellLock() };
        m_queue.resetQueue(locker);
    }
    JSPromise* result = performByteControllerCancelAlgorithm(vm, globalObject, this, reason);
    RETURN_IF_EXCEPTION(scope, nullptr);
    readableByteStreamControllerClearAlgorithms(this);
    return result;
}

// [[PullSteps]](readRequest)
void JSReadableByteStreamController::pullSteps(JSGlobalObject* globalObject, JSReadRequest* readRequest)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSReadableStream* stream = m_stream.get();
    ASSERT(readableStreamHasDefaultReader(stream));
    if (m_queue.totalSize() > 0) {
        ASSERT(!readableStreamGetNumReadRequests(stream));
        RELEASE_AND_RETURN(scope, readableByteStreamControllerFillReadRequestFromQueue(globalObject, this, readRequest));
    }
    if (m_autoAllocateChunkSize) {
        // "Let buffer be Construct(%ArrayBuffer%, « autoAllocateChunkSize »)" is interpreted
        // as a completion record: an allocation failure goes to the error steps. The impl is
        // allocated directly (no JSArrayBuffer wrapper cell); user-visible views over it wrap
        // it lazily.
        RefPtr<JSC::ArrayBuffer> buffer = JSC::ArrayBuffer::tryCreate(static_cast<size_t>(m_autoAllocateChunkSize), 1);
        if (!buffer) [[unlikely]] {
            auto* error = JSC::createOutOfMemoryError(globalObject);
            RELEASE_AND_RETURN(scope, readRequest->errorSteps(globalObject, error));
        }
        auto* zigGlobalObject = defaultGlobalObject(globalObject);
        JSPullIntoDescriptor* pullIntoDescriptor = JSPullIntoDescriptor::create(vm, JSStreamsRuntime::from(globalObject)->pullIntoDescriptorStructure(zigGlobalObject));
        RETURN_IF_EXCEPTION(scope, void());
        pullIntoDescriptor->m_buffer = WTF::move(buffer);
        pullIntoDescriptor->m_bufferByteLength = static_cast<size_t>(m_autoAllocateChunkSize);
        pullIntoDescriptor->m_byteOffset = 0;
        pullIntoDescriptor->m_byteLength = static_cast<size_t>(m_autoAllocateChunkSize);
        pullIntoDescriptor->m_bytesFilled = 0;
        pullIntoDescriptor->m_minimumFill = 1;
        pullIntoDescriptor->m_viewConstructor = JSC::TypeUint8;
        pullIntoDescriptor->m_readerType = ReaderType::Default;
        {
            WTF::Locker locker { cellLock() };
            m_pendingPullIntos.append(WriteBarrier<JSPullIntoDescriptor>(vm, this, pullIntoDescriptor));
        }
    }
    readableStreamAddReadRequest(vm, stream, readRequest);
    RELEASE_AND_RETURN(scope, readableByteStreamControllerCallPullIfNeeded(globalObject, this));
}

// [[ReleaseSteps]]()
void JSReadableByteStreamController::releaseSteps()
{
    if (m_pendingPullIntos.isEmpty())
        return;
    JSPullIntoDescriptor* firstPendingPullInto = m_pendingPullIntos.first().get();
    firstPendingPullInto->m_readerType = ReaderType::None;
    WTF::Locker locker { cellLock() };
    while (m_pendingPullIntos.size() > 1)
        m_pendingPullIntos.removeLast();
}

// The shared start/pull reaction handlers ([reaction-convention]; context at argument(1)).

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onRSByteControllerStartFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSReadableByteStreamController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    controller->m_started = true;
    ASSERT(!controller->m_pulling);
    ASSERT(!controller->m_pullAgain);
    readableByteStreamControllerCallPullIfNeeded(globalObject, controller);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onRSByteControllerStartRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSReadableByteStreamController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    readableByteStreamControllerError(globalObject, controller, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onRSByteControllerPullFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSReadableByteStreamController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    controller->m_pulling = false;
    if (controller->m_pullAgain) {
        controller->m_pullAgain = false;
        readableByteStreamControllerCallPullIfNeeded(globalObject, controller);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onRSByteControllerPullRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSReadableByteStreamController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    readableByteStreamControllerError(globalObject, controller, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// Prototype accessors & methods.

JSC_DEFINE_CUSTOM_GETTER(jsReadableByteStreamControllerConstructorGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSReadableByteStreamControllerPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(globalObject, scope);
    return JSValue::encode(JSReadableByteStreamController::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableByteStreamControllerPrototypeGetter_byobRequest, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSReadableByteStreamController>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ReadableByteStreamController"_s);
    JSReadableStreamBYOBRequest* byobRequest = readableByteStreamControllerGetBYOBRequest(globalObject, thisObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!byobRequest)
        return JSValue::encode(jsNull());
    return JSValue::encode(byobRequest);
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableByteStreamControllerPrototypeGetter_desiredSize, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSReadableByteStreamController>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ReadableByteStreamController"_s);
    std::optional<double> desiredSize = readableByteStreamControllerGetDesiredSize(thisObject);
    if (!desiredSize)
        return JSValue::encode(jsNull());
    return JSValue::encode(jsNumber(*desiredSize));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableByteStreamControllerPrototypeFunction_close, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSReadableByteStreamController>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ReadableByteStreamController"_s);
    if (thisObject->m_closeRequested)
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: ReadableStream is already closed"_s);
    const JSReadableStream* const stream = thisObject->m_stream.get();
    if (!stream || stream->m_state != ReadableStreamState::Readable)
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: ReadableStream is already closed"_s);
    readableByteStreamControllerClose(globalObject, thisObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableByteStreamControllerPrototypeFunction_enqueue, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSReadableByteStreamController>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ReadableByteStreamController"_s);
    if (callFrame->argumentCount() < 1) [[unlikely]]
        return throwVMError(globalObject, scope, createNotEnoughArgumentsError(globalObject));
    auto* chunk = dynamicDowncast<JSArrayBufferView>(callFrame->uncheckedArgument(0));
    if (!chunk) [[unlikely]]
        return Bun::ERR::INVALID_ARG_INSTANCE(scope, globalObject, "buffer"_s, "Buffer, TypedArray, or DataView"_s, callFrame->uncheckedArgument(0));
    JSC::ArrayBuffer* viewedBuffer = chunk->possiblySharedBuffer();
    if (viewedBuffer && viewedBuffer->isShared()) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "ReadableByteStreamController.enqueue does not accept a view over a SharedArrayBuffer"_s);
    if (!chunk->byteLength())
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: chunk ArrayBuffer is zero-length or detached"_s);
    if (!viewedBuffer || !viewedBuffer->byteLength())
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: chunk ArrayBuffer is zero-length or detached"_s);
    if (thisObject->m_closeRequested)
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: ReadableStream is already closed"_s);
    const JSReadableStream* const stream = thisObject->m_stream.get();
    if (!stream || stream->m_state != ReadableStreamState::Readable)
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: ReadableStream is already closed"_s);
    readableByteStreamControllerEnqueue(globalObject, thisObject, chunk);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableByteStreamControllerPrototypeFunction_error, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSReadableByteStreamController>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ReadableByteStreamController"_s);
    readableByteStreamControllerError(globalObject, thisObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using namespace WebCore;

void readableByteStreamControllerCallPullIfNeeded(JSGlobalObject* globalObject, JSReadableByteStreamController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!readableByteStreamControllerShouldCallPull(controller))
        return;
    if (controller->m_pulling) {
        controller->m_pullAgain = true;
        return;
    }
    ASSERT(!controller->m_pullAgain);
    controller->m_pulling = true;
    JSPromise* pullPromise = performByteControllerPullAlgorithm(vm, globalObject, controller);
    RETURN_IF_EXCEPTION(scope, void());
    auto* runtime = JSStreamsRuntime::from(globalObject);
    // See readableStreamDefaultControllerCallPullIfNeeded.
    if (!pullPromise || pullPromise->status() == JSPromise::Status::Fulfilled)
        return queueStreamsMicrotask(globalObject, runtime->onRSByteControllerPullFulfilled(), jsUndefined(), controller);
    pullPromise->performPromiseThenWithContext(vm, globalObject, runtime->onRSByteControllerPullFulfilled(), runtime->onRSByteControllerPullRejected(), jsUndefined(), controller);
}

bool readableByteStreamControllerShouldCallPull(JSReadableByteStreamController* controller)
{
    JSReadableStream* stream = controller->m_stream.get();
    if (stream->m_state != ReadableStreamState::Readable)
        return false;
    if (controller->m_closeRequested)
        return false;
    if (!controller->m_started)
        return false;
    if (readableStreamHasDefaultReader(stream) && readableStreamGetNumReadRequests(stream) > 0)
        return true;
    if (readableStreamHasBYOBReader(stream) && readableStreamGetNumReadIntoRequests(stream) > 0)
        return true;
    std::optional<double> desiredSize = readableByteStreamControllerGetDesiredSize(controller);
    ASSERT(desiredSize);
    return *desiredSize > 0;
}

void readableByteStreamControllerClearAlgorithms(JSReadableByteStreamController* controller)
{
    controller->m_algorithms.kind = SourceKind::Nothing;
    controller->m_algorithms.underlyingObject.clear();
    controller->m_algorithms.method1.clear();
    controller->m_algorithms.method2.clear();
    controller->m_algorithms.algorithmContext.clear();
}

void readableByteStreamControllerClearPendingPullIntos(JSReadableByteStreamController* controller)
{
    readableByteStreamControllerInvalidateBYOBRequest(controller);
    WTF::Locker locker { controller->cellLock() };
    controller->m_pendingPullIntos.clear();
}

void readableByteStreamControllerClose(JSGlobalObject* globalObject, JSReadableByteStreamController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSReadableStream* stream = controller->m_stream.get();
    if (controller->m_closeRequested || stream->m_state != ReadableStreamState::Readable)
        return;
    if (controller->m_queue.totalSize() > 0) {
        controller->m_closeRequested = true;
        return;
    }
    if (!controller->m_pendingPullIntos.isEmpty()) {
        JSPullIntoDescriptor* firstPendingPullInto = controller->m_pendingPullIntos.first().get();
        if (firstPendingPullInto->m_bytesFilled % firstPendingPullInto->elementSize()) {
            JSObject* error = createTypeError(globalObject, "Cannot close a ReadableByteStreamController while a BYOB read request is partially filled"_s);
            readableByteStreamControllerError(globalObject, controller, error);
            RETURN_IF_EXCEPTION(scope, void());
            throwException(globalObject, scope, error);
            return;
        }
    }
    readableByteStreamControllerClearAlgorithms(controller);
    RELEASE_AND_RETURN(scope, readableStreamClose(globalObject, stream));
}

void readableByteStreamControllerCommitPullIntoDescriptor(JSGlobalObject* globalObject, JSReadableStream* stream, JSPullIntoDescriptor* pullIntoDescriptor)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_state != ReadableStreamState::Errored);
    ASSERT(pullIntoDescriptor->m_readerType != ReaderType::None);
    bool done = false;
    if (stream->m_state == ReadableStreamState::Closed) {
        ASSERT(!(pullIntoDescriptor->m_bytesFilled % pullIntoDescriptor->elementSize()));
        done = true;
    }
    JSArrayBufferView* filledView = readableByteStreamControllerConvertPullIntoDescriptor(globalObject, pullIntoDescriptor);
    RETURN_IF_EXCEPTION(scope, void());
    if (pullIntoDescriptor->m_readerType == ReaderType::Default)
        RELEASE_AND_RETURN(scope, readableStreamFulfillReadRequest(globalObject, stream, filledView, done));
    ASSERT(pullIntoDescriptor->m_readerType == ReaderType::Byob);
    RELEASE_AND_RETURN(scope, readableStreamFulfillReadIntoRequest(globalObject, stream, filledView, done));
}

JSArrayBufferView* readableByteStreamControllerConvertPullIntoDescriptor(JSGlobalObject* globalObject, JSPullIntoDescriptor* pullIntoDescriptor)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    size_t bytesFilled = pullIntoDescriptor->m_bytesFilled;
    size_t elementSize = pullIntoDescriptor->elementSize();
    ASSERT(bytesFilled <= pullIntoDescriptor->m_byteLength);
    ASSERT(!(bytesFilled % elementSize));
    RefPtr<JSC::ArrayBuffer> buffer = transferArrayBufferImpl(globalObject, *pullIntoDescriptor->m_buffer);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, constructViewOfType(globalObject, pullIntoDescriptor->m_viewConstructor, WTF::move(buffer), pullIntoDescriptor->m_byteOffset, bytesFilled / elementSize));
}

void readableByteStreamControllerEnqueue(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, JSArrayBufferView* chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSReadableStream* stream = controller->m_stream.get();
    if (controller->m_closeRequested || stream->m_state != ReadableStreamState::Readable)
        return;
    RefPtr<JSC::ArrayBuffer> buffer = chunk->possiblySharedBuffer();
    size_t byteOffset = chunk->byteOffset();
    size_t byteLength = chunk->byteLength();
    if (!buffer || buffer->isDetached()) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: chunk ArrayBuffer is zero-length or detached"_s);
        return;
    }
    RefPtr<JSC::ArrayBuffer> transferredBuffer = transferArrayBufferImpl(globalObject, *buffer);
    RETURN_IF_EXCEPTION(scope, void());
    if (!controller->m_pendingPullIntos.isEmpty()) {
        JSPullIntoDescriptor* firstPendingPullInto = controller->m_pendingPullIntos.first().get();
        if (firstPendingPullInto->m_buffer->isDetached()) {
            throwTypeError(globalObject, scope, "Cannot enqueue after the pending BYOB request's buffer has been detached"_s);
            return;
        }
        readableByteStreamControllerInvalidateBYOBRequest(controller);
        RefPtr<JSC::ArrayBuffer> transferredHeadBuffer = transferArrayBufferImpl(globalObject, *firstPendingPullInto->m_buffer);
        RETURN_IF_EXCEPTION(scope, void());
        firstPendingPullInto->m_buffer = WTF::move(transferredHeadBuffer);
        if (firstPendingPullInto->m_readerType == ReaderType::None) {
            readableByteStreamControllerEnqueueDetachedPullIntoToQueue(globalObject, controller, firstPendingPullInto);
            RETURN_IF_EXCEPTION(scope, void());
        }
    }
    if (readableStreamHasDefaultReader(stream)) {
        readableByteStreamControllerProcessReadRequestsUsingQueue(globalObject, controller);
        RETURN_IF_EXCEPTION(scope, void());
        if (!readableStreamGetNumReadRequests(stream)) {
            ASSERT(controller->m_pendingPullIntos.isEmpty());
            readableByteStreamControllerEnqueueChunkToQueue(controller, WTF::move(transferredBuffer), byteOffset, byteLength);
        } else {
            ASSERT(controller->m_queue.isEmpty());
            if (!controller->m_pendingPullIntos.isEmpty()) {
                ASSERT(controller->m_pendingPullIntos.first()->m_readerType == ReaderType::Default);
                readableByteStreamControllerShiftPendingPullInto(controller);
            }
            JSArrayBufferView* transferredView = constructViewOfType(globalObject, JSC::TypeUint8, WTF::move(transferredBuffer), byteOffset, byteLength);
            RETURN_IF_EXCEPTION(scope, void());
            readableStreamFulfillReadRequest(globalObject, stream, transferredView, false);
            RETURN_IF_EXCEPTION(scope, void());
        }
    } else if (readableStreamHasBYOBReader(stream)) {
        readableByteStreamControllerEnqueueChunkToQueue(controller, WTF::move(transferredBuffer), byteOffset, byteLength);
        MarkedArgumentBuffer filledPullIntos;
        readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller, filledPullIntos);
        if (filledPullIntos.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return;
        }
        for (size_t i = 0, count = filledPullIntos.size(); i < count; ++i) {
            readableByteStreamControllerCommitPullIntoDescriptor(globalObject, stream, uncheckedDowncast<JSPullIntoDescriptor>(filledPullIntos.at(i)));
            RETURN_IF_EXCEPTION(scope, void());
        }
    } else {
        ASSERT(!isReadableStreamLocked(stream));
        readableByteStreamControllerEnqueueChunkToQueue(controller, WTF::move(transferredBuffer), byteOffset, byteLength);
    }
    RELEASE_AND_RETURN(scope, readableByteStreamControllerCallPullIfNeeded(globalObject, controller));
}

void readableByteStreamControllerEnqueueChunkToQueue(JSReadableByteStreamController* controller, RefPtr<JSC::ArrayBuffer>&& buffer, size_t byteOffset, size_t byteLength)
{
    {
        WTF::Locker locker { controller->cellLock() };
        controller->m_queue.append(locker, ByteQueueEntry { WTF::move(buffer), byteOffset, byteLength });
    }
    controller->m_queue.adjustTotalSize(static_cast<double>(byteLength));
}

void readableByteStreamControllerEnqueueClonedChunkToQueue(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, JSC::ArrayBuffer& buffer, size_t byteOffset, size_t byteLength)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RefPtr<JSC::ArrayBuffer> cloneResult;
    {
        // CloneArrayBuffer is interpreted as a completion record: an abrupt completion errors
        // the controller and is then rethrown.
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        cloneResult = cloneArrayBuffer(vm, globalObject, buffer, byteOffset, byteLength);
        if (catchScope.exception()) [[unlikely]] {
            JSValue thrown = takeAbruptCompletion(globalObject, catchScope);
            if (thrown.isEmpty()) [[unlikely]]
                return;
            readableByteStreamControllerError(globalObject, controller, thrown);
            RETURN_IF_EXCEPTION(scope, void());
            throwException(globalObject, scope, thrown);
            return;
        }
    }
    readableByteStreamControllerEnqueueChunkToQueue(controller, WTF::move(cloneResult), 0, byteLength);
}

void readableByteStreamControllerEnqueueDetachedPullIntoToQueue(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, JSPullIntoDescriptor* pullIntoDescriptor)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(pullIntoDescriptor->m_readerType == ReaderType::None);
    const size_t bytesFilled = pullIntoDescriptor->m_bytesFilled;
    if (bytesFilled > 0) {
        readableByteStreamControllerEnqueueClonedChunkToQueue(globalObject, controller, *pullIntoDescriptor->m_buffer, pullIntoDescriptor->m_byteOffset, bytesFilled);
        RETURN_IF_EXCEPTION(scope, void());
    }
    readableByteStreamControllerShiftPendingPullInto(controller);
}

void readableByteStreamControllerError(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSReadableStream* stream = controller->m_stream.get();
    if (stream->m_state != ReadableStreamState::Readable)
        return;
    readableByteStreamControllerClearPendingPullIntos(controller);
    {
        WTF::Locker locker { controller->cellLock() };
        controller->m_queue.resetQueue(locker);
    }
    readableByteStreamControllerClearAlgorithms(controller);
    RELEASE_AND_RETURN(scope, readableStreamError(globalObject, stream, error));
}

void readableByteStreamControllerFillHeadPullIntoDescriptor(JSReadableByteStreamController* controller, size_t size, JSPullIntoDescriptor* pullIntoDescriptor)
{
    ASSERT(controller->m_pendingPullIntos.isEmpty() || controller->m_pendingPullIntos.first().get() == pullIntoDescriptor);
    ASSERT(!controller->m_byobRequest);
    UNUSED_PARAM(controller);
    pullIntoDescriptor->m_bytesFilled += size;
}

bool readableByteStreamControllerFillPullIntoDescriptorFromQueue(JSReadableByteStreamController* controller, JSPullIntoDescriptor* pullIntoDescriptor)
{
    size_t elementSize = pullIntoDescriptor->elementSize();
    const size_t bytesFilled = pullIntoDescriptor->m_bytesFilled;
    size_t maxBytesToCopy = std::min(static_cast<size_t>(controller->m_queue.totalSize()), pullIntoDescriptor->m_byteLength - bytesFilled);
    size_t maxBytesFilled = bytesFilled + maxBytesToCopy;
    size_t totalBytesToCopyRemaining = maxBytesToCopy;
    bool ready = false;
    ASSERT(!pullIntoDescriptor->m_buffer->isDetached());
    ASSERT(bytesFilled < pullIntoDescriptor->m_minimumFill);
    size_t remainderBytes = maxBytesFilled % elementSize;
    size_t maxAlignedBytes = maxBytesFilled - remainderBytes;
    if (maxAlignedBytes >= pullIntoDescriptor->m_minimumFill) {
        totalBytesToCopyRemaining = maxAlignedBytes - bytesFilled;
        ready = true;
    }
    auto& queue = controller->m_queue;
    while (totalBytesToCopyRemaining > 0) {
        ByteQueueEntry& headOfQueue = queue.first();
        size_t bytesToCopy = std::min(totalBytesToCopyRemaining, headOfQueue.byteLength);
        size_t destStart = pullIntoDescriptor->m_byteOffset + pullIntoDescriptor->m_bytesFilled;
        JSC::ArrayBuffer* descriptorBuffer = pullIntoDescriptor->m_buffer.get();
        JSC::ArrayBuffer* queueBuffer = headOfQueue.buffer.get();
        size_t queueByteOffset = headOfQueue.byteOffset;
        RELEASE_ASSERT(canCopyDataBlockBytes(*descriptorBuffer, destStart, *queueBuffer, queueByteOffset, bytesToCopy));
        memcpy(static_cast<uint8_t*>(descriptorBuffer->data()) + destStart, static_cast<const uint8_t*>(queueBuffer->data()) + queueByteOffset, bytesToCopy);
        bool consumedHead = headOfQueue.byteLength == bytesToCopy;
        if (consumedHead) {
            WTF::Locker locker { controller->cellLock() };
            queue.removeFirst(locker);
        } else {
            headOfQueue.byteOffset += bytesToCopy;
            headOfQueue.byteLength -= bytesToCopy;
        }
        queue.adjustTotalSize(-static_cast<double>(bytesToCopy));
        readableByteStreamControllerFillHeadPullIntoDescriptor(controller, bytesToCopy, pullIntoDescriptor);
        totalBytesToCopyRemaining -= bytesToCopy;
    }
    if (!ready) {
        ASSERT(!controller->m_queue.totalSize());
        ASSERT(pullIntoDescriptor->m_bytesFilled > 0);
        ASSERT(pullIntoDescriptor->m_bytesFilled < pullIntoDescriptor->m_minimumFill);
    }
    return ready;
}

void readableByteStreamControllerFillReadRequestFromQueue(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, JSReadRequest* readRequest)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(controller->m_queue.totalSize() > 0);
    RefPtr<JSC::ArrayBuffer> buffer;
    size_t byteOffset;
    size_t byteLength;
    {
        WTF::Locker locker { controller->cellLock() };
        ByteQueueEntry& entry = controller->m_queue.first();
        buffer = WTF::move(entry.buffer);
        byteOffset = entry.byteOffset;
        byteLength = entry.byteLength;
        controller->m_queue.removeFirst(locker);
    }
    controller->m_queue.adjustTotalSize(-static_cast<double>(byteLength));
    readableByteStreamControllerHandleQueueDrain(globalObject, controller);
    RETURN_IF_EXCEPTION(scope, void());
    JSArrayBufferView* view = constructViewOfType(globalObject, JSC::TypeUint8, WTF::move(buffer), byteOffset, byteLength);
    RETURN_IF_EXCEPTION(scope, void());
    RELEASE_AND_RETURN(scope, readRequest->chunkSteps(globalObject, view));
}

JSReadableStreamBYOBRequest* readableByteStreamControllerGetBYOBRequest(JSGlobalObject* globalObject, JSReadableByteStreamController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!controller->m_byobRequest && !controller->m_pendingPullIntos.isEmpty()) {
        const JSPullIntoDescriptor* firstDescriptor = controller->m_pendingPullIntos.first().get();
        const size_t bytesFilled = firstDescriptor->m_bytesFilled;
        JSArrayBufferView* view = constructViewOfType(globalObject, JSC::TypeUint8, firstDescriptor->m_buffer, firstDescriptor->m_byteOffset + bytesFilled, firstDescriptor->m_byteLength - bytesFilled);
        RETURN_IF_EXCEPTION(scope, nullptr);
        auto* zigGlobalObject = defaultGlobalObject(globalObject);
        JSReadableStreamBYOBRequest* byobRequest = JSReadableStreamBYOBRequest::create(vm, getDOMStructure<JSReadableStreamBYOBRequest>(vm, *zigGlobalObject));
        byobRequest->m_controller.set(vm, byobRequest, controller);
        byobRequest->m_view.set(vm, byobRequest, view);
        controller->m_byobRequest.set(vm, controller, byobRequest);
    }
    return controller->m_byobRequest.get();
}

std::optional<double> readableByteStreamControllerGetDesiredSize(JSReadableByteStreamController* controller)
{
    switch (controller->m_stream->m_state) {
    case ReadableStreamState::Errored:
        return std::nullopt;
    case ReadableStreamState::Closed:
        return 0;
    case ReadableStreamState::Readable:
        break;
    }
    return controller->m_strategyHWM - controller->m_queue.totalSize();
}

void readableByteStreamControllerHandleQueueDrain(JSGlobalObject* globalObject, JSReadableByteStreamController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(controller->m_stream->m_state == ReadableStreamState::Readable);
    if (!controller->m_queue.totalSize() && controller->m_closeRequested) {
        readableByteStreamControllerClearAlgorithms(controller);
        RELEASE_AND_RETURN(scope, readableStreamClose(globalObject, controller->m_stream.get()));
    }
    RELEASE_AND_RETURN(scope, readableByteStreamControllerCallPullIfNeeded(globalObject, controller));
}

void readableByteStreamControllerInvalidateBYOBRequest(JSReadableByteStreamController* controller)
{
    JSReadableStreamBYOBRequest* byobRequest = controller->m_byobRequest.get();
    if (!byobRequest)
        return;
    byobRequest->m_controller.clear();
    byobRequest->m_view.clear();
    controller->m_byobRequest.clear();
}

void readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(JSReadableByteStreamController* controller, MarkedArgumentBuffer& filledPullIntos)
{
    ASSERT(!controller->m_closeRequested);
    while (!controller->m_pendingPullIntos.isEmpty()) {
        if (!controller->m_queue.totalSize())
            break;
        JSPullIntoDescriptor* pullIntoDescriptor = controller->m_pendingPullIntos.first().get();
        if (readableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor)) {
            readableByteStreamControllerShiftPendingPullInto(controller);
            filledPullIntos.append(pullIntoDescriptor);
        }
    }
}

void readableByteStreamControllerProcessReadRequestsUsingQueue(JSGlobalObject* globalObject, JSReadableByteStreamController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = uncheckedDowncast<JSReadableStreamDefaultReader>(controller->m_stream->m_reader.get());
    ASSERT(reader);
    while (!reader->m_readRequests.isEmpty()) {
        if (!controller->m_queue.totalSize())
            return;
        JSReadRequest* readRequest = nullptr;
        {
            WTF::Locker locker { reader->cellLock() };
            readRequest = reader->m_readRequests.takeFirst().get();
        }
        readableByteStreamControllerFillReadRequestFromQueue(globalObject, controller, readRequest);
        RETURN_IF_EXCEPTION(scope, void());
    }
}

void readableByteStreamControllerPullInto(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, JSArrayBufferView* view, uint64_t min, JSReadIntoRequest* readIntoRequest)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSReadableStream* stream = controller->m_stream.get();
    TypedArrayType ctor = typedArrayType(view->type());
    size_t elementSize = JSC::elementSize(ctor);
    size_t minimumFill = static_cast<size_t>(min) * elementSize;
    ASSERT(minimumFill <= view->byteLength());
    ASSERT(!(minimumFill % elementSize));
    size_t byteOffset = view->byteOffset();
    size_t byteLength = view->byteLength();
    RefPtr<JSC::ArrayBuffer> viewedBuffer = view->possiblySharedBuffer();
    RefPtr<JSC::ArrayBuffer> buffer;
    JSValue transferAbruptCompletion;
    {
        // "If bufferResult is an abrupt completion", route it to the read-into request's error steps.
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        buffer = transferArrayBufferImpl(globalObject, *viewedBuffer);
        if (catchScope.exception()) [[unlikely]] {
            transferAbruptCompletion = takeAbruptCompletion(globalObject, catchScope);
            if (transferAbruptCompletion.isEmpty()) [[unlikely]]
                return;
        }
    }
    if (!transferAbruptCompletion.isEmpty()) [[unlikely]]
        RELEASE_AND_RETURN(scope, readIntoRequest->errorSteps(globalObject, transferAbruptCompletion));
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSPullIntoDescriptor* pullIntoDescriptor = JSPullIntoDescriptor::create(vm, JSStreamsRuntime::from(globalObject)->pullIntoDescriptorStructure(zigGlobalObject));
    pullIntoDescriptor->m_bufferByteLength = buffer->byteLength();
    pullIntoDescriptor->m_buffer = WTF::move(buffer);
    pullIntoDescriptor->m_byteOffset = byteOffset;
    pullIntoDescriptor->m_byteLength = byteLength;
    pullIntoDescriptor->m_bytesFilled = 0;
    pullIntoDescriptor->m_minimumFill = minimumFill;
    pullIntoDescriptor->m_viewConstructor = ctor;
    pullIntoDescriptor->m_readerType = ReaderType::Byob;
    if (!controller->m_pendingPullIntos.isEmpty()) {
        {
            WTF::Locker locker { controller->cellLock() };
            controller->m_pendingPullIntos.append(WriteBarrier<JSPullIntoDescriptor>(vm, controller, pullIntoDescriptor));
        }
        readableStreamAddReadIntoRequest(vm, stream, readIntoRequest);
        return;
    }
    if (stream->m_state == ReadableStreamState::Closed) {
        JSArrayBufferView* emptyView = constructViewOfType(globalObject, ctor, pullIntoDescriptor->m_buffer, pullIntoDescriptor->m_byteOffset, 0);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, readIntoRequest->closeSteps(globalObject, emptyView));
    }
    if (controller->m_queue.totalSize() > 0) {
        if (readableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor)) {
            JSArrayBufferView* filledView = readableByteStreamControllerConvertPullIntoDescriptor(globalObject, pullIntoDescriptor);
            RETURN_IF_EXCEPTION(scope, void());
            readableByteStreamControllerHandleQueueDrain(globalObject, controller);
            RETURN_IF_EXCEPTION(scope, void());
            RELEASE_AND_RETURN(scope, readIntoRequest->chunkSteps(globalObject, filledView));
        }
        if (controller->m_closeRequested) {
            JSObject* error = createTypeError(globalObject, "Cannot read into a view after close has been requested on the ReadableByteStreamController"_s);
            readableByteStreamControllerError(globalObject, controller, error);
            RETURN_IF_EXCEPTION(scope, void());
            RELEASE_AND_RETURN(scope, readIntoRequest->errorSteps(globalObject, error));
        }
    }
    {
        WTF::Locker locker { controller->cellLock() };
        controller->m_pendingPullIntos.append(WriteBarrier<JSPullIntoDescriptor>(vm, controller, pullIntoDescriptor));
    }
    readableStreamAddReadIntoRequest(vm, stream, readIntoRequest);
    RELEASE_AND_RETURN(scope, readableByteStreamControllerCallPullIfNeeded(globalObject, controller));
}

void readableByteStreamControllerRespond(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, uint64_t bytesWritten)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(!controller->m_pendingPullIntos.isEmpty());
    JSPullIntoDescriptor* firstDescriptor = controller->m_pendingPullIntos.first().get();
    ReadableStreamState state = controller->m_stream->m_state;
    if (state == ReadableStreamState::Closed) {
        if (bytesWritten) {
            throwTypeError(globalObject, scope, "A closed byte stream's BYOB request can only be responded to with 0 bytes written"_s);
            return;
        }
    } else {
        ASSERT(state == ReadableStreamState::Readable);
        if (!bytesWritten) {
            throwTypeError(globalObject, scope, "A readable byte stream's BYOB request cannot be responded to with 0 bytes written"_s);
            return;
        }
        if (static_cast<uint64_t>(firstDescriptor->m_bytesFilled) + bytesWritten > static_cast<uint64_t>(firstDescriptor->m_byteLength)) {
            throwRangeError(globalObject, scope, "The number of bytes written exceeds the remaining length of the BYOB request's view"_s);
            return;
        }
    }
    RefPtr<JSC::ArrayBuffer> transferredBuffer = transferArrayBufferImpl(globalObject, *firstDescriptor->m_buffer);
    RETURN_IF_EXCEPTION(scope, void());
    firstDescriptor->m_buffer = WTF::move(transferredBuffer);
    RELEASE_AND_RETURN(scope, readableByteStreamControllerRespondInternal(globalObject, controller, bytesWritten));
}

void readableByteStreamControllerRespondInClosedState(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, JSPullIntoDescriptor* firstDescriptor)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(!(firstDescriptor->m_bytesFilled % firstDescriptor->elementSize()));
    if (firstDescriptor->m_readerType == ReaderType::None)
        readableByteStreamControllerShiftPendingPullInto(controller);
    JSReadableStream* stream = controller->m_stream.get();
    if (readableStreamHasBYOBReader(stream)) {
        MarkedArgumentBuffer filledPullIntos;
        while (filledPullIntos.size() < readableStreamGetNumReadIntoRequests(stream))
            filledPullIntos.append(readableByteStreamControllerShiftPendingPullInto(controller));
        if (filledPullIntos.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return;
        }
        for (size_t i = 0, count = filledPullIntos.size(); i < count; ++i) {
            readableByteStreamControllerCommitPullIntoDescriptor(globalObject, stream, uncheckedDowncast<JSPullIntoDescriptor>(filledPullIntos.at(i)));
            RETURN_IF_EXCEPTION(scope, void());
        }
    }
}

void readableByteStreamControllerRespondInReadableState(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, uint64_t bytesWritten, JSPullIntoDescriptor* pullIntoDescriptor)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(pullIntoDescriptor->m_bytesFilled + bytesWritten <= pullIntoDescriptor->m_byteLength);
    readableByteStreamControllerFillHeadPullIntoDescriptor(controller, static_cast<size_t>(bytesWritten), pullIntoDescriptor);
    if (pullIntoDescriptor->m_readerType == ReaderType::None) {
        readableByteStreamControllerEnqueueDetachedPullIntoToQueue(globalObject, controller, pullIntoDescriptor);
        RETURN_IF_EXCEPTION(scope, void());
        MarkedArgumentBuffer filledPullIntos;
        readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller, filledPullIntos);
        if (filledPullIntos.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return;
        }
        for (size_t i = 0, count = filledPullIntos.size(); i < count; ++i) {
            readableByteStreamControllerCommitPullIntoDescriptor(globalObject, controller->m_stream.get(), uncheckedDowncast<JSPullIntoDescriptor>(filledPullIntos.at(i)));
            RETURN_IF_EXCEPTION(scope, void());
        }
        return;
    }
    const size_t bytesFilled = pullIntoDescriptor->m_bytesFilled;
    if (bytesFilled < pullIntoDescriptor->m_minimumFill)
        return;
    readableByteStreamControllerShiftPendingPullInto(controller);
    size_t remainderSize = bytesFilled % pullIntoDescriptor->elementSize();
    if (remainderSize > 0) {
        size_t end = pullIntoDescriptor->m_byteOffset + bytesFilled;
        readableByteStreamControllerEnqueueClonedChunkToQueue(globalObject, controller, *pullIntoDescriptor->m_buffer, end - remainderSize, remainderSize);
        RETURN_IF_EXCEPTION(scope, void());
    }
    pullIntoDescriptor->m_bytesFilled -= remainderSize;
    MarkedArgumentBuffer filledPullIntos;
    readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller, filledPullIntos);
    if (filledPullIntos.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return;
    }
    readableByteStreamControllerCommitPullIntoDescriptor(globalObject, controller->m_stream.get(), pullIntoDescriptor);
    RETURN_IF_EXCEPTION(scope, void());
    for (size_t i = 0, count = filledPullIntos.size(); i < count; ++i) {
        readableByteStreamControllerCommitPullIntoDescriptor(globalObject, controller->m_stream.get(), uncheckedDowncast<JSPullIntoDescriptor>(filledPullIntos.at(i)));
        RETURN_IF_EXCEPTION(scope, void());
    }
}

void readableByteStreamControllerRespondInternal(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, uint64_t bytesWritten)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSPullIntoDescriptor* firstDescriptor = controller->m_pendingPullIntos.first().get();
    ASSERT(canTransferArrayBuffer(*firstDescriptor->m_buffer));
    readableByteStreamControllerInvalidateBYOBRequest(controller);
    ReadableStreamState state = controller->m_stream->m_state;
    if (state == ReadableStreamState::Closed) {
        ASSERT(!bytesWritten);
        readableByteStreamControllerRespondInClosedState(globalObject, controller, firstDescriptor);
        RETURN_IF_EXCEPTION(scope, void());
    } else {
        ASSERT(state == ReadableStreamState::Readable);
        ASSERT(bytesWritten > 0);
        readableByteStreamControllerRespondInReadableState(globalObject, controller, bytesWritten, firstDescriptor);
        RETURN_IF_EXCEPTION(scope, void());
    }
    RELEASE_AND_RETURN(scope, readableByteStreamControllerCallPullIfNeeded(globalObject, controller));
}

void readableByteStreamControllerRespondWithNewView(JSGlobalObject* globalObject, JSReadableByteStreamController* controller, JSArrayBufferView* view)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(!controller->m_pendingPullIntos.isEmpty());
    ASSERT(!view->isDetached());
    JSPullIntoDescriptor* firstDescriptor = controller->m_pendingPullIntos.first().get();
    ReadableStreamState state = controller->m_stream->m_state;
    size_t viewByteLength = view->byteLength();
    if (state == ReadableStreamState::Closed) {
        if (viewByteLength) {
            throwTypeError(globalObject, scope, "A closed byte stream's BYOB request can only be responded to with a zero-length view"_s);
            return;
        }
    } else {
        ASSERT(state == ReadableStreamState::Readable);
        if (!viewByteLength) {
            throwTypeError(globalObject, scope, "A readable byte stream's BYOB request cannot be responded to with a zero-length view"_s);
            return;
        }
    }
    const size_t bytesFilled = firstDescriptor->m_bytesFilled;
    if (firstDescriptor->m_byteOffset + bytesFilled != view->byteOffset()) {
        Bun::ERR::INVALID_ARG_VALUE_RangeError(scope, globalObject, "view"_s, view, "must match the BYOB request's current write position"_s);
        return;
    }
    RefPtr<JSC::ArrayBuffer> viewedBuffer = view->possiblySharedBuffer();
    if (firstDescriptor->m_bufferByteLength != viewedBuffer->byteLength()) {
        Bun::ERR::INVALID_ARG_VALUE_RangeError(scope, globalObject, "view"_s, view, "must have the same buffer length as the BYOB request"_s);
        return;
    }
    if (bytesFilled + viewByteLength > firstDescriptor->m_byteLength) {
        Bun::ERR::INVALID_ARG_VALUE_RangeError(scope, globalObject, "view"_s, view, "must not exceed the remaining length of the BYOB request"_s);
        return;
    }
    RefPtr<JSC::ArrayBuffer> transferredBuffer = transferArrayBufferImpl(globalObject, *viewedBuffer);
    RETURN_IF_EXCEPTION(scope, void());
    firstDescriptor->m_buffer = WTF::move(transferredBuffer);
    RELEASE_AND_RETURN(scope, readableByteStreamControllerRespondInternal(globalObject, controller, viewByteLength));
}

JSPullIntoDescriptor* readableByteStreamControllerShiftPendingPullInto(JSReadableByteStreamController* controller)
{
    ASSERT(!controller->m_byobRequest);
    WTF::Locker locker { controller->cellLock() };
    return controller->m_pendingPullIntos.takeFirst().get();
}

} // namespace WebStreams
} // namespace Bun
