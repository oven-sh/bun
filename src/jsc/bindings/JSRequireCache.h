#pragma once
#include "root.h"
#include "BunClientData.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

class JSCommonJSModule;

// `require.cache` and `Module._cache`, an object without a prototype as in Node. Its string keys are those of a require map and of the ES modules
// that the map's loader has evaluated: an entry is a data property that is writable, enumerable and configurable. The object's own storage holds
// symbol keys, and what Object.defineProperty() gave another shape.
class JSRequireCache final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags
        | JSC::OverridesGetOwnPropertySlot
        | JSC::InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero
        | JSC::OverridesPut
        | JSC::OverridesGetOwnPropertyNames
        | JSC::ProhibitsPropertyCaching;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSRequireCache, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSRequireCache, m_subspaceForJSRequireCache));
    }

    // `owner`: a module of the Bun.ModuleGraph that `requireMap` belongs to, which names the loader whose ES modules are listed. Null: the global object's.
    static JSRequireCache* create(JSC::VM&, Zig::GlobalObject*, JSC::JSMap* requireMap, JSCommonJSModule* owner);

    static bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool getOwnPropertySlotByIndex(JSC::JSObject*, JSC::JSGlobalObject*, unsigned, JSC::PropertySlot&);
    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static bool putByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned, JSC::JSValue, bool shouldThrow);
    static bool deleteProperty(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&);
    static bool deletePropertyByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned);
    static void getOwnPropertyNames(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);
    static bool defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow);
    // The loader adds keys whatever the object allows.
    static bool preventExtensions(JSC::JSObject*, JSC::JSGlobalObject*) { return false; }

    // What `require.cache[key]` answers for a key that is listed and has no entry in the require map, or a falsy one. It makes the entry.
    JSC::JSValue entryMadeOnRead(WTF::UniquedStringImpl* key);

private:
    JSRequireCache(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    Zig::GlobalObject* zigGlobalObject() const;
    // The files of a compiled program are modules of the realm. A Bun.ModuleGraph has modules of its own, and its cache shows those alone.
    bool seesCompiledModules(Zig::GlobalObject*) const;
    // A key that the loader answers for: an evaluated ES module, a file of a compiled test run, a built-in module that a compiled require() has put there.
    bool isListedByLoader(Zig::GlobalObject*, WTF::UniquedStringImpl* key) const;
    bool store(Zig::GlobalObject*, WTF::UniquedStringImpl* key, JSC::JSValue);
    // False: the key is hidden, and there is nothing to take out.
    bool takeOut(Zig::GlobalObject*, WTF::UniquedStringImpl* key);

    JSC::WriteBarrier<JSC::JSMap> m_requireMap;
    JSC::WriteBarrier<JSCommonJSModule> m_owner;
};

} // namespace Bun
