#include "config.h"
#include "JSStreamAlgorithmContexts.h"

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
        [](auto& spaces) -> auto& { return spaces.m_clientSubspaceForStreamFromIterableContext; },
        [](auto& spaces) -> auto& { return spaces.m_subspaceForStreamFromIterableContext; });
}

DEFINE_VISIT_CHILDREN(JSStreamFromIterableContext);

template<typename Visitor>
void JSStreamFromIterableContext::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSStreamFromIterableContext>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_iterator);
    visitor.append(thisObject->m_nextMethod);
}

} // namespace WebCore
