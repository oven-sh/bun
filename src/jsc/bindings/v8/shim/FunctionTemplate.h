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
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES functionConstruct(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

    // Shared frame-building/callback-invocation path used by both the JSC host-call entry
    // (functionCall/functionConstruct) and v8::Function::NewInstance. When isConstruct is true the synthetic
    // ApiCallbackExitFrame is tagged as a construct-exit frame and new.target is set to the
    // callee so IsConstructCall()/NewTarget() behave as under `new`.
    static JSC::JSValue invokeCallback(JSC::JSGlobalObject* globalObject, Function* callee, JSC::JSObject* thisObject, const JSC::ArgList& args, bool isConstruct);

    friend v8::Local<v8::Value> api_internal::GetFunctionTemplateData(v8::Isolate* isolate, v8::Local<v8::Data> target);

    JSC::JSString* className() const { return m_className.get(); }
    void setClassName(JSC::VM& vm, JSC::JSString* name) { m_className.set(vm, this, name); }

    ObjectTemplate* instanceTemplate() const;
    void setInstanceTemplate(JSC::VM& vm, ObjectTemplate* objectTemplate);
    // Lazily create the instance ObjectTemplate (internalFieldCount 0) if unset.
    ObjectTemplate* ensureInstanceTemplate(JSC::JSGlobalObject* globalObject);

    ObjectTemplate* prototypeTemplate() const;
    // Lazily create the prototype ObjectTemplate if unset.
    ObjectTemplate* ensurePrototypeTemplate(JSC::JSGlobalObject* globalObject);

    WTF::Vector<TemplateProperty>& properties() { return m_properties; }
    WTF::Vector<TemplateAccessor>& accessors() { return m_accessors; }

    void addProperty(JSC::VM& vm, JSC::JSValue name, JSC::JSValue value, unsigned attributes);
    void addAccessor(JSC::VM& vm, JSC::JSValue name, AccessorNameGetterCallback getter, AccessorNameSetterCallback setter, JSC::JSValue data, unsigned attributes);

    // Create a shim::Function for this template, including setting up its
    // prototype object from m_prototypeTemplate. Shared by GetFunction() and
    // materialization of nested FunctionTemplates recorded via Template::Set.
    Function* makeFunction(JSC::VM& vm, Zig::GlobalObject* globalObject, GlobalInternals* internals);

private:
    FunctionCallback m_callback;
    JSC::WriteBarrier<JSC::Unknown> m_data;
    JSC::WriteBarrier<JSC::JSString> m_className;
    JSC::WriteBarrier<ObjectTemplate> m_instanceTemplate;
    JSC::WriteBarrier<ObjectTemplate> m_prototypeTemplate;
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
