// StreamConstructor.h — JSStreamConstructor<JSClass>, the ONE constructor class shared by
// every user-constructible Web Streams class (`using JSFooConstructor =
// JSStreamConstructor<JSFoo>;` in each class header). Same shape as WebCore::JSDOMConstructor
// plus the cached instance Structure. Each owner .cpp defines the specialization's s_info,
// visitChildrenImpl, subspaceForImpl, `construct`, and `prototypeForStructure`.
#pragma once

#include "JSDOMConstructorBase.h"
#include "ErrorCode.h"
#include <JavaScriptCore/WriteBarrier.h>

namespace WebCore {

template<typename JSClass, Bun::ErrorCode errorCodeIfCalled = Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR>
class JSStreamConstructor : public JSDOMConstructorBase {
public:
    using Base = JSDOMConstructorBase;

    static JSStreamConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSDOMGlobalObject& globalObject)
    {
        JSStreamConstructor* constructor = new (NotNull, JSC::allocateCell<JSStreamConstructor>(vm)) JSStreamConstructor(vm, structure);
        constructor->finishCreation(vm, globalObject);
        return constructor;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject& globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, &globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_instanceStructure.
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // Must be defined for each specialization class.
    static JSC::JSValue prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);

    // Must be defined for each specialization class.
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);

    // The cached instance Structure (from getDOMStructure<JSClass>()), set in finishCreation
    // so construct() does zero hashmap lookups. Visited.
    JSC::Structure* instanceStructure() const { return m_instanceStructure.get(); }

private:
    JSStreamConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, construct, nullptr, errorCodeIfCalled)
    {
    }

    // Defined for each specialization class (it populates m_instanceStructure).
    void finishCreation(JSC::VM&, JSDOMGlobalObject&);

    JSC::WriteBarrier<JSC::Structure> m_instanceStructure;
};

} // namespace WebCore
