#include "root.h"

#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"

#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include <JavaScriptCore/FastMallocAlignedMemoryAllocator.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/IsoHeapCellType.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/SimpleMarkingConstraint.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/VM.h>
#include <wtf/MainThread.h>

#include "JSDOMConstructorBase.h"
#include "JSDOMBuiltinConstructorBase.h"

#include "BunGCOutputConstraint.h"
#include "WebCoreTypedArrayController.h"
#include <JavaScriptCore/JSCInlines.h>

#include "JSDOMWrapper.h"
#include <JavaScriptCore/DeferredWorkTimer.h>
#include "NodeVM.h"
#include "../../runtime/bake/BakeGlobalObject.h"
#include "napi_handle_scope.h"
#include "NativePromiseContext.h"
#include "StrongRootBlock.h"

namespace WebCore {
using namespace JSC;

RefPtr<JSC::SourceProvider> createBuiltinsSourceProvider();

JSHeapData::JSHeapData(Heap& heap)
    : m_heapCellTypeForJSWorkerGlobalScope(JSC::IsoHeapCellType::Args<Zig::GlobalObject>())
    , m_heapCellTypeForNodeVMGlobalObject(JSC::IsoHeapCellType::Args<Bun::NodeVMGlobalObject>())
    , m_heapCellTypeForBakeGlobalObject(JSC::IsoHeapCellType::Args<Bake::GlobalObject>())
    , m_heapCellTypeForNapiHandleScopeImpl(JSC::IsoHeapCellType::Args<Bun::NapiHandleScopeImpl>())
    , m_heapCellTypeForNativePromiseContext(JSC::IsoHeapCellType::Args<Bun::NativePromiseContext>())
    , m_domBuiltinConstructorSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMBuiltinConstructorBase)
    , m_domConstructorSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMConstructorBase)
    , m_domNamespaceObjectSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMObject)
    , m_subspaces(makeUnique<ExtendedDOMIsoSubspaces>())

{
}

JSHeapData::~JSHeapData() = default;

#define CLIENT_ISO_SUBSPACE_INIT(subspace) subspace(m_heapData->subspace)

JSVMClientData::JSVMClientData(VM& vm, RefPtr<JSC::SourceProvider> sourceProvider)
    : m_builtinNames(vm)
    , m_builtinFunctions(makeUnique<JSBuiltinFunctions>(vm, sourceProvider, m_builtinNames))
    , m_heapData(JSHeapData::ensureHeapData(vm.heap))
    , CLIENT_ISO_SUBSPACE_INIT(m_domBuiltinConstructorSpace)
    , CLIENT_ISO_SUBSPACE_INIT(m_domConstructorSpace)
    , CLIENT_ISO_SUBSPACE_INIT(m_domNamespaceObjectSpace)
    , m_clientSubspaces(makeUnique<ExtendedDOMClientIsoSubspaces>())
{
}

#undef CLIENT_ISO_SUBSPACE_INIT

JSHeapData* JSHeapData::ensureHeapData(Heap& heap)
{
    if (!Options::useGlobalGC())
        return new JSHeapData(heap);

    static JSHeapData* singleton = nullptr;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        singleton = new JSHeapData(heap);
    });
    return singleton;
}

DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(JSVMClientData);

// Frees a per-VM `JSHeapData`; leaves the `useGlobalGC` singleton alone (it is
// shared by every VM and lives for the process lifetime). This runs as part of
// `~JSVMClientData` member teardown — after the client `IsoSubspace` members,
// whose `~LocalAllocator` dereferences a `BlockDirectory` inside this object
// (see the member-ordering note in the header). `~VM` invokes `~JSVMClientData`
// only after `heap.lastChanceToFinalize()`, with `heap` (a `VM` member)
// outliving the destructor, so tearing the server `IsoSubspace`s down here is
// safe.
void JSVMClientData::JSHeapDataDeleter::operator()(JSHeapData* heapData) const
{
    if (!JSC::Options::useGlobalGC())
        delete heapData;
}

