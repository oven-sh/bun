#pragma once

#include "root.h"
#include "ZigGlobalObject.h"

#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/VM.h"

#include "headers-handwritten.h"
#include "BunClientData.h"
#include "JavaScriptCore/CallFrame.h"

namespace WebCore {

class VMModuleScriptConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static VMModuleScriptConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);

    DECLARE_EXPORT_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
    }

private:
    VMModuleScriptConstructor(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM&, JSC::JSObject* prototype);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(VMModuleScriptConstructor, InternalFunction);

class VMModuleScript final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static VMModuleScript* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, String source);

    DECLARE_EXPORT_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<VMModuleScript, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForVMModuleScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForVMModuleScript = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForVMModuleScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForVMModuleScript = std::forward<decltype(space)>(space); });
    }

    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);

private:
    Ref<JSC::StringSourceProvider> m_source;

    VMModuleScript(JSC::VM& vm, JSC::Structure* structure, String source)
        : Base(vm, structure)
        // TODO: source location
        , m_source(JSC::StringSourceProvider::create(source, JSC::SourceOrigin(), ""_s))
    {
    }

    void finishCreation(JSC::VM&);
};

}
