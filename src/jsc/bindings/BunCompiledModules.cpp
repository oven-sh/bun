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
JSC::JSPromise* evaluateOriginalOfCompiledMock(Zig::GlobalObject*, JSC::AOT::ModuleID, bool& hasFactory);
bool layMocksOfBodiesAgain(Zig::GlobalObject*, const WTF::ScopedLambda<bool(JSC::AOT::ModuleID)>& isReached);
JSC::JSPromise* factoryOfCompiledMockThatWaits(Zig::GlobalObject*, const WTF::ScopedLambda<bool(JSC::AOT::ModuleID)>& isAskedAbout, JSC::AOT::FactoryAskedForBy, JSC::JSValue& state);
uint64_t callOfFactoryOfCompiledMockThatHasNotSettled(Zig::GlobalObject*, JSC::AOT::ModuleID, bool& refusesEveryRequire);
JSC::JSPromise* turnOfCompiledMockThatLoaderFetches(Zig::GlobalObject*, uint32_t module, const String& key);
void giveBackTurnOfCompiledMockUnlessItRuns(Zig::GlobalObject*, JSC::JSValue holder);
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
extern "C" bool Bun__compiledProgramNamesPlugin();
extern "C" JSC::AOT::AnswerForName Bun__AOT__onResolveAnswersFor(JSC::JSGlobalObject*, const BunString* name, const BunString* importer, BunString* foundWithoutPlugins);
extern "C" BunString Bun__AOT__findWithoutPlugins(JSC::JSGlobalObject*, const BunString* name, const BunString* importer);
extern "C" bool Bun__compiledProgramHoldsFileAsItIs(const BunString*);
extern "C" bool Bun__compiledProgramDataFileIsPrintedAsJavaScript(JSC::JSGlobalObject*, const BunString*);
extern "C" JSC::EncodedJSValue Bun__compiledProgramErrorOfRefusedData(JSC::JSGlobalObject*, const BunString*);
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

void didKeepText(VM& vm, const String& key, bool isOfPlugin)
{
    if (auto module = hasCompiledModules() ? compiledModuleForPath(key) : std::nullopt)
        AOT::didKeepTextInHost(vm, *module, isOfPlugin);
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

static String findsWithoutPlugins(JSGlobalObject* globalObject, const String& name, const String& importer)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
    BunString nameArgument = Bun::toString(name);
    BunString importerArgument = Bun::toString(importer);
    BunString found = Bun__AOT__findWithoutPlugins(globalObject, &nameArgument, &importerArgument);
    (void)scope.tryClearException();
    return found.isDead() ? String() : found.transferToWTFString();
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
static bool keepsFilesFromCodeFromDisk()
{
    return Bun__AOT__allowsCodeFromDisk() && !isBunTest && !Bun__compiledProgramRunsInPlace();
}

static bool refusesFileToAsker(JSGlobalObject* globalObject, AOT::ModuleID module, AOT::LoadByName way)
{
    if (!keepsFilesFromCodeFromDisk())
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

// The resolver does not see the attributes of an import, and finds a file that the executable holds in any form. A require(), and an import call without a type, find it as where the executable holds nothing of it. Its path stays one that require.resolve() gives and that can be read.
void throwIfHeldUnderTypesAlone(Zig::GlobalObject* globalObject, const String& key, const String& specifier, const String& importer, bool isForRequire)
{
    if (Bun__compiledProgramRunsInPlace() || moduleThatAnswersToPath(key) || findDefaultForm(key) || !AOT::holdsFormThatAttributeAsksFor(key))
        return;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    BunString specifierString = Bun::toString(specifier);
    BunString referrer = Bun::toString(importer);
    throwException(globalObject, scope, JSValue::decode(ResolveMessage__createModuleNotFound(globalObject, &specifierString, &referrer, isForRequire)));
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
BUN_DECLARE_HOST_FUNCTION(jsFunctionCompiledSourceBehindTurn);

static String keyOfFetch(JSArray* fetch)
{
    return uncheckedDowncast<AbstractModuleRecord>(fetch->getIndexQuickly(0).asCell())->moduleKey().string();
}

static void fetchIsHeldBehindFactoryNoMore(Zig::GlobalObject* globalObject, JSArray* fetch)
{
    globalObject->onLoadPlugins.compiledFetchesHeldBehindFactories.removeFirst(keyOfFetch(fetch));
}

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
    globalObject->onLoadPlugins.compiledFetchesHeldBehindFactories.append(keyOfFetch(fetch));
    factory->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionCompiledSourceAfterFactory), globalObject->thenable(jsFunctionCompiledSourceAfterFailedFactory), source, fetch);
    return source;
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFactory, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    fetchIsHeldBehindFactoryNoMore(globalObject, asArray(callFrame->argument(1)));
    AOT::fetchDidGoOnBehindFactory(globalObject);
    JSPromise* next = JSPromise::create(getVM(globalObject), globalObject->promiseStructure());
    return JSValue::encode(sourceAfterFactories(globalObject, next, asArray(callFrame->argument(1))));
}

