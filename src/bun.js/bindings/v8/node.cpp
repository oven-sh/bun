#include "node.h"

using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::Value;

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
    Isolate* isolate = Isolate::GetCurrent();
    // TODO
    // must update pendingNapiModule
    struct node_module* mod = reinterpret_cast<struct node_module*>(opaque_mod);
    if (mod->nm_register_func) {
        v8::HandleScope hs(isolate);
        Local<Object> exports = Object::New(isolate);
        Local<Value> module; // init somehow?
        mod->nm_register_func(exports, module, mod->nm_priv);
    }
}

}
