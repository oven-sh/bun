#pragma once

// All that the scripts of one thread share.

#include "engine/api/Heap.h"

namespace JSC {

class CodeCache;
class ControlFlowProfiler;
class DeferredWorkTimer;
class EntryFrame;
class HeapProfiler;
class MicrotaskQueue;
class QueuedTask;
class SamplingProfiler;
class TerminationDeadline;
class UnlinkedProgramCodeBlock;

enum VMIdentifierType {};
using VMIdentifier = ObjectIdentifier<VMIdentifierType>;
using ErrorInfoFunction = Function<String(VM&, Vector<StackFrame>&, unsigned& line, unsigned& column, String& sourceURL)>;
using ErrorInfoFunctionJSValue = Function<JSValue(VM&, Vector<StackFrame>&, unsigned& line, unsigned& column, String& sourceURL, JSObject*)>;

class VMTraps {
public:
    using BitField = uint32_t;
    static constexpr BitField NeedTermination = Engine::Trap::TERMINATION;

    bool needHandling(BitField mask) const { return m_pending.load(std::memory_order_relaxed) & mask; }
    // Also true while an exception is pending.
    ALWAYS_INLINE bool maybeNeedHandling() const { return reinterpret_cast<uintptr_t>(Engine::fieldAt<Exception*>(this, Engine::Layout::Vm_exception - Engine::Layout::Vm_traps)) | m_pending.load(std::memory_order_relaxed); }
    bool isDeferringTermination() const { return Engine::vm_is_termination_deferred(Engine::fieldAt<VM>(this, -Engine::Layout::Vm_traps)); }

private:
    friend class DeferTraps;
    friend class VM;

    std::atomic<BitField> m_pending;
    std::atomic<bool> m_isTerminationRequested;
    bool m_areDeferred;
    Engine::Opaque<8> m_stackLimit;
    void* m_realStackLimit;
};

class SmallStrings {
public:
    JSString* emptyString() const { return m_empty; }
    JSString* singleCharacterString(unsigned char character) const { return ofStaticAtom(character); }
    JSString* defaultString() const { return ofStaticAtom(Engine::StaticAtom::default_); }
    JSString* falseString() const { return ofStaticAtom(Engine::StaticAtom::false_); }
    JSString* nullString() const { return ofStaticAtom(Engine::StaticAtom::null_); }
    JSString* objectObjectString() const { return ofStaticAtom(Engine::StaticAtom::objectObject_); }
    JSString* symbolString() const { return ofStaticAtom(Engine::StaticAtom::symbol_); }
    JSString* trueString() const { return ofStaticAtom(Engine::StaticAtom::true_); }
    JSString* undefinedString() const { return ofStaticAtom(Engine::StaticAtom::undefined_); }

private:
    friend class VM;

    JSString* ofStaticAtom(unsigned index) const;

    JSString* m_empty;
    JSString* m_ofStaticAtoms[Engine::StaticAtom::COUNT];
};

// A VM belongs to the thread that made it, so there is nothing to wait for. The last to unlock runs the microtasks.
class JSLock {
public:
    void lock() { m_count++; }
    void unlock()
    {
        ASSERT(m_count);
        if (m_count == 1) [[unlikely]]
            willRelease();
        m_count--;
    }

private:
    void willRelease();

    unsigned m_count { 0 };
};

class JSLockHolder {
    WTF_MAKE_NONCOPYABLE(JSLockHolder);

public:
    JSLockHolder(VM&);
    JSLockHolder(VM* vm)
        : JSLockHolder(*vm)
    {
    }
    JSLockHolder(JSGlobalObject* globalObject)
        : JSLockHolder(getVM(globalObject))
    {
    }
    ~JSLockHolder() { m_lock.unlock(); }

private:
    JSLock& m_lock;
};

class DateCache {
public:
    void clearForTimeZoneChange();
    double gregorianDateTimeToMS(int32_t year, int32_t month, int32_t day, int32_t hour, int32_t minute, int32_t second, int32_t millisecond, TimeType);
    PlainGregorianDateTime msToGregorianDateTime(double milliseconds, TimeType);
    double parseDate(JSGlobalObject*, VM&, const String&);

private:
    VM& vm();
};

class Interpreter {
public:
    // It is not asked about functions that wait, and allocates no cell.
    using StackFrameFilter = ScopedLambda<bool(const StackFrame&)>;

