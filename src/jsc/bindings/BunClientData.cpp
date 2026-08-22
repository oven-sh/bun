#include "root.h"

#include "BunClientData.h"
#include "WorkerMessagingProxy.h"
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

#include "BunGCOutputConstraint.h"
#include "WebCoreTypedArrayController.h"
#include <JavaScriptCore/JSCInlines.h>

#include "JSDOMWrapper.h"
#include <JavaScriptCore/DeferredWorkTimer.h>
#include <JavaScriptCore/HeapObserver.h>
#include "NodeVM.h"
#include "../../runtime/bake/BakeGlobalObject.h"
#include "napi_handle_scope.h"
#include "NativePromiseContext.h"
#include "StrongRootBlock.h"

#if OS(WINDOWS)
#include <stdlib.h>
#else
#include <unistd.h>
#endif

namespace Bun {

// Enforces `--max-old-space-size`: when a full GC cannot keep the live heap
// under the limit, fail fast with Node's fatal OOM message and exit code
// instead of letting the process grow until the OS kills it.
class HeapSizeLimitObserver final : public JSC::HeapObserver {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(HeapSizeLimitObserver);

public:
    HeapSizeLimitObserver(JSC::Heap& heap, size_t limit)
        : m_heap(heap)
        , m_limit(limit)
    {
    }

    void willGarbageCollect() final {}

    // May run on the collector thread; only reads heap counters and exits.
    void didGarbageCollect(JSC::CollectionScope scope) final
    {
        if (scope != JSC::CollectionScope::Full)
            return;
        size_t sizeAfterGC = m_heap.sizeAfterLastFullCollection();
        if (sizeAfterGC <= m_limit) [[likely]]
            return;
        fprintf(stderr,
            "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n"
            "(heap size %zu MB exceeded the limit of %zu MB set by --max-old-space-size)\n",
            sizeAfterGC / (1024 * 1024), m_limit / (1024 * 1024));
        fflush(stderr);
        // Node exits with 134 (128 + SIGABRT) here; _exit keeps it
        // deterministic and safe from any thread.
        _exit(134);
    }

    JSC::Heap& heap() { return m_heap; }

private:
    JSC::Heap& m_heap;
    size_t m_limit;
};

} // namespace Bun

