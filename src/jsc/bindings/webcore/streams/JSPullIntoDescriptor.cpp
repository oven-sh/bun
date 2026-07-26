#include "config.h"
#include "JSPullIntoDescriptor.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;

const ClassInfo JSPullIntoDescriptor::s_info = { "PullIntoDescriptor"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPullIntoDescriptor) };

JSPullIntoDescriptor::JSPullIntoDescriptor(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSPullIntoDescriptor::~JSPullIntoDescriptor() = default;

void JSPullIntoDescriptor::destroy(JSCell* cell)
{
    static_cast<JSPullIntoDescriptor*>(cell)->~JSPullIntoDescriptor();
}

void JSPullIntoDescriptor::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSPullIntoDescriptor* JSPullIntoDescriptor::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSPullIntoDescriptor>(vm)) JSPullIntoDescriptor(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSPullIntoDescriptor::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSPullIntoDescriptor::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSPullIntoDescriptor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForPullIntoDescriptor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForPullIntoDescriptor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForPullIntoDescriptor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForPullIntoDescriptor = std::forward<decltype(space)>(space); });
}

} // namespace WebCore
