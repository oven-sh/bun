#include "root.h"
#include "JSNextTickQueue.h"

#include "BunCompiledModules.h"

#include "BunAOTCompile.h"
#include "BunClientData.h"
#include "BunCompiledEntryPoint.h"
#include "BunProcess.h"
#include "CodeGenerationFromStrings.h"
#include "ErrorCode.h"
#include "ImportMetaObject.h"
#include "IsolatedModuleCache.h"
#include "JSCommonJSExtensions.h"
#include "JSCommonJSModule.h"
#include "JSMockFunction.h"
#include "ModuleGraph.h"
#include "ModuleLoader.h"
#include "PathInlines.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGlobalObject.h"
#if ENABLE(AOT)
#include "RemovableFeatures.h"
#include <zstd.h>

#include <JavaScriptCore/AOTImage.h>
#include <JavaScriptCore/AOTPropertyWalk.h>
#endif
#include <JavaScriptCore/AOTSchemaEnums.h>
#include <JavaScriptCore/AbstractModuleRecord.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ModuleRegistryEntry.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/RegExp.h>
#include <JavaScriptCore/ScriptFetchParameters.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/Symbol.h>
#include <wtf/FileSystem.h>
#include <wtf/SetForScope.h>

#if ENABLE(AOT)
namespace Zig {
bool runCompiledMock(Zig::GlobalObject*, JSC::AOT::ModuleID);
bool hasPendingCompiledPatch(Zig::GlobalObject*, JSC::AOT::ModuleID);
bool deferCompiledPatchToNextLoad(Zig::GlobalObject*, JSC::AOT::ModuleID, bool isFactoryPending);
JSC::JSPromise* evaluateCompiledOriginalBeforeFactory(Zig::GlobalObject*, JSC::AOT::ModuleID, bool& hasFactory);
JSC::JSValue requireCompiledOriginal(Zig::GlobalObject*, JSC::AOT::ModuleID, bool isForOwnFactory);
void didStartCompiledModuleImport(Zig::GlobalObject*, const ScopedLambda<bool(JSC::AOT::ModuleID)>& isReached);
bool reinstallBodyMocks(Zig::GlobalObject*, const WTF::ScopedLambda<bool(JSC::AOT::ModuleID)>& isReached);
JSC::JSPromise* nextPendingCompiledFactory(Zig::GlobalObject*, const WTF::ScopedLambda<bool(JSC::AOT::ModuleID)>& isInGraph, JSC::AOT::PendingFactoryRequester, JSC::JSValue& state);
uint64_t pendingCompiledFactoryCallID(Zig::GlobalObject*, JSC::AOT::ModuleID, bool& shouldRejectEveryRequire);
bool isCompiledFactoryCallPending(Zig::GlobalObject*, uint64_t call);
bool isMockAwaitingBody(Zig::GlobalObject*, JSC::AOT::ModuleID);
bool isInCompiledFactoryChain(Zig::GlobalObject*, JSC::AOT::ModuleID file, JSC::AOT::ModuleID mocked);
bool evictOriginalOfCommonJSFile(Zig::GlobalObject*, const String& specifier);
bool isCompiledModulePatchPending(Zig::GlobalObject*, const WTF::ScopedLambda<WTF::String()>& path);
bool hasRunningModuleMock(Zig::GlobalObject*);
bool requiresCompiledPatch(Zig::GlobalObject*, const WTF::ScopedLambda<WTF::String()>& path, JSC::JSObject*& exports);
uint32_t addToFactoryImportChains(Zig::GlobalObject*, JSC::AOT::ModuleID importer, JSC::AOT::ModuleID asked, JSC::AOT::LoadKind);
JSC::JSPromise* fetchedCompiledMockTurn(Zig::GlobalObject*, uint32_t module, const String& key);
bool isInsideMockFactory(Zig::GlobalObject*);
void releaseUnusedMockTurn(Zig::GlobalObject*, JSC::JSValue holder);
bool isRequestedByCompiledFactory(Zig::GlobalObject*, JSC::AOT::ModuleID);
bool isRequiredByCompiledFactory(Zig::GlobalObject*, JSC::AOT::ModuleID required, JSC::AOT::ModuleID requirer);
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
    // Reflect.ownKeys lists symbols after strings.
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionDefineMissingProperties, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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
    // Reflect.ownKeys lists symbols after strings.
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
extern "C" bool Bun__compiledProgramRunsInPlace();
extern "C" bool Bun__compiledProgramNamesPlugin();
extern "C" JSC::AOT::PluginResolveResult Bun__AOT__resolveWithPlugins(JSC::JSGlobalObject*, const BunString* name, const BunString* importer, BunString* resolvedWithoutPlugins);
extern "C" BunString Bun__AOT__resolveWithoutPlugins(JSC::JSGlobalObject*, const BunString* name, const BunString* importer);
extern "C" bool Bun__compiledProgramHoldsFileAsItIs(const BunString*);
extern "C" bool Bun__compiledProgramDataFileIsPrintedAsJavaScript(JSC::JSGlobalObject*, const BunString*);
extern "C" JSC::EncodedJSValue Bun__compiledProgramErrorOfRefusedData(JSC::JSGlobalObject*, const BunString*);
extern "C" bool Bun__AOT__isWorkerTextRefusedByTrimming(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__isMainModule(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__isLoadedSynchronously(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__isBetweenLoadOfTestFileAndItsCallbacks(JSC::JSGlobalObject*);
extern "C" bool Bun__AOT__runsTestFilesAgain();
extern "C" bool Bun__AOT__hasImmediatesYetToRun(JSC::JSGlobalObject*);
extern "C" uint64_t Bun__AOT__transpilerJobsScheduled(JSC::JSGlobalObject*);
extern "C" uint64_t Bun__AOT__transpilerJobsCompleted(JSC::JSGlobalObject*);
extern "C" uint64_t Bun__AOT__computeFileStamp(const char* path, size_t length);
extern "C" bool Bun__isESModuleByExtensionOrPackageType(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__allowsCodeFromDisk();
extern "C" bool Bun__AOT__setResolvesForCodeFromDisk(JSC::JSGlobalObject*, bool);
extern "C" JSC::EncodedJSValue SYSV_ABI BunObject_getter_main(JSC::JSGlobalObject*);
extern "C" bool isBunTest;
extern "C" bool JSMock__isInPreload(Zig::GlobalObject*);

static bool reloadsFilesFromDisk()
{
    return isBunTest && Bun__AOT__allowsCodeFromDisk();
}
extern "C" JSC::EncodedJSValue ResolveMessage__createModuleNotFound(JSC::JSGlobalObject*, const BunString* specifier, const BunString* referrer, bool isForRequire);
extern "C" BunString Bun__AOT__pathOfForm(const BunString* path, const BunString* typeAttribute, bool* isFormWithoutAttributes);
extern "C" BunString Bun__AOT__pathOfDefaultForm(const BunString* path);
extern "C" BunString Bun__AOT__nodeModuleNamedWithoutPrefix(const BunString* name);
extern "C" BunString Bun__AOT__pathInExecutable(const BunString* path);
extern "C" bool Bun__AOT__isFileInExecutable(const BunString* path);

namespace Bun {
using namespace JSC;

#if OS(WINDOWS)
static constexpr bool hostHasTwoSeparators = true;
#else
static constexpr bool hostHasTwoSeparators = false;
#endif

static std::optional<AOT::ModuleID> findModuleForPath(const String& path)
{
    if (!hasCompiledModules())
        return std::nullopt;
    std::optional<AOT::ModuleID> found = AOT::findModule(path, path.hash());
    if (found || !hostHasTwoSeparators)
        return found;
    // Executable paths are like `B:/~BUN/root/a.ts`, in-place paths like `C:\\a.ts`. Programs may use either separator.
    if (path.contains('\\'))
        found = AOT::findModule(makeStringByReplacingAll(path, '\\', '/'));
    if (!found && path.contains('/'))
        found = AOT::findModule(makeStringByReplacingAll(path, '/', '\\'));
    return found;
}

// The executable has no code for a native module. Requests for it get the module that the program imports.
std::optional<AOT::ModuleID> compiledModuleForPath(const String& path)
{
    auto module = findModuleForPath(path);
    return module && AOT::isNativeModule(*module) ? std::nullopt : module;
}

String uncompiledCallerFile(VM& vm, CallFrame* callFrame)
{
    SourceOrigin origin = callFrame->callerSourceOrigin(vm);
    const URL& url = origin.url();
    if (origin.isNull() || !url.isValid() || !url.protocolIsFile())
        return {};
    String path = url.fileSystemPath();
    bool isFile = FileSystem::fileTypeFollowingSymlinks(path) == FileSystem::FileType::Regular;
    return isFile && !isCompiledModule(path) ? path : String();
}

void didCacheSource(VM& vm, const String& key, bool isPluginSource)
{
    if (auto module = hasCompiledModules() ? compiledModuleForPath(key) : std::nullopt)
        AOT::didCacheSourceInHost(vm, *module, isPluginSource);
}

std::optional<bool> isHiddenFromRequireCache(const String& key)
{
    auto module = findModuleForPath(key);
    if (!module)
        return std::nullopt;
    return !AOT::mayHaveProgramCacheEntry(*module) && !AOT::isNativeModule(*module);
}

// A mock applies under every name of the module, and native modules are imported from the image.
std::optional<AOT::ModuleID> findMockedModule(const String& path)
{
    return findModuleForPath(path);
}

static bool replacesNativeModule(JSGlobalObject* globalObject, const String& path)
{
    auto& plugins = uncheckedDowncast<Zig::GlobalObject>(globalObject)->onLoadPlugins;
    return plugins.hasVirtualModules() && plugins.virtualModules->contains(path);
}

// As in an executable of `bun build --compile`, plugins resolve runtime names first.
static bool hasMatchingLoadPlugin(JSGlobalObject* globalObject, const String& path)
{
    if (Bun__compiledProgramRunsInPlace())
        return false;
    // A filter that throws does so again when the loader calls the plugins.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
    String asked = path;
    bool isLoadedByPlugin = uncheckedDowncast<Zig::GlobalObject>(globalObject)->onLoadPlugins.fileNamespace.find(globalObject, asked);
    (void)scope.tryClearException();
    return isLoadedByPlugin;
}

void recordFileRunFromSource(JSGlobalObject*, const String& path, ASCIILiteral why);

// A module from `build.module()`, or an onResolve filter that matches. A mock is in the same table but is no function.
static bool isGivenByPlugin(Zig::GlobalObject* global, const String& name)
{
    auto* modules = global->onLoadPlugins.virtualModules;
    auto given = modules ? modules->get(name) : JSC::Strong<JSC::JSObject>();
    return given && given->isCallable();
}

static bool hasResolvePlugins(JSGlobalObject* globalObject)
{
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    if (!global->onResolvePlugins.isEmpty())
        return true;
    auto* modules = global->onLoadPlugins.virtualModules;
    if (!modules)
        return false;
    for (auto& given : modules->values()) {
        if (given && given.get()->isCallable())
            return true;
    }
    return false;
}

struct AnswerOfPlugins {
    JSGlobalObject* realm;
    String question;
    String importer;
    JSC::Strong<JSC::Unknown> value;
    bool isThrown;
};

struct AnswersOfPlugins {
    Vector<Vector<AnswerOfPlugins>, 2> gotByEngine;
    UncheckedKeyHashMap<String, Vector<AnswerOfPlugins, 1>> keptForLoader;
    bool engineAsks { false };
    bool pluginsAreSilent { false };
};

static AnswersOfPlugins& threadPluginResolutions()
{
    static thread_local NeverDestroyed<AnswersOfPlugins> answers;
    return answers;
}

static String questionOf(const BunString* space, const BunString* name, const BunString* importer)
{
    return makeString(space ? space->toWTFString() : String(), '\n', name->toWTFString(), '\n', importer->toWTFString());
}

std::optional<JSC::EncodedJSValue> takeSavedResolution(JSGlobalObject* globalObject, const BunString* space, const BunString* name, const BunString* importer, bool& engineAsks)
{
    AnswersOfPlugins& answers = threadPluginResolutions();
    if (answers.pluginsAreSilent) [[unlikely]]
        return JSValue::encode(jsUndefined());
    engineAsks = std::exchange(answers.engineAsks, false);
    if (engineAsks || answers.keptForLoader.isEmpty()) [[likely]]
        return std::nullopt;
    auto kept = answers.keptForLoader.find(questionOf(space, name, importer));
    if (kept == answers.keptForLoader.end())
        return std::nullopt;
    size_t index = kept->value.findIf([&](const AnswerOfPlugins& answer) {
        return answer.realm == globalObject;
    });
    if (index == notFound)
        return std::nullopt;
    JSValue value = kept->value[index].value.get();
    bool isThrown = kept->value[index].isThrown;
    kept->value.removeAt(index);
    if (kept->value.isEmpty())
        answers.keptForLoader.remove(kept);
    if (!isThrown)
        return JSValue::encode(value);
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    throwException(globalObject, scope, value);
    return JSC::EncodedJSValue {};
}

void saveResolution(JSGlobalObject* globalObject, const BunString* space, const BunString* name, const BunString* importer, JSValue resultOrThrownValue, bool isThrown)
{
    AnswersOfPlugins& answers = threadPluginResolutions();
    answers.engineAsks = true;
    answers.gotByEngine.last().append({ globalObject, questionOf(space, name, importer), importer->toWTFString(), JSC::Strong<JSC::Unknown>(getVM(globalObject), resultOrThrownValue), isThrown });
}

extern "C" void Bun__AOT__setPluginsSilent(bool areSilent)
{
    threadPluginResolutions().pluginsAreSilent = areSilent;
}

bool hasSavedResolutions()
{
    return !threadPluginResolutions().keptForLoader.isEmpty();
}

void clearSavedResolutions(JSGlobalObject* globalObject)
{
    threadPluginResolutions().keptForLoader.removeIf([&](auto& kept) {
        kept.value.removeAllMatching([&](const AnswerOfPlugins& answer) {
            return answer.realm == globalObject;
        });
        return kept.value.isEmpty();
    });
}

static void beginOrEndPluginResolutions(JSGlobalObject*, const ScopedLambda<bool(const String& importer)>* shouldCacheForLoader)
{
    AnswersOfPlugins& answers = threadPluginResolutions();
    if (!shouldCacheForLoader) {
        answers.gotByEngine.append(Vector<AnswerOfPlugins>());
        return;
    }
    for (AnswerOfPlugins& answer : answers.gotByEngine.takeLast()) {
        if (!(*shouldCacheForLoader)(answer.importer))
            continue;
        String question = answer.question;
        answers.keptForLoader.ensure(question, [] {
                                 return Vector<AnswerOfPlugins, 1>();
                             })
            .iterator->value.append(WTF::move(answer));
    }
}

static String resolveWithoutPlugins(JSGlobalObject* globalObject, const String& name, const String& importer)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
    BunString nameArgument = Bun::toString(name);
    BunString importerArgument = Bun::toString(importer);
    BunString found = Bun__AOT__resolveWithoutPlugins(globalObject, &nameArgument, &importerArgument);
    (void)scope.tryClearException();
    return found.isDead() ? String() : found.transferToWTFString();
}

static AOT::PluginResolveResult resolveWithPlugins(JSGlobalObject* globalObject, const String& name, const String& importer, String& resolvedWithoutPlugins)
{
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    AOT::PluginResolveResult answer = isGivenByPlugin(global, name) ? AOT::PluginResolveResult::Resolved : AOT::PluginResolveResult::Declined;
    if (answer == AOT::PluginResolveResult::Declined && !global->onResolvePlugins.isEmpty()) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
        BunString nameArgument = Bun::toString(name);
        BunString importerArgument = Bun::toString(importer);
        BunString found = { BunStringTag::Dead };
        {
            SetForScope engineAsks(threadPluginResolutions().engineAsks, true);
            SetForScope importStatement(global->onResolvePlugins.isResolvingImportStatement, true);
            answer = Bun__AOT__resolveWithPlugins(globalObject, &nameArgument, &importerArgument, &found);
        }
        (void)scope.tryClearException();
        if (!found.isDead())
            resolvedWithoutPlugins = found.transferToWTFString();
    }
    if (answer != AOT::PluginResolveResult::Declined)
        recordFileRunFromSource(globalObject, importer, "a plugin answers for a name that it imports"_s);
    return answer;
}

// Code from disk may name globals, built-in modules and files on disk. The helpers of a test run import the files under test.
static bool keepsFilesFromCodeFromDisk()
{
    return Bun__AOT__allowsCodeFromDisk() && !isBunTest && !Bun__compiledProgramRunsInPlace();
}

static bool rejectsRequester(JSGlobalObject* globalObject, AOT::ModuleID module, AOT::LoadKind way)
{
    if (!keepsFilesFromCodeFromDisk())
        return false;
    if (AOT::isNativeModule(module) || AOT::isOfLibrary(module) || !AOT::hasUncompiledRequester(globalObject))
        return false;
    AOT::throwCompiledModuleAccessError(globalObject, module, way);
    return true;
}

void willResolveImport(Zig::GlobalObject* globalObject, const String& key, JSValue importer)
{
    if (!hasCompiledModules())
        return;
    auto module = compiledModuleForPath(key);
    if (!module)
        return;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (isModuleRefusedByName(key)) [[unlikely]] {
        throwException(globalObject, scope, createCodeGenerationFromStringsError(globalObject));
        return;
    }
    if (!importer || !importer.isString())
        return;
    String path = importer.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, void());
    AOT::ModuleRequesterScope requesterScope(globalObject, requesterForImporter(path));
    scope.release();
    rejectsRequester(globalObject, *module, AOT::LoadKind::Import);
}

// A file that is only imported with type attributes has no module under its bare path.
static std::optional<AOT::ModuleID> findDefaultForm(const String& path)
{
    if (!hasCompiledModules() || Bun__compiledProgramRunsInPlace())
        return std::nullopt;
    BunString pathArgument = Bun::toString(path);
    BunString pathOfForm = Bun__AOT__pathOfDefaultForm(&pathArgument);
    if (pathOfForm.isDead())
        return std::nullopt;
    return findModuleForPath(pathOfForm.transferToWTFString());
}

// The resolver ignores import attributes and finds a file in any form. A require() or an import() without a type treats it as missing, but its path can still be resolved and read.
void throwIfOnlyTyped(Zig::GlobalObject* globalObject, const String& key, const String& specifier, const String& importer, bool isForRequire)
{
    if (Bun__compiledProgramRunsInPlace() || findModuleForPath(key) || findDefaultForm(key) || !AOT::hasAttributeVariant(key))
        return;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    BunString specifierString = Bun::toString(specifier);
    BunString referrer = Bun::toString(importer);
    throwException(globalObject, scope, JSValue::decode(ResolveMessage__createModuleNotFound(globalObject, &specifierString, &referrer, isForRequire)));
}

static std::optional<AOT::ModuleID> moduleForRequest(Zig::GlobalObject* globalObject, const String& path, AOT::LoadKind way)
{
    auto module = findModuleForPath(path);
    if (!module)
        module = findDefaultForm(path);
    if (!module) {
        // Each query of a file is a separate instance, which the loader creates from the source. The source has the path alone.
        if (size_t query = path.find('?'); query != notFound && findModuleForPath(path.left(query)) && !AOT::isCompiledOriginal(globalObject, path))
            recordFileRunFromSource(globalObject, path, "it was imported under a query"_s);
        return module;
    }
    // In a realm without compiled modules, such as the --isolate window of `bun test`, the library runs from source.
    if (!globalObject->aotInstance() && AOT::isOfLibrary(*module))
        return std::nullopt;
    // Before the plugins: their result would be registered under the path of the file, where the program finds it.
    if (rejectsRequester(globalObject, *module, way))
        return std::nullopt;
    // A mock that was stored over an earlier require().
    if (way == AOT::LoadKind::Require && AOT::isInRequireCache(globalObject, *module))
        return module;
    if (!AOT::isNativeModule(*module) && hasMatchingLoadPlugin(globalObject, path))
        return std::nullopt;
    // Files that load again after a reset import the mock itself. Files linked before the reset keep the module.
    if (way == AOT::LoadKind::Import && AOT::hasPendingMockAfterReset(globalObject, *module))
        return std::nullopt;
    // Native modules belong to the host, for every requester.
    bool isReplaced = AOT::isNativeModule(*module) ? replacesNativeModule(globalObject, path) : AOT::isReplacedByHost(globalObject, *module, way);
    return isReplaced ? std::nullopt : module;
}

static std::optional<AOT::ModuleID> compiledModuleForRequest(Zig::GlobalObject* globalObject, const String& path, bool hasImportAttributes, AOT::LoadKind way)
{
    if (hasImportAttributes)
        return std::nullopt;
    auto module = moduleForRequest(globalObject, path, way);
    if (!module)
        return std::nullopt;
    if (auto form = way == AOT::LoadKind::Import ? AOT::moduleFormOf(globalObject, *module) : AOT::loadedModuleForm(globalObject, *module))
        module = form;
    BunString pathArgument = Bun::toString(path);
    auto startedBy = Bun__AOT__isMainModule(globalObject, &pathArgument) ? AOT::StartedBy::Host : AOT::StartedBy::Code;
    if (AOT::delegatesModuleToHost(globalObject, *module, startedBy)) {
        AOT::willLoadCopyFromDisk(globalObject, *module, way);
        return std::nullopt;
    }
    return module;
}

static String typeAttributeOf(const ScriptFetchParameters& attributes)
{
    // The path does not show what another attribute selects. The engine requests a statement that the loader links by type.
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

enum class FormWithoutAttributes : bool { MayAnswer,
    IsAnotherModule };

static std::optional<AOT::ModuleID> findFormOfModule(JSGlobalObject* globalObject, const String& path, const ScriptFetchParameters& attributes, FormWithoutAttributes formWithoutAttributes)
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
    // The files of an executable are not on disk, so the form compiled without the attribute is used. In place, the loader reads the file with its type, as another module.
    if (!module && isFormWithoutAttributes && formWithoutAttributes == FormWithoutAttributes::MayAnswer && !Bun__compiledProgramRunsInPlace())
        module = compiledModuleForPath(path);
    if (module && (rejectsRequester(globalObject, *module, AOT::LoadKind::Import) || AOT::delegatesModuleToHost(globalObject, *module)))
        return std::nullopt;
    return module;
}

static std::optional<AOT::ModuleID> findModuleWithAttributes(JSGlobalObject* globalObject, const String& path, const ScriptFetchParameters& attributes)
{
    return findFormOfModule(globalObject, path, attributes, FormWithoutAttributes::MayAnswer);
}

BUN_DECLARE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFactory);
BUN_DECLARE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFailedFactory);
BUN_DECLARE_HOST_FUNCTION(jsFunctionCompiledSourceAfterTurn);

static String keyOfFetch(JSArray* fetch)
{
    return uncheckedDowncast<AbstractModuleRecord>(fetch->getIndexQuickly(0).asCell())->moduleKey().string();
}

static void didUnblockFetch(Zig::GlobalObject* globalObject, JSArray* fetch)
{
    globalObject->onLoadPlugins.fetchesBlockedOnFactories.removeFirst(keyOfFetch(fetch));
}

// The factories that a fetch calls may release the module being fetched.
static AbstractModuleRecord* currentFetchRecord(Zig::GlobalObject* globalObject, AbstractModuleRecord* record, AOT::ModuleID module)
{
    return AOT::isReleasedModuleRecord(record) ? AOT::moduleRecord(globalObject, module) : record;
}

// `fetch`: the record, the number of its module, and the state of ModuleHost::nextPendingFactory, which begins as the requested key.
static JSPromise* sourceAfterFactories(Zig::GlobalObject* globalObject, JSPromise* source, JSArray* fetch)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue state = fetch->getIndexQuickly(2);
    if (state.isUndefined())
        state = JSValue();
    AOT::ModuleID module(fetch->getIndexQuickly(1).asUInt32());
    JSPromise* factory = AOT::pendingFactoryInGraph(globalObject, module, state);
    if (scope.exception()) [[unlikely]]
        return source->rejectWithCaughtException(vm, scope);
    // The factories of one load run one at a time: the visit stops after each that waits.
    while (!factory) {
        bool hasCalledWaitingFactory = AOT::runMocksInGraph(globalObject, module);
        if (scope.exception()) [[unlikely]]
            return source->rejectWithCaughtException(vm, scope);
        if (!hasCalledWaitingFactory)
            break;
        factory = AOT::pendingFactoryInGraph(globalObject, module, state);
        if (scope.exception()) [[unlikely]]
            return source->rejectWithCaughtException(vm, scope);
    }
    if (!factory) {
        auto* record = currentFetchRecord(globalObject, uncheckedDowncast<AbstractModuleRecord>(fetch->getIndexQuickly(0).asCell()), module);
        if (scope.exception()) [[unlikely]]
            return source->rejectWithCaughtException(vm, scope);
        source->fulfill(vm, record);
        return source;
    }
    fetch->putDirectIndex(globalObject, 2, state);
    if (scope.exception()) [[unlikely]]
        return source->rejectWithCaughtException(vm, scope);
    globalObject->onLoadPlugins.fetchesBlockedOnFactories.append(keyOfFetch(fetch));
    factory->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionCompiledSourceAfterFactory), globalObject->thenable(jsFunctionCompiledSourceAfterFailedFactory), source, fetch);
    return source;
}

