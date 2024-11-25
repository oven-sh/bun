// clang-format off
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


JSC_DEFINE_CUSTOM_GETTER(jsCustomGetterGetNativeModule, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject); 
    JSC::VM& vm = globalObject->vm(); 
    
    JSC::JSValue key = JSC::identifierToJSValue(vm, propertyName == "jsc"_s ? JSC::Identifier::fromString(vm, "bun:jsc"_s) : JSC::Identifier::fromUid(vm, propertyName.uid())); 
    JSC::JSValue result = globalObject->requireMap()->get(globalObject, key); 
    if (!result || result.isUndefinedOrNull()) { 
        auto& builtinNames = WebCore::builtinNames(vm); 
        JSC::JSFunction* function = jsCast<JSC::JSFunction*>(globalObject->getDirect(vm, builtinNames.requireNativeModulePrivateName())); 
        JSC::MarkedArgumentBuffer arguments = JSC::MarkedArgumentBuffer(); 
        arguments.append(key); 
        auto callData = JSC::getCallData(function); 
        return JSC::JSValue::encode(call(globalObject, function, callData, JSC::jsUndefined(), arguments)); 
    } 
    return JSC::JSValue::encode(result); 
}

} // namespace ExposeNodeModuleGlobalGetters

extern "C" void Bun__ExposeNodeModuleGlobals(Zig::GlobalObject* globalObject)
{

    JSC::VM& vm = globalObject->vm();
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


    JSC::CustomGetterSetter *nativeModuleGetter = JSC::CustomGetterSetter::create(
        vm,
        ExposeNodeModuleGlobalGetters::jsCustomGetterGetNativeModule,
        nullptr
    );

    static constexpr ASCIILiteral nativeModuleNames[] = {
        "constants"_s,
        "string_decoder"_s,
        "buffer"_s,
        "jsc"_s,
    };

    for (auto name : nativeModuleNames) {
        globalObject->putDirectCustomAccessor(
            vm,
            JSC::Identifier::fromString(vm, name),
            nativeModuleGetter,
            0 | JSC::PropertyAttribute::CustomValue
        );
    }
}
