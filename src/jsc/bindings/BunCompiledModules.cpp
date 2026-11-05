#include "root.h"
#include "JSNextTickQueue.h"

#include "BunCompiledModules.h"

#include "BunAOTCompile.h"
#include "BunClientData.h"
#include "BunCompiledEntryPoint.h"
#include "CodeGenerationFromStrings.h"
#include "ErrorCode.h"
#include "ImportMetaObject.h"
#include "IsolatedModuleCache.h"
#include "JSCommonJSExtensions.h"
#include "JSCommonJSModule.h"
#include "JSMockFunction.h"
#include "ModuleLoader.h"
#include "PathInlines.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGlobalObject.h"
#if ENABLE(AOT)
#include "RemovableFeatures.h"
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
#include <wtf/FileSystem.h>
#include <wtf/SetForScope.h>

#if ENABLE(AOT)
namespace Zig {
bool runCompiledMock(Zig::GlobalObject*, JSC::AOT::ModuleID);
bool layMocksOfBodiesAgain(Zig::GlobalObject*, const WTF::ScopedLambda<bool(JSC::AOT::ModuleID)>& isReached);
JSC::JSPromise* factoryOfCompiledMockThatWaits(Zig::GlobalObject*, const WTF::ScopedLambda<bool(JSC::AOT::ModuleID)>& isAskedAbout, JSC::AOT::FactoryAskedForBy, JSC::JSValue& state);
bool isCalledFromFactoryOfCompiledMockThatWaits(Zig::GlobalObject*, JSC::AOT::ModuleID);
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
extern "C" bool Bun__compiledProgramRunsInPlace();
extern "C" JSC::AOT::AnswerForName Bun__AOT__onResolveAnswersFor(JSC::JSGlobalObject*, const BunString* name, const BunString* importer, BunString* foundWithoutPlugins);
extern "C" bool Bun__compiledProgramHoldsFileAsItIs(const BunString*);
extern "C" bool Bun__AOT__isWorkerTextRefusedByTrimming(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__isMainModule(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__isLoadedSynchronously(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__isBetweenLoadOfTestFileAndItsCallbacks(JSC::JSGlobalObject*);
extern "C" uint64_t Bun__AOT__stampOfFile(const char* path, size_t length);
extern "C" bool Bun__isESModuleByExtensionOrPackageType(JSC::JSGlobalObject*, const BunString* path);
extern "C" bool Bun__AOT__allowsCodeFromDisk();
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

static std::optional<AOT::ModuleID> moduleThatAnswersToPath(const String& path)
{
    if (!hasCompiledModules())
        return std::nullopt;
    std::optional<AOT::ModuleID> found = AOT::findModule(path, path.hash());
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

String fileOfCallerThatWasNotCompiled(VM& vm, CallFrame* callFrame)
{
    SourceOrigin origin = callFrame->callerSourceOrigin(vm);
    const URL& url = origin.url();
    if (origin.isNull() || !url.isValid() || !url.protocolIsFile())
        return {};
    String path = url.fileSystemPath();
    bool isFile = FileSystem::fileTypeFollowingSymlinks(path) == FileSystem::FileType::Regular;
    return isFile && !isCompiledModule(path) ? path : String();
}

std::optional<bool> isHiddenFromRequireCache(const String& key)
{
    auto module = moduleThatAnswersToPath(key);
    if (!module)
        return std::nullopt;
    return !AOT::mayHoldEntryOfProgramInRequireCache(*module) && !AOT::isNativeModule(*module);
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

// As in an executable of `bun build --compile`: a name that the run time resolves is the plugins' first.
static bool loadsFileItself(JSGlobalObject* globalObject, const String& path)
{
    if (Bun__compiledProgramRunsInPlace())
        return false;
    // Whoever asks goes on either way. A filter that throws does so again where the loader calls the plugins.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
    String asked = path;
    bool isLoadedByPlugin = uncheckedDowncast<Zig::GlobalObject>(globalObject)->onLoadPlugins.fileNamespace.find(globalObject, asked);
    (void)scope.tryClearException();
    return isLoadedByPlugin;
}

void recordFileRunFromSource(JSGlobalObject*, const String& path, ASCIILiteral why);

// A module that `build.module()` gave for the name, or an onResolve whose filter takes it. The loader calls the callback where it resolves the name. A mock lies in the same table and is no function.
static bool isGivenByPlugin(Zig::GlobalObject* global, const String& name)
{
    auto* modules = global->onLoadPlugins.virtualModules;
    auto given = modules ? modules->get(name) : JSC::Strong<JSC::JSObject>();
    return given && given->isCallable();
}

static bool hasPluginsThatAnswerForNames(JSGlobalObject* globalObject)
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

static AnswersOfPlugins& answersOfPluginsOnThisThread()
{
    static thread_local NeverDestroyed<AnswersOfPlugins> answers;
    return answers;
}

static String questionOf(const BunString* space, const BunString* name, const BunString* importer)
{
    return makeString(space ? space->toWTFString() : String(), '\n', name->toWTFString(), '\n', importer->toWTFString());
}

std::optional<JSC::EncodedJSValue> takeAnswerKeptForLoader(JSGlobalObject* globalObject, const BunString* space, const BunString* name, const BunString* importer, bool& engineAsks)
{
    AnswersOfPlugins& answers = answersOfPluginsOnThisThread();
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

void keepAnswerForLoader(JSGlobalObject* globalObject, const BunString* space, const BunString* name, const BunString* importer, JSValue answerOrWhatWasThrown, bool isThrown)
{
    AnswersOfPlugins& answers = answersOfPluginsOnThisThread();
    answers.engineAsks = true;
    answers.gotByEngine.last().append({ globalObject, questionOf(space, name, importer), importer->toWTFString(), JSC::Strong<JSC::Unknown>(getVM(globalObject), answerOrWhatWasThrown), isThrown });
}

extern "C" void Bun__AOT__setPluginsSilent(bool areSilent)
{
    answersOfPluginsOnThisThread().pluginsAreSilent = areSilent;
}

bool holdsAnswersForLoader()
{
    return !answersOfPluginsOnThisThread().keptForLoader.isEmpty();
}

void forgetAnswersKeptForLoader(JSGlobalObject* globalObject)
{
    answersOfPluginsOnThisThread().keptForLoader.removeIf([&](auto& kept) {
        kept.value.removeAllMatching([&](const AnswerOfPlugins& answer) {
            return answer.realm == globalObject;
        });
        return kept.value.isEmpty();
    });
}

static void askingAboutNames(JSGlobalObject*, const ScopedLambda<bool(const String& importer)>* leavesWhereAskingEnds)
{
    AnswersOfPlugins& answers = answersOfPluginsOnThisThread();
    if (!leavesWhereAskingEnds) {
        answers.gotByEngine.append(Vector<AnswerOfPlugins>());
        return;
    }
    for (AnswerOfPlugins& answer : answers.gotByEngine.takeLast()) {
        if (!(*leavesWhereAskingEnds)(answer.importer))
            continue;
        String question = answer.question;
        answers.keptForLoader.ensure(question, [] {
                                 return Vector<AnswerOfPlugins, 1>();
                             })
            .iterator->value.append(WTF::move(answer));
    }
}

static AOT::AnswerForName answersForName(JSGlobalObject* globalObject, const String& name, const String& importer, String& foundWithoutPlugins)
{
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    AOT::AnswerForName answer = isGivenByPlugin(global, name) ? AOT::AnswerForName::Answered : AOT::AnswerForName::Declined;
    if (answer == AOT::AnswerForName::Declined && !global->onResolvePlugins.isEmpty()) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
        BunString nameArgument = Bun::toString(name);
        BunString importerArgument = Bun::toString(importer);
        BunString found = { BunStringTag::Dead };
        {
            SetForScope engineAsks(answersOfPluginsOnThisThread().engineAsks, true);
            answer = Bun__AOT__onResolveAnswersFor(globalObject, &nameArgument, &importerArgument, &found);
        }
        (void)scope.tryClearException();
        if (!found.isDead())
            foundWithoutPlugins = found.transferToWTFString();
    }
    if (answer != AOT::AnswerForName::Declined)
        recordFileRunFromSource(globalObject, importer, "a plugin answers for a name that it imports"_s);
    return answer;
}

// Code that an executable loads from disk names globals, built-in modules, files on disk and what it is handed. The helpers of a test run import the files under test.
static bool refusesFileToAsker(JSGlobalObject* globalObject, AOT::ModuleID module, AOT::LoadByName way)
{
    if (!Bun__AOT__allowsCodeFromDisk() || isBunTest || Bun__compiledProgramRunsInPlace())
        return false;
    if (AOT::isNativeModule(module) || AOT::isOfLibrary(module) || !AOT::isAskedByCodeOutsideImage(globalObject))
        return false;
    AOT::throwFileOfImageRefused(globalObject, module, way);
    return true;
}

void willResolveImport(Zig::GlobalObject* globalObject, const String& key, JSValue importer)
{
    if (!hasCompiledModules() || !importer || !importer.isString())
        return;
    auto module = compiledModuleForPath(key);
    if (!module)
        return;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    String path = importer.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, void());
    AOT::AskerOfModule asker(globalObject, askerOfImport(path));
    scope.release();
    refusesFileToAsker(globalObject, *module, AOT::LoadByName::Import);
}

// A file that the program only imports with type attributes, as two types, has no module under its bare path.
static std::optional<AOT::ModuleID> findDefaultForm(const String& path)
{
    if (!hasCompiledModules() || Bun__compiledProgramRunsInPlace())
        return std::nullopt;
    BunString pathArgument = Bun::toString(path);
    BunString pathOfForm = Bun__AOT__pathOfDefaultForm(&pathArgument);
    if (pathOfForm.isDead())
        return std::nullopt;
    return moduleThatAnswersToPath(pathOfForm.transferToWTFString());
}

static std::optional<AOT::ModuleID> moduleForRequest(Zig::GlobalObject* globalObject, const String& path, AOT::LoadByName way)
{
    auto module = moduleThatAnswersToPath(path);
    if (!module)
        module = findDefaultForm(path);
    if (!module) {
        // Each query of a file is an instance of its own, which the loader makes of the text. The text bears the path alone.
        if (size_t query = path.find('?'); query != notFound && moduleThatAnswersToPath(path.left(query)))
            recordFileRunFromSource(globalObject, path, "it was imported under a query"_s);
        return module;
    }
    // A realm that holds nothing compiled, as the one in which `bun test` keeps a window under --isolate: there the library runs from its text and meets only itself.
    if (!globalObject->aotInstance() && AOT::isOfLibrary(*module))
        return std::nullopt;
    // In front of the plugins: what one of them answered would stand in the loader under the path of the file, where the program finds it.
    if (refusesFileToAsker(globalObject, *module, way))
        return std::nullopt;
    // What a mock has stored over an earlier require().
    if (way == AOT::LoadByName::Require && AOT::isInRequireCache(globalObject, *module))
        return module;
    if (!AOT::isNativeModule(*module) && loadsFileItself(globalObject, path))
        return std::nullopt;
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
    // The files of an executable are on no disk, so what was compiled without the attribute answers. A program that runs in place has the loader read the file with its type, as another module.
    if (!module && isFormWithoutAttributes && formWithoutAttributes == FormWithoutAttributes::MayAnswer && !Bun__compiledProgramRunsInPlace())
        module = compiledModuleForPath(path);
    if (module && (refusesFileToAsker(globalObject, *module, AOT::LoadByName::Import) || AOT::leavesModuleToHost(globalObject, *module)))
        return std::nullopt;
    return module;
}

static std::optional<AOT::ModuleID> findModuleWithAttributes(JSGlobalObject* globalObject, const String& path, const ScriptFetchParameters& attributes)
{
    return findFormOfModule(globalObject, path, attributes, FormWithoutAttributes::MayAnswer);
}

BUN_DECLARE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFactory);
BUN_DECLARE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFailedFactory);

// `fetch`: the record, the number of its module, and ModuleHost::factoryThatWaits' state: at first the key that the loader asks under.
static JSPromise* sourceAfterFactories(Zig::GlobalObject* globalObject, JSPromise* source, JSArray* fetch)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue state = fetch->getIndexQuickly(2);
    if (state.isUndefined())
        state = JSValue();
    AOT::ModuleID module(fetch->getIndexQuickly(1).asUInt32());
    JSPromise* factory = AOT::factoryThatWaitsBelow(globalObject, module, state);
    if (scope.exception()) [[unlikely]]
        return source->rejectWithCaughtException(vm, scope);
    // The factories that one load calls run one at a time: the walk stops behind each that waits.
    while (!factory) {
        bool hasCalledFactoryThatWaits = AOT::runMocksBelow(globalObject, module);
        if (scope.exception()) [[unlikely]]
            return source->rejectWithCaughtException(vm, scope);
        if (!hasCalledFactoryThatWaits)
            break;
        factory = AOT::factoryThatWaitsBelow(globalObject, module, state);
        if (scope.exception()) [[unlikely]]
            return source->rejectWithCaughtException(vm, scope);
    }
    if (!factory) {
        source->fulfill(vm, fetch->getIndexQuickly(0));
        return source;
    }
    fetch->putDirectIndex(globalObject, 2, state);
    if (scope.exception()) [[unlikely]]
        return source->rejectWithCaughtException(vm, scope);
    factory->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionCompiledSourceAfterFactory), globalObject->thenable(jsFunctionCompiledSourceAfterFailedFactory), source, fetch);
    return source;
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFactory, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSPromise* next = JSPromise::create(getVM(globalObject), globalObject->promiseStructure());
    return JSValue::encode(sourceAfterFactories(globalObject, next, asArray(callFrame->argument(1))));
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFailedFactory, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    scope.throwException(globalObject, callFrame->argument(0));
    return {};
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
    auto module = attributes ? findFormOfModule(globalObject, key, *attributes, FormWithoutAttributes::IsAnotherModule) : compiledModuleForRequest(globalObject, key, false, AOT::LoadByName::Import);
    if (scope.exception()) [[unlikely]]
        return rejected();
    if (!module)
        return nullptr;
    if (isBunTest && !JSMock__isInPreload(globalObject))
        globalObject->onLoadPlugins.testFileOfModule.set(key, globalObject->onLoadPlugins.testFile);
    bool textComesInLaterTurn = AOT::textOfFetchedModuleComesInLaterTurn(globalObject, *module);
    AbstractModuleRecord* record = AOT::moduleRecord(globalObject, *module);
    if (scope.exception()) [[unlikely]]
        return rejected();
    bool hasCalledFactoryThatWaits = AOT::runMocksBelow(globalObject, *module);
    if (scope.exception()) [[unlikely]]
        return AOT::mockFailedBehindImportStatement(globalObject, *module) ? nullptr : rejected();
    JSPromise* source = JSPromise::create(vm, globalObject->promiseStructure());
    if (!hasCalledFactoryThatWaits && globalObject->onLoadPlugins.factoriesOfCompiledMocks.isEmpty()) [[likely]] {
        if (textComesInLaterTurn) [[unlikely]]
            AOT::holdTextOfFetchedModule(globalObject, *module, source, record);
        else
            source->fulfill(vm, record);
        return source;
    }
    // The loader of `bun run` waits for a factory before it goes on with the graph.
    MarkedArgumentBuffer fetch;
    fetch.append(record);
    fetch.append(jsNumber(module->index()));
    fetch.append(jsString(vm, key));
    JSArray* heldFetch = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), fetch);
    if (scope.exception()) [[unlikely]]
        return rejected();
    RELEASE_AND_RETURN(scope, sourceAfterFactories(globalObject, source, heldFetch));
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

