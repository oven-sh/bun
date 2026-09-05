#include "config.h"
#include "JSReadableStreamDefaultController.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSReadRequest.h"
#include "JSReadableStream.h"
#include "JSStreamTeeState.h"
#include "JSStreamsRuntime.h"
#include "JSTransformStream.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"

#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ExceptionHelpers.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <limits>
#include <wtf/Locker.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;

// The [[pullAlgorithm]] dispatch.
// Returns nullptr with no exception pending when the pull completed synchronously with a
// non-thenable result: the caller queues the upon-fulfillment handler without a wrapper promise.
static JSC::JSPromise* performDefaultControllerPullAlgorithm(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller)
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
        RELEASE_AND_RETURN(scope, invokeCallbackReturningPromiseFast(globalObject, pullMethod, controller->m_algorithms.underlyingObject.get(), args));
    }
    case SourceKind::Nothing:
        return nullptr;
    case SourceKind::Transform:
        RELEASE_AND_RETURN(scope, transformStreamDefaultSourcePullAlgorithm(globalObject, uncheckedDowncast<JSTransformStream>(controller->m_algorithms.algorithmContext.get())));
    case SourceKind::TeeBranch:
        RELEASE_AND_RETURN(scope, defaultTeePullAlgorithm(globalObject, uncheckedDowncast<JSStreamTeeState>(controller->m_algorithms.algorithmContext.get()), controller->m_algorithms.teeBranchIndex));
    case SourceKind::FromIterable:
        RELEASE_AND_RETURN(scope, fromIterablePullAlgorithm(globalObject, controller));
    case SourceKind::Native:
        RELEASE_AND_RETURN(scope, nativeSourcePull(globalObject, controller));
    case SourceKind::TextDecode:
        RELEASE_AND_RETURN(scope, textDecodePullAlgorithm(globalObject, controller));
    case SourceKind::ByteTeeBranch:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
    return nullptr;
}

// The [[cancelAlgorithm]] dispatch. Same reachable kind set as the pull dispatch.
static JSC::JSPromise* performDefaultControllerCancelAlgorithm(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller, JSC::JSValue reason)
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
        RELEASE_AND_RETURN(scope, invokeCallbackReturningPromise(globalObject, cancelMethod, controller->m_algorithms.underlyingObject.get(), args));
    }
    case SourceKind::Nothing:
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    case SourceKind::Transform:
        RELEASE_AND_RETURN(scope, transformStreamDefaultSourceCancelAlgorithm(globalObject, uncheckedDowncast<JSTransformStream>(controller->m_algorithms.algorithmContext.get()), reason));
    case SourceKind::TeeBranch:
        RELEASE_AND_RETURN(scope, defaultTeeCancelAlgorithm(globalObject, uncheckedDowncast<JSStreamTeeState>(controller->m_algorithms.algorithmContext.get()), controller->m_algorithms.teeBranchIndex, reason));
    case SourceKind::FromIterable:
        RELEASE_AND_RETURN(scope, fromIterableCancelAlgorithm(globalObject, controller, reason));
    case SourceKind::Native:
        RELEASE_AND_RETURN(scope, nativeSourceCancel(globalObject, controller, reason));
    case SourceKind::TextDecode:
        RELEASE_AND_RETURN(scope, textDecodeCancelAlgorithm(globalObject, controller, reason));
    case SourceKind::ByteTeeBranch:
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

static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamDefaultControllerConstructorGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamDefaultControllerPrototypeGetter_desiredSize);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeFunction_close);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeFunction_enqueue);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeFunction_error);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototype_inspectCustom);

class JSReadableStreamDefaultControllerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSReadableStreamDefaultControllerPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSReadableStreamDefaultControllerPrototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSReadableStreamDefaultControllerPrototype))) JSReadableStreamDefaultControllerPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamDefaultControllerPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSReadableStreamDefaultControllerPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamDefaultControllerPrototype, JSReadableStreamDefaultControllerPrototype::Base);

static const HashTableValue JSReadableStreamDefaultControllerPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamDefaultControllerConstructorGetter, 0 } },
    { "desiredSize"_s, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor, NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamDefaultControllerPrototypeGetter_desiredSize, 0 } },
    { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamDefaultControllerPrototypeFunction_close, 0 } },
    { "enqueue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamDefaultControllerPrototypeFunction_enqueue, 0 } },
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamDefaultControllerPrototypeFunction_error, 0 } },
};

