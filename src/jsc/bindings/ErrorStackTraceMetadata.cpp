#include "root.h"
#include "ErrorStackTraceMetadata.h"

#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/VM.h>
#include <wtf/IterationStatus.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/ThreadSpecific.h>

namespace Bun {

using namespace JSC;

static constexpr size_t kCacheSize = 128;

struct CacheSlot {
    JSCell* owner { nullptr };
    uintptr_t generation { 0 };
    StackTraceMetadata data;
};

using Cache = std::array<CacheSlot, kCacheSize>;

// Direct-mapped per-thread cache. .stack is almost always read in the same
// turn it was captured, so a small cache suffices; on eviction the only
// consequence is that the older error's stack loses its receiver prefixes.
static CacheSlot& slotFor(JSCell* owner)
{
    static LazyNeverDestroyed<ThreadSpecific<Cache>> cache;
    static std::once_flag once;
    std::call_once(once, [] { cache.construct(); });
    return (*cache.get())[(reinterpret_cast<uintptr_t>(owner) >> 4) % kCacheSize];
}

static WTF::String typeNameForReceiver(JSValue thisValue)
{
    if (!thisValue || !thisValue.isCell())
        return String();

    JSObject* thisObject = thisValue.getObject();
    if (!thisObject)
        return String();

    // For bare `foo()` JSC passes the resolved scope as |this| and the callee
    // converts it via to_this when |this| is used; the raw slot holds a scope
    // (JSLexicalEnvironment, GlobalObject, etc.), which is never a real
    // receiver. The global proxy is likewise a stand-in for "no receiver".
    JSC::JSType type = thisObject->type();
    if ((JSC::FirstScopeType <= type && type <= JSC::LastScopeType) || type == JSC::GlobalProxyType)
        return String();

    auto* classInfo = thisObject->structure()->classInfoForCells();
    if (!classInfo)
        return String();

    ASCIILiteral name = classInfo->className;
    // Generic classInfo names that would need calculatedClassName() to resolve
    // to the user-visible constructor name; skip rather than mislabel.
    if (name == "Object"_s || name == "Function"_s || name == "Module"_s || name == "GlobalObject"_s)
        return String();
    return name;
}

// Installed as VM::onAppendStackTrace. Runs inside Interpreter::getStackTrace
// under AssertNoGC while the physical call frames are still live. Re-walks the
// stack via StackVisitor, matches the already-filtered `stackTrace` frames by
// callee in order, and records each frame's receiver type name into the cache
// slot for this ErrorInstance.
void captureStackFrameReceivers(VM& vm, JSCell* owner, WTF::Vector<StackFrame>& stackTrace, size_t maxToAppend)
{
    UNUSED_PARAM(maxToAppend);

    auto* errorInstance = dynamicDowncast<ErrorInstance>(owner);
    if (!errorInstance)
        return;

    CacheSlot& slot = slotFor(owner);
    slot.owner = nullptr;
    slot.generation = 0;
    slot.data.entries.shrink(0);

    if (stackTrace.isEmpty())
        return;

    CallFrame* topCallFrame = vm.topCallFrame;
    if (!topCallFrame)
        return;

    slot.data.entries.reserveCapacity(stackTrace.size());

    size_t cursor = 0;
    bool any = false;
    StackVisitor::visit(topCallFrame, vm, [&](StackVisitor& visitor) -> IterationStatus {
        if (cursor >= stackTrace.size())
            return IterationStatus::Done;

        if (visitor->callee().isNativeCallee())
            return IterationStatus::Continue;

        JSCell* callee = visitor->callee().asCell();
        if (stackTrace[cursor].callee() != callee)
            return IterationStatus::Continue;

        String typeName;
        if (!visitor->isInlinedDFGFrame()) {
            if (auto* codeBlock = visitor->codeBlock()) {
                if (codeBlock->codeType() == FunctionCode && !codeBlock->isConstructor()) {
                    if (CallFrame* frame = visitor->callFrame())
                        typeName = typeNameForReceiver(frame->thisValue());
                }
            } else if (CallFrame* frame = visitor->callFrame()) {
                typeName = typeNameForReceiver(frame->thisValue());
            }
        }
        if (!typeName.isEmpty())
            any = true;
        slot.data.entries.append({ callee, WTF::move(typeName) });
        cursor++;

        while (cursor < stackTrace.size() && !stackTrace[cursor].callee())
            cursor++;

        return IterationStatus::Continue;
    });

    if (!any) {
        slot.data.entries.shrink(0);
        return;
    }

    static std::atomic<uintptr_t> generation { 0 };
    uintptr_t gen = generation.fetch_add(1, std::memory_order_relaxed) + 1;
    slot.owner = owner;
    slot.generation = gen;
    // Stamp the instance with the generation so a recycled cell at the same
    // address does not pick up stale metadata. The value is never a real
    // pointer; Bun__errorInstance__finalize is a no-op.
    errorInstance->setBunErrorData(reinterpret_cast<void*>(gen));
}

const StackTraceMetadata* stackTraceMetadataFor(JSCell* owner)
{
    auto* errorInstance = dynamicDowncast<ErrorInstance>(owner);
    if (!errorInstance)
        return nullptr;
    CacheSlot& slot = slotFor(owner);
    if (slot.owner != owner)
        return nullptr;
    if (reinterpret_cast<uintptr_t>(errorInstance->bunErrorData()) != slot.generation)
        return nullptr;
    return &slot.data;
}

}
