#include "root.h"
#include "JSNextTickQueue.h"

#include "BunCompiledModules.h"

#include "BunAOTCompile.h"
#include "BunClientData.h"
#include "BunCompiledEntryPoint.h"
#include "CodeGenerationFromStrings.h"
#include "ErrorCode.h"
#include "ImportMetaObject.h"
#include "JSCommonJSExtensions.h"
#include "JSCommonJSModule.h"
#include "ModuleLoader.h"
#include "PathInlines.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGlobalObject.h"
#if ENABLE(AOT)
#include <JavaScriptCore/AOTImage.h>
#include <JavaScriptCore/AOTPropertyWalk.h>
#endif
#include <JavaScriptCore/AOTSchemaEnums.h>
#include <JavaScriptCore/AbstractModuleRecord.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/RegExp.h>
#include <JavaScriptCore/ScriptFetchParameters.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/Symbol.h>
#include <wtf/SetForScope.h>

#if ENABLE(AOT)
namespace Zig {
void runCompiledMock(Zig::GlobalObject*, JSC::AOT::ModuleID);
}
#endif

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsFunctionCallOwnFunctionsWithoutParameters, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    using namespace JSC;
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* holder = callFrame->argument(0).getObject();
    JSObject* except = callFrame->argument(1).getObject();
    JSValue receiver = callFrame->argument(2);
    if (!holder || !except)
        return throwVMTypeError(globalObject, scope, "The holder and the exceptions must be objects"_s);
    MarkedArgumentBuffer makersOfIterators;

    PropertyNameArrayBuilder keys(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    holder->methodTable()->getOwnPropertyNames(holder, globalObject, keys, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, {});
    auto callUnder = [&](const Identifier& key) {
        bool isExcepted = except->hasOwnProperty(globalObject, key);
        RETURN_IF_EXCEPTION(scope, void());
        if (isExcepted)
            return;
        PropertyDescriptor descriptor;
        bool isOwn = holder->getOwnPropertyDescriptor(globalObject, key, descriptor);
        RETURN_IF_EXCEPTION(scope, void());
        if (!isOwn || !descriptor.value() || !descriptor.value().isCallable())
            return;
        JSValue length = descriptor.value().get(globalObject, vm.propertyNames->length);
        RETURN_IF_EXCEPTION(scope, void());
        if (!length.isNumber() || length.asNumber())
            return;
        JSValue answer = call(globalObject, descriptor.value(), getCallData(descriptor.value()), receiver, ArgList());
        RETURN_IF_EXCEPTION(scope, void());
        if (!answer.isObject() || answer.isCallable())
            return;
        bool hasIterator = asObject(answer)->hasProperty(globalObject, vm.propertyNames->iteratorSymbol);
        RETURN_IF_EXCEPTION(scope, void());
        if (!hasIterator)
            return;
        makersOfIterators.append(key.isSymbol() ? JSValue(Symbol::create(vm, static_cast<SymbolImpl&>(*key.impl()))) : JSValue(jsString(vm, key.string())));
        makersOfIterators.append(descriptor.value());
    };
    // Reflect.ownKeys lists the symbols behind the strings.
    for (bool takesSymbols : { false, true }) {
        for (const Identifier& key : keys) {
            if (key.isSymbol() != takesSymbols)
                continue;
            callUnder(key);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), makersOfIterators)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDefineOwnPropertiesLeftOut, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    using namespace JSC;
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* target = callFrame->argument(0).getObject();
    JSObject* source = callFrame->argument(1).getObject();
    JSObject* replacements = callFrame->argument(2).getObject();
    if (!target || !source || (!replacements && !callFrame->argument(2).isUndefined()))
        return throwVMTypeError(globalObject, scope, "The target and the source must be objects, and the replacements an object or undefined"_s);

    PropertyNameArrayBuilder keys(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    source->methodTable()->getOwnPropertyNames(source, globalObject, keys, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, {});
    // Reflect.ownKeys lists the symbols behind the strings.
    for (bool takesSymbols : { false, true }) {
        for (const Identifier& key : keys) {
            if (key.isSymbol() != takesSymbols)
                continue;
            bool isOwned = target->hasOwnProperty(globalObject, key);
            RETURN_IF_EXCEPTION(scope, {});
            if (isOwned)
                continue;
            PropertyDescriptor descriptor;
            bool isOwn = source->getOwnPropertyDescriptor(globalObject, key, descriptor);
            RETURN_IF_EXCEPTION(scope, {});
            if (!isOwn)
                continue;
            if (replacements && descriptor.isDataDescriptor()) {
                PropertyDescriptor replacement;
                bool isReplaced = replacements->getOwnPropertyDescriptor(globalObject, key, replacement);
                RETURN_IF_EXCEPTION(scope, {});
                if (isReplaced && replacement.isDataDescriptor())
                    descriptor.setValue(replacement.value());
            }
            target->methodTable()->defineOwnProperty(target, globalObject, key, descriptor, false);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionPrepareHoldersBeforeLookupsUnder, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    using namespace JSC;
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue symbol = callFrame->argument(0);
    JSValue prepare = callFrame->argument(1);
    if (!symbol.isSymbol() || !prepare.isCallable())
        return throwVMTypeError(globalObject, scope, "The key must be a symbol, and what prepares its holders a function"_s);
    AOT::PropertyWalk::prepareHoldersBeforeLookupsUnder(globalObject, asSymbol(symbol), asObject(prepare));
    return JSValue::encode(jsUndefined());
}

}

#if ENABLE(AOT)

extern "C" BunLoaderType Bun__getDefaultLoader(JSC::JSGlobalObject*, const BunString* specifier, const BunString* typeAttribute);
extern "C" JSC::EncodedJSValue Blob__createEmptyJSONBodyError(JSC::JSGlobalObject*);
extern "C" bool Bun__compiledProgramRunsInPlace();
extern "C" bool Bun__compiledProgramHoldsFileAsItIs(const BunString*);
extern "C" bool Bun__AOT__isWorkerTextRefusedByTrimming(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__isStartOfWorker(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__isMainModule(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__isLoadedSynchronously(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__allowsCodeFromDisk();
extern "C" JSC::EncodedJSValue SYSV_ABI BunObject_getter_main(JSC::JSGlobalObject*);
extern "C" bool isBunTest;

static bool reloadsFilesFromDisk()
{
    return isBunTest && Bun__AOT__allowsCodeFromDisk();
}
extern "C" JSC::EncodedJSValue ResolveMessage__createModuleNotFound(JSC::JSGlobalObject*, const BunString* specifier, const BunString* referrer, bool isForRequire);
extern "C" BunString Bun__AOT__pathOfForm(const BunString* path, const BunString* typeAttribute, bool* isFormWithoutAttributes);
extern "C" BunString Bun__AOT__nodeModuleNamedWithoutPrefix(const BunString* name);
extern "C" BunString Bun__AOT__pathInExecutable(const BunString* path);
extern "C" uint64_t Bun__AOT__stampOfFile(const BunString* path);

namespace Bun {
using namespace JSC;

#if OS(WINDOWS)
static constexpr bool hostHasTwoSeparators = true;
#else
static constexpr bool hostHasTwoSeparators = false;
#endif

static std::optional<AOT::ModuleID> moduleThatAnswersToPath(const String& path)
{
    if (!hasCompiledModules())
        return std::nullopt;
    std::optional<AOT::ModuleID> found = AOT::findModule(path);
    if (found || !hostHasTwoSeparators)
        return found;
    // A file of an executable is `B:/~BUN/root/a.ts`, one that runs in place `C:\\a.ts`, and a program spells either with the other separator.
    if (path.contains('\\'))
        found = AOT::findModule(makeStringByReplacingAll(path, '\\', '/'));
    if (!found && path.contains('/'))
        found = AOT::findModule(makeStringByReplacingAll(path, '/', '\\'));
    return found;
}

// The executable holds no code of a module that is native code. Whoever asks for that module gets the one that the program imports.
std::optional<AOT::ModuleID> compiledModuleForPath(const String& path)
{
    auto module = moduleThatAnswersToPath(path);
    return module && AOT::isNativeModule(*module) ? std::nullopt : module;
}

bool isHiddenFromRequireCache(const String& key)
{
    auto module = compiledModuleForPath(key);
    return module && !AOT::mayHoldEntryOfProgramInRequireCache(*module);
}

// A mock stands under the names of the module wherever the program gets them from, and the program imports a module of native code from the image.
std::optional<AOT::ModuleID> moduleThatMockReplaces(const String& path)
{
    return moduleThatAnswersToPath(path);
}

static bool replacesNativeModule(JSGlobalObject* globalObject, const String& path)
{
    auto& plugins = uncheckedDowncast<Zig::GlobalObject>(globalObject)->onLoadPlugins;
    return plugins.hasVirtualModules() && plugins.virtualModules->contains(path);
}

static std::optional<AOT::ModuleID> moduleForRequest(Zig::GlobalObject* globalObject, const String& path, AOT::LoadByName way)
{
    auto module = moduleThatAnswersToPath(path);
    if (!module)
        return module;
    // What a mock has stored over an earlier require().
    if (way == AOT::LoadByName::Require && AOT::isInRequireCache(globalObject, *module))
        return module;
    // A module of native code is the host's own, whoever asks.
    bool isReplaced = AOT::isNativeModule(*module) ? replacesNativeModule(globalObject, path) : AOT::hostAnswersInPlaceOf(globalObject, *module, way);
    return isReplaced ? std::nullopt : module;
}

static std::optional<AOT::ModuleID> compiledModuleForRequest(Zig::GlobalObject* globalObject, const String& path, bool hasImportAttributes, AOT::LoadByName way)
{
    if (hasImportAttributes)
        return std::nullopt;
    auto module = moduleForRequest(globalObject, path, way);
    if (!module)
        return std::nullopt;
    BunString pathArgument = Bun::toString(path);
    auto startedBy = Bun__AOT__isMainModule(globalObject, &pathArgument) ? AOT::StartedBy::Host : AOT::StartedBy::Code;
    if (AOT::leavesModuleToHost(globalObject, *module, startedBy)) {
        AOT::willLoadCopyFromDisk(globalObject, *module, way);
        return std::nullopt;
    }
    return module;
}

static String typeAttributeOf(const ScriptFetchParameters& attributes)
{
    // What another attribute chooses, the path of a module does not say. The engine asks for a statement that the loader links with the type alone.
    if (attributes.attributes().size() > 1)
        return {};
    switch (attributes.type()) {
    case ScriptFetchParameters::Type::JSON:
        return "json"_s;
    case ScriptFetchParameters::Type::HostDefined:
        return attributes.hostDefinedImportType();
    default:
        return {};
    }
}

static std::optional<AOT::ModuleID> findModuleWithAttributes(JSGlobalObject* globalObject, const String& path, const ScriptFetchParameters& attributes)
{
    String type = typeAttributeOf(attributes);
    if (type.isNull())
        return std::nullopt;
    BunString pathArgument = Bun::toString(path);
    BunString typeArgument = Bun::toString(type);
    bool isFormWithoutAttributes = false;
    BunString pathOfForm = Bun__AOT__pathOfForm(&pathArgument, &typeArgument, &isFormWithoutAttributes);
    if (pathOfForm.isDead())
        return std::nullopt;
    std::optional<AOT::ModuleID> module = compiledModuleForPath(pathOfForm.transferToWTFString());
    if (!module && isFormWithoutAttributes)
        module = compiledModuleForPath(path);
    if (module && AOT::leavesModuleToHost(globalObject, *module))
        return std::nullopt;
    return module;
}

BUN_DECLARE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFactory);
BUN_DECLARE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFailedFactory);

static JSPromise* sourceAfterFactories(Zig::GlobalObject* globalObject, JSPromise* source, JSValue record)
{
    auto& vm = getVM(globalObject);
    auto& factories = globalObject->onLoadPlugins.factoriesOfCompiledMocks;
    JSPromise* last = factories.last().get();
    factories.removeLast();
    last->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionCompiledSourceAfterFactory), globalObject->thenable(jsFunctionCompiledSourceAfterFailedFactory), source, record);
    return source;
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFactory, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue record = callFrame->argument(1);
    if (globalObject->onLoadPlugins.factoriesOfCompiledMocks.isEmpty())
        return JSValue::encode(record);
    JSPromise* next = JSPromise::create(getVM(globalObject), globalObject->promiseStructure());
    return JSValue::encode(sourceAfterFactories(globalObject, next, record));
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFailedFactory, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    scope.throwException(globalObject, callFrame->argument(0));
    return {};
}

JSPromise* compiledModuleSource(Zig::GlobalObject* globalObject, const String& key, const ScriptFetchParameters* attributes)
{
    // `import data from "./data.json" with { type: "json" }` in a statement that the loader links, and in a compiled file: one module, so one object.
    auto module = attributes ? findModuleWithAttributes(globalObject, key, *attributes) : compiledModuleForRequest(globalObject, key, false, AOT::LoadByName::Import);
    if (!module)
        return nullptr;
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    AbstractModuleRecord* record = AOT::moduleRecord(globalObject, *module);
    RETURN_IF_EXCEPTION(scope, nullptr);
    AOT::runMocksBelow(globalObject, *module);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSPromise* source = JSPromise::create(vm, globalObject->promiseStructure());
    auto& factories = globalObject->onLoadPlugins.factoriesOfCompiledMocks;
    if (factories.isEmpty()) [[likely]] {
        source->fulfill(vm, record);
        return source;
    }
    // The loader of `bun run` waits for a factory before it goes on with the graph.
    return sourceAfterFactories(globalObject, source, record);
}

JSPromise* importCompiledModule(Zig::GlobalObject* globalObject, const String& key, const ScriptFetchParameters* attributes, int64_t referrerAsyncOrder)
{
    auto module = attributes ? findModuleWithAttributes(globalObject, key, *attributes) : compiledModuleForRequest(globalObject, key, false, AOT::LoadByName::Import);
    if (!module)
        return nullptr;
    return AOT::importModule(globalObject, *module, referrerAsyncOrder < 0 ? std::nullopt : std::optional(referrerAsyncOrder));
}

static std::optional<AOT::ModuleID> compiledModuleOf(JSCommonJSModule* module)
{
    if (module->compiledModule == JSCommonJSModule::noCompiledModule)
        return std::nullopt;
    return AOT::ModuleID(module->compiledModule);
}

static void requireInto(Zig::GlobalObject* globalObject, JSCommonJSModule* target, AOT::ModuleID module, std::optional<AOT::ModuleID> referrer = std::nullopt)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue exports = AOT::requireModule(globalObject, module, referrer);
    RETURN_IF_EXCEPTION(scope, void());
    target->setExportsObject(exports);
}

// `bun run` reads a file of a kind that nothing names, `a.png`, as code for require(), and an import of it gets its path. What an import has loaded answers a later require().
// The image has the code where the program names the file in a require(). The loader reads any other file.
static bool isReadAsCodeByRequire(Zig::GlobalObject* globalObject, AOT::ModuleID module, const String& path)
{
    if (!reloadsFilesFromDisk() || !AOT::isDataFile(module))
        return false;
    BunString pathString = Bun::toString(path);
    return Bun__getDefaultLoader(globalObject, &pathString, nullptr) == BunLoaderTypeJS && !AOT::isHeldForImport(globalObject, module);
}

bool requireCompiledModule(Zig::GlobalObject* globalObject, JSCommonJSModule* target, const String& path, bool hasImportAttributes)
{
    auto module = compiledModuleForRequest(globalObject, path, hasImportAttributes, AOT::LoadByName::Require);
    if (module && isReadAsCodeByRequire(globalObject, *module, path))
        module = compiledModuleForRequest(globalObject, makeString(path, "?ts"_s), hasImportAttributes, AOT::LoadByName::Require);
    if (!module)
        return false;
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSCommonJSModule* requirer = target->m_parent.get();
    // `target` is the object that require() under a computed name has made to load the file into.
    auto referrer = requirer ? compiledModuleOf(requirer) : std::nullopt;
    // The engine says whose child the file is.
    if (referrer)
        target->compiledModule = module->index();
    if (requirer)
        AOT::willRequireModule(globalObject, *module, referrer, requirer);
    JSString* key = jsString(vm, path);
    if (reloadsFilesFromDisk()) {
        if (AOT::isESModule(*module))
            AOT::didMakeModuleObjectForRequire(globalObject, *module, target);
        else
            globalObject->requireMap()->remove(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
    }
    requireInto(globalObject, target, *module, referrer);
    RETURN_IF_EXCEPTION(scope, false);
    if (referrer) {
        AOT::didRequireModule(globalObject, *module, *referrer);
        RETURN_IF_EXCEPTION(scope, false);
    }
    // A module of the executable is in no cache. The next require() of the name asks the engine again, which answers what the module exports then.
    JSValue held = globalObject->requireMap()->get(globalObject, key);
    RETURN_IF_EXCEPTION(scope, false);
    if (held == target) {
        globalObject->requireMap()->remove(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
    }
    return true;
}

JSObject* loaderOfCompiledESModule(Zig::GlobalObject* globalObject, const String& path, bool hasImportAttributes)
{
    auto module = compiledModuleForRequest(globalObject, path, hasImportAttributes, AOT::LoadByName::Require);
    if (!module || !AOT::isESModule(*module))
        return nullptr;
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue loader = globalObject->get(globalObject, WebCore::builtinNames(vm).esmLoadSyncPrivateName());
    RETURN_IF_EXCEPTION(scope, nullptr);
    return loader.getObject();
}

JSValue loadCompiledModuleNamespace(Zig::GlobalObject* globalObject, const String& path)
{
    auto module = moduleForRequest(globalObject, path, AOT::LoadByName::Require);
    if (!module || AOT::leavesModuleToHost(globalObject, *module))
        return {};
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    AOT::evaluateModuleSynchronously(globalObject, *module);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, AOT::moduleNamespace(globalObject, *module));
}

bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject* globalObject, JSCommonJSModule* target, const String& path, bool isTypeScriptLoader)
{
    if (!hasCompiledModules() || target->moduleGraph() || target->m_overriddenCompile) [[likely]]
        return false;
    auto module = compiledModuleForPath(path);
    // The run time has sent the call here for such a file: it would only send it here again.
    if (!module || AOT::leavesModuleToHost(globalObject, *module))
        return false;
    BunString pathString = Bun::toString(path);
    auto loader = Bun__getDefaultLoader(globalObject, &pathString, nullptr);
    bool isTypeScriptFile = loader == BunLoaderTypeTS || loader == BunLoaderTypeTSX;
    if (isTypeScriptFile != isTypeScriptLoader)
        return false;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    requireInto(globalObject, target, *module);
    RETURN_IF_EXCEPTION(scope, false);
    target->hasEvaluated = true;
    return true;
}

void didDeleteRequireCacheEntry(Zig::GlobalObject* globalObject, const String& key)
{
    if (!reloadsFilesFromDisk()) {
        if (auto module = AOT::findLibraryModuleInRequireCache(globalObject, key))
            AOT::didDeleteRequireCacheEntry(globalObject, *module);
        return;
    }
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (auto module = moduleThatAnswersToPath(key)) {
        AOT::didDeleteRequireCacheEntry(globalObject, *module);
        RETURN_IF_EXCEPTION(scope, );
    }
    // `import("./a", { with: { type: "text" } })`: the image holds the file once for each type that is asked for, and the cache knows it by its path.
    for (AOT::ModuleID form : AOT::formsThatAttributesAskFor(globalObject, key)) {
        AOT::didDeleteRequireCacheEntry(globalObject, form);
        RETURN_IF_EXCEPTION(scope, );
    }
}

bool requireCacheListsCompiledFiles(Zig::GlobalObject*)
{
    return reloadsFilesFromDisk();
}

bool isLibraryModuleInRequireCache(Zig::GlobalObject* globalObject, const String& key)
{
    return hasCompiledModules() && AOT::findLibraryModuleInRequireCache(globalObject, key);
}

bool isEvaluatedCompiledFile(Zig::GlobalObject* globalObject, const String& key)
{
    if (isLibraryModuleInRequireCache(globalObject, key))
        return true;
    if (!reloadsFilesFromDisk())
        return false;
    auto module = compiledModuleForPath(key);
    return module && AOT::isEvaluatedFile(globalObject, *module);
}

JSValue compiledRequireCacheEntry(Zig::GlobalObject* globalObject, const String& key)
{
    if (auto module = AOT::findLibraryModuleInRequireCache(globalObject, key))
        return AOT::requireCacheEntry(globalObject, *module);
    if (!isEvaluatedCompiledFile(globalObject, key))
        return {};
    return AOT::requireCacheEntry(globalObject, *compiledModuleForPath(key));
}

bool isRecordOfCompiledModule(AbstractModuleRecord* record)
{
    return AOT::isCompiledModuleRecord(record);
}

void forEachEvaluatedCompiledFile(Zig::GlobalObject* globalObject, const WTF::Function<void(const String&)>& functor)
{
    if (!hasCompiledModules())
        return;
    if (reloadsFilesFromDisk())
        AOT::forEachEvaluatedFile(globalObject, functor);
    AOT::forEachLibraryModuleInRequireCache(globalObject, functor);
}

// `require.cache[name] = { exports: fake }`, where `name` turns out to be "fs": overridableRequire() would answer require("fs") with the entry.
static void willSetRequireCacheEntryUnderNameOfNodeModule(Zig::GlobalObject* globalObject, const String& name)
{
    BunString nameArgument = Bun::toString(name);
    BunString path = Bun__AOT__nodeModuleNamedWithoutPrefix(&nameArgument);
    if (path.isDead())
        return;
    if (auto module = moduleThatAnswersToPath(path.transferToWTFString()))
        AOT::willSetRequireCacheEntryUnderName(globalObject, *module, name);
}

void willSetRequireCacheEntry(Zig::GlobalObject* globalObject, const String& key, JSValue entry)
{
    auto module = compiledModuleForPath(key);
    if (!module) {
        if (entry.toBoolean(globalObject))
            willSetRequireCacheEntryUnderNameOfNodeModule(globalObject, key);
        return;
    }
    // `require.cache[path] = undefined`: overridableRequire() goes by an entry that is truthy.
    if (!entry.toBoolean(globalObject)) {
        if (reloadsFilesFromDisk())
            AOT::willClearRequireCacheEntry(globalObject, *module);
        return;
    }
    // `require.cache[path] = { exports: fake }`: how a test puts something of its own in place of a CommonJS file.
    if (reloadsFilesFromDisk())
        return AOT::willReplaceRequireCacheEntry(globalObject, *module);
    AOT::willSetRequireCacheEntry(globalObject, *module, entry);
}

void willStoreLoaderOfExtension(Zig::GlobalObject* globalObject, StringView extension)
{
    // How a test has a file of its own kind loaded, or looks at what the files of a kind hold. Elsewhere imports are bound for good: the loader is stored,
    // and only a file that is read from disk as the program runs is handed to it, as in an executable of `bun build --compile`.
    if (hasCompiledModules() && reloadsFilesFromDisk())
        AOT::willStoreLoaderOfExtension(globalObject, extension);
}

static JSCommonJSModule* boundModuleOf(JSValue require)
{
    auto* bound = dynamicDowncast<JSBoundFunction>(require);
    return bound ? dynamicDowncast<JSCommonJSModule>(bound->boundThis()) : nullptr;
}

static bool isRequireFunctionOf(Zig::GlobalObject* globalObject, JSCommonJSModule* module, JSValue function)
{
    return boundModuleOf(function) == module && uncheckedDowncast<JSBoundFunction>(function)->targetFunction() == globalObject->requireFunctionUnbound();
}

static JSCell* resolveFunctionOf(JSGlobalObject* realm, JSObject* requirer, JSCell* heldOrNull)
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(realm);
    auto& vm = getVM(globalObject);
    JSObject* unbound = globalObject->requireResolveFunctionUnbound();
    auto* held = heldOrNull ? dynamicDowncast<JSBoundFunction>(heldOrNull) : nullptr;
    if (held && held->targetFunction() == unbound && held->boundThis() == JSValue(requirer) && !held->boundArgsLength())
        return held;
    return JSBoundFunction::create(vm, globalObject, unbound, requirer, ArgList(), 1, Bun::commonStrings(vm).resolveString(), makeSource("resolve"_s, SourceOrigin(), SourceTaintedOrigin::Untainted));
}

// As without compiled modules, evaluating a module replaces whatever the program stored in `module.require`.
static JSObject* attachRequireFunction(VM& vm, Zig::GlobalObject* globalObject, JSCommonJSModule* module, JSString* path)
{
    const Identifier& requireName = WebCore::clientData(vm)->builtinNames().requirePublicName();
    JSValue ownRequire = module->getDirect(vm, requireName);
    if (ownRequire && isRequireFunctionOf(globalObject, module, ownRequire))
        return asObject(ownRequire);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String pathText = path->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSObject* require = JSCommonJSModule::createBoundRequireFunction(vm, globalObject, pathText, nullptr, module);
    RETURN_IF_EXCEPTION(scope, nullptr);
    module->putDirect(vm, requireName, require, 0);
    return require;
}

// `module.exports` of a file of the executable is a variable of the program, which its code reads and stores without the module object.
JSC_DEFINE_CUSTOM_GETTER(getterExportsOfCompiledModule, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName))
{
    auto* module = dynamicDowncast<JSCommonJSModule>(JSValue::decode(thisValue));
    auto compiled = module ? compiledModuleOf(module) : std::nullopt;
    if (!compiled) [[unlikely]]
        return JSValue::encode(jsUndefined());
    return JSValue::encode(AOT::moduleExports(module->globalObject(), *compiled));
}

