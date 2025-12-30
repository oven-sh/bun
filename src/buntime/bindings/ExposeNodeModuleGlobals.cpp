// clang-format off
#include "ModuleLoader.h"
#include "root.h"

#include <JavaScriptCore/PropertySlot.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSString.h>

#include "ZigGlobalObject.h"
#include "InternalModuleRegistry.h"

#undef assert

#define FOREACH_EXPOSED_BUILTIN_IMR(v)     \
    v(ffi,                    Bun::InternalModuleRegistry::BunFFI) \
    v(assert,                 Bun::InternalModuleRegistry::NodeAssert) \
    v(async_hooks,            Bun::InternalModuleRegistry::NodeAsyncHooks) \
    v(child_process,          Bun::InternalModuleRegistry::NodeChildProcess) \
    v(cluster,                Bun::InternalModuleRegistry::NodeCluster) \
    v(dgram,                  Bun::InternalModuleRegistry::NodeDgram) \
    v(diagnostics_channel,    Bun::InternalModuleRegistry::NodeDiagnosticsChannel) \
    v(dns,                    Bun::InternalModuleRegistry::NodeDNS) \
    v(domain,                 Bun::InternalModuleRegistry::NodeDomain) \
    v(events,                 Bun::InternalModuleRegistry::NodeEvents) \
    v(fs,                     Bun::InternalModuleRegistry::NodeFS) \
    v(http,                   Bun::InternalModuleRegistry::NodeHttp) \
    v(http2,                  Bun::InternalModuleRegistry::NodeHttp2) \
    v(https,                  Bun::InternalModuleRegistry::NodeHttps) \
    v(inspector,              Bun::InternalModuleRegistry::NodeInspector) \
    v(net,                    Bun::InternalModuleRegistry::NodeNet) \
    v(os,                     Bun::InternalModuleRegistry::NodeOS) \
    v(path,                   Bun::InternalModuleRegistry::NodePath) \
    v(perf_hooks,             Bun::InternalModuleRegistry::NodePerfHooks) \
    v(punycode,               Bun::InternalModuleRegistry::NodePunycode) \
    v(querystring,            Bun::InternalModuleRegistry::NodeQuerystring) \
    v(readline,               Bun::InternalModuleRegistry::NodeReadline) \
    v(stream,                 Bun::InternalModuleRegistry::NodeStream) \
    v(sys,                    Bun::InternalModuleRegistry::NodeUtil) \
    v(timers,                 Bun::InternalModuleRegistry::NodeTimers) \
    v(tls,                    Bun::InternalModuleRegistry::NodeTLS) \
    v(trace_events,           Bun::InternalModuleRegistry::NodeTraceEvents) \
    v(tty,                    Bun::InternalModuleRegistry::NodeTty) \
    v(url,                    Bun::InternalModuleRegistry::NodeUrl) \
    v(util,                   Bun::InternalModuleRegistry::NodeUtil) \
    v(v8,                     Bun::InternalModuleRegistry::NodeV8) \
    v(vm,                     Bun::InternalModuleRegistry::NodeVM) \
    v(wasi,                   Bun::InternalModuleRegistry::NodeWasi) \
    v(sqlite,                 Bun::InternalModuleRegistry::BunSqlite) \
    v(worker_threads,         Bun::InternalModuleRegistry::NodeWorkerThreads) \
    v(zlib,                   Bun::InternalModuleRegistry::NodeZlib) \
    v(constants,              Bun::InternalModuleRegistry::NodeConstants) \
    v(string_decoder,         Bun::InternalModuleRegistry::NodeStringDecoder) \
    v(buffer,                 Bun::InternalModuleRegistry::NodeBuffer) \
    v(jsc,                    Bun::InternalModuleRegistry::BunJSC) \

namespace ExposeNodeModuleGlobalGetters {

#define DECL_GETTER(id, field) \
    JSC_DEFINE_CUSTOM_GETTER(id, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName)) \
    { \
        Zig::GlobalObject* thisObject = defaultGlobalObject(lexicalGlobalObject); \
        JSC::VM& vm = thisObject->vm(); \
        return JSC::JSValue::encode(thisObject->internalModuleRegistry()->requireId(thisObject, vm, field)); \
    }
FOREACH_EXPOSED_BUILTIN_IMR(DECL_GETTER)
#undef DECL_GETTER    

} // namespace ExposeNodeModuleGlobalGetters

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__ExposeNodeModuleGlobals(Zig::GlobalObject* globalObject)
{

    auto& vm = JSC::getVM(globalObject);
#define PUT_CUSTOM_GETTER_SETTER(id, field) \
    globalObject->putDirectCustomAccessor( \
        vm, \
        JSC::Identifier::fromString(vm, #id##_s), \
        JSC::CustomGetterSetter::create( \
            vm, \
            ExposeNodeModuleGlobalGetters::id, \
            nullptr), \
        0 | JSC::PropertyAttribute::CustomValue \
    );

    FOREACH_EXPOSED_BUILTIN_IMR(PUT_CUSTOM_GETTER_SETTER)
#undef PUT_CUSTOM_GETTER_SETTER
}