    // The functions that wait for the one that is running come on top, up to as many again.
    void getStackTrace(Vector<StackFrame>& results, size_t framesToSkip = 0, size_t maxStackSize = std::numeric_limits<size_t>::max(), const StackFrameFilter* = nullptr);
    // The async functions that wait for the promise, one for the other.
    void getStackTraceOfAwaiters(JSPromise*, Vector<StackFrame>& results, size_t maxStackSize);
    bool isInsideSeveralResumedAsyncFunctions();
    JSValue executeProgram(const SourceCode&, JSGlobalObject*, JSObject* thisObject);

private:
    VM& vm();
};

struct ExceptionEventLocation {
    void* stackPosition { nullptr };
    const char* functionName { nullptr };
    const char* file { nullptr };
    unsigned line { 0 };
};

// Rust allocates it. The constructor and the destructor see to the members that only C++ has.
class VM {
    WTF_MAKE_NONCOPYABLE(VM);

public:
    struct ClientData {
        virtual ~ClientData() = default;
        virtual bool isWebCoreJSClientData() const { return false; }
        virtual void reportErrorOfMicrotask(JSGlobalObject*, Exception*) {}
    };

    enum class DeletePropertyMode : bool { Default,
        IgnoreConfigurable };

    class DeletePropertyModeScope {
    public:
        DeletePropertyModeScope(VM& vm, DeletePropertyMode mode)
            : m_vm(vm)
            , m_previous(std::exchange(vm.m_deletePropertyMode, mode))
        {
        }
        ~DeletePropertyModeScope() { m_vm.m_deletePropertyMode = m_previous; }

    private:
        VM& m_vm;
        DeletePropertyMode m_previous;
    };

    enum class ShrinkFootprint : uint8_t {
        LeaveCollectionToCaller = 1 << 0,
        KeepCodeInUse = 1 << 1,
    };

    class SynchronousModuleQueueScope;

    static RefPtr<VM> tryCreate(HeapType = HeapType::Small);
    void ref() const { m_refCount.fetch_add(1, std::memory_order_relaxed); }
    void deref() const { Engine::vm_release(this); }
    unsigned refCount() const { return m_refCount.load(std::memory_order_relaxed); }
    void refSuppressingSaferCPPChecking() const { ref(); }
    void derefSuppressingSaferCPPChecking() const { deref(); }

    VMIdentifier identifier() const { return m_identifier; }
    JSLock& apiLock() { return m_apiLock; }
    bool currentThreadIsHoldingAPILock() const { return m_ownerThread == currentThreadID(); }
    bool isCollectorBusyOnCurrentThread() const { return !currentThreadIsHoldingAPILock() || heap.mutatorState() != MutatorState::Running; }
    constexpr bool hasCompiledCode() const { return false; }

    bool isEntered() const { return entryScope; }
    void whenIdle(Function<void()>&&);
    void finalizeSynchronousJSExecution() { Engine::vm_clear_kept_objects(*this); }
    void* softStackLimit() const { return m_traps.m_realStackLimit; }
    bool isSafeToRecurseSoft() const { return currentStackPointer() >= softStackLimit(); }
    bool isSafeToRecurse() const { return currentStackPointer() >= m_hardStackLimit; }

    Exception* exceptionForInspection() const { return m_exception; }
    Exception* lastException() const { return m_lastException; }
    void clearLastException() { m_lastException = nullptr; }
    bool hasExceptionsAfterHandlingTraps() { return Engine::vm_has_exception_after_handling_traps(*this); }

