#pragma once

// Promises, microtasks, and work that the event loop runs later.

#include "engine/api/Errors.h"

namespace JSC {

class JSMicrotaskDispatcher;

enum class InternalMicrotask : uint8_t {
    // A function, the async context, and up to two arguments.
    BunPerformMicrotaskJob = Engine::InternalMicrotask::CallInAsyncContext,
    // A function and up to three arguments.
    BunInvokeJobWithArguments = Engine::InternalMicrotask::CallWithArguments,
    ImportModuleNamespace = Engine::InternalMicrotask::ImportModuleNamespace,
};

class JSPromise final : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(Promise)

    enum class Status : uint16_t {
        Pending = Engine::PromiseStatus::Pending,
        Fulfilled = Engine::PromiseStatus::Fulfilled,
        Rejected = Engine::PromiseStatus::Rejected,
    };

    static constexpr uint16_t isHandledFlag = Engine::Layout::promiseIsHandled;
    static constexpr uint16_t isFirstResolvingFunctionCalledFlag = Engine::Layout::promiseIsResolved;

    static JSPromise* create(VM& vm, Structure* structure) { return Engine::promise_create(vm, structure); }
    static JSPromise* resolvedPromise(JSGlobalObject* globalObject, JSValue value) { return Engine::promise_resolved(globalObject, value); }
    static JSPromise* rejectedPromise(JSGlobalObject* globalObject, JSValue reason) { return Engine::promise_rejected(globalObject, reason); }
    static JSPromise* rejectedPromiseWithCaughtException(JSGlobalObject* globalObject, ThrowScope& scope)
    {
        Exception* exception = scope.exception();
        TRY_CLEAR_EXCEPTION(scope, nullptr);
        RELEASE_AND_RETURN(scope, rejectedPromise(globalObject, exception->value()));
    }
    static JSValue createNewPromiseCapability(JSGlobalObject* globalObject, JSValue constructor) { return Engine::promise_capability_create(globalObject, constructor); }

    ALWAYS_INLINE uint16_t flags() const { return payload() >> flagsShift; }
    ALWAYS_INLINE Status status() const { return static_cast<Status>(flags() & Engine::Layout::promiseStatusMask); }
    ALWAYS_INLINE bool isHandled() const { return flags() & isHandledFlag; }
    ALWAYS_INLINE JSValue result() const { return status() == Status::Pending ? jsUndefined() : slot().get(); }
    JSValue settlementValue() const
    {
        ASSERT(status() != Status::Pending);
        return slot().get();
    }

    ALWAYS_INLINE void setFlags(uint16_t flags)
    {
        uint64_t address = payload() & ((1ull << flagsShift) - 1);
        std::atomic_ref(payload()).store(address | static_cast<uint64_t>(flags) << flagsShift, std::memory_order_relaxed);
    }
    void setSlot(VM& vm, JSValue value) { slot().set(vm, this, value); }
    ALWAYS_INLINE void markAsHandled() { setFlags(flags() | isHandledFlag); }

    // The first of these calls is the one that counts.
    void resolve(JSGlobalObject* globalObject, VM&, JSValue value) { Engine::promise_resolve(this, globalObject, value); }
    void fulfill(VM& vm, JSValue value) { Engine::promise_fulfill(this, vm, value); }
    void reject(VM& vm, JSValue reason) { Engine::promise_reject(this, vm, reason); }
    void reject(VM& vm, Exception* reason) { reject(vm, reason->value()); }
    void rejectAsHandled(VM& vm, JSValue reason) { Engine::promise_reject_as_handled(this, vm, reason); }
    void rejectAsHandled(VM& vm, Exception* reason) { rejectAsHandled(vm, reason->value()); }
    JSPromise* rejectWithCaughtException(VM& vm, ThrowScope& scope)
    {
        Exception* exception = scope.exception();
        TRY_CLEAR_EXCEPTION(scope, nullptr);
        scope.release();
        reject(vm, exception);
        return this;
    }
    // Settles as the other does, unobserved by scripts.
    void pipeFrom(VM& vm, JSPromise* source) { Engine::promise_pipe_from(this, vm, source); }
    JSFunction* createFirstResolveFunction(VM&, JSGlobalObject* globalObject) { return Engine::promise_create_resolve_function(this, globalObject); }

    JSObject* then(JSGlobalObject* globalObject, JSValue onFulfilled, JSValue onRejected) { return Engine::promise_then(this, globalObject, onFulfilled, onRejected); }
    void performPromiseThen(VM&, JSGlobalObject* globalObject, JSValue onFulfilled, JSValue onRejected, JSValue promiseOrCapability) { Engine::promise_perform_then(this, globalObject, onFulfilled, onRejected, promiseOrCapability); }
    // The handlers get the context as a second argument, unless it is undefined or null.
    void performPromiseThenWithContext(VM&, JSGlobalObject* globalObject, JSValue onFulfilled, JSValue onRejected, JSValue promiseOrCapability, JSValue context) { Engine::promise_perform_then_with_context(this, globalObject, onFulfilled, onRejected, promiseOrCapability, context); }
    void performPromiseThenWithInternalMicrotask(VM& vm, InternalMicrotask task, JSCell* cell, JSValue context) { Engine::promise_react(this, vm, task, cell, context); }
    bool isThenFastAndNonObservable() { return Engine::promise_has_pristine_then(this, vm()); }

private:
    static constexpr unsigned flagsShift = Engine::Layout::promiseFlagsShift;

