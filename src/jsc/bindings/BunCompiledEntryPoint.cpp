#include "root.h"

#include "BunCompiledEntryPoint.h"

#include "BunString.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/AbstractModuleRecord.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <array>
#include <wtf/text/MakeString.h>

#if ENABLE(AOT)
#include "BunCompiledModules.h"

extern "C" bool Bun__VM__shouldLookForServer(void*);
extern "C" BunString Bun__VM__entryRootKey(void*);
#endif
extern "C" void Bun__VM__didLookForServer(void*);
extern "C" BunString Bun__VM__entryPath(void*);
extern "C" BunString Bun__entryPointWrapperSource(void*);
extern "C" void Bun__noteEntryEvaluation(Zig::GlobalObject*);

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(functionStartServerFromNamespace);

// A throw for a name that the object says it does not have is dropped, and the answer is empty. Every other throw stays the program's.
static JSValue getForLook(JSGlobalObject* globalObject, JSValue object, PropertyName name)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue value = object.get(globalObject, name);
    auto* exception = scope.exception();
    if (!exception) [[likely]]
        return value;
    if (!object.isObject() || !scope.tryClearException())
        return {};
    bool hasName = asObject(object)->hasProperty(globalObject, name);
    if (scope.exception()) [[unlikely]] {
        // A Proxy can refuse that question too. Then its first throw stays.
        if (!scope.tryClearException())
            return {};
        hasName = true;
    }
    if (hasName)
        throwException(globalObject, scope, exception);
    return {};
}

// An export that throws when it is asked for a name that it does not have is no server, and is asked for nothing more.
static bool isServerConfig(Zig::GlobalObject* globalObject, JSValue config)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!config.toBoolean(globalObject) || config == globalObject->globalThis())
        return false;
    JSValue fetch = getForLook(globalObject, config, Identifier::fromString(vm, "fetch"_s));
    RETURN_IF_EXCEPTION(scope, false);
    if (!fetch)
        return false;
    if (!fetch.isCallable()) {
        JSValue app = getForLook(globalObject, config, Identifier::fromString(vm, "app"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (!app || app.isUndefinedOrNull())
            return false;
    }
    JSValue stop = getForLook(globalObject, config, Identifier::fromString(vm, "stop"_s));
    RETURN_IF_EXCEPTION(scope, false);
    return stop && !stop.isCallable();
}

// The program wrote none of the reads and calls of the look, and no frame of a stack trace names them. The error says what Bun did.
static void addNoteOfLook(Zig::GlobalObject* globalObject, Exception* exception, ASCIILiteral whatBunDid)
{
    auto& vm = JSC::getVM(globalObject);
    auto* error = dynamicDowncast<ErrorInstance>(exception->value());
    unsigned attributes = 0;
    JSValue message = error ? error->getDirect(vm, vm.propertyNames->message, attributes) : JSValue();
    if (!message || !message.isString() || (attributes & PropertyAttribute::ReadOnly))
        return;
    String text = asString(message)->tryGetValue().data;
    String tail = makeString(" the default export of \""_s, Bun__VM__entryPath(globalObject->bunVM()).toWTFString(BunString::ZeroCopy), '"');
    // An error that leaves the look a second time has its note.
    if (text.isNull() || text.endsWith(tail))
        return;
    String noted = tryMakeString(text, "\nnote: Bun "_s, whatBunDid, tail);
    if (!noted.isNull())
        error->putDirect(vm, vm.propertyNames->message, jsString(vm, WTF::move(noted)), attributes);
}

static void startServerFromNamespace(Zig::GlobalObject* globalObject, JSValue entryNamespace)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (entryNamespace.isUndefinedOrNull())
        return;
    // An exported `then` hands over any value.
    JSValue config = getForLook(globalObject, entryNamespace, vm.propertyNames->defaultKeyword);
    RETURN_IF_EXCEPTION(scope, void());
    if (!config)
        return;
    bool isConfig = isServerConfig(globalObject, config);
    RETURN_IF_EXCEPTION(scope, void());
    if (!isConfig)
        return;
    JSValue bun = globalObject->get(globalObject, Identifier::fromString(vm, "Bun"_s));
    RETURN_IF_EXCEPTION(scope, void());
    JSValue serve = bun.get(globalObject, Identifier::fromString(vm, "serve"_s));
    RETURN_IF_EXCEPTION(scope, void());
    config = getForLook(globalObject, entryNamespace, vm.propertyNames->defaultKeyword);
    RETURN_IF_EXCEPTION(scope, void());
    if (!config)
        return;
    MarkedArgumentBuffer serveArguments;
    serveArguments.append(config);
    JSValue server = JSC::call(globalObject, serve, bun, serveArguments, "Bun.serve is not a function"_s);
    if (auto* exception = scope.exception()) [[unlikely]] {
        addNoteOfLook(globalObject, exception, "called Bun.serve() with"_s);
        return;
    }
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
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    startServerFromNamespace(globalObject, callFrame->argument(0));
    if (auto* exception = scope.exception()) [[unlikely]] {
        addNoteOfLook(globalObject, exception, "looked for a server in"_s);
        return {};
    }
    return JSValue::encode(jsUndefined());
}

