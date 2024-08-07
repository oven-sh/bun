#include "node.h"

#include "JavaScriptCore/ObjectConstructor.h"
#include "CommonJSModuleRecord.h"

using v8::Context;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::Value;

using JSC::JSObject;
using JSC::jsUndefined;
using JSC::JSValue;

namespace node {

void AddEnvironmentCleanupHook(v8::Isolate* isolate,
    void (*fun)(void* arg),
    void* arg)
{
    // TODO
}

void RemoveEnvironmentCleanupHook(v8::Isolate* isolate,
    void (*fun)(void* arg),
    void* arg)
{
    // TODO
}

void node_module_register(void* opaque_mod)
{
    // TODO unify this with napi_module_register
    auto* globalObject = Bun__getDefaultGlobalObject();
    auto& vm = globalObject->vm();
    auto* mod = reinterpret_cast<struct node_module*>(opaque_mod);
    auto keyStr = WTF::String::fromUTF8(mod->nm_modname);
    globalObject->napiModuleRegisterCallCount++;
    JSValue pendingNapiModule = globalObject->m_pendingNapiModuleAndExports[0].get();
    JSObject* object = (pendingNapiModule && pendingNapiModule.isObject()) ? pendingNapiModule.getObject()
                                                                           : nullptr;

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::Strong<JSC::JSObject> strongExportsObject;

    if (!object) {
        auto* exportsObject = JSC::constructEmptyObject(globalObject);
        RETURN_IF_EXCEPTION(scope, void());

        object = Bun::JSCommonJSModule::create(globalObject, keyStr, exportsObject, false, jsUndefined());
        strongExportsObject = { vm, exportsObject };
    } else {
        JSValue exportsObject = object->getIfPropertyExists(globalObject, WebCore::builtinNames(vm).exportsPublicName());
        RETURN_IF_EXCEPTION(scope, void());

        if (exportsObject && exportsObject.isObject()) {
            strongExportsObject = { vm, exportsObject.getObject() };
        }
    }

    JSC::Strong<JSC::JSObject> strongObject = { vm, object };

    HandleScope hs(reinterpret_cast<Isolate*>(globalObject));

    // TODO(@190n) check if version is correct?

    // exports, module
    Local<Object> exports = hs.createLocal<Object>(*strongExportsObject);
    Local<Value> module = hs.createLocal<Value>(object);
    Local<Context> context = hs.createLocal<Context>(globalObject);
    if (mod->nm_context_register_func) {
        mod->nm_context_register_func(exports, module, context, mod->nm_priv);
    } else if (mod->nm_register_func) {
        mod->nm_register_func(exports, module, mod->nm_priv);
    } else {
        // TODO(@190n) throw
        BUN_PANIC("v8 module has no entrypoint");
    }

    RETURN_IF_EXCEPTION(scope, void());

    globalObject->m_pendingNapiModuleAndExports[1].set(vm, globalObject, object);
}

}
