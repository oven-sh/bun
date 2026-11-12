#pragma once
#include "root.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include "BunClientData.h"
#include "InternalModuleRegistry+numberOfModules.h"
#include "_NativeModule.h"

namespace Bun {
using namespace JSC;

enum class ErrorCode : uint16_t;

// Internal module registry is an array of lazily initialized "modules". Module
// IDs are generated pre-build by `bundle-modules.ts` and inlined into JS code
// and the C++ enum (InternalModuleRegistry::Field) This allows modules
// depending on each other to skip the module resolver.
//
// Modules come from two sources:
// - some are written in JS (src/js, there is a readme file that explain those files more.
// - others are native code (src/jsc/modules), see _NativeModule.h in there.
class InternalModuleRegistry : public JSInternalFieldObjectImpl<BUN_INTERNAL_MODULE_COUNT> {
public:
    using Base = JSInternalFieldObjectImpl<BUN_INTERNAL_MODULE_COUNT>;

    DECLARE_EXPORT_INFO;

    enum Field : uint8_t {
#include "InternalModuleRegistry+enum.h"
    };

    const WriteBarrier<Unknown>& internalField(Field field) const { return Base::internalField(static_cast<uint32_t>(field)); }
    WriteBarrier<Unknown>& internalField(Field field) { return Base::internalField(static_cast<uint32_t>(field)); }

    template<typename, SubspaceAccess mode>
    static GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<InternalModuleRegistry, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForInternalModuleRegistry, m_subspaceForInternalModuleRegistry));
    }

    static InternalModuleRegistry* create(VM& vm, Structure* structure);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject);

    static JSC_DECLARE_HOST_FUNCTION(jsCreateInternalModuleById);

private:
    friend struct DeclaredModuleLoad;

    JS_EXPORT_PRIVATE InternalModuleRegistry(VM&, Structure*);
    DECLARE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE);

    // DECLARE_VISIT_CHILDREN_WITH_MODIFIER ends in "public:".
private:
    JSValue requireId(JSGlobalObject* globalObject, VM& vm, Field id);
    JSValue createInternalModuleById(JSGlobalObject* globalObject, VM& vm, Field id);
    void finishCreation(VM&);
};

struct DeclaredModuleLoad {
    template<InternalModuleRegistry::Field field>
    static JSC::JSValue require(Zig::GlobalObject* globalObject, ASCIILiteral onBehalfOf)
    {
        return requireModuleOnBehalfOf(globalObject, field, onBehalfOf);
    }

    template<InternalModuleRegistry::Field field>
    static JSC::JSValue require(Zig::GlobalObject* globalObject, ASCIILiteral onBehalfOf, ASCIILiteral exportName)
    {
        return requireExportOnBehalfOf(globalObject, field, onBehalfOf, exportName);
    }

    template<InternalModuleRegistry::Field field>
    static void load(Zig::GlobalObject* globalObject, ASCIILiteral onBehalfOf)
    {
        requireOnBehalfOf(globalObject, field, onBehalfOf);
    }

    static bool canLoad(Zig::GlobalObject*, InternalModuleRegistry::Field);
    static JSC::JSValue requireNamedAtRunTime(Zig::GlobalObject*, InternalModuleRegistry::Field, ErrorCode ifNotInExecutable);
    static JSC::JSValue requireForCommandLine(Zig::GlobalObject*, InternalModuleRegistry::Field);

private:
    static JSC::JSValue requireField(Zig::GlobalObject*, InternalModuleRegistry::Field);
    static JSC::JSValue requireOnBehalfOf(Zig::GlobalObject*, InternalModuleRegistry::Field, ASCIILiteral builtin);
    static JSC::JSValue requireModuleOnBehalfOf(Zig::GlobalObject*, InternalModuleRegistry::Field, ASCIILiteral builtin);
    static JSC::JSValue requireExportOnBehalfOf(Zig::GlobalObject*, InternalModuleRegistry::Field, ASCIILiteral builtin, ASCIILiteral exportName);
};

// Given the name of an export, returns that export, so the call site never holds the module object and can read nothing else. Without a name, returns the module's value.
#define BUN_REQUIRE_INTERNAL_MODULE(globalObject, field, onBehalfOf, ...) \
    ::Bun::DeclaredModuleLoad::require<::Bun::InternalModuleRegistry::Field::field>((globalObject), onBehalfOf##_s __VA_OPT__(, ) __VA_ARGS__)

// Runs the module and returns nothing, so the call site reads no export.
#define BUN_LOAD_INTERNAL_MODULE(globalObject, field, onBehalfOf) \
    ::Bun::DeclaredModuleLoad::load<::Bun::InternalModuleRegistry::Field::field>((globalObject), onBehalfOf##_s)

JSC_DECLARE_HOST_FUNCTION(jsInternalModulesLoadedFromBytecode);
JSC_DECLARE_HOST_FUNCTION(jsInternalModulesCompiledFromSource);
JSC_DECLARE_HOST_FUNCTION(jsInternalModuleBytecode);

} // namespace Bun