const ClassInfo JSReadableStreamDefaultControllerPrototype::s_info = { "ReadableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultControllerPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSReadableStreamDefaultController>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    (void)thisObject;
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "ReadableStreamDefaultController"_s, data));
}

void JSReadableStreamDefaultControllerPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSReadableStreamDefaultController::info(), JSReadableStreamDefaultControllerPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsReadableStreamDefaultControllerPrototype_inspectCustom);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

template<> const ClassInfo JSReadableStreamDefaultControllerConstructor::s_info = { "ReadableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultControllerConstructor) };

template<> JSValue JSReadableStreamDefaultControllerConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    UNUSED_PARAM(vm);
    return globalObject.functionPrototype();
}

template<> void JSReadableStreamDefaultControllerConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    initializeBaseProperties(vm, 0, "ReadableStreamDefaultController"_s, JSReadableStreamDefaultController::prototype(vm, globalObject));
}

const ClassInfo JSReadableStreamDefaultController::s_info = { "ReadableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultController) };

JSReadableStreamDefaultController::JSReadableStreamDefaultController(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSReadableStreamDefaultController::~JSReadableStreamDefaultController() = default;

void JSReadableStreamDefaultController::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSReadableStreamDefaultController* JSReadableStreamDefaultController::create(VM& vm, Structure* structure)
{
    JSReadableStreamDefaultController* controller = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultController>(vm)) JSReadableStreamDefaultController(vm, structure);
    controller->finishCreation(vm);
    return controller;
}

void JSReadableStreamDefaultController::destroy(JSCell* cell)
{
    static_cast<JSReadableStreamDefaultController*>(cell)->JSReadableStreamDefaultController::~JSReadableStreamDefaultController();
}

Structure* JSReadableStreamDefaultController::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSReadableStreamDefaultController::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSReadableStreamDefaultControllerPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSReadableStreamDefaultControllerPrototype::create(vm, &globalObject, structure);
}

JSObject* JSReadableStreamDefaultController::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSReadableStreamDefaultController>(vm, globalObject);
}

JSValue JSReadableStreamDefaultController::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSReadableStreamDefaultControllerConstructor, DOMConstructorID::ReadableStreamDefaultController>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSReadableStreamDefaultController::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamDefaultController, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForReadableStreamDefaultController, m_subspaceForReadableStreamDefaultController));
}

template<typename Visitor>
void JSReadableStreamDefaultController::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamDefaultController>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_algorithms.underlyingObject);
    visitor.appendHidden(thisObject->m_algorithms.method1);
    visitor.appendHidden(thisObject->m_algorithms.method2);
    visitor.appendHidden(thisObject->m_algorithms.algorithmContext);
    visitor.appendHidden(thisObject->m_strategySizeAlgorithm);
    WTF::Locker locker { thisObject->cellLock() };
    thisObject->m_queue.visit(locker, visitor);
}

DEFINE_VISIT_CHILDREN(JSReadableStreamDefaultController);

void JSReadableStreamDefaultController::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamDefaultController>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_strategySizeAlgorithm, "strategySizeAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.underlyingObject, "underlyingSource"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.method1, "pullAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.method2, "cancelAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.algorithmContext, "algorithmContext"_s);
    WTF::Locker locker { thisObject->cellLock() };
    thisObject->m_queue.analyzeHeap(locker, cell, analyzer);
}

// [[CancelSteps]](reason)
JSPromise* JSReadableStreamDefaultController::cancelSteps(JSGlobalObject* globalObject, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    {
        WTF::Locker locker { cellLock() };
        m_queue.resetQueue(locker);
    }
    JSPromise* result = performDefaultControllerCancelAlgorithm(vm, globalObject, this, reason);
    RETURN_IF_EXCEPTION(scope, nullptr);
    readableStreamDefaultControllerClearAlgorithms(this);
    return result;
}

