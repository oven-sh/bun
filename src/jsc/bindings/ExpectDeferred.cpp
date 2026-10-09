#include "root.h"

#include "ErrorStackTrace.h"
#include "ZigGeneratedClasses.h"
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

// `promise.then(onFulfilled)`, whatever has been done to Promise.
extern "C" EncodedJSValue ExpectDeferred__then(JSGlobalObject* globalObject, EncodedJSValue promise, EncodedJSValue onFulfilled)
{
    auto& vm = getVM(globalObject);
    auto* result = JSPromise::create(vm, globalObject->promiseStructure());
    uncheckedDowncast<JSPromise>(JSValue::decode(promise))->performPromiseThen(vm, globalObject, JSValue::decode(onFulfilled), jsUndefined(), result);
    return JSValue::encode(result);
}

// The ExpectDeferred that is being thrown, which is then no longer thrown. Empty when anything else is.
extern "C" EncodedJSValue ExpectDeferred__takeThrown(JSGlobalObject* globalObject)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
    auto* exception = scope.exception();
    if (!exception)
        return {};
    JSValue thrown = exception->value();
    if (!dynamicDowncast<WebCore::JSExpectDeferred>(thrown))
        return {};
    (void)scope.tryClearException();
    return JSValue::encode(thrown);
}

extern "C" bool ExpectDeferred__isHandled(EncodedJSValue promise)
{
    return uncheckedDowncast<JSPromise>(JSValue::decode(promise))->isHandled();
}

// An Exception, unlike an Error, keeps the code of its stack frames alive.
extern "C" EncodedJSValue ExpectDeferred__captureCallSite(JSGlobalObject* globalObject)
{
    return JSValue::encode(JSC::Exception::create(getVM(globalObject), jsUndefined()));
}

// The stack `error` would have, had the matcher that was called at `callSite` thrown it there and then.
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
