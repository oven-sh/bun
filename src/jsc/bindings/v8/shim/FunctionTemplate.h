#pragma once

#include "../v8.h"
#include "../V8FunctionCallbackInfo.h"
#include "TemplateProperty.h"

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

class Function;
class ObjectTemplate;
class GlobalInternals;

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
        return WebCore::subspaceForImpl<FunctionTemplate, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForFunctionTemplate, m_subspaceForFunctionTemplate));
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES functionCall(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES functionConstruct(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

    // Builds the synthetic ApiCallbackExitFrame and invokes m_callback.
    static JSC::JSValue invokeCallback(JSC::JSGlobalObject* globalObject, Function* callee, JSC::JSObject* thisObject, const JSC::ArgList& args, bool isConstruct);

    friend v8::Local<v8::Value> api_internal::GetFunctionTemplateData(v8::Isolate* isolate, v8::Local<v8::Data> target);

    JSC::JSString* className() const { return m_className.get(); }
    void setClassName(JSC::VM& vm, JSC::JSString* name) { m_className.set(vm, this, name); }

    // Lazily create the instance ObjectTemplate (internalFieldCount 0) if unset.
    ObjectTemplate* ensureInstanceTemplate(JSC::JSGlobalObject* globalObject);
    // Lazily create the prototype ObjectTemplate if unset.
    ObjectTemplate* ensurePrototypeTemplate(JSC::JSGlobalObject* globalObject);

    void addProperty(JSC::VM& vm, JSC::JSValue name, JSC::JSValue value, unsigned attributes);
    void addAccessor(JSC::VM& vm, JSC::JSValue name, AccessorNameGetterCallback getter, AccessorNameSetterCallback setter, JSC::JSValue data, unsigned attributes);

    // Memoized; shared by GetFunction() and nested Template::Set materialization.
    Function* makeFunction(JSC::VM& vm, Zig::GlobalObject* globalObject, GlobalInternals* internals);

private:
    FunctionCallback m_callback;
    JSC::WriteBarrier<JSC::Unknown> m_data;
    JSC::WriteBarrier<JSC::JSString> m_className;
    JSC::WriteBarrier<ObjectTemplate> m_instanceTemplate;
    JSC::WriteBarrier<ObjectTemplate> m_prototypeTemplate;
    JSC::WriteBarrier<Function> m_cachedFunction;
    WTF::Vector<TemplateProperty> m_properties;
    WTF::Vector<TemplateAccessor> m_accessors;

    FunctionTemplate(JSC::VM& vm, JSC::Structure* structure, FunctionCallback callback, JSC::JSValue data)
        : Base(vm, structure, functionCall, JSC::callHostFunctionAsConstructor)
        , m_callback(callback)
        , m_data(vm, this, data)
    {
    }
};

} // namespace shim
} // namespace v8