    ALWAYS_INLINE uint64_t& payload() const { return Engine::fieldAt<uint64_t>(this, Engine::Layout::JsPromise_payload); }
    ALWAYS_INLINE WriteBarrier<Unknown>& slot() const { return Engine::fieldAt<WriteBarrier<Unknown>>(this, Engine::Layout::JsPromise_slot); }
};
ENGINE_CLASS_HAS_TYPE(JSPromise, JSPromiseType);

class QueuedTask {
public:
    QueuedTask(JSMicrotaskDispatcher*, InternalMicrotask job, uint8_t payload, JSGlobalObject* globalObject, JSValue first = {}, JSValue second = {}, JSValue third = {}, JSValue fourth = {})
        : m_header(std::bit_cast<uintptr_t>(globalObject) | static_cast<uint64_t>(job) << Engine::Layout::queuedTaskJobShift | static_cast<uint64_t>(payload) << Engine::Layout::queuedTaskPayloadShift)
        , m_arguments { first, second, third, fourth }
    {
        ENGINE_CHECK_OFFSET(QueuedTask, m_arguments, QueuedTask_arguments);
    }

private:
    uint64_t m_header;
    JSValue m_arguments[4];
};
ENGINE_CHECK_SIZE(QueuedTask, sizeOfQueuedTask);

// Rust allocates it.
class MicrotaskQueue {
    WTF_MAKE_NONCOPYABLE(MicrotaskQueue);

public:
    static Ref<MicrotaskQueue> create(VM& vm) { return Engine::microtask_queue_create(vm); }
    void ref() const { Engine::microtask_queue_retain(this); }
    void deref() const { Engine::microtask_queue_release(this); }

    void clear() { Engine::microtask_queue_clear(*this); }
    void performMicrotaskCheckpoint(VM& vm) { Engine::microtask_queue_perform_checkpoint(this, vm); }
};

inline MicrotaskQueue& VM::defaultMicrotaskQueue() { return *Engine::vm_default_microtask_queue(*this); }
inline void VM::queueMicrotask(QueuedTask&& task) { Engine::vm_queue_microtask(*this, task); }
inline void VM::drainMicrotasks() { Engine::vm_drain_microtasks(*this); }
inline bool VM::synchronousModuleQueue() const { return Engine::vm_has_synchronous_module_queue(*this); }

// While there is one, the steps of the module loader wait in a queue of their own. What is left in it at the end is dropped.
class VM::SynchronousModuleQueueScope {
    WTF_MAKE_NONCOPYABLE(SynchronousModuleQueueScope);

public:
    explicit SynchronousModuleQueueScope(VM& vm)
        : m_vm(vm)
    {
        Engine::vm_open_synchronous_module_queue(vm);
    }
    ~SynchronousModuleQueueScope() { Engine::vm_close_synchronous_module_queue(m_vm); }

private:
    VM& m_vm;
};

inline MicrotaskQueue& JSGlobalObject::microtaskQueue() const { return *Engine::global_microtask_queue(this); }
inline void JSGlobalObject::setMicrotaskQueue(Ref<MicrotaskQueue>&& queue) { Engine::global_set_microtask_queue(this, WTF::move(queue)); }
inline void JSGlobalObject::setAsyncContextTrackingEnabled(bool isEnabled)
{
    if (isEnabled)
        Engine::vm_start_tracking_async_context(vm());
}

// Stands for work that ends with a task on the thread of the VM. It is cancelled if its realm dies. Rust allocates it.
class DeferredWorkTicket {
    WTF_MAKE_NONCOPYABLE(DeferredWorkTicket);

public:
    void ref() const { Engine::ticket_retain(this); }
    void deref() const { Engine::ticket_release(this); }

    bool isCancelled() const { return Engine::ticket_is_cancelled(*this); }
    JSObject* target() const { return Engine::ticket_target(*this); }
    JSObject* scriptExecutionOwner() const { return Engine::ticket_script_execution_owner(*this); }
};

// How the VM gets at the event loop.
class DeferredWorkTimer final : public ThreadSafeRefCounted<DeferredWorkTimer> {
public:
    enum class WorkType : uint8_t {
        ImminentlyScheduled = Engine::WorkKind::ImminentlyScheduled,
        AtSomePoint = Engine::WorkKind::AtSomePoint,
    };
    using Ticket = DeferredWorkTicket;
    using Task = Function<void(Ticket&)>;

    static Ref<DeferredWorkTimer> create() { return adoptRef(*new DeferredWorkTimer); }

    // Once the functions are set. Until then nothing that is deferred runs.
    void start(VM& vm) { Engine::vm_set_event_loop(vm, this); }
    void runDueTimers(VM& vm) { Engine::vm_run_due_timers(vm); }

    // On the thread of the VM.
    Function<void(Ref<Ticket>&&, WorkType)> onAddPendingWork;
    // On any thread.
    Function<void(Ref<Ticket>&&, Task&&)> onScheduleWorkSoon;
    Function<void(Ticket&)> onCancelPendingWork;
    // When to call runDueTimers(), instead of the time that was set before.
    Function<void(std::optional<Seconds>)> onSetTimer;
};

} // namespace JSC
