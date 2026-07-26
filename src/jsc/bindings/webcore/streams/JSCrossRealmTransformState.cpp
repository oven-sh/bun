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
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSCrossRealmTransformState::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSCrossRealmTransformState, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForCrossRealmTransformState.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCrossRealmTransformState = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForCrossRealmTransformState.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForCrossRealmTransformState = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSCrossRealmTransformState);

template<typename Visitor>
void JSCrossRealmTransformState::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSCrossRealmTransformState>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_port);
    visitor.appendHidden(thisObject->m_backpressurePromise);
    visitor.appendHidden(thisObject->m_readableController);
    visitor.appendHidden(thisObject->m_writableController);
}

void JSCrossRealmTransformState::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSCrossRealmTransformState>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_port, "port"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_backpressurePromise, "backpressurePromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_readableController, "readableController"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_writableController, "writableController"_s);
}

} // namespace WebCore
