#pragma once

#include "v8.h"
#include "V8Local.h"
#include "V8Isolate.h"
#include "V8Object.h"
#include "V8Value.h"
#include "V8String.h"

namespace node {

typedef double async_id;
struct async_context {
    double async_id;
    double trigger_async_id;
};

BUN_EXPORT void AddEnvironmentCleanupHook(v8::Isolate* isolate,
    void (*fun)(void* arg),
    void* arg);

BUN_EXPORT void RemoveEnvironmentCleanupHook(v8::Isolate* isolate,
    void (*fun)(void* arg),
    void* arg);

BUN_EXPORT async_id AsyncHooksGetExecutionAsyncId(v8::Isolate* isolate);

BUN_EXPORT async_id AsyncHooksGetTriggerAsyncId(v8::Isolate* isolate);

BUN_EXPORT async_context EmitAsyncInit(v8::Isolate* isolate,
    v8::Local<v8::Object> resource,
    const char* name,
    async_id trigger_async_id = -1);

BUN_EXPORT async_context EmitAsyncInit(v8::Isolate* isolate,
    v8::Local<v8::Object> resource,
    v8::Local<v8::String> name,
    async_id trigger_async_id = -1);

BUN_EXPORT void EmitAsyncDestroy(v8::Isolate* isolate,
    async_context asyncContext);

typedef void (*addon_register_func)(
    v8::Local<v8::Object> exports,
    v8::Local<v8::Value> module,
    void* priv);

typedef void (*addon_context_register_func)(
    v8::Local<v8::Object> exports,
    v8::Local<v8::Value> module,
    v8::Local<v8::Context> context,
    void* priv);

struct node_module {
    int nm_version;
    unsigned int nm_flags;
    void* nm_dso_handle;
    const char* nm_filename;
    node::addon_register_func nm_register_func;
    node::addon_context_register_func nm_context_register_func;
    const char* nm_modname;
    void* nm_priv;
    struct node_module* nm_link;
};

extern "C" BUN_EXPORT void node_module_register(void* mod);

} // namespace node