// The first argument: the mock that has the turn, see turnOfCompiledMockThatLoaderFetches().
BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledSourceBehindTurn, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSPromise* next = JSPromise::create(getVM(globalObject), globalObject->promiseStructure());
    JSPromise* source = sourceAfterFactories(globalObject, next, asArray(callFrame->argument(1)));
    Zig::giveBackTurnOfCompiledMockUnlessItRuns(globalObject, callFrame->argument(0));
    return JSValue::encode(source);
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledSourceAfterFailedFactory, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    fetchIsHeldBehindFactoryNoMore(defaultGlobalObject(globalObject), asArray(callFrame->argument(1)));
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
    // A require() cannot wait.
    JSPromise* turn = attributes || vm.synchronousModuleQueue() || globalObject->onLoadPlugins.compiledMocksToRun.isEmpty() ? nullptr : Zig::turnOfCompiledMockThatLoaderFetches(globalObject, module->index(), key);
    if (turn) [[unlikely]]
        AOT::willFetchBehindTurn(globalObject, *module);
    bool hasCalledFactoryThatWaits = !turn && AOT::runMocksBelow(globalObject, *module);
    if (scope.exception()) [[unlikely]]
        return AOT::mockFailedBehindImportStatement(globalObject, *module) ? nullptr : rejected();
    JSPromise* source = JSPromise::create(vm, globalObject->promiseStructure());
    if (!turn && !hasCalledFactoryThatWaits && globalObject->onLoadPlugins.factoriesOfCompiledMocks.isEmpty()) [[likely]] {
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
    if (turn) [[unlikely]] {
        turn->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionCompiledSourceBehindTurn), globalObject->thenable(jsFunctionCompiledSourceAfterFailedFactory), source, heldFetch);
        return source;
    }
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

