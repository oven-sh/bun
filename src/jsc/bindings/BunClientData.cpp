#include "root.h"

#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"

#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include <JavaScriptCore/FastMallocAlignedMemoryAllocator.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/IsoHeapCellType.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
// #include <JavaScriptCore/MarkingConstraint.h>
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
    m_clients.forEach([](auto& client) {
        client.willDestroyVM();
    });
    m_clients.clear();

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
    vm->m_typedArrayController = adoptRef(new WebCoreTypedArrayController(true));
    clientData->builtinFunctions().exportNames();
}

} // namespace WebCore
