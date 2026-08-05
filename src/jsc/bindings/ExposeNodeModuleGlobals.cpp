// clang-format off
#include "root.h"
#include "ModuleLoader.h"
#include "headers-handwritten.h"
#include "PathInlines.h"
#include "JSCommonJSModule.h"

#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSGlobalProxyInlines.h>
#include <JavaScriptCore/PropertySlot.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/SourceCode.h>

#include "ZigGlobalObject.h"
#include "InternalModuleRegistry.h"

#pragma push_macro("assert")
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

// Assignment puts a plain data property on the receiver (the old null-setter
// CustomValue behavior): writes through `globalThis` replace the lazy
// accessor, writes through an inheriting object shadow it.
JSC_DEFINE_CUSTOM_SETTER(exposedNodeModuleGlobalSetter, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    JSC::JSValue decodedThis = JSC::JSValue::decode(thisValue);
    if (auto* proxy = dynamicDowncast<JSC::JSGlobalProxy>(decodedThis))
        decodedThis = proxy->target();
    JSC::JSObject* thisObject = decodedThis.getObject();
    if (!thisObject)
        return false;
    thisObject->putDirect(JSC::getVM(lexicalGlobalObject), propertyName, JSC::JSValue::decode(encodedValue), 0);
    return true;
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__ExposeNodeModuleGlobals(Zig::GlobalObject* globalObject)
{

    auto& vm = JSC::getVM(globalObject);
    // CustomAccessor, not CustomValue: JSC computes a CustomValue during
    // [[GetOwnProperty]], so the global-declaration shadow check for a
    // top-level `const zlib = ...` would load node:zlib before the script's
    // first statement. An accessor's descriptor never invokes the getter.
#define PUT_CUSTOM_GETTER_SETTER(id, field) \
    globalObject->putDirectCustomAccessor( \
        vm, \
        JSC::Identifier::fromString(vm, #id##_s), \
        JSC::CustomGetterSetter::create( \
            vm, \
            ExposeNodeModuleGlobalGetters::id, \
            exposedNodeModuleGlobalSetter), \
        0 | JSC::PropertyAttribute::CustomAccessor \
    );

    FOREACH_EXPOSED_BUILTIN_IMR(PUT_CUSTOM_GETTER_SETTER)
#undef PUT_CUSTOM_GETTER_SETTER
}

// Evaluate `internal/process/pre_execution` before any user code runs.
// Called from VirtualMachine::reload_entry_point when argv carries a
// Node.js `--trace-*` flag. The registry caches the module, so repeat calls
// (hot reload, workers) are cheap.
extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__preExecutionBootstrap(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    globalObject->internalModuleRegistry()->requireId(globalObject, vm, Bun::InternalModuleRegistry::InternalProcessPreExecution);
    if (auto* exception = scope.exception()) [[unlikely]] {
        CLEAR_IF_EXCEPTION(scope);
        Bun__reportError(globalObject, JSC::JSValue::encode(exception));
    }
}

// Set up require(), module, __filename, __dirname on globalThis for the REPL.
// Creates a CommonJS module object rooted at the given directory so require() resolves correctly.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__REPL__setupGlobalRequire(
    Zig::GlobalObject* globalObject,
    const unsigned char* cwdPtr,
    size_t cwdLen)
{
    using namespace JSC;
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto cwdStr = WTF::String::fromUTF8(std::span { cwdPtr, cwdLen });
    auto* filename = jsString(vm, makeString(cwdStr, PLATFORM_SEP_s, "[repl]"_s));
    auto* dirname = jsString(vm, WTF::String(cwdStr));

    auto* moduleObject = Bun::JSCommonJSModule::create(vm,
        globalObject->CommonJSModuleObjectStructure(),
        filename, filename, dirname, SourceCode());
    moduleObject->hasEvaluated = true;

    auto* resolveFunction = JSBoundFunction::create(vm, globalObject,
        globalObject->requireResolveFunctionUnbound(), filename,
        ArgList(), 1, globalObject->commonStrings().resolveString(globalObject),
        makeSource("resolve"_s, SourceOrigin(), SourceTaintedOrigin::Untainted));
    RETURN_IF_EXCEPTION(scope, );

    auto* requireFunction = JSBoundFunction::create(vm, globalObject,
        globalObject->requireFunctionUnbound(), moduleObject,
        ArgList(), 1, globalObject->commonStrings().requireString(globalObject),
        makeSource("require"_s, SourceOrigin(), SourceTaintedOrigin::Untainted));
    RETURN_IF_EXCEPTION(scope, );

    requireFunction->putDirect(vm, vm.propertyNames->resolve, resolveFunction, 0);
    moduleObject->putDirect(vm, WebCore::clientData(vm)->builtinNames().requirePublicName(), requireFunction, 0);

    globalObject->putDirect(vm, WebCore::builtinNames(vm).requirePublicName(), requireFunction, 0);
    globalObject->putDirect(vm, Identifier::fromString(vm, "module"_s), moduleObject, 0);
    globalObject->putDirect(vm, Identifier::fromString(vm, "__filename"_s), filename, 0);
    globalObject->putDirect(vm, Identifier::fromString(vm, "__dirname"_s), dirname, 0);
}

#pragma pop_macro("assert")
