#include "node.h"
#include "V8HandleScope.h"
#include "JSBuffer.h"

#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ThrowScope.h"
#include "JavaScriptCore/ArrayBuffer.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSArrayBufferViewInlines.h"
#include "JavaScriptCore/JSTypedArrays.h"

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

namespace Buffer {

// Node's CHECK(val->IsArrayBufferView()). The type check reads the handle's kind first, so
// a number or an oddball aborts with this message instead of being read as a cell.
static JSC::JSArrayBufferView* viewOf(v8::Local<v8::Value> val, const char* caller)
{
    RELEASE_ASSERT(val->IsArrayBufferView(), "%s: not an ArrayBufferView", caller);
    return val->localToObjectPointer<JSC::JSArrayBufferView>();
}

bool HasInstance(v8::Local<v8::Value> val)
{
    return val->IsArrayBufferView();
}

bool HasInstance(v8::Local<v8::Object> val)
{
    return val->IsArrayBufferView();
}

char* Data(v8::Local<v8::Value> val)
{
    auto* view = viewOf(val, "node::Buffer::Data");
    // A small view made by JS has no ArrayBuffer yet and moves its bytes when one is
    // made. Make it now, so the address stays valid for the view's lifetime, as in Node
    // (napi_get_buffer_info does the same).
    RELEASE_ASSERT(view->possiblySharedBuffer(), "node::Buffer::Data: out of memory");
    return static_cast<char*>(view->vector());
}

char* Data(v8::Local<v8::Object> val)
{
    return Data(val.reinterpret<v8::Value>());
}

size_t Length(v8::Local<v8::Value> val)
{
    return viewOf(val, "node::Buffer::Length")->byteLength();
}

size_t Length(v8::Local<v8::Object> val)
{
    return Length(val.reinterpret<v8::Value>());
}

// A Buffer over its own ArrayBuffer, as napi_create_buffer makes one, so the address Data()
// returns stays valid for the buffer's lifetime, as in Node. Null with an OutOfMemoryError
// pending if the allocation fails. The caller owns the boundary exception scope.
static JSC::JSUint8Array* createBufferOverArrayBuffer(Zig::GlobalObject* globalObject, size_t length, RefPtr<JSC::ArrayBuffer>& arrayBuffer)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(length, 1);
    if (!arrayBuffer) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    RELEASE_AND_RETURN(scope, JSC::JSUint8Array::create(globalObject, globalObject->JSBufferSubclassStructure(), arrayBuffer.copyRef(), 0, length));
}

static void throwStringNotReadable(Zig::GlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    JSC::throwOutOfMemoryError(globalObject, scope);
}

v8::MaybeLocal<v8::Object> Copy(v8::Isolate* isolate, const char* data, size_t len)
{
    auto* globalObject = isolate->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    RefPtr<JSC::ArrayBuffer> arrayBuffer;
    auto* buffer = createBufferOverArrayBuffer(globalObject, len, arrayBuffer);
    RETURN_IF_EXCEPTION(scope, {});
    if (len > 0) {
        memcpy(arrayBuffer->data(), data, len);
    }
    return isolate->currentHandleScope()->createLocal<v8::Object>(vm, buffer);
}

// Node's StringBytes::Write: ASCII writes the low byte of each code unit like
// LATIN1, and BUFFER writes UTF-8.
static WebCore::BufferEncodingType toBufferEncoding(enum encoding enc)
{
    switch (enc) {
    case UTF8:
    case BUFFER:
        return WebCore::BufferEncodingType::utf8;
    case BASE64:
        return WebCore::BufferEncodingType::base64;
    case UCS2:
        return WebCore::BufferEncodingType::ucs2;
    case HEX:
        return WebCore::BufferEncodingType::hex;
    case BASE64URL:
        return WebCore::BufferEncodingType::base64url;
    case ASCII:
    case BINARY:
        return WebCore::BufferEncodingType::latin1;
    }
    RELEASE_ASSERT_NOT_REACHED("node::Buffer::New: unknown encoding %d", static_cast<int>(enc));
}

v8::MaybeLocal<v8::Object> New(v8::Isolate* isolate, v8::Local<v8::String> string, enum encoding enc)
{
    auto* globalObject = isolate->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::JSString* jsString = string->localToJSString();
    WebCore::BufferEncodingType encoding = toBufferEncoding(enc);

    // Like Node: size the store from the string, write, and keep the bytes written.
    std::optional<size_t> maybeLength = Bun::byteLength(jsString, globalObject, encoding);
    RETURN_IF_EXCEPTION(scope, {});
    if (!maybeLength) [[unlikely]] {
        // byteLength() could not read the string (a rope that failed to resolve).
        throwStringNotReadable(globalObject);
        return {};
    }
    size_t length = *maybeLength;

    RefPtr<JSC::ArrayBuffer> arrayBuffer;
    auto* buffer = createBufferOverArrayBuffer(globalObject, length, arrayBuffer);
    RETURN_IF_EXCEPTION(scope, {});

    if (length > 0) {
        auto view = jsString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto* to = static_cast<unsigned char*>(arrayBuffer->data());
        size_t written = 0;
        if (encoding == WebCore::BufferEncodingType::utf8) {
            written = v8::shim::writeUtf8(view, reinterpret_cast<char*>(to), length, nullptr);
        } else if (view->is8Bit()) {
            const auto span = view->span8();
            written = Bun__encoding__writeLatin1(span.data(), span.size(), to, length, static_cast<Encoding>(encoding));
        } else {
            const auto span = view->span16();
            written = Bun__encoding__writeUTF16(span.data(), span.size(), to, length, static_cast<Encoding>(encoding));
        }
        ASSERT(written <= length);
        if (written < length) {
            // A hex or base64 string can decode to fewer bytes than its size bound. Like
            // Node, copy them into a store of the exact size.
            RefPtr<JSC::ArrayBuffer> exact;
            buffer = createBufferOverArrayBuffer(globalObject, written, exact);
            RETURN_IF_EXCEPTION(scope, {});
            if (written > 0) {
                memcpy(exact->data(), to, written);
            }
        }
    }

    return isolate->currentHandleScope()->createLocal<v8::Object>(vm, buffer);
}

} // namespace Buffer

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
        auto* error = JSC::createError(globalObject, WTF::makeString("The module '"_s, keyStr, "' has no declared entry point."_s));
        JSC::throwException(globalObject, scope, error);
        return;
    }

    RETURN_IF_EXCEPTION(scope, void());
}

} // namespace node