JSValue JSReadableStreamDefaultController::dequeueChunkForRead(JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    ASSERT(!m_queue.isEmpty());
    JSValue chunk;
    {
        WTF::Locker locker { cellLock() };
        chunk = m_queue.dequeueValue(locker);
    }
    if (m_closeRequested && m_queue.isEmpty()) {
        readableStreamDefaultControllerClearAlgorithms(this);
        readableStreamClose(globalObject, m_stream.get());
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        readableStreamDefaultControllerCallPullIfNeeded(globalObject, this);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return chunk;
}

// [[PullSteps]](readRequest)
void JSReadableStreamDefaultController::pullSteps(JSGlobalObject* globalObject, JSReadRequest* readRequest)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSReadableStream* stream = m_stream.get();
    if (!m_queue.isEmpty()) {
        JSValue chunk = dequeueChunkForRead(globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, readRequest->chunkSteps(globalObject, chunk));
    }
    readableStreamAddReadRequest(vm, stream, readRequest);
    RELEASE_AND_RETURN(scope, readableStreamDefaultControllerCallPullIfNeeded(globalObject, this));
}

// [[ReleaseSteps]]()
void JSReadableStreamDefaultController::releaseSteps()
{
}

// The shared start/pull reaction handlers ([reaction-convention]; context at argument(1)).

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onRSDefaultControllerStartFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSReadableStreamDefaultController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    controller->m_started = true;
    ASSERT(!controller->m_pulling);
    ASSERT(!controller->m_pullAgain);
    readableStreamDefaultControllerCallPullIfNeeded(globalObject, controller);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onRSDefaultControllerStartRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSReadableStreamDefaultController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    readableStreamDefaultControllerError(globalObject, controller, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onRSDefaultControllerPullFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSReadableStreamDefaultController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    controller->m_pulling = false;
    if (controller->m_pullAgain) {
        controller->m_pullAgain = false;
        readableStreamDefaultControllerCallPullIfNeeded(globalObject, controller);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onRSDefaultControllerPullRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSReadableStreamDefaultController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    readableStreamDefaultControllerError(globalObject, controller, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// Prototype accessors & methods.

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamDefaultControllerConstructorGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSReadableStreamDefaultControllerPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(globalObject, scope);
    return JSValue::encode(JSReadableStreamDefaultController::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamDefaultControllerPrototypeGetter_desiredSize, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSReadableStreamDefaultController>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ReadableStreamDefaultController"_s);
    std::optional<double> desiredSize = readableStreamDefaultControllerGetDesiredSize(thisObject);
    if (!desiredSize)
        return JSValue::encode(jsNull());
    return JSValue::encode(jsNumber(*desiredSize));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeFunction_close, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSReadableStreamDefaultController>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ReadableStreamDefaultController"_s);
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(thisObject))
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Controller is already closed"_s);
    readableStreamDefaultControllerClose(globalObject, thisObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeFunction_enqueue, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSReadableStreamDefaultController>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ReadableStreamDefaultController"_s);
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(thisObject))
        return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Controller is already closed"_s);
    readableStreamDefaultControllerEnqueue(globalObject, thisObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeFunction_error, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSReadableStreamDefaultController>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ReadableStreamDefaultController"_s);
    readableStreamDefaultControllerError(globalObject, thisObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using namespace WebCore;

void readableStreamDefaultControllerCallPullIfNeeded(JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!readableStreamDefaultControllerShouldCallPull(controller))
        return;
    if (controller->m_pulling) {
        controller->m_pullAgain = true;
        return;
    }
    ASSERT(!controller->m_pullAgain);
    controller->m_pulling = true;
    JSPromise* pullPromise = performDefaultControllerPullAlgorithm(vm, globalObject, controller);
    RETURN_IF_EXCEPTION(scope, void());
    auto* runtime = JSStreamsRuntime::from(globalObject);
    // A non-thenable return, or an already-fulfilled promise from an internal pull arm,
    // completed synchronously: queue the upon-fulfillment handler directly, saving the
    // wrapper promise and performPromiseThen reactions while keeping the spec's microtask
    // boundary (m_pulling stays set until then, so pull-call count is unchanged).
    if (!pullPromise || pullPromise->status() == JSPromise::Status::Fulfilled)
        return queueStreamsMicrotask(globalObject, runtime->onRSDefaultControllerPullFulfilled(), jsUndefined(), controller);
    pullPromise->performPromiseThenWithContext(vm, globalObject, runtime->onRSDefaultControllerPullFulfilled(), runtime->onRSDefaultControllerPullRejected(), jsUndefined(), controller);
}

bool readableStreamDefaultControllerShouldCallPull(JSReadableStreamDefaultController* controller)
{
    JSReadableStream* stream = controller->m_stream.get();
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller))
        return false;
    if (!controller->m_started)
        return false;
    if (readableStreamHasDefaultReader(stream) && readableStreamGetNumReadRequests(stream) > 0)
        return true;
    std::optional<double> desiredSize = readableStreamDefaultControllerGetDesiredSize(controller);
    ASSERT(desiredSize);
    return *desiredSize > 0;
}

void readableStreamDefaultControllerClearAlgorithms(JSReadableStreamDefaultController* controller)
{
    controller->m_algorithms.kind = SourceKind::Nothing;
    controller->m_algorithms.underlyingObject.clear();
    controller->m_algorithms.method1.clear();
    controller->m_algorithms.method2.clear();
    controller->m_algorithms.algorithmContext.clear();
    controller->m_strategySizeAlgorithm.clear();
    if (auto* stream = controller->m_stream.get())
        readableStreamClearSourceBarriers(stream);
}

void readableStreamDefaultControllerClose(JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller))
        return;
    JSReadableStream* stream = controller->m_stream.get();
    controller->m_closeRequested = true;
    if (controller->m_queue.isEmpty()) {
        readableStreamDefaultControllerClearAlgorithms(controller);
        RELEASE_AND_RETURN(scope, readableStreamClose(globalObject, stream));
    }
}

