#include "root.h"

#include "ErrorStackTrace.h"
#include "GeneratedExpectDeferred.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSPromiseReaction.h>
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

// The promise that a reaction rejects with the reason it got, if the reaction has no function for a rejection.
static JSPromise* passesRejectionOnTo(InternalMicrotask task, JSValue cell, JSValue context)
{
    switch (task) {
    // `.finally(f)`. The context has the promise that it returned.
    case InternalMicrotask::PromiseFinallyReactionJob:
        if (auto* finally = dynamicDowncast<JSSlimPromiseReaction>(context))
            return dynamicDowncast<JSPromise>(finally->promise());
        return nullptr;
    // `.then()` with no function, a promise that was resolved with this one, and `.finally(() => thisOne)`.
    case InternalMicrotask::PromiseResolveWithoutHandlerJob:
    case InternalMicrotask::PromiseFinallyAwaitJob:
        return dynamicDowncast<JSPromise>(cell);
    default:
        return nullptr;
    }
}

// Whether every reaction down from `first` only passes a rejection on. `end` gets each promise that the rejection ends up at.
template<typename Functor>
static bool onlyPassesRejectionOn(JSPromise* first, const Functor& end)
{
    Vector<JSPromise*, 8> unread { first };
    UncheckedKeyHashSet<JSPromise*> seen;
    // `.then()` and `.finally()` make one promise each, so a promise that two reactions lead to is not their shape.
    auto readLater = [&](JSPromise* next) {
        if (!next || !seen.add(next).isNewEntry)
            return false;
        unread.append(next);
        return true;
    };
    while (!unread.isEmpty()) {
        auto* promise = unread.takeLast();
        if (promise->status() != JSPromise::Status::Pending)
            return false;
        JSPromise* next = nullptr;
        switch (promise->inlineReactionKind()) {
        case JSPromise::InlineReactionKind::FulfillHandler:
            if (!readLater(promise->inlineHandlerResultPromise()))
                return false;
            continue;
        case JSPromise::InlineReactionKind::RejectHandler:
            return false;
        case JSPromise::InlineReactionKind::InternalMicrotask:
            promise->forEachPendingReaction([&](InternalMicrotask task, JSValue cell, JSValue context) {
                next = passesRejectionOnTo(task, cell, context);
                return false;
            });
            if (!readLater(next))
                return false;
            continue;
        case JSPromise::InlineReactionKind::None:
            break;
        }
        auto* reaction = uncheckedDowncast<JSPromiseReaction>(promise->payloadCell());
        if (!reaction) {
            // Marked as handled with no reaction: whoever marked it takes the rejection, such as a matcher that got this promise.
            if (promise->isHandled())
                return false;
            end(promise);
            continue;
        }
        for (; reaction; reaction = reaction->next()) {
            // As JSPromise::triggerPromiseReactions() reads them for a rejection.
            if (auto* full = dynamicDowncast<JSFullPromiseReaction>(reaction))
                next = full->onRejected().isUndefined() ? dynamicDowncast<JSPromise>(full->promise()) : nullptr;
            else if (auto* slim = uncheckedDowncast<JSSlimPromiseReaction>(reaction); slim->internalMicrotask() == InternalMicrotask::None)
                next = slim->isFulfillHandler() ? dynamicDowncast<JSPromise>(slim->promise()) : nullptr;
            else
                next = passesRejectionOnTo(slim->internalMicrotask(), slim->promiseSlotIsAsyncContext() ? jsUndefined() : slim->promise(), slim->handlerOrContext());
            if (!readLater(next))
                return false;
        }
    }
    return true;
}

extern "C" bool ExpectDeferred__onlyPassesRejectionOn(EncodedJSValue promise)
{
    return onlyPassesRejectionOn(uncheckedDowncast<JSPromise>(JSValue::decode(promise)), [](JSPromise*) {});
}

// Calls `onCopy(value, end)` when `end`, a promise that a rejection of `promise` ends up at, settles.
extern "C" void ExpectDeferred__watchCopies(JSGlobalObject* globalObject, EncodedJSValue promise, EncodedJSValue onCopy)
{
    auto& vm = getVM(globalObject);
    MarkedArgumentBuffer ends;
    onlyPassesRejectionOn(uncheckedDowncast<JSPromise>(JSValue::decode(promise)), [&](JSPromise* end) { ends.append(end); });
    RELEASE_ASSERT(!ends.hasOverflowed());
    for (size_t i = 0; i < ends.size(); i++) {
        auto* end = uncheckedDowncast<JSPromise>(ends.at(i));
        // `onCopy` for a fulfilment too: without a function, JSC passes the value on to a promise, and there is none.
        end->performPromiseThenWithContext(vm, globalObject, JSValue::decode(onCopy), JSValue::decode(onCopy), jsUndefined(), end);
        // That reaction is not a handler: a rejection of `end` stays unhandled until user code or ExpectDeferred__markHandled() takes it.
        end->setFlags(end->flags() & ~JSPromise::isHandledFlag);
    }
}

// What a reaction that user code adds to a rejected promise does to it.
extern "C" void ExpectDeferred__markHandled(EncodedJSValue encodedPromise)
{
    auto* promise = uncheckedDowncast<JSPromise>(JSValue::decode(encodedPromise));
    if (promise->status() != JSPromise::Status::Rejected || promise->isHandled())
        return;
    auto* globalObject = promise->realm();
    globalObject->globalObjectMethodTable()->promiseRejectionTracker(globalObject, promise, JSPromiseRejectionOperation::Handle);
    promise->markAsHandled();
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