JSC_DEFINE_CUSTOM_SETTER(setterExportsOfCompiledModule, (JSGlobalObject*, EncodedJSValue thisValue, EncodedJSValue value, PropertyName))
{
    auto* module = dynamicDowncast<JSCommonJSModule>(JSValue::decode(thisValue));
    auto compiled = module ? compiledModuleOf(module) : std::nullopt;
    if (!compiled) [[unlikely]]
        return false;
    AOT::setModuleExports(module->globalObject(), *compiled, JSValue::decode(value));
    return true;
}

static void createModuleObject(JSGlobalObject* realm, JSString* path, AOT::ModuleID compiled, OptionSet<AOT::ModuleObjectTrait> traits, AOT::ModuleObjects& out)
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(realm);
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // putDirectCustomAccessor() is for a name that the object does not have yet.
    JSValue exportsAsData = traits.contains(AOT::ModuleObjectTrait::HasExportsVariable) ? JSValue() : jsUndefined();
    JSCommonJSModule* module = JSCommonJSModule::create(globalObject, path, exportsAsData, !traits.contains(AOT::ModuleObjectTrait::IsESModule), JSValue());
    RETURN_IF_EXCEPTION(scope, void());
    module->compiledModule = compiled.index();
    if (traits.contains(AOT::ModuleObjectTrait::IsMain))
        module->m_id.set(vm, module, jsString(vm, String("."_s)));
    if (traits.contains(AOT::ModuleObjectTrait::HasExportsVariable)) {
        auto* accessors = CustomGetterSetter::create(vm, getterExportsOfCompiledModule, setterExportsOfCompiledModule);
        module->putDirectCustomAccessor(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), accessors, PropertyAttribute::CustomValue | 0);
    }
    out.module = module;
    if (traits.contains(AOT::ModuleObjectTrait::IsNoCommonJSFile))
        return;
    scope.release();
    out.require = attachRequireFunction(vm, globalObject, module, path);
}

