// Bun's async-iterable body extension: an async iterator (or async generator function)
// becomes a DIRECT ReadableStream whose pull drives `iter.next(controller)`; writes obey the
// sink's backpressure protocol and cancellation is forwarded to the iterator.
#include "config.h"
#include "JSAsyncIteratorSourceOperation.h"

#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapperCache.h"
#include "JSReadableStream.h"
#include "JSStreamsRuntime.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SourceCode.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

const ClassInfo JSAsyncIteratorSourceOperation::s_info = { "AsyncIteratorSourceOperation"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSAsyncIteratorSourceOperation) };

JSAsyncIteratorSourceOperation::JSAsyncIteratorSourceOperation(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSAsyncIteratorSourceOperation::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSAsyncIteratorSourceOperation* JSAsyncIteratorSourceOperation::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSAsyncIteratorSourceOperation>(vm)) JSAsyncIteratorSourceOperation(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSAsyncIteratorSourceOperation::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSAsyncIteratorSourceOperation::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSAsyncIteratorSourceOperation, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForAsyncIteratorSourceOperation.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForAsyncIteratorSourceOperation = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForAsyncIteratorSourceOperation.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForAsyncIteratorSourceOperation = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSAsyncIteratorSourceOperation::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSAsyncIteratorSourceOperation>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_iterator);
    visitor.appendHidden(thisObject->m_controller);
    visitor.appendHidden(thisObject->m_pullPromise);
}

DEFINE_VISIT_CHILDREN(JSAsyncIteratorSourceOperation);

void JSAsyncIteratorSourceOperation::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSAsyncIteratorSourceOperation>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_iterator, "iterator"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_controller, "controller"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_pullPromise, "pullPromise"_s);
}

static void driveAsyncIterator(JSGlobalObject*, JSAsyncIteratorSourceOperation*);
static void asyncIterReturnIteratorAndSettle(JSGlobalObject*, JSAsyncIteratorSourceOperation*);
static void asyncIterFinishWithError(JSGlobalObject*, JSAsyncIteratorSourceOperation*, JSValue error);

// invokeOptionalMethod returns the EMPTY value when the method is not callable; the empty
// value reports isCell(), so it must never reach a downcast.
static JSPromise* asPromise(JSValue value)
{
    if (!value || !value.isCell())
        return nullptr;
    return dynamicDowncast<JSPromise>(value);
}

static void settlePullPromiseResolved(JSGlobalObject* globalObject, JSAsyncIteratorSourceOperation* op)
{
    auto& vm = getVM(globalObject);
    op->m_done = true;
    op->m_running = false;
    if (auto* pullPromise = op->m_pullPromise.get()) {
        op->m_pullPromise.clear();
        pullPromise->fulfill(vm, jsUndefined());
    }
}

static void settlePullPromiseRejected(JSGlobalObject* globalObject, JSAsyncIteratorSourceOperation* op, JSValue error)
{
    auto& vm = getVM(globalObject);
    op->m_done = true;
    op->m_running = false;
    if (auto* pullPromise = op->m_pullPromise.get()) {
        op->m_pullPromise.clear();
        pullPromise->reject(vm, error);
    }
}

// The success tail: controller.end(), then iterator.return(), then resolve the pull promise.
static void asyncIterFinishSuccess(JSGlobalObject* globalObject, JSAsyncIteratorSourceOperation* op)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);

    JSValue endResult;
    if (JSObject* controller = op->m_controller.get()) {
        MarkedArgumentBuffer noArgs;
        endResult = invokeOptionalMethod(globalObject, controller, WebCore::builtinNames(vm).endPublicName(), noArgs);
        if (scope.exception()) [[unlikely]] {
            JSValue error = takeAbruptCompletion(globalObject, scope);
            asyncIterFinishWithError(globalObject, op, error ? error : jsUndefined());
            return;
        }
    }
    if (auto* endPromise = asPromise(endResult)) {
        endPromise->performPromiseThenWithContext(vm, globalObject, runtime->onAsyncIterableSourceEndFulfilled(), runtime->onAsyncIterableSourceErrored(), jsUndefined(), op);
        return;
    }
    asyncIterReturnIteratorAndSettle(globalObject, op);
}

