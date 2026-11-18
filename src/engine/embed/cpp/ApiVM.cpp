#include "engine/Engine.h"

namespace JSC {

VM::VM()
    : deferredWorkTimer(DeferredWorkTimer::create())
    , m_ownerThread(currentThreadID())
    , m_identifier(VMIdentifier::generate())
    , m_hardStackLimit(Engine::vm_hard_stack_limit(*this))
{
}

VM::~VM()
{
    delete clientData;
}

RefPtr<VM> VM::tryCreate(HeapType heapType)
{
    Options::freeze();
    void* memory = Engine::vm_create(heapType, Engine::StaticAtom::COUNT, Engine::RealmSlot::COUNT);
    auto* vm = new (memory) VM;
    if (Options::useControlFlowProfiler()) [[unlikely]]
        vm->enableControlFlowProfiler();
    if (Options::useSamplingProfiler()) [[unlikely]]
        vm->ensureSamplingProfiler().start();
    return adoptRef(vm);
}

extern "C" void engine_host_destroy_vm_members(VM* vm)
{
    vm->~VM();
}

void VM::whenIdle(Function<void()>&& task)
{
    auto run = [](void* context) { (*std::unique_ptr<Function<void()>>(static_cast<Function<void()>*>(context)))(); };
    Engine::vm_when_idle(*this, run, new Function<void()>(WTF::move(task)));
}

SymbolRegistry& VM::symbolRegistry()
{
    static SymbolRegistry registryOfCurrentThread;
    return registryOfCurrentThread;
}

bool VM::shrinkFootprintNow(OptionSet<ShrinkFootprint> options)
{
    if (isEntered() || heap.mutatorState() != MutatorState::Running)
        return false;
    clearLastException();
    Engine::vm_clear_source_caches(*this);
    if (options.contains(ShrinkFootprint::KeepCodeInUse))
        Engine::vm_delete_unlinked_code(*this);
    else
        deleteAllCode(DeleteAllCodeIfNotCollecting);
    if (!options.contains(ShrinkFootprint::LeaveCollectionToCaller))
        heap.collectNow(Sync, CollectionScope::Full);
    return true;
}

void VM::shrinkFootprintWhenIdle(OptionSet<ShrinkFootprint> options)
{
    whenIdle([this, options] { shrinkFootprintNow(options); });
}

void JSLock::willRelease()
{
    auto& vm = Engine::fieldAt<VM>(this, -OBJECT_OFFSETOF(VM, m_apiLock));
    vm.drainMicrotasks();
    if (!vm.isEntered())
        vm.clearLastException();
}

#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)

ExceptionScope::ExceptionScope(VM& vm, ExceptionEventLocation location)
    : m_vm(vm)
    , m_previous(std::exchange(vm.m_topExceptionScope, this))
    , m_location(location)
{
    verifyThatNoCheckIsOwed(vm, location);
}

ExceptionScope::~ExceptionScope()
{
    RELEASE_ASSERT(m_vm.m_topExceptionScope);
    m_vm.m_topExceptionScope = m_previous;
}

void ExceptionScope::verifyThatNoCheckIsOwed(VM& vm, const ExceptionEventLocation& location)
{
    if (!vm.m_needsExceptionCheck || !Options::validateExceptionChecks()) [[likely]]
        return;
    auto& thrown = vm.m_simulatedThrowLocation;
    dataLogLn("ERROR: Unchecked JS exception:\n    This scope can throw a JS exception: ", thrown.functionName, " @ ", thrown.file, ":", thrown.line);
    dataLogLn("    But the exception was unchecked as of this scope: ", location.functionName, " @ ", location.file, ":", location.line);
    if (vm.m_simulatedThrowStack)
        dataLogLn("The simulated exception was thrown at:\n", vm.m_simulatedThrowStack->toString());
    dataLogLn("Unchecked exception detected at:");
    WTFReportBacktrace();
    RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("exception check validation failed");
}

void ExceptionScope::simulateThrow(VM& vm, const ExceptionEventLocation& location, const ExceptionScope* outer)
{
    bool returnsToGeneratedCode = vm.topEntryFrame && (!outer || outer->m_location.stackPosition > vm.topEntryFrame);
    if (returnsToGeneratedCode)
        return;
    vm.m_needsExceptionCheck = true;
    vm.m_simulatedThrowCount++;
    vm.m_simulatedThrowLocation = location;
    if (Options::dumpSimulatedThrows()) [[unlikely]]
        vm.m_simulatedThrowStack = WTF::StackTrace::captureStackTrace(100);
}

ThrowScope::ThrowScope(VM& vm, ExceptionEventLocation location)
    : ExceptionScope(vm, location)
{
}

ThrowScope::~ThrowScope()
{
    if (m_isReleased)
        didCheck();
    else
        verifyThatNoCheckIsOwed(m_vm, m_location);
    simulateThrow(m_vm, m_location, m_previous);
}

TopExceptionScope::TopExceptionScope(VM& vm, ExceptionEventLocation location)
    : ExceptionScope(vm, location)
{
}

TopExceptionScope::~TopExceptionScope()
{
    verifyThatNoCheckIsOwed(m_vm, m_location);
}

#endif

} // namespace JSC

#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)

namespace Engine {

MayThrow::MayThrow(const JSC::JSGlobalObject* globalObject, bool canThrow, const char* function)
    : m_vm(globalObject->vm())
    , m_function(function)
    , m_throwCountBefore(m_vm.m_simulatedThrowCount)
    , m_canThrow(canThrow)
{
    if (canThrow)
        JSC::ExceptionScope::verifyThatNoCheckIsOwed(m_vm, { nullptr, function, "EngineExports.h", 0 });
}

MayThrow::~MayThrow()
{
    if (m_canThrow || m_vm.m_simulatedThrowCount != m_throwCountBefore)
        JSC::ExceptionScope::simulateThrow(m_vm, { nullptr, m_function, "EngineExports.h", 0 }, m_vm.m_topExceptionScope);
}

} // namespace Engine

#endif
