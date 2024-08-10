#pragma once
#include "root.h"
#include "ZigGlobalObject.h"

namespace Kit {

struct DevServer; // DevServer.zig
struct Route; // DevServer.zig
struct BunVirtualMachine;

class DevGlobalObject : public Zig::GlobalObject {
public:
    using Base = Zig::GlobalObject;

    static const JSC::GlobalObjectMethodTable s_globalObjectMethodTable;
    static DevGlobalObject* create(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable);

    DevServer* m_devServer;

    void finishCreation(JSC::VM& vm);

    DevGlobalObject(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable) 
        : Zig::GlobalObject(vm, structure, methodTable) { }
};

// Zig API
extern "C" DevGlobalObject* KitCreateDevGlobal(DevServer* owner, void* console);

}; // namespace Kit
