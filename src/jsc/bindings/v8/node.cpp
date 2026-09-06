#include "node.h"
#include "V8HandleScope.h"

#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ThrowScope.h"
#include "JSCommonJSModule.h"

#include "node/node_version.h"

static_assert(REPORTED_NODEJS_ABI_VERSION == NODE_MODULE_VERSION,
    "Bun's Node.js ABI version is not the same as in the reported version of Node.js");

using v8::Context;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
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

struct uv_loop_s* GetCurrentEventLoop(v8::Isolate* isolate)
{
#if OS(WINDOWS)
    return reinterpret_cast<struct uv_loop_s*>(isolate->globalObject()->uvLoop());
#else
    // Bun does not run a libuv event loop on POSIX; per node.h this may return
    // nullptr when the context is not associated with a Node instance.
    (void)isolate;
    return nullptr;
#endif
}

async_id AsyncHooksGetExecutionAsyncId(v8::Local<v8::Context> context)
{
    // Bun does not maintain async_hooks numeric IDs; 0 means "no execution set".
    (void)context;
    return 0;
}

async_context EmitAsyncInit(v8::Isolate* isolate,
    v8::Local<v8::Object> resource,
    v8::Local<v8::String> name,
    async_id trigger_async_id)
{
    // Bun does not maintain async_hooks numeric IDs; mirror napi_async_init.
    (void)isolate;
    (void)resource;
    (void)name;
    (void)trigger_async_id;
    return { 0, 0 };
}

void EmitAsyncDestroy(v8::Isolate* isolate, async_context asyncContext)
{
    // Bun does not maintain async_hooks numeric IDs; mirror napi_async_destroy.
    (void)isolate;
    (void)asyncContext;
}

v8::MaybeLocal<v8::Value> MakeCallback(v8::Isolate* isolate,
    v8::Local<v8::Object> recv,
    v8::Local<v8::Function> callback,
    int argc,
    v8::Local<v8::Value>* argv,
    async_context asyncContext)
{
    (void)asyncContext;

    auto* globalObject = isolate->globalObject();
    auto& vm = isolate->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::JSValue callee = callback->localToJSValue();
    JSC::JSValue thisValue = recv.IsEmpty() ? JSC::jsUndefined() : recv->localToJSValue();

    JSC::MarkedArgumentBuffer args;
    args.ensureCapacity(argc);
    for (int i = 0; i < argc; i++) {
        args.append(argv[i]->localToJSValue());
    }

    JSC::JSValue result = JSC::call(globalObject, callee, thisValue, args, "node::MakeCallback"_s);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Value>());

    return isolate->currentHandleScope()->createLocal<Value>(vm, result);
}

void node_module_register(void* opaque_mod)
{
    // TODO unify this with napi_module_register
    auto* globalObject = defaultGlobalObject();
    auto& vm = JSC::getVM(globalObject);
    auto* mod = reinterpret_cast<struct node_module*>(opaque_mod);

    auto keyStr = WTF::String::fromUTF8(mod->nm_modname);

    // Append to GlobalObject vector so BunProcess.cpp can save ALL registrations after dlopen completes
    globalObject->m_pendingV8Modules.append(mod);

    globalObject->napiModuleRegisterCallCount++;
    JSValue pendingNapiModule = globalObject->m_pendingNapiModuleAndExports[0].get();
    JSObject* object = (pendingNapiModule && pendingNapiModule.isObject()) ? pendingNapiModule.getObject()
                                                                           : nullptr;

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
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
        RETURN_IF_EXCEPTION(scope, void());
        strongExportsObject = { vm, exportsObject };
    } else {
        JSValue exportsObject = object->get(globalObject, WebCore::builtinNames(vm).exportsPublicName());
        RETURN_IF_EXCEPTION(scope, void());

        // Convert exports to object, matching Node.js behavior.
        // This throws for null/undefined and creates wrapper objects for primitives.
        JSObject* exports = exportsObject.toObject(globalObject);
        RETURN_IF_EXCEPTION(scope, void());

        ASSERT(exports);
        strongExportsObject = { vm, exports };
    }

    JSC::Strong<JSC::JSObject> strongObject = { vm, object };

    auto* isolate = globalObject->V8GlobalInternals()->isolate();
    HandleScope hs(isolate);

    // exports, module
    Local<Object> exports = hs.createLocal<Object>(vm, *strongExportsObject);
    Local<Value> module = hs.createLocal<Value>(vm, object);
    Local<Context> context = isolate->GetCurrentContext();
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

} // namespace node