namespace WebCore {
using namespace JSC;

RefPtr<JSC::SourceProvider> createBuiltinsSourceProvider();

JSHeapData::JSHeapData(Heap& heap)
    : m_heapCellTypeForJSWorkerGlobalScope(JSC::IsoHeapCellType::Args<Zig::GlobalObject>())
    , m_heapCellTypeForNodeVMGlobalObject(JSC::IsoHeapCellType::Args<Bun::NodeVMGlobalObject>())
    , m_heapCellTypeForBakeGlobalObject(JSC::IsoHeapCellType::Args<Bake::GlobalObject>())
    , m_heapCellTypeForNapiHandleScopeImpl(JSC::IsoHeapCellType::Args<Bun::NapiHandleScopeImpl>())
    , m_heapCellTypeForNativePromiseContext(JSC::IsoHeapCellType::Args<Bun::NativePromiseContext>())
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
    , CLIENT_ISO_SUBSPACE_INIT(m_domConstructorSpace)
    , CLIENT_ISO_SUBSPACE_INIT(m_domNamespaceObjectSpace)
    , m_clientSubspaces(makeUnique<ExtendedDOMClientIsoSubspaces>())
    , m_heapSizeAfterLastCollection(vm.heap)
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

void JSVMClientData::enforceMaxOldSpaceSize(VM& vm, size_t limitBytes)
{
    ASSERT(!m_heapSizeLimitObserver);
    m_heapSizeLimitObserver = makeUnique<Bun::HeapSizeLimitObserver>(vm.heap, limitBytes);
    vm.heap.addObserver(m_heapSizeLimitObserver.get());
}

JSVMClientData::~JSVMClientData()
{
    if (m_heapSizeLimitObserver)
        m_heapSizeLimitObserver->heap().removeObserver(m_heapSizeLimitObserver.get());

    while (!m_clients.isEmpty()) {
        auto* client = &*m_clients.begin();
        client->remove();
        client->willDestroyVM();
    }

    m_normalWorld = nullptr;
    if (vmHandle)
        Bun__VmHandle__release(std::exchange(vmHandle, nullptr));
}
void JSVMClientData::create(VM* vm, void* bunVM, WorkerMessagingProxy* worker)
{
    auto provider = WebCore::createBuiltinsSourceProvider();
    JSVMClientData* clientData = new JSVMClientData(*vm, provider);
    clientData->bunVM = bunVM;
    clientData->m_isWorkerVM = !!worker;
    clientData->m_isNodeWorkerVM = worker && worker->options().kind == WorkerOptions::Kind::Node;
    clientData->vmHandle = Bun__VmHandle__retain(bunVM);
    clientData->vmHandleState = Bun__VmHandle__stateAddress(clientData->vmHandle);
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

JSC::GCClient::IsoSubspace* subspaceForImplSlow(JSC::VM& vm, const SubspaceForInit& init, SubspaceSlots slots, JSC::HeapCellType& (*getCustomHeapCellType)(JSHeapData&))
{
    auto& clientData = *downcast<JSVMClientData>(vm.clientData);
    auto& clientSlot = *reinterpret_cast<JSC::GCClient::IsoSubspace**>(reinterpret_cast<uint8_t*>(&clientData.clientSubspaces()) + slots.clientOffset);

    auto& heapData = clientData.heapData();
    Locker locker { heapData.lock() };

    auto& serverSlot = *reinterpret_cast<JSC::IsoSubspace**>(reinterpret_cast<uint8_t*>(&heapData.subspaces()) + slots.serverOffset);
    JSC::IsoSubspace* space = serverSlot;
    if (!space) {
        JSC::Heap& heap = vm.heap;
        const JSC::HeapCellType* cellType;
        switch (init.cellType) {
        case SubspaceForInit::CellType::Custom:
            cellType = &getCustomHeapCellType(heapData);
            break;
        case SubspaceForInit::CellType::Destructible:
            cellType = &heap.destructibleObjectHeapCellType;
            break;
        case SubspaceForInit::CellType::Cell:
            cellType = &heap.cellHeapCellType;
            break;
        }
        // What `ISO_SUBSPACE_INIT(heap, ..., T)` stringified to inside the old template: the token `T`.
        space = serverSlot = makeUnique<JSC::IsoSubspace>("T"_s, heap, *cellType, init.cellSize, init.numberOfLowerTierPreciseCells).release();

        if (init.hasOutputConstraints)
            heapData.outputConstraintSpaces().append(space);
    }

    clientSlot = makeUnique<JSC::GCClient::IsoSubspace>(*space).release();
    return clientSlot;
}

} // namespace WebCore

namespace Bun {

JSC::Structure* createClassStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype, JSC::TypeInfo typeInfo, const JSC::ClassInfo* classInfo, JSC::IndexingType indexingType, unsigned inlineCapacity)
{
    return JSC::Structure::create(vm, globalObject, prototype, typeInfo, classInfo, indexingType, inlineCapacity);
}

void reifyStaticPropertyTable(JSC::VM& vm, const JSC::ClassInfo* classInfo, std::span<const JSC::HashTableValue> values, JSC::JSObject& object)
{
    JSC::reifyStaticProperties(vm, classInfo, values, object);
}

class PlainObjectCell : public JSC::JSNonFinalObject {
public:
    template<typename, JSC::SubspaceAccess> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm) { return &vm.plainObjectSpace(); }
};

void putToStringTagWithoutTransition(JSC::VM& vm, JSC::JSObject* object, const JSC::ClassInfo* classInfo)
{
    object->putDirectWithoutTransition(vm, vm.propertyNames->toStringTagSymbol, JSC::jsNontrivialString(vm, classInfo->className), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
}

void* allocatePlainObjectCell(JSC::VM& vm, size_t size)
{
    ASSERT(size == sizeof(JSC::JSNonFinalObject));
    return JSC::allocateCell<PlainObjectCell>(vm, size);
}

} // namespace Bun

namespace WebCore {

template<typename Subspace, typename Table>
static void deleteSubspaceTable(Table* table)
{
    static_assert(sizeof(Table) % sizeof(Subspace*) == 0);
    auto** slots = reinterpret_cast<Subspace**>(table);
    for (size_t i = 0; i < sizeof(Table) / sizeof(Subspace*); ++i)
        std::unique_ptr<Subspace> { slots[i] };
}

DOMIsoSubspaces::~DOMIsoSubspaces()
{
    deleteSubspaceTable<JSC::IsoSubspace>(this);
}

DOMClientIsoSubspaces::~DOMClientIsoSubspaces()
{
    deleteSubspaceTable<JSC::GCClient::IsoSubspace>(this);
}

} // namespace WebCore
