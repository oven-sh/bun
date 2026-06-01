#include "root.h"

#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"

#include <atomic>
#include <cstdint>

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

// Number of live `JSHeapData` instances. One is created per VM (the non-global
// GC path). Exposed to tests via `bun:internal-for-testing` so a regression
// test can assert a terminated worker's `JSHeapData` is actually freed rather
// than leaked. Release builds reuse the freed backing memory, so neither RSS
// nor LSAN reliably surface the leak — a live-instance count is the
// deterministic signal.
static std::atomic<int64_t> s_jsHeapDataLiveCount { 0 };

extern "C" int64_t Bun__JSHeapData__liveCount()
{
    return s_jsHeapDataLiveCount.load(std::memory_order_relaxed);
}

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
    s_jsHeapDataLiveCount.fetch_add(1, std::memory_order_relaxed);
}

JSHeapData::~JSHeapData()
{
    s_jsHeapDataLiveCount.fetch_sub(1, std::memory_order_relaxed);
}

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

JSVMClientData::~JSVMClientData()
{
    m_clients.forEach([](auto& client) {
        client.willDestroyVM();
    });
    m_clients.clear();

    m_normalWorld = nullptr;

    // `m_heapData` is a raw, owning pointer. On the default (`!useGlobalGC`)
    // path `ensureHeapData` allocates a fresh `JSHeapData` per VM, so it must
    // be freed here or it leaks on every VM teardown — which, since only worker
    // VMs are destroyed, manifests as unbounded WKFastMalloc growth across
    // repeated `new Worker()` + `terminate()` cycles (the embedded IsoSubspaces
    // each own a FastMalloc-backed allocator). When `useGlobalGC` is enabled the
    // pointer aliases a process-wide `static` singleton shared by every VM, so
    // it must NOT be deleted. `~VM` runs `delete clientData` only after
    // `heap.lastChanceToFinalize()`, and `heap` outlives this destructor, so the
    // IsoSubspaces are safe to tear down here.
    if (!JSC::Options::useGlobalGC()) {
        delete m_heapData;
    }
    m_heapData = nullptr;
}
void JSVMClientData::create(VM* vm, void* bunVM)
{
    auto provider = WebCore::createBuiltinsSourceProvider();
    JSVMClientData* clientData = new JSVMClientData(*vm, provider);
    clientData->bunVM = bunVM;
    vm->deferredWorkTimer->onAddPendingWork = [clientData](Ref<JSC::DeferredWorkTimer::TicketData>&& ticket, JSC::DeferredWorkTimer::WorkType kind) -> void {
        Bun::JSCTaskScheduler::onAddPendingWork(clientData, WTF::move(ticket), kind);
    };
    vm->deferredWorkTimer->onScheduleWorkSoon = [clientData](JSC::DeferredWorkTimer::Ticket ticket, JSC::DeferredWorkTimer::Task&& task) -> void {
        Bun::JSCTaskScheduler::onScheduleWorkSoon(clientData, ticket, WTF::move(task));
    };
    vm->deferredWorkTimer->onCancelPendingWork = [clientData](JSC::DeferredWorkTimer::Ticket ticket) -> void {
        Bun::JSCTaskScheduler::onCancelPendingWork(clientData, ticket);
    };

    vm->clientData = clientData; // ~VM deletes this pointer.
    clientData->m_normalWorld = DOMWrapperWorld::create(*vm, DOMWrapperWorld::Type::Normal);

    vm->heap.addMarkingConstraint(makeUnique<WebCore::DOMGCOutputConstraint>(*vm, clientData->heapData()));
    vm->m_typedArrayController = adoptRef(new WebCoreTypedArrayController(true));
    clientData->builtinFunctions().exportNames();
}

WebCore::HTTPHeaderIdentifiers& JSVMClientData::httpHeaderIdentifiers()
{
    if (!m_httpHeaderIdentifiers)
        m_httpHeaderIdentifiers.emplace();
    return *m_httpHeaderIdentifiers;
}

} // namespace WebCore
