#pragma once

#include "v8.h"
#include "V8Local.h"

namespace v8 {

class Context;
class Value;
class String;
class HeapObjectStatistics;
class HeapProfiler;
class Isolate;

namespace shim {
class GlobalInternals;
class HandleScopeBuffer;
}

// v8-callbacks.h
enum GCType {
    kGCTypeScavenge = 1 << 0,
    kGCTypeMinorMarkSweep = 1 << 1,
    kGCTypeMarkSweepCompact = 1 << 2,
    kGCTypeIncrementalMarking = 1 << 3,
    kGCTypeProcessWeakCallbacks = 1 << 4,
    kGCTypeAll = kGCTypeScavenge | kGCTypeMinorMarkSweep | kGCTypeMarkSweepCompact | kGCTypeIncrementalMarking | kGCTypeProcessWeakCallbacks
};

enum GCCallbackFlags {
    kNoGCCallbackFlags = 0,
    kGCCallbackFlagConstructRetainedObjectInfos = 1 << 1,
    kGCCallbackFlagForced = 1 << 2,
    kGCCallbackFlagSynchronousPhantomCallbackProcessing = 1 << 3,
    kGCCallbackFlagCollectAllAvailableGarbage = 1 << 4,
    kGCCallbackFlagCollectAllExternalMemory = 1 << 5,
    kGCCallbackScheduleIdleGarbageCollection = 1 << 6,
    kGCCallbackFlagLastResort = 1 << 7,
};

using InterruptCallback = void (*)(Isolate* isolate, void* data);
using NearHeapLimitCallback = size_t (*)(void* data, size_t current_heap_limit, size_t initial_heap_limit);

// The only fields here are "roots," which are the global locations of V8's versions of nullish and
// boolean values. These are computed as offsets from an Isolate pointer in many V8 functions so
// they need to have the correct layout.
class Isolate final {
public:
    using GCCallback = void (*)(Isolate* isolate, GCType type, GCCallbackFlags flags);
    using GCCallbackWithData = void (*)(Isolate* isolate, GCType type, GCCallbackFlags flags, void* data);

    // v8-internal.h:1107
    static constexpr int kUndefinedValueRootIndex = 0;
    static constexpr int kTheHoleValueRootIndex = 1;
    static constexpr int kNullValueRootIndex = 2;
    static constexpr int kTrueValueRootIndex = 3;
    static constexpr int kFalseValueRootIndex = 4;

    Isolate(shim::GlobalInternals* globalInternals);

    // Returns the isolate inside which the current thread is running or nullptr.
    BUN_EXPORT static Isolate* TryGetCurrent();

    // Returns the isolate inside which the current thread is running.
    BUN_EXPORT static Isolate* GetCurrent();

    BUN_EXPORT Local<Context> GetCurrentContext();
    BUN_EXPORT Local<Context> GetEnteredOrMicrotaskContext();
    BUN_EXPORT Local<Value> GetContinuationPreservedEmbedderData();
    BUN_EXPORT bool IsInUse();

    BUN_EXPORT void LowMemoryNotification();
    BUN_EXPORT void AutomaticallyRestoreInitialHeapLimit(double threshold_percent = 0.5);
    BUN_EXPORT size_t NumberOfTrackedHeapObjectTypes();
    BUN_EXPORT bool GetHeapObjectStatisticsAtLastGC(HeapObjectStatistics* object_statistics, size_t type_index);
    BUN_EXPORT HeapProfiler* GetHeapProfiler();

    BUN_EXPORT void AddGCPrologueCallback(GCCallbackWithData callback, void* data = nullptr, GCType gc_type_filter = kGCTypeAll);
    BUN_EXPORT void RemoveGCPrologueCallback(GCCallbackWithData callback, void* data = nullptr);
    BUN_EXPORT void AddGCEpilogueCallback(GCCallbackWithData callback, void* data = nullptr, GCType gc_type_filter = kGCTypeAll);
    BUN_EXPORT void RemoveGCEpilogueCallback(GCCallbackWithData callback, void* data = nullptr);
    BUN_EXPORT void AddNearHeapLimitCallback(NearHeapLimitCallback callback, void* data);
    BUN_EXPORT void RemoveNearHeapLimitCallback(NearHeapLimitCallback callback, size_t heap_limit);

    BUN_EXPORT void RequestInterrupt(InterruptCallback callback, void* data);

    BUN_EXPORT Local<Value> ThrowException(Local<Value> exception);
    BUN_EXPORT Local<Value> ThrowError(Local<String> message);

    Zig::GlobalObject* globalObject() { return m_globalObject; }
    JSC::VM& vm() { return globalObject()->vm(); }
    shim::GlobalInternals* globalInternals() { return m_globalInternals; }
    // The innermost open handle scope, where new handles go (see GlobalInternals::currentHandleScope).
    shim::HandleScopeBuffer* currentHandleScope();

    TaggedPointer* undefinedSlot() { return &m_roots[Isolate::kUndefinedValueRootIndex]; }

    TaggedPointer* nullSlot() { return &m_roots[Isolate::kNullValueRootIndex]; }

    TaggedPointer* trueSlot() { return &m_roots[Isolate::kTrueValueRootIndex]; }

    TaggedPointer* falseSlot() { return &m_roots[Isolate::kFalseValueRootIndex]; }

    shim::GlobalInternals* m_globalInternals;
    Zig::GlobalObject* m_globalObject;

    // Padding so that m_roots is at Internals::kIsolateRootsOffset (688 on 64-bit: 16 bytes of
    // fields above plus 84 words). V8 14.x inserted kIsolateJSDispatchTableOffset
    // (kExternalEntityTableSize) into the isolate-data layout ahead of the roots array.
    uintptr_t m_padding[84];

    std::array<TaggedPointer, 5> m_roots;

    // Lazily-created shim::HeapProfilerImpl* (opaque here to avoid a shim
    // include in this layout-sensitive header). Placed after m_roots so the
    // kIsolateRootsOffset static_assert is unaffected.
    void* m_heapProfiler { nullptr };
};

} // namespace v8
