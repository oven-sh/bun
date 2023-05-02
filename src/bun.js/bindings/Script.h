#pragma once

#include "root.h"
#include "ZigGlobalObject.h"

#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/VM.h"

#include "headers-handwritten.h"
#include "BunClientData.h"
#include "JavaScriptCore/CallFrame.h"

namespace WebCore {

class ScriptConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static ScriptConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);

    DECLARE_EXPORT_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
    }
    void initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype);

private:
    ScriptConstructor(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(ScriptConstructor, InternalFunction);

class Script final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static Script* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, String source);

    DECLARE_EXPORT_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<Script, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForScript = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForScript = std::forward<decltype(space)>(space); });
    }

    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);

private:
    Ref<JSC::StringSourceProvider> m_source;

    Script(JSC::VM& vm, JSC::Structure* structure, String source)
        : Base(vm, structure)
        // TODO: source location
        , m_source(JSC::StringSourceProvider::create(source, JSC::SourceOrigin(), ""_s))
    {
    }

    void finishCreation(JSC::VM&);
};

}