static void createRequirer(JSGlobalObject* realm, JSObject* importMeta, AOT::ModuleObjects& out)
{
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* meta = uncheckedDowncast<Zig::ImportMetaObject>(importMeta);
    out.require = meta->requireProperty.getInitializedOnMainThread(meta);
    RETURN_IF_EXCEPTION(scope, void());
    out.module = boundModuleOf(out.require);
    if (out.module) [[likely]]
        return;

    // The program replaced import.meta.require with a value that is not bound to a module object.
    String path = meta->pathProperty.getInitializedOnMainThread(meta)->value(realm);
    RETURN_IF_EXCEPTION(scope, void());
    JSObject* ownRequire = JSCommonJSModule::createBoundRequireFunction(vm, realm, path, meta->moduleGraph());
    RETURN_IF_EXCEPTION(scope, void());
    out.module = boundModuleOf(ownRequire);
}

static void pushObservableChild(JSGlobalObject* realm, JSObject* parent, JSObject* child)
{
    auto& vm = getVM(realm);
    JSFunction* function = JSFunction::create(vm, realm, WebCore::commonJSPushObservableChildCodeGenerator(vm), realm);
    MarkedArgumentBuffer arguments;
    arguments.append(uncheckedDowncast<JSCommonJSModule>(parent)->m_childrenValue.get());
    arguments.append(child);
    call(realm, function, getCallData(function), jsUndefined(), arguments);
}

