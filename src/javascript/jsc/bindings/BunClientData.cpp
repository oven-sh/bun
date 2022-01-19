
#include "BunClientData.h"
#include "root.h"

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

JSVMClientData::JSVMClientData(VM &vm) : m_builtinNames(vm) {}

JSVMClientData::~JSVMClientData() {}

void JSVMClientData::create(VM *vm) {
  JSVMClientData *clientData = new JSVMClientData(*vm);
  vm->clientData = clientData; // ~VM deletes this pointer.

  //   vm->heap.addMarkingConstraint(makeUnique<BunGCOutputConstraint>(*vm, *clientData));

  //   vm->m_typedArrayController = adoptRef(new WebCoreTypedArrayController(
  //     type == WorkerThreadType::DedicatedWorker || type == WorkerThreadType::Worklet));
}

} // namespace Bun