// The require() of the library is in a program that loads under names of its own making. The build has followed this name, so the engine is asked at once.
JSValue requireCompiledModuleForTestRunner(Zig::GlobalObject* globalObject, const String& key)
{
    auto module = moduleThatAnswersToPath(key);
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;
    if (!module || (virtualModules && virtualModules->contains(key)) || refusesFileToAsker(globalObject, *module, AOT::LoadByName::Require))
        return {};
    return AOT::requireModule(globalObject, *module);
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
    if (requirer && !referrer)
        AOT::willRequireModuleFromOutsideImage(globalObject, *module, requirer);
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

static void takeOutOfProgram(Zig::GlobalObject* globalObject, const String& key, void (*takeOut)(JSGlobalObject*, AOT::ModuleID))
{
    if (!reloadsFilesFromDisk()) {
        if (auto module = AOT::findLibraryModuleInRequireCache(globalObject, key))
            takeOut(globalObject, *module);
        return;
    }
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (auto module = moduleThatAnswersToPath(key)) {
        takeOut(globalObject, *module);
        RETURN_IF_EXCEPTION(scope, );
    }
    // `import("./a", { with: { type: "text" } })`: the image holds the file once for each type that is asked for, and the cache knows it by its path.
    for (AOT::ModuleID form : AOT::formsThatAttributesAskFor(globalObject, key)) {
        takeOut(globalObject, form);
        RETURN_IF_EXCEPTION(scope, );
    }
}

void didDeleteRequireCacheEntry(Zig::GlobalObject* globalObject, const String& key)
{
    takeOutOfProgram(globalObject, key, AOT::didDeleteRequireCacheEntry);
}

void willResetModules(Zig::GlobalObject* globalObject, ASCIILiteral call, bool keepsPackages)
{
    if (!hasCompiledModules() || !reloadsFilesFromDisk())
        return;
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    String packages = makeString(PLATFORM_SEP, "node_modules"_s, PLATFORM_SEP);
    // isExternalizedByVitest(): Vitest loads an ES module that Node would read as CommonJS like the project's modules, and resets it with them.
    auto isKept = [&](const String& path) {
        if (!keepsPackages || !path.contains(packages))
            return false;
        auto module = moduleThatAnswersToPath(path);
        if (!module || !AOT::isESModule(*module))
            return true;
        BunString borrowedPath = Bun::toString(path);
        return Bun__isESModuleByExtensionOrPackageType(globalObject, &borrowedPath);
    };
    Vector<String> files;
    AOT::forEachEvaluatedFile(globalObject, [&](const String& path) {
        if (!isKept(path))
            files.append(path);
    });
    // All or nothing.
    for (auto& file : files) {
        auto module = moduleThatAnswersToPath(file);
        if (!module || !AOT::refusesToLoadAgain(globalObject, *module))
            continue;
        throwException(globalObject, scope, createError(globalObject, makeString("Cannot load '"_s, file, "' again after "_s, call, ": the build found nothing that calls it, so the code that imports the file was compiled for a module that loads once. Call it in a file that the tests import."_s)));
        return;
    }
    AOT::dropErrorsOfLoadsEndedByMocks(globalObject);
    // What a preload resets, or a hook of a preload, is gone for good.
    auto takeOut = JSMock__isInPreload(globalObject) ? AOT::didDeleteRequireCacheEntry : AOT::didResetModule;
    for (auto& file : files) {
        takeOutOfProgram(globalObject, file, takeOut);
        RETURN_IF_EXCEPTION(scope, );
    }
}

Vector<String> bringBackFilesOfPreloads(Zig::GlobalObject* globalObject)
{
    Vector<String> files;
    if (hasCompiledModules() && reloadsFilesFromDisk())
        AOT::bringBackKeptFiles(globalObject, [&](const String& path) { files.append(path); });
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

static std::optional<AOT::ModuleID> evaluatedFileOfProgram(Zig::GlobalObject* globalObject, const String& key)
{
    if (!reloadsFilesFromDisk())
        return std::nullopt;
    auto module = compiledModuleForPath(key);
    // `bun test` takes a file that imported a mock out of its loader with the mock, and loads it anew when a graph comes by.
    return module && AOT::isEvaluatedFile(globalObject, *module) && !AOT::wasLetGoByLoader(globalObject, *module) ? module : std::nullopt;
}

bool isEvaluatedCompiledFile(Zig::GlobalObject* globalObject, const String& key)
{
    return isLibraryModuleInRequireCache(globalObject, key) || evaluatedFileOfProgram(globalObject, key);
}

JSValue compiledRequireCacheEntry(Zig::GlobalObject* globalObject, const String& key)
{
    if (auto module = AOT::findLibraryModuleInRequireCache(globalObject, key))
        return AOT::requireCacheEntry(globalObject, *module);
    if (auto module = evaluatedFileOfProgram(globalObject, key))
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
        AOT::forEachEvaluatedFile(globalObject, [&](const String& path) {
            if (evaluatedFileOfProgram(globalObject, path))
                functor(path);
        });
    }
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
        if (!entry.toBoolean(globalObject))
            return;
        // overridableRequire() looks for a module of native code that is Bun's own under its one name: "bun:jsc".
        if (auto nativeModule = moduleThatAnswersToPath(key))
            return AOT::willSetRequireCacheEntry(globalObject, *nativeModule, entry);
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

// `filename` is the program's to store over, and createRequire() takes any path. What the object is, the program cannot change.
String pathOfRequirer(JSCommonJSModule* target, const String& written)
{
    JSCommonJSModule* requirer = target->m_parent.get();
    if (!requirer || compiledModuleOf(requirer) || requirer->isMadeByCodeOfImage || !compiledModuleForPath(written))
        return written;
    return "."_s;
}

void didCreateRequire(VM& vm, CallFrame* callFrame, JSObject* require)
{
    JSCommonJSModule* module = hasCompiledModules() ? boundModuleOf(require) : nullptr;
    if (!module)
        return;
    // A call without a caller that is known, as one that a built-in or a job makes, may be anybody's.
    SourceOrigin origin = callFrame->callerSourceOrigin(vm);
    module->isMadeByCodeOfImage = !origin.isNull() && origin.url().protocolIsFile() && compiledModuleForPath(origin.url().fileSystemPath());
}

void didCreateRequireOfCompiledModule(JSObject* require)
{
    if (JSCommonJSModule* module = boundModuleOf(require))
        module->isMadeByCodeOfImage = true;
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
    JSValue exportsAsData = jsUndefined();
    // putDirectCustomAccessor() is for a name that the object does not have yet.
    if (traits.contains(AOT::ModuleObjectTrait::HasExportsVariable))
        exportsAsData = JSValue();
    else if (!traits.contains(AOT::ModuleObjectTrait::IsNoCommonJSFile))
        exportsAsData = constructEmptyObject(globalObject);
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
    // The engine asks for the loader of a module of the image.
    if (JSCommonJSModule* module = boundModuleOf(out.require)) [[likely]] {
        module->isMadeByCodeOfImage = true;
        out.module = module;
        return;
    }

    // The program replaced import.meta.require with a value that is not bound to a module object.
    String path = meta->pathProperty.getInitializedOnMainThread(meta)->value(realm);
    RETURN_IF_EXCEPTION(scope, void());
    JSObject* ownRequire = JSCommonJSModule::createBoundRequireFunction(vm, realm, path, meta->moduleGraph());
    RETURN_IF_EXCEPTION(scope, void());
    JSCommonJSModule* module = boundModuleOf(ownRequire);
    module->isMadeByCodeOfImage = true;
    out.module = module;
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

void dropNewChildrenOfCompiledModule(JSCommonJSModule* parent)
{
    if (auto compiled = compiledModuleOf(parent))
        AOT::dropNewChildren(parent->globalObject(), *compiled);
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

bool hasCompiledModuleYetToBegin(JSCommonJSModule* module)
{
    auto compiled = compiledModuleOf(module);
    return compiled && AOT::hasYetToBegin(module->globalObject(), *compiled);
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

static thread_local bool isAskingWhyFileFails = false;

bool isAskingWhyFileFailsToLoad()
{
    return isAskingWhyFileFails;
}

// The file is read and parsed as `require` reads it, and nothing of it runs.
static JSValue createLoadError(JSGlobalObject* realm, const String& path)
{
    // The build writes the type that alone asks for a file of data behind its path: "/project/odd.txt?json". The file is read as an import with that type reads it.
    size_t mark = path.reverseFind('?');
    String type = mark == notFound ? String() : path.substring(mark + 1);
    bool isAskedForUnderType = type == "json"_s || type == "jsonc"_s || type == "json5"_s || type == "toml"_s || type == "yaml"_s;
    String file = isAskedForUnderType ? path.left(mark) : path;
    BunString specifier = Bun::toString(file);
    BunString typeAttribute = Bun::toString(type);
    // The name of a built-in module is not a path. Reading one that the executable does not hold fails as under `bun run`.
    // An executable holds a file that the build could not take as it is: what is wrong with it is for its loader to say.
    if (!Bun__compiledProgramRunsInPlace() && isAbsolutePath(file) && !Bun__compiledProgramHoldsFileAsItIs(&specifier))
        return {};
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(realm);
    ErrorableResolvedSource source;
    SetForScope isAsking(isAskingWhyFileFails, true);
    Bun__transpileFile(globalObject->bunVM(), globalObject, &specifier, &specifier, isAskedForUnderType ? &typeAttribute : nullptr, &source, false, true, BunLoaderTypeNone);
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

// Only `bun:test` lays a mock, so what runs one goes with it out of a trimmed executable.
static bool runMock(JSGlobalObject* globalObject, AOT::ModuleID module)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, Abort, bool)
    return Zig::runCompiledMock(uncheckedDowncast<Zig::GlobalObject>(globalObject), module);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static bool layMocksAgain(JSGlobalObject* globalObject, const ScopedLambda<bool(AOT::ModuleID)>& isReached)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, Abort, bool)
    return Zig::layMocksOfBodiesAgain(uncheckedDowncast<Zig::GlobalObject>(globalObject), isReached);
    BUN_END_REMOVABLE_ENTRY_POINT
}

// Every import() asks.
static JSPromise* factoryThatWaits(JSGlobalObject* globalObject, const ScopedLambda<bool(AOT::ModuleID)>& isAskedAbout, AOT::FactoryAskedForBy askedBy, JSValue& state)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, JSPromise*)
    return Zig::factoryOfCompiledMockThatWaits(defaultGlobalObject(globalObject), isAskedAbout, askedBy, state);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static void didStartImport(JSGlobalObject* globalObject, JSPromise* import, const String& path)
{
    if (isBunTest)
        didStartDynamicImport(defaultGlobalObject(globalObject), import, path);
}

static bool givesOriginalBesideMock(JSGlobalObject* globalObject, const String& path, const String& importer, bool isImport)
{
    // isExternalizedByVitest() knows an ES module by the record that the loader made of its text. A compiled one has none.
    if (auto module = isImport ? moduleThatAnswersToPath(importer) : std::nullopt; module && AOT::isESModule(*module)) {
        BunString borrowedPath = Bun::toString(importer);
        if (!Bun__isESModuleByExtensionOrPackageType(globalObject, &borrowedPath))
            return false;
    }
    return keyOfImportByPackage(defaultGlobalObject(globalObject), path, importer, isImport) != path;
}

static std::optional<bool> isInPreload(JSGlobalObject* globalObject)
{
    if (!isBunTest)
        return std::nullopt;
    return JSMock__isInPreload(defaultGlobalObject(globalObject));
}

static bool holdsTextsOfProgram(JSGlobalObject*)
{
    return true;
}

static bool keepsTexts(JSGlobalObject* globalObject)
{
    return Bun::IsolatedModuleCache::canUse(globalObject->vm(), defaultGlobalObject(globalObject)->bunVM());
}

static bool loadsSynchronously(JSGlobalObject* globalObject, AOT::ModuleID module)
{
    String path = AOT::modulePath(module);
    BunString pathArgument = Bun::toString(path);
    return Bun__AOT__isLoadedSynchronously(globalObject, &pathArgument);
}

// `bun test` reads the text on another thread, which takes longer than the runner takes from the end of a test file to its `describe` callbacks: what an import() of the file loads
// runs behind them, and meets a mock that one of them lays. It is a race there, which the thread loses on a quiet machine. Here the text never comes in between. It is put off once,
// so whoever waits for it gets it a turn later at the worst.
static void deliverTextInLaterTurn(WebCore::ScriptExecutionContext& context, bool wasPutOff)
{
    context.postTaskAfterYield([wasPutOff](WebCore::ScriptExecutionContext& context) {
        if (isBunTest && !wasPutOff && Bun__AOT__isBetweenLoadOfTestFileAndItsCallbacks(context.globalObject())) [[unlikely]]
            return deliverTextInLaterTurn(context, true);
        AOT::deliverTextThatWaits(context.vm());
        // What the delivery has queued runs here, ticks too, so that the run time hears where it ends: what a later turn calls for is held again.
        defaultGlobalObject(context.globalObject())->drainMicrotasks();
        AOT::didRunJobsBehindDelivery(context.vm());
    });
}

static void callInLaterTurn(JSGlobalObject* globalObject)
{
    WebCore::ScriptExecutionContext& context = *defaultGlobalObject(globalObject)->scriptExecutionContext();
    // An executable has every text: what waits for a graph goes on once the jobs have run, ahead of timers and immediates, as in `bun run` and Node.js.
    if (!isBunTest) {
        context.postTask([](WebCore::ScriptExecutionContext& context) {
            AOT::deliverTextThatWaits(context.vm());
        });
        return;
    }
    deliverTextInLaterTurn(context, false);
}

static bool isCalledFromFactoryThatWaits(JSGlobalObject* globalObject, AOT::ModuleID module)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, bool)
    return Zig::isCalledFromFactoryOfCompiledMockThatWaits(defaultGlobalObject(globalObject), module);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static const AOT::MockOperations* mockOperations()
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, const AOT::MockOperations*)
    return AOT::mockOperations();
    BUN_END_REMOVABLE_ENTRY_POINT
}

