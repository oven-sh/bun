#pragma once
#include "root.h"
#include "ZigGlobalObject.h"

namespace Bake {

struct DevServer; // DevServer.zig
struct Route; // DevServer.zig
struct BunVirtualMachine;

class DevGlobalObject : public Zig::GlobalObject {
public:
    using Base = Zig::GlobalObject;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<DevGlobalObject, WebCore::UseCustomHeapCellType::Yes>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForBakeGlobalScope.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBakeGlobalScope = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForBakeGlobalScope.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForBakeGlobalScope = std::forward<decltype(space)>(space); },
            [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForJSWorkerGlobalScope; });
    }

    static const JSC::GlobalObjectMethodTable s_globalObjectMethodTable;
    static DevGlobalObject* create(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable);

    DevServer* m_devServer;

    void finishCreation(JSC::VM& vm);

    DevGlobalObject(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable) 
        : Zig::GlobalObject(vm, structure, methodTable) { }
};

// Zig API
extern "C" void KitInitProcessIdentifier();
extern "C" DevGlobalObject* KitCreateDevGlobal(DevServer* owner, void* console);

}; // namespace Kit
