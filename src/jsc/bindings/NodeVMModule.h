#pragma once

#include "NodeVM.h"

#include "JavaScriptCore/AbstractModuleRecord.h"
#include "JavaScriptCore/JSModuleNamespaceObject.h"

namespace Bun {

class NodeVMSourceTextModule;

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

    Status status() const { return m_status; }
    void status(Status value) { m_status = value; }

    JSModuleNamespaceObject* namespaceObject(JSC::JSGlobalObject* globalObject);
    void namespaceObject(JSC::VM& vm, JSModuleNamespaceObject* value) { m_namespaceObject.set(vm, this, value); }

    const WTF::Vector<NodeVMModuleRequest>& moduleRequests() const { return m_moduleRequests; }
    void addModuleRequest(NodeVMModuleRequest request) { m_moduleRequests.append(WTF::move(request)); }

    // Purposely not virtual. Dispatches to the correct subclass.
    JSValue createModuleRecord(JSC::JSGlobalObject* globalObject);

    // Purposely not virtual. Dispatches to the correct subclass.
    AbstractModuleRecord* moduleRecord(JSC::JSGlobalObject* globalObject);

    JSValue evaluate(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint);

    // A SourceTextModule with a record has the status of the record: Link() and Evaluate() of any module that
    // imports it change that status, and so do the jobs of a top-level await. Call this before m_status or
    // m_evaluationException is read.
    void reconcileEvaluationState(JSC::VM& vm);

    bool hasAsyncGraph();

    JSC::Exception* evaluationException() const { return m_evaluationException.get(); }

    // Where a termination unwound the evaluation of a graph: in the walk of Evaluate(), or in a job that a
    // microtask checkpoint ran.
    enum class UnwoundIn : bool {
        Walk,
        Job,
    };
    // Gives `error` to the modules of the graph of `root` that the termination stopped, because the termination
    // itself is not an error a module can have.
    static void errorModulesCutShort(JSC::JSGlobalObject*, JSC::AbstractModuleRecord* root, JSC::JSValue error, UnwoundIn);

protected:
    WTF::String m_identifier;
    Status m_status = Status::Unlinked;
    WriteBarrier<JSModuleNamespaceObject> m_namespaceObject;
    WriteBarrier<JSObject> m_context;
    WriteBarrier<Unknown> m_moduleWrapper;
    WTF::Vector<NodeVMModuleRequest> m_moduleRequests;
    WTF::HashMap<WTF::String, WriteBarrier<JSObject>> m_resolveCache;
    WriteBarrier<JSC::Exception> m_evaluationException;

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
