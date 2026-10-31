#pragma once

#include "NodeVM.h"

#include "JavaScriptCore/AbstractModuleRecord.h"
#include "JavaScriptCore/JSCellButterfly.h"
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
    // The context's own module loader (its global object's), or `globalObject`'s without a context: the
    // loader this module's record is created against.
    JSC::JSModuleLoader* moduleLoader(JSC::JSGlobalObject*);

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

    // For top-level-await modules JSC finishes evaluation asynchronously
    // (record status EvaluatingAsync -> Evaluated); pull the final state into
    // m_status/m_evaluationException once the record has settled.
    void reconcileEvaluationState(JSC::VM& vm);

    bool hasAsyncGraph() const;
    void propagateLinked();

    JSC::Exception* evaluationException() const { return m_evaluationException.get(); }

protected:
    WTF::String m_identifier;
    Status m_status = Status::Unlinked;
    WriteBarrier<JSModuleNamespaceObject> m_namespaceObject;
    WriteBarrier<JSObject> m_context;
    WriteBarrier<Unknown> m_evaluationResult;
    WriteBarrier<Unknown> m_moduleWrapper;
    WTF::Vector<NodeVMModuleRequest> m_moduleRequests;
    // One module for each request of the record, by request index. link() makes a new list and never writes to one again.
    WriteBarrier<JSC::JSCellButterfly> m_linkedModules;
    WriteBarrier<JSC::Exception> m_evaluationException;

    NodeVMModule(JSC::VM& vm, JSC::Structure* structure, WTF::String identifier, JSValue context, JSValue moduleWrapper);

    unsigned linkedModuleCount() const { return m_linkedModules ? m_linkedModules->length() : 0; }
    NodeVMModule* linkedModule(unsigned index) const { return uncheckedDowncast<NodeVMModule>(m_linkedModules->get(index)); }

    void evaluateDependencies(JSGlobalObject* globalObject, uint32_t timeout, bool breakOnSigint);

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
