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
#include <JavaScriptCore/JSPromiseReaction.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/UnlinkedCodeBlock.h>
#include <JavaScriptCore/VMEntryRecord.h>

using namespace JSC;

template<typename T>
static bool dynamicCastValue(JSC::JSValue v, T** out)
{
    if (!v || !v.isCell())
        return false;
    *out = dynamicDowncast<T>(v.asCell());
    return *out != nullptr;
}

static JSC::JSAsyncFunctionGenerator* unwrapGeneratorFromContext(JSC::JSValue context)
{
    JSC::InternalFieldTuple* tuple = nullptr;
    if (dynamicCastValue(context, &tuple))
        context = tuple->getInternalField(0);
    JSC::JSAsyncFunctionGenerator* generator = nullptr;
    dynamicCastValue(context, &generator);
    return generator;
}

// Where the newest reaction of a pending promise leads.
struct PendingReaction {
    // The async function that awaits the promise.
    JSC::JSAsyncFunctionGenerator* generator { nullptr };
    // With no generator: the promise the reaction settles, which is a handler's result promise or the promise that
    // was resolved with this one.
    JSC::JSPromise* promise { nullptr };
    // The reaction, when it is a `then(onFulfilled, onRejected)` on the heap.
    JSC::JSFullPromiseReaction* full { nullptr };
    bool isOnlyReaction { false };
};

// The pending reaction can be stored two ways:
//  - Inline in the JSPromise itself (the common single-await / single-then
//    fast path). InternalMicrotask carries the await generator context in
//    m_slot; FulfillHandler/RejectHandler carry the result promise in
//    payloadCell() and the handler in m_slot.
//  - As a heap-allocated JSPromiseReaction list once a second handler is
//    attached, headed at payloadCell().
static PendingReaction newestReactionOf(JSC::JSPromise* p)
{
    ASSERT(p->status() == JSC::JSPromise::Status::Pending);
    PendingReaction result;
    switch (p->inlineReactionKind()) {
    case JSC::JSPromise::InlineReactionKind::InternalMicrotask:
        result.isOnlyReaction = true;
        result.generator = unwrapGeneratorFromContext(p->inlineReactionContext());
        // No generator in the context. For the resolve-with-promise fast
        // path (`return promise` without await inside an async function),
        // the reaction's cell payload is the outer promise being resolved.
        // Combinator reactions store a JSPromiseCombinatorsGlobalContext
        // there, so the downcast fails and the chain stops.
        if (!result.generator)
            result.promise = dynamicDowncast<JSC::JSPromise>(p->payloadCell());
        return result;
    case JSC::JSPromise::InlineReactionKind::FulfillHandler:
    case JSC::JSPromise::InlineReactionKind::RejectHandler:
        result.isOnlyReaction = true;
        result.promise = p->inlineHandlerResultPromise();
        return result;
    case JSC::JSPromise::InlineReactionKind::None:
        break;
    }
    auto* reaction = dynamicDowncast<JSC::JSPromiseReaction>(p->payloadCell());
    if (!reaction)
        return result;
    result.isOnlyReaction = !reaction->next();
    result.full = dynamicDowncast<JSC::JSFullPromiseReaction>(reaction);
    result.generator = unwrapGeneratorFromContext(JSC::JSPromiseReaction::tryGetContext(reaction));
    // No generator in the context: follow the thenable chain to the
    // promise this reaction resolves/rejects.
    if (!result.generator)
        dynamicCastValue(reaction->promise(), &result.promise);
    return result;
}

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

    // Walk reaction->context → generator. If context is not a generator (e.g.
    // thenable-chain from `return promise` without await inside an async
    // function), follow reaction->promise() to the next promise in the chain.
    // Cap hops to avoid pathological chains.
    auto getAwaitingGenerator = [&](JSC::JSPromise* p) -> JSC::JSAsyncFunctionGenerator* {
        for (unsigned hops = 0; p && hops < 32; hops++) {
            if (p->status() != JSC::JSPromise::Status::Pending)
                return nullptr;
            auto reaction = newestReactionOf(p);
            if (reaction.generator)
                return reaction.generator;
            p = reaction.promise;
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

extern "C" JSC::EncodedJSValue Bun__thenContextAwaitingRunningAsyncFunction(JSC::JSGlobalObject* globalObject, Zig::FFIFunction onFulfilled, Zig::FFIFunction onRejected)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::AssertNoGC assertNoGC;

    auto resultPromiseOf = [](JSC::JSAsyncFunctionGenerator* generator) -> JSC::JSPromise* {
        JSC::JSPromise* promise = nullptr;
        if (generator)
            dynamicCastValue(generator->context(), &promise);
        return promise;
    };
    auto isHostFunction = [](JSC::JSValue value, Zig::FFIFunction function) -> bool {
        JSC::JSFunction* jsFunction = nullptr;
        return dynamicCastValue(value, &jsFunction) && jsFunction->isHostFunction() && jsFunction->nativeFunction() == JSC::toTagged(JSC::NativeFunction(function));
    };

    // The microtask that resumes an async function enters the VM with the function's generator as the entry's context.
    JSC::JSPromise* promise = vm.topEntryFrame ? resultPromiseOf(dynamicDowncast<JSC::JSAsyncFunctionGenerator>(JSC::vmEntryRecord(vm.topEntryFrame)->m_context)) : nullptr;
    for (unsigned hops = 0; promise && hops < 32; hops++) {
        if (promise->status() != JSC::JSPromise::Status::Pending)
            break;
        auto reaction = newestReactionOf(promise);
        if (!reaction.isOnlyReaction)
            break;
        if (reaction.full && isHostFunction(reaction.full->onFulfilled(), onFulfilled) && isHostFunction(reaction.full->onRejected(), onRejected)) {
            JSC::JSValue context = reaction.full->context();
            // JSPromise::performPromiseThenWithContext pairs the context with the async context when one is current.
            JSC::InternalFieldTuple* tuple = nullptr;
            if (dynamicCastValue(context, &tuple))
                context = tuple->getInternalField(0);
            return JSC::JSValue::encode(context);
        }
        promise = reaction.generator ? resultPromiseOf(reaction.generator) : reaction.promise;
    }
    return {};
}
