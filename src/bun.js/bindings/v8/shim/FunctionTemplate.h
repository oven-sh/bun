#pragma once

#include "../v8.h"
#include "../V8FunctionCallbackInfo.h"

namespace v8 {

class FunctionTemplate;

template<typename T>
class Local;
class Value;
class Data;

class Isolate;

namespace api_internal {
// Forward declaration - defined in v8_api_internal.cpp
Local<Value> GetFunctionTemplateData(Isolate* isolate, Local<Data> target);
}

namespace shim {

class FunctionTemplate : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static FunctionTemplate* create(JSC::VM& vm, JSC::Structure* structure, FunctionCallback callback, JSC::JSValue data);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<FunctionTemplate, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForFunctionTemplate.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForFunctionTemplate = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForFunctionTemplate.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForFunctionTemplate = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES functionCall(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

    friend v8::Local<v8::Value> api_internal::GetFunctionTemplateData(v8::Isolate* isolate, v8::Local<v8::Data> target);

private:
    FunctionCallback m_callback;
    JSC::WriteBarrier<JSC::Unknown> m_data;

    FunctionTemplate(JSC::VM& vm, JSC::Structure* structure, FunctionCallback callback, JSC::JSValue data)
        : Base(vm, structure, functionCall, JSC::callHostFunctionAsConstructor)
        , m_callback(callback)
        , m_data(vm, this, data)
    {
    }
};

} // namespace shim
} // namespace v8
