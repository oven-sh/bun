#include "node.h"
#include "V8HandleScope.h"

#include "JavaScriptCore/ObjectConstructor.h"
#include "CommonJSModuleRecord.h"
#include <charconv>

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
    auto* globalObject = defaultGlobalObject();
    auto& vm = globalObject->vm();
    auto* mod = reinterpret_cast<struct node_module*>(opaque_mod);
    // Error: The module '/Users/ben/code/bun/test/v8/v8-module/build/Release/v8tests.node'
    // was compiled against a different Node.js version using
    // NODE_MODULE_VERSION 127. This version of Node.js requires
    // NODE_MODULE_VERSION 108. Please try re-compiling or re-installing
    // the module (for instance, using `npm rebuild` or `npm install`).

    if (mod->nm_version != REPORTED_NODEJS_ABI_VERSION) {
    }

    auto keyStr = WTF::String::fromUTF8(mod->nm_modname);
    globalObject->napiModuleRegisterCallCount++;
    JSValue pendingNapiModule = globalObject->m_pendingNapiModuleAndExports[0].get();
    JSObject* object = (pendingNapiModule && pendingNapiModule.isObject()) ? pendingNapiModule.getObject()
                                                                           : nullptr;

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::Strong<JSC::JSObject> strongExportsObject;

    if (mod->nm_version != REPORTED_NODEJS_ABI_VERSION) {
        auto* error = JSC::createError(globalObject,
            WTF::makeString("The module '"_s,
                keyStr,
                "' was compiled against a different Node.js ABI version using NODE_MODULE_VERSION "_s,
                mod->nm_version,
                ". This version of Bun requires NODE_MODULE_VERSION "_s,
                REPORTED_NODEJS_ABI_VERSION,
                ". Please try re-compiling or re-installing the module."_s));
        globalObject->m_pendingNapiModuleAndExports[0].set(vm, globalObject, error);
        return;
    }

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

    HandleScope hs(Isolate::fromGlobalObject(globalObject));

    // exports, module
    Local<Object> exports = hs.createLocal<Object>(vm, *strongExportsObject);
    Local<Value> module = hs.createLocal<Value>(vm, object);
    Local<Context> context = Isolate::fromGlobalObject(globalObject)->GetCurrentContext();
    if (mod->nm_context_register_func) {
        mod->nm_context_register_func(exports, module, context, mod->nm_priv);
    } else if (mod->nm_register_func) {
        mod->nm_register_func(exports, module, mod->nm_priv);
    } else {
        auto* error = JSC::createError(globalObject, WTF::makeString("The module '"_s, keyStr, "' has no declared entry point."_s));
        globalObject->m_pendingNapiModuleAndExports[0].set(vm, globalObject, error);
        return;
    }

    RETURN_IF_EXCEPTION(scope, void());

    globalObject->m_pendingNapiModuleAndExports[1].set(vm, globalObject, object);
}

}
