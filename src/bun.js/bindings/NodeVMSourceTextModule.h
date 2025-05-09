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

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);
    static void destroy(JSC::JSCell* cell);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    JSValue createModuleRecord(JSGlobalObject* globalObject);
    JSValue link(JSGlobalObject* globalObject, JSArray* specifiers, JSArray* moduleNatives);
    JSValue evaluate(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint);
    void sigintReceived();

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

private:
    WriteBarrier<JSModuleRecord> m_moduleRecord;
    SourceCode m_sourceCode;
    bool m_terminatedWithSigint = false;

    NodeVMSourceTextModule(JSC::VM& vm, JSC::Structure* structure, WTF::String identifier, JSValue context, SourceCode sourceCode)
        : Base(vm, structure, WTFMove(identifier), context)
        , m_sourceCode(WTFMove(sourceCode))
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
    }
};

} // namespace Bun
