#include "root.h"

#include "AsyncStackTrace.h"

#include "BunClientData.h"
#include "ErrorStackFrame.h"

#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/FunctionCodeBlock.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSAsyncFunctionGenerator.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunctionWithFields.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSPromiseReaction.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/UnlinkedCodeBlock.h>

using namespace JSC;

// Walk a promise's reaction chain to find the async generators awaiting it,
// and collect them as async StackFrames. Used when an error is created from
// native code at the top of the event loop (e.g. run_from_js_thread in node_fs.rs)
// where there's no JS call stack, but the promise being rejected has an await
// chain that tells us where the user's code is.
//
// This replicates the minimal chain-walking from JSC's private
// Interpreter::getAsyncStackTrace for the common case (direct await). Promise
// combinators (all/race/any) are not traced through — we stop at them.
static void collectAsyncStackFramesFromPromise(JSC::VM& vm, JSC::JSCell* owner, JSC::JSPromise* promise, WTF::Vector<JSC::StackFrame>& results, size_t maxStackSize)
{
    if (!JSC::Options::useAsyncStackTrace() || !promise)
        return;

    JSC::AssertNoGC assertNoGC;

    auto dynamicCastValue = []<typename T>(JSC::JSValue v, T** out) -> bool {
        if (!v || !v.isCell())
            return false;
        *out = dynamicDowncast<T>(v.asCell());
        return *out != nullptr;
    };

    // What a rejection passed to `handler` settles, if `handler` is the reject
    // half of a JSC resolving-function pair that was not called yet: the pair's
    // promise or, for the pair an `await` creates, the await's context. JSC
    // calls then(resolve, reject) with such a pair where it has no internal
    // reaction to register: to await a thenable or a Promise subclass, and to
    // resolve a promise with another promise once the realm's
    // promiseThenWatchpointSet or promiseSpeciesWatchpointSet has fired (for
    // good: `then` defined on Object.prototype, Promise.prototype.then replaced,
    // Promise.prototype frozen). Nothing awaits the promise that then() returned.
    auto rejectionTargetOf = [&](JSC::JSValue handler) -> JSC::JSValue {
        using Field = JSC::JSFunctionWithFields::Field;
        JSC::JSFunctionWithFields* function = nullptr;
        if (!dynamicCastValue(handler, &function))
            return {};
        JSC::TaggedNativeFunction nativeFunction = function->nativeFunction();
        // A call to either half of these two pairs clears its link to the other.
        if (nativeFunction == JSC::toTagged(JSC::promiseResolvingFunctionReject))
            return function->getField(Field::ResolvingOther).isCell() ? function->getField(Field::ResolvingPromise) : JSC::JSValue();
        if (nativeFunction == JSC::toTagged(JSC::promiseResolvingFunctionRejectWithInternalMicrotask)) {
            JSC::JSSlimPromiseReaction* awaitRecord = nullptr;
            if (function->getField(Field::ResolvingWithInternalMicrotaskOther).isCell() && dynamicCastValue(function->getField(Field::ResolvingWithInternalMicrotaskContext), &awaitRecord))
                return awaitRecord->handlerOrContext();
            return {};
        }
        // A call to either half of this pair marks the promise.
        if (nativeFunction == JSC::toTagged(JSC::promiseFirstResolvingFunctionReject)) {
            JSC::JSPromise* target = nullptr;
            if (dynamicCastValue(function->getField(Field::FirstResolvingPromise), &target) && !(target->flags() & JSC::JSPromise::isFirstResolvingFunctionCalledFlag))
                return target;
        }
        return {};
    };

    // The reject handler that then() stored in a heap-allocated reaction.
    auto rejectHandlerOf = [&](JSC::JSPromiseReaction* reaction) -> JSC::JSValue {
        if (auto* full = dynamicDowncast<JSC::JSFullPromiseReaction>(reaction))
            return full->onRejected();
        auto* slim = dynamicDowncast<JSC::JSSlimPromiseReaction>(reaction);
        if (slim && slim->internalMicrotask() == JSC::InternalMicrotask::None && !slim->isFulfillHandler())
            return slim->handlerOrContext();
        return {};
    };

    // The promise that then() returned for a heap-allocated reaction. Once the
    // realm's promiseSpeciesWatchpointSet has fired, then() stores a capability
    // record { resolve, reject, promise } in the reaction instead.
    auto derivedPromiseOf = [&](JSC::JSPromiseReaction* reaction) -> JSC::JSPromise* {
        JSC::JSObject* promiseOrCapability = nullptr;
        if (!dynamicCastValue(reaction->promise(), &promiseOrCapability))
            return nullptr;
        if (auto* derived = dynamicDowncast<JSC::JSPromise>(promiseOrCapability))
            return derived;
        // getDirect(vm, name) can allocate a property table. Nothing here may allocate.
        JSC::PropertyOffset offset = promiseOrCapability->structure()->getConcurrently(vm.propertyNames->promise.impl());
        JSC::JSPromise* derived = nullptr;
        if (offset != JSC::invalidOffset)
            dynamicCastValue(promiseOrCapability->getDirect(offset), &derived);
        return derived;
    };

    auto unwrapGeneratorFromContext = [&](JSC::JSValue context) -> JSC::JSAsyncFunctionGenerator* {
        JSC::InternalFieldTuple* tuple = nullptr;
        if (dynamicCastValue(context, &tuple))
            context = tuple->getInternalField(0);
        JSC::JSAsyncFunctionGenerator* generator = nullptr;
        dynamicCastValue(context, &generator);
        return generator;
    };

    // Walk reaction->context → generator. If context is not a generator (e.g.
    // thenable-chain from `return promise` without await inside an async
    // function), follow reaction->promise() to the next promise in the chain.
    // Cap hops to avoid pathological chains.
    //
    // The pending reaction can be stored two ways:
    //  - Inline in the JSPromise itself (the common single-await / single-then
    //    fast path). InternalMicrotask carries the await generator context in
    //    m_slot; FulfillHandler/RejectHandler carry the result promise in
    //    payloadCell() and the handler in m_slot.
    //  - As a heap-allocated JSPromiseReaction list once a second handler is
    //    attached, headed at payloadCell().
    auto walkReactions = [&](JSC::JSPromise* p, unsigned& hops, WTF::Vector<JSC::JSPromise*, 4>& fallbacks) -> JSC::JSAsyncFunctionGenerator* {
        // Moves `p` along a then() reaction. Where a reject function says the
        // rejection goes (see rejectionTargetOf) comes first. `derived`, the
        // promise then() returned, is the fallback if nothing awaits that.
        auto followThen = [&](JSC::JSValue rejectHandler, JSC::JSPromise* derived) -> JSC::JSAsyncFunctionGenerator* {
            JSC::JSValue target = rejectionTargetOf(rejectHandler);
            if (auto* generator = unwrapGeneratorFromContext(target))
                return generator;
            JSC::JSPromise* next = nullptr;
            if (dynamicCastValue(target, &next) && derived)
                fallbacks.append(derived);
            p = next ? next : derived;
            return nullptr;
        };

        for (; p && hops < 32; hops++) {
            if (p->status() != JSC::JSPromise::Status::Pending)
                return nullptr;
            switch (p->inlineReactionKind()) {
            case JSC::JSPromise::InlineReactionKind::InternalMicrotask: {
                if (auto* generator = unwrapGeneratorFromContext(p->inlineReactionContext()))
                    return generator;
                // No generator in the context. For the resolve-with-promise fast
                // path (`return promise` without await inside an async function),
                // the reaction's cell payload is the outer promise being resolved —
                // follow it to the next promise in the chain. Combinator reactions
                // store a JSPromiseCombinatorsGlobalContext there, so the downcast
                // fails and we stop, as before.
                if (auto* next = dynamicDowncast<JSC::JSPromise>(p->payloadCell())) {
                    p = next;
                    continue;
                }
                return nullptr;
            }
            case JSC::JSPromise::InlineReactionKind::RejectHandler: {
                if (auto* generator = followThen(p->inlineHandlerHandler(), p->inlineHandlerResultPromise()))
                    return generator;
                continue;
            }
            case JSC::JSPromise::InlineReactionKind::FulfillHandler: {
                p = p->inlineHandlerResultPromise();
                continue;
            }
            case JSC::JSPromise::InlineReactionKind::None:
                break;
            }
            auto* reaction = dynamicDowncast<JSC::JSPromiseReaction>(p->payloadCell());
            if (!reaction)
                return nullptr;
            if (auto* generator = unwrapGeneratorFromContext(JSC::JSPromiseReaction::tryGetContext(reaction)))
                return generator;
            // No generator in context — follow the thenable chain to the
            // promise this reaction resolves/rejects.
            if (auto* generator = followThen(rejectHandlerOf(reaction), derivedPromiseOf(reaction)))
                return generator;
        }
        return nullptr;
    };

    // Every walk of one search draws on the same 32 hops.
    auto getAwaitingGenerator = [&](JSC::JSPromise* start) -> JSC::JSAsyncFunctionGenerator* {
        unsigned hops = 0;
        WTF::Vector<JSC::JSPromise*, 4> fallbacks { start };
        while (!fallbacks.isEmpty()) {
            if (auto* generator = walkReactions(fallbacks.takeLast(), hops, fallbacks))
                return generator;
        }
        return nullptr;
    };

    auto computeBytecodeIndex = [&](JSC::CodeBlock* codeBlock, JSC::JSAsyncFunctionGenerator* generator) -> JSC::BytecodeIndex {
        JSC::BytecodeIndex bytecodeIndex(0);
        JSC::JSValue stateValue = generator->internalField(JSC::JSAsyncFunctionGenerator::Field::State).get();
        if (stateValue.isInt32()) {
            int32_t state = stateValue.asInt32();
            size_t numberOfJumpTables = codeBlock->numberOfUnlinkedSwitchJumpTables();
            if (state > 0 && numberOfJumpTables > 0) {
                size_t lastTableIndex = numberOfJumpTables - 1;
                const JSC::UnlinkedSimpleJumpTable& jumpTable = codeBlock->unlinkedSwitchJumpTable(lastTableIndex);
                int32_t offset = jumpTable.offsetForValue(state);
                if (offset)
                    bytecodeIndex = JSC::BytecodeIndex(offset);
            }
        }
        return bytecodeIndex;
    };

    auto appendFrame = [&](JSC::JSAsyncFunctionGenerator* generator) {
        JSC::JSFunction* asyncFunction = nullptr;
        if (!dynamicCastValue(generator->next(), &asyncFunction))
            return;
        if (asyncFunction->isHostOrPrivateBuiltinFunction())
            return;
        JSC::FunctionExecutable* executable = asyncFunction->jsExecutable();
        if (!executable)
            return;
        if (JSC::CodeBlock* codeBlock = executable->codeBlockForCall()) {
            JSC::BytecodeIndex bytecodeIndex = computeBytecodeIndex(codeBlock, generator);
            results.append(JSC::StackFrame(vm, owner, asyncFunction, codeBlock, bytecodeIndex, /* isAsyncFrame */ true));
        } else {
            results.append(JSC::StackFrame(vm, owner, asyncFunction, /* isAsyncFrame */ true));
        }
    };

    JSC::JSAsyncFunctionGenerator* gen = getAwaitingGenerator(promise);
    while (gen && results.size() < maxStackSize) {
        appendFrame(gen);
        JSC::JSPromise* returnPromise = nullptr;
        if (!dynamicCastValue(gen->context(), &returnPromise))
            break;
        gen = getAwaitingGenerator(returnPromise);
    }
}

extern "C" void Bun__attachAsyncStackFromPromise(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue errorValue, JSC::JSPromise* promise)
{
    auto& vm = JSC::getVM(globalObject);
    auto* instance = dynamicDowncast<JSC::ErrorInstance>(JSC::JSValue::decode(errorValue));
    if (!instance || !promise)
        return;

    // Don't overwrite an existing stack trace. User-provided errors (e.g. via
    // StreamError.JSValue or Body.ValueError.JSValue) may already have a
    // meaningful synchronous stack from where they were created. Also skip if
    // .stack was already accessed — setStackFrames after materialization
    // would desync m_stackTrace from the cached property.
    if (instance->hasMaterializedErrorInfo())
        return;
    if (auto* existing = instance->stackTrace(); existing && !existing->isEmpty())
        return;

    size_t limit = globalObject->stackTraceLimit().value_or(10);
    if (!limit)
        return;

    WTF::Vector<JSC::StackFrame> frames;
    collectAsyncStackFramesFromPromise(vm, instance, promise, frames, limit);
    if (frames.isEmpty())
        return;

    instance->setStackFrames(vm, WTF::move(frames));
}