void readableStreamDefaultControllerEnqueue(JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller))
        return;
    JSReadableStream* stream = controller->m_stream.get();
    if (readableStreamHasDefaultReader(stream) && readableStreamGetNumReadRequests(stream) > 0) {
        readableStreamFulfillReadRequest(globalObject, stream, chunk, false);
        RETURN_IF_EXCEPTION(scope, void());
    } else {
        double chunkSize = 1;
        if (JSObject* sizeAlgorithm = controller->m_strategySizeAlgorithm.get()) {
            auto callData = JSC::getCallData(sizeAlgorithm);
            ASSERT(callData.type != JSC::CallData::Type::None);
            JSC::MarkedArgumentBuffer args;
            args.append(chunk);
            if (args.hasOverflowed()) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return;
            }
            JSValue chunkSizeValue = JSC::call(globalObject, sizeAlgorithm, callData, jsUndefined(), args);
            // Web IDL: the size callback returns an `unrestricted double` — a full ToNumber.
            if (!scope.exception()) [[likely]]
                chunkSize = chunkSizeValue.toNumber(globalObject);
        }
        if (!scope.exception()) [[likely]]
            controller->m_queue.enqueueValueWithSize(globalObject, controller, chunk, chunkSize);
        if (JSC::Exception* exception = scope.exception()) [[unlikely]] {
            // Spec steps 4.b / 5.b: "If result is an abrupt completion, perform
            // ! ReadableStreamDefaultControllerError(controller, result.[[Value]]) and return result."
            TRY_CLEAR_EXCEPTION(scope, );
            readableStreamDefaultControllerError(globalObject, controller, exception->value());
            RETURN_IF_EXCEPTION(scope, );
            throwException(globalObject, scope, exception);
            return;
        }
    }
    RELEASE_AND_RETURN(scope, readableStreamDefaultControllerCallPullIfNeeded(globalObject, controller));
}

void readableStreamDefaultControllerError(JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSReadableStream* stream = controller->m_stream.get();
    if (stream->m_state != ReadableStreamState::Readable)
        return;
    {
        WTF::Locker locker { controller->cellLock() };
        controller->m_queue.resetQueue(locker);
    }
    readableStreamDefaultControllerClearAlgorithms(controller);
    RELEASE_AND_RETURN(scope, readableStreamError(globalObject, stream, error));
}

std::optional<double> readableStreamDefaultControllerGetDesiredSize(JSReadableStreamDefaultController* controller)
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

bool readableStreamDefaultControllerHasBackpressure(JSReadableStreamDefaultController* controller)
{
    return !readableStreamDefaultControllerShouldCallPull(controller);
}

bool readableStreamDefaultControllerCanCloseOrEnqueue(JSReadableStreamDefaultController* controller)
{
    return !controller->m_closeRequested && controller->m_stream->m_state == ReadableStreamState::Readable;
}

} // namespace WebStreams
} // namespace Bun
