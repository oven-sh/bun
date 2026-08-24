#pragma once

#include "root.h"
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/Strong.h>

namespace WebCore {
}

namespace Zig {
class GlobalObject;
}

namespace Bun {

using namespace JSC;
using namespace WebCore;

enum class CallbackKind : uint8_t {
    Call,
    GetterSetter,
};

class JSMockFunction : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    // `spyTarget` and `spyIdentifier` have non-trivial destructors. The cell
    // must be destructible so a spy that is collected without mockRestore()
    // releases its WeakImpl and its ref on the property name atom.
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    static void destroy(JSC::JSCell*);

    static JSMockFunction* create(JSC::VM&, Zig::GlobalObject*, JSC::Structure*, CallbackKind kind = CallbackKind::Call);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;

    DECLARE_VISIT_CHILDREN;
    template<typename Visitor> void visitAdditionalChildrenInGCThread(Visitor&);
    DECLARE_VISIT_OUTPUT_CONSTRAINTS;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM&);

    JSC::LazyProperty<JSMockFunction, JSObject> mock;
    // three pointers to implementation objects
    // head of the list, this one is run next
    mutable JSC::WriteBarrier<JSC::Unknown> implementation;
    // this contains the non-once implementation. there is only ever one of these
    mutable JSC::WriteBarrier<JSC::Unknown> fallbackImplmentation;
    // the last once implementation
    mutable JSC::WriteBarrier<JSC::Unknown> tail;
    // original implementation from spy. separate from `implementation` so restoration always works
    mutable JSC::WriteBarrier<JSC::Unknown> spyOriginal;
    mutable JSC::WriteBarrier<JSC::JSArray> calls;
    mutable JSC::WriteBarrier<JSC::JSArray> contexts;
    mutable JSC::WriteBarrier<JSC::JSArray> invocationCallOrder;
    mutable JSC::WriteBarrier<JSC::JSArray> instances;
    mutable JSC::WriteBarrier<JSC::JSArray> returnValues;

    JSC::Weak<JSObject> spyTarget;
    JSC::Identifier spyIdentifier;
    unsigned spyAttributes = 0;

    static constexpr unsigned SpyAttributeESModuleNamespace = 1 << 30;

    JSString* jsName()
    {
        return m_originalName.get();
    }

    void setName(const WTF::String& name);
    void copyNameAndLength(JSC::VM&, JSGlobalObject*, JSC::JSValue);
    void initMock();

    void clear()
    {
        this->calls.clear();
        this->instances.clear();
        this->returnValues.clear();
        this->contexts.clear();
        this->invocationCallOrder.clear();

        if (this->mock.isInitialized()) {
            this->initMock();
        }
    }

    void reset()
    {
        this->clear();
        this->implementation.clear();
        this->fallbackImplmentation.clear();
        this->tail.clear();
    }

    void clearSpy();

    JSArray* getCalls() const;
    JSArray* getContexts() const;
    JSArray* getInstances() const;
    JSArray* getReturnValues() const;
    JSArray* getInvocationCallOrder() const;

    JSMockFunction(JSC::VM&, JSC::Structure*, CallbackKind wrapKind);
};

// Wrapper to scope a bunch of GlobalObject properties related to mocks
class JSMockModule final {
public:
    static uint64_t s_nextInvocationId;
    static uint64_t nextInvocationId() { return ++s_nextInvocationId; }

#define FOR_EACH_JSMOCKMODULE_GC_MEMBER(V)           \
    V(Structure, mockFunctionStructure)              \
    V(Structure, mockResultStructure)                \
    V(Structure, mockImplementationStructure)        \
    V(Structure, mockObjectStructure)                \
    V(Structure, mockModuleStructure)                \
    V(Structure, activeSpySetStructure)              \
    V(JSFunction, withImplementationCleanupFunction) \
    V(JSC::Structure, mockWithImplementationCleanupDataStructure)

#define DECLARE_JSMOCKMODULE_GC_MEMBER(T, name) \
    LazyProperty<JSGlobalObject, T> name;
    FOR_EACH_JSMOCKMODULE_GC_MEMBER(DECLARE_JSMOCKMODULE_GC_MEMBER)
#undef DECLARE_JSMOCKMODULE_GC_MEMBER

    static JSMockModule create(JSC::JSGlobalObject*);

    // These are used by "spyOn"
    // This is useful for iterating through every non-GC'd spyOn
    JSC::WriteBarrier<JSC::Unknown> activeSpies;

    // Every JSMockFunction::create appends to this list
    // This is useful for iterating through every non-GC'd mock function
    // This list includes activeSpies
    JSC::WriteBarrier<JSC::Unknown> activeMocks;

    // Called by GlobalObject::visitChildren
    template<typename Visitor>
    void visit(Visitor& visitor);
};

class MockWithImplementationCleanupData : public JSC::JSInternalFieldObjectImpl<4> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<4>;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    JS_EXPORT_PRIVATE static MockWithImplementationCleanupData* create(VM&, Structure*);
    static MockWithImplementationCleanupData* create(JSC::JSGlobalObject* globalObject, JSMockFunction* fn, JSValue impl, JSValue tail, JSValue fallback);
    static Structure* createStructure(VM&, JSGlobalObject*, JSValue);

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    MockWithImplementationCleanupData(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSMockFunction* fn, JSValue impl, JSValue tail, JSValue fallback);
};
}
