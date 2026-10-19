#pragma once

#include "NodeVM.h"
#include "NodeVMModule.h"

#include "JavaScriptCore/JSModuleRecord.h"

namespace Bun {

class NodeVMSyntheticModule final : public NodeVMModule {
public:
    using Base = NodeVMModule;

    static NodeVMSyntheticModule* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, ArgList args);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NodeVMSyntheticModule, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForNodeVMSyntheticModule, m_subspaceForNodeVMSyntheticModule));
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);
    static void destroy(JSC::JSCell* cell);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    // A JSModuleRecord without code: the realm's moduleLoaderEvaluate hook runs the evaluateCallback as its body.
    void createModuleRecord(JSGlobalObject* globalObject);
    void ensureModuleRecord(JSGlobalObject* globalObject);
    AbstractModuleRecord* moduleRecord(JSGlobalObject* globalObject);
    JSC::JSModuleRecord* moduleRecordIfExists() const { return m_moduleRecord.get(); }
    JSValue instantiate(JSGlobalObject* globalObject);
    // vm.ts calls instantiate() in the constructor of a SyntheticModule, so no program sees "unlinked".
    bool isInstantiated() const { return m_isInstantiated; }
    // The [[EvaluationSteps]] of the SyntheticModule that `record` belongs to.
    static void runEvaluationSteps(JSGlobalObject*, JSC::JSModuleRecord* record);
    void setExport(JSGlobalObject* globalObject, WTF::String exportName, JSValue value);

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

private:
    WriteBarrier<JSC::JSModuleRecord> m_moduleRecord;
    WriteBarrier<Unknown> m_syntheticEvaluationSteps;
    WTF::HashSet<String> m_exportNames;
    bool m_isInstantiated { false };

    NodeVMSyntheticModule(JSC::VM& vm, JSC::Structure* structure, WTF::String identifier, JSValue context, JSValue moduleWrapper, WTF::HashSet<String> exportNames, JSValue syntheticEvaluationSteps)
        : Base(vm, structure, WTF::move(identifier), context, moduleWrapper)
        , m_exportNames(WTF::move(exportNames))
        , m_syntheticEvaluationSteps(syntheticEvaluationSteps, JSC::WriteBarrierEarlyInit)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
    }
};

} // namespace Bun
