#pragma once

#include "root.h"
#include "BunClientData.h"

namespace WebCore {
}

namespace Bun {

using namespace JSC;
using namespace WebCore;

class AsyncBoundFunction : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static AsyncBoundFunction* create(VM& vm, JSC::Structure* structure, JSValue callback, JSValue context);
    static JSValue snapshotCallback(JSGlobalObject* globalObject, JSValue callback);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    mutable JSC::WriteBarrier<JSC::Unknown> callback;
    mutable JSC::WriteBarrier<JSC::Unknown> context;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<AsyncBoundFunction, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForAsyncBoundFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForAsyncBoundFunction = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForAsyncBoundFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForAsyncBoundFunction = std::forward<decltype(space)>(space); });
    }

    AsyncBoundFunction(JSC::VM& vm, JSC::Structure* structure)
        : JSNonFinalObject(vm, structure)
    {
    }
};

} // namespace Bun