    VMTraps& traps() { return m_traps; }
    void notifyNeedTermination() { Engine::vm_request_termination(*this); }
    Exception* ensureTerminationException() { return Engine::vm_termination_exception(*this); }
    bool isTerminationException(Exception* exception) const { return exception == m_terminationException; }
    bool hasPendingTerminationException() const { return m_exception && isTerminationException(m_exception); }
    bool hasTerminationRequest() const { return m_traps.m_isTerminationRequested.load(std::memory_order_relaxed); }
    void setHasTerminationRequest() { m_traps.m_isTerminationRequested.store(true); }
    void clearHasTerminationRequest() { m_traps.m_isTerminationRequested.store(false); }
    bool hasPendingTermination() const { return m_traps.needHandling(VMTraps::NeedTermination) || hasTerminationRequest() || hasPendingTerminationException(); }
    bool cancelTermination() { return Engine::vm_cancel_termination(*this); }
    void throwTerminationException() { Engine::vm_throw_termination(*this); }
    Ref<TerminationDeadline> addTerminationDeadline(MonotonicTime);
    bool executionForbidden() const { return m_isExecutionForbidden; }
    void setExecutionForbidden() { m_isExecutionForbidden = true; }

    ALWAYS_INLINE void writeBarrier(const JSCell* from)
    {
        if (from->cellState() <= heap.barrierThreshold()) [[unlikely]]
            Engine::write_barrier_slow_path(from);
    }
    ALWAYS_INLINE void writeBarrier(const JSCell* from, JSCell* to)
    {
        if (to)
            writeBarrier(from);
    }
    ALWAYS_INLINE void writeBarrier(const JSCell* from, JSValue to)
    {
        if (to.isCell() && to)
            writeBarrier(from);
    }
    ALWAYS_INLINE void mutatorFence()
    {
#if CPU(X86_64)
        std::atomic_signal_fence(std::memory_order_release);
#else
        if (heap.mutatorShouldBeFenced()) [[unlikely]]
            std::atomic_thread_fence(std::memory_order_release);
#endif
    }

    IsoSubspace& plainObjectSpace() { return heap.cellSpace().allocatorFor<Engine::Layout::sizeOfJsObject>(); }
    IsoSubspace& internalFunctionSpace() { return heap.cellSpace().allocatorFor<Engine::Layout::sizeOfInternalFunction>(); }
    CompleteSubspace& destructibleObjectSpace() { return heap.destructibleObjectSpace(); }

    NativeExecutable* getHostFunction(NativeFunction function, ImplementationVisibility visibility, NativeFunction constructor, unsigned length, const String& name) { return getHostFunction(function, visibility, NoIntrinsic, constructor, length, name); }
    NativeExecutable* getHostFunction(NativeFunction function, ImplementationVisibility visibility, Intrinsic intrinsic, NativeFunction constructor, unsigned length, const String& name) { return Engine::native_executable_shared(*this, length, name, function, constructor, intrinsic, visibility); }
    ExecutableBase* internalFunctionExecutable() const { return m_internalFunctionExecutable; }
    // Makes `@name` in the source of a built-in stand for the symbol.
    void registerPrivateName(const Identifier& name, const Identifier& symbol) { Engine::vm_register_private_name(*this, name, symbol); }
    SymbolRegistry& symbolRegistry();

    MicrotaskQueue& defaultMicrotaskQueue();
    void queueMicrotask(QueuedTask&&);
    void drainMicrotasks();
    void setOnEachMicrotaskTick(void (*callback)(VM&))
    {
        m_onEachMicrotaskTick = callback;
        Engine::vm_set_calls_back_after_microtasks(*this, callback);
    }
    void callOnEachMicrotaskTick() { m_onEachMicrotaskTick(*this); }
    bool isAsyncContextTrackingEnabled() const { return m_isAsyncContextTracked; }
    // Whether there is one.
    bool synchronousModuleQueue() const;

    Function<void(VM&, SourceProvider*, LineColumn&, String&)>& computeLineColumnWithSourcemap() { return m_computeLineColumnWithSourcemap; }
    void setComputeLineColumnWithSourcemap(Function<void(VM&, SourceProvider*, LineColumn&, String&)>&&);
    const ErrorInfoFunction& onComputeErrorInfo() const { return m_onComputeErrorInfo; }
    void setOnComputeErrorInfo(ErrorInfoFunction&&);
    const ErrorInfoFunctionJSValue& onComputeErrorInfoJSValue() const { return m_onComputeErrorInfoJSValue; }
    void setOnComputeErrorInfoJSValue(ErrorInfoFunctionJSValue&&);

