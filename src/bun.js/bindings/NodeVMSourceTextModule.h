#pragma once

#include "NodeVM.h"
#include "NodeVMModule.h"

namespace Bun {

class NodeVMSourceTextModule final : public NodeVMModule {
public:
    using Base = NodeVMModule;

    static NodeVMSourceTextModule* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, ArgList args);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NodeVMSourceTextModule, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNodeVMSourceTextModule.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeVMSourceTextModule = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNodeVMSourceTextModule.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeVMSourceTextModule = std::forward<decltype(space)>(space); });
    }

    static void destroy(JSC::JSCell* cell);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);

    EncodedJSValue link(JSGlobalObject* globalObject, JSArray* specifiers, JSArray* moduleNatives);

    DECLARE_EXPORT_INFO;

private:
    NodeVMSourceTextModule(JSC::VM& vm, JSC::Structure* structure, WTF::String identifier)
        : Base(vm, structure, WTFMove(identifier))
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
    }
};

} // namespace Bun
