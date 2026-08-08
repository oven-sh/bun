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
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/JSPromiseReaction.h>
#include <JavaScriptCore/ModuleProgramCodeBlock.h>
#include <JavaScriptCore/ModuleProgramExecutable.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/UnlinkedCodeBlock.h>
#include <JavaScriptCore/VMEntryRecord.h>

using namespace JSC;

// dynamicDowncast(JSValue) reads through a null cell for the empty value (isCell() is true for 0 on JSVALUE64); asyncStackTraceContext() can return empty, so all JSValue downcasts here go through this.
template<typename T>
static inline T* cellAs(JSValue v)
{
    return (v && v.isCell()) ? dynamicDowncast<T>(v.asCell()) : nullptr;
}

template<typename T>
static inline bool dynamicCastValue(JSValue v, T** out)
{
    *out = cellAs<T>(v);
    return *out != nullptr;
}

// Under AsyncLocalStorage the await context is wrapped in InternalFieldTuple(context, asyncContext); field 0 is the real cell.
static inline JSValue unwrapAsyncContextTuple(JSValue v)
{
    if (auto* tuple = cellAs<InternalFieldTuple>(v))
        return tuple->getInternalField(0);
    return v;
}

static BytecodeIndex yieldStateToBytecodeIndex(CodeBlock* codeBlock, int32_t state)
{
    size_t numberOfJumpTables = codeBlock->numberOfUnlinkedSwitchJumpTables();
    if (state > 0 && numberOfJumpTables > 0) {
        const UnlinkedSimpleJumpTable& jumpTable = codeBlock->unlinkedSwitchJumpTable(numberOfJumpTables - 1);
        int32_t offset = jumpTable.offsetForValue(state);
        if (offset)
            return BytecodeIndex(offset);
    }
    return BytecodeIndex(0);
}

// SAFETY: a positive Field::State (a yield index) means the module body is
// suspended at an await, the only state in which JSModuleRecord::evaluate has
// not cleared m_moduleProgramExecutable, so getOrMakeExecutable() returns the
// stored executable without allocating. Callers run under AssertNoGC.
static bool appendSuspendedModuleFrame(VM& vm, JSCell* owner, JSModuleRecord* moduleRecord, Vector<StackFrame>& results)
{
    JSValue stateValue = moduleRecord->internalField(AbstractModuleRecord::Field::State).get();
    if (!stateValue.isInt32())
        return false;
    int32_t state = stateValue.asInt32();
    if (state <= 0)
        return false;

    ModuleProgramExecutable* executable = moduleRecord->getOrMakeExecutable(moduleRecord->globalObject());
    if (!executable)
        return false;
    CodeBlock* codeBlock = executable->codeBlock();
    if (!codeBlock)
        return false;

    results.append(StackFrame(vm, owner, moduleRecord, codeBlock, yieldStateToBytecodeIndex(codeBlock, state), /* isAsyncFrame */ true));
    return true;
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
    //
    // The pending reaction can be stored two ways:
    //  - Inline in the JSPromise itself (the common single-await / single-then
    //    fast path). InternalMicrotask carries the await generator context in
    //    m_slot; FulfillHandler/RejectHandler carry the result promise in
    //    payloadCell() and the handler in m_slot.
    //  - As a heap-allocated JSPromiseReaction list once a second handler is
    //    attached, headed at payloadCell().
    JSModuleRecord* terminalModule = nullptr;
    auto getAwaitingGenerator = [&](JSC::JSPromise* p) -> JSC::JSAsyncFunctionGenerator* {
        for (unsigned hops = 0; p && hops < 32; hops++) {
            if (p->status() != JSC::JSPromise::Status::Pending)
                return nullptr;
            switch (p->inlineReactionKind()) {
            case JSC::JSPromise::InlineReactionKind::InternalMicrotask: {
                JSValue context = unwrapAsyncContextTuple(p->inlineReactionContext());
                if (auto* generator = cellAs<JSC::JSAsyncFunctionGenerator>(context))
                    return generator;
                terminalModule = cellAs<JSModuleRecord>(context);
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
            JSValue context = unwrapAsyncContextTuple(JSC::JSPromiseReaction::tryGetContext(reaction));
            if (auto* generator = cellAs<JSC::JSAsyncFunctionGenerator>(context))
                return generator;
            terminalModule = cellAs<JSModuleRecord>(context);
            // No generator in context — follow the thenable chain to the
            // promise this reaction resolves/rejects.
            if (!dynamicCastValue(reaction->promise(), &p))
                return nullptr;
        }
        return nullptr;
    };

    auto computeBytecodeIndex = [&](JSC::CodeBlock* codeBlock, JSC::JSAsyncFunctionGenerator* generator) -> JSC::BytecodeIndex {
        JSC::JSValue stateValue = generator->internalField(JSC::JSAsyncFunctionGenerator::Field::State).get();
        return stateValue.isInt32() ? yieldStateToBytecodeIndex(codeBlock, stateValue.asInt32()) : JSC::BytecodeIndex(0);
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

    if (terminalModule && results.size() < maxStackSize)
        appendSuspendedModuleFrame(vm, owner, terminalModule, results);
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

// VM::onAppendStackTrace hook. Interpreter::getAsyncStackTrace only follows JSAsyncFunctionGenerator links, so a top-level-await module (JSModuleRecord reaction context) is dropped; we locate the same origin generator and append one frame for that module's await. getStackTrace calls this after its sync walk and before inserting async frames, so the frame lands at the bottom.
void Bun::appendTopLevelAwaitStackFrame(VM& vm, JSCell* owner, Vector<StackFrame>& results, size_t maxToAppend)
{
    if (!maxToAppend || !Options::useAsyncStackTrace())
        return;

    AssertNoGC assertNoGC;

    // getStackTrace only inspects entry frames that contributed visible frames; the innermost one with a generator context is the microtask resume behind the current sync stack. Deeper entry frames belong to the embedder's scheduler and would walk into internal modules.
    JSAsyncFunctionGenerator* origin = nullptr;
    for (EntryFrame* entryFrame = vm.topEntryFrame; entryFrame;) {
        VMEntryRecord* record = vmEntryRecord(entryFrame);
        if (auto* generator = dynamicDowncast<JSAsyncFunctionGenerator>(record->m_context)) {
            origin = generator;
            break;
        }
        entryFrame = record->prevTopEntryFrame();
    }
    if (!origin)
        return;

    auto reactionContext = [](JSValue v) -> JSValue {
        auto* promise = cellAs<JSPromise>(v);
        return promise ? unwrapAsyncContextTuple(promise->asyncStackTraceContext()) : JSValue();
    };

    JSModuleRecord* moduleRecord = nullptr;
    JSAsyncFunctionGenerator* generator = origin;
    for (unsigned hops = 0; generator && hops < 256; hops++) {
        JSValue context = reactionContext(generator->internalField(JSAsyncFunctionGenerator::Field::Context).get());
        if (auto* next = cellAs<JSAsyncFunctionGenerator>(context)) {
            generator = next;
            continue;
        }
        if (auto* promise = cellAs<JSPromise>(context)) {
            JSValue inner = unwrapAsyncContextTuple(promise->asyncStackTraceContext());
            if (auto* next = cellAs<JSAsyncFunctionGenerator>(inner)) {
                generator = next;
                continue;
            }
            moduleRecord = cellAs<JSModuleRecord>(inner);
        } else
            moduleRecord = cellAs<JSModuleRecord>(context);
        break;
    }

    if (moduleRecord)
        appendSuspendedModuleFrame(vm, owner, moduleRecord, results);
}