bool appendNewChildrenOfCompiledModule(JSGlobalObject* realm, JSCommonJSModule* parent)
{
    auto compiled = compiledModuleOf(parent);
    if (!compiled)
        return true;
    auto& vm = getVM(realm);
    return AOT::forEachNewChild(parent->globalObject(), *compiled, [&](JSObject* child) {
        if (parent->m_childrenValue) {
            pushObservableChild(realm, parent, child);
            return;
        }
        WTF::Locker locker { parent->cellLock() };
        parent->m_children.append(WriteBarrier<Unknown>());
        parent->m_children.last().set(vm, parent, child);
    });
}

static void showChildren(JSGlobalObject* realm, JSObject* module, JSObject* requiredAgain)
{
    auto* parent = dynamicDowncast<JSCommonJSModule>(module);
    // A list that no code has seen is put together when it is first read.
    if (!parent || !parent->m_childrenValue)
        return;
    if (requiredAgain)
        pushObservableChild(realm, parent, requiredAgain);
    else
        appendNewChildrenOfCompiledModule(realm, parent);
}

JSCommonJSModule* parentOfCompiledModule(JSCommonJSModule* module)
{
    auto compiled = compiledModuleOf(module);
    JSObject* parent = compiled ? AOT::parentModuleObject(module->globalObject(), *compiled) : nullptr;
    return parent ? dynamicDowncast<JSCommonJSModule>(parent) : nullptr;
}

