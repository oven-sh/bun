#include "node.h"
#include "V8HandleScope.h"
#include "ErrorCode.h"

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

#if !OS(WINDOWS)
extern "C" struct uv_loop_s* Bun__VirtualMachine__uvLoop(void* bunVM);
#endif

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
    return Bun__VirtualMachine__uvLoop(isolate->globalObject()->bunVM());
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
    // This runs in one of the addon's static constructors, so like Node it only queues the module.
    auto* globalObject = defaultGlobalObject();
    globalObject->m_pendingV8Modules.append(reinterpret_cast<struct node_module*>(opaque_mod));
    globalObject->napiModuleRegisterCallCount++;
}

// 13.0.0 moved to Node-API and ships prebuilt binaries. 13.0.2 is the first that installs without a node-gyp step ("gypfile": false).
static constexpr ASCIILiteral betterSqlite3Remedy = "\nbetter-sqlite3 13 uses Node-API. Upgrade to 13.0.2 or later, or use bun:sqlite, which has a similar API."_s;

WTF::String loaderErrorMessage(WTF::String&& loaderError, const WTF::String& filename)
{
    // The Itanium mangling of every member of v8:: and node:: starts with one of these.
    auto namesV8Symbol = [](const WTF::String& text) {
        return text.contains("_ZN2v8"_s) || text.contains("_ZNK2v8"_s) || text.contains("_ZN4node"_s) || text.contains("_ZNK4node"_s);
    };
    // The loader repeats the path in its error. A path that has one of them in it proves nothing.
    if (!namesV8Symbol(loaderError) || namesV8Symbol(filename))
        return WTF::move(loaderError);
    // Nothing registered before the loader failed, so the file name is the only sign of a better-sqlite3 build.
    bool isBetterSqlite3 = filename.endsWith("better_sqlite3.node"_s);
    return makeString(loaderError, "\nBun does not export this V8 or Node.js C++ API function. Either the addon was built for another Node.js version (this version of Bun requires NODE_MODULE_VERSION " STRINGIZE_VALUE_OF(REPORTED_NODEJS_ABI_VERSION) "), or it uses a function that is not yet supported in Bun (https://github.com/oven-sh/bun/issues/4290)."_s, isBetterSqlite3 ? betterSqlite3Remedy : ""_s);
}

void executePendingV8Module(Zig::GlobalObject* globalObject, node_module* mod, JSObject* object, const WTF::String& filename)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Node runs this module. In Bun the loader ends the process at its first call of a v8:: or node:: function that Bun does not export. Remove this when better-sqlite3 12.11.1 runs a query: https://github.com/oven-sh/bun/issues/4290
    if (mod->nm_modname && !strcmp(mod->nm_modname, "better_sqlite3")) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_DLOPEN_FAILED,
            makeString("Cannot load native addon '"_s, filename, "': this build of better-sqlite3 uses V8 C++ API functions that are not yet supported in Bun (https://github.com/oven-sh/bun/issues/4290)."_s, betterSqlite3Remedy));
        return;
    }

    if (mod->nm_version != REPORTED_NODEJS_ABI_VERSION) {
        auto* error = JSC::createError(globalObject,
            WTF::makeString("The module '"_s,
                WTF::String::fromUTF8(mod->nm_modname),
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

    // Like Node, convert exports to an object. null and undefined throw, and a primitive gets a wrapper object.
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
        auto* error = JSC::createError(globalObject, WTF::makeString("The module '"_s, WTF::String::fromUTF8(mod->nm_modname), "' has no declared entry point."_s));
        JSC::throwException(globalObject, scope, error);
        return;
    }

    RETURN_IF_EXCEPTION(scope, void());
}

} // namespace node