static JSPromise* sourceAfterRelease(JSGlobalObject* lexicalGlobalObject, AbstractModuleRecord* record, AOT::ModuleID module)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer fetch;
    fetch.append(record);
    fetch.append(jsNumber(module.index()));
    fetch.append(jsString(vm, record->moduleKey().string()));
    JSArray* heldFetch = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), fetch);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, sourceAfterFactories(globalObject, JSPromise::create(vm, globalObject->promiseStructure()), heldFetch));
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFactory, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    didUnblockFetch(globalObject, asArray(callFrame->argument(1)));
    AOT::didResumeFetchAfterFactory(globalObject);
    JSPromise* next = JSPromise::create(getVM(globalObject), globalObject->promiseStructure());
    return JSValue::encode(sourceAfterFactories(globalObject, next, asArray(callFrame->argument(1))));
}

// The first argument is the mock that has the turn, see fetchedCompiledMockTurn().
BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledSourceAfterTurn, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSArray* fetch = asArray(callFrame->argument(1));
    if (fetch->length() > 3)
        AOT::forgetMockRegisteredAfter(globalObject, AOT::ModuleID(fetch->getIndexQuickly(1).asUInt32()), fetch->getIndexQuickly(3).asUInt32());
    JSPromise* next = JSPromise::create(getVM(globalObject), globalObject->promiseStructure());
    JSPromise* source = sourceAfterFactories(globalObject, next, fetch);
    Zig::releaseUnusedMockTurn(globalObject, callFrame->argument(0));
    return JSValue::encode(source);
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFailedFactory, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    didUnblockFetch(defaultGlobalObject(globalObject), asArray(callFrame->argument(1)));
    scope.throwException(globalObject, callFrame->argument(0));
    return {};
}

static bool ranDuringWaitingMock(Zig::GlobalObject*, AOT::ModuleID);

static std::optional<AOT::ModuleID> evaluatedOriginalKeyModule(Zig::GlobalObject* globalObject, const String& key)
{
    if (!isBunTest || !key.endsWith("?actual"_s))
        return std::nullopt;
    auto module = findModuleForPath(key.left(key.length() - "?actual"_s.length()));
    if (!module || !((AOT::isUnderActualKey(globalObject, *module) && (AOT::evaluatedBy(globalObject, *module) != AOT::LoadedBy::EarlierTestFile || key.contains(makeString(PLATFORM_SEP, "node_modules"_s, PLATFORM_SEP)))) || (ranDuringWaitingMock(globalObject, *module) && !AOT::isRetainedByInFlightLoads(globalObject, *module))) || AOT::isEvicted(globalObject, *module) || AOT::wasReleasedByLoader(globalObject, *module) || AOT::isOriginalEvicted(globalObject, *module) || AOT::mockedModuleEvaluationError(globalObject, *module))
        return std::nullopt;
    return module;
}

