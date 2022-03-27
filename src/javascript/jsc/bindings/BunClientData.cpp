
#include "BunClientData.h"
#include "root.h"

#include "JSDOMURL.h"
#include <JavaScriptCore/FastMallocAlignedMemoryAllocator.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/IsoHeapCellType.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/MarkingConstraint.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/VM.h>
#include <wtf/MainThread.h>

// #include "BunGCOutputConstraint.h"

namespace Bun {
using namespace JSC;
using namespace WebCore;

class ExtendedDOMClientIsoSubspaces;
class ExtendedDOMIsoSubspaces;

#define CLIENT_ISO_SUBSPACE_INIT(subspace) subspace(m_heapData->subspace)
JSHeapData::JSHeapData(Heap& heap)
    : m_domNamespaceObjectSpace ISO_SUBSPACE_INIT(heap, heap.cellHeapCellType, JSDOMObject)

{
}

JSVMClientData::JSVMClientData(VM& vm)
    : m_builtinNames(vm)
    , m_heapData(JSHeapData::ensureHeapData(vm.heap))
{
}

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

    // vm->heap.addMarkingConstraint(makeUnique<BunGCOutputConstraint>(*vm, *clientData));

    //   vm->m_typedArrayController = adoptRef(new WebCoreTypedArrayController(
    //     type == WorkerThreadType::DedicatedWorker || type == WorkerThreadType::Worklet));
}

} // namespace Bun