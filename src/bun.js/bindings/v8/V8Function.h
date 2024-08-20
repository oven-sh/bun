#pragma once

#include "V8Object.h"
#include "V8FunctionTemplate.h"
#include "V8Local.h"
#include "V8String.h"

namespace v8 {

// If this inherited Object like it does in V8, the layout would be wrong for JSC HeapCell.
// Inheritance shouldn't matter for the ABI.
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

    BUN_EXPORT void SetName(Local<String> name);

    FunctionTemplate* functionTemplate() const
    {
        return __internals.functionTemplate.get();
    }

private:
    class Internals {
    private:
        JSC::WriteBarrier<FunctionTemplate> functionTemplate;
        friend class Function;
        friend class FunctionTemplate;
    };

    Internals __internals;

    Function(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, FunctionTemplate::functionCall)
    {
    }

    Function* localToObjectPointer()
    {
        return reinterpret_cast<Data*>(this)->localToObjectPointer<Function>();
    }

    const Function* localToObjectPointer() const
    {
        return reinterpret_cast<const Data*>(this)->localToObjectPointer<Function>();
    }

    Internals& internals()
    {
        return localToObjectPointer()->__internals;
    }

    void finishCreation(JSC::VM& vm, FunctionTemplate* functionTemplate);
};

}