JSPromise* compiledModuleSource(Zig::GlobalObject* globalObject, const String& key, const ScriptFetchParameters* attributes)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto rejected = [&] {
        JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
        promise->markAsHandled();
        return promise->rejectWithCaughtException(vm, scope);
    };
    if (auto itself = attributes ? std::nullopt : evaluatedOriginalKeyModule(globalObject, key)) {
        AbstractModuleRecord* record = AOT::originalModuleRecord(globalObject, *itself);
        if (scope.exception()) [[unlikely]]
            return rejected();
        if (record) {
            JSPromise* source = JSPromise::create(vm, globalObject->promiseStructure());
            source->fulfill(vm, record);
            return source;
        }
    }
    auto module = attributes ? findFormOfModule(globalObject, key, *attributes, FormWithoutAttributes::IsAnotherModule) : compiledModuleForRequest(globalObject, key, false, AOT::LoadKind::Import);
    if (scope.exception()) [[unlikely]]
        return rejected();
    if (!module)
        return nullptr;
    if (isBunTest && !JSMock__isInPreload(globalObject)) {
        unsigned testFile = globalObject->onLoadPlugins.testFile;
        auto loadedBy = AOT::evaluatedBy(globalObject, *module);
        if (loadedBy != AOT::LoadedBy::Preload)
            globalObject->onLoadPlugins.testFileOfModule.set(key, testFile > 1 && loadedBy == AOT::LoadedBy::EarlierTestFile ? testFile - 1 : testFile);
    }
    bool shouldDeferSource = AOT::shouldDeferFetchFulfillment(globalObject, *module);
    AbstractModuleRecord* record = AOT::moduleRecord(globalObject, *module);
    if (scope.exception()) [[unlikely]]
        return rejected();
    // Another fetch in flight may request the module once it is mocked.
    bool isAlone = globalObject->onLoadPlugins.waitingMockFetches.isEmpty() && !AOT::hasBatchedFetches(globalObject);
    // A require() cannot wait.
    JSPromise* turn = attributes || vm.synchronousModuleQueue() || globalObject->onLoadPlugins.pendingCompiledMocks.isEmpty() ? nullptr : Zig::fetchedCompiledMockTurn(globalObject, module->index(), key);
    if (turn) [[unlikely]]
        AOT::willFetchAfterTick(globalObject, *module);
    bool hasCalledWaitingFactory = !turn && AOT::runMocksInGraph(globalObject, *module);
    if (scope.exception()) [[unlikely]]
        return AOT::didMockFailForImportStatement(globalObject, *module) ? nullptr : rejected();
    record = currentFetchRecord(globalObject, record, *module);
    if (scope.exception()) [[unlikely]]
        return rejected();
    JSPromise* source = JSPromise::create(vm, globalObject->promiseStructure());
    if (!turn && !hasCalledWaitingFactory && globalObject->onLoadPlugins.compiledMockFactories.isEmpty()) [[likely]] {
        // The entry of a file that another file imports exists while it is fetched, so a mock finds it.
        if (isBunTest && !testFileModuleLoader(globalObject)->registryEntry(Identifier::fromString(vm, key)))
            AOT::didFetch(globalObject, record);
        if (shouldDeferSource) [[unlikely]]
            AOT::deferFetchFulfillment(globalObject, *module, source, record);
        else
            source->fulfill(vm, record);
        return source;
    }
    // The loader of `bun run` waits for a factory before it continues the graph.
    MarkedArgumentBuffer fetch;
    fetch.append(record);
    fetch.append(jsNumber(module->index()));
    fetch.append(jsString(vm, key));
    if (turn && isAlone && !AOT::hasPendingMock(globalObject, *module)) [[unlikely]]
        fetch.append(jsNumber(AOT::momentOfLoads(globalObject)));
    JSArray* heldFetch = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), fetch);
    if (scope.exception()) [[unlikely]]
        return rejected();
    if (turn) [[unlikely]] {
        turn->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionCompiledSourceAfterTurn), globalObject->thenable(jsFunctionCompiledSourceAfterFailedFactory), source, heldFetch);
        return source;
    }
    RELEASE_AND_RETURN(scope, sourceAfterFactories(globalObject, source, heldFetch));
}

JSPromise* importCompiledModule(Zig::GlobalObject* globalObject, const String& key, const ScriptFetchParameters* attributes, int64_t referrerAsyncOrder)
{
    auto module = attributes ? findModuleWithAttributes(globalObject, key, *attributes) : compiledModuleForRequest(globalObject, key, false, AOT::LoadKind::Import);
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

static std::optional<AOT::ModuleID> compiledModuleOfRequirer(JSCommonJSModule* requirer)
{
    if (auto own = compiledModuleOf(requirer))
        return own;
    uint32_t asker = requirer->requestingCompiledModule();
    if (asker == JSCommonJSModule::noCompiledModule)
        return std::nullopt;
    return AOT::ModuleID(asker);
}

static void requireInto(Zig::GlobalObject* globalObject, JSCommonJSModule* target, AOT::ModuleID module, std::optional<AOT::ModuleID> referrer = std::nullopt)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue exports = AOT::requireModule(globalObject, module, referrer);
    RETURN_IF_EXCEPTION(scope, void());
    target->setExportsObject(exports);
}

// `bun run` reads a file with an unknown extension, like `a.png`, as code for require(), while import gets its path.
// The image has the code if the program names the file in a require(). The loader reads any other file.
static bool isReadAsCodeByRequire(Zig::GlobalObject* globalObject, AOT::ModuleID module, const String& path)
{
    if (!reloadsFilesFromDisk() || !AOT::isDataFile(module))
        return false;
    BunString pathString = Bun::toString(path);
    return Bun__getDefaultLoader(globalObject, &pathString, nullptr) == BunLoaderTypeJS && !AOT::hasBeenImported(globalObject, module);
}

// The library requires computed names. The build resolved this one, so ask the engine directly.
JSValue requireCompiledModuleForTestRunner(Zig::GlobalObject* globalObject, const String& key)
{
    auto module = findModuleForPath(key);
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;
    if (!module || (virtualModules && virtualModules->contains(key)) || rejectsRequester(globalObject, *module, AOT::LoadKind::Require))
        return {};
    return AOT::requireModule(globalObject, *module);
}

JSC_DECLARE_HOST_FUNCTION(jsLoaderJS);
JSC_DECLARE_HOST_FUNCTION(jsLoaderTS);
JSC_DECLARE_HOST_FUNCTION(jsLoaderJSON);

// As find_longest_registered_extension() in NodeModuleModule.rs: the first extension from the left with a registered function. A default loader does not count.
static JSValue loaderOfProgramForFile(Zig::GlobalObject* globalObject, const String& path)
{
    auto& vm = getVM(globalObject);
    JSObject* extensions = globalObject->lazyRequireExtensionsObject();
    StringView name = StringView(path).substring(path.reverseFind(PLATFORM_SEP) + 1);
    for (size_t dot = name.find('.', 1); dot != notFound; dot = name.find('.', dot + 1)) {
        JSValue stored = extensions->getDirect(vm, Identifier::fromString(vm, name.substring(dot).toString()));
        CallData callData = stored ? getCallData(stored) : CallData();
        if (callData.type == CallData::Type::None)
            continue;
        if (callData.type == CallData::Type::JS)
            return stored;
        auto* function = callData.native.function.untaggedPtr();
        return function == &jsLoaderJS || function == &jsLoaderTS || function == &jsLoaderJSON || function == &Process_functionDlopen ? JSValue() : stored;
    }
    return {};
}

// While a loader of the program runs: the object that require() created, and its file.
struct TransferredRequire {
    JSCommonJSModule* target { nullptr };
    const String* path { nullptr };
    uint32_t module { 0 };
    // The engine uses `target` as the file's `module`.
    bool isModuleOfFile { false };
};
static constinit thread_local TransferredRequire s_transferredRequire;

static void requireCompiledModuleInto(Zig::GlobalObject*, JSCommonJSModule* target, AOT::ModuleID, JSString* key);
static void linkToModuleObjects(Zig::GlobalObject*, JSCommonJSModule* requirer, JSCommonJSModule* target, AOT::ModuleID, bool isFirstRequire);
static void appendModuleChildren(JSGlobalObject*, JSObject* module, JSObject* childOrNull);
static JSObject* attachRequireFunction(VM&, Zig::GlobalObject*, JSCommonJSModule*, JSString* path);
static void storeOnModuleObject(Zig::GlobalObject*, JSCommonJSModule*, JSString* path, AOT::ModuleID, OptionSet<AOT::ModuleObjectTrait>, AOT::ModuleObjects& out);
static bool tryBindExportsVariable(Zig::GlobalObject*, JSCommonJSModule*, AOT::ModuleID);

bool resumeDelegatedRequire(Zig::GlobalObject* globalObject, JSCommonJSModule* target, const String& path)
{
    TransferredRequire handed = s_transferredRequire;
    if (!handed.target || handed.target != target || *handed.path != path)
        return false;
    // `bun run` leaves an evaluated object unchanged, see JSCommonJSModule::evaluate().
    if (target->hasEvaluated)
        return true;
    if (target->m_overriddenCompile) {
        AOT::throwCompileOverrideError(globalObject, AOT::ModuleID(handed.module));
        return false;
    }
    SetForScope nothingIsHanded(s_transferredRequire, TransferredRequire {});
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    // Set before the body runs, as in `bun run`: a second call does not evaluate a file that threw.
    target->hasEvaluated = true;
    requireCompiledModuleInto(globalObject, target, AOT::ModuleID(handed.module), jsString(getVM(globalObject), path));
    RETURN_IF_EXCEPTION(scope, false);
    return true;
}

static bool tryAdoptModuleObject(Zig::GlobalObject* globalObject, JSCommonJSModule* target, AOT::ModuleID module, JSString* key)
{
    if (!AOT::newModuleObjectTraits(globalObject, module))
        return false;
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    AOT::ModuleObjects objects;
    objects.module = target;
    objects.require = attachRequireFunction(vm, globalObject, target, key);
    RETURN_IF_EXCEPTION(scope, false);
    AOT::adoptModuleObject(globalObject, module, objects);
    return true;
}

bool requireCompiledModule(Zig::GlobalObject* globalObject, JSCommonJSModule* target, const String& path, bool hasImportAttributes)
{
    auto module = compiledModuleForRequest(globalObject, path, hasImportAttributes, AOT::LoadKind::Require);
    if (module && isReadAsCodeByRequire(globalObject, *module, path))
        module = compiledModuleForRequest(globalObject, makeString(path, "?ts"_s), hasImportAttributes, AOT::LoadKind::Require);
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!module) {
        // For a data file that failed to parse, the executable has the error message instead of a module.
        BunString pathOfForm = Bun::toString(path);
        JSValue refused = hasImportAttributes ? JSValue() : JSValue::decode(Bun__compiledProgramErrorOfRefusedData(globalObject, &pathOfForm));
        if (refused)
            throwException(globalObject, scope, refused);
        return false;
    }
    // In a test run willSetExtensionLoader() already removed files of this kind from the program.
    if (JSValue loader = reloadsFilesFromDisk() ? JSValue() : loaderOfProgramForFile(globalObject, path)) {
        JSString* key = jsString(vm, path);
        // As in `bun run`, the file sees what the loader stored on the object, as its `module`.
        // Until the file runs, the object is like any other of require(): `exports` is empty, and it is a child of the requirer.
        bool isAdopted = tryAdoptModuleObject(globalObject, target, *module, key);
        RETURN_IF_EXCEPTION(scope, false);
        SetForScope isHanded(s_transferredRequire, TransferredRequire { target, &path, module->index(), isAdopted });
        MarkedArgumentBuffer arguments;
        arguments.append(target);
        arguments.append(key);
        JSC::profiledCall(globalObject, ProfilingReason::API, loader, getCallData(loader), target, arguments);
        if (scope.exception()) [[unlikely]] {
            // Remove the object from the cache. If the file can still run, the next require() creates its `module`.
            if (isAdopted)
                AOT::releaseModuleObject(globalObject, *module);
            return false;
        }
        // The object stays in the cache, as in `bun run`, so the loader is called once for a file.
        return true;
    }
    JSString* key = jsString(vm, path);
    JSCommonJSModule* requirer = target->m_parent.get();
    bool isFirstRequire = requirer && !AOT::parentModuleObject(globalObject, *module);
    RETURN_IF_EXCEPTION(scope, false);
    requireCompiledModuleInto(globalObject, target, *module, key);
    RETURN_IF_EXCEPTION(scope, false);
    // As in `bun run`, where `loaded` stays false for an ES module.
    target->hasEvaluated = !AOT::isESModule(*module);
    if (requirer && target->compiledModuleLoadedInto != JSCommonJSModule::noCompiledModule) {
        linkToModuleObjects(globalObject, requirer, target, *module, isFirstRequire);
        RETURN_IF_EXCEPTION(scope, false);
    }
    // Compiled modules are in no cache. The next require() asks the engine for the current exports.
    JSValue held = globalObject->requireMap()->get(globalObject, key);
    RETURN_IF_EXCEPTION(scope, false);
    if (held == target) {
        globalObject->requireMap()->remove(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
    }
    return true;
}

static void linkToModuleObjects(Zig::GlobalObject* globalObject, JSCommonJSModule* requirer, JSCommonJSModule* target, AOT::ModuleID module, bool isFirstRequire)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* parent = AOT::parentModuleObject(globalObject, module);
    RETURN_IF_EXCEPTION(scope, void());
    if (parent && parent != requirer)
        target->m_overriddenParent.set(vm, target, parent);
    // `bun run` adds no child for the first require() of an ES module.
    if (isFirstRequire && parent && AOT::isESModule(module)) {
        target->isListedAsChild = true;
        return;
    }
    JSObject* child = AOT::childModuleObject(globalObject, module);
    RETURN_IF_EXCEPTION(scope, void());
    if (!child || child == target)
        return;
    target->isListedAsChild = true;
    if (requirer->listsAsChild(target))
        RELEASE_AND_RETURN(scope, appendModuleChildren(globalObject, requirer, child));
}

static void requireCompiledModuleInto(Zig::GlobalObject* globalObject, JSCommonJSModule* target, AOT::ModuleID module, JSString* key)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSCommonJSModule* requirer = target->m_parent.get();
    // `target` is the object that require() created for the file under a computed name.
    auto referrer = requirer ? compiledModuleOfRequirer(requirer) : std::nullopt;
    // The engine tracks the parent of the file.
    if (referrer)
        target->compiledModule = module.index();
    bool isAdopted = false;
    // Test runs manage their own entries of the require map.
    bool isOwnRequire = referrer && !reloadsFilesFromDisk() && requirer->compiledModule == referrer->index();
    if (requirer && (!referrer || isOwnRequire)) {
        if (!referrer) {
            target->compiledModuleLoadedInto = module.index();
            AOT::willRequireFromUncompiledCode(globalObject, module, requirer);
        }
        isAdopted = tryAdoptModuleObject(globalObject, target, module, key);
        RETURN_IF_EXCEPTION(scope, void());
        if (isAdopted) {
            target->hasEvaluated = true;
            // The engine tracks calls of a created require().
            if (referrer)
                target->clearParent();
        }
    }
    if (reloadsFilesFromDisk()) {
        if (AOT::isESModule(module))
            AOT::didCreateModuleObject(globalObject, module, target);
        else
            globalObject->requireMap()->remove(globalObject, key);
        RETURN_IF_EXCEPTION(scope, void());
    }
    bool readsExportsOffVariable = tryBindExportsVariable(globalObject, target, module);
    RETURN_IF_EXCEPTION(scope, void());
    if (readsExportsOffVariable || isAdopted) {
        scope.release();
        AOT::requireModule(globalObject, module, referrer, AOT::ReadsExports::No);
        return;
    }
    RELEASE_AND_RETURN(scope, requireInto(globalObject, target, module, referrer));
}

