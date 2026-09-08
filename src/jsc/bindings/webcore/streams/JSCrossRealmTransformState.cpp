#include "config.h"
#include "JSCrossRealmTransformState.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSReadableStreamDefaultController.h"
#include "JSWritableStreamDefaultController.h"
#include "WebStreamsHeapAnalyzer.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using Bun::WebStreams::analyzeBarrierEdge;

const ClassInfo JSCrossRealmTransformState::s_info = { "CrossRealmTransformState"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCrossRealmTransformState) };

JSCrossRealmTransformState::JSCrossRealmTransformState(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSCrossRealmTransformState::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSCrossRealmTransformState* JSCrossRealmTransformState::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSCrossRealmTransformState>(vm)) JSCrossRealmTransformState(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSCrossRealmTransformState::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSCrossRealmTransformState::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSCrossRealmTransformState, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForCrossRealmTransformState, m_subspaceForCrossRealmTransformState));
}

DEFINE_VISIT_CHILDREN(JSCrossRealmTransformState);

template<typename Visitor>
void JSCrossRealmTransformState::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSCrossRealmTransformState>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

void JSCrossRealmTransformState::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSCrossRealmTransformState>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::Port), "port"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::BackpressurePromise), "backpressurePromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::ReadableController), "readableController"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::WritableController), "writableController"_s);
}

} // namespace WebCore
