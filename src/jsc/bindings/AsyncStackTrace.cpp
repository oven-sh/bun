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
    auto getAwaitingGenerator = [&](JSC::JSPromise* p) -> JSC::JSAsyncFunctionGenerator* {
        for (unsigned hops = 0; p && hops < 32; hops++) {
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
            case JSC::JSPromise::InlineReactionKind::FulfillHandler:
            case JSC::JSPromise::InlineReactionKind::RejectHandler: {
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
            if (!dynamicCastValue(reaction->promise(), &p))
                return nullptr;
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