JSObject* loaderOfCompiledESModule(Zig::GlobalObject* globalObject, const String& path, bool hasImportAttributes)
{
    auto module = compiledModuleForRequest(globalObject, path, hasImportAttributes, AOT::LoadKind::Require);
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
    auto module = moduleForRequest(globalObject, path, AOT::LoadKind::Require);
    if (!module || AOT::delegatesModuleToHost(globalObject, *module))
        return {};
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    AOT::evaluateModuleSynchronously(globalObject, *module);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, AOT::moduleNamespace(globalObject, *module));
}

// As in `bun run`, the object passed to the default loader is the file's `module`. If the program's loader passes another object or file, the object of require() is an ordinary one.
static void takeForModuleObjectOfFile(Zig::GlobalObject* globalObject, JSCommonJSModule* target, AOT::ModuleID module, const String& path)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    TransferredRequire handed = s_transferredRequire;
    if (handed.target && (handed.target == target || handed.module == module.index())) {
        s_transferredRequire = {};
        if (handed.isModuleOfFile)
            AOT::releaseModuleObject(globalObject, AOT::ModuleID(handed.module));
    }
    // A file that was evaluated, or is being evaluated, keeps its `module`.
    if (AOT::hasCommonJSEvaluationStarted(globalObject, module) || !AOT::newModuleObjectTraits(globalObject, module))
        return;
    AOT::ModuleObjects objects;
    objects.module = target;
    objects.require = attachRequireFunction(vm, globalObject, target, jsString(vm, path));
    RETURN_IF_EXCEPTION(scope, void());
    target->compiledModule = module.index();
    // Its parent is the one that the program created it with, not the first requirer.
    target->m_isParentStored = true;
    AOT::adoptModuleObject(globalObject, module, objects);
}

bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject* globalObject, JSCommonJSModule* target, const String& path, bool isTypeScriptLoader)
{
    if (!hasCompiledModules() || target->moduleGraph() || target->m_overriddenCompile) [[likely]]
        return false;
    auto module = compiledModuleForPath(path);
    // The runtime delegated the call here for such a file and would do so again.
    if (!module || AOT::delegatesModuleToHost(globalObject, *module))
        return false;
    // `bun run` reads the file and leaves an evaluated object unchanged, see JSCommonJSModule::evaluate().
    if (target->hasEvaluated)
        return true;
    BunString pathString = Bun::toString(path);
    auto loader = Bun__getDefaultLoader(globalObject, &pathString, nullptr);
    bool isTypeScriptFile = loader == BunLoaderTypeTS || loader == BunLoaderTypeTSX;
    if (isTypeScriptFile != isTypeScriptLoader)
        return false;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    // A default loader can be called with any object and path. Check before storing anything on the object.
    String requesterPath = requesterForRequire(target, String());
    AOT::ModuleRequesterScope requesterScope(globalObject, requesterPath);
    if (rejectsRequester(globalObject, *module, AOT::LoadKind::Require))
        return false;
    takeForModuleObjectOfFile(globalObject, target, *module, path);
    RETURN_IF_EXCEPTION(scope, false);
    // `bun run` would evaluate the source again into `target`, but the image has the file once.
    bool readsExportsOffVariable = tryBindExportsVariable(globalObject, target, *module);
    RETURN_IF_EXCEPTION(scope, false);
    // A refusal is not an exception of the file: the object does not change, and the next call is refused as well.
    bool isRefused = AOT::hasCommonJSEvaluationStarted(globalObject, *module);
    // Set before the body runs, as in `bun run`: a file that throws is not evaluated again into the same object.
    target->hasEvaluated = !isRefused;
    JSValue exports = AOT::evaluateForDefaultLoader(globalObject, *module);
    bool hasThrown = scope.exception();
    // An ES module that threw stored nothing on the object.
    if (readsExportsOffVariable || isRefused || (hasThrown && AOT::isESModule(*module)))
        return !hasThrown;
    // `bun run` evaluates into the object's own `exports`, which keeps what the file stored before it threw.
    target->setExportsObject(hasThrown ? AOT::moduleExports(globalObject, *module) : exports);
    return !hasThrown;
}

static void evictFromProgram(Zig::GlobalObject* globalObject, const String& key, void (*takeOut)(JSGlobalObject*, AOT::ModuleID))
{
    if (!reloadsFilesFromDisk()) {
        if (auto module = AOT::findLibraryModuleInRequireCache(globalObject, key))
            takeOut(globalObject, *module);
        return;
    }
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (auto module = findModuleForPath(key)) {
        takeOut(globalObject, *module);
        RETURN_IF_EXCEPTION(scope, );
    }
    // `import("./a", { with: { type: "text" } })`: the image has the file once for each type, and the cache has it under its path.
    for (AOT::ModuleID form : AOT::importAttributeVariants(globalObject, key)) {
        takeOut(globalObject, form);
        RETURN_IF_EXCEPTION(scope, );
    }
}

// A require() could not wait for the factory of an unloaded mock and evaluated the file beside it: in `bun test` that original has its own key, and nothing is under the file's.
static bool ranDuringWaitingMock(Zig::GlobalObject* globalObject, AOT::ModuleID module)
{
    return AOT::hasRequireCacheEntry(globalObject, module) && AOT::hasPendingMock(globalObject, module) && !AOT::hasIntactOriginal(globalObject, module);
}

void didDeleteRequireCacheEntry(Zig::GlobalObject* globalObject, const String& key)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto module = reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    if (module && ranDuringWaitingMock(globalObject, *module))
        RELEASE_AND_RETURN(scope, AOT::didDeletePendingMockEntry(globalObject, *module));
    // Under a mock the original has its own key and outlives the entry. If the end of the mock moved it back under this key, it goes with the entry.
    auto* mocks = globalObject->onLoadPlugins.virtualModules;
    if (module && AOT::isEvicted(globalObject, *module) && AOT::wasOriginalRestoredToOwnKey(globalObject, *module) && !(mocks && mocks->contains(key)))
        AOT::clearRetainedOriginalExports(globalObject, *module);
    evictFromProgram(globalObject, key, [](JSGlobalObject* realm, AOT::ModuleID module) {
        if (AOT::isLoadInFlight(realm, module))
            return;
        if (AOT::isDisplacedByMock(realm, module))
            AOT::didDeleteDisplacedModuleEntry(realm, module);
        else
            AOT::didDeleteRequireCacheEntry(realm, module);
    });
    RETURN_IF_EXCEPTION(scope, );
    if (module && AOT::isLoadInFlight(globalObject, *module))
        return;
    RELEASE_AND_RETURN(scope, didDeleteModuleMockKey(globalObject, key));
}

bool didStashCompiledFile(Zig::GlobalObject* globalObject, const String& key)
{
    auto module = reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    if (!module || !AOT::isDisplacedByMock(globalObject, *module) || AOT::isUnderActualKey(globalObject, *module))
        return false;
    AOT::setIsUnderActualKey(globalObject, *module, true);
    return true;
}

bool isCompiledOriginalRetained(Zig::GlobalObject* globalObject, const String& key)
{
    auto module = reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    return module && AOT::isEvicted(globalObject, *module) && AOT::retainedOriginalExports(globalObject, *module);
}

bool willUnmockCompiledFile(Zig::GlobalObject* globalObject, const String& key, bool restoresOriginal, bool isReplacedByLaterMock)
{
    auto module = reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    if (!module)
        return false;
    auto keyOfOriginal = Identifier::fromString(getVM(globalObject), makeString(key, "?actual"_s));
    if (auto* entry = testFileModuleLoader(globalObject)->registryEntry(keyOfOriginal); entry && entry->record() && AOT::isCompiledModuleRecord(entry->record()))
        testFileModuleLoader(globalObject)->removeEntry(keyOfOriginal);
    AOT::setWasOriginalRestoredToOwnKey(globalObject, *module, restoresOriginal);
    bool isUnderActualKey = AOT::isUnderActualKey(globalObject, *module) || ranDuringWaitingMock(globalObject, *module);
    bool mayLeaveProgram = !AOT::rejectsReload(globalObject, *module);
    bool runsAtNextLoad = isUnderActualKey && !restoresOriginal && !isReplacedByLaterMock && AOT::hasRequireCacheEntry(globalObject, *module) && (mayLeaveProgram || !AOT::isESModule(*module));
    AOT::setIsUnderActualKey(globalObject, *module, isUnderActualKey && !restoresOriginal && !(runsAtNextLoad && mayLeaveProgram));
    if (runsAtNextLoad && mayLeaveProgram)
        AOT::retainOriginalExports(globalObject, *module);
    return runsAtNextLoad;
}

void didUnmockCompiledFile(Zig::GlobalObject* globalObject, const String& key, bool runsAtNextLoad, bool restoresOriginal, bool factoryIsPending)
{
    // Nothing is under the file's own key, so the next load evaluates the file. If the build has not seen that the file may leave the program, its compiled body runs again,
    // and the evaluation under the key of the original is kept for the next mock. Not if this end restored a preload mock, or while the factory of the ended mock is pending.
    if (auto file = runsAtNextLoad ? compiledModuleForPath(key) : std::nullopt; file && AOT::rejectsReload(globalObject, *file)) {
        if (!factoryIsPending && !AOT::hasActiveMock(globalObject, *file) && !AOT::hasPendingMock(globalObject, *file))
            AOT::stashActualKeyExports(globalObject, *file);
        return;
    }
    if (runsAtNextLoad)
        return didDeleteRequireCacheEntry(globalObject, key);
    auto module = restoresOriginal && reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    if (!module || !AOT::isEvicted(globalObject, *module) || AOT::isESModule(*module))
        return;
    // The program stored its own module meanwhile, so the file has left the program. The end of the mock moves the original back under the file's key.
    JSValue original = AOT::retainedOriginalExports(globalObject, *module);
    if (!original)
        return;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    // An earlier end created the module object, the later mock stashed it, and the loader's own move restored it.
    JSValue moved = Bun::testFileRequireMap(globalObject)->get(globalObject, jsStringWithCache(vm, key));
    RETURN_IF_EXCEPTION(scope, );
    if (auto* present = moved.isCell() ? dynamicDowncast<JSCommonJSModule>(moved.asCell()) : nullptr) {
        JSValue exports = present->exportsObject();
        RETURN_IF_EXCEPTION(scope, );
        if (exports == original)
            return;
    }
    JSObject* held = AOT::retainedOriginalModuleObject(globalObject, *module);
    auto* back = held ? dynamicDowncast<JSCommonJSModule>(held) : nullptr;
    if (back)
        back->putDirect(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), original, 0);
    else
        back = JSCommonJSModule::create(globalObject, key, original, true, JSValue());
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    Bun::testFileRequireMap(globalObject)->set(globalObject, jsStringWithCache(vm, key), back);
}

void willMockReloadedFile(Zig::GlobalObject* globalObject, const String& key, JSValue loadedExports)
{
    auto module = reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    // What an earlier mock's end restored is not a new load.
    if (module && AOT::isEvicted(globalObject, *module) && AOT::retainedOriginalExports(globalObject, *module) != loadedExports)
        AOT::clearRetainedOriginalExports(globalObject, *module);
}

