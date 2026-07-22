#include "config.h"
#include "JSWritableStreamDefaultController.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSAbortController.h"
#include "JSAbortSignal.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSStreamsRuntime.h"
#include "JSTransformStream.h"
#include "JSWritableStream.h"
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
#include <JavaScriptCore/TopExceptionScope.h>
#include <wtf/Locker.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;

// As invokePromiseReturningMethod, but returns nullptr for a synchronous non-thenable completion
// and returns a vanilla JSPromise unwrapped (isThenFastAndNonObservable); the caller queues the
// upon-fulfillment handler directly when the result is nullptr or already Fulfilled.
static JSC::JSPromise* invokePromiseReturningMethodFast(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* method, JSC::JSValue thisValue, const JSC::MarkedArgumentBuffer& args)
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

// The [[writeAlgorithm]] dispatch. The reachable SinkKind set on a writable default
// controller is {JavaScript, Nothing, Transform} (CrossRealm: transferable streams are not
// implemented, so setUpCrossRealmTransformWritable never creates one).
// Returns nullptr with no exception pending when the write completed synchronously with a
// non-thenable result: the caller queues the upon-fulfillment handler without a wrapper promise.
static JSC::JSPromise* performWriteAlgorithm(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller, JSC::JSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (controller->m_algorithms.kind) {
    case SinkKind::JavaScript: {
        JSC::JSObject* writeMethod = controller->m_algorithms.method1.get();
        if (!writeMethod)
            return nullptr;
        JSC::MarkedArgumentBuffer args;
        args.append(chunk);
        args.append(controller);
        if (args.hasOverflowed()) [[unlikely]] {
            JSC::throwOutOfMemoryError(globalObject, scope);
            return nullptr;
        }
        RELEASE_AND_RETURN(scope, invokePromiseReturningMethodFast(vm, globalObject, writeMethod, controller->m_algorithms.underlyingObject.get(), args));
    }
    case SinkKind::Nothing:
        return nullptr;
    case SinkKind::Transform:
        RELEASE_AND_RETURN(scope, transformStreamDefaultSinkWriteAlgorithm(globalObject, uncheckedDowncast<JSTransformStream>(controller->m_algorithms.algorithmContext.get()), chunk));
    case SinkKind::CrossRealm:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
    return nullptr;
}

// The [[closeAlgorithm]] dispatch. Same reachable kind set as the write dispatch.
// Returns nullptr with no exception pending when the close completed synchronously with a
// non-thenable result: the caller queues the upon-fulfillment handler without a wrapper promise.
static JSC::JSPromise* performCloseAlgorithm(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (controller->m_algorithms.kind) {
    case SinkKind::JavaScript: {
        JSC::JSObject* closeMethod = controller->m_algorithms.method2.get();
        if (!closeMethod)
            return nullptr;
        JSC::MarkedArgumentBuffer args;
        RELEASE_AND_RETURN(scope, invokePromiseReturningMethodFast(vm, globalObject, closeMethod, controller->m_algorithms.underlyingObject.get(), args));
    }
    case SinkKind::Nothing:
        return nullptr;
    case SinkKind::Transform:
        RELEASE_AND_RETURN(scope, transformStreamDefaultSinkCloseAlgorithm(globalObject, uncheckedDowncast<JSTransformStream>(controller->m_algorithms.algorithmContext.get())));
    case SinkKind::CrossRealm:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
    return nullptr;
}

// The [[abortAlgorithm]] dispatch. Same reachable kind set as the write dispatch.
static JSC::JSPromise* performAbortAlgorithm(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller, JSC::JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (controller->m_algorithms.kind) {
    case SinkKind::JavaScript: {
        JSC::JSObject* abortMethod = controller->m_algorithms.method3.get();
        if (!abortMethod)
            RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
        JSC::MarkedArgumentBuffer args;
        args.append(reason);
        if (args.hasOverflowed()) [[unlikely]] {
            JSC::throwOutOfMemoryError(globalObject, scope);
            return nullptr;
        }
        RELEASE_AND_RETURN(scope, invokePromiseReturningMethod(vm, globalObject, abortMethod, controller->m_algorithms.underlyingObject.get(), args));
    }
    case SinkKind::Nothing:
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    case SinkKind::Transform:
        RELEASE_AND_RETURN(scope, transformStreamDefaultSinkAbortAlgorithm(globalObject, uncheckedDowncast<JSTransformStream>(controller->m_algorithms.algorithmContext.get()), reason));
    case SinkKind::CrossRealm:
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

static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultControllerConstructorGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultControllerPrototypeGetter_signal);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultControllerPrototypeFunction_error);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultControllerPrototype_inspectCustom);

class JSWritableStreamDefaultControllerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSWritableStreamDefaultControllerPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSWritableStreamDefaultControllerPrototype* ptr = new (NotNull, JSC::allocateCell<JSWritableStreamDefaultControllerPrototype>(vm)) JSWritableStreamDefaultControllerPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamDefaultControllerPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSWritableStreamDefaultControllerPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamDefaultControllerPrototype, JSWritableStreamDefaultControllerPrototype::Base);

