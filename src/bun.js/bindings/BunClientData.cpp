#include "root.h"

#include "BunClientData.h"

#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "JavaScriptCore/FastMallocAlignedMemoryAllocator.h"
#include "JavaScriptCore/HeapInlines.h"
#include "JavaScriptCore/IsoHeapCellType.h"
#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"
// #include "JavaScriptCore/MarkingConstraint.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "JavaScriptCore/VM.h"
#include "wtf/MainThread.h"

#include "JSDOMConstructorBase.h"
#include "JSDOMBuiltinConstructorBase.h"

#include "BunGCOutputConstraint.h"
#include "WebCoreTypedArrayController.h"
#include "JavaScriptCore/JSCInlines.h"

#include "JSDOMWrapper.h"
#include <JavaScriptCore/DeferredWorkTimer.h>

namespace WebCore {
using namespace JSC;

JSHeapData::JSHeapData(Heap& heap)
    : m_heapCellTypeForJSWorkerGlobalScope(JSC::IsoHeapCellType::Args<Zig::GlobalObject>())
    , m_domBuiltinConstructorSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMBuiltinConstructorBase)
    , m_domConstructorSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMConstructorBase)
    , m_domNamespaceObjectSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMObject)
    , m_subspaces(makeUnique<ExtendedDOMIsoSubspaces>())

{
}

#define CLIENT_ISO_SUBSPACE_INIT(subspace) subspace(m_heapData->subspace)

JSVMClientData::JSVMClientData(VM& vm)
    : m_builtinFunctions(vm)
    , m_builtinNames(vm)
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

JSVMClientData::~JSVMClientData()
{
    ASSERT(m_normalWorld->hasOneRef());
    m_normalWorld = nullptr;
}
void JSVMClientData::create(VM* vm, void* bunVM)
{
    JSVMClientData* clientData = new JSVMClientData(*vm);
    clientData->bunVM = bunVM;
    vm->deferredWorkTimer->onAddPendingWork = Bun::JSCTaskScheduler::onAddPendingWork;
    vm->deferredWorkTimer->onScheduleWorkSoon = Bun::JSCTaskScheduler::onScheduleWorkSoon;
    vm->deferredWorkTimer->onCancelPendingWork = Bun::JSCTaskScheduler::onCancelPendingWork;

    vm->clientData = clientData; // ~VM deletes this pointer.
    clientData->m_normalWorld = DOMWrapperWorld::create(*vm, DOMWrapperWorld::Type::Normal);

    vm->heap.addMarkingConstraint(makeUnique<WebCore::DOMGCOutputConstraint>(*vm, clientData->heapData()));
    vm->m_typedArrayController = adoptRef(new WebCoreTypedArrayController(true));
}

} // namespace WebCore