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

// Per-thread cache; eviction just drops the older error's receiver prefixes.
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

    // Bare `foo()`: JSC passes the resolved scope as raw |this| (normalized
    // later by to_this), so a scope/global-proxy here means "no receiver".
    JSC::JSType type = thisObject->type();
    if ((JSC::FirstScopeType <= type && type <= JSC::LastScopeType) || type == JSC::GlobalProxyType)
        return String();

    auto* classInfo = thisObject->structure()->classInfoForCells();
    if (!classInfo)
        return String();

    ASCIILiteral name = classInfo->className;
    // These need calculatedClassName() for the real name; skip rather than mislabel.
    if (name == "Object"_s || name == "Function"_s || name == "Module"_s || name == "GlobalObject"_s)
        return String();
    return name;
}

// VM::onAppendStackTrace hook: runs under AssertNoGC inside getStackTrace
// while call frames are live; matches stackTrace[] frames by callee and
// records each receiver's classInfo name into this ErrorInstance's cache slot.
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
    // Generation stamp guards against a recycled cell at the same address.
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
