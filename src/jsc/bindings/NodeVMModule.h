#pragma once

#include "NodeVM.h"

#include "JavaScriptCore/AbstractModuleRecord.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"

#include <wtf/HashSet.h>
#include <wtf/IterationStatus.h>

namespace Bun {

class NodeVMSourceTextModule;
class NodeVMSyntheticModule;

class NodeVMModuleRequest final {
public:
    NodeVMModuleRequest(WTF::String specifier, WTF::HashMap<WTF::String, WTF::String> importAttributes = {});

    JSArray* toJS(JSGlobalObject* globalObject) const;

private:
    WTF::String m_specifier;
    WTF::HashMap<WTF::String, WTF::String> m_importAttributes;
};

class NodeVMModule : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    enum class Status : uint8_t {
        Unlinked,
        Linking,
        Linked,
        Evaluating,
        Evaluated,
        Errored
    };

    static NodeVMModule* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, ArgList args);

    const WTF::String& identifier() const { return m_identifier; }
    // The realm of the module's record: the global object of the module's context, or `globalObject` without a
    // context. JSC queues the jobs of the record there, and the record uses that realm's module loader.
    JSC::JSGlobalObject* moduleRealm(JSC::JSGlobalObject*);

    // Purposely not virtual. A SourceTextModule has the status and the error of its record: Link() and Evaluate()
    // of any module that imports it change them, and so do the jobs of a top-level await. A SyntheticModule has
    // its own.
    Status status() const;
    // Empty unless the status is Errored.
    JSC::JSValue evaluationError() const;

    JSModuleNamespaceObject* namespaceObject(JSC::JSGlobalObject* globalObject);
    void namespaceObject(JSC::VM& vm, JSModuleNamespaceObject* value) { m_namespaceObject.set(vm, this, value); }

    const WTF::Vector<NodeVMModuleRequest>& moduleRequests() const { return m_moduleRequests; }
    void addModuleRequest(NodeVMModuleRequest request) { m_moduleRequests.append(WTF::move(request)); }

    // Purposely not virtual. Dispatches to the correct subclass.
    JSValue createModuleRecord(JSC::JSGlobalObject* globalObject);

    // Purposely not virtual. Dispatches to the correct subclass.
    AbstractModuleRecord* moduleRecord(JSC::JSGlobalObject* globalObject);

    JSValue evaluate(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint);

    bool hasAsyncGraph();

    // A termination (the timeout or the SIGINT of a vm run) unwinds module code where it is, and is not an error
    // that a module can have. The code that it unwinds reports what was stopped: the body of a SourceTextModule
    // that an Evaluate() started, the evaluateCallback of a SyntheticModule, or a checkpoint of a context's
    // microtask queue (the jobs of that queue resume module bodies). The vm run that the termination belongs to
    // then calls errorModulesCutShort() with the error that it throws, and every module that the termination
    // stopped gets that error. A termination that stops the VM belongs to no run, and nothing is done.
    //
    // In Node such a module is "errored" with the error null and its evaluate() never settles, or it stays
    // "evaluating" or "evaluated" for good.
    static void noteBodyCutShort(JSC::VM&);
    static void noteStepsCutShort(NodeVMSyntheticModule*);
    static void noteCheckpointCutShort(NodeVMGlobalObject*);
    static void errorModulesCutShort(JSC::VM&, JSC::JSValue error);

    // Calls `visit(record)` for `root` and for every record that `root` reaches through its requests. A request
    // that has no module yet (the graph is not linked) goes to `missing(request)`. Either one ends the walk
    // when it returns IterationStatus::Done. Iterative: a chain of imports is as deep as it is long.
    template<typename Visit, typename Missing>
    static void forEachRecordOfGraph(JSC::AbstractModuleRecord* root, const Visit& visit, const Missing& missing)
    {
        WTF::HashSet<JSC::AbstractModuleRecord*> visited;
        WTF::Vector<JSC::AbstractModuleRecord*, 16> worklist;
        worklist.append(root);

        while (!worklist.isEmpty()) {
            JSC::AbstractModuleRecord* record = worklist.takeLast();
            if (!visited.add(record).isNewEntry)
                continue;
            if (visit(record) == WTF::IterationStatus::Done)
                return;

            const auto& loaded = record->loadedModules();
            for (const auto& request : record->requestedModules()) {
                if (JSC::AbstractModuleRecord* dependency = record->prelinkedRequestedModule(request)) {
                    worklist.append(dependency);
                    continue;
                }
                auto iter = loaded.find(JSC::ModuleMapKey { request.m_specifier.impl(), request.type() });
                if (iter == loaded.end()) {
                    if (missing(request) == WTF::IterationStatus::Done)
                        return;
                    continue;
                }
                if (JSC::AbstractModuleRecord* dependency = iter->value.m_module.get())
                    worklist.append(dependency);
            }
        }
    }

protected:
    WTF::String m_identifier;
    WriteBarrier<JSModuleNamespaceObject> m_namespaceObject;
    WriteBarrier<JSObject> m_context;
    WriteBarrier<Unknown> m_moduleWrapper;
    WTF::Vector<NodeVMModuleRequest> m_moduleRequests;
    WTF::HashMap<WTF::String, WriteBarrier<JSObject>> m_resolveCache;

    NodeVMModule(JSC::VM& vm, JSC::Structure* structure, WTF::String identifier, JSValue context, JSValue moduleWrapper);

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;
};

class NodeVMModulePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static NodeVMModulePrototype* create(VM& vm, Structure* structure);

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMModulePrototype, Base);
        return &vm.plainObjectSpace();
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype);

private:
    NodeVMModulePrototype(VM& vm, Structure* structure);

    void finishCreation(VM& vm);
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMModulePrototype, NodeVMModulePrototype::Base);

class NodeVMModuleConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    DECLARE_EXPORT_INFO;

    static NodeVMModuleConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

private:
    NodeVMModuleConstructor(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM&, JSC::JSObject* prototype);
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMModuleConstructor, JSC::InternalFunction);

} // namespace Bun
