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
#include <JavaScriptCore/CachedTypes.h>
#include <JavaScriptCore/PrelinkedModuleGraph.h>
#include <wtf/MainThread.h>

#include "JSDOMConstructorBase.h"

#include "BunGCOutputConstraint.h"
#include "WebCoreTypedArrayController.h"
#include <JavaScriptCore/JSCInlines.h>

#include "JSDOMWrapper.h"
#include <JavaScriptCore/DeferredWorkTimer.h>
#include "NodeVM.h"
#include "../../runtime/bake/BakeGlobalObject.h"
#include "napi_handle_scope.h"
#include "NativePromiseContext.h"
#include "ModuleGraph.h"
#include "StrongRootBlock.h"
#include "JSPerformance.h"
#include "BunProcess.h"

namespace WebCore {
using namespace JSC;

RefPtr<JSC::SourceProvider> createBuiltinsSourceProvider();

JSHeapData::JSHeapData(Heap& heap)
    : m_heapCellTypeForJSWorkerGlobalScope(JSC::IsoHeapCellType::Args<Zig::GlobalObject>())
    , m_heapCellTypeForNodeVMGlobalObject(JSC::IsoHeapCellType::Args<Bun::NodeVMGlobalObject>())
    , m_heapCellTypeForBakeGlobalObject(JSC::IsoHeapCellType::Args<Bake::GlobalObject>())
    , m_heapCellTypeForNapiHandleScopeImpl(JSC::IsoHeapCellType::Args<Bun::NapiHandleScopeImpl>())
    , m_heapCellTypeForNativePromiseContext(JSC::IsoHeapCellType::Args<Bun::NativePromiseContext>())
    , m_heapCellTypeForJSModuleGraph(JSC::IsoHeapCellType::Args<Bun::JSModuleGraph>())
    , m_domConstructorSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMConstructorBase)
    , m_domNamespaceObjectSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMObject)
    , m_subspaces(makeUnique<ExtendedDOMIsoSubspaces>())

{
}

JSHeapData::~JSHeapData() = default;

#define CLIENT_ISO_SUBSPACE_INIT(subspace) subspace(m_heapData->subspace)

JSVMClientData::JSVMClientData(VM& vm, RefPtr<JSC::SourceProvider> sourceProvider)
    : commonStrings(vm)
    , schemaStrings(vm)
    , m_builtinNames(vm)
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