// An entry point that exports a function `then` is asked through it, as `await import()` would ask, for what holds the server.
static void askEntryPointForServer(Zig::GlobalObject* globalObject, JSValue entryNamespace)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
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

static void lookForServer(Zig::GlobalObject* globalObject, JSValue entryNamespace)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    askEntryPointForServer(globalObject, entryNamespace);
    if (auto* exception = scope.exception()) [[unlikely]]
        addNoteOfLook(globalObject, exception, "looked for a server in"_s);
}

// The text of `bun:main` names the entry point and the load. A ShadowRealm and a Bun.ModuleGraph load that text with a loader of their own.
bool isEntryPointWrapperOfThisLoad(Zig::GlobalObject* globalObject, JSModuleLoader* moduleLoader, JSValue moduleRecordValue)
{
    auto& vm = JSC::getVM(globalObject);
    if (globalObject != defaultGlobalObject(vm) || moduleLoader != globalObject->moduleLoader())
        return false;
    auto* record = dynamicDowncast<JSModuleRecord>(moduleRecordValue);
    if (!record || record->moduleKey().string() != "bun:main"_s)
        return false;
    return record->sourceCode().view() == StringView(Bun__entryPointWrapperSource(globalObject->bunVM()).toWTFString(BunString::ZeroCopy));
}

JSValue evaluateEntryPointWrapper(Zig::GlobalObject* globalObject, JSModuleLoader* moduleLoader, JSValue key, JSValue moduleRecordValue, RefPtr<ScriptFetcher>&& scriptFetcher, JSValue sentValue, JSValue resumeMode)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // A CommonJS entry point evaluates without moduleLoaderEvaluate(), so this can be the first module of the load that it gets.
    Bun__noteEntryEvaluation(globalObject);
    JSValue result = moduleLoader->evaluateNonVirtual(globalObject, key, moduleRecordValue, WTF::move(scriptFetcher), sentValue, resumeMode);
    RETURN_IF_EXCEPTION(scope, {});
    Bun__VM__didLookForServer(globalObject->bunVM());
    // The entry point is the one import of the wrapper, which bound its namespace object to `start`.
    auto* wrapper = uncheckedDowncast<AbstractModuleRecord>(moduleRecordValue);
    const auto& imports = wrapper->requestedModules();
    auto* entryPoint = imports.size() == 1 ? wrapper->hostResolveImportedModule(globalObject, imports.first().m_specifier, imports.first().type()) : nullptr;
    RETURN_IF_EXCEPTION(scope, {});
    if (!entryPoint)
        return result;
    JSValue entryNamespace = entryPoint->moduleNamespaceObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    lookForServer(globalObject, entryNamespace);
    RETURN_IF_EXCEPTION(scope, {});
    return result;
}

#if ENABLE(AOT)

bool isMainModuleImport(JSGlobalObject* lexicalGlobalObject, AOT::ModuleID module)
{
    void* bunVM = defaultGlobalObject(lexicalGlobalObject)->bunVM();
    return Bun__VM__shouldLookForServer(bunVM) && compiledModuleForPath(Bun__VM__entryRootKey(bunVM).toWTFString(BunString::ZeroCopy)) == module;
}

void didEvaluateMainModule(JSGlobalObject* lexicalGlobalObject, AOT::ModuleID entryPoint)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Bun__VM__didLookForServer(globalObject->bunVM());
    // Most programs export neither, and need no namespace object.
    if (!AOT::mayExport(globalObject, entryPoint, vm.propertyNames->then.impl()) && !AOT::mayExport(globalObject, entryPoint, vm.propertyNames->defaultKeyword.impl()))
        return;
    JSValue entryNamespace = AOT::moduleNamespace(globalObject, entryPoint);
    RETURN_IF_EXCEPTION(scope, void());
    RELEASE_AND_RETURN(scope, lookForServer(globalObject, entryNamespace));
}

#endif // ENABLE(AOT)

} // namespace Bun