JSVMClientData::~JSVMClientData()
{
    m_normalWorld = nullptr;
}
void JSVMClientData::create(VM* vm, void* bunVM)
{
    auto provider = WebCore::createBuiltinsSourceProvider();
    JSVMClientData* clientData = new JSVMClientData(*vm, provider);
    clientData->bunVM = bunVM;
    vm->deferredWorkTimer->onAddPendingWork = [clientData](Ref<JSC::DeferredWorkTimer::Ticket>&& ticket, JSC::DeferredWorkTimer::WorkType kind) -> void {
        Bun::JSCTaskScheduler::onAddPendingWork(clientData, WTF::move(ticket), kind);
    };
    vm->deferredWorkTimer->onScheduleWorkSoon = [clientData](Ref<JSC::DeferredWorkTimer::Ticket>&& ticket, JSC::DeferredWorkTimer::Task&& task) -> void {
        Bun::JSCTaskScheduler::onScheduleWorkSoon(clientData, WTF::move(ticket), WTF::move(task));
    };
    vm->deferredWorkTimer->onCancelPendingWork = [clientData](JSC::DeferredWorkTimer::Ticket& ticket) -> void {
        Bun::JSCTaskScheduler::onCancelPendingWork(clientData, ticket);
    };

    vm->clientData = clientData; // ~VM deletes this pointer.
    clientData->m_normalWorld = DOMWrapperWorld::create(*vm, DOMWrapperWorld::Type::Normal);

    vm->heap.addMarkingConstraint(makeUnique<WebCore::DOMGCOutputConstraint>(*vm, clientData->heapData()));

    // Root the StrongRootBlock list from the VM instead of any one global.
    //
    // JSC's collector alternates Fixpoint (world stopped: mutator suspended via
    // finishChangingPhase / stopTheMutator; see worldShouldBeSuspended in
    // CollectorPhase.cpp) with Concurrent (mutator running) phases. The
    // constraint set is solved only during Fixpoint, so the lambda below never
    // races the mutator's writes to m_strongRootBlockHead/Free.
    //
    // `GreyedByExecution` puts this in the "root" bucket
    // (MarkingConstraintSet::didStartMarking tags it as an unexecuted root for
    // iteration 1 and re-evaluates it on every return to Fixpoint after a
    // mutator resumption), mirroring the "Sh" strong-handle constraint in
    // Heap::addCoreConstraints: anything the mutator linked onto the list while
    // running is picked up on the next Fixpoint.
    //
    // Eden vs. full: `appendUnbarriered` early-returns when `isMarked()`; eden
    // keeps the previous full GC's `m_markingVersion`
    // (MarkedSpace::beginMarking), so an old-gen head reads as marked and its
    // `visitChildren` does not run on eden. Slots written into such a block
    // since the last GC already fired `WriteBarrier::set` on the block cell
    // (Heap::writeBarrierSlowPath -> addToRememberedSet -> m_mutatorMarkStack),
    // and Fixpoint drains that stack to visit the dirtied block. A full GC
    // bumps `m_markingVersion`, every cell reads unmarked, and the constraint
    // seeds the whole `m_next` chain. Net: this body is O(1) per collection.
    //
    // `Concurrent` here means the constraint may run on a GC helper thread via
    // MarkingConstraintSolver::runExecutionThread (MarkingConstraintSet still
    // runs each constraint once per fixpoint iteration, gated by `m_executed`);
    // it does not mean concurrent with the mutator. The lambda only reads three
    // pointers and appends to the per-thread visitor, so helper-thread
    // execution is safe. `clientData` outlives the Heap
    // (~VM -> lastChanceToFinalize -> delete clientData), so the capture stays
    // valid for every collection.
    vm->heap.addMarkingConstraint(makeUnique<JSC::SimpleMarkingConstraint>(
        "Srb", "Bun StrongRootBlocks",
        MAKE_MARKING_CONSTRAINT_EXECUTOR_PAIR(([clientData](auto& visitor) {
            JSC::SetRootMarkReasonScope rootScope(visitor, JSC::RootMarkReason::StrongHandles);
            visitor.appendUnbarriered(clientData->m_strongRootBlockHead);
            visitor.appendUnbarriered(clientData->m_strongRootBlockFree);
            visitor.appendUnbarriered(clientData->m_strongRootBlockStructure);
        })),
        JSC::ConstraintVolatility::GreyedByExecution));

    vm->m_typedArrayController = adoptRef(new WebCoreTypedArrayController(true));
    clientData->builtinFunctions().exportNames();
}

} // namespace WebCore