    void deleteAllCode(DeleteAllCodeEffort) { Engine::vm_delete_all_code(*this); }
    bool shrinkFootprintNow(OptionSet<ShrinkFootprint> = {});
    void shrinkFootprintWhenIdle(OptionSet<ShrinkFootprint> = {});
    void setStartupJITDeferralScale(double scale) { Engine::vm_set_tier_up_scale(*this, scale); }
    CodeCache* codeCache() { return reinterpret_cast<CodeCache*>(this); }

    void enableControlFlowProfiler();
    ControlFlowProfiler* controlFlowProfiler();
    HeapProfiler& ensureHeapProfiler();
    HeapProfiler* heapProfiler();
    SamplingProfiler& ensureSamplingProfiler();
    SamplingProfiler* samplingProfiler();

    static constexpr Engine::CommonNamesPointer propertyNames {};

    ~VM();

private:
    friend class ExceptionScope;
    friend class JSLock;
    friend class JSNativeStdFunction;
    friend class SuspendExceptionScope;
    friend class ThrowScope;
    friend class TopExceptionScope;
    friend class Engine::MayThrow;

    VM();
    static void checkLayout();

    Exception* m_exception;
    VMTraps m_traps;

public:
    CallFrame* topCallFrame;
    EntryFrame* topEntryFrame;
    ClientData* clientData;
    // The realm through which the outermost script was entered.
    JSGlobalObject* entryScope;

private:
    Exception* m_terminationException;
    Exception* m_lastException;
    ExecutableBase* m_internalFunctionExecutable;
    // The constructor would reset it.
    union {
        mutable std::atomic<uint32_t> m_refCount;
    };

public:
    bool didEnterVM;

private:
    bool m_isExecutionForbidden;
    DeletePropertyMode m_deletePropertyMode;
    bool m_isAsyncContextTracked;
    bool m_needsExceptionCheck;
    Engine::Opaque<159> m_forGeneratedCode;

public:
    // From here to the heap, what only C++ has.
    const Ref<DeferredWorkTimer> deferredWorkTimer;
    DateCache dateCache;
    Interpreter interpreter;

private:
    JSLock m_apiLock;
    unsigned m_simulatedThrowCount { 0 };
    const uint32_t m_ownerThread;
    const VMIdentifier m_identifier;
    void* const m_hardStackLimit;
    Function<void(VM&, SourceProvider*, LineColumn&, String&)> m_computeLineColumnWithSourcemap;
    ErrorInfoFunction m_onComputeErrorInfo;
    ErrorInfoFunctionJSValue m_onComputeErrorInfoJSValue;
    void (*m_onEachMicrotaskTick)(VM&) { nullptr };
    ExceptionScope* m_topExceptionScope { nullptr };
    ExceptionEventLocation m_simulatedThrowLocation;
    std::unique_ptr<WTF::StackTrace> m_simulatedThrowStack;
    IsoSubspace* m_nativeStdFunctionSpace { nullptr };

public:
    // Rust constructs and destroys it.
    union {
        alignas(Engine::Layout::Vm_embedder_members) Heap heap;
    };
    SmallStrings smallStrings;
};

inline void VM::checkLayout()
{
    ENGINE_CHECK_SIZE(VMTraps, sizeOfTraps);
    ENGINE_CHECK_OFFSET(VMTraps, m_pending, Traps_pending);
    ENGINE_CHECK_OFFSET(VMTraps, m_isTerminationRequested, Traps_is_termination_requested);
    ENGINE_CHECK_OFFSET(VMTraps, m_areDeferred, Traps_are_deferred);
    ENGINE_CHECK_OFFSET(VMTraps, m_realStackLimit, Traps_real_stack_limit);
    ENGINE_CHECK_OFFSET(SmallStrings, m_empty, SmallStrings_empty);
    ENGINE_CHECK_OFFSET(SmallStrings, m_ofStaticAtoms, SmallStrings_static_atoms);
    ENGINE_CHECK_OFFSET(VM, m_exception, Vm_exception);
    ENGINE_CHECK_OFFSET(VM, m_traps, Vm_traps);
    ENGINE_CHECK_OFFSET(VM, topCallFrame, Vm_top_call_frame);
    ENGINE_CHECK_OFFSET(VM, topEntryFrame, Vm_top_entry_frame);
    ENGINE_CHECK_OFFSET(VM, clientData, Vm_client_data);
    ENGINE_CHECK_OFFSET(VM, entryScope, Vm_entry_global);
    ENGINE_CHECK_OFFSET(VM, m_terminationException, Vm_termination_exception);
    ENGINE_CHECK_OFFSET(VM, m_lastException, Vm_last_exception);
    ENGINE_CHECK_OFFSET(VM, m_internalFunctionExecutable, Vm_internal_function_executable);
    ENGINE_CHECK_OFFSET(VM, m_refCount, Vm_ref_count);
    ENGINE_CHECK_OFFSET(VM, didEnterVM, Vm_did_enter);
    ENGINE_CHECK_OFFSET(VM, m_isExecutionForbidden, Vm_is_execution_forbidden);
    ENGINE_CHECK_OFFSET(VM, m_deletePropertyMode, Vm_deletes_unconfigurable_properties);
    ENGINE_CHECK_OFFSET(VM, m_isAsyncContextTracked, Vm_is_async_context_tracked);
    ENGINE_CHECK_OFFSET(VM, m_needsExceptionCheck, Vm_is_exception_check_owed);
    ENGINE_CHECK_OFFSET(VM, deferredWorkTimer, Vm_embedder_members);
    ENGINE_CHECK_OFFSET(VM, heap, Vm_heap);
    ENGINE_CHECK_OFFSET(VM, smallStrings, Vm_small_strings);
}

inline VM& DateCache::vm() { return Engine::fieldAt<VM>(this, -OBJECT_OFFSETOF(VM, dateCache)); }
inline VM& Interpreter::vm() { return Engine::fieldAt<VM>(this, -OBJECT_OFFSETOF(VM, interpreter)); }

inline JSLockHolder::JSLockHolder(VM& vm)
    : m_lock(vm.apiLock())
{
    ASSERT(vm.currentThreadIsHoldingAPILock());
    m_lock.lock();
}

ALWAYS_INLINE JSString* SmallStrings::ofStaticAtom(unsigned index) const
{
    if (JSString* string = m_ofStaticAtoms[index]) [[likely]]
        return string;
    return Engine::string_of_static_atom(Engine::fieldAt<VM>(this, -Engine::Layout::Vm_small_strings), index);
}

ALWAYS_INLINE void JSCell::finishCreation(VM& vm)
{
    vm.heap.setIsConstructingCell(false);
    vm.mutatorFence();
}

// The constructor and finishCreation() come before the next allocation. A collection that finds it without a header ends the process.
template<typename T> ALWAYS_INLINE void* allocateCell(VM& vm, size_t size = sizeof(T))
{
    void* cell = T::template subspaceFor<T, SubspaceAccess::OnMainThread>(vm)->allocate(vm.heap, size);
    memset(cell, 0, sizeof(JSCell));
    vm.heap.setIsConstructingCell(true);
    return cell;
}

namespace Integrity {
inline void auditCellFully(VM& vm, JSCell* cell) { RELEASE_ASSERT(&cell->vm() == &vm && !cell->isPendingDestruction()); }
}

// A collection that has become due runs at the end of the scope.
class DeferGC {
    WTF_MAKE_NONCOPYABLE(DeferGC);

public:
    DeferGC(VM& vm)
        : m_heap(vm.heap)
    {
        m_heap.m_deferralDepth++;
    }
    ~DeferGC()
    {
        if (!--m_heap.m_deferralDepth && m_heap.m_didDeferCollection) [[unlikely]]
            Engine::heap_collect_if_deferred(m_heap);
    }

private:
    Heap& m_heap;
};

class GCDeferralContext {
public:
    GCDeferralContext(VM& vm)
        : m_deferral(vm)
    {
    }

private:
    DeferGC m_deferral;
};

} // namespace JSC