String pathInExecutable(const String& path)
{
    BunString pathArgument = Bun::toString(path);
    BunString known = Bun__AOT__pathInExecutable(&pathArgument);
    return known.isDead() ? String() : known.transferToWTFString();
}

JSValue mainModuleOfExecutable(Zig::GlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue main = JSValue::decode(BunObject_getter_main(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    if (main.isString()) {
        String path = asString(main)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        // `Bun.main = require.resolve("./other.cjs")` stores where the file lay when the program was built.
        if (String known = pathInExecutable(path); !known.isNull())
            path = known;
        if (auto module = compiledModuleForRequest(globalObject, path, false, AOT::LoadByName::Require)) {
            JSObject* moduleObject = AOT::mainModuleObject(globalObject, *module);
            RETURN_IF_EXCEPTION(scope, {});
            return moduleObject ? JSValue(moduleObject) : jsUndefined();
        }
    }
    RELEASE_AND_RETURN(scope, globalObject->requireMap()->get(globalObject, main));
}

void willStorePathOfMainModule(Zig::GlobalObject* globalObject, JSValue path)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue main = JSValue::decode(BunObject_getter_main(globalObject));
    RETURN_IF_EXCEPTION(scope, void());
    bool isStoredAlready = JSValue::strictEqual(globalObject, main, path);
    RETURN_IF_EXCEPTION(scope, void());
    if (!isStoredAlready)
        RELEASE_AND_RETURN(scope, AOT::willStorePathOfMainModule(globalObject));
}

static JSValue requireSpecifier(JSGlobalObject* realm, JSObject* requirer, JSValue specifier)
{
    auto& vm = getVM(realm);
    JSValue function = realm->getDirect(vm, WebCore::builtinNames(vm).overridableRequirePrivateName());
    MarkedArgumentBuffer arguments;
    arguments.append(specifier);
    return call(realm, function, requirer, arguments, "Module.prototype.require is not a function"_s);
}

static JSValue resolveSpecifier(JSGlobalObject* realm, JSObject* holder, JSValue specifier, AOT::ResolvedSpecifierForm form)
{
    JSObject* function = nullptr;
    switch (form) {
    case AOT::ResolvedSpecifierForm::PathForRequire: {
        auto& vm = getVM(realm);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue from = holder->get(realm, WebCore::builtinNames(vm).filenamePublicName());
        RETURN_IF_EXCEPTION(scope, {});
        JSValue resolved = JSValue::decode(Bun__resolveSync(realm, JSValue::encode(specifier), JSValue::encode(from), false, false));
        RETURN_IF_EXCEPTION(scope, {});
        if (!resolved.isString()) {
            throwException(realm, scope, resolved);
            return {};
        }
        return resolved;
    }
    case AOT::ResolvedSpecifierForm::Path:
        function = uncheckedDowncast<Zig::GlobalObject>(realm)->requireResolveFunctionUnbound();
        break;
    case AOT::ResolvedSpecifierForm::URL:
        function = JSFunction::create(getVM(realm), realm, 1, "resolve"_s, Zig::functionImportMeta__resolve, ImplementationVisibility::Public);
        break;
    }
    MarkedArgumentBuffer arguments;
    arguments.append(specifier);
    return call(realm, function, getCallData(function), holder, arguments);
}

static JSObject* captureRuntimeModuleExports(JSGlobalObject* globalObject, JSValue value, Vector<Identifier, 4>& names, MarkedArgumentBuffer& values)
{
    if (JSObject* object = value.getObject())
        return appendInternalModuleExports(uncheckedDowncast<Zig::GlobalObject>(globalObject), object, names, values);
    names.append(getVM(globalObject).propertyNames->defaultKeyword);
    values.append(value);
    return nullptr;
}

static JSObject* captureSyntheticExports(JSGlobalObject* globalObject, AOT::SyntheticExportRule rule, JSValue value, Vector<Identifier, 4>& names, MarkedArgumentBuffer& values)
{
    switch (rule) {
    case AOT::SyntheticExportRule::CommonJs:
    case AOT::SyntheticExportRule::CommonJsIgnoringAnnotation:
        populateESMExports(globalObject, value, names, values, rule == AOT::SyntheticExportRule::CommonJsIgnoringAnnotation);
        return nullptr;
    case AOT::SyntheticExportRule::RuntimeModule:
        return captureRuntimeModuleExports(globalObject, value, names, values);
    case AOT::SyntheticExportRule::None:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

static JSValue requireNativeModule(JSGlobalObject* realm, JSString* specifier)
{
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String text = specifier->value(realm);
    RETURN_IF_EXCEPTION(scope, {});
    BunString name = Bun::toString(text);
    JSValue exports = resolveAndFetchBuiltinModule(uncheckedDowncast<Zig::GlobalObject>(realm), &name);
    RETURN_IF_EXCEPTION(scope, {});
    if (exports)
        return exports;

    // The name of a built-in module resolves to itself from every file.
    JSObject* require = JSCommonJSModule::createBoundRequireFunction(vm, realm, text, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, requireSpecifier(realm, boundModuleOf(require), specifier));
}

static JSObject* captureNativeModuleExports(JSGlobalObject* realm, uint32_t registryID, Vector<Identifier, 4>& names, MarkedArgumentBuffer& values)
{
    return appendNativeModuleExports(uncheckedDowncast<Zig::GlobalObject>(realm), registryID, names, values);
}

static JSObject* requireCache(JSGlobalObject* realm)
{
    return uncheckedDowncast<Zig::GlobalObject>(realm)->lazyRequireCacheObject();
}

static JSObject* requireExtensions(JSGlobalObject* realm)
{
    return uncheckedDowncast<Zig::GlobalObject>(realm)->lazyRequireExtensionsObject();
}

static JSObject* requirePrototype(JSGlobalObject* realm)
{
    return uncheckedDowncast<Zig::GlobalObject>(realm)->requireFunctionUnbound()->getPrototypeDirect().getObject();
}

static JSObject* createEmptyJSONBodyError(JSGlobalObject* realm)
{
    return asObject(JSValue::decode(Blob__createEmptyJSONBodyError(realm)));
}

static thread_local bool isAskingWhyFileFails = false;

bool isAskingWhyFileFailsToLoad()
{
    return isAskingWhyFileFails;
}

// The file is read and parsed as `require` reads it, and nothing of it runs.
static JSValue createLoadError(JSGlobalObject* realm, const String& path)
{
    BunString specifier = Bun::toString(path);
    // The name of a built-in module is not a path. Reading one that the executable does not hold fails as under `bun run`.
    // An executable holds a file that the build could not take as it is: what is wrong with it is for its loader to say.
    if (!Bun__compiledProgramRunsInPlace() && isAbsolutePath(path) && !Bun__compiledProgramHoldsFileAsItIs(&specifier))
        return {};
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(realm);
    ErrorableResolvedSource source;
    SetForScope isAsking(isAskingWhyFileFails, true);
    Bun__transpileFile(globalObject->bunVM(), globalObject, &specifier, &specifier, nullptr, &source, false, true, BunLoaderTypeNone);
    if (!source.success)
        return JSValue::decode(source.result.err);
    // The text of a JSON file goes through the parser of the engine next, as where the loader reads it. What that throws stays thrown.
    if (source.result.value.tag == SyntheticModuleType::JSONForObjectLoader) {
        auto scope = DECLARE_THROW_SCOPE(realm->vm());
        JSC::JSONParseWithException(realm, source.result.value.source_code.toWTFString(BunString::NonNull));
        RELEASE_AND_RETURN(scope, JSValue());
    }
    return {};
}

static JSValue createModuleNotFoundError(JSGlobalObject* realm, const String& specifier, const String& importer, bool isForRequire)
{
    // `bun run` names the importer by the path of its source URL: "/data:.." for the code of a Worker made from a data: URL.
    String importerPath = isAbsolutePath(importer) ? importer : URL::fileURLWithFileSystemPath(importer).fileSystemPath();
    BunString specifierString = Bun::toString(specifier);
    BunString referrer = Bun::toString(importerPath);
    return JSValue::decode(ResolveMessage__createModuleNotFound(realm, &specifierString, &referrer, isForRequire));
}

static bool hasQueuedTicks(JSGlobalObject* globalObject)
{
    auto* queue = defaultGlobalObject(globalObject)->m_nextTickQueue.get();
    return queue && !queue->isEmpty();
}

static void runMock(JSGlobalObject* globalObject, AOT::ModuleID module)
{
    Zig::runCompiledMock(uncheckedDowncast<Zig::GlobalObject>(globalObject), module);
}

static bool loadsSynchronously(JSGlobalObject* globalObject, AOT::ModuleID module)
{
    String path = AOT::modulePath(module);
    BunString pathArgument = Bun::toString(path);
    return Bun__AOT__isLoadedSynchronously(globalObject, &pathArgument);
}

static void callInLaterTurn(JSGlobalObject* globalObject)
{
    defaultGlobalObject(globalObject)->scriptExecutionContext()->postTask([](WebCore::ScriptExecutionContext& context) {
        AOT::deliverTextThatWaits(context.vm());
    });
}

static uint64_t stampOfFile(const String& path)
{
    BunString pathArgument = Bun::toString(path);
    return Bun__AOT__stampOfFile(&pathArgument);
}

const AOT::ModuleHost compiledModuleHost = {
    &createModuleObject,
    &createRequirer,
    &requireSpecifier,
    &resolveSpecifier,
    &captureSyntheticExports,
    &requireNativeModule,
    &captureNativeModuleExports,
    &requireCache,
    &requireExtensions,
    &createAsyncModuleRequiredError,
    &createEmptyJSONBodyError,
    &createLoadError,
    &showChildren,
    &findModuleWithAttributes,
    &resolveFunctionOf,
    &replacesNativeModule,
    &hasQueuedTicks,
    &isImportOfMainModule,
    &runMainModule,
    &createModuleNotFoundError,
    &requirePrototype,
    &runMock,
    &loadsSynchronously,
    &callInLaterTurn,
    &stampOfFile,
};

JSValue createNotInExecutableError(JSGlobalObject* globalObject, ErrorCode code, const String& path, NotInExecutable what)
{
    // --disallow-code-generation-from-strings=strict refuses code from the disk in an executable built without --aot too. Whoever set the flag expects its error.
    if (what == NotInExecutable::Code && isCodeGenerationFromStringsStrictByFlags())
        return createCodeGenerationFromStringsError(globalObject);
    BunString text = Bun::toString(path);
    // A Worker runs text apart from the compiled program, and with --aot-allow-code-from-disk a file too.
    if (what == NotInExecutable::Code && (isDataOrBlobURL(path) || Bun__AOT__allowsCodeFromDisk())) {
        if (Bun__AOT__isWorkerTextRefusedByTrimming(globalObject, &text))
            return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it isn't in this executable, and --trim removed what a Worker needs to run code that wasn't compiled into it. Build without --trim."_s));
    }
    // The flag acts on the file that a Worker starts from, and where the compiler found an import() or a require() of a path that it does not know.
    const AOT::Image* image = AOT::Image::current();
    // --trim removed what such a Worker runs on: the flag would only lead to the refusal above.
    bool startsWorker = !isDataOrBlobURL(path) && !Bun__AOT__allowsCodeFromDisk() && Bun__AOT__isStartOfWorker(globalObject, &text) && !Bun__AOT__isWorkerTextRefusedByTrimming(globalObject, &text);
    bool flagWouldHelp = !image || image->findsDataFilesByName() || startsWorker;
    // `bun test --aot` makes no executable and takes no entry points.
    if (compiledModulesRunInPlaceOfFiles())
        return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it wasn't compiled with the program, and --aot only runs code that was. Import the file by a constant path"_s, flagWouldHelp ? ", or add --aot-allow-code-from-disk."_s : "."_s));
    return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it isn't in this executable, which only runs code that was compiled into it. Pass the file to bun compile as another entry point"_s, flagWouldHelp ? ", or build with --aot-allow-code-from-disk."_s : "."_s));
}

JSValue errorIfCodeOutsideImageIsRefused(JSGlobalObject* globalObject, ErrorCode code, const String& path)
{
    if (!hasCompiledModules() || isAskingWhyFileFails)
        return {};
    bool refusesCode = AOT::refusesCodeOutsideImage(globalObject, path);
    // An executable does not hold the text of a compiled module.
    if (isCompiledModule(path) && (refusesCode || !compiledModulesRunInPlaceOfFiles()))
        return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it's compiled into this executable, and a compiled module can't be loaded a second time (for example into a Bun.ModuleGraph)."_s));
    if (!refusesCode)
        return {};
    return createNotInExecutableError(globalObject, code, path);
}

JSValue errorIfHostObjectOutsideImageIsRefused(JSGlobalObject* globalObject, ErrorCode code, const String& path)
{
    if (!hasCompiledModules() || !AOT::refusesHostObjectsOutsideImage(globalObject))
        return {};
    return createNotInExecutableError(globalObject, code, path, NotInExecutable::HostObject);
}

JSValue parentSeenBy(Zig::GlobalObject* globalObject, JSString* id, JSValue parent)
{
    if (!hasCompiledModules()) [[likely]]
        return parent;
    auto* requirer = dynamicDowncast<JSCommonJSModule>(parent);
    if (!requirer || !requirer->filename().isString())
        return parent;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSString* pathOfRequirer = asString(requirer->filename());
    auto path = pathOfRequirer->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto required = id->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isCompiledModule(path) || isCompiledModule(required))
        return parent;
    RELEASE_AND_RETURN(scope, JSCommonJSModule::create(globalObject, pathOfRequirer, constructEmptyObject(globalObject), true, jsUndefined()));
}

static JSObject* createCodeNotCompiledError(JSGlobalObject* globalObject, const String& message)
{
    auto& vm = getVM(globalObject);
    JSObject* error = JSC::createError(globalObject, message);
    Bun::putDirectNamed(vm, error, "code"_s, jsString(vm, String("ERR_CODE_NOT_COMPILED"_s)));
    return error;
}

JSValue errorIfUnseenCodeIsRefused(JSGlobalObject* globalObject, ASCIILiteral builtin)
{
    const AOT::Image* image = AOT::Image::current();
    if (!image || image->admitsUnknownJavaScript()) [[likely]]
        return {};
    return createCodeNotCompiledError(globalObject, makeString("Cannot use "_s, builtin, ": this executable only runs code that was compiled into it."_s));
}

bool isDebuggerAdmitted()
{
    const AOT::Image* image = AOT::Image::current();
    return !image || AOT::hasFlag(image->header().options.admitted(), AOT::AdmittedCode::Inspector);
}

JSValue errorIfDebuggerIsRefused(JSGlobalObject* globalObject, ASCIILiteral builtin)
{
    if (isDebuggerAdmitted()) [[likely]]
        return {};
    return createCodeNotCompiledError(globalObject, makeString("Cannot use "_s, builtin, ": rebuild this executable with --compile-inspector."_s));
}

bool compiledProgramRunsInSeveralRealmsAtOnce()
{
    const AOT::Image* image = AOT::Image::current();
    return image && (image->first().programTables().flags & AOT::ProgramTables::mayRunInMultipleInstances);
}

bool compiledModulesRunInPlaceOfFiles()
{
    return hasCompiledModules() && Bun__compiledProgramRunsInPlace();
}

String firstCompiledModuleMatching(JSGlobalObject* globalObject, RegExp* filter)
{
    if (!compiledModulesRunInPlaceOfFiles())
        return {};
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    String found;
    AOT::forEachModule([&](AOT::ModuleID module) {
        // `import("./a.custom")` beside `require("./a.custom")`: the image has the file in two forms, one of them under the path, a question mark and the name of the form. The plugin is asked for the file.
        String path = AOT::pathOfFileOfModule(module);
        auto matchResult = filter->match(globalObject, path, 0);
        RETURN_IF_EXCEPTION(scope, IterationStatus::Done);
        if (!matchResult)
            return IterationStatus::Continue;
        if (reloadsFilesFromDisk() && AOT::willLoadFileInAnotherWay(globalObject, module))
            return IterationStatus::Continue;
        found = WTF::move(path);
        return IterationStatus::Done;
    });
    return found;
}

}

extern "C" bool Bun__refusesCodeOutsideExecutable(JSC::JSGlobalObject* globalObject)
{
    return Bun::hasCompiledModules() && JSC::AOT::refusesCodeOutsideImage(globalObject, {});
}

extern "C" bool Bun__isCompiledProgramFile(const BunString* path)
{
    return Bun::isCompiledModule(path->toWTFString(BunString::ZeroCopy));
}

extern "C" void Bun__AOT__willRunEntryPointAgain(JSC::JSGlobalObject* globalObject, const BunString* path)
{
    if (auto module = Bun::compiledModuleForPath(path->toWTFString(BunString::ZeroCopy)))
        JSC::AOT::willRunEntryPointAgain(globalObject, *module);
}

extern "C" bool Bun__isCompiledProgramFileInSomeForm(const BunString* path)
{
    String file = path->toWTFString(BunString::ZeroCopy);
    return Bun::isCompiledModule(file) || (Bun::hasCompiledModules() && JSC::AOT::holdsFormThatAttributeAsksFor(file));
}

extern "C" bool Bun__AOT__mayHoldPathStartingWith(const BunString* start)
{
    return JSC::AOT::mayHoldPathStartingWith(start->toWTFString(BunString::ZeroCopy));
}

extern "C" bool Bun__AOT__isLeftToCodeOutsideImage(const BunString* specifier, const BunString* directoryOfImporter)
{
    return JSC::AOT::isLeftToCodeOutsideImage(specifier->toWTFString(BunString::ZeroCopy), directoryOfImporter->toWTFString(BunString::ZeroCopy));
}

// Start-up reads its options before the image is in use.
extern "C" bool Bun__AOT__omitsFunctionSource(BunAOTBytes image)
{
    std::span<const uint8_t> bytes { image.ptr, image.len };
    if (!JSC::AOT::Image::flags(bytes))
        return false;
    return reinterpret_cast<const JSC::AOT::ImageHeader*>(bytes.data())->options.omitsFunctionSource;
}

extern "C" bool Bun__AOT__tryReservePagesForNewThread(void** pages, bool threadsAreEnding)
{
    JSC::AOT::PagesForNewThread result = JSC::AOT::tryReservePagesForNewThread(threadsAreEnding);
    *pages = result.pages;
    return !result.isRefused;
}

extern "C" void Bun__AOT__releasePagesForNewThread(void* pages) { JSC::AOT::releasePagesForNewThread(pages); }
extern "C" void Bun__AOT__adoptPagesForNewThread(void* pages) { JSC::AOT::adoptPagesForNewThread(pages); }
extern "C" void Bun__AOT__releaseUnusedPagesOfThread() { JSC::AOT::releaseUnusedPagesOfThread(); }
extern "C" void Bun__AOT__didStartThread() { JSC::AOT::didStartThread(nullptr); }

extern "C" bool Bun__AOT__entryPointIsCommonJS(JSC::JSGlobalObject* globalObject)
{
    return JSC::AOT::entryPointIsCommonJS(globalObject);
}

// `each` answers false to end the walk. Any thread may ask.
extern "C" void Bun__AOT__forEachFilePathStartingWith(BunAOTBytes start, void* context, bool (*each)(void* context, BunAOTBytes path))
{
    String startOfPath = String::fromUTF8(std::span<const uint8_t> { start.ptr, start.len });
    JSC::AOT::forEachFilePathStartingWith(startOfPath, [&](const String& path) {
        CString bytes = path.utf8();
        return each(context, BunAOTBytes { byteCast<uint8_t>(bytes.span().data()), bytes.length() }) ? IterationStatus::Continue : IterationStatus::Done;
    });
}

// For `bun test --aot --coverage`, on the thread of the VM.
extern "C" void Bun__AOT__forEachCountedFile(JSC::VM* vm, void* context, void (*each)(void* context, BunAOTBytes description, const uint64_t* counts, size_t count))
{
    JSC::AOT::forEachCountedFile(*vm, [&](const String& description, std::span<const uint64_t> counts) {
        CString bytes = description.utf8();
        each(context, BunAOTBytes { byteCast<uint8_t>(bytes.span().data()), bytes.length() }, counts.data(), counts.size());
    });
}

// For `bun test --aot` over several programs, on the thread of the VM.
extern "C" void Bun__AOT__forEachFirstLoad(JSC::VM* vm, void* context, void (*each)(void* context, BunAOTBytes path, bool wasSynchronous))
{
    JSC::AOT::forEachFirstLoad(*vm, [&](const String& path, bool wasSynchronous) {
        CString bytes = path.utf8();
        each(context, BunAOTBytes { byteCast<uint8_t>(bytes.span().data()), bytes.length() }, wasSynchronous);
    });
}

extern "C" void Bun__AOT__noteFirstLoadInEarlierProcess(JSC::VM* vm, BunAOTBytes path, bool wasSynchronous)
{
    JSC::AOT::noteFirstLoadInEarlierProcess(*vm, String::fromUTF8(std::span<const uint8_t> { path.ptr, path.len }), wasSynchronous);
}

extern "C" bool Bun__AOT__imagesHoldFile(const BunAOTBytes* images, size_t count, BunAOTBytes path)
{
    Vector<std::span<const uint8_t>, 2> list(count, [&](size_t index) {
        return std::span<const uint8_t> { images[index].ptr, images[index].len };
    });
    return JSC::AOT::imagesHoldFile(list.span(), String::fromUTF8(std::span<const uint8_t> { path.ptr, path.len }));
}

extern "C" JSC::EncodedJSValue Bun__AOT__errorIfCodeOutsideImageIsRefused(JSC::JSGlobalObject* globalObject, Bun::ErrorCode code, const BunString* path)
{
    return JSC::JSValue::encode(Bun::errorIfCodeOutsideImageIsRefused(globalObject, code, path->toWTFString(BunString::ZeroCopy)));
}

extern "C" JSC::EncodedJSValue Bun__AOT__errorIfHostObjectOutsideImageIsRefused(JSC::JSGlobalObject* globalObject, Bun::ErrorCode code, const BunString* path)
{
    return JSC::JSValue::encode(Bun::errorIfHostObjectOutsideImageIsRefused(globalObject, code, path->toWTFString(BunString::ZeroCopy)));
}

#else // ENABLE(AOT)

// The answers of the functions above where no image is registered.
namespace Bun {
using namespace JSC;

const AOT::ModuleHost compiledModuleHost {};

std::optional<AOT::ModuleID> compiledModuleForPath(const String&) { return std::nullopt; }
bool isHiddenFromRequireCache(const String&) { return false; }
std::optional<AOT::ModuleID> moduleThatMockReplaces(const String&) { return std::nullopt; }
JSPromise* compiledModuleSource(Zig::GlobalObject*, const String&, const ScriptFetchParameters*) { return nullptr; }
JSPromise* importCompiledModule(Zig::GlobalObject*, const String&, const ScriptFetchParameters*, int64_t) { return nullptr; }
bool requireCompiledModule(Zig::GlobalObject*, JSCommonJSModule*, const String&, bool) { return false; }
JSObject* loaderOfCompiledESModule(Zig::GlobalObject*, const String&, bool) { return nullptr; }
JSValue loadCompiledModuleNamespace(Zig::GlobalObject*, const String&) { return {}; }
bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject*, JSCommonJSModule*, const String&, bool) { return false; }
bool compiledModulesRunInPlaceOfFiles() { return false; }
bool compiledProgramRunsInSeveralRealmsAtOnce() { return false; }
String firstCompiledModuleMatching(JSGlobalObject*, RegExp*) { return {}; }
JSValue createNotInExecutableError(JSGlobalObject* globalObject, ErrorCode code, const String& path, NotInExecutable)
{
    return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it isn't in this executable."_s));
}
JSValue errorIfCodeOutsideImageIsRefused(JSGlobalObject*, ErrorCode, const String&) { return {}; }
JSValue errorIfHostObjectOutsideImageIsRefused(JSGlobalObject*, ErrorCode, const String&) { return {}; }
String pathInExecutable(const String&) { return {}; }
JSValue mainModuleOfExecutable(Zig::GlobalObject*) { return jsUndefined(); }
void willStorePathOfMainModule(Zig::GlobalObject*, JSValue) {}
bool appendNewChildrenOfCompiledModule(JSGlobalObject*, JSCommonJSModule*) { return true; }
JSCommonJSModule* parentOfCompiledModule(JSCommonJSModule*) { return nullptr; }
JSValue parentSeenBy(Zig::GlobalObject*, JSString*, JSValue parent) { return parent; }
JSValue errorIfUnseenCodeIsRefused(JSGlobalObject*, ASCIILiteral) { return {}; }
bool isAskingWhyFileFailsToLoad() { return false; }
bool isDebuggerAdmitted() { return true; }
JSValue errorIfDebuggerIsRefused(JSGlobalObject*, ASCIILiteral) { return {}; }
void willSetRequireCacheEntry(Zig::GlobalObject*, const String&, JSValue) {}
void willStoreLoaderOfExtension(Zig::GlobalObject*, StringView) {}
void didDeleteRequireCacheEntry(Zig::GlobalObject*, const String&) {}
bool requireCacheListsCompiledFiles(Zig::GlobalObject*) { return false; }
bool isLibraryModuleInRequireCache(Zig::GlobalObject*, const String&) { return false; }
bool isEvaluatedCompiledFile(Zig::GlobalObject*, const String&) { return false; }
JSValue compiledRequireCacheEntry(Zig::GlobalObject*, const String&) { return {}; }
bool isRecordOfCompiledModule(AbstractModuleRecord*) { return false; }
void forEachEvaluatedCompiledFile(Zig::GlobalObject*, const WTF::Function<void(const String&)>&) {}

}

