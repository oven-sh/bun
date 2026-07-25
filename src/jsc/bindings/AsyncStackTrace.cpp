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

// dynamicDowncast(JSValue)'s isCell() check is true for the empty value on
// JSVALUE64, so it would read through a null cell. asyncStackTraceContext()
// and reaction getters return the empty value in several paths, so every
// JSValue downcast in this file goes through this helper.
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

static BytecodeIndex computeGeneratorBytecodeIndex(CodeBlock* codeBlock, JSAsyncFunctionGenerator* generator)
{
    BytecodeIndex bytecodeIndex(0);
    JSValue stateValue = generator->internalField(JSAsyncFunctionGenerator::Field::State).get();
    if (stateValue.isInt32()) {
        int32_t state = stateValue.asInt32();
        size_t numberOfJumpTables = codeBlock->numberOfUnlinkedSwitchJumpTables();
        if (state > 0 && numberOfJumpTables > 0) {
            size_t lastTableIndex = numberOfJumpTables - 1;
            const UnlinkedSimpleJumpTable& jumpTable = codeBlock->unlinkedSwitchJumpTable(lastTableIndex);
            int32_t offset = jumpTable.offsetForValue(state);
            if (offset)
                bytecodeIndex = BytecodeIndex(offset);
        }
    }
    return bytecodeIndex;
}

static bool appendGeneratorFrame(VM& vm, JSCell* owner, JSAsyncFunctionGenerator* generator, WTF::Vector<StackFrame>& results)
{
    auto* asyncFunction = cellAs<JSFunction>(generator->next());
    if (!asyncFunction || asyncFunction->isHostOrPrivateBuiltinFunction())
        return false;
    FunctionExecutable* executable = asyncFunction->jsExecutable();
    if (!executable)
        return false;
    if (CodeBlock* codeBlock = executable->codeBlockForCall()) {
        BytecodeIndex bytecodeIndex = computeGeneratorBytecodeIndex(codeBlock, generator);
        results.append(StackFrame(vm, owner, asyncFunction, codeBlock, bytecodeIndex, /* isAsyncFrame */ true));
    } else {
        results.append(StackFrame(vm, owner, asyncFunction, /* isAsyncFrame */ true));
    }
    return true;
}

// With AsyncLocalStorage active, JSPromise::resolveWithInternalMicrotaskForAsyncAwait
// wraps the await context in InternalFieldTuple(context, asyncContext). Unwrap
// to field 0 so the generator/combinator probes see the real cell.
static inline JSValue unwrapAsyncContextTuple(JSValue v)
{
    if (auto* tuple = cellAs<InternalFieldTuple>(v))
        return tuple->getInternalField(0);
    return v;
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

    auto unwrapGeneratorFromContext = [&](JSC::JSValue context) -> JSC::JSAsyncFunctionGenerator* {
        return cellAs<JSC::JSAsyncFunctionGenerator>(unwrapAsyncContextTuple(context));
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

    JSC::JSAsyncFunctionGenerator* gen = getAwaitingGenerator(promise);
    while (gen && results.size() < maxStackSize) {
        appendGeneratorFrame(vm, owner, gen, results);
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

// Installed as VM::onAppendStackTrace. Interpreter::getAsyncStackTrace walks
// the await chain via JSPromise::asyncStackTraceContext(), but under
// AsyncLocalStorage that context is an InternalFieldTuple(generator, asyncContext)
// (see JSPromise::resolveWithInternalMicrotaskForAsyncAwait) and the walk's
// dynamicDowncast<JSAsyncFunctionGenerator> fails, dropping every `at async`
// frame. getStackTrace calls this hook before inserting its own async frames,
// so we replicate getParentGenerator here with tuple unwrapping and append the
// frames JSC's walk misses. To avoid duplicating frames JSC does find (when
// ALS was inactive at some hop), we run the unwrapped and non-unwrapped walks
// in lockstep and only start appending once the non-unwrapped walk stops.
void Bun::appendAsyncLocalStorageStackFrames(VM& vm, JSCell* owner, Vector<StackFrame>& results, size_t maxToAppend)
{
    if (!maxToAppend || !Options::useAsyncStackTrace())
        return;

    AssertNoGC assertNoGC;

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

    auto promiseContext = [](JSPromise* p, bool unwrap) -> JSValue {
        if (!p)
            return { };
        JSValue context = p->asyncStackTraceContext();
        return unwrap ? unwrapAsyncContextTuple(context) : context;
    };

    // Mirrors Interpreter::getAsyncStackTrace's getParentGenerator for the
    // direct-await and Promise.race shapes. Promise.all/allSettled/any store a
    // JSPromiseCombinatorsGlobalContext (a private header the prebuilt WebKit
    // doesn't forward), so under ALS the chain still ends at a combinator hop
    // the same way JSC's own walk does; that narrower case wants the unwrap in
    // getAsyncStackTrace itself.
    auto getParentGenerator = [&](JSAsyncFunctionGenerator* gen, bool unwrap) -> JSAsyncFunctionGenerator* {
        auto* returnPromise = cellAs<JSPromise>(gen->internalField(JSAsyncFunctionGenerator::Field::Context).get());
        JSValue context = promiseContext(returnPromise, unwrap);
        if (!context)
            return nullptr;
        if (auto* generator = cellAs<JSAsyncFunctionGenerator>(context))
            return generator;
        if (auto* promise = cellAs<JSPromise>(context))
            return cellAs<JSAsyncFunctionGenerator>(promiseContext(promise, unwrap));
        return nullptr;
    };

    size_t appended = 0;
    bool jscStopped = false;
    JSAsyncFunctionGenerator* current = origin;
    for (unsigned hops = 0; hops < 256 && appended < maxToAppend; hops++) {
        JSAsyncFunctionGenerator* next = getParentGenerator(current, /* unwrap */ true);
        if (!next)
            break;
        if (!jscStopped) {
            if (getParentGenerator(current, /* unwrap */ false))
                current = next;
            else
                jscStopped = true;
        }
        if (jscStopped) {
            if (appendGeneratorFrame(vm, owner, next, results))
                appended++;
            current = next;
        }
    }
}