void willResetModules(Zig::GlobalObject* globalObject, ASCIILiteral call, bool keepsPackages)
{
    if (!hasCompiledModules() || !reloadsFilesFromDisk())
        return;
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    AOT::finishLoadsAwaitingLoader(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    String packages = makeString(PLATFORM_SEP, "node_modules"_s, PLATFORM_SEP);
    // isExternalizedByVitest(): Vitest loads an ES module that Node would read as CommonJS like the project's modules, and resets it with them.
    auto isKept = [&](const String& path) {
        auto module = findModuleForPath(path);
        // It counts as evaluated and is evicted with failed modules, after what the reset evicts.
        if (module && AOT::mockedModuleEvaluationError(globalObject, *module))
            return true;
        if (!keepsPackages || !path.contains(packages))
            return false;
        if (!module || !AOT::isESModule(*module))
            return true;
        BunString borrowedPath = Bun::toString(path);
        return Bun__isESModuleByExtensionOrPackageType(globalObject, &borrowedPath);
    };
    Vector<String> files;
    AOT::forEachRequireCacheKey(globalObject, [&](const String& path) {
        if (!isKept(path))
            files.append(path);
    });
    // A module that awaits at top level, or waits for one that does, finishes, and the next import loads it again.
    AOT::forEachEvaluatingAsyncModule(globalObject, [&](const String& path) {
        if (!isKept(path) && !files.contains(path))
            files.append(path);
    });
    // So is the original of a mock over a file that the program replaced with its own module.
    AOT::forEachModuleWithProgramEntry(globalObject, [&](const String& path) {
        if (!isKept(path) && !files.contains(path))
            files.append(path);
    });
    // All or nothing.
    for (auto& file : files) {
        auto module = findModuleForPath(file);
        if (!module || !AOT::rejectsReload(globalObject, *module))
            continue;
        throwException(globalObject, scope, createError(globalObject, makeString("Cannot load '"_s, file, "' again after "_s, call, ": the build found nothing that calls it, so the code that imports the file was compiled for a module that loads once. Call it in a file that the tests import."_s)));
        return;
    }
    AOT::clearMockLoadErrors(globalObject);
    AOT::discardDetachedLoadErrors(globalObject);
    // What a preload or its hook resets is not restored.
    auto takeOut = JSMock__isInPreload(globalObject) ? AOT::didDeleteRequireCacheEntry : AOT::didResetModule;
    for (auto& file : files) {
        evictFromProgram(globalObject, file, takeOut);
        RETURN_IF_EXCEPTION(scope, );
    }
    AOT::resetModulesAfterEvaluation(globalObject, [&](const String& path) { return isKept(path); });
}

Vector<String> restorePreloadModules(Zig::GlobalObject* globalObject)
{
    Vector<String> files;
    if (hasCompiledModules() && reloadsFilesFromDisk())
        AOT::restoreRetainedModules(globalObject, [&](const String& path) { files.append(path); });
    return files;
}

bool requireCacheListsCompiledFiles()
{
    return reloadsFilesFromDisk();
}

bool isLibraryModuleInRequireCache(Zig::GlobalObject* globalObject, const String& key)
{
    return hasCompiledModules() && AOT::findLibraryModuleInRequireCache(globalObject, key);
}

static std::optional<AOT::ModuleID> evaluatedProgramFile(Zig::GlobalObject* globalObject, const String& key)
{
    if (!reloadsFilesFromDisk())
        return std::nullopt;
    auto module = compiledModuleForPath(key);
    // `bun test` evicts a file that imported a mock together with the mock, and reloads it when a graph reaches it.
    // A mock that was loaded since then is under the key.
    if (!module || !AOT::hasRequireCacheEntry(globalObject, *module) || (AOT::wasReleasedByLoader(globalObject, *module) && !AOT::hasActiveMock(globalObject, *module)) || AOT::hasPendingMock(globalObject, *module) || AOT::wasActiveMockEntryRemoved(globalObject, *module))
        return std::nullopt;
    return AOT::hasIntactOriginal(globalObject, *module) && !AOT::hasActiveMock(globalObject, *module) ? std::nullopt : module;
}

bool isEvaluatedCompiledFile(Zig::GlobalObject* globalObject, const String& key)
{
    return isLibraryModuleInRequireCache(globalObject, key) || evaluatedProgramFile(globalObject, key);
}

JSValue compiledRequireCacheEntry(Zig::GlobalObject* globalObject, const String& key)
{
    if (auto module = AOT::findLibraryModuleInRequireCache(globalObject, key))
        return AOT::requireCacheEntry(globalObject, *module);
    if (auto module = evaluatedProgramFile(globalObject, key))
        return AOT::requireCacheEntry(globalObject, *module);
    return {};
}

bool isRecordOfCompiledModule(AbstractModuleRecord* record)
{
    return record->vm().hasCompiledCode() && AOT::isCompiledModuleRecord(record);
}

bool isRecordOfCompiledFile(AbstractModuleRecord* record)
{
    if (!isRecordOfCompiledModule(record))
        return false;
    auto module = compiledModuleForPath(record->moduleKey().string());
    return module && !AOT::isOfLibrary(*module);
}

void forEachEvaluatedCompiledFile(Zig::GlobalObject* globalObject, const WTF::Function<void(const String&)>& functor)
{
    if (!hasCompiledModules())
        return;
    if (reloadsFilesFromDisk()) {
        AOT::forEachRequireCacheKey(globalObject, [&](const String& path) {
            if (evaluatedProgramFile(globalObject, path))
                functor(path);
        });
    }
    AOT::forEachLibraryModuleInRequireCache(globalObject, functor);
}

// `require.cache[name] = { exports: fake }` with name "fs": overridableRequire() would return the entry for require("fs").
static void willSetNodeBuiltinCacheEntry(Zig::GlobalObject* globalObject, const String& name)
{
    BunString nameArgument = Bun::toString(name);
    BunString path = Bun__AOT__nodeModuleNamedWithoutPrefix(&nameArgument);
    if (path.isDead())
        return;
    if (auto module = findModuleForPath(path.transferToWTFString()))
        AOT::willSetBuiltinCacheEntry(globalObject, *module, name);
}

void willSetRequireCacheEntry(Zig::GlobalObject* globalObject, const String& key, JSValue entry)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto module = compiledModuleForPath(key);
    if (!module) {
        if (!entry.toBoolean(globalObject))
            return;
        // overridableRequire() finds Bun's own native modules, like "bun:jsc", under their only name.
        if (auto nativeModule = findModuleForPath(key))
            RELEASE_AND_RETURN(scope, AOT::willSetRequireCacheEntry(globalObject, *nativeModule, entry));
        RELEASE_AND_RETURN(scope, willSetNodeBuiltinCacheEntry(globalObject, key));
    }
    // `require.cache[path] = undefined`: overridableRequire() only uses a truthy entry.
    if (!entry.toBoolean(globalObject)) {
        if (reloadsFilesFromDisk() && !AOT::isDisplacedByMock(globalObject, *module) && !ranDuringWaitingMock(globalObject, *module))
            AOT::willClearRequireCacheEntry(globalObject, *module);
        RETURN_IF_EXCEPTION(scope, );
        if (reloadsFilesFromDisk() && !ranDuringWaitingMock(globalObject, *module) && !AOT::isLoadInFlight(globalObject, *module) && !AOT::wasLoadedByImport(globalObject, *module))
            RELEASE_AND_RETURN(scope, didDeleteModuleMockKey(globalObject, key));
        return;
    }
    if (reloadsFilesFromDisk() && !ranDuringWaitingMock(globalObject, *module) && !AOT::isLoadInFlight(globalObject, *module) && !AOT::wasLoadedByImport(globalObject, *module))
        didDeleteModuleMockKey(globalObject, key);
    RETURN_IF_EXCEPTION(scope, );
    // `require.cache[path] = { exports: fake }`, as tests replace a CommonJS module.
    if (reloadsFilesFromDisk())
        RELEASE_AND_RETURN(scope, AOT::willReplaceRequireCacheEntry(globalObject, *module));
    RELEASE_AND_RETURN(scope, AOT::willSetRequireCacheEntry(globalObject, *module, entry));
}

void willSetExtensionLoader(Zig::GlobalObject* globalObject, StringView extension)
{
    // Tests load or inspect files of their own kind this way. Outside of tests imports are bound for good: the loader is stored,
    // and is only called for files that are requested under computed names, as in an executable of `bun build --compile`.
    if (!hasCompiledModules())
        return;
    if (reloadsFilesFromDisk())
        AOT::willSetExtensionLoader(globalObject, extension);
    else
        AOT::willChangeRequireOverride(globalObject, AOT::RequireOverride::ExtensionLoader, true);
}

static JSCommonJSModule* boundModuleOf(JSValue require)
{
    auto* bound = dynamicDowncast<JSBoundFunction>(require);
    return bound ? dynamicDowncast<JSCommonJSModule>(bound->boundThis()) : nullptr;
}

// The program can overwrite `filename`, and createRequire() accepts any path, but the identity of the object cannot change.
String requesterForRequire(JSCommonJSModule* target, const String& written)
{
    JSCommonJSModule* requirer = target->m_parent.get();
    // `createRequire(__dirname + "/locales/")`: no file has the path, yet compiled code is the requester.
    // For any other object, or none, the path is unverified.
    return requirer && (compiledModuleOf(requirer) || requirer->isCreatedByImageCode) ? AOT::compiledCodeRequester() : written;
}

std::optional<bool> willResolveName(JSGlobalObject* globalObject, JSValue requirer)
{
    if (!keepsFilesFromCodeFromDisk())
        return std::nullopt;
    auto* module = dynamicDowncast<JSCommonJSModule>(requirer);
    bool isCodeFromDisk = module && !compiledModuleOf(module) && !module->isCreatedByImageCode;
    return Bun__AOT__setResolvesForCodeFromDisk(globalObject, isCodeFromDisk);
}

void didResolveName(JSGlobalObject* globalObject, bool previous)
{
    Bun__AOT__setResolvesForCodeFromDisk(globalObject, previous);
}

// bun:main is a host module, which starts the program by importing the entry point. No source text gets that key.
// The loader assigns the key of a compiled record, so code cannot forge it.
const String& requesterForImporter(const String& importer)
{
    return importer.isEmpty() || importer == "bun:main"_s || compiledModuleForPath(importer) ? AOT::compiledCodeRequester() : importer;
}

// import() in compiled code does not reach the host's entry. The origin of any other code is unverified.
// Without restrictions the requester only affects the wording of an error, so use the origin.
const String& requesterForUncompiledImportCall(const String& origin)
{
    return requesterForImporter(uncompiledImportReferrer(origin));
}

const String& uncompiledImportReferrer(const String& origin)
{
    static NeverDestroyed<const String> nobody(MAKE_STATIC_STRING_IMPL("."));
    return keepsFilesFromCodeFromDisk() ? nobody.get() : origin;
}

void didCreateRequire(VM& vm, CallFrame* callFrame, JSObject* require)
{
    JSCommonJSModule* module = hasCompiledModules() ? boundModuleOf(require) : nullptr;
    if (!module)
        return;
    // Compiled code that names createRequire() passes a private function as `this`. Other calls have an unknown caller.
    JSValue word = require->globalObject()->getDirect(vm, WebCore::builtinNames(vm).createCommonJSModulePrivateName());
    module->isCreatedByImageCode = word && callFrame->thisValue() == word;
}

void didCreateRequireOfCompiledModule(JSObject* require)
{
    if (JSCommonJSModule* module = boundModuleOf(require))
        module->isCreatedByImageCode = true;
}

static bool isRequireFunctionOf(Zig::GlobalObject* globalObject, JSCommonJSModule* module, JSValue function)
{
    return boundModuleOf(function) == module && uncheckedDowncast<JSBoundFunction>(function)->targetFunction() == globalObject->requireFunctionUnbound();
}

static JSCell* ensureResolveFunction(JSGlobalObject* realm, JSObject* requirer, JSCell* cachedOrNull)
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(realm);
    auto& vm = getVM(globalObject);
    JSObject* unbound = globalObject->requireResolveFunctionUnbound();
    auto* held = cachedOrNull ? dynamicDowncast<JSBoundFunction>(cachedOrNull) : nullptr;
    if (held && held->targetFunction() == unbound && held->boundThis() == JSValue(requirer) && !held->boundArgsLength())
        return held;
    return JSBoundFunction::create(vm, globalObject, unbound, requirer, ArgList(), 1, Bun::commonStrings(vm).resolveString(), makeSource("resolve"_s, SourceOrigin(), SourceTaintedOrigin::Untainted));
}

// As in an uncompiled run, evaluating a module replaces what the program stored in `module.require`.
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

// `module.exports` of a compiled file is a variable that its code accesses without the module object.
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
    JSValue exportsAsData = jsUndefined();
    // putDirectCustomAccessor() requires a property that the object does not have.
    if (!traits.contains(AOT::ModuleObjectTrait::IsNotCommonJSModule))
        exportsAsData = JSValue();
    JSCommonJSModule* module = JSCommonJSModule::create(globalObject, path, exportsAsData, !traits.contains(AOT::ModuleObjectTrait::IsRequiredESModule), JSValue());
    RETURN_IF_EXCEPTION(scope, void());
    RELEASE_AND_RETURN(scope, storeOnModuleObject(globalObject, module, path, compiled, traits, out));
}

static bool bindExportsVariable(Zig::GlobalObject* globalObject, JSCommonJSModule* module)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const Identifier& exportsName = WebCore::clientData(vm)->builtinNames().exportsPublicName();
    // putDirectCustomAccessor() requires a property that the object does not have, but the object of require() has it.
    if (JSValue laid = module->getDirect(vm, exportsName)) {
        if (laid.isCustomGetterSetter())
            return true;
        // The program may have made the property non-configurable.
        bool isDeleted = JSCell::deleteProperty(module, globalObject, exportsName);
        RETURN_IF_EXCEPTION(scope, false);
        if (!isDeleted)
            return false;
    }
    auto* accessors = CustomGetterSetter::create(vm, getterExportsOfCompiledModule, setterExportsOfCompiledModule);
    module->putDirectCustomAccessor(vm, exportsName, accessors, PropertyAttribute::CustomValue | 0);
    return true;
}

// Once the file runs, the `exports` of its own `module` is the program's variable.
static bool tryBindExportsVariable(Zig::GlobalObject* globalObject, JSCommonJSModule* target, AOT::ModuleID module)
{
    if (AOT::moduleObjectWithExportsVariable(globalObject, module) != target)
        return false;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    target->compiledModule = module.index();
    bool isLaid = bindExportsVariable(globalObject, target);
    RETURN_IF_EXCEPTION(scope, false);
    // Not stored over a read-only property: the exports are in the variable only.
    if (isLaid)
        AOT::didBindExportsVariable(globalObject, module);
    return isLaid;
}

static void storeOnModuleObject(Zig::GlobalObject* globalObject, JSCommonJSModule* module, JSString* path, AOT::ModuleID compiled, OptionSet<AOT::ModuleObjectTrait> traits, AOT::ModuleObjects& out)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    module->compiledModule = compiled.index();
    if (traits.contains(AOT::ModuleObjectTrait::IsMain))
        module->m_id.set(vm, module, jsString(vm, String("."_s)));
    if (traits.contains(AOT::ModuleObjectTrait::HasExportsVariable)) {
        bindExportsVariable(globalObject, module);
        RETURN_IF_EXCEPTION(scope, void());
    }
    out.module = module;
    if (traits.contains(AOT::ModuleObjectTrait::IsNotCommonJSModule))
        return;
    scope.release();
    out.require = attachRequireFunction(vm, globalObject, module, path);
}

// The program may have stored the `require` of another file in `import.meta.require`: that file is the requester.
static void storeRequesterOnRequirer(JSCommonJSModule* requirer, AOT::ModuleID asker)
{
    requirer->isCreatedByImageCode = true;
    if (!requirer->areChildrenListedByEngine())
        requirer->setRequestingCompiledModule(asker.index());
}

static void createRequirer(JSGlobalObject* realm, JSObject* importMeta, AOT::ModuleID asker, AOT::ModuleObjects& out)
{
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* meta = uncheckedDowncast<Zig::ImportMetaObject>(importMeta);
    out.require = meta->requireProperty.getInitializedOnMainThread(meta);
    RETURN_IF_EXCEPTION(scope, void());
    // The engine requests the loader of a module of the image.
    if (JSCommonJSModule* module = boundModuleOf(out.require)) [[likely]] {
        storeRequesterOnRequirer(module, asker);
        out.module = module;
        return;
    }

    // The program replaced import.meta.require with a value that is not bound to a module object.
    String path = meta->pathProperty.getInitializedOnMainThread(meta)->value(realm);
    RETURN_IF_EXCEPTION(scope, void());
    JSObject* ownRequire = JSCommonJSModule::createBoundRequireFunction(vm, realm, path, meta->moduleGraph());
    RETURN_IF_EXCEPTION(scope, void());
    JSCommonJSModule* module = boundModuleOf(ownRequire);
    storeRequesterOnRequirer(module, asker);
    out.module = module;
}

static void pushObservableChild(JSGlobalObject* realm, JSObject* parent, JSObject* child)
{
    auto& vm = getVM(realm);
    JSFunction* function = JSFunction::create(vm, realm, WebCore::compiledCommonJSPushObservableChildCodeGenerator(vm), realm);
    MarkedArgumentBuffer arguments;
    arguments.append(uncheckedDowncast<JSCommonJSModule>(parent)->m_childrenValue.get());
    arguments.append(child);
    call(realm, function, getCallData(function), jsUndefined(), arguments);
}

static void createChildrenArray(JSGlobalObject* realm, JSCommonJSModule* parent)
{
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer children;
    for (WriteBarrier<Unknown> child : parent->m_children) {
        bool isListed = false;
        for (size_t index = 0; index < children.size(); ++index)
            isListed |= children.at(index) == child.get();
        if (!isListed)
            children.append(child.get());
    }
    JSArray* list = constructArray(realm, static_cast<ArrayAllocationProfile*>(nullptr), children);
    RETURN_IF_EXCEPTION(scope, void());
    parent->m_childrenValue.set(vm, parent, list);
    WTF::Locker locker { parent->cellLock() };
    parent->m_children.clear();
}

