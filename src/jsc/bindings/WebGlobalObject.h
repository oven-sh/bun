#pragma once

#include "root.h"

#include "ZigGlobalObject.h"

namespace JSC::AOT {
struct ModuleHost;
}

namespace Bun {

// The global object of a window or of a worker. Its names are in src/codegen/web-globals.ts.
// Not final: each kind of realm has a ClassInfo that inherits from info().
class WebGlobalObject : public Zig::GlobalObject {
public:
    using Base = Zig::GlobalObject;

    enum class Scope : uint8_t { Window,
        DedicatedWorker,
        SharedWorker,
        ServiceWorker };
    enum class NodeGlobals : uint8_t { None,
        OfPreload,
        OfNodeIntegration };
    struct Kind {
        Scope scope;
        bool isSecureContext;
        bool isCrossOriginIsolated;
        NodeGlobals nodeGlobals;
        bool isIsolatedWorld { false };
    };

    DECLARE_INFO;
    static const JSC::ClassInfo s_infoWithBunGlobals;
    struct ClassInfos;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    static WebGlobalObject* create(JSC::VM&, Kind, const JSC::GlobalObjectMethodTable*);
    // The global object of a program that starts in a window. It has Bun's names too.
    static WebGlobalObject* createForProgram(JSC::VM&, uint32_t scriptExecutionContextId, const JSC::GlobalObjectMethodTable&);
    static bool programStartsInWindow();
#if ENABLE(AOT)
    static const JSC::AOT::ModuleHost& moduleHost();
#endif
    ~WebGlobalObject();
    static void destroy(JSC::JSCell*);
    // Code that every executable keeps asks this: naming info() would keep the whole class.
    static bool is(JSC::JSGlobalObject* realm) { return realm->methodTable()->destroy == &destroy; }

    static bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static bool defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow);
    static bool deleteProperty(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&);
    static bool getOwnPropertySlotByIndex(JSC::JSObject*, JSC::JSGlobalObject*, unsigned, JSC::PropertySlot&);
    static bool setPrototype(JSC::JSObject*, JSC::JSGlobalObject*, JSC::JSValue, bool shouldThrow);
    static bool preventExtensions(JSC::JSObject*, JSC::JSGlobalObject*);
    static bool putByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned, JSC::JSValue, bool shouldThrow);
    static bool deletePropertyByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned);
    static void getOwnSpecialPropertyNames(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);

    // { load, members }: what is still written in TypeScript.
    JSC::JSObject* members();
    void setMembers(JSC::VM&, JSC::JSObject*);

    // The row of the static tables, unless Node.js or the language has the name.
    static const JSC::HashTableValue* rowOfPlatform(JSC::JSObject* window, JSC::PropertyName);

    // bun_web::realm::Realm
    void* realm() const { return m_realm; }

    // Null before scripts may run and after the realm is disposed.
    bool isRunning() const { return m_isRunning; }
    void setRunning(bool isRunning) { m_isRunning = isRunning; }

    // The value of a [SameObject] attribute lies in the object, where every tier caches it. Scripts go on seeing the accessor.
    void rememberSameObject(JSC::VM&, unsigned index, JSC::PropertyName, JSC::JSValue);
    void forgetSameObjects(JSC::VM&);

private:
    WebGlobalObject(JSC::VM&, JSC::Structure*, uint32_t scriptExecutionContextId, const JSC::GlobalObjectMethodTable*);
    static WebGlobalObject* create(JSC::VM&, const JSC::ClassInfo*, Kind, uint32_t scriptExecutionContextId, const JSC::GlobalObjectMethodTable*);

    void adoptPrototype(JSC::VM&, ASCIILiteral interface);
    const JSC::HashTableValue* rowOfRememberedObject(JSC::VM&, JSC::PropertyName);
    void forget(JSC::VM&, JSC::PropertyName, const JSC::HashTableValue&);

    JSC::WriteBarrier<JSC::JSObject> m_members;
    bool m_isRunning { false };
    void* m_realm { nullptr };
    uint32_t m_rememberedObjects { 0 };
};

} // namespace Bun
