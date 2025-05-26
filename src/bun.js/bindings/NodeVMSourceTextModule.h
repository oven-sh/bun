#pragma once

#include "NodeVM.h"
#include "NodeVMModule.h"

#include "../vm/SigintReceiver.h"

namespace Bun {

class NodeVMSourceTextModule final : public NodeVMModule, public SigintReceiver {
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
    void ensureModuleRecord(JSGlobalObject* globalObject);
    bool hasModuleRecord() const { return !!m_moduleRecord; }
    AbstractModuleRecord* moduleRecord(JSGlobalObject* globalObject);
    JSValue link(JSGlobalObject* globalObject, JSArray* specifiers, JSArray* moduleNatives, JSValue scriptFetcher);
    JSValue evaluate(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint);
    RefPtr<CachedBytecode> bytecode(JSGlobalObject* globalObject);
    JSUint8Array* cachedData(JSGlobalObject* globalObject);
    Exception* evaluationException() const { return m_evaluationException.get(); }

    const SourceCode& sourceCode() const { return m_sourceCode; }
    ModuleProgramExecutable* cachedExecutable() const { return m_cachedExecutable.get(); }

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

private:
    WriteBarrier<JSModuleRecord> m_moduleRecord;
    WriteBarrier<JSArray> m_moduleRequestsArray;
    WriteBarrier<ModuleProgramExecutable> m_cachedExecutable;
    WriteBarrier<JSUint8Array> m_cachedBytecodeBuffer;
    WriteBarrier<Exception> m_evaluationException;
    RefPtr<CachedBytecode> m_bytecode;
    SourceCode m_sourceCode;

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
