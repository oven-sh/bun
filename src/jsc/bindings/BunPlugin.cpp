#include "BunPlugin.h"
#include "BunCompiledModules.h"

#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSCast.h"
#include "headers-handwritten.h"
#include "headers.h"
#include "helpers.h"
#include "ZigGlobalObject.h"
#include "NodeAsyncHooks.h"

#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/FunctionCodeBlock.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/ModuleRegistryEntry.h>
#include <JavaScriptCore/CyclicModuleRecord.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/JavaScript.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/SymbolTableInlines.h>
#include <JavaScriptCore/SyntheticModuleRecord.h>
#include <wtf/SetForScope.h>
#include <wtf/text/StringToIntegerConversion.h>
#include <wtf/text/WTFString.h>

#include "BunClientData.h"
#include "BuiltinModuleKeys.h"
#include "CodeGenerationFromStrings.h"
#include "JSCommonJSModule.h"
#include "ModuleGraph.h"
#include "ModuleLoader.h"
#include "PathInlines.h"
#include "isBuiltinModule.h"
#include "AsyncContextFrame.h"
#include "ImportMetaObject.h"
#include "../modules/ObjectModule.h"

#if ENABLE(AOT)
extern "C" bool Bun__AOT__runsTestFilesAgain();
#endif

namespace Bun {
static bool haveUnfinishedImporterInCommon(Zig::GlobalObject*, const String& earlier, const String& later);
#if ENABLE(AOT)
void recordRepeatedFileRun(JSC::JSGlobalObject*, const String& path, ASCIILiteral why);
#endif
}

extern "C" bool Bun__AOT__runsTestFilesAgain();

namespace Zig {

static void evictModulesAndTheirImporters(Zig::GlobalObject*, Vector<String>&& modules);
#if ENABLE(AOT)
static void clearCompiledProgramFailures(Zig::GlobalObject*, std::optional<JSC::AOT::ModuleID> patched = std::nullopt);
#endif

static bool isValidNamespaceCharacter(char16_t c)
{
    return isASCIIAlphanumeric(c) || c == '_' || c == '-' || c == '/' || c == '@';
}

static bool isValidNamespaceString(String& namespaceString)
{
    return !namespaceString.isEmpty() && namespaceString.containsOnly<isValidNamespaceCharacter>();
}

static bool throwForUnknownPlugin(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope)
{
    JSC::JSValue error = Bun::errorIfBuildSawNoPlugin(globalObject);
    if (error) [[unlikely]]
        throwException(globalObject, scope, error);
    return !!error;
}

static JSC::EncodedJSValue jsFunctionAppendOnLoadPluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (throwForUnknownPlugin(globalObject, scope))
        return {};

    if (callframe->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() requires at least 2 arguments"_s));
        return {};
    }

    auto* filterObject = callframe->uncheckedArgument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::RegExpObject* filter = nullptr;
    auto filterValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "filter"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (filterValue) {
        if (filterValue.isCell() && filterValue.asCell()->inherits<JSC::RegExpObject>())
            filter = uncheckedDowncast<JSC::RegExpObject>(filterValue);
    }

    if (!filter) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() expects first argument to be an object with a filter RegExp"_s));
        return {};
    }

    String namespaceString = String();
    auto namespaceValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "namespace"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (namespaceValue) {
        if (namespaceValue.isString()) {
            namespaceString = namespaceValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (!isValidNamespaceString(namespaceString)) {
                throwException(globalObject, scope, createError(globalObject, "namespace can only contain letters, numbers, dashes, or underscores"_s));
                return {};
            }
        }
    }

    auto func = callframe->uncheckedArgument(1);

    if (!func.isCell() || !func.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() expects second argument to be a function"_s));
        return {};
    }

    if (namespaceString.isEmpty() || namespaceString == "file"_s) {
        String compiled = Bun::firstCompiledModuleMatching(globalObject, filter->regExp());
        RETURN_IF_EXCEPTION(scope, {});
        if (!compiled.isNull()) {
            throwException(globalObject, scope, createError(globalObject, makeString("A runtime plugin can't load \""_s, compiled, "\" because it was already compiled into this executable"_s)));
            return {};
        }
    }

    plugin.append(vm, filter->regExp(), func.getObject(), namespaceString);

    return JSValue::encode(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
}

static EncodedJSValue jsFunctionAppendVirtualModulePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (throwForUnknownPlugin(globalObject, scope))
        return {};

    if (callframe->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "module() needs 2 arguments: a module ID and a function to call"_s));
        return {};
    }

    JSValue moduleIdValue = callframe->uncheckedArgument(0);
    JSValue functionValue = callframe->uncheckedArgument(1);

    if (!moduleIdValue.isString()) {
        throwException(globalObject, scope, createError(globalObject, "module() expects first argument to be a string for the module ID"_s));
        return {};
    }

    if (!functionValue.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "module() expects second argument to be a function"_s));
        return {};
    }

    String moduleId = moduleIdValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (moduleId.isEmpty()) {
        throwException(globalObject, scope, createError(globalObject, "virtual module cannot be blank"_s));
        return {};
    }

    if (Bun::isBuiltinModule(moduleId)) {
        throwException(globalObject, scope, createError(globalObject, makeString("module() cannot be used to override builtin module \""_s, moduleId, "\""_s)));
        return {};
    }

    if (moduleId.startsWith("."_s)) {
        throwException(globalObject, scope, createError(globalObject, "virtual module cannot start with \".\""_s));
        return {};
    }

    if (moduleId.contains('\0')) {
        throwException(globalObject, scope, createError(globalObject, "virtual module cannot contain a null byte"_s));
        return {};
    }

    if (Bun::isCompiledModule(moduleId)) {
        throwException(globalObject, scope, createTypeError(globalObject, "module() cannot replace a module that was compiled ahead of time"_s));
        return {};
    }

    Zig::GlobalObject* global = defaultGlobalObject(globalObject);

    if (global->onLoadPlugins.virtualModules == nullptr) {
        global->onLoadPlugins.virtualModules = new BunPlugin::VirtualModuleMap;
    }
    auto* virtualModules = global->onLoadPlugins.virtualModules;

    virtualModules->set(moduleId, JSC::Strong<JSC::JSObject> { vm, uncheckedDowncast<JSC::JSObject>(functionValue) });
#if ENABLE(AOT)
    if (global->vm().hasCompiledCode())
        JSC::AOT::didChangePlugins(global);
#endif

    evictModulesAndTheirImporters(global, Vector<String> { moduleId });
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
}

extern "C" JSC::EncodedJSValue SYSV_ABI BunObject_getter_main(JSC::JSGlobalObject*);

static JSC::EncodedJSValue jsFunctionAppendOnResolvePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (throwForUnknownPlugin(globalObject, scope))
        return {};

    if (callframe->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "onResolve() requires at least 2 arguments"_s));
        return {};
    }

    auto* filterObject = callframe->uncheckedArgument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::RegExpObject* filter = nullptr;
    auto filterValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "filter"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (filterValue) {
        if (filterValue.isCell() && filterValue.asCell()->inherits<JSC::RegExpObject>())
            filter = uncheckedDowncast<JSC::RegExpObject>(filterValue);
    }

    if (!filter) {
        throwException(globalObject, scope, createError(globalObject, "onResolve() expects first argument to be an object with a filter RegExp"_s));
        return {};
    }

    String namespaceString = String();
    auto namespaceValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "namespace"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (namespaceValue) {
        if (namespaceValue.isString()) {
            namespaceString = namespaceValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (!isValidNamespaceString(namespaceString)) {
                throwException(globalObject, scope, createError(globalObject, "namespace can only contain letters, numbers, dashes, or underscores"_s));
                return {};
            }
        }
    }

    auto func = callframe->uncheckedArgument(1);

    if (!func.isCell() || !func.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "onResolve() expects second argument to be a function"_s));
        return {};
    }

    if (Bun::runsCompiledModules() && (namespaceString.isEmpty() || namespaceString == "file"_s)) {
        JSValue main = JSValue::decode(BunObject_getter_main(defaultGlobalObject(globalObject)));
        RETURN_IF_EXCEPTION(scope, {});
        if (main.isString()) {
            String path = main.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto matchResult = filter->regExp()->match(globalObject, path, 0);
            RETURN_IF_EXCEPTION(scope, {});
            if (matchResult) {
                throwException(globalObject, scope, createError(globalObject, makeString("A runtime plugin can't resolve the entry point \""_s, path, "\" because it was already compiled into this executable"_s)));
                return {};
            }
        }
    }

    plugin.append(vm, filter->regExp(), uncheckedDowncast<JSObject>(func), namespaceString);
#if ENABLE(AOT)
    if (vm.hasCompiledCode())
        JSC::AOT::didChangePlugins(defaultGlobalObject(globalObject));
#endif

    return JSValue::encode(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
}

static JSC::EncodedJSValue jsFunctionAppendOnResolvePluginGlobal(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    Zig::GlobalObject* global = defaultGlobalObject(globalObject);

    auto& plugins = global->onResolvePlugins;
    return jsFunctionAppendOnResolvePluginBody(globalObject, callframe, target, plugins);
}

static JSC::EncodedJSValue jsFunctionAppendOnLoadPluginGlobal(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    Zig::GlobalObject* global = defaultGlobalObject(globalObject);

    auto& plugins = global->onLoadPlugins;
    return jsFunctionAppendOnLoadPluginBody(globalObject, callframe, target, plugins);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnLoadPluginNode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnLoadPluginGlobal(globalObject, callframe, BunPluginTargetNode);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnLoadPluginBun, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnLoadPluginGlobal(globalObject, callframe, BunPluginTargetBun);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnLoadPluginBrowser, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnLoadPluginGlobal(globalObject, callframe, BunPluginTargetBrowser);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnResolvePluginNode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnResolvePluginGlobal(globalObject, callframe, BunPluginTargetNode);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnResolvePluginBun, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnResolvePluginGlobal(globalObject, callframe, BunPluginTargetBun);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendVirtualModule, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendVirtualModulePluginBody(globalObject, callframe);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnResolvePluginBrowser, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnResolvePluginGlobal(globalObject, callframe, BunPluginTargetBrowser);
}

/// `Bun.plugin()`
static inline JSC::EncodedJSValue setupBunPlugin(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callframe->argumentCount() < 1) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs at least one argument (an object)"_s);
        return {};
    }

    JSC::JSObject* obj = callframe->uncheckedArgument(0).getObject();
    if (!obj) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs an object as first argument"_s);
        return {};
    }

    JSC::JSValue setupFunctionValue = obj->getIfPropertyExists(globalObject, Identifier::fromString(vm, "setup"_s));
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!setupFunctionValue || setupFunctionValue.isUndefinedOrNull() || !setupFunctionValue.isCell() || !setupFunctionValue.isCallable()) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs a setup() function"_s);
        return {};
    }

    auto targetValue = obj->getIfPropertyExists(globalObject, Identifier::fromString(vm, "target"_s));
    RETURN_IF_EXCEPTION(throwScope, {});
    if (targetValue) {
        auto* targetJSString = targetValue.toStringOrNull(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        String targetString = targetJSString->value(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!(targetString == "node"_s || targetString == "bun"_s || targetString == "browser"_s)) {
            JSC::throwTypeError(globalObject, throwScope, "plugin target must be one of 'node', 'bun' or 'browser'"_s);
            return {};
        }
    }

    JSObject* builderObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 4);

    Bun::putDirectNamed(vm, builderObject, "target"_s, jsString(vm, String("bun"_s)));
    builderObject->putDirectNativeFunction(
        vm,
        globalObject,
        JSC::Identifier::fromString(vm, "onLoad"_s),
        1,
        jsFunctionAppendOnLoadPluginBun,
        ImplementationVisibility::Public,
        NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    builderObject->putDirectNativeFunction(
        vm,
        globalObject,
        JSC::Identifier::fromString(vm, "onResolve"_s),
        1,
        jsFunctionAppendOnResolvePluginBun,
        ImplementationVisibility::Public,
        NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    builderObject->putDirectNativeFunction(
        vm,
        globalObject,
        JSC::Identifier::fromString(vm, "module"_s),
        1,
        jsFunctionAppendVirtualModule,
        ImplementationVisibility::Public,
        NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    JSC::MarkedArgumentBuffer args;
    args.append(builderObject);

    JSObject* function = uncheckedDowncast<JSObject>(setupFunctionValue);
    JSC::CallData callData = JSC::getCallData(function);
    JSValue result = call(globalObject, function, callData, JSC::jsUndefined(), args);

    RETURN_IF_EXCEPTION(throwScope, {});

    if (auto* promise = dynamicDowncast<JSC::JSPromise>(result)) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(promise));
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

void BunPlugin::Group::append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSObject* func)
{
    filters.append(JSC::Strong<JSC::RegExp> { vm, filter });
    callbacks.append(JSC::Strong<JSC::JSObject> { vm, func });
}

void BunPlugin::Base::append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSObject* func, String& namespaceString)
{
    if (namespaceString.isEmpty() || namespaceString == "file"_s) {
        this->fileNamespace.append(vm, filter, func);
    } else if (auto found = this->group(namespaceString)) {
        found->append(vm, filter, func);
    } else {
        Group newGroup;
        newGroup.append(vm, filter, func);
        this->groups.append(WTF::move(newGroup));
        this->namespaces.append(namespaceString);
    }
}

JSC::JSObject* BunPlugin::Group::find(JSC::JSGlobalObject* globalObject, String& path)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    size_t count = filters.size();
    for (size_t i = 0; i < count; i++) {
        auto matchResult = filters[i].get()->match(globalObject, path, 0);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (matchResult) {
            return callbacks[i].get();
        }
    }

    return nullptr;
}

// fileSystemPath() returns null if a percent escape in the specifier doesn't decode to UTF-8. Retry with every "%" escaped.
static String relativeSpecifierToFileSystemPath(const URL& base, const String& specifier)
{
    String path = URL(base, specifier).fileSystemPath();
    if (path.isNull()) [[unlikely]]
        path = URL(base, makeStringByReplacingAll(specifier, "%"_s, "%25"_s)).fileSystemPath();
    return path;
}

#if ENABLE(AOT)
static void noteMockOutsideRegistry(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto file = globalObject->vm().hasCompiledCode() ? Bun::compiledModuleForPath(specifier) : std::nullopt;
    if (!file)
        return;
    globalObject->onLoadPlugins.filesMockedOutsideRegistry.set(file->index());
    auto& specifiers = globalObject->onLoadPlugins.mocksOutsideRegistry.add(file->index(), Vector<String, 1>()).iterator->value;
    specifiers.appendIfNotContains(specifier);
}
#endif

void BunPlugin::OnLoad::addModuleMock(JSC::VM& vm, const String& path, JSC::JSObject* mockObject)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(mockObject->globalObject());

    if (globalObject->onLoadPlugins.virtualModules == nullptr) {
        globalObject->onLoadPlugins.virtualModules = new BunPlugin::VirtualModuleMap;
    }
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;

    virtualModules->set(path, JSC::Strong<JSC::JSObject> { vm, mockObject });
#if ENABLE(AOT)
    noteMockOutsideRegistry(globalObject, path);
#endif
}

enum class ModuleMockFunction : uint8_t {
    MockModule,
    ViMock,
    JestMock,
    ViDoMock,
    JestDoMock,
};

// Also the liveExportsSource() of the ES module it's loaded as, which is why it overrides getOwnPropertySlot.
class JSModuleMock final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesGetOwnPropertySlot | JSC::OverridesGetOwnPropertyNames | JSC::OverridesPut | JSC::InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero | JSC::GetOwnPropertySlotIsImpureForPropertyAbsence;

    enum class State : uint8_t {
        NotCalled,
        Running,
        Settled,
    };

    // A function, a string (the path of a `__mocks__` file), or empty (automock the original's exports).
    WriteBarrier<Unknown> factory;
    // Settled: the exports, or a JSCommonJSModule holding them. Running: the promise run() returned, if the factory is async.
    WriteBarrier<JSObject> result;
    // What ES importers read: `result`, or the ESM view of its `module.exports`.
    WriteBarrier<JSObject> exports;
    WriteBarrier<JSString> specifier;
    WriteBarrier<JSString> writtenSpecifier;
    // Set when a loaded ES module is patched in place. Maps export name to the overwritten value, or to this object if there was none yet.
    WriteBarrier<JSObject> originalExports;
    WriteBarrier<Unknown> originalCommonJSExports;
    WriteBarrier<Unknown> commonJSExportsOfOriginal;
    WriteBarrier<JSC::JSObject> esmExportsOfOriginal;
    WriteBarrier<JSObject> originalNamespace;
    // These outlive the patched module's eviction, so unmocking still restores it for whatever stays linked to it (a preload, say).
    WriteBarrier<JSC::JSModuleNamespaceObject> patchedNamespace;
    WriteBarrier<JSObject> originalExportsOfEvictedModule;
    // Patches are undone newest first: two modules can export one variable (`export *`), and each patch saved what it found there.
    unsigned patchOrder { 0 };
    State state { State::NotCalled };
    // Moments (OnLoad::moduleMockSequenceNumber) of the factory call and of the import() that led to it. Kept after the factory has settled.
    uint32_t calledAt { 0 };
    uint32_t requestedAt { 0 };
#if ENABLE(AOT)
    bool wasCalledUnderRequire { false };
    bool isAwaitedByGeneratedModule { false };
#endif
    ModuleMockFunction function;
    // The factory's promise is pending and will patch the already-loaded module when it settles.
    bool hasPendingPatch { false };
    // The mock ended between the settlement of its factory and the job that installs it.
    bool wasInstalledAtEnd { false };
    bool spy { false };
    bool isFromPreload { false };
    // unmockModule() registers that module under its own key again.
    bool didStashLoadedModule { false };
#if ENABLE(AOT)
    // Like didStashLoadedModule, for a compiled file, which has no entry in the loader.
    bool didStashCompiledModule { false };
    // The displaced original was fetched by importActual(), and the end of a mock does not restore it.
    bool coversImportedActual { false };
    bool isOriginalLoadDetached { false };
    unsigned followingDroppedFetches { 0 };
    // A require() was answered with the original, which cannot be required. The entry of the original stays.
    bool hasRefusedOriginal { false };
    bool isOriginalAfterAwait { false };
    bool isOverFailedGraphFile { false };
    bool isOverEarlierLinkedFile { false };
    bool patchesRestoredRun { false };
    bool foundNothingLoaded { false };
    bool usesBodilessFileAsOriginal { false };
    // A test file's mock over a preload's mock. didStashPreloadMock: the module of the preload's mock was stashed.
    bool wasInstalledOnPreloadMock { false };
    bool didStashPreloadMock { false };
    bool patchesPreloadMock { false };
    // For a compiled file with several variants: whether `bun test` has saved originals for this mock.
    bool foundVariants { false };
    // Only require() has loaded the data file that it was laid over, so an import finds the mock alone.
    bool replacesRequiredDataFile { false };
    bool isDisplacedByTestMock { false };
    // Restored when the test file's mock ended. `bun test` keeps it displaced until the end of the test file.
    bool wasRestoredByTestMock { false };
    // The module of this preload mock is registered under the key of the original. See stashLoadedModule() and packagesToRestore.
    bool isUnderActualKey { false };
    // A reset removed it from there. giveBackPreloadModules() restores it at the end of the test file.
    bool wasRemovedByReset { false };
    bool lostOriginalsToReset { false };
    bool lostCommonJSExportsToReset { false };
#endif
    // Loaded as a generated ES module that imports the original (or the `__mocks__` file) and calls the factory when evaluated.
    bool importsOriginal { false };
    // See JSMock__releaseHeldImports().
    bool providesActualFile { false };
    bool wasInstalledOverFailedLoad { false };
    bool isAwaitingRunningBody { false };
    bool isAwaitingFactoryAfterBody { false };
    bool hasAwaitedLoaderTick { false };
    // The mock that it replaced has a factory that imports the original, so that factory's module is under the key of the original.
    bool replacesOriginalImportingMock { false };
    // How the hoisted factory last failed.
    bool readUninitializedVariable { false };
    // That happened at the mock call, over a module whose body had thrown: `bun test` loads the original under its own key.
    bool droppedSavedOriginal { false };
    // The mock waited for the first load by compiled code, and a require() behind it had left a module object in require.cache by then.
    bool keepsModuleObject { false };
#if ENABLE(AOT)
    // The compiled module that the mock replaced before its body ran.
    std::optional<unsigned> unevaluatedCompiledModule;
    std::optional<unsigned> moduleRequestedByLoad;
    // The test file that first loaded the mock, or installed it over an evaluated compiled module. 0 for a preload.
    unsigned firstLoadTestFile { 0 };
    // Of the CommonJS file that this mock or an earlier one patches.
    unsigned patchedLoadTestFile { 0 };
    // Whether importers that were linked under the active mock keep it. Unset: isOfVitest() decides.
    std::optional<bool> keepsActiveMockForImporters;
    // The factory rejected asynchronously. runCompiledMock() throws this once to the load that waited.
    WriteBarrier<Unknown> lateFactoryError;
    // Pending import() calls of the module itself that wait for the running factory. In `bun test` they share one fetch and its failure.
    unsigned waitingImportCount { 0 };
    bool isDetached { false };
    // The load of the original, until the factory is called.
    WriteBarrier<JSC::JSPromise> earlyOriginalLoad;
    // Whether the factory names its original in its source, and whether it has requested it.
    bool wasOriginalLoadedAhead { false };
    bool wasOriginalRequested { false };
    // Whether `bun test` would have a registry entry for the mock's generated module.
    bool wouldBeInRegistry { false };
    // Removed before its original was loaded.
    bool endedBeforeOriginal { false };
    // `bun test` calls such a factory after the original has loaded, compiled code at once. Pending in between.
    WriteBarrier<JSC::JSPromise> originalRequestedByFactory;
    bool wasRequested { false };
    bool wasLoadedByRequire { false };
    bool retainsFailureForImports { false };
    bool isDecidingFailureRetention { false };
    bool wasActiveMockSettled { false };
    WriteBarrier<JSObject> activeMockAtFailure;
    void clearRetainedFailure()
    {
        if (std::exchange(retainsFailureForImports, false) && !--numberOfImportsOwedError)
            errorOwedToImports.clear();
    }
    void forgetOwedErrors()
    {
        retainsFailureForImports = false;
        numberOfImportsOwedError = 0;
        errorOwedToImports.clear();
    }
    // A require() called the running factory and cannot wait for it, and no load has waited for it since. Its failure is reported.
    bool isFactoryUnawaited { false };
    bool wasFactoryStartedByRequire { false };
    // The factory rejected asynchronously. throwErrorOwedToImport() passes this to each of those import() calls once.
    WriteBarrier<Unknown> errorOwedToImports;
    unsigned numberOfImportsOwedError { 0 };
#endif

    static JSModuleMock* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue factory, JSC::JSString* specifier, JSC::JSString* writtenSpecifier, ModuleMockFunction);
    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static bool getOwnPropertySlot(JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool getOwnPropertySlotByIndex(JSObject*, JSC::JSGlobalObject*, unsigned, JSC::PropertySlot&);
    static void getOwnPropertyNames(JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);
    static bool put(JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSValue, JSC::PutPropertySlot&);
    static bool putByIndex(JSCell*, JSC::JSGlobalObject*, unsigned, JSValue, bool shouldThrow);
    static bool deleteProperty(JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&);
    static bool deletePropertyByIndex(JSCell*, JSC::JSGlobalObject*, unsigned);
    static bool defineOwnProperty(JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow);

    // Returns null once settled, otherwise a promise for that. `dependency` is the namespace of dependencyKeyOfModuleMock(), if it's loaded.
    JSC::JSPromise* run(Zig::GlobalObject* globalObject, bool synchronous, JSObject* dependency = nullptr);
    void settle(Zig::GlobalObject* globalObject, JSValue value);
    void settleWithPromised(Zig::GlobalObject* globalObject, JSValue value);
    void didFail(Zig::GlobalObject* globalObject, JSValue error);
    // Like didFail(), but defers the eviction and runs no script, because a termination exception may be pending.
    void abandon(Zig::GlobalObject* globalObject);
    // Stops waiting for a pending factory: fulfills run()'s promise, so waiters continue with whatever the module is now.
    void giveUp(Zig::GlobalObject* globalObject);
    // The factory no longer counts as running. If it settles, whatever still waits for it gets its exports.
    void detach(Zig::GlobalObject* globalObject);
    bool isHoisted() const { return function == ModuleMockFunction::ViMock || function == ModuleMockFunction::JestMock; }
    bool isOfJest() const { return function == ModuleMockFunction::JestMock || function == ModuleMockFunction::JestDoMock; }
    bool isOfVitest() const { return function == ModuleMockFunction::ViMock || function == ModuleMockFunction::ViDoMock; }

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSModuleMock, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSModuleMock, m_subspaceForJSModuleMock));
    }

    void finishCreation(JSC::VM&);

private:
    JSModuleMock(JSC::VM&, JSC::Structure*, JSC::JSValue factory, JSC::JSString* specifier, JSC::JSString* writtenSpecifier, ModuleMockFunction);

    JSValue callFactory(Zig::GlobalObject* globalObject, bool synchronous, JSObject* dependency);
};

const JSC::ClassInfo JSModuleMock::s_info = { "ModuleMock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleMock) };

JSModuleMock* JSModuleMock::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue factory, JSC::JSString* specifier, JSC::JSString* writtenSpecifier, ModuleMockFunction function)
{
    JSModuleMock* ptr = new (NotNull, JSC::allocateCell<JSModuleMock>(vm)) JSModuleMock(vm, structure, factory, specifier, writtenSpecifier, function);
    ptr->finishCreation(vm);
    return ptr;
}

void JSModuleMock::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

JSModuleMock::JSModuleMock(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue factory, JSC::JSString* specifier, JSC::JSString* writtenSpecifier, ModuleMockFunction function)
    : Base(vm, structure)
    , factory(factory, JSC::WriteBarrierEarlyInit)
    , specifier(specifier, JSC::WriteBarrierEarlyInit)
    , writtenSpecifier(writtenSpecifier, JSC::WriteBarrierEarlyInit)
    , function(function)
{
}

Structure* JSModuleMock::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

static void throwFactoryMustReturnObject(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope)
{
    JSC::throwTypeError(globalObject, scope, "mock(module, fn) requires a function that returns an object"_s);
}

static JSModuleMock* toModuleMock(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue value)
{
    auto* mock = value ? dynamicDowncast<JSModuleMock>(value) : nullptr;
    if (!mock) [[unlikely]]
        JSC::throwTypeError(globalObject, scope, "Expected a module mock"_s);
    return mock;
}

static JSC::InternalFieldTuple* moduleMockWith(Zig::GlobalObject* globalObject, JSModuleMock* mock, JSC::JSCell* cell)
{
    return JSC::InternalFieldTuple::create(globalObject->vm(), globalObject->internalFieldTupleStructure(), mock, cell);
}

template<typename T>
static std::pair<JSModuleMock*, T*> toModuleMockWith(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue context)
{
    auto* tuple = dynamicDowncast<JSC::InternalFieldTuple>(context);
    auto* cell = tuple ? dynamicDowncast<T>(tuple->getInternalField(1)) : nullptr;
    return { toModuleMock(globalObject, scope, cell ? tuple->getInternalField(0) : jsUndefined()), cell };
}

static JSModuleMock* registeredModuleMock(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;
    if (!virtualModules)
        return nullptr;
    auto entry = virtualModules->find(specifier);
    return entry == virtualModules->end() ? nullptr : dynamicDowncast<JSModuleMock>(entry->value.get());
}

// jest.resetModules() swaps in a new JSModuleMock with the same factory, which still counts as the same mock.
static bool isStillRegisteredModuleMock(Zig::GlobalObject* globalObject, const String& specifier, JSModuleMock* mock)
{
    auto* registered = registeredModuleMock(globalObject, specifier);
    return registered == mock || (registered && mock && registered->factory.get() == mock->factory.get() && registered->function == mock->function);
}

struct LoadedModule {
    JSC::JSModuleNamespaceObject* esmNamespace { nullptr };
    // The file was compiled ahead of time. Its exports are variables of the program, whether or not it has run.
    std::optional<JSC::AOT::ModuleID> compiledModule;
    Bun::JSCommonJSModule* commonJSModule { nullptr };
    // In the registry / require.cache with nothing to patch: removed so the next import loads the mock.
    bool staleESMEntry { false };
    bool staleCommonJSEntry { false };
};

__attribute__((minsize)) static void findLoadedESModule(Zig::GlobalObject* globalObject, JSC::JSString* specifierString, LoadedModule& loaded)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    loaded.esmNamespace = nullptr;
    loaded.staleESMEntry = false;

    auto specifierIdent = JSC::Identifier::fromString(vm, specifierString->value(globalObject));
    RETURN_IF_EXCEPTION(scope, );
    auto* loader = Bun::testFileModuleLoader(globalObject);
    auto* entry = loader->registryEntry(specifierIdent);
    if (!entry)
        return;

    loaded.staleESMEntry = true;
    // Registered under several import types (with and without `type: "json"`, say): a patch would only reach one, so treat it as stale.
    using Type = JSC::ScriptFetchParameters::Type;
    unsigned types = 0;
    for (Type type : { Type::JavaScript, Type::HostDefined, Type::JSON, Type::Text, Type::WebAssembly, Type::None })
        types += !!loader->getRegisteredMayBeNull(specifierIdent, type);
    if (types > 1)
        return;
    if (auto* mod = entry->record()) {
        // getModuleNamespace asserts the record has progressed past linking.
        // A previous import that failed during link (e.g. unresolved binding)
        // leaves the record at New/Unlinked; in that case there is no
        // namespace to patch — drop the stale entry so the mock takes over
        // on the next import.
        bool linked = true;
        if (auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(mod))
            linked = cyclic->status() >= JSC::CyclicModuleRecord::Status::Linked;
        // The loader fetched a compiled module for an importer that runs from source, and that load failed or is pending. Evict the entry so that the next import gets the mock.
        if (mod->vm().hasCompiledCode() && JSC::AOT::isCompiledModuleRecord(mod)) {
            loaded.staleESMEntry = !linked;
            return;
        }
        if (linked) {
            loaded.esmNamespace = mod->getModuleNamespace(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            if (loaded.esmNamespace)
                loaded.staleESMEntry = false;
        }
    }
}

static void findLoadedCommonJSModule(Zig::GlobalObject* globalObject, JSC::JSString* specifierString, LoadedModule& loaded)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    loaded.commonJSModule = nullptr;
    loaded.staleCommonJSEntry = false;

    JSValue entryValue = JSValue::decode(JSC__JSMap__get(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(specifierString)));
    RETURN_IF_EXCEPTION(scope, );
    if (entryValue && !entryValue.isUndefined()) {
        loaded.commonJSModule = dynamicDowncast<Bun::JSCommonJSModule>(entryValue);
        loaded.staleCommonJSEntry = !loaded.commonJSModule;
    }
}

static bool isBuiltinModuleKey(const String&);

static LoadedModule findLoadedModule(Zig::GlobalObject* globalObject, JSC::JSString* specifierString)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    LoadedModule loaded;
    findLoadedESModule(globalObject, specifierString, loaded);
    RETURN_IF_EXCEPTION(scope, {});
    findLoadedCommonJSModule(globalObject, specifierString, loaded);
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    auto specifier = specifierString->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    loaded.compiledModule = globalObject->vm().hasCompiledCode() ? JSC::AOT::findVariantToMock(globalObject, specifier, Bun::findMockedModule(specifier)) : std::nullopt;
    if (loaded.compiledModule && JSC::AOT::isEvicted(globalObject, *loaded.compiledModule))
        loaded.compiledModule = std::nullopt;
    // Several import types, as in findLoadedESModule(). The module of a mocked built-in module is in the loader too.
    bool isMockOfBuiltin = isBuiltinModuleKey(specifier) && loaded.esmNamespace && loaded.esmNamespace->moduleRecord()->hasLiveExports();
    if (loaded.compiledModule && loaded.esmNamespace && !isMockOfBuiltin && JSC::AOT::hasBeenImported(globalObject, *loaded.compiledModule)) {
        loaded.esmNamespace = nullptr;
        loaded.compiledModule = std::nullopt;
    }
#endif
    return loaded;
}

// Mocks are looked up by exact key, so the extra query makes the loader load the real file.
static String originalModuleKey(const String& specifier)
{
    return makeString(specifier, specifier.contains('?') ? '&' : '?', "actual"_s);
}

// Removes what originalModuleKey() and friends append ("?actual", any number of "&actual", "&spy"), leaving the file path.
static String withoutOriginalModuleQuery(const String& key)
{
    String path = key;
    if (path.endsWith("&spy"_s))
        path = path.left(path.length() - "&spy"_s.length());
    while (path.endsWith("?actual"_s) || path.endsWith("&actual"_s))
        path = path.left(path.length() - "?actual"_s.length());
    return path;
}

// A second module for a mock: it has the mock's exports and waits for nothing. For what a factory loads while the mock's own module waits for that factory.
static String unwaitedModuleMockKey(const String& specifier)
{
    return makeString(specifier, specifier.contains('?') ? '&' : '?', "mocked"_s);
}

static String specifierOfUnwaitedModuleMockKey(const String& key)
{
    return key.endsWith("?mocked"_s) || key.endsWith("&mocked"_s) ? key.left(key.length() - "?mocked"_s.length()) : String();
}

static bool isModuleOrCopyOfIt(const String& key, const String& module)
{
    String copy = module;
    while (copy.length() < key.length())
        copy = originalModuleKey(copy);
    return copy == key;
}

extern "C" int ModuleLoader__builtinAliasIndex(const Latin1Character*, size_t);

static std::optional<ASCIILiteral> builtinModuleOfOriginalKey(const String& key)
{
    if (!key.is8Bit() || !key.endsWith("?actual"_s))
        return std::nullopt;
    int index = ModuleLoader__builtinAliasIndex(key.span8().data(), key.length() - "?actual"_s.length());
    if (index < 0)
        return std::nullopt;
    return Bun::builtinModuleKeys[index];
}

static bool isBuiltinModuleKey(const String& key)
{
    return key.is8Bit() && ModuleLoader__builtinAliasIndex(key.span8().data(), key.length()) >= 0;
}

struct ExportVariable {
    JSC::AbstractModuleRecord* record { nullptr };
    JSC::Identifier localName;
    JSC::ScopeOffset offset;
};

static ExportVariable findExportVariable(JSC::JSGlobalObject* globalObject, JSC::JSModuleNamespaceObject* moduleNamespace, const JSC::Identifier& name)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto resolution = moduleNamespace->moduleRecord()->resolveExport(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    if (resolution.type != JSC::AbstractModuleRecord::Resolution::Type::Resolved)
        return {};
    auto* environment = resolution.moduleRecord->moduleEnvironmentMayBeNull();
    if (!environment)
        return {};
    JSC::SymbolTableEntry::Fast entry = environment->symbolTable()->get(resolution.localName.impl());
    if (entry.isNull())
        return {};
    return { resolution.moduleRecord, resolution.localName, entry.scopeOffset() };
}

static JSC::JSPromise* importModuleKey(Zig::GlobalObject* globalObject, const String& key)
{
    if (globalObject->onLoadPlugins.loadRoots.add(key).isNewEntry)
        globalObject->onLoadPlugins.hasNewLoad = true;
    return Bun::testFileModuleLoader(globalObject)->loadModule(globalObject, JSC::Identifier::fromString(globalObject->vm(), key), nullptr, nullptr, { JSC::ModuleLoadFlag::Evaluate, JSC::ModuleLoadFlag::Dynamic });
}

static JSC::JSPromise* importModuleFrom(Zig::GlobalObject* globalObject, const String& from, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    globalObject->onLoadPlugins.isResolvingImportCall = true;
    globalObject->onResolvePlugins.isResolvingImportCall = true;
    JSC::JSPromise* promise = Bun::testFileModuleLoader(globalObject)->requestImportModule(globalObject, JSC::Identifier::fromString(vm, specifier), JSC::Identifier::fromString(vm, Bun::uncompiledImportReferrer(from)), nullptr, nullptr);
    globalObject->onResolvePlugins.isResolvingImportCall = false;
    if (scope.exception()) [[unlikely]]
        return JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
#if ENABLE(AOT)
    if (auto imported = vm.hasCompiledCode() && Bun::isBunTest ? Bun::compiledModuleForPath(specifier) : std::nullopt)
        JSC::AOT::didCallHostImport(globalObject, *imported, promise);
#endif
    return promise;
}

static JSValue importModuleKeySync(Zig::GlobalObject* globalObject, const String& key)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSPromise* promise = nullptr;
    {
        JSC::VM::SynchronousModuleQueueScope queue(vm);
        promise = importModuleKey(globalObject, key);
        if (!scope.exception())
            JSC::JSModuleLoader::drainSynchronousModuleQueue(globalObject);
    }
    RETURN_IF_EXCEPTION(scope, {});
    Bun::evictModulesThatHaveLoaded(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    switch (promise->status()) {
    case JSC::JSPromise::Status::Fulfilled:
        return promise->result();
    case JSC::JSPromise::Status::Rejected:
        scope.throwException(globalObject, promise->result());
        return {};
    case JSC::JSPromise::Status::Pending:
        break;
    }
    throwException(globalObject, scope, Bun::createAsyncModuleRequiredError(globalObject, key));
    return {};
}

static JSValue requireModuleKey(Zig::GlobalObject* globalObject, const String& from, const String& key)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
#if ENABLE(AOT)
    // `from` is the source origin of the caller.
    JSC::AOT::ModuleRequesterScope requesterScope(globalObject, Bun::requesterForUncompiledImportCall(from));
    JSValue required = Bun::requireCompiledModuleForTestRunner(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    if (required)
        return required;
    if (globalObject->aotInstance() && registeredModuleMock(globalObject, key)) {
        if (auto compiled = Bun::compiledModuleForPath(key))
            RELEASE_AND_RETURN(scope, JSC::AOT::requireModule(globalObject, *compiled));
    }
#endif
    JSObject* require = Bun::JSCommonJSModule::createBoundRequireFunction(vm, globalObject, from, Bun::testFileModuleGraph(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    MarkedArgumentBuffer arguments;
    arguments.append(jsString(vm, key));
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, require, JSC::getCallData(require), jsUndefined(), arguments));
}

// Null for the wrapper that require() of an ES module leaves in require.cache.
static Bun::JSCommonJSModule* loadedCommonJSModule(Zig::GlobalObject* globalObject, const String& key)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue entry = JSValue::decode(JSC__JSMap__get(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(jsString(vm, key))));
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* commonJSModule = dynamicDowncast<Bun::JSCommonJSModule>(entry);
    if (!commonJSModule)
        return nullptr;
    JSValue exports = commonJSModule->exportsObject();
    RETURN_IF_EXCEPTION(scope, nullptr);
    return exports.inherits<JSC::JSModuleNamespaceObject>() ? nullptr : commonJSModule;
}

static JSObject* objectWithExports(Zig::GlobalObject* globalObject, const Vector<JSC::Identifier, 4>& names, const MarkedArgumentBuffer& values)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = JSC::constructEmptyObject(globalObject);
    for (size_t i = 0; i < names.size(); ++i) {
        object->putDirectMayBeIndex(globalObject, names[i], values.at(i));
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    return object;
}

static constexpr ASCIILiteral missingExportMessage = "\" export is defined on the mock of \""_s;

static bool isMissingExportError(JSC::VM& vm, JSValue error)
{
    auto* instance = dynamicDowncast<JSC::ErrorInstance>(error);
    JSValue message = instance ? instance->getDirect(vm, vm.propertyNames->message) : JSValue();
    return message && message.isString() && asString(message)->tryGetValue().data.contains(missingExportMessage);
}

static String messageOfUninitializedVariableError(JSC::VM& vm, JSValue error)
{
    auto* instance = dynamicDowncast<JSC::ErrorInstance>(error);
    if (!instance || instance->errorType() != JSC::ErrorType::ReferenceError)
        return {};
    JSValue messageValue = instance->getDirect(vm, vm.propertyNames->message);
    if (!messageValue || !messageValue.isString())
        return {};
    String message = asString(messageValue)->tryGetValue().data;
    if (!message.startsWith("Cannot access "_s) || !(message.endsWith("before initialization."_s) || message.endsWith("uninitialized variable."_s)))
        return {};
    return message;
}

// Spreading a namespace throws on TDZ exports (import cycles) and on names a vi.mock() factory left out, so copy it with those as undefined.
static JSObject* withoutUninitializedExports(Zig::GlobalObject* globalObject, JSObject* moduleNamespace)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    moduleNamespace->methodTable()->getOwnPropertyNames(moduleNamespace, globalObject, properties, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, nullptr);

    Vector<JSC::Identifier, 4> names;
    MarkedArgumentBuffer values;
    bool isInitialized = true;
    for (auto& name : properties) {
        JSValue value = moduleNamespace->get(globalObject, name);
        if (auto* exception = scope.exception()) [[unlikely]] {
            if ((messageOfUninitializedVariableError(vm, exception->value()).isNull() && !isMissingExportError(vm, exception->value())) || !scope.tryClearException())
                return nullptr;
            isInitialized = false;
            value = jsUndefined();
        }
        names.append(name);
        values.append(value);
    }
    if (isInitialized)
        return moduleNamespace;
    RELEASE_AND_RETURN(scope, objectWithExports(globalObject, names, values));
}

#if ENABLE(AOT)
JSC_DECLARE_HOST_FUNCTION(jsFunctionOriginalWithoutUninitializedExports);

JSC_DEFINE_HOST_FUNCTION(jsFunctionOriginalWithoutUninitializedExports, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSObject* original = callframe->argument(0).getObject();
    return JSValue::encode(original ? JSValue(withoutUninitializedExports(defaultGlobalObject(globalObject), original)) : callframe->argument(0));
}
#endif

static JSObject* esmExportsOfCommonJSExports(Zig::GlobalObject* globalObject, JSValue exports)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Vector<JSC::Identifier, 4> names;
    MarkedArgumentBuffer values;
    Bun::populateESMExports(globalObject, exports, names, values, false);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, objectWithExports(globalObject, names, values));
}

__attribute__((minsize)) static JSObject* esmExportsBeforePatches(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* overwritten = mock->originalExports.get();
    if (!overwritten)
        return nullptr;

    // Reading a builtin's exports would force its lazy ones, and the caller can load it again for free.
    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (builtinModuleOfOriginalKey(originalModuleKey(specifier)))
        return nullptr;

    LoadedModule loaded;
    findLoadedESModule(globalObject, mock->specifier.get(), loaded);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!loaded.esmNamespace)
        return nullptr;

    JSC::PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    loaded.esmNamespace->methodTable()->getOwnPropertyNames(loaded.esmNamespace, globalObject, properties, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);

    Vector<JSC::Identifier, 4> names;
    MarkedArgumentBuffer values;
    for (auto& name : properties) {
        JSValue value = overwritten->getIfPropertyExists(globalObject, name);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (value == overwritten)
            continue;
        if (!value) {
            value = loaded.esmNamespace->get(globalObject, name);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        names.append(name);
        values.append(value);
    }
    RELEASE_AND_RETURN(scope, objectWithExports(globalObject, names, values));
}

#if ENABLE(AOT)
// A compiled module that was evaluated before it was mocked is its own original.
static JSValue compiledExportsBeforeMock(Zig::GlobalObject* globalObject, JSModuleMock* mock, bool& isCommonJS, bool& didExportReadThrow)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, {});
    if (!loaded.compiledModule) {
        // The program replaced the key of an evaluated file, which evicts the file. The original of a mock has a key of its own.
        auto file = Bun::compiledModuleForPath(mock->specifier->tryGetValue().data);
        JSValue kept = file ? JSC::AOT::revalidateRetainedOriginalExports(globalObject, *file) : JSValue();
        RETURN_IF_EXCEPTION(scope, {});
        isCommonJS = kept && !JSC::AOT::isESModule(*file);
        return kept;
    }
    isCommonJS = !JSC::AOT::isESModule(*loaded.compiledModule) && !JSC::AOT::isDataFile(*loaded.compiledModule);
    RELEASE_AND_RETURN(scope, JSC::AOT::exportsBeforeMock(globalObject, *loaded.compiledModule, !mock->isOfVitest() && !mock->wasInstalledOverFailedLoad, &didExportReadThrow));
}

static JSObject* evaluatedOriginalNamespace(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!loaded.compiledModule)
        return nullptr;
    RELEASE_AND_RETURN(scope, JSC::AOT::namespaceBeforeMock(globalObject, *loaded.compiledModule));
}

static JSC::JSPromise* intactOriginalEvaluation(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!loaded.compiledModule)
        return nullptr;
    auto factoryCallerLoad = mock->moduleRequestedByLoad.transform([](unsigned requested) { return JSC::AOT::ModuleID(requested); });
    RELEASE_AND_RETURN(scope, JSC::AOT::pendingOriginalEvaluation(globalObject, *loaded.compiledModule, factoryCallerLoad));
}

static JSValue compiledModuleEvaluationError(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, {});
    return loaded.compiledModule ? JSC::AOT::mockedModuleEvaluationError(globalObject, *loaded.compiledModule) : JSValue();
}
#endif

static BunPlugin::OnLoad::RunningModuleMock* findRunningModuleMock(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
        if (running.mock.get() == mock)
            return &running;
    }
    return nullptr;
}

static void giveTurnsSoon(Zig::GlobalObject*);

#if ENABLE(AOT)
static WTF::BitVector unfinishedModulesOfLoad(Zig::GlobalObject*, JSC::AOT::ModuleID requested, JSC::AOT::LoadGraphMode);
#endif

static void addToImportChain(Zig::GlobalObject* globalObject, BunPlugin::OnLoad::RunningModuleMock& running, const String& key)
{
    running.importChain.add(key);
    bool reachesWaitingMock = false;
#if ENABLE(AOT)
    // The loader only sees this load. What compiled modules import below it is recorded here.
    if (auto module = JSC::getVM(globalObject).hasCompiledCode() ? Bun::compiledModuleForPath(key) : std::nullopt) {
        auto unfinished = unfinishedModulesOfLoad(globalObject, *module, JSC::AOT::LoadGraphMode::RespectMocks);
        reachesWaitingMock = globalObject->onLoadPlugins.waitingModuleMocks.containsIf([&](auto& waiting) {
            auto mocked = Bun::compiledModuleForPath(uncheckedDowncast<JSModuleMock>(waiting.mock.get())->specifier->tryGetValue().data);
            return mocked && unfinished.get(mocked->index());
        });
        running.compiledImportChain.merge(unfinished);
        if (auto own = uncheckedDowncast<JSModuleMock>(running.mock.get())->unevaluatedCompiledModule; own && *own != module->index())
            running.compiledImportChain.clear(*own);
    }
#endif
    if (size_t query = key.find('?'); query != notFound)
        running.importChainWithoutQuery.add(key.left(query));
    // See giveTurns(). The load that now asks for it has to be fetched first.
    if (reachesWaitingMock || globalObject->onLoadPlugins.waitingModuleMocks.containsIf([&](auto& waiting) { return uncheckedDowncast<JSModuleMock>(waiting.mock.get())->specifier->tryGetValue().data == key; })) [[unlikely]] {
        globalObject->onLoadPlugins.ranksAreStale = true;
        giveTurnsSoon(globalObject);
    }
}

static String dependencyKeyOfModuleMock(JSC::JSGlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (JSValue manualMock = mock->factory.get(); manualMock && manualMock.isString())
        RELEASE_AND_RETURN(scope, asString(manualMock)->value(globalObject));
    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    // Spying mutates the objects nested in the exports, so it gets its own instance of the original.
    return mock->spy ? makeString(originalModuleKey(specifier), "&spy"_s) : originalModuleKey(specifier);
}

static JSC::JSPromise* thenWithContext(Zig::GlobalObject*, JSC::JSPromise*, JSC::NativeFunction onFulfilled, JSC::NativeFunction onRejected, JSValue context);
static JSC::JSPromise* importOriginalModule(Zig::GlobalObject*, JSModuleMock*, bool mayLoadDependenciesFirst, const String& from, bool hasAlreadyWaited);
#if ENABLE(AOT)
static JSObject* loadedOriginalNamespace(Zig::GlobalObject*, const String& specifier);
#endif
static String redirectedModuleKey(Zig::GlobalObject*, BunPlugin::OnLoad::RunningModuleMock&, const String& key, const String& mocked);
static void returnTurn(Zig::GlobalObject*, JSModuleMock*);

// Asks `functor` about the modules that evaluating `start` would evaluate too, or find in the middle of it, until it returns true.
template<typename Functor>
static bool anyUnevaluatedImport(JSC::AbstractModuleRecord* start, const Functor& functor)
{
    UncheckedKeyHashSet<JSC::AbstractModuleRecord*> seen;
    Vector<JSC::AbstractModuleRecord*> work { start };
    while (!work.isEmpty()) {
        for (auto& loaded : work.takeLast()->loadedModules().values()) {
            auto* imported = dynamicDowncast<JSC::CyclicModuleRecord>(loaded.m_module.get());
            if (!imported || imported->isSCCEvaluated() || !seen.add(imported).isNewEntry)
                continue;
            if (functor(imported))
                return true;
            work.append(imported);
        }
    }
    return false;
}

// Whether the module that `mock` patches in place hasn't run its body to the end, so some of its exports have no value yet.
static bool patchesModuleBeingEvaluated(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier)
{
    if (!mock->originalExports)
        return false;
    auto* entry = Bun::testFileModuleLoader(globalObject)->getRegisteredMayBeNull(JSC::Identifier::fromString(globalObject->vm(), specifier), JSC::ScriptFetchParameters::Type::JavaScript);
    auto* record = entry ? dynamicDowncast<JSC::CyclicModuleRecord>(entry->record()) : nullptr;
    return record && !record->hasLiveExports() && record->status() >= JSC::CyclicModuleRecord::Status::Linked && !record->isSCCEvaluated();
}

// Returns a promise for `next` to settle. `next` is called once `loading` has settled, either way, with (mock, that promise) as its context.
__attribute__((minsize)) static JSC::JSPromise* originalModuleAfter(Zig::GlobalObject* globalObject, JSModuleMock* mock, JSC::JSPromise* loading, JSC::NativeFunction next)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSPromise* original = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    JSC::JSFunction* didLoad = JSC::JSFunction::create(vm, globalObject, 2, String(), next, ImplementationVisibility::Private);
    loading->performPromiseThenWithContext(vm, globalObject, didLoad, didLoad, jsUndefined(), moduleMockWith(globalObject, mock, original));
    return original;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockDidLoadBeforeOriginal, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto [mock, original] = toModuleMockWith<JSC::JSPromise>(lexicalGlobalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSPromise* loading = importOriginalModule(defaultGlobalObject(lexicalGlobalObject), mock, false, String(), false);
    if (scope.exception()) [[unlikely]]
        original->rejectWithCaughtException(vm, scope);
    else
        original->pipeFrom(vm, loading);
    return JSValue::encode(jsUndefined());
}

#if ENABLE(AOT)
JSC_DEFINE_HOST_FUNCTION(jsFunctionOriginalTurnDidEnd, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto [mock, original] = toModuleMockWith<JSC::JSPromise>(lexicalGlobalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSPromise* loading = importOriginalModule(defaultGlobalObject(lexicalGlobalObject), mock, false, String(), true);
    if (scope.exception()) [[unlikely]]
        original->rejectWithCaughtException(vm, scope);
    else
        original->pipeFrom(vm, loading);
    return JSValue::encode(jsUndefined());
}
#endif

#if ENABLE(AOT)
JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockFailedBelowOriginal, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSPromise* original = toModuleMockWith<JSC::JSPromise>(lexicalGlobalObject, scope, callframe->argument(1)).second;
    RETURN_IF_EXCEPTION(scope, {});
    original->reject(vm, callframe->argument(0));
    return JSValue::encode(jsUndefined());
}

static JSC::JSPromise* originalAfterDependencies(Zig::GlobalObject* globalObject, JSModuleMock* mock, JSC::JSPromise* ending)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSPromise* original = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    JSC::JSFunction* didEnd = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionOriginalTurnDidEnd, ImplementationVisibility::Private);
    JSC::JSFunction* didFail = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionModuleMockFailedBelowOriginal, ImplementationVisibility::Private);
    ending->performPromiseThenWithContext(vm, globalObject, didEnd, didFail, jsUndefined(), moduleMockWith(globalObject, mock, original));
    return original;
}
#endif

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionOriginalImportsDidLoad, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto [mock, original] = toModuleMockWith<JSC::JSPromise>(globalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Enter an import cycle through the mock module: entering it through the original would evaluate the mock module before the original.
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, originalModuleKey(specifier)));
    bool importsMock = mock->state == JSModuleMock::State::NotCalled && entry && entry->record()
        && anyUnevaluatedImport(entry->record(), [&](JSC::CyclicModuleRecord* imported) { return imported->moduleKey().string() == specifier; });
    JSC::JSPromise* loading = importsMock ? importModuleKey(globalObject, specifier) : importOriginalModule(globalObject, mock, false, String(), false);
    if (scope.exception()) [[unlikely]]
        original->rejectWithCaughtException(vm, scope);
    else
        original->pipeFrom(vm, importsMock ? originalModuleAfter(globalObject, mock, loading, jsFunctionModuleMockDidLoadBeforeOriginal) : loading);
    return JSValue::encode(jsUndefined());
}

// The factories the running code was called from, innermost first. See callFactory().
static Vector<JSObject*, 2> factoriesInAsyncContext(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto& names = WebCore::builtinNames(vm);
    Vector<JSObject*, 2> factories;
    for (JSObject* frame = globalObject->m_asyncContextData.get()->getInternalField(0).getObject(); frame;) {
        JSValue storage = frame->getDirect(vm, names.storagePublicName());
        if (storage && storage.inherits<JSModuleMock>())
            factories.append(asObject(storage));
        JSValue previous = frame->getDirect(vm, names.prevPublicName());
        frame = previous ? previous.getObject() : nullptr;
    }
    return factories;
}

#if ENABLE(AOT)
// The async context in which callFactory() called the factory of `mock`, with the frames of outer factories.
bool isInsideMockFactory(Zig::GlobalObject* globalObject)
{
    return !factoriesInAsyncContext(globalObject).isEmpty();
}

static JSValue asyncContextAroundFactoryOf(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto& names = WebCore::builtinNames(vm);
    JSValue context = globalObject->m_asyncContextData.get()->getInternalField(0);
    for (JSObject* frame = context.getObject(); frame;) {
        JSValue previous = frame->getDirect(vm, names.prevPublicName());
        if (frame->getDirect(vm, names.storagePublicName()) == JSValue(mock))
            return previous ? previous : jsUndefined();
        frame = previous ? previous.getObject() : nullptr;
    }
    return context;
}

static bool isInNodeModules(const String& path);

static bool isOneInstanceWithItsOriginal(const JSModuleMock* mock, const String& specifier)
{
    return mock->isOfVitest() && (isInNodeModules(specifier) || mock->isOverFailedGraphFile);
}

static bool takesFileWithoutBodyAsOriginal(const JSModuleMock* mock, JSC::AOT::ModuleID file)
{
    return mock->isOfVitest() && !mock->factory && JSC::AOT::isESModule(file) && !JSC::AOT::hasModuleBody(file);
}
#endif

#if ENABLE(AOT)
uint32_t addToFactoryImportChains(Zig::GlobalObject*, JSC::AOT::ModuleID importer, JSC::AOT::ModuleID requested, JSC::AOT::LoadKind);
#endif

#if ENABLE(AOT)
// The loader has the file under its key, or has evicted the original, so the original that the mock has is another instance.
static bool isOriginalLoadedAgain(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier)
{
    if (!globalObject->vm().hasCompiledCode())
        return false;
    auto file = Bun::compiledModuleForPath(specifier);
    if (file && JSC::AOT::isOriginalEvicted(globalObject, *file))
        return true;
    if (file && mock->isOfVitest() && !isInNodeModules(specifier) && !JSC::AOT::isESModule(*file) && !JSC::AOT::isDataFile(*file) && JSC::AOT::hasIntactOriginal(globalObject, *file)) {
        JSC::AOT::LoadedBy loadedBy = JSC::AOT::evaluatedBy(globalObject, *file);
        if (loadedBy == JSC::AOT::LoadedBy::EarlierTestFile || loadedBy == JSC::AOT::LoadedBy::Preload)
            return true;
    }
    return file && mock->state == JSModuleMock::State::NotCalled && !mock->originalNamespace && JSC::AOT::isMockUnseen(globalObject, *file);
}
#endif

__attribute__((minsize)) static JSC::JSPromise* importOriginalModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, bool mayLoadDependenciesFirst = true, const String& from = String(), bool hasAlreadyWaited = false)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

#if ENABLE(AOT)
    mock->wasOriginalRequested = true;
    if (auto file = vm.hasCompiledCode() ? Bun::compiledModuleForPath(specifier) : std::nullopt) {
        if (globalObject->onLoadPlugins.filesWithRestoredOriginal.get(specifier) == globalObject->onLoadPlugins.testFile && !JSC::AOT::hasIntactOriginal(globalObject, *file)) [[unlikely]]
            Bun::recordRepeatedFileRun(globalObject, specifier, "an earlier mock in this test file has its original"_s);
        JSC::AOT::willImportOriginal(globalObject, *file);
    }
    if (mock->unevaluatedCompiledModule && !hasAlreadyWaited)
        addToFactoryImportChains(globalObject, JSC::AOT::ModuleID(), JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule), JSC::AOT::LoadKind::Import);
    if (isOriginalLoadedAgain(globalObject, mock, specifier)) {
        String key = originalModuleKey(specifier);
        if (!from.isNull() && !globalObject->onLoadPlugins.runningModuleMocks.isEmpty())
            key = Bun::keyOfImportWhileModuleMocksRun(globalObject, key, from, true);
        JSC::JSPromise* loading = importModuleKey(globalObject, key);
        RETURN_IF_EXCEPTION(scope, nullptr);
        RELEASE_AND_RETURN(scope, thenWithContext(globalObject, loading, jsFunctionOriginalWithoutUninitializedExports, nullptr, jsUndefined()));
    }
#endif
    JSObject* exports = mock->originalNamespace.get();
    if (!exports && mayLoadDependenciesFirst && patchesModuleBeingEvaluated(globalObject, mock, specifier)) {
        JSC::JSPromise* evaluating = importModuleKey(globalObject, specifier);
        RETURN_IF_EXCEPTION(scope, nullptr);
        return originalModuleAfter(globalObject, mock, evaluating, jsFunctionModuleMockDidLoadBeforeOriginal);
    }
    if (exports)
        exports = withoutUninitializedExports(globalObject, exports);
    else
        exports = esmExportsBeforePatches(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, nullptr);
#if ENABLE(AOT)
    // A compiled ES module's original is never made from its saved require() result.
    auto compiledFile = mock->unevaluatedCompiledModule ? std::optional(JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule)) : !exports && vm.hasCompiledCode() ? Bun::compiledModuleForPath(specifier)
                                                                                                                                                                 : std::nullopt;
    bool isCompiledESModule = compiledFile && JSC::AOT::isESModule(*compiledFile) && (mock->unevaluatedCompiledModule || !JSC::AOT::isEvicted(globalObject, *compiledFile));
#else
    constexpr bool isCompiledESModule = false;
    UNUSED_PARAM(hasAlreadyWaited);
#endif
    if (!exports && mock->originalCommonJSExports && !isCompiledESModule) {
        exports = esmExportsOfCommonJSExports(globalObject, mock->originalCommonJSExports.get());
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
#if ENABLE(AOT)
    // A require() cannot wait for the factory it called, so it gets the original: evaluate the file now, and install the mock over it.
    // An original that has failed stays failed.
    auto* originalEntry = isBuiltinModuleKey(specifier) ? nullptr : Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, originalModuleKey(specifier)));
    JSValue originalError = originalEntry && !originalEntry->record() ? originalEntry->error(globalObject) : JSValue();
    RETURN_IF_EXCEPTION(scope, nullptr);
    bool hasOriginalFailed = !!originalError;
    if (auto file = mock->unevaluatedCompiledModule; file && !exports && !hasOriginalFailed && JSC::AOT::requireRunsMocks(vm) && !JSC::AOT::isESModule(JSC::AOT::ModuleID(*file)) && !JSC::AOT::hasStartedLoading(globalObject, JSC::AOT::ModuleID(*file)) && !JSC::AOT::isCompiledOriginal(globalObject, originalModuleKey(specifier))) {
        JSC::AOT::evaluateCommonJSModuleBeforeMock(globalObject, JSC::AOT::ModuleID(*file));
        RETURN_IF_EXCEPTION(scope, nullptr);
        mock->unevaluatedCompiledModule = std::nullopt;
    }
    std::optional<unsigned> unevaluatedFile = mock->unevaluatedCompiledModule;
    if (auto compiled = !unevaluatedFile && mock->isOverFailedGraphFile ? Bun::compiledModuleForPath(specifier) : std::nullopt)
        unevaluatedFile = compiled->index();
    // unmockModule() restores such a package under its own key, so there is one instance: evaluate it now, beside the waiting mock.
    if (auto file = unevaluatedFile; file && !exports && isOneInstanceWithItsOriginal(mock, specifier) && JSC::AOT::isESModule(JSC::AOT::ModuleID(*file))) {
        exports = JSC::AOT::evaluateOriginalUnderMock(globalObject, JSC::AOT::ModuleID(*file));
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (exports)
            exports = withoutUninitializedExports(globalObject, exports);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }

    if (auto file = unevaluatedFile; file && !exports && isOneInstanceWithItsOriginal(mock, specifier) && JSC::AOT::isESModule(JSC::AOT::ModuleID(*file))) {
        bool hasRun = JSC::AOT::tryEvaluateESModuleBeforeMock(globalObject, JSC::AOT::ModuleID(*file));
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (hasRun)
            mock->unevaluatedCompiledModule = std::nullopt;
    }
    if (globalObject->aotInstance() && !exports) {
        JSC::JSPromise* underWay = intactOriginalEvaluation(globalObject, mock);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (underWay)
            return originalModuleAfter(globalObject, mock, underWay, jsFunctionModuleMockDidLoadBeforeOriginal);
    }
    bool hasSavedOriginal = !!exports;
    bool isImportedNamespace = false;
    if (globalObject->aotInstance() && Bun::isBunTest && !exports && !mock->esmExportsOfOriginal) {
        exports = evaluatedOriginalNamespace(globalObject, mock);
        isImportedNamespace = !!exports;
        if (scope.exception()) [[unlikely]]
            return JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    }
    // The original of a mock that was laid over a loaded module is that module.
    bool asksLoaderFirst = mock->isOfVitest() && mock->unevaluatedCompiledModule;
    JSObject* copy = globalObject->aotInstance() && !exports && asksLoaderFirst ? loadedOriginalNamespace(globalObject, specifier) : nullptr;
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (copy) {
        exports = withoutUninitializedExports(globalObject, copy);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    if (globalObject->aotInstance() && !exports) {
        bool isCommonJS = false;
        bool didExportReadThrow = false;
        auto displaced = Bun::compiledModuleForPath(specifier);
        bool hasNoSavedOriginal = mock->droppedSavedOriginal || (displaced && JSC::AOT::wasDisplacedAfterFailure(globalObject, *displaced));
        JSValue before = hasNoSavedOriginal ? JSValue() : compiledExportsBeforeMock(globalObject, mock, isCommonJS, didExportReadThrow);
        // The original threw before it was mocked, so its import rejects with that error.
        if (JSC::Exception* thrownByOriginal = scope.exception()) [[unlikely]] {
            if (!scope.tryClearException())
                return nullptr;
            if (!didExportReadThrow)
                RELEASE_AND_RETURN(scope, JSC::JSPromise::rejectedPromise(globalObject, thrownByOriginal->value()));
            bool isImportedByOwnFactory = !from.isNull() && mock->state == JSModuleMock::State::Running && factoriesInAsyncContext(globalObject).contains(mock);
            if (!isImportedByOwnFactory) {
                throwException(globalObject, scope, thrownByOriginal);
                return nullptr;
            }
            before = JSValue();
        }
        if (auto file = before ? Bun::compiledModuleForPath(specifier) : std::nullopt; file && (JSC::AOT::retainedOriginalExports(globalObject, *file) || JSC::AOT::evaluatedBy(globalObject, *file) == JSC::AOT::LoadedBy::EarlierTestFile)) {
            JSC::JSPromise* below = JSC::AOT::pendingEvaluationInGraph(globalObject, *file);
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (below)
                return originalAfterDependencies(globalObject, mock, below);
            for (const auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
                auto* other = uncheckedDowncast<JSModuleMock>(running.mock.get());
                auto* pending = other != mock && other->state == JSModuleMock::State::Running && other->result ? dynamicDowncast<JSC::JSPromise>(other->result.get()) : nullptr;
                if (pending && other->unevaluatedCompiledModule && JSC::AOT::importsStatically(globalObject, *file, JSC::AOT::ModuleID(*other->unevaluatedCompiledModule)))
                    return originalAfterDependencies(globalObject, mock, pending);
            }
        }
        // In `bun test` the namespace of an original that a mock has displaced is one object.
        auto displacedFile = before && isCommonJS && mock->isOfVitest() ? Bun::compiledModuleForPath(specifier) : std::nullopt;
        bool hasOneNamespace = displacedFile && !JSC::AOT::isPatchedByMock(globalObject, *displacedFile);
        if (hasOneNamespace && before == mock->commonJSExportsOfOriginal.get())
            exports = mock->esmExportsOfOriginal.get();
        else if (before) {
            JSValue required = isCommonJS ? before : JSValue();
            if (auto file = isCommonJS || mock->isOfVitest() ? std::nullopt : Bun::compiledModuleForPath(specifier); file && JSC::AOT::isDataFile(*file) && (mock->replacesRequiredDataFile || JSC::AOT::wasOriginalRequiredFirst(globalObject, *file))) [[unlikely]] {
                required = before.getObject()->get(globalObject, vm.propertyNames->defaultKeyword);
                RETURN_IF_EXCEPTION(scope, nullptr);
            }
            exports = required ? esmExportsOfCommonJSExports(globalObject, required) : withoutUninitializedExports(globalObject, before.getObject());
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (hasOneNamespace) {
                mock->commonJSExportsOfOriginal.set(vm, mock, before);
                mock->esmExportsOfOriginal.set(vm, mock, exports);
            }
        }
        RETURN_IF_EXCEPTION(scope, nullptr);
        copy = exports || asksLoaderFirst ? nullptr : loadedOriginalNamespace(globalObject, specifier);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (copy) {
            exports = withoutUninitializedExports(globalObject, copy);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        // The original is being evaluated or is about to be: wait for it, since importing the key below would evaluate its source again.
        // The failed entry under the original's key rejects every import of it.
        JSValue detachedLoadError = !exports && mock->isOriginalLoadDetached ? compiledModuleEvaluationError(globalObject, mock) : JSValue();
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (detachedLoadError)
            RELEASE_AND_RETURN(scope, JSC::JSPromise::rejectedPromise(globalObject, detachedLoadError));
        if (auto compiled = exports ? std::nullopt : Bun::compiledModuleForPath(specifier)) {
            JSC::JSPromise* evaluation = JSC::AOT::pendingEvaluation(globalObject, *compiled, hasAlreadyWaited);
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (evaluation)
                return originalModuleAfter(globalObject, mock, evaluation, jsFunctionOriginalTurnDidEnd);
        }
    }
    // A mock whose generated module has imported the original has saved it.
    bool didImportOriginal = mock->isOfVitest() ? mock->importsOriginal : mock->replacesOriginalImportingMock || (mock->importsOriginal && mock->foundNothingLoaded);
    auto mockedFile = exports && !hasSavedOriginal && !didImportOriginal && globalObject->aotInstance() ? Bun::compiledModuleForPath(specifier) : std::nullopt;
    bool isDisplacedOriginal = mockedFile && (JSC::AOT::isESModule(*mockedFile) || isImportedNamespace) && JSC::AOT::hasIntactOriginal(globalObject, *mockedFile);
#endif
    if (exports) {
        JSC::JSPromise* original = JSC::JSPromise::resolvedPromise(globalObject, exports);
        RETURN_IF_EXCEPTION(scope, nullptr);
#if ENABLE(AOT)
        if (isDisplacedOriginal) [[unlikely]] {
            // `bun test` imports it under the key of the original.
            constexpr unsigned jobsOfLoadedModuleImport = 7;
            for (unsigned job = 1; job < jobsOfLoadedModuleImport; ++job) {
                JSC::JSPromise* next = JSC::JSPromise::create(vm, globalObject->promiseStructure());
                original->performPromiseThen(vm, globalObject, jsUndefined(), jsUndefined(), next);
                original = next;
            }
        }
#endif
        return original;
    }

    String key = originalModuleKey(specifier);

    auto* running = findRunningModuleMock(globalObject, mock);
    bool mayBeAnotherFactory = !running && !from.isNull() && !globalObject->onLoadPlugins.runningModuleMocks.isEmpty();

    // Only an import of the mocked module calls the factory, so find out whether the original has one before evaluating anything.
    if (mayLoadDependenciesFirst && !mayBeAnotherFactory && mock->importsOriginal && mock->state == JSModuleMock::State::NotCalled) {
        String dependency = dependencyKeyOfModuleMock(globalObject, mock);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (dependency == key) {
            JSC::JSPromise* loading = Bun::testFileModuleLoader(globalObject)->loadModule(globalObject, JSC::Identifier::fromString(vm, key), nullptr, nullptr, {});
            RETURN_IF_EXCEPTION(scope, nullptr);
            return originalModuleAfter(globalObject, mock, loading, jsFunctionOriginalImportsDidLoad);
        }
    }

    if (running) {
        key = redirectedModuleKey(globalObject, *running, key, specifier);
        addToImportChain(globalObject, *running, key);
        // If another factory called vi.importActual(), it waits for the module too.
        for (JSObject* factory : factoriesInAsyncContext(globalObject)) {
            auto* asking = findRunningModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(factory));
            if (!asking || asking == running)
                continue;
            key = redirectedModuleKey(globalObject, *asking, key, uncheckedDowncast<JSModuleMock>(factory)->specifier->tryGetValue().data);
            addToImportChain(globalObject, *asking, key);
        }
#if ENABLE(AOT)
        // In `bun test` the original joins every import chain that has the mocked module.
        for (auto& other : globalObject->onLoadPlugins.runningModuleMocks) {
            if (&other == running || !mock->unevaluatedCompiledModule || !other.compiledImportChain.get(*mock->unevaluatedCompiledModule))
                continue;
            key = redirectedModuleKey(globalObject, other, key, uncheckedDowncast<JSModuleMock>(other.mock.get())->specifier->tryGetValue().data);
            addToImportChain(globalObject, other, key);
        }
#endif
    } else if (mayBeAnotherFactory)
        key = Bun::keyOfImportWhileModuleMocksRun(globalObject, key, from, true);
#if ENABLE(AOT)
    if (globalObject->aotInstance() && !isBuiltinModuleKey(specifier)) {
        JSC::JSPromise* loading = importModuleKey(globalObject, key);
        RETURN_IF_EXCEPTION(scope, nullptr);
        RELEASE_AND_RETURN(scope, thenWithContext(globalObject, loading, jsFunctionOriginalWithoutUninitializedExports, nullptr, jsUndefined()));
    }
#endif
    RELEASE_AND_RETURN(scope, importModuleKey(globalObject, key));
}

#if ENABLE(AOT)
enum class OriginalUse : bool { Exports,
    Spy };

static JSC::AbstractModuleRecord* loadedOriginalRecord(Zig::GlobalObject* globalObject, const String& specifier, OriginalUse use = OriginalUse::Exports)
{
    if (isBuiltinModuleKey(specifier))
        return nullptr;
    String key = originalModuleKey(specifier);
    if (use == OriginalUse::Spy)
        key = makeString(key, "&spy"_s);
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(JSC::getVM(globalObject), key));
    auto* record = entry ? entry->record() : nullptr;
    return record && !JSC::AOT::isCompiledModuleRecord(record) ? record : nullptr;
}

static JSValue originalEvaluationError(Zig::GlobalObject* globalObject, const String& specifier, OriginalUse use = OriginalUse::Exports)
{
    auto* original = loadedOriginalRecord(globalObject, specifier, use);
    auto* cyclic = original ? dynamicDowncast<JSC::CyclicModuleRecord>(original) : nullptr;
    return cyclic ? cyclic->evaluationError() : JSValue();
}

static void dropFailedOriginal(Zig::GlobalObject* globalObject, const String& specifier)
{
    if (originalEvaluationError(globalObject, specifier))
        Bun::testFileModuleLoader(globalObject)->removeEntry(JSC::Identifier::fromString(JSC::getVM(globalObject), originalModuleKey(specifier)));
}

static void dropRecordlessFailedOriginal(Zig::GlobalObject* globalObject, const String& specifier)
{
    using Status = JSC::ModuleRegistryEntry::Status;
    auto key = JSC::Identifier::fromString(JSC::getVM(globalObject), originalModuleKey(specifier));
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(key);
    if (entry && !entry->record() && (entry->status() == Status::FetchFailed || entry->status() == Status::InstantiationFailed || entry->status() == Status::EvaluationFailed))
        Bun::testFileModuleLoader(globalObject)->removeEntry(key);
}

static JSObject* loadedOriginalNamespace(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto* original = loadedOriginalRecord(globalObject, specifier);
    auto* cyclic = original ? dynamicDowncast<JSC::CyclicModuleRecord>(original) : nullptr;
    if (!original || (cyclic && (cyclic->status() != JSC::CyclicModuleRecord::Status::Evaluated || cyclic->evaluationError())))
        return nullptr;
    return original->getModuleNamespace(globalObject);
}
#endif

#if ENABLE(AOT)
// requireOriginalModule() makes the module the requirer of its original.
static bool isRequirerOfOwnOriginal(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String key = originalModuleKey(specifier);
    // The wrapper of an original that has moved back is also there.
    if (!Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, key)))
        return false;
    JSValue entry = JSValue::decode(JSC__JSMap__get(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(jsString(vm, key))));
    RETURN_IF_EXCEPTION(scope, false);
    auto* original = entry ? dynamicDowncast<Bun::JSCommonJSModule>(entry) : nullptr;
    JSValue filename = original ? original->parentFilename() : JSValue();
    if (!filename || !filename.isString())
        return false;
    String path = asString(filename)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    return path == specifier;
}
#endif

static JSValue requireOriginalModule(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

#if ENABLE(AOT)
    mock->wasOriginalRequested = true;
#endif
    if (JSValue exports = mock->originalCommonJSExports.get(); exports && !exports.inherits<JSC::JSModuleNamespaceObject>())
        return exports;
    JSObject* exports = esmExportsBeforePatches(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, {});
    if (exports)
        return exports;
    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    if (globalObject->aotInstance() && !isOriginalLoadedAgain(globalObject, mock, specifier)) {
        bool isCommonJS = false;
        bool didExportReadThrow = false;
        JSValue before = compiledExportsBeforeMock(globalObject, mock, isCommonJS, didExportReadThrow);
        RETURN_IF_EXCEPTION(scope, {});
        if (before) {
            auto file = Bun::compiledModuleForPath(specifier);
            // An import loads the original before the factory that names it.
            if (file && mock->importsOriginal && mock->state == JSModuleMock::State::Running && !JSC::AOT::requireRunsMocks(vm))
                JSC::AOT::willImportEvictedDataOriginal(globalObject, *file);
            if (file && !mock->originalNamespace && (JSC::AOT::isESModule(*file) || (JSC::AOT::isDataFile(*file) && !JSC::AOT::wasOriginalRequiredFirst(globalObject, *file))))
                JSC::AOT::didRequireOwnOriginal(globalObject, *file);
            // The require map has the value of a data file that a require() was the first to load.
            if (file && before.isObject() && (mock->replacesRequiredDataFile || JSC::AOT::wasOriginalRequiredFirst(globalObject, *file))) [[unlikely]]
                RELEASE_AND_RETURN(scope, asObject(before)->get(globalObject, vm.propertyNames->defaultKeyword));
            return before;
        }
    }
#endif

    String key = originalModuleKey(specifier);
    JSObject* moduleNamespace = mock->originalNamespace.get();
#if ENABLE(AOT)
    if (!moduleNamespace && mock->unevaluatedCompiledModule) {
        moduleNamespace = loadedOriginalNamespace(globalObject, specifier);
        RETURN_IF_EXCEPTION(scope, {});
        if (auto file = moduleNamespace ? Bun::compiledModuleForPath(specifier) : std::nullopt; file && JSC::AOT::isESModule(*file))
            JSC::AOT::didRequireOwnOriginal(globalObject, *file);
    }
#endif
    if (moduleNamespace) {
        auto* commonJSModule = loadedCommonJSModule(globalObject, key);
        RETURN_IF_EXCEPTION(scope, {});
        if (!commonJSModule)
            RELEASE_AND_RETURN(scope, withoutUninitializedExports(globalObject, moduleNamespace));
        RELEASE_AND_RETURN(scope, commonJSModule->exportsObject());
    }

    BunString specifierString = Bun::toString(specifier);
    JSValue builtin = Bun::resolveAndFetchBuiltinModule(globalObject, &specifierString);
    RETURN_IF_EXCEPTION(scope, {});
    if (builtin)
        return builtin;
    if (auto* running = findRunningModuleMock(globalObject, mock)) {
        redirectedModuleKey(globalObject, *running, key, specifier);
        addToImportChain(globalObject, *running, key);
    }
#if ENABLE(AOT)
    if (globalObject->aotInstance())
        JSC::AOT::willRunCopyFromDisk(globalObject);
    if (auto file = globalObject->aotInstance() ? Bun::compiledModuleForPath(specifier) : std::nullopt; file && !JSC::AOT::isESModule(*file))
        JSC::AOT::noteOriginalRequiredFromSource(globalObject, *file);
#endif
    JSValue required = requireModuleKey(globalObject, specifier, key);
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    if (auto file = mock->isFromPreload && globalObject->aotInstance() ? Bun::compiledModuleForPath(specifier) : std::nullopt; file && JSC::AOT::isESModule(*file))
        JSC::AOT::didRequireOwnOriginal(globalObject, *file);
#endif
    return required;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockImportOriginal, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(lexicalGlobalObject));
    auto* mock = toModuleMock(lexicalGlobalObject, scope, callframe->thisValue());
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    // Compiled bodies run inside this call. In `bun test` loader jobs run them, outside the factory's frame.
    auto* asyncContext = defaultGlobalObject(lexicalGlobalObject)->m_asyncContextData.get();
    JSValue factoryContext = asyncContext->getInternalField(0);
    if (JSC::getVM(lexicalGlobalObject).hasCompiledCode())
        asyncContext->putInternalField(JSC::getVM(lexicalGlobalObject), 0, asyncContextAroundFactoryOf(defaultGlobalObject(lexicalGlobalObject), mock));
#endif
    JSC::JSPromise* original = importOriginalModule(defaultGlobalObject(lexicalGlobalObject), mock);
#if ENABLE(AOT)
    asyncContext->putInternalField(JSC::getVM(lexicalGlobalObject), 0, factoryContext);
#endif
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    mock->originalRequestedByFactory.setMayBeNull(JSC::getVM(lexicalGlobalObject), mock, original);
#endif
    return JSValue::encode(original);
}

static JSValue mockExportsOfLoadedModule(Zig::GlobalObject* globalObject, const String& key, JSValue moduleNamespace, bool spy, bool& isCommonJS)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue exports = moduleNamespace;
    auto* commonJSModule = loadedCommonJSModule(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    // A compiled CommonJS file has no module object in the loader's table.
    auto compiled = !globalObject->aotInstance() || commonJSModule ? std::nullopt : Bun::compiledModuleForPath(key);
    bool isCompiledCommonJSFile = compiled && !JSC::AOT::isESModule(*compiled) && !JSC::AOT::isDataFile(*compiled) && !JSC::AOT::isNativeModule(*compiled) && !JSC::AOT::isEvicted(globalObject, *compiled);
#else
    constexpr bool isCompiledCommonJSFile = false;
#endif
    if (commonJSModule) {
        isCommonJS = true;
        exports = commonJSModule->exportsObject();
    } else if (isCompiledCommonJSFile) {
#if ENABLE(AOT)
        isCommonJS = true;
        exports = JSC::AOT::moduleExports(globalObject, *compiled);
#endif
    } else if (JSObject* object = moduleNamespace.getObject())
        exports = withoutUninitializedExports(globalObject, object);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, Bun::mockObject(globalObject, exports, spy));
}

static JSObject* automockExports(Zig::GlobalObject* globalObject, JSModuleMock* mock, JSValue moduleNamespace)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (JSValue manualMock = mock->factory.get()) {
        String key = asString(manualMock)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        auto* commonJSModule = loadedCommonJSModule(globalObject, key);
        RETURN_IF_EXCEPTION(scope, nullptr);
#if ENABLE(AOT)
        // A compiled CommonJS file has no module object in the loader's table.
        if (auto compiled = !globalObject->aotInstance() || commonJSModule ? std::nullopt : Bun::compiledModuleForPath(key); compiled && !JSC::AOT::isESModule(*compiled) && !JSC::AOT::isDataFile(*compiled) && !JSC::AOT::isNativeModule(*compiled)) {
            JSValue exports = JSC::AOT::moduleExports(globalObject, *compiled);
            RELEASE_AND_RETURN(scope, Bun::JSCommonJSModule::create(globalObject, mock->specifier.get(), exports, true, jsUndefined()));
        }
#endif
        return commonJSModule ? commonJSModule : moduleNamespace.getObject();
    }

    String key = dependencyKeyOfModuleMock(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, nullptr);
    bool isCommonJS = false;
    JSValue mocked = mockExportsOfLoadedModule(globalObject, key, moduleNamespace, mock->spy, isCommonJS);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!isCommonJS)
        return mocked.getObject();
    RELEASE_AND_RETURN(scope, Bun::JSCommonJSModule::create(globalObject, mock->specifier.get(), mocked, true, jsUndefined()));
}

// Resolving the derived promise reads `then` on what the handler returns, so handlers return undefined or a value script may hold.
static JSC::JSPromise* thenWithContext(Zig::GlobalObject* globalObject, JSC::JSPromise* promise, JSC::NativeFunction onFulfilled, JSC::NativeFunction onRejected, JSValue context)
{
    auto& vm = JSC::getVM(globalObject);
    auto handler = [&](JSC::NativeFunction function) -> JSValue {
        return function ? JSValue(JSC::JSFunction::create(vm, globalObject, 2, String(), function, ImplementationVisibility::Private)) : jsUndefined();
    };
    JSC::JSPromise* derived = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    promise->performPromiseThenWithContext(vm, globalObject, handler(onFulfilled), handler(onRejected), derived, context);
    return derived;
}

static bool addHoistingNote(JSC::VM& vm, JSValue error)
{
    String message = messageOfUninitializedVariableError(vm, error);
    if (message.isNull())
        return false;
    uncheckedDowncast<JSC::ErrorInstance>(error)->putDirect(vm, vm.propertyNames->message, jsString(vm, makeString(message, "\nnote: vi.mock() and jest.mock() are hoisted above the file's imports and top-level variables, so a factory can't use them. Declare what it needs with vi.hoisted()."_s)), static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
    return true;
}

__attribute__((minsize)) JSValue JSModuleMock::callFactory(Zig::GlobalObject* globalObject, bool synchronous, JSObject* dependency)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue factoryValue = factory.get();
#if ENABLE(AOT)
    // In `bun test` such a mock imports its original statically: the original's body runs first, and its error is the error of the load.
    // Returns whether `answer`, or the exception, is the result of this call.
    auto tryAnswerFromOriginal = [&](JSValue& answer) -> bool {
        bool hasAlreadyWaited = std::exchange(hasAwaitedLoaderTick, false);
        JSValue thrownByBody = compiledModuleEvaluationError(globalObject, this);
        RETURN_IF_EXCEPTION(scope, true);
        // Under a Vitest mock `bun test` evaluates a file that threw again. A compiled file is reloaded from source under the key of the original instead.
        auto compiled = thrownByBody && factoryValue && !synchronous ? Bun::compiledModuleForPath(specifier->tryGetValue().data) : std::nullopt;
        if (compiled && JSC::AOT::wasDisplacedAfterFailure(globalObject, *compiled)) {
            JSObject* loadedAgain = loadedOriginalNamespace(globalObject, specifier->tryGetValue().data);
            RETURN_IF_EXCEPTION(scope, true);
            if (loadedAgain)
                return false;
            JSC::JSPromise* loadingAgain = importModuleKey(globalObject, originalModuleKey(specifier->tryGetValue().data));
            RETURN_IF_EXCEPTION(scope, true);
            isAwaitingRunningBody = true;
            answer = loadingAgain;
            return true;
        }
        bool settlesInNextJob = hasAlreadyWaited && !factoryValue;
        if (thrownByBody && !settlesInNextJob) {
            // The loader returns a rejected promise for a module that has failed. importModuleKeySync() throws its reason.
            if (JSC::AOT::requireRunsMocks(vm))
                JSC::JSPromise::rejectedPromise(globalObject, thrownByBody);
            throwException(globalObject, scope, thrownByBody);
            return true;
        }
        JSC::JSPromise* underWay = thrownByBody ? nullptr : intactOriginalEvaluation(globalObject, this);
        RETURN_IF_EXCEPTION(scope, true);
        if (underWay && synchronous) {
            throwException(globalObject, scope, Bun::createAsyncModuleRequiredError(globalObject, specifier->tryGetValue().data));
            return true;
        }
        if (!underWay && settlesInNextJob) {
            isAwaitingRunningBody = true;
            answer = JSC::JSPromise::resolvedPromise(globalObject, jsUndefined());
            RETURN_IF_EXCEPTION(scope, true);
            return true;
        }
        if (!underWay)
            return false;
        isAwaitingRunningBody = true;
        // `bun test` decides only some jobs after the import() call whether the generated module waits for the original.
        if (!hasAlreadyWaited) {
            hasAwaitedLoaderTick = true;
            constexpr unsigned generatedModuleEvaluationJobs = 12;
            unsigned jobsToWait = generatedModuleEvaluationJobs - (factoryValue ? 0 : 2);
            JSC::JSPromise* turn = JSC::JSPromise::resolvedPromise(globalObject, jsUndefined());
            RETURN_IF_EXCEPTION(scope, true);
            for (unsigned job = 0; job < jobsToWait; ++job) {
                JSC::JSPromise* next = JSC::JSPromise::create(vm, globalObject->promiseStructure());
                turn->performPromiseThen(vm, globalObject, jsUndefined(), jsUndefined(), next);
                turn = next;
            }
            answer = turn;
            return true;
        }
        answer = underWay;
        // In `bun test` the generated module runs one job after the importers that wait for the body.
        if (factoryValue) {
            JSC::JSPromise* behindBody = JSC::JSPromise::create(vm, globalObject->promiseStructure());
            underWay->performPromiseThen(vm, globalObject, jsUndefined(), jsUndefined(), behindBody);
            answer = behindBody;
        }
        return true;
    };
    // A require() of the mocked file itself has no such module, see handleVirtualModuleResult().
    auto fileOfMock = importsOriginal && JSC::AOT::requireRunsMocks(vm) ? Bun::compiledModuleForPath(specifier->tryGetValue().data) : std::nullopt;
    bool isDirectlyRequired = fileOfMock && JSC::AOT::isCurrentRequireTarget(globalObject, *fileOfMock);
    if (JSValue answer; importsOriginal && !isDirectlyRequired && factoryValue && factoryValue.isCallable() && globalObject->aotInstance() && tryAnswerFromOriginal(answer))
        return answer;
    if (providesActualFile && synchronous) {
        JSValue file = requireOriginalModule(globalObject, this);

        JSC::Exception* thrown = scope.exception();
        auto* error = thrown ? dynamicDowncast<JSC::ErrorInstance>(thrown->value()) : nullptr;
        JSValue message = error ? error->getDirect(vm, vm.propertyNames->message) : JSValue();
        String path = specifier->tryGetValue().data;
        if (message && message.isString() && asString(message)->tryGetValue().data.startsWith(makeString("require() async module \""_s, originalModuleKey(path), '"')) && scope.tryClearException()) [[unlikely]]
            throwException(globalObject, scope, Bun::createAsyncModuleRequiredError(globalObject, path));
        return file;
    }
#endif
    if (factoryValue && factoryValue.isCallable()) {
        JSC::JSFunction* importOriginal = JSC::JSFunction::create(vm, globalObject, 0, "importOriginal"_s, jsFunctionModuleMockImportOriginal, ImplementationVisibility::Public);
        MarkedArgumentBuffer arguments;
        arguments.append(JSC::JSBoundFunction::create(vm, globalObject, importOriginal, this, ArgList(), 0, nullptr, makeSource("importOriginal"_s, JSC::SourceOrigin(), JSC::SourceTaintedOrigin::Untainted)));
        RETURN_IF_EXCEPTION(scope, {});
        // The context survives the factory's awaits, so an import() it makes later can still be traced back to it.
        Bun::beginTrackingAsyncContexts(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto* asyncContext = globalObject->m_asyncContextData.get();
        JSValue previous = asyncContext->getInternalField(0);
        asyncContext->putInternalField(vm, 0, Bun::createAsyncContextFrame(globalObject, this, previous));
        JSValue result = JSC::profiledCall(globalObject, ProfilingReason::API, factoryValue, JSC::getCallData(factoryValue), JSC::jsUndefined(), arguments);
        asyncContext->putInternalField(vm, 0, previous);
        RELEASE_AND_RETURN(scope, result);
    }

#if ENABLE(AOT)
    if (JSValue thrown = !factoryValue && wasInstalledOverFailedLoad ? originalEvaluationError(globalObject, specifier->tryGetValue().data) : JSValue()) {
        throwException(globalObject, scope, thrown);
        return {};
    }
#endif
    if (!dependency && !factoryValue && !spy)
        dependency = originalNamespace.get();
#if ENABLE(AOT)
    if (!dependency && !factoryValue && !spy && unevaluatedCompiledModule && (replacesOriginalImportingMock || !JSC::AOT::hasActiveMock(globalObject, JSC::AOT::ModuleID(*unevaluatedCompiledModule)))) {
        dependency = loadedOriginalNamespace(globalObject, specifier->tryGetValue().data);
        RETURN_IF_EXCEPTION(scope, {});
    }
#endif
    if (dependency)
        RELEASE_AND_RETURN(scope, automockExports(globalObject, this, dependency));

#if ENABLE(AOT)
    if (auto variant = factoryValue ? std::nullopt : unevaluatedCompiledModule; variant && JSC::AOT::isDataFile(JSC::AOT::ModuleID(*variant))) {
        String path = specifier->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* own = JSC::AOT::importAttributeVariants(globalObject, path).contains(JSC::AOT::ModuleID(*variant)) ? JSC::AOT::evaluateOriginalUnderMock(globalObject, JSC::AOT::ModuleID(*variant)) : nullptr;
        RETURN_IF_EXCEPTION(scope, {});
        if (own)
            RELEASE_AND_RETURN(scope, Bun::mockObject(globalObject, own, spy, true));
    }
    if (JSValue answer; !factoryValue && globalObject->aotInstance() && tryAnswerFromOriginal(answer))
        return answer;
    // An evaluated compiled module passes its own exports, like a loaded module below.
    if (!factoryValue && vm.hasCompiledCode()) {
        String path = specifier->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto compiled = isBuiltinModuleKey(path) ? std::nullopt : JSC::AOT::findVariantToMock(globalObject, path, Bun::findMockedModule(path));
        bool isCommonJS = compiled && !JSC::AOT::isESModule(*compiled) && !JSC::AOT::isDataFile(*compiled);
        bool hasOwnOriginal = spy && compiled && (isCommonJS || JSC::AOT::isESModule(*compiled)) && JSC::AOT::hasIntactOriginal(globalObject, *compiled);
        // The loader holds a later run of the file, which is what this mock patches.
        bool isOverLaterRun = compiled && (originalExports || originalCommonJSExports) && JSC::AOT::isEvicted(globalObject, *compiled);
        if (compiled && !hasOwnOriginal && !isOverLaterRun && JSC::AOT::hasStartedLoading(globalObject, *compiled) && !JSC::AOT::hasOnlyBeenLinked(globalObject, *compiled) && !JSC::AOT::hasActiveMock(globalObject, *compiled)) {
            // Under an earlier mock those would be the mock's functions, which an automock would keep.
            JSValue before = JSC::AOT::isPatchedByMock(globalObject, *compiled) ? JSC::AOT::exportsBeforeMock(globalObject, *compiled, false) : JSValue();
            RETURN_IF_EXCEPTION(scope, {});
            if (JSC::AOT::isESModule(*compiled) || JSC::AOT::isDataFile(*compiled)) {
                JSC::AOT::willRunCopyFromDisk(globalObject);
                JSObject* exports = before ? before.getObject() : nullptr;
                if (!exports)
                    exports = JSC::AOT::moduleNamespace(globalObject, *compiled);
                RETURN_IF_EXCEPTION(scope, {});
                exports = withoutUninitializedExports(globalObject, exports);
                RETURN_IF_EXCEPTION(scope, {});
                RELEASE_AND_RETURN(scope, Bun::mockObject(globalObject, exports, spy, true));
            }
            JSValue mocked = Bun::mockObject(globalObject, before ? before : JSC::AOT::moduleExports(globalObject, *compiled), spy, true);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, Bun::JSCommonJSModule::create(globalObject, specifier.get(), mocked, true, jsUndefined()));
        }
    }
#endif

    if (!factoryValue) {
        JSValue commonJSExports = originalCommonJSExports.get();
        if (!commonJSExports || commonJSExports.inherits<JSC::JSModuleNamespaceObject>()) {
            JSObject* exports = esmExportsBeforePatches(globalObject, this);
            RETURN_IF_EXCEPTION(scope, {});
            if (exports)
                RELEASE_AND_RETURN(scope, Bun::mockObject(globalObject, exports, spy, true));
            String specifierString = specifier->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            BunString key = Bun::toString(specifierString);
            commonJSExports = Bun::resolveAndFetchBuiltinModule(globalObject, &key);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (commonJSExports) {
            JSValue mocked = Bun::mockObject(globalObject, commonJSExports, spy, true);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, Bun::JSCommonJSModule::create(globalObject, specifier.get(), mocked, true, jsUndefined()));
        }
    }

#if ENABLE(AOT)
    // As in importOriginalModule(): the original of a package is the package itself, one instance.
    if (!factoryValue && isOfVitest() && unevaluatedCompiledModule && JSC::AOT::isESModule(JSC::AOT::ModuleID(*unevaluatedCompiledModule))) {
        String path = specifier->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        bool hasNoBody = takesFileWithoutBodyAsOriginal(this, JSC::AOT::ModuleID(*unevaluatedCompiledModule));
        bool isOneInstance = hasNoBody || ((!spy || isOverEarlierLinkedFile) && isOneInstanceWithItsOriginal(this, path));
        JSObject* own = isOneInstance ? JSC::AOT::evaluateOriginalUnderMock(globalObject, JSC::AOT::ModuleID(*unevaluatedCompiledModule)) : nullptr;
        RETURN_IF_EXCEPTION(scope, {});
        if (own) {
            usesBodilessFileAsOriginal = hasNoBody && !JSC::AOT::hasInstances(globalObject, JSC::AOT::ModuleID(*unevaluatedCompiledModule));
            own = withoutUninitializedExports(globalObject, own);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, Bun::mockObject(globalObject, own, spy, true));
        }
    }
#endif

    String key = dependencyKeyOfModuleMock(globalObject, this);
    RETURN_IF_EXCEPTION(scope, {});
    if (auto* running = findRunningModuleMock(globalObject, this)) {
        redirectedModuleKey(globalObject, *running, key, specifier->tryGetValue().data);
        addToImportChain(globalObject, *running, key);
    }

    if (synchronous) {
        JSValue moduleNamespace = importModuleKeySync(globalObject, key);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, automockExports(globalObject, this, moduleNamespace));
    }

    RELEASE_AND_RETURN(scope, importModuleKey(globalObject, key));
}

// Returns the modules to evict: they're linked to the original for the factory's sake, and later importers must get the mock.
static Vector<String> stopRunning(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& runningModuleMocks = globalObject->onLoadPlugins.runningModuleMocks;
    size_t index = runningModuleMocks.findIf([&](auto& running) { return running.mock.get() == mock; });
    if (index == notFound)
        return {};
    Vector<String> givenTheOriginal = WTF::move(runningModuleMocks[index].givenTheOriginal);
    runningModuleMocks.removeAt(index);
    return givenTheOriginal;
}

static void didStopRunning(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
#if ENABLE(AOT)
    if (auto* running = findRunningModuleMock(globalObject, mock)) {
        auto requirers = std::exchange(running->compiledRequirersGivenOriginal, {});
        for (uint32_t requirer : requirers)
            JSC::AOT::evictAtNextLoad(globalObject, JSC::AOT::ModuleID(requirer));
        // The pass that evicts them evicts whatever has failed.
        if (!requirers.isEmpty())
            clearCompiledProgramFailures(globalObject);
    }
#endif
    evictModulesAndTheirImporters(globalObject, stopRunning(globalObject, mock));
    returnTurn(globalObject, mock);
}

void JSModuleMock::didFail(Zig::GlobalObject* globalObject, JSValue error)
{
#if ENABLE(AOT)
    if (globalObject->vm().hasCompiledCode() && !factory && Bun__AOT__runsTestFilesAgain()) [[unlikely]] {
        String path = specifier->tryGetValue().data;
        auto file = Bun::compiledModuleForPath(path);
        if (file && JSC::AOT::isESModule(*file) && !JSC::AOT::isSynchronousESModule(globalObject, *file))
            Bun::recordRepeatedFileRun(globalObject, path, "its body threw behind a top-level await"_s);
    }
#endif
    state = State::NotCalled;
    result.clear();
    readUninitializedVariable = isHoisted() && addHoistingNote(globalObject->vm(), error);
#if ENABLE(AOT)
    // In `bun test` a load of the mock itself leaves no entry if the factory fails.
    if (auto file = moduleRequestedByLoad ? Bun::compiledModuleForPath(specifier->tryGetValue().data) : std::nullopt; file && file->index() == *moduleRequestedByLoad) {
        wasRequested = false;
        if (!importsOriginal)
            JSC::AOT::didFailMockImportRoot(globalObject, *file);
        else if (factory)
            clearCompiledProgramFailures(globalObject);
    }
#endif
    didStopRunning(globalObject, this);
}

void JSModuleMock::abandon(Zig::GlobalObject* globalObject)
{
    state = State::NotCalled;
    result.clear();
#if ENABLE(AOT)
    isAwaitingRunningBody = false;
    hasAwaitedLoaderTick = false;
#endif
    detach(globalObject);
}

void JSModuleMock::giveUp(Zig::GlobalObject* globalObject)
{
    auto* pending = state == State::Running && result ? dynamicDowncast<JSC::JSPromise>(result.get()) : nullptr;
    if (!pending)
        return;
    abandon(globalObject);
    pending->fulfill(globalObject->vm(), jsUndefined());
}

void JSModuleMock::detach(Zig::GlobalObject* globalObject)
{
    for (auto& module : stopRunning(globalObject, this))
        globalObject->onLoadPlugins.modulesToEvictOnceLoaded.add(module);
    returnTurn(globalObject, this);
}

static bool readsModuleExports(JSC::JSGlobalObject* globalObject, JSObject* object, const String& key, UncheckedKeyHashSet<JSObject*>& seen)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

#if ENABLE(AOT)

    if (JSC::AbstractModuleRecord* compiled = JSC::AOT::isModuleNamespace(object) ? JSC::AOT::moduleRecordForNamespace(globalObject, object) : nullptr) {
        if (!seen.add(object).isNewEntry)
            return false;
        Vector<JSC::AbstractModuleRecord*> mockRecords;
        if (compiled->hasLiveExports())
            mockRecords.append(compiled);
        else {
            JSC::PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            object->methodTable()->getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Include);
            RETURN_IF_EXCEPTION(scope, false);
            for (auto& name : names) {
                auto resolution = compiled->resolveExport(globalObject, name);
                RETURN_IF_EXCEPTION(scope, false);
                if (resolution.isLiveExport(vm) && !mockRecords.contains(resolution.moduleRecord))
                    mockRecords.append(resolution.moduleRecord);
            }
        }
        for (auto* record : mockRecords) {
            if (record->moduleKey().string() == key)
                return true;
            JSObject* source = record->liveExportsSource();
            if (auto* mock = source ? dynamicDowncast<JSModuleMock>(source) : nullptr)
                source = mock->exports.get();
            bool reads = source && readsModuleExports(globalObject, source, key, seen);
            RETURN_IF_EXCEPTION(scope, false);
            if (reads)
                return true;
        }
        return false;
    }
#endif

    auto* moduleNamespace = dynamicDowncast<JSC::JSModuleNamespaceObject>(object);
    if (!moduleNamespace || !seen.add(moduleNamespace).isNewEntry)
        return false;

    Vector<JSC::AbstractModuleRecord*> records;
    if (moduleNamespace->moduleRecord()->hasLiveExports())
        records.append(moduleNamespace->moduleRecord());
    else {
        JSC::PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        moduleNamespace->methodTable()->getOwnPropertyNames(moduleNamespace, globalObject, names, DontEnumPropertiesMode::Include);
        RETURN_IF_EXCEPTION(scope, false);
        for (auto& name : names) {
            auto resolution = moduleNamespace->moduleRecord()->resolveExport(globalObject, name);
            RETURN_IF_EXCEPTION(scope, false);
            if (resolution.isLiveExport(vm) && !records.contains(resolution.moduleRecord))
                records.append(resolution.moduleRecord);
        }
    }

    for (auto* record : records) {
        if (record->moduleKey().string() == key)
            return true;
        JSObject* source = record->liveExportsSource();
        if (auto* mock = source ? dynamicDowncast<JSModuleMock>(source) : nullptr)
            source = mock->exports.get();
        bool reads = source && readsModuleExports(globalObject, source, key, seen);
        RETURN_IF_EXCEPTION(scope, false);
        if (reads)
            return true;
    }
    return false;
}

void JSModuleMock::settle(Zig::GlobalObject* globalObject, JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* object = value.getObject();
    if (!object) {
        throwFactoryMustReturnObject(globalObject, scope);
        return;
    }
#if ENABLE(AOT)
    if (std::exchange(wasOriginalLoadedAhead, false) && !wasOriginalRequested) [[unlikely]]
        Bun::recordRepeatedFileRun(globalObject, specifier->tryGetValue().data, "its mock's factory names importOriginal, importActual or requireActual, and didn't request it"_s);
#endif
    JSObject* esmExports = object;
    if (auto* commonJSModule = dynamicDowncast<Bun::JSCommonJSModule>(object)) {
        JSValue moduleExports = commonJSModule->exportsObject();
        RETURN_IF_EXCEPTION(scope, );
        esmExports = esmExportsOfCommonJSExports(globalObject, moduleExports);
        RETURN_IF_EXCEPTION(scope, );
    }

    // Unwrap a mocked module's namespace to what it reads from now. Otherwise this module's own namespace would read from itself.
    while (auto* moduleNamespace = dynamicDowncast<JSC::JSModuleNamespaceObject>(esmExports)) {
        JSObject* source = moduleNamespace->moduleRecord()->hasLiveExports() ? moduleNamespace->moduleRecord()->liveExportsSource() : nullptr;
        if (auto* mock = source ? dynamicDowncast<JSModuleMock>(source) : nullptr)
            source = mock->exports.get();
        if (!source)
            break;
        esmExports = source;
    }
#if ENABLE(AOT)

    while (JSObject* source = globalObject->vm().hasCompiledCode() ? JSC::AOT::activeMockForNamespace(esmExports) : nullptr) {
        if (auto* mock = dynamicDowncast<JSModuleMock>(source))
            source = mock->exports.get();
        if (!source || source == esmExports)
            break;
        esmExports = source;
    }
#endif
    String key = specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    UncheckedKeyHashSet<JSObject*> seen;
    bool readsItself = readsModuleExports(globalObject, esmExports, key, seen);
    RETURN_IF_EXCEPTION(scope, );
    if (readsItself) {
        JSC::throwTypeError(globalObject, scope, "mock(module, fn): the factory can't return the namespace object of a module that re-exports the mocked module"_s);
        return;
    }

    state = State::Settled;
    result.set(vm, this, object);
    exports.set(vm, this, esmExports);
    RELEASE_AND_RETURN(scope, didStopRunning(globalObject, this));
}

#if ENABLE(AOT)
JSC_DECLARE_HOST_FUNCTION(jsFunctionModuleMockFactoryDidFulfill);
JSC_DECLARE_HOST_FUNCTION(jsFunctionModuleMockFactoryDidReject);
#endif

void JSModuleMock::settleWithPromised(Zig::GlobalObject* globalObject, JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
#if ENABLE(AOT)
    if (std::exchange(isAwaitingRunningBody, false)) {
        JSValue made = callFactory(globalObject, false, nullptr);
        RETURN_IF_EXCEPTION(scope, );
        if (auto* promised = dynamicDowncast<JSC::JSPromise>(made)) {
            isAwaitingFactoryAfterBody = true;
            JSC::JSFunction* didFulfill = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionModuleMockFactoryDidFulfill, ImplementationVisibility::Private);
            JSC::JSFunction* didReject = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionModuleMockFactoryDidReject, ImplementationVisibility::Private);
            promised->performPromiseThenWithContext(vm, globalObject, didFulfill, didReject, jsUndefined(), moduleMockWith(globalObject, this, uncheckedDowncast<JSC::JSPromise>(result.get())));
            return;
        }
        RELEASE_AND_RETURN(scope, settle(globalObject, made));
    }
#endif
    if (JSValue factoryValue = factory.get(); !factoryValue || !factoryValue.isCallable()) {
        JSObject* exports = automockExports(globalObject, this, value);
        RETURN_IF_EXCEPTION(scope, );
        value = exports ? JSValue(exports) : jsUndefined();
    }
    RELEASE_AND_RETURN(scope, settle(globalObject, value));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockFactoryDidFulfill, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto [mock, pending] = toModuleMockWith<JSC::JSPromise>(globalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    if (mock->result.get() != pending)
        return JSValue::encode(jsUndefined());
    mock->settleWithPromised(globalObject, callframe->argument(0));
#if ENABLE(AOT)
    if (std::exchange(mock->isAwaitingFactoryAfterBody, false) && !scope.exception())
        return JSValue::encode(jsUndefined());
#endif
    if (auto* exception = scope.exception()) [[unlikely]] {
        if (!scope.tryClearException()) {
            mock->abandon(globalObject);
            return {};
        }
        mock->didFail(globalObject, exception->value());
        RETURN_IF_EXCEPTION(scope, {});
        pending->reject(vm, exception->value());
    } else
        pending->fulfill(vm, jsUndefined());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockFactoryDidReject, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto [mock, pending] = toModuleMockWith<JSC::JSPromise>(lexicalGlobalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    if (mock->result.get() != pending)
        return JSValue::encode(jsUndefined());
    mock->didFail(defaultGlobalObject(lexicalGlobalObject), callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    pending->reject(vm, callframe->argument(0));
    return JSValue::encode(jsUndefined());
}

#if ENABLE(AOT)
JSC_DEFINE_HOST_FUNCTION(jsFunctionAbandonedMockBodyDidEnd, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto [mock, pending] = toModuleMockWith<JSC::JSPromise>(lexicalGlobalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    if (!registeredModuleMock(defaultGlobalObject(lexicalGlobalObject), mock->specifier->tryGetValue().data))
        pending->fulfill(vm, jsUndefined());
    return JSValue::encode(jsUndefined());
}
#endif

static String fileOfFunction(JSValue function)
{
    auto* jsFunction = function ? dynamicDowncast<JSC::JSFunction>(function) : nullptr;
    if (!jsFunction || jsFunction->isHostFunction())
        return {};
    const URL& url = jsFunction->jsExecutable()->sourceOrigin().url();
    return url.isValid() && url.protocolIsFile() ? url.fileSystemPath() : String();
}

__attribute__((minsize)) JSC::JSPromise* JSModuleMock::run(Zig::GlobalObject* globalObject, bool synchronous, JSObject* dependency)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    switch (state) {
    case State::Settled:
        return nullptr;
    case State::Running: {
        if (JSObject* pending = result.get())
            return uncheckedDowncast<JSC::JSPromise>(pending);
        String specifierString = specifier->value(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        scope.throwException(globalObject, JSC::createError(globalObject, makeString("Circular import: \""_s, specifierString, "\" is imported by a module that its own mock factory loads while it runs"_s)));
        return nullptr;
    }
    case State::NotCalled:
        break;
    }

    state = State::Running;
#if ENABLE(AOT)
    // Nothing has fetched the failure of the previous call. This call replaces it.
    lateFactoryError.clear();
    waitingImportCount = 0;
    wasRequested = true;
#endif
    globalObject->onLoadPlugins.runningModuleMocks.append(BunPlugin::OnLoad::RunningModuleMock { JSC::Strong<JSC::JSObject> { vm, this }, fileOfFunction(factory.get()), {}, {}, {}, {} });
#if ENABLE(AOT)
    if (vm.hasCompiledCode()) {
        calledAt = ++globalObject->onLoadPlugins.moduleMockSequenceNumber;
        auto import = JSC::AOT::currentImportCall(globalObject);
        requestedAt = import ? import->callSequenceNumber : calledAt;
        wasCalledUnderRequire = JSC::AOT::requireRunsMocks(vm);
    }
#endif

    JSValue value = callFactory(globalObject, synchronous, dependency);
    bool isAwaited = false;
#if ENABLE(AOT)
    isAwaited = std::exchange(isAwaitedByGeneratedModule, false);
    if (isAwaited && !scope.exception() && !dynamicDowncast<JSC::JSPromise>(value)) {
        JSC::JSPromise* returned = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        returned->fulfill(vm, value);
        value = returned;
    }
#endif
    if (!scope.exception()) [[likely]] {
        if (auto* promise = dynamicDowncast<JSC::JSPromise>(value)) {
            switch (isAwaited && promise->status() == JSC::JSPromise::Status::Fulfilled ? JSC::JSPromise::Status::Pending : promise->status()) {
            case JSC::JSPromise::Status::Pending: {
                // The reactions settle it explicitly, not through their return value, so it stays pending once the mock is abandoned.
                JSC::JSPromise* pending = JSC::JSPromise::create(vm, globalObject->promiseStructure());
                result.set(vm, this, pending);
                JSC::JSFunction* didFulfill = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionModuleMockFactoryDidFulfill, ImplementationVisibility::Private);
                JSC::JSFunction* didReject = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionModuleMockFactoryDidReject, ImplementationVisibility::Private);
                promise->performPromiseThenWithContext(vm, globalObject, didFulfill, didReject, jsUndefined(), moduleMockWith(globalObject, this, pending));
                return pending;
            }
            case JSC::JSPromise::Status::Rejected:
                promise->markAsHandled();
                scope.throwException(globalObject, promise->result());
                break;
            case JSC::JSPromise::Status::Fulfilled:
                settleWithPromised(globalObject, promise->result());
                break;
            }
        } else
            settle(globalObject, value);
    }
    if (auto* exception = scope.exception()) [[unlikely]] {
        if (scope.tryClearException()) {
            didFail(globalObject, exception->value());
            RETURN_IF_EXCEPTION(scope, nullptr);
            scope.throwException(globalObject, exception);
        } else
            abandon(globalObject);
    }
    return nullptr;
}

// Such a fetch settles without waiting on a factory, so waiting for it can't deadlock. See runModuleMock().
static bool isFetchedWithoutFactory(Zig::GlobalObject* globalObject, const String& key)
{
    if (globalObject->onLoadPlugins.moduleMocksBeingLoaded.contains(key))
        return false;
    JSModuleMock* mock = registeredModuleMock(globalObject, key);
    return !mock || mock->state == JSModuleMock::State::Settled || (mock->state == JSModuleMock::State::NotCalled && mock->importsOriginal);
}

static bool isBeingFetchedWithoutFactory(Zig::GlobalObject* globalObject, JSC::ModuleRegistryEntry* entry)
{
    bool isBeingFetched = entry->status() == JSC::ModuleRegistryEntry::Status::Fetching;
#if ENABLE(AOT)
    isBeingFetched |= globalObject->vm().hasCompiledCode() && entry->status() == JSC::ModuleRegistryEntry::Status::New;
#endif
    return !entry->record() && isBeingFetched && isFetchedWithoutFactory(globalObject, entry->key().string());
}

extern "C" int32_t Bun__onLoadNamespaceLength(const BunString* key);

static bool isLoadedByPlugin(Zig::GlobalObject* globalObject, const String& key)
{
    auto& plugins = globalObject->onLoadPlugins;
    if (plugins.isEmpty())
        return false;
    BunString keyString = Bun::toString(key);
    int32_t namespaceLength = Bun__onLoadNamespaceLength(&keyString);
    auto* group = namespaceLength < 0 ? nullptr : plugins.group(namespaceLength ? key.substringSharingImpl(0, namespaceLength) : String());
    if (!group)
        return false;
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(JSC::getVM(globalObject));
    String path = withoutOriginalModuleQuery(namespaceLength ? key.substringSharingImpl(namespaceLength + 1) : key);
    bool isLoadedByPlugin = group->find(globalObject, path);
    (void)scope.tryClearException();
    return isLoadedByPlugin;
}

JSC_DECLARE_HOST_FUNCTION(jsFunctionGiveTurnsToModuleMocks);

// Ranks again once all of `fetches` have settled, or from the next microtask if there are none.
__attribute__((minsize)) static void rerankAfter(Zig::GlobalObject* globalObject, Vector<JSC::JSPromise*>& fetches)
{
    auto& vm = JSC::getVM(globalObject);
    if (fetches.isEmpty()) {
        fetches.append(JSC::JSPromise::create(vm, globalObject->promiseStructure()));
        fetches.last()->fulfill(vm, jsUndefined());
    }
    globalObject->onLoadPlugins.loadsBeingFetched++;
    auto* countdown = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), jsNumber(fetches.size()), jsNumber(globalObject->onLoadPlugins.timesRanked));
    JSC::JSFunction* settled = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionGiveTurnsToModuleMocks, ImplementationVisibility::Private);
    for (auto* fetch : fetches)
        fetch->performPromiseThenWithContext(vm, globalObject, settled, settled, jsUndefined(), countdown);
    fetches.shrink(0);
}

// Finds the load each waiting mock belongs to. Once a load has fetched all it can without a factory, ranks its mocks in the order
// their modules would be evaluated, which is the order Vitest calls the factories in. isWaitingForModule() then sees the whole graph.
__attribute__((noinline, minsize)) static void rankWaitingModuleMocks(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto& plugins = globalObject->onLoadPlugins;
    auto* loader = Bun::testFileModuleLoader(globalObject);
    plugins.timesRanked++;
    plugins.loadsBeingFetched = 0;
    plugins.hasNewLoad = false;

    Vector<JSC::Identifier> keys;
    UncheckedKeyHashMap<UniquedStringImpl*, size_t> indexOf;
    for (size_t i = 0; i < plugins.waitingModuleMocks.size(); ++i) {
        plugins.waitingModuleMocks[i].rank = 0;
        plugins.waitingModuleMocks[i].load = String();
        keys.append(JSC::Identifier::fromString(vm, uncheckedDowncast<JSModuleMock>(plugins.waitingModuleMocks[i].mock.get())->specifier->tryGetValue().data));
        indexOf.add(keys.last().impl(), i);
    }
    size_t mockKeyCount = indexOf.size();
#if ENABLE(AOT)
    // The loader has no record of a compiled file while its fetch waits, so the entry of that fetch stands in for the mock.
    size_t numberOfOwnKeys = keys.size();
    for (auto& [key, mock] : plugins.waitingMockFetches) {
        size_t index = plugins.waitingModuleMocks.findIf([&](auto& waiting) { return waiting.mock.get() == mock.get(); });
        if (index == notFound)
            continue;
        keys.append(JSC::Identifier::fromString(vm, key));
        indexOf.add(keys.last().impl(), index);
    }
#endif

    auto unfinishedRecord = [&](JSC::ModuleRegistryEntry* entry) -> JSC::CyclicModuleRecord* {
        auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(entry->record());
        return cyclic && !cyclic->isSCCEvaluated() ? cyclic : nullptr;
    };
    auto importOf = [&](JSC::AbstractModuleRecord* record, const JSC::AbstractModuleRecord::ModuleRequest& request) -> UniquedStringImpl* {
        JSC::ModuleMapKey key { request.m_specifier.impl(), request.type() };
        if (auto* resolved = record->resolvedRequests().get(key))
            return resolved;
        auto loaded = record->loadedModules().find(key);
        return loaded == record->loadedModules().end() ? nullptr : loaded->value.m_module->moduleKey().impl();
    };

    // What a running factory has requested for comes first, the latest first: the mocks it leads to are called in its order, as in Vitest.
    Vector<UniquedStringImpl*> loads;
    Vector<String> finished;
    Vector<JSC::JSPromise*> fetches;
    // If a factory imports a module that's still being read, we can't tell yet whether that module imports the mock, so the factory gets a private copy.
    // To avoid that, don't start a factory while any load is reading a file. Don't wait for onLoad() callbacks, which may depend on the test's progress.
    bool isReadingFile = false;
#if ENABLE(AOT)
    Vector<JSC::JSPromise*> heldFetches;
#endif
    auto addFetch = [&](const String& key, JSC::JSPromise* fetch) {
#if ENABLE(AOT)
        // Such a fetch has loaded all that it can without the factory. What is below it is ranked once it settles.
        if (plugins.fetchesBlockedOnFactories.contains(key)) [[unlikely]] {
            heldFetches.append(fetch);
            return;
        }
#endif
        fetches.append(fetch);
        isReadingFile = isReadingFile || !isLoadedByPlugin(globalObject, key);
    };
    // A mock passed to import() gets its own turn right away, even if another load also imports it and already has a factory running. Vitest does the same.
    Vector<bool> isDirectlyRequested;
    isDirectlyRequested.fill(false, plugins.waitingModuleMocks.size());
    size_t directlyRequested = 0;
    for (auto& key : plugins.loadRoots) {
        if (auto index = indexOf.find(JSC::Identifier::fromString(vm, key).impl()); index != indexOf.end()) {
#if ENABLE(AOT)
            // import() requested the compiled file, so the file is the root of a load.
            if (index->key != keys[index->value].impl()) {
                loads.append(index->key);
                continue;
            }
#endif
            isDirectlyRequested[index->value] = true;
            directlyRequested++;
            continue;
        }
        auto* entry = loader->registryEntry(JSC::Identifier::fromString(vm, key));
        JSC::JSPromise* unregisteredFetch = nullptr;
        if (entry)
            plugins.loadRootFetches.remove(key);
        else if (auto fetch = plugins.loadRootFetches.find(key); fetch != plugins.loadRootFetches.end())
            unregisteredFetch = uncheckedDowncast<JSC::JSPromise>(fetch->value.get());
        if (unregisteredFetch && isFetchedWithoutFactory(globalObject, key)) {
            // After it settles, JSC registers the module in a microtask that's already queued.
            if (unregisteredFetch->status() == JSC::JSPromise::Status::Pending)
                addFetch(key, unregisteredFetch);
            else if (plugins.modulesGivenTimeToRequestImports.add(key).isNewEntry)
                isReadingFile = true;
            else
                finished.append(key);
        } else if (!entry || (entry->record() && !unfinishedRecord(entry)))
            finished.append(key);
        else if (!entry->record()) {
            if (isBeingFetchedWithoutFactory(globalObject, entry))
                addFetch(key, entry->ensureModulePromise(globalObject));
        } else if (!plugins.loadRootsDuringFactories.contains(key) && plugins.runningModuleMocks.containsIf([&](auto& running) { return running.importChain.contains(key); }))
            loads.insert(0, entry->key().impl());
        else
            loads.append(entry->key().impl());
    }
    for (auto& key : finished) {
        plugins.loadRoots.remove(key);
        plugins.loadRootsDuringFactories.remove(key);
        plugins.loadRootFetches.remove(key);
    }
    if (!fetches.isEmpty() || isReadingFile)
        rerankAfter(globalObject, fetches);

    // Loads that share a module are fetched together: none is ready before all are.
    // A load that a factory started shares that factory's turn. Two import() calls of a test don't, as in Vitest.
    Vector<size_t> fetchedWith, sharesTurnWith;
    auto first = [](Vector<size_t>& group, size_t load) {
        while (group[load] != load)
            load = group[load];
        return load;
    };
    auto join = [&](Vector<size_t>& group, size_t load, size_t other) {
        group[first(group, other)] = first(group, load);
    };
    UncheckedKeyHashMap<UniquedStringImpl*, size_t> seen;
    Vector<std::pair<JSC::CyclicModuleRecord*, size_t>> stack;
    Vector<std::pair<size_t, size_t>> found;
    Vector<bool> isBeingFetched;
    bool hasOtherLoads = false;
    for (size_t load = 0;; ++load) {
        if (load == loads.size() && !hasOtherLoads && found.size() + directlyRequested < mockKeyCount) {
            // The imports of a test file or a preload, which import() didn't ask for: they start at a module that nothing unfinished imports.
            hasOtherLoads = true;
            UncheckedKeyHashSet<UniquedStringImpl*> imported;
            for (auto& [key, entry] : loader->moduleMap()) {
                auto* record = unfinishedRecord(entry.get());
                if (!record)
                    continue;
                if (!seen.contains(key.first))
                    loads.append(key.first);
                for (auto& request : record->requestedModules()) {
                    if (auto* import = importOf(record, request))
                        imported.add(import);
                }
            }
            loads.removeAllMatching([&](auto* key) { return imported.contains(key); }, load);
        }
        if (load == loads.size())
            break;
        fetchedWith.append(load);
        sharesTurnWith.append(load);
        isBeingFetched.append(false);
        bool needsTime = false;
        auto enter = [&](UniquedStringImpl* key) {
            if (auto added = seen.add(key, load); !added.isNewEntry) {
                join(fetchedWith, added.iterator->value, load);
                return;
            }
            if (auto index = indexOf.find(key); index != indexOf.end()) {
                if (!isDirectlyRequested[index->value])
                    found.append({ index->value, load });
                return;
            }
            auto* entry = loader->registryEntry(JSC::Identifier::fromUid(vm, key));
            if (!entry)
                return;
            if (auto* record = unfinishedRecord(entry))
                stack.append({ record, 0 });
            else if (isBeingFetchedWithoutFactory(globalObject, entry))
                addFetch(String(key), entry->ensureModulePromise(globalObject));
            // A mock that is about to ask for its turn, from a microtask that is already queued. It may come before the ones that wait.
            else if (plugins.moduleMocksBeingLoaded.contains(String(key)) && plugins.modulesGivenTimeToRequestImports.add(String(key)).isNewEntry)
                needsTime = true;
        };
        enter(loads[load]);
        while (!stack.isEmpty()) {
            auto [record, next] = stack.last();
            if (next == record->requestedModules().size()) {
                stack.removeLast();
                continue;
            }
            stack.last().second++;
            if (auto* import = importOf(record, record->requestedModules()[next]))
                enter(import);
            // The loader requests a module's imports in a microtask that is already queued. If the load has failed, it never will.
            else if (plugins.modulesGivenTimeToRequestImports.add(record->moduleKey().string()).isNewEntry)
                needsTime = true;
        }
        if (!fetches.isEmpty() || needsTime) {
            isBeingFetched[load] = true;
            isReadingFile = isReadingFile || needsTime;
            rerankAfter(globalObject, fetches);
        }
    }
    for (size_t load = 0; load < loads.size(); ++load) {
        if (isBeingFetched[load])
            isBeingFetched[first(fetchedWith, load)] = true;
    }
#if ENABLE(AOT)

    if (!heldFetches.isEmpty()) [[unlikely]] {
        rerankAfter(globalObject, heldFetches);
        plugins.loadsBeingFetched--;
    }
#endif
    // A factory keeps the load it was called for, also if another load turns out to import its module. That load can't end before it returns.
    for (auto& holder : plugins.moduleMocksWithTurn) {
        size_t holderLoad = loads.findIf([&](auto* load) { return holder.load == StringView(load); });
        auto* running = findRunningModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(holder.mock.get()));
        for (size_t load = 0; running && holderLoad != notFound && load < loads.size(); ++load) {
            if (String key = loads[load]; running->importChain.contains(key) && !plugins.loadRootsDuringFactories.contains(key))
                join(sharesTurnWith, holderLoad, load);
        }
    }
    for (auto& holder : plugins.moduleMocksWithTurn) {
        if (size_t load = loads.findIf([&](auto* load) { return holder.load == StringView(load); }); load != notFound)
            holder.load = String(loads[first(sharesTurnWith, load)]);
    }
    unsigned rank = 0;
    for (auto [index, load] : found) {
        if (isReadingFile || isBeingFetched[first(fetchedWith, load)])
            continue;
        plugins.waitingModuleMocks[index].rank = ++rank;
        plugins.waitingModuleMocks[index].load = String(loads[first(sharesTurnWith, load)]);
    }

#if ENABLE(AOT)
    Vector<bool> isReachedThroughFetch;
    isReachedThroughFetch.fill(false, plugins.waitingModuleMocks.size());
    for (size_t i = numberOfOwnKeys; i < keys.size(); ++i) {
        if (seen.contains(keys[i].impl()))
            isReachedThroughFetch[indexOf.get(keys[i].impl())] = true;
    }
#endif
    // Nothing unfinished imports these: import() requested for them.
    for (auto& [key, index] : indexOf) {
        if (seen.contains(key) && !isDirectlyRequested[index])
            continue;
#if ENABLE(AOT)
        if (key != keys[index].impl() || (isReachedThroughFetch[index] && !isDirectlyRequested[index]))
            continue;
#endif
        plugins.waitingModuleMocks[index].rank = 1;
        plugins.waitingModuleMocks[index].load = String(key);
    }
}

__attribute__((minsize)) static void giveTurns(Zig::GlobalObject* globalObject)
{
    auto& plugins = globalObject->onLoadPlugins;
    if (plugins.waitingModuleMocks.isEmpty())
        return;
    if (std::exchange(plugins.ranksAreStale, false))
        rankWaitingModuleMocks(globalObject);
    auto hasToWait = [&](auto& waiting) {
        String specifier = uncheckedDowncast<JSModuleMock>(waiting.mock.get())->specifier->tryGetValue().data;
        return plugins.moduleMocksWithTurn.containsIf([&](auto& other) {
            if (other.load != waiting.load)
                return false;
            // A factory that waits for this module would never return its turn.
            auto* running = findRunningModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(other.mock.get()));
#if ENABLE(AOT)
            // The loader knows nothing below a compiled file whose fetch waits for this turn.
            auto mocked = running && globalObject->vm().hasCompiledCode() ? Bun::compiledModuleForPath(specifier) : std::nullopt;
            if (mocked && running->compiledImportChain.get(mocked->index()))
                return false;
#endif
            return !running || !running->importChain.contains(specifier);
        });
    };
    while (true) {
        size_t next = notFound;
        for (size_t i = 0; i < plugins.waitingModuleMocks.size(); ++i) {
            auto& waiting = plugins.waitingModuleMocks[i];
            if (!waiting.rank || hasToWait(waiting))
                continue;
            if (next == notFound || (waiting.load == plugins.waitingModuleMocks[next].load && waiting.rank < plugins.waitingModuleMocks[next].rank))
                next = i;
        }
        if (next == notFound)
            return;
        auto waiting = plugins.waitingModuleMocks[next];
        plugins.waitingModuleMocks.removeAt(next);
        plugins.moduleMocksWithTurn.append({ waiting.mock, waiting.load });
        plugins.modulesGivenTimeToRequestImports.clear();
        uncheckedDowncast<JSC::JSPromise>(waiting.turn.get())->fulfill(globalObject->vm(), jsUndefined());
    }
}

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionGiveTurnsToModuleMocks, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& plugins = globalObject->onLoadPlugins;
    if (callframe->argument(1).isUndefined())
        plugins.willGiveTurns = false;
    else {
        auto* countdown = uncheckedDowncast<JSC::InternalFieldTuple>(callframe->argument(1));
        int32_t left = countdown->getInternalField(0).asInt32() - 1;
        countdown->putInternalField(JSC::getVM(globalObject), 0, jsNumber(left));
        if (left || countdown->getInternalField(1).asNumber() != plugins.timesRanked)
            return JSValue::encode(jsUndefined());
        plugins.ranksAreStale = true;
    }
    giveTurns(globalObject);
    return JSValue::encode(jsUndefined());
}

// From a microtask, so the mocks that the loader asks for next are waiting by then.
__attribute__((minsize)) static void giveTurnsSoon(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    if (std::exchange(globalObject->onLoadPlugins.willGiveTurns, true))
        return;
    JSC::JSPromise* fulfilled = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    fulfilled->fulfill(vm, jsUndefined());
    thenWithContext(globalObject, fulfilled, jsFunctionGiveTurnsToModuleMocks, nullptr, jsUndefined());
}

static void returnTurn(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    if (globalObject->onLoadPlugins.moduleMocksWithTurn.removeFirstMatching([&](auto& other) { return other.mock.get() == mock; }))
        giveTurns(globalObject);
}

// The factories that one load calls run one at a time, as in Vitest, and only once the load has fetched all it can without them.
// So what a factory imports doesn't depend on how far another factory's imports have come, or on which module was fetched first.
// Returns null if `mock` can call its factory now, else a promise that is fulfilled when it should ask again.
__attribute__((minsize)) static JSC::JSPromise* waitForTurn(Zig::GlobalObject* globalObject, JSModuleMock* mock, bool isBeingFetched)
{
    auto& vm = JSC::getVM(globalObject);
    auto& plugins = globalObject->onLoadPlugins;
    if (plugins.moduleMocksWithTurn.containsIf([&](auto& other) { return other.mock.get() == mock; }))
        return nullptr;
    for (auto& waiting : plugins.waitingModuleMocks) {
        if (waiting.mock.get() == mock)
            return uncheckedDowncast<JSC::JSPromise>(waiting.turn.get());
    }
    JSC::JSPromise* turn = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    plugins.waitingModuleMocks.append({ JSC::Strong<JSC::JSObject> { vm, mock }, JSC::Strong<JSC::JSObject> { vm, turn }, String(), 0 });
    // A module is only fetched for a load that is being fetched. If the ranks know of all such loads, the end of that one ranks again.
    if (!isBeingFetched || !plugins.loadsBeingFetched || plugins.hasNewLoad)
        plugins.ranksAreStale = true;
    if (plugins.ranksAreStale)
        giveTurnsSoon(globalObject);
    return turn;
}

#if ENABLE(AOT)
// An import() of the mocked module called the factory, not the fetch that waits for its turn. The fetch resumes after the factory.
static void endWaitForTurn(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& waitingForTurn = globalObject->onLoadPlugins.waitingModuleMocks;
    size_t place = waitingForTurn.findIf([&](auto& other) { return other.mock.get() == mock; });
    if (place == notFound)
        return;
    auto turn = waitingForTurn[place].turn;
    waitingForTurn.removeAt(place);
    uncheckedDowncast<JSC::JSPromise>(turn.get())->fulfill(globalObject->vm(), jsUndefined());
}
#endif

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionRunModuleMockLater, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue context = callframe->argument(1);
    auto [mock, waiting] = toModuleMockWith<JSC::InternalFieldTuple>(globalObject, scope, context);
    RETURN_IF_EXCEPTION(scope, {});
    auto* settled = uncheckedDowncast<JSC::JSPromise>(waiting->getInternalField(0));

    bool isInUse = Bun::isModuleMockInUse(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, {});

    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto& moduleMocksBeingLoaded = globalObject->onLoadPlugins.moduleMocksBeingLoaded;
    if (JSC::JSPromise* turn = isInUse && mock->state == JSModuleMock::State::NotCalled ? waitForTurn(globalObject, mock, true) : nullptr) {
        JSValue later = callframe->jsCallee();
        turn->performPromiseThenWithContext(vm, globalObject, later, later, jsUndefined(), context);
        return JSValue::encode(jsUndefined());
    }

    // Drop runModuleMock()'s entry, unless the factory already ran and the mock was replaced since (keepInFlightModuleMock).
    if (auto waiting = moduleMocksBeingLoaded.find(specifier); waiting != moduleMocksBeingLoaded.end() && waiting->value.get() == mock && (!isInUse || registeredModuleMock(globalObject, specifier) == mock))
        moduleMocksBeingLoaded.remove(waiting);

    JSC::JSPromise* pending = isInUse ? mock->run(globalObject, false) : nullptr;
    if (!findRunningModuleMock(globalObject, mock))
        returnTurn(globalObject, mock);
    if (scope.exception()) [[unlikely]]
        settled->rejectWithCaughtException(vm, scope);
    else if (pending)
        settled->pipeFrom(vm, pending);
    else
        settled->fulfill(vm, jsUndefined());
    return JSValue::encode(jsUndefined());
}

bool JSModuleMock::getOwnPropertySlot(JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSC::PropertySlot& slot)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* mock = uncheckedDowncast<JSModuleMock>(object);
    JSObject* exports = mock->exports.get();
    if (!exports || slot.internalMethodType() == JSC::PropertySlot::InternalMethodType::VMInquiry)
        return false;

    JSC::PropertySlot exportSlot(exports, slot.internalMethodType());
    bool hasExport = exports->getPropertySlot(globalObject, propertyName, exportSlot);
    RETURN_IF_EXCEPTION(scope, false);
    if (hasExport) {
        JSValue value = jsUndefined();
        if (slot.internalMethodType() != JSC::PropertySlot::InternalMethodType::HasProperty) {
            value = exportSlot.getValue(globalObject, propertyName);
            RETURN_IF_EXCEPTION(scope, false);
        }
        slot.setValue(mock, static_cast<unsigned>(JSC::PropertyAttribute::None), value);
        return true;
    }

    // In Jest the factory returns `module.exports`, so a default import gets the object itself unless it's marked `__esModule`.
    if (mock->isOfJest() && propertyName == vm.propertyNames->defaultKeyword) {
        JSValue isESModule = exports->get(globalObject, vm.propertyNames->__esModule);
        RETURN_IF_EXCEPTION(scope, false);
        if (!isESModule.toBoolean(globalObject)) {
            slot.setValue(mock, static_cast<unsigned>(JSC::PropertyAttribute::None), exports);
            return true;
        }
    }

    // Like Vitest, vi.mock() and vi.doMock() throw on an export the factory left out. For mock.module() and jest.mock() it's undefined.
    if (!mock->isOfVitest())
        return false;
    // Promise resolution probes `then` and CommonJS interop probes `__esModule`, so those must not throw.
    JSValue factory = mock->factory.get();
    if (slot.internalMethodType() != JSC::PropertySlot::InternalMethodType::Get || !factory || !factory.isCallable() || mock->providesActualFile || propertyName.isSymbol() || propertyName == vm.propertyNames->then || propertyName == vm.propertyNames->__esModule)
        return false;

    String written = mock->writtenSpecifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    auto function = mock->function == ModuleMockFunction::ViMock ? "vi.mock"_s : "vi.doMock"_s;
    StringBuilder message;
    message.append("No \""_s);
    message.append(StringView(propertyName.uid()));
    message.append(missingExportMessage);
    message.append(written);
    message.append("\". Did you forget to return it from the "_s);
    message.append(function);
    message.append("() factory?\nTo keep the exports of the original module, spread them:\n\n"_s);
    message.append(function);
    message.append("(\""_s);
    message.append(written);
    message.append("\", async importOriginal => ({\n  ...(await importOriginal()),\n}));\n"_s);
    scope.throwException(globalObject, JSC::createError(globalObject, message.toString()));
    return false;
}

bool JSModuleMock::getOwnPropertySlotByIndex(JSObject* object, JSC::JSGlobalObject* globalObject, unsigned index, JSC::PropertySlot& slot)
{
    return getOwnPropertySlot(object, globalObject, JSC::Identifier::from(globalObject->vm(), index), slot);
}

void JSModuleMock::getOwnPropertyNames(JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyNameArrayBuilder& names, JSC::DontEnumPropertiesMode mode)
{
    if (JSObject* exports = uncheckedDowncast<JSModuleMock>(object)->exports.get())
        exports->methodTable()->getOwnPropertyNames(exports, globalObject, names, mode);
}

// As in Vitest, writing to a mocked module's namespace object changes the object the factory returned, which importers read.
bool JSModuleMock::put(JSCell* cell, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSValue value, JSC::PutPropertySlot& slot)
{
    JSObject* exports = uncheckedDowncast<JSModuleMock>(cell)->exports.get();
    if (!exports)
        return false;
    JSC::PutPropertySlot exportsSlot(exports, slot.isStrictMode());
    return exports->methodTable()->put(exports, globalObject, propertyName, value, exportsSlot);
}

bool JSModuleMock::putByIndex(JSCell* cell, JSC::JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow)
{
    JSObject* exports = uncheckedDowncast<JSModuleMock>(cell)->exports.get();
    return exports && exports->methodTable()->putByIndex(exports, globalObject, index, value, shouldThrow);
}

bool JSModuleMock::deleteProperty(JSCell* cell, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, JSC::DeletePropertySlot&)
{
    JSObject* exports = uncheckedDowncast<JSModuleMock>(cell)->exports.get();
    // Not the caller's slot: `exports` would mark it cacheable for this object's structure, which never changes.
    JSC::DeletePropertySlot exportsSlot;
    return !exports || exports->methodTable()->deleteProperty(exports, globalObject, propertyName, exportsSlot);
}

bool JSModuleMock::deletePropertyByIndex(JSCell* cell, JSC::JSGlobalObject* globalObject, unsigned index)
{
    JSObject* exports = uncheckedDowncast<JSModuleMock>(cell)->exports.get();
    return !exports || exports->methodTable()->deletePropertyByIndex(exports, globalObject, index);
}

bool JSModuleMock::defineOwnProperty(JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyName propertyName, const JSC::PropertyDescriptor& descriptor, bool shouldThrow)
{
    JSObject* exports = uncheckedDowncast<JSModuleMock>(object)->exports.get();
    return exports && exports->methodTable()->defineOwnProperty(exports, globalObject, propertyName, descriptor, shouldThrow);
}

__attribute__((minsize)) static void overrideLoadedModuleExports(Zig::GlobalObject* globalObject, JSModuleMock* mock, const LoadedModule& loaded)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* exports = mock->result.get();
    auto* commonJSExports = dynamicDowncast<Bun::JSCommonJSModule>(exports);
    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    JSModuleMock* registered = registeredModuleMock(globalObject, specifier);

#if ENABLE(AOT)
    // The loader resolves import() of a mocked built-in module itself, since the module has live exports.
    bool isBuiltin = isBuiltinModuleKey(specifier);
    bool isMockInLoader = isBuiltin && loaded.esmNamespace && loaded.esmNamespace->moduleRecord()->hasLiveExports();
    if (loaded.compiledModule && mock->wasInstalledOverFailedLoad && !JSC::AOT::requireRunsMocks(vm) && originalEvaluationError(globalObject, specifier))
        return;
    if (loaded.compiledModule && (!loaded.esmNamespace || isMockInLoader) && JSC::AOT::hasMockSlot(globalObject, *loaded.compiledModule) && (mock->unevaluatedCompiledModule || mock->replacesRequiredDataFile || isBuiltin || JSC::AOT::hasActiveMock(globalObject, *loaded.compiledModule))) {
        JSValue answer = exports;
        if (commonJSExports) {
            answer = commonJSExports->exportsObject();
            RETURN_IF_EXCEPTION(scope, );
        } else {
            JSValue isESModule = exports->getIfPropertyExists(globalObject, vm.propertyNames->__esModule);
            RETURN_IF_EXCEPTION(scope, );
            if (isESModule && isESModule.toBoolean(globalObject) && mock->unevaluatedCompiledModule && !(isBuiltin && loaded.commonJSModule) && !JSC::AOT::wasRequiredUnderActiveMock(globalObject, *loaded.compiledModule)) {
                JSValue defaultValue = exports->getIfPropertyExists(globalObject, vm.propertyNames->defaultKeyword);
                RETURN_IF_EXCEPTION(scope, );
                if (defaultValue && !defaultValue.isUndefined())
                    answer = defaultValue;
            }
        }
        // The end of the mock restores what the require() has loaded.
        if (mock->replacesRequiredDataFile && !JSC::AOT::hasActiveMock(globalObject, *loaded.compiledModule)) {
            JSC::AOT::releaseEarlierImporters(globalObject, *loaded.compiledModule);
            RETURN_IF_EXCEPTION(scope, );
            JSC::AOT::willReplaceRequiredDataFile(globalObject, *loaded.compiledModule);
            RETURN_IF_EXCEPTION(scope, );
        }
        bool isInPlace = JSC::AOT::setMock(globalObject, *loaded.compiledModule, mock, answer, mock->keepsActiveMockForImporters.value_or(mock->isOfVitest()));
        RETURN_IF_EXCEPTION(scope, );
        if (isInPlace) {
            if (isMockInLoader)
                loaded.esmNamespace->moduleRecord()->setLiveExportsSource(vm, mock);
            if (auto* moduleObject = isBuiltin ? loaded.commonJSModule : nullptr) {
                JSValue cached = JSValue::decode(JSC__JSMap__get(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(mock->specifier.get())));
                RETURN_IF_EXCEPTION(scope, );
                if (cached == moduleObject) {
                    moduleObject->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), answer, 0);
                    moduleObject->hasEvaluated = true;
                }
            }
            return;
        }
    }
#endif

    auto* moduleNamespaceObject = loaded.esmNamespace;
    if (moduleNamespaceObject && moduleNamespaceObject->moduleRecord()->hasLiveExports()) {
        moduleNamespaceObject->moduleRecord()->setLiveExportsSource(vm, mock);
        moduleNamespaceObject = nullptr;
    }
    if (moduleNamespaceObject || loaded.compiledModule) {
        // Read every export before overriding any, so a throwing getter leaves the
        // namespace untouched.
        Vector<JSC::Identifier, 4> names;
        MarkedArgumentBuffer values;
        if (commonJSExports) {
            commonJSExports->toSyntheticSource(globalObject, JSC::Identifier(), names, values);
            RETURN_IF_EXCEPTION(scope, );
        } else {
            JSC::PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            // Via the method table so a module namespace object (`() => import("./mocked")`) lists its exports.
            exports->methodTable()->getOwnPropertyNames(exports, globalObject, properties, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, );
            for (auto& name : properties) {
                JSValue value = exports->get(globalObject, name);
                RETURN_IF_EXCEPTION(scope, );
                names.append(name);
                values.append(value);
            }
        }
        if (values.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return;
        }
        // A getter above may have re-mocked or unmocked the module, and that wins.
        if (!isStillRegisteredModuleMock(globalObject, specifier, registered))
            return;

        static std::atomic<unsigned> patches { 0 };
        if (JSObject* overwritten = moduleNamespaceObject ? mock->originalExports.get() : nullptr) {
            if (!mock->patchOrder)
                mock->patchOrder = ++patches;
            for (auto& name : names) {
                bool isSaved = overwritten->hasProperty(globalObject, name);
                RETURN_IF_EXCEPTION(scope, );
                if (isSaved)
                    continue;
                // Read the variable directly, because the namespace object would force a builtin's lazy export.
                ExportVariable variable = findExportVariable(globalObject, moduleNamespaceObject, name);
                RETURN_IF_EXCEPTION(scope, );
                if (!variable.record)
                    continue;
                JSValue original = variable.record->moduleEnvironment()->readVariable(vm, variable.offset);
                overwritten->putDirectMayBeIndex(globalObject, name, original ? original : JSValue(overwritten));
                RETURN_IF_EXCEPTION(scope, );
            }
        }

        if (moduleNamespaceObject && mock->originalExports && !mock->originalExportsOfEvictedModule)
            mock->patchedNamespace.set(vm, mock, moduleNamespaceObject);
#if ENABLE(AOT)
        // A getter above may have evicted it.
        bool mocksCompiledModule = loaded.compiledModule && !JSC::AOT::isEvicted(globalObject, *loaded.compiledModule);
        bool hasBegunToLay = false;
        auto endsLaying = makeScopeExit([&] {
            if (hasBegunToLay)
                JSC::AOT::didStopInstallingMock(globalObject, *loaded.compiledModule);
        });
        if (mocksCompiledModule) {
            // Two mocks may patch a variable that two modules export. The last patch is undone first, as above.
            if (!mock->patchOrder)
                mock->patchOrder = ++patches;
            JSValue requireReturnValue = exports;
            if (commonJSExports) {
                requireReturnValue = commonJSExports->exportsObject();
                RETURN_IF_EXCEPTION(scope, );
            }
            hasBegunToLay = true;
            JSValue ownFactory = mock->factory.get();
            JSC::AOT::willMockModule(globalObject, *loaded.compiledModule, requireReturnValue, !!commonJSExports, ownFactory && ownFactory.isCallable(), mock);
            RETURN_IF_EXCEPTION(scope, );
        }
#endif
        for (size_t i = 0; i < names.size(); ++i) {
            if (moduleNamespaceObject) {
                moduleNamespaceObject->overrideExportValue(globalObject, names[i], values.at(i));
                RETURN_IF_EXCEPTION(scope, );
            }
#if ENABLE(AOT)
            // Code outside the image has imported the loader's module, compiled code imports the image's: a module of native code may be loaded as both.
            if (mocksCompiledModule) {
                JSC::AOT::mockExport(globalObject, *loaded.compiledModule, names[i].impl(), values.at(i));
                RETURN_IF_EXCEPTION(scope, );
            }
#endif
        }
#if ENABLE(AOT)
        if (mocksCompiledModule) {
            JSC::AOT::didMockModule(globalObject, *loaded.compiledModule);
            RETURN_IF_EXCEPTION(scope, );
        }
#endif
    }

    if (auto* moduleObject = loaded.commonJSModule) {
        // A getter above may have evicted it, and a patch on an evicted module could never be undone.
        JSValue cached = JSValue::decode(JSC__JSMap__get(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(mock->specifier.get())));
        RETURN_IF_EXCEPTION(scope, );
        if (cached != moduleObject)
            return;
        JSValue moduleExports = exports;
        if (commonJSExports) {
            moduleExports = commonJSExports->exportsObject();
            RETURN_IF_EXCEPTION(scope, );
        }
        moduleObject->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), moduleExports, 0);
        moduleObject->hasEvaluated = true;
    }
}

using ModuleImporters = UncheckedKeyHashMap<String, Vector<String>>;

static void addImporter(ModuleImporters& importersOf, const String& importer, const String& imported)
{
    importersOf.ensure(imported, [] { return Vector<String>(); }).iterator->value.append(importer);
}

// After moveLoadedModule() a module's filename is not its key in the require cache.
using RequireKeys = UncheckedKeyHashMap<Bun::JSCommonJSModule*, String>;

// `importer` is null if the requirer's object has been collected. Then it isn't in the require cache, and `importerFilename` is its key.
static void addRequirer(Zig::GlobalObject* globalObject, ModuleImporters& importersOf, const RequireKeys& requireKeys, Bun::JSCommonJSModule* importer, JSValue importerFilename, JSValue importedValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* imported = importedValue ? dynamicDowncast<Bun::JSCommonJSModule>(importedValue) : nullptr;
    if (!imported)
        return;
    String importedKey = requireKeys.get(imported);
    bool isOfCompiledFile = imported->compiledModule != Bun::JSCommonJSModule::noCompiledModule || imported->compiledModuleLoadedInto != Bun::JSCommonJSModule::noCompiledModule;
    if (importedKey.isNull() && isOfCompiledFile && imported->filename().isString()) {
        importedKey = asString(imported->filename())->value(globalObject);
        RETURN_IF_EXCEPTION(scope, );
    }
    if (importedKey.isNull())
        return;
    if (auto importerKey = importer ? requireKeys.find(importer) : requireKeys.end(); importerKey != requireKeys.end()) {
        addImporter(importersOf, importerKey->value, importedKey);
        return;
    }
    if (!importerFilename || !importerFilename.isString())
        return;
    String importerKey = asString(importerFilename)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    addImporter(importersOf, importerKey, importedKey);
}

static bool isInNodeModules(const String& path)
{
    return path.contains(makeString(PLATFORM_SEP, "node_modules"_s, PLATFORM_SEP));
}

extern "C" bool Bun__isESModuleByExtensionOrPackageType(JSC::JSGlobalObject*, const BunString* path);

// Vitest externalizes packages: Node loads them, outside the module graph that Vitest mocks and resets.
// It inlines an ES module that Node would read as CommonJS (".js" in a package without "type": "module") and loads it like the project's modules.
static bool isExternalizedByVitest(Zig::GlobalObject* globalObject, const String& key)
{
    if (!isInNodeModules(key))
        return false;
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(globalObject->vm(), key));
    if (!entry || !dynamicDowncast<JSC::JSModuleRecord>(entry->record()))
        return true;
    size_t query = key.find('?');
    String path = query == notFound ? key : key.left(query);
    BunString borrowedPath = Bun::toString(path);
    return Bun__isESModuleByExtensionOrPackageType(globalObject, &borrowedPath);
}

struct ModulesToEvict {
    Vector<String> modules;
    // Patched in place: these stay registered, but their exports changed, so their importers go.
    Vector<String> patchedESModules;
    Vector<String> patchedCommonJSModules;
    // Mocked modules whose factory was abandoned, so their pending fetch never settles.
    Vector<String> abandonedModules;
    bool all { false };
    // With `all`: not what Vitest externalizes.
    bool exceptPackages { false };
    // Packages that vi.mock() no longer mocks. See stashLoadedModule().
    Vector<String> packagesToRestore;
    // Packages that vi.mock() is about to mock.
    Vector<String> packagesToStash;
    bool onlyImportersFromEarlierTestFiles { false };
    // Forces a pass even with nothing listed, to sweep the modules that failed to load or threw.
    bool isEndOfTestFile { false };
    bool hasLoadSettled { false };
    // The same for a mock of an evaluated compiled file, whose exports are in the program.
    bool endsEvaluatedFileMock { false };
#if ENABLE(AOT)
    // `bun test` makes no such pass: failed modules stay.
    bool keepsFailuresOfCompiledProgram { false };
    // The later mock sets the restored packages aside again.
    bool isReplacedByLaterMock { false };
#endif
};

static JSC::JSPromise* pendingLoadOf(JSC::JSGlobalObject* globalObject, JSC::ModuleRegistryEntry* entry)
{
    JSC::JSPromise* promise = entry->loadPromise();
    if (!promise && entry->status() == JSC::ModuleRegistryEntry::Status::Fetching)
        promise = entry->ensureModulePromise(globalObject);
    return promise && promise->status() == JSC::JSPromise::Status::Pending ? promise : nullptr;
}

#if ENABLE(AOT)
// Whether a pending load is fetching the module, or has requested or linked it.
static bool isGivenToPendingLoad(Zig::GlobalObject* globalObject, const String& key)
{
    auto* loader = Bun::testFileModuleLoader(globalObject);
    auto* entry = loader->registryEntry(JSC::Identifier::fromString(globalObject->vm(), key));
    if (!entry)
        return false;
    if (pendingLoadOf(globalObject, entry))
        return true;
    Vector<JSC::AbstractModuleRecord*, 8> work;
    for (auto& [mapKey, other] : loader->moduleMap()) {
        if (other->record() && pendingLoadOf(globalObject, other.get()))
            work.append(other->record());
    }
    UncheckedKeyHashSet<JSC::AbstractModuleRecord*> seen;
    while (!work.isEmpty()) {
        auto* record = work.takeLast();
        if (!seen.add(record).isNewEntry)
            continue;
        for (auto& resolved : record->resolvedRequests().values()) {
            if (String { resolved.get() } == key)
                return true;
        }
        for (auto& loaded : record->loadedModules().values()) {
            auto* imported = loaded.m_module.get();
            if (imported == entry->record())
                return true;
            auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(imported);
            if (cyclic && cyclic->status() == JSC::CyclicModuleRecord::Status::New)
                work.append(imported);
        }
    }
    return false;
}
#endif

// JSC parks the error of a failed import() in a new entry that nothing fetches, so a module that imports it would wait forever.
static bool isNeverFetched(JSC::ModuleRegistryEntry* entry)
{
    return !entry->record() && entry->status() > JSC::ModuleRegistryEntry::Status::FetchFailed;
}

JSC_DECLARE_HOST_FUNCTION(jsFunctionEvictModulesThatHaveLoaded);

// Preload modules are never reloaded and stay linked to this record, so point its live exports back at the preload's mock.
static void giveLoadedModuleBackToPreloadModuleMock(Zig::GlobalObject* globalObject, const String& key)
{
    auto& plugins = globalObject->onLoadPlugins;
    if (plugins.displacedPreloadModuleMocks.isEmpty() || plugins.testFileOfModule.get(key))
        return;
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(globalObject->vm(), key));
    auto* record = entry ? entry->record() : nullptr;
    if (!record || !record->hasLiveExports())
        return;
    for (auto& displaced : plugins.displacedPreloadModuleMocks) {
        auto* mock = uncheckedDowncast<JSModuleMock>(displaced.get());
        if (mock->state == JSModuleMock::State::Settled && mock->specifier->tryGetValue().data == key)
            record->setLiveExportsSource(globalObject->vm(), mock);
    }
}

extern "C" bool JSMock__isInPreload(Zig::GlobalObject*);

__attribute__((minsize)) static void moveLoadedModule(Zig::GlobalObject* globalObject, const String& from, const String& to)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* loader = Bun::testFileModuleLoader(globalObject);
    JSC::JSMap* requireMap = Bun::testFileRequireMap(globalObject);

    auto fromKey = JSC::Identifier::fromString(vm, from);
    auto* entry = loader->getRegisteredMayBeNull(fromKey, JSC::ScriptFetchParameters::Type::JavaScript);
    if (entry && entry->record() && entry->status() < JSC::ModuleRegistryEntry::Status::FetchFailed && !pendingLoadOf(globalObject, entry)) {
        auto* record = entry->record();
        loader->removeEntry(fromKey);
        auto* moved = loader->ensureRegistered(globalObject, JSC::Identifier::fromString(vm, to), JSC::ScriptFetchParameters::Type::JavaScript);
        RETURN_IF_EXCEPTION(scope, );
        if (!moved->record()) {
            moved->provideModule(vm, record);
            moved->markLoaded();
        }
    }

    JSString* fromString = jsString(vm, from);
    JSValue commonJSModule = requireMap->get(globalObject, fromString);
    RETURN_IF_EXCEPTION(scope, );
    if (commonJSModule.isCell()) {
        requireMap->set(globalObject, jsString(vm, to), commonJSModule);
        RETURN_IF_EXCEPTION(scope, );
        JSC__JSMap__remove(requireMap, globalObject, JSValue::encode(fromString));
        RETURN_IF_EXCEPTION(scope, );
    }
}

// As in Vitest, a real package is one instance however often it's mocked and unmocked, and so is what vi.importActual() returned.
// While vi.mock() mocks it, the loaded instance is registered under the key that vi.importActual() and the modules in node_modules import.
static void stashLoadedModule(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String original = originalModuleKey(specifier);
    // An earlier mock of the module may have left the instance it loaded there.
    if (Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, original))) {
        evictModulesAndTheirImporters(globalObject, Vector<String> { original });
        RETURN_IF_EXCEPTION(scope, );
    }
    RELEASE_AND_RETURN(scope, moveLoadedModule(globalObject, specifier, original));
}

// Importers stay linked to the record they imported, so they're evicted too, except preload modules, which nothing would load again.
// The loader looks up the entries of a loading module's imports more than once and expects the same ones, so an entry that is
// loading, or that a loading module has requested, stays until that load settles (modulesToEvictOnceLoaded).
#if ENABLE(AOT)
// `bun test` has the failure under the key of the module, and evicts it with the failed modules. The next load evaluates a CommonJS file again.
static void evictRetainedFailures(Zig::GlobalObject* globalObject)
{
    auto& plugins = globalObject->onLoadPlugins;
    for (auto& factory : plugins.compiledMockFactories.span().subspan(plugins.stashedFactoryCount)) {
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        bool retainedFailure = mock->retainsFailureForImports;
        mock->clearRetainedFailure();
        auto file = retainedFailure ? Bun::compiledModuleForPath(mock->specifier->tryGetValue().data) : std::nullopt;
        if (file && !JSC::AOT::isESModule(*file))
            JSC::AOT::releaseCommonJSFile(globalObject, *file);
    }
}

static void clearCompiledProgramFailures(Zig::GlobalObject* globalObject, std::optional<JSC::AOT::ModuleID> patched)
{
    evictRetainedFailures(globalObject);
    JSC::AOT::clearMockLoadErrors(globalObject);
    JSC::AOT::evictFailedModules(globalObject, patched);
}
#endif

#if ENABLE(AOT)
// jest.requireActual() makes a mocked CommonJS file the requirer of its original, and a factory that takes the original makes it an importer.
static bool dependsOnOwnOriginal(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (mock->originalNamespace)
        return true;
    String specifier = mock->specifier->tryGetValue().data;
    JSValue entry = JSValue::decode(JSC__JSMap__get(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(jsString(vm, originalModuleKey(specifier)))));
    RETURN_IF_EXCEPTION(scope, false);
    auto* original = entry ? dynamicDowncast<Bun::JSCommonJSModule>(entry) : nullptr;
    JSValue requirer = original ? original->parentFilename() : JSValue();
    return requirer && requirer.isString() && asString(requirer)->tryGetValue().data == specifier;
}

// The original of a mocked CommonJS file has required what is evicted. Returns whether the mock is evicted too.
bool evictOriginalOfCommonJSFile(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::SuspendExceptionScope suspendedException(vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto& plugins = globalObject->onLoadPlugins;
    auto* loader = Bun::testFileModuleLoader(globalObject);
    String key = originalModuleKey(specifier);
    auto* mock = registeredModuleMock(globalObject, specifier);
    bool evictsMock = mock && dependsOnOwnOriginal(globalObject, mock);
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
    auto identifier = JSC::Identifier::fromString(vm, key);
    if (auto* entry = loader->registryEntry(identifier); entry && pendingLoadOf(globalObject, entry))
        plugins.modulesToEvictOnceLoaded.add(key);
    else {
        loader->removeEntry(identifier);
        plugins.ranksAreStale = true;
        plugins.loadedByImportActual.remove(key);
        JSC__JSMap__remove(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(jsString(vm, key)));
        if (evictsMock)
            mock->originalNamespace.clear();
    }
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
    return evictsMock;
}
#endif

__attribute__((minsize)) static void evictModulesAndTheirImporters(Zig::GlobalObject* globalObject, ModulesToEvict&& evict)
{
    auto& plugins = globalObject->onLoadPlugins;
    Vector<String>& keys = evict.modules;
    keys.removeAllMatching([&](const String& key) { return plugins.modulesToEvictOnceLoaded.contains(key); });
    if (keys.isEmpty() && evict.patchedESModules.isEmpty() && evict.patchedCommonJSModules.isEmpty() && evict.abandonedModules.isEmpty() && evict.packagesToRestore.isEmpty() && !evict.all && !evict.isEndOfTestFile && !evict.hasLoadSettled && !evict.endsEvaluatedFileMock)
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* loader = Bun::testFileModuleLoader(globalObject);
    JSC::JSMap* requireMap = Bun::testFileRequireMap(globalObject);
#if ENABLE(AOT)

    if (vm.hasCompiledCode() && !evict.keepsFailuresOfCompiledProgram) {
        clearCompiledProgramFailures(globalObject);
        RETURN_IF_EXCEPTION(scope, );
    }
    if (vm.hasCompiledCode())
        keys.appendVector(JSC::AOT::takeModulesReleasedSincePass(globalObject));
#endif

    auto& waitedFor = plugins.modulesToEvictOnceLoaded;
    for (auto& key : waitedFor)
        keys.append(key);
    UncheckedKeyHashSet<String> staysInRegistry, staysInRequireCache;
    for (auto& key : evict.patchedESModules) {
        staysInRegistry.add(key);
        keys.append(key);
    }
    for (auto& key : evict.patchedCommonJSModules) {
        staysInRequireCache.add(key);
        keys.append(key);
    }

    ModuleImporters importersOf;
    UncheckedKeyHashMap<String, JSC::JSPromise*> loading;
    MarkedArgumentBuffer pendingLoads;
    Vector<std::pair<JSC::AbstractModuleRecord*, JSC::JSPromise*>> asking;
    UncheckedKeyHashSet<JSC::AbstractModuleRecord*> asks;
    // After moveLoadedModule() a record's own key is not the one it is registered under.
    UncheckedKeyHashMap<JSC::AbstractModuleRecord*, String> registeredKeys;
    for (auto& [mapKey, entry] : loader->moduleMap()) {
        if (auto* record = entry->record())
            registeredKeys.add(record, String(mapKey.first));
    }
    for (auto& [mapKey, entry] : loader->moduleMap()) {
        String key(mapKey.first);
        auto* record = entry->record();
        if (JSC::JSPromise* pendingLoad = pendingLoadOf(globalObject, entry.get())) {
            loading.set(key, pendingLoad);
            pendingLoads.append(pendingLoad);
            if (record && asks.add(record).isNewEntry)
                asking.append({ record, pendingLoad });
        }
        if (isNeverFetched(entry.get()))
            evict.abandonedModules.append(key);
        // It may have failed because of a mock, and JSC forgets a failed module's requests, so it's never found as an importer.
        auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record);
        bool isEvictedWithAll = evict.all && !(evict.exceptPackages && isExternalizedByVitest(globalObject, key));
        if (isEvictedWithAll || entry->status() >= JSC::ModuleRegistryEntry::Status::FetchFailed || (cyclic && cyclic->evaluationError()))
            keys.append(key);
        if (!record || evict.all)
            continue;
        if (String mocked = specifierOfUnwaitedModuleMockKey(key); !mocked.isNull())
            addImporter(importersOf, key, mocked);
        for (auto& resolved : record->resolvedRequests().values())
            addImporter(importersOf, key, String { resolved.get() });
        for (auto& loaded : record->loadedModules().values()) {
            auto* imported = loaded.m_module.get();
#if ENABLE(AOT)
            if (vm.hasCompiledCode() && !registeredKeys.contains(imported) && JSC::AOT::isCompiledModuleRecord(imported))
                addImporter(importersOf, key, imported->moduleKey().string());
#endif
            if (auto registered = registeredKeys.find(imported); registered != registeredKeys.end())
                addImporter(importersOf, key, registered->value);
            else if (evict.isEndOfTestFile && imported->hasLiveExports() && plugins.testFileOfModule.get(key))
                keys.append(key); // Linked to a mock's record that is no longer registered, e.g. after `delete require.cache[mocked]`.
        }
    }

    // A pending load also pins what it has requested: the module's imports, and transitively those of imports still at Status::New.
    for (size_t i = 0; i < asking.size(); ++i) {
        auto [record, pendingLoad] = asking[i];
        for (auto& resolved : record->resolvedRequests().values())
            loading.add(String { resolved.get() }, pendingLoad);
        for (auto& loaded : record->loadedModules().values()) {
            auto* imported = dynamicDowncast<JSC::CyclicModuleRecord>(loaded.m_module.get());
            if (imported && imported->status() == JSC::CyclicModuleRecord::Status::New && asks.add(imported).isNewEntry)
                asking.append({ imported, pendingLoad });
        }
    }

    JSValue requireKey, value;
    RequireKeys requireKeys;
    if (!evict.all) {
        auto* entries = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), requireMap, JSC::IterationKind::Entries);
        RETURN_IF_EXCEPTION(scope, );
        while (entries->nextKeyValue(globalObject, requireKey, value)) {
            auto* commonJSModule = dynamicDowncast<Bun::JSCommonJSModule>(value);
            if (!commonJSModule || !requireKey.isString())
                continue;
            requireKeys.add(commonJSModule, asString(requireKey)->value(globalObject));
            RETURN_IF_EXCEPTION(scope, );
        }
    }
    auto* iterator = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), requireMap, JSC::IterationKind::Entries);
    RETURN_IF_EXCEPTION(scope, );
    while (iterator->nextKeyValue(globalObject, requireKey, value)) {
        if (evict.all) {
            if (!requireKey.isString())
                continue;
            String path = asString(requireKey)->value(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            // A native addon can only be loaded once per process.
            size_t query = path.find('?');
            if (!(query == notFound ? StringView(path) : StringView(path).left(query)).endsWith(".node"_s) && !(evict.exceptPackages && isInNodeModules(path)))
                keys.append(path);
            continue;
        }
        auto* commonJSModule = dynamicDowncast<Bun::JSCommonJSModule>(value);
        if (!commonJSModule)
            continue;
        // The wrapper of a require()d ES module isn't in its requirer's m_children, so only its parent links the two.
        addRequirer(globalObject, importersOf, requireKeys, commonJSModule->m_parent.get(), commonJSModule->parentFilename(), commonJSModule);
        RETURN_IF_EXCEPTION(scope, );
        for (auto& child : commonJSModule->m_children) {
            addRequirer(globalObject, importersOf, requireKeys, commonJSModule, commonJSModule->filename(), child.get());
            RETURN_IF_EXCEPTION(scope, );
        }
        if (auto* children = commonJSModule->m_childrenValue ? dynamicDowncast<JSC::JSArray>(commonJSModule->m_childrenValue.get()) : nullptr) {
            for (unsigned i = 0; i < children->length(); ++i) {
                // canGetIndexQuickly() skips accessors, so no script runs here.
                addRequirer(globalObject, importersOf, requireKeys, commonJSModule, commonJSModule->filename(), children->canGetIndexQuickly(i) ? children->getIndexQuickly(i) : JSValue());
                RETURN_IF_EXCEPTION(scope, );
            }
        }
    }

    // A load stuck behind an abandoned fetch never finishes, so the entries waiting on it don't have to stay.
    Vector<String> neverLoads;
    for (auto& key : evict.abandonedModules) {
        auto* entry = loader->registryEntry(JSC::Identifier::fromString(vm, key));
        if (entry && !entry->record() && loading.remove(key)) {
            neverLoads.append(key);
            keys.append(key);
        }
    }
    for (size_t i = 0; i < neverLoads.size(); ++i) {
        auto importers = importersOf.find(neverLoads[i]);
        if (importers == importersOf.end())
            continue;
        for (auto& importer : importers->value) {
            if (loading.remove(importer))
                neverLoads.append(importer);
        }
    }

    // A patched-in-place module that imports an evicted one goes after all, and is walked again for the rest of its importers.
    UncheckedKeyHashSet<String> evicted;
    keys.removeAllMatching([&](const String& key) { return !evicted.add(key).isNewEntry; });
    for (size_t i = 0; i < keys.size(); ++i) {
        String key = keys[i];
        bool stays = staysInRegistry.contains(key) || staysInRequireCache.contains(key);
#if ENABLE(AOT)
        // Compiled importers are not registered.
        auto* entry = vm.hasCompiledCode() && !evict.all && !loading.contains(key) ? loader->registryEntry(JSC::Identifier::fromString(vm, key)) : nullptr;
        if (entry && entry->record() && entry->record()->hasLiveExports() && JSC::AOT::releaseAbsentModuleImporters(globalObject, key, stays && evict.onlyImportersFromEarlierTestFiles)) {
            for (String& released : JSC::AOT::takeModulesReleasedSincePass(globalObject)) {
                if (evicted.add(released).isNewEntry)
                    keys.append(WTF::move(released));
            }
        }
#endif
        auto importers = importersOf.find(key);
        if (importers == importersOf.end())
            continue;
        for (auto& importer : importers->value) {
            unsigned testFile = plugins.testFileOfModule.get(importer);
            // It imports the real package whether or not vi.mock() mocks it.
            if (isExternalizedByVitest(globalObject, importer) && (evict.packagesToRestore.contains(key) || evict.packagesToStash.contains(key)))
                continue;
            if (!testFile || importer == key || (stays && evict.onlyImportersFromEarlierTestFiles && testFile == plugins.testFile))
                continue;
            bool stayed = staysInRegistry.remove(importer);
            stayed |= staysInRequireCache.remove(importer);
            if (evicted.add(importer).isNewEntry || stayed)
                keys.append(importer);
        }
    }

    bool isTestFileRunning = Bun::isBunTest && !JSMock__isInPreload(globalObject);
    auto keepPreloadModule = [&](const String& key, JSC::ModuleRegistryEntry* entry) {
        if (!isTestFileRunning || !entry || !entry->record() || entry->status() >= JSC::ModuleRegistryEntry::Status::FetchFailed || plugins.testFileOfModule.get(key))
            return;
#if ENABLE(AOT)
        // The loader gets the record of a compiled module without a fetch.
        if (auto module = vm.hasCompiledCode() ? JSC::AOT::compiledModuleForRecord(globalObject, entry->record()) : std::nullopt; module && JSC::AOT::isCompiledModuleRecord(entry->record()) && !JSC::AOT::wasLoadedInPreload(globalObject, *module))
            return;
#endif
        plugins.evictedPreloadModules.add(key, JSC::Strong<JSC::JSCell> { vm, entry->record() });
    };
    bool clearsRegistry = evict.all && !evict.exceptPackages && loading.isEmpty();
    if (clearsRegistry) {
        for (auto& displaced : plugins.displacedPreloadModuleMocks)
            giveLoadedModuleBackToPreloadModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(displaced.get())->specifier->tryGetValue().data);
        for (auto& [mapKey, entry] : loader->moduleMap()) {
            if (mapKey.second == JSC::ScriptFetchParameters::Type::JavaScript)
                keepPreloadModule(String(mapKey.first), entry.get());
        }
        loader->clearAll();
    }
#if ENABLE(AOT)
    // The compiled modules that required the originals that leave.
    Vector<JSC::AOT::ModuleID, 1> requirersOfOriginals;
    Vector<JSC::AOT::ModuleID, 1> mocksOfOriginals;
    for (auto& key : keys) {
        if (!vm.hasCompiledCode() || !key.endsWith("?actual"_s) || staysInRegistry.contains(key) || loading.contains(key))
            continue;
        String path = key.left(key.length() - "?actual"_s.length());
        auto file = Bun::compiledModuleForPath(path);
        if (!file)
            continue;
        if (auto* mock = !JSC::AOT::isDataFile(*file) && JSC::AOT::hasActiveMock(globalObject, *file) ? registeredModuleMock(globalObject, path) : nullptr) {
            bool evictsMock = dependsOnOwnOriginal(globalObject, mock);
            RETURN_IF_EXCEPTION(scope, );
            evictsMock |= JSC::AOT::takeRequirerOfOwnOriginal(globalObject, *file);
            if (evictsMock) {
                mock->originalNamespace.clear();
                mocksOfOriginals.append(*file);
                continue;
            }
        }
        if (!JSC::AOT::hasInstances(globalObject, *file))
            continue;
        bool isRequirer = isRequirerOfOwnOriginal(globalObject, path);
        RETURN_IF_EXCEPTION(scope, );
        if (isRequirer)
            requirersOfOriginals.append(*file);
    }
#endif
    UncheckedKeyHashSet<JSC::JSPromise*> awaited;
    WTF::ListHashSet<String> stay;
    for (auto& key : keys) {
        if (JSC::JSPromise* pendingLoad = loading.get(key)) {
            stay.add(key);
            awaited.add(pendingLoad);
            continue;
        }
        bool leavesRegistry = !staysInRegistry.contains(key), leavesRequireCache = !staysInRequireCache.contains(key);
        if (leavesRegistry && !clearsRegistry) {
            auto identifier = JSC::Identifier::fromString(vm, key);
            ASSERT(!loader->registryEntry(identifier) || neverLoads.contains(key) || !pendingLoadOf(globalObject, loader->registryEntry(identifier)));
            giveLoadedModuleBackToPreloadModuleMock(globalObject, key);
            keepPreloadModule(key, loader->getRegisteredMayBeNull(identifier, JSC::ScriptFetchParameters::Type::JavaScript));
            loader->removeEntry(identifier);
            plugins.ranksAreStale = true;
        }
        if (leavesRegistry) {
            plugins.moduleMocksBeingLoaded.remove(key);
            plugins.loadedByImportActual.remove(key);
        }
        if (leavesRequireCache) {
            JSString* keyString = jsString(vm, key);
            // Only keep real CommonJS modules. require()'s wrapper for an ES module or a mock gets rebuilt, and may wrap the test file's own mock.
            auto* esModule = plugins.evictedPreloadModules.get(key).get();
            if (!esModule) {
                if (auto* entry = loader->registryEntry(JSC::Identifier::fromString(vm, key)))
                    esModule = entry->record();
            }
            auto* record = esModule ? uncheckedDowncast<JSC::AbstractModuleRecord>(esModule) : nullptr;
            bool isCommonJSModule = !record || (!record->hasLiveExports() && !record->inherits<JSC::CyclicModuleRecord>());
            if (isTestFileRunning && isCommonJSModule && !plugins.testFileOfModule.get(key)) {
                JSValue commonJSModule = requireMap->get(globalObject, keyString);
                RETURN_IF_EXCEPTION(scope, );
                if (commonJSModule.isCell())
                    plugins.evictedPreloadCommonJSModules.add(key, JSC::Strong<JSC::JSCell> { vm, commonJSModule.asCell() });
                // Undo the patch now, because unmockModule() can't find the module once it's evicted.
                auto* mock = registeredModuleMock(globalObject, key);
                if (auto* patched = mock && mock->originalCommonJSExports ? dynamicDowncast<Bun::JSCommonJSModule>(commonJSModule) : nullptr)
                    patched->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), mock->originalCommonJSExports.get(), 0);
            }
            JSC__JSMap__remove(requireMap, globalObject, JSValue::encode(keyString));
            RETURN_IF_EXCEPTION(scope, );
        }
        if (auto* mock = registeredModuleMock(globalObject, key)) {
            if (leavesRegistry) {
                if (mock->patchedNamespace && !mock->originalExportsOfEvictedModule)
                    mock->originalExportsOfEvictedModule.setMayBeNull(vm, mock, mock->originalExports.get());
                mock->originalExports.clear();
                mock->originalNamespace.clear();
            }
            if (leavesRequireCache)
                mock->originalCommonJSExports.clear();
        }
    }
    for (auto& package : evict.packagesToRestore) {
        if (stay.contains(package))
            continue;
        moveLoadedModule(globalObject, originalModuleKey(package), package);
        RETURN_IF_EXCEPTION(scope, );
#if ENABLE(AOT)
        auto packageKey = JSC::Identifier::fromString(vm, package);
        auto* entry = vm.hasCompiledCode() && !evict.isReplacedByLaterMock ? loader->registryEntry(packageKey) : nullptr;
        if (entry && entry->record() && entry->record()->isCompiledOriginal() && JSC::AOT::tryRestoreCompiledOriginal(globalObject, entry->record()))
            loader->removeEntry(packageKey);
        if (auto file = vm.hasCompiledCode() && !evict.isReplacedByLaterMock ? Bun::compiledModuleForPath(package) : std::nullopt)
            JSC::AOT::restoreOriginalLeftByEarlierMock(globalObject, *file);
#endif
    }
#if ENABLE(AOT)
    for (JSC::AOT::ModuleID file : requirersOfOriginals)
        JSC::AOT::releaseModuleAndImporters(globalObject, file, std::nullopt);
    for (JSC::AOT::ModuleID file : mocksOfOriginals)
        JSC::AOT::releaseMockImporters(globalObject, file);
#endif
    plugins.modulesToEvictOnceLoaded = WTF::move(stay);

    // This function runs again each time one of these loads settles. A second reaction on the ones still pending would double the runs per load.
    auto alreadyAwaited = std::exchange(plugins.loadsOfModulesToEvict, {});
    JSC::JSFunction* didSettle = nullptr;
    for (auto* pendingLoad : awaited) {
        plugins.loadsOfModulesToEvict.add(pendingLoad, JSC::Weak<JSC::JSPromise> { pendingLoad });
        if (auto previous = alreadyAwaited.find(pendingLoad); previous != alreadyAwaited.end() && previous->value.get() == pendingLoad)
            continue;
        if (!didSettle)
            didSettle = JSC::JSFunction::create(vm, globalObject, 0, String(), jsFunctionEvictModulesThatHaveLoaded, ImplementationVisibility::Private);
        pendingLoad->performPromiseThenWithContext(vm, globalObject, didSettle, didSettle, jsUndefined(), jsUndefined());
    }
}

static void evictModulesAndTheirImporters(Zig::GlobalObject* globalObject, Vector<String>&& modules)
{
    evictModulesAndTheirImporters(globalObject, ModulesToEvict { WTF::move(modules) });
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionEvictModulesThatHaveLoaded, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(lexicalGlobalObject));
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    Bun::evictModulesThatHaveLoaded(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// The loader may fetch a module twice in one load and expects the same result, so a replaced mock whose factory ran keeps serving that load.
static void keepInFlightModuleMock(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, const LoadedModule& loaded)
{
    if (loaded.staleESMEntry && mock->state != JSModuleMock::State::NotCalled)
        globalObject->onLoadPlugins.moduleMocksBeingLoaded.add(specifier, JSC::Strong<JSC::JSObject> { globalObject->vm(), mock });
}

static void restoreOverwrittenExports(Zig::GlobalObject* globalObject, JSC::JSModuleNamespaceObject* moduleNamespace, JSObject* overwritten)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    overwritten->getOwnPropertyNames(overwritten, globalObject, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, );
    for (auto& name : names) {
        JSValue original = overwritten->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, );
        if (original != overwritten) {
            moduleNamespace->overrideExportValue(globalObject, name, original);
            RETURN_IF_EXCEPTION(scope, );
            continue;
        }
        // A variable can't go back to TDZ, because optimized code has dropped the check. A JS module will initialize its own,
        // so only a builtin's lazy export has to be forced here.
        ExportVariable variable = findExportVariable(globalObject, moduleNamespace, name);
        RETURN_IF_EXCEPTION(scope, );
        if (!variable.record || !variable.record->inherits<JSC::SyntheticModuleRecord>())
            continue;
        BunString builtinKey = Bun::toString(variable.record->moduleKey().string());
        JSValue builtin = Bun::resolveAndFetchBuiltinModule(globalObject, &builtinKey);
        RETURN_IF_EXCEPTION(scope, );
        if (!builtin || !builtin.isObject())
            continue;
        original = builtin.getObject()->get(globalObject, variable.localName);
        RETURN_IF_EXCEPTION(scope, );
        moduleNamespace->overrideExportValue(globalObject, name, original);
        RETURN_IF_EXCEPTION(scope, );
    }
}

#if ENABLE(AOT)
static bool isRegisteredModuleMock(Zig::GlobalObject*, JSModuleMock*, const String& specifier);
static bool patchesPreloadPackage(JSModuleMock* mock, const String& specifier)
{
    return mock->isFromPreload && !mock->isOfVitest() && !mock->unevaluatedCompiledModule && isInNodeModules(specifier);
}

static JSModuleMock* displacedPreloadMock(Zig::GlobalObject* globalObject, const String& specifier)
{
    // A preload hook may have installed a second mock, which was displaced too. The last one counts.
    auto& list = globalObject->onLoadPlugins.displacedPreloadModuleMocks;
    for (size_t index = list.size(); index--;) {
        if (auto* mock = uncheckedDowncast<JSModuleMock>(list[index].get()); mock->isDisplacedByTestMock && mock->specifier->tryGetValue().data == specifier)
            return mock;
    }
    for (auto& displaced : list) {
        if (auto* mock = uncheckedDowncast<JSModuleMock>(displaced.get()); mock->specifier->tryGetValue().data == specifier)
            return mock;
    }
    return nullptr;
}

// Mirrors packagesToRestore in unmockModule(), for the module of a preload mock.
static JSModuleMock* findPreloadMockToRestore(Zig::GlobalObject* globalObject, JSModuleMock* ended, const String& specifier)
{
    auto* mock = displacedPreloadMock(globalObject, specifier);
    if (!mock || !mock->isDisplacedByTestMock)
        return nullptr;
    if (ended->patchesPreloadMock)
        return mock;
    return mock->isUnderActualKey && (ended->didStashPreloadMock || (ended->isOfVitest() && isInNodeModules(specifier))) ? mock : nullptr;
}

template<typename Functor>
static void forEachPreloadMock(Zig::GlobalObject* globalObject, const Functor& functor)
{
    for (auto& displaced : globalObject->onLoadPlugins.displacedPreloadModuleMocks)
        functor(uncheckedDowncast<JSModuleMock>(displaced.get()));
    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules) {
        for (auto& value : virtualModules->values()) {
            if (auto* mock = dynamicDowncast<JSModuleMock>(value.get()); mock && mock->isFromPreload)
                functor(mock);
        }
    }
}
#endif

#if ENABLE(AOT)
// The mock of a preload file is the original of the mocks that displace it.
void noteOriginalUnderPreloadMock(Zig::GlobalObject* globalObject, const String& originalKey)
{
    String path = withoutOriginalModuleQuery(originalKey);
    bool displacesPreloadMock = false;
    auto* registered = registeredModuleMock(globalObject, path);
    forEachPreloadMock(globalObject, [&](JSModuleMock* mock) { displacesPreloadMock |= mock != registered && mock->specifier->tryGetValue().data == path; });
    if (displacesPreloadMock)
        Bun::recordRepeatedFileRun(globalObject, path, "a preload file mocks it too"_s);
}

// Mirrors packagesToRestore in unmockModule(), for a compiled file.
static bool restoresCompiledFile(JSC::JSGlobalObject* globalObject, const JSModuleMock* mock, const String& specifier)
{
    if (mock->didStashCompiledModule || mock->usesBodilessFileAsOriginal || mock->replacesRequiredDataFile)
        return true;
    if (!isOneInstanceWithItsOriginal(mock, specifier))
        return false;
    // What an earlier test file had linked is evicted when the mock is made, and the original is loaded beside the key.
    auto file = mock->isOverEarlierLinkedFile && !isInNodeModules(specifier) ? Bun::compiledModuleForPath(specifier) : std::nullopt;
    return !file || !JSC::AOT::hasInstances(globalObject, *file);
}

static bool isUnloadedVariant(Zig::GlobalObject* globalObject, const String& specifier, uint32_t module)
{
    return JSC::AOT::importAttributeVariants(globalObject, specifier).contains(JSC::AOT::ModuleID(module)) && !JSC::AOT::hasStartedLoading(globalObject, JSC::AOT::ModuleID(module));
}

static bool hasLoadedVariant(Zig::GlobalObject* globalObject, const String& specifier)
{
    return JSC::AOT::importAttributeVariants(globalObject, specifier).containsIf([&](JSC::AOT::ModuleID variant) {
        return JSC::AOT::hasStartedLoading(globalObject, variant) || JSC::AOT::hasActiveMock(globalObject, variant);
    });
}
#endif

#if ENABLE(AOT)
// The load made for a mock continues for a mock that replaces it and needs the same original.
static void transferOriginalLoad(JSC::VM& vm, JSModuleMock* mock, JSModuleMock* laterMock)
{
    if (laterMock && mock->earlyOriginalLoad && laterMock->spy == mock->spy && !(laterMock->factory && laterMock->factory.get().isString())) {
        laterMock->earlyOriginalLoad.set(vm, laterMock, mock->earlyOriginalLoad.get());
        laterMock->wouldBeInRegistry = mock->wouldBeInRegistry;
        noteMockOutsideRegistry(defaultGlobalObject(laterMock->globalObject()), laterMock->specifier->tryGetValue().data);
    }
    mock->earlyOriginalLoad.clear();
}
#endif

#if ENABLE(AOT)
static constexpr uint64_t endedMockCallBit = 1ull << 63;
#endif

__attribute__((minsize)) static void unmockModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, ModulesToEvict& evict, [[maybe_unused]] JSModuleMock* laterMock = nullptr)
{
#if ENABLE(AOT)
    globalObject->onLoadPlugins.compiledImportersLinkedBeforeMocks.removeAllMatching([&](const auto& linked) { return linked.mocked == specifier; });
    auto& givenOriginal = globalObject->onLoadPlugins.compiledModulesGivenOriginal;
    if (auto given = givenOriginal.find(specifier); given != givenOriginal.end()) {
        Vector<uint32_t, 2> modules = WTF::move(given->value);
        givenOriginal.remove(given);
        for (uint32_t module : modules)
            JSC::AOT::releaseModuleAndImporters(globalObject, JSC::AOT::ModuleID(module), std::nullopt);
    }
    JSC::JSPromise* askedFor = mock->originalRequestedByFactory.get();
    bool waitsForOriginal = !mock->factory || mock->spy || (askedFor && askedFor->status() == JSC::JSPromise::Status::Pending);
    mock->endedBeforeOriginal = !laterMock && mock->state == JSModuleMock::State::Running && waitsForOriginal && !mock->originalNamespace && !mock->originalExports;
    transferOriginalLoad(JSC::getVM(globalObject), mock, laterMock);
#endif
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

#if ENABLE(AOT)
    // The job that installs it is queued.
    if (auto file = !laterMock && mock->state == JSModuleMock::State::Settled && vm.hasCompiledCode() ? mock->unevaluatedCompiledModule : std::nullopt; file && isRegisteredModuleMock(globalObject, mock, specifier) && JSC::AOT::isMockAwaitedByRefusedRequire(globalObject, JSC::AOT::ModuleID(*file))) [[unlikely]] {
        LoadedModule awaited;
        awaited.compiledModule = JSC::AOT::ModuleID(*file);
        mock->wasInstalledAtEnd = true;
        overrideLoadedModuleExports(globalObject, mock, awaited);
        RETURN_IF_EXCEPTION(scope, );
    }
#endif
    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules)
        virtualModules->remove(specifier);
#if ENABLE(AOT)
    Vector<JSC::AOT::ModuleID, 1> pendingMockModules;
    globalObject->onLoadPlugins.pendingCompiledMocks.removeAllMatching([&](const auto& waiting) {
        if (waiting.second.get() != mock)
            return false;
        pendingMockModules.append(JSC::AOT::ModuleID(waiting.first));
        return true;
    });
    auto* displaced = laterMock && laterMock->isOfVitest() ? displacedPreloadMock(globalObject, specifier) : nullptr;
    bool restoresPreloadMock = findPreloadMockToRestore(globalObject, mock, specifier) || (displaced && displaced->isDisplacedByTestMock && displaced->isUnderActualKey);
    auto original = mock->wasInstalledOnPreloadMock || restoresPreloadMock || patchesPreloadPackage(mock, specifier) ? JSC::AOT::RetainedOriginalPolicy::Keep : JSC::AOT::RetainedOriginalPolicy::DiscardWithMock;
    // Mirrors packagesToRestore below: a patching mock that was installed over the stashing one restores nothing.
    bool restoresOriginal = restoresCompiledFile(globalObject, mock, specifier);
    for (JSC::AOT::ModuleID module : pendingMockModules) {
        JSC::AOT::didRemoveMock(globalObject, module, original, restoresPreloadMock, restoresOriginal);
        RETURN_IF_EXCEPTION(scope, );
    }
#endif

    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, );
    bool hadActiveCompiledMock = false;
#if ENABLE(AOT)
    hadActiveCompiledMock = loaded.compiledModule && JSC::AOT::hasActiveMock(globalObject, *loaded.compiledModule) && !JSC::AOT::wasActiveMockEntryRemoved(globalObject, *loaded.compiledModule);
    // A mock of a file with several variants is active over one of them.
    if (globalObject->vm().hasCompiledCode() && !loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule) {
        auto variants = JSC::AOT::importAttributeVariants(globalObject, specifier);
        if (auto file = Bun::findMockedModule(specifier); file && !variants.contains(*file))
            variants.append(*file);
        hadActiveCompiledMock = std::ranges::count_if(variants, [&](JSC::AOT::ModuleID variant) { return JSC::AOT::hasStartedLoading(globalObject, variant); }) > 1 && std::ranges::any_of(variants, [&](JSC::AOT::ModuleID variant) { return JSC::AOT::hasActiveMock(globalObject, variant) && !JSC::AOT::wasActiveMockEntryRemoved(globalObject, variant); });
    }
    // Import types matter only when a mock is installed, not when it ends.
    if (globalObject->vm().hasCompiledCode() && !loaded.esmNamespace) {
        findLoadedESModule(globalObject, mock->specifier.get(), loaded);
        RETURN_IF_EXCEPTION(scope, );
    }
    if (auto* restoredMock = mock->patchesPreloadMock ? findPreloadMockToRestore(globalObject, mock, specifier) : nullptr; restoredMock && loaded.esmNamespace && loaded.esmNamespace->moduleRecord()->liveExportsSource() == mock)
        loaded.esmNamespace->moduleRecord()->setLiveExportsSource(vm, restoredMock);
    // Also for a file that was evicted under the mock.
    auto compiledModule = globalObject->vm().hasCompiledCode() ? JSC::AOT::findVariantToMock(globalObject, specifier, Bun::findMockedModule(specifier)) : std::nullopt;
    // Its original was loaded behind the reset. It moves under the key of the file.
    if (auto reset = globalObject->onLoadPlugins.dataFilesResetUnderMocks.find(specifier); reset != globalObject->onLoadPlugins.dataFilesResetUnderMocks.end() && Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, originalModuleKey(specifier))))
        reset->value = 0;
    // After a mock ends, the file itself may be loaded, which ends the fetch that the factory blocked. A mock that replaces it keeps the fetch blocked.
    for (auto& each : globalObject->onLoadPlugins.latestCompiledFactoryCalls) {
        if (compiledModule && !laterMock && each.first == compiledModule->index()) {
            each.second |= endedMockCallBit;
            JSC::AOT::markFetchOrphaned(globalObject, *compiledModule);
        }
    }
    // In `bun test` a mock that patched an evaluated file goes through patchedCommonJSModules, whether or not its key is still registered.
    // One that stashed such a file goes through packagesToRestore, whether or not the mock was loaded.
    // Except for a file that the loader released: `bun test` finds nothing loaded there.
    evict.endsEvaluatedFileMock |= (mock->didStashCompiledModule && !(compiledModule && JSC::AOT::wasReleasedByLoader(globalObject, *compiledModule))) || (compiledModule && JSC::AOT::wasPatchedAfterEvaluation(globalObject, *compiledModule)) || (compiledModule && (JSC::AOT::wasLinkedByFailedGraph(globalObject, *compiledModule) || JSC::AOT::wasLinkedBeforeLinkFailure(globalObject, *compiledModule)));
    bool endsOverRestoredRun = compiledModule && !laterMock && (mock->patchesRestoredRun || (mock->isFromPreload && JSC::AOT::evaluatedBy(globalObject, *compiledModule) == JSC::AOT::LoadedBy::EarlierTestFile && !JSC::AOT::hasActiveMock(globalObject, *compiledModule) && !JSC::AOT::hasIntactOriginal(globalObject, *compiledModule) && !JSC::AOT::hasPendingMock(globalObject, *compiledModule) && !JSC::AOT::wasPatchedAfterEvaluation(globalObject, *compiledModule)));
    bool wasPatchedFile = compiledModule && (JSC::AOT::wasPatchedAfterEvaluation(globalObject, *compiledModule) || JSC::AOT::isPatchedLibraryModule(globalObject, *compiledModule));
    // The program deleted the file's key, and a require() made a module object for the mock: it gets the file's own exports back below.
    if (compiledModule && loaded.commonJSModule && !mock->wasInstalledOnPreloadMock && !mock->lostCommonJSExportsToReset && !mock->originalCommonJSExports && !JSC::AOT::isESModule(*compiledModule) && JSC::AOT::isEvicted(globalObject, *compiledModule)) {
        if (JSValue own = JSC::AOT::exportsBeforePatch(globalObject, *compiledModule))
            mock->originalCommonJSExports.set(vm, mock, own);
    }
    // `bun test` saves what a mock patches at the call, compiled code when the factory settles.
    bool waitedToPatch = compiledModule && (!laterMock || laterMock->isOfVitest()) && !restoresOriginal && !mock->foundNothingLoaded && mock->state != JSModuleMock::State::Settled && JSC::AOT::hasRequireCacheEntry(globalObject, *compiledModule) && !JSC::AOT::hasActiveMock(globalObject, *compiledModule) && !JSC::AOT::hasPendingMock(globalObject, *compiledModule) && !JSC::AOT::hasIntactOriginal(globalObject, *compiledModule) && !JSC::AOT::isPatchedByMock(globalObject, *compiledModule);
    if (compiledModule && !pendingMockModules.contains(*compiledModule)) {
        JSC::AOT::didRemoveMock(globalObject, *compiledModule, original, restoresPreloadMock, restoresOriginal);
        RETURN_IF_EXCEPTION(scope, );
    }
    if (waitedToPatch)
        JSC::AOT::releaseImporters(globalObject, *compiledModule);
    if (endsOverRestoredRun)
        JSC::AOT::releaseModuleAndImporters(globalObject, *compiledModule, std::nullopt);
    if (globalObject->vm().hasCompiledCode()) {
        for (JSC::AOT::ModuleID variant : JSC::AOT::importAttributeVariants(globalObject, specifier)) {
            if (compiledModule == variant)
                continue;
            JSC::AOT::didRemoveMock(globalObject, variant, original, restoresPreloadMock, restoresOriginal);
            RETURN_IF_EXCEPTION(scope, );
        }
        if (auto file = Bun::findMockedModule(specifier); file && file != compiledModule && !pendingMockModules.contains(*file)) {
            JSC::AOT::didRemoveMock(globalObject, *file, original, restoresPreloadMock, restoresOriginal);
            RETURN_IF_EXCEPTION(scope, );
        }
        // The key of the module is empty: its next load runs it again.
        if (compiledModule && !laterMock && mock->coversImportedActual && !restoresOriginal && mock->state != JSModuleMock::State::Running)
            JSC::AOT::releaseModule(globalObject, *compiledModule);
    }
#endif
    keepInFlightModuleMock(globalObject, mock, specifier, loaded);
    if (mock->didStashLoadedModule || (mock->isOfVitest() && isInNodeModules(specifier)))
        evict.packagesToRestore.append(specifier);
#if ENABLE(AOT)
    else if (mock->didStashCompiledModule && compiledModule && JSC::AOT::evaluatedBy(globalObject, *compiledModule) == JSC::AOT::LoadedBy::Nobody) {
        auto* original = loadedOriginalRecord(globalObject, specifier);
        if (original && original->isCompiledOriginal())
            evict.packagesToRestore.append(specifier);
    }
#endif

    JSObject* saved = mock->originalExportsOfEvictedModule ? mock->originalExportsOfEvictedModule.get() : mock->originalExports.get();
    if (auto* patched = mock->patchedNamespace.get(); patched && saved) {
        restoreOverwrittenExports(globalObject, patched, saved);
        RETURN_IF_EXCEPTION(scope, );
    }
    // A record with live exports was loaded as a mock, so it isn't the module that was patched.
    JSObject* overwritten = loaded.esmNamespace && loaded.esmNamespace->moduleRecord()->hasLiveExports() ? nullptr : mock->originalExports.get();

    if (JSValue original = mock->originalCommonJSExports.get()) {
        if (loaded.commonJSModule)
            loaded.commonJSModule->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), original, 0);
    }

    if (!overwritten && !mock->originalCommonJSExports) {
        if (loaded.esmNamespace || loaded.staleESMEntry || loaded.commonJSModule || hadActiveCompiledMock)
            evict.modules.append(specifier);
#if ENABLE(AOT)
        else if (wasPatchedFile) {
            evict.patchedESModules.append(specifier);
            evict.patchedCommonJSModules.append(specifier);
        }
#endif
        return;
    }
    if (overwritten)
        evict.patchedESModules.append(specifier);
    if (mock->originalCommonJSExports)
        evict.patchedCommonJSModules.append(specifier);
}

#if ENABLE(AOT)
static void scheduleDetachedLoadRetry(Zig::GlobalObject*, JSModuleMock*, JSC::AOT::ModuleID);
#endif

#if ENABLE(AOT)
// In `bun test` a key belongs to the test file that fetched it, and nothing has fetched this one.
static void noteRestoredOriginal(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier)
{
    if (!mock->foundNothingLoaded || mock->firstLoadTestFile || mock->wasRequested)
        return;
    if (auto file = Bun::compiledModuleForPath(specifier))
        JSC::AOT::setHasNoTestFile(globalObject, *file);
}
#endif

static void unmockModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, JSModuleMock* laterMock = nullptr, bool alsoEndsInPlainRun = true)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ModulesToEvict evict;
#if ENABLE(AOT)
    if (vm.hasCompiledCode())
        JSC::AOT::evictLoadedModules(globalObject);
    // Ending a mock that a require() loaded drops the entry that detached loads wait for.
    if (auto module = mock->wasLoadedByRequire ? Bun::compiledModuleForPath(specifier) : std::nullopt)
        scheduleDetachedLoadRetry(globalObject, mock, *module);
    // Mirrors packagesToRestore in the other unmockModule().
    bool restoresOriginal = restoresCompiledFile(globalObject, mock, specifier) || patchesPreloadPackage(mock, specifier);
    bool movesCompiledFile = vm.hasCompiledCode() && alsoEndsInPlainRun;
    bool leavesProgram = movesCompiledFile && Bun::willUnmockCompiledFile(globalObject, specifier, restoresOriginal, laterMock);
    if (movesCompiledFile && restoresOriginal)
        noteRestoredOriginal(globalObject, mock, specifier);
    bool factoryIsPending = mock->state == JSModuleMock::State::Running;
    if (vm.hasCompiledCode() && !mock->isFromPreload && !mock->wasInstalledOverFailedLoad && mock->wasRequested)
        dropFailedOriginal(globalObject, specifier);
    if (vm.hasCompiledCode() && !mock->isFromPreload && !mock->wasInstalledOverFailedLoad && (mock->wasRequested || (mock->moduleRequestedByLoad && mock->importsOriginal)))
        dropRecordlessFailedOriginal(globalObject, specifier);
#endif
#if ENABLE(AOT)
    if (auto module = vm.hasCompiledCode() && !laterMock ? Bun::findMockedModule(specifier) : std::nullopt)
        JSC::AOT::willEndMockOfBuiltin(globalObject, *module, JSC::AOT::MockEnd::Removed);
#endif
    unmockModule(globalObject, mock, specifier, evict, alsoEndsInPlainRun ? laterMock : nullptr);
    RETURN_IF_EXCEPTION(scope, );
#if ENABLE(AOT)
    // `bun test` makes no pass if a patching mock replaces a waiting one.
    evict.endsEvaluatedFileMock &= alsoEndsInPlainRun;
    if (!alsoEndsInPlainRun)
        evict.packagesToRestore.clear();
    evict.keepsFailuresOfCompiledProgram = !alsoEndsInPlainRun;
    evict.isReplacedByLaterMock = laterMock;
#endif
    evictModulesAndTheirImporters(globalObject, WTF::move(evict));
    RETURN_IF_EXCEPTION(scope, );
#if ENABLE(AOT)
    // A later Vitest mock stashes again what this end restored.
    if (movesCompiledFile && laterMock)
        laterMock->didStashCompiledModule = restoresOriginal && Bun::isCompiledOriginalRetained(globalObject, specifier);
    else if (movesCompiledFile) {
        Bun::didUnmockCompiledFile(globalObject, specifier, leavesProgram, restoresOriginal, factoryIsPending);
        RETURN_IF_EXCEPTION(scope, );
        if (auto file = patchesPreloadPackage(mock, specifier) ? Bun::compiledModuleForPath(specifier) : std::nullopt)
            JSC::AOT::clearRetainedOriginalExports(globalObject, *file);
    }
#else
    UNUSED_PARAM(laterMock);
    UNUSED_PARAM(alsoEndsInPlainRun);
#endif
}

static String callerPath(JSC::VM& vm, JSC::CallFrame* callframe)
{
#if ENABLE(AOT)
    if (vm.hasCompiledCode()) {
        if (const String& file = defaultGlobalObject(callframe->lexicalGlobalObject(vm))->onLoadPlugins.replayedMockCaller(callframe); !file.isNull())
            return file;
    }
#endif
    JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
    const URL& url = sourceOrigin.url();
    return !sourceOrigin.isNull() && url.isValid() && url.protocolIsFile() ? url.fileSystemPath() : String("."_s);
}

#if ENABLE(AOT)
static StringView withoutFileExtension(StringView path)
{
    size_t slash = path.reverseFind('/');
    size_t dot = path.reverseFind('.');
    bool hasExtension = dot != notFound && dot > (slash == notFound ? 0 : slash + 1);
    return hasExtension ? path.left(dot) : path;
}

static std::optional<JSC::AOT::ModuleAliasKind> findFileAlias(StringView name, StringView file)
{
    if (name == withoutFileExtension(file))
        return JSC::AOT::ModuleAliasKind::WithoutExtension;
    if (size_t slash = file.reverseFind('/'); slash != notFound && name == file.left(slash))
        return JSC::AOT::ModuleAliasKind::AsDirectory;
    if (withoutFileExtension(name) == withoutFileExtension(file))
        return JSC::AOT::ModuleAliasKind::WithOtherExtension;
    return std::nullopt;
}
#endif

// Returns true if importers can only reach the mock through resolveVirtualModule()'s relative lookup.
__attribute__((minsize)) static bool resolveModuleMockSpecifier(Zig::GlobalObject* globalObject, JSC::CallFrame* callframe, JSC::JSString*& specifierString, WTF::String& specifier, bool& exists)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
#if ENABLE(AOT)
    if (vm.hasCompiledCode()) {
        if (const String& file = globalObject->onLoadPlugins.replayedMockCaller(callframe); !file.isNull())
            sourceOrigin = JSC::SourceOrigin(URL::fileURLWithFileSystemPath(file));
    }
#endif
    if (sourceOrigin.isNull())
        return false;
    const URL& url = sourceOrigin.url();

    if (specifier.startsWith("file:"_s)) {
        URL fileURL = URL(url, specifier);
        String path = fileURL.isValid() ? fileURL.fileSystemPath() : String();
        if (path.isNull() || path.contains('\0')) {
            scope.throwException(globalObject, JSC::createTypeError(globalObject, "Invalid \"file:\" URL"_s));
            return false;
        }
        specifier = path;
        specifierString = jsString(vm, specifier);
#if ENABLE(AOT)
        // A compiled importer that uses this name is linked to the file, so it gets the mock.
        if (vm.hasCompiledCode() && url.isValid() && url.protocolIsFile() && !Bun::findMockedModule(specifier)) {
            auto importerPath = url.fileSystemPath();
            BunString importer = Bun::toString(importerPath);
            auto resolved = JSValue::decode(Bun__resolveSyncWithSourceIfExists(globalObject, JSValue::encode(specifierString), &importer, true));
            RETURN_IF_EXCEPTION(scope, false);
            if (resolved.isString() && asString(resolved)->length()) {
                String file = asString(resolved)->value(globalObject);
                RETURN_IF_EXCEPTION(scope, false);
                auto module = Bun::findMockedModule(file);
                auto name = findFileAlias(specifier, file);
                if (module && name && JSC::AOT::isImportedByAlias(*module, *name)) {
                    specifierString = asString(resolved);
                    specifier = file;
                    exists = true;
                    return false;
                }
            }
        }
#endif
        return true;
    }

    if (!url.isValid() || !url.protocolIsFile())
        return false;

    auto fromString = url.fileSystemPath();
    BunString from = Bun::toString(fromString);
    // Not resolving is fine (mocking a module that does not exist yet); anything else thrown
    // while resolving (e.g. by an onResolve plugin) propagates.
    auto result = JSValue::decode(Bun__resolveSyncWithSourceIfExists(globalObject, JSValue::encode(specifierString), &from, true));
    RETURN_IF_EXCEPTION(scope, false);

    if (result.isString()) {
        auto* specifierStr = asString(result);
        if (specifierStr->length() > 0) {
            specifierString = specifierStr;
            specifier = specifierString->value(globalObject);
            exists = true;
        }
        return false;
    }

    if (!specifier.startsWith("./"_s) && !specifier.startsWith(".."_s))
        return false;

    // If module resolution fails, we try to resolve it relative to the current file
    auto relativeURL = URL(url, specifier);
    if (!relativeURL.isValid())
        return false;
    specifier = relativeURL.protocolIsFile() ? relativeSpecifierToFileSystemPath(url, specifier) : relativeURL.string();
    specifierString = jsString(vm, specifier);
    return true;
}

struct ModuleMockSpecifier {
    JSC::JSString* keyString { nullptr };
    WTF::String key;
    WTF::String written;
};

static ModuleMockSpecifier moduleMockSpecifierArgument(Zig::GlobalObject* globalObject, JSC::CallFrame* callframe, ASCIILiteral signature)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

#if ENABLE(AOT)
    if (vm.hasCompiledCode()) {
        JSC::AOT::removeUnusedLingeringMocks(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
#endif
    JSValue argument = callframe->argument(0);
    if (!argument.isString() || !asString(argument)->length()) {
        JSC::throwTypeError(globalObject, scope, makeString(signature, " requires a module name string"_s));
        return {};
    }
    ModuleMockSpecifier specifier { asString(argument) };
    specifier.written = specifier.keyString->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (specifier.written.contains('\0')) {
        JSC::throwTypeError(globalObject, scope, makeString(signature, " requires a module name without null bytes"_s));
        return {};
    }
    specifier.key = specifier.written;
    bool exists = false;
    resolveModuleMockSpecifier(globalObject, callframe, specifier.keyString, specifier.key, exists);
    RETURN_IF_EXCEPTION(scope, {});
    return specifier;
}

extern "C" JSC::EncodedJSValue Bun__Process__getCwd(JSC::JSGlobalObject*);

__attribute__((minsize)) static JSC::JSString* findManualModuleMock(Zig::GlobalObject* globalObject, const String& from, const String& written, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String candidate;
    if (isAbsolutePath(specifier) && !isInNodeModules(specifier)) {
        size_t separator = specifier.reverseFind(PLATFORM_SEP);
        candidate = makeString(StringView(specifier).left(separator + 1), "__mocks__"_s, PLATFORM_SEP, StringView(specifier).substring(separator + 1));
    } else if (!written.startsWith('.') && !isAbsolutePath(written)) {
        JSValue cwd = JSValue::decode(Bun__Process__getCwd(globalObject));
        RETURN_IF_EXCEPTION(scope, nullptr);
        String cwdString = cwd.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        candidate = makeString(cwdString, PLATFORM_SEP, "__mocks__"_s, PLATFORM_SEP, written.startsWith("node:"_s) ? StringView(written).substring(5) : StringView(written));
    } else
        return nullptr;

    BunString fromString = Bun::toString(from);
    JSValue resolved = JSValue::decode(Bun__resolveSyncWithSourceIfExists(globalObject, JSValue::encode(jsString(vm, candidate)), &fromString, true));
    RETURN_IF_EXCEPTION(scope, nullptr);
    return resolved.isString() ? asString(resolved) : nullptr;
}

// `source` is the factory of the mock of `specifier`. importActual() of another module doesn't count.
static bool mentionsOriginalModule(Zig::GlobalObject* globalObject, JSC::CallFrame* callframe, StringView source, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (source.contains("importOriginal"_s))
        return true;
    for (auto name : { "importActual"_s, "requireActual"_s }) {
        for (size_t at = source.find(name); at != notFound; at = source.find(name, at + 1)) {
            size_t i = at + name.length();
            if (i + 2 >= source.length() || source[i] != '(' || source[i + 1] != '"')
                return true;
            size_t end = source.find('"', i + 2);
            if (end == notFound)
                return true;
            String other = source.substring(i + 2, end - i - 2).toString();
            if (Bun::isBuiltinModule(other))
                continue;
            JSC::JSString* otherString = jsString(vm, other);
            bool exists = false;
            resolveModuleMockSpecifier(globalObject, callframe, otherString, other, exists);
            RETURN_IF_EXCEPTION(scope, false);
            if (other == specifier)
                return true;
        }
    }
    return false;
}

#if ENABLE(AOT)
static void restoreStashedFactories(Zig::GlobalObject*, JSModuleMock*);

// In `bun test` vi.doUnmock() and the handle's dispose restore what vi.doMock() stashed, see stashLoadedModule(). Over a preload mock that is its module.
static void didEndMockOverPreload(Zig::GlobalObject* globalObject, JSModuleMock* ended, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& plugins = globalObject->onLoadPlugins;
    bool restoresOriginal = vm.hasCompiledCode() && findPreloadMockToRestore(globalObject, ended, specifier);
    if (!vm.hasCompiledCode() || (!ended->wasInstalledOnPreloadMock && !restoresOriginal))
        return;
    size_t index = plugins.displacedPreloadModuleMocks.reverseFindIf([&](const auto& displaced) {
        auto* each = uncheckedDowncast<JSModuleMock>(displaced.get());
        return each->isDisplacedByTestMock && each->specifier->tryGetValue().data == specifier;
    });
    if (index == notFound)
        return;
    auto* mock = uncheckedDowncast<JSModuleMock>(plugins.displacedPreloadModuleMocks[index].get());
    auto compiled = JSC::AOT::findVariantToMock(globalObject, specifier, Bun::findMockedModule(specifier));
    if (!compiled || mock->state != JSModuleMock::State::Settled)
        return;
    bool isEvictedFromProgram = JSC::AOT::isEvicted(globalObject, *compiled);
    if (!restoresOriginal) {
        // Evict a file of the program that the preload loaded, so that it is evaluated again.
        if (ended->isOfVitest() && !mock->unevaluatedCompiledModule && !isInNodeModules(specifier) && !isEvictedFromProgram && !JSC::AOT::rejectsReload(globalObject, *compiled))
            RELEASE_AND_RETURN(scope, Bun::didDeleteRequireCacheEntry(globalObject, specifier));
        return;
    }
    // What the program stored under the key cannot be patched. Evict it, so that the next load gets the mock.
    if (isEvictedFromProgram) {
        JSC__JSMap__remove(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(mock->specifier.get()));
        RETURN_IF_EXCEPTION(scope, );
    }
    // A later mock of the name stays listed: at the end of the test file it is added over this one.
    for (size_t each = index + 1; each--;) {
        if (uncheckedDowncast<JSModuleMock>(plugins.displacedPreloadModuleMocks[each].get())->specifier->tryGetValue().data == specifier)
            plugins.displacedPreloadModuleMocks.removeAt(each);
    }
    plugins.addModuleMock(vm, specifier, mock);
    mock->isDetached = false;
    mock->isDisplacedByTestMock = false;
    mock->wasRestoredByTestMock = true;
    mock->isUnderActualKey = false;
    restoreStashedFactories(globalObject, mock);
    LoadedModule inPlace;
    inPlace.compiledModule = mock->unevaluatedCompiledModule ? JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule) : *compiled;
    RELEASE_AND_RETURN(scope, overrideLoadedModuleExports(globalObject, mock, inPlace));
}
#endif

JSC_DEFINE_HOST_FUNCTION(jsFunctionDisposeModuleMock, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* mock = toModuleMock(globalObject, scope, callframe->thisValue());
    RETURN_IF_EXCEPTION(scope, {});
    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (registeredModuleMock(globalObject, specifier) == mock) {
        unmockModule(globalObject, mock, specifier);
        RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
        didEndMockOverPreload(globalObject, mock, specifier);
        RETURN_IF_EXCEPTION(scope, {});
#endif
    }
    return JSValue::encode(jsUndefined());
}

// Whether a module that Vitest doesn't externalize is linked to `record` and has yet to run. `running` is the one that asks.
__attribute__((minsize)) static bool hasUnevaluatedImporter(Zig::GlobalObject* globalObject, JSC::AbstractModuleRecord* record, const String& running)
{
    for (auto& [mapKey, entry] : Bun::testFileModuleLoader(globalObject)->moduleMap()) {
        auto* importer = dynamicDowncast<JSC::CyclicModuleRecord>(entry->record());
        if (!importer || importer->status() < JSC::CyclicModuleRecord::Status::Linked || importer->status() > JSC::CyclicModuleRecord::Status::Evaluating)
            continue;
        String key(mapKey.first);
        if (key == running || isExternalizedByVitest(globalObject, key))
            continue;
        for (auto& loaded : importer->loadedModules().values()) {
            if (loaded.m_module.get() == record)
                return true;
        }
    }
    return false;
}

// The body of the module that `mock` patched has run since, and has given a value to the exports that had none. Resolves once the factory has settled too.
JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionPatchedModuleDidRun, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* mock = toModuleMock(globalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (registeredModuleMock(globalObject, specifier) != mock)
        return JSValue::encode(jsUndefined());

    LoadedModule loaded;
    findLoadedESModule(globalObject, mock->specifier.get(), loaded);
    RETURN_IF_EXCEPTION(scope, {});
    if (JSObject* overwritten = loaded.esmNamespace ? mock->originalExports.get() : nullptr) {
        JSC::PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        overwritten->getOwnPropertyNames(overwritten, globalObject, names, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, {});
        for (auto& name : names) {
            JSValue saved = overwritten->get(globalObject, name);
            RETURN_IF_EXCEPTION(scope, {});
            if (saved != overwritten)
                continue;
            ExportVariable variable = findExportVariable(globalObject, loaded.esmNamespace, name);
            RETURN_IF_EXCEPTION(scope, {});
            JSValue original = variable.record ? variable.record->moduleEnvironment()->readVariable(vm, variable.offset) : JSValue();
            if (!original)
                continue;
            overwritten->putDirectMayBeIndex(globalObject, name, original);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    JSC::JSPromise* pending = mock->run(globalObject, false);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(pending ? JSValue(pending) : jsUndefined());
}

// Under `bun test` a mock that is made while nothing is loaded stores nothing: what require() answers behind it stays in the module object.
static void keepModuleObjectLeftBehindMock(const JSModuleMock* mock, LoadedModule& loaded)
{
    if (mock->keepsModuleObject)
        loaded.commonJSModule = nullptr;
}

static JSC::JSPromise* patchWhenFactorySettles(Zig::GlobalObject* globalObject, JSModuleMock* mock, JSC::JSPromise* pendingFactory)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSPromise* patched = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    pendingFactory->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionMockModuleFactoryResolve), globalObject->thenable(jsFunctionMockModuleFactoryReject), patched, mock);
    mock->hasPendingPatch = true;
    return patched;
}

#if ENABLE(AOT)
// The program's own factory was called and returned a promise that is pending.
static bool hasPendingFactory(const JSModuleMock* mock)
{
    JSValue factory = mock->factory.get();
    return factory && factory.isCallable() && mock->state == JSModuleMock::State::Running && mock->result && mock->result->inherits<JSC::JSPromise>();
}

static void deferMockToNextLoad(Zig::GlobalObject* globalObject, JSModuleMock* mock, JSC::AOT::FactoryFailurePolicy failurePolicy = JSC::AOT::FactoryFailurePolicy::RetryFactory)
{
    uint32_t module = *mock->unevaluatedCompiledModule;
    auto& waiting = globalObject->onLoadPlugins.pendingCompiledMocks;
    waiting.removeAllMatching([&](const auto& entry) { return entry.first == module; });
    waiting.append({ module, JSC::Strong<JSC::JSObject> { JSC::getVM(globalObject), mock } });
    JSC::AOT::deferMock(globalObject, JSC::AOT::ModuleID(module), failurePolicy, mock->isFromPreload);
}

static bool stillRetainsFailure(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    return mock->retainsFailureForImports && registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) == mock->activeMockAtFailure.get();
}

static JSValue retainedFailureForImports(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto& plugins = globalObject->onLoadPlugins;
    for (const auto& factory : plugins.compiledMockFactories.span().subspan(plugins.stashedFactoryCount)) {
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (stillRetainsFailure(globalObject, mock) && mock->specifier->tryGetValue().data == specifier)
            return mock->errorOwedToImports.get();
    }
    return {};
}

static void restoreStashedFactories(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& plugins = globalObject->onLoadPlugins;
    auto& factories = plugins.compiledMockFactories;
    for (size_t index = 0; index < plugins.stashedFactoryCount; ++index) {
        if (factories[index].mock.get() == mock)
            plugins.stashedFactoryCount = index;
    }
}

static void decideFailureRetention(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    if (!std::exchange(mock->isDecidingFailureRetention, false) || mock->numberOfImportsOwedError)
        return;
    auto& plugins = globalObject->onLoadPlugins;
    auto* later = registeredModuleMock(globalObject, mock->specifier->tryGetValue().data);
    bool isLoadedAgain = later ? later == mock->activeMockAtFailure.get() && mock->wasActiveMockSettled : mock->unevaluatedCompiledModule && !JSC::AOT::isMockLingering(globalObject, JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule)) && JSC::AOT::hasImportStartedLoading(globalObject, JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule));
    if (isLoadedAgain) {
        for (const auto& factory : plugins.compiledMockFactories.span().subspan(plugins.stashedFactoryCount)) {
            auto* earlier = uncheckedDowncast<JSModuleMock>(factory.mock.get());
            if (earlier->retainsFailureForImports && earlier->specifier->tryGetValue().data == mock->specifier->tryGetValue().data)
                earlier->clearRetainedFailure();
        }
        mock->retainsFailureForImports = true;
        mock->numberOfImportsOwedError = 1;
        mock->activeMockAtFailure.setMayBeNull(JSC::getVM(globalObject), mock, later);
    } else
        mock->errorOwedToImports.clear();
}

static void deferFailureRetention(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto* later = registeredModuleMock(globalObject, mock->specifier->tryGetValue().data);
    mock->isDecidingFailureRetention = true;
    mock->activeMockAtFailure.setMayBeNull(vm, mock, later);
    mock->wasActiveMockSettled = later && later != mock && later->state == JSModuleMock::State::Settled;
    JSC::JSPromise* settled = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    settled->fulfill(vm, jsUndefined());
    settled->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionDecideFailureRetention), globalObject->thenable(jsFunctionDecideFailureRetention), jsUndefined(), mock);
}

// A factory that fails under require() drops the entry that detached loads wait for.
static void scheduleDetachedLoadRetry(Zig::GlobalObject* globalObject, JSModuleMock* mock, JSC::AOT::ModuleID module)
{
    auto& vm = JSC::getVM(globalObject);
    for (const auto& earlier : globalObject->onLoadPlugins.compiledMockFactories) {
        if (earlier.module != module.index() || uncheckedDowncast<JSModuleMock>(earlier.mock.get())->factory.get() == mock->factory.get() || !earlier.isAwaitedByDetachedLoad || earlier.patched->status() != JSC::JSPromise::Status::Pending)
            continue;
        JSC::AOT::retryMockInDetachedLoads(globalObject, module);
        JSC::JSPromise* job = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        job->fulfill(vm, jsUndefined());
        for (unsigned hop = 0; hop < 2; ++hop) {
            JSC::JSPromise* next = JSC::JSPromise::create(vm, globalObject->promiseStructure());
            job->performPromiseThen(vm, globalObject, jsUndefined(), jsUndefined(), next);
            job = next;
        }
        job->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionSettleReplacedFactory), globalObject->thenable(jsFunctionSettleReplacedFactory), jsUndefined(), earlier.patched.get());
    }
}

static bool throwErrorOwedToImport(Zig::GlobalObject* globalObject, JSC::ThrowScope& scope)
{
    auto& plugins = globalObject->onLoadPlugins;
    auto owesError = [](JSC::JSObject* object) { return object && uncheckedDowncast<JSModuleMock>(object)->numberOfImportsOwedError; };
    JSValue importWaitState = JSC::AOT::currentImportWaitState(globalObject);
    JSValue awaited = importWaitState && !importWaitState.isString() ? JSC::asArray(importWaitState)->getDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->value) : JSValue();
    auto isAwaited = [&](JSC::JSObject* mock) {
        return !awaited || plugins.compiledMockFactories.containsIf([&](const auto& factory) { return factory.mock.get() == mock && JSValue(factory.patched.get()) == awaited; });
    };
    auto throwIfOwed = [&](uint32_t module, JSC::JSObject* object, bool isForWaitingImport) {
        auto* mock = uncheckedDowncast<JSModuleMock>(object);
        if (isForWaitingImport ? !(mock->numberOfImportsOwedError > mock->retainsFailureForImports && JSC::AOT::isCurrentImportTargetAfterWait(globalObject, JSC::AOT::ModuleID(module))) : !(stillRetainsFailure(globalObject, mock) && JSC::AOT::isCurrentImportTarget(globalObject, JSC::AOT::ModuleID(module))))
            return false;
        JSValue error = mock->errorOwedToImports.get();
        if (isForWaitingImport && !--mock->numberOfImportsOwedError)
            deferFailureRetention(globalObject, mock);
        throwException(globalObject, scope, error);
        return true;
    };
    for (const auto& entry : plugins.pendingCompiledMocks) {
        if (owesError(entry.second.get()) && ((isAwaited(entry.second.get()) && throwIfOwed(entry.first, entry.second.get(), true)) || throwIfOwed(entry.first, entry.second.get(), false)))
            return true;
    }
    // A static import has called the factory again meanwhile.
    for (const auto& factory : plugins.compiledMockFactories.span().subspan(plugins.stashedFactoryCount)) {
        if (owesError(factory.mock.get()) && (!awaited || JSValue(factory.patched.get()) == awaited) && throwIfOwed(factory.module, factory.mock.get(), true))
            return true;
    }
    for (const auto& factory : plugins.compiledMockFactories.span().subspan(plugins.stashedFactoryCount)) {
        if (owesError(factory.mock.get()) && throwIfOwed(factory.module, factory.mock.get(), false))
            return true;
    }
    return false;
}

// In `bun test` the generated module keeps the namespace that it imported, even after a reset. See evaluateModuleMock().
static JSObject* earlyLoadedOriginal(JSC::VM& vm, JSModuleMock* mock)
{
    JSC::JSPromise* load = mock->earlyOriginalLoad.get();
    auto* original = load && load->status() == JSC::JSPromise::Status::Fulfilled ? dynamicDowncast<JSC::JSModuleNamespaceObject>(load->result()) : nullptr;
    if (original && isModuleOrCopyOfIt(original->moduleRecord()->moduleKey().string(), originalModuleKey(mock->specifier->tryGetValue().data)))
        mock->originalNamespace.set(vm, mock, original);
    return original;
}

// In `bun test` import() registers every unregistered key that it resolves, including those of static imports below.
void didStartCompiledModuleImport(Zig::GlobalObject* globalObject, const ScopedLambda<BitVector()>& reachedModules)
{
    auto& files = globalObject->onLoadPlugins.filesMockedOutsideRegistry;
    if (files.isEmpty())
        return;
    BitVector reached = reachedModules();
    reached.filter(files);
    for (size_t file : reached) {
        files.quickClear(file);
        for (const String& specifier : globalObject->onLoadPlugins.mocksOutsideRegistry.take(static_cast<uint32_t>(file))) {
            if (auto* mock = registeredModuleMock(globalObject, specifier))
                mock->wouldBeInRegistry = true;
        }
    }
}

JSC::JSPromise* evaluateCompiledOriginalBeforeFactory(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module, bool& hasFactory)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& waiting = globalObject->onLoadPlugins.pendingCompiledMocks;
    size_t index = waiting.findIf([&](const auto& entry) { return entry.first == module.index(); });
    auto* mock = index == notFound ? nullptr : dynamicDowncast<JSModuleMock>(waiting[index].second.get());
    JSValue factory = mock ? mock->factory.get() : JSValue();
    if (!mock || !mock->importsOriginal || (factory && factory.isString()) || mock->state == JSModuleMock::State::Settled)
        return nullptr;
    // The jobs of a CommonJS file may fill its exports before `bun test` makes an automock or a spy of them.
    if (!factory && !JSC::AOT::isESModule(module))
        return nullptr;
    hasFactory = !!factory;
    mock->wasRequested = true;
    bool isOneInstance = isOneInstanceWithItsOriginal(mock, mock->specifier->tryGetValue().data);
    // Spies and automocks take the original too, but have no factory that would wait for its turn.
    if ((isOneInstance && !hasFactory) || takesFileWithoutBodyAsOriginal(mock, module))
        return nullptr;
    if (isOneInstance && JSC::AOT::isESModule(module)) {
        JSObject* package = JSC::AOT::evaluateOriginalUnderMock(globalObject, module);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (!package)
            return nullptr;
        JSC::JSPromise* settled = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        settled->fulfill(vm, package);
        return settled;
    }
    // A load that resumes after a reset keeps the modules that it imported.
    if (JSC::JSPromise* underWay = mock->wouldBeInRegistry ? nullptr : mock->earlyOriginalLoad.get(); underWay && underWay->status() != JSC::JSPromise::Status::Rejected)
        return underWay;
    String key = dependencyKeyOfModuleMock(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSC::VM::SynchronousModuleQueue queue;
    queue.prev = vm.m_synchronousModuleQueue;
    vm.m_synchronousModuleQueue = &queue;
    JSC::JSPromise* evaluation = importModuleKey(globalObject, key);
    if (!scope.exception())
        JSC::JSModuleLoader::drainSynchronousModuleQueue(globalObject);
    vm.m_synchronousModuleQueue = queue.prev;
    RETURN_IF_EXCEPTION(scope, nullptr);
    mock->earlyOriginalLoad.setMayBeNull(vm, mock, evaluation);
    mock->wouldBeInRegistry = true;
    // A factory without parameters names the original in its source. `bun test` looks for the name in the source that the transpiler has printed, which may lack it.
    JSObject* compiledFactory = factory ? factory.getObject() : nullptr;
    mock->wasOriginalLoadedAhead = compiledFactory && JSC::AOT::CompiledCallee::isCompiledCallee(compiledFactory) && !JSC::AOT::CompiledCallee::length(compiledFactory);
    earlyLoadedOriginal(vm, mock);
    Bun::evictModulesThatHaveLoaded(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return evaluation;
}

JSC::JSValue requireCompiledOriginal(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module, bool isForOwnFactory)
{
    auto* mock = registeredModuleMock(globalObject, JSC::AOT::moduleFilePath(module));
    if (!mock || isOneInstanceWithItsOriginal(mock, mock->specifier->tryGetValue().data) || (!isForOwnFactory && !Bun::canRequireOriginalOfModuleMock(globalObject, mock)))
        return {};
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!isForOwnFactory) {
        // What the program stored under the key. A falsy value counts as absent.
        JSC::JSMap* requireMap = Bun::testFileRequireMap(globalObject);
        JSValue stored = requireMap->get(globalObject, mock->specifier.get());
        RETURN_IF_EXCEPTION(scope, {});
        if (stored.isObject())
            RELEASE_AND_RETURN(scope, asObject(stored)->get(globalObject, Bun::builtinNames(vm).exportsPublicName()));
        JSC__JSMap__remove(requireMap, globalObject, JSValue::encode(mock->specifier.get()));
        RETURN_IF_EXCEPTION(scope, {});
    }
    RELEASE_AND_RETURN(scope, requireOriginalModule(globalObject, mock));
}

bool hasPendingCompiledPatch(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module)
{
    auto* mock = registeredModuleMock(globalObject, JSC::AOT::moduleFilePath(module));
    return mock && mock->hasPendingPatch && hasPendingFactory(mock);
}

bool deferCompiledPatchToNextLoad(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module, bool isFactoryPending)
{
    auto* mock = registeredModuleMock(globalObject, JSC::AOT::moduleFilePath(module));
    if (!mock || mock->hasPendingPatch != isFactoryPending || !(isFactoryPending ? hasPendingFactory(mock) : mock->state == JSModuleMock::State::Settled))
        return false;
    auto& vm = JSC::getVM(globalObject);
    // Modules are released also while an exception propagates.
    if (vm.exceptionForInspection()) [[unlikely]]
        return false;
    mock->unevaluatedCompiledModule = module.index();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    deferMockToNextLoad(globalObject, mock, mock->importsOriginal ? JSC::AOT::FactoryFailurePolicy::RetryFactory : JSC::AOT::FactoryFailurePolicy::CacheError);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return false;
    }
    return true;
}

bool runCompiledMock(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (throwErrorOwedToImport(globalObject, scope)) [[unlikely]]
        return false;
    auto& waiting = globalObject->onLoadPlugins.pendingCompiledMocks;
    size_t index = waiting.findIf([&](const auto& entry) { return entry.first == module.index(); });
    if (index == notFound)
        return false;
    auto* mock = uncheckedDowncast<JSModuleMock>(waiting[index].second.get());
    waiting.removeAt(index);
    if (!mock)
        return false;
    endWaitForTurn(globalObject, mock);
    // Release the turn that a fetch took for the mock unless a factory is running, as after every waitForTurn().
    auto givesTurnBack = makeScopeExit([&] {
        if (!findRunningModuleMock(globalObject, mock))
            returnTurn(globalObject, mock);
    });
    mock->moduleRequestedByLoad = JSC::AOT::currentLoadTarget(globalObject).transform([](JSC::AOT::ModuleID requested) { return requested.index(); });
    bool isBelowWhatIsRequired = JSC::AOT::requireRunsMocks(vm) && !JSC::AOT::isCurrentRequireTarget(globalObject, module);
    bool wasRequestedBefore = std::exchange(mock->wasRequested, true);
    bool rethrowsOriginalError = isBelowWhatIsRequired ? mock->importsOriginal && !mock->wasInstalledOverFailedLoad && wasRequestedBefore : !JSC::AOT::requireRunsMocks(vm) && (mock->wasInstalledOverFailedLoad || mock->importsOriginal);
    // A spy has an original of its own.
    OriginalUse use = mock->spy && !mock->factory ? OriginalUse::Spy : OriginalUse::Exports;
    if (JSValue thrown = rethrowsOriginalError ? originalEvaluationError(globalObject, mock->specifier->tryGetValue().data, use) : JSValue()) [[unlikely]] {
        waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
        throwException(globalObject, scope, thrown);
        return false;
    }
    // The load that waited for the factory retries, and the factory counts as failed. A require() has not waited, so it does not get the error.
    if (JSValue error = JSC::AOT::isCurrentRequireTarget(globalObject, module) ? JSValue() : mock->lateFactoryError.get()) [[unlikely]] {
        mock->lateFactoryError.clear();
        waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
        throwException(globalObject, scope, error);
        return false;
    }
    // As in ModuleLoader.cpp: require() does not call a factory that awaits. It gets the original, and the mock waits for an import.
    // Nor does it call the factory for a package that does not see the mock.
    bool isPending = hasPendingFactory(mock);
    String requirer = JSC::AOT::requirerPath(globalObject, module);
    bool isHiddenFromRequirer = !requirer.isNull() && !JSC::AOT::hasIntactOriginal(globalObject, module) && Bun::packageImportKey(globalObject, mock->specifier->tryGetValue().data, requirer, false) != mock->specifier->tryGetValue().data;
    if (JSC::AOT::requireRunsMocks(vm) && !JSC::AOT::isESModule(module) && (isHiddenFromRequirer || ((!JSC::AOT::isRequiringAnotherModule(globalObject, module) || JSC::AOT::hasStartedLoading(globalObject, module)) && (isPending || Bun::canRequireOriginalOfModuleMock(globalObject, mock))))) {
        mock->unevaluatedCompiledModule = module.index();
        // As there: a falsy `require.cache[key]` counts as absent.
        JSC::JSMap* requireMap = Bun::testFileRequireMap(globalObject);
        JSValue stored = requireMap->get(globalObject, mock->specifier.get());
        RETURN_IF_EXCEPTION(scope, false);
        if (!stored.toBoolean(globalObject)) {
            JSC__JSMap__remove(requireMap, globalObject, JSValue::encode(mock->specifier.get()));
            RETURN_IF_EXCEPTION(scope, false);
        }
        // The body has already run beside the mock, which keeps waiting.
        if (JSC::AOT::hasStartedLoading(globalObject, module)) {
            waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
            JSC::AOT::deferMockAfterAsyncFailure(globalObject, module);
            return false;
        }
        JSC::Exception* thrownByBody = nullptr;
        {
            auto catching = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            JSC::AOT::evaluateCommonJSModuleBeforeMock(globalObject, module);
            thrownByBody = catching.exception();
            if (thrownByBody && !catching.tryClearException()) [[unlikely]]
                return false;
        }
        deferMockToNextLoad(globalObject, mock, mock->importsOriginal ? JSC::AOT::FactoryFailurePolicy::RetryFactory : JSC::AOT::FactoryFailurePolicy::CacheError);
        RETURN_IF_EXCEPTION(scope, false);
        if (thrownByBody) [[unlikely]]
            throwException(globalObject, scope, thrownByBody);
        return false;
    }
    // The same for an ES module: evaluate its body now if it has not run.
    // If a static import below the required module requests this one, the require() finds a graph that awaits, and throws.
    // The same while a pending load holds the module's entry: in `bun test` later imports join that entry and call no factory.
    bool isRetainedForPendingLoad = !JSC::AOT::requireRunsMocks(vm) && JSC::AOT::isRetainedByInFlightLoads(globalObject, module) && globalObject->onLoadPlugins.modulesToEvictOnceLoaded.contains(mock->specifier->tryGetValue().data);
    if (JSC::AOT::isESModule(module) && (isRetainedForPendingLoad || (JSC::AOT::isCurrentRequireTarget(globalObject, module) && Bun::canRequireOriginalOfModuleMock(globalObject, mock)))) {
        // The original that an import loaded has failed.
        if (JSValue thrown = isRetainedForPendingLoad ? JSValue() : originalEvaluationError(globalObject, mock->specifier->tryGetValue().data)) [[unlikely]] {
            waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
            throwException(globalObject, scope, thrown);
            return false;
        }
        if (!isRetainedForPendingLoad)
            JSC::AOT::restoreOriginalForRequire(globalObject, module);
        if (JSC::AOT::hasIntactOriginal(globalObject, module) || JSC::AOT::isOriginalEvaluatedOutsideRegistry(globalObject, module)) {
            waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
            JSC::AOT::deferMockAfterAsyncFailure(globalObject, module);
            return false;
        }
        JSC::Exception* thrownByBody = nullptr;
        bool hasRun = false;
        {
            auto catching = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            hasRun = JSC::AOT::tryEvaluateESModuleBeforeMock(globalObject, module);
            thrownByBody = catching.exception();
            if (thrownByBody && !catching.tryClearException()) [[unlikely]]
                return false;
        }
        // `bun test` calls no factory here: the mock stays pending for the next import.
        bool isLoadingOriginal = thrownByBody && JSC::AOT::startDetachedOriginalLoad(globalObject, module);
        RETURN_IF_EXCEPTION(scope, false);
        if (isLoadingOriginal) {
            mock->isOriginalLoadDetached = true;
            mock->unevaluatedCompiledModule = module.index();
            deferMockToNextLoad(globalObject, mock, mock->importsOriginal ? JSC::AOT::FactoryFailurePolicy::RetryFactory : JSC::AOT::FactoryFailurePolicy::CacheError);
            RETURN_IF_EXCEPTION(scope, false);
            throwException(globalObject, scope, Bun::createAsyncModuleRequiredError(globalObject, originalModuleKey(mock->specifier->tryGetValue().data)));
            return false;
        }
        // The original has top-level await: the factory isn't called, and the mock stays pending. The next require() finds the entry of the original, and a factory that doesn't take it is called.
        if (!hasRun && !thrownByBody && !isRetainedForPendingLoad && !JSC::AOT::hasStartedLoading(globalObject, module) && !JSC::AOT::isSynchronousESModule(globalObject, module) && (mock->importsOriginal || !std::exchange(mock->hasRefusedOriginal, true))) {
            bool hasBegun = JSC::AOT::tryStartAsyncOriginal(globalObject, module);
            RETURN_IF_EXCEPTION(scope, false);
            if (hasBegun) {
                mock->isOriginalAfterAwait = JSC::AOT::tryKeepOriginalIntact(globalObject, module, false, std::nullopt, true);
                RETURN_IF_EXCEPTION(scope, false);
                if (mock->isOriginalAfterAwait)
                    JSC::AOT::setIsUnderActualKey(globalObject, module, true);
                mock->unevaluatedCompiledModule = module.index();
                deferMockToNextLoad(globalObject, mock, mock->importsOriginal ? JSC::AOT::FactoryFailurePolicy::RetryFactory : JSC::AOT::FactoryFailurePolicy::CacheError);
                RETURN_IF_EXCEPTION(scope, false);
                // Its awaits have ended already.
                if (mock->isOriginalAfterAwait && !JSC::AOT::wasDisplacedDuringEvaluation(globalObject, module))
                    return false;
            } else
                waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
            throwException(globalObject, scope, Bun::createAsyncModuleRequiredError(globalObject, originalModuleKey(mock->specifier->tryGetValue().data)));
            return false;
        }
        if (thrownByBody && mock->importsOriginal) [[unlikely]] {
            throwException(globalObject, scope, thrownByBody);
            return false;
        }
        bool waitsOverModule = (hasRun || thrownByBody) && JSC::AOT::tryKeepOriginalIntact(globalObject, module, false, std::nullopt, !!thrownByBody);
        RETURN_IF_EXCEPTION(scope, false);
        if (waitsOverModule) {
            JSC::AOT::setIsUnderActualKey(globalObject, module, hasRun && !thrownByBody);
            if (!JSMock__isInPreload(globalObject)) {
                globalObject->onLoadPlugins.testFileOfModule.set(originalModuleKey(mock->specifier->tryGetValue().data), globalObject->onLoadPlugins.testFile);
                if (JSC::AOT::isESModule(module))
                    JSC::AOT::didRequireOwnOriginal(globalObject, module);
            }
            mock->unevaluatedCompiledModule = module.index();
            deferMockToNextLoad(globalObject, mock, mock->importsOriginal ? JSC::AOT::FactoryFailurePolicy::RetryFactory : JSC::AOT::FactoryFailurePolicy::CacheError);
            RETURN_IF_EXCEPTION(scope, false);
        }
        if (thrownByBody) [[unlikely]]
            throwException(globalObject, scope, thrownByBody);
        if (waitsOverModule || thrownByBody)
            return false;
    }
    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, false);
    loaded.compiledModule = module;
    mock->unevaluatedCompiledModule = module.index();
    mock->firstLoadTestFile = Bun::isBunTest && !JSMock__isInPreload(globalObject) ? globalObject->onLoadPlugins.testFile : 0;
    // `bun test` assigns a key to the test file that fetches it, so what is restored under the key belongs to this test file.
    if (mock->firstLoadTestFile)
        JSC::AOT::markEntryOwnedByTestFile(globalObject, module);
    // A preload mock outlives the test file that loads it, so a key that an earlier test file emptied is in use again.
    if (mock->firstLoadTestFile && mock->isFromPreload)
        JSC::AOT::didRestoreEntryForPreload(globalObject, module);
    if (auto* displaced = displacedPreloadMock(globalObject, mock->specifier->tryGetValue().data); displaced && displaced->isUnderActualKey)
        displaced->firstLoadTestFile = mock->firstLoadTestFile;
    // The loader created the namespace object from a mock, and it reads the newest one.
    if (loaded.esmNamespace && loaded.esmNamespace->moduleRecord()->hasLiveExports())
        loaded.esmNamespace = nullptr;
    // Under the path of a variant the loader holds the module of another import type.
    if (loaded.esmNamespace && JSC::AOT::importAttributeVariants(globalObject, mock->specifier->value(globalObject)).contains(module))
        loaded.esmNamespace = nullptr;
    RETURN_IF_EXCEPTION(scope, false);
    // Nothing was loaded when the mock was made. Since then the host has answered a require(): of a name that the build does not know, or from code outside the image.
    mock->keepsModuleObject = !!loaded.commonJSModule;
    // A `__mocks__` file and the original of a mock without a factory may have top-level await: import waits, and require() throws, as in `bun test`.
    // A mock that provides the actual file has ended in `bun test`, so require() gets the file at once.
    bool requiresFile = (!mock->factory.get() || mock->factory.get().isString() || mock->providesActualFile) && JSC::AOT::requireRunsMocks(vm);
    // After a synchronous ES module the loader builds such a mock in the same evaluation, before jobs that the body queued.
    bool runsRightAfterBody = !mock->factory.get() && JSC::AOT::isSynchronousESModule(globalObject, module);
    if (!mock->earlyOriginalLoad)
        mock->wouldBeInRegistry = true;
    JSObject* original = earlyLoadedOriginal(vm, mock);
    mock->earlyOriginalLoad.clear();
    bool joinsFetchInFlight = globalObject->onLoadPlugins.latestCompiledFactoryCalls.containsIf([&](const auto& newest) {
        return newest.first == module.index() && !((newest.second & endedMockCallBit) && !JSC::AOT::hasOrphanedFetch(globalObject, module)) && globalObject->onLoadPlugins.compiledMockFactories.containsIf([&](const auto& earlier) { return earlier.call == (newest.second & ~endedMockCallBit) && earlier.joinedFetchWhenCalled && earlier.patched->status() == JSC::JSPromise::Status::Pending && uncheckedDowncast<JSModuleMock>(earlier.mock.get())->factory.get() != mock->factory.get(); });
    });
    JSValue factory = mock->factory.get();
    mock->isAwaitedByGeneratedModule = mock->importsOriginal && factory && factory.isCallable() && JSC::AOT::awaitsGeneratedModule(globalObject, module);
    JSC::JSPromise* pendingFactory = mock->run(globalObject, requiresFile || runsRightAfterBody, original);
    if (!pendingFactory && !scope.exception() && !JSC::AOT::isCurrentRequireTarget(globalObject, module))
        globalObject->onLoadPlugins.latestCompiledFactoryCalls.removeAllMatching([&](const auto& each) { return each.first == module.index(); });
    if (!scope.exception()) [[likely]] {
        // The factory may have require()d the module itself: `() => ({ ...require("./m"), extra })`.
        findLoadedCommonJSModule(globalObject, mock->specifier.get(), loaded);
    }
    bool isGone = !scope.exception() && !pendingFactory && !registeredModuleMock(globalObject, mock->specifier->value(globalObject));
    if (!scope.exception() && !pendingFactory && (!isGone || !JSC::AOT::hasStartedLoading(globalObject, module) || JSC::AOT::isMockLingering(globalObject, module))) [[likely]] {
        keepModuleObjectLeftBehindMock(mock, loaded);
        overrideLoadedModuleExports(globalObject, mock, loaded);
        if (isGone && !scope.exception())
            JSC::AOT::markMockLingering(globalObject, module);
    }
    if (JSC::Exception* thrown = scope.exception()) [[unlikely]] {
        if (JSC::AOT::requireRunsMocks(vm) && !vm.isTerminationException(thrown))
            scheduleDetachedLoadRetry(globalObject, mock, module);
        // The next load asks the mock again.
        waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
        // A detached load that calls the factory again fails with that call. That is reported only if the load's own call joined a fetch in flight.
        uint64_t retriedCall = JSC::AOT::factoryCallOfResumedLoad(globalObject, module);
        bool isReportedRetry = retriedCall && globalObject->onLoadPlugins.compiledMockFactories.containsIf([&](const auto& factory) { return factory.call == retriedCall && factory.joinedFetchWhenCalled; });
        bool isReportedRequire = joinsFetchInFlight && !JSC::AOT::isRequestedByDetachedLoad(globalObject, module) && !JSC::AOT::needsRetryInDetachedLoad(globalObject, module);
        if ((isReportedRetry || isReportedRequire) && !vm.isTerminationException(thrown) && scope.tryClearException()) {
            JSC::JSPromise::rejectedPromise(globalObject, thrown->value())->performPromiseThen(vm, globalObject, JSC::jsUndefined(), JSC::jsUndefined(), JSC::JSPromise::create(vm, globalObject->promiseStructure()));
            throwException(globalObject, scope, thrown);
        }
        return false;
    }
    mock->wasLoadedByRequire |= !pendingFactory && JSC::AOT::requireRunsMocks(vm);
    if (pendingFactory) {
        auto& plugins = globalObject->onLoadPlugins;
        // A separate promise, because the job after the factory settles its own promise unconditionally.
        JSC::JSPromise* patched = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        patchWhenFactorySettles(globalObject, mock, pendingFactory)->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionCompiledFactorySettled), globalObject->thenable(jsFunctionCompiledFactoryFailed), JSC::jsUndefined(), patched);
        auto& newestCalls = plugins.latestCompiledFactoryCalls;
        size_t newest = newestCalls.findIf([&](const auto& each) { return each.first == module.index(); });
        bool wasFileLoadedSince = newest != notFound && (newestCalls[newest].second & endedMockCallBit) && !JSC::AOT::hasOrphanedFetch(globalObject, module);
        bool joinedFetchInFlight = newest != notFound && !wasFileLoadedSince && plugins.compiledMockFactories.containsIf([&](const auto& earlier) { return earlier.call == (newestCalls[newest].second & ~endedMockCallBit) && earlier.patched->status() == JSC::JSPromise::Status::Pending; });
        plugins.compiledMockFactories.append({ module.index(), false, JSC::Strong<JSC::JSObject> { vm, mock }, JSC::Strong<JSC::JSPromise> { vm, patched } });
        plugins.compiledMockFactories.last().joinedFetchInFlight = joinedFetchInFlight && JSC::AOT::requireRunsMocks(vm);
        plugins.compiledMockFactories.last().joinedFetchWhenCalled = joinedFetchInFlight;
        plugins.compiledMockFactories.last().wasStartedByRequire = JSC::AOT::requireRunsMocks(vm);
        plugins.compiledMockFactories.last().isInCurrentWalk = JSC::AOT::requireRunsMocks(vm);
        mock->isFactoryUnawaited = JSC::AOT::requireRunsMocks(vm);
        mock->wasFactoryStartedByRequire = JSC::AOT::requireRunsMocks(vm);
        plugins.compiledMockFactories.last().isAwaitedByImporter = !JSC::AOT::isCurrentImportTarget(globalObject, module);
        plugins.compiledMockFactories.last().call = ++plugins.compiledFactoryCallCount;
        // In `bun test` the fetch that a require() dropped follows the active mock.
        unsigned followed = std::exchange(mock->followingDroppedFetches, 0);
        if (joinedFetchInFlight)
            plugins.compiledMockFactories.last().rejectedRequireCount += followed;
        for (size_t earlier = 0; joinedFetchInFlight && earlier + 1 < plugins.compiledMockFactories.size(); ++earlier) {
            auto& displaced = plugins.compiledMockFactories[earlier];
            if (displaced.module == module.index() && displaced.patched->status() == JSC::JSPromise::Status::Pending)
                plugins.compiledMockFactories.last().rejectedRequireCount += std::exchange(displaced.rejectedRequireCount, 0) + std::exchange(displaced.joinedFetchInFlight, false);
        }
        if (newest == notFound)
            newestCalls.append({ module.index(), plugins.compiledFactoryCallCount });
        else
            newestCalls[newest].second = plugins.compiledFactoryCallCount;
        mock->hasPendingPatch = false;
        mock->waitingImportCount += JSC::AOT::isCurrentImportTarget(globalObject, module);
        mock->isDetached = false;
    }
    return !!pendingFactory;
}
#endif

#if ENABLE(AOT)
static bool isFactoryWaitingFor(Zig::GlobalObject* globalObject, JSObject* waiting, JSObject* waitedFor, Vector<JSObject*, 4>& seen)
{
    if (seen.contains(waitedFor))
        return false;
    seen.append(waitedFor);
    for (const auto& factory : globalObject->onLoadPlugins.compiledMockFactories) {
        if (factory.mock.get() == waitedFor && factory.patched->status() == JSC::JSPromise::Status::Pending && factory.waitingFactories.containsIf([&](const auto& other) { return other.get() == waiting || isFactoryWaitingFor(globalObject, waiting, other.get(), seen); }))
            return true;
    }
    return false;
}

static bool isWrittenIn(JSModuleMock* mock, JSC::AOT::ModuleID file)
{
    JSObject* factory = mock->factory ? mock->factory.get().getObject() : nullptr;
    // Host functions have no source file.
    if (!factory)
        return false;
    return (JSC::AOT::CompiledCallee::isCompiledCallee(factory) ? JSC::AOT::declaringFilePath(factory) : fileOfFunction(factory)) == JSC::AOT::moduleFilePath(file);
}

// As in keyOfImportWhileModuleMocksRun(): a file on the import chain of a running factory counts as that factory.
// A held import() is retried later. Factories called since then do not count, see waitsForMockOf().
// A module that was linked as itself is patched in place, so requests from below its original get that module.
static bool isPatchedInPlace(JSModuleMock* mock, JSC::AOT::ModuleID requested)
{
    return mock->importsOriginal && requested && mock->specifier->tryGetValue().data == JSC::AOT::moduleFilePath(requested);
}

static Vector<JSObject*, 2> findRequestingFactories(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID loadingFile, JSC::AOT::ModuleID requested, uint32_t callSequenceNumber = UINT32_MAX)
{
    Vector<JSObject*, 2> callers = factoriesInAsyncContext(globalObject);
    for (const auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
        if (loadingFile && running.compiledImportChain.get(loadingFile.index()) && !isPatchedInPlace(uncheckedDowncast<JSModuleMock>(running.mock.get()), requested) && uncheckedDowncast<JSModuleMock>(running.mock.get())->calledAt <= callSequenceNumber && !callers.contains(running.mock.get()))
            callers.append(running.mock.get());
    }
    return callers;
}

// An import() with no factory in its async context counts as a request from the running factory.
static bool isRequestedByFactoryModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, const JSC::AOT::CurrentImportCall& import)
{
    // Compiled code calls such a factory inside import(), so the sequence numbers do not apply.
    if (mock->importsOriginal && import.importTarget && JSC::AOT::hasIntactOriginal(globalObject, import.importTarget))
        return false;
    return mock->state == JSModuleMock::State::Running && !mock->isDetached && registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) == mock && mock->calledAt <= import.callSequenceNumber && isWrittenIn(mock, import.callerModule);
}

// As in isWaitingForModule(): a new load waits for the mock only through a module that a load which waits for it has requested.
static bool reachesOriginal(Zig::GlobalObject* globalObject, const BunPlugin::OnLoad::CompiledMockFactory& factory, JSC::AOT::ModuleID requested)
{
    if (!requested)
        return false;
    JSC::AOT::ModuleID mocked(factory.module);
    WTF::BitVector unfinished = unfinishedModulesOfLoad(globalObject, requested, JSC::AOT::LoadGraphMode::RespectMocks);
    if (!unfinished.get(requested.index()))
        return false;
    for (size_t index : unfinished) {
        JSC::AOT::ModuleID module(index);
        if (module == mocked || (module != requested && !JSC::AOT::isInLoadGraph(globalObject, module, mocked)))
            continue;
        if (factory.modulesRequestedByWaiters.containsIf([&](unsigned waiting) { return waiting == index || JSC::AOT::isInLoadGraph(globalObject, JSC::AOT::ModuleID(waiting), module); }))
            return false;
    }
    return true;
}

static bool waitsForMockOf(Zig::GlobalObject* globalObject, JSModuleMock* running, const Vector<JSObject*, 2>& callers, std::optional<JSC::AOT::CurrentImportCall> import)
{
    // Importers that do not see a mock do not wait for it.
    if (import && running->unevaluatedCompiledModule == import->importTarget.index() && !JSC::AOT::isMockedForImportCall(globalObject, import->importTarget, import->callerModule))
        return false;
    auto* entry = findRunningModuleMock(globalObject, running);
    // A factory that was not running when import() was called does not count.
    // Compiled code calls some factories earlier than `bun test`: one whose import() came before the requester's counts as running.
    // A require() calls a factory at the same time as `bun test`.
    if (import && !callers.isEmpty() && running->calledAt > import->callSequenceNumber && (running->requestedAt > uncheckedDowncast<JSModuleMock>(callers[0])->requestedAt || uncheckedDowncast<JSModuleMock>(callers[0])->wasCalledUnderRequire))
        return true;
    auto importingFile = import ? std::optional(import->callerModule) : std::nullopt;
    auto requested = import ? std::optional(import->importTarget) : std::nullopt;
    Vector<JSObject*, 4> seen;
    if (callers.containsIf([&](JSObject* caller) { return isFactoryWaitingFor(globalObject, running, caller, seen); }))
        return false;
    if (requested && isPatchedInPlace(running, *requested) && !callers.contains(running))
        return true;
    if (importingFile) {
        if (*requested && running->unevaluatedCompiledModule && requested->index() != *running->unevaluatedCompiledModule && JSC::AOT::isInLoadGraph(globalObject, *requested, JSC::AOT::ModuleID(*running->unevaluatedCompiledModule))) {
            // The load reaches the mocked module statically, through a file that the running factory imported, which was linked with the original.
            JSC::AOT::ModuleID mocked(*running->unevaluatedCompiledModule);
            for (size_t module : entry ? entry->compiledImportChain : WTF::BitVector()) {
                if (JSC::AOT::importsStatically(globalObject, JSC::AOT::ModuleID(module), mocked) && (module == requested->index() || JSC::AOT::isInLoadGraph(globalObject, *requested, JSC::AOT::ModuleID(module))))
                    return false;
            }
        }
        // Factories that imported the requester's module may wait for it, so it must not wait for them.
        Vector<JSObject*, 4> mayWait(callers.span());
        for (size_t index = 0; index < mayWait.size(); ++index) {
            auto module = uncheckedDowncast<JSModuleMock>(mayWait[index])->unevaluatedCompiledModule;
            for (const auto& other : globalObject->onLoadPlugins.runningModuleMocks) {
                if (module && other.compiledImportChain.get(*module) && !mayWait.contains(other.mock.get()))
                    mayWait.append(other.mock.get());
            }
        }
        if (mayWait.contains(running))
            return false;
        if (entry && (entry->compiledImportChain.get(importingFile->index()) || entry->importChain.contains(JSC::AOT::moduleFilePath(*importingFile))))
            return false;
        if (!isWrittenIn(running, *importingFile))
            return true;
    }
    auto* asker = uncheckedDowncast<JSModuleMock>(callers[0]);
    // The fetch of a mocked module starts its factory without a load, so two such fetches are not one load.
    if (running->moduleRequestedByLoad && running->moduleRequestedByLoad == asker->moduleRequestedByLoad)
        return true;
    auto leadsTo = [&](std::optional<unsigned> requested, JSModuleMock* other) {
        return requested && other->unevaluatedCompiledModule && JSC::AOT::isInLoadGraph(globalObject, JSC::AOT::ModuleID(*requested), JSC::AOT::ModuleID(*other->unevaluatedCompiledModule));
    };
    if (leadsTo(asker->moduleRequestedByLoad, running) || leadsTo(running->moduleRequestedByLoad, asker))
        return true;
    auto leadsToBoth = [&](std::optional<unsigned> requested) { return leadsTo(requested, running) && leadsTo(requested, asker); };
    for (const auto& factory : globalObject->onLoadPlugins.compiledMockFactories) {
        if (factory.patched->status() == JSC::JSPromise::Status::Pending && (leadsToBoth(uncheckedDowncast<JSModuleMock>(factory.mock.get())->moduleRequestedByLoad) || factory.modulesRequestedByWaiters.containsIf(leadsToBoth)))
            return true;
    }
    // For importers that run from source, ask the loader, as `bun test` does.
    // While such a file is being read, the loader knows none of its imports, but the image does.
    auto isAboveBothAsBuilt = [&](const String& key) {
        auto file = Bun::compiledModuleForPath(key);
        return file && leadsToBoth(file->index());
    };
    for (auto& [key, fetch] : globalObject->onLoadPlugins.loadRootFetches) {
        if (uncheckedDowncast<JSC::JSPromise>(fetch.get())->status() == JSC::JSPromise::Status::Pending && isAboveBothAsBuilt(key))
            return true;
    }
    for (auto& [mapKey, entry] : Bun::testFileModuleLoader(globalObject)->moduleMap()) {
        bool isBeingFetched = !entry->record() && (entry->status() == JSC::ModuleRegistryEntry::Status::New || entry->status() == JSC::ModuleRegistryEntry::Status::Fetching);
        if (isBeingFetched && isAboveBothAsBuilt(String(mapKey.first)))
            return true;
    }
    return Bun::haveUnfinishedImporterInCommon(globalObject, running->specifier->tryGetValue().data, asker->specifier->tryGetValue().data);
}
#endif

#if ENABLE(AOT)
JSC::JSPromise* fetchedCompiledMockTurn(Zig::GlobalObject*, uint32_t module, const String& key);

JSC_DEFINE_HOST_FUNCTION(jsFunctionRetryCompiledMockTurn, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto [mock, fetch] = toModuleMockWith<JSC::InternalFieldTuple>(globalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    auto* mayGoOn = uncheckedDowncast<JSC::JSPromise>(fetch->getInternalField(0));
    auto* fetched = uncheckedDowncast<JSC::InternalFieldTuple>(fetch->getInternalField(1));
    uint32_t module = fetched->getInternalField(0).asUInt32();
    String key = asString(fetched->getInternalField(1))->tryGetValue().data;
    globalObject->onLoadPlugins.waitingMockFetches.removeAllMatching([&](const auto& standing) { return standing.first == key && standing.second.get() == mock; });
    // The mock ended or was replaced while it waited, another mock hides it, or another fetch that waited for the same turn called its factory. Unless it runs, pass the turn on.
    bool stillWaits = globalObject->onLoadPlugins.pendingCompiledMocks.containsIf([&](const auto& waiting) {
        return waiting.second.get() == mock && (waiting.first == module || JSC::AOT::modulesInLoadGraph(globalObject, JSC::AOT::ModuleID(module)).get(waiting.first));
    });
    if (!stillWaits && !findRunningModuleMock(globalObject, mock))
        returnTurn(globalObject, mock);
    if (JSC::JSPromise* next = fetchedCompiledMockTurn(globalObject, module, key))
        mayGoOn->pipeFrom(vm, next);
    else
        mayGoOn->fulfill(vm, stillWaits ? JSValue(mock) : jsUndefined());
    return JSValue::encode(jsUndefined());
}

// An importer that runs from source imports a compiled module that waits for a mock: the factory takes its turn as in `bun test`, see waitForTurn().
// Null if the fetch may proceed, else a promise for the mock that has the turn, or for undefined if none is left.
JSC::JSPromise* fetchedCompiledMockTurn(Zig::GlobalObject* globalObject, uint32_t module, const String& key)
{
    auto& vm = JSC::getVM(globalObject);
    auto& standing = globalObject->onLoadPlugins.waitingMockFetches;
    std::optional<WTF::BitVector> below;
    for (auto& waiting : globalObject->onLoadPlugins.pendingCompiledMocks) {
        if (waiting.first != module && !below)
            below = JSC::AOT::modulesInLoadGraph(globalObject, JSC::AOT::ModuleID(module));
        bool liesBelow = waiting.first != module && below->get(waiting.first);
        if (waiting.first != module && !liesBelow)
            continue;
        auto* mock = uncheckedDowncast<JSModuleMock>(waiting.second.get());
        // Another load has called it. One beside it below the file may still wait.
        if (mock->state != JSModuleMock::State::NotCalled) {
            if (liesBelow)
                continue;
            return nullptr;
        }
        if (liesBelow)
            standing.append({ key, JSC::Strong<JSC::JSObject> { vm, mock } });
        JSC::JSPromise* turn = waitForTurn(globalObject, mock, true);
        if (!turn) {
            standing.removeAllMatching([&](const auto& other) { return other.first == key && other.second.get() == mock; });
            return nullptr;
        }
        JSC::JSPromise* mayGoOn = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        auto* fetched = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), jsNumber(module), jsString(vm, key));
        auto* fetch = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), mayGoOn, fetched);
        JSC::JSFunction* asksAgain = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionRetryCompiledMockTurn, ImplementationVisibility::Private);
        turn->performPromiseThenWithContext(vm, globalObject, asksAgain, asksAgain, jsUndefined(), moduleMockWith(globalObject, mock, fetch));
        return mayGoOn;
    }
    return nullptr;
}

// The fetch that had the turn may have called no factory.
void releaseUnusedMockTurn(Zig::GlobalObject* globalObject, JSValue holder)
{
    auto* mock = dynamicDowncast<JSModuleMock>(holder);
    if (mock && !findRunningModuleMock(globalObject, mock))
        returnTurn(globalObject, mock);
}

// mock.module() itself called the compiled factory over a loaded module, and it is pending. The list below only has factories that loads called.
bool hasRunningModuleMock(Zig::GlobalObject* globalObject)
{
    return !globalObject->onLoadPlugins.runningModuleMocks.isEmpty();
}

bool isCompiledModulePatchPending(Zig::GlobalObject* globalObject, const WTF::ScopedLambda<WTF::String()>& pathOfModule)
{
    const auto& runningModuleMocks = globalObject->onLoadPlugins.runningModuleMocks;
    if (runningModuleMocks.isEmpty()) [[likely]]
        return false;
    String path = pathOfModule();
    return runningModuleMocks.containsIf([&](const auto& running) {
        return !running.file.isEmpty() && uncheckedDowncast<JSModuleMock>(running.mock.get())->specifier->tryGetValue().data == path;
    });
}

// A factory that has requested its original in the mock call no longer counts as running, so a require() from its file gets no original.
bool requiresCompiledPatch(Zig::GlobalObject* globalObject, const WTF::ScopedLambda<WTF::String()>& pathOfModule, JSC::JSObject*& exports)
{
    if (!globalObject->onLoadPlugins.virtualModules) [[likely]]
        return false;
    auto* mock = registeredModuleMock(globalObject, pathOfModule());
    if (!mock || !mock->hasPendingPatch || findRunningModuleMock(globalObject, mock))
        return false;
    if (mock->state == JSModuleMock::State::Settled)
        exports = mock->result.get();
    return exports || hasPendingFactory(mock);
}

// 0 if the module's active mock has no pending factory.
uint64_t pendingCompiledFactoryCallID(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module, bool& shouldRejectEveryRequire)
{
    for (const auto& factory : globalObject->onLoadPlugins.compiledMockFactories | std::views::reverse) {
        if (factory.module != module.index() || factory.patched->status() != JSC::JSPromise::Status::Pending)
            continue;
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (mock->state == JSModuleMock::State::NotCalled || registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) != mock)
            continue;
        // A require() gives up on a preload mock each time, as in `bun test`.
        shouldRejectEveryRequire = mock->isFromPreload && !mock->importsOriginal && !factoriesInAsyncContext(globalObject).contains(mock);
        return factory.call;
    }
    return 0;
}

bool isCompiledFactoryCallPending(Zig::GlobalObject* globalObject, uint64_t call)
{
    return globalObject->onLoadPlugins.compiledMockFactories.containsIf([&](const auto& factory) { return factory.call == call && factory.patched->status() == JSC::JSPromise::Status::Pending && !uncheckedDowncast<JSModuleMock>(factory.mock.get())->wasInstalledAtEnd; });
}

bool isMockAwaitingBody(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module)
{
    for (const auto& factory : globalObject->onLoadPlugins.compiledMockFactories | std::views::reverse) {
        if (factory.module != module.index() || factory.patched->status() != JSC::JSPromise::Status::Pending)
            continue;
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        return !mock->factory && mock->isAwaitingRunningBody;
    }
    return false;
}

bool isInCompiledFactoryChain(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID file, JSC::AOT::ModuleID mocked)
{
    for (const auto& factory : globalObject->onLoadPlugins.compiledMockFactories | std::views::reverse) {
        if (factory.module != mocked.index() || factory.patched->status() != JSC::JSPromise::Status::Pending)
            continue;
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (mock->state == JSModuleMock::State::NotCalled || registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) != mock)
            continue;
        auto* running = findRunningModuleMock(globalObject, mock);
        return isWrittenIn(mock, file) || (running && (running->compiledImportChain.get(file.index()) || running->importChain.contains(JSC::AOT::moduleFilePath(file))));
    }
    return true;
}

// `state` is an array: the calling factories (as an array), then the promises of the factories that the caller started and has not waited for. `source` is the importing file. In the loader's first request the array begins with the key of its fetch.
// Whether the factory may wait for the module that the loader fetches under this key, directly or by way of another factory.
static bool mayFactoryAwaitFetch(Zig::GlobalObject* globalObject, JSModuleMock* factory, const String& key)
{
    auto module = JSC::AOT::findModule(key, key.hash());
    Vector<JSObject*, 4> waiting { factory };
    for (size_t index = 0; index < waiting.size(); ++index) {
        auto* running = findRunningModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(waiting[index]));
        if (!running)
            return true;
        if (running->importChain.contains(key) || (module && running->compiledImportChain.get(module->index())))
            return true;
        for (const auto& other : globalObject->onLoadPlugins.runningModuleMocks) {
            auto* below = uncheckedDowncast<JSModuleMock>(other.mock.get());
            bool isBelow = running->importChain.contains(below->specifier->tryGetValue().data) || (below->unevaluatedCompiledModule && running->compiledImportChain.get(*below->unevaluatedCompiledModule));
            if (isBelow && !waiting.contains(below))
                waiting.append(below);
        }
    }
    return false;
}

// Whether the original that the factory waits for imports the file under this key.
static bool isBelowOriginal(Zig::GlobalObject* globalObject, const auto& factory, const String& key)
{
    auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
    auto fetched = mock->wasOriginalRequested ? JSC::AOT::findModule(key, key.hash()) : std::nullopt;
    return fetched && fetched->index() != factory.module && JSC::AOT::importsStatically(globalObject, JSC::AOT::ModuleID(factory.module), *fetched);
}

JSC::JSPromise* nextPendingCompiledFactory(Zig::GlobalObject* globalObject, const WTF::ScopedLambda<bool(JSC::AOT::ModuleID)>& isInGraph, JSC::AOT::PendingFactoryRequester requester, JSC::JSValue& state)
{
    auto& factories = globalObject->onLoadPlugins.compiledMockFactories;
    if (factories.isEmpty() && !state) [[likely]]
        return nullptr;
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    if (requester != JSC::AOT::PendingFactoryRequester::Require && requester != JSC::AOT::PendingFactoryRequester::RejectedRequire && throwErrorOwedToImport(globalObject, scope)) [[unlikely]]
        return nullptr;
    // Nothing waits for a factory that a require() started. Once its mock is gone, no load adopts it.
    size_t& setAside = globalObject->onLoadPlugins.stashedFactoryCount;
    Vector<JSModuleMock*, 1> noLongerRunning;
    factories.removeAllMatching([&](const auto& factory) {
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (factory.isWaitedFor && factory.patched->status() != JSC::JSPromise::Status::Pending)
            return !mock->isDecidingFailureRetention && mock->numberOfImportsOwedError <= mock->retainsFailureForImports && !stillRetainsFailure(globalObject, mock);
        if (mock->isDetached || registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) == mock)
            return false;
        mock->isDetached = true;
        noLongerRunning.append(mock);
        return !factory.isWaitedFor && factory.wasStartedByRequire;
    },
        setAside);
    for (auto* mock : noLongerRunning)
        mock->detach(globalObject);
    for (; setAside < factories.size(); ++setAside) {
        const auto& factory = factories[setAside];
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (!mock->isDetached || !factory.isWaitedFor || factory.isAwaitedByImporter || !factory.waitingFactories.isEmpty() || mock->numberOfImportsOwedError || factory.patched->status() != JSC::JSPromise::Status::Pending)
            break;
    }
    if (requester == JSC::AOT::PendingFactoryRequester::DetachedLoad) {
        for (auto& factory : factories)
            factory.isInCurrentWalk = false;
    }
    if (requester == JSC::AOT::PendingFactoryRequester::RejectedRequire) {
        for (const auto& factory : factories.span().subspan(setAside)) {
            auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
            String mocked = mock->specifier->tryGetValue().data;
            if (mock->state == JSModuleMock::State::Settled && factory.patched->status() == JSC::JSPromise::Status::Pending && registeredModuleMock(globalObject, mocked) == mock && isInGraph(JSC::AOT::ModuleID(factory.module)))
                Bun::recordRepeatedFileRun(globalObject, mocked, "a require() of it was rejected"_s);
        }
        // The factory rejected, but the detached load that waits for it has not failed yet. `bun test` has already dropped the entry, so this require() calls the factory again.
        JSC::MarkedArgumentBuffer mocksToRetry;
        auto hasRejectedUnheard = [&](JSModuleMock* mock, uint32_t module) {
            return mock->state == JSModuleMock::State::NotCalled && registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) == mock && isInGraph(JSC::AOT::ModuleID(module));
        };
        for (auto& factory : factories) {
            auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
            if (factory.patched->status() == JSC::JSPromise::Status::Pending && factory.isAwaitedByDetachedLoad && hasRejectedUnheard(mock, factory.module)) {
                factory.isInCurrentWalk = true;
                mocksToRetry.append(mock);
            }
        }
        for (auto& [module, waiting] : globalObject->onLoadPlugins.pendingCompiledMocks) {
            auto* mock = uncheckedDowncast<JSModuleMock>(waiting.get());
            if (mock->lateFactoryError && hasRejectedUnheard(mock, module))
                mocksToRetry.append(mock);
        }
        for (size_t index = 0; index < mocksToRetry.size(); ++index) {
            auto* mock = uncheckedDowncast<JSModuleMock>(mocksToRetry.at(index));
            JSValue loadError = mock->lateFactoryError.get();
            mock->run(globalObject, false);
            if (loadError)
                mock->lateFactoryError.set(JSC::getVM(globalObject), mock, loadError);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        for (auto& factory : factories) {
            if (std::exchange(factory.isInCurrentWalk, false))
                continue;
            if (factory.patched->status() != JSC::JSPromise::Status::Pending || (factory.isWaitedFor && !factory.isAwaitedByDetachedLoad) || registeredModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(factory.mock.get())->specifier->tryGetValue().data) != factory.mock.get() || !isInGraph(JSC::AOT::ModuleID(factory.module)))
                continue;
            ++factory.rejectedRequireCount;
        }
        return nullptr;
    }
    if (requester == JSC::AOT::PendingFactoryRequester::Require) {
        for (auto& factory : factories) {
            auto* registered = registeredModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(factory.mock.get())->specifier->tryGetValue().data);
            if (factory.patched->status() != JSC::JSPromise::Status::Pending || registered == factory.mock.get() || !isInGraph(JSC::AOT::ModuleID(factory.module)))
                continue;
            unsigned dropped = std::exchange(factory.rejectedRequireCount, 0) + std::exchange(factory.joinedFetchInFlight, false);
            if (registered)
                registered->followingDroppedFetches += dropped;
            if (!registered)
                globalObject->onLoadPlugins.latestCompiledFactoryCalls.removeAllMatching([&](const auto& each) { return each.first == factory.module; });
        }
        for (const auto& factory : factories) {
            if (factory.patched->status() == JSC::JSPromise::Status::Pending)
                return factory.patched.get();
        }
        return nullptr;
    }
    bool asksForFirstTime = !state || state.isString();
    if (asksForFirstTime) {
        auto import = requester == JSC::AOT::PendingFactoryRequester::ImportCall ? JSC::AOT::currentImportCall(globalObject) : std::nullopt;
        JSC::MarkedArgumentBuffer callers;
        if (requester == JSC::AOT::PendingFactoryRequester::ImportCall) {
            for (JSObject* factory : findRequestingFactories(globalObject, import ? import->callerModule : JSC::AOT::ModuleID(), import ? import->importTarget : JSC::AOT::ModuleID(), import ? import->callSequenceNumber : UINT32_MAX))
                callers.append(factory);
        }
        JSC::JSArray* callerArray = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), callers);
        RETURN_IF_EXCEPTION(scope, nullptr);
        JSC::MarkedArgumentBuffer list;
        list.append(state ? state : JSValue(callerArray));
        JSC::JSArray* newState = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (import) {
            newState->putDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->source, JSC::jsNumber(import->callerModule.index()));
            newState->putDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->index, JSC::jsNumber(import->callSequenceNumber));
        }
        state = newState;
    }
    auto* list = JSC::asArray(state);
    // A load starts its factories one at a time and checks after each, so whatever it has started is below it.
    for (auto& factory : factories.mutableSpan().subspan(setAside)) {
        // A require() does not check again, so what it started concerns only loads that lead there.
        if (factory.isWaitedFor || ((!asksForFirstTime || factory.wasStartedByRequire) && !isInGraph(JSC::AOT::ModuleID(factory.module))))
            continue;
        JSValue fetch = list->getIndexQuickly(0);
        // What the original imports may import it back.
        if (requester == JSC::AOT::PendingFactoryRequester::Loader && fetch.isString() && (factory.wasStartedByRequire || !isInGraph(JSC::AOT::ModuleID(factory.module))) && isBelowOriginal(globalObject, factory, asString(fetch)->tryGetValue().data))
            continue;
        factory.isWaitedFor = true;
        uncheckedDowncast<JSModuleMock>(factory.mock.get())->isFactoryUnawaited = false;
        factory.isAwaitedByOwnFetch = requester == JSC::AOT::PendingFactoryRequester::Loader && fetch.isString() && JSValue::strictEqual(globalObject, fetch, uncheckedDowncast<JSModuleMock>(factory.mock.get())->specifier.get());
        RETURN_IF_EXCEPTION(scope, nullptr);
        factory.isAwaitedByDetachedLoad = requester == JSC::AOT::PendingFactoryRequester::DetachedLoad;
        if (factory.isAwaitedByDetachedLoad && factory.joinedFetchInFlight)
            factory.patched->performPromiseThen(JSC::getVM(globalObject), globalObject, jsUndefined(), jsUndefined(), JSC::JSPromise::create(JSC::getVM(globalObject), globalObject->promiseStructure()));
        list->push(globalObject, factory.patched.get());
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    if (list->length() > 1) {
        JSValue started = list->pop(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        list->putDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->value, started);
        return uncheckedDowncast<JSC::JSPromise>(started);
    }
    // What the loader fetches may be in a graph that one of those factories waits for. The mocked module itself is not: a factory's own loads get the original's key.
    JSValue first = list->getIndexQuickly(0);
    if (requester != JSC::AOT::PendingFactoryRequester::ImportCall && (!first.isString() || JSC::getVM(globalObject).synchronousModuleQueue()))
        return nullptr;
    String keyOfFetch;
    if (first.isString()) {
        keyOfFetch = asString(first)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    auto* callers = first.isString() ? nullptr : JSC::asArray(first);
    auto isCaller = [&](JSObject* mock) {
        if (!callers)
            return uncheckedDowncast<JSModuleMock>(mock)->specifier->tryGetValue().data != keyOfFetch;
        for (unsigned index = 0; index < callers->length(); ++index) {
            if (callers->getIndexQuickly(index) == JSValue(mock))
                return true;
        }
        return false;
    };
    Vector<JSObject*, 2> requestingFactories;
    for (unsigned index = 0; callers && index < callers->length(); ++index)
        requestingFactories.append(asObject(callers->getIndexQuickly(index)));
    JSValue source = list->getDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->source);
    auto import = source ? std::optional(JSC::AOT::CurrentImportCall { JSC::AOT::ModuleID(source.asUInt32()), JSC::AOT::currentLoadTarget(globalObject).value_or(JSC::AOT::ModuleID()), list->getDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->index).asUInt32() }) : std::nullopt;
    for (auto& factory : factories.mutableSpan().subspan(setAside)) {
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (factory.patched->status() != JSC::JSPromise::Status::Pending)
            continue;
        // A mock that ended or was replaced only blocks the load that started it. If another load requests the module, that one resumes too.
        if (mock->isDetached || registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) != mock) {
            // A test file that has ended does not resume.
            if (factory.isAwaitedByImporter && mock->firstLoadTestFile == globalObject->onLoadPlugins.testFile && isInGraph(JSC::AOT::ModuleID(factory.module)))
                factory.patched.get()->resolve(globalObject, JSC::getVM(globalObject), JSC::jsUndefined());
            continue;
        }
        if (!callers && factory.isWaitedFor && isCaller(mock) && isInGraph(JSC::AOT::ModuleID(factory.module)) && !mayFactoryAwaitFetch(globalObject, mock, keyOfFetch)) {
            list->putDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->value, factory.patched.get());
            return factory.patched.get();
        }
        if (isCaller(mock) || (!callers && factory.isAwaitedByOwnFetch))
            continue;
        if (requestingFactories.isEmpty() && callers && import && requester == JSC::AOT::PendingFactoryRequester::ImportCall && isRequestedByFactoryModule(globalObject, mock, *import) && (import->importTarget.index() == factory.module || reachesOriginal(globalObject, factory, import->importTarget)))
            continue;
        if (!requestingFactories.isEmpty() && !waitsForMockOf(globalObject, mock, requestingFactories, import))
            continue;
        if (isInGraph(JSC::AOT::ModuleID(factory.module))) {
            if (JSC::AOT::isCurrentImportTarget(globalObject, JSC::AOT::ModuleID(factory.module)))
                ++mock->waitingImportCount;
            else
                factory.isAwaitedByImporter = true;
            if (auto requested = JSC::AOT::currentLoadTarget(globalObject))
                factory.modulesRequestedByWaiters.appendIfNotContains(requested->index());
            for (JSObject* caller : requestingFactories) {
                if (!factory.waitingFactories.containsIf([&](const auto& other) { return other.get() == caller; }))
                    factory.waitingFactories.append(JSC::Strong<JSC::JSObject> { JSC::getVM(globalObject), caller });
            }
            list->putDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->value, factory.patched.get());
            return factory.patched.get();
        }
    }
    return nullptr;
}
#endif

#if ENABLE(AOT)
// As in keyOfImportWhileModuleMocksRun(): an import is recorded on the chain of every running factory that it does not wait for. Without an async context the importing file decides.
static bool isWaitingForModule(Zig::GlobalObject*, BunPlugin::OnLoad::RunningModuleMock&, const String& start, const String& mocked, Vector<String>& unfinished);

// As in redirectedModuleKey(): for an import, the modules that have yet to finish.
static WTF::BitVector unfinishedModulesOfLoad(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID requested, JSC::AOT::LoadGraphMode graphMode)
{
    // A mocked module is unfinished while its factory is pending.
    WTF::BitVector unsettledMocks;
    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules) {
        for (auto& [specifier, value] : *virtualModules) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            if (!mock || mock->state == JSModuleMock::State::Settled)
                continue;
            if (auto file = JSC::AOT::findModule(specifier, specifier.hash()))
                unsettledMocks.set(file->index());
        }
    }
    return JSC::AOT::unfinishedModulesInLoadGraph(globalObject, requested, graphMode, unsettledMocks);
}

uint32_t addToFactoryImportChains(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID importer, JSC::AOT::ModuleID requested, JSC::AOT::LoadKind loadedBy)
{
    uint32_t moment = loadedBy == JSC::AOT::LoadKind::Import ? ++globalObject->onLoadPlugins.moduleMockSequenceNumber : globalObject->onLoadPlugins.moduleMockSequenceNumber;
    if (globalObject->onLoadPlugins.runningModuleMocks.isEmpty()) [[likely]]
        return moment;
    Vector<JSModuleMock*, 1> replaced, unawaited;
    String key = JSC::AOT::moduleFilePath(requested);
    for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
        auto* mock = uncheckedDowncast<JSModuleMock>(running.mock.get());
        String mocked = mock->specifier->tryGetValue().data;
        if (isStillRegisteredModuleMock(globalObject, mocked, mock)) [[likely]]
            continue;
        auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(globalObject->vm(), mocked));
        bool isFetchInFlight = entry && !entry->record();
        Vector<String> unfinished;
        if (!isFetchInFlight)
            unawaited.append(mock);
        else if (mocked == key || isWaitingForModule(globalObject, running, key, mocked, unfinished))
            replaced.append(mock);
    }
    for (auto* mock : replaced)
        mock->giveUp(globalObject);
    for (auto* mock : unawaited)
        mock->detach(globalObject);
    Vector<JSObject*, 2> callers = factoriesInAsyncContext(globalObject);
    // A required module is recorded as is.
    auto collectRecordedModules = [&](JSC::AOT::LoadGraphMode graphMode) {
        if (loadedBy != JSC::AOT::LoadKind::Require)
            return unfinishedModulesOfLoad(globalObject, requested, graphMode);
        WTF::BitVector booked;
        booked.set(requested.index());
        return booked;
    };
    Vector<BunPlugin::OnLoad::RunningModuleMock*, 2> recordingFactories;
    for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
        auto* mock = uncheckedDowncast<JSModuleMock>(running.mock.get());
        // The caller of a createRequire() function is unknown.
        bool isOwnFactoryCall = callers.contains(mock);
        if (isOwnFactoryCall || (importer && (callers.isEmpty() ? running.compiledImportChain.get(importer.index()) || isWrittenIn(mock, importer) : !waitsForMockOf(globalObject, mock, callers, JSC::AOT::CurrentImportCall { importer, requested, moment }))))
            recordingFactories.append(&running);
    }
    // A requester that does not wait for the module's mock gets its original, and every factory that it counts as records that.
    auto mocksRequestedModule = [&](auto* running) { return uncheckedDowncast<JSModuleMock>(running->mock.get())->unevaluatedCompiledModule == requested.index(); };
    bool getsOriginal = recordingFactories.containsIf(mocksRequestedModule);
    for (auto* running : recordingFactories) {
        auto* ownMock = uncheckedDowncast<JSModuleMock>(running->mock.get());
        bool isFromChain = importer && loadedBy == JSC::AOT::LoadKind::Import && ownMock->unevaluatedCompiledModule && running->compiledImportChain.get(importer.index());
        if (isFromChain && (mocksRequestedModule(running) ? Bun__AOT__runsTestFilesAgain() : collectRecordedModules(JSC::AOT::LoadGraphMode::OriginalRoot).get(*ownMock->unevaluatedCompiledModule)))
            Bun::recordRepeatedFileRun(globalObject, ownMock->specifier->tryGetValue().data, "a file that its original loads imports it"_s);
        if (importer && loadedBy == JSC::AOT::LoadKind::Import && mocksRequestedModule(running) && running->compiledImportChain.get(importer.index()))
            globalObject->onLoadPlugins.compiledModulesGivenOriginal.add(uncheckedDowncast<JSModuleMock>(running->mock.get())->specifier->tryGetValue().data, Vector<uint32_t, 2>()).iterator->value.appendIfNotContains(importer.index());
        else if (importer && loadedBy == JSC::AOT::LoadKind::Require && mocksRequestedModule(running) && running->compiledImportChain.get(importer.index()))
            running->compiledRequirersGivenOriginal.appendIfNotContains(importer.index());
        running->compiledImportChain.merge(collectRecordedModules(getsOriginal ? JSC::AOT::LoadGraphMode::OriginalRoot : JSC::AOT::LoadGraphMode::RespectMocks));
        if (auto own = uncheckedDowncast<JSModuleMock>(running->mock.get())->unevaluatedCompiledModule; own && !mocksRequestedModule(running))
            running->compiledImportChain.clear(*own);
    }
    return moment;
}

bool isRequiredByCompiledFactory(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID required, JSC::AOT::ModuleID requirer)
{
    auto& plugins = globalObject->onLoadPlugins;
    // Only imports reach a patched module itself.
    Vector<JSObject*, 2> callers = findRequestingFactories(globalObject, requirer, JSC::AOT::ModuleID());
    for (size_t index = 0; index < callers.size(); ++index) {
        auto mocked = uncheckedDowncast<JSModuleMock>(callers[index])->unevaluatedCompiledModule;
        for (const auto& running : plugins.runningModuleMocks) {
            if (mocked && running.compiledImportChain.get(*mocked) && !callers.contains(running.mock.get()))
                callers.append(running.mock.get());
        }
    }
    return plugins.compiledMockFactories.containsIf([&](const auto& factory) {
        if (factory.module != required.index() || factory.patched->status() != JSC::JSPromise::Status::Pending)
            return false;
        auto* own = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        String path = own->specifier->tryGetValue().data;
        // The original has a key of its own, and a require() cannot wait for that load either.
        auto* original = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(globalObject->vm(), originalModuleKey(path)));
        auto* cyclic = original && original->record() ? dynamicDowncast<JSC::CyclicModuleRecord>(original->record()) : nullptr;
        if (original && (!original->record() || (cyclic && !cyclic->isSCCEvaluated())))
            return false;
        if (callers.contains(own))
            return true;
        if (own->isDetached || registeredModuleMock(globalObject, path) != own || !isWrittenIn(own, requirer))
            return false;
        return callers.isEmpty() || !Bun::haveUnfinishedImporterInCommon(globalObject, path, uncheckedDowncast<JSModuleMock>(callers[0])->specifier->tryGetValue().data);
    });
}

bool isRequestedByCompiledFactory(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module)
{
    auto import = JSC::AOT::currentImportCall(globalObject);
    Vector<JSObject*, 2> callers = findRequestingFactories(globalObject, import ? import->callerModule : JSC::AOT::ModuleID(), import ? import->importTarget : JSC::AOT::ModuleID(), import ? import->callSequenceNumber : UINT32_MAX);
    if (callers.isEmpty()) {
        // The call to mock.module() itself called this factory.
        auto* patch = import ? registeredModuleMock(globalObject, JSC::AOT::moduleFilePath(module)) : nullptr;
        if (patch && patch->hasPendingPatch && patch->unevaluatedCompiledModule == module.index() && isRequestedByFactoryModule(globalObject, patch, *import))
            return true;
        return import && globalObject->onLoadPlugins.compiledMockFactories.containsIf([&](const auto& factory) {
            return factory.module == module.index() && factory.patched->status() == JSC::JSPromise::Status::Pending && isRequestedByFactoryModule(globalObject, uncheckedDowncast<JSModuleMock>(factory.mock.get()), *import);
        });
    }
    // The call to mock.module() itself called this factory, which has awaited since.
    if (auto* patch = import ? registeredModuleMock(globalObject, JSC::AOT::moduleFilePath(module)) : nullptr; patch && patch->hasPendingPatch && patch->unevaluatedCompiledModule == module.index() && callers.contains(patch))
        return true;
    for (const auto& factory : globalObject->onLoadPlugins.compiledMockFactories) {
        if (factory.module != module.index() || factory.patched->status() != JSC::JSPromise::Status::Pending)
            continue;
        // A settled factory does not block an import(), even if its waiters have not been notified.
        // If it failed below a load of another file, the failure belongs to that load until it has been notified.
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        bool hasFailedBelowAnotherFile = mock->state == JSModuleMock::State::NotCalled && mock->moduleRequestedByLoad != module.index();
        if (import && mock->state != JSModuleMock::State::Running && !hasFailedBelowAnotherFile)
            continue;
        if (callers.contains(mock))
            return true;
        // A mock that ended or was replaced does not concern new requests.
        if (mock->isDetached || registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) != mock)
            continue;
        if (!waitsForMockOf(globalObject, mock, callers, import))
            return true;
    }
    return false;
}

static std::optional<size_t> recordBodyMock(Zig::GlobalObject* globalObject, JSC::CallFrame* callframe, ModuleMockFunction function)
{
    auto& vm = JSC::getVM(globalObject);
    auto& plugins = globalObject->onLoadPlugins;
    if (!plugins.replayingFile.isNull())
        return std::nullopt;
    String file = callerPath(vm, callframe);
    std::optional<JSC::AOT::ModuleID> module = Bun::compiledModuleForPath(file);
    if (!module)
        return std::nullopt;
    BunPlugin::OnLoad::BodyMock recorded { file, module->index(), static_cast<uint8_t>(function), false, false, {}, {}, {}, false };
    JSC::AOT::forEachEvaluatingModuleOnStack(vm, callframe, [&](JSC::AOT::ModuleID body) {
        if (body == *module)
            recorded.isFromOwnBody = true;
        else if (recorded.importers.contains(body.index()) || recorded.importersByCall.contains(body.index()))
            return;
        // A body that is on the stack below the file's own body has required the file, so it is the parent of the file's module object.
        else if (recorded.isFromOwnBody || JSC::AOT::importsStatically(globalObject, body, *module))
            recorded.importers.append(body.index());
        else
            recorded.importersByCall.append(body.index());
    });
    if (!recorded.isFromOwnBody && recorded.importers.isEmpty() && recorded.importersByCall.isEmpty())
        return std::nullopt;
    for (uint32_t other : plugins.modulesWithBodyMocks) {
        if (other != recorded.module && !recorded.importers.contains(other) && !recorded.importersByCall.contains(other) && JSC::AOT::isBeingEvaluated(globalObject, JSC::AOT::ModuleID(other)))
            recorded.importersByCall.append(other);
    }
    for (size_t index = 0; index < std::min<size_t>(callframe->argumentCount(), 2); ++index)
        recorded.arguments.append(JSC::Strong<JSC::Unknown> { vm, callframe->uncheckedArgument(index) });
    if (!plugins.modulesWithBodyMocks.contains(recorded.module))
        plugins.modulesWithBodyMocks.append(recorded.module);
    plugins.bodyMocks.append(WTF::move(recorded));
    return plugins.bodyMocks.size() - 1;
}
#endif

__attribute__((minsize)) static JSC::EncodedJSValue mockModule(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, ModuleMockFunction function)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!globalObject) [[unlikely]] {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "Cannot run mock from a different global context"_s));
        return {};
    }

    if (callframe->argumentCount() < 1) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a module and function"_s));
        return {};
    }

    if (!callframe->argument(0).isString()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a module name string"_s));
        return {};
    }

    JSC::JSString* specifierString = callframe->argument(0).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    WTF::String specifier = specifierString->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (specifier.isEmpty()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a module and function"_s));
        return {};
    }

    if (specifier.contains('\0')) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a module name without null bytes"_s));
        return {};
    }

    JSC::JSValue factory = callframe->argument(1);
    bool spy = false;
    if (!factory.isCallable()) {
        if (function == ModuleMockFunction::MockModule || !(factory.isUndefined() || factory.isObject())) {
            scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a function"_s));
            return {};
        }
        if (JSObject* options = factory.getObject()) {
            JSValue spyValue = options->get(globalObject, JSC::Identifier::fromString(vm, "spy"_s));
            RETURN_IF_EXCEPTION(scope, {});
            spy = spyValue.toBoolean(globalObject);
        }
        factory = JSValue();
    }

    WTF::String written = specifier;
    JSC::JSString* writtenString = specifierString;
    bool exists = false;
    if (resolveModuleMockSpecifier(globalObject, callframe, specifierString, specifier, exists))
        globalObject->onLoadPlugins.mustDoExpensiveRelativeLookup = true;
    RETURN_IF_EXCEPTION(scope, {});

#if ENABLE(AOT)
    if (auto compiledModule = globalObject->vm().hasCompiledCode() ? JSC::AOT::findVariantToMock(globalObject, specifier, Bun::findMockedModule(specifier)) : std::nullopt; compiledModule && !JSC::AOT::mayBeMocked(globalObject, *compiledModule)) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, JSC::AOT::mockModuleErrorMessage(globalObject, specifier, Bun::uncompiledCallerFile(vm, callframe))));
        return {};
    }
#endif

    if (!factory && !spy) {
        if (JSC::JSString* manualMock = findManualModuleMock(globalObject, callerPath(vm, callframe), written, specifier))
            factory = manualMock;
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSModuleMock* mock = JSModuleMock::create(vm, globalObject->mockModule.mockModuleStructure.getInitializedOnMainThread(globalObject), factory, specifierString, writtenString, function);
    mock->spy = spy;
    mock->isFromPreload = JSMock__isInPreload(globalObject);
    if (!mock->isFromPreload)
        globalObject->onLoadPlugins.mockingModules.add(callerPath(vm, callframe));
#if ENABLE(AOT)
    std::optional<size_t> remembered;
    if (vm.hasCompiledCode() && !mock->isFromPreload)
        remembered = recordBodyMock(globalObject, callframe, function);
    auto remembersThrow = makeScopeExit([&] {
        auto& recorded = globalObject->onLoadPlugins.bodyMocks;
        if (remembered && *remembered < recorded.size() && vm.exceptionForInspection()) [[unlikely]]
            recorded[*remembered].threw = true;
    });
#endif
    // Nothing a builtin imports can import the mock back, so it never needs the generated module.
    if (exists && !isBuiltinModuleKey(specifier)) {
        auto* factoryFunction = factory ? dynamicDowncast<JSC::JSFunction>(factory) : nullptr;
        if (!factory || factory.isString())
            mock->importsOriginal = true;
        else if (factoryFunction && !factoryFunction->isHostFunction()) {
            auto* executable = factoryFunction->jsExecutable();
            mock->importsOriginal = executable->parameterCount() || mentionsOriginalModule(globalObject, callframe, executable->source().view(), specifier);
            RETURN_IF_EXCEPTION(scope, {});
        }
#if ENABLE(AOT)
        else if (JSObject* compiled = factory.getObject(); compiled && compiled->vm().hasCompiledCode() && JSC::AOT::CompiledCallee::isCompiledCallee(compiled)) {
            mock->importsOriginal = JSC::AOT::CompiledCallee::length(compiled) || JSC::AOT::mayImportOwnOriginal(compiled);
            for (String other : mock->importsOriginal ? Vector<String>() : JSC::AOT::requestedOriginals(compiled)) {
                if (Bun::isBuiltinModule(other))
                    continue;
                JSC::JSString* otherString = jsString(vm, other);
                bool otherExists = false;
                resolveModuleMockSpecifier(globalObject, callframe, otherString, other, otherExists);
                RETURN_IF_EXCEPTION(scope, {});
                mock->importsOriginal |= other == specifier;
            }
        }
#endif
    }

#if ENABLE(AOT)
    if (globalObject->vm().hasCompiledCode())
        JSC::AOT::evictLoadedModules(globalObject);
#endif
    LoadedModule loaded = findLoadedModule(globalObject, specifierString);
    RETURN_IF_EXCEPTION(scope, {});
    JSModuleMock* previous = registeredModuleMock(globalObject, specifier);
    [[maybe_unused]] bool wasMocked = previous;
#if ENABLE(AOT)
    if (previous && previous->isFromPreload && previous->state == JSModuleMock::State::Running && !previous->wasFactoryStartedByRequire && !mock->isFromPreload && vm.hasCompiledCode() && Bun__AOT__runsTestFilesAgain()) [[unlikely]]
        Bun::recordRepeatedFileRun(globalObject, specifier, "it was mocked while the factory of the mock of a preload ran"_s);
    if (auto file = vm.hasCompiledCode() && Bun::isBunTest && !mock->isFromPreload ? Bun::compiledModuleForPath(specifier) : std::nullopt)
        JSC::AOT::tellIfMockedBelowImport(globalObject, *file, Bun::compiledModuleForPath(callerPath(vm, callframe)));
    if (auto module = vm.hasCompiledCode() && previous ? Bun::findMockedModule(specifier) : std::nullopt)
        JSC::AOT::willEndMockOfBuiltin(globalObject, *module, JSC::AOT::MockEnd::Replaced);
    if (JSValue previousFactory = previous ? previous->factory.get() : JSValue())
        mock->replacesOriginalImportingMock = previous->importsOriginal && previousFactory.isCallable();
    // See didUnmockCompiledFile(). A file whose exports are restored has no module under its key.
    // vi.mock() evicts what an earlier test file loaded, so the module under the original's key is the original. mock.module() evicts nothing.
    auto actualKeyExports = JSC::AOT::ActualKeyExports::None;
    if (loaded.compiledModule) {
        if (!previous && mock->isOfVitest() && !mock->isFromPreload && !isInNodeModules(specifier) && JSC::AOT::mayTakeRunUnderActualKey(globalObject, *loaded.compiledModule) && JSC::AOT::evaluatedBy(globalObject, *loaded.compiledModule) == JSC::AOT::LoadedBy::EarlierTestFile)
            JSC::AOT::releaseModuleAndImporters(globalObject, *loaded.compiledModule, Bun::compiledModuleForPath(callerPath(vm, callframe)));
        actualKeyExports = JSC::AOT::restoreActualKeyExports(globalObject, *loaded.compiledModule, !mock->isOfVitest());
    }
    bool isOnlyUnderActualKey = actualKeyExports == JSC::AOT::ActualKeyExports::Restored;
    if (vm.hasCompiledCode() && !previous && !loaded.compiledModule && (loaded.commonJSModule || loaded.esmNamespace)) {
        JSValue loadedExports = loaded.commonJSModule ? loaded.commonJSModule->getDirect(vm, Bun::builtinNames(vm).exportsPublicName()) : JSValue(loaded.esmNamespace);
        Bun::willMockReloadedFile(globalObject, specifier, loadedExports);
    }
    // A mock that replaces another does not change who was linked to the module before the first, unless the first patched the module.
    Vector<BunPlugin::OnLoad::CompiledImporterLinkedBeforeMock> linkedBeforeEarlierMock;
    auto carryOver = makeScopeExit([&] {
        globalObject->onLoadPlugins.compiledImportersLinkedBeforeMocks.appendVector(linkedBeforeEarlierMock);
    });
    if (vm.hasCompiledCode()) {
        auto& linkedAhead = globalObject->onLoadPlugins.compiledImportersLinkedBeforeMocks;
        for (auto& linked : linkedAhead) {
            if (previous && previous->isOfVitest() && linked.mocked == specifier)
                linkedBeforeEarlierMock.append(linked);
        }
        linkedAhead.removeAllMatching([&](const auto& linked) { return linked.mocked == specifier; });
        auto hasRun = [](JSC::AbstractModuleRecord* record) {
            auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record);
            return cyclic && cyclic->status() == JSC::CyclicModuleRecord::Status::Evaluated;
        };
        // An ES module holds a CommonJS file by a record under another key, so compare the files.
        auto mocked = wasMocked ? std::nullopt : Bun::compiledModuleForPath(specifier);
        // An unevaluated importer is reloaded to get the mock if the module is unevaluated too.
        Vector<String, 2> reloadedImporters;
        for (auto& [mapKey, entry] : Bun::testFileModuleLoader(globalObject)->moduleMap()) {
            auto* importer = entry->record();
            if (!mocked || !importer || hasRun(importer) || !JSC::AOT::isCompiledModuleRecord(importer))
                continue;
            for (auto& imported : importer->loadedModules().values()) {
                if (JSC::AOT::compiledModuleForRecord(globalObject, imported.m_module.get()) == mocked && hasRun(imported.m_module.get()))
                    linkedAhead.append({ specifier, String(mapKey.first) });
            }
            // The load that left the importer may have ended before it reached the module, so the loader has no such request.
            auto fileOfImporter = JSC::AOT::compiledModuleForRecord(globalObject, importer);
            if (fileOfImporter && !JSC::AOT::hasStartedLoading(globalObject, *mocked) && JSC::AOT::importsStatically(globalObject, *fileOfImporter, *mocked))
                reloadedImporters.append(String(mapKey.first));
        }
        if (!reloadedImporters.isEmpty()) [[unlikely]]
            linkedAhead.removeAllMatching([&](const auto& linked) { return reloadedImporters.contains(linked.importer); });
    }
#endif

    // Like Vitest, vi.mock() in a test file doesn't patch a module that a preload loaded. The file loads its own mocked copy,
    // and the preload's module is restored when the file ends. mock.module() and jest.mock() patch it in place.
    // Nor does it patch a package, which vi.resetModules() leaves loaded, or what vi.importActual() returned: the factory has to stay lazy.
    // Nor does vi.doMock() patch what a test file loaded. This file's importers keep it. What an earlier file left is loaded again: in Vitest a file starts with nothing loaded.
    bool isDoMock = function == ModuleMockFunction::ViDoMock;
    unsigned loadedByTestFile = globalObject->onLoadPlugins.testFileOfModule.get(specifier);
#if ENABLE(AOT)
    // The loader fetches nothing for a compiled module.
    auto testFileOf = [&](JSC::AOT::LoadedBy loadedBy) {
        unsigned testFile = globalObject->onLoadPlugins.testFile;
        return loadedBy == JSC::AOT::LoadedBy::ThisTestFile ? testFile : loadedBy == JSC::AOT::LoadedBy::EarlierTestFile ? testFile - 1
                                                                                                                         : 0;
    };
    // The loader fetched the key for an earlier test file, and the compiled module has been loaded since.
    if (loaded.compiledModule && loadedByTestFile && !previous && !loaded.esmNamespace && !loaded.commonJSModule && JSC::AOT::hasInstances(globalObject, *loaded.compiledModule) && JSC::AOT::evaluatedBy(globalObject, *loaded.compiledModule) == JSC::AOT::LoadedBy::ThisTestFile)
        loadedByTestFile = globalObject->onLoadPlugins.testFile;
    // The end of an earlier test file may have emptied the key. The first request after that reloaded the mock.
    if (previous && loaded.compiledModule && !loadedByTestFile) {
        if (!previous->firstLoadTestFile)
            previous->firstLoadTestFile = testFileOf(JSC::AOT::activeMockReloadedBy(globalObject, *loaded.compiledModule));
        loadedByTestFile = previous->firstLoadTestFile;
        if (mock->importsOriginal && previous->patchedLoadTestFile)
            loadedByTestFile = previous->patchedLoadTestFile;
        // A patching mock leaves the key to the test file that loaded the module.
        if (!loadedByTestFile && !loaded.esmNamespace && !loaded.commonJSModule && JSC::AOT::wasPatchedAfterEvaluation(globalObject, *loaded.compiledModule))
            loadedByTestFile = testFileOf(JSC::AOT::fetchedBy(globalObject, *loaded.compiledModule));
    } else if (loaded.compiledModule && !loadedByTestFile && !loaded.esmNamespace && !loaded.commonJSModule && !isOnlyUnderActualKey)
        loadedByTestFile = testFileOf(JSC::AOT::fetchedBy(globalObject, *loaded.compiledModule));
    // After `delete require.cache[key]` nothing is loaded under the key.
    auto previousMockedFile = loaded.compiledModule ? loaded.compiledModule : Bun::compiledModuleForPath(specifier);
    bool isPreviousMockKeyEmpty = previous && !previous->isUnderActualKey && previousMockedFile && JSC::AOT::wasActiveMockEntryRemoved(globalObject, *previousMockedFile);
#endif
    bool wasLoadedByImportActual = globalObject->onLoadPlugins.loadedByImportActual.remove(specifier);
#if ENABLE(AOT)
    // So does an original that ran beside an earlier mock.
    bool ranBesidePrevious = previous && !previous->isFromPreload && loaded.compiledModule && JSC::AOT::hasIntactOriginal(globalObject, *loaded.compiledModule) && !restoresCompiledFile(globalObject, previous, specifier);
    bool coversImportedActual = wasLoadedByImportActual || ranBesidePrevious || (previous && previous->coversImportedActual);
#endif
    bool remainsOriginal = wasLoadedByImportActual || isInNodeModules(specifier) || (isDoMock && loadedByTestFile == globalObject->onLoadPlugins.testFile);
    bool keepsLoadedModule = mock->isOfVitest() && Bun::isBunTest && !mock->isFromPreload && !isBuiltinModuleKey(specifier) && (!loadedByTestFile || remainsOriginal || isDoMock);
    // In Vitest a module that has yet to run imports it after this call, and gets the mock. Here it is linked already, so only a patch reaches it.
    if (keepsLoadedModule && loaded.esmNamespace && hasUnevaluatedImporter(globalObject, loaded.esmNamespace->moduleRecord(), callerPath(vm, callframe)))
        keepsLoadedModule = false;
#if ENABLE(AOT)
    // stashLoadedModule() evicts the original that the preload's mock has required, and the mock as its requirer.
    if (keepsLoadedModule && remainsOriginal && previous && previous->isFromPreload && !isPreviousMockKeyEmpty && loaded.compiledModule && JSC::AOT::tryEvictRequirerOfOriginal(globalObject, *loaded.compiledModule))
        isPreviousMockKeyEmpty = true;
    if (keepsLoadedModule && loaded.compiledModule && JSC::AOT::isLinkedForPendingImporter(globalObject, *loaded.compiledModule, Bun::compiledModuleForPath(callerPath(vm, callframe))))
        keepsLoadedModule = false;
    // The same for a compiled module with an active mock, which the loader does not have.
    if (keepsLoadedModule && loaded.compiledModule && JSC::AOT::hasUnevaluatedActiveMockImporter(globalObject, *loaded.compiledModule, Bun::compiledModuleForPath(callerPath(vm, callframe)))) {
        mock->keepsActiveMockForImporters = false;
        keepsLoadedModule = false;
    }
    // So does a compiled module that a failed load had linked: its importers have yet to be evaluated.
    if (keepsLoadedModule && loaded.compiledModule && JSC::AOT::hasImporterLinkedBeforeFailure(globalObject, *loaded.compiledModule)) {
        JSC::AOT::releaseEarlierImporters(globalObject, *loaded.compiledModule);
        RETURN_IF_EXCEPTION(scope, {});
        mock->keepsActiveMockForImporters = false;
        keepsLoadedModule = false;
    }
    // In `bun test` such a mock patches the entry of the preload's mock, which importers of earlier test files hold.
    if (!keepsLoadedModule && previous && previous->isFromPreload && loaded.compiledModule && JSC::AOT::hasActiveMock(globalObject, *loaded.compiledModule))
        mock->keepsActiveMockForImporters = false;
    if (auto file = previous && vm.hasCompiledCode() ? Bun::compiledModuleForPath(specifier) : std::nullopt)
        JSC::AOT::willReplaceMock(globalObject, *file);
    // In `bun test` a waiting Vitest mock has stashed the module: a patching mock finds nothing loaded, and waits too.
    bool replacesMock = false;
    bool isOriginalOfReplacedMock = false;
    bool waitsForUnloadedMock = !keepsLoadedModule && !mock->isFromPreload && previous && !previous->isFromPreload && loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule
        && !JSC::AOT::wasReleasedByLoader(globalObject, *loaded.compiledModule) && JSC::AOT::hasIntactOriginal(globalObject, *loaded.compiledModule) && !JSC::AOT::hasActiveMock(globalObject, *loaded.compiledModule);
    if (waitsForUnloadedMock) {
        coversImportedActual |= restoresCompiledFile(globalObject, previous, specifier);
        unmockModule(globalObject, previous, specifier, mock, false);
        RETURN_IF_EXCEPTION(scope, {});
        JSC::AOT::displaceEntryParent(globalObject, *loaded.compiledModule);
        previous = nullptr;
        loaded = findLoadedModule(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }
    // The importers of the replaced module have been evaluated, and nothing loads it again for them.
    std::optional<unsigned> endedMockModule;
    unsigned endedMockTestFile = 0;
    if (keepsLoadedModule && previous && !previous->isFromPreload) {
        endedMockModule = previous->unevaluatedCompiledModule;
        // runCompiledMock() sets it for every mock that waited. One that kept the module replaced no unevaluated body.
        bool waitsAgain = globalObject->onLoadPlugins.pendingCompiledMocks.containsIf([&](const auto& waiting) { return waiting.second.get() == previous; });
        if (endedMockModule && (waitsAgain || previous->state == JSModuleMock::State::Running || JSC::AOT::hasIntactOriginal(globalObject, JSC::AOT::ModuleID(*endedMockModule))))
            endedMockModule = std::nullopt;
        endedMockTestFile = previous->firstLoadTestFile;
    }
#endif
    if (keepsLoadedModule && previous && !previous->isFromPreload) {
#if ENABLE(AOT)
        auto* restoredMock = vm.hasCompiledCode() ? findPreloadMockToRestore(globalObject, previous, specifier) : nullptr;
#endif
        unmockModule(globalObject, previous, specifier, mock);
        RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
        replacesMock = true;
        mock->wasInstalledOnPreloadMock = previous->wasInstalledOnPreloadMock;
        // The end of that mock has moved the preload's module back under the key, and this mock stashes it again.
        if (restoredMock) {
            mock->didStashPreloadMock = remainsOriginal;
            restoredMock->isUnderActualKey = remainsOriginal;
        }
#endif
        previous = nullptr;
        loaded = findLoadedModule(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }
    bool isLoadInFlight = loaded.staleESMEntry;
    if (keepsLoadedModule && remainsOriginal && (loaded.esmNamespace || loaded.commonJSModule)) {
        // Before the move, while its importers are found under this key.
        if (loadedByTestFile != globalObject->onLoadPlugins.testFile) {
            ModulesToEvict evict;
            evict.onlyImportersFromEarlierTestFiles = true;
            evict.patchedESModules.append(specifier);
            evict.patchedCommonJSModules.append(specifier);
            evict.packagesToStash.append(specifier);
            evictModulesAndTheirImporters(globalObject, WTF::move(evict));
            RETURN_IF_EXCEPTION(scope, {});
        }
        stashLoadedModule(globalObject, specifier);
        RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
        // It is now under the key of the original, instead of the module that an earlier mock of the test file had stashed.
        if (auto* ofPreload = vm.hasCompiledCode() && !previous && !mock->didStashPreloadMock ? displacedPreloadMock(globalObject, specifier) : nullptr)
            ofPreload->isUnderActualKey = false;
#endif
        mock->didStashLoadedModule = !wasLoadedByImportActual;
        loaded = findLoadedModule(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }
#if ENABLE(AOT)
    // moveLoadedModule() leaves the entry of a failed load under the key, where it is stale. Compiled files have such entries too.
    bool keepsFailedEntry = false;
    if (keepsLoadedModule && remainsOriginal && loaded.compiledModule) {
        auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, specifier));
        keepsFailedEntry = (entry && entry->status() >= JSC::ModuleRegistryEntry::Status::FetchFailed) || JSC::AOT::isFailedLoadRoot(globalObject, *loaded.compiledModule);
    }
#endif
    if (keepsLoadedModule) {
        loaded.staleESMEntry |= !!std::exchange(loaded.esmNamespace, nullptr);
        loaded.staleCommonJSEntry |= !!std::exchange(loaded.commonJSModule, nullptr);
    }

    // Left for later, the body of a linked module would assign over the patch. It can't run ahead of an import whose own body is up the stack, though.
    using Status = JSC::CyclicModuleRecord::Status;
    auto* linked = loaded.esmNamespace ? dynamicDowncast<JSC::CyclicModuleRecord>(loaded.esmNamespace->moduleRecord()) : nullptr;
    JSC::JSPromise* pendingBody = nullptr;
    if (linked && linked->status() == Status::Linked && !linked->hasLiveExports() && !anyUnevaluatedImport(linked, [](JSC::CyclicModuleRecord* imported) { return imported->status() == Status::Evaluating; })) {
        JSC::JSPromise* evaluating = linked->evaluate(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        evaluating->markAsHandled();
        if (evaluating->status() == JSC::JSPromise::Status::Rejected) {
            scope.throwException(globalObject, evaluating->result());
            return {};
        }
        // It waits for an import that is asynchronous, e.g. a module that a preload mocks with an async factory.
        if (evaluating->status() == JSC::JSPromise::Status::Pending)
            pendingBody = evaluating;
        loaded = findLoadedModule(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
        previous = registeredModuleMock(globalObject, specifier);
    }

#if ENABLE(AOT)
    bool isEarlierMockPending = previous && loaded.compiledModule && globalObject->onLoadPlugins.pendingCompiledMocks.containsIf([&](const auto& waiting) {
        return waiting.first == loaded.compiledModule->index() && waiting.second.get() == previous;
    });
    // A held import() has requested the original. In `bun test` the load in flight runs it although another mock is installed meanwhile.
    if (loaded.compiledModule && JSC::AOT::hasInFlightOriginalRequest(globalObject, *loaded.compiledModule))
        mock->importsOriginal = true;
    // In `bun test` the load that failed with the original of the earlier mock left a failed entry, which this mock evicts below.
    bool didDisplacedMockLoadFail = keepsLoadedModule && previous && previous->wasRequested && loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule && originalEvaluationError(globalObject, specifier);
    // A preload mock does not end when a test file installs another over it.
    if (previous)
        transferOriginalLoad(vm, previous, mock);
    if (previous && !keepsLoadedModule && !previous->isFromPreload && loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule)
        JSC::AOT::didPatchPendingMock(globalObject, *loaded.compiledModule);
#endif
    // With an earlier mock in place, what's loaded isn't the original any more, so inherit what that mock saved.
    if (previous && !keepsLoadedModule) {
        mock->originalExports.setMayBeNull(vm, mock, previous->originalExports.get());
        mock->originalNamespace.setMayBeNull(vm, mock, previous->originalNamespace.get());
        mock->patchedNamespace.setMayBeNull(vm, mock, previous->patchedNamespace.get());
        mock->originalExportsOfEvictedModule.setMayBeNull(vm, mock, previous->originalExportsOfEvictedModule.get());
        mock->patchOrder = previous->patchOrder;
        if (JSValue exports = previous->originalCommonJSExports.get())
            mock->originalCommonJSExports.set(vm, mock, exports);
#if ENABLE(AOT)
        mock->unevaluatedCompiledModule = previous->unevaluatedCompiledModule;
        mock->lostCommonJSExportsToReset = previous->lostCommonJSExportsToReset;
        mock->patchesPreloadMock = previous->patchesPreloadMock;
        mock->firstLoadTestFile = previous->firstLoadTestFile;
        mock->wasInstalledOverFailedLoad = loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule && (previous->importsOriginal || previous->wasInstalledOverFailedLoad) && originalEvaluationError(globalObject, specifier);
        if (!mock->wasInstalledOverFailedLoad)
            globalObject->onLoadPlugins.pendingCompiledMocks.removeAllMatching([&](const auto& waiting) { return waiting.second.get() == previous && !isUnloadedVariant(globalObject, specifier, waiting.first); });
#endif
    } else {
        if (loaded.esmNamespace)
            mock->originalExports.set(vm, mock, JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure()));
        if (loaded.commonJSModule) {
            JSValue exports = loaded.commonJSModule->exportsObject();
            RETURN_IF_EXCEPTION(scope, {});
            mock->originalCommonJSExports.set(vm, mock, exports);
        }
#if ENABLE(AOT)
        // The program keeps the require.cache entry of a compiled require() of a built-in module.
        if (vm.hasCompiledCode() && !loaded.commonJSModule && isBuiltinModuleKey(specifier)) {
            JSValue entry = Bun::compiledRequireCacheEntry(globalObject, specifier);
            RETURN_IF_EXCEPTION(scope, {});
            if (entry && entry.isObject()) {
                JSValue exports = entry.getObject()->get(globalObject, Bun::builtinNames(vm).exportsPublicName());
                RETURN_IF_EXCEPTION(scope, {});
                mock->originalCommonJSExports.set(vm, mock, exports);
            }
        }
#endif
    }

#if ENABLE(AOT)
    // If a load will reach the module, the mock waits for it, as in `bun test`. Also if the end of the earlier mock restored a preload mock.
    // Also if the factory awaits: called here, it would leave nothing to load until it settles.
    if (endedMockModule && (JSC::AOT::willReloadAfterMockRemoval(globalObject, JSC::AOT::ModuleID(*endedMockModule)) || JSC::AOT::hasActiveMock(globalObject, JSC::AOT::ModuleID(*endedMockModule)) || JSC::AOT::hasInstances(globalObject, JSC::AOT::ModuleID(*endedMockModule)) || Bun::hasModuleMockUnsettledAsyncFactory(mock)))
        endedMockModule = std::nullopt;
    if (endedMockModule) {
        mock->unevaluatedCompiledModule = endedMockModule;
        mock->firstLoadTestFile = endedMockTestFile;
    } else if (keepsLoadedModule && loaded.compiledModule) {
        // Until it is loaded, the mock keeps the owner that it found.
        mock->firstLoadTestFile = loadedByTestFile;
    }
    if (vm.hasCompiledCode()) {
        static constexpr std::array<ASCIILiteral, 5> calls { "mock.module"_s, "vi.mock"_s, "jest.mock"_s, "vi.doMock"_s, "jest.doMock"_s };
        JSValue factory = mock->factory.get();
        auto counted = endedMockModule ? std::optional(JSC::AOT::ModuleID(*endedMockModule)) : loaded.compiledModule;
        JSC::AOT::countMockCall(globalObject, counted, loaded.esmNamespace || loaded.commonJSModule ? "the loader holds it"_s : "nothing holds it"_s, calls[static_cast<size_t>(function)], mock->spy ? "spy"_s : !factory ? "no factory"_s
                : factory.isString()                                                                                                                                                                                       ? "a file of __mocks__"_s
                : mock->importsOriginal                                                                                                                                                                                    ? "a factory that takes the original"_s
                                                                                                                                                                                                                           : "a factory"_s);
    }
    // A failed load registered the file without linking it: `bun test` treats its entry as stale, and evicting it evicts every failed module.
    bool wasInEarlierFailedGraph = loaded.compiledModule && keepsLoadedModule && JSC::AOT::wasLinkedByFailedGraph(globalObject, *loaded.compiledModule, true);
    bool wasLinkedByEarlierFailedLoad = loaded.compiledModule && keepsLoadedModule && JSC::AOT::wasLinkedBeforeTestFile(globalObject, *loaded.compiledModule);
    bool isFromEarlierFailedLoad = wasLinkedByEarlierFailedLoad && !remainsOriginal;
    bool hasStalePlainEntry = keepsFailedEntry || wasLinkedByEarlierFailedLoad || (loaded.compiledModule && keepsLoadedModule && hasLoadedVariant(globalObject, specifier)) || (loaded.compiledModule && JSC::AOT::wasRegisteredByFailedLoad(globalObject, *loaded.compiledModule)) || wasInEarlierFailedGraph;
    mock->isOverFailedGraphFile = loaded.compiledModule && keepsLoadedModule && JSC::AOT::wasLinkedByFailedGraph(globalObject, *loaded.compiledModule);
    mock->isOverEarlierLinkedFile = wasInEarlierFailedGraph;
    bool isLinkedOnlyUnderMocks = false;
    if (loaded.compiledModule && !endedMockModule && !loaded.esmNamespace && !loaded.commonJSModule) {
        isLinkedOnlyUnderMocks = JSC::AOT::evaluateLinkedModuleBeforeMock(globalObject, *loaded.compiledModule, wasMocked, mock->isOfVitest(), keepsLoadedModule);
        RETURN_IF_EXCEPTION(scope, {});
        if (replacesMock && !mock->spy)
            isOriginalOfReplacedMock = JSC::AOT::keepCommonJSFileDroppedByLoader(globalObject, *loaded.compiledModule);
        else if (JSC::AOT::tryReleaseCommonJSFileDroppedByLoader(globalObject, *loaded.compiledModule)) [[unlikely]] {
            loaded = findLoadedModule(globalObject, specifierString);
            RETURN_IF_EXCEPTION(scope, {});
        } else if (replacesMock)
            JSC::AOT::reportReloadableFileKept(globalObject, *loaded.compiledModule);
    }
    // As in `bun run`, the factory waits for the first import of a module that has not loaded. require() registers "node:" modules neither with the loader
    // nor in require.cache: see overridableRequire().
    auto hasLoaded = [&](JSC::AOT::ModuleID module) {
        if (isLinkedOnlyUnderMocks || !JSC::AOT::hasStartedLoading(globalObject, module))
            return false;
        if (!specifier.startsWith("node:"_s))
            return true;
        return JSC::AOT::hasBeenImportedSinceReset(globalObject, module);
    };
    // The end of an earlier test file's mock brought the file's own run back, and nothing has loaded the preload's mock since.
    bool isOverRestoredRun = previous && previous->isFromPreload && loaded.compiledModule && JSC::AOT::evaluatedBy(globalObject, *loaded.compiledModule) == JSC::AOT::LoadedBy::EarlierTestFile && !JSC::AOT::hasActiveMock(globalObject, *loaded.compiledModule) && !JSC::AOT::hasPendingMock(globalObject, *loaded.compiledModule);
    bool isUnderPreloadMock = previous && previous->isFromPreload && !isPreviousMockKeyEmpty && (keepsLoadedModule || !previous->lostOriginalsToReset) && (previous->state == JSModuleMock::State::Settled || (isOverRestoredRun && keepsLoadedModule) || (!previous->readUninitializedVariable && loaded.compiledModule && JSC::AOT::evaluatedBy(globalObject, *loaded.compiledModule) == JSC::AOT::LoadedBy::Preload));
    mock->patchesRestoredRun = isOverRestoredRun && !keepsLoadedModule;
    mock->foundNothingLoaded = waitsForUnloadedMock || !loaded.compiledModule || !hasLoaded(*loaded.compiledModule);
    // A module that is being evaluated or awaits may belong to a load of this test file, so its entry is not stale.
    bool wasLoadedBeforeTestFile = loaded.compiledModule && !isOnlyUnderActualKey && !loaded.esmNamespace && !loaded.commonJSModule && !mock->isFromPreload && (!previous || isUnderPreloadMock) && (hasLoaded(*loaded.compiledModule) || (previous && JSC::AOT::isMockLoadedInPreload(globalObject, *loaded.compiledModule)))
        && !JSC::AOT::isEntryOwnedByTestFile(globalObject, *loaded.compiledModule) && !JSC::AOT::isBeingEvaluated(globalObject, *loaded.compiledModule) && loadedByTestFile != globalObject->onLoadPlugins.testFile && (keepsLoadedModule || (globalObject->onLoadPlugins.testFile > 1 && !(previous && previous->unevaluatedCompiledModule && !previous->wasRestoredByTestMock)));
    // Read here, because the eviction may clear `loaded.compiledModule`.
    auto patchedFile = wasLoadedBeforeTestFile && !keepsLoadedModule ? loaded.compiledModule : std::nullopt;
    auto compiledModuleToEvict = wasLoadedBeforeTestFile && keepsLoadedModule && !remainsOriginal ? loaded.compiledModule : std::nullopt;
    // stashLoadedModule() empties the key until the mock ends. `bun test` assigns the key to the test file that fetches it meanwhile: see runVirtualModule().
    if (keepsLoadedModule && remainsOriginal && !mock->isFromPreload && loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule && hasLoaded(*loaded.compiledModule))
        JSC::AOT::didRemoveEntryForMock(globalObject, *loaded.compiledModule);
    // What this test file linked and nothing evaluated counts as loaded earlier, but `bun test` makes no pass for it.
    auto ranBy = loaded.compiledModule ? JSC::AOT::evaluatedBy(globalObject, *loaded.compiledModule) : JSC::AOT::LoadedBy::Nobody;
    bool wasEvaluatedBeforeTestFile = ranBy == JSC::AOT::LoadedBy::EarlierTestFile || ranBy == JSC::AOT::LoadedBy::Preload;
    // moveLoadedModule() leaves the entry of a failed import() root under its key, where `bun test` treats it as stale.
    // A mock that keeps the loaded module treats any failed entry as stale, unless it stashes the entry. A patch of a failed module also evicts its importers.
    bool treatsFailedEntryAsStale = !mock->isOfVitest() || (keepsLoadedModule && !remainsOriginal);
    bool hasFailedPlainEntry = loaded.compiledModule && ((mock->isOfVitest() && JSC::AOT::isFailedLoadRoot(globalObject, *loaded.compiledModule)) || (treatsFailedEntryAsStale && JSC::AOT::isFailedESModule(globalObject, *loaded.compiledModule)));
    // evictModulesAndTheirImporters() finds no compiled modules. One that it would have evicted has run, so the mock precedes its next load.
    bool isEvictedDataFile = loaded.compiledModule && JSC::AOT::isEvictedDataFile(globalObject, *loaded.compiledModule);
    bool isReleasedFromLoader = loaded.compiledModule && (waitsForUnloadedMock || isOnlyUnderActualKey || JSC::AOT::wasReleasedByLoader(globalObject, *loaded.compiledModule));
    if (isEvictedDataFile)
        JSC::AOT::setMockedAfterEviction(globalObject, *loaded.compiledModule, !keepsLoadedModule && !isReleasedFromLoader);
    isReleasedFromLoader |= isEvictedDataFile;
    // That eviction removes the module itself too if it is neither patched nor displaced.
    if (isFromEarlierFailedLoad || (compiledModuleToEvict && wasEvaluatedBeforeTestFile))
        JSC::AOT::releaseModuleAndImporters(globalObject, *loaded.compiledModule, Bun::compiledModuleForPath(callerPath(vm, callframe)));
    // Nor does moveLoadedModule() move a failed import() root, so an automock loads the original again.
    else if (keepsLoadedModule && mock->importsOriginal && !mock->factory.get() && hasFailedPlainEntry && JSC::AOT::isFailedLoadRoot(globalObject, *loaded.compiledModule) && JSC::AOT::hasInstances(globalObject, *loaded.compiledModule) && JSC::AOT::isSynchronousESModule(globalObject, *loaded.compiledModule)) {
        JSC::AOT::releaseModuleAndImporters(globalObject, *loaded.compiledModule, Bun::compiledModuleForPath(callerPath(vm, callframe)));
        mock->didStashCompiledModule = remainsOriginal && !wasLoadedByImportActual;
    }
    // Evicting the original that an earlier mock left evicts its requirer, so nothing is left to set aside.
    if (keepsLoadedModule && remainsOriginal && loaded.compiledModule && !endedMockModule && !loaded.esmNamespace && !loaded.commonJSModule && JSC::AOT::hasInstances(globalObject, *loaded.compiledModule) && hasLoaded(*loaded.compiledModule)) {
        bool isRequirer = isRequirerOfOwnOriginal(globalObject, specifier);
        RETURN_IF_EXCEPTION(scope, {});
        if (isRequirer) {
            JSC::AOT::releaseModuleAndImporters(globalObject, *loaded.compiledModule, Bun::compiledModuleForPath(callerPath(vm, callframe)));
            evictModulesAndTheirImporters(globalObject, Vector<String> { originalModuleKey(specifier) });
            RETURN_IF_EXCEPTION(scope, {});
            mock->didStashCompiledModule |= !wasLoadedByImportActual;
        }
    }
    if (keepsLoadedModule && remainsOriginal && loaded.compiledModule && !endedMockModule && !loaded.esmNamespace && !loaded.commonJSModule && JSC::AOT::isDataFile(*loaded.compiledModule) && JSC::AOT::takeRequirerOfOwnOriginal(globalObject, *loaded.compiledModule))
        JSC::AOT::releaseModuleAndImporters(globalObject, *loaded.compiledModule, Bun::compiledModuleForPath(callerPath(vm, callframe)));
    bool keepsCompiledModule = (keepsLoadedModule || isReleasedFromLoader) && loaded.compiledModule && !endedMockModule && !loaded.esmNamespace && !loaded.commonJSModule && hasLoaded(*loaded.compiledModule)
        && JSC::AOT::tryKeepOriginalIntact(globalObject, *loaded.compiledModule, !isReleasedFromLoader && !loadedByTestFile && !remainsOriginal && !isDoMock, Bun::compiledModuleForPath(callerPath(vm, callframe)), !mock->importsOriginal || mock->factory.get() || (JSC::AOT::hasInstances(globalObject, *loaded.compiledModule) && JSC::AOT::isSynchronousESModule(globalObject, *loaded.compiledModule) && !JSC::AOT::isFailedLoadRoot(globalObject, *loaded.compiledModule)));
    RETURN_IF_EXCEPTION(scope, {});
    mock->coversImportedActual = keepsCompiledModule && coversImportedActual;
    if (isOnlyUnderActualKey)
        globalObject->onLoadPlugins.filesWithRestoredOriginal.set(specifier, globalObject->onLoadPlugins.testFile);
    if (actualKeyExports == JSC::AOT::ActualKeyExports::Superseded && mock->isOfVitest() && !coversImportedActual)
        globalObject->onLoadPlugins.filesWithEarlierOriginal.set(specifier, globalObject->onLoadPlugins.testFile);
    else if (mock->isOfVitest() && vm.hasCompiledCode())
        globalObject->onLoadPlugins.filesWithEarlierOriginal.remove(specifier);
    // `bun test` loads the original anew.
    if (keepsCompiledModule && keepsLoadedModule && mock->importsOriginal && !isInNodeModules(specifier)) {
        if (ranBy == JSC::AOT::LoadedBy::EarlierTestFile)
            JSC::AOT::noteKeptOriginal(globalObject, *loaded.compiledModule, !mock->factory.get());
        else if (JSC::AOT::wasLoadedByPreloadHook(globalObject, *loaded.compiledModule))
            Bun::recordRepeatedFileRun(globalObject, specifier, "a hook of a preload loaded it"_s);
    }
    if (keepsCompiledModule && keepsLoadedModule && remainsOriginal && (JSC::AOT::tryEvictUnderActualKey(globalObject, *loaded.compiledModule) || actualKeyExports == JSC::AOT::ActualKeyExports::Superseded)) {
        evictModulesAndTheirImporters(globalObject, Vector<String> { originalModuleKey(specifier) });
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (mock->coversImportedActual && (JSC::AOT::hasInstances(globalObject, *loaded.compiledModule) || JSC::AOT::isReloadableImport(globalObject, *loaded.compiledModule)))
        JSC::AOT::setIsUnderActualKey(globalObject, *loaded.compiledModule, true);
    if (keepsCompiledModule && wasLoadedByImportActual && Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, originalModuleKey(specifier)))) {
        evictModulesAndTheirImporters(globalObject, Vector<String> { originalModuleKey(specifier) });
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (keepsCompiledModule && !mock->coversImportedActual && (isDoMock || isInNodeModules(specifier))) {
        JSC::AOT::didDisplaceIntactOriginal(globalObject, *loaded.compiledModule, isInNodeModules(specifier));
        // It lies under the key of the original already, and the end of this mock leaves it there.
        bool didStashFile = keepsLoadedModule && !isOriginalOfReplacedMock && Bun::didStashCompiledFile(globalObject, specifier);
        mock->didStashCompiledModule |= didStashFile;
        if (didStashFile && Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, originalModuleKey(specifier)))) {
            evictModulesAndTheirImporters(globalObject, Vector<String> { originalModuleKey(specifier) });
            RETURN_IF_EXCEPTION(scope, {});
        }
        // It is now under the key of the original. A module of a preload mock that patched the file is the file.
        if (auto* ofPreload = didStashFile ? displacedPreloadMock(globalObject, specifier) : nullptr; ofPreload && ofPreload->unevaluatedCompiledModule)
            ofPreload->isUnderActualKey = false;
    }
    auto wait = [&](JSC::AOT::ModuleID variant) {
        auto& waiting = globalObject->onLoadPlugins.pendingCompiledMocks;
        uint32_t module = variant.index();
        waiting.removeAllMatching([&](const auto& entry) { return entry.first == module; });
        waiting.append({ module, JSC::Strong<JSC::JSObject> { vm, mock } });
        JSC::AOT::deferMock(globalObject, variant, mock->importsOriginal ? JSC::AOT::FactoryFailurePolicy::RetryFactory : JSC::AOT::FactoryFailurePolicy::CacheError);
    };
    bool formsWait = false;
    if (vm.hasCompiledCode() && !loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule) {
        auto variants = JSC::AOT::importAttributeVariants(globalObject, specifier);
        if (auto file = Bun::findMockedModule(specifier); file && !variants.contains(*file))
            variants.append(*file);
        if (std::ranges::count_if(variants, [&](JSC::AOT::ModuleID variant) { return JSC::AOT::hasStartedLoading(globalObject, variant); }) > 1) {
            // The loader holds a variant from its load until its key is evicted, and again once it is requested, mocked or not.
            // Computed before the loop below, which makes this mock wait for every variant.
            Vector<JSC::AOT::ModuleID, 2> loadedVariants;
            for (JSC::AOT::ModuleID variant : variants) {
                if (JSC::AOT::hasStartedLoading(globalObject, variant) && (JSC::AOT::hasActiveMock(globalObject, variant) || !JSC::AOT::wasVariantEvictedByMock(globalObject, variant)))
                    loadedVariants.append(variant);
            }
            // In `bun test` an entry with several import types is stale (findLoadedESModule()), and evicting it evicts every failed module.
            // What only require() has loaded is not registered with the loader.
            // So does evicting what an earlier test file or a preload loaded: see wasLoadedByEarlierTestFile below.
            // A mock that keeps the loaded module treats what is still under the key as stale, and finds nothing if it stashed the module.
            // The loader fetches nothing for a compiled file, so the variants say who loaded it.
            bool keepsVariants = keepsLoadedModule && (isDoMock || remainsOriginal || std::ranges::any_of(variants, [&](JSC::AOT::ModuleID variant) { return JSC::AOT::wasVariantRegisteredByPreload(globalObject, variant); }));
            bool setsAside = remainsOriginal || (isDoMock && std::ranges::any_of(variants, [&](JSC::AOT::ModuleID variant) { return JSC::AOT::wasVariantFetchedByTestFile(globalObject, variant); }));
            bool hasStaleEntry = std::ranges::count_if(loadedVariants, [&](JSC::AOT::ModuleID variant) { return JSC::AOT::hasBeenImported(globalObject, variant) || JSC::AOT::wasLoadedByImport(globalObject, variant); }) > 1
                || (keepsVariants && !setsAside && !loadedVariants.isEmpty());
            auto asking = Bun::compiledModuleForPath(callerPath(vm, callframe));
            for (JSC::AOT::ModuleID variant : variants) {
                if (hasStaleEntry && loadedVariants.contains(variant))
                    JSC::AOT::releaseImporters(globalObject, variant);
                JSC::AOT::tryKeepOriginalIntact(globalObject, variant, false, asking);
                RETURN_IF_EXCEPTION(scope, {});
                wait(variant);
                RETURN_IF_EXCEPTION(scope, {});
            }
            formsWait = true;
            mock->foundVariants = !keepsVariants && (previous ? previous->foundVariants : !hasStaleEntry && !loadedVariants.isEmpty());
            // The key, not the variant, belongs to the test file that last fetched any of them.
            bool hasEarlierLoadedVariant = mock->foundVariants && !mock->isFromPreload && (!previous || previous->isFromPreload) && globalObject->onLoadPlugins.testFile > 1
                && std::ranges::any_of(variants, [&](JSC::AOT::ModuleID variant) { return JSC::AOT::hasStartedLoading(globalObject, variant) && JSC::AOT::wasLoadedBeforeTestFile(globalObject, variant); })
                && std::ranges::none_of(variants, [&](JSC::AOT::ModuleID variant) { return JSC::AOT::wasVariantFetchedByTestFile(globalObject, variant); });
            if (hasEarlierLoadedVariant || hasStaleEntry) {
                clearCompiledProgramFailures(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                // That eviction removes the key unless the mock patches its module, so whoever loads a variant from here on is this test file.
                if ((keepsLoadedModule && (isDoMock || remainsOriginal)) || hasStaleEntry) {
                    for (JSC::AOT::ModuleID variant : variants) {
                        JSC::AOT::clearLoadedBeforeTestFile(globalObject, variant);
                        JSC::AOT::markVariantEvictedByMock(globalObject, variant);
                    }
                    // What a preload registered and a test file evicted is restored at the end of the test file: see keepPreloadModule() and giveBackPreloadModules().
                    if (!mock->isFromPreload && !loadedVariants.isEmpty()
                        && std::ranges::any_of(variants, [&](JSC::AOT::ModuleID variant) { return JSC::AOT::wasVariantRegisteredByPreload(globalObject, variant); })
                        && std::ranges::none_of(variants, [&](JSC::AOT::ModuleID variant) { return JSC::AOT::wasVariantFetchedByTestFile(globalObject, variant); }))
                        JSC::AOT::scheduleVariantRestore(globalObject, loadedVariants.first(), variants);
                }
            }
        }
    }
    // An active mock keeps what was loaded under it, and the new factory waits for the next load.
    bool waitsOverActiveMock = keepsLoadedModule && loaded.compiledModule && !endedMockModule && !loaded.esmNamespace && !loaded.commonJSModule && (hasLoaded(*loaded.compiledModule) || (previous && JSC::AOT::isActiveMockRegistered(globalObject, *loaded.compiledModule)))
        && JSC::AOT::tryKeepActiveMock(globalObject, *loaded.compiledModule, remainsOriginal && !isPreviousMockKeyEmpty, isDoMock && !loadedByTestFile);
    // The original of this mock is what was loaded under the active mock. A spy uses the real file.
    if (waitsOverActiveMock && !mock->spy) {
        auto kept = JSC::AOT::retainedActiveMockExports(globalObject, *loaded.compiledModule);
        RETURN_IF_EXCEPTION(scope, {});
        mock->originalNamespace.setMayBeNull(vm, mock, kept.namespaceObject);
        if (kept.requiredValue)
            mock->originalCommonJSExports.set(vm, mock, kept.requiredValue);
    }
    bool activatesOnNextLoad = endedMockModule && mock->importsOriginal && mock->factory.get() && JSC::AOT::isResolvedForInFlightLoads(globalObject, JSC::AOT::ModuleID(*endedMockModule));
    if (loaded.compiledModule && !mock->wasInstalledOverFailedLoad && (!endedMockModule || activatesOnNextLoad) && !loaded.esmNamespace && !loaded.commonJSModule && (activatesOnNextLoad || keepsCompiledModule || waitsOverActiveMock || isEarlierMockPending || !hasLoaded(*loaded.compiledModule))) {
        wait(*loaded.compiledModule);
        RETURN_IF_EXCEPTION(scope, {});
        for (JSC::AOT::ModuleID variant : JSC::AOT::importAttributeVariants(globalObject, specifier)) {
            wait(variant);
            RETURN_IF_EXCEPTION(scope, {});
        }
        // A pending load that got the module before it was mocked keeps the module. The mock is for later requests.
        if (!wasMocked && isGivenToPendingLoad(globalObject, specifier))
            JSC::AOT::retainRecordForInFlightLoads(globalObject, *loaded.compiledModule);
        loaded.compiledModule = std::nullopt;
        formsWait = true;
    }
#endif

    JSC::JSPromise* pendingFactory = nullptr;
    // False once the factory itself has re-mocked or unmocked the module, which wins.
    bool isCurrent = true;
    if (loaded.esmNamespace || loaded.compiledModule || loaded.commonJSModule) {
#if ENABLE(AOT)
        mock->replacesRequiredDataFile = loaded.compiledModule && !endedMockModule && JSC::AOT::hasOnlyBeenRequired(globalObject, *loaded.compiledModule) && !JSC::AOT::hasActiveMock(globalObject, *loaded.compiledModule);
        pendingFactory = mock->run(globalObject, endedMockModule && !mock->factory.get());
#else
        pendingFactory = mock->run(globalObject, false);
#endif
        // As in Vitest and Jest, a hoisted factory that reads a variable declared below the call waits for the first import.
#if ENABLE(AOT)
        // An evaluated or mocked compiled module stays as it is, and the next load gets the mock.
        bool compiledModuleWaits = scope.exception() && mock->readUninitializedVariable && loaded.compiledModule && !endedMockModule;
        JSC::Exception* thrownByFactory = compiledModuleWaits ? scope.exception() : nullptr;
        if (compiledModuleWaits && scope.tryClearException()) [[unlikely]] {
            JSC::AOT::ModuleID compiled = *loaded.compiledModule;
            bool staysUnchanged = JSC::AOT::hasInstances(globalObject, compiled) && !JSC::AOT::isFailedESModule(globalObject, compiled) && JSC::AOT::releaseModuleAndImporters(globalObject, compiled, Bun::compiledModuleForPath(callerPath(vm, callframe)));
            staysUnchanged = staysUnchanged || JSC::AOT::tryKeepOriginalIntact(globalObject, compiled, false, Bun::compiledModuleForPath(callerPath(vm, callframe)), true);
            RETURN_IF_EXCEPTION(scope, {});
            if (!staysUnchanged && JSC::AOT::tryKeepActiveMock(globalObject, compiled, remainsOriginal, isDoMock && !loadedByTestFile)) {
                mock->keepsActiveMockForImporters = true;
                staysUnchanged = true;
            }
            if (!staysUnchanged) {
                scope.throwException(globalObject, thrownByFactory);
                return {};
            }
            if (previous && !previous->isFromPreload) {
                unmockModule(globalObject, previous, specifier, mock);
                RETURN_IF_EXCEPTION(scope, {});
                previous = nullptr;
            }
            wait(compiled);
            RETURN_IF_EXCEPTION(scope, {});
            for (JSC::AOT::ModuleID variant : JSC::AOT::importAttributeVariants(globalObject, specifier)) {
                wait(variant);
                RETURN_IF_EXCEPTION(scope, {});
            }
            loaded.compiledModule = std::nullopt;
            formsWait = true;
            mock->droppedSavedOriginal = !!JSC::AOT::mockedModuleEvaluationError(globalObject, compiled);
        }
#endif
        if (scope.exception() && mock->readUninitializedVariable && !loaded.compiledModule && scope.tryClearException()) [[unlikely]] {
            if (previous && !previous->isFromPreload) {
                unmockModule(globalObject, previous, specifier, mock);
                RETURN_IF_EXCEPTION(scope, {});
                previous = nullptr;
            }
            loaded = findLoadedModule(globalObject, specifierString);
            RETURN_IF_EXCEPTION(scope, {});
            loaded.staleESMEntry |= !!std::exchange(loaded.esmNamespace, nullptr);
            loaded.staleCommonJSEntry |= !!std::exchange(loaded.commonJSModule, nullptr);
            mock->originalExports.clear();
            mock->originalNamespace.clear();
            mock->patchedNamespace.clear();
            mock->originalExportsOfEvictedModule.clear();
            mock->originalCommonJSExports.clear();
            mock->patchOrder = 0;
            pendingBody = nullptr;
        }
        RETURN_IF_EXCEPTION(scope, {});
    }
#if ENABLE(AOT)
    if (mock->wasInstalledOverFailedLoad && loaded.compiledModule) {
        isCurrent = isStillRegisteredModuleMock(globalObject, specifier, previous);
        if (isCurrent) {
            wait(*loaded.compiledModule);
            RETURN_IF_EXCEPTION(scope, {});
            for (JSC::AOT::ModuleID variant : JSC::AOT::importAttributeVariants(globalObject, specifier)) {
                wait(variant);
                RETURN_IF_EXCEPTION(scope, {});
            }
            formsWait = true;
        }
        loaded.compiledModule = std::nullopt;
    }
#endif
    if (loaded.esmNamespace || loaded.compiledModule || loaded.commonJSModule) {
        isCurrent = isStillRegisteredModuleMock(globalObject, specifier, previous);

        // The factory may have evicted the module, or require()d it: `() => ({ ...require("./m"), extra })`.
        LoadedModule before = std::exchange(loaded, findLoadedModule(globalObject, specifierString));
        RETURN_IF_EXCEPTION(scope, {});
        if (loaded.esmNamespace != before.esmNamespace) {
            mock->originalExports.clear();
            mock->originalNamespace.clear();
            if (previous)
                mock->originalExportsOfEvictedModule.setMayBeNull(vm, mock, previous->originalExportsOfEvictedModule.get());
        }
        if (before.commonJSModule && loaded.commonJSModule != before.commonJSModule)
            mock->originalCommonJSExports.clear();

        if (!pendingFactory && isCurrent) {
            overrideLoadedModuleExports(globalObject, mock, loaded);
            RETURN_IF_EXCEPTION(scope, {});
            isCurrent = isStillRegisteredModuleMock(globalObject, specifier, previous);
        }
#if ENABLE(AOT)
        // A mock that patches leaves the key to the test file that loaded the module.
        if (loaded.compiledModule && !mock->isFromPreload && !JSC::AOT::hasInstances(globalObject, *loaded.compiledModule)) {
            if (previous && previous->patchedLoadTestFile)
                mock->patchedLoadTestFile = previous->patchedLoadTestFile;
            else if (loadedByTestFile && !previous && JSC::AOT::isReloadableImport(globalObject, *loaded.compiledModule))
                mock->patchedLoadTestFile = loadedByTestFile;
        }
        bool patchesModuleOfPreload = loaded.compiledModule && !loadedByTestFile && ranBy == JSC::AOT::LoadedBy::Preload && JSC::AOT::hasInstances(globalObject, *loaded.compiledModule);
        if (loaded.compiledModule && !mock->firstLoadTestFile && Bun::isBunTest && !mock->isFromPreload && !patchesModuleOfPreload)
            mock->firstLoadTestFile = loadedByTestFile && JSC::AOT::hasInstances(globalObject, *loaded.compiledModule) ? loadedByTestFile : globalObject->onLoadPlugins.testFile;
#endif
    }
    // Its functions are the mock's from here on. What the body assigns is the mock's once it is patched again.
    if (pendingBody && isCurrent)
        pendingFactory = thenWithContext(globalObject, pendingBody, jsFunctionPatchedModuleDidRun, nullptr, mock);

    auto& plugins = globalObject->onLoadPlugins;
    if (isCurrent) {
        plugins.addModuleMock(vm, specifier, mock);
#if ENABLE(AOT)
        for (auto& factory : plugins.compiledMockFactories.span().subspan(plugins.stashedFactoryCount)) {
            auto* earlier = uncheckedDowncast<JSModuleMock>(factory.mock.get());
            if (earlier->retainsFailureForImports && earlier->specifier->tryGetValue().data == specifier)
                earlier->clearRetainedFailure();
        }
        // A require() cannot wait for the factory of a patching mock either. While it is pending over an active mock, loads go to runCompiledMock().
        if (pendingFactory && hasPendingFactory(mock) && !keepsLoadedModule && !isBuiltinModuleKey(specifier) && loaded.compiledModule && !JSC::AOT::isESModule(*loaded.compiledModule) && JSC::AOT::hasActiveMock(globalObject, *loaded.compiledModule)) {
            JSC::AOT::reportMockedFileKept(globalObject, *loaded.compiledModule);
            wait(*loaded.compiledModule);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (previous && !mock->wasInstalledOverFailedLoad)
            globalObject->onLoadPlugins.pendingCompiledMocks.removeAllMatching([&](const auto& waiting) { return waiting.second.get() == previous; });
        if (vm.hasCompiledCode() && !formsWait && !endedMockModule && mock->factory.get()) {
            for (JSC::AOT::ModuleID variant : JSC::AOT::importAttributeVariants(globalObject, specifier)) {
                if (JSC::AOT::hasStartedLoading(globalObject, variant))
                    continue;
                wait(variant);
                RETURN_IF_EXCEPTION(scope, {});
            }
        }
#endif
        if (previous && isLoadInFlight)
            keepInFlightModuleMock(globalObject, previous, specifier, loaded);
        if (previous && previous->isFromPreload && !mock->isFromPreload) {
            plugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, previous });
#if ENABLE(AOT)
            previous->isDisplacedByTestMock = true;
            mock->wasInstalledOnPreloadMock = true;
            // In `bun test` nothing is registered after the displacing mock ended: a patching mock saves the restored CommonJS module, and its end restores that.
            // It patches the require map only, not what an import has loaded of the preload mock.
            auto file = Bun::compiledModuleForPath(specifier);
            mock->didStashPreloadMock = keepsLoadedModule && remainsOriginal && !isPreviousMockKeyEmpty;
            mock->patchesPreloadMock = !keepsLoadedModule && previous->wasRestoredByTestMock && file && !JSC::AOT::isESModule(*file) && !(previous->unevaluatedCompiledModule && !JSC::AOT::wasRequiredUnderPreloadMock(globalObject, *file));
            previous->isUnderActualKey |= mock->didStashPreloadMock;
            previous->wasRestoredByTestMock = false;
#endif
        }
#if ENABLE(AOT)
        // In `bun test` the restored mock never left the list: at the end of the test file it is added over what a preload hook installs here.
        if (previous && previous->isFromPreload && mock->isFromPreload && std::exchange(previous->wasRestoredByTestMock, false))
            plugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, previous });
#endif

        bool wasLoadedByEarlierTestFile = (mock->originalExports || mock->originalCommonJSExports) && !mock->isFromPreload && (!previous || previous->isFromPreload) && plugins.testFile > 1 && plugins.testFileOfModule.get(specifier) != plugins.testFile;
#if ENABLE(AOT)
        loaded.staleESMEntry |= didDisplacedMockLoadFail;
#endif
        if (wasLoadedByEarlierTestFile || loaded.staleESMEntry || loaded.staleCommonJSEntry) {
            ModulesToEvict evict;
            evict.onlyImportersFromEarlierTestFiles = true;
            if (loaded.esmNamespace)
                evict.patchedESModules.append(specifier);
            if (loaded.commonJSModule)
                evict.patchedCommonJSModules.append(specifier);
            if (!loaded.esmNamespace && !loaded.commonJSModule)
                evict.modules.append(specifier);
            evictModulesAndTheirImporters(globalObject, WTF::move(evict));
            RETURN_IF_EXCEPTION(scope, {});
        }
#if ENABLE(AOT)
        if ((wasLoadedBeforeTestFile && (previous || wasEvaluatedBeforeTestFile || hasFailedPlainEntry)) || hasStalePlainEntry) {
            clearCompiledProgramFailures(globalObject, patchedFile);
            RETURN_IF_EXCEPTION(scope, {});
            // The eviction of importers does not wait for the factory.
            if (patchedFile) {
                JSC::AOT::releaseEarlierImporters(globalObject, *patchedFile);
                RETURN_IF_EXCEPTION(scope, {});
            }
            // The loader has no compiled files, but may have importers that run from source.
            // The pass also evicts whatever failed, so it is made only if `bun test` makes one: if an earlier test file or a preload has run the module.
            if (!previous && (wasEvaluatedBeforeTestFile || hasFailedPlainEntry || wasInEarlierFailedGraph || wasLinkedByEarlierFailedLoad)) {
                ModulesToEvict evict;
                evict.keepsFailuresOfCompiledProgram = true;
                evict.onlyImportersFromEarlierTestFiles = true;
                if (keepsLoadedModule && !remainsOriginal && !isBuiltinModuleKey(specifier))
                    evict.modules.append(specifier);
                else
                    evict.patchedESModules.append(specifier);
                evictModulesAndTheirImporters(globalObject, WTF::move(evict));
                RETURN_IF_EXCEPTION(scope, {});
            }
            // That eviction removes the key unless the mock patches or stashes its module, so no later mock of this test file evicts what an earlier one loaded.
            if (compiledModuleToEvict) {
                JSC::AOT::markEntryOwnedByTestFile(globalObject, *compiledModuleToEvict);
                JSC::AOT::releaseFailedESModule(globalObject, *compiledModuleToEvict);
            }
        }
#endif
    }

    JSObject* returned = nullptr;
    if (pendingFactory && isCurrent)
        returned = patchWhenFactorySettles(globalObject, mock, pendingFactory);
#if ENABLE(AOT)
    if (patchedFile)
        JSC::AOT::releasePatchedModuleOfCycle(globalObject, *patchedFile, pendingFactory && isCurrent);
    // A compiled function has no executable, so the build supplies its file. Only if this call has called the factory:
    // otherwise the load that calls it would be taken for the factory's file.
    // Empty for an automock.
    if (JSObject* factory = pendingFactory && isCurrent && vm.hasCompiledCode() && mock->factory ? mock->factory.get().getObject() : nullptr; factory && JSC::AOT::CompiledCallee::isCompiledCallee(factory)) {
        for (auto& running : plugins.runningModuleMocks) {
            if (running.mock.get() == mock)
                running.file = JSC::AOT::declaringFilePath(factory);
        }
    }
#endif

    switch (function) {
    case ModuleMockFunction::JestMock:
    case ModuleMockFunction::JestDoMock:
        return JSValue::encode(callframe->thisValue().toThis(lexicalGlobalObject, JSC::ECMAMode::strict()));
    case ModuleMockFunction::ViDoMock: {
        if (!returned)
            returned = JSC::constructEmptyObject(globalObject);
        JSC::JSFunction* dispose = JSC::JSFunction::create(vm, globalObject, 0, "[Symbol.dispose]"_s, jsFunctionDisposeModuleMock, ImplementationVisibility::Public);
        JSObject* bound = JSC::JSBoundFunction::create(vm, globalObject, dispose, mock, ArgList(), 0, nullptr, makeSource("[Symbol.dispose]"_s, JSC::SourceOrigin(), JSC::SourceTaintedOrigin::Untainted));
        RETURN_IF_EXCEPTION(scope, {});
        returned->putDirect(vm, vm.propertyNames->disposeSymbol, bound, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
        break;
    }
    case ModuleMockFunction::MockModule:
    case ModuleMockFunction::ViMock:
        break;
    }
    return JSValue::encode(returned ? JSValue(returned) : jsUndefined());
}

BUN_DECLARE_HOST_FUNCTION(JSMock__jsModuleMock);
extern "C" JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(JSMock__jsModuleMock, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return mockModule(lexicalGlobalObject, callframe, ModuleMockFunction::MockModule);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionViMock, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return mockModule(lexicalGlobalObject, callframe, ModuleMockFunction::ViMock);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionJestMock, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return mockModule(lexicalGlobalObject, callframe, ModuleMockFunction::JestMock);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionViDoMock, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return mockModule(lexicalGlobalObject, callframe, ModuleMockFunction::ViDoMock);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionJestDoMock, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return mockModule(lexicalGlobalObject, callframe, ModuleMockFunction::JestDoMock);
}

#if ENABLE(AOT)
// A load that reaches the file repeats the call, and so does one that reaches a body that ran then and imports the file.
static void letMockWaitForLoads(Zig::GlobalObject* globalObject, const BunPlugin::OnLoad::BodyMock& recorded, bool waits)
{
    JSC::AOT::setNeedsMockReinstall(globalObject, JSC::AOT::ModuleID(recorded.module), waits);
    for (uint32_t importer : recorded.importers)
        JSC::AOT::setNeedsMockReinstall(globalObject, JSC::AOT::ModuleID(importer), waits);
}

bool reinstallBodyMocks(Zig::GlobalObject* globalObject, const WTF::ScopedLambda<bool(JSC::AOT::ModuleID)>& isReached)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& plugins = globalObject->onLoadPlugins;
    static constexpr std::array<JSC::NativeFunction::Ptr, 5> functions { JSMock__jsModuleMock, jsFunctionViMock, jsFunctionJestMock, jsFunctionViDoMock, jsFunctionJestDoMock };
    static_assert(functions.size() == static_cast<size_t>(ModuleMockFunction::JestDoMock) + 1);
    bool laidSome = false;
    for (size_t index = 0; index < plugins.bodyMocks.size(); ++index) {
        auto isReachedByNumber = [&](uint32_t module) { return isReached(JSC::AOT::ModuleID(module)); };
        auto hasOwnBodyMock = [&](uint32_t importer) {
            return isReachedByNumber(importer) && plugins.modulesWithBodyMocks.contains(importer);
        };
        const auto& recorded = plugins.bodyMocks[index];
        if (!recorded.waits || (!(recorded.isFromOwnBody && isReachedByNumber(recorded.module)) && !recorded.importers.containsIf(isReachedByNumber) && !recorded.importersByCall.containsIf(hasOwnBodyMock)))
            continue;
        plugins.bodyMocks[index].waits = false;
        letMockWaitForLoads(globalObject, plugins.bodyMocks[index], false);
        // In `bun test` the file runs again.
        JSC::AOT::didRepeatMockOfKeptFile(globalObject, JSC::AOT::ModuleID(plugins.bodyMocks[index].module));
        JSC::MarkedArgumentBuffer arguments;
        for (auto& argument : plugins.bodyMocks[index].arguments)
            arguments.append(argument.get());
        JSC::JSFunction* function = JSC::JSFunction::create(vm, globalObject, 2, String(), functions[plugins.bodyMocks[index].function], ImplementationVisibility::Private);
        SetForScope caller(plugins.replayingFile, plugins.bodyMocks[index].file);
        SetForScope<const void*> frame(plugins.replayFrame, nullptr);
        JSC::Exception* thrown = nullptr;
        {
            auto catching = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            JSC::call(globalObject, function, JSC::getCallData(function), jsUndefined(), arguments);
            thrown = catching.exception();
            if (thrown && !catching.tryClearException()) [[unlikely]]
                return laidSome;
        }
        // Swallow what the body caught, and continue with the calls after it.
        if (thrown && !plugins.bodyMocks[index].threw) [[unlikely]] {
            throwException(globalObject, scope, thrown);
            return laidSome;
        }
        laidSome = true;
    }
    // A body whose calls are done may lead to another that still waits.
    for (size_t index = 0; laidSome && index < plugins.bodyMocks.size(); ++index) {
        if (plugins.bodyMocks[index].waits)
            letMockWaitForLoads(globalObject, plugins.bodyMocks[index], true);
    }
    return laidSome;
}
#endif

#if ENABLE(AOT)
// Undoes the mocks of the test file that ended. Those installed by the body of a compiled module are replayed for the next test file that imports it.
static void scheduleBodyMockReplay(Zig::GlobalObject* globalObject, const WTF::UncheckedKeyHashSet<String>& mockingModules, const String& testFile)
{
    auto& recorded = globalObject->onLoadPlugins.bodyMocks;
    std::optional<JSC::AOT::ModuleID> testFileModule = Bun::compiledModuleForPath(testFile);
    recorded.removeAllMatching([&](auto& each) {
        if (testFileModule) {
            each.importers.removeAll(testFileModule->index());
            each.importersByCall.removeAll(testFileModule->index());
        }
        return each.file == testFile || (!each.isFromOwnBody && each.importers.isEmpty() && each.importersByCall.isEmpty());
    });
    auto& modules = globalObject->onLoadPlugins.modulesWithBodyMocks;
    modules.removeAllMatching([&](uint32_t module) { return !recorded.containsIf([&](const auto& each) { return each.module == module; }); });
    for (auto& each : recorded) {
        if (!mockingModules.contains(each.file))
            continue;
        each.waits = true;
        letMockWaitForLoads(globalObject, each, true);
    }
}
#endif

#if ENABLE(AOT)
static void redisplacePreloadMock(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    mock->isDisplacedByTestMock = true;
    globalObject->onLoadPlugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { JSC::getVM(globalObject), mock });
    unmockModule(globalObject, mock, mock->specifier->tryGetValue().data);
}
#endif

static JSC::EncodedJSValue unmock(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, JSValue returned)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto specifier = moduleMockSpecifierArgument(globalObject, callframe, "unmock(module)"_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (JSModuleMock* mock = registeredModuleMock(globalObject, specifier.key)) {
#if ENABLE(AOT)
        // In `bun test` it stays displaced until the end of the test file, so nothing is registered here.
        if (mock->wasRestoredByTestMock)
            return JSValue::encode(returned);
#endif
        if (mock->isFromPreload && !JSMock__isInPreload(globalObject))
            globalObject->onLoadPlugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, mock });
#if ENABLE(AOT)
        if (auto file = vm.hasCompiledCode() && Bun::isBunTest ? Bun::compiledModuleForPath(specifier.key) : std::nullopt)
            JSC::AOT::tellIfMockedBelowImport(globalObject, *file, Bun::compiledModuleForPath(callerPath(vm, callframe)));
#endif
        unmockModule(globalObject, mock, specifier.key);
        RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
        globalObject->onLoadPlugins.filesWithEarlierOriginal.remove(specifier.key);
        didEndMockOverPreload(globalObject, mock, specifier.key);
        RETURN_IF_EXCEPTION(scope, {});
#endif
    }
    return JSValue::encode(returned);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionViUnmock, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return unmock(globalObject, callframe, jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionJestUnmock, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return unmock(globalObject, callframe, callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionImportActualModule, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto specifier = moduleMockSpecifierArgument(globalObject, callframe, "importActual(module)"_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (JSModuleMock* mock = registeredModuleMock(globalObject, specifier.key)) {
#if ENABLE(AOT)
        // As in jsFunctionModuleMockImportOriginal(), if the mock's own factory imports by name.
        if (auto factories = factoriesInAsyncContext(globalObject); vm.hasCompiledCode() && !factories.isEmpty() && factories[0] == mock) {
            auto* asyncContext = globalObject->m_asyncContextData.get();
            JSValue factoryContext = asyncContext->getInternalField(0);
            asyncContext->putInternalField(vm, 0, asyncContextAroundFactoryOf(globalObject, mock));
            JSC::JSPromise* original = importOriginalModule(globalObject, mock, true, callerPath(vm, callframe));
            asyncContext->putInternalField(vm, 0, factoryContext);
            RELEASE_AND_RETURN(scope, JSValue::encode(original));
        }
#endif
        JSC::JSPromise* original = importOriginalModule(globalObject, mock, true, callerPath(vm, callframe));
        RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
        if (auto file = vm.hasCompiledCode() && Bun::isBunTest && original ? Bun::compiledModuleForPath(specifier.key) : std::nullopt)
            JSC::AOT::noteHostImportCall(globalObject, *file, original);
#endif
        return JSValue::encode(original);
    }
#if ENABLE(AOT)
    if (JSValue kept = retainedFailureForImports(globalObject, specifier.key))
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSPromise::rejectedPromise(globalObject, kept)));
#endif

    LoadedModule loaded = findLoadedModule(globalObject, specifier.keyString);
    RETURN_IF_EXCEPTION(scope, {});
    bool isLoaded = loaded.esmNamespace || loaded.commonJSModule || loaded.staleESMEntry || loaded.staleCommonJSEntry;
#if ENABLE(AOT)
    if (unsigned mockedIn = globalObject->onLoadPlugins.filesWithEarlierOriginal.get(specifier.key); mockedIn && mockedIn != globalObject->onLoadPlugins.testFile) [[unlikely]]
        Bun::recordRepeatedFileRun(globalObject, specifier.key, "an earlier test file mocked a later run of it"_s);
    isLoaded |= loaded.compiledModule && JSC::AOT::hasStartedLoading(globalObject, *loaded.compiledModule) && !JSC::AOT::wasReleasedByLoader(globalObject, *loaded.compiledModule);
#endif
    // What a preload loads is given back to the next test file under its own key.
    if (!isLoaded && !JSMock__isInPreload(globalObject))
        globalObject->onLoadPlugins.loadedByImportActual.add(specifier.key);
#if ENABLE(AOT)
    if (auto requested = vm.hasCompiledCode() && Bun::isBunTest ? Bun::compiledModuleForPath(specifier.key) : std::nullopt; requested && !JSC::AOT::hasStartedLoading(globalObject, *requested)) {
        BunPlugin::OnLoad::RunningModuleMock* asking = nullptr;
        for (JSObject* factory : factoriesInAsyncContext(globalObject)) {
            auto* mock = uncheckedDowncast<JSModuleMock>(factory);
            if (!asking && mock->unevaluatedCompiledModule && JSC::AOT::isInLoadGraph(globalObject, *requested, JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule)))
                asking = findRunningModuleMock(globalObject, mock);
        }
        if (asking && JSC::AOT::willRunCopyFromDisk(globalObject)) {
            String copy = originalModuleKey(specifier.key);
            asking->givenTheOriginal.append(copy);
            RELEASE_AND_RETURN(scope, JSValue::encode(importModuleFrom(globalObject, callerPath(vm, callframe), copy)));
        }
    }
#endif
#if ENABLE(AOT)
    std::optional<SetForScope<JSC::CallFrame*>> loaderImportScope;
    if (vm.hasCompiledCode() && factoriesInAsyncContext(globalObject).isEmpty())
        loaderImportScope.emplace(vm.aotState().importFrameInLoader, vm.topCallFrame);
    if (loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule)
        JSC::AOT::registerEvaluatedModule(globalObject, *loaded.compiledModule);
    RETURN_IF_EXCEPTION(scope, {});
#endif
    JSC::JSPromise* loading = importModuleFrom(globalObject, callerPath(vm, callframe), specifier.key);
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    auto isOwnFactory = [&](JSObject* factory) { return uncheckedDowncast<JSModuleMock>(factory)->specifier->tryGetValue().data == specifier.key; };
    if (loaded.compiledModule && Bun::isBunTest)
        JSC::AOT::noteHostImportInFlight(globalObject, *loaded.compiledModule, loading, factoriesInAsyncContext(globalObject).containsIf(isOwnFactory));
#endif
    return JSValue::encode(loading);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireActualModule, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto specifier = moduleMockSpecifierArgument(globalObject, callframe, "requireActual(module)"_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (JSModuleMock* mock = registeredModuleMock(globalObject, specifier.key))
        RELEASE_AND_RETURN(scope, JSValue::encode(requireOriginalModule(globalObject, mock)));
    RELEASE_AND_RETURN(scope, JSValue::encode(requireModuleKey(globalObject, callerPath(vm, callframe), specifier.key)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionImportMockDidLoad, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    String key = asString(callframe->argument(1))->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool isCommonJS = false;
    JSValue mocked = mockExportsOfLoadedModule(globalObject, key, callframe->argument(0), false, isCommonJS);
    RETURN_IF_EXCEPTION(scope, {});
    if (isCommonJS)
        RELEASE_AND_RETURN(scope, JSValue::encode(esmExportsOfCommonJSExports(globalObject, mocked)));
    // As in Vitest. The exports of a module mocked without a factory have no prototype, so that importers find only exports in them.
    if (JSObject* object = mocked.getObject(); object && object->getPrototypeDirect().isNull())
        object->setPrototypeDirect(vm, globalObject->objectPrototype());
    return JSValue::encode(mocked);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionImportMockModule, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto specifier = moduleMockSpecifierArgument(globalObject, callframe, "importMock(module)"_s);
    RETURN_IF_EXCEPTION(scope, {});
    String from = callerPath(vm, callframe);

    bool isMocked = registeredModuleMock(globalObject, specifier.key);
    if (!isMocked) {
        JSC::JSString* manualMock = findManualModuleMock(globalObject, from, specifier.written, specifier.key);
        RETURN_IF_EXCEPTION(scope, {});
        if (manualMock) {
            String key = manualMock->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, JSValue::encode(importModuleKey(globalObject, key)));
        }
    }

#if ENABLE(AOT)
    if (isMocked && vm.hasCompiledCode() && Bun::isBunTest) {
        JSC::AOT::ModuleRequesterScope requesterScope(globalObject, Bun::requesterForUncompiledImportCall(from));
        JSC::JSPromise* imported = Bun::importCompiledModule(globalObject, specifier.key, nullptr, -1);
        if (scope.exception()) [[unlikely]]
            return JSValue::encode(JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
        if (imported)
            return JSValue::encode(imported);
    }
#endif
    JSC::JSPromise* loading = importModuleFrom(globalObject, from, specifier.key);
    RETURN_IF_EXCEPTION(scope, {});
    if (isMocked)
        return JSValue::encode(loading);
    return JSValue::encode(thenWithContext(globalObject, loading, jsFunctionImportMockDidLoad, nullptr, specifier.keyString));
}

static JSC::EncodedJSValue requireMockModule(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, ASCIILiteral signature, bool fromOriginal)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto specifier = moduleMockSpecifierArgument(globalObject, callframe, signature);
    RETURN_IF_EXCEPTION(scope, {});
    String from = callerPath(vm, callframe);

    JSModuleMock* mock = registeredModuleMock(globalObject, specifier.key);
    if (!fromOriginal) {
        if (mock)
            RELEASE_AND_RETURN(scope, JSValue::encode(requireModuleKey(globalObject, from, specifier.key)));
        JSC::JSString* manualMock = findManualModuleMock(globalObject, from, specifier.written, specifier.key);
        RETURN_IF_EXCEPTION(scope, {});
        if (manualMock) {
            String key = manualMock->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, JSValue::encode(requireModuleKey(globalObject, from, key)));
        }
    }

    JSValue original = mock ? requireOriginalModule(globalObject, mock) : requireModuleKey(globalObject, from, specifier.key);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::mockObject(globalObject, original, false)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireMockModule, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return requireMockModule(globalObject, callframe, "requireMock(module)"_s, false);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateMockFromModule, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return requireMockModule(globalObject, callframe, "createMockFromModule(module)"_s, true);
}

// Jest calls every mock's factory again after resetModules(), and loads packages again. Vitest keeps the exports and the packages.
__attribute__((minsize)) static JSC::EncodedJSValue resetModules(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, bool callFactoriesAgain)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    ModulesToEvict evict;
    evict.all = true;
    evict.exceptPackages = !callFactoriesAgain;
#if ENABLE(AOT)
    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules) {
        JSC::JSMap* requireMap = Bun::testFileRequireMap(globalObject);
        for (auto& value : virtualModules->values()) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            if (!mock || (evict.exceptPackages && isInNodeModules(mock->specifier->tryGetValue().data)))
                continue;
            auto file = Bun::compiledModuleForPath(mock->specifier->tryGetValue().data);
            if (!file)
                continue;
            JSValue stored = requireMap->get(globalObject, mock->specifier.get());
            RETURN_IF_EXCEPTION(scope, {});
            if (!stored.isUndefined() || !JSC::AOT::isEvicted(globalObject, *file))
                mock->lostCommonJSExportsToReset = true;
        }
    }
    Bun::willResetModules(globalObject, callFactoriesAgain ? "jest.resetModules()"_s : "vi.resetModules()"_s, evict.exceptPackages);
    RETURN_IF_EXCEPTION(scope, {});
    globalObject->onLoadPlugins.compiledImportersLinkedBeforeMocks.removeAllMatching([&](const auto& linked) { return !evict.exceptPackages || !isInNodeModules(linked.importer); });
    forEachPreloadMock(globalObject, [&](JSModuleMock* mock) {
        if (mock->isUnderActualKey && !(evict.exceptPackages && isInNodeModules(mock->specifier->tryGetValue().data)))
            mock->wasRemovedByReset = std::exchange(mock->isUnderActualKey, false);
    });
    // Also evict what was restored under the key itself, unless it is a package and the reset keeps packages. `bun test` keeps the preload mock displaced until the end of the test file.
    MarkedArgumentBuffer restoredPreloadMocks;
    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules) {
        for (auto& value : virtualModules->values()) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            bool isOfPackage = mock && isInNodeModules(mock->specifier->tryGetValue().data);
            if (!mock || (evict.exceptPackages && isOfPackage))
                continue;
            mock->lostOriginalsToReset = true;
            if (!mock->isFromPreload && (mock->didStashCompiledModule || mock->replacesRequiredDataFile)) {
                String path = mock->specifier->tryGetValue().data;
                // The mock that takes its place below restores nothing.
                if (callFactoriesAgain && mock->state == JSModuleMock::State::Settled)
                    globalObject->onLoadPlugins.dataFilesResetUnderMocks.remove(path);
                else if (auto file = Bun::compiledModuleForPath(path); file && JSC::AOT::isDataFile(*file) && JSC::AOT::isImportedByStatement(globalObject, *file))
                    globalObject->onLoadPlugins.dataFilesResetUnderMocks.set(path, globalObject->onLoadPlugins.testFile);
            }
            // evictModulesAndTheirImporters() only finds registered keys, and compiled files have none.
            if (std::exchange(mock->wouldBeInRegistry, false)) {
                mock->originalNamespace.clear();
                noteMockOutsideRegistry(globalObject, mock->specifier->tryGetValue().data);
            }
            if (!isOfPackage) {
                mock->patchesPreloadMock = false;
                if (auto file = mock->isFromPreload ? Bun::compiledModuleForPath(mock->specifier->tryGetValue().data) : std::nullopt)
                    JSC::AOT::didRemoveActiveMockEntry(globalObject, *file);
            }
            if (std::exchange(mock->wasRestoredByTestMock, false))
                restoredPreloadMocks.append(mock);
        }
    }
    for (size_t i = 0; i < restoredPreloadMocks.size(); ++i) {
        redisplacePreloadMock(globalObject, uncheckedDowncast<JSModuleMock>(restoredPreloadMocks.at(i)));
        RETURN_IF_EXCEPTION(scope, {});
    }
    for (auto& factory : globalObject->onLoadPlugins.compiledMockFactories)
        uncheckedDowncast<JSModuleMock>(factory.mock.get())->clearRetainedFailure();
#endif
    evictModulesAndTheirImporters(globalObject, WTF::move(evict));
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules; virtualModules && vm.hasCompiledCode()) {
        for (auto& value : virtualModules->values()) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            if (!mock || mock->state != JSModuleMock::State::Settled || !isBuiltinModuleKey(mock->specifier->tryGetValue().data))
                continue;
            auto file = Bun::findMockedModule(mock->specifier->tryGetValue().data);
            if (!file || !JSC::AOT::isPatchedLibraryModule(globalObject, *file))
                continue;
            globalObject->onLoadPlugins.pendingCompiledMocks.append({ file->index(), JSC::Strong<JSC::JSObject> { vm, mock } });
            JSC::AOT::deferMock(globalObject, *file, JSC::AOT::FactoryFailurePolicy::CacheError);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
#endif
    // As in Vitest, vi.dynamicImportSettled() doesn't wait for what was being loaded before.
    globalObject->mockModule.dynamicImports.clear();

    // Replace the mocks instead of resetting them, because modules already linked to one keep reading from it.
    if (auto* virtualModules = callFactoriesAgain ? globalObject->onLoadPlugins.virtualModules : nullptr) {
        for (auto& value : virtualModules->values()) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            if (!mock || mock->state != JSModuleMock::State::Settled)
                continue;
            auto* again = JSModuleMock::create(vm, mock->structure(), mock->factory.get(), mock->specifier.get(), mock->writtenSpecifier.get(), mock->function);
            again->spy = mock->spy;
            again->isFromPreload = mock->isFromPreload && JSMock__isInPreload(globalObject);
            if (mock->isFromPreload && !again->isFromPreload)
                globalObject->onLoadPlugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, mock });
            again->importsOriginal = mock->importsOriginal;
            again->patchedNamespace.setMayBeNull(vm, again, mock->patchedNamespace.get());
            again->originalExportsOfEvictedModule.setMayBeNull(vm, again, mock->originalExportsOfEvictedModule.get());
            again->patchOrder = mock->patchOrder;
#if ENABLE(AOT)
            again->lostCommonJSExportsToReset = true;
            for (auto& waiting : globalObject->onLoadPlugins.pendingCompiledMocks) {
                if (waiting.second.get() != mock)
                    continue;
                again->unevaluatedCompiledModule = mock->unevaluatedCompiledModule;
                waiting.second.set(vm, again);
            }
#endif
            value.set(vm, again);
        }
    }

    return JSValue::encode(callframe->thisValue().toThis(lexicalGlobalObject, JSC::ECMAMode::strict()));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionViResetModules, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return resetModules(globalObject, callframe, false);
}

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionJestResetModules, __attribute__((minsize)), (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return resetModules(globalObject, callframe, true);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionMockHoisted, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue factory = callframe->argument(0);
    if (!factory.isCallable()) {
        JSC::throwTypeError(globalObject, scope, "vi.hoisted(factory) requires a function"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::call(globalObject, factory, JSC::getCallData(factory), JSC::jsUndefined(), ArgList())));
}

extern "C" __attribute__((minsize)) void JSMock__putModuleMockFunctions(Zig::GlobalObject* globalObject, JSC::EncodedJSValue encodedMockFn, JSC::EncodedJSValue encodedJest, JSC::EncodedJSValue encodedVi)
{
    auto& vm = JSC::getVM(globalObject);
    UNUSED_PARAM(encodedMockFn);
    auto put = [&](JSC::EncodedJSValue target, ASCIILiteral name, unsigned length, JSC::NativeFunction function) {
        JSValue::decode(target).getObject()->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, name), length, function, ImplementationVisibility::Public, NoIntrinsic, 0);
    };
    put(encodedVi, "mock"_s, 2, jsFunctionViMock);
    put(encodedVi, "doMock"_s, 2, jsFunctionViDoMock);
    put(encodedVi, "unmock"_s, 1, jsFunctionViUnmock);
    put(encodedVi, "doUnmock"_s, 1, jsFunctionViUnmock);
    put(encodedVi, "importActual"_s, 1, jsFunctionImportActualModule);
    put(encodedVi, "importMock"_s, 1, jsFunctionImportMockModule);
    put(encodedVi, "resetModules"_s, 0, jsFunctionViResetModules);
    put(encodedVi, "hoisted"_s, 1, jsFunctionMockHoisted);
    put(encodedJest, "mock"_s, 2, jsFunctionJestMock);
    put(encodedJest, "doMock"_s, 2, jsFunctionJestDoMock);
    put(encodedJest, "unmock"_s, 1, jsFunctionJestUnmock);
    put(encodedJest, "dontMock"_s, 1, jsFunctionJestUnmock);
    put(encodedJest, "requireActual"_s, 1, jsFunctionRequireActualModule);
    put(encodedJest, "requireMock"_s, 1, jsFunctionRequireMockModule);
    put(encodedJest, "createMockFromModule"_s, 1, jsFunctionCreateMockFromModule);
    put(encodedJest, "resetModules"_s, 0, jsFunctionJestResetModules);
}

static bool isRegisteredModuleMock(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier)
{
    return registeredModuleMock(globalObject, specifier) == mock;
}

// False once a later mock.module() or Bun.plugin.clearAll() replaced `mock` while its factory was pending.
static bool didSettlePendingModulePatch(Zig::GlobalObject* globalObject, JSModuleMock* mock, String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    mock->hasPendingPatch = false;
#if ENABLE(AOT)
    restoreStashedFactories(globalObject, mock);
#endif

    specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    return isRegisteredModuleMock(globalObject, mock, specifier);
}

#if ENABLE(AOT)
static bool isRemovedWithPendingLoads(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier)
{
    if (!mock->unevaluatedCompiledModule || mock->endedBeforeOriginal || JSC::AOT::hasStartedLoading(globalObject, JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule)))
        return false;
    if (JSC::AOT::wasEvictedOnceLoaded(globalObject, JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule)))
        return false;
    auto* later = registeredModuleMock(globalObject, specifier);
    bool isAwaitedByImporter = globalObject->onLoadPlugins.compiledMockFactories.containsIf([&](const auto& factory) { return factory.mock.get() == mock && factory.isAwaitedByImporter; });
    if (later && ((mock->state == JSModuleMock::State::Settled && !isAwaitedByImporter && JSC::AOT::hasDelayedImport(globalObject, JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule))) || (mock->unevaluatedCompiledModule && JSC::AOT::needsRetryInDetachedLoad(globalObject, JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule))) || !globalObject->onLoadPlugins.pendingCompiledMocks.containsIf([&](const auto& waiting) { return waiting.second.get() == later; })))
        return false;
    return globalObject->onLoadPlugins.compiledMockFactories.containsIf([&](const auto& factory) { return factory.mock.get() == mock && factory.patched->status() == JSC::JSPromise::Status::Pending && (factory.isWaitedFor || !factory.wasStartedByRequire); });
}
#endif

static void failPendingModulePatch(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, JSValue error)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // The script that failed may have replaced or removed the mock already.
    if (isRegisteredModuleMock(globalObject, mock, specifier)) {
        unmockModule(globalObject, mock, specifier);
        RETURN_IF_EXCEPTION(scope, );
    }
    scope.throwException(globalObject, error);
}

// Mocks replaced or cleared while their factory was pending are no longer in the map.
template<typename Functor>
static void forEachPendingModulePatch(Zig::GlobalObject* globalObject, const Functor& functor)
{
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;
    if (!virtualModules)
        return;
    for (auto& value : virtualModules->values()) {
        auto* mock = dynamicDowncast<JSModuleMock>(value.get());
        if (mock && mock->hasPendingPatch)
            functor(mock);
    }
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool JSMock__hasPendingModulePatches(Zig::GlobalObject* globalObject)
{
    bool hasPending = false;
    forEachPendingModulePatch(globalObject, [&](JSModuleMock*) { hasPending = true; });
    return hasPending;
}

extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__forgetPendingModulePatches(Zig::GlobalObject* globalObject)
{
    forEachPendingModulePatch(globalObject, [](JSModuleMock* mock) { mock->hasPendingPatch = false; });
}

extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__clearPendingVitestPatches(Zig::GlobalObject* globalObject)
{
    forEachPendingModulePatch(globalObject, [](JSModuleMock* mock) { mock->hasPendingPatch = !mock->isOfVitest(); });
}

__attribute__((minsize)) static void giveBackPreloadModules(Zig::GlobalObject* globalObject)
{
    auto& plugins = globalObject->onLoadPlugins;
#if ENABLE(AOT)
    if (Bun::hasCompiledModules()) {
        // No throw scope, because its check would be the caller's.
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(JSC::getVM(globalObject));
        JSC::AOT::restorePreloadInstances(globalObject);
        Vector<String> compiledFiles = Bun::restorePreloadModules(globalObject);
        if (scope.exception()) [[unlikely]]
            return;
        evictModulesAndTheirImporters(globalObject, Vector<String> { compiledFiles });
        if (scope.exception()) [[unlikely]]
            return;
        for (auto& key : compiledFiles)
            plugins.testFileOfModule.remove(key);
    }
#endif
    if (plugins.evictedPreloadModules.isEmpty() && plugins.evictedPreloadCommonJSModules.isEmpty()) [[likely]]
        return;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* loader = Bun::testFileModuleLoader(globalObject);
    JSC::JSMap* requireMap = Bun::testFileRequireMap(globalObject);

    Vector<String> keys;
    for (auto& key : plugins.evictedPreloadModules.keys())
        keys.append(key);
    for (auto& key : plugins.evictedPreloadCommonJSModules.keys())
        keys.append(key);
    Vector<String> modulesToReload = keys;
    evictModulesAndTheirImporters(globalObject, WTF::move(modulesToReload));
    RETURN_IF_EXCEPTION(scope, );

    for (auto& key : keys) {
        // Its replacement is still loading and can't be evicted yet. JSMock__replaceModuleOfTestFile() retries once it has loaded.
        if (plugins.modulesToEvictOnceLoaded.contains(key))
            continue;
        plugins.testFileOfModule.remove(key);
        if (auto kept = plugins.evictedPreloadModules.take(key)) {
            auto* entry = loader->ensureRegistered(globalObject, JSC::Identifier::fromString(vm, key), JSC::ScriptFetchParameters::Type::JavaScript);
            RETURN_IF_EXCEPTION(scope, );
            if (!entry->record()) {
                entry->provideModule(vm, uncheckedDowncast<JSC::AbstractModuleRecord>(kept.get()));
                entry->markLoaded();
            }
        }
        if (auto kept = plugins.evictedPreloadCommonJSModules.take(key)) {
            requireMap->set(globalObject, jsString(vm, key), kept.get());
            RETURN_IF_EXCEPTION(scope, );
        }
    }
}

// Called after the preloads and before the load of each test file, including the first. Modules loaded before the first call belong to a preload.
extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__didBeginTestFile(Zig::GlobalObject* globalObject)
{
#if ENABLE(AOT)
    if (globalObject->vm().hasCompiledCode()) {
        Bun::clearSavedResolutions(globalObject);
        JSC::AOT::didBeginTestFile(globalObject);
    }
#else
    UNUSED_PARAM(globalObject);
#endif
}

extern "C" [[ZIG_EXPORT(nothrow)]] __attribute__((minsize)) void JSMock__undoModuleMocksOfTestFile(Zig::GlobalObject* globalObject, bool nextLoadSharesModules)
{
    auto& plugins = globalObject->onLoadPlugins;
    plugins.testFile++;
#if ENABLE(AOT)
    if (globalObject->vm().hasCompiledCode()) {
        Bun::clearSavedResolutions(globalObject);
        JSC::AOT::didBeginTestFile(globalObject);
        JSC::AOT::evictAbandonedModules(globalObject);
    }
#endif
    plugins.loadedByImportActual.clear();
    ModulesToEvict evict;
#if ENABLE(AOT)
    plugins.waitingMockFetches.clear();
    plugins.fetchesBlockedOnFactories.clear();
    plugins.compiledImportersLinkedBeforeMocks.clear();
    if (globalObject->vm().hasCompiledCode())
        evictRetainedFailures(globalObject);
    for (auto& factory : plugins.compiledMockFactories)
        uncheckedDowncast<JSModuleMock>(factory.mock.get())->clearRetainedFailure();
    forEachPreloadMock(globalObject, [](JSModuleMock* mock) { mock->forgetOwedErrors(); });
#endif
    for (auto& waiting : std::exchange(plugins.waitingModuleMocks, {}))
        evict.abandonedModules.append(uncheckedDowncast<JSModuleMock>(waiting.mock.get())->specifier->tryGetValue().data);
    plugins.moduleMocksWithTurn.clear();
    plugins.modulesGivenTimeToRequestImports.clear();
    plugins.loadRoots.clear();
    plugins.loadRootsDuringFactories.clear();
    plugins.loadRootFetches.clear();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    while (!plugins.runningModuleMocks.isEmpty()) {
        auto* mock = uncheckedDowncast<JSModuleMock>(plugins.runningModuleMocks.last().mock.get());
        evict.abandonedModules.append(mock->specifier->tryGetValue().data);
#if ENABLE(AOT)
        // In `bun test` an import of a module that is being evaluated joins the evaluation, even if a mock ends meanwhile.
        JSC::JSPromise* ownBodyEvaluation = vm.hasCompiledCode() && mock->importsOriginal ? intactOriginalEvaluation(globalObject, mock) : nullptr;
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
        auto* heldUp = ownBodyEvaluation && mock->state == JSModuleMock::State::Running && mock->result ? dynamicDowncast<JSC::JSPromise>(mock->result.get()) : nullptr;
        if (heldUp) {
            JSC::JSFunction* didEnd = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionAbandonedMockBodyDidEnd, ImplementationVisibility::Private);
            ownBodyEvaluation->performPromiseThenWithContext(vm, globalObject, didEnd, didEnd, jsUndefined(), moduleMockWith(globalObject, mock, heldUp));
        }
#endif
        mock->abandon(globalObject);
#if ENABLE(AOT)
        bool wasCalledByLoad = plugins.compiledMockFactories.removeAllMatching([&](const auto& factory) { return factory.mock.get() == mock; });
        if (wasCalledByLoad && mock->unevaluatedCompiledModule && isRegisteredModuleMock(globalObject, mock, mock->specifier->tryGetValue().data))
            deferMockToNextLoad(globalObject, mock, mock->importsOriginal ? JSC::AOT::FactoryFailurePolicy::RetryFactory : JSC::AOT::FactoryFailurePolicy::CacheError);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
#endif
    }
    if (!nextLoadSharesModules)
        return;

    MarkedArgumentBuffer mocks;
#if ENABLE(AOT)
    MarkedArgumentBuffer restoredPreloadMocks;
#endif
    if (plugins.virtualModules) {
        for (auto& value : plugins.virtualModules->values()) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            if (mock && !mock->isFromPreload)
                mocks.append(mock);
#if ENABLE(AOT)
            else if (mock && std::exchange(mock->wasRestoredByTestMock, false))
                restoredPreloadMocks.append(mock);
#endif
        }
    }
    Vector<JSModuleMock*> lastPatchFirst;
    for (size_t i = 0; i < mocks.size(); ++i) {
        auto* mock = uncheckedDowncast<JSModuleMock>(mocks.at(i));
        size_t index = lastPatchFirst.size();
        while (index && lastPatchFirst[index - 1]->patchOrder < mock->patchOrder)
            --index;
        lastPatchFirst.insert(index, mock);
    }
#if ENABLE(AOT)
    Vector<std::tuple<String, bool, bool, bool>, 4> endedMockFiles;
    // What `bun test` keeps registered at the end of the file: stashed modules are restored after the evictions, and patched modules are not evicted.
    Vector<String, 4> retainedCompiledFiles;
    // giveBackPreloadModules() runs before the moves that the ends below request.
    forEachPreloadMock(globalObject, [](JSModuleMock* mock) { mock->isUnderActualKey |= std::exchange(mock->wasRemovedByReset, false); });
    if (vm.hasCompiledCode())
        JSC::AOT::willEndMocksOfTestFile(globalObject);
#endif
    for (auto* mock : lastPatchFirst) {
#if ENABLE(AOT)
        JSModuleMock* restoredPreloadMock = nullptr;
        if (vm.hasCompiledCode()) {
            String key = mock->specifier->tryGetValue().data;
            bool restoresOriginal = restoresCompiledFile(globalObject, mock, key);
            auto patched = restoresOriginal ? std::nullopt : Bun::compiledModuleForPath(key);
            // `bun test` saves what a mock patches at the call, compiled code when the factory settles.
            bool waitsForFactoryToPatch = patched && JSC::AOT::hasRequireCacheEntry(globalObject, *patched) && !JSC::AOT::hasActiveMock(globalObject, *patched) && !JSC::AOT::hasPendingMock(globalObject, *patched) && !JSC::AOT::hasIntactOriginal(globalObject, *patched);
            restoredPreloadMock = findPreloadMockToRestore(globalObject, mock, key);
            if (restoresOriginal || restoredPreloadMock || waitsForFactoryToPatch || (patched && JSC::AOT::isPatchedByMock(globalObject, *patched)))
                retainedCompiledFiles.append(key);
            if (restoresOriginal)
                noteRestoredOriginal(globalObject, mock, key);
            endedMockFiles.append({ key, Bun::willUnmockCompiledFile(globalObject, key, restoresOriginal, false), restoresOriginal, mock->state == JSModuleMock::State::Running });
        }
#endif
        unmockModule(globalObject, mock, mock->specifier->tryGetValue().data, evict);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
#if ENABLE(AOT)
        if (restoredPreloadMock)
            restoredPreloadMock->isUnderActualKey = false;
#endif
    }

#if ENABLE(AOT)
    if (vm.hasCompiledCode())
        JSC::AOT::didEndMocksOfTestFile(globalObject);
    // Also if the end of an earlier test file emptied the key: the first request after that loaded the mock again.
    auto wasMockLoadedByTestFile = [&](JSModuleMock* mock, JSC::AOT::ModuleID module) {
        return mock->firstLoadTestFile || JSC::AOT::activeMockReloadedBy(globalObject, module) != JSC::AOT::LoadedBy::Nobody;
    };
    for (size_t i = 0; i < restoredPreloadMocks.size(); ++i) {
        auto* mock = uncheckedDowncast<JSModuleMock>(restoredPreloadMocks.at(i));
        String key = mock->specifier->tryGetValue().data;
        auto compiled = JSC::AOT::findVariantToMock(globalObject, key, Bun::findMockedModule(key));
        // The result of a factory that ended its own mock was installed after this mock was restored.
        if (compiled && mock->unevaluatedCompiledModule && mock->state == JSModuleMock::State::Settled) {
            LoadedModule inPlace;
            inPlace.compiledModule = JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule);
            overrideLoadedModuleExports(globalObject, mock, inPlace);
            if (scope.exception()) [[unlikely]]
                (void)scope.tryClearException();
        }
        // A mock that patched an evaluated module stays in require.cache. For a compiled module it has no saved originals and replaced no unevaluated body.
        if (!compiled || !wasMockLoadedByTestFile(mock, *compiled) || !mock->unevaluatedCompiledModule || retainedCompiledFiles.contains(key) || mock->originalExports || mock->originalCommonJSExports)
            continue;
        mock->firstLoadTestFile = 0;
        JSC::AOT::releaseMockImporters(globalObject, *compiled);
        JSC::AOT::didRemoveActiveMockEntry(globalObject, *compiled);
    }
    if (globalObject->vm().hasCompiledCode())
        JSC::AOT::releaseRemovedMocks(globalObject);
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
#endif

    giveBackPreloadModules(globalObject);
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();

    for (auto& displaced : plugins.displacedPreloadModuleMocks)
        giveLoadedModuleBackToPreloadModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(displaced.get())->specifier->tryGetValue().data);
    for (auto& displaced : std::exchange(plugins.displacedPreloadModuleMocks, {})) {
        auto* mock = uncheckedDowncast<JSModuleMock>(displaced.get());
        String specifier = mock->specifier->tryGetValue().data;
#if ENABLE(AOT)
        // In `bun test` a restored original stays registered, and the next mock change evicts its importers.
        if (auto file = globalObject->vm().hasCompiledCode() && retainedCompiledFiles.contains(specifier) ? Bun::compiledModuleForPath(specifier) : std::nullopt) {
            JSC::AOT::reportKeptImporters(globalObject, *file);
            if (mock->state == JSModuleMock::State::Settled && !isInNodeModules(specifier))
                JSC::AOT::reportIfFileWasReleased(globalObject, *file);
        }
        // The eviction below removes the module that the test file loaded instead.
        if (auto file = globalObject->vm().hasCompiledCode() && !mock->originalExports && !mock->originalCommonJSExports && !retainedCompiledFiles.contains(specifier) ? Bun::compiledModuleForPath(specifier) : std::nullopt; file && JSC::AOT::evaluatedBy(globalObject, *file) != JSC::AOT::LoadedBy::Preload && !JSC::AOT::ranDuringMockThatOnlyWaited(globalObject, *file))
            JSC::AOT::releaseModuleAndImporters(globalObject, *file, std::nullopt);
#endif
        plugins.addModuleMock(vm, specifier, mock);
#if ENABLE(AOT)
        mock->isDetached = false;
        restoreStashedFactories(globalObject, mock);
        // Preload modules that were linked to the active mock of a compiled module read it there, and load nothing again.
        auto compiled = globalObject->vm().hasCompiledCode() ? JSC::AOT::findVariantToMock(globalObject, specifier, Bun::findMockedModule(specifier)) : std::nullopt;
        // After a test file's mock over it, the next test file begins with the preload mock, whatever the program stored under the key.
        if (std::exchange(mock->isDisplacedByTestMock, false)) {
            endedMockFiles.removeAllMatching([&](const auto& ended) { return std::get<0>(ended) == specifier; });
            if (compiled && JSC::AOT::isEvicted(globalObject, *compiled)) {
                JSC__JSMap__remove(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(mock->specifier.get()));
                if (scope.exception()) [[unlikely]]
                    (void)scope.tryClearException();
            }
        }
        // The eviction below empties the key of a built-in module.
        if (compiled && mock->state == JSModuleMock::State::NotCalled && isBuiltinModuleKey(specifier))
            JSC::AOT::didEvictLibraryEntry(globalObject, *compiled);
        bool wasInstalledOverCompiledModule = compiled && JSC::AOT::hasStartedLoading(globalObject, *compiled) && !JSC::AOT::isEvicted(globalObject, *compiled);
        // Nothing requested the preload mock, and the module has run since. The eviction below empties its key in `bun test`, so the factory waits for the next test file.
        bool waitsOverEvaluatedModule = wasInstalledOverCompiledModule && mock->state == JSModuleMock::State::NotCalled && !retainedCompiledFiles.contains(specifier) && JSC::AOT::tryKeepOriginalIntact(globalObject, *compiled, false, std::nullopt, !mock->importsOriginal);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
        if ((mock->unevaluatedCompiledModule || wasInstalledOverCompiledModule) && mock->state == JSModuleMock::State::Settled) {
            LoadedModule inPlace;
            inPlace.compiledModule = mock->unevaluatedCompiledModule ? JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule) : *compiled;
            overrideLoadedModuleExports(globalObject, mock, inPlace);
            if (scope.exception()) [[unlikely]]
                (void)scope.tryClearException();
        } else if (compiled && (!JSC::AOT::hasStartedLoading(globalObject, *compiled) || waitsOverEvaluatedModule || (mock->state == JSModuleMock::State::NotCalled && isBuiltinModuleKey(specifier)))) {
            auto wait = [&](JSC::AOT::ModuleID variant) {
                plugins.pendingCompiledMocks.removeAllMatching([&](const auto& entry) { return entry.first == variant.index(); });
                plugins.pendingCompiledMocks.append({ variant.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
                JSC::AOT::deferMock(globalObject, variant, mock->importsOriginal ? JSC::AOT::FactoryFailurePolicy::RetryFactory : JSC::AOT::FactoryFailurePolicy::CacheError, mock->isFromPreload);
                if (scope.exception()) [[unlikely]]
                    (void)scope.tryClearException();
            };
            wait(*compiled);
            for (JSC::AOT::ModuleID variant : JSC::AOT::importAttributeVariants(globalObject, specifier))
                wait(variant);
        }
#endif
        if (!mock->originalExports && !mock->originalCommonJSExports) {
#if ENABLE(AOT)
            // From here on the key is empty: the next test file that requests it reloads the preload mock and owns it.
            if (compiled && mock->unevaluatedCompiledModule && wasMockLoadedByTestFile(mock, *compiled) && !retainedCompiledFiles.contains(specifier)) {
                mock->firstLoadTestFile = 0;
                JSC::AOT::releaseMockImporters(globalObject, *compiled);
                JSC::AOT::didRemoveActiveMockEntry(globalObject, *compiled);
            }
            // No mock of a later test file finds what an earlier one loaded there.
            // Compiled files have no saved originals. What a preload evaluated was patched by its mock, and in `bun test` does not get here.
            // If the preload mock was requested, `bun test` finds it under the key in the next test file.
            if (compiled && mock->state == JSModuleMock::State::NotCalled && JSC::AOT::evaluatedBy(globalObject, *compiled) == JSC::AOT::LoadedBy::EarlierTestFile && !retainedCompiledFiles.contains(specifier))
                JSC::AOT::didRemoveEntryAfterTestFile(globalObject, *compiled);
#endif
            evict.modules.append(specifier);
            continue;
        }
        if (mock->originalExports)
            evict.patchedESModules.append(specifier);
        if (mock->originalCommonJSExports)
            evict.patchedCommonJSModules.append(specifier);
        if (mock->state != JSModuleMock::State::Settled)
            continue;
        LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
        if (!scope.exception()) [[likely]]
            overrideLoadedModuleExports(globalObject, mock, loaded);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
    }

    for (auto& module : plugins.moduleMocksBeingLoaded.keys())
        evict.modules.append(module);
    evict.isEndOfTestFile = plugins.hasVirtualModules();
    evictModulesAndTheirImporters(globalObject, WTF::move(evict));
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
#if ENABLE(AOT)
    for (auto& [key, leavesProgram, restoresOriginal, factoryIsPending] : endedMockFiles) {
        Bun::didUnmockCompiledFile(globalObject, key, leavesProgram, restoresOriginal, factoryIsPending);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
    }
    if (globalObject->vm().hasCompiledCode())
        JSC::AOT::releaseEndedMockImporters(globalObject);
#endif
}

static void replaceModuleWithItsExports(Zig::GlobalObject* globalObject, JSC::AbstractModuleRecord* record)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const JSC::Identifier& key = record->moduleKey();

    JSObject* exports = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto* moduleNamespace = record->getModuleNamespace(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    JSC::PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    moduleNamespace->methodTable()->getOwnPropertyNames(moduleNamespace, globalObject, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, );
    for (auto& name : names) {
        JSValue value = moduleNamespace->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, );
        exports->putDirectMayBeIndex(globalObject, name, value);
        RETURN_IF_EXCEPTION(scope, );
    }

    evictModulesAndTheirImporters(globalObject, Vector<String> { key.string() });
    RETURN_IF_EXCEPTION(scope, );
    auto* loader = Bun::testFileModuleLoader(globalObject);
    if (!loader->registryEntry(key))
        RELEASE_AND_RETURN(scope, loader->provideFetch(globalObject, key, JSC::ScriptFetchParameters::Type::JavaScript, Zig::createObjectModuleSourceCode(vm, exports, key.string())));
}

// A test file that mocked modules holds its own copies of their importers, partly in variables that `vi.mock()` made out of its imports.
// So evict it too, and leave a module with the same exports in its place so that a later import doesn't evaluate the file again.
extern "C" __attribute__((minsize)) void JSMock__replaceModuleOfTestFile(Zig::GlobalObject* globalObject, const BunString* path)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto& plugins = globalObject->onLoadPlugins;
    giveBackPreloadModules(globalObject);
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
    auto mockingModules = std::exchange(plugins.mockingModules, {});
    if (mockingModules.isEmpty())
        return;
    String testFile = path->toWTFString();
#if ENABLE(AOT)
    if (vm.hasCompiledCode()) {
        // Modules with instances are released below. The test file itself keeps its instance.
        auto file = Bun::compiledModuleForPath(testFile);
        if (file)
            JSC::AOT::releaseImporters(globalObject, *file);
        JSC::AOT::setReplacedTestFile(globalObject, file);
        auto retainedModules = mockingModules;
        for (auto& key : mockingModules) {
            if (auto module = key != testFile ? Bun::compiledModuleForPath(key) : std::nullopt; module && JSC::AOT::evaluatedBy(globalObject, *module) != JSC::AOT::LoadedBy::Preload && JSC::AOT::releaseModuleAndImporters(globalObject, *module, std::nullopt))
                retainedModules.remove(key);
        }
        JSC::AOT::setReplacedTestFile(globalObject, std::nullopt);
        scheduleBodyMockReplay(globalObject, retainedModules, testFile);
    }
#endif
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, testFile));
    auto* record = entry ? dynamicDowncast<JSC::CyclicModuleRecord>(entry->record()) : nullptr;
    // A module that was compiled ahead of time can't be evicted.
    if (record && !(record->vm().hasCompiledCode() && JSC::AOT::isCompiledModuleRecord(record)) && record->status() == JSC::CyclicModuleRecord::Status::Evaluated && !record->evaluationError()) {
        replaceModuleWithItsExports(globalObject, record);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
    }

    // Their mocks are undone, so the next file that imports them has to run them again. Nothing loads a preload's modules again.
    Vector<String> modulesToReevaluate;
    for (auto& key : mockingModules) {
        if (key != testFile && plugins.testFileOfModule.get(key))
            modulesToReevaluate.append(key);
    }
    evictModulesAndTheirImporters(globalObject, WTF::move(modulesToReevaluate));
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
}

// The next run of a test file whose imports are loaded begins before the read of what this run was fetching ends.
extern "C" void JSMock__willRunTestFileAgain([[maybe_unused]] Zig::GlobalObject* globalObject, [[maybe_unused]] const BunString* path)
{
#if ENABLE(AOT)
    if (auto file = globalObject->vm().hasCompiledCode() ? Bun::compiledModuleForPath(path->toWTFString()) : std::nullopt)
        JSC::AOT::willRunTestFileAgain(globalObject, *file);
#endif
}

// While this is true, the next test file would pick up this file's still-loading modules and the mocks they imported.
extern "C" [[ZIG_EXPORT(nothrow)]] bool JSMock__hasModulesToEvict(Zig::GlobalObject* globalObject)
{
#if ENABLE(AOT)
    if (globalObject->vm().hasCompiledCode() && JSC::AOT::hasDeferredFetchToEvict(globalObject))
        return true;
#endif
    return !globalObject->onLoadPlugins.modulesToEvictOnceLoaded.isEmpty();
}

// Under --aot an import() of a mocked file waits in the runtime while `bun test` reads the file. Plain runs hold none.
extern "C" [[ZIG_EXPORT(nothrow)]] bool JSMock__hasHeldImports(Zig::GlobalObject* globalObject)
{
#if ENABLE(AOT)
    return globalObject->vm().hasCompiledCode() && JSC::AOT::hasMockImportsAwaitingSource(globalObject);
#else
    UNUSED_PARAM(globalObject);
    return false;
#endif
}

#if ENABLE(AOT)
JSC_DECLARE_HOST_FUNCTION(jsFunctionProvideActualFile);
JSC_DEFINE_HOST_FUNCTION(jsFunctionProvideActualFile, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSValue importOriginal = callFrame->argument(0);
    return JSValue::encode(JSC::call(globalObject, importOriginal, JSC::getCallData(importOriginal), JSC::jsUndefined(), ArgList()));
}
#endif

// `bun test` first undoes the mocks of a test file and then lets pending loads end: no factory is called for them, and they get the files themselves.
extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__releaseHeldImports(Zig::GlobalObject* globalObject)
{
#if ENABLE(AOT)
    auto& vm = JSC::getVM(globalObject);
    JSC::JSFunction* providesActualFile = nullptr;
    JSC::AOT::didFinishTests(globalObject);
    // `bun test` abandons the factories that are still running, so loads that wait for them never finish. Except mocks that the program removed: a later load gets the file.
    for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
        auto* mock = uncheckedDowncast<JSModuleMock>(running.mock.get());
        String mocked = mock->specifier->tryGetValue().data;
        if (auto file = isStillRegisteredModuleMock(globalObject, mocked, mock) ? Bun::compiledModuleForPath(mocked) : std::nullopt)
            JSC::AOT::markFactoryAbandoned(globalObject, *file);
    }
    for (auto& waiting : globalObject->onLoadPlugins.pendingCompiledMocks) {
        auto* mock = dynamicDowncast<JSModuleMock>(waiting.second.get());
        // Preload mocks are not undone after the tests of a file: their factories are called.
        if (!mock || mock->isFromPreload || mock->state != JSModuleMock::State::NotCalled)
            continue;
        // A pending load of a `__mocks__` file already has the name of that file, and gets it.
        if (JSValue manualMock = mock->factory.get(); manualMock && manualMock.isString())
            continue;
        if (!providesActualFile)
            providesActualFile = JSC::JSFunction::create(vm, globalObject, 1, String(), jsFunctionProvideActualFile, ImplementationVisibility::Private);
        mock->factory.set(vm, mock, providesActualFile);
        mock->providesActualFile = true;
        JSC::AOT::markMockPassthrough(globalObject, JSC::AOT::ModuleID(waiting.first));
    }
#else
    UNUSED_PARAM(globalObject);
#endif
}

// The key is NUL followed by this name, because no specifier or plugin result can resolve to a key that contains NUL.
static constexpr ASCIILiteral moduleMockEvaluatorName = "bun:module-mock"_s;

static bool isModuleMockEvaluatorKey(const String& key)
{
    return key.length() == moduleMockEvaluatorName.length() + 1 && !key[0] && key.endsWith(moduleMockEvaluatorName);
}

// Evicted so that the next import of it, or of an importer that failed with it, calls the factory again.
static void forgetModuleThatFailedToEvaluate(Zig::GlobalObject* globalObject, JSC::AbstractModuleRecord* record)
{
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(record->moduleKey());
    if (!entry || entry->record() != record)
        return;
    evictModulesAndTheirImporters(globalObject, Vector<String> { record->moduleKey().string() });
}

// If the factory re-mocked the module, `record` already reads from the newer mock and keeps doing so.
static void didEvaluateModuleMock(Zig::GlobalObject* globalObject, JSModuleMock* mock, JSC::AbstractModuleRecord* record)
{
    JSModuleMock* registered = registeredModuleMock(globalObject, record->moduleKey().string());
    if (!registered || registered == mock || !record->liveExportsSource())
        record->setLiveExportsSource(globalObject->vm(), mock);
}

static JSValue evaluateModuleMock(Zig::GlobalObject*, JSC::AbstractModuleRecord*, JSC::JSModuleNamespaceObject* dependency);

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockDidEvaluate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto [mock, record] = toModuleMockWith<JSC::AbstractModuleRecord>(globalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    if (mock->state != JSModuleMock::State::Settled) {
        // giveUp() fulfilled the promise, so evaluate again as whatever the module is now.
        auto* original = mock->originalNamespace ? dynamicDowncast<JSC::JSModuleNamespaceObject>(mock->originalNamespace.get()) : nullptr;
        RELEASE_AND_RETURN(scope, JSValue::encode(original ? evaluateModuleMock(defaultGlobalObject(globalObject), record, original) : jsUndefined()));
    }
    didEvaluateModuleMock(defaultGlobalObject(globalObject), mock, record);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockDidNotEvaluate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* record = toModuleMockWith<JSC::AbstractModuleRecord>(globalObject, scope, callframe->argument(1)).second;
    RETURN_IF_EXCEPTION(scope, {});
    forgetModuleThatFailedToEvaluate(defaultGlobalObject(globalObject), record);
    RETURN_IF_EXCEPTION(scope, {});
    scope.throwException(globalObject, callframe->argument(0));
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionEvaluateModuleMockWithDependency, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto* dependency = dynamicDowncast<JSC::JSModuleNamespaceObject>(callframe->argument(0));
    auto* record = dynamicDowncast<JSC::AbstractModuleRecord>(callframe->argument(1));
    if (!dependency || !record)
        return JSValue::encode(jsUndefined());
    RELEASE_AND_RETURN(scope, JSValue::encode(evaluateModuleMock(defaultGlobalObject(globalObject), record, dependency)));
}

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionEvaluateModuleMockInTurn, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(lexicalGlobalObject));
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto [mock, context] = toModuleMockWith<JSC::InternalFieldTuple>(globalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    auto* record = uncheckedDowncast<JSC::AbstractModuleRecord>(context->getInternalField(0));
    auto* dependency = uncheckedDowncast<JSC::JSModuleNamespaceObject>(context->getInternalField(1));
    JSValue evaluated = evaluateModuleMock(globalObject, record, dependency);
    // The module may be another mock's by now, or nobody's.
    if (!findRunningModuleMock(globalObject, mock))
        returnTurn(globalObject, mock);
    RELEASE_AND_RETURN(scope, JSValue::encode(evaluated));
}

// `evaluate(mock, original)` in the source that sourceCodeOfModuleMock() generates.
JSC_DEFINE_HOST_FUNCTION(jsFunctionEvaluateModuleMock, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto* moduleNamespace = dynamicDowncast<JSC::JSModuleNamespaceObject>(callframe->argument(0));
    auto* dependency = dynamicDowncast<JSC::JSModuleNamespaceObject>(callframe->argument(1));
    if (!moduleNamespace || !moduleNamespace->moduleRecord()->hasLiveExports())
        return JSValue::encode(jsUndefined());
    if (!dependency && specifierOfUnwaitedModuleMockKey(moduleNamespace->moduleRecord()->moduleKey().string()).isNull())
        return JSValue::encode(jsUndefined());
    RELEASE_AND_RETURN(scope, JSValue::encode(evaluateModuleMock(globalObject, moduleNamespace->moduleRecord(), dependency)));
}

__attribute__((minsize)) static JSValue evaluateModuleMock(Zig::GlobalObject* globalObject, JSC::AbstractModuleRecord* record, JSC::JSModuleNamespaceObject* dependency)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String specifier = record->moduleKey().string();
    if (String mocked = specifierOfUnwaitedModuleMockKey(specifier); !mocked.isNull()) {
        if (JSModuleMock* unwaited = registeredModuleMock(globalObject, mocked)) {
            record->setLiveExportsSource(vm, unwaited);
            return jsUndefined();
        }
        // Unmocked since, so it's the original.
        specifier = mocked;
        if (!dependency) {
            JSC::JSPromise* loading = importModuleKey(globalObject, originalModuleKey(specifier));
            RETURN_IF_EXCEPTION(scope, {});
            return thenWithContext(globalObject, loading, jsFunctionEvaluateModuleMockWithDependency, nullptr, record);
        }
    }

    String dependencyKey = dependency->moduleRecord()->moduleKey().string();
    // A record that stashLoadedModule() moved keeps the key it was loaded with.
    if (auto* original = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, originalModuleKey(specifier))); original && original->record() == dependency->moduleRecord())
        dependencyKey = originalModuleKey(specifier);
    bool isOriginal = isModuleOrCopyOfIt(dependencyKey, originalModuleKey(specifier));

    JSModuleMock* mock = registeredModuleMock(globalObject, specifier);
    if (!mock) {
        UncheckedKeyHashSet<JSObject*> seen;
        bool readsItself = record->liveExportsSource() || readsModuleExports(globalObject, dependency, specifier, seen);
        RETURN_IF_EXCEPTION(scope, {});
        if (!readsItself)
            record->setLiveExportsSource(vm, dependency);
        return jsUndefined();
    }

    // A mock registered after this module's source was generated may want a different dependency than the one it imported.
    if (isOriginal)
        mock->originalNamespace.set(vm, mock, dependency);
    String wanted = dependencyKeyOfModuleMock(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, {});

    // The generated module only awaits a mock that has a factory.
    bool callsFactory = mock->state == JSModuleMock::State::NotCalled && mock->factory && mock->factory.get().isCallable();
    if (JSC::JSPromise* turn = callsFactory ? waitForTurn(globalObject, mock, false) : nullptr) {
        auto* context = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), record, dependency);
        return thenWithContext(globalObject, turn, jsFunctionEvaluateModuleMockInTurn, nullptr, moduleMockWith(globalObject, mock, context));
    }

    JSC::JSPromise* pending = mock->run(globalObject, false, isModuleOrCopyOfIt(dependencyKey, wanted) ? dependency : nullptr);
    if (auto* exception = scope.exception()) [[unlikely]] {
        if (scope.tryClearException()) {
            forgetModuleThatFailedToEvaluate(globalObject, record);
            RETURN_IF_EXCEPTION(scope, {});
            scope.throwException(globalObject, exception);
        }
        return {};
    }
    if (pending)
        return thenWithContext(globalObject, pending, jsFunctionModuleMockDidEvaluate, jsFunctionModuleMockDidNotEvaluate, moduleMockWith(globalObject, mock, record));
    didEvaluateModuleMock(globalObject, mock, record);
    return jsUndefined();
}

// The fetch of a compiled file may wait for another mock, but the file's imports are known.
static bool isCompiledFileNotImporting(Zig::GlobalObject* globalObject, const String& key, const String& target)
{
#if ENABLE(AOT)
    if (!globalObject->vm().hasCompiledCode())
        return false;
    auto file = Bun::compiledModuleForPath(key);
    auto targetFile = file ? Bun::compiledModuleForPath(target) : std::nullopt;
    return targetFile && !JSC::AOT::isInLoadGraph(globalObject, *file, *targetFile);
#else
    UNUSED_PARAM(globalObject);
    UNUSED_PARAM(key);
    UNUSED_PARAM(target);
    return false;
#endif
}

// Whether `start` can't finish evaluating until `target`, the module `running` mocks, has. If it can, `unfinished` gets the modules that must
// finish first and aren't in the import chain yet. A waiting module keeps waiting while the factory runs, so waitingModules caches the answer.
__attribute__((minsize)) static bool isWaitingForModule(Zig::GlobalObject* globalObject, BunPlugin::OnLoad::RunningModuleMock& running, const String& start, const String& target, Vector<String>& unfinished)
{
    if (running.waitingModules.contains(start))
        return true;

    auto& vm = JSC::getVM(globalObject);
    auto* loader = Bun::testFileModuleLoader(globalObject);
    auto recordOf = [&](const String& key) -> JSC::AbstractModuleRecord* {
        auto* entry = loader->registryEntry(JSC::Identifier::fromString(vm, key));
        return entry ? entry->record() : nullptr;
    };

    ModuleImporters importersOf;
    Vector<String> waiting;
    UncheckedKeyHashSet<String> seen;
    auto add = [&](const String& key) {
        if (!seen.add(key).isNewEntry)
            return;
        if (key == target || running.waitingModules.contains(key)) {
            waiting.append(key);
            return;
        }
        if (running.importChain.contains(key) || isModuleMockEvaluatorKey(key))
            return;
        if (auto* record = recordOf(key)) {
            auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record);
            if (!cyclic || cyclic->isSCCEvaluated())
                return;
        } else if (auto* mock = registeredModuleMock(globalObject, key); mock && mock->state == JSModuleMock::State::Settled && !mock->importsOriginal) {
            // What is being fetched is the mock's own module, which imports nothing.
            return;
        } else if (auto* entry = loader->registryEntry(JSC::Identifier::fromString(vm, key)); entry && isBeingFetchedWithoutFactory(globalObject, entry) && (!isInNodeModules(key) || isInNodeModules(target)) && !isCompiledFileNotImporting(globalObject, key, target)) {
            // Another load is fetching it, and it may import the mock. In the chain it would get the original, for that load too, so treat it as waiting.
            // A package doesn't import the project's modules. A copy of it would only run its side effects a second time.
            running.waitingModules.add(key);
            waiting.append(key);
            return;
        }
        unfinished.append(key);
    };

    add(start);
    for (size_t i = 0; i < unfinished.size(); ++i) {
        String importer = unfinished[i];
        auto* record = recordOf(importer);
        if (!record)
            continue;
        // An import only shows up in loadedModules() once its own imports have loaded, so walk resolvedRequests() too.
        for (auto& resolved : record->resolvedRequests().values()) {
            String key { resolved.get() };
            addImporter(importersOf, importer, key);
            add(key);
        }
        for (auto& loaded : record->loadedModules().values()) {
            const String& key = loaded.m_module->moduleKey().string();
            addImporter(importersOf, importer, key);
            add(key);
        }
    }

    for (size_t i = 0; i < waiting.size(); ++i) {
        auto importers = importersOf.find(waiting[i]);
        if (importers == importersOf.end())
            continue;
        for (auto& importer : importers->value) {
            if (running.waitingModules.add(importer).isNewEntry)
                waiting.append(importer);
        }
    }
    return running.waitingModules.contains(start);
}

// Returns `key`, or if that module waits for `mocked`, the key of a private copy for the factory (of a mock: unwaitedModuleMockKey()), since awaiting it would deadlock.
// Every key has to pass through here before addToImportChain(): isWaitingForModule() assumes that nothing in the chain waits.
__attribute__((minsize)) static String redirectedModuleKey(Zig::GlobalObject* globalObject, BunPlugin::OnLoad::RunningModuleMock& running, const String& key, const String& mocked)
{
    String instead = key;
    Vector<String> unfinished;
    while (isWaitingForModule(globalObject, running, instead, mocked, unfinished)) {
        if (registeredModuleMock(globalObject, instead))
            return unwaitedModuleMockKey(instead);
        instead = originalModuleKey(instead);
        unfinished.clear();
    }
    for (auto& module : unfinished)
        addToImportChain(globalObject, running, module);
    return instead;
}

template<typename Visitor>
void JSModuleMock::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSModuleMock* mock = uncheckedDowncast<JSModuleMock>(cell);
    ASSERT_GC_OBJECT_INHERITS(mock, info());
    Base::visitChildren(mock, visitor);

    visitor.append(mock->factory);
    visitor.append(mock->result);
    visitor.append(mock->exports);
    visitor.append(mock->specifier);
    visitor.append(mock->writtenSpecifier);
    visitor.append(mock->originalExports);
    visitor.append(mock->originalCommonJSExports);
    visitor.append(mock->commonJSExportsOfOriginal);
    visitor.append(mock->esmExportsOfOriginal);
    visitor.append(mock->originalNamespace);
    visitor.append(mock->patchedNamespace);
    visitor.append(mock->originalExportsOfEvictedModule);
#if ENABLE(AOT)
    visitor.append(mock->lateFactoryError);
    visitor.append(mock->errorOwedToImports);
    visitor.append(mock->activeMockAtFailure);
    visitor.append(mock->earlyOriginalLoad);
    visitor.append(mock->originalRequestedByFactory);
#endif
}

DEFINE_VISIT_CHILDREN(JSModuleMock);

JSValue BunPlugin::OnLoad::run(JSC::JSGlobalObject* globalObject, const String& key, Matches& matches)
{
    if (isEmpty())
        return {};

    BunString keyString = Bun::toString(key);
    int32_t namespaceLength = Bun__onLoadNamespaceLength(&keyString);
    if (namespaceLength < 0)
        return {};

    Group* group = this->group(namespaceLength ? key.substringSharingImpl(0, namespaceLength) : String());
    if (!group)
        return {};

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String path = Zig::withoutOriginalModuleQuery(namespaceLength ? key.substringSharingImpl(namespaceLength + 1) : key);

    for (size_t i = 0; i < group->filters.size(); i++) {
        auto matchResult = group->filters[i]->match(globalObject, path, 0);
        RETURN_IF_EXCEPTION(scope, {});
        if (matchResult)
            matches.callbacks.append(group->callbacks[i].get());
    }
    if (matches.callbacks.hasOverflowed()) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    if (matches.callbacks.isEmpty())
        return {};

    // `key` can borrow the caller's bytes, and `args.path` outlives this call, so give it a copy.
    matches.path = jsString(vm, path.isolatedCopy());
    RELEASE_AND_RETURN(scope, ask(globalObject, matches, jsUndefined()));
}

JSValue BunPlugin::OnLoad::ask(JSC::JSGlobalObject* globalObject, Matches& matches, JSValue answer)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    while (answer.isUndefinedOrNull()) {
        if (matches.next == matches.callbacks.size())
            return {};
        JSObject* callback = matches.callbacks.at(matches.next++).getObject();

        JSObject* paramsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
        paramsObject->putDirect(vm, WebCore::builtinNames(vm).pathPublicName(), matches.path);
        JSC::MarkedArgumentBuffer arguments;
        arguments.append(paramsObject);

        answer = AsyncContextFrame::call(globalObject, callback, JSC::jsUndefined(), arguments);
        RETURN_IF_EXCEPTION(scope, {});

        if (auto* promise = dynamicDowncast<JSPromise>(answer)) {
            if (promise->status() != JSPromise::Status::Fulfilled)
                return promise;
            answer = promise->result();
        }
    }

    if (!answer.isObject()) {
        JSC::throwTypeError(globalObject, scope, "onLoad() expects an object returned"_s);
        return {};
    }

    return answer;
}

std::optional<String> BunPlugin::OnLoad::resolveVirtualModule(const String& path, const String& from)
{
    ASSERT(virtualModules);

    if (path.isNull()) [[unlikely]]
        return std::nullopt;

    if (this->mustDoExpensiveRelativeLookup) {
        String joinedPath = path;

        if (path.startsWith("./"_s) || path.startsWith(".."_s)) {
            auto url = WTF::URL::fileURLWithFileSystemPath(from);
            ASSERT(url.isValid());
            joinedPath = relativeSpecifierToFileSystemPath(url, path);
        }

        return virtualModules->contains(joinedPath) ? std::optional<String> { joinedPath } : std::nullopt;
    }

    return virtualModules->contains(path) ? std::optional<String> { path } : std::nullopt;
}

EncodedJSValue BunPlugin::OnResolve::run(JSC::JSGlobalObject* globalObject, const BunString* namespaceString, const BunString* path, const BunString* importer, const BunString* importerNamespace, const BunString* resolveDir, Asker asker)
{
    Group* groupPtr = this->group(namespaceString ? namespaceString->toWTFString(BunString::ZeroCopy) : String());
    if (groupPtr == nullptr) {
        return JSValue::encode(jsUndefined());
    }
    Group& group = *groupPtr;
    auto& filters = group.filters;

    if (filters.size() == 0) {
        return JSValue::encode(jsUndefined());
    }

    auto& callbacks = group.callbacks;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String pathString = path->toWTFString(BunString::ZeroCopy);

    JSC::MarkedArgumentBuffer matchedCallbacks;
    matchedCallbacks.ensureCapacity(filters.size());
    if (matchedCallbacks.hasOverflowed()) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    for (size_t i = 0; i < filters.size(); i++) {
        auto matchResult = filters[i].get()->match(globalObject, pathString, 0);
        RETURN_IF_EXCEPTION(scope, {});
        if (!matchResult) {
            continue;
        }
        auto* function = callbacks[i].get();
        if (!function) [[unlikely]] {
            continue;
        }
        matchedCallbacks.append(function);
    }
    if (matchedCallbacks.hasOverflowed()) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
#if ENABLE(AOT)
    if (vm.hasCompiledCode() && vm.disallowVMEntryCount) [[unlikely]]
        return JSValue::encode(jsUndefined());
#endif

    for (size_t i = 0; i < matchedCallbacks.size(); i++) {
        auto* function = matchedCallbacks.at(i).getObject();

        JSC::MarkedArgumentBuffer arguments;

        JSC::JSObject* paramsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 5);
        const auto& builtinNames = WebCore::builtinNames(vm);
        auto* pathJS = Bun::toJS(globalObject, *path);
        RETURN_IF_EXCEPTION(scope, {});
        paramsObject->putDirect(
            vm, builtinNames.pathPublicName(),
            pathJS);
        auto* importerJS = Bun::toJS(globalObject, *importer);
        RETURN_IF_EXCEPTION(scope, {});
        paramsObject->putDirect(
            vm, builtinNames.importerPublicName(),
            importerJS);
        auto* importerNamespaceJS = Bun::toJS(globalObject, *importerNamespace);
        RETURN_IF_EXCEPTION(scope, {});
        paramsObject->putDirect(vm, Identifier::fromString(vm, "namespace"_s), importerNamespaceJS);
        JSValue resolveDirJS = jsUndefined();
        if (!resolveDir->isEmpty()) {
            resolveDirJS = Bun::toJS(globalObject, *resolveDir);
            RETURN_IF_EXCEPTION(scope, {});
        }
        paramsObject->putDirect(vm, Identifier::fromString(vm, "resolveDir"_s), resolveDirJS);
        // import.meta.resolve() and Bun.resolveSync() report what import() would load, so they are "dynamic-import" too.
        ASCIILiteral kind = asker == Asker::Require ? "require-call"_s
            : asker == Asker::RequireResolve        ? "require-resolve"_s
            : isResolvingImportStatement            ? "import-statement"_s
                                                    : "dynamic-import"_s;
        paramsObject->putDirect(vm, Identifier::fromString(vm, "kind"_s), jsNontrivialString(vm, kind));
        arguments.append(paramsObject);

        SetForScope ownRequests(isResolvingImportStatement, false);
        auto result = AsyncContextFrame::call(globalObject, function, JSC::jsUndefined(), arguments);
        RETURN_IF_EXCEPTION(scope, {});

        if (result.isUndefinedOrNull()) {
            continue;
        }

        if (auto* promise = dynamicDowncast<JSPromise>(result)) {
            switch (promise->status()) {
            case JSPromise::Status::Pending: {
                JSC::throwTypeError(globalObject, scope, "onResolve() doesn't support pending promises yet"_s);
                return {};
            }
            case JSPromise::Status::Rejected: {
                promise->markAsHandled();
                JSC::throwException(globalObject, scope, promise->result());
                return {};
            }
            case JSPromise::Status::Fulfilled: {
                result = promise->result();
                break;
            }
            }
        }

        // Check again after promise resolution
        if (result.isUndefinedOrNull()) {
            continue;
        }

        if (!result.isObject()) {
            JSC::throwTypeError(globalObject, scope, "onResolve() expects an object returned"_s);
            return {};
        }

        RELEASE_AND_RETURN(scope, JSValue::encode(result));
    }

    return JSValue::encode(JSC::jsUndefined());
}

} // namespace Zig

#if ENABLE(AOT)
BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledFactorySettled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    uncheckedDowncast<JSC::JSPromise>(callFrame->argument(1))->resolve(globalObject, JSC::getVM(globalObject), callFrame->argument(0));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionDecideFailureRetention, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(lexicalGlobalObject));
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* mock = Zig::toModuleMock(globalObject, scope, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    Zig::decideFailureRetention(globalObject, mock);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionSettleReplacedFactory, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* patched = uncheckedDowncast<JSC::JSPromise>(callFrame->argument(1));
    patched->resolve(globalObject, JSC::getVM(globalObject), JSC::jsUndefined());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionCompiledFactoryFailed, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    uncheckedDowncast<JSC::JSPromise>(callFrame->argument(1))->reject(JSC::getVM(globalObject), callFrame->argument(0));
    return JSC::JSValue::encode(JSC::jsUndefined());
}
#endif

BUN_DEFINE_HOST_FUNCTION(jsFunctionMockModuleFactoryResolve, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* mock = Zig::toModuleMock(globalObject, scope, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    String specifier;
    bool isCurrent = Zig::didSettlePendingModulePatch(globalObject, mock, specifier);
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    mock->isFactoryUnawaited = false;
    // The promise may have been dropped for a factory that never settled. Then there is nothing to pass on.
    bool isMockLingering = !isCurrent && mock->state == Zig::JSModuleMock::State::Settled && mock->result && Zig::isRemovedWithPendingLoads(globalObject, mock, specifier) && !JSC::AOT::isMockLingering(globalObject, JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule));
    isCurrent = isCurrent || isMockLingering;
#endif
    if (!isCurrent)
        return JSC::JSValue::encode(JSC::jsUndefined());

    Zig::LoadedModule loaded = Zig::findLoadedModule(globalObject, mock->specifier.get());
#if ENABLE(AOT)
    if (mock->unevaluatedCompiledModule)
        loaded.compiledModule = JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule);
    else if (loaded.compiledModule && JSC::AOT::isReleased(globalObject, *loaded.compiledModule)) [[unlikely]]
        loaded.compiledModule = std::nullopt;
    globalObject->onLoadPlugins.pendingCompiledMocks.removeAllMatching([&](const auto& waiting) { return waiting.second.get() == mock && loaded.compiledModule && waiting.first == loaded.compiledModule->index(); });
#endif
    if (!scope.exception()) [[likely]] {
        Zig::keepModuleObjectLeftBehindMock(mock, loaded);
#if ENABLE(AOT)
        JSC::AOT::setModuleWithSettledFactory(globalObject, loaded.compiledModule);
#endif
        Zig::overrideLoadedModuleExports(globalObject, mock, loaded);
#if ENABLE(AOT)
        JSC::AOT::setModuleWithSettledFactory(globalObject, std::nullopt);
#endif
    }
#if ENABLE(AOT)
    if (isMockLingering && !scope.exception())
        JSC::AOT::markMockLingering(globalObject, *loaded.compiledModule);
#endif
    if (auto* exception = scope.exception()) [[unlikely]] {
        if (scope.tryClearException()) {
            scope.release();
            Zig::failPendingModulePatch(globalObject, mock, specifier, exception->value());
        }
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionMockModuleFactoryReject, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* mock = Zig::toModuleMock(globalObject, scope, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    String specifier;
    bool isCurrent = Zig::didSettlePendingModulePatch(globalObject, mock, specifier);
    RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
    if (!isCurrent && mock->waitingImportCount) {
        mock->errorOwedToImports.set(vm, mock, callFrame->argument(0));
        mock->numberOfImportsOwedError = std::exchange(mock->waitingImportCount, 0);
    }
    // A require() cannot wait for the factory that it called. If nothing has waited since, the failure is reported, as in `bun test`.
    auto& factories = globalObject->onLoadPlugins.compiledMockFactories;
    size_t started = factories.findIf([&](const auto& factory) { return factory.mock.get() == mock; });
    // A detached load fails with this call, and no later mock is called for it.
    auto* laterMock = isCurrent ? nullptr : Zig::registeredModuleMock(globalObject, mock->specifier->tryGetValue().data);
    bool failsDetachedLoad = laterMock && laterMock->state == Zig::JSModuleMock::State::NotCalled && started != notFound && factories[started].isAwaitedByDetachedLoad && !factories[started].joinedFetchWhenCalled;
    bool isUnawaited = std::exchange(mock->isFactoryUnawaited, false) && !mock->waitingImportCount && !mock->numberOfImportsOwedError;
    bool wasCalledByLoad = started != notFound || isUnawaited;
    unsigned reports = started != notFound ? std::exchange(factories[started].rejectedRequireCount, 0) : 0;
    if (!isCurrent && !isUnawaited && started != notFound && factories[started].isAwaitedByDetachedLoad && factories[started].joinedFetchInFlight && Zig::registeredModuleMock(globalObject, mock->specifier->tryGetValue().data))
        ++reports;
    for (; reports; --reports)
        JSC::JSPromise::rejectedPromise(globalObject, callFrame->argument(0));
    bool joinedFetchInFlight = started != notFound && factories[started].isAwaitedByDetachedLoad && factories[started].joinedFetchInFlight;
    if (isUnawaited && started != notFound)
        factories.removeAt(started);
    if (!isCurrent && (isUnawaited || failsDetachedLoad || (joinedFetchInFlight && !Zig::registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) && !JSC::AOT::hasRequireCacheEntry(globalObject, JSC::AOT::ModuleID(factories[started].module))))) {
        scope.throwException(globalObject, callFrame->argument(0));
        return {};
    }
#endif
    if (!isCurrent)
        return JSC::JSValue::encode(JSC::jsUndefined());

#if ENABLE(AOT)
    // None of the module has run. See JSC::AOT::FactoryFailurePolicy::RetryFactory.
    if (mock->unevaluatedCompiledModule && mock->importsOriginal) {
        Zig::deferMockToNextLoad(globalObject, mock);
        RETURN_IF_EXCEPTION(scope, {});
        // An import() that still waits for the file has joined this load in `bun test`: it gets this error, and the factory is not called again.
        JSC::AOT::didFailImportOriginalFactory(globalObject, JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule), callFrame->argument(0));
        scope.throwException(globalObject, callFrame->argument(0));
        return {};
    }
    // In `bun test` the loader calls such a factory at every load, so the mock stays active. Its waiters retry, and get the error
    // from runCompiledMock().
    // For ES modules and CommonJS files only, not for built-in modules and data files.
    // A load called the factory. If mock.module() called it, its caller gets the promise instead.
    auto isFileOfProgram = [](JSC::AOT::ModuleID module) { return JSC::AOT::isESModule(module) || (!JSC::AOT::isOfLibrary(module) && !JSC::AOT::isDataFile(module)); };
    if (wasCalledByLoad && mock->unevaluatedCompiledModule && isFileOfProgram(JSC::AOT::ModuleID(*mock->unevaluatedCompiledModule))) {
        // A call that several loads have joined rejects once for each of them.
        bool isOwedToImports = mock->waitingImportCount || (mock->numberOfImportsOwedError && mock->errorOwedToImports.get() == callFrame->argument(0));
        if (mock->waitingImportCount) {
            mock->errorOwedToImports.set(vm, mock, callFrame->argument(0));
            mock->numberOfImportsOwedError = std::exchange(mock->waitingImportCount, 0);
        }
        if (!isUnawaited && (!isOwedToImports || (started != notFound && factories[started].isAwaitedByDetachedLoad)))
            mock->lateFactoryError.set(vm, mock, callFrame->argument(0));
        uint32_t module = *mock->unevaluatedCompiledModule;
        auto& waiting = globalObject->onLoadPlugins.pendingCompiledMocks;
        waiting.removeAllMatching([&](const auto& entry) { return entry.first == module; });
        waiting.append({ module, JSC::Strong<JSC::JSObject> { vm, mock } });
        JSC::AOT::deferMockAfterAsyncFailure(globalObject, JSC::AOT::ModuleID(module));
        JSC::AOT::retainFactoryLoadedImporters(globalObject, JSC::AOT::ModuleID(module));
        if (isUnawaited || joinedFetchInFlight)
            scope.throwException(globalObject, callFrame->argument(0));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    if (mock->isFromPreload && mock->wasFactoryStartedByRequire && globalObject->vm().hasCompiledCode() && Bun__AOT__runsTestFilesAgain()) [[unlikely]]
        Bun::recordRepeatedFileRun(globalObject, specifier, "a factory that a require() started failed in a later run of a test file"_s);
#endif
    scope.release();
    Zig::failPendingModulePatch(globalObject, mock, specifier, callFrame->argument(0));
    return {};
}

extern "C" JSC::EncodedJSValue Bun__runOnResolvePlugins(Zig::GlobalObject* globalObject, const BunString* namespaceString, const BunString* path, const BunString* from, const BunString* importerNamespace, const BunString* resolveDir, Zig::BunPlugin::OnResolve::Asker asker)
{
#if ENABLE(AOT)
    bool engineAsks = false;
    if (std::optional<JSC::EncodedJSValue> kept = Bun::takeSavedResolution(globalObject, namespaceString, path, from, engineAsks))
        return *kept;
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    JSC::EncodedJSValue answer = globalObject->onResolvePlugins.run(globalObject, namespaceString, path, from, importerNamespace, resolveDir, asker);
    JSC::Exception* thrown = scope.exception();
    if (engineAsks) [[unlikely]]
        Bun::saveResolution(globalObject, namespaceString, path, from, thrown ? thrown->value() : JSC::JSValue::decode(answer), !!thrown);
    return answer;
#else
    return globalObject->onResolvePlugins.run(globalObject, namespaceString, path, from, importerNamespace, resolveDir, asker);
#endif
}

extern "C" bool Bun__isKeyOfLoadedModule(Zig::GlobalObject* globalObject, const BunString* key)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String string = key->toWTFString();
    if (Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, string)))
        return true;
    RELEASE_AND_RETURN(scope, Bun::testFileRequireMap(globalObject)->has(globalObject, jsString(vm, string)));
}

extern "C" bool Bun__hasPlugins(Zig::GlobalObject* globalObject)
{
    return !globalObject->onLoadPlugins.isEmpty() || !globalObject->onResolvePlugins.isEmpty();
}

extern "C" uint8_t Bun__onResolveNamespaces(Zig::GlobalObject* globalObject)
{
#if ENABLE(AOT)
    if (Bun::hasCompiledModules() && Bun::hasSavedResolutions()) [[unlikely]]
        return 3;
#endif
    auto& plugins = globalObject->onResolvePlugins;
    return (plugins.fileNamespace.filters.isEmpty() ? 0 : 1) | (plugins.groups.isEmpty() ? 0 : 2);
}

extern "C" BunString Bun__resolveVirtualModule(Zig::GlobalObject* globalObject, const BunString* specifier, const BunString* importer)
{
    auto& plugins = globalObject->onLoadPlugins;
    if (plugins.hasVirtualModules()) {
        if (auto key = plugins.resolveVirtualModule(specifier->toWTFString(), importer->toWTFString(BunString::ZeroCopy)))
            return Bun::toStringRef(*key);
    }
    return { BunStringTag::Dead };
}

extern "C" bool Bun__hasOnLoad(Zig::GlobalObject* globalObject, const BunString* namespaceString, const BunString* path)
{
    auto* group = globalObject->onLoadPlugins.group(namespaceString ? namespaceString->toWTFString(BunString::ZeroCopy) : String());
    if (!group)
        return false;
    auto pathString = path->toWTFString(BunString::ZeroCopy);
    return group->find(globalObject, pathString);
}

namespace Bun {

#if ENABLE(AOT)
void didDeleteModuleMockKey(Zig::GlobalObject* globalObject, const String& key)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Test, ReturnDefault, void)
    auto* mock = Zig::registeredModuleMock(globalObject, key);
    if (mock && std::exchange(mock->wasRestoredByTestMock, false))
        Zig::redisplacePreloadMock(globalObject, mock);
    BUN_END_REMOVABLE_ENTRY_POINT
}
#endif

Structure* createModuleMockStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Zig::JSModuleMock::createStructure(vm, globalObject, prototype);
}

JSC::JSValue runVirtualModule(Zig::GlobalObject* globalObject, BunString* specifier, bool& wasModuleMock, Zig::BunPlugin::OnLoad::Matches& onLoad)
{
    auto fallback = [&]() -> JSC::JSValue {
        return globalObject->onLoadPlugins.run(globalObject, specifier->toWTFString(BunString::ZeroCopy), onLoad);
    };

    if (isBunTest && !Zig::JSMock__isInPreload(globalObject)) {
        // require() of a loaded ES module and import() of a loaded CommonJS one get here too, but load nothing and keep the owner.
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, specifier->toWTFString()));
        JSValue cached = JSValue::decode(JSC__JSMap__get(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(jsString(vm, specifier->toWTFString()))));
        scope.assertNoExceptionExceptTermination();
        auto* commonJSModule = cached ? dynamicDowncast<Bun::JSCommonJSModule>(cached) : nullptr;
        if ((!entry || !entry->record()) && !(commonJSModule && commonJSModule->hasEvaluated))
            globalObject->onLoadPlugins.testFileOfModule.set(specifier->toWTFString(), globalObject->onLoadPlugins.testFile);
    }

    WTF::String specifierString = specifier->toWTFString(BunString::ZeroCopy);
    if (auto& beingLoaded = globalObject->onLoadPlugins.moduleMocksBeingLoaded; !beingLoaded.isEmpty()) [[unlikely]] {
        auto* moduleMock = dynamicDowncast<Zig::JSModuleMock>(beingLoaded.get(specifierString).get());
        if (moduleMock && moduleMock->state != Zig::JSModuleMock::State::NotCalled) {
            // Only for the load it was kept for, which has a registry entry without a record. A load that starts now gets the current mock.
            auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(globalObject->vm(), specifierString));
            if (entry && !entry->record()) {
                wasModuleMock = true;
                return moduleMock;
            }
            beingLoaded.remove(specifierString);
        }
    }

    if (String mocked = Zig::specifierOfUnwaitedModuleMockKey(specifierString); !mocked.isNull()) [[unlikely]] {
        if (auto* moduleMock = Zig::registeredModuleMock(globalObject, mocked)) {
            wasModuleMock = true;
            return moduleMock;
        }
    }

    if (!globalObject->onLoadPlugins.hasVirtualModules()) {
        return fallback();
    }
    auto& virtualModules = *globalObject->onLoadPlugins.virtualModules;

    if (auto virtualModuleFn = virtualModules.get(specifierString)) {
        auto& vm = JSC::getVM(globalObject);
        JSC::JSObject* function = virtualModuleFn.get();
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        JSValue result;

        if (Zig::JSModuleMock* moduleMock = dynamicDowncast<Zig::JSModuleMock>(function)) {
            wasModuleMock = true;
            return moduleMock;
        } else {
            // regular function
            JSC::MarkedArgumentBuffer arguments;
            JSC::CallData callData = JSC::getCallData(function);
            RELEASE_ASSERT(callData.type != JSC::CallData::Type::None);

            result = call(globalObject, function, callData, JSC::jsUndefined(), arguments);
        }

        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());

        if (auto* promise = dynamicDowncast<JSPromise>(result)) {
            switch (promise->status()) {
            case JSPromise::Status::Rejected:
            case JSPromise::Status::Pending: {
                return promise;
            }
            case JSPromise::Status::Fulfilled: {
                result = promise->result();
                break;
            }
            }
        }

        if (!result.isObject()) {
            JSC::throwTypeError(globalObject, throwScope, "virtual module expects an object returned"_s);
            return {};
        }

        return result;
    }

    if (auto builtin = Zig::builtinModuleOfOriginalKey(specifierString))
        *specifier = Bun::toStringView(*builtin);

    if (Zig::isModuleMockEvaluatorKey(specifierString)) {
        auto& vm = JSC::getVM(globalObject);
        JSObject* exports = JSC::constructEmptyObject(globalObject);
        exports->putDirect(vm, vm.propertyNames->defaultKeyword, JSC::JSFunction::create(vm, globalObject, 2, String(), Zig::jsFunctionEvaluateModuleMock, ImplementationVisibility::Private));
        JSObject* result = JSC::constructEmptyObject(globalObject);
        result->putDirect(vm, JSC::Identifier::fromString(vm, "loader"_s), jsNontrivialString(vm, "object"_s));
        result->putDirect(vm, JSC::Identifier::fromString(vm, "exports"_s), exports);
        return result;
    }

    return fallback();
}

JSC::JSValue findModuleMock(Zig::GlobalObject* globalObject, const BunString* specifier)
{
    if (!globalObject->onLoadPlugins.hasVirtualModules())
        return {};
    return Zig::registeredModuleMock(globalObject, specifier->toWTFString(BunString::ZeroCopy));
}

JSC::JSPromise* runModuleMock(Zig::GlobalObject* globalObject, JSC::JSObject* moduleMock, const String& key, bool synchronous)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* mock = Zig::toModuleMock(globalObject, scope, moduleMock);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!Zig::specifierOfUnwaitedModuleMockKey(key).isNull())
        return nullptr;

    if (!synchronous && mock->state == Zig::JSModuleMock::State::NotCalled) {
        if (mock->importsOriginal)
            return nullptr;
        // Call the factory from a microtask, not under the loader's fetch of this module: what the factory loads may import it too.
        String specifier = mock->specifier->value(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        globalObject->onLoadPlugins.moduleMocksBeingLoaded.add(specifier, JSC::Strong<JSC::JSObject> { vm, mock });
        JSC::JSPromise* fulfilled = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        fulfilled->fulfill(vm, jsUndefined());
        JSC::JSPromise* settled = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        JSC::JSFunction* later = JSC::JSFunction::create(vm, globalObject, 2, String(), Zig::jsFunctionRunModuleMockLater, ImplementationVisibility::Private);
        auto* waiting = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), settled, jsUndefined());
        fulfilled->performPromiseThenWithContext(vm, globalObject, later, jsUndefined(), jsUndefined(), Zig::moduleMockWith(globalObject, mock, waiting));
        return settled;
    }

#if ENABLE(AOT)
    if (synchronous && vm.hasCompiledCode() && mock->state == Zig::JSModuleMock::State::NotCalled) {
        auto& plugins = globalObject->onLoadPlugins;
        auto file = Bun::compiledModuleForPath(mock->specifier->value(globalObject));
        RETURN_IF_EXCEPTION(scope, nullptr);
        bool comesToCallInFlight = file && plugins.latestCompiledFactoryCalls.containsIf([&](const auto& newest) {
            return newest.first == file->index() && !((newest.second & Zig::endedMockCallBit) && !JSC::AOT::hasOrphanedFetch(globalObject, *file)) && plugins.compiledMockFactories.containsIf([&](const auto& earlier) { return earlier.call == (newest.second & ~Zig::endedMockCallBit) && earlier.patched->status() == JSC::JSPromise::Status::Pending; });
        });
        JSC::JSPromise* pending = mock->run(globalObject, synchronous);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (pending && comesToCallInFlight)
            pending->performPromiseThen(vm, globalObject, JSC::jsUndefined(), JSC::jsUndefined(), JSC::JSPromise::create(vm, globalObject->promiseStructure()));
        return pending;
    }
#endif
    RELEASE_AND_RETURN(scope, mock->run(globalObject, synchronous));
}

bool isModuleMockInUse(Zig::GlobalObject* globalObject, JSC::JSObject* moduleMock)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* mock = dynamicDowncast<Zig::JSModuleMock>(moduleMock);
    if (!mock || mock->state != Zig::JSModuleMock::State::NotCalled)
        return true;
    String key = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, true);
    return Zig::registeredModuleMock(globalObject, key) == mock;
}

void evictModulesThatHaveLoaded(Zig::GlobalObject* globalObject)
{
    if (globalObject->onLoadPlugins.modulesToEvictOnceLoaded.isEmpty() || globalObject->vm().m_synchronousModuleQueue) [[likely]]
        return;
    Zig::ModulesToEvict evict;
    evict.hasLoadSettled = true;
    Zig::evictModulesAndTheirImporters(globalObject, WTF::move(evict));
}

void evictModuleThatNothingFetches(Zig::GlobalObject* globalObject, const JSC::Identifier& key)
{
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(key);
    if (entry && Zig::isNeverFetched(entry)) [[unlikely]]
        Zig::evictModulesAndTheirImporters(globalObject, Vector<String> { key.string() });
}

JSC::JSObject* resultOfModuleMock(JSC::JSObject* moduleMock)
{
    auto* mock = dynamicDowncast<Zig::JSModuleMock>(moduleMock);
    return mock && mock->state == Zig::JSModuleMock::State::Settled ? mock->result.get() : nullptr;
}

static bool hasUncalledAsyncFactory(Zig::JSModuleMock* mock)
{
    if (!mock || mock->state != Zig::JSModuleMock::State::NotCalled)
        return false;
    // Empty for an automock.
    JSValue value = mock->factory.get();
#if ENABLE(AOT)
    // Compiled functions have no executable. The build reports what the parser below reports.
    if (JSObject* compiled = value ? value.getObject() : nullptr; compiled && compiled->vm().hasCompiledCode() && JSC::AOT::CompiledCallee::isCompiledCallee(compiled))
        return JSC::AOT::hasOwnAwait(compiled) || JSC::AOT::declaredAs(compiled) == JSC::AOT::DeclaredAs::AsyncGeneratorFunction;
#endif
    auto* factory = value ? dynamicDowncast<JSC::JSFunction>(value) : nullptr;
    if (!factory || factory->isHostOrBuiltinFunction())
        return false;
    auto* executable = factory->jsExecutable();
    if (!JSC::isAsyncFunctionParseMode(executable->parseMode()))
        return false;
    // The parser says so once the body is compiled. Without an `await` of its own it settles during the call, so require() gets the mock.
    auto& vm = mock->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::CodeBlock* codeBlock = nullptr;
    executable->prepareForExecution<JSC::FunctionExecutable>(vm, factory, factory->scope(), JSC::CodeSpecializationKind::CodeForCall, codeBlock);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return false;
    }
    return !(executable->features() & JSC::AsyncFunctionWithoutAwaitFeature);
}

bool hasModuleMockUnsettledAsyncFactory(JSC::JSObject* moduleMock)
{
    auto* mock = dynamicDowncast<Zig::JSModuleMock>(moduleMock);
    if (mock && mock->state == Zig::JSModuleMock::State::Running)
        return mock->result && mock->result->inherits<JSC::JSPromise>();
    return hasUncalledAsyncFactory(mock);
}

bool canRequireOriginalOfModuleMock(Zig::GlobalObject* globalObject, JSC::JSObject* moduleMock)
{
    auto* mock = dynamicDowncast<Zig::JSModuleMock>(moduleMock);
    if (!hasUncalledAsyncFactory(mock))
        return false;
#if ENABLE(AOT)
    // A compiled file that the mock stashed has no entry under the key below. The runtime keeps its record.
    if (auto compiled = mock->didStashCompiledModule || mock->isOriginalAfterAwait ? Bun::compiledModuleForPath(mock->specifier->tryGetValue().data) : std::nullopt; compiled && JSC::AOT::wasDisplacedDuringEvaluation(globalObject, *compiled))
        return false;
    // A detached original has no evaluated record until its body has run.
    if (auto compiled = mock->isOriginalLoadDetached ? Bun::compiledModuleForPath(mock->specifier->tryGetValue().data) : std::nullopt; compiled && !JSC::AOT::wasOriginalEvaluated(globalObject, *compiled))
        return false;
#endif
    // An import of the mock loads what the original imports before it calls a factory that takes the original.
    String key = Zig::originalModuleKey(mock->specifier->tryGetValue().data);
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(globalObject->vm(), key));
    if (!entry)
        return true;
    auto* cyclic = entry->record() ? dynamicDowncast<JSC::CyclicModuleRecord>(entry->record()) : nullptr;
    return entry->record() && (!cyclic || cyclic->isSCCEvaluated());
}

#if ENABLE(AOT)
bool isSpyMock(Zig::GlobalObject* globalObject, const String& path)
{
    auto* mock = Zig::registeredModuleMock(globalObject, path);
    return mock && mock->spy;
}

// An automock settles with its original.
bool hasSynchronousMockFactory(Zig::GlobalObject* globalObject, const String& path, bool isOriginalSynchronous)
{
    auto* mock = Zig::registeredModuleMock(globalObject, path);
    if (!mock || Zig::hasPendingFactory(mock))
        return false;
    JSValue factory = mock->factory.get();
    return factory ? factory.isCallable() && !hasUncalledAsyncFactory(mock) : isOriginalSynchronous;
}

bool hasRegisteredModuleMock(Zig::GlobalObject* globalObject, const String& path)
{
    return Zig::registeredModuleMock(globalObject, path);
}

bool canRequireMockOriginalAt(Zig::GlobalObject* globalObject, const String& path)
{
    auto* mock = Zig::registeredModuleMock(globalObject, path);
    return mock && (Zig::hasPendingFactory(mock) || canRequireOriginalOfModuleMock(globalObject, mock));
}
#endif

JSC::JSValue requireOriginalOfModuleMock(Zig::GlobalObject* globalObject, JSC::JSObject* moduleMock)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* mock = Zig::toModuleMock(globalObject, scope, moduleMock);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, Zig::requireOriginalModule(globalObject, mock));
}

std::optional<ASCIILiteral> builtinModuleOfOriginalKey(const String& key)
{
    return Zig::builtinModuleOfOriginalKey(key);
}

__attribute__((minsize)) static JSC::JSObject* generateSettledModuleMock(JSValue source, JSC::JSGlobalObject* globalObject, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* mock = uncheckedDowncast<Zig::JSModuleMock>(source);
    String key = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Re-mocked or unmocked since the fetch: use the new mock if it has settled, else evict so only the load in flight gets this one.
    auto* registered = Zig::registeredModuleMock(defaultGlobalObject(globalObject), key);
    if (registered && registered->state == Zig::JSModuleMock::State::Settled && !defaultGlobalObject(globalObject)->onLoadPlugins.moduleMocksBeingLoaded.contains(key))
        mock = registered;
    else if (registered != mock) {
        Zig::evictModulesAndTheirImporters(defaultGlobalObject(globalObject), Vector<String> { key });
        RETURN_IF_EXCEPTION(scope, nullptr);
    }

    JSC::PropertyNameArrayBuilder names(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
    Zig::JSModuleMock::getOwnPropertyNames(mock, globalObject, names, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);
    for (auto& name : names) {
        exportNames.append(name);
        exportValues.append(JSValue());
    }
    return mock;
}

__attribute__((minsize)) JSC::JSSourceCode* sourceCodeOfModuleMock(Zig::GlobalObject* globalObject, JSC::JSObject* moduleMock, const String& key, const String& typeAttribute)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* mock = Zig::toModuleMock(globalObject, scope, moduleMock);
    RETURN_IF_EXCEPTION(scope, nullptr);

    if (mock->state == Zig::JSModuleMock::State::Settled)
        return Zig::createSyntheticSourceCode(vm, mock, generateSettledModuleMock, key, true);

    String dependency = Zig::dependencyKeyOfModuleMock(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSValue factory = mock->factory.get();

    // GlobalObject::moduleLoaderResolve() takes a specifier that starts with NUL as a registry key.
    StringBuilder text;
    // Repeat the type attribute this module was imported with, or `mock` would name a different registry entry.
    auto appendKey = [&](StringView specifier) {
        text.appendQuotedJSONString(makeString('\0', specifier));
        if (!typeAttribute.isEmpty() && specifier[0]) {
            text.append(" with{type:"_s);
            text.appendQuotedJSONString(typeAttribute);
            text.append('}');
        }
    };
    text.append("import * as mock from "_s);
    appendKey(key);
    bool isUnwaited = !Zig::specifierOfUnwaitedModuleMockKey(key).isNull();
    if (!isUnwaited) {
        text.append(";import * as original from "_s);
        appendKey(dependency);
        text.append(";export * from "_s);
        appendKey(dependency);
    }
    text.append(";import evaluate from "_s);
    appendKey(makeString('\0', Zig::moduleMockEvaluatorName));
    if (isUnwaited)
        text.append(";await evaluate(mock);"_s);
    else
        text.append(factory && factory.isCallable() ? ";await evaluate(mock, original);"_s : ";evaluate(mock, original);"_s);

    // Only static code can run beside compiled code. This is the runner's own.
    auto provenance = vm.hasCompiledCode() && !Bun::isCodeGenerationFromStringsStrictByFlags() ? JSC::SourceProvenance::Static : JSC::SourceProvenance::GeneratedAtRuntime;
    Ref provider = JSC::StringSourceProvider::create(text.toString(), JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(key)), key, JSC::SourceTaintedOrigin::Untainted, WTF::TextPosition(), JSC::SourceProviderSourceType::Module, provenance);
    provider->setModuleHasLiveExports();
    return JSC::JSSourceCode::create(vm, JSC::SourceCode(WTF::move(provider)));
}

bool moduleMockImportsByKey(Zig::GlobalObject* globalObject, const String& key)
{
    if (!Zig::specifierOfUnwaitedModuleMockKey(key).isNull())
        return true;
    auto* mock = Zig::registeredModuleMock(globalObject, key);
    if (!mock)
        mock = dynamicDowncast<Zig::JSModuleMock>(globalObject->onLoadPlugins.moduleMocksBeingLoaded.get(key).get());
    return mock && mock->importsOriginal;
}

bool isModuleMockWaitingForFactory(Zig::GlobalObject* globalObject, const String& key)
{
    auto* mock = Zig::registeredModuleMock(globalObject, key);
    if (!mock)
        mock = dynamicDowncast<Zig::JSModuleMock>(globalObject->onLoadPlugins.moduleMocksBeingLoaded.get(key).get());
    return mock && (mock->state == Zig::JSModuleMock::State::Running || globalObject->onLoadPlugins.waitingModuleMocks.containsIf([&](auto& waiting) { return waiting.mock.get() == mock; }));
}

// A module that Vitest externalizes gets the original of what vi.mock() mocked. Jest's mocks reach packages too.
String packageImportKey(Zig::GlobalObject* globalObject, const String& key, const String& importer, bool isESM)
{
    if (!Zig::isInNodeModules(importer) || Zig::isBuiltinModuleKey(key))
        return key;
    auto* mock = Zig::registeredModuleMock(globalObject, key);
    // A module that was patched in place is the only instance there is.
    bool hasOriginal = mock && mock->isOfVitest() && !mock->originalExports && !mock->originalCommonJSExports;
    if (!hasOriginal || (isESM && !Zig::isExternalizedByVitest(globalObject, importer)))
        return key;
    return Zig::originalModuleKey(key);
}

// Whether some unfinished module imports both, directly or through other modules. The factories of two loads run at the same time.
// If a third load imports both modules, the later factory waits for the earlier one's mock, as if one load had called both.
__attribute__((minsize)) static bool haveUnfinishedImporterInCommon(Zig::GlobalObject* globalObject, const String& earlier, const String& later)
{
    Zig::ModuleImporters importersOf;
#if ENABLE(AOT)
    // A compiled file has no record while its fetch waits for a factory, and its records list no requests. The image knows its imports.
    bool hasCompiledCode = globalObject->vm().hasCompiledCode();
    auto earlierFile = hasCompiledCode ? compiledModuleForPath(earlier) : std::nullopt;
    auto laterFile = hasCompiledCode ? compiledModuleForPath(later) : std::nullopt;
#endif
    for (auto& [mapKey, entry] : Bun::testFileModuleLoader(globalObject)->moduleMap()) {
        auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(entry->record());
        if (!cyclic || cyclic->isSCCEvaluated())
            continue;
        for (auto& resolved : cyclic->resolvedRequests().values()) {
            Zig::addImporter(importersOf, String(mapKey.first), String { resolved.get() });
#if ENABLE(AOT)
            auto file = earlierFile || laterFile ? compiledModuleForPath(String { resolved.get() }) : std::nullopt;
            if (file && earlierFile && *earlierFile != *file && JSC::AOT::isInLoadGraph(globalObject, *file, *earlierFile))
                Zig::addImporter(importersOf, String(mapKey.first), earlier);
            if (file && laterFile && *laterFile != *file && JSC::AOT::isInLoadGraph(globalObject, *file, *laterFile))
                Zig::addImporter(importersOf, String(mapKey.first), later);
#endif
        }
    }
    auto importersAbove = [&](const String& key) {
        UncheckedKeyHashSet<String> above;
        Vector<String> queue { key };
        for (size_t i = 0; i < queue.size(); ++i) {
            auto importers = importersOf.find(queue[i]);
            if (importers == importersOf.end())
                continue;
            for (auto& importer : importers->value) {
                if (above.add(importer).isNewEntry)
                    queue.append(importer);
            }
        }
        return above;
    };
    auto aboveEarlier = importersAbove(earlier);
    for (auto& importer : importersAbove(later)) {
        if (aboveEarlier.contains(importer))
            return true;
    }
    return false;
}

__attribute__((minsize)) String keyOfImportWhileModuleMocksRun(Zig::GlobalObject* globalObject, const String& key, const String& importer, bool isESM)
{
    // It imports nothing, so it waits for no mock, and only its own key is served.
    if (Zig::isModuleMockEvaluatorKey(key))
        return key;

    // A fetch in flight for a mock that has since been replaced still waits for the old factory.
    // A new import of that module, or of one that waits for it, ends the wait, and everyone gets what the module is now.
    // Once vi.resetModules() has dropped that fetch, no module waits for the factory. If it never settles, it would otherwise
    // count as running until the file ends, and whatever its file imports meanwhile would get the original.
    // The import() that called it keeps waiting for it, as in Vitest. Waking it would load the module at a time no test chose.
    Vector<Zig::JSModuleMock*, 1> replaced, unawaited;
    for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
        auto* mock = uncheckedDowncast<Zig::JSModuleMock>(running.mock.get());
        String mocked = mock->specifier->tryGetValue().data;
        if (Zig::isStillRegisteredModuleMock(globalObject, mocked, mock)) [[likely]]
            continue;
        auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(globalObject->vm(), mocked));
        bool isFetchInFlight = entry && !entry->record();
        Vector<String> unfinished;
        if (!isFetchInFlight)
            unawaited.append(mock);
        else if (mocked == key || Zig::isWaitingForModule(globalObject, running, key, mocked, unfinished))
            replaced.append(mock);
    }
    for (auto* mock : replaced)
        mock->giveUp(globalObject);
    for (auto* mock : unawaited)
        mock->detach(globalObject);

    // The runner's own load of a test file has no importer.
    if (importer.isNull())
        return key;

    // A module that is still loading can't be running import(), so `importer` is exactly that module and not a factory's copy of it.
    auto* importerEntry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(globalObject->vm(), importer));
    auto* importerRecord = importerEntry ? dynamicDowncast<JSC::CyclicModuleRecord>(importerEntry->record()) : nullptr;
    bool isImporterBeingLoaded = importerRecord && importerRecord->status() == JSC::CyclicModuleRecord::Status::New;

    // The innermost one is asking. The ones that called it are waiting for it.
    Vector<JSObject*, 2> callers = Zig::factoriesInAsyncContext(globalObject);
    // The loader resolves static imports outside that context, so a module in a factory's import chain counts as that factory asking.
    for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
        if (running.importChain.contains(importer) && !callers.contains(running.mock.get()))
            callers.append(running.mock.get());
    }
    // Plus the factories that imported one of those factories' modules. They may be waiting for it, so it must not wait for theirs.
    for (bool grew = !callers.isEmpty(); std::exchange(grew, false);) {
        for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
            if (callers.contains(running.mock.get()))
                continue;
            grew = callers.containsIf([&](JSObject* caller) { return running.importChain.contains(uncheckedDowncast<Zig::JSModuleMock>(caller)->specifier->tryGetValue().data); });
            if (grew) {
                callers.append(running.mock.get());
                break;
            }
        }
    }

    // Iterate to a fixed point: the key picked for one running factory must not wait for another running factory's mock either.
    String given = key;
    String requested;
    while (std::exchange(requested, given) != given) {
        for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
            bool isInChain = running.importChain.contains(importer);
            String mocked = uncheckedDowncast<Zig::JSModuleMock>(running.mock.get())->specifier->tryGetValue().data;
            // Once another mock has replaced it, imports from its file are no longer attributed to the factory.
            bool isFactory = importer == running.file && (!Zig::registeredModuleMock(globalObject, mocked) || Zig::isStillRegisteredModuleMock(globalObject, mocked, uncheckedDowncast<Zig::JSModuleMock>(running.mock.get())));
            // The file alone can't tell which of its factories called import(). The async context can.
            if (!callers.isEmpty() && !callers.contains(running.mock.get()))
                isFactory = isFactory && !haveUnfinishedImporterInCommon(globalObject, mocked, uncheckedDowncast<Zig::JSModuleMock>(callers[0])->specifier->tryGetValue().data);
            else if (!callers.isEmpty())
                isFactory = true;
            if (!isInChain && !isFactory && (isImporterBeingLoaded || !running.importChainWithoutQuery.contains(importer)))
                continue;
            // A module that was linked as itself is patched in place: nothing waits for this factory, and the patch reaches whatever imports it meanwhile.
            if (auto* entry = isESM ? Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(globalObject->vm(), mocked)) : nullptr; entry && entry->record()) {
                auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(entry->record());
                if (!cyclic || cyclic->isSCCEvaluated() || (!cyclic->hasLiveExports() && cyclic->status() >= JSC::CyclicModuleRecord::Status::Linked))
                    continue;
            }
#if ENABLE(AOT)
            // The loader has no entry for a compiled module: the runtime knows whether an import has loaded it. The file of a compiled factory is only known if mock.module() itself
            // called it and will patch. If a load called the factory, importers do wait.
            JSObject* runningFactory = uncheckedDowncast<Zig::JSModuleMock>(running.mock.get())->factory ? uncheckedDowncast<Zig::JSModuleMock>(running.mock.get())->factory.get().getObject() : nullptr;
            bool willPatch = isESM && !running.file.isEmpty() && runningFactory && globalObject->vm().hasCompiledCode() && JSC::AOT::CompiledCallee::isCompiledCallee(runningFactory);
            if (auto module = willPatch ? Bun::compiledModuleForPath(mocked) : std::nullopt; module && JSC::AOT::hasImportStartedLoading(globalObject, *module) && JSC::AOT::wasLoadedByImport(globalObject, *module) && !JSC::AOT::isEvicted(globalObject, *module))
                continue;
#endif
            String instead = given == mocked ? Zig::originalModuleKey(given) : given;
            String copy = Zig::redirectedModuleKey(globalObject, running, instead, mocked);
            if (isESM)
                instead = copy;
            else
                Zig::addToImportChain(globalObject, running, instead);
            if (instead != given && isInChain && !importer.contains("?actual"_s) && !importer.contains("&actual"_s))
                running.givenTheOriginal.append(importer);
            given = instead;
        }
    }
    // Its turn is its own, as in Vitest: what the test resolves later may be what a factory that it calls waits for.
    if (callers.isEmpty() && !isImporterBeingLoaded)
        globalObject->onLoadPlugins.loadRootsDuringFactories.add(given);
    else
        globalObject->onLoadPlugins.loadRootsDuringFactories.remove(given);
    return given;
}

JSC::JSObject* objectHoldingExportOfModuleMock(JSC::JSGlobalObject* globalObject, JSC::JSModuleNamespaceObject* moduleNamespace, const JSC::Identifier& name)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto resolution = moduleNamespace->moduleRecord()->resolveExport(globalObject, name);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!resolution.isLiveExport(vm))
        return nullptr;
    JSObject* source = resolution.moduleRecord->liveExportsSource();
    auto* mock = source ? dynamicDowncast<Zig::JSModuleMock>(source) : nullptr;
    return mock ? mock->exports.get() : nullptr;
}

#if ENABLE(AOT)
JSC::JSObject* compiledMockExportHolder(JSC::JSGlobalObject* globalObject, JSC::JSObject* moduleNamespace, const JSC::Identifier& name)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // A namespace object that was created under a mock keeps reading its names from that mock. The record is the module's current one.
    JSObject* readThrough = JSC::AOT::activeMockForNamespace(moduleNamespace);
    if (auto* mock = readThrough ? dynamicDowncast<Zig::JSModuleMock>(readThrough) : nullptr) {
        JSObject* exports = mock->exports.get();
        bool holdsName = exports && exports->hasProperty(globalObject, name);
        RETURN_IF_EXCEPTION(scope, nullptr);
        // With Vitest the object has no other names: reading a name that the mock lacks throws. A spy gives the mock the name.
        if (holdsName || (exports && mock->isOfVitest()))
            return exports;
    }
    JSC::AbstractModuleRecord* moduleRecord = JSC::AOT::isModuleNamespace(moduleNamespace) ? JSC::AOT::moduleRecordForNamespace(globalObject, moduleNamespace) : nullptr;
    if (!moduleRecord)
        return nullptr;
    auto resolution = moduleRecord->resolveExport(globalObject, name);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!resolution.isLiveExport(vm))
        return nullptr;
    JSObject* source = resolution.moduleRecord->liveExportsSource();
    auto* mock = source ? dynamicDowncast<Zig::JSModuleMock>(source) : nullptr;
    return mock ? mock->exports.get() : nullptr;
}
#endif

} // namespace Bun

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPluginClear, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    Zig::GlobalObject* global = static_cast<Zig::GlobalObject*>(globalObject);
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto& plugins = global->onLoadPlugins;
    if (plugins.virtualModules) {
        for (auto& [specifier, virtualModule] : *plugins.virtualModules) {
            auto* mock = dynamicDowncast<Zig::JSModuleMock>(virtualModule.get());
            if (!mock)
                continue;
            auto loaded = Zig::findLoadedModule(global, mock->specifier.get());
            RETURN_IF_EXCEPTION(scope, {});
            Zig::keepInFlightModuleMock(global, mock, specifier, loaded);
        }
    }
#if ENABLE(AOT)
    for (auto& waiting : std::exchange(plugins.pendingCompiledMocks, {})) {
        JSC::AOT::didRemoveMock(global, JSC::AOT::ModuleID(waiting.first));
        RETURN_IF_EXCEPTION(scope, {});
    }
#endif
    auto moduleMocksBeingLoaded = std::exchange(plugins.moduleMocksBeingLoaded, {});
    auto runningModuleMocks = std::exchange(plugins.runningModuleMocks, {});
    auto waitingModuleMocks = std::exchange(plugins.waitingModuleMocks, {});
    auto moduleMocksWithTurn = std::exchange(plugins.moduleMocksWithTurn, {});
    plugins.clear();
    plugins.moduleMocksBeingLoaded = WTF::move(moduleMocksBeingLoaded);
    plugins.runningModuleMocks = WTF::move(runningModuleMocks);
    plugins.waitingModuleMocks = WTF::move(waitingModuleMocks);
    plugins.moduleMocksWithTurn = WTF::move(moduleMocksWithTurn);
    global->onResolvePlugins.clear();
#if ENABLE(AOT)
    if (global->vm().hasCompiledCode())
        JSC::AOT::didChangePlugins(global);
#endif

    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPlugin, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    BUN_REMOVABLE_HOST_FUNCTION_DEFINITION(Plugin, jsFunctionBunPlugin);
    if (JSC::JSValue error = Bun::errorIfUnseenCodeIsRefused(globalObject, "Bun.plugin"_s)) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
        JSC::throwException(globalObject, scope, error);
        return {};
    }
    return Bun::setupBunPlugin(globalObject, callframe, BunPluginTargetBun);
}
