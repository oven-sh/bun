#pragma once
#include "root.h"
#include "JavaScriptCore/JSInternalFieldObjectImpl.h"
#include "JavaScriptCore/JSInternalFieldObjectImplInlines.h"
#include "BunClientData.h"
#include "../../../src/js/out/InternalModuleRegistry+numberOfModules.h"

namespace Bun {
using namespace JSC;

// Internal module registry is an array of lazily initialized "modules". Module IDs are generated
// pre-build by `make js` and inlined into JS code and the C++ enum (InternalModuleRegistry::Field)
// This allows modules depending on each other to skip the module resolver.
//
// Modules come from two sources:
// - some are written in JS (src/js, there is a readme file that explain those files more.
// - others are native code (src/bun.js/modules), see _NativeModule.h in there.
class InternalModuleRegistry : public JSInternalFieldObjectImpl<BUN_INTERNAL_MODULE_COUNT> {
protected:
    JS_EXPORT_PRIVATE InternalModuleRegistry(VM&, Structure*);
    DECLARE_DEFAULT_FINISH_CREATION;
    DECLARE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE);

public:
    using Base = JSInternalFieldObjectImpl<BUN_INTERNAL_MODULE_COUNT>;

    DECLARE_EXPORT_INFO;

    enum Field : uint8_t {
#include "../../../src/js/out/InternalModuleRegistry+enum.h"
    };
    const WriteBarrier<Unknown>& internalField(Field field) const { return Base::internalField(static_cast<uint32_t>(field)); }
    WriteBarrier<Unknown>& internalField(Field field) { return Base::internalField(static_cast<uint32_t>(field)); }

    template<typename, SubspaceAccess mode>
    static GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<InternalModuleRegistry, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForInternalModuleRegistry.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForInternalModuleRegistry = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForInternalModuleRegistry.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForInternalModuleRegistry = std::forward<decltype(space)>(space); });
    }

    static InternalModuleRegistry* create(VM& vm, Structure* structure);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

    JSValue requireId(JSGlobalObject* globalObject, VM& vm, Field id);

    static JSC_DECLARE_HOST_FUNCTION(jsCreateInternalModuleById);

protected:
    JSValue createInternalModuleById(JSGlobalObject* globalObject, VM& vm, Field id);
};

} // namespace Bun
