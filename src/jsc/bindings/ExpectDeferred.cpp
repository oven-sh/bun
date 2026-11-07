#include "root.h"

#include "AsyncContextFrame.h"
#include "BunClientData.h"
#include "ErrorStackTrace.h"
#include "GeneratedExpectDeferred.h"
#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/StackFrame.h>

using namespace JSC;

extern "C" void ExpectDeferred__callWhenSettled(JSGlobalObject* globalObject, EncodedJSValue promise, EncodedJSValue function, EncodedJSValue deferred)
{
    JSValue callback = JSValue::decode(function);
    uncheckedDowncast<JSPromise>(JSValue::decode(promise))->performPromiseThenWithContext(getVM(globalObject), globalObject, callback, callback, jsUndefined(), JSValue::decode(deferred));
}

// `promise.then(onFulfilled)` without going through Promise.prototype, which user code can patch.
extern "C" EncodedJSValue ExpectDeferred__then(JSGlobalObject* globalObject, EncodedJSValue promise, EncodedJSValue onFulfilled)
{
    auto& vm = getVM(globalObject);
    auto* result = JSPromise::create(vm, globalObject->promiseStructure());
    uncheckedDowncast<JSPromise>(JSValue::decode(promise))->performPromiseThen(vm, globalObject, JSValue::decode(onFulfilled), jsUndefined(), result);
    return JSValue::encode(result);
}

extern "C" EncodedJSValue ExpectDeferred__takeThrown(JSGlobalObject* globalObject)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
    auto* exception = scope.exception();
    if (!exception)
        return {};
    JSValue thrown = exception->value();
    if (!dynamicDowncast<Bun::Bindgen::Generated::JSExpectDeferred>(thrown))
        return {};
    (void)scope.tryClearException();
    return JSValue::encode(thrown);
}

extern "C" void ExpectDeferred__setCauseIfNone(JSGlobalObject* globalObject, EncodedJSValue error, EncodedJSValue cause)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* object = JSValue::decode(error).getObject();
    if (!object)
        return;
    JSValue existing = object->get(globalObject, vm.propertyNames->cause);
    if (!scope.exception() && existing.isUndefinedOrNull()) {
        PutPropertySlot slot(object);
        object->methodTable()->put(object, globalObject, vm.propertyNames->cause, JSValue::decode(cause), slot);
    }
    if (scope.exception())
        (void)scope.tryClearException();
}

extern "C" bool ExpectDeferred__isHandled(EncodedJSValue promise)
{
    return uncheckedDowncast<JSPromise>(JSValue::decode(promise))->isHandled();
}

// A JSC::Exception, because unlike an Error it keeps its stack frames' code alive.
extern "C" EncodedJSValue ExpectDeferred__captureCallSite(JSGlobalObject* globalObject)
{
    return JSValue::encode(JSC::Exception::create(getVM(globalObject), jsUndefined()));
}

// Rewrites `error`'s stack as if the matcher had thrown synchronously at `callSite`.
extern "C" void ExpectDeferred__continueStackAt(JSGlobalObject* globalObject, EncodedJSValue encodedError, EncodedJSValue callSite)
{
    auto* error = dynamicDowncast<ErrorInstance>(JSValue::decode(encodedError));
    if (!error || error->hasMaterializedErrorInfo())
        return;
    Vector<StackFrame> frames;
    if (auto* thrownFrom = error->stackTrace()) {
        size_t insideMatcher = 0;
        for (size_t i = 0; i < thrownFrom->size(); i++) {
            if (thrownFrom->at(i).hasLineAndColumnInfo() && !thrownFrom->at(i).isAsyncFrame())
                insideMatcher = i + 1;
        }
        frames.append(thrownFrom->span().first(insideMatcher));
    }
    frames.appendVector(uncheckedDowncast<JSC::Exception>(JSValue::decode(callSite))->stack());
    frames.shrink(std::min<size_t>(frames.size(), globalObject->stackTraceLimit().value_or(0)));
    error->setStackFrames(getVM(globalObject), WTF::move(frames));
}