static uint64_t stampOfFile(std::span<const char> path)
{
    return Bun__AOT__stampOfFile(path.data(), path.size());
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
    &loadsFileItself,
    &hasPluginsThatAnswerForNames,
    &answersForName,
    &askingAboutNames,
    &mockOperations,
    &stampOfFile,
    &givesOriginalBesideMock,
    &factoryThatWaits,
    &isInPreload,
    &layMocksAgain,
    &callInLaterTurn,
    &didStartImport,
    &holdsTextsOfProgram,
    &isCalledFromFactoryThatWaits,
    &keepsTexts,
};
// A member missing from the initializer would be null, which tells the engine that the host does not support it.
static_assert(sizeof(AOT::ModuleHost) == 37 * sizeof(void*));

void recordRefusedLoad(JSGlobalObject*, const String& path);
bool recordAddonLoadedFromDisk(JSGlobalObject*, const String& path);

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
    // `bun test --aot` makes no executable and takes no entry points.
    if (compiledModulesRunInPlaceOfFiles())
        recordRefusedLoad(globalObject, path);
    if (compiledModulesRunInPlaceOfFiles())
        return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it wasn't compiled with the program, and --aot only runs code that was. Import the file by a constant path, or add --aot-allow-code-from-disk."_s));
    return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it isn't in this executable, which only runs code that was compiled into it. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk."_s));
}

