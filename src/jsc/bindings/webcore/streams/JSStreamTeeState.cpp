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
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSStreamTeeState::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSStreamTeeState, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForStreamTeeState.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForStreamTeeState = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForStreamTeeState.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForStreamTeeState = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSStreamTeeState);

template<typename Visitor>
void JSStreamTeeState::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSStreamTeeState>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_reader);
    visitor.appendHidden(thisObject->m_branch1);
    visitor.appendHidden(thisObject->m_branch2);
    visitor.appendHidden(thisObject->m_cancelPromise);
    visitor.appendHidden(thisObject->m_reason1);
    visitor.appendHidden(thisObject->m_reason2);
}

void JSStreamTeeState::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSStreamTeeState>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_reader, "reader"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_branch1, "branch1"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_branch2, "branch2"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_cancelPromise, "cancelPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_reason1, "reason1"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_reason2, "reason2"_s);
}

} // namespace WebCore