static const HashTableValue JSWritableStreamDefaultControllerPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsWritableStreamDefaultControllerConstructorGetter, 0 } },
    { "signal"_s, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor, NoIntrinsic, { HashTableValue::GetterSetterType, jsWritableStreamDefaultControllerPrototypeGetter_signal, 0 } },
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWritableStreamDefaultControllerPrototypeFunction_error, 0 } },
};

const ClassInfo JSWritableStreamDefaultControllerPrototype::s_info = { "WritableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamDefaultControllerPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultControllerPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSWritableStreamDefaultController>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "stream"_s), thisObject->m_stream.get() ? JSValue(thisObject->m_stream.get()) : jsUndefined(), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "WritableStreamDefaultController"_s, data));
}

void JSWritableStreamDefaultControllerPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSWritableStreamDefaultController::info(), JSWritableStreamDefaultControllerPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsWritableStreamDefaultControllerPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

template<> const ClassInfo JSWritableStreamDefaultControllerConstructor::s_info = { "WritableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamDefaultControllerConstructor) };

template<> JSValue JSWritableStreamDefaultControllerConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    UNUSED_PARAM(vm);
    return globalObject.functionPrototype();
}

template<> void JSWritableStreamDefaultControllerConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "WritableStreamDefaultController"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSWritableStreamDefaultController::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

const ClassInfo JSWritableStreamDefaultController::s_info = { "WritableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamDefaultController) };

JSWritableStreamDefaultController::JSWritableStreamDefaultController(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSWritableStreamDefaultController::~JSWritableStreamDefaultController() = default;

void JSWritableStreamDefaultController::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSWritableStreamDefaultController* JSWritableStreamDefaultController::create(VM& vm, Structure* structure)
{
    JSWritableStreamDefaultController* controller = new (NotNull, JSC::allocateCell<JSWritableStreamDefaultController>(vm)) JSWritableStreamDefaultController(vm, structure);
    controller->finishCreation(vm);
    return controller;
}

void JSWritableStreamDefaultController::destroy(JSCell* cell)
{
    static_cast<JSWritableStreamDefaultController*>(cell)->JSWritableStreamDefaultController::~JSWritableStreamDefaultController();
}

Structure* JSWritableStreamDefaultController::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSWritableStreamDefaultController::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSWritableStreamDefaultControllerPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSWritableStreamDefaultControllerPrototype::create(vm, &globalObject, structure);
}

JSObject* JSWritableStreamDefaultController::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSWritableStreamDefaultController>(vm, globalObject);
}

JSValue JSWritableStreamDefaultController::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSWritableStreamDefaultControllerConstructor, DOMConstructorID::WritableStreamDefaultController>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSWritableStreamDefaultController::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSWritableStreamDefaultController, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForWritableStreamDefaultController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWritableStreamDefaultController = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForWritableStreamDefaultController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForWritableStreamDefaultController = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSWritableStreamDefaultController::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSWritableStreamDefaultController>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_abortController);
    visitor.appendHidden(thisObject->m_algorithms.underlyingObject);
    visitor.appendHidden(thisObject->m_algorithms.method1);
    visitor.appendHidden(thisObject->m_algorithms.method2);
    visitor.appendHidden(thisObject->m_algorithms.method3);
    visitor.appendHidden(thisObject->m_algorithms.algorithmContext);
    visitor.appendHidden(thisObject->m_strategySizeAlgorithm);
    // ONE non-recursive cellLock scope covers the barrier container (StreamQueue.h).
    WTF::Locker locker { thisObject->cellLock() };
    thisObject->m_queue.visit(locker, visitor);
}