extern "C" bool Bun__refusesCodeOutsideExecutable(JSC::JSGlobalObject*) { return false; }
extern "C" bool Bun__isCompiledProgramFile(const BunString*) { return false; }
extern "C" void Bun__AOT__willRunEntryPointAgain(JSC::JSGlobalObject*, const BunString*) {}
extern "C" bool Bun__isCompiledProgramFileInSomeForm(const BunString*) { return false; }
extern "C" bool Bun__AOT__mayHoldPathStartingWith(const BunString*) { return false; }
extern "C" bool Bun__AOT__isLeftToCodeOutsideImage(const BunString*, const BunString*) { return false; }
extern "C" bool Bun__AOT__omitsFunctionSource(BunAOTBytes) { return false; }
extern "C" bool Bun__AOT__tryReservePagesForNewThread(void** pages, bool)
{
    *pages = nullptr;
    return true;
}
extern "C" void Bun__AOT__releasePagesForNewThread(void*) {}
extern "C" void Bun__AOT__adoptPagesForNewThread(void*) {}
extern "C" void Bun__AOT__releaseUnusedPagesOfThread() {}
extern "C" void Bun__AOT__didStartThread() {}
extern "C" bool Bun__AOT__entryPointIsCommonJS(JSC::JSGlobalObject*) { return false; }
extern "C" void Bun__AOT__forEachFilePathStartingWith(BunAOTBytes, void*, bool (*)(void*, BunAOTBytes)) {}
extern "C" void Bun__AOT__forEachCountedFile(JSC::VM*, void*, void (*)(void*, BunAOTBytes, const uint64_t*, size_t)) {}
extern "C" void Bun__AOT__forEachFirstLoad(JSC::VM*, void*, void (*)(void*, BunAOTBytes, bool)) {}
extern "C" void Bun__AOT__noteFirstLoadInEarlierProcess(JSC::VM*, BunAOTBytes, bool) {}
extern "C" bool Bun__AOT__imagesHoldFile(const BunAOTBytes*, size_t, BunAOTBytes) { return false; }
extern "C" JSC::EncodedJSValue Bun__AOT__errorIfCodeOutsideImageIsRefused(JSC::JSGlobalObject*, Bun::ErrorCode, const BunString*) { return JSC::JSValue::encode({}); }
extern "C" JSC::EncodedJSValue Bun__AOT__errorIfHostObjectOutsideImageIsRefused(JSC::JSGlobalObject*, Bun::ErrorCode, const BunString*) { return JSC::JSValue::encode({}); }

#endif // ENABLE(AOT)
