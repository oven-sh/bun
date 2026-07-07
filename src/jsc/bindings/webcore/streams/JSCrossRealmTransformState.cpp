#include "config.h"
#include "JSCrossRealmTransformState.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSReadableStreamDefaultController.h"
#include "JSWritableStreamDefaultController.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;

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
        [](auto& spaces) -> auto& { return spaces.m_clientSubspaceForCrossRealmTransformState; },
        [](auto& spaces) -> auto& { return spaces.m_subspaceForCrossRealmTransformState; });
}

DEFINE_VISIT_CHILDREN(JSCrossRealmTransformState);

template<typename Visitor>
void JSCrossRealmTransformState::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSCrossRealmTransformState>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_port);
    visitor.append(thisObject->m_backpressurePromise);
    visitor.append(thisObject->m_readableController);
    visitor.append(thisObject->m_writableController);
}

} // namespace WebCore