static std::optional<AOT::ModuleID> compiledModuleThatAsksThrough(JSCommonJSModule* requirer)
{
    if (auto own = compiledModuleOf(requirer))
        return own;
    uint32_t asker = requirer->compiledModuleThatAsks();
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

JSC_DECLARE_HOST_FUNCTION(jsLoaderJS);
JSC_DECLARE_HOST_FUNCTION(jsLoaderTS);
JSC_DECLARE_HOST_FUNCTION(jsLoaderJSON);

// NodeModuleModule.rs find_longest_registered_extension(): the first extension of the name, from the left, under which a function is stored. One of the default loaders is no function of the program.
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

// While a loader of the program runs: the object that require() has made, and the file that it has made it for.
struct RequireHandedToLoaderOfProgram {
    JSCommonJSModule* target { nullptr };
    const String* path { nullptr };
    uint32_t module { 0 };
    // The engine has taken `target` for the file's `module`.
    bool isModuleOfFile { false };
};
static constinit thread_local RequireHandedToLoaderOfProgram s_requireHandedToLoaderOfProgram;

static void requireCompiledModuleInto(Zig::GlobalObject*, JSCommonJSModule* target, AOT::ModuleID, JSString* key);
static JSObject* attachRequireFunction(VM&, Zig::GlobalObject*, JSCommonJSModule*, JSString* path);
static void layOnModuleObject(Zig::GlobalObject*, JSCommonJSModule*, JSString* path, AOT::ModuleID, OptionSet<AOT::ModuleObjectTrait>, AOT::ModuleObjects& out);
static bool layExportsVariableIfModuleObjectOfFile(Zig::GlobalObject*, JSCommonJSModule*, AOT::ModuleID);

bool goOnWithRequireHandedToLoaderOfProgram(Zig::GlobalObject* globalObject, JSCommonJSModule* target, const String& path)
{
    RequireHandedToLoaderOfProgram handed = s_requireHandedToLoaderOfProgram;
    if (!handed.target || handed.target != target || *handed.path != path)
        return false;
    // `bun run` leaves the object as it is: JSCommonJSModule::evaluate() runs nothing into an object that has been evaluated.
    if (target->hasEvaluated)
        return true;
    if (target->m_overriddenCompile) {
        AOT::throwTextRefusedToCompileOfProgram(globalObject, AOT::ModuleID(handed.module));
        return false;
    }
    SetForScope nothingIsHanded(s_requireHandedToLoaderOfProgram, RequireHandedToLoaderOfProgram {});
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    // Ahead of the body, as in `bun run`: a file that throws is not run again by a second call.
    target->hasEvaluated = true;
    requireCompiledModuleInto(globalObject, target, AOT::ModuleID(handed.module), jsString(getVM(globalObject), path));
    RETURN_IF_EXCEPTION(scope, false);
    return true;
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
    // In a test run willStoreLoaderOfExtension() has taken the files of the kind out of the program.
    if (JSValue loader = reloadsFilesFromDisk() ? JSValue() : loaderOfProgramForFile(globalObject, path)) {
        JSString* key = jsString(vm, path);
        // What the loader lays on the object the file finds on its `module`, as in `bun run`.
        auto traits = AOT::traitsOfModuleObjectYetToBeMade(globalObject, *module);
        // Until the file runs it is an object of require() like any other: `exports` is the empty object that lies there, and it is a child of whoever asked.
        if (traits) {
            AOT::ModuleObjects objects;
            objects.module = target;
            objects.require = attachRequireFunction(vm, globalObject, target, key);
            RETURN_IF_EXCEPTION(scope, false);
            AOT::takeModuleObject(globalObject, *module, objects);
        }
        SetForScope isHanded(s_requireHandedToLoaderOfProgram, RequireHandedToLoaderOfProgram { target, &path, module->index(), traits.has_value() });
        MarkedArgumentBuffer arguments;
        arguments.append(target);
        arguments.append(key);
        JSC::profiledCall(globalObject, ProfilingReason::API, loader, getCallData(loader), target, arguments);
        if (scope.exception()) [[unlikely]] {
            // The object leaves the cache. Where the file has not run, or may run again, the next require() makes its `module`.
            if (traits)
                AOT::giveBackModuleObject(globalObject, *module);
            return false;
        }
        // The object stays in the cache, as in `bun run`: the loader is called once for a file.
        return true;
    }
    JSString* key = jsString(vm, path);
    requireCompiledModuleInto(globalObject, target, *module, key);
    RETURN_IF_EXCEPTION(scope, false);
    target->hasEvaluated = true;
    // A module of the executable is in no cache. The next require() of the name asks the engine again, which answers what the module exports then.
    JSValue held = globalObject->requireMap()->get(globalObject, key);
    RETURN_IF_EXCEPTION(scope, false);
    if (held == target) {
        globalObject->requireMap()->remove(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
    }
    return true;
}

static void requireCompiledModuleInto(Zig::GlobalObject* globalObject, JSCommonJSModule* target, AOT::ModuleID module, JSString* key)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSCommonJSModule* requirer = target->m_parent.get();
    // `target` is the object that require() under a computed name has made to load the file into.
    auto referrer = requirer ? compiledModuleThatAsksThrough(requirer) : std::nullopt;
    // The engine says whose child the file is.
    if (referrer)
        target->compiledModule = module.index();
    if (requirer && !referrer) {
        target->compiledModuleLoadedInto = module.index();
        AOT::willRequireModuleFromOutsideImage(globalObject, module, requirer);
    }
    if (reloadsFilesFromDisk()) {
        if (AOT::isESModule(module))
            AOT::didMakeModuleObjectForRequire(globalObject, module, target);
        else
            globalObject->requireMap()->remove(globalObject, key);
        RETURN_IF_EXCEPTION(scope, void());
    }
    bool readsExportsOffVariable = layExportsVariableIfModuleObjectOfFile(globalObject, target, module);
    RETURN_IF_EXCEPTION(scope, void());
    if (readsExportsOffVariable) {
        scope.release();
        AOT::requireModule(globalObject, module, referrer);
        return;
    }
    RELEASE_AND_RETURN(scope, requireInto(globalObject, target, module, referrer));
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

// The object that the default loader is handed is the file's `module`, as in `bun run`. Where the loader of the program hands on another object, or names another file, the one that require() has made is an object like any other again.
static void takeForModuleObjectOfFile(Zig::GlobalObject* globalObject, JSCommonJSModule* target, AOT::ModuleID module, const String& path)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RequireHandedToLoaderOfProgram handed = s_requireHandedToLoaderOfProgram;
    if (handed.target && (handed.target == target || handed.module == module.index())) {
        s_requireHandedToLoaderOfProgram = {};
        if (handed.isModuleOfFile)
            AOT::giveBackModuleObject(globalObject, AOT::ModuleID(handed.module));
    }
    // A file that has run, or is running, keeps its `module`, also where nothing has asked for the object yet.
    if (AOT::refusesToRunFileForDefaultLoader(globalObject, module) || !AOT::traitsOfModuleObjectYetToBeMade(globalObject, module))
        return;
    AOT::ModuleObjects objects;
    objects.module = target;
    objects.require = attachRequireFunction(vm, globalObject, target, jsString(vm, path));
    RETURN_IF_EXCEPTION(scope, void());
    target->compiledModule = module.index();
    // Its parent is what the program made it with, and not whoever asks for the file first.
    target->m_isParentStored = true;
    AOT::takeModuleObject(globalObject, module, objects);
}

bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject* globalObject, JSCommonJSModule* target, const String& path, bool isTypeScriptLoader)
{
    if (!hasCompiledModules() || target->moduleGraph() || target->m_overriddenCompile) [[likely]]
        return false;
    auto module = compiledModuleForPath(path);
    // The run time has sent the call here for such a file: it would only send it here again.
    if (!module || AOT::leavesModuleToHost(globalObject, *module))
        return false;
    // `bun run` reads the file and leaves the object as it is: JSCommonJSModule::evaluate() runs nothing into an object that has been evaluated or is being evaluated.
    if (target->hasEvaluated)
        return true;
    BunString pathString = Bun::toString(path);
    auto loader = Bun__getDefaultLoader(globalObject, &pathString, nullptr);
    bool isTypeScriptFile = loader == BunLoaderTypeTS || loader == BunLoaderTypeTSX;
    if (isTypeScriptFile != isTypeScriptLoader)
        return false;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    // Whoever has the function of a default loader can hand it any object and any path. Ahead of what is laid on the object: a refusal leaves it as it was.
    String pathOfAsker = pathOfRequirer(target, String());
    AOT::AskerOfModule asker(globalObject, pathOfAsker);
    if (refusesFileToAsker(globalObject, *module, AOT::LoadByName::Require))
        return false;
    takeForModuleObjectOfFile(globalObject, target, *module, path);
    RETURN_IF_EXCEPTION(scope, false);
    // `bun run` runs the text once more, into `target`. The image has the file once, so what has run cannot run beside itself.
    bool readsExportsOffVariable = layExportsVariableIfModuleObjectOfFile(globalObject, target, *module);
    RETURN_IF_EXCEPTION(scope, false);
    // A refusal is no throw of the file: nothing has run into the object, which stays as it was, and the next call is refused as well.
    bool isRefused = AOT::refusesToRunFileForDefaultLoader(globalObject, *module);
    // Ahead of the body, as in `bun run`: a file that throws is not run again into the same object.
    target->hasEvaluated = !isRefused;
    JSValue exports = AOT::runFileForDefaultLoader(globalObject, *module);
    bool hasThrown = scope.exception();
    // An ES module that threw has laid nothing: the object keeps what it had.
    if (readsExportsOffVariable || isRefused || (hasThrown && AOT::isESModule(*module)))
        return !hasThrown;
    // `bun run` runs the text into the object's own `exports`: what the file had laid there when it threw is there.
    target->setExportsObject(hasThrown ? AOT::moduleExports(globalObject, *module) : exports);
    return !hasThrown;
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

// A require() could not wait for the factory of a mock that nobody had loaded, and ran the file beside it: `bun test` keeps that original under a key of its own, and nothing under the file's.
static bool ranBesideMockThatWaits(Zig::GlobalObject* globalObject, AOT::ModuleID module)
{
    return AOT::isEvaluatedFile(globalObject, module) && AOT::hasMockThatWaitsOrRuns(globalObject, module) && !AOT::isLeftAloneByMock(globalObject, module);
}

void didDeleteRequireCacheEntry(Zig::GlobalObject* globalObject, const String& key)
{
    auto module = reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    if (module && ranBesideMockThatWaits(globalObject, *module))
        return AOT::didDeleteEntryUnderMockThatWaits(globalObject, *module);
    // Under a mock the original lies under a key of its own and outlives the entry; so it does behind an end that brought nothing back. Where the end of the mock has moved it back under this key, it goes with the entry.
    auto* mocks = globalObject->onLoadPlugins.virtualModules;
    if (module && AOT::isEvictedFile(globalObject, *module) && AOT::didOriginalComeBackUnderOwnKey(globalObject, *module) && !(mocks && mocks->contains(key)))
        AOT::forgetOriginalOfFileThatLeftProgram(globalObject, *module);
    takeOutOfProgram(globalObject, key, [](JSGlobalObject* realm, AOT::ModuleID module) {
        if (AOT::isSetAsideByMock(realm, module))
            AOT::didDeleteEntryOfMockOverFileSetAside(realm, module);
        else
            AOT::didDeleteRequireCacheEntry(realm, module);
    });
}

bool didSetCompiledFileAside(Zig::GlobalObject* globalObject, const String& key)
{
    auto module = reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    if (!module || !AOT::isSetAsideByMock(globalObject, *module) || AOT::liesUnderKeyOfOriginal(globalObject, *module))
        return false;
    AOT::setLiesUnderKeyOfOriginal(globalObject, *module, true);
    return true;
}

bool isOriginalKeptOfCompiledFile(Zig::GlobalObject* globalObject, const String& key)
{
    auto module = reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    return module && AOT::isEvictedFile(globalObject, *module) && AOT::exportsBehindEntryOfProgram(globalObject, *module);
}

bool willUnmockCompiledFile(Zig::GlobalObject* globalObject, const String& key, bool bringsBack, bool isReplacedByLaterMock)
{
    auto module = reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    if (!module)
        return false;
    AOT::setOriginalCameBackUnderOwnKey(globalObject, *module, bringsBack);
    bool liesUnderKeyOfOriginal = AOT::liesUnderKeyOfOriginal(globalObject, *module) || ranBesideMockThatWaits(globalObject, *module);
    bool mayLeaveProgram = !AOT::refusesToLoadAgain(globalObject, *module);
    bool runsAtNextLoad = liesUnderKeyOfOriginal && !bringsBack && !isReplacedByLaterMock && AOT::isEvaluatedFile(globalObject, *module) && (mayLeaveProgram || !AOT::isESModule(*module));
    AOT::setLiesUnderKeyOfOriginal(globalObject, *module, liesUnderKeyOfOriginal && !bringsBack && !(runsAtNextLoad && mayLeaveProgram));
    if (runsAtNextLoad && mayLeaveProgram)
        AOT::keepOriginalOfFileThatLeavesProgram(globalObject, *module);
    return runsAtNextLoad;
}

void didUnmockCompiledFile(Zig::GlobalObject* globalObject, const String& key, bool runsAtNextLoad, bool bringsBack, bool factoryIsPending)
{
    // Nothing lies under the file's own key: the next load runs the file. Where the build has not seen that the file may leave the program, its compiled body runs once more,
    // and the run that lies under the key of the original is kept for the next mock. Not where this end has brought a preload's mock back, nor while the factory of the mock that ended has yet to settle.
    if (auto file = runsAtNextLoad ? compiledModuleForPath(key) : std::nullopt; file && AOT::refusesToLoadAgain(globalObject, *file)) {
        if (!factoryIsPending && !AOT::hasMockInPlace(globalObject, *file) && !AOT::hasMockThatWaitsOrRuns(globalObject, *file))
            AOT::parkRunUnderKeyOfOriginal(globalObject, *file);
        return;
    }
    if (runsAtNextLoad)
        return didDeleteRequireCacheEntry(globalObject, key);
    auto module = bringsBack && reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    if (!module || !AOT::isEvictedFile(globalObject, *module) || AOT::isESModule(*module))
        return;
    // The program stored a module of its own meanwhile, so the file has left the program. The end of the mock moves the original back under the file's key.
    JSValue original = AOT::exportsBehindEntryOfProgram(globalObject, *module);
    if (!original)
        return;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    // An earlier end has made the module object, the later mock has set that aside, and the loader's own move has brought it back.
    JSValue moved = Bun::testFileRequireMap(globalObject)->get(globalObject, jsStringWithCache(vm, key));
    RETURN_IF_EXCEPTION(scope, );
    if (auto* present = moved.isCell() ? dynamicDowncast<JSCommonJSModule>(moved.asCell()) : nullptr) {
        JSValue exports = present->exportsObject();
        RETURN_IF_EXCEPTION(scope, );
        if (exports == original)
            return;
    }
    JSObject* held = AOT::moduleObjectBehindEntryOfProgram(globalObject, *module);
    auto* back = held ? dynamicDowncast<JSCommonJSModule>(held) : nullptr;
    if (back)
        back->putDirect(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), original, 0);
    else
        back = JSCommonJSModule::create(globalObject, key, original, true, JSValue());
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    Bun::testFileRequireMap(globalObject)->set(globalObject, jsStringWithCache(vm, key), back);
}