bool appendNewChildrenOfCompiledModule(JSGlobalObject* realm, JSCommonJSModule* parent)
{
    auto compiled = compiledModuleOfRequirer(parent);
    if (!compiled)
        return true;
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool areShown = AOT::forEachNewChild(parent->globalObject(), *compiled, [&](JSObject* child) {
        if (!parent->m_childrenValue && !child->inherits<JSCommonJSModule>()) {
            createChildrenArray(realm, parent);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (parent->m_childrenValue) {
            pushObservableChild(realm, parent, child);
            return;
        }
        WTF::Locker locker { parent->cellLock() };
        parent->m_children.append(WriteBarrier<Unknown>());
        parent->m_children.last().set(vm, parent, child);
    });
    RETURN_IF_EXCEPTION(scope, false);
    return areShown;
}

void dropNewChildrenOfCompiledModule(JSCommonJSModule* parent)
{
    if (auto compiled = compiledModuleOfRequirer(parent))
        AOT::clearNewChildren(parent->globalObject(), *compiled);
}

static void appendModuleChildren(JSGlobalObject* realm, JSObject* module, JSObject* childOrNull)
{
    auto* parent = dynamicDowncast<JSCommonJSModule>(module);
    if (!parent)
        return;
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool hasLeftCompiledModule = parent->compiledModule == JSCommonJSModule::noCompiledModule;
    // m_children only has module objects. Stand-ins go into the array itself.
    if (!parent->m_childrenValue && childOrNull && hasLeftCompiledModule && !childOrNull->inherits<JSCommonJSModule>()) {
        createChildrenArray(realm, parent);
        RETURN_IF_EXCEPTION(scope, void());
    }
    // The array is created when it is first read: from the compiled module or, if the object was detached, from m_children.
    if (!parent->m_childrenValue) {
        if (childOrNull && hasLeftCompiledModule) {
            WTF::Locker locker { parent->cellLock() };
            parent->m_children.append(WriteBarrier<Unknown>());
            parent->m_children.last().set(vm, parent, childOrNull);
        }
        return;
    }
    scope.release();
    if (childOrNull)
        pushObservableChild(realm, parent, childOrNull);
    else
        appendNewChildrenOfCompiledModule(realm, parent);
}

JSObject* parentOfCompiledModule(JSCommonJSModule* module)
{
    auto compiled = compiledModuleOf(module);
    JSObject* parent = compiled ? AOT::parentModuleObject(module->globalObject(), *compiled) : nullptr;
    if (parent && !parent->inherits<JSCommonJSModule>())
        module->m_overriddenParent.set(getVM(module->globalObject()), module, parent);
    return parent;
}

static void didDiscardModuleEvaluation(JSGlobalObject* realm, JSObject* object, bool willEvaluateAgain)
{
    auto* module = uncheckedDowncast<JSCommonJSModule>(object);
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    appendNewChildrenOfCompiledModule(realm, module);
    RETURN_IF_EXCEPTION(scope, void());
    if (!module->m_overriddenParent && !module->m_parent && !module->m_isParentStored) {
        JSObject* parent = parentOfCompiledModule(module);
        RETURN_IF_EXCEPTION(scope, void());
        if (parent)
            module->m_overriddenParent.set(vm, module, parent);
    }
    if (willEvaluateAgain)
        module->compiledModule = JSCommonJSModule::noCompiledModule;
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
        // `Bun.main = require.resolve("./other.cjs")` stores the path on the build machine.
        if (String known = pathInExecutable(path); !known.isNull())
            path = known;
        if (auto module = compiledModuleForRequest(globalObject, path, false, AOT::LoadKind::Require)) {
            JSObject* moduleObject = AOT::mainModuleObject(globalObject, *module);
            RETURN_IF_EXCEPTION(scope, {});
            return moduleObject ? JSValue(moduleObject) : jsUndefined();
        }
    }
    RELEASE_AND_RETURN(scope, globalObject->requireMap()->get(globalObject, main));
}

void willSetMainModulePath(Zig::GlobalObject* globalObject, JSValue path)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue main = JSValue::decode(BunObject_getter_main(globalObject));
    RETURN_IF_EXCEPTION(scope, void());
    bool isStoredAlready = JSValue::strictEqual(globalObject, main, path);
    RETURN_IF_EXCEPTION(scope, void());
    if (!isStoredAlready)
        RELEASE_AND_RETURN(scope, AOT::willSetMainModulePath(globalObject));
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
    JSObject* object = value.getObject();
    if (auto* namespaceObject = object ? dynamicDowncast<JSModuleNamespaceObject>(object) : nullptr) {
        auto& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        PropertyNameArrayBuilder exported(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        namespaceObject->methodTable()->getOwnPropertyNames(namespaceObject, globalObject, exported, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, nullptr);
        for (const Identifier& name : exported) {
            JSValue exportedValue = namespaceObject->get(globalObject, name);
            RETURN_IF_EXCEPTION(scope, nullptr);
            names.append(name);
            values.append(exportedValue);
        }
        return nullptr;
    }
    if (object)
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

    // The name of a built-in module resolves to itself.
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

static thread_local bool isDiagnosingFailure = false;

bool isDiagnosingLoadFailure()
{
    return isDiagnosingFailure;
}

// The file is read and parsed as by `require`, but not evaluated.
static JSValue createLoadError(JSGlobalObject* realm, const String& path)
{
    // For a data file that failed to parse, the executable has the position and nothing to parse again.
    BunString pathOfForm = Bun::toString(path);
    if (JSValue refused = JSValue::decode(Bun__compiledProgramErrorOfRefusedData(realm, &pathOfForm)))
        return refused;
    // The build appends the type of a data file that is only imported with that type: "/project/odd.txt?json".
    size_t mark = path.reverseFind('?');
    String type = mark == notFound ? String() : path.substring(mark + 1);
    bool isRequestedWithType = type == "json"_s || type == "jsonc"_s || type == "json5"_s || type == "toml"_s || type == "yaml"_s;
    String file = isRequestedWithType ? path.left(mark) : path;
    BunString specifier = Bun::toString(file);
    BunString typeAttribute = Bun::toString(type);
    // The name of a built-in module is not a path. Reading one that is not in the executable fails as in `bun run`.
    // The executable has a file that the build could not process. Its loader reports the error.
    if (!Bun__compiledProgramRunsInPlace() && isAbsolutePath(file) && !Bun__compiledProgramHoldsFileAsItIs(&specifier))
        return {};
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(realm);
    ErrorableResolvedSource source;
    SetForScope isAsking(isDiagnosingFailure, true);
    Bun__transpileFile(globalObject->bunVM(), globalObject, &specifier, &specifier, isRequestedWithType ? &typeAttribute : nullptr, &source, false, true, BunLoaderTypeNone);
    if (!source.success)
        return JSValue::decode(source.result.err);
    // The engine parses the text of a JSON file next, and what that throws stays thrown.
    if (source.result.value.tag == SyntheticModuleType::JSONForObjectLoader) {
        auto scope = DECLARE_THROW_SCOPE(realm->vm());
        JSC::JSONParseWithException(realm, source.result.value.source_code.toWTFString(BunString::NonNull));
        RELEASE_AND_RETURN(scope, JSValue());
    }
    return {};
}

static JSValue createModuleNotFoundError(JSGlobalObject* realm, const String& specifier, const String& importer, bool isForRequire)
{
    // `bun run` identifies the importer by the path of its source URL: "/data:.." in a Worker of a data: URL.
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

// Only `bun:test` installs mocks, so this is trimmed with it.
static bool runMock(JSGlobalObject* globalObject, AOT::ModuleID module)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, Abort, bool)
    return Zig::runCompiledMock(uncheckedDowncast<Zig::GlobalObject>(globalObject), module);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static JSValue requireOriginal(JSGlobalObject* globalObject, AOT::ModuleID module, bool isForOwnFactory)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, Abort, JSValue)
    return Zig::requireCompiledOriginal(uncheckedDowncast<Zig::GlobalObject>(globalObject), module, isForOwnFactory);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static JSPromise* evaluateOriginalBeforeFactory(JSGlobalObject* globalObject, AOT::ModuleID module, bool& hasFactory)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, Abort, JSPromise*)
    return Zig::evaluateCompiledOriginalBeforeFactory(uncheckedDowncast<Zig::GlobalObject>(globalObject), module, hasFactory);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool reinstallMocks(JSGlobalObject* globalObject, const ScopedLambda<bool(AOT::ModuleID)>& isReached)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, Abort, bool)
    return Zig::reinstallBodyMocks(uncheckedDowncast<Zig::GlobalObject>(globalObject), isReached);
    BUN_END_REMOVABLE_ENTRY_POINT
}

// Called for every import().
static JSPromise* nextPendingFactory(JSGlobalObject* globalObject, const ScopedLambda<bool(AOT::ModuleID)>& isInGraph, AOT::PendingFactoryRequester askedBy, JSValue& state)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, JSPromise*)
    return Zig::nextPendingCompiledFactory(defaultGlobalObject(globalObject), isInGraph, askedBy, state);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static uint64_t pendingFactoryCallID(JSGlobalObject* globalObject, AOT::ModuleID module, bool& shouldRejectEveryRequire)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, uint64_t)
    return Zig::pendingCompiledFactoryCallID(defaultGlobalObject(globalObject), module, shouldRejectEveryRequire);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool hasPendingPatch(JSGlobalObject* globalObject, AOT::ModuleID module)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::hasPendingCompiledPatch(defaultGlobalObject(globalObject), module);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool isFactoryCallPending(JSGlobalObject* globalObject, uint64_t call)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::isCompiledFactoryCallPending(defaultGlobalObject(globalObject), call);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool isAwaitingOriginalBody(JSGlobalObject* globalObject, AOT::ModuleID module)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::isMockAwaitingBody(defaultGlobalObject(globalObject), module);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool isInPendingFactoryChain(JSGlobalObject* globalObject, AOT::ModuleID file, AOT::ModuleID mocked)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::isInCompiledFactoryChain(defaultGlobalObject(globalObject), file, mocked);
    BUN_END_REMOVABLE_ENTRY_POINT
}

void recordRepeatedFileRun(JSGlobalObject*, const String& path, ASCIILiteral why);

static void didRunOriginal(JSGlobalObject* globalObject, const String& path, AOT::OriginalRun run)
{
    switch (run) {
    case AOT::OriginalRun::FromSource:
        return recordFileRunFromSource(globalObject, path, "it was imported under a query"_s);
    case AOT::OriginalRun::Failed:
        return recordRepeatedFileRun(globalObject, path, "its top-level code threw beside its mock"_s);
    case AOT::OriginalRun::PrivateCopy:
        return recordRepeatedFileRun(globalObject, path, "a mock's factory requested it while it waited for that mock"_s);
    case AOT::OriginalRun::SecondInstance:
        return recordRepeatedFileRun(globalObject, path, "importers that bypass its mock share no instance with the mock's factory"_s);
    case AOT::OriginalRun::MockedDuringImport:
        return recordRepeatedFileRun(globalObject, path, "it was mocked while an import() of it was in flight"_s);
    case AOT::OriginalRun::MockAddsNames:
        return recordRepeatedFileRun(globalObject, path, "its mock adds names, and a file has another `export *` beside the one of it"_s);
    case AOT::OriginalRun::LoadsItsImporter:
        return recordRepeatedFileRun(globalObject, path, "its top-level code loads a file that loads it"_s);
    case AOT::OriginalRun::ExportsNamesOfMocks:
        return recordRepeatedFileRun(globalObject, path, "it has an `export *` of a file that imports a mocked file"_s);
    case AOT::OriginalRun::RunsAmongLoads:
        return recordRepeatedFileRun(globalObject, path, "another import, mock or factory was under way when its top-level code ran"_s);
    case AOT::OriginalRun::RequireRejected:
        return recordRepeatedFileRun(globalObject, path, "a require() of it was rejected"_s);
    case AOT::OriginalRun::AwaitsMockedAgain:
        return recordRepeatedFileRun(globalObject, path, "its top-level code awaits, and it was mocked again"_s);
    case AOT::OriginalRun::ResetWhileAwaiting:
        return recordRepeatedFileRun(globalObject, path, "the modules were reset while its top-level code awaited"_s);
    case AOT::OriginalRun::BuiltinMockChanged:
        return recordRepeatedFileRun(globalObject, path, "a mock of a built-in module that it imports was replaced or has ended"_s);
    case AOT::OriginalRun::TestFilesRunAgain:
        return recordRepeatedFileRun(globalObject, path, "a later run of its test file may get the same original"_s);
    case AOT::OriginalRun::LoadFailsToLink:
        return recordRepeatedFileRun(globalObject, path, "a file that imports it imports a name that doesn't exist"_s);
    }
}

