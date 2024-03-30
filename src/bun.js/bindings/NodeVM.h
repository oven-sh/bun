#pragma once

#include "root.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/VM.h>

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>

namespace WebCore {

class NodeVMScriptConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static NodeVMScriptConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);

    DECLARE_EXPORT_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
    }

private:
    NodeVMScriptConstructor(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM&, JSC::JSObject* prototype);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMScriptConstructor, InternalFunction);

class NodeVMScript final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static NodeVMScript* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::SourceCode source);

    DECLARE_EXPORT_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NodeVMScript, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNodeVMScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeVMScript = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNodeVMScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeVMScript = std::forward<decltype(space)>(space); });
    }

    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);

    const JSC::SourceCode& source() const { return m_source; }

    DECLARE_VISIT_CHILDREN;
    mutable JSC::WriteBarrier<JSC::DirectEvalExecutable> m_cachedDirectExecutable;

private:
    JSC::SourceCode m_source;

    NodeVMScript(JSC::VM& vm, JSC::Structure* structure, JSC::SourceCode source)
        : Base(vm, structure)
        , m_source(source)
    {
    }

    void finishCreation(JSC::VM&);
};

JSC_DECLARE_HOST_FUNCTION(vmModule_createContext);
JSC_DECLARE_HOST_FUNCTION(vmModule_isContext);
JSC_DECLARE_HOST_FUNCTION(vmModuleRunInNewContext);
JSC_DECLARE_HOST_FUNCTION(vmModuleRunInThisContext);

} // namespace WebCore

namespace Bun {

JSC::JSValue createNodeVMBinding(Zig::GlobalObject*);

}