JSVMClientData::~JSVMClientData()
{
    while (!m_clients.isEmpty()) {
        auto* client = &*m_clients.begin();
        client->remove();
        client->willDestroyVM();
    }
    ASSERT(m_sqliteDatabases.isEmpty());

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
        "Srb"_s, "Bun StrongRootBlocks"_s,
        MAKE_MARKING_CONSTRAINT_EXECUTOR_PAIR(([clientData](auto& visitor) {
            JSC::SetRootMarkReasonScope rootScope(visitor, JSC::RootMarkReason::StrongHandles);
            visitor.appendUnbarriered(clientData->m_strongRootBlockHead);
            visitor.appendUnbarriered(clientData->m_strongRootBlockFree);
            visitor.appendUnbarriered(clientData->m_strongRootBlockStructure);
        })),
        JSC::ConstraintVolatility::GreyedByExecution));

    // The common string cache: slots filled by the JS thread, read here with the world stopped (as above).
    vm->heap.addMarkingConstraint(makeUnique<JSC::SimpleMarkingConstraint>(
        "Bcs"_s, "Bun CommonStrings"_s,
        MAKE_MARKING_CONSTRAINT_EXECUTOR_PAIR(([clientData](auto& visitor) {
            JSC::SetRootMarkReasonScope rootScope(visitor, JSC::RootMarkReason::StrongHandles);
            clientData->commonStrings.visit(visitor);
            clientData->schemaStrings.visit(visitor);
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
    if (prototype.isObject())
        globalObject->didCreateBuiltin(vm, asObject(prototype));
    return JSC::Structure::create(vm, globalObject, prototype, typeInfo, classInfo, indexingType, inlineCapacity);
}

JSC::JSValue namespaceObjectOf(JSC::VM& vm, JSC::JSObject* owner, JSC::JSValue namespaceObject)
{
    if (!owner->hasImmutableProperties() || !namespaceObject || !namespaceObject.isObject()) [[likely]]
        return namespaceObject;

    // The objects it holds are part of it too: `Bun.FFI.read`, `process.config.variables`.
    JSC::DeferGC deferGC(vm);
    Vector<JSC::JSObject*, 8> objects { asObject(namespaceObject) };
    while (!objects.isEmpty()) {
        auto* object = objects.takeLast();
        if (object->hasImmutableProperties())
            continue;
        owner->globalObject()->makeObjectAndItsFunctionsImmutable(vm, object);
        object->structure()->forEachProperty(vm, [&](const JSC::PropertyTableEntry& entry) {
            if (JSC::JSValue value = object->getDirect(entry.offset()); value.isObject())
                objects.append(asObject(value));
            return true;
        });
    }
    return namespaceObject;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDefineBuiltinProperty, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* builtin = callFrame->argument(0).getObject();
    if (!builtin)
        return throwVMTypeError(globalObject, scope, "Properties can only be defined on Objects."_s);
    auto key = callFrame->argument(1).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::PropertyDescriptor descriptor;
    JSC::toPropertyDescriptor(globalObject, callFrame->argument(2), descriptor);
    RETURN_IF_EXCEPTION(scope, {});

    bool isImmutable = builtin->hasImmutableProperties();
    if (isImmutable) {
        // Building a lazy property may run JavaScript, which must not happen while the write is allowed.
        JSC::PropertySlot slot(builtin, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
        builtin->methodTable()->getOwnPropertySlot(builtin, globalObject, key, slot);
        RETURN_IF_EXCEPTION(scope, {});
    }
    {
        std::optional<JSC::AllowLazyMaterializationOfImmutableProperties> allowMaterialization;
        if (isImmutable)
            allowMaterialization.emplace(vm);
        builtin->methodTable()->defineOwnProperty(builtin, globalObject, key, descriptor, true);
    }
    RETURN_IF_EXCEPTION(scope, {});
    if (isImmutable) {
        for (JSC::JSValue added : { descriptor.value(), descriptor.isAccessorDescriptor() ? descriptor.getter() : JSC::JSValue(), descriptor.isAccessorDescriptor() ? descriptor.setter() : JSC::JSValue() }) {
            if (added && added.isCallable())
                globalObject->makeObjectAndItsFunctionsImmutable(vm, asObject(added));
        }
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDeleteBuiltinProperty, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* builtin = callFrame->argument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto key = callFrame->argument(1).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    bool isImmutable = builtin->hasImmutableProperties();
    if (isImmutable && !builtin->staticPropertiesReified()) {
        // Building a lazy property may run JavaScript, which must not happen while the write is allowed.
        builtin->reifyAllStaticProperties(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    bool didDelete;
    {
        std::optional<JSC::AllowLazyMaterializationOfImmutableProperties> allowMaterialization;
        if (isImmutable)
            allowMaterialization.emplace(vm);
        didDelete = JSC::JSCell::deleteProperty(builtin, globalObject, key);
    }
    RETURN_IF_EXCEPTION(scope, {});
    if (!didDelete)
        return throwVMTypeError(globalObject, scope, JSC::UnableToDeletePropertyError);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSetBuiltinPrototype, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* builtin = callFrame->argument(0).getObject();
    JSC::JSValue prototype = callFrame->argument(1);
    if (!builtin || !(prototype.isObject() || prototype.isNull()))
        return throwVMTypeError(globalObject, scope, "Object prototype may only be an Object or null"_s);

    std::optional<JSC::AllowLazyMaterializationOfImmutableProperties> allowMaterialization;
    if (builtin->hasImmutableProperties())
        allowMaterialization.emplace(vm);
    scope.release();
    builtin->setPrototype(vm, globalObject, prototype, true);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC::JSValue blobPrototype(Zig::GlobalObject* globalObject)
{
    return globalObject->JSBlobPrototype();
}

JSC::JSValue performancePrototype(Zig::GlobalObject* globalObject)
{
    return WebCore::JSPerformance::prototype(JSC::getVM(globalObject), *globalObject);
}

JSC::JSValue processPrototype(Zig::GlobalObject* globalObject)
{
    return globalObject->processObject()->getPrototypeDirect();
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDidCreateBuiltin, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    if (auto* builtin = callFrame->argument(0).getObject())
        globalObject->didCreateBuiltin(JSC::getVM(globalObject), builtin);
    return JSC::JSValue::encode(JSC::jsUndefined());
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

void JSVMClientData::reconcileWeakReferencesAtGCEnd(JSC::VM& vm, JSC::CollectionScope)
{
    Bun::JSCTaskScheduler::cancelWorkOfDeadRealms(this, vm);
}

void JSVMClientData::setDecoderStringTable(std::span<const uint8_t> bytes)
{
    if (m_decoderStringTable)
        return; // slots may already hold cells this VM visits; never replace
    m_decoderStringTable = makeUnique<JSC::DecoderStringTable>(bytes);
}

extern "C" bool Bun__standalonePrelinkedModuleGraph(const uint8_t** blob, size_t* blobLength, const uint8_t** slotTable, size_t* slotTableLength);

JSC::PrelinkedModuleGraph* JSVMClientData::prelinkedModuleGraph(JSC::VM& vm)
{
    if (!m_prelinkedModuleGraphChecked) [[unlikely]] {
        if (!m_decoderStringTable)
            return nullptr; // not installed (yet): a later call may still build the graph
        m_prelinkedModuleGraphChecked = true;
        const uint8_t* blob = nullptr;
        size_t blobLength = 0;
        const uint8_t* slotTable = nullptr;
        size_t slotTableLength = 0;
        if (Bun__standalonePrelinkedModuleGraph(&blob, &blobLength, &slotTable, &slotTableLength) && slotTableLength >= sizeof(uint32_t)) {
            // ModuleInfoSlotTable: u32 count, then `count` u32 slots (4-byte aligned in the mapped section).
            ASSERT(!(reinterpret_cast<uintptr_t>(slotTable) % alignof(uint32_t)));
            uint32_t count = 0;
            memcpy(&count, slotTable, sizeof(count));
            if (count <= (slotTableLength - sizeof(uint32_t)) / sizeof(uint32_t))
                m_prelinkedModuleGraph = JSC::PrelinkedModuleGraph::tryCreate(vm, *m_decoderStringTable, { blob, blobLength }, { reinterpret_cast<const uint32_t*>(slotTable + sizeof(uint32_t)), count });
        }
    }
    return m_prelinkedModuleGraph.get();
}

} // namespace WebCore