static bool hasRunningFactory(JSGlobalObject* globalObject)
{
    if (!isBunTest)
        return false;
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::hasRunningModuleMock(defaultGlobalObject(globalObject));
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool isPatchPending(JSGlobalObject* globalObject, const ScopedLambda<String()>& path)
{
    if (!isBunTest)
        return false;
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::isCompiledModulePatchPending(defaultGlobalObject(globalObject), path);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool requiresPatch(JSGlobalObject* globalObject, const ScopedLambda<String()>& path, JSObject*& exports)
{
    if (!isBunTest)
        return false;
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::requiresCompiledPatch(defaultGlobalObject(globalObject), path, exports);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static uint32_t willLoad(JSGlobalObject* globalObject, AOT::ModuleID callerModuleIfKnown, AOT::ModuleID asked, AOT::LoadKind loadedBy)
{
    if (!isBunTest)
        return 0;
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, Abort, uint32_t)
    return Zig::addToFactoryImportChains(defaultGlobalObject(globalObject), callerModuleIfKnown, asked, loadedBy);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static void didStartImport(JSGlobalObject* globalObject, JSPromise* import, const String& path, const ScopedLambda<bool(JSC::AOT::ModuleID)>& isReached)
{
    if (!isBunTest)
        return;
    Zig::didStartCompiledModuleImport(defaultGlobalObject(globalObject), isReached);
    didStartDynamicImport(defaultGlobalObject(globalObject), import, path);
}

// The importer's static imports are linked, but an import() in it resolves again.
static bool wasLinkedBeforeMock(JSGlobalObject* globalObject, const String& path, const String& importer)
{
    return defaultGlobalObject(globalObject)->onLoadPlugins.compiledImportersLinkedBeforeMocks.containsIf([&](const auto& linked) { return linked.mocked == path && linked.importer == importer; });
}

static bool shouldBypassMock(JSGlobalObject* globalObject, const String& path, const String& importer, bool isImport)
{
    // A later mock waits over the active one, and a require() cannot wait for its factory: as in ModuleLoader.cpp.
    if (!isImport && canRequireMockOriginalAt(defaultGlobalObject(globalObject), path))
        return true;
    // isExternalizedByVitest() recognizes ES modules by the loader's record, which a compiled one does not have.
    if (auto module = isImport ? findModuleForPath(importer) : std::nullopt; module && AOT::isESModule(*module)) {
        BunString borrowedPath = Bun::toString(importer);
        if (!Bun__isESModuleByExtensionOrPackageType(globalObject, &borrowedPath))
            return false;
    }
    return packageImportKey(defaultGlobalObject(globalObject), path, importer, isImport) != path;
}

static bool isMockHiddenFromRequirer(JSGlobalObject* globalObject, const String& path, const String& requirer)
{
    return packageImportKey(defaultGlobalObject(globalObject), path, requirer, false) != path;
}

static std::optional<bool> isInPreload(JSGlobalObject* globalObject)
{
    if (!isBunTest)
        return std::nullopt;
    return JSMock__isInPreload(defaultGlobalObject(globalObject));
}

static bool hasProgramSources(JSGlobalObject*)
{
    return true;
}

static bool hasSourceCache(JSGlobalObject* globalObject)
{
    return Bun::IsolatedModuleCache::canUse(globalObject->vm(), defaultGlobalObject(globalObject)->bunVM());
}

extern "C" bool Bun__AOT__isLoadingUnderVitest(void* bunVM);

static bool isLoadingUnderVitest(JSGlobalObject* globalObject)
{
    return Bun__AOT__isLoadingUnderVitest(defaultGlobalObject(globalObject)->bunVM());
}

static bool printsDataFileAsJavaScript(JSGlobalObject* globalObject, const String& path)
{
    BunString pathString = Bun::toString(path);
    return Bun__compiledProgramDataFileIsPrintedAsJavaScript(globalObject, &pathString);
}

extern "C" void Bun__compiledProgramWillRunTextOfFile(JSGlobalObject* globalObject, const BunString* specifier)
{
    String path = specifier->toWTFString(BunString::ZeroCopy);
    auto module = hasCompiledModules() ? compiledModuleForPath(path) : std::nullopt;
    if (!module || !AOT::isEvicted(globalObject, *module))
        return;
    if (!AOT::isDataFile(*module)) {
        recordFileRunFromSource(globalObject, path, "it was loaded a second time, or it changed on disk after the build"_s);
        return;
    }
    auto& plugins = defaultGlobalObject(globalObject)->onLoadPlugins;
    if (auto reset = plugins.dataFilesResetUnderMocks.find(path); reset != plugins.dataFilesResetUnderMocks.end() && reset->value != plugins.testFile) {
        plugins.dataFilesResetUnderMocks.remove(reset);
        recordRepeatedFileRun(globalObject, path, "the modules were reset while a mock was over it"_s);
    }
}

static void evictCachedSource(JSGlobalObject* globalObject, const String& path)
{
    Bun::IsolatedModuleCache::evict(globalObject->vm(), path);
}

static void crashWithReason(std::span<const char> reason)
{
    Bun__panic(reason.data(), reason.size());
}

bool decompressSource(std::span<uint8_t> text, std::span<const uint8_t> compressed)
{
    ZSTD_DCtx* context = ZSTD_createDCtx();
    bool isOpened = context && ZSTD_decompressDCtx(context, text.data(), text.size(), compressed.data(), compressed.size()) == text.size();
    ZSTD_freeDCtx(context);
    return isOpened;
}

static bool loadsSynchronously(JSGlobalObject* globalObject, AOT::ModuleID module)
{
    String path = AOT::modulePath(module);
    BunString pathArgument = Bun::toString(path);
    return Bun__AOT__isLoadedSynchronously(globalObject, &pathArgument);
}

// `bun test` reads the source on another thread, which takes longer than the runner needs to reach the file's `describe` callbacks, so an import() runs after them
// and gets a mock that one of them installs. The thread can lose that race on a quiet machine. Here the source is delayed by one turn instead.
static void fulfillFetchesInLaterTick(WebCore::ScriptExecutionContext& context, bool wasPostponed)
{
    context.postTaskAfterYield([wasPostponed](WebCore::ScriptExecutionContext& context) {
        // A task after the yield that an immediate posted runs in the same iteration, before the next immediates. The reader thread of `bun test` is slower.
        if (isBunTest && !wasPostponed && (Bun__AOT__isBetweenLoadOfTestFileAndItsCallbacks(context.globalObject()) || Bun__AOT__hasImmediatesYetToRun(context.globalObject()))) [[unlikely]]
            return fulfillFetchesInLaterTick(context, true);
        // As in `bun test`, an earlier read finishes first.
        std::optional<uint32_t> batch = AOT::firstDeferredBatchNumber(context.vm());
        if (!AOT::fulfillDeferredFetches(context.vm(), Bun__AOT__transpilerJobsCompleted(context.globalObject()))) [[unlikely]]
            return fulfillFetchesInLaterTick(context, wasPostponed);
        // Jobs and ticks that the delivery queued run here, so that the runtime sees where it ends: what a later turn requests is deferred again.
        defaultGlobalObject(context.globalObject())->drainMicrotasks();
        // `bun test` drains the microtasks between two sources that arrive in one turn.
        while (isBunTest && batch && AOT::firstDeferredBatchNumber(context.vm()) == batch && AOT::fulfillDeferredFetches(context.vm(), Bun__AOT__transpilerJobsCompleted(context.globalObject())))
            defaultGlobalObject(context.globalObject())->drainMicrotasks();
        AOT::didDrainDeferredFetchJobs(context.vm());
    });
}

static uint64_t scheduleFetchFulfillment(JSGlobalObject* globalObject)
{
    WebCore::ScriptExecutionContext& context = *defaultGlobalObject(globalObject)->scriptExecutionContext();
    // An executable has every source, so a waiting graph continues after the jobs, before timers and immediates, as in `bun run` and Node.js.
    if (!isBunTest) {
        context.postTask([](WebCore::ScriptExecutionContext& context) {
            AOT::fulfillDeferredFetches(context.vm());
        });
        return 0;
    }
    fulfillFetchesInLaterTick(context, false);
    // The fetches of a factory are not delayed after the reads from disk.
    return Zig::isInsideMockFactory(defaultGlobalObject(globalObject)) ? 0 : Bun__AOT__transpilerJobsScheduled(globalObject);
}

static bool isRequiredByOwnFactory(JSGlobalObject* globalObject, AOT::ModuleID required, AOT::ModuleID requirer)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::isRequiredByCompiledFactory(defaultGlobalObject(globalObject), required, requirer);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool isRequestedByPendingFactory(JSGlobalObject* globalObject, AOT::ModuleID module)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::isRequestedByCompiledFactory(defaultGlobalObject(globalObject), module);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool isESModuleInNode(JSGlobalObject* globalObject, const String& path)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    BunString borrowedPath = Bun::toString(path);
    return Bun__isESModuleByExtensionOrPackageType(globalObject, &borrowedPath);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool evictOriginal(JSGlobalObject* globalObject, const String& mocked)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::evictOriginalOfCommonJSFile(defaultGlobalObject(globalObject), mocked);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool wasFetchedByTestFile(JSGlobalObject* globalObject, const String& key)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return defaultGlobalObject(globalObject)->onLoadPlugins.testFileOfModule.get(key);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool isSpy(JSGlobalObject* globalObject, const String& mocked)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return isSpyMock(defaultGlobalObject(globalObject), mocked);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool hasSynchronousFactory(JSGlobalObject* globalObject, const String& mocked, bool isOriginalSynchronous)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return hasSynchronousMockFactory(defaultGlobalObject(globalObject), mocked, isOriginalSynchronous);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool deferPatchToNextLoad(JSGlobalObject* globalObject, AOT::ModuleID module, bool isFactoryPending)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::deferCompiledPatchToNextLoad(defaultGlobalObject(globalObject), module, isFactoryPending);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static const AOT::MockOperations* mockOperations()
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, const AOT::MockOperations*)
    return AOT::mockOperations();
    BUN_END_REMOVABLE_ENTRY_POINT
}

static uint64_t computeFileStamp(std::span<const char> path)
{
    return Bun__AOT__computeFileStamp(path.data(), path.size());
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
    &createLoadError,
    &appendModuleChildren,
    &findModuleWithAttributes,
    &ensureResolveFunction,
    &replacesNativeModule,
    &hasQueuedTicks,
    &isMainModuleImport,
    &didEvaluateMainModule,
    &createModuleNotFoundError,
    &requirePrototype,
    &runMock,
    &loadsSynchronously,
    &hasMatchingLoadPlugin,
    &hasResolvePlugins,
    &resolveWithPlugins,
    &resolveWithoutPlugins,
    &beginOrEndPluginResolutions,
    &mockOperations,
    &computeFileStamp,
    &shouldBypassMock,
    &wasLinkedBeforeMock,
    &isMockHiddenFromRequirer,
    &nextPendingFactory,
    &isInPreload,
    &reinstallMocks,
    &scheduleFetchFulfillment,
    &didStartImport,
    &hasProgramSources,
    &isRequestedByPendingFactory,
    &hasSourceCache,
    &crashWithReason,
    &decompressSource,
    &pendingFactoryCallID,
    &evaluateOriginalBeforeFactory,
    &isLoadingUnderVitest,
    &evictCachedSource,
    &printsDataFileAsJavaScript,
    &didDiscardModuleEvaluation,
    &isPatchPending,
    &hasRunningFactory,
    &willLoad,
    &isInPendingFactoryChain,
    &isRequiredByOwnFactory,
    &isFactoryCallPending,
    &isAwaitingOriginalBody,
    &didRunOriginal,
    &deferPatchToNextLoad,
    &Bun__AOT__runsTestFilesAgain,
    &requireOriginal,
    &wasFetchedByTestFile,
    &hasSynchronousFactory,
    &isSpy,
    &sourceAfterRelease,
    &hasPendingPatch,
    &evictOriginal,
    &requiresPatch,
    &isESModuleInNode,
};
// A member missing from the initializer is null, which tells the engine that the host does not support it.
static_assert(sizeof(AOT::ModuleHost) == 67 * sizeof(void*));

void recordRefusedLoad(JSGlobalObject*, const String& path);
bool recordAddonLoadedFromDisk(JSGlobalObject*, const String& path);

JSValue createNotInExecutableError(JSGlobalObject* globalObject, ErrorCode code, const String& path, NotInExecutable what)
{
    // --disallow-code-generation-from-strings=strict rejects code from disk also without --aot, and its error is expected.
    if (what == NotInExecutable::Code && isCodeGenerationFromStringsStrictByFlags())
        return createCodeGenerationFromStringsError(globalObject);
    BunString text = Bun::toString(path);
    // A Worker runs source text apart from the compiled program, and files with --aot-allow-code-from-disk.
    if (what == NotInExecutable::Code && (isDataOrBlobURL(path) || Bun__AOT__allowsCodeFromDisk())) {
        if (Bun__AOT__isWorkerTextRefusedByTrimming(globalObject, &text))
            return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it isn't in this executable, and --trim removed what a Worker needs to run code that wasn't compiled into it. Build without --trim."_s));
    }
    // `bun test --aot` makes no executable and takes no entry points.
    if (runsCompiledModules())
        recordRefusedLoad(globalObject, path);
    if (runsCompiledModules())
        return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it wasn't compiled with the program, and --aot only runs code that was. Import the file by a constant path, or add --aot-allow-code-from-disk."_s));
    return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it isn't in this executable, which only runs code that was compiled into it. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk."_s));
}

JSValue errorIfCodeOutsideImageIsRefused(JSGlobalObject* globalObject, ErrorCode code, const String& path)
{
    if (!hasCompiledModules() || isDiagnosingFailure)
        return {};
    // A test evicts a module from require.cache to run it again. Its source is on disk, and the build has seen it.
    if (isBunTest && runsCompiledModules() && isCompiledModule(path))
        return {};
    // The original of a mocked module is a second instance of the file, under a key of its own.
    if (isBunTest && runsCompiledModules()) {
        size_t query = path.find('?');
        if (query != notFound && (path.endsWith("actual"_s) || path.endsWith("actual&spy"_s)) && isCompiledModule(path.left(query))) {
            // It has the same imports as the compiled file.
            if (AOT::willRunCopyFromDisk(globalObject))
                return {};
            return createError(globalObject, code, makeString("Cannot load the original of '"_s, path.left(query), "' beside its mock: the build found nothing in this test run that asks for it, so the run was compiled for mocks whose originals never run. Ask for it where the build can read it: vi.importActual(), jest.requireActual() or the parameter of the factory, called on `vi` or `jest` as bun:test exports them."_s));
        }
    }
    bool refusesCode = AOT::rejectsUncompiledCode(globalObject, path);
    // An executable does not have the source of a compiled module.
    if (isCompiledModule(path) && (refusesCode || !runsCompiledModules()))
        return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it's compiled into this executable, and a compiled module can't be loaded a second time (for example into a Bun.ModuleGraph)."_s));
    if (!refusesCode)
        return {};
    return createNotInExecutableError(globalObject, code, path);
}

bool letsTestRunLoadAddon(JSGlobalObject* globalObject, const String& path)
{
    if (!hasCompiledModules() || !runsCompiledModules() || isCompiledModule(path) || !AOT::rejectsUncompiledCode(globalObject, path))
        return false;
    return recordAddonLoadedFromDisk(globalObject, path);
}

bool isFileInExecutable(const String& path)
{
    BunString pathArgument = Bun::toString(path);
    return Bun__AOT__isFileInExecutable(&pathArgument);
}

JSValue errorIfHostObjectOutsideImageIsRefused(JSGlobalObject* globalObject, ErrorCode code, const String& path)
{
    if (!hasCompiledModules() || !AOT::rejectsUncompiledHostObjects(globalObject))
        return {};
    return createNotInExecutableError(globalObject, code, path, NotInExecutable::HostObject);
}

static bool isReadAsCode(Zig::GlobalObject* globalObject, const String& path)
{
    BunString pathString = Bun::toString(path);
    BunLoaderType loader = Bun__getDefaultLoader(globalObject, &pathString, nullptr);
    return loader == BunLoaderTypeJS || loader == BunLoaderTypeJSX || loader == BunLoaderTypeTS || loader == BunLoaderTypeTSX;
}

JSValue parentSeenBy(Zig::GlobalObject* globalObject, JSString* id, JSValue parent)
{
    if (!hasCompiledModules()) [[likely]]
        return parent;
    auto* requirer = dynamicDowncast<JSCommonJSModule>(parent);
    if (!requirer || !requirer->filename().isString())
        return parent;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSString* requesterForRequire = asString(requirer->filename());
    auto path = requesterForRequire->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto required = id->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto compiled = compiledModuleForPath(path);
    // As requesterForRequire(), by the identity of the object: its holder counts as code of the executable.
    bool requestsAsImageCode = compiledModuleOf(requirer) || requirer->isCreatedByImageCode;
    if ((!compiled && !requestsAsImageCode) || isCompiledModule(required))
        return parent;
    bool isExecutableDiskCode = !runsCompiledModules() && isReadAsCode(globalObject, required);
    if (!isExecutableDiskCode && (!compiled || AOT::canExposeModuleObject(requirer->globalObject(), *compiled)))
        return parent;
    RELEASE_AND_RETURN(scope, JSCommonJSModule::create(globalObject, requesterForRequire, JSValue(), false, jsUndefined()));
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

JSValue errorIfBuildSawNoPlugin(JSGlobalObject* globalObject)
{
    bool isCompiledWithoutPlugins = hasCompiledModules() && !Bun__compiledProgramNamesPlugin() && (isBunTest || !(Bun__compiledProgramRunsInPlace() || Bun__AOT__allowsCodeFromDisk()));
    if (!isCompiledWithoutPlugins) [[likely]]
        return {};
    return createCodeNotCompiledError(globalObject, "Cannot use Bun.plugin: no file that was compiled names it, so the program's imports were linked as if no plugin could answer for them. Write Bun.plugin(...) or import { plugin } from \"bun\" in a file that the build compiles."_s);
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
    return image && (image->programTables().flags & AOT::ProgramTables::mayRunInMultipleInstances);
}

bool runsCompiledModules()
{
    return hasCompiledModules() && Bun__compiledProgramRunsInPlace();
}

String firstCompiledModuleMatching(JSGlobalObject* globalObject, RegExp* filter)
{
    if (!runsCompiledModules())
        return {};
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    String found;
    AOT::forEachModule([&](AOT::ModuleID module) {
        // `import("./a.custom")` next to `require("./a.custom")`: the image has the file in two forms, one under the path with a query. The plugin gets the path of the file.
        String path = AOT::moduleFilePath(module);
        auto matchResult = filter->match(globalObject, path, 0);
        RETURN_IF_EXCEPTION(scope, IterationStatus::Done);
        if (!matchResult)
            return IterationStatus::Continue;
        if (reloadsFilesFromDisk() && AOT::tryDelegateModuleToHost(globalObject, module))
            return IterationStatus::Continue;
        found = WTF::move(path);
        return IterationStatus::Done;
    });
    return found;
}

}

extern "C" bool Bun__refusesCodeOutsideExecutable(JSC::JSGlobalObject* globalObject)
{
    return Bun::hasCompiledModules() && JSC::AOT::rejectsUncompiledCode(globalObject, {});
}

extern "C" bool Bun__isCompiledProgramFile(const BunString* path)
{
    return Bun::isCompiledModule(path->toWTFString(BunString::ZeroCopy));
}

extern "C" void Bun__AOT__willReevaluateEntryPoint(JSC::JSGlobalObject* globalObject, const BunString* path)
{
    if (auto module = Bun::compiledModuleForPath(path->toWTFString(BunString::ZeroCopy)))
        JSC::AOT::willReevaluateEntryPoint(globalObject, *module);
}

extern "C" void Bun__AOT__willRunPreloads(JSC::JSGlobalObject* globalObject)
{
    if (!Bun::hasCompiledModules())
        return;
    JSC::AOT::willRunPreloads(globalObject);
    if (Bun::requireCacheListsCompiledFiles())
        JSC::AOT::snapshotEvaluatedModules(globalObject);
}

extern "C" void Bun__AOT__didRunPreloads(JSC::JSGlobalObject* globalObject)
{
    if (!Bun::hasCompiledModules())
        return;
    JSC::AOT::didRunPreloads(globalObject);
    if (Bun::requireCacheListsCompiledFiles())
        JSC::AOT::retainNewlyEvaluatedModules(globalObject);
}

extern "C" bool Bun__isCompiledProgramFileInSomeForm(const BunString* path)
{
    String file = path->toWTFString(BunString::ZeroCopy);
    return Bun::isCompiledModule(file) || (Bun::hasCompiledModules() && JSC::AOT::hasAttributeVariant(file));
}

extern "C" bool Bun__AOT__mayHoldPathStartingWith(BunAOTBytes start)
{
    std::span<const Latin1Character> text { byteCast<Latin1Character>(start.ptr), start.len };
    if (charactersAreAllASCII(text))
        return JSC::AOT::mayContainPathWithPrefix(StringView(text));
    return JSC::AOT::mayContainPathWithPrefix(String::fromUTF8(std::span<const uint8_t> { start.ptr, start.len }));
}

extern "C" bool Bun__AOT__isLeftToCodeOutsideImage(const BunString* specifier, const BunString* importerDirectory)
{
    return JSC::AOT::isExternalSpecifier(specifier->toWTFString(BunString::ZeroCopy), importerDirectory->toWTFString(BunString::ZeroCopy));
}

// Startup reads its options before it uses the image.
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

// `each` returns false to stop. May be called on any thread.
extern "C" void Bun__AOT__forEachFilePathStartingWith(BunAOTBytes start, void* context, bool (*each)(void* context, BunAOTBytes path))
{
    String startOfPath = String::fromUTF8(std::span<const uint8_t> { start.ptr, start.len });
    // Bytes that are not UTF-8 give the null string, which is a prefix of every path.
    if (startOfPath.isNull() && start.len)
        return;
    JSC::AOT::forEachFilePathWithPrefix(startOfPath, [&](const String& path) {
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
    JSC::AOT::recordFirstLoadFromEarlierProcess(*vm, String::fromUTF8(std::span<const uint8_t> { path.ptr, path.len }), wasSynchronous);
}

extern "C" JSC::EncodedJSValue Bun__AOT__errorIfCodeOutsideImageIsRefused(JSC::JSGlobalObject* globalObject, Bun::ErrorCode code, const BunString* path)
{
    return JSC::JSValue::encode(Bun::errorIfCodeOutsideImageIsRefused(globalObject, code, path->toWTFString(BunString::ZeroCopy)));
}

// `bun test` evaluates what is on disk when a file is first loaded. The run was compiled from an earlier version, and the build saw no writer of the file.
extern "C" JSC::EncodedJSValue Bun__AOT__errorIfCompiledFileChangedOutOfSight(JSC::JSGlobalObject* globalObject, Bun::ErrorCode code, const BunString* path)
{
    String file = path->toWTFString(BunString::ZeroCopy);
    if (!JSC::AOT::wasModifiedSinceBuild(globalObject, file))
        return JSC::JSValue::encode({});
    return JSC::JSValue::encode(Bun::createError(globalObject, code, makeString("Cannot load '"_s, file, "': it was written after this test run was compiled, by a path that bun test --aot could not read in the tests. Spell the path where the file is written (for example import.meta.dir + \"/name.ts\"), or run this test without --aot."_s)));
}

extern "C" JSC::EncodedJSValue Bun__AOT__errorIfHostObjectOutsideImageIsRefused(JSC::JSGlobalObject* globalObject, Bun::ErrorCode code, const BunString* path)
{
    return JSC::JSValue::encode(Bun::errorIfHostObjectOutsideImageIsRefused(globalObject, code, path->toWTFString(BunString::ZeroCopy)));
}

extern "C" bool Bun__AOT__letsTestRunLoadAddon(JSC::JSGlobalObject* globalObject, const BunString* path)
{
    return Bun::letsTestRunLoadAddon(globalObject, path->toWTFString(BunString::ZeroCopy));
}

#else // ENABLE(AOT)

// Results of the functions above without a registered image.
namespace Bun {
using namespace JSC;

const AOT::ModuleHost compiledModuleHost {};

bool decompressSource(std::span<uint8_t>, std::span<const uint8_t>) { return false; }
std::optional<AOT::ModuleID> compiledModuleForPath(const String&) { return std::nullopt; }
std::optional<bool> isHiddenFromRequireCache(const String&) { return false; }
std::optional<AOT::ModuleID> findMockedModule(const String&) { return std::nullopt; }
JSPromise* compiledModuleSource(Zig::GlobalObject*, const String&, const ScriptFetchParameters*) { return nullptr; }
JSPromise* importCompiledModule(Zig::GlobalObject*, const String&, const ScriptFetchParameters*, int64_t) { return nullptr; }
JSValue requireCompiledModuleForTestRunner(Zig::GlobalObject*, const String&) { return {}; }
bool requireCompiledModule(Zig::GlobalObject*, JSCommonJSModule*, const String&, bool) { return false; }
JSObject* loaderOfCompiledESModule(Zig::GlobalObject*, const String&, bool) { return nullptr; }
JSValue loadCompiledModuleNamespace(Zig::GlobalObject*, const String&) { return {}; }
bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject*, JSCommonJSModule*, const String&, bool) { return false; }
bool resumeDelegatedRequire(Zig::GlobalObject*, JSCommonJSModule*, const String&) { return false; }
bool runsCompiledModules() { return false; }
bool compiledProgramRunsInSeveralRealmsAtOnce() { return false; }
std::optional<EncodedJSValue> takeSavedResolution(JSGlobalObject*, const BunString*, const BunString*, const BunString*, bool&) { return std::nullopt; }
void saveResolution(JSGlobalObject*, const BunString*, const BunString*, const BunString*, JSValue, bool) {}
bool hasSavedResolutions() { return false; }
JSValue errorIfBuildSawNoPlugin(JSGlobalObject*) { return {}; }
void clearSavedResolutions(JSGlobalObject*) {}
String uncompiledCallerFile(VM&, CallFrame*) { return {}; }
String firstCompiledModuleMatching(JSGlobalObject*, RegExp*) { return {}; }
JSValue createNotInExecutableError(JSGlobalObject* globalObject, ErrorCode code, const String& path, NotInExecutable)
{
    return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it isn't in this executable."_s));
}
JSValue errorIfCodeOutsideImageIsRefused(JSGlobalObject*, ErrorCode, const String&) { return {}; }
bool letsTestRunLoadAddon(JSGlobalObject*, const String&) { return false; }
bool isFileInExecutable(const String&) { return false; }
JSValue errorIfHostObjectOutsideImageIsRefused(JSGlobalObject*, ErrorCode, const String&) { return {}; }
String pathInExecutable(const String&) { return {}; }
std::optional<bool> willResolveName(JSGlobalObject*, JSValue) { return std::nullopt; }
void didResolveName(JSGlobalObject*, bool) {}
JSValue mainModuleOfExecutable(Zig::GlobalObject*) { return jsUndefined(); }
void willSetMainModulePath(Zig::GlobalObject*, JSValue) {}
bool appendNewChildrenOfCompiledModule(JSGlobalObject*, JSCommonJSModule*) { return true; }
void dropNewChildrenOfCompiledModule(JSCommonJSModule*) {}
JSObject* parentOfCompiledModule(JSCommonJSModule*) { return nullptr; }
JSValue parentSeenBy(Zig::GlobalObject*, JSString*, JSValue parent) { return parent; }
JSValue errorIfUnseenCodeIsRefused(JSGlobalObject*, ASCIILiteral) { return {}; }
bool isDiagnosingLoadFailure() { return false; }
bool isDebuggerAdmitted() { return true; }
JSValue errorIfDebuggerIsRefused(JSGlobalObject*, ASCIILiteral) { return {}; }
void willSetRequireCacheEntry(Zig::GlobalObject*, const String&, JSValue) {}
void willSetExtensionLoader(Zig::GlobalObject*, StringView) {}
String requesterForRequire(JSCommonJSModule*, const String& written) { return written; }
const String& requesterForImporter(const String& importer) { return importer; }
const String& requesterForUncompiledImportCall(const String& origin) { return origin; }
const String& uncompiledImportReferrer(const String& origin) { return origin; }
void didCreateRequire(VM&, CallFrame*, JSObject*) {}
void didCreateRequireOfCompiledModule(JSObject*) {}
void willResolveImport(Zig::GlobalObject*, const String&, JSValue) {}
void throwIfOnlyTyped(Zig::GlobalObject*, const String&, const String&, const String&, bool) {}
void didDeleteRequireCacheEntry(Zig::GlobalObject*, const String&) {}
bool willUnmockCompiledFile(Zig::GlobalObject*, const String&, bool, bool) { return false; }
void didUnmockCompiledFile(Zig::GlobalObject*, const String&, bool, bool, bool) {}
bool didStashCompiledFile(Zig::GlobalObject*, const String&) { return false; }
bool isCompiledOriginalRetained(Zig::GlobalObject*, const String&) { return false; }
void willMockReloadedFile(Zig::GlobalObject*, const String&, JSValue) {}
void willResetModules(Zig::GlobalObject*, ASCIILiteral, bool) {}
Vector<String> restorePreloadModules(Zig::GlobalObject*) { return {}; }
bool requireCacheListsCompiledFiles() { return false; }
bool isLibraryModuleInRequireCache(Zig::GlobalObject*, const String&) { return false; }
bool isEvaluatedCompiledFile(Zig::GlobalObject*, const String&) { return false; }
JSValue compiledRequireCacheEntry(Zig::GlobalObject*, const String&) { return {}; }
bool isRecordOfCompiledModule(AbstractModuleRecord*) { return false; }
bool isRecordOfCompiledFile(AbstractModuleRecord*) { return false; }
void forEachEvaluatedCompiledFile(Zig::GlobalObject*, const WTF::Function<void(const String&)>&) {}

}

extern "C" bool Bun__refusesCodeOutsideExecutable(JSC::JSGlobalObject*) { return false; }
extern "C" bool Bun__isCompiledProgramFile(const BunString*) { return false; }
extern "C" void Bun__AOT__willReevaluateEntryPoint(JSC::JSGlobalObject*, const BunString*) {}
extern "C" void Bun__AOT__willRunPreloads(JSC::JSGlobalObject*) {}
extern "C" void Bun__AOT__didRunPreloads(JSC::JSGlobalObject*) {}
extern "C" void Bun__AOT__setPluginsSilent(bool) {}
extern "C" bool Bun__isCompiledProgramFileInSomeForm(const BunString*) { return false; }
extern "C" bool Bun__AOT__mayHoldPathStartingWith(BunAOTBytes) { return false; }
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
extern "C" JSC::EncodedJSValue Bun__AOT__errorIfCodeOutsideImageIsRefused(JSC::JSGlobalObject*, Bun::ErrorCode, const BunString*) { return JSC::JSValue::encode({}); }
extern "C" JSC::EncodedJSValue Bun__AOT__errorIfCompiledFileChangedOutOfSight(JSC::JSGlobalObject*, Bun::ErrorCode, const BunString*) { return JSC::JSValue::encode({}); }
extern "C" JSC::EncodedJSValue Bun__AOT__errorIfHostObjectOutsideImageIsRefused(JSC::JSGlobalObject*, Bun::ErrorCode, const BunString*) { return JSC::JSValue::encode({}); }
extern "C" bool Bun__AOT__letsTestRunLoadAddon(JSC::JSGlobalObject*, const BunString*) { return false; }
extern "C" void Bun__compiledProgramWillRunTextOfFile(JSC::JSGlobalObject*, const BunString*) {}

#endif // ENABLE(AOT)
