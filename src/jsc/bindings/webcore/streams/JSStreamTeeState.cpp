#include "config.h"
#include "JSStreamTeeState.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSReadableStream.h"
#include "WebStreamsHeapAnalyzer.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using Bun::WebStreams::analyzeBarrierEdge;
using Bun::WebStreams::visitInternalFieldsHidden;

const ClassInfo JSStreamTeeState::s_info = { "StreamTeeState"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStreamTeeState) };

JSStreamTeeState::JSStreamTeeState(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSStreamTeeState::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSStreamTeeState* JSStreamTeeState::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSStreamTeeState>(vm)) JSStreamTeeState(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSStreamTeeState::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSStreamTeeState::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSStreamTeeState, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForStreamTeeState, m_subspaceForStreamTeeState));
}

DEFINE_VISIT_CHILDREN(JSStreamTeeState);

template<typename Visitor>
void JSStreamTeeState::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSStreamTeeState>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    visitInternalFieldsHidden(thisObject, visitor);
}

void JSStreamTeeState::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSStreamTeeState>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::Stream), "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::Reader), "reader"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::Branch1), "branch1"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::Branch2), "branch2"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::CancelPromise), "cancelPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::Reason1), "reason1"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::Reason2), "reason2"_s);
}

} // namespace WebCore
