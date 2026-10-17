#pragma once

#include "NodeVM.h"
#include "NodeVMModule.h"

#include "JavaScriptCore/SyntheticModuleRecord.h"

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

    void createModuleRecord(JSGlobalObject* globalObject);
    void ensureModuleRecord(JSGlobalObject* globalObject);
    AbstractModuleRecord* moduleRecord(JSGlobalObject* globalObject);
    JSValue instantiate(JSGlobalObject* globalObject);
    // The module's [[EvaluationSteps]]. JSC calls them through Bun__runSyntheticModuleEvaluationSteps() when
    // Evaluate() reaches the module's record for the first time, as the root or through an import of it.
    void runEvaluationSteps(JSGlobalObject* globalObject);
    void errorEvaluationSteps(JSC::VM&, JSC::Exception*);
    void setExport(JSGlobalObject* globalObject, WTF::String exportName, JSValue value);

    // A synthetic record has no status. The module keeps its own, and what its steps threw.
    Status ownStatus() const { return m_status; }
    JSC::Exception* evaluationException() const { return m_evaluationException.get(); }

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

private:
    WriteBarrier<SyntheticModuleRecord> m_moduleRecord;
    WriteBarrier<Unknown> m_syntheticEvaluationSteps;
    WriteBarrier<JSC::Exception> m_evaluationException;
    WTF::HashSet<String> m_exportNames;
    Status m_status { Status::Unlinked };

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