extern "C" void ExpectDeferred__location(JSGlobalObject* globalObject, EncodedJSValue callSite, BunString* outSourceURL, unsigned* outLine, unsigned* outColumn)
{
    auto& vm = getVM(globalObject);
    for (const StackFrame& frame : uncheckedDowncast<JSC::Exception>(JSValue::decode(callSite))->stack()) {
        if (Zig::isImplementationVisibilityPrivate(frame) || !frame.hasLineAndColumnInfo())
            continue;
        LineColumn lineColumn = frame.computeLineAndColumn();
        Bun::OwnedZigStackFrames remapped(1);
        remapped[0].position.line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt();
        remapped[0].position.column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt();
        remapped[0].source_url = Bun::toStringRef(Zig::sourceURL(vm, frame));
        remapped.remap(Bun::vm(globalObject));
        *outSourceURL = Bun::toStringRef(remapped[0].source_url.toWTFString());
        *outLine = OrdinalNumber::fromZeroBasedInt(remapped[0].position.line_zero_based).oneBasedInt();
        *outColumn = OrdinalNumber::fromZeroBasedInt(remapped[0].position.column_zero_based).oneBasedInt();
        return;
    }
}

// `callback`, bound to an async context frame that names `attempt` on top of the context it would run in.
// The frame's storage is the `bun:test` module object, which no AsyncLocalStorage, module graph or mock is.
extern "C" EncodedJSValue ExpectDeferred__bindToAttempt(JSGlobalObject* lexicalGlobalObject, EncodedJSValue encodedCallback, uint32_t attempt)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue callback = JSValue::decode(encodedCallback);
    auto* bound = dynamicDowncast<AsyncContextFrame>(callback);
    JSValue outer = bound ? bound->context.get() : globalObject->m_asyncContextData.get()->getInternalField(0);
    // Promise reactions only capture the async context once tracking is on.
    globalObject->setAsyncContextTrackingEnabled(true);
    JSObject* frame = Bun::createAsyncContextFrame(globalObject, globalObject->lazyTestModuleObject(), outer, jsNumber(attempt));
    return JSValue::encode(AsyncContextFrame::create(globalObject, bound ? bound->callback.get() : callback, frame));
}

// Resolves `promise` with `thenable`, as `JSPromise::resolve` does. If `ExpectDeferred__bindToAttempt` bound `callback`,
// which returned `thenable`, the job that calls `then` runs in the async context of `callback`: that work is the attempt's too.
extern "C" void ExpectDeferred__followThenable(JSGlobalObject* lexicalGlobalObject, EncodedJSValue encodedCallback, JSPromise* promise, EncodedJSValue encodedThenable)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = getVM(globalObject);
    JSValue attempt;
    if (auto* bound = dynamicDowncast<AsyncContextFrame>(JSValue::decode(encodedCallback))) {
        JSObject* frame = bound->context.get().getObject();
        if (frame && frame->getDirect(vm, WebCore::builtinNames(vm).storagePublicName()) == globalObject->lazyTestModuleObject())
            attempt = frame;
    }
    AsyncContextScope context(globalObject, attempt);
    promise->resolve(globalObject, vm, JSValue::decode(encodedThenable));
}

// The attempt that the innermost frame of `ExpectDeferred__bindToAttempt` in the current async context names, or 0.
extern "C" uint32_t ExpectDeferred__callingAttempt(JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = getVM(globalObject);
    auto& names = WebCore::builtinNames(vm);
    JSObject* storage = globalObject->lazyTestModuleObject();
    for (JSObject* frame = globalObject->m_asyncContextData.get()->getInternalField(0).getObject(); frame;) {
        if (frame->getDirect(vm, names.storagePublicName()) == storage) {
            JSValue attempt = frame->getDirect(vm, vm.propertyNames->value);
            return attempt && attempt.isUInt32() ? attempt.asUInt32() : 0;
        }
        JSValue previous = frame->getDirect(vm, names.prevPublicName());
        frame = previous ? previous.getObject() : nullptr;
    }
    return 0;
}