void willMockFileLoadedAnew(Zig::GlobalObject* globalObject, const String& key, JSValue exportsOfLoad)
{
    auto module = reloadsFilesFromDisk() ? compiledModuleForPath(key) : std::nullopt;
    // What came back at the end of an earlier mock is no load anew.
    if (module && AOT::isEvictedFile(globalObject, *module) && AOT::exportsBehindEntryOfProgram(globalObject, *module) != exportsOfLoad)
        AOT::forgetOriginalOfFileThatLeftProgram(globalObject, *module);
}

void willResetModules(Zig::GlobalObject* globalObject, ASCIILiteral call, bool keepsPackages)
{
    if (!hasCompiledModules() || !reloadsFilesFromDisk())
        return;
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    String packages = makeString(PLATFORM_SEP, "node_modules"_s, PLATFORM_SEP);
    // isExternalizedByVitest(): Vitest loads an ES module that Node would read as CommonJS like the project's modules, and resets it with them.
    auto isKept = [&](const String& path) {
        auto module = moduleThatAnswersToPath(path);
        // It stands as evaluated, and goes with what failed, behind what the reset takes out.
        if (module && AOT::errorThrownByBodyOfMockedModule(globalObject, *module))
            return true;
        if (!keepsPackages || !path.contains(packages))
            return false;
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
    // One that awaits at its top, or waits for such a one, finishes as it is, and the next import loads it anew.
    AOT::forEachFileWhoseEvaluationAwaits(globalObject, [&](const String& path) {
        if (!isKept(path) && !files.contains(path))
            files.append(path);
    });
    // So is the original of a mock that the run time keeps of a file for which the program stored a module of its own.
    AOT::forEachFileBehindEntryOfProgram(globalObject, [&](const String& path) {
        if (!isKept(path) && !files.contains(path))
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
    // A mock that was loaded since lies under the key.
    if (!module || !AOT::isEvaluatedFile(globalObject, *module) || (AOT::wasLetGoByLoader(globalObject, *module) && !AOT::hasMockInPlace(globalObject, *module)) || AOT::hasMockThatWaitsOrRuns(globalObject, *module) || AOT::isKeyOfMockInPlaceEmpty(globalObject, *module))
        return std::nullopt;
    return AOT::isLeftAloneByMock(globalObject, *module) && !AOT::hasMockInPlace(globalObject, *module) ? std::nullopt : module;
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
        if (reloadsFilesFromDisk() && !AOT::isSetAsideByMock(globalObject, *module) && !ranBesideMockThatWaits(globalObject, *module))
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
    // and only a file that is asked for under a name made as the program runs is handed to it, as in an executable of `bun build --compile`.
    if (!hasCompiledModules())
        return;
    if (reloadsFilesFromDisk())
        AOT::willStoreLoaderOfExtension(globalObject, extension);
    else
        AOT::willChangeRequireOverride(globalObject, AOT::RequireOverride::LoaderOfExtension, true);
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
    // `createRequire(__dirname + "/locales/")`: no file of the executable has the path, and code of the executable asks all the same.
    // Nothing vouches for any other object, or for none, and what it calls its path is a claim.
    return requirer && (compiledModuleOf(requirer) || requirer->isMadeByCodeOfImage) ? AOT::askerThatIsProgram() : written;
}

// bun:main is the host's own module: where it imports the entry point, the host starts the program. No text gets that key, or none.
// The key under which the loader holds a compiled record is the loader's own: no code chooses the key of the module that it is.
const String& askerOfImport(const String& importer)
{
    return importer.isEmpty() || importer == "bun:main"_s || compiledModuleForPath(importer) ? AOT::askerThatIsProgram() : importer;
}

// Compiled code's import() does not come to the host's entry. The origin of any other code is what its maker called it: a claim.
// Where nothing is kept from anybody the asker chooses the words of a refusal alone, and they go by the origin.
const String& askerOfImportCallInCodeThatIsNotCompiled(const String& origin)
{
    return askerOfImport(referrerOfImportCallInCodeThatIsNotCompiled(origin));
}

const String& referrerOfImportCallInCodeThatIsNotCompiled(const String& origin)
{
    static NeverDestroyed<const String> nobody(MAKE_STATIC_STRING_IMPL("."));
    return keepsFilesFromCodeFromDisk() ? nobody.get() : origin;
}

void didCreateRequire(VM& vm, CallFrame* callFrame, JSObject* require)
{
    JSCommonJSModule* module = hasCompiledModules() ? boundModuleOf(require) : nullptr;
    if (!module)
        return;
    // Where compiled code names createRequire(), it hands it as `this` a function that no program comes by. Any other call may be anybody's.
    JSValue word = require->globalObject()->getDirect(vm, WebCore::builtinNames(vm).createCommonJSModulePrivateName());
    module->isMadeByCodeOfImage = word && callFrame->thisValue() == word;
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
    if (!traits.contains(AOT::ModuleObjectTrait::IsNoCommonJSFile))
        exportsAsData = JSValue();
    JSCommonJSModule* module = JSCommonJSModule::create(globalObject, path, exportsAsData, !traits.contains(AOT::ModuleObjectTrait::IsESModule), JSValue());
    RETURN_IF_EXCEPTION(scope, void());
    RELEASE_AND_RETURN(scope, layOnModuleObject(globalObject, module, path, compiled, traits, out));
}

static bool layExportsVariableOnModuleObject(Zig::GlobalObject* globalObject, JSCommonJSModule* module)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const Identifier& exportsName = WebCore::clientData(vm)->builtinNames().exportsPublicName();
    // putDirectCustomAccessor() is for a name that the object does not have yet. The object that require() has made has it.
    if (JSValue laid = module->getDirect(vm, exportsName)) {
        if (laid.isCustomGetterSetter())
            return true;
        // The program may have made the property one that cannot be deleted.
        bool isDeleted = JSCell::deleteProperty(module, globalObject, exportsName);
        RETURN_IF_EXCEPTION(scope, false);
        if (!isDeleted)
            return false;
    }
    auto* accessors = CustomGetterSetter::create(vm, getterExportsOfCompiledModule, setterExportsOfCompiledModule);
    module->putDirectCustomAccessor(vm, exportsName, accessors, PropertyAttribute::CustomValue | 0);
    return true;
}

// From the moment the file runs, the `exports` of its own `module` is the variable of the program.
static bool layExportsVariableIfModuleObjectOfFile(Zig::GlobalObject* globalObject, JSCommonJSModule* target, AOT::ModuleID module)
{
    if (AOT::moduleObjectOverExportsVariableIfMade(globalObject, module) != target)
        return false;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    target->compiledModule = module.index();
    bool isLaid = layExportsVariableOnModuleObject(globalObject, target);
    RETURN_IF_EXCEPTION(scope, false);
    // Over a property that the program has made fixed nothing is laid: what the file exports is in the variable alone.
    if (isLaid)
        AOT::didLayExportsVariableOnModuleObject(globalObject, module);
    return isLaid;
}

static void layOnModuleObject(Zig::GlobalObject* globalObject, JSCommonJSModule* module, JSString* path, AOT::ModuleID compiled, OptionSet<AOT::ModuleObjectTrait> traits, AOT::ModuleObjects& out)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    module->compiledModule = compiled.index();
    if (traits.contains(AOT::ModuleObjectTrait::IsMain))
        module->m_id.set(vm, module, jsString(vm, String("."_s)));
    if (traits.contains(AOT::ModuleObjectTrait::HasExportsVariable)) {
        layExportsVariableOnModuleObject(globalObject, module);
        RETURN_IF_EXCEPTION(scope, void());
    }
    out.module = module;
    if (traits.contains(AOT::ModuleObjectTrait::IsNoCommonJSFile))
        return;
    scope.release();
    out.require = attachRequireFunction(vm, globalObject, module, path);
}

// The program may have stored the `require` of another file in `import.meta.require`: who asks through that is the other file.
static void layAskerOnRequirer(JSCommonJSModule* requirer, AOT::ModuleID asker)
{
    requirer->isMadeByCodeOfImage = true;
    if (!requirer->areChildrenListedByEngine())
        requirer->setCompiledModuleThatAsks(asker.index());
}

static void createRequirer(JSGlobalObject* realm, JSObject* importMeta, AOT::ModuleID asker, AOT::ModuleObjects& out)
{
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* meta = uncheckedDowncast<Zig::ImportMetaObject>(importMeta);
    out.require = meta->requireProperty.getInitializedOnMainThread(meta);
    RETURN_IF_EXCEPTION(scope, void());
    // The engine asks for the loader of a module of the image.
    if (JSCommonJSModule* module = boundModuleOf(out.require)) [[likely]] {
        layAskerOnRequirer(module, asker);
        out.module = module;
        return;
    }

    // The program replaced import.meta.require with a value that is not bound to a module object.
    String path = meta->pathProperty.getInitializedOnMainThread(meta)->value(realm);
    RETURN_IF_EXCEPTION(scope, void());
    JSObject* ownRequire = JSCommonJSModule::createBoundRequireFunction(vm, realm, path, meta->moduleGraph());
    RETURN_IF_EXCEPTION(scope, void());
    JSCommonJSModule* module = boundModuleOf(ownRequire);
    layAskerOnRequirer(module, asker);
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

static void makeListOfChildren(JSGlobalObject* realm, JSCommonJSModule* parent)
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
    auto compiled = compiledModuleThatAsksThrough(parent);
    if (!compiled)
        return true;
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool areShown = AOT::forEachNewChild(parent->globalObject(), *compiled, [&](JSObject* child) {
        if (!parent->m_childrenValue && !child->inherits<JSCommonJSModule>()) {
            makeListOfChildren(realm, parent);
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
    if (auto compiled = compiledModuleThatAsksThrough(parent))
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

JSObject* parentOfCompiledModule(JSCommonJSModule* module)
{
    auto compiled = compiledModuleOf(module);
    JSObject* parent = compiled ? AOT::parentModuleObject(module->globalObject(), *compiled) : nullptr;
    if (parent && !parent->inherits<JSCommonJSModule>())
        module->m_overriddenParent.set(getVM(module->globalObject()), module, parent);
    return parent;
}

static void didForgetRunOfModuleObject(JSGlobalObject* realm, JSObject* object, bool nextRunBegins)
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
    if (nextRunBegins)
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
    // Of a file of data that its parser refused the executable holds the place, and nothing to parse again.
    BunString pathOfForm = Bun::toString(path);
    if (JSValue refused = JSValue::decode(Bun__compiledProgramErrorOfRefusedData(realm, &pathOfForm)))
        return refused;
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

static JSPromise* evaluateOriginalOfMock(JSGlobalObject* globalObject, AOT::ModuleID module, bool& hasFactory)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, Abort, JSPromise*)
    return Zig::evaluateOriginalOfCompiledMock(uncheckedDowncast<Zig::GlobalObject>(globalObject), module, hasFactory);
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

static uint64_t callOfFactoryThatHasNotSettled(JSGlobalObject* globalObject, AOT::ModuleID module, bool& refusesEveryRequire)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, uint64_t)
    return Zig::callOfFactoryOfCompiledMockThatHasNotSettled(defaultGlobalObject(globalObject), module, refusesEveryRequire);
    BUN_END_REMOVABLE_ENTRY_POINT
}

static void didStartImport(JSGlobalObject* globalObject, JSPromise* import, const String& path)
{
    if (isBunTest)
        didStartDynamicImport(defaultGlobalObject(globalObject), import, path);
}

// What holds for the statements of the importer, which are linked, does not hold for a call of import() in it, which asks anew.
static bool staysLinkedToFileAheadOfMock(JSGlobalObject* globalObject, const String& path, const String& importer)
{
    return defaultGlobalObject(globalObject)->onLoadPlugins.compiledImportersLinkedAheadOfMocks.containsIf([&](const auto& linked) { return linked.mocked == path && linked.importer == importer; });
}

static bool givesOriginalBesideMock(JSGlobalObject* globalObject, const String& path, const String& importer, bool isImport)
{
    // A later mock waits over the one that stands, and a require() cannot wait for its factory: as in ModuleLoader.cpp.
    if (!isImport && canRequireOriginalOfModuleMockAt(defaultGlobalObject(globalObject), path))
        return true;
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

extern "C" bool Bun__AOT__loadsCompiledFileBelowVitest(void* bunVM);

static bool loadsBelowVitest(JSGlobalObject* globalObject)
{
    return Bun__AOT__loadsCompiledFileBelowVitest(defaultGlobalObject(globalObject)->bunVM());
}

static bool printsDataFileAsJavaScript(JSGlobalObject* globalObject, const String& path)
{
    BunString pathString = Bun::toString(path);
    return Bun__compiledProgramDataFileIsPrintedAsJavaScript(globalObject, &pathString);
}

extern "C" void Bun__compiledProgramWillRunTextOfFile(JSGlobalObject* globalObject, const BunString* specifier)
{
    String path = specifier->toWTFString(BunString::ZeroCopy);
    if (auto module = hasCompiledModules() ? compiledModuleForPath(path) : std::nullopt; module && !AOT::isDataFile(*module) && AOT::isEvictedFile(globalObject, *module))
        recordFileRunFromSource(globalObject, path, "it was loaded a second time, or it changed on disk after the build"_s);
}

static void dropKeptText(JSGlobalObject* globalObject, const String& path)
{
    Bun::IsolatedModuleCache::evict(globalObject->vm(), path);
}

static void stopWithReport(std::span<const char> reason)
{
    Bun__panic(reason.data(), reason.size());
}

static bool openCompressedText(std::span<uint8_t> text, std::span<const uint8_t> compressed)
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
    &findsWithoutPlugins,
    &askingAboutNames,
    &mockOperations,
    &stampOfFile,
    &givesOriginalBesideMock,
    &staysLinkedToFileAheadOfMock,
    &factoryThatWaits,
    &isInPreload,
    &layMocksAgain,
    &callInLaterTurn,
    &didStartImport,
    &holdsTextsOfProgram,
    &isCalledFromFactoryThatWaits,
    &keepsTexts,
    &stopWithReport,
    &openCompressedText,
    &callOfFactoryThatHasNotSettled,
    &evaluateOriginalOfMock,
    &loadsBelowVitest,
    &dropKeptText,
    &printsDataFileAsJavaScript,
    &didForgetRunOfModuleObject,
};
// A member missing from the initializer would be null, which tells the engine that the host does not support it.
static_assert(sizeof(AOT::ModuleHost) == 47 * sizeof(void*));

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
    // By what the object is, as in pathOfRequirer(): whoever holds it asks as code of the executable.
    bool asksAsCodeOfImage = compiledModuleOf(requirer) || requirer->isMadeByCodeOfImage;
    if ((!compiled && !asksAsCodeOfImage) || isCompiledModule(required))
        return parent;
    bool isCodeThatExecutableLoadsFromDisk = !compiledModulesRunInPlaceOfFiles() && isReadAsCode(globalObject, required);
    if (!isCodeThatExecutableLoadsFromDisk && (!compiled || AOT::mayHandOutModuleObject(requirer->globalObject(), *compiled)))
        return parent;
    RELEASE_AND_RETURN(scope, JSCommonJSModule::create(globalObject, pathOfRequirer, JSValue(), false, jsUndefined()));
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
    bool isCompiledAsIfNoPluginCame = hasCompiledModules() && !Bun__compiledProgramNamesPlugin() && (isBunTest || !(Bun__compiledProgramRunsInPlace() || Bun__AOT__allowsCodeFromDisk()));
    if (!isCompiledAsIfNoPluginCame) [[likely]]
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
    if (!Bun::hasCompiledModules())
        return;
    JSC::AOT::willRunPreloads(globalObject);
    if (Bun::requireCacheListsCompiledFiles())
        JSC::AOT::willRunCodeThatKeepsFiles(globalObject);
}

extern "C" void Bun__AOT__didRunPreloads(JSC::JSGlobalObject* globalObject)
{
    if (!Bun::hasCompiledModules())
        return;
    JSC::AOT::didRunPreloads(globalObject);
    if (Bun::requireCacheListsCompiledFiles())
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
bool goOnWithRequireHandedToLoaderOfProgram(Zig::GlobalObject*, JSCommonJSModule*, const String&) { return false; }
bool compiledModulesRunInPlaceOfFiles() { return false; }
bool compiledProgramRunsInSeveralRealmsAtOnce() { return false; }
std::optional<EncodedJSValue> takeAnswerKeptForLoader(JSGlobalObject*, const BunString*, const BunString*, const BunString*, bool&) { return std::nullopt; }
void keepAnswerForLoader(JSGlobalObject*, const BunString*, const BunString*, const BunString*, JSValue, bool) {}
bool holdsAnswersForLoader() { return false; }
JSValue errorIfBuildSawNoPlugin(JSGlobalObject*) { return {}; }
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
JSObject* parentOfCompiledModule(JSCommonJSModule*) { return nullptr; }
JSValue parentSeenBy(Zig::GlobalObject*, JSString*, JSValue parent) { return parent; }
JSValue errorIfUnseenCodeIsRefused(JSGlobalObject*, ASCIILiteral) { return {}; }
bool isAskingWhyFileFailsToLoad() { return false; }
bool isDebuggerAdmitted() { return true; }
JSValue errorIfDebuggerIsRefused(JSGlobalObject*, ASCIILiteral) { return {}; }
void willSetRequireCacheEntry(Zig::GlobalObject*, const String&, JSValue) {}
void willStoreLoaderOfExtension(Zig::GlobalObject*, StringView) {}
String pathOfRequirer(JSCommonJSModule*, const String& written) { return written; }
const String& askerOfImport(const String& importer) { return importer; }
const String& askerOfImportCallInCodeThatIsNotCompiled(const String& origin) { return origin; }
const String& referrerOfImportCallInCodeThatIsNotCompiled(const String& origin) { return origin; }
void didCreateRequire(VM&, CallFrame*, JSObject*) {}
void didCreateRequireOfCompiledModule(JSObject*) {}
void willResolveImport(Zig::GlobalObject*, const String&, JSValue) {}
void throwIfHeldUnderTypesAlone(Zig::GlobalObject*, const String&, const String&, const String&, bool) {}
void didDeleteRequireCacheEntry(Zig::GlobalObject*, const String&) {}
bool willUnmockCompiledFile(Zig::GlobalObject*, const String&, bool, bool) { return false; }
void didUnmockCompiledFile(Zig::GlobalObject*, const String&, bool, bool, bool) {}
bool didSetCompiledFileAside(Zig::GlobalObject*, const String&) { return false; }
bool isOriginalKeptOfCompiledFile(Zig::GlobalObject*, const String&) { return false; }
void willMockFileLoadedAnew(Zig::GlobalObject*, const String&, JSValue) {}
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
