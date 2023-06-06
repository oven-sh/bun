#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>
#include "JavaScriptCore/SubspaceInlines.h"

namespace WebCore {
}

namespace Bun {

using namespace JSC;
using namespace WebCore;

class JSMockFunction final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSMockFunction* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSValue);
    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::LazyProperty<JSMockFunction, JSC::JSObject> m_mock;
    mutable JSC::WriteBarrier<JSC::JSArray> m_returnValues;
    mutable JSC::WriteBarrier<JSC::JSArray> m_calls;
    mutable JSC::WriteBarrier<JSC::JSArray> m_instances;
    mutable JSC::WriteBarrier<JSC::Unknown> m_next;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSMockFunction, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSMockFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSMockFunction = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSMockFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSMockFunction = std::forward<decltype(space)>(space); });
    }

    void setNext(JSC::JSValue value)
    {
        m_next.set(this->globalObject()->vm(), this, value);
    }

    JSC::JSValue calls()
    {
        return m_calls.get();
    }

    JSC::JSValue instances()
    {
        return m_instances.get();
    }

    JSC::JSValue returnValues()
    {
        return m_returnValues.get();
    }

    JSC::JSValue mock()
    {
        return m_mock.getInitializedOnMainThread(this);
    }

    JSC::JSValue next()
    {
        return m_next.get();
    }

    JSMockFunction(JSC::VM&, JSC::Structure*);
};

}