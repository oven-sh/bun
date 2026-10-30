#include "root.h"

#include "BunCompiledEntryPoint.h"

#if ENABLE(AOT)

#include "BunCompiledModules.h"
#include "BunString.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSFunction.h>
#include <array>
#include <wtf/text/MakeString.h>

extern "C" bool Bun__VM__shouldLookForServer(void*);
extern "C" void Bun__VM__didLookForServer(void*);
extern "C" BunString Bun__VM__entryRootKey(void*);

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(functionStartServerFromNamespace);

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

bool isImportOfMainModule(JSGlobalObject* lexicalGlobalObject, AOT::ModuleID module)
{
    void* bunVM = defaultGlobalObject(lexicalGlobalObject)->bunVM();
    return Bun__VM__shouldLookForServer(bunVM) && compiledModuleForPath(Bun__VM__entryRootKey(bunVM).toWTFString(BunString::ZeroCopy)) == module;
}

void runMainModule(JSGlobalObject* lexicalGlobalObject, AOT::ModuleID entryPoint)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Bun__VM__didLookForServer(globalObject->bunVM());
    JSValue entryNamespace = AOT::moduleNamespace(globalObject, entryPoint);
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

} // namespace Bun

#endif // ENABLE(AOT)