DEFINE_VISIT_CHILDREN(JSWritableStreamDefaultController);

void JSWritableStreamDefaultController::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSWritableStreamDefaultController>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_abortController, "abortController"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_strategySizeAlgorithm, "strategySizeAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.underlyingObject, "underlyingSink"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.method1, "writeAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.method2, "closeAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.method3, "abortAlgorithm"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_algorithms.algorithmContext, "algorithmContext"_s);
    WTF::Locker locker { thisObject->cellLock() };
    thisObject->m_queue.analyzeHeap(locker, cell, analyzer);
}

// [[AbortSteps]](reason)
JSPromise* JSWritableStreamDefaultController::abortSteps(JSGlobalObject* globalObject, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSPromise* result = performAbortAlgorithm(vm, globalObject, this, reason);
    RETURN_IF_EXCEPTION(scope, nullptr);
    writableStreamDefaultControllerClearAlgorithms(this);
    return result;
}

// [[ErrorSteps]]()
void JSWritableStreamDefaultController::errorSteps()
{
    WTF::Locker locker { cellLock() };
    m_queue.resetQueue(locker);
}

// The shared start / sink write / sink close reaction handlers
// ([reaction-convention]; context at argument(1)).

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onWSControllerStartFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSWritableStreamDefaultController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    const auto* stream = controller->m_stream.get();
    ASSERT(stream->m_state == WritableStreamState::Writable || stream->m_state == WritableStreamState::Erroring);
    UNUSED_PARAM(stream);
    controller->m_started = true;
    writableStreamDefaultControllerAdvanceQueueIfNeeded(globalObject, controller);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onWSControllerStartRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSWritableStreamDefaultController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    auto* stream = controller->m_stream.get();
    ASSERT(stream->m_state == WritableStreamState::Writable || stream->m_state == WritableStreamState::Erroring);
    controller->m_started = true;
    writableStreamDealWithRejection(globalObject, stream, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onWSSinkCloseFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* controller = dynamicDowncast<JSWritableStreamDefaultController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    writableStreamFinishInFlightClose(globalObject, controller->m_stream.get());
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onWSSinkCloseRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* controller = dynamicDowncast<JSWritableStreamDefaultController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    writableStreamFinishInFlightCloseWithError(globalObject, controller->m_stream.get(), callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onWSSinkWriteFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSWritableStreamDefaultController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    auto* stream = controller->m_stream.get();
    writableStreamFinishInFlightWrite(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    WritableStreamState state = stream->m_state;
    ASSERT(state == WritableStreamState::Writable || state == WritableStreamState::Erroring);
    {
        WTF::Locker locker { controller->cellLock() };
        controller->m_queue.dequeueValue(locker);
    }
    if (!writableStreamCloseQueuedOrInFlight(stream) && state == WritableStreamState::Writable) {
        bool backpressure = writableStreamDefaultControllerGetBackpressure(controller);
        writableStreamUpdateBackpressure(globalObject, stream, backpressure);
        RETURN_IF_EXCEPTION(scope, {});
    }
    writableStreamDefaultControllerAdvanceQueueIfNeeded(globalObject, controller);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onWSSinkWriteRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSWritableStreamDefaultController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    auto* stream = controller->m_stream.get();
    if (stream->m_state == WritableStreamState::Writable)
        writableStreamDefaultControllerClearAlgorithms(controller);
    writableStreamFinishInFlightWriteWithError(globalObject, stream, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// Prototype accessors & methods.

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultControllerConstructorGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSWritableStreamDefaultControllerPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(globalObject, scope);
    return JSValue::encode(JSWritableStreamDefaultController::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultControllerPrototypeGetter_signal, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* thisObject = dynamicDowncast<JSWritableStreamDefaultController>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "WritableStreamDefaultController"_s);
    auto* jsAbortController = uncheckedDowncast<JSAbortController>(thisObject->m_abortController.get());
    RELEASE_AND_RETURN(scope, JSValue::encode(toJS(globalObject, jsAbortController->globalObject(), jsAbortController->wrapped().signal())));
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultControllerPrototypeFunction_error, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSWritableStreamDefaultController>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "WritableStreamDefaultController"_s);
    if (thisObject->m_stream->m_state != WritableStreamState::Writable)
        return JSValue::encode(jsUndefined());
    writableStreamDefaultControllerError(globalObject, thisObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using namespace WebCore;

void writableStreamDefaultControllerAdvanceQueueIfNeeded(JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = controller->m_stream.get();
    if (!controller->m_started)
        return;
    if (stream->m_inFlightWriteRequest)
        return;
    WritableStreamState state = stream->m_state;
    ASSERT(state != WritableStreamState::Closed && state != WritableStreamState::Errored);
    if (state == WritableStreamState::Erroring)
        RELEASE_AND_RETURN(scope, writableStreamFinishErroring(globalObject, stream));
    if (controller->m_queue.isEmpty())
        return;
    // An EMPTY value barrier is the close sentinel (StreamQueue.h).
    JSValue value = controller->m_queue.peekQueueValue();
    if (!value)
        RELEASE_AND_RETURN(scope, writableStreamDefaultControllerProcessClose(globalObject, controller));
    RELEASE_AND_RETURN(scope, writableStreamDefaultControllerProcessWrite(globalObject, controller, value));
}

void writableStreamDefaultControllerClearAlgorithms(JSWritableStreamDefaultController* controller)
{
    controller->m_algorithms.kind = SinkKind::Nothing;
    controller->m_algorithms.underlyingObject.clear();
    controller->m_algorithms.method1.clear();
    controller->m_algorithms.method2.clear();
    controller->m_algorithms.method3.clear();
    controller->m_algorithms.algorithmContext.clear();
    controller->m_strategySizeAlgorithm.clear();
}

void writableStreamDefaultControllerClose(JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // The close sentinel: an EMPTY value with size 0 (never throws).
    controller->m_queue.enqueueValueWithSize(globalObject, controller, JSValue(), 0);
    scope.assertNoException();
    RELEASE_AND_RETURN(scope, writableStreamDefaultControllerAdvanceQueueIfNeeded(globalObject, controller));
}

void writableStreamDefaultControllerError(JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = controller->m_stream.get();
    ASSERT(stream->m_state == WritableStreamState::Writable);
    writableStreamDefaultControllerClearAlgorithms(controller);
    RELEASE_AND_RETURN(scope, writableStreamStartErroring(globalObject, stream, error));
}

void writableStreamDefaultControllerErrorIfNeeded(JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (controller->m_stream->m_state != WritableStreamState::Writable)
        return;
    RELEASE_AND_RETURN(scope, writableStreamDefaultControllerError(globalObject, controller, error));
}

bool writableStreamDefaultControllerGetBackpressure(JSWritableStreamDefaultController* controller)
{
    return writableStreamDefaultControllerGetDesiredSize(controller) <= 0;
}

double writableStreamDefaultControllerGetChunkSize(JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // null covers BOTH the default `() => 1` algorithm and the cleared (undefined) slot;
    // both return 1 without running user JS.
    auto* sizeAlgorithm = controller->m_strategySizeAlgorithm.get();
    if (!sizeAlgorithm)
        return 1;

    // "interpreting the result as a completion record": the size() call AND the WebIDL
    // `unrestricted double` conversion of its return value (the sanctioned size() catch family).
    double size = 1;
    JSValue thrown;
    bool abrupt = false;
    MarkedArgumentBuffer args;
    args.append(chunk);
    ASSERT(!args.hasOverflowed());
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto callData = getCallData(sizeAlgorithm);
        ASSERT(callData.type != CallData::Type::None);
        JSValue returnValue = call(globalObject, sizeAlgorithm, callData, jsUndefined(), args);
        if (!catchScope.exception())
            size = returnValue.toNumber(globalObject);
        if (catchScope.exception()) [[unlikely]] {
            abrupt = true;
            thrown = takeAbruptCompletion(globalObject, catchScope);
        }
    }
    if (abrupt) [[unlikely]] {
        // A VM termination is never consumed: it is still pending on the scope.
        if (thrown.isEmpty())
            return 1;
        writableStreamDefaultControllerErrorIfNeeded(globalObject, controller, thrown);
        RETURN_IF_EXCEPTION(scope, 1);
        return 1;
    }
    return size;
}

double writableStreamDefaultControllerGetDesiredSize(JSWritableStreamDefaultController* controller)
{
    return controller->m_strategyHWM - controller->m_queue.totalSize();
}

void writableStreamDefaultControllerProcessClose(JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = controller->m_stream.get();
    writableStreamMarkCloseRequestInFlight(vm, stream);
    {
        WTF::Locker locker { controller->cellLock() };
        controller->m_queue.dequeueValue(locker);
    }
    ASSERT(controller->m_queue.isEmpty());
    JSPromise* sinkClosePromise = performCloseAlgorithm(vm, globalObject, controller);
    RETURN_IF_EXCEPTION(scope, );
    writableStreamDefaultControllerClearAlgorithms(controller);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    // See readableStreamDefaultControllerCallPullIfNeeded.
    if (!sinkClosePromise || sinkClosePromise->status() == JSPromise::Status::Fulfilled)
        return queueStreamsMicrotask(globalObject, runtime->onWSSinkCloseFulfilled(), jsUndefined(), controller);
    sinkClosePromise->performPromiseThenWithContext(vm, globalObject, runtime->onWSSinkCloseFulfilled(), runtime->onWSSinkCloseRejected(), jsUndefined(), controller);
}

void writableStreamDefaultControllerProcessWrite(JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    writableStreamMarkFirstWriteRequestInFlight(vm, controller->m_stream.get());
    JSPromise* sinkWritePromise = performWriteAlgorithm(vm, globalObject, controller, chunk);
    RETURN_IF_EXCEPTION(scope, );
    auto* runtime = JSStreamsRuntime::from(globalObject);
    // See readableStreamDefaultControllerCallPullIfNeeded.
    if (!sinkWritePromise || sinkWritePromise->status() == JSPromise::Status::Fulfilled)
        return queueStreamsMicrotask(globalObject, runtime->onWSSinkWriteFulfilled(), jsUndefined(), controller);
    sinkWritePromise->performPromiseThenWithContext(vm, globalObject, runtime->onWSSinkWriteFulfilled(), runtime->onWSSinkWriteRejected(), jsUndefined(), controller);
}

void writableStreamDefaultControllerWrite(JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller, JSValue chunk, double chunkSize)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // "If enqueueResult is an abrupt completion" — EnqueueValueWithSize's RangeError on an
    // invalid size is interpreted as a completion record (no user JS runs).
    JSValue enqueueError;
    bool abrupt = false;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        controller->m_queue.enqueueValueWithSize(globalObject, controller, chunk, chunkSize);
        if (catchScope.exception()) [[unlikely]] {
            abrupt = true;
            enqueueError = takeAbruptCompletion(globalObject, catchScope);
        }
    }
    if (abrupt) [[unlikely]] {
        // A VM termination is never consumed: it is still pending on the scope.
        if (enqueueError.isEmpty())
            return;
        RELEASE_AND_RETURN(scope, writableStreamDefaultControllerErrorIfNeeded(globalObject, controller, enqueueError));
    }

    auto* stream = controller->m_stream.get();
    if (!writableStreamCloseQueuedOrInFlight(stream) && stream->m_state == WritableStreamState::Writable) {
        bool backpressure = writableStreamDefaultControllerGetBackpressure(controller);
        writableStreamUpdateBackpressure(globalObject, stream, backpressure);
        RETURN_IF_EXCEPTION(scope, );
    }
    RELEASE_AND_RETURN(scope, writableStreamDefaultControllerAdvanceQueueIfNeeded(globalObject, controller));
}

} // namespace WebStreams
} // namespace Bun
