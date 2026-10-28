#include "root.h"

#include "BunCompiledEntryPoint.h"
#include "BunString.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/AbstractModuleRecord.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ModuleRegistryEntry.h>
#include <array>
#include <wtf/text/MakeString.h>

extern "C" bool Bun__VM__shouldLookForServer(void*);
extern "C" void Bun__VM__didLookForServer(void*);
extern "C" BunString Bun__VM__entryRootKey(void*);

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(functionStartServerFromNamespace);
static JSC_DECLARE_HOST_FUNCTION(functionLookForServerAfterEvaluation);

static bool isServerConfig(Zig::GlobalObject* globalObject, JSValue config)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!config.toBoolean(globalObject) || config == globalObject->globalThis())
        return false;
    JSValue fetch = config.get(globalObject, Identifier::fromString(vm, "fetch"_s));
    RETURN_IF_EXCEPTION(scope, false);
    if (!fetch.isCallable()) {
        JSValue app = config.get(globalObject, Identifier::fromString(vm, "app"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (app.isUndefinedOrNull())
            return false;
    }
    JSValue stop = config.get(globalObject, Identifier::fromString(vm, "stop"_s));
    RETURN_IF_EXCEPTION(scope, false);
    return !stop.isCallable();
}

static void startServerFromNamespace(Zig::GlobalObject* globalObject, JSValue entryNamespace)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (entryNamespace.isUndefinedOrNull())
        return;
    JSValue config = entryNamespace.get(globalObject, vm.propertyNames->defaultKeyword);
    RETURN_IF_EXCEPTION(scope, void());
    bool isConfig = isServerConfig(globalObject, config);
    RETURN_IF_EXCEPTION(scope, void());
    if (!isConfig)
        return;
    JSValue bun = globalObject->get(globalObject, Identifier::fromString(vm, "Bun"_s));
    RETURN_IF_EXCEPTION(scope, void());
    JSValue serve = bun.get(globalObject, Identifier::fromString(vm, "serve"_s));
    RETURN_IF_EXCEPTION(scope, void());
    config = entryNamespace.get(globalObject, vm.propertyNames->defaultKeyword);
    RETURN_IF_EXCEPTION(scope, void());
    MarkedArgumentBuffer serveArguments;
    serveArguments.append(config);
    JSValue server = JSC::call(globalObject, serve, bun, serveArguments, "Bun.serve is not a function"_s);
    RETURN_IF_EXCEPTION(scope, void());
    JSValue console = globalObject->get(globalObject, Identifier::fromString(vm, "console"_s));
    RETURN_IF_EXCEPTION(scope, void());
    JSValue debug = console.get(globalObject, Identifier::fromString(vm, "debug"_s));
    RETURN_IF_EXCEPTION(scope, void());
    JSValue development = server.get(globalObject, Identifier::fromString(vm, "development"_s));
    RETURN_IF_EXCEPTION(scope, void());
    bool isDevelopment = development.toBoolean(globalObject);
    std::array<String, 3> parts;
    std::array<ASCIILiteral, 3> names { "protocol"_s, "hostname"_s, "port"_s };
    for (size_t i = 0; i < names.size(); ++i) {
        JSValue part = server.get(globalObject, Identifier::fromString(vm, names[i]));
        RETURN_IF_EXCEPTION(scope, void());
        parts[i] = part.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, void());
    }
    MarkedArgumentBuffer debugArguments;
    debugArguments.append(jsString(vm, makeString("Started "_s, isDevelopment ? "development "_s : ""_s, "server: "_s, parts[0], "://"_s, parts[1], ':', parts[2])));
    scope.release();
    JSC::call(globalObject, debug, console, debugArguments, "console.debug is not a function"_s);
}

JSC_DEFINE_HOST_FUNCTION(functionStartServerFromNamespace, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    startServerFromNamespace(defaultGlobalObject(lexicalGlobalObject), callFrame->argument(0));
    return JSValue::encode(jsUndefined());
}

static void lookForServer(Zig::GlobalObject* globalObject, AbstractModuleRecord* moduleRecord)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Bun__VM__didLookForServer(globalObject->bunVM());
    JSValue entryNamespace = moduleRecord->moduleNamespaceObject(globalObject);
    RETURN_IF_EXCEPTION(scope, void());
    JSValue then = entryNamespace.get(globalObject, vm.propertyNames->then);
    RETURN_IF_EXCEPTION(scope, void());
    if (!then.isCallable())
        RELEASE_AND_RETURN(scope, startServerFromNamespace(globalObject, entryNamespace));
    JSValue reportError = globalObject->get(globalObject, Identifier::fromString(vm, "reportError"_s));
    RETURN_IF_EXCEPTION(scope, void());
    MarkedArgumentBuffer arguments;
    arguments.append(JSFunction::create(vm, globalObject, 1, String(), functionStartServerFromNamespace, ImplementationVisibility::Private));
    arguments.append(reportError);
    scope.release();
    JSC::call(globalObject, then, entryNamespace, arguments, "then is not a function"_s);
}

static AbstractModuleRecord* entryPointRecord(Zig::GlobalObject* globalObject, JSModuleLoader* moduleLoader)
{
    BunString rootKey = Bun__VM__entryRootKey(globalObject->bunVM());
    auto* entry = moduleLoader->registryEntry(Identifier::fromString(globalObject->vm(), rootKey.toWTFString(BunString::ZeroCopy)));
    return entry ? entry->record() : nullptr;
}

void lookForServerInEntryPoint(Zig::GlobalObject* globalObject, JSModuleLoader* moduleLoader, JSValue moduleRecord)
{
    if (!Bun__VM__shouldLookForServer(globalObject->bunVM())) [[likely]]
        return;
    auto* record = dynamicDowncast<AbstractModuleRecord>(moduleRecord);
    if (record && !record->hasTLA() && record == entryPointRecord(globalObject, moduleLoader))
        lookForServer(globalObject, record);
}

JSC_DEFINE_HOST_FUNCTION(functionLookForServerAfterEvaluation, (JSGlobalObject * lexicalGlobalObject, CallFrame*))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(JSC::getVM(globalObject));
    if (!Bun__VM__shouldLookForServer(globalObject->bunVM()))
        return JSValue::encode(jsUndefined());
    if (auto* record = entryPointRecord(globalObject, globalObject->moduleLoader()))
        lookForServer(globalObject, record);
    if (auto* exception = scope.exception()) {
        (void)scope.tryClearException();
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
    }
    return JSValue::encode(jsUndefined());
}

} // namespace Bun

extern "C" void Bun__lookForServerAfterEvaluation(JSC::JSGlobalObject* globalObject, JSC::JSPromise* promise)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::JSObject* derived = promise->then(globalObject, JSC::JSFunction::create(vm, globalObject, 0, String(), Bun::functionLookForServerAfterEvaluation, JSC::ImplementationVisibility::Private), JSC::jsUndefined());
    scope.assertNoException();
    if (auto* derivedPromise = dynamicDowncast<JSC::JSPromise>(derived))
        derivedPromise->markAsHandled();
}