JSValue errorIfCodeOutsideImageIsRefused(JSGlobalObject* globalObject, ErrorCode code, const String& path)
{
    if (!hasCompiledModules() || isAskingWhyFileFails)
        return {};
    // A test takes a module out of require.cache so that it runs again. Its text is on disk, and the build has seen it.
    if (isBunTest && compiledModulesRunInPlaceOfFiles() && isCompiledModule(path))
        return {};
    // `vi.importActual()`, the parameter of a factory, a mock without a factory: the original of a mocked module is the file once more, under a key of the mocks' own.
    if (isBunTest && compiledModulesRunInPlaceOfFiles()) {
        size_t query = path.find('?');
        if (query != notFound && (path.endsWith("actual"_s) || path.endsWith("actual&spy"_s)) && isCompiledModule(path.left(query))) {
            // It imports what the compiled file imports.
            if (AOT::willRunCopyFromDisk(globalObject))
                return {};
            return createError(globalObject, code, makeString("Cannot load the original of '"_s, path.left(query), "' beside its mock: the build found nothing in this test run that asks for it, so the run was compiled for mocks whose originals never run. Ask for it where the build can read it: vi.importActual(), jest.requireActual() or the parameter of the factory, called on `vi` or `jest` as bun:test exports them."_s));
        }
    }
    bool refusesCode = AOT::refusesCodeOutsideImage(globalObject, path);
    // An executable does not hold the text of a compiled module.
    if (isCompiledModule(path) && (refusesCode || !compiledModulesRunInPlaceOfFiles()))
        return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it's compiled into this executable, and a compiled module can't be loaded a second time (for example into a Bun.ModuleGraph)."_s));
    if (!refusesCode)
        return {};
    return createNotInExecutableError(globalObject, code, path);
}