// iterator.return() (so a generator's `finally` runs), then resolve the pull promise.
static void asyncIterReturnIteratorAndSettle(JSGlobalObject* globalObject, JSAsyncIteratorSourceOperation* op)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    JSObject* iterator = op->m_iterator.get();
    op->m_iterator.clear();
    if (!iterator) {
        settlePullPromiseResolved(globalObject, op);
        return;
    }
    MarkedArgumentBuffer noArgs;
    JSValue returned = invokeOptionalMethod(globalObject, iterator, vm.propertyNames->returnKeyword, noArgs);
    if (scope.exception()) [[unlikely]] {
        // The iterator's own cleanup failure is subsumed: the stream already ended.
        scope.clearExceptionExceptTermination();
        settlePullPromiseResolved(globalObject, op);
        return;
    }
    if (auto* returnPromise = asPromise(returned)) {
        markPromiseAsHandled(vm, returnPromise);
        returnPromise->performPromiseThenWithContext(vm, globalObject, runtime->onAsyncIterableSourceCleanupSettled(), runtime->onAsyncIterableSourceCleanupSettled(), jsUndefined(), op);
        return;
    }
    settlePullPromiseResolved(globalObject, op);
}

// Error tail: an already-gone consumer (ERR_INVALID_THIS) returns the iterator quietly;
// otherwise notify it via iterator.throw(error) and settle once that settles.
static void asyncIterFinishWithError(JSGlobalObject* globalObject, JSAsyncIteratorSourceOperation* op, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);

    if (errorCodeIs(globalObject, error, "ERR_INVALID_THIS"_s)) {
        asyncIterReturnIteratorAndSettle(globalObject, op);
        return;
    }

    bool swallowByCode = errorCodeIs(globalObject, error, "ERR_INVALID_STATE"_s);

    JSObject* iterator = op->m_iterator.get();
    op->m_iterator.clear();
    JSValue thrown;
    if (iterator) {
        MarkedArgumentBuffer args;
        args.append(error);
        thrown = invokeOptionalMethod(globalObject, iterator, vm.propertyNames->throwKeyword, args);
        if (scope.exception()) [[unlikely]] {
            // The iterator's own cleanup failure is subsumed by the original error.
            scope.clearExceptionExceptTermination();
            thrown = {};
        }
    }
    // The cancelled check happens when the settle runs: a cancellation arriving while
    // iterator.throw() is pending must still suppress the rejection.
    if (auto* thrownPromise = asPromise(thrown)) {
        markPromiseAsHandled(vm, thrownPromise);
        auto* context = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), op, error);
        auto* handler = swallowByCode ? runtime->onAsyncIterableSourceErrorSwallowed() : runtime->onAsyncIterableSourceErrorRethrow();
        thrownPromise->performPromiseThenWithContext(vm, globalObject, handler, handler, jsUndefined(), context);
        return;
    }
    if (swallowByCode || op->m_cancelled) {
        settlePullPromiseResolved(globalObject, op);
        return;
    }
    settlePullPromiseRejected(globalObject, op, error);
}

enum class NextStep : uint8_t {
    ContinueLoop,
    Suspended,
    Finished,
};

// One iteration result: write the value (a final `return v` is still written), honor the
// sink's backpressure protocol (`wrote < 0` -> await flush(true)), then finish when done.
static NextStep asyncIterHandleNextResult(JSGlobalObject* globalObject, JSAsyncIteratorSourceOperation* op, JSValue result)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);

    JSValue doneValue = jsUndefined();
    JSValue value = jsUndefined();
    if (!result.isObject()) {
        // Matches awaiting a malformed iterator: iteration results must be objects.
        JSObject* error = createTypeError(globalObject, "Async iterator result is not an object"_s);
        asyncIterFinishWithError(globalObject, op, error);
        return NextStep::Finished;
    }
    {
        doneValue = result.get(globalObject, vm.propertyNames->done);
        if (scope.exception()) [[unlikely]]
            goto abrupt;
        value = result.get(globalObject, vm.propertyNames->value);
        if (scope.exception()) [[unlikely]]
            goto abrupt;
    }

    if (doneValue.toBoolean(globalObject))
        op->m_iteratorDone = true;

    // The done/value getters run user JS that can cancel the stream.
    if (op->m_cancelled) {
        asyncIterReturnIteratorAndSettle(globalObject, op);
        return NextStep::Finished;
    }

    if (!value.isUndefinedOrNull()) {
        JSObject* controller = op->m_controller.get();
        if (!controller) {
            asyncIterFinishSuccess(globalObject, op);
            return NextStep::Finished;
        }
        MarkedArgumentBuffer writeArgs;
        writeArgs.append(value);
        JSValue wrote = invokeOptionalMethod(globalObject, controller, WebCore::builtinNames(vm).writePublicName(), writeArgs);
        if (scope.exception()) [[unlikely]]
            goto abrupt;
        if (wrote && wrote.isNumber() && wrote.asNumber() < 0) {
            // The HTTP sink reports backpressure with a negative return: wait for the drain.
            MarkedArgumentBuffer flushArgs;
            flushArgs.append(jsBoolean(true));
            JSValue flushed = invokeOptionalMethod(globalObject, controller, builtinNames(vm).flushPublicName(), flushArgs);
            if (scope.exception()) [[unlikely]]
                goto abrupt;
            JSPromise* flushPromise = asPromise(flushed);
            if (!flushPromise) {
                flushPromise = promiseResolvedWith(globalObject, flushed ? flushed : jsUndefined());
                if (scope.exception()) [[unlikely]]
                    goto abrupt;
            }
            flushPromise->performPromiseThenWithContext(vm, globalObject, runtime->onAsyncIterableSourceFlushFulfilled(), runtime->onAsyncIterableSourceErrored(), jsUndefined(), op);
            return NextStep::Suspended;
        }
        if (auto* wrotePromise = asPromise(wrote))
            markPromiseAsHandled(vm, wrotePromise);
    }

    if (op->m_iteratorDone) {
        asyncIterFinishSuccess(globalObject, op);
        return NextStep::Finished;
    }
    return NextStep::ContinueLoop;

