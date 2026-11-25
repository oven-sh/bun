#include "NodeDiagnosticsChannel.h"

#include "AsyncContextFrame.h"
#include "ModuleGraph.h"
#include "WebCoreJSBuiltins.h"
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSPromisePrototype.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/ScriptArguments.h>

namespace Bun {

using namespace JSC;

static std::optional<DiagnosticsHook> hookOfName(StringView name)
{
    static constexpr std::pair<ASCIILiteral, DiagnosticsHook> hooks[] = {
        { "console.log"_s, DiagnosticsHook::ConsoleLog },
        { "console.info"_s, DiagnosticsHook::ConsoleInfo },
        { "console.debug"_s, DiagnosticsHook::ConsoleDebug },
        { "console.warn"_s, DiagnosticsHook::ConsoleWarn },
        { "console.error"_s, DiagnosticsHook::ConsoleError },
        { "module.require"_s, DiagnosticsHook::ModuleRequire },
        { "module.import"_s, DiagnosticsHook::ModuleImport },
        { "process.execve"_s, DiagnosticsHook::ProcessExecve },
        { "sqlite.db.query"_s, DiagnosticsHook::SqliteQuery },
        { "undici:request"_s, DiagnosticsHook::Request },
        { "undici:websocket"_s, DiagnosticsHook::WebSocket },
    };
    static_assert(std::size(hooks) == static_cast<size_t>(DiagnosticsHook::Count));
    for (auto& [text, hook] : hooks) {
        if (name == text)
            return hook;
    }
    return std::nullopt;
}

JSC_DEFINE_HOST_FUNCTION(jsSetDiagnosticsHook, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    String name = callFrame->argument(0).getString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Compiled code counts on the methods of the global console to run no code but that of their operands.
    if (globalObject->vm().hasCompiledCode() && name.startsWith("console."_s))
        return JSValue::encode(jsUndefined());

    if (auto hook = hookOfName(name))
        globalObject->setDiagnosticsHook(*hook, callFrame->argument(1).getObject());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsObservePromise, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto* promise = dynamicDowncast<JSPromise>(callFrame->argument(0));
    if (!promise)
        return JSValue::encode(jsBoolean(false));
    // `await` calls the then() of a subclass, which may be what starts the work.
    if (promise->getPrototypeDirect() != globalObject->promisePrototype() && callFrame->argument(1) != promise->realm()->promisePrototype()->getDirect(vm, vm.propertyNames->then))
        return JSValue::encode(jsBoolean(false));

    bool wasHandled = promise->isHandled();
    // Ahead of the call, or it tells the rejection tracker that a rejected promise has a handler now.
    promise->markAsHandled();
    promise->performPromiseThenExported(vm, globalObject, callFrame->argument(2), callFrame->argument(3), jsUndefined());
    if (!wasHandled)
        promise->setFlags(promise->flags() & ~JSPromise::isHandledFlag);
    return JSValue::encode(jsBoolean(true));
}

JSValue createOriginalRequireFunction(Zig::GlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    return JSFunction::create(vm, globalObject, WebCore::commonJSOverridableRequireCodeGenerator(vm), globalObject);
}

static DiagnosticsHook hookOfLevel(MessageLevel level)
{
    switch (level) {
    case MessageLevel::Log:
        return DiagnosticsHook::ConsoleLog;
    case MessageLevel::Info:
        return DiagnosticsHook::ConsoleInfo;
    case MessageLevel::Debug:
        return DiagnosticsHook::ConsoleDebug;
    case MessageLevel::Warning:
        return DiagnosticsHook::ConsoleWarn;
    case MessageLevel::Error:
        return DiagnosticsHook::ConsoleError;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

// Five methods publish. The others that are heard call one of the five:
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/console/constructor.js#L409-L560
bool publishConsoleCall(Zig::GlobalObject* globalObject, MessageType& type, MessageLevel level, const Inspector::ScriptArguments& arguments, MarkedArgumentBuffer& printed, size_t printedLimit)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    size_t count = arguments.argumentCount();
    MessageType publishedType = MessageType::Log;
    MessageLevel publishedLevel = level;
    ASCIILiteral method;
    switch (type) {
    case MessageType::StartGroup:
    case MessageType::StartGroupCollapsed:
        if (!count)
            return false;
        [[fallthrough]];
    case MessageType::Log:
    case MessageType::DirXML:
        publishedType = type;
        break;
    case MessageType::Table:
        // The text of a table is published where it is made. ConsoleClient::table() drops a call without arguments.
        if (arguments.argumentAt(0).isObject())
            return false;
        count = 1;
        method = "table"_s;
        break;
    case MessageType::Assert:
        publishedLevel = MessageLevel::Warning;
        method = "assert"_s;
        break;
    case MessageType::Trace:
        publishedLevel = MessageLevel::Error;
        method = "trace"_s;
        break;
    default:
        return false;
    }

    JSObject* hook = globalObject->diagnosticsHook(hookOfLevel(publishedLevel));
    if (!hook) [[likely]]
        return false;

    MarkedArgumentBuffer values;
    for (size_t i = 0; i < count; ++i)
        values.append(arguments.argumentAt(i));
    if (values.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return false;
    }
    JSArray* array = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values);
    RETURN_IF_EXCEPTION(scope, false);

    MarkedArgumentBuffer hookArguments;
    hookArguments.append(array);
    hookArguments.append(method.isNull() ? jsUndefined() : jsNontrivialString(vm, method));
    if (type == MessageType::Trace)
        hookArguments.append(vm.topCallFrame->jsCallee());
    JSValue result = call(globalObject, hook, getCallData(hook), jsUndefined(), hookArguments);
    RETURN_IF_EXCEPTION(scope, false);
    if (result.isUndefined())
        return false;

    auto* changed = asArray(result);
    for (unsigned i = 0; i < changed->length() && i < printedLimit; ++i) {
        JSValue value = changed->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, false);
        printed.append(value);
    }
    if (printed.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return false;
    }
    // A subscriber took everything away: the line stays.
    if (printed.isEmpty() && (count || !method.isNull()))
        printed.append(jsEmptyString(vm));
    type = publishedType;
    return true;
}

extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__consoleLogDiagnosticsHook(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(defaultGlobalObject(globalObject)->diagnosticsHook(DiagnosticsHook::ConsoleLog));
}

extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__requestDiagnosticsHook(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(defaultGlobalObject(globalObject)->diagnosticsHook(DiagnosticsHook::Request));
}

// Holding on to it does not keep a Bun.ModuleGraph alive.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__currentAsyncLocalStores(JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return JSValue::encode(asyncContextWithoutModuleGraphs(globalObject, globalObject->m_asyncContextData.get()->getInternalField(0)));
}

// Returns the map, a new one if `maybeMap` is none.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__addToWeakMap(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue maybeMap, JSC::EncodedJSValue key, JSC::EncodedJSValue value)
{
    auto& vm = getVM(globalObject);
    auto* map = dynamicDowncast<JSWeakMap>(JSValue::decode(maybeMap));
    if (!map)
        map = JSWeakMap::create(vm, globalObject->weakMapStructure());
    map->set(vm, JSValue::decode(key).asCell(), JSValue::decode(value));
    return JSValue::encode(map);
}

// Stays in the context of the current Bun.ModuleGraph.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__callInAsyncLocalStores(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue function, JSC::EncodedJSValue stores, const JSC::EncodedJSValue* arguments, size_t count)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto* graph = currentModuleGraph(globalObject);
    AsyncContextScope asyncContext(globalObject, JSValue::decode(stores));
    ModuleGraphContextScope moduleGraphContext(globalObject, graph);
    JSValue callee = JSValue::decode(function);
    JSValue result = call(globalObject, callee, getCallData(callee), jsUndefined(), ArgList(const_cast<EncodedJSValue*>(arguments), count));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

JSPromise* traceImportCall(Zig::GlobalObject* globalObject, JSObject* hook, JSString* specifier, const SourceOrigin& sourceOrigin, const WTF::ScopedLambda<JSPromise*()>& import)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    MarkedArgumentBuffer arguments;
    auto& parentURL = sourceOrigin.url();
    arguments.append(parentURL.isEmpty() || parentURL.protocolIs("builtin"_s) ? jsUndefined() : jsString(vm, parentURL.string()));
    arguments.append(specifier);
    JSValue finish = call(globalObject, hook, getCallData(hook), jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, nullptr);

    JSPromise* promise = [&] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSPromise* promise = import();
        return scope.exception() ? JSPromise::rejectedPromiseWithCaughtException(globalObject, scope) : promise;
    }();
    RETURN_IF_EXCEPTION(scope, nullptr);

    arguments.clear();
    arguments.append(promise);
    call(globalObject, finish, getCallData(finish), jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return promise;
}

}
