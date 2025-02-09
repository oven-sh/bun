#pragma once
#include "root.h"
#include "ZigGlobalObject.h"

namespace Bake {

struct ProductionPerThread;

class GlobalObject : public Zig::GlobalObject {
public:
    using Base = Zig::GlobalObject;

    ProductionPerThread* m_perThreadData = nullptr;
    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<GlobalObject, WebCore::UseCustomHeapCellType::Yes>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForBakeGlobalScope.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBakeGlobalScope = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForBakeGlobalScope.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForBakeGlobalScope = std::forward<decltype(space)>(space); },
            [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForBakeGlobalObject; });
    }

    static const JSC::GlobalObjectMethodTable s_globalObjectMethodTable;
    static GlobalObject* create(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable);

    static JSC::Structure* createStructure(JSC::VM& vm);

    void finishCreation(JSC::VM& vm);

    GlobalObject(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable)
        : Zig::GlobalObject(vm, structure, methodTable)
    {
    }
};

}; // namespace Kit