abrupt:
    JSValue error = takeAbruptCompletion(globalObject, scope);
    asyncIterFinishWithError(globalObject, op, error ? error : jsUndefined());
    return NextStep::Finished;
}

// The pump loop. Synchronously-fulfilled next() results are consumed in place (writes batch
// within the tick); a pending one suspends the loop on its reactions. A non-promise result
// (including foreign thenables) is normalized through promise resolution, like `await`.
static void driveAsyncIterator(JSGlobalObject* globalObject, JSAsyncIteratorSourceOperation* op)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);

    while (true) {
        if (op->m_done || op->m_iteratorDone) {
            op->m_running = false;
            return;
        }
        if (op->m_cancelled) {
            asyncIterReturnIteratorAndSettle(globalObject, op);
            return;
        }
        JSObject* iterator = op->m_iterator.get();
        if (!iterator) {
            settlePullPromiseResolved(globalObject, op);
            return;
        }
        MarkedArgumentBuffer nextArgs;
        nextArgs.append(op->m_controller ? JSValue(op->m_controller.get()) : jsUndefined());
        JSValue nextResult;
        {
            JSValue nextFunction = iterator->get(globalObject, vm.propertyNames->next);
            if (!scope.exception()) [[likely]] {
                if (op->m_cancelled) {
                    // A `next` getter cancelled the stream; do not resume the iterator.
                    asyncIterReturnIteratorAndSettle(globalObject, op);
                    return;
                }
                nextResult = JSC::call(globalObject, nextFunction, iterator, nextArgs, "iterator.next is not a function"_s);
            }
            if (scope.exception()) [[unlikely]] {
                JSValue error = takeAbruptCompletion(globalObject, scope);
                asyncIterFinishWithError(globalObject, op, error ? error : jsUndefined());
                return;
            }
        }
        if (op->m_cancelled) {
            asyncIterReturnIteratorAndSettle(globalObject, op);
            return;
        }
        JSPromise* nextPromise = asPromise(nextResult);
        if (!nextPromise) {
            // `await` semantics: adopt thenables; plain results become fulfilled promises.
            nextPromise = promiseResolvedWith(globalObject, nextResult);
            if (scope.exception()) [[unlikely]] {
                JSValue error = takeAbruptCompletion(globalObject, scope);
                asyncIterFinishWithError(globalObject, op, error ? error : jsUndefined());
                return;
            }
        }
        auto status = nextPromise->status();
        if (status == JSPromise::Status::Fulfilled) {
            if (asyncIterHandleNextResult(globalObject, op, nextPromise->result()) != NextStep::ContinueLoop)
                return;
            continue;
        }
        if (status == JSPromise::Status::Rejected) {
            markPromiseAsHandled(vm, nextPromise);
            asyncIterFinishWithError(globalObject, op, nextPromise->result());
            return;
        }
        nextPromise->performPromiseThenWithContext(vm, globalObject, runtime->onAsyncIterableSourceNextFulfilled(), runtime->onAsyncIterableSourceErrored(), jsUndefined(), op);
        return;
    }
}

