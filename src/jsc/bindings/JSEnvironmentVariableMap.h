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

// Node.js treats process.env as an exotic object: every assigned value is
// coerced to a string (process.env.x = 42 stores "42", = undefined stores
// "undefined"), writes keyed by a symbol throw a TypeError, and
// Object.defineProperty only accepts a data descriptor that is explicitly
// configurable, writable, and enumerable.
class JSEnvironmentVariableMap final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut;

    static JSEnvironmentVariableMap* create(JSC::VM& vm, JSC::Structure* structure)
    {
        JSEnvironmentVariableMap* map = new (NotNull, JSC::allocateCell<JSEnvironmentVariableMap>(vm)) JSEnvironmentVariableMap(vm, structure);
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
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
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

// Setting the TZ environment variable must make *existing* Date instances
// recompute their local time. JSC's DateCache::resetIfNecessarySlow() only
// clears the shared DateInstanceCache slots; live DateInstance objects keep a
// Ref to their DateInstanceData whose cached gregorian breakdown still
// matches the instance's ms value, so toString() keeps returning the old
// offset. Walk the heap and invalidate those per-instance caches.
void invalidateLiveDateInstanceCaches(JSC::VM&);

// resetIfNecessarySlow() + invalidateLiveDateInstanceCaches(): every caller
// that changes the time zone override must do both, so use this instead.
void resetDateCachesAfterTimeZoneChange(JSC::VM&);

// worker_threads SHARE_ENV: a `process.env` whose reads/writes/enumeration go
// through the SharedEnvStore of the tree its global belongs to.
JSC::JSValue createSharedEnvironmentVariablesMap(Zig::GlobalObject* globalObject);

// True for both process.env implementations that are non-JSFinalObject
// (JSEnvironmentVariableMap and the file-local JSSharedEnvMap), so structured
// clone can allowlist them without exposing the latter's declaration.
bool isProcessEnvClassInfo(const JSC::ClassInfo*);

// Resolve the SHARE_ENV store for a worker spawned from `globalObject`: the
// spawning thread's existing store if it has one, otherwise a fresh store seeded
// from its `process.env` (which is then swapped to a write-through view).
// Returns null if seeding threw.
RefPtr<SharedEnvStore> ensureSharedEnvStoreForWorker(Zig::GlobalObject* globalObject);

}
