#pragma once

#include "../v8.h"
#include "FunctionTemplate.h"

namespace v8 {
namespace shim {

class Function : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static Function* create(JSC::VM& vm, JSC::Structure* structure, FunctionTemplate* functionTemplate);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<Function, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForV8Function.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForV8Function = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForV8Function.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForV8Function = std::forward<decltype(space)>(space); });
    }

    FunctionTemplate* functionTemplate() const { return m_functionTemplate.get(); }

    void setName(JSC::JSString* name);

private:
    JSC::WriteBarrier<FunctionTemplate> m_functionTemplate;

    Function(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, FunctionTemplate::functionCall)
    {
    }

    void finishCreation(JSC::VM& vm, FunctionTemplate* functionTemplate);
};

} // namespace shim
} // namespace v8