bool letsTestRunLoadAddon(JSGlobalObject* globalObject, const String& path)
{
    if (!hasCompiledModules() || !compiledModulesRunInPlaceOfFiles() || isCompiledModule(path) || !AOT::refusesCodeOutsideImage(globalObject, path))
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
    if (!hasCompiledModules() || !AOT::refusesHostObjectsOutsideImage(globalObject))
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
    JSString* pathOfRequirer = asString(requirer->filename());
    auto path = pathOfRequirer->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto required = id->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto compiled = compiledModuleForPath(path);
    if (!compiled || isCompiledModule(required))
        return parent;
    bool isCodeThatExecutableLoadsFromDisk = !compiledModulesRunInPlaceOfFiles() && isReadAsCode(globalObject, required);
    if (!isCodeThatExecutableLoadsFromDisk && AOT::mayHandOutModuleObject(requirer->globalObject(), *compiled))
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
    return image && (image->programTables().flags & AOT::ProgramTables::mayRunInMultipleInstances);
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

extern "C" void Bun__AOT__willRunPreloads(JSC::JSGlobalObject* globalObject)
{
    if (Bun::hasCompiledModules() && Bun::requireCacheListsCompiledFiles())
        JSC::AOT::willRunCodeThatKeepsFiles(globalObject);
}

extern "C" void Bun__AOT__didRunPreloads(JSC::JSGlobalObject* globalObject)
{
    if (Bun::hasCompiledModules() && Bun::requireCacheListsCompiledFiles())
        JSC::AOT::keepFilesThatHaveRun(globalObject);
}

extern "C" bool Bun__isCompiledProgramFileInSomeForm(const BunString* path)
{
    String file = path->toWTFString(BunString::ZeroCopy);
    return Bun::isCompiledModule(file) || (Bun::hasCompiledModules() && JSC::AOT::holdsFormThatAttributeAsksFor(file));
}

extern "C" bool Bun__AOT__mayHoldPathStartingWith(BunAOTBytes start)
{
    std::span<const Latin1Character> text { byteCast<Latin1Character>(start.ptr), start.len };
    if (charactersAreAllASCII(text))
        return JSC::AOT::mayHoldPathStartingWith(StringView(text));
    return JSC::AOT::mayHoldPathStartingWith(String::fromUTF8(std::span<const uint8_t> { start.ptr, start.len }));
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
    // Bytes that are not UTF-8 give the null string, with which every path starts.
    if (startOfPath.isNull() && start.len)
        return;
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

extern "C" JSC::EncodedJSValue Bun__AOT__errorIfCodeOutsideImageIsRefused(JSC::JSGlobalObject* globalObject, Bun::ErrorCode code, const BunString* path)
{
    return JSC::JSValue::encode(Bun::errorIfCodeOutsideImageIsRefused(globalObject, code, path->toWTFString(BunString::ZeroCopy)));
}

// `bun test` runs what lies on disk when a file is first loaded. The run was compiled against what lay there before, and the build saw nothing that writes the file.
extern "C" JSC::EncodedJSValue Bun__AOT__errorIfCompiledFileChangedOutOfSight(JSC::JSGlobalObject* globalObject, Bun::ErrorCode code, const BunString* path)
{
    String file = path->toWTFString(BunString::ZeroCopy);
    if (!JSC::AOT::isChangedOutOfSightOfBuild(globalObject, file))
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

// The answers of the functions above where no image is registered.
namespace Bun {
using namespace JSC;

const AOT::ModuleHost compiledModuleHost {};

std::optional<AOT::ModuleID> compiledModuleForPath(const String&) { return std::nullopt; }
std::optional<bool> isHiddenFromRequireCache(const String&) { return false; }
std::optional<AOT::ModuleID> moduleThatMockReplaces(const String&) { return std::nullopt; }
JSPromise* compiledModuleSource(Zig::GlobalObject*, const String&, const ScriptFetchParameters*) { return nullptr; }
JSPromise* importCompiledModule(Zig::GlobalObject*, const String&, const ScriptFetchParameters*, int64_t) { return nullptr; }
JSValue requireCompiledModuleForTestRunner(Zig::GlobalObject*, const String&) { return {}; }
bool requireCompiledModule(Zig::GlobalObject*, JSCommonJSModule*, const String&, bool) { return false; }
JSObject* loaderOfCompiledESModule(Zig::GlobalObject*, const String&, bool) { return nullptr; }
JSValue loadCompiledModuleNamespace(Zig::GlobalObject*, const String&) { return {}; }
bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject*, JSCommonJSModule*, const String&, bool) { return false; }
bool compiledModulesRunInPlaceOfFiles() { return false; }
bool compiledProgramRunsInSeveralRealmsAtOnce() { return false; }
std::optional<EncodedJSValue> takeAnswerKeptForLoader(JSGlobalObject*, const BunString*, const BunString*, const BunString*, bool&) { return std::nullopt; }
void keepAnswerForLoader(JSGlobalObject*, const BunString*, const BunString*, const BunString*, JSValue, bool) {}
bool holdsAnswersForLoader() { return false; }
void forgetAnswersKeptForLoader(JSGlobalObject*) {}
String fileOfCallerThatWasNotCompiled(VM&, CallFrame*) { return {}; }
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
JSValue mainModuleOfExecutable(Zig::GlobalObject*) { return jsUndefined(); }
void willStorePathOfMainModule(Zig::GlobalObject*, JSValue) {}
bool appendNewChildrenOfCompiledModule(JSGlobalObject*, JSCommonJSModule*) { return true; }
void dropNewChildrenOfCompiledModule(JSCommonJSModule*) {}
JSCommonJSModule* parentOfCompiledModule(JSCommonJSModule*) { return nullptr; }
bool hasCompiledModuleYetToBegin(JSCommonJSModule*) { return false; }
JSValue parentSeenBy(Zig::GlobalObject*, JSString*, JSValue parent) { return parent; }
JSValue errorIfUnseenCodeIsRefused(JSGlobalObject*, ASCIILiteral) { return {}; }
bool isAskingWhyFileFailsToLoad() { return false; }
bool isDebuggerAdmitted() { return true; }
JSValue errorIfDebuggerIsRefused(JSGlobalObject*, ASCIILiteral) { return {}; }
void willSetRequireCacheEntry(Zig::GlobalObject*, const String&, JSValue) {}
void willStoreLoaderOfExtension(Zig::GlobalObject*, StringView) {}
String pathOfRequirer(JSCommonJSModule*, const String& written) { return written; }
void didCreateRequire(VM&, CallFrame*, JSObject*) {}
void didCreateRequireOfCompiledModule(JSObject*) {}
void willResolveImport(Zig::GlobalObject*, const String&, JSValue) {}
void didDeleteRequireCacheEntry(Zig::GlobalObject*, const String&) {}
void willResetModules(Zig::GlobalObject*, ASCIILiteral, bool) {}
Vector<String> bringBackFilesOfPreloads(Zig::GlobalObject*) { return {}; }
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
extern "C" void Bun__AOT__willRunEntryPointAgain(JSC::JSGlobalObject*, const BunString*) {}
extern "C" void Bun__AOT__willRunPreloads(JSC::JSGlobalObject*) {}
extern "C" void Bun__AOT__didRunPreloads(JSC::JSGlobalObject*) {}
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

#endif // ENABLE(AOT)