// -- [reaction-convention] handlers: (value, contextCell) --

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onAsyncIterableSourceNextFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* op = uncheckedDowncast<JSAsyncIteratorSourceOperation>(callFrame->uncheckedArgument(1));
    if (op->m_done) {
        op->m_running = false;
        return JSValue::encode(jsUndefined());
    }
    if (op->m_cancelled) {
        asyncIterReturnIteratorAndSettle(globalObject, op);
        return JSValue::encode(jsUndefined());
    }
    if (asyncIterHandleNextResult(globalObject, op, callFrame->argument(0)) == NextStep::ContinueLoop)
        driveAsyncIterator(globalObject, op);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onAsyncIterableSourceFlushFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* op = uncheckedDowncast<JSAsyncIteratorSourceOperation>(callFrame->uncheckedArgument(1));
    if (op->m_done)
        return JSValue::encode(jsUndefined());
    if (op->m_cancelled) {
        asyncIterReturnIteratorAndSettle(globalObject, op);
        return JSValue::encode(jsUndefined());
    }
    // The drained write may have been the iterator's final value.
    if (op->m_iteratorDone)
        asyncIterFinishSuccess(globalObject, op);
    else
        driveAsyncIterator(globalObject, op);
    return JSValue::encode(jsUndefined());
}

// Any rejection feeding the loop (next(), flush(true), end()) takes the error path.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onAsyncIterableSourceErrored, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* op = uncheckedDowncast<JSAsyncIteratorSourceOperation>(callFrame->uncheckedArgument(1));
    if (op->m_done)
        return JSValue::encode(jsUndefined());
    asyncIterFinishWithError(globalObject, op, callFrame->argument(0));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onAsyncIterableSourceEndFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* op = uncheckedDowncast<JSAsyncIteratorSourceOperation>(callFrame->uncheckedArgument(1));
    asyncIterReturnIteratorAndSettle(globalObject, op);
    return JSValue::encode(jsUndefined());
}

// Registered as both reactions of iterator.return()'s promise: the stream already ended.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onAsyncIterableSourceCleanupSettled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* op = uncheckedDowncast<JSAsyncIteratorSourceOperation>(callFrame->uncheckedArgument(1));
    settlePullPromiseResolved(globalObject, op);
    return JSValue::encode(jsUndefined());
}

// context = InternalFieldTuple{op, originalError}; iterator.throw(error) settled.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onAsyncIterableSourceErrorRethrow, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* tuple = uncheckedDowncast<JSC::InternalFieldTuple>(callFrame->uncheckedArgument(1));
    auto* op = uncheckedDowncast<JSAsyncIteratorSourceOperation>(tuple->getInternalField(0));
    if (op->m_cancelled) {
        settlePullPromiseResolved(globalObject, op);
        return JSValue::encode(jsUndefined());
    }
    settlePullPromiseRejected(globalObject, op, tuple->getInternalField(1));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onAsyncIterableSourceErrorSwallowed, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* tuple = uncheckedDowncast<JSC::InternalFieldTuple>(callFrame->uncheckedArgument(1));
    auto* op = uncheckedDowncast<JSAsyncIteratorSourceOperation>(tuple->getInternalField(0));
    settlePullPromiseResolved(globalObject, op);
    return JSValue::encode(jsUndefined());
}

// -- [bound-convention] direct-source methods: (opCell, ...callArgs) --

// pull(controller): one drive of the iterator runs at a time; every pull while it runs gets
// the same promise.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundAsyncIterableSourcePull, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* op = uncheckedDowncast<JSAsyncIteratorSourceOperation>(callFrame->uncheckedArgument(0));
    if (op->m_done || op->m_cancelled)
        return JSValue::encode(jsUndefined());
    if (JSObject* controller = callFrame->argument(1).getObject())
        op->m_controller.set(vm, op, controller);
    if (op->m_running) {
        if (auto* pullPromise = op->m_pullPromise.get())
            return JSValue::encode(pullPromise);
        return JSValue::encode(jsUndefined());
    }
    auto* pullPromise = JSPromise::create(vm, globalObject->promiseStructure());
    op->m_pullPromise.set(vm, op, pullPromise);
    op->m_running = true;
    driveAsyncIterator(globalObject, op);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(pullPromise);
}

