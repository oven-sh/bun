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

#include "BunGCOutputConstraint.h"
#include "WebCoreTypedArrayController.h"
#include "JavaScriptCore/AbstractSlotVisitorInlines.h"
#include "JavaScriptCore/JSCellInlines.h"
#include "JavaScriptCore/WeakInlines.h"

namespace WebCore {
using namespace JSC;

JSHeapData::JSHeapData(Heap& heap)
    // : m_domNamespaceObjectSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMObject)
    // ,
    : m_subspaces(makeUnique<ExtendedDOMIsoSubspaces>())
    , m_domConstructorSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMConstructorBase)

{
}

#define CLIENT_ISO_SUBSPACE_INIT(subspace) subspace(m_heapData->subspace)

JSVMClientData::JSVMClientData(VM& vm)
    : m_builtinNames(vm)
    , m_heapData(JSHeapData::ensureHeapData(vm.heap))
    , CLIENT_ISO_SUBSPACE_INIT(m_domConstructorSpace)
    , m_clientSubspaces(makeUnique<ExtendedDOMClientIsoSubspaces>())
    , m_builtinFunctions(vm)
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

JSVMClientData::~JSVMClientData() {}

void JSVMClientData::create(VM* vm)
{
    JSVMClientData* clientData = new JSVMClientData(*vm);
    vm->clientData = clientData; // ~VM deletes this pointer.
    clientData->m_normalWorld = DOMWrapperWorld::create(*vm, DOMWrapperWorld::Type::Normal);

    vm->heap.addMarkingConstraint(makeUnique<WebCore::DOMGCOutputConstraint>(*vm, clientData->heapData()));

    vm->m_typedArrayController = adoptRef(new WebCoreTypedArrayController(true));
}

} // namespace WebCore