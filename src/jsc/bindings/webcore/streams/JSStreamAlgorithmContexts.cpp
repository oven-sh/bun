#include "config.h"
#include "JSStreamAlgorithmContexts.h"

#include "WebStreamsHeapAnalyzer.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using Bun::WebStreams::analyzeBarrierEdge;

const ClassInfo JSStreamFromIterableContext::s_info = { "StreamFromIterableContext"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStreamFromIterableContext) };

JSStreamFromIterableContext::JSStreamFromIterableContext(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSStreamFromIterableContext::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSStreamFromIterableContext* JSStreamFromIterableContext::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSStreamFromIterableContext>(vm)) JSStreamFromIterableContext(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSStreamFromIterableContext::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSStreamFromIterableContext::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSStreamFromIterableContext, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForStreamFromIterableContext.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForStreamFromIterableContext = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForStreamFromIterableContext.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForStreamFromIterableContext = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSStreamFromIterableContext);

template<typename Visitor>
void JSStreamFromIterableContext::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSStreamFromIterableContext>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_iterator);
    visitor.appendHidden(thisObject->m_nextMethod);
}

void JSStreamFromIterableContext::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSStreamFromIterableContext>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_iterator, "iterator"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_nextMethod, "nextMethod"_s);
}

} // namespace WebCore
