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

    // A scope or global-proxy cell here is a bare call's raw un-normalized |this|, not a receiver.
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

// VM::onAppendStackTrace hook; runs inside getStackTrace while the captured frames are still live on the machine stack.
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

    size_t cursor = 0;
    StackVisitor::visit(topCallFrame, vm, [&](StackVisitor& visitor) -> IterationStatus {
        while (cursor < stackTrace.size() && !stackTrace[cursor].callee())
            cursor++;
        if (cursor >= stackTrace.size())
            return IterationStatus::Done;

        if (visitor->callee().isNativeCallee())
            return IterationStatus::Continue;

        if (stackTrace[cursor].callee() != visitor->callee().asCell())
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
            slot.data.entries.append({ static_cast<unsigned>(cursor), WTF::move(typeName) });
        cursor++;

        return IterationStatus::Continue;
    });

    if (slot.data.entries.isEmpty())
        return;

    static std::atomic<uintptr_t> generation { 0 };
    uintptr_t gen = generation.fetch_add(1, std::memory_order_relaxed) + 1;
    slot.owner = owner;
    slot.generation = gen;
    // Generation stamp guards against a recycled cell at the same address.
    errorInstance->setBunErrorData(reinterpret_cast<void*>(gen));
}

void remapStackTraceMetadata(JSCell* owner, std::span<const unsigned> frameSyncIndices)
{
    auto* errorInstance = dynamicDowncast<ErrorInstance>(owner);
    if (!errorInstance)
        return;
    CacheSlot& slot = slotFor(owner);
    if (slot.owner != owner || reinterpret_cast<uintptr_t>(errorInstance->bunErrorData()) != slot.generation)
        return;

    WTF::Vector<StackTraceMetadata::Entry> remapped;
    size_t cursor = 0;
    unsigned newIndex = 0;
    for (unsigned original : frameSyncIndices) {
        if (original == noSyncFrameIndex)
            continue;
        while (cursor < slot.data.entries.size() && slot.data.entries[cursor].frameIndex < original)
            cursor++;
        if (cursor < slot.data.entries.size() && slot.data.entries[cursor].frameIndex == original)
            remapped.append({ newIndex, WTF::move(slot.data.entries[cursor].typeName) });
        newIndex++;
    }

    slot.data.entries = WTF::move(remapped);
    if (slot.data.entries.isEmpty()) {
        slot.owner = nullptr;
        slot.generation = 0;
        errorInstance->setBunErrorData(nullptr);
    }
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