// cancel(reason): reason ? iterator.throw(reason) : iterator.return(); the result is
// returned so the stream's cancel promise chains onto it.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundAsyncIterableSourceCancel, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* op = uncheckedDowncast<JSAsyncIteratorSourceOperation>(callFrame->uncheckedArgument(0));
    op->m_cancelled = true;
    JSObject* iterator = op->m_iterator.get();
    op->m_iterator.clear();
    // The pump is abandoned: whatever awaited pull() resolves, like the old converter.
    settlePullPromiseResolved(globalObject, op);
    if (!iterator)
        return JSValue::encode(jsUndefined());
    JSValue reason = callFrame->argument(1);
    MarkedArgumentBuffer args;
    JSValue result;
    // Truthiness, not definedness: an absent/falsy reason means a graceful return(), never
    // an injected throw (which would surface as an uncatchable rejection).
    if (reason.toBoolean(globalObject)) {
        args.append(reason);
        result = invokeOptionalMethod(globalObject, iterator, vm.propertyNames->throwKeyword, args);
    } else
        result = invokeOptionalMethod(globalObject, iterator, vm.propertyNames->returnKeyword, args);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result ? result : jsUndefined());
}

// close(): the consumer is gone; the iterator's finally still runs via return().
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundAsyncIterableSourceClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* op = uncheckedDowncast<JSAsyncIteratorSourceOperation>(callFrame->uncheckedArgument(0));
    op->m_cancelled = true;
    asyncIterReturnIteratorAndSettle(globalObject, op);
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSAsyncIteratorSourceOperation;
using WebCore::JSReadableStream;
using WebCore::JSStreamsRuntime;

// An `async function*` value is not itself async-iterable; ReadableStreamTag__tagged and
// readableStreamFromAsyncIterator both accept one and start it eagerly.
bool isNonHostAsyncGeneratorFunction(JSObject* object)
{
    auto* function = dynamicDowncast<JSFunction>(object);
    return function && !function->isHostFunction() && function->jsExecutable() && function->jsExecutable()->isAsyncGenerator();
}

// Bun's async-iterable body extension: a DIRECT stream driven natively (the spec's
// ReadableStream.from() semantics are NOT used here). The iterator starts eagerly so that
// reused objects work.
JSReadableStream* readableStreamFromAsyncIterator(JSGlobalObject* globalObject, JSValue asyncIterableOrGeneratorFn)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    auto& names = WebCore::builtinNames(vm);

    JSValue target = jsUndefined();
    JSValue iteratorFn = asyncIterableOrGeneratorFn;
    if (JSObject* object = asyncIterableOrGeneratorFn.getObject(); object && !isNonHostAsyncGeneratorFunction(object)) {
        iteratorFn = object->get(globalObject, vm.propertyNames->asyncIteratorSymbol);
        RETURN_IF_EXCEPTION(scope, nullptr);
        target = object;
    }

    auto callData = JSC::getCallData(iteratorFn);
    if (callData.type == JSC::CallData::Type::None) {
        throwTypeError(globalObject, scope, "Expected an async generator"_s);
        return nullptr;
    }
    MarkedArgumentBuffer noArgs;
    JSValue iteratorValue = JSC::call(globalObject, iteratorFn, callData, target, noArgs);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSObject* iterator = iteratorValue.getObject();
    JSValue nextMethod = iterator ? iterator->get(globalObject, vm.propertyNames->next) : jsUndefined();
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!nextMethod.isCallable()) {
        throwTypeError(globalObject, scope, "Expected an async generator"_s);
        return nullptr;
    }

    auto* op = JSAsyncIteratorSourceOperation::create(vm, runtime->asyncIteratorSourceOperationStructure(zigGlobalObject));
    op->m_iterator.set(vm, op, iterator);

    auto* source = constructEmptyObject(globalObject);
    source->putDirect(vm, names.typePublicName(), jsString(vm, String("direct"_s)), 0);
    auto* pullFunction = createStreamsBoundHandler(globalObject, runtime->boundAsyncIterableSourcePull(), op);
    RETURN_IF_EXCEPTION(scope, nullptr);
    source->putDirect(vm, names.pullPublicName(), pullFunction, 0);
    auto* cancelFunction = createStreamsBoundHandler(globalObject, runtime->boundAsyncIterableSourceCancel(), op);
    RETURN_IF_EXCEPTION(scope, nullptr);
    source->putDirect(vm, builtinNames(vm).cancelPublicName(), cancelFunction, 0);
    auto* closeFunction = createStreamsBoundHandler(globalObject, runtime->boundAsyncIterableSourceClose(), op);
    RETURN_IF_EXCEPTION(scope, nullptr);
    source->putDirect(vm, names.closePublicName(), closeFunction, 0);

    auto* stream = JSReadableStream::create(vm, WebCore::getDOMStructure<JSReadableStream>(vm, *zigGlobalObject));
    initializeReadableStream(stream);
    stream->m_bunMode = WebCore::BunStreamMode::DirectPending;
    stream->m_directUnderlyingSource.set(vm, stream, source);
    return stream;
}

} // namespace WebStreams
} // namespace Bun
