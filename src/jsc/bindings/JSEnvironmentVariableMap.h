#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "BunClientData.h"

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSValue;
}

namespace Bun {

JSC::JSValue createEnvironmentVariablesMap(Zig::GlobalObject* globalObject);

// process.env backing object. Overrides the write paths so that assigning a
// non-string coerces it to a string, matching Node.js: `process.env.X = 123`
// stores `"123"`, `process.env.X = undefined` stores `"undefined"`. Reads stay
// on the fast plain-object path (no getOwnPropertySlot override).
class JSEnvironmentVariableMap final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut;

    static JSEnvironmentVariableMap* create(JSC::VM& vm, JSC::Structure* structure)
    {
        JSEnvironmentVariableMap* ptr = new (NotNull, JSC::allocateCell<JSEnvironmentVariableMap>(vm)) JSEnvironmentVariableMap(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSEnvironmentVariableMap, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSEnvironmentVariableMap.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSEnvironmentVariableMap = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSEnvironmentVariableMap.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSEnvironmentVariableMap = std::forward<decltype(space)>(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static bool putByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned propertyName, JSC::JSValue, bool shouldThrow);

private:
    JSEnvironmentVariableMap(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }
};

}
