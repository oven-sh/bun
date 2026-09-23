#include "node.h"
#include "V8HandleScope.h"

#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ThrowScope.h"

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
    // Only queue, as Node does (https://github.com/nodejs/node/blob/b7e6a5d37e7a14ef0f2cc95214b95d66c4081415/src/node_binding.cc#L275-L290): this runs in a static constructor of the addon.
    auto* globalObject = defaultGlobalObject();
    globalObject->m_pendingV8Modules.append(reinterpret_cast<struct node_module*>(opaque_mod));
    globalObject->napiModuleRegisterCallCount++;
}

void executePendingV8Module(Zig::GlobalObject* globalObject, node_module* mod, JSObject* object)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto keyStr = WTF::String::fromUTF8(mod->nm_modname);

    if (mod->nm_version != REPORTED_NODEJS_ABI_VERSION) {
        auto* error = JSC::createError(globalObject,
            WTF::makeString("The module '"_s,
                keyStr,
                "' was compiled against a different Node.js ABI version using NODE_MODULE_VERSION "_s,
                mod->nm_version,
                ". This version of Bun requires NODE_MODULE_VERSION "_s,
                REPORTED_NODEJS_ABI_VERSION,
                ". Please try re-compiling or re-installing the module."_s));
        JSC::throwException(globalObject, scope, error);
        return;
    }

    JSValue exportsValue = object->get(globalObject, WebCore::builtinNames(vm).exportsPublicName());
    RETURN_IF_EXCEPTION(scope, void());

    // Like Node, convert exports to an object: null and undefined throw, a primitive gets a wrapper object.
    JSObject* exportsObject = exportsValue.toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, void());

    ASSERT(exportsObject);
    JSC::Strong<JSC::JSObject> strongExportsObject = { vm, exportsObject };

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
        JSC::throwException(globalObject, scope, error);
        return;
    }

    RETURN_IF_EXCEPTION(scope, void());
}

} // namespace node
