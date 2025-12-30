#pragma once

#include "NodeVM.h"
#include "NodeVMModule.h"

#include "JavaScriptCore/SyntheticModuleRecord.h"

#include "../vm/SigintReceiver.h"

namespace Bun {

class NodeVMSyntheticModule final : public NodeVMModule {
public:
    using Base = NodeVMModule;

    static NodeVMSyntheticModule* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, ArgList args);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NodeVMSyntheticModule, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNodeVMSyntheticModule.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeVMSyntheticModule = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNodeVMSyntheticModule.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeVMSyntheticModule = std::forward<decltype(space)>(space); });
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);
    static void destroy(JSC::JSCell* cell);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    void createModuleRecord(JSGlobalObject* globalObject);
    void ensureModuleRecord(JSGlobalObject* globalObject);
    bool hasModuleRecord() const { return !!m_moduleRecord; }
    AbstractModuleRecord* moduleRecord(JSGlobalObject* globalObject);
    JSValue link(JSGlobalObject* globalObject, JSArray* specifiers, JSArray* moduleNatives, JSValue scriptFetcher);
    JSValue instantiate(JSGlobalObject* globalObject);
    JSValue evaluate(JSGlobalObject* globalObject);
    void setExport(JSGlobalObject* globalObject, WTF::String exportName, JSValue value);

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

private:
    WriteBarrier<SyntheticModuleRecord> m_moduleRecord;
    WriteBarrier<Unknown> m_syntheticEvaluationSteps;
    WTF::HashSet<String> m_exportNames;

    NodeVMSyntheticModule(JSC::VM& vm, JSC::Structure* structure, WTF::String identifier, JSValue context, JSValue moduleWrapper, WTF::HashSet<String> exportNames, JSValue syntheticEvaluationSteps)
        : Base(vm, structure, WTF::move(identifier), context, moduleWrapper)
        , m_exportNames(WTF::move(exportNames))
        , m_syntheticEvaluationSteps(vm, this, syntheticEvaluationSteps)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
    }
};

} // namespace Bun
