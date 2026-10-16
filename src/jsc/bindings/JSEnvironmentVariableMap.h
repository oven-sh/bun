#include "root.h"
#include "SharedEnvStore.h"

#include <JavaScriptCore/JSObject.h>

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSValue;
}

namespace Bun {

// Node's process.env exotic object (https://github.com/nodejs/node/blob/main/src/node_env_var.cc):
// values ToString'd, symbol keys throw, defineProperty requires a full writable data descriptor.
class JSEnvironmentVariableMap final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut;

    static JSEnvironmentVariableMap* create(JSC::VM& vm, JSC::Structure* structure)
    {
        JSEnvironmentVariableMap* map = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSEnvironmentVariableMap))) JSEnvironmentVariableMap(vm, structure);
        map->finishCreation(vm);
        return map;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSEnvironmentVariableMap, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static bool putByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned, JSC::JSValue, bool shouldThrow);
    static bool defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow);
    static bool deleteProperty(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&);

private:
    JSEnvironmentVariableMap(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

JSC::JSValue createEnvironmentVariablesMap(Zig::GlobalObject* globalObject);

// Setting TZ must make *existing* Date instances recompute local time. JSC's DateCache
// reset only clears shared slots; live DateInstances keep their own cached fields
// that still match, so walk the heap and invalidate those.
void invalidateLiveDateInstanceCaches(JSC::VM&);

// The shared DateCache reset and invalidateLiveDateInstanceCaches() must travel
// together; every caller that changes the time zone override uses this instead.
void resetDateCachesAfterTimeZoneChange(JSC::VM&);

// worker_threads SHARE_ENV: a `process.env` whose reads/writes/enumeration go
// through the SharedEnvStore of the tree its global belongs to.
JSC::JSValue createSharedEnvironmentVariablesMap(Zig::GlobalObject* globalObject);

// True for both process.env implementations that are non-JSFinalObject
// (JSEnvironmentVariableMap and the file-local JSSharedEnvMap), so structured
// clone can allowlist them without exposing the latter's declaration.
bool isProcessEnvClassInfo(const JSC::ClassInfo*);

// SHARE_ENV store for a worker spawned from `globalObject`: the spawner's existing store,
// else a fresh one seeded from its `process.env` (then swapped to a write-through view).
// Returns null if seeding threw.
RefPtr<SharedEnvStore> ensureSharedEnvStoreForWorker(Zig::GlobalObject* globalObject);

}
