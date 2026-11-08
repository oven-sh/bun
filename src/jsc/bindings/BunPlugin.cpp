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
#include <wtf/text/WTFString.h>

#include "BunClientData.h"
#include "BuiltinModuleKeys.h"
#include "JSCommonJSModule.h"
#include "ModuleGraph.h"
#include "ModuleLoader.h"
#include "PathInlines.h"
#include "isBuiltinModule.h"
#include "AsyncContextFrame.h"
#include "ImportMetaObject.h"
#include "../modules/ObjectModule.h"

namespace Bun {
static bool haveUnfinishedImporterInCommon(Zig::GlobalObject*, const String& earlier, const String& later);
}

namespace Zig {

static void evictModulesAndTheirImporters(Zig::GlobalObject*, Vector<String>&& modules);

static bool isValidNamespaceCharacter(char16_t c)
{
    return isASCIIAlphanumeric(c) || c == '_' || c == '-' || c == '/' || c == '@';
}

static bool isValidNamespaceString(String& namespaceString)
{
    return !namespaceString.isEmpty() && namespaceString.containsOnly<isValidNamespaceCharacter>();
}

static bool throwsWhereBuildSawNoPlugin(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope)
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
    if (throwsWhereBuildSawNoPlugin(globalObject, scope))
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
    if (throwsWhereBuildSawNoPlugin(globalObject, scope))
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
    if (throwsWhereBuildSawNoPlugin(globalObject, scope))
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

    if (Bun::compiledModulesRunInPlaceOfFiles() && (namespaceString.isEmpty() || namespaceString == "file"_s)) {
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

void BunPlugin::OnLoad::addModuleMock(JSC::VM& vm, const String& path, JSC::JSObject* mockObject)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(mockObject->globalObject());

    if (globalObject->onLoadPlugins.virtualModules == nullptr) {
        globalObject->onLoadPlugins.virtualModules = new BunPlugin::VirtualModuleMap;
    }
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;

    virtualModules->set(path, JSC::Strong<JSC::JSObject> { vm, mockObject });
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
    WriteBarrier<JSObject> originalNamespace;
    // These outlive the patched module's eviction, so unmocking still restores it for whatever stays linked to it (a preload, say).
    WriteBarrier<JSC::JSModuleNamespaceObject> patchedNamespace;
    WriteBarrier<JSObject> originalExportsOfEvictedModule;
    // Patches are undone newest first: two modules can export one variable (`export *`), and each patch saved what it found there.
    unsigned patchOrder { 0 };
    State state { State::NotCalled };
    // Moments, see OnLoad::momentOfModuleMocks: when the factory was called, and when the import() that led to it was. They outlast the run of the factory: whoever asked meanwhile comes to its turn later.
    uint32_t calledAt { 0 };
    uint32_t askedForAt { 0 };
    ModuleMockFunction function;
    // The factory's promise is pending and will patch the already-loaded module when it settles.
    bool hasPendingPatch { false };
    bool spy { false };
    bool isFromPreload { false };
    // unmockModule() registers that module under its own key again.
    bool hasSetLoadedModuleAside { false };
#if ENABLE(AOT)
    // The same of a compiled file, of which the loader holds nothing to move.
    bool hasSetCompiledModuleAside { false };
    // A mock of a test file that was laid over a preload's. The loader holds nothing of a compiled module to set aside: where it would have set aside what stood under the key, the second word says so: hasSetLoadedModuleAside, of the preload's instance.
    bool wasLaidOverMockOfPreload { false };
    bool hasSetMockOfPreloadAside { false };
    // It has patched the CommonJS module that had come back, and its end restores that.
    bool patchesMockOfPreload { false };
    // A preload's mock that such a one has displaced, and not the test file's own vi.doUnmock().
    bool isDisplacedByMockOfTestFile { false };
    // One that the end of that mock has registered again. Under `bun test` it stays displaced until the end of the test file, which empties its key.
    bool cameBackAtEndOfMockOfTestFile { false };
    // What lies under the key of the original: this preload's mock's instance, from where a mock of a test file sets it aside to where an end moves it back or something else is set aside over it. See setLoadedModuleAside() and packagesToBringBack.
    bool liesUnderKeyOfOriginal { false };
    // A reset has taken it out from there, as it takes out a preload's module: giveBackPreloadModules() lays it back at the end of the test file.
    bool liesThereBehindReset { false };
    bool lostOriginalsToReset { false };
    bool lostCommonJSExportsToReset { false };
#endif
    // Loaded as a generated ES module that imports the original (or the `__mocks__` file) and calls the factory when evaluated.
    bool importsOriginal { false };
    // The tests of its file were done while a call of import() still waited for it. See JSMock__letImportsHeldGetFilesThemselves().
    bool givesFileItself { false };
    bool wasLaidOverFailedLoad { false };
    bool waitsForBodyUnderWay { false };
    bool waitsForFactoryBehindBody { false };
    bool hasWaitedForTurnOfLoader { false };
    // The mock whose place it took had a factory that takes the original: what the loader holds under the key of the original is that factory's. Under any other mock that stands, `bun test` keeps what stands.
    bool wasLaidOverFactoryThatTakesOriginal { false };
    // How the hoisted factory last failed.
    bool readUninitializedVariable { false };
    // The mock waited for the first load by compiled code, and a require() behind it had left a module object in require.cache by then.
    bool keepsModuleObject { false };
#if ENABLE(AOT)
    // The compiled module whose first load ran the factory, or that was linked and had yet to run when the mock came. Its body never ran.
    std::optional<unsigned> compiledModuleThatNeverRan;
    std::optional<unsigned> moduleThatLoadAskedFor;
    // The test file that made that load, or that laid the mock over a compiled module that had run: what testFileOfModule says of a module that the loader fetched. 0 for a preload.
    unsigned testFileOfFirstLoad { 0 };
    // Over a mock that stands on a compiled module: whoever was linked under that one keeps it, as the kind of this mock says (isOfVitest()) unless the call found otherwise.
    // No: an importer of the module was linked and had yet to run, so everybody gets this mock. Yes: the factory read a variable declared below the call and waits for a load.
    std::optional<bool> leavesStandingMockToItsImporters;
    // The factory failed behind an await. Whoever waited for it asks again and is handed this, once: runCompiledMock().
    WriteBarrier<Unknown> errorOfLateFailure;
    // Calls of import() for the module itself that wait for the run of the factory that is under way: in `bun test` they share one fetch, and so its failure.
    unsigned numberOfImportsThatWait { 0 };
    bool isDetached { false };
    // It is made of its original, and was taken off while that had yet to come: under `bun test` nothing of it had been made.
    bool endedAheadOfItsOriginal { false };
    bool wasAskedFor { false };
    bool keepsFailureForImports { false };
    bool decidesWhetherFailureIsKept { false };
    bool mockThatStoodAtFailureHadSettled { false };
    WriteBarrier<JSObject> mockThatStoodAtFailure;
    void forgetFailureKeptForImports()
    {
        if (std::exchange(keepsFailureForImports, false) && !--numberOfImportsOwedError)
            errorOwedToImports.clear();
    }
    // A require() started the run of the factory that is under way and could not wait for it, and no load has come to wait since: its failure is nobody's, and is reported.
    bool nobodyWaitsForFactory { false };
    // The run failed behind an await: each of those calls is handed this, once, where it goes on: throwErrorOwedToImport(). Whoever comes to the module by a statement asks the factory anew.
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
        // The loader fetched a compiled module for a file that runs from its text, and that load failed or is under way: the entry goes like any other, so that the next import fetches the module and comes to the mock.
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
    loaded.compiledModule = globalObject->vm().hasCompiledCode() ? JSC::AOT::formThatMockFinds(globalObject, specifier, Bun::moduleThatMockReplaces(specifier)) : std::nullopt;
    // As a module that is out of the registry: nothing finds it, so nothing patches it.
    if (loaded.compiledModule && JSC::AOT::isEvictedFile(globalObject, *loaded.compiledModule))
        loaded.compiledModule = std::nullopt;
    // Several import types, as in findLoadedESModule(): the loader holds one and an image another.
    if (loaded.compiledModule && loaded.esmNamespace && JSC::AOT::isHeldForImport(globalObject, *loaded.compiledModule)) {
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
    if (globalObject->onLoadPlugins.modulesAskedFor.add(key).isNewEntry)
        globalObject->onLoadPlugins.hasNewLoad = true;
    return Bun::testFileModuleLoader(globalObject)->loadModule(globalObject, JSC::Identifier::fromString(globalObject->vm(), key), nullptr, nullptr, { JSC::ModuleLoadFlag::Evaluate, JSC::ModuleLoadFlag::Dynamic });
}

static JSC::JSPromise* importModuleFrom(Zig::GlobalObject* globalObject, const String& from, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    globalObject->onLoadPlugins.isResolvingImportCall = true;
    // The loader takes the referrer for the key of the module that imports.
    JSC::JSPromise* promise = Bun::testFileModuleLoader(globalObject)->requestImportModule(globalObject, JSC::Identifier::fromString(vm, specifier), JSC::Identifier::fromString(vm, Bun::referrerOfImportCallInCodeThatIsNotCompiled(from)), nullptr, nullptr);
    if (scope.exception()) [[unlikely]]
        return JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
#if ENABLE(AOT)
    if (auto imported = vm.hasCompiledCode() && Bun::isBunTest ? Bun::compiledModuleForPath(specifier) : std::nullopt)
        JSC::AOT::didCallImportOfHost(globalObject, *imported, promise);
#endif
    return promise;
}

static JSValue importModuleKeySync(Zig::GlobalObject* globalObject, const String& key)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::VM::SynchronousModuleQueue queue;
    queue.prev = vm.m_synchronousModuleQueue;
    vm.m_synchronousModuleQueue = &queue;
    JSC::JSPromise* promise = importModuleKey(globalObject, key);
    if (!scope.exception())
        JSC::JSModuleLoader::drainSynchronousModuleQueue(globalObject);
    vm.m_synchronousModuleQueue = queue.prev;
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
    JSC::throwTypeError(globalObject, scope, makeString("require() async module \""_s, key, "\" is unsupported. use \"await import()\" instead."_s));
    return {};
}

static JSValue requireModuleKey(Zig::GlobalObject* globalObject, const String& from, const String& key)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
#if ENABLE(AOT)
    // `from` is the origin of whoever calls: what the maker of that code called it.
    JSC::AOT::AskerOfModule asker(globalObject, Bun::askerOfImportCallInCodeThatIsNotCompiled(from));
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
// A compiled module that had run when the mock was laid over it is its own original, as a module of the loader is.
static JSValue exportsOfCompiledModuleBeforeMock(Zig::GlobalObject* globalObject, JSModuleMock* mock, bool& isCommonJS, bool& readOfNameThrew)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, {});
    if (!loaded.compiledModule) {
        // The program stored a module of its own under the key of a file that had run, so the file has left the program. The original of a mock has a key of its own under `bun test`: it is still what it was.
        auto file = Bun::compiledModuleForPath(mock->specifier->tryGetValue().data);
        JSValue kept = file ? JSC::AOT::askForExportsBehindEntryOfProgram(globalObject, *file) : JSValue();
        RETURN_IF_EXCEPTION(scope, {});
        isCommonJS = kept && !JSC::AOT::isESModule(*file);
        return kept;
    }
    isCommonJS = !JSC::AOT::isESModule(*loaded.compiledModule) && !JSC::AOT::isDataFile(*loaded.compiledModule);
    RELEASE_AND_RETURN(scope, JSC::AOT::exportsBeforeMock(globalObject, *loaded.compiledModule, !mock->isOfVitest() && !mock->wasLaidOverFailedLoad, &readOfNameThrew));
}

static JSObject* namespaceOfCompiledFileThatRanAheadOfMock(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!loaded.compiledModule)
        return nullptr;
    RELEASE_AND_RETURN(scope, JSC::AOT::namespaceOfFileThatRanAheadOfMock(globalObject, *loaded.compiledModule));
}

static JSC::JSPromise* evaluationOfCompiledModuleThatMockLeftAlone(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!loaded.compiledModule)
        return nullptr;
    auto loadThatCalledFactory = mock->moduleThatLoadAskedFor.transform([](unsigned asked) { return JSC::AOT::ModuleID(asked); });
    RELEASE_AND_RETURN(scope, JSC::AOT::evaluationOfModuleThatMockLeftAlone(globalObject, *loaded.compiledModule, loadThatCalledFactory));
}

static JSValue errorThrownByBodyOfCompiledModule(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, {});
    return loaded.compiledModule ? JSC::AOT::errorThrownByBodyOfMockedModule(globalObject, *loaded.compiledModule) : JSValue();
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

static void addToImportChain(Zig::GlobalObject* globalObject, BunPlugin::OnLoad::RunningModuleMock& running, const String& key)
{
    running.importChain.add(key);
    if (size_t query = key.find('?'); query != notFound)
        running.importChainWithoutQuery.add(key.left(query));
    // See giveTurns(). The load that now asks for it has to be fetched first.
    if (globalObject->onLoadPlugins.waitingModuleMocks.containsIf([&](auto& waiting) { return uncheckedDowncast<JSModuleMock>(waiting.mock.get())->specifier->tryGetValue().data == key; })) [[unlikely]] {
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
static JSC::JSPromise* importOriginalModule(Zig::GlobalObject*, JSModuleMock*, bool mayLoadOthersFirst, const String& from, bool hasWaitedForTurn);
#if ENABLE(AOT)
static JSObject* namespaceOfLoadedOriginal(Zig::GlobalObject*, const String& specifier);
#endif
static String keyOfModuleThatDoesNotWait(Zig::GlobalObject*, BunPlugin::OnLoad::RunningModuleMock&, const String& key, const String& mocked);
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
// As above, behind the one job that importOriginalModule() gives the graph that is being evaluated to come to a compiled module.
JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockDidWaitForTurnOfOriginal, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
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

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionModuleMockDidLoadImportsOfOriginal, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
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
static bool isInNodeModules(const String& path);
#endif

#if ENABLE(AOT)
uint32_t addToImportChainsOfCompiledFactories(Zig::GlobalObject*, JSC::AOT::ModuleID importer, JSC::AOT::ModuleID asked, JSC::AOT::LoadByName);
#endif

__attribute__((minsize)) static JSC::JSPromise* importOriginalModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, bool mayLoadOthersFirst = true, const String& from = String(), bool hasWaitedForTurn = false)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

#if ENABLE(AOT)
    if (mock->compiledModuleThatNeverRan && !hasWaitedForTurn)
        addToImportChainsOfCompiledFactories(globalObject, JSC::AOT::ModuleID(), JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan), JSC::AOT::LoadByName::Import);
#endif
    JSObject* exports = mock->originalNamespace.get();
    if (!exports && mayLoadOthersFirst && patchesModuleBeingEvaluated(globalObject, mock, specifier)) {
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
    bool isCompiledESModule = mock->compiledModuleThatNeverRan && JSC::AOT::isESModule(JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan));
#else
    constexpr bool isCompiledESModule = false;
    UNUSED_PARAM(hasWaitedForTurn);
#endif
    if (!exports && mock->originalCommonJSExports && !isCompiledESModule) {
        exports = esmExportsOfCommonJSExports(globalObject, mock->originalCommonJSExports.get());
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
#if ENABLE(AOT)
    // A require() has called the factory, and cannot wait for it: it answers the original until the factory has settled. So the file's own body runs now, once: it is what the require() answers
    // and what the factory is handed, and the mock is laid over it.
    if (auto file = mock->compiledModuleThatNeverRan; file && !exports && JSC::AOT::requireRunsMocks(vm) && !JSC::AOT::isESModule(JSC::AOT::ModuleID(*file)) && !JSC::AOT::hasBegunToLoad(globalObject, JSC::AOT::ModuleID(*file))) {
        JSC::AOT::runBodyOfRequiredFileAheadOfMock(globalObject, JSC::AOT::ModuleID(*file));
        RETURN_IF_EXCEPTION(scope, nullptr);
        mock->compiledModuleThatNeverRan = std::nullopt;
    }
    // unmockModule() brings the original of such a package back under the package's own key: one instance. So its own body runs now, once, beside the mock, which goes on waiting and comes to stand in its place.
    if (auto file = mock->compiledModuleThatNeverRan; file && !exports && mock->isOfVitest() && isInNodeModules(specifier) && JSC::AOT::isESModule(JSC::AOT::ModuleID(*file))) {
        exports = JSC::AOT::packageItselfBesideMock(globalObject, JSC::AOT::ModuleID(*file));
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (exports)
            exports = withoutUninitializedExports(globalObject, exports);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    // Where it cannot run beside the mock, the mock is laid over it.
    if (auto file = mock->compiledModuleThatNeverRan; file && !exports && mock->isOfVitest() && isInNodeModules(specifier) && JSC::AOT::isESModule(JSC::AOT::ModuleID(*file))) {
        bool hasRun = JSC::AOT::runBodyOfImportedModuleAheadOfMock(globalObject, JSC::AOT::ModuleID(*file));
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (hasRun)
            mock->compiledModuleThatNeverRan = std::nullopt;
    }
    if (globalObject->aotInstance() && !exports) {
        JSC::JSPromise* underWay = evaluationOfCompiledModuleThatMockLeftAlone(globalObject, mock);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (underWay)
            return originalModuleAfter(globalObject, mock, underWay, jsFunctionModuleMockDidLoadBeforeOriginal);
    }
    if (globalObject->aotInstance() && Bun::isBunTest && !exports) {
        exports = namespaceOfCompiledFileThatRanAheadOfMock(globalObject, mock);
        if (scope.exception()) [[unlikely]]
            return JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    }
    JSObject* copy = globalObject->aotInstance() && !exports && mock->isOfVitest() ? namespaceOfLoadedOriginal(globalObject, specifier) : nullptr;
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (copy) {
        exports = withoutUninitializedExports(globalObject, copy);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    if (globalObject->aotInstance() && !exports) {
        bool isCommonJS = false;
        bool readOfNameThrew = false;
        JSValue before = exportsOfCompiledModuleBeforeMock(globalObject, mock, isCommonJS, readOfNameThrew);
        // The body of the original threw before the mock was laid: its import rejects with that error, as under `bun test`.
        if (JSC::Exception* thrownByOriginal = scope.exception()) [[unlikely]] {
            if (!scope.tryClearException())
                return nullptr;
            if (!readOfNameThrew)
                RELEASE_AND_RETURN(scope, JSC::JSPromise::rejectedPromise(globalObject, thrownByOriginal->value()));
            bool isAskedByNameInsideOwnFactory = !from.isNull() && mock->state == JSModuleMock::State::Running && factoriesInAsyncContext(globalObject).contains(mock);
            if (!isAskedByNameInsideOwnFactory) {
                throwException(globalObject, scope, thrownByOriginal);
                return nullptr;
            }
            before = JSValue();
        }
        if (before)
            exports = isCommonJS ? esmExportsOfCommonJSExports(globalObject, before) : withoutUninitializedExports(globalObject, before.getObject());
        RETURN_IF_EXCEPTION(scope, nullptr);
        copy = exports || mock->isOfVitest() ? nullptr : namespaceOfLoadedOriginal(globalObject, specifier);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (copy) {
            exports = withoutUninitializedExports(globalObject, copy);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        // The call of the mock began the body, which awaits, or the graph that is being evaluated is about to come to it: the original is that module once it has run
        // to its end. Under the key below its text would run a second time.
        if (auto compiled = exports ? std::nullopt : Bun::compiledModuleForPath(specifier)) {
            JSC::JSPromise* evaluation = JSC::AOT::evaluationUnderWay(globalObject, *compiled, hasWaitedForTurn);
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (evaluation)
                return originalModuleAfter(globalObject, mock, evaluation, jsFunctionModuleMockDidWaitForTurnOfOriginal);
        }
    }
#endif
    if (exports)
        RELEASE_AND_RETURN(scope, JSC::JSPromise::resolvedPromise(globalObject, exports));

    String key = originalModuleKey(specifier);

    auto* running = findRunningModuleMock(globalObject, mock);
    bool mayBeAnotherFactory = !running && !from.isNull() && !globalObject->onLoadPlugins.runningModuleMocks.isEmpty();

    // Only an import of the mocked module calls the factory, so find out whether the original has one before evaluating anything.
    if (mayLoadOthersFirst && !mayBeAnotherFactory && mock->importsOriginal && mock->state == JSModuleMock::State::NotCalled) {
        String dependency = dependencyKeyOfModuleMock(globalObject, mock);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (dependency == key) {
            JSC::JSPromise* loading = Bun::testFileModuleLoader(globalObject)->loadModule(globalObject, JSC::Identifier::fromString(vm, key), nullptr, nullptr, {});
            RETURN_IF_EXCEPTION(scope, nullptr);
            return originalModuleAfter(globalObject, mock, loading, jsFunctionModuleMockDidLoadImportsOfOriginal);
        }
    }

    if (running) {
        key = keyOfModuleThatDoesNotWait(globalObject, *running, key, specifier);
        addToImportChain(globalObject, *running, key);
        // If another factory called vi.importActual(), it waits for the module too.
        for (JSObject* factory : factoriesInAsyncContext(globalObject)) {
            auto* asking = findRunningModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(factory));
            if (!asking || asking == running)
                continue;
            key = keyOfModuleThatDoesNotWait(globalObject, *asking, key, uncheckedDowncast<JSModuleMock>(factory)->specifier->tryGetValue().data);
            addToImportChain(globalObject, *asking, key);
        }
    } else if (mayBeAnotherFactory)
        key = Bun::keyOfImportWhileModuleMocksRun(globalObject, key, from, true);
#if ENABLE(AOT)
    if (globalObject->aotInstance()) {
        JSC::JSPromise* loading = importModuleKey(globalObject, key);
        RETURN_IF_EXCEPTION(scope, nullptr);
        RELEASE_AND_RETURN(scope, thenWithContext(globalObject, loading, jsFunctionOriginalWithoutUninitializedExports, nullptr, jsUndefined()));
    }
#endif
    RELEASE_AND_RETURN(scope, importModuleKey(globalObject, key));
}

#if ENABLE(AOT)
static JSC::AbstractModuleRecord* loadedRecordOfOriginal(Zig::GlobalObject* globalObject, const String& specifier)
{
    if (isBuiltinModuleKey(specifier))
        return nullptr;
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(JSC::getVM(globalObject), originalModuleKey(specifier)));
    auto* record = entry ? entry->record() : nullptr;
    return record && !JSC::AOT::isCompiledModuleRecord(record) ? record : nullptr;
}

static JSValue evaluationErrorOfOriginal(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto* original = loadedRecordOfOriginal(globalObject, specifier);
    auto* cyclic = original ? dynamicDowncast<JSC::CyclicModuleRecord>(original) : nullptr;
    return cyclic ? cyclic->evaluationError() : JSValue();
}

static void dropOriginalThatFailed(Zig::GlobalObject* globalObject, const String& specifier)
{
    if (evaluationErrorOfOriginal(globalObject, specifier))
        Bun::testFileModuleLoader(globalObject)->removeEntry(JSC::Identifier::fromString(JSC::getVM(globalObject), originalModuleKey(specifier)));
}

static void dropOriginalThatFailedAndLeftNoRecord(Zig::GlobalObject* globalObject, const String& specifier)
{
    using Status = JSC::ModuleRegistryEntry::Status;
    auto key = JSC::Identifier::fromString(JSC::getVM(globalObject), originalModuleKey(specifier));
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(key);
    if (entry && !entry->record() && (entry->status() == Status::FetchFailed || entry->status() == Status::InstantiationFailed || entry->status() == Status::EvaluationFailed))
        Bun::testFileModuleLoader(globalObject)->removeEntry(key);
}

static JSObject* namespaceOfLoadedOriginal(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto* original = loadedRecordOfOriginal(globalObject, specifier);
    auto* cyclic = original ? dynamicDowncast<JSC::CyclicModuleRecord>(original) : nullptr;
    if (!original || (cyclic && (cyclic->status() != JSC::CyclicModuleRecord::Status::Evaluated || cyclic->evaluationError())))
        return nullptr;
    return original->getModuleNamespace(globalObject);
}
#endif

static JSValue requireOriginalModule(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (JSValue exports = mock->originalCommonJSExports.get(); exports && !exports.inherits<JSC::JSModuleNamespaceObject>())
        return exports;
    JSObject* exports = esmExportsBeforePatches(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, {});
    if (exports)
        return exports;
#if ENABLE(AOT)
    if (globalObject->aotInstance()) {
        bool isCommonJS = false;
        bool readOfNameThrew = false;
        JSValue before = exportsOfCompiledModuleBeforeMock(globalObject, mock, isCommonJS, readOfNameThrew);
        RETURN_IF_EXCEPTION(scope, {});
        if (before)
            return before;
    }
#endif

    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String key = originalModuleKey(specifier);
    JSObject* moduleNamespace = mock->originalNamespace.get();
#if ENABLE(AOT)
    if (!moduleNamespace && mock->compiledModuleThatNeverRan) {
        moduleNamespace = namespaceOfLoadedOriginal(globalObject, specifier);
        RETURN_IF_EXCEPTION(scope, {});
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
        keyOfModuleThatDoesNotWait(globalObject, *running, key, specifier);
        addToImportChain(globalObject, *running, key);
    }
#if ENABLE(AOT)
    if (globalObject->aotInstance())
        JSC::AOT::willRunCopyFromDisk(globalObject);
#endif
    RELEASE_AND_RETURN(scope, requireModuleKey(globalObject, specifier, key));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockImportOriginal, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(lexicalGlobalObject));
    auto* mock = toModuleMock(lexicalGlobalObject, scope, callframe->thisValue());
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(importOriginalModule(defaultGlobalObject(lexicalGlobalObject), mock)));
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
    bool isCompiledCommonJSFile = compiled && !JSC::AOT::isESModule(*compiled) && !JSC::AOT::isDataFile(*compiled) && !JSC::AOT::isNativeModule(*compiled) && !JSC::AOT::isEvictedFile(globalObject, *compiled);
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

static JSObject* exportsOfModuleMockWithoutFactory(Zig::GlobalObject* globalObject, JSModuleMock* mock, JSValue moduleNamespace)
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
    // `bun test` makes a mock that imports its original a module that imports it by a statement: the body of the original runs first, and its error is the error of the load.
    // Returns whether `answer`, or the exception, is what this call answers.
    auto answersByBodyOfOriginal = [&](JSValue& answer) -> bool {
        // Each load waits a turn of its own.
        bool hasWaitedForTurn = std::exchange(hasWaitedForTurnOfLoader, false);
        JSValue thrownByBody = errorThrownByBodyOfCompiledModule(globalObject, this);
        RETURN_IF_EXCEPTION(scope, true);
        if (thrownByBody) {
            // The loader answers a load of a module that has failed with a promise that is rejected already. importModuleKeySync() throws what it holds and lets it go.
            if (JSC::AOT::requireRunsMocks(vm))
                JSC::JSPromise::rejectedPromise(globalObject, thrownByBody);
            throwException(globalObject, scope, thrownByBody);
            return true;
        }
        JSC::JSPromise* underWay = evaluationOfCompiledModuleThatMockLeftAlone(globalObject, this);
        RETURN_IF_EXCEPTION(scope, true);
        if (underWay && synchronous) {
            throwException(globalObject, scope, Bun::createAsyncModuleRequiredError(globalObject, specifier->tryGetValue().data));
            return true;
        }
        if (!underWay)
            return false;
        waitsForBodyUnderWay = true;
        // `bun test` decides whether the generated module waits for the original when it evaluates that module, these jobs behind the call of import(). By then a body that awaits the call is seen to await it.
        if (!hasWaitedForTurn) {
            hasWaitedForTurnOfLoader = true;
            constexpr unsigned jobsFromCallOfImportToEvaluationOfGeneratedModule = 12;
            JSC::JSPromise* turn = JSC::JSPromise::resolvedPromise(globalObject, jsUndefined());
            RETURN_IF_EXCEPTION(scope, true);
            for (unsigned job = 0; job < jobsFromCallOfImportToEvaluationOfGeneratedModule; ++job) {
                JSC::JSPromise* next = JSC::JSPromise::create(vm, globalObject->promiseStructure());
                turn->performPromiseThen(vm, globalObject, jsUndefined(), jsUndefined(), next);
                turn = next;
            }
            answer = turn;
            return true;
        }
        answer = underWay;
        // The generated module of `bun test`, which calls the factory, runs one job behind whoever waits for the body itself.
        if (factoryValue) {
            JSC::JSPromise* behindBody = JSC::JSPromise::create(vm, globalObject->promiseStructure());
            underWay->performPromiseThen(vm, globalObject, jsUndefined(), jsUndefined(), behindBody);
            answer = behindBody;
        }
        return true;
    };
    if (JSValue answer; importsOriginal && factoryValue && factoryValue.isCallable() && globalObject->aotInstance() && answersByBodyOfOriginal(answer))
        return answer;
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
    if (JSValue thrown = !factoryValue && wasLaidOverFailedLoad ? evaluationErrorOfOriginal(globalObject, specifier->tryGetValue().data) : JSValue()) {
        throwException(globalObject, scope, thrown);
        return {};
    }
#endif
    if (!dependency && !factoryValue && !spy)
        dependency = originalNamespace.get();
#if ENABLE(AOT)
    if (!dependency && !factoryValue && !spy && compiledModuleThatNeverRan && (wasLaidOverFactoryThatTakesOriginal || !JSC::AOT::hasMockInPlace(globalObject, JSC::AOT::ModuleID(*compiledModuleThatNeverRan)))) {
        dependency = namespaceOfLoadedOriginal(globalObject, specifier->tryGetValue().data);
        RETURN_IF_EXCEPTION(scope, {});
    }
#endif
    if (dependency)
        RELEASE_AND_RETURN(scope, exportsOfModuleMockWithoutFactory(globalObject, this, dependency));

#if ENABLE(AOT)
    if (auto form = factoryValue ? std::nullopt : compiledModuleThatNeverRan; form && JSC::AOT::isDataFile(JSC::AOT::ModuleID(*form))) {
        String path = specifier->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* own = JSC::AOT::formsThatAttributesAskFor(globalObject, path).contains(JSC::AOT::ModuleID(*form)) ? JSC::AOT::packageItselfBesideMock(globalObject, JSC::AOT::ModuleID(*form)) : nullptr;
        RETURN_IF_EXCEPTION(scope, {});
        if (own)
            RELEASE_AND_RETURN(scope, Bun::mockObject(globalObject, own, spy, true));
    }
    if (JSValue answer; !factoryValue && globalObject->aotInstance() && answersByBodyOfOriginal(answer))
        return answer;
    // A compiled module that has run hands over its own exports, like a loaded module below.
    if (!factoryValue && vm.hasCompiledCode()) {
        String path = specifier->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto compiled = isBuiltinModuleKey(path) ? std::nullopt : JSC::AOT::formThatMockFinds(globalObject, path, Bun::moduleThatMockReplaces(path));
        if (compiled && JSC::AOT::hasBegunToLoad(globalObject, *compiled) && !JSC::AOT::hasMockInPlace(globalObject, *compiled)) {
            // With an earlier mock laid over it, what it exports now is that mock, whose functions an automock would keep.
            JSValue before = JSC::AOT::hasMockLaidOver(globalObject, *compiled) ? JSC::AOT::exportsBeforeMock(globalObject, *compiled, false) : JSValue();
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
    // As in importOriginalModule(): the original of a package is the package itself, one instance, and its body runs beside the mock.
    if (!factoryValue && !spy && isOfVitest() && compiledModuleThatNeverRan && JSC::AOT::isESModule(JSC::AOT::ModuleID(*compiledModuleThatNeverRan))) {
        String path = specifier->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* own = isInNodeModules(path) ? JSC::AOT::packageItselfBesideMock(globalObject, JSC::AOT::ModuleID(*compiledModuleThatNeverRan)) : nullptr;
        RETURN_IF_EXCEPTION(scope, {});
        if (own) {
            own = withoutUninitializedExports(globalObject, own);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, Bun::mockObject(globalObject, own, false, true));
        }
    }
#endif

    String key = dependencyKeyOfModuleMock(globalObject, this);
    RETURN_IF_EXCEPTION(scope, {});
    if (auto* running = findRunningModuleMock(globalObject, this)) {
        keyOfModuleThatDoesNotWait(globalObject, *running, key, specifier->tryGetValue().data);
        addToImportChain(globalObject, *running, key);
    }

    if (synchronous) {
        JSValue moduleNamespace = importModuleKeySync(globalObject, key);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, exportsOfModuleMockWithoutFactory(globalObject, this, moduleNamespace));
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
    evictModulesAndTheirImporters(globalObject, stopRunning(globalObject, mock));
    returnTurn(globalObject, mock);
}

void JSModuleMock::didFail(Zig::GlobalObject* globalObject, JSValue error)
{
    state = State::NotCalled;
    result.clear();
    readUninitializedVariable = isHoisted() && addHoistingNote(globalObject->vm(), error);
#if ENABLE(AOT)
    // Under `bun test` a load that asked for the mock itself leaves no entry behind a factory that fails.
    if (auto file = moduleThatLoadAskedFor ? Bun::compiledModuleForPath(specifier->tryGetValue().data) : std::nullopt; file && file->index() == *moduleThatLoadAskedFor)
        wasAskedFor = false;
#endif
    didStopRunning(globalObject, this);
}

void JSModuleMock::abandon(Zig::GlobalObject* globalObject)
{
    state = State::NotCalled;
    result.clear();
#if ENABLE(AOT)
    waitsForBodyUnderWay = false;
    hasWaitedForTurnOfLoader = false;
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

static bool readsExportsOfModule(JSC::JSGlobalObject* globalObject, JSObject* object, const String& key, UncheckedKeyHashSet<JSObject*>& seen)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

#if ENABLE(AOT)
    // The namespace object of a compiled module is asked in the same way, by the record of its module.
    if (JSC::AbstractModuleRecord* compiled = JSC::AOT::isModuleNamespace(object) ? JSC::AOT::moduleRecordOfNamespace(globalObject, object) : nullptr) {
        if (!seen.add(object).isNewEntry)
            return false;
        Vector<JSC::AbstractModuleRecord*> recordsOfMocks;
        if (compiled->hasLiveExports())
            recordsOfMocks.append(compiled);
        else {
            JSC::PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            object->methodTable()->getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Include);
            RETURN_IF_EXCEPTION(scope, false);
            for (auto& name : names) {
                auto resolution = compiled->resolveExport(globalObject, name);
                RETURN_IF_EXCEPTION(scope, false);
                if (resolution.isLiveExport(vm) && !recordsOfMocks.contains(resolution.moduleRecord))
                    recordsOfMocks.append(resolution.moduleRecord);
            }
        }
        for (auto* record : recordsOfMocks) {
            if (record->moduleKey().string() == key)
                return true;
            JSObject* source = record->liveExportsSource();
            if (auto* mock = source ? dynamicDowncast<JSModuleMock>(source) : nullptr)
                source = mock->exports.get();
            bool reads = source && readsExportsOfModule(globalObject, source, key, seen);
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
        bool reads = source && readsExportsOfModule(globalObject, source, key, seen);
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
    // So does the namespace object of a compiled module: it asks the mock that stands in place of the module.
    while (JSObject* source = globalObject->vm().hasCompiledCode() ? JSC::AOT::mockInPlaceBehind(esmExports) : nullptr) {
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
    bool readsItself = readsExportsOfModule(globalObject, esmExports, key, seen);
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
    if (std::exchange(waitsForBodyUnderWay, false)) {
        JSValue made = callFactory(globalObject, false, nullptr);
        RETURN_IF_EXCEPTION(scope, );
        if (auto* promised = dynamicDowncast<JSC::JSPromise>(made)) {
            waitsForFactoryBehindBody = true;
            JSC::JSFunction* didFulfill = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionModuleMockFactoryDidFulfill, ImplementationVisibility::Private);
            JSC::JSFunction* didReject = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionModuleMockFactoryDidReject, ImplementationVisibility::Private);
            promised->performPromiseThenWithContext(vm, globalObject, didFulfill, didReject, jsUndefined(), moduleMockWith(globalObject, this, uncheckedDowncast<JSC::JSPromise>(result.get())));
            return;
        }
        RELEASE_AND_RETURN(scope, settle(globalObject, made));
    }
#endif
    if (JSValue factoryValue = factory.get(); !factoryValue || !factoryValue.isCallable()) {
        JSObject* exports = exportsOfModuleMockWithoutFactory(globalObject, this, value);
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
    if (std::exchange(mock->waitsForFactoryBehindBody, false) && !scope.exception())
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
JSC_DEFINE_HOST_FUNCTION(jsFunctionBodyThatAbandonedModuleMockWaitedForDidEnd, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
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
    // Nobody has fetched the failure of the call before: whoever waited for it has asked by another road, as for a module that is out of the program. This call takes its place.
    errorOfLateFailure.clear();
    numberOfImportsThatWait = 0;
    wasAskedFor = true;
#endif
    globalObject->onLoadPlugins.runningModuleMocks.append(BunPlugin::OnLoad::RunningModuleMock { JSC::Strong<JSC::JSObject> { vm, this }, fileOfFunction(factory.get()), {}, {}, {}, {} });
#if ENABLE(AOT)
    if (vm.hasCompiledCode()) {
        calledAt = ++globalObject->onLoadPlugins.momentOfModuleMocks;
        auto import = JSC::AOT::importThatAsks(globalObject);
        askedForAt = import ? import->momentOfCall : calledAt;
    }
#endif

    JSValue value = callFactory(globalObject, synchronous, dependency);
    if (!scope.exception()) [[likely]] {
        if (auto* promise = dynamicDowncast<JSC::JSPromise>(value)) {
            switch (promise->status()) {
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
__attribute__((minsize)) static void rankAgainAfter(Zig::GlobalObject* globalObject, Vector<JSC::JSPromise*>& fetches)
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
    size_t numberOfKeysOfMocks = indexOf.size();
#if ENABLE(AOT)
    // No record asks for a mocked module that lies below a compiled file: the loader has no record of that file while its fetch waits. The entry of the fetch stands for the mock.
    size_t numberOfOwnKeys = keys.size();
    for (auto& [key, mock] : plugins.fetchesThatStandForWaitingMocks) {
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

    // What a running factory has asked for comes first, the latest first: the mocks it leads to are called in its order, as in Vitest.
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
        // Such a fetch reads no file, and its load has fetched all it can without a factory. Whoever waited for it would wait for the factory, which may wait for a turn. What lies below it is ranked once it settles.
        if (plugins.compiledFetchesHeldBehindFactories.contains(key)) [[unlikely]] {
            heldFetches.append(fetch);
            return;
        }
#endif
        fetches.append(fetch);
        isReadingFile = isReadingFile || !isLoadedByPlugin(globalObject, key);
    };
    // A mock passed to import() gets its own turn right away, even if another load also imports it and already has a factory running. Vitest does the same.
    Vector<bool> isAskedForDirectly;
    isAskedForDirectly.fill(false, plugins.waitingModuleMocks.size());
    size_t askedForDirectly = 0;
    for (auto& key : plugins.modulesAskedFor) {
        if (auto index = indexOf.find(JSC::Identifier::fromString(vm, key).impl()); index != indexOf.end()) {
#if ENABLE(AOT)
            // import() asked for the compiled file, not for the mock below it: the file is the top of a load.
            if (index->key != keys[index->value].impl()) {
                loads.append(index->key);
                continue;
            }
#endif
            isAskedForDirectly[index->value] = true;
            askedForDirectly++;
            continue;
        }
        auto* entry = loader->registryEntry(JSC::Identifier::fromString(vm, key));
        JSC::JSPromise* fetchOfUnregistered = nullptr;
        if (entry)
            plugins.fetchesOfModulesAskedFor.remove(key);
        else if (auto fetch = plugins.fetchesOfModulesAskedFor.find(key); fetch != plugins.fetchesOfModulesAskedFor.end())
            fetchOfUnregistered = uncheckedDowncast<JSC::JSPromise>(fetch->value.get());
        if (fetchOfUnregistered && isFetchedWithoutFactory(globalObject, key)) {
            // After it settles, JSC registers the module in a microtask that's already queued.
            if (fetchOfUnregistered->status() == JSC::JSPromise::Status::Pending)
                addFetch(key, fetchOfUnregistered);
            else if (plugins.modulesGivenTimeToRequestImports.add(key).isNewEntry)
                isReadingFile = true;
            else
                finished.append(key);
        } else if (!entry || (entry->record() && !unfinishedRecord(entry)))
            finished.append(key);
        else if (!entry->record()) {
            if (isBeingFetchedWithoutFactory(globalObject, entry))
                addFetch(key, entry->ensureModulePromise(globalObject));
        } else if (plugins.runningModuleMocks.containsIf([&](auto& running) { return running.importChain.contains(key); }))
            loads.insert(0, entry->key().impl());
        else
            loads.append(entry->key().impl());
    }
    for (auto& key : finished) {
        plugins.modulesAskedFor.remove(key);
        plugins.fetchesOfModulesAskedFor.remove(key);
    }
    if (!fetches.isEmpty() || isReadingFile)
        rankAgainAfter(globalObject, fetches);

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
        if (load == loads.size() && !hasOtherLoads && found.size() + askedForDirectly < numberOfKeysOfMocks) {
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
                if (!isAskedForDirectly[index->value])
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
            rankAgainAfter(globalObject, fetches);
        }
    }
    for (size_t load = 0; load < loads.size(); ++load) {
        if (isBeingFetched[load])
            isBeingFetched[first(fetchedWith, load)] = true;
    }
#if ENABLE(AOT)
    // No load is being fetched by them: waitForTurn() must not leave a mock that comes later to the end of such a fetch.
    if (!heldFetches.isEmpty()) [[unlikely]] {
        rankAgainAfter(globalObject, heldFetches);
        plugins.loadsBeingFetched--;
    }
#endif
    // A factory keeps the load it was called for, also if another load turns out to import its module. That load can't end before it returns.
    for (auto& holder : plugins.moduleMocksWithTurn) {
        size_t holderLoad = loads.findIf([&](auto* load) { return holder.load == StringView(load); });
        auto* running = findRunningModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(holder.mock.get()));
        for (size_t load = 0; running && holderLoad != notFound && load < loads.size(); ++load) {
            if (running->importChain.contains(String(loads[load])))
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
    // Nothing unfinished imports these: import() asked for them.
    for (auto& [key, index] : indexOf) {
        if (seen.contains(key) && !isAskedForDirectly[index])
            continue;
#if ENABLE(AOT)
        if (key != keys[index].impl() || (isReachedThroughFetch[index] && !isAskedForDirectly[index]))
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
// The factory of a compiled mock is called by another road than the fetch that waits for its turn, an import() of the mocked module for one: the fetch goes on, behind the factory.
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

    // Drop runModuleMock()'s entry, unless the factory already ran and the mock was replaced since (keepModuleMockOfLoadInFlight).
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
    if (slot.internalMethodType() != JSC::PropertySlot::InternalMethodType::Get || !factory || !factory.isCallable() || mock->givesFileItself || propertyName.isSymbol() || propertyName == vm.propertyNames->then || propertyName == vm.propertyNames->__esModule)
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
    // The loader answers an import() of a mocked built-in module itself: its module has live exports.
    bool isBuiltin = isBuiltinModuleKey(specifier);
    bool loaderHoldsMock = isBuiltin && loaded.esmNamespace && loaded.esmNamespace->moduleRecord()->hasLiveExports();
    if (loaded.compiledModule && mock->wasLaidOverFailedLoad && !JSC::AOT::requireRunsMocks(vm) && evaluationErrorOfOriginal(globalObject, specifier))
        return;
    if (loaded.compiledModule && (!loaded.esmNamespace || loaderHoldsMock) && JSC::AOT::hasWordOfMock(globalObject, *loaded.compiledModule) && (mock->compiledModuleThatNeverRan || isBuiltin || JSC::AOT::hasMockInPlace(globalObject, *loaded.compiledModule))) {
        JSValue answer = exports;
        if (commonJSExports) {
            answer = commonJSExports->exportsObject();
            RETURN_IF_EXCEPTION(scope, );
        } else {
            JSValue isESModule = exports->getIfPropertyExists(globalObject, vm.propertyNames->__esModule);
            RETURN_IF_EXCEPTION(scope, );
            if (isESModule && isESModule.toBoolean(globalObject) && mock->compiledModuleThatNeverRan && !(isBuiltin && loaded.commonJSModule) && !JSC::AOT::wasRequiredUnderMockInPlace(globalObject, *loaded.compiledModule)) {
                JSValue defaultValue = exports->getIfPropertyExists(globalObject, vm.propertyNames->defaultKeyword);
                RETURN_IF_EXCEPTION(scope, );
                if (defaultValue && !defaultValue.isUndefined())
                    answer = defaultValue;
            }
        }
        bool isInPlace = JSC::AOT::setMock(globalObject, *loaded.compiledModule, mock, answer, mock->leavesStandingMockToItsImporters.value_or(mock->isOfVitest()));
        RETURN_IF_EXCEPTION(scope, );
        if (isInPlace) {
            if (loaderHoldsMock)
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
        bool laysOverCompiledModule = loaded.compiledModule && !JSC::AOT::isEvictedFile(globalObject, *loaded.compiledModule);
        bool hasBegunToLay = false;
        auto endsLaying = makeScopeExit([&] {
            if (hasBegunToLay)
                JSC::AOT::didStopLayingMock(globalObject, *loaded.compiledModule);
        });
        if (laysOverCompiledModule) {
            // Two mocks may patch one variable, which two modules export. The last patch is undone first, as above.
            if (!mock->patchOrder)
                mock->patchOrder = ++patches;
            JSValue whatRequireAnswers = exports;
            if (commonJSExports) {
                whatRequireAnswers = commonJSExports->exportsObject();
                RETURN_IF_EXCEPTION(scope, );
            }
            hasBegunToLay = true;
            JSC::AOT::willMockModule(globalObject, *loaded.compiledModule, whatRequireAnswers, !!commonJSExports);
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
            if (laysOverCompiledModule) {
                JSC::AOT::mockExport(globalObject, *loaded.compiledModule, names[i].impl(), values.at(i));
                RETURN_IF_EXCEPTION(scope, );
            }
#endif
        }
#if ENABLE(AOT)
        if (laysOverCompiledModule) {
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

static void addRequirer(Zig::GlobalObject* globalObject, ModuleImporters& importersOf, const RequireKeys& requireKeys, Bun::JSCommonJSModule* importer, JSValue importedValue)
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
    if (auto importerKey = requireKeys.find(importer); importerKey != requireKeys.end()) {
        addImporter(importersOf, importerKey->value, importedKey);
        return;
    }
    if (!importer->filename().isString())
        return;
    String importerKey = asString(importer->filename())->value(globalObject);
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
    // Packages that vi.mock() no longer mocks. See setLoadedModuleAside().
    Vector<String> packagesToBringBack;
    // Packages that vi.mock() is about to mock.
    Vector<String> packagesSetAside;
    bool onlyImportersFromEarlierTestFiles { false };
    // Forces a pass even with nothing listed, to sweep the modules that failed to load or threw.
    bool isEndOfTestFile { false };
    bool hasLoadSettled { false };
    // The same, for the end of a mock over a compiled file that had run: the program holds what the file exported, so nothing is listed here.
    bool endsMockOverCompiledFileThatHadRun { false };
#if ENABLE(AOT)
    // An end that `bun test` does not make: the pass is for the books of the compiled program, and what failed stays failed.
    bool keepsFailuresOfCompiledProgram { false };
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
// A load that has yet to settle is fetching the module, or one of its records has asked for it or holds its record. What a failed load left is held by nobody.
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
static void setLoadedModuleAside(Zig::GlobalObject* globalObject, const String& specifier)
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
static void forgetFailuresKeptByCompiledProgram(Zig::GlobalObject* globalObject)
{
    auto& plugins = globalObject->onLoadPlugins;
    for (auto& factory : plugins.factoriesOfCompiledMocks.span().subspan(plugins.numberOfFactoriesSetAside))
        uncheckedDowncast<JSModuleMock>(factory.mock.get())->forgetFailureKeptForImports();
    JSC::AOT::dropErrorsOfLoadsEndedByMocks(globalObject);
    JSC::AOT::takeOutFilesThatFailed(globalObject);
}
#endif

__attribute__((minsize)) static void evictModulesAndTheirImporters(Zig::GlobalObject* globalObject, ModulesToEvict&& evict)
{
    auto& plugins = globalObject->onLoadPlugins;
    Vector<String>& keys = evict.modules;
    keys.removeAllMatching([&](const String& key) { return plugins.modulesToEvictOnceLoaded.contains(key); });
    if (keys.isEmpty() && evict.patchedESModules.isEmpty() && evict.patchedCommonJSModules.isEmpty() && evict.abandonedModules.isEmpty() && evict.packagesToBringBack.isEmpty() && !evict.all && !evict.isEndOfTestFile && !evict.hasLoadSettled && !evict.endsMockOverCompiledFileThatHadRun)
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* loader = Bun::testFileModuleLoader(globalObject);
    JSC::JSMap* requireMap = Bun::testFileRequireMap(globalObject);
#if ENABLE(AOT)
    // The program keeps the failure of a compiled file beside the entry that goes below.
    if (vm.hasCompiledCode() && !evict.keepsFailuresOfCompiledProgram) {
        forgetFailuresKeptByCompiledProgram(globalObject);
        RETURN_IF_EXCEPTION(scope, );
    }
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
        // The wrapper of a require()d ES module isn't in its requirer's m_children, so only m_parent links the two.
        if (auto* parent = commonJSModule->m_parent.get()) {
            addRequirer(globalObject, importersOf, requireKeys, parent, commonJSModule);
            RETURN_IF_EXCEPTION(scope, );
        }
        for (auto& child : commonJSModule->m_children) {
            addRequirer(globalObject, importersOf, requireKeys, commonJSModule, child.get());
            RETURN_IF_EXCEPTION(scope, );
        }
        if (auto* children = commonJSModule->m_childrenValue ? dynamicDowncast<JSC::JSArray>(commonJSModule->m_childrenValue.get()) : nullptr) {
            for (unsigned i = 0; i < children->length(); ++i) {
                // canGetIndexQuickly() skips accessors, so no script runs here.
                addRequirer(globalObject, importersOf, requireKeys, commonJSModule, children->canGetIndexQuickly(i) ? children->getIndexQuickly(i) : JSValue());
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
        auto importers = importersOf.find(key);
        if (importers == importersOf.end())
            continue;
        bool stays = staysInRegistry.contains(key) || staysInRequireCache.contains(key);
        for (auto& importer : importers->value) {
            unsigned testFile = plugins.testFileOfModule.get(importer);
            // It imports the real package whether or not vi.mock() mocks it.
            if (isExternalizedByVitest(globalObject, importer) && (evict.packagesToBringBack.contains(key) || evict.packagesSetAside.contains(key)))
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
        if (isTestFileRunning && entry && entry->record() && entry->status() < JSC::ModuleRegistryEntry::Status::FetchFailed && !plugins.testFileOfModule.get(key))
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
    for (auto& package : evict.packagesToBringBack) {
        if (stay.contains(package))
            continue;
        moveLoadedModule(globalObject, originalModuleKey(package), package);
        RETURN_IF_EXCEPTION(scope, );
    }
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
static void keepModuleMockOfLoadInFlight(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, const LoadedModule& loaded)
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
static bool endsPatchOfPreloadOverPackage(JSModuleMock* mock, const String& specifier)
{
    return mock->isFromPreload && !mock->isOfVitest() && !mock->compiledModuleThatNeverRan && isInNodeModules(specifier);
}

static JSModuleMock* displacedMockOfPreload(Zig::GlobalObject* globalObject, const String& specifier)
{
    // A hook of a preload may have laid a second one, and a mock of the test file have displaced that too: what the later of them left is what lies there.
    auto& list = globalObject->onLoadPlugins.displacedPreloadModuleMocks;
    for (size_t index = list.size(); index--;) {
        if (auto* mock = uncheckedDowncast<JSModuleMock>(list[index].get()); mock->isDisplacedByMockOfTestFile && mock->specifier->tryGetValue().data == specifier)
            return mock;
    }
    for (auto& displaced : list) {
        if (auto* mock = uncheckedDowncast<JSModuleMock>(displaced.get()); mock->specifier->tryGetValue().data == specifier)
            return mock;
    }
    return nullptr;
}

// What unmockModule() asks for packagesToBringBack, of the instance of a preload's mock: whatever lies under the key of the original moves back, whoever had set it aside.
static JSModuleMock* mockOfPreloadThatEndBringsBack(Zig::GlobalObject* globalObject, JSModuleMock* ended, const String& specifier)
{
    auto* mock = displacedMockOfPreload(globalObject, specifier);
    if (!mock || !mock->isDisplacedByMockOfTestFile)
        return nullptr;
    if (ended->patchesMockOfPreload)
        return mock;
    return mock->liesUnderKeyOfOriginal && (ended->hasSetMockOfPreloadAside || (ended->isOfVitest() && isInNodeModules(specifier))) ? mock : nullptr;
}

template<typename Functor>
static void forEachMockOfPreload(Zig::GlobalObject* globalObject, const Functor& functor)
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
// What unmockModule() asks for packagesToBringBack, of a compiled file.
static bool bringsBackCompiledFile(const JSModuleMock* mock, const String& specifier)
{
    return mock->hasSetCompiledModuleAside || (mock->isOfVitest() && isInNodeModules(specifier));
}

static bool isFormThatNobodyHasLoaded(Zig::GlobalObject* globalObject, const String& specifier, uint32_t module)
{
    return JSC::AOT::formsThatAttributesAskFor(globalObject, specifier).contains(JSC::AOT::ModuleID(module)) && !JSC::AOT::hasBegunToLoad(globalObject, JSC::AOT::ModuleID(module));
}
#endif

__attribute__((minsize)) static void unmockModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, ModulesToEvict& evict, [[maybe_unused]] JSModuleMock* laterMock = nullptr)
{
#if ENABLE(AOT)
    globalObject->onLoadPlugins.compiledImportersLinkedAheadOfMocks.removeAllMatching([&](const auto& linked) { return linked.mocked == specifier; });
    mock->endedAheadOfItsOriginal = !laterMock && mock->state == JSModuleMock::State::Running && (!mock->factory || mock->spy || (mock->importsOriginal && !mock->factory.get().isString())) && !mock->originalNamespace && !mock->originalExports;
#endif
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules)
        virtualModules->remove(specifier);
#if ENABLE(AOT)
    Vector<JSC::AOT::ModuleID, 1> compiledModulesOfMockToRun;
    globalObject->onLoadPlugins.compiledMocksToRun.removeAllMatching([&](const auto& waiting) {
        if (waiting.second.get() != mock)
            return false;
        compiledModulesOfMockToRun.append(JSC::AOT::ModuleID(waiting.first));
        return true;
    });
    // What a patch was laid over goes with the patch. The patch below a mock that a test file laid over a preload's stays; and the end of a preload's patch over a package moves it back under the key first: see the other unmockModule().
    // What lies under the key of the original and stays there is the original of a later mock of Vitest's kind: the run time half holds it as the mock that stands under the one that waits.
    auto* displaced = laterMock && laterMock->isOfVitest() ? displacedMockOfPreload(globalObject, specifier) : nullptr;
    bool mockOfPreloadStands = mockOfPreloadThatEndBringsBack(globalObject, mock, specifier) || (displaced && displaced->isDisplacedByMockOfTestFile && displaced->liesUnderKeyOfOriginal);
    auto original = mock->wasLaidOverMockOfPreload || mockOfPreloadStands || endsPatchOfPreloadOverPackage(mock, specifier) ? JSC::AOT::OriginalBehindEntryOfProgram::Stays : JSC::AOT::OriginalBehindEntryOfProgram::GoesWithPatch;
    // What is asked for packagesToBringBack below: a mock that patches and was laid over the one that had set the module aside brings nothing back.
    bool bringsBack = bringsBackCompiledFile(mock, specifier);
    for (JSC::AOT::ModuleID module : compiledModulesOfMockToRun) {
        JSC::AOT::didEndMock(globalObject, module, original, mockOfPreloadStands, bringsBack);
        RETURN_IF_EXCEPTION(scope, );
    }
#endif

    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, );
    bool wasLoadedOverCompiledModule = false;
#if ENABLE(AOT)
    wasLoadedOverCompiledModule = loaded.compiledModule && JSC::AOT::hasMockInPlace(globalObject, *loaded.compiledModule) && !JSC::AOT::isKeyOfMockInPlaceEmpty(globalObject, *loaded.compiledModule);
    // "Several import types" is for the laying of a mock. Its end goes to what the loader holds.
    if (globalObject->vm().hasCompiledCode() && !loaded.esmNamespace) {
        findLoadedESModule(globalObject, mock->specifier.get(), loaded);
        RETURN_IF_EXCEPTION(scope, );
    }
    // Also of a file that was evicted behind the mock.
    auto compiledModule = globalObject->vm().hasCompiledCode() ? JSC::AOT::formThatMockFinds(globalObject, specifier, Bun::moduleThatMockReplaces(specifier)) : std::nullopt;
    // A mock that patched a file that had run goes by patchedCommonJSModules under `bun test`, whether or not the key still lies there: the file stays and the pass is made.
    // One that had set such a file aside goes by packagesToBringBack, whether or not anybody loaded the mock.
    // Not over a file that the loader had let go: `bun test` finds nothing loaded there, and sets nothing aside.
    evict.endsMockOverCompiledFileThatHadRun |= (mock->hasSetCompiledModuleAside && !(compiledModule && JSC::AOT::wasLetGoByLoader(globalObject, *compiledModule))) || (compiledModule && JSC::AOT::hasMockLaidOverFileThatHadRun(globalObject, *compiledModule));
    // The program deleted the file's key under the mock, and a require() has made a module object of the mock. The run time holds what the file itself exported: the object gets it back below, as one that was patched.
    // Not where the mock had been laid over a preload's: what it was laid over is that mock, and the key is emptied.
    if (compiledModule && loaded.commonJSModule && !mock->wasLaidOverMockOfPreload && !mock->lostCommonJSExportsToReset && !mock->originalCommonJSExports && !JSC::AOT::isESModule(*compiledModule) && JSC::AOT::isEvictedFile(globalObject, *compiledModule)) {
        if (JSValue own = JSC::AOT::exportsThatMockWasLaidOver(globalObject, *compiledModule))
            mock->originalCommonJSExports.set(vm, mock, own);
    }
    if (compiledModule && !compiledModulesOfMockToRun.contains(*compiledModule)) {
        JSC::AOT::didEndMock(globalObject, *compiledModule, original, mockOfPreloadStands, bringsBack);
        RETURN_IF_EXCEPTION(scope, );
    }
    if (globalObject->vm().hasCompiledCode()) {
        for (JSC::AOT::ModuleID form : JSC::AOT::formsThatAttributesAskFor(globalObject, specifier)) {
            if (compiledModule == form)
                continue;
            JSC::AOT::didEndMock(globalObject, form, original, mockOfPreloadStands, bringsBack);
            RETURN_IF_EXCEPTION(scope, );
        }
        if (auto file = Bun::moduleThatMockReplaces(specifier); file && file != compiledModule && !compiledModulesOfMockToRun.contains(*file)) {
            JSC::AOT::didEndMock(globalObject, *file, original, mockOfPreloadStands, bringsBack);
            RETURN_IF_EXCEPTION(scope, );
        }
    }
#endif
    keepModuleMockOfLoadInFlight(globalObject, mock, specifier, loaded);
    if (mock->hasSetLoadedModuleAside || (mock->isOfVitest() && isInNodeModules(specifier)))
        evict.packagesToBringBack.append(specifier);

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
        if (loaded.esmNamespace || loaded.staleESMEntry || loaded.commonJSModule || wasLoadedOverCompiledModule)
            evict.modules.append(specifier);
        return;
    }
    if (overwritten)
        evict.patchedESModules.append(specifier);
    if (mock->originalCommonJSExports)
        evict.patchedCommonJSModules.append(specifier);
}

static void unmockModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, JSModuleMock* laterMock = nullptr, bool endsUnderPlainToo = true)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ModulesToEvict evict;
#if ENABLE(AOT)
    // What the other unmockModule() asks for packagesToBringBack.
    bool bringsBack = bringsBackCompiledFile(mock, specifier) || endsPatchOfPreloadOverPackage(mock, specifier);
    bool movesCompiledFile = vm.hasCompiledCode() && endsUnderPlainToo;
    bool leavesProgram = movesCompiledFile && Bun::willUnmockCompiledFile(globalObject, specifier, bringsBack, laterMock);
    bool factoryIsPending = mock->state == JSModuleMock::State::Running;
    if (vm.hasCompiledCode() && !mock->isFromPreload && !mock->wasLaidOverFailedLoad && mock->wasAskedFor)
        dropOriginalThatFailed(globalObject, specifier);
    if (vm.hasCompiledCode() && !mock->isFromPreload && !mock->wasLaidOverFailedLoad && mock->moduleThatLoadAskedFor)
        dropOriginalThatFailedAndLeftNoRecord(globalObject, specifier);
#endif
    unmockModule(globalObject, mock, specifier, evict, endsUnderPlainToo ? laterMock : nullptr);
    RETURN_IF_EXCEPTION(scope, );
#if ENABLE(AOT)
    // `bun test` makes no end where a mock that patches is laid over one that waits, and so no pass.
    evict.endsMockOverCompiledFileThatHadRun &= endsUnderPlainToo;
    evict.keepsFailuresOfCompiledProgram = !endsUnderPlainToo;
#endif
    evictModulesAndTheirImporters(globalObject, WTF::move(evict));
    RETURN_IF_EXCEPTION(scope, );
#if ENABLE(AOT)
    // A later mock of Vitest's kind sets aside again what this end has brought back.
    if (movesCompiledFile && laterMock)
        laterMock->hasSetCompiledModuleAside = bringsBack && Bun::isOriginalKeptOfCompiledFile(globalObject, specifier);
    else if (movesCompiledFile) {
        Bun::didUnmockCompiledFile(globalObject, specifier, leavesProgram, bringsBack, factoryIsPending);
        RETURN_IF_EXCEPTION(scope, );
        if (auto file = endsPatchOfPreloadOverPackage(mock, specifier) ? Bun::compiledModuleForPath(specifier) : std::nullopt)
            JSC::AOT::forgetOriginalOfFileThatLeftProgram(globalObject, *file);
    }
#else
    UNUSED_PARAM(laterMock);
    UNUSED_PARAM(endsUnderPlainToo);
#endif
}

static String callerPath(JSC::VM& vm, JSC::CallFrame* callframe)
{
#if ENABLE(AOT)
    if (vm.hasCompiledCode()) {
        if (const String& file = defaultGlobalObject(callframe->lexicalGlobalObject(vm))->onLoadPlugins.callerOfMockLaidAgain(callframe); !file.isNull())
            return file;
    }
#endif
    JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
    const URL& url = sourceOrigin.url();
    return !sourceOrigin.isNull() && url.isValid() && url.protocolIsFile() ? url.fileSystemPath() : String("."_s);
}

#if ENABLE(AOT)
static StringView withoutExtensionOfFile(StringView path)
{
    size_t slash = path.reverseFind('/');
    size_t dot = path.reverseFind('.');
    bool hasExtension = dot != notFound && dot > (slash == notFound ? 0 : slash + 1);
    return hasExtension ? path.left(dot) : path;
}

static std::optional<JSC::AOT::OtherNameOfModule> otherNameOfFile(StringView name, StringView file)
{
    if (name == withoutExtensionOfFile(file))
        return JSC::AOT::OtherNameOfModule::WithoutExtension;
    if (size_t slash = file.reverseFind('/'); slash != notFound && name == file.left(slash))
        return JSC::AOT::OtherNameOfModule::AsFolder;
    if (withoutExtensionOfFile(name) == withoutExtensionOfFile(file))
        return JSC::AOT::OtherNameOfModule::UnderAnotherExtension;
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
        if (const String& file = globalObject->onLoadPlugins.callerOfMockLaidAgain(callframe); !file.isNull())
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
        // A compiled importer is linked to the file. Where one writes this name for it, the mock stands for the file.
        if (vm.hasCompiledCode() && url.isValid() && url.protocolIsFile() && !Bun::moduleThatMockReplaces(specifier)) {
            auto importerPath = url.fileSystemPath();
            BunString importer = Bun::toString(importerPath);
            auto resolved = JSValue::decode(Bun__resolveSyncWithSourceIfExists(globalObject, JSValue::encode(specifierString), &importer, true));
            RETURN_IF_EXCEPTION(scope, false);
            if (resolved.isString() && asString(resolved)->length()) {
                String file = asString(resolved)->value(globalObject);
                RETURN_IF_EXCEPTION(scope, false);
                auto module = Bun::moduleThatMockReplaces(file);
                auto name = otherNameOfFile(specifier, file);
                if (module && name && JSC::AOT::isReachedUnder(*module, *name)) {
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
        JSC::AOT::endMocksThatStoodForLoadsInFlight(globalObject);
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
static void bringBackFactoriesSetAside(Zig::GlobalObject*, JSModuleMock*);

// Under `bun test` what vi.doMock() had set aside comes back under the key at vi.doUnmock() and at the handle's dispose: see setLoadedModuleAside(). Over a preload's mock that is what the mock had left there.
static void didEndMockLaidOverMockOfPreload(Zig::GlobalObject* globalObject, JSModuleMock* ended, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& plugins = globalObject->onLoadPlugins;
    bool bringsBack = vm.hasCompiledCode() && mockOfPreloadThatEndBringsBack(globalObject, ended, specifier);
    if (!vm.hasCompiledCode() || (!ended->wasLaidOverMockOfPreload && !bringsBack))
        return;
    size_t index = plugins.displacedPreloadModuleMocks.reverseFindIf([&](const auto& displaced) {
        auto* each = uncheckedDowncast<JSModuleMock>(displaced.get());
        return each->isDisplacedByMockOfTestFile && each->specifier->tryGetValue().data == specifier;
    });
    if (index == notFound)
        return;
    auto* mock = uncheckedDowncast<JSModuleMock>(plugins.displacedPreloadModuleMocks[index].get());
    auto compiled = JSC::AOT::formThatMockFinds(globalObject, specifier, Bun::moduleThatMockReplaces(specifier));
    if (!compiled || mock->state != JSModuleMock::State::Settled)
        return;
    bool hasLeftProgram = JSC::AOT::isEvictedFile(globalObject, *compiled);
    if (!bringsBack) {
        // A file of the program that the preload had loaded leaves the loader, and runs anew.
        if (ended->isOfVitest() && !mock->compiledModuleThatNeverRan && !isInNodeModules(specifier) && !hasLeftProgram && !JSC::AOT::refusesToLoadAgain(globalObject, *compiled))
            Bun::didDeleteRequireCacheEntry(globalObject, specifier);
        return;
    }
    // What the program stored under the key has nothing to patch: it goes, and the next load finds the mock.
    if (hasLeftProgram) {
        JSC__JSMap__remove(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(mock->specifier.get()));
        RETURN_IF_EXCEPTION(scope, );
    }
    // The earlier ones of the name are behind it. A later one stays: at the end of the test file it is added over this one.
    for (size_t each = index + 1; each--;) {
        if (uncheckedDowncast<JSModuleMock>(plugins.displacedPreloadModuleMocks[each].get())->specifier->tryGetValue().data == specifier)
            plugins.displacedPreloadModuleMocks.removeAt(each);
    }
    plugins.addModuleMock(vm, specifier, mock);
    mock->isDetached = false;
    mock->isDisplacedByMockOfTestFile = false;
    mock->cameBackAtEndOfMockOfTestFile = true;
    mock->liesUnderKeyOfOriginal = false;
    bringBackFactoriesSetAside(globalObject, mock);
    LoadedModule inPlace;
    inPlace.compiledModule = mock->compiledModuleThatNeverRan ? JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan) : *compiled;
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
        didEndMockLaidOverMockOfPreload(globalObject, mock, specifier);
        RETURN_IF_EXCEPTION(scope, {});
#endif
    }
    return JSValue::encode(jsUndefined());
}

// Whether a module that Vitest doesn't externalize is linked to `record` and has yet to run. `running` is the one that asks.
__attribute__((minsize)) static bool isImportedByModuleYetToRun(Zig::GlobalObject* globalObject, JSC::AbstractModuleRecord* record, const String& running)
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
JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionBodyOfPatchedModuleDidRun, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
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
// The program's own factory has been called and has given a promise that is not settled.
static bool hasPendingFactory(const JSModuleMock* mock)
{
    JSValue factory = mock->factory.get();
    return factory && factory.isCallable() && mock->state == JSModuleMock::State::Running && mock->result && mock->result->inherits<JSC::JSPromise>();
}

static void waitForNextLoadOfCompiledModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, JSC::AOT::AfterFailure afterFailure = JSC::AOT::AfterFailure::AsksAgain)
{
    uint32_t module = *mock->compiledModuleThatNeverRan;
    auto& waiting = globalObject->onLoadPlugins.compiledMocksToRun;
    waiting.removeAllMatching([&](const auto& entry) { return entry.first == module; });
    waiting.append({ module, JSC::Strong<JSC::JSObject> { JSC::getVM(globalObject), mock } });
    JSC::AOT::deferMock(globalObject, JSC::AOT::ModuleID(module), afterFailure);
}

static bool stillKeepsFailureForImports(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    return mock->keepsFailureForImports && registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) == mock->mockThatStoodAtFailure.get();
}

static JSValue failureKeptForImportsOf(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto& plugins = globalObject->onLoadPlugins;
    for (const auto& factory : plugins.factoriesOfCompiledMocks.span().subspan(plugins.numberOfFactoriesSetAside)) {
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (stillKeepsFailureForImports(globalObject, mock) && mock->specifier->tryGetValue().data == specifier)
            return mock->errorOwedToImports.get();
    }
    return {};
}

static void bringBackFactoriesSetAside(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& plugins = globalObject->onLoadPlugins;
    auto& factories = plugins.factoriesOfCompiledMocks;
    for (size_t index = 0; index < plugins.numberOfFactoriesSetAside; ++index) {
        if (factories[index].mock.get() == mock)
            plugins.numberOfFactoriesSetAside = index;
    }
}

static void decideWhetherFailureIsKept(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    if (!std::exchange(mock->decidesWhetherFailureIsKept, false) || mock->numberOfImportsOwedError)
        return;
    auto& plugins = globalObject->onLoadPlugins;
    auto* later = registeredModuleMock(globalObject, mock->specifier->tryGetValue().data);
    bool isLoadedAgain = later ? later == mock->mockThatStoodAtFailure.get() && mock->mockThatStoodAtFailureHadSettled : mock->compiledModuleThatNeverRan && !JSC::AOT::standsForLoadsInFlight(globalObject, JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan)) && JSC::AOT::hasImportBegunToLoad(globalObject, JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan));
    if (isLoadedAgain) {
        for (const auto& factory : plugins.factoriesOfCompiledMocks.span().subspan(plugins.numberOfFactoriesSetAside)) {
            auto* earlier = uncheckedDowncast<JSModuleMock>(factory.mock.get());
            if (earlier->keepsFailureForImports && earlier->specifier->tryGetValue().data == mock->specifier->tryGetValue().data)
                earlier->forgetFailureKeptForImports();
        }
        mock->keepsFailureForImports = true;
        mock->numberOfImportsOwedError = 1;
        mock->mockThatStoodAtFailure.setMayBeNull(JSC::getVM(globalObject), mock, later);
    } else
        mock->errorOwedToImports.clear();
}

static void decideInNextJobWhetherFailureIsKept(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto* later = registeredModuleMock(globalObject, mock->specifier->tryGetValue().data);
    mock->decidesWhetherFailureIsKept = true;
    mock->mockThatStoodAtFailure.setMayBeNull(vm, mock, later);
    mock->mockThatStoodAtFailureHadSettled = later && later != mock && later->state == JSModuleMock::State::Settled;
    JSC::JSPromise* settled = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    settled->fulfill(vm, jsUndefined());
    settled->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionDecideWhetherFailureIsKept), globalObject->thenable(jsFunctionDecideWhetherFailureIsKept), jsUndefined(), mock);
}

static bool throwErrorOwedToImport(Zig::GlobalObject* globalObject, JSC::ThrowScope& scope)
{
    auto& plugins = globalObject->onLoadPlugins;
    auto owesError = [](JSC::JSObject* object) { return object && uncheckedDowncast<JSModuleMock>(object)->numberOfImportsOwedError; };
    JSValue stateOfWait = JSC::AOT::stateOfWaitOfImportThatAsks(globalObject);
    JSValue awaited = stateOfWait && !stateOfWait.isString() ? JSC::asArray(stateOfWait)->getDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->value) : JSValue();
    auto isAwaited = [&](JSC::JSObject* mock) {
        return !awaited || plugins.factoriesOfCompiledMocks.containsIf([&](const auto& factory) { return factory.mock.get() == mock && JSValue(factory.patched.get()) == awaited; });
    };
    auto throwIfOwed = [&](uint32_t module, JSC::JSObject* object, bool toImportThatWaited) {
        auto* mock = uncheckedDowncast<JSModuleMock>(object);
        if (toImportThatWaited ? !(mock->numberOfImportsOwedError > mock->keepsFailureForImports && JSC::AOT::importThatWaitedAsksFor(globalObject, JSC::AOT::ModuleID(module))) : !(stillKeepsFailureForImports(globalObject, mock) && JSC::AOT::importAsksFor(globalObject, JSC::AOT::ModuleID(module))))
            return false;
        JSValue error = mock->errorOwedToImports.get();
        if (toImportThatWaited && !--mock->numberOfImportsOwedError)
            decideInNextJobWhetherFailureIsKept(globalObject, mock);
        throwException(globalObject, scope, error);
        return true;
    };
    for (const auto& entry : plugins.compiledMocksToRun) {
        if (owesError(entry.second.get()) && ((isAwaited(entry.second.get()) && throwIfOwed(entry.first, entry.second.get(), true)) || throwIfOwed(entry.first, entry.second.get(), false)))
            return true;
    }
    // A load that came by a statement has asked the factory anew meanwhile.
    for (const auto& factory : plugins.factoriesOfCompiledMocks.span().subspan(plugins.numberOfFactoriesSetAside)) {
        if (owesError(factory.mock.get()) && (!awaited || JSValue(factory.patched.get()) == awaited) && throwIfOwed(factory.module, factory.mock.get(), true))
            return true;
    }
    for (const auto& factory : plugins.factoriesOfCompiledMocks.span().subspan(plugins.numberOfFactoriesSetAside)) {
        if (owesError(factory.mock.get()) && throwIfOwed(factory.module, factory.mock.get(), false))
            return true;
    }
    return false;
}

JSC::JSPromise* evaluateOriginalOfCompiledMock(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module, bool& hasFactory)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& waiting = globalObject->onLoadPlugins.compiledMocksToRun;
    size_t index = waiting.findIf([&](const auto& entry) { return entry.first == module.index(); });
    auto* mock = index == notFound ? nullptr : dynamicDowncast<JSModuleMock>(waiting[index].second.get());
    JSValue factory = mock ? mock->factory.get() : JSValue();
    if (!mock || !mock->importsOriginal || (factory && factory.isString()) || mock->state == JSModuleMock::State::Settled)
        return nullptr;
    hasFactory = !!factory;
    mock->wasAskedFor = true;
    bool isPackageUnderMockOfVitest = mock->isOfVitest() && isInNodeModules(mock->specifier->tryGetValue().data);
    // A spy and an automock take the original too, and have no factory that would wait for its turn: nothing is run for them ahead of the factories.
    if (isPackageUnderMockOfVitest && !hasFactory)
        return nullptr;
    if (isPackageUnderMockOfVitest) {
        JSObject* package = JSC::AOT::packageItselfBesideMock(globalObject, module);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (!package)
            return nullptr;
        JSC::JSPromise* settled = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        settled->fulfill(vm, package);
        return settled;
    }
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
    Bun::evictModulesThatHaveLoaded(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return evaluation;
}

bool runCompiledMock(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (throwErrorOwedToImport(globalObject, scope)) [[unlikely]]
        return false;
    auto& waiting = globalObject->onLoadPlugins.compiledMocksToRun;
    size_t index = waiting.findIf([&](const auto& entry) { return entry.first == module.index(); });
    if (index == notFound)
        return false;
    auto* mock = uncheckedDowncast<JSModuleMock>(waiting[index].second.get());
    waiting.removeAt(index);
    if (!mock)
        return false;
    endWaitForTurn(globalObject, mock);
    // The turn that a fetch took for the mock goes back wherever no factory is left running, as behind every waitForTurn().
    auto givesTurnBack = makeScopeExit([&] {
        if (!findRunningModuleMock(globalObject, mock))
            returnTurn(globalObject, mock);
    });
    mock->moduleThatLoadAskedFor = JSC::AOT::loadThatAsks(globalObject).transform([](JSC::AOT::ModuleID asked) { return asked.index(); });
    bool isBelowWhatIsRequired = JSC::AOT::requireRunsMocks(vm) && !JSC::AOT::requireAsksFor(globalObject, module);
    bool wasAskedForBefore = std::exchange(mock->wasAskedFor, true);
    bool keepsErrorOfOriginal = isBelowWhatIsRequired ? mock->importsOriginal && !mock->wasLaidOverFailedLoad && wasAskedForBefore : !JSC::AOT::requireRunsMocks(vm) && (mock->wasLaidOverFailedLoad || mock->importsOriginal);
    if (JSValue thrown = keepsErrorOfOriginal ? evaluationErrorOfOriginal(globalObject, mock->specifier->tryGetValue().data) : JSValue()) [[unlikely]] {
        waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
        throwException(globalObject, scope, thrown);
        return false;
    }
    // The load that waited for the factory asks again. From here on it is a factory that fails at once.
    if (JSValue error = mock->errorOfLateFailure.get()) [[unlikely]] {
        mock->errorOfLateFailure.clear();
        waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
        throwException(globalObject, scope, error);
        return false;
    }
    // As where the loader answers a require(): ModuleLoader.cpp. It cannot wait for a factory that awaits, so it does not call it: it answers the original, whose body runs now, and the mock waits for an import.
    // Nor does it call the factory for a package that does not see the mock.
    bool isPending = hasPendingFactory(mock);
    String requirer = JSC::AOT::pathOfModuleThatRequires(globalObject, module);
    bool isHiddenFromRequirer = !requirer.isNull() && !JSC::AOT::isLeftAloneByMock(globalObject, module) && Bun::keyOfImportByPackage(globalObject, mock->specifier->tryGetValue().data, requirer, false) != mock->specifier->tryGetValue().data;
    if (JSC::AOT::requireRunsMocks(vm) && !JSC::AOT::isESModule(module) && (isPending || isHiddenFromRequirer || Bun::canRequireOriginalOfModuleMock(globalObject, mock))) {
        mock->compiledModuleThatNeverRan = module.index();
        // There, too, nothing falsy is left under the key: `require.cache[key] = undefined`. The loader comes there only past an entry that is not truthy: what the program stored to stand for the file stays.
        JSC::JSMap* requireMap = Bun::testFileRequireMap(globalObject);
        JSValue stored = requireMap->get(globalObject, mock->specifier.get());
        RETURN_IF_EXCEPTION(scope, false);
        if (!stored.toBoolean(globalObject)) {
            JSC__JSMap__remove(requireMap, globalObject, JSValue::encode(mock->specifier.get()));
            RETURN_IF_EXCEPTION(scope, false);
        }
        // The body has run beside the mock already: the mock goes on waiting, and what the run time keeps of the loads that it ended stays.
        if (JSC::AOT::hasBegunToLoad(globalObject, module)) {
            waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
            JSC::AOT::letMockWaitBehindLateFailure(globalObject, module);
            return false;
        }
        JSC::Exception* thrownByBody = nullptr;
        {
            auto catching = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            JSC::AOT::runBodyOfRequiredFileAheadOfMock(globalObject, module);
            thrownByBody = catching.exception();
            if (thrownByBody && !catching.tryClearException()) [[unlikely]]
                return false;
        }
        waitForNextLoadOfCompiledModule(globalObject, mock, mock->importsOriginal ? JSC::AOT::AfterFailure::AsksAgain : JSC::AOT::AfterFailure::KeepsError);
        RETURN_IF_EXCEPTION(scope, false);
        if (thrownByBody) [[unlikely]]
            throwException(globalObject, scope, thrownByBody);
        return false;
    }
    // The same of an ES module: its body runs now, where it has not run, and the mock waits over a module that has run.
    // Where a statement below what is required asks for the module, the require() finds a graph that awaits, and throws.
    // So it is while the loader keeps the entry of the module for a load that has yet to settle: whoever imports it meanwhile joins that entry under `bun test`, and no factory is called.
    bool isKeptForPendingLoad = !JSC::AOT::requireRunsMocks(vm) && JSC::AOT::isKeptByLoadsInFlight(globalObject, module) && globalObject->onLoadPlugins.modulesToEvictOnceLoaded.contains(mock->specifier->tryGetValue().data);
    if (JSC::AOT::isESModule(module) && (isKeptForPendingLoad || (JSC::AOT::requireAsksFor(globalObject, module) && Bun::canRequireOriginalOfModuleMock(globalObject, mock)))) {
        // It waits there already: it goes on waiting, and what the run time keeps of the loads that it ended stays.
        if (JSC::AOT::isLeftAloneByMock(globalObject, module)) {
            waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
            JSC::AOT::letMockWaitBehindLateFailure(globalObject, module);
            return false;
        }
        JSC::Exception* thrownByBody = nullptr;
        bool hasRun = false;
        {
            auto catching = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            hasRun = JSC::AOT::runBodyOfImportedModuleAheadOfMock(globalObject, module);
            thrownByBody = catching.exception();
            if (thrownByBody && !catching.tryClearException()) [[unlikely]]
                return false;
        }
        if (thrownByBody && mock->importsOriginal) [[unlikely]] {
            throwException(globalObject, scope, thrownByBody);
            return false;
        }
        bool waitsOverModule = (hasRun || thrownByBody) && JSC::AOT::willLeaveModuleAlone(globalObject, module, false, std::nullopt, !!thrownByBody);
        RETURN_IF_EXCEPTION(scope, false);
        if (waitsOverModule) {
            mock->compiledModuleThatNeverRan = module.index();
            waitForNextLoadOfCompiledModule(globalObject, mock, mock->importsOriginal ? JSC::AOT::AfterFailure::AsksAgain : JSC::AOT::AfterFailure::KeepsError);
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
    mock->compiledModuleThatNeverRan = module.index();
    mock->testFileOfFirstLoad = Bun::isBunTest && !JSMock__isInPreload(globalObject) ? globalObject->onLoadPlugins.testFile : 0;
    // The owner is the key's: what lies under the key of the original comes back under a key that this load has written over.
    if (auto* displaced = displacedMockOfPreload(globalObject, mock->specifier->tryGetValue().data); displaced && displaced->liesUnderKeyOfOriginal)
        displaced->testFileOfFirstLoad = mock->testFileOfFirstLoad;
    // The loader made such a namespace object from a mock, and it reads the newest one. This mock is that one, or a later one has taken its place.
    if (loaded.esmNamespace && loaded.esmNamespace->moduleRecord()->hasLiveExports())
        loaded.esmNamespace = nullptr;
    // What the loader holds under the path of a form is what another import type makes of the file.
    if (loaded.esmNamespace && JSC::AOT::formsThatAttributesAskFor(globalObject, mock->specifier->value(globalObject)).contains(module))
        loaded.esmNamespace = nullptr;
    RETURN_IF_EXCEPTION(scope, false);
    // Nothing was loaded when the mock was made. Since then the host has answered a require(): of a name that the build does not know, or from code outside the image.
    mock->keepsModuleObject = !!loaded.commonJSModule;
    // A file of a `__mocks__` folder may await at its top, and so may the file that a mock without a factory is made of: an import waits for it, and a require() refuses it, as in `bun test`.
    bool requiresFile = (!mock->factory.get() || mock->factory.get().isString()) && JSC::AOT::requireRunsMocks(vm);
    // Behind an ES module that awaits nothing the loader makes such a mock in the same evaluation, ahead of the jobs that the body has queued.
    bool followsBodyAtOnce = !mock->factory.get() && JSC::AOT::isESModuleThatWaitsForNothing(globalObject, module);
    JSC::JSPromise* pendingFactory = mock->run(globalObject, requiresFile || followsBodyAtOnce);
    if (!scope.exception()) [[likely]] {
        // The factory may have require()d the module itself: `() => ({ ...require("./m"), extra })`.
        findLoadedCommonJSModule(globalObject, mock->specifier.get(), loaded);
    }
    bool isGone = !scope.exception() && !pendingFactory && !registeredModuleMock(globalObject, mock->specifier->value(globalObject));
    if (!scope.exception() && !pendingFactory && (!isGone || !JSC::AOT::hasBegunToLoad(globalObject, module) || JSC::AOT::standsForLoadsInFlight(globalObject, module))) [[likely]] {
        keepModuleObjectLeftBehindMock(mock, loaded);
        overrideLoadedModuleExports(globalObject, mock, loaded);
        if (isGone && !scope.exception())
            JSC::AOT::letMockStandForLoadsInFlight(globalObject, module);
    }
    if (scope.exception()) [[unlikely]] {
        // The next load asks the mock again.
        waiting.append({ module.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
        return false;
    }
    if (pendingFactory) {
        auto& plugins = globalObject->onLoadPlugins;
        // The job behind the factory settles its own promise whatever that holds, so what may be settled from two sides is another one.
        JSC::JSPromise* patched = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        patchWhenFactorySettles(globalObject, mock, pendingFactory)->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionFactoryOfCompiledMockSettled), globalObject->thenable(jsFunctionFactoryOfCompiledMockFailed), JSC::jsUndefined(), patched);
        auto& newestCalls = plugins.newestCallsOfFactoriesOfCompiledMocks;
        size_t newest = newestCalls.findIf([&](const auto& each) { return each.first == module.index(); });
        bool cameToFetchInFlight = newest != notFound && plugins.factoriesOfCompiledMocks.containsIf([&](const auto& earlier) { return earlier.call == newestCalls[newest].second && earlier.patched->status() == JSC::JSPromise::Status::Pending; });
        plugins.factoriesOfCompiledMocks.append({ module.index(), false, JSC::Strong<JSC::JSObject> { vm, mock }, JSC::Strong<JSC::JSPromise> { vm, patched } });
        plugins.factoriesOfCompiledMocks.last().cameToFetchInFlight = cameToFetchInFlight;
        plugins.factoriesOfCompiledMocks.last().wasStartedByRequire = JSC::AOT::requireRunsMocks(vm);
        mock->nobodyWaitsForFactory = JSC::AOT::requireRunsMocks(vm);
        plugins.factoriesOfCompiledMocks.last().isWaitedForByImporter = !JSC::AOT::importAsksFor(globalObject, module);
        plugins.factoriesOfCompiledMocks.last().call = ++plugins.callsOfFactoriesOfCompiledMocks;
        if (newest == notFound)
            newestCalls.append({ module.index(), plugins.callsOfFactoriesOfCompiledMocks });
        else
            newestCalls[newest].second = plugins.callsOfFactoriesOfCompiledMocks;
        mock->hasPendingPatch = false;
        mock->numberOfImportsThatWait = JSC::AOT::importAsksFor(globalObject, module);
        mock->isDetached = false;
    }
    return !!pendingFactory;
}
#endif

#if ENABLE(AOT)
static bool factoryWaitsForFactory(Zig::GlobalObject* globalObject, JSObject* waiting, JSObject* waitedFor, Vector<JSObject*, 4>& seen)
{
    if (seen.contains(waitedFor))
        return false;
    seen.append(waitedFor);
    for (const auto& factory : globalObject->onLoadPlugins.factoriesOfCompiledMocks) {
        if (factory.mock.get() == waitedFor && factory.patched->status() == JSC::JSPromise::Status::Pending && factory.factoriesThatWait.containsIf([&](const auto& other) { return other.get() == waiting || factoryWaitsForFactory(globalObject, waiting, other.get(), seen); }))
            return true;
    }
    return false;
}

static bool isWrittenIn(JSModuleMock* mock, JSC::AOT::ModuleID file)
{
    JSObject* factory = mock->factory ? mock->factory.get().getObject() : nullptr;
    // A function of the host is written in no file.
    if (!factory)
        return false;
    return (JSC::AOT::CompiledCallee::isCompiledCallee(factory) ? JSC::AOT::pathOfFileThatDeclares(factory) : fileOfFunction(factory)) == JSC::AOT::pathOfFileOfModule(file);
}

static bool waitsForMockOf(Zig::GlobalObject* globalObject, JSModuleMock* running, const Vector<JSObject*, 2>& callers, std::optional<JSC::AOT::ImportThatAsks> import)
{
    // Who does not see a mock waits for none.
    if (import && running->compiledModuleThatNeverRan == import->fileAskedFor.index() && !JSC::AOT::callOfImportSeesMockOf(globalObject, import->fileAskedFor, import->fileThatWroteIt))
        return false;
    auto* entry = findRunningModuleMock(globalObject, running);
    // A factory that was not running when import() was called is nothing to that call: it asks for the module and gets what stands for it.
    // Compiled code calls some factories earlier than `bun test` does: one whose import() was called ahead of the asker's would have been running.
    if (import && !callers.isEmpty() && running->calledAt > import->momentOfCall && running->askedForAt > uncheckedDowncast<JSModuleMock>(callers[0])->askedForAt)
        return true;
    auto fileThatWroteImport = import ? std::optional(import->fileThatWroteIt) : std::nullopt;
    auto asked = import ? std::optional(import->fileAskedFor) : std::nullopt;
    Vector<JSObject*, 4> seen;
    if (callers.containsIf([&](JSObject* caller) { return factoryWaitsForFactory(globalObject, running, caller, seen); }))
        return false;
    if (fileThatWroteImport) {
        if (*asked && running->compiledModuleThatNeverRan && asked->index() != *running->compiledModuleThatNeverRan && JSC::AOT::loadLeadsTo(globalObject, *asked, JSC::AOT::ModuleID(*running->compiledModuleThatNeverRan))) {
            // The load comes to the mocked module by statements, through a file that the running factory has imported: that file was linked with the original.
            JSC::AOT::ModuleID mocked(*running->compiledModuleThatNeverRan);
            for (size_t module : entry ? entry->compiledImportChain : WTF::BitVector()) {
                if (JSC::AOT::importsByStatements(globalObject, JSC::AOT::ModuleID(module), mocked) && (module == asked->index() || JSC::AOT::loadLeadsTo(globalObject, *asked, JSC::AOT::ModuleID(module))))
                    return false;
            }
        }
        // The factories that have imported the module of one that asks may wait for it: it must not wait for theirs.
        Vector<JSObject*, 4> mayWait(callers.span());
        for (size_t index = 0; index < mayWait.size(); ++index) {
            auto module = uncheckedDowncast<JSModuleMock>(mayWait[index])->compiledModuleThatNeverRan;
            for (const auto& other : globalObject->onLoadPlugins.runningModuleMocks) {
                if (module && other.compiledImportChain.get(*module) && !mayWait.contains(other.mock.get()))
                    mayWait.append(other.mock.get());
            }
        }
        if (mayWait.contains(running))
            return false;
        if (entry && (entry->compiledImportChain.get(fileThatWroteImport->index()) || entry->importChain.contains(JSC::AOT::pathOfFileOfModule(*fileThatWroteImport))))
            return false;
        if (!isWrittenIn(running, *fileThatWroteImport))
            return true;
    }
    auto* asker = uncheckedDowncast<JSModuleMock>(callers[0]);
    // The fetch of a mocked module starts its factory without a load: two such are not one load. The end of this function asks who fetches them.
    if (running->moduleThatLoadAskedFor && running->moduleThatLoadAskedFor == asker->moduleThatLoadAskedFor)
        return true;
    auto leadsTo = [&](std::optional<unsigned> asked, JSModuleMock* other) {
        return asked && other->compiledModuleThatNeverRan && JSC::AOT::loadLeadsTo(globalObject, JSC::AOT::ModuleID(*asked), JSC::AOT::ModuleID(*other->compiledModuleThatNeverRan));
    };
    if (leadsTo(asker->moduleThatLoadAskedFor, running) || leadsTo(running->moduleThatLoadAskedFor, asker))
        return true;
    auto leadsToBoth = [&](std::optional<unsigned> asked) { return leadsTo(asked, running) && leadsTo(asked, asker); };
    for (const auto& factory : globalObject->onLoadPlugins.factoriesOfCompiledMocks) {
        if (factory.patched->status() == JSC::JSPromise::Status::Pending && (leadsToBoth(uncheckedDowncast<JSModuleMock>(factory.mock.get())->moduleThatLoadAskedFor) || factory.modulesThatLoadsThatWaitAskedFor.containsIf(leadsToBoth)))
            return true;
    }
    // What runs from its text stands on none of these lists: the loader fetches what it imports, so the loader is asked, as under `bun test`.
    // Of a file that is still being read it knows no import: the image knows what the file imported when it was built.
    auto isAboveBothAsBuilt = [&](const String& key) {
        auto file = Bun::compiledModuleForPath(key);
        return file && leadsToBoth(file->index());
    };
    for (auto& [key, fetch] : globalObject->onLoadPlugins.fetchesOfModulesAskedFor) {
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
JSC::JSPromise* turnOfCompiledMockThatLoaderFetches(Zig::GlobalObject*, uint32_t module, const String& key);

JSC_DEFINE_HOST_FUNCTION(jsFunctionCompiledMockAsksForItsTurnAgain, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
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
    globalObject->onLoadPlugins.fetchesThatStandForWaitingMocks.removeAllMatching([&](const auto& standing) { return standing.first == key && standing.second.get() == mock; });
    // The mock was taken back or replaced while it waited, or another fetch that waited for the same turn has called its factory: unless that runs, its turn goes to the next. Whatever waits there now asks for its own.
    bool stillWaits = globalObject->onLoadPlugins.compiledMocksToRun.containsIf([&](const auto& waiting) { return waiting.second.get() == mock; });
    if (!stillWaits && !findRunningModuleMock(globalObject, mock))
        returnTurn(globalObject, mock);
    if (JSC::JSPromise* next = turnOfCompiledMockThatLoaderFetches(globalObject, module, key))
        mayGoOn->pipeFrom(vm, next);
    else
        mayGoOn->fulfill(vm, stillWaits ? JSValue(mock) : jsUndefined());
    return JSValue::encode(jsUndefined());
}

// The loader fetches a compiled module on which a mock waits, or below which one does, for an importer that runs from its text: the factory takes its turn as under `bun test`, see waitForTurn().
// Null where the fetch may go on at once, else a promise for the mock that has the turn, or for undefined if none is left.
JSC::JSPromise* turnOfCompiledMockThatLoaderFetches(Zig::GlobalObject* globalObject, uint32_t module, const String& key)
{
    auto& vm = JSC::getVM(globalObject);
    auto& standing = globalObject->onLoadPlugins.fetchesThatStandForWaitingMocks;
    std::optional<WTF::BitVector> below;
    for (auto& waiting : globalObject->onLoadPlugins.compiledMocksToRun) {
        if (waiting.first != module && !below)
            below = JSC::AOT::modulesThatLoadLeadsTo(globalObject, JSC::AOT::ModuleID(module));
        bool liesBelow = waiting.first != module && below->get(waiting.first);
        if (waiting.first != module && !liesBelow)
            continue;
        auto* mock = uncheckedDowncast<JSModuleMock>(waiting.second.get());
        // Another load has called it. One that lies beside it below the file may still wait.
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
        JSC::JSFunction* asksAgain = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionCompiledMockAsksForItsTurnAgain, ImplementationVisibility::Private);
        turn->performPromiseThenWithContext(vm, globalObject, asksAgain, asksAgain, jsUndefined(), moduleMockWith(globalObject, mock, fetch));
        return mayGoOn;
    }
    return nullptr;
}

// Behind the door of the fetch that had the turn: it may have called nobody.
void giveBackTurnOfCompiledMockUnlessItRuns(Zig::GlobalObject* globalObject, JSValue holder)
{
    auto* mock = dynamicDowncast<JSModuleMock>(holder);
    if (mock && !findRunningModuleMock(globalObject, mock))
        returnTurn(globalObject, mock);
}

// mock.module() itself has called the compiled factory over a module that is loaded, and the factory has yet to settle. The list below knows only the factories that a load has called.
bool isCompiledModulePatchedOnceFactorySettles(Zig::GlobalObject* globalObject, const WTF::String& path)
{
    return globalObject->onLoadPlugins.runningModuleMocks.containsIf([&](const auto& running) {
        return !running.file.isEmpty() && uncheckedDowncast<JSModuleMock>(running.mock.get())->specifier->tryGetValue().data == path;
    });
}

// 0 where the mock that stands for the module has no factory that was called and has returned a promise which is pending.
uint64_t callOfFactoryOfCompiledMockThatHasNotSettled(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module, bool& refusesEveryRequire)
{
    for (const auto& factory : globalObject->onLoadPlugins.factoriesOfCompiledMocks | std::views::reverse) {
        if (factory.module != module.index() || factory.patched->status() != JSC::JSPromise::Status::Pending)
            continue;
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (mock->state == JSModuleMock::State::NotCalled || registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) != mock)
            continue;
        // A require() gives up on the mock of a preload each time, as in `bun test`.
        refusesEveryRequire = mock->isFromPreload && !mock->importsOriginal && !factoriesInAsyncContext(globalObject).contains(mock);
        return factory.call;
    }
    return 0;
}

// `state`: a list: the factories that whoever asks was called from, as a list, and behind it the promises of those that it has started and not waited for yet. Its `source` is the file that wrote the import. The loader's first question brings the key of its fetch, and the list begins with that.
JSC::JSPromise* factoryOfCompiledMockThatWaits(Zig::GlobalObject* globalObject, const WTF::ScopedLambda<bool(JSC::AOT::ModuleID)>& isAskedAbout, JSC::AOT::FactoryAskedForBy askedBy, JSC::JSValue& state)
{
    auto& factories = globalObject->onLoadPlugins.factoriesOfCompiledMocks;
    if (factories.isEmpty() && !state) [[likely]]
        return nullptr;
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    if (askedBy != JSC::AOT::FactoryAskedForBy::Require && throwErrorOwedToImport(globalObject, scope)) [[unlikely]]
        return nullptr;
    // What a require() has started and could not wait for is waited for by nobody. Once its mock has gone, no load takes it for its own.
    size_t& setAside = globalObject->onLoadPlugins.numberOfFactoriesSetAside;
    Vector<JSModuleMock*, 1> noLongerRunning;
    factories.removeAllMatching([&](const auto& factory) {
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (factory.isWaitedFor && factory.patched->status() != JSC::JSPromise::Status::Pending)
            return !mock->decidesWhetherFailureIsKept && mock->numberOfImportsOwedError <= mock->keepsFailureForImports && !stillKeepsFailureForImports(globalObject, mock);
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
        if (!mock->isDetached || !factory.isWaitedFor || factory.isWaitedForByImporter || !factory.factoriesThatWait.isEmpty() || mock->numberOfImportsOwedError || factory.patched->status() != JSC::JSPromise::Status::Pending)
            break;
    }
    if (askedBy == JSC::AOT::FactoryAskedForBy::Require) {
        for (const auto& factory : factories) {
            if (factory.patched->status() == JSC::JSPromise::Status::Pending)
                return factory.patched.get();
        }
        return nullptr;
    }
    bool asksForFirstTime = !state || state.isString();
    if (asksForFirstTime) {
        JSC::MarkedArgumentBuffer callers;
        if (askedBy == JSC::AOT::FactoryAskedForBy::ImportCall) {
            for (JSObject* factory : factoriesInAsyncContext(globalObject))
                callers.append(factory);
        }
        JSC::JSArray* listOfCallers = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), callers);
        RETURN_IF_EXCEPTION(scope, nullptr);
        JSC::MarkedArgumentBuffer list;
        list.append(state ? state : JSValue(listOfCallers));
        JSC::JSArray* newState = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (auto import = askedBy == JSC::AOT::FactoryAskedForBy::ImportCall ? JSC::AOT::importThatAsks(globalObject) : std::nullopt) {
            newState->putDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->source, JSC::jsNumber(import->fileThatWroteIt.index()));
            newState->putDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->index, JSC::jsNumber(import->momentOfCall));
        }
        state = newState;
    }
    auto* list = JSC::asArray(state);
    // Whoever starts a factory asks before anybody else can. A load starts its factories one at a time, and asks behind each: what it has started since lies below it.
    for (auto& factory : factories.mutableSpan().subspan(setAside)) {
        // A require() does not come back to ask: what it has started is nothing to a load that does not lead there.
        if (factory.isWaitedFor || ((!asksForFirstTime || factory.wasStartedByRequire) && !isAskedAbout(JSC::AOT::ModuleID(factory.module))))
            continue;
        factory.isWaitedFor = true;
        uncheckedDowncast<JSModuleMock>(factory.mock.get())->nobodyWaitsForFactory = false;
        factory.isWaitedForByFetch = askedBy == JSC::AOT::FactoryAskedForBy::Loader;
        factory.isWaitedForByLoadThatRequireLeft = askedBy == JSC::AOT::FactoryAskedForBy::LoadThatRequireLeft;
        if (factory.isWaitedForByLoadThatRequireLeft && factory.cameToFetchInFlight)
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
    // What the loader fetches may be part of a graph that one of those factories waits for. The mocked module itself is not: a factory's own loads are given the original's key. A require() can wait for nothing.
    JSValue first = list->getIndexQuickly(0);
    if (askedBy != JSC::AOT::FactoryAskedForBy::ImportCall && (!first.isString() || JSC::getVM(globalObject).synchronousModuleQueue()))
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
    Vector<JSObject*, 2> factoriesThatAsk;
    for (unsigned index = 0; callers && index < callers->length(); ++index)
        factoriesThatAsk.append(asObject(callers->getIndexQuickly(index)));
    JSValue source = list->getDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->source);
    auto import = source ? std::optional(JSC::AOT::ImportThatAsks { JSC::AOT::ModuleID(source.asUInt32()), JSC::AOT::loadThatAsks(globalObject).value_or(JSC::AOT::ModuleID()), list->getDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->index).asUInt32() }) : std::nullopt;
    for (auto& factory : factories.mutableSpan().subspan(setAside)) {
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (factory.patched->status() != JSC::JSPromise::Status::Pending)
            continue;
        // A mock that has ended, or that another one has taken the place of, holds up nobody but who started it. Once somebody else asks for the module, that one goes on too, with what stands there now.
        if (mock->isDetached || registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) != mock) {
            // A test file that has ended does not go on.
            if (factory.isWaitedForByImporter && mock->testFileOfFirstLoad == globalObject->onLoadPlugins.testFile && isAskedAbout(JSC::AOT::ModuleID(factory.module)))
                factory.patched.get()->resolve(globalObject, JSC::getVM(globalObject), JSC::jsUndefined());
            continue;
        }
        if (isCaller(mock) || (!callers && factory.isWaitedForByFetch))
            continue;
        if (!factoriesThatAsk.isEmpty() && !waitsForMockOf(globalObject, mock, factoriesThatAsk, import))
            continue;
        if (isAskedAbout(JSC::AOT::ModuleID(factory.module))) {
            if (JSC::AOT::importAsksFor(globalObject, JSC::AOT::ModuleID(factory.module)))
                ++mock->numberOfImportsThatWait;
            else
                factory.isWaitedForByImporter = true;
            if (auto asked = JSC::AOT::loadThatAsks(globalObject))
                factory.modulesThatLoadsThatWaitAskedFor.appendIfNotContains(asked->index());
            for (JSObject* caller : factoriesThatAsk) {
                if (!factory.factoriesThatWait.containsIf([&](const auto& other) { return other.get() == caller; }))
                    factory.factoriesThatWait.append(JSC::Strong<JSC::JSObject> { JSC::getVM(globalObject), caller });
            }
            list->putDirect(JSC::getVM(globalObject), JSC::getVM(globalObject).propertyNames->value, factory.patched.get());
            return factory.patched.get();
        }
    }
    return nullptr;
}
#endif

#if ENABLE(AOT)
// As in keyOfImportWhileModuleMocksRun(): what is imported or required is booked on the chain of every running factory that it does not wait for. Without a factory in the async context the file that wrote it says whose it is.
uint32_t addToImportChainsOfCompiledFactories(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID importer, JSC::AOT::ModuleID asked, JSC::AOT::LoadByName loadedBy)
{
    uint32_t moment = loadedBy == JSC::AOT::LoadByName::Import ? ++globalObject->onLoadPlugins.momentOfModuleMocks : globalObject->onLoadPlugins.momentOfModuleMocks;
    if (globalObject->onLoadPlugins.runningModuleMocks.isEmpty()) [[likely]]
        return moment;
    Vector<JSObject*, 2> callers = factoriesInAsyncContext(globalObject);
    // As keyOfModuleThatDoesNotWait() has it: of an import the modules that have yet to finish. What is required goes on the chain as it is.
    auto listWhatIsBooked = [&](JSC::AOT::LoadOf loadOf) {
        WTF::BitVector booked;
        if (loadedBy == JSC::AOT::LoadByName::Require) {
            booked.set(asked.index());
            return booked;
        }
        WTF::BitVector reached = JSC::AOT::modulesThatLoadLeadsTo(globalObject, asked, loadOf);
        reached.set(asked.index());
        for (size_t module : reached) {
            JSC::AOT::ModuleID file(module);
            // What stands for a mocked module has yet to finish while its factory has yet to settle.
            auto* mockOfFile = registeredModuleMock(globalObject, JSC::AOT::pathOfFileOfModule(file));
            if ((mockOfFile && mockOfFile->state != JSModuleMock::State::Settled) || JSC::AOT::isBeingEvaluated(globalObject, file) || !JSC::AOT::isEvaluatedFile(globalObject, file))
                booked.set(module);
        }
        return booked;
    };
    for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
        auto* mock = uncheckedDowncast<JSModuleMock>(running.mock.get());
        // Nobody says who wrote a call of a function that createRequire() made.
        bool isOfFactoryItself = callers.contains(mock);
        if (!isOfFactoryItself && (!importer || (callers.isEmpty() ? !running.compiledImportChain.get(importer.index()) && !isWrittenIn(mock, importer) : waitsForMockOf(globalObject, mock, callers, JSC::AOT::ImportThatAsks { importer, asked, moment }))))
            continue;
        // Whoever does not wait for the mock of the module that is asked for gets its original.
        bool getsOriginal = mock->compiledModuleThatNeverRan == asked.index();
        running.compiledImportChain.merge(listWhatIsBooked(getsOriginal ? JSC::AOT::LoadOf::Original : JSC::AOT::LoadOf::WhatStandsForModule));
        if (mock->compiledModuleThatNeverRan && !getsOriginal)
            running.compiledImportChain.clear(*mock->compiledModuleThatNeverRan);
    }
    return moment;
}

bool isCalledFromFactoryOfCompiledMockThatWaits(Zig::GlobalObject* globalObject, JSC::AOT::ModuleID module)
{
    Vector<JSObject*, 2> callers = factoriesInAsyncContext(globalObject);
    if (callers.isEmpty())
        return false;
    for (const auto& factory : globalObject->onLoadPlugins.factoriesOfCompiledMocks) {
        if (factory.module != module.index() || factory.patched->status() != JSC::JSPromise::Status::Pending)
            continue;
        if (callers.contains(factory.mock.get()))
            return true;
        // A mock that has ended, or that another one has taken the place of, is nothing to whoever asks now.
        auto* mock = uncheckedDowncast<JSModuleMock>(factory.mock.get());
        if (mock->isDetached || registeredModuleMock(globalObject, mock->specifier->tryGetValue().data) != mock)
            continue;
        if (!waitsForMockOf(globalObject, mock, callers, JSC::AOT::importThatAsks(globalObject)))
            return true;
    }
    return false;
}

static std::optional<size_t> rememberMockLaidByBody(Zig::GlobalObject* globalObject, JSC::CallFrame* callframe, ModuleMockFunction function)
{
    auto& vm = JSC::getVM(globalObject);
    auto& plugins = globalObject->onLoadPlugins;
    if (!plugins.callerOfMocksLaidAgain.isNull())
        return std::nullopt;
    String file = callerPath(vm, callframe);
    std::optional<JSC::AOT::ModuleID> module = Bun::compiledModuleForPath(file);
    if (!module)
        return std::nullopt;
    BunPlugin::OnLoad::MockLaidByBody laid { file, module->index(), static_cast<uint8_t>(function), false, false, {}, {}, {}, false };
    JSC::AOT::forEachModuleWhoseBodyRuns(vm, callframe, [&](JSC::AOT::ModuleID body) {
        if (body == *module)
            laid.isOfOwnBody = true;
        else if (laid.importers.contains(body.index()) || laid.importersByCall.contains(body.index()))
            return;
        // A body that stands on the stack below the file's own body has required the file: `bun test` finds it as the parent of the file's module object.
        else if (laid.isOfOwnBody || JSC::AOT::importsByStatements(globalObject, body, *module))
            laid.importers.append(body.index());
        else
            laid.importersByCall.append(body.index());
    });
    if (!laid.isOfOwnBody && laid.importers.isEmpty() && laid.importersByCall.isEmpty())
        return std::nullopt;
    for (uint32_t other : plugins.modulesThatLaidMocksInBodies) {
        if (other != laid.module && !laid.importers.contains(other) && !laid.importersByCall.contains(other) && JSC::AOT::isBeingEvaluated(globalObject, JSC::AOT::ModuleID(other)))
            laid.importersByCall.append(other);
    }
    for (size_t index = 0; index < std::min<size_t>(callframe->argumentCount(), 2); ++index)
        laid.arguments.append(JSC::Strong<JSC::Unknown> { vm, callframe->uncheckedArgument(index) });
    if (!plugins.modulesThatLaidMocksInBodies.contains(laid.module))
        plugins.modulesThatLaidMocksInBodies.append(laid.module);
    plugins.mocksLaidByBodies.append(WTF::move(laid));
    return plugins.mocksLaidByBodies.size() - 1;
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
    if (auto compiledModule = globalObject->vm().hasCompiledCode() ? JSC::AOT::formThatMockFinds(globalObject, specifier, Bun::moduleThatMockReplaces(specifier)) : std::nullopt; compiledModule && !JSC::AOT::mayBeMocked(globalObject, *compiledModule)) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, JSC::AOT::refusedMockMessage(globalObject, specifier, Bun::fileOfCallerThatWasNotCompiled(vm, callframe))));
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
        globalObject->onLoadPlugins.modulesThatMocked.add(callerPath(vm, callframe));
#if ENABLE(AOT)
    std::optional<size_t> remembered;
    if (vm.hasCompiledCode() && !mock->isFromPreload)
        remembered = rememberMockLaidByBody(globalObject, callframe, function);
    auto remembersThrow = makeScopeExit([&] {
        auto& laid = globalObject->onLoadPlugins.mocksLaidByBodies;
        if (remembered && *remembered < laid.size() && vm.exceptionForInspection()) [[unlikely]]
            laid[*remembered].threw = true;
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
            mock->importsOriginal = JSC::AOT::CompiledCallee::length(compiled) || JSC::AOT::mayAskForOwnOriginal(compiled);
            for (String other : mock->importsOriginal ? Vector<String>() : JSC::AOT::originalsAskedFor(compiled)) {
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

    LoadedModule loaded = findLoadedModule(globalObject, specifierString);
    RETURN_IF_EXCEPTION(scope, {});
    JSModuleMock* previous = registeredModuleMock(globalObject, specifier);
    [[maybe_unused]] bool wasMocked = previous;
#if ENABLE(AOT)
    if (JSValue factoryOfPrevious = previous ? previous->factory.get() : JSValue())
        mock->wasLaidOverFactoryThatTakesOriginal = previous->importsOriginal && factoryOfPrevious.isCallable();
    // See didUnmockCompiledFile().
    if (loaded.compiledModule)
        JSC::AOT::takeBackRunUnderKeyOfOriginal(globalObject, *loaded.compiledModule);
    if (vm.hasCompiledCode() && !previous && !loaded.compiledModule && (loaded.commonJSModule || loaded.esmNamespace)) {
        JSValue exportsOfLoad = loaded.commonJSModule ? loaded.commonJSModule->getDirect(vm, Bun::builtinNames(vm).exportsPublicName()) : JSValue(loaded.esmNamespace);
        Bun::willMockFileLoadedAnew(globalObject, specifier, exportsOfLoad);
    }
    // A mock that takes the place of another changes nothing about who was linked to the module ahead of the first, unless the first patched the module: a patch reaches whoever is linked.
    Vector<BunPlugin::OnLoad::CompiledImporterLinkedAheadOfMock> linkedAheadOfEarlierMock;
    auto carryOver = makeScopeExit([&] {
        globalObject->onLoadPlugins.compiledImportersLinkedAheadOfMocks.appendVector(linkedAheadOfEarlierMock);
    });
    if (vm.hasCompiledCode()) {
        auto& linkedAhead = globalObject->onLoadPlugins.compiledImportersLinkedAheadOfMocks;
        for (auto& linked : linkedAhead) {
            if (previous && previous->isOfVitest() && linked.mocked == specifier)
                linkedAheadOfEarlierMock.append(linked);
        }
        linkedAhead.removeAllMatching([&](const auto& linked) { return linked.mocked == specifier; });
        auto hasRun = [](JSC::AbstractModuleRecord* record) {
            auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record);
            return cyclic && cyclic->status() == JSC::CyclicModuleRecord::Status::Evaluated;
        };
        // An ES module holds a CommonJS file by a record under a key of its own: the records are told by their file.
        auto mocked = wasMocked ? std::nullopt : Bun::compiledModuleForPath(specifier);
        // An importer that has yet to run is loaded anew where the module has yet to run too, to get the mock: it is linked anew to all that it imports.
        Vector<String, 2> importersLoadedAnew;
        for (auto& [mapKey, entry] : Bun::testFileModuleLoader(globalObject)->moduleMap()) {
            auto* importer = entry->record();
            if (!mocked || !importer || hasRun(importer) || !JSC::AOT::isCompiledModuleRecord(importer))
                continue;
            for (auto& imported : importer->loadedModules().values()) {
                if (JSC::AOT::fileOfCompiledModuleRecord(globalObject, imported.m_module.get()) == mocked && hasRun(imported.m_module.get()))
                    linkedAhead.append({ specifier, String(mapKey.first) });
            }
            // The load that left the importer may have ended before it came to the module: the loader knows nothing of that statement.
            auto fileOfImporter = JSC::AOT::fileOfCompiledModuleRecord(globalObject, importer);
            if (fileOfImporter && !JSC::AOT::hasBegunToLoad(globalObject, *mocked) && JSC::AOT::importsByStatements(globalObject, *fileOfImporter, *mocked))
                importersLoadedAnew.append(String(mapKey.first));
        }
        if (!importersLoadedAnew.isEmpty()) [[unlikely]]
            linkedAhead.removeAllMatching([&](const auto& linked) { return importersLoadedAnew.contains(linked.importer); });
    }
#endif

    // Like Vitest, vi.mock() in a test file doesn't patch a module that a preload loaded. The file loads its own mocked copy,
    // and the preload's module is restored when the file ends. mock.module() and jest.mock() patch it in place.
    // Nor does it patch a package, which vi.resetModules() leaves loaded, or what vi.importActual() returned: the factory has to stay lazy.
    // Nor does vi.doMock() patch what a test file loaded. This file's importers keep it. What an earlier file left is loaded again: in Vitest a file starts with nothing loaded.
    bool isDoMock = function == ModuleMockFunction::ViDoMock;
    unsigned loadedByTestFile = globalObject->onLoadPlugins.testFileOfModule.get(specifier);
#if ENABLE(AOT)
    // The loader has fetched nothing for a compiled module.
    auto testFileOf = [&](JSC::AOT::LoadedBy loadedBy) {
        unsigned testFile = globalObject->onLoadPlugins.testFile;
        return loadedBy == JSC::AOT::LoadedBy::ThisTestFile ? testFile : loadedBy == JSC::AOT::LoadedBy::EarlierTestFile ? testFile - 1
                                                                                                                         : 0;
    };
    // The end of an earlier test file may have emptied the key: whoever asked first behind it has loaded the mock anew.
    if (previous && loaded.compiledModule && !loadedByTestFile) {
        if (!previous->testFileOfFirstLoad)
            previous->testFileOfFirstLoad = testFileOf(JSC::AOT::whoLoadedMockInPlaceAnew(globalObject, *loaded.compiledModule));
        loadedByTestFile = previous->testFileOfFirstLoad;
    } else if (loaded.compiledModule && !loadedByTestFile && !loaded.esmNamespace && !loaded.commonJSModule)
        loadedByTestFile = testFileOf(JSC::AOT::whoFetched(globalObject, *loaded.compiledModule));
    // Behind `delete require.cache[key]` nothing is found loaded under the key.
    auto fileUnderPreviousMock = loaded.compiledModule ? loaded.compiledModule : Bun::compiledModuleForPath(specifier);
    bool isKeyOfPreviousMockEmpty = previous && !previous->liesUnderKeyOfOriginal && fileUnderPreviousMock && JSC::AOT::isKeyOfMockInPlaceEmpty(globalObject, *fileUnderPreviousMock);
#endif
    bool wasLoadedByImportActual = globalObject->onLoadPlugins.loadedByImportActual.remove(specifier);
    bool staysTheOriginal = wasLoadedByImportActual || isInNodeModules(specifier) || (isDoMock && loadedByTestFile == globalObject->onLoadPlugins.testFile);
    bool leavesLoadedModuleAlone = mock->isOfVitest() && Bun::isBunTest && !mock->isFromPreload && !isBuiltinModuleKey(specifier) && (!loadedByTestFile || staysTheOriginal || isDoMock);
    // In Vitest a module that has yet to run imports it after this call, and gets the mock. Here it is linked already, so only a patch reaches it.
    if (leavesLoadedModuleAlone && loaded.esmNamespace && isImportedByModuleYetToRun(globalObject, loaded.esmNamespace->moduleRecord(), callerPath(vm, callframe)))
        leavesLoadedModuleAlone = false;
#if ENABLE(AOT)
    // The same of a compiled module on which a mock stands: the loader holds nothing of it.
    if (leavesLoadedModuleAlone && loaded.compiledModule && JSC::AOT::isStandingMockImportedByModuleYetToRun(globalObject, *loaded.compiledModule, Bun::compiledModuleForPath(callerPath(vm, callframe)))) {
        mock->leavesStandingMockToItsImporters = false;
        leavesLoadedModuleAlone = false;
    }
    // A mock of Vitest's kind that waits has set the module aside under `bun test`: a mock that patches finds nothing loaded there, and waits too.
    bool waitsBehindMockThatNobodyLoaded = !leavesLoadedModuleAlone && !mock->isFromPreload && previous && !previous->isFromPreload && loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule
        && !JSC::AOT::wasLetGoByLoader(globalObject, *loaded.compiledModule) && JSC::AOT::isLeftAloneByMock(globalObject, *loaded.compiledModule) && !JSC::AOT::hasMockInPlace(globalObject, *loaded.compiledModule);
    if (waitsBehindMockThatNobodyLoaded) {
        unmockModule(globalObject, previous, specifier, mock, false);
        RETURN_IF_EXCEPTION(scope, {});
        previous = nullptr;
        loaded = findLoadedModule(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }
    // The importers of the module that it stands in place of have run, and nothing loads the module again for them.
    std::optional<unsigned> placeOfMockThatEnds;
    unsigned testFileOfMockThatEnds = 0;
    if (leavesLoadedModuleAlone && previous && !previous->isFromPreload) {
        placeOfMockThatEnds = previous->compiledModuleThatNeverRan;
        // runCompiledMock() names the module there for every mock that waited. One that left the module alone stood in place of no body that never ran.
        bool waitsAgain = globalObject->onLoadPlugins.compiledMocksToRun.containsIf([&](const auto& waiting) { return waiting.second.get() == previous; });
        if (placeOfMockThatEnds && (waitsAgain || previous->state == JSModuleMock::State::Running || JSC::AOT::isLeftAloneByMock(globalObject, JSC::AOT::ModuleID(*placeOfMockThatEnds))))
            placeOfMockThatEnds = std::nullopt;
        testFileOfMockThatEnds = previous->testFileOfFirstLoad;
    }
#endif
    if (leavesLoadedModuleAlone && previous && !previous->isFromPreload) {
#if ENABLE(AOT)
        auto* broughtBack = vm.hasCompiledCode() ? mockOfPreloadThatEndBringsBack(globalObject, previous, specifier) : nullptr;
#endif
        unmockModule(globalObject, previous, specifier, mock);
        RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
        mock->wasLaidOverMockOfPreload = previous->wasLaidOverMockOfPreload;
        // That end has moved the preload's instance back under the key, and this mock sets it aside again.
        if (broughtBack) {
            mock->hasSetMockOfPreloadAside = staysTheOriginal;
            broughtBack->liesUnderKeyOfOriginal = staysTheOriginal;
        }
#endif
        previous = nullptr;
        loaded = findLoadedModule(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }
    bool isLoadInFlight = loaded.staleESMEntry;
    if (leavesLoadedModuleAlone && staysTheOriginal && (loaded.esmNamespace || loaded.commonJSModule)) {
        // Before the move, while its importers are found under this key.
        if (loadedByTestFile != globalObject->onLoadPlugins.testFile) {
            ModulesToEvict evict;
            evict.onlyImportersFromEarlierTestFiles = true;
            evict.patchedESModules.append(specifier);
            evict.patchedCommonJSModules.append(specifier);
            evict.packagesSetAside.append(specifier);
            evictModulesAndTheirImporters(globalObject, WTF::move(evict));
            RETURN_IF_EXCEPTION(scope, {});
        }
        setLoadedModuleAside(globalObject, specifier);
        RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
        // It lies under the key of the original now, in place of the instance of a preload's mock that an earlier mock of the test file had set aside.
        if (auto* ofPreload = vm.hasCompiledCode() && !previous && !mock->hasSetMockOfPreloadAside ? displacedMockOfPreload(globalObject, specifier) : nullptr)
            ofPreload->liesUnderKeyOfOriginal = false;
#endif
        mock->hasSetLoadedModuleAside = !wasLoadedByImportActual;
        loaded = findLoadedModule(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }
#if ENABLE(AOT)
    // moveLoadedModule() leaves the entry of a load that failed under the key, where it is stale. The loader keeps such an entry for a compiled file too.
    bool failedEntryStaysUnderKey = false;
    if (leavesLoadedModuleAlone && staysTheOriginal && loaded.compiledModule) {
        auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, specifier));
        failedEntryStaysUnderKey = entry && entry->status() >= JSC::ModuleRegistryEntry::Status::FetchFailed;
    }
#endif
    if (leavesLoadedModuleAlone) {
        loaded.staleESMEntry |= !!std::exchange(loaded.esmNamespace, nullptr);
        loaded.staleCommonJSEntry |= !!std::exchange(loaded.commonJSModule, nullptr);
    }

    // Left for later, the body of a linked module would assign over the patch. It can't run ahead of an import whose own body is up the stack, though.
    using Status = JSC::CyclicModuleRecord::Status;
    auto* linked = loaded.esmNamespace ? dynamicDowncast<JSC::CyclicModuleRecord>(loaded.esmNamespace->moduleRecord()) : nullptr;
    JSC::JSPromise* bodyYetToRun = nullptr;
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
            bodyYetToRun = evaluating;
        loaded = findLoadedModule(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
        previous = registeredModuleMock(globalObject, specifier);
    }

#if ENABLE(AOT)
    bool earlierMockStillWaits = previous && loaded.compiledModule && globalObject->onLoadPlugins.compiledMocksToRun.containsIf([&](const auto& waiting) {
        return waiting.first == loaded.compiledModule->index() && waiting.second.get() == previous;
    });
    // A call of import() that is held for the text of the file has asked for its original. The load in flight of `bun test` runs it though another mock is laid meanwhile.
    if (loaded.compiledModule && JSC::AOT::hasLoadInFlightAskedForOriginalOf(globalObject, *loaded.compiledModule))
        mock->importsOriginal = true;
    // Under `bun test` the load that came to the earlier mock and failed with its original has left a failed entry under the key, and this mock evicts it below.
    bool loadFailedUnderMockThatIsDisplaced = leavesLoadedModuleAlone && previous && previous->wasAskedFor && loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule && evaluationErrorOfOriginal(globalObject, specifier);
#endif
    // With an earlier mock in place, what's loaded isn't the original any more, so inherit what that mock saved.
    if (previous && !leavesLoadedModuleAlone) {
        mock->originalExports.setMayBeNull(vm, mock, previous->originalExports.get());
        mock->originalNamespace.setMayBeNull(vm, mock, previous->originalNamespace.get());
        mock->patchedNamespace.setMayBeNull(vm, mock, previous->patchedNamespace.get());
        mock->originalExportsOfEvictedModule.setMayBeNull(vm, mock, previous->originalExportsOfEvictedModule.get());
        mock->patchOrder = previous->patchOrder;
        if (JSValue exports = previous->originalCommonJSExports.get())
            mock->originalCommonJSExports.set(vm, mock, exports);
#if ENABLE(AOT)
        mock->compiledModuleThatNeverRan = previous->compiledModuleThatNeverRan;
        mock->lostCommonJSExportsToReset = previous->lostCommonJSExportsToReset;
        mock->patchesMockOfPreload = previous->patchesMockOfPreload;
        mock->testFileOfFirstLoad = previous->testFileOfFirstLoad;
        mock->wasLaidOverFailedLoad = loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule && (previous->importsOriginal || previous->wasLaidOverFailedLoad) && evaluationErrorOfOriginal(globalObject, specifier);
        if (!mock->wasLaidOverFailedLoad)
            globalObject->onLoadPlugins.compiledMocksToRun.removeAllMatching([&](const auto& waiting) { return waiting.second.get() == previous && !isFormThatNobodyHasLoaded(globalObject, specifier, waiting.first); });
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
        // A compiled require() of a built-in module keeps its entry of require.cache with the program.
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
    // Where a load will come to the module, the mock waits for it, as under `bun test`. So it does where the end of the earlier mock has brought a preload's back.
    if (placeOfMockThatEnds && (JSC::AOT::loadComesToModuleWhoseMockEnded(globalObject, JSC::AOT::ModuleID(*placeOfMockThatEnds)) || JSC::AOT::hasMockInPlace(globalObject, JSC::AOT::ModuleID(*placeOfMockThatEnds))))
        placeOfMockThatEnds = std::nullopt;
    if (placeOfMockThatEnds) {
        mock->compiledModuleThatNeverRan = placeOfMockThatEnds;
        mock->testFileOfFirstLoad = testFileOfMockThatEnds;
    } else if (leavesLoadedModuleAlone && loaded.compiledModule) {
        // Until somebody loads this mock it hands on the owner that it found.
        mock->testFileOfFirstLoad = loadedByTestFile;
    }
    if (vm.hasCompiledCode()) {
        static constexpr std::array<ASCIILiteral, 5> calls { "mock.module"_s, "vi.mock"_s, "jest.mock"_s, "vi.doMock"_s, "jest.doMock"_s };
        JSValue factory = mock->factory.get();
        auto counted = placeOfMockThatEnds ? std::optional(JSC::AOT::ModuleID(*placeOfMockThatEnds)) : loaded.compiledModule;
        JSC::AOT::countMockCall(globalObject, counted, loaded.esmNamespace || loaded.commonJSModule ? "the loader holds it"_s : "nothing holds it"_s, calls[static_cast<size_t>(function)], mock->spy ? "spy"_s : !factory ? "no factory"_s
                : factory.isString()                                                                                                                                                                                       ? "a file of __mocks__"_s
                : mock->importsOriginal                                                                                                                                                                                    ? "a factory that takes the original"_s
                                                                                                                                                                                                                           : "a factory"_s);
    }
    // A load that failed has registered the file and never linked it: its entry is stale under `bun test` (findLoadedESModule()), and the eviction that takes it out takes every failed module out too.
    bool hasStaleEntryUnderPlain = failedEntryStaysUnderKey || (loaded.compiledModule && JSC::AOT::wasPulledInByLoadThatFailed(globalObject, *loaded.compiledModule));
    bool isLinkedBelowMocksAlone = false;
    if (loaded.compiledModule && !placeOfMockThatEnds && !loaded.esmNamespace && !loaded.commonJSModule) {
        isLinkedBelowMocksAlone = JSC::AOT::runBodyOfLinkedModuleAheadOfMock(globalObject, *loaded.compiledModule, wasMocked, mock->isOfVitest());
        RETURN_IF_EXCEPTION(scope, {});
    }
    // As under `bun run`, the factory waits for the first import of a module that has not loaded. require() leaves a module under "node:" neither with the loader
    // nor in require.cache: see overridableRequire().
    auto hasLoaded = [&](JSC::AOT::ModuleID module) {
        return !isLinkedBelowMocksAlone && JSC::AOT::hasBegunToLoad(globalObject, module) && (!specifier.startsWith("node:"_s) || JSC::AOT::isHeldForImport(globalObject, module));
    };
    bool liesUnderMockOfPreload = previous && previous->isFromPreload && !isKeyOfPreviousMockEmpty && (leavesLoadedModuleAlone || !previous->lostOriginalsToReset) && (previous->state == JSModuleMock::State::Settled || (!previous->readUninitializedVariable && loaded.compiledModule && JSC::AOT::whoLoaded(globalObject, *loaded.compiledModule) == JSC::AOT::LoadedBy::Preload));
    // Nobody has loaded a file that is being run or waits at an await, yet this test file may be loading it: it is linked under `bun test`, so its entry is not stale and no pass is made.
    bool wasLoadedAheadOfThisTestFile = loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule && !mock->isFromPreload && (!previous || liesUnderMockOfPreload) && hasLoaded(*loaded.compiledModule)
        && !JSC::AOT::hasLeftLoaderInThisTestFile(globalObject, *loaded.compiledModule) && !JSC::AOT::isBeingEvaluated(globalObject, *loaded.compiledModule) && loadedByTestFile != globalObject->onLoadPlugins.testFile && (leavesLoadedModuleAlone || (globalObject->onLoadPlugins.testFile > 1 && !(previous && previous->compiledModuleThatNeverRan && !previous->cameBackAtEndOfMockOfTestFile)));
    // Taken here: `loaded` may name no compiled module any more where the eviction is made.
    auto fileWhoseKeyThisLayingTakesOut = wasLoadedAheadOfThisTestFile && leavesLoadedModuleAlone && !staysTheOriginal ? loaded.compiledModule : std::nullopt;
    // What this test file has linked and nobody has run counts as loaded ahead of it, but `bun test` makes no pass over its loader for it.
    auto ranBy = loaded.compiledModule ? JSC::AOT::whoLoaded(globalObject, *loaded.compiledModule) : JSC::AOT::LoadedBy::Nobody;
    bool ranAheadOfThisTestFile = ranBy == JSC::AOT::LoadedBy::EarlierTestFile || ranBy == JSC::AOT::LoadedBy::Preload;
    // moveLoadedModule() leaves the entry of the root of an import() that failed under its key, where `bun test` takes it for stale and makes the pass.
    bool hasEntryThatFailedUnderPlain = loaded.compiledModule && JSC::AOT::isRootOfImportThatFailed(globalObject, *loaded.compiledModule);
    // evictModulesAndTheirImporters() finds no compiled module with the loader. One that it would have taken out has run, and the mock comes ahead of its next load all the same.
    bool isOutOfLoader = loaded.compiledModule && (waitsBehindMockThatNobodyLoaded || JSC::AOT::wasLetGoByLoader(globalObject, *loaded.compiledModule));
    bool leavesCompiledModuleAlone = (leavesLoadedModuleAlone || isOutOfLoader) && loaded.compiledModule && !placeOfMockThatEnds && !loaded.esmNamespace && !loaded.commonJSModule && hasLoaded(*loaded.compiledModule)
        && JSC::AOT::willLeaveModuleAlone(globalObject, *loaded.compiledModule, !isOutOfLoader && !loadedByTestFile && !staysTheOriginal && !isDoMock, Bun::compiledModuleForPath(callerPath(vm, callframe)), !mock->importsOriginal);
    RETURN_IF_EXCEPTION(scope, {});
    if (leavesCompiledModuleAlone && wasLoadedByImportActual && Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, originalModuleKey(specifier)))) {
        evictModulesAndTheirImporters(globalObject, Vector<String> { originalModuleKey(specifier) });
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (leavesCompiledModuleAlone && !wasLoadedByImportActual && (isDoMock || isInNodeModules(specifier))) {
        JSC::AOT::didSetAsideModuleLeftAlone(globalObject, *loaded.compiledModule, isInNodeModules(specifier));
        bool hasSetFileAside = leavesLoadedModuleAlone && Bun::didSetCompiledFileAside(globalObject, specifier);
        mock->hasSetCompiledModuleAside |= hasSetFileAside;
        if (hasSetFileAside && Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, originalModuleKey(specifier)))) {
            evictModulesAndTheirImporters(globalObject, Vector<String> { originalModuleKey(specifier) });
            RETURN_IF_EXCEPTION(scope, {});
        }
        // It lies under the key of the original now, in place of what lay there. The instance of a preload's mock that had patched the file is the file.
        if (auto* ofPreload = hasSetFileAside ? displacedMockOfPreload(globalObject, specifier) : nullptr; ofPreload && ofPreload->compiledModuleThatNeverRan)
            ofPreload->liesUnderKeyOfOriginal = false;
    }
    auto wait = [&](JSC::AOT::ModuleID form) {
        auto& waiting = globalObject->onLoadPlugins.compiledMocksToRun;
        uint32_t module = form.index();
        waiting.removeAllMatching([&](const auto& entry) { return entry.first == module; });
        waiting.append({ module, JSC::Strong<JSC::JSObject> { vm, mock } });
        JSC::AOT::deferMock(globalObject, form, mock->importsOriginal ? JSC::AOT::AfterFailure::AsksAgain : JSC::AOT::AfterFailure::KeepsError);
    };
    bool formsWait = false;
    if (vm.hasCompiledCode() && !loaded.compiledModule && !loaded.esmNamespace && !loaded.commonJSModule) {
        auto forms = JSC::AOT::formsThatAttributesAskFor(globalObject, specifier);
        if (auto file = Bun::moduleThatMockReplaces(specifier); file && !forms.contains(*file))
            forms.append(*file);
        if (std::ranges::count_if(forms, [&](JSC::AOT::ModuleID form) { return JSC::AOT::hasBegunToLoad(globalObject, form); }) > 1) {
            for (JSC::AOT::ModuleID form : forms) {
                JSC::AOT::willLeaveModuleAlone(globalObject, form, false, Bun::compiledModuleForPath(callerPath(vm, callframe)));
                RETURN_IF_EXCEPTION(scope, {});
                wait(form);
                RETURN_IF_EXCEPTION(scope, {});
            }
            formsWait = true;
            // Under `bun test` an entry registered under several import types is stale (findLoadedESModule()), and the eviction that takes it out takes every failed module out too.
            // What require() alone has loaded is not registered with the loader.
            // So does the eviction of what an earlier test file or a preload has loaded: see wasLoadedByEarlierTestFile below.
            bool wasSomeFormLoadedAheadOfThisTestFile = !mock->isFromPreload && (!previous || previous->isFromPreload) && globalObject->onLoadPlugins.testFile > 1
                && std::ranges::any_of(forms, [&](JSC::AOT::ModuleID form) { return JSC::AOT::hasBegunToLoad(globalObject, form) && JSC::AOT::wasLoadedAheadOfThisTestFile(globalObject, form); });
            bool hasStaleEntry = std::ranges::count_if(forms, [&](JSC::AOT::ModuleID form) { return JSC::AOT::hasBegunToLoad(globalObject, form) && (JSC::AOT::isHeldForImport(globalObject, form) || JSC::AOT::wasLoadedByImport(globalObject, form)); }) > 1;
            if (wasSomeFormLoadedAheadOfThisTestFile || hasStaleEntry) {
                forgetFailuresKeptByCompiledProgram(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                // That eviction takes the key out unless the mock patches what lies under it: whoever loads a form from here on is this test file.
                if ((leavesLoadedModuleAlone && (isDoMock || staysTheOriginal)) || hasStaleEntry) {
                    for (JSC::AOT::ModuleID form : forms)
                        JSC::AOT::didLeaveLoaderInThisTestFile(globalObject, form);
                }
            }
        }
    }
    // A standing mock (a preload's, say) keeps what was loaded under it; the new factory waits for the next load.
    bool waitsOverStandingMock = leavesLoadedModuleAlone && loaded.compiledModule && !placeOfMockThatEnds && !loaded.esmNamespace && !loaded.commonJSModule && hasLoaded(*loaded.compiledModule)
        && JSC::AOT::willLeaveStandingMockAlone(globalObject, *loaded.compiledModule, staysTheOriginal && !isKeyOfPreviousMockEmpty, isDoMock && !loadedByTestFile);
    // This mock's original is what was loaded under the standing mock; a spy uses the real file.
    if (waitsOverStandingMock && !mock->spy) {
        auto kept = JSC::AOT::loadedUnderStandingMockThatImportersKeep(globalObject, *loaded.compiledModule);
        RETURN_IF_EXCEPTION(scope, {});
        mock->originalNamespace.setMayBeNull(vm, mock, kept.namespaceObject);
        if (kept.requiredValue)
            mock->originalCommonJSExports.set(vm, mock, kept.requiredValue);
    }
    bool takesPlaceAtNextLoad = placeOfMockThatEnds && mock->importsOriginal && mock->factory.get() && JSC::AOT::haveLoadsInFlightTakenAnswerThatStandsOn(globalObject, JSC::AOT::ModuleID(*placeOfMockThatEnds));
    if (loaded.compiledModule && !mock->wasLaidOverFailedLoad && (!placeOfMockThatEnds || takesPlaceAtNextLoad) && !loaded.esmNamespace && !loaded.commonJSModule && (takesPlaceAtNextLoad || leavesCompiledModuleAlone || waitsOverStandingMock || earlierMockStillWaits || !hasLoaded(*loaded.compiledModule))) {
        wait(*loaded.compiledModule);
        RETURN_IF_EXCEPTION(scope, {});
        for (JSC::AOT::ModuleID form : JSC::AOT::formsThatAttributesAskFor(globalObject, specifier)) {
            wait(form);
            RETURN_IF_EXCEPTION(scope, {});
        }
        // A pending load was given the module ahead of any mock: to that load the record stays the module itself, as under `bun test`. The mock is for whoever asks later.
        if (!wasMocked && isGivenToPendingLoad(globalObject, specifier))
            JSC::AOT::letLoadsInFlightKeepRecordOf(globalObject, *loaded.compiledModule);
        loaded.compiledModule = std::nullopt;
        formsWait = true;
    }
#endif

    JSC::JSPromise* pendingFactory = nullptr;
    // False once the factory itself has re-mocked or unmocked the module, which wins.
    bool isCurrent = true;
    if (loaded.esmNamespace || loaded.compiledModule || loaded.commonJSModule) {
#if ENABLE(AOT)
        pendingFactory = mock->run(globalObject, placeOfMockThatEnds && !mock->factory.get());
#else
        pendingFactory = mock->run(globalObject, false);
#endif
        // As in Vitest and Jest, a hoisted factory that reads a variable declared below the call waits for the first import.
#if ENABLE(AOT)
        // A compiled module that has run, or on which a mock stands, stays as it is, and the loader comes to the mock at its next load.
        bool compiledModuleWaits = scope.exception() && mock->readUninitializedVariable && loaded.compiledModule && !placeOfMockThatEnds;
        JSC::Exception* thrownByFactory = compiledModuleWaits ? scope.exception() : nullptr;
        if (compiledModuleWaits && scope.tryClearException()) [[unlikely]] {
            JSC::AOT::ModuleID compiled = *loaded.compiledModule;
            bool staysAsItIs = JSC::AOT::willLeaveModuleAlone(globalObject, compiled, false, Bun::compiledModuleForPath(callerPath(vm, callframe)), true);
            RETURN_IF_EXCEPTION(scope, {});
            if (!staysAsItIs && JSC::AOT::willLeaveStandingMockAlone(globalObject, compiled, staysTheOriginal, isDoMock && !loadedByTestFile)) {
                mock->leavesStandingMockToItsImporters = true;
                staysAsItIs = true;
            }
            if (!staysAsItIs) {
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
            for (JSC::AOT::ModuleID form : JSC::AOT::formsThatAttributesAskFor(globalObject, specifier)) {
                wait(form);
                RETURN_IF_EXCEPTION(scope, {});
            }
            loaded.compiledModule = std::nullopt;
            formsWait = true;
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
            bodyYetToRun = nullptr;
        }
        RETURN_IF_EXCEPTION(scope, {});
    }
#if ENABLE(AOT)
    if (mock->wasLaidOverFailedLoad && loaded.compiledModule) {
        isCurrent = isStillRegisteredModuleMock(globalObject, specifier, previous);
        if (isCurrent) {
            wait(*loaded.compiledModule);
            RETURN_IF_EXCEPTION(scope, {});
            for (JSC::AOT::ModuleID form : JSC::AOT::formsThatAttributesAskFor(globalObject, specifier)) {
                wait(form);
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
        if (loaded.compiledModule && !mock->testFileOfFirstLoad && Bun::isBunTest && !mock->isFromPreload)
            mock->testFileOfFirstLoad = globalObject->onLoadPlugins.testFile;
#endif
    }
    // Its functions are the mock's from here on. What the body assigns is the mock's once it is patched again.
    if (bodyYetToRun && isCurrent)
        pendingFactory = thenWithContext(globalObject, bodyYetToRun, jsFunctionBodyOfPatchedModuleDidRun, nullptr, mock);

    auto& plugins = globalObject->onLoadPlugins;
    if (isCurrent) {
        plugins.addModuleMock(vm, specifier, mock);
#if ENABLE(AOT)
        for (auto& factory : plugins.factoriesOfCompiledMocks.span().subspan(plugins.numberOfFactoriesSetAside)) {
            auto* earlier = uncheckedDowncast<JSModuleMock>(factory.mock.get());
            if (earlier->keepsFailureForImports && earlier->specifier->tryGetValue().data == specifier)
                earlier->forgetFailureKeptForImports();
        }
        // A require() cannot wait for the factory of a mock that patches either. While it is pending over a mock that stands in place, loads come to runCompiledMock().
        if (pendingFactory && hasPendingFactory(mock) && !leavesLoadedModuleAlone && !isBuiltinModuleKey(specifier) && loaded.compiledModule && !JSC::AOT::isESModule(*loaded.compiledModule) && JSC::AOT::hasMockInPlace(globalObject, *loaded.compiledModule)) {
            wait(*loaded.compiledModule);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (previous && !mock->wasLaidOverFailedLoad)
            globalObject->onLoadPlugins.compiledMocksToRun.removeAllMatching([&](const auto& waiting) { return waiting.second.get() == previous; });
        if (vm.hasCompiledCode() && !formsWait && !placeOfMockThatEnds && mock->factory.get()) {
            for (JSC::AOT::ModuleID form : JSC::AOT::formsThatAttributesAskFor(globalObject, specifier)) {
                if (JSC::AOT::hasBegunToLoad(globalObject, form))
                    continue;
                wait(form);
                RETURN_IF_EXCEPTION(scope, {});
            }
        }
#endif
        if (previous && isLoadInFlight)
            keepModuleMockOfLoadInFlight(globalObject, previous, specifier, loaded);
        if (previous && previous->isFromPreload && !mock->isFromPreload) {
            plugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, previous });
#if ENABLE(AOT)
            previous->isDisplacedByMockOfTestFile = true;
            mock->wasLaidOverMockOfPreload = true;
            // Under `bun test` nothing is registered behind the end of the mock that had displaced it: a mock that patches saves the CommonJS module that came back, and its end restores it.
            // It patches what lies in the require map. What import() or a statement has loaded of the preload's mock lies in the loader's registry: nothing is patched, and the end restores nothing.
            auto file = Bun::compiledModuleForPath(specifier);
            mock->hasSetMockOfPreloadAside = leavesLoadedModuleAlone && staysTheOriginal && !isKeyOfPreviousMockEmpty;
            mock->patchesMockOfPreload = !leavesLoadedModuleAlone && previous->cameBackAtEndOfMockOfTestFile && file && !JSC::AOT::isESModule(*file) && !(previous->compiledModuleThatNeverRan && !JSC::AOT::wasRequiredUnderMockLaidInPreload(globalObject, *file));
            previous->liesUnderKeyOfOriginal |= mock->hasSetMockOfPreloadAside;
            previous->cameBackAtEndOfMockOfTestFile = false;
#endif
        }
#if ENABLE(AOT)
        // Under `bun test` the one that came back never left the list: at the end of the test file it is added over what a hook of the preload lays here.
        if (previous && previous->isFromPreload && mock->isFromPreload && std::exchange(previous->cameBackAtEndOfMockOfTestFile, false))
            plugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, previous });
#endif

        bool wasLoadedByEarlierTestFile = (mock->originalExports || mock->originalCommonJSExports) && !mock->isFromPreload && (!previous || previous->isFromPreload) && plugins.testFile > 1 && plugins.testFileOfModule.get(specifier) != plugins.testFile;
#if ENABLE(AOT)
        loaded.staleESMEntry |= loadFailedUnderMockThatIsDisplaced;
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
        if ((wasLoadedAheadOfThisTestFile && (previous || ranAheadOfThisTestFile || hasEntryThatFailedUnderPlain)) || hasStaleEntryUnderPlain) {
            forgetFailuresKeptByCompiledProgram(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            // That eviction takes the key itself out where the mock neither patches what lies under it nor sets it aside, to bring it back at its end. From there on `bun test` finds nothing
            // under it, or what this test file has fetched: either way no later mock of this test file makes the eviction of what an earlier one has loaded.
            if (fileWhoseKeyThisLayingTakesOut)
                JSC::AOT::didLeaveLoaderInThisTestFile(globalObject, *fileWhoseKeyThisLayingTakesOut);
            // The loader holds no compiled file, but it may hold what it made of the text of a file that imports one: code from disk, or a compiled file that was loaded a second time.
            // The pass also takes out whatever failed, so it is made only where `bun test` makes one of its own: an earlier test file or a preload has run the module.
            if (!previous && (ranAheadOfThisTestFile || hasEntryThatFailedUnderPlain)) {
                ModulesToEvict evict;
                evict.keepsFailuresOfCompiledProgram = true;
                evict.onlyImportersFromEarlierTestFiles = true;
                if (mock->isOfVitest() && !staysTheOriginal)
                    evict.modules.append(specifier);
                else
                    evict.patchedESModules.append(specifier);
                evictModulesAndTheirImporters(globalObject, WTF::move(evict));
                RETURN_IF_EXCEPTION(scope, {});
            }
        }
#endif
    }

    JSObject* returned = nullptr;
    if (pendingFactory && isCurrent)
        returned = patchWhenFactorySettles(globalObject, mock, pendingFactory);
#if ENABLE(AOT)
    // fileOfFunction() reads an executable, and a compiled function has none: the build knows where it is written. Only here, where this call has called the factory:
    // where a load calls it, the run time asks the loader for the key behind that call, and the load itself would be taken for the factory's file asking.
    // Empty for an automock.
    if (JSObject* factory = pendingFactory && isCurrent && vm.hasCompiledCode() && mock->factory ? mock->factory.get().getObject() : nullptr; factory && JSC::AOT::CompiledCallee::isCompiledCallee(factory)) {
        for (auto& running : plugins.runningModuleMocks) {
            if (running.mock.get() == mock)
                running.file = JSC::AOT::pathOfFileThatDeclares(factory);
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
// A load that comes to the file makes the call again, and so does one that comes to a body that ran then and imports the file. No statement need lead from such a body to the file.
static void letMockWaitForLoads(Zig::GlobalObject* globalObject, const BunPlugin::OnLoad::MockLaidByBody& laid, bool waits)
{
    JSC::AOT::layMocksAgainAtNextLoad(globalObject, JSC::AOT::ModuleID(laid.module), waits);
    for (uint32_t importer : laid.importers)
        JSC::AOT::layMocksAgainAtNextLoad(globalObject, JSC::AOT::ModuleID(importer), waits);
}

bool layMocksOfBodiesAgain(Zig::GlobalObject* globalObject, const WTF::ScopedLambda<bool(JSC::AOT::ModuleID)>& isReached)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& plugins = globalObject->onLoadPlugins;
    static constexpr std::array<JSC::NativeFunction::Ptr, 5> functions { JSMock__jsModuleMock, jsFunctionViMock, jsFunctionJestMock, jsFunctionViDoMock, jsFunctionJestDoMock };
    static_assert(functions.size() == static_cast<size_t>(ModuleMockFunction::JestDoMock) + 1);
    bool laidSome = false;
    for (size_t index = 0; index < plugins.mocksLaidByBodies.size(); ++index) {
        auto isReachedByNumber = [&](uint32_t module) { return isReached(JSC::AOT::ModuleID(module)); };
        auto laidMockItself = [&](uint32_t importer) {
            return isReachedByNumber(importer) && plugins.modulesThatLaidMocksInBodies.contains(importer);
        };
        const auto& laid = plugins.mocksLaidByBodies[index];
        if (!laid.waits || (!(laid.isOfOwnBody && isReachedByNumber(laid.module)) && !laid.importers.containsIf(isReachedByNumber) && !laid.importersByCall.containsIf(laidMockItself)))
            continue;
        plugins.mocksLaidByBodies[index].waits = false;
        letMockWaitForLoads(globalObject, plugins.mocksLaidByBodies[index], false);
        JSC::MarkedArgumentBuffer arguments;
        for (auto& argument : plugins.mocksLaidByBodies[index].arguments)
            arguments.append(argument.get());
        JSC::JSFunction* function = JSC::JSFunction::create(vm, globalObject, 2, String(), functions[plugins.mocksLaidByBodies[index].function], ImplementationVisibility::Private);
        SetForScope caller(plugins.callerOfMocksLaidAgain, plugins.mocksLaidByBodies[index].file);
        SetForScope<const void*> frame(plugins.frameOfMockLaidAgain, nullptr);
        JSC::Exception* thrown = nullptr;
        {
            auto catching = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            JSC::call(globalObject, function, JSC::getCallData(function), jsUndefined(), arguments);
            thrown = catching.exception();
            if (thrown && !catching.tryClearException()) [[unlikely]]
                return laidSome;
        }
        // What the body caught is caught here: the calls behind it are made, and the load goes on.
        if (thrown && !plugins.mocksLaidByBodies[index].threw) [[unlikely]] {
            throwException(globalObject, scope, thrown);
            return laidSome;
        }
        laidSome = true;
    }
    // A body that is done with one call may be the way to another that still waits.
    for (size_t index = 0; laidSome && index < plugins.mocksLaidByBodies.size(); ++index) {
        if (plugins.mocksLaidByBodies[index].waits)
            letMockWaitForLoads(globalObject, plugins.mocksLaidByBodies[index], true);
    }
    return laidSome;
}
#endif

#if ENABLE(AOT)
// The mocks of the test file that ends are undone. What a compiled module's body laid is laid again for the next test file that imports the module.
static void layMocksOfBodiesAgainAtNextLoad(Zig::GlobalObject* globalObject, const WTF::UncheckedKeyHashSet<String>& modulesThatMocked, const String& testFile)
{
    auto& laid = globalObject->onLoadPlugins.mocksLaidByBodies;
    std::optional<JSC::AOT::ModuleID> moduleOfTestFile = Bun::compiledModuleForPath(testFile);
    laid.removeAllMatching([&](auto& each) {
        if (moduleOfTestFile) {
            each.importers.removeAll(moduleOfTestFile->index());
            each.importersByCall.removeAll(moduleOfTestFile->index());
        }
        return each.file == testFile || (!each.isOfOwnBody && each.importers.isEmpty() && each.importersByCall.isEmpty());
    });
    auto& modules = globalObject->onLoadPlugins.modulesThatLaidMocksInBodies;
    modules.removeAllMatching([&](uint32_t module) { return !laid.containsIf([&](const auto& each) { return each.module == module; }); });
    for (auto& each : laid) {
        if (!modulesThatMocked.contains(each.file))
            continue;
        each.waits = true;
        letMockWaitForLoads(globalObject, each, true);
    }
}
#endif

#if ENABLE(AOT)
static void displaceMockOfPreloadAgain(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    mock->isDisplacedByMockOfTestFile = true;
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
        // Under `bun test` it stays displaced until the end of the test file: nothing is registered here.
        if (mock->cameBackAtEndOfMockOfTestFile)
            return JSValue::encode(returned);
#endif
        if (mock->isFromPreload && !JSMock__isInPreload(globalObject))
            globalObject->onLoadPlugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, mock });
        unmockModule(globalObject, mock, specifier.key);
        RETURN_IF_EXCEPTION(scope, {});
#if ENABLE(AOT)
        didEndMockLaidOverMockOfPreload(globalObject, mock, specifier.key);
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

    if (JSModuleMock* mock = registeredModuleMock(globalObject, specifier.key))
        RELEASE_AND_RETURN(scope, JSValue::encode(importOriginalModule(globalObject, mock, true, callerPath(vm, callframe))));
#if ENABLE(AOT)
    if (JSValue kept = failureKeptForImportsOf(globalObject, specifier.key))
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSPromise::rejectedPromise(globalObject, kept)));
#endif

    LoadedModule loaded = findLoadedModule(globalObject, specifier.keyString);
    RETURN_IF_EXCEPTION(scope, {});
    // What a preload loads is given back to the next test file under its own key.
    if (!loaded.esmNamespace && !loaded.commonJSModule && !loaded.staleESMEntry && !loaded.staleCommonJSEntry && !JSMock__isInPreload(globalObject))
        globalObject->onLoadPlugins.loadedByImportActual.add(specifier.key);
#if ENABLE(AOT)
    if (auto asked = vm.hasCompiledCode() && Bun::isBunTest ? Bun::compiledModuleForPath(specifier.key) : std::nullopt; asked && !JSC::AOT::hasBegunToLoad(globalObject, *asked)) {
        BunPlugin::OnLoad::RunningModuleMock* asking = nullptr;
        for (JSObject* factory : factoriesInAsyncContext(globalObject)) {
            auto* mock = uncheckedDowncast<JSModuleMock>(factory);
            if (!asking && mock->compiledModuleThatNeverRan && JSC::AOT::loadLeadsTo(globalObject, *asked, JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan)))
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
    std::optional<SetForScope<JSC::CallFrame*>> callAsksLoaderForImport;
    if (vm.hasCompiledCode() && factoriesInAsyncContext(globalObject).isEmpty())
        callAsksLoaderForImport.emplace(vm.aotState().frameOfImportThatAsksLoader, vm.topCallFrame);
#endif
    RELEASE_AND_RETURN(scope, JSValue::encode(importModuleFrom(globalObject, callerPath(vm, callframe), specifier.key)));
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
        JSC::AOT::AskerOfModule asker(globalObject, Bun::askerOfImportCallInCodeThatIsNotCompiled(from));
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
            if (!stored.isUndefined() || !JSC::AOT::isEvictedFile(globalObject, *file))
                mock->lostCommonJSExportsToReset = true;
        }
    }
    Bun::willResetModules(globalObject, callFactoriesAgain ? "jest.resetModules()"_s : "vi.resetModules()"_s, evict.exceptPackages);
    RETURN_IF_EXCEPTION(scope, {});
    globalObject->onLoadPlugins.compiledImportersLinkedAheadOfMocks.removeAllMatching([&](const auto& linked) { return !evict.exceptPackages || !isInNodeModules(linked.importer); });
    forEachMockOfPreload(globalObject, [&](JSModuleMock* mock) {
        if (mock->liesUnderKeyOfOriginal && !(evict.exceptPackages && isInNodeModules(mock->specifier->tryGetValue().data)))
            mock->liesThereBehindReset = std::exchange(mock->liesUnderKeyOfOriginal, false);
    });
    // So does what had come back under the key itself, but for a package where the reset keeps packages. Under `bun test` nothing is registered behind the end that brought it back: the preload's mock stays displaced until the end of the test file.
    MarkedArgumentBuffer mocksOfPreloadsThatCameBack;
    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules) {
        for (auto& value : virtualModules->values()) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            bool isOfPackage = mock && isInNodeModules(mock->specifier->tryGetValue().data);
            if (!mock || (evict.exceptPackages && isOfPackage))
                continue;
            mock->lostOriginalsToReset = true;
            if (!isOfPackage) {
                mock->patchesMockOfPreload = false;
                if (auto file = mock->isFromPreload ? Bun::compiledModuleForPath(mock->specifier->tryGetValue().data) : std::nullopt)
                    JSC::AOT::didEmptyKeyOfMockInPlace(globalObject, *file);
            }
            if (std::exchange(mock->cameBackAtEndOfMockOfTestFile, false))
                mocksOfPreloadsThatCameBack.append(mock);
        }
    }
    for (size_t i = 0; i < mocksOfPreloadsThatCameBack.size(); ++i) {
        displaceMockOfPreloadAgain(globalObject, uncheckedDowncast<JSModuleMock>(mocksOfPreloadsThatCameBack.at(i)));
        RETURN_IF_EXCEPTION(scope, {});
    }
    for (auto& factory : globalObject->onLoadPlugins.factoriesOfCompiledMocks)
        uncheckedDowncast<JSModuleMock>(factory.mock.get())->forgetFailureKeptForImports();
#endif
    evictModulesAndTheirImporters(globalObject, WTF::move(evict));
    RETURN_IF_EXCEPTION(scope, {});
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
            for (auto& waiting : globalObject->onLoadPlugins.compiledMocksToRun) {
                if (waiting.second.get() != mock)
                    continue;
                again->compiledModuleThatNeverRan = mock->compiledModuleThatNeverRan;
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
    bringBackFactoriesSetAside(globalObject, mock);
#endif

    specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    return isRegisteredModuleMock(globalObject, mock, specifier);
}

#if ENABLE(AOT)
static bool isGoneWhileLoadsWaitForFactory(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier)
{
    if (!mock->compiledModuleThatNeverRan || mock->endedAheadOfItsOriginal || JSC::AOT::hasBegunToLoad(globalObject, JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan)))
        return false;
    auto* later = registeredModuleMock(globalObject, specifier);
    bool isWaitedForByImporter = globalObject->onLoadPlugins.factoriesOfCompiledMocks.containsIf([&](const auto& factory) { return factory.mock.get() == mock && factory.isWaitedForByImporter; });
    if (later && ((mock->state == JSModuleMock::State::Settled && !isWaitedForByImporter && JSC::AOT::isImportHeld(globalObject, JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan))) || !globalObject->onLoadPlugins.compiledMocksToRun.containsIf([&](const auto& waiting) { return waiting.second.get() == later; })))
        return false;
    return globalObject->onLoadPlugins.factoriesOfCompiledMocks.containsIf([&](const auto& factory) { return factory.mock.get() == mock && (factory.isWaitedFor || !factory.wasStartedByRequire); });
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

extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__forgetPendingModulePatchesOfVitest(Zig::GlobalObject* globalObject)
{
    forEachPendingModulePatch(globalObject, [](JSModuleMock* mock) { mock->hasPendingPatch = !mock->isOfVitest(); });
}

__attribute__((minsize)) static void giveBackPreloadModules(Zig::GlobalObject* globalObject)
{
    auto& plugins = globalObject->onLoadPlugins;
#if ENABLE(AOT)
    if (Bun::hasCompiledModules()) {
        // No throw scope: one that ends asks whoever comes next for a check, and that is the scope below.
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(JSC::getVM(globalObject));
        Vector<String> compiledFiles = Bun::bringBackFilesOfPreloads(globalObject);
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
    Vector<String> loadedInTheirPlace = keys;
    evictModulesAndTheirImporters(globalObject, WTF::move(loadedInTheirPlace));
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

// Comes behind the preloads and in front of the load of each test file, the first too: what compiled code has loaded before the first call counts as loaded by a preload.
extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__didBeginTestFile(Zig::GlobalObject* globalObject)
{
#if ENABLE(AOT)
    if (globalObject->vm().hasCompiledCode()) {
        Bun::forgetAnswersKeptForLoader(globalObject);
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
        Bun::forgetAnswersKeptForLoader(globalObject);
        JSC::AOT::didBeginTestFile(globalObject);
    }
#endif
    plugins.loadedByImportActual.clear();
    ModulesToEvict evict;
#if ENABLE(AOT)
    plugins.fetchesThatStandForWaitingMocks.clear();
    plugins.compiledFetchesHeldBehindFactories.clear();
    plugins.compiledImportersLinkedAheadOfMocks.clear();
    for (auto& factory : plugins.factoriesOfCompiledMocks)
        uncheckedDowncast<JSModuleMock>(factory.mock.get())->forgetFailureKeptForImports();
#endif
    for (auto& waiting : std::exchange(plugins.waitingModuleMocks, {}))
        evict.abandonedModules.append(uncheckedDowncast<JSModuleMock>(waiting.mock.get())->specifier->tryGetValue().data);
    plugins.moduleMocksWithTurn.clear();
    plugins.modulesGivenTimeToRequestImports.clear();
    plugins.modulesAskedFor.clear();
    plugins.fetchesOfModulesAskedFor.clear();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    while (!plugins.runningModuleMocks.isEmpty()) {
        auto* mock = uncheckedDowncast<JSModuleMock>(plugins.runningModuleMocks.last().mock.get());
        evict.abandonedModules.append(mock->specifier->tryGetValue().data);
#if ENABLE(AOT)
        // Under `bun test` whoever imports a module whose own body is under way joins that evaluation: a mock that ends meanwhile holds nobody up, and the import gets what the module is when the body ends.
        JSC::JSPromise* bodyOfModuleItself = vm.hasCompiledCode() && mock->importsOriginal ? evaluationOfCompiledModuleThatMockLeftAlone(globalObject, mock) : nullptr;
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
        auto* heldUp = bodyOfModuleItself && mock->state == JSModuleMock::State::Running && mock->result ? dynamicDowncast<JSC::JSPromise>(mock->result.get()) : nullptr;
        if (heldUp) {
            JSC::JSFunction* didEnd = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionBodyThatAbandonedModuleMockWaitedForDidEnd, ImplementationVisibility::Private);
            bodyOfModuleItself->performPromiseThenWithContext(vm, globalObject, didEnd, didEnd, jsUndefined(), moduleMockWith(globalObject, mock, heldUp));
        }
#endif
        mock->abandon(globalObject);
#if ENABLE(AOT)
        bool wasCalledByLoad = plugins.factoriesOfCompiledMocks.removeAllMatching([&](const auto& factory) { return factory.mock.get() == mock; });
        if (wasCalledByLoad && mock->compiledModuleThatNeverRan && isRegisteredModuleMock(globalObject, mock, mock->specifier->tryGetValue().data))
            waitForNextLoadOfCompiledModule(globalObject, mock, mock->importsOriginal ? JSC::AOT::AfterFailure::AsksAgain : JSC::AOT::AfterFailure::KeepsError);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
#endif
    }
    if (!nextLoadSharesModules)
        return;

    MarkedArgumentBuffer mocks;
#if ENABLE(AOT)
    MarkedArgumentBuffer mocksOfPreloadsThatCameBack;
#endif
    if (plugins.virtualModules) {
        for (auto& value : plugins.virtualModules->values()) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            if (mock && !mock->isFromPreload)
                mocks.append(mock);
#if ENABLE(AOT)
            else if (mock && std::exchange(mock->cameBackAtEndOfMockOfTestFile, false))
                mocksOfPreloadsThatCameBack.append(mock);
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
    Vector<std::tuple<String, bool, bool, bool>, 4> compiledFilesOfMocksThatEnd;
    // What `bun test` leaves under its key at the end of the file: what a mock had set aside comes back behind the evictions, and what it had patched is not evicted.
    Vector<String, 4> compiledFilesThatStayLoaded;
    // giveBackPreloadModules() comes in front of the moves that the ends below ask for.
    forEachMockOfPreload(globalObject, [](JSModuleMock* mock) { mock->liesUnderKeyOfOriginal |= std::exchange(mock->liesThereBehindReset, false); });
#endif
    for (auto* mock : lastPatchFirst) {
#if ENABLE(AOT)
        JSModuleMock* mockOfPreloadThatComesBack = nullptr;
        if (vm.hasCompiledCode()) {
            String key = mock->specifier->tryGetValue().data;
            bool bringsBack = bringsBackCompiledFile(mock, key);
            auto patched = bringsBack ? std::nullopt : Bun::compiledModuleForPath(key);
            // `bun test` saves what a mock patches at the call. Compiled code holds nothing of such a mock until its factory has settled.
            bool waitsForFactoryToPatch = patched && JSC::AOT::isEvaluatedFile(globalObject, *patched) && !JSC::AOT::hasMockInPlace(globalObject, *patched) && !JSC::AOT::hasMockThatWaitsOrRuns(globalObject, *patched) && !JSC::AOT::isLeftAloneByMock(globalObject, *patched);
            mockOfPreloadThatComesBack = mockOfPreloadThatEndBringsBack(globalObject, mock, key);
            if (bringsBack || mockOfPreloadThatComesBack || waitsForFactoryToPatch || (patched && JSC::AOT::hasMockLaidOver(globalObject, *patched)))
                compiledFilesThatStayLoaded.append(key);
            compiledFilesOfMocksThatEnd.append({ key, Bun::willUnmockCompiledFile(globalObject, key, bringsBack, false), bringsBack, mock->state == JSModuleMock::State::Running });
        }
#endif
        unmockModule(globalObject, mock, mock->specifier->tryGetValue().data, evict);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
#if ENABLE(AOT)
        if (mockOfPreloadThatComesBack)
            mockOfPreloadThatComesBack->liesUnderKeyOfOriginal = false;
#endif
    }

#if ENABLE(AOT)
    for (size_t i = 0; i < mocksOfPreloadsThatCameBack.size(); ++i) {
        auto* mock = uncheckedDowncast<JSModuleMock>(mocksOfPreloadsThatCameBack.at(i));
        String key = mock->specifier->tryGetValue().data;
        auto compiled = JSC::AOT::formThatMockFinds(globalObject, key, Bun::moduleThatMockReplaces(key));
        // What a factory that ended its own mock returned was put in place behind the moment at which this one came back.
        if (compiled && mock->compiledModuleThatNeverRan && mock->state == JSModuleMock::State::Settled) {
            LoadedModule inPlace;
            inPlace.compiledModule = JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan);
            overrideLoadedModuleExports(globalObject, mock, inPlace);
            if (scope.exception()) [[unlikely]]
                (void)scope.tryClearException();
        }
        // One that had patched a module that had run stays in require.cache. Of a compiled module it holds no originals: it stands in place of no body that never ran.
        if (!compiled || !mock->testFileOfFirstLoad || !mock->compiledModuleThatNeverRan || compiledFilesThatStayLoaded.contains(key) || mock->originalExports || mock->originalCommonJSExports)
            continue;
        mock->testFileOfFirstLoad = 0;
        JSC::AOT::didEmptyKeyOfMockInPlace(globalObject, *compiled);
    }
    if (globalObject->vm().hasCompiledCode())
        JSC::AOT::letGoOfMocksThatEnded(globalObject);
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
        plugins.addModuleMock(vm, specifier, mock);
#if ENABLE(AOT)
        mock->isDetached = false;
        bringBackFactoriesSetAside(globalObject, mock);
        // What the preload has linked to a mock that stood in place of a compiled module reads it there, and loads nothing again.
        auto compiled = globalObject->vm().hasCompiledCode() ? JSC::AOT::formThatMockFinds(globalObject, specifier, Bun::moduleThatMockReplaces(specifier)) : std::nullopt;
        // Behind a mock that the test file had laid over it the next test file begins with the preload's mock, whatever the program stored under the file's own key or took out of it: nothing else comes back there,
        // and what the program stored is no module of the preload's that the eviction below would keep for the next test file.
        if (std::exchange(mock->isDisplacedByMockOfTestFile, false)) {
            compiledFilesOfMocksThatEnd.removeAllMatching([&](const auto& ended) { return std::get<0>(ended) == specifier; });
            if (compiled && JSC::AOT::isEvictedFile(globalObject, *compiled)) {
                JSC__JSMap__remove(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(mock->specifier.get()));
                if (scope.exception()) [[unlikely]]
                    (void)scope.tryClearException();
            }
        }
        bool wasLaidOverCompiledModule = compiled && JSC::AOT::hasBegunToLoad(globalObject, *compiled) && !JSC::AOT::isEvictedFile(globalObject, *compiled);
        // Nobody had asked for the preload's mock, and the module itself has run meanwhile. The eviction below empties its key under `bun test`: the factory waits over it for the next test file's load.
        bool waitsOverModuleThatHasRun = wasLaidOverCompiledModule && mock->state == JSModuleMock::State::NotCalled && !compiledFilesThatStayLoaded.contains(specifier) && JSC::AOT::willLeaveModuleAlone(globalObject, *compiled, false, std::nullopt, !mock->importsOriginal);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
        if ((mock->compiledModuleThatNeverRan || wasLaidOverCompiledModule) && mock->state == JSModuleMock::State::Settled) {
            LoadedModule inPlace;
            inPlace.compiledModule = mock->compiledModuleThatNeverRan ? JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan) : *compiled;
            overrideLoadedModuleExports(globalObject, mock, inPlace);
            if (scope.exception()) [[unlikely]]
                (void)scope.tryClearException();
        } else if (compiled && (!JSC::AOT::hasBegunToLoad(globalObject, *compiled) || waitsOverModuleThatHasRun)) {
            auto wait = [&](JSC::AOT::ModuleID form) {
                plugins.compiledMocksToRun.removeAllMatching([&](const auto& entry) { return entry.first == form.index(); });
                plugins.compiledMocksToRun.append({ form.index(), JSC::Strong<JSC::JSObject> { vm, mock } });
                JSC::AOT::deferMock(globalObject, form, mock->importsOriginal ? JSC::AOT::AfterFailure::AsksAgain : JSC::AOT::AfterFailure::KeepsError);
                if (scope.exception()) [[unlikely]]
                    (void)scope.tryClearException();
            };
            wait(*compiled);
            for (JSC::AOT::ModuleID form : JSC::AOT::formsThatAttributesAskFor(globalObject, specifier))
                wait(form);
        }
#endif
        if (!mock->originalExports && !mock->originalCommonJSExports) {
#if ENABLE(AOT)
            // The key is empty from here on: the test file that asks next loads the preload's mock anew and owns it.
            if (compiled && mock->testFileOfFirstLoad && mock->compiledModuleThatNeverRan && !compiledFilesThatStayLoaded.contains(specifier)) {
                mock->testFileOfFirstLoad = 0;
                JSC::AOT::didEmptyKeyOfMockInPlace(globalObject, *compiled);
            }
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
    for (auto& [key, leavesProgram, bringsBack, factoryIsPending] : compiledFilesOfMocksThatEnd) {
        Bun::didUnmockCompiledFile(globalObject, key, leavesProgram, bringsBack, factoryIsPending);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
    }
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
    auto modulesThatMocked = std::exchange(plugins.modulesThatMocked, {});
    if (modulesThatMocked.isEmpty())
        return;
    String testFile = path->toWTFString();
#if ENABLE(AOT)
    if (vm.hasCompiledCode())
        layMocksOfBodiesAgainAtNextLoad(globalObject, modulesThatMocked, testFile);
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
    Vector<String> modulesToRunAgain;
    for (auto& key : modulesThatMocked) {
        if (key != testFile && plugins.testFileOfModule.get(key))
            modulesToRunAgain.append(key);
    }
    evictModulesAndTheirImporters(globalObject, WTF::move(modulesToRunAgain));
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
}

// While this is true, the next test file would pick up this file's still-loading modules and the mocks they imported.
extern "C" [[ZIG_EXPORT(nothrow)]] bool JSMock__hasModulesToEvict(Zig::GlobalObject* globalObject)
{
    return !globalObject->onLoadPlugins.modulesToEvictOnceLoaded.isEmpty();
}

// Under --aot a call of import() that asks for a mocked file waits in the run time for its text, where `bun test` has a read under way. A plain run holds none.
extern "C" [[ZIG_EXPORT(nothrow)]] bool JSMock__hasImportsHeldForMockedFiles(Zig::GlobalObject* globalObject)
{
#if ENABLE(AOT)
    return globalObject->vm().hasCompiledCode() && JSC::AOT::isSomeImportHeldThatAsksForMockOfItsFile(globalObject);
#else
    UNUSED_PARAM(globalObject);
    return false;
#endif
}

#if ENABLE(AOT)
JSC_DECLARE_HOST_FUNCTION(jsFunctionModuleMockGivesFileItself);
JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockGivesFileItself, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSValue importOriginal = callFrame->argument(0);
    return JSValue::encode(JSC::call(globalObject, importOriginal, JSC::getCallData(importOriginal), JSC::jsUndefined(), ArgList()));
}
#endif

// `bun test` undoes the mocks of a test file first and lets the loads in flight end: no factory is called for them and they get the files themselves.
extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__letImportsHeldGetFilesThemselves(Zig::GlobalObject* globalObject)
{
#if ENABLE(AOT)
    auto& vm = JSC::getVM(globalObject);
    JSC::JSFunction* givesFileItself = nullptr;
    JSC::AOT::didFinishTestsOfFile(globalObject);
    for (auto& waiting : globalObject->onLoadPlugins.compiledMocksToRun) {
        auto* mock = dynamicDowncast<JSModuleMock>(waiting.second.get());
        if (!mock || mock->state != JSModuleMock::State::NotCalled || !JSC::AOT::isImportHeldThatAsksForMockOf(globalObject, JSC::AOT::ModuleID(waiting.first)))
            continue;
        // The load in flight of a mock that is a file of a `__mocks__` folder has the name of that file already, and gets it.
        if (JSValue manualMock = mock->factory.get(); manualMock && manualMock.isString())
            continue;
        if (!givesFileItself)
            givesFileItself = JSC::JSFunction::create(vm, globalObject, 1, String(), jsFunctionModuleMockGivesFileItself, ImplementationVisibility::Private);
        mock->factory.set(vm, mock, givesFileItself);
        mock->givesFileItself = true;
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
    // A record that setLoadedModuleAside() moved keeps the key it was loaded with.
    if (auto* original = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, originalModuleKey(specifier))); original && original->record() == dependency->moduleRecord())
        dependencyKey = originalModuleKey(specifier);
    bool isOriginal = isModuleOrCopyOfIt(dependencyKey, originalModuleKey(specifier));

    JSModuleMock* mock = registeredModuleMock(globalObject, specifier);
    if (!mock) {
        UncheckedKeyHashSet<JSObject*> seen;
        bool readsItself = record->liveExportsSource() || readsExportsOfModule(globalObject, dependency, specifier, seen);
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
        } else if (auto* entry = loader->registryEntry(JSC::Identifier::fromString(vm, key)); entry && isBeingFetchedWithoutFactory(globalObject, entry) && (!isInNodeModules(key) || isInNodeModules(target))) {
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
__attribute__((minsize)) static String keyOfModuleThatDoesNotWait(Zig::GlobalObject* globalObject, BunPlugin::OnLoad::RunningModuleMock& running, const String& key, const String& mocked)
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
    visitor.append(mock->originalNamespace);
    visitor.append(mock->patchedNamespace);
    visitor.append(mock->originalExportsOfEvictedModule);
#if ENABLE(AOT)
    visitor.append(mock->errorOfLateFailure);
    visitor.append(mock->errorOwedToImports);
    visitor.append(mock->mockThatStoodAtFailure);
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

EncodedJSValue BunPlugin::OnResolve::run(JSC::JSGlobalObject* globalObject, const BunString* namespaceString, const BunString* path, const BunString* importer)
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

        JSC::JSObject* paramsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
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
        arguments.append(paramsObject);

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
BUN_DEFINE_HOST_FUNCTION(jsFunctionFactoryOfCompiledMockSettled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    uncheckedDowncast<JSC::JSPromise>(callFrame->argument(1))->resolve(globalObject, JSC::getVM(globalObject), callFrame->argument(0));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionDecideWhetherFailureIsKept, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(lexicalGlobalObject));
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* mock = Zig::toModuleMock(globalObject, scope, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    Zig::decideWhetherFailureIsKept(globalObject, mock);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionFactoryOfCompiledMockFailed, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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
    mock->nobodyWaitsForFactory = false;
    // The promise may have been let go for a factory that never answered: then there is nothing that could stand for anybody.
    bool standsForLoadsInFlight = !isCurrent && mock->state == Zig::JSModuleMock::State::Settled && mock->result && Zig::isGoneWhileLoadsWaitForFactory(globalObject, mock, specifier) && !JSC::AOT::standsForLoadsInFlight(globalObject, JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan));
    isCurrent = isCurrent || standsForLoadsInFlight;
#endif
    if (!isCurrent)
        return JSC::JSValue::encode(JSC::jsUndefined());

    Zig::LoadedModule loaded = Zig::findLoadedModule(globalObject, mock->specifier.get());
#if ENABLE(AOT)
    if (mock->compiledModuleThatNeverRan)
        loaded.compiledModule = JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan);
    globalObject->onLoadPlugins.compiledMocksToRun.removeAllMatching([&](const auto& waiting) { return waiting.second.get() == mock && loaded.compiledModule && waiting.first == loaded.compiledModule->index(); });
#endif
    if (!scope.exception()) [[likely]] {
        Zig::keepModuleObjectLeftBehindMock(mock, loaded);
        Zig::overrideLoadedModuleExports(globalObject, mock, loaded);
    }
#if ENABLE(AOT)
    if (standsForLoadsInFlight && !scope.exception())
        JSC::AOT::letMockStandForLoadsInFlight(globalObject, *loaded.compiledModule);
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
    if (!isCurrent && mock->numberOfImportsThatWait) {
        mock->errorOwedToImports.set(vm, mock, callFrame->argument(0));
        mock->numberOfImportsOwedError = std::exchange(mock->numberOfImportsThatWait, 0);
    }
    // A require() could not wait for the factory that it started. Where nobody has come to wait since, the failure is nobody's: it is reported, as under `bun test`.
    auto& factories = globalObject->onLoadPlugins.factoriesOfCompiledMocks;
    size_t started = factories.findIf([&](const auto& factory) { return factory.mock.get() == mock; });
    bool isWaitedForByNobody = std::exchange(mock->nobodyWaitsForFactory, false) && !mock->numberOfImportsThatWait && !mock->numberOfImportsOwedError;
    bool wasCalledByLoad = started != notFound || isWaitedForByNobody;
    if (isWaitedForByNobody && started != notFound)
        factories.removeAt(started);
    if (!isCurrent && isWaitedForByNobody) {
        scope.throwException(globalObject, callFrame->argument(0));
        return {};
    }
#endif
    if (!isCurrent)
        return JSC::JSValue::encode(JSC::jsUndefined());

#if ENABLE(AOT)
    // Nothing of the module has run. As JSC::AOT::AfterFailure::AsksAgain says.
    if (mock->compiledModuleThatNeverRan && mock->importsOriginal) {
        Zig::waitForNextLoadOfCompiledModule(globalObject, mock);
        RETURN_IF_EXCEPTION(scope, {});
        // A call of import that still waits for the text of the file has joined this load under `bun test`: it gets this error, and the factory is not called for it.
        JSC::AOT::didFailFactoryThatTakesOriginal(globalObject, JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan), callFrame->argument(0));
        scope.throwException(globalObject, callFrame->argument(0));
        return {};
    }
    // `bun test` runs such a factory from its loader, at every load: the mock stands on. What the run time keeps of a load that a factory ended, it keeps where the factory fails at once:
    // so whoever waited goes on, asks again, and gets the error from runCompiledMock().
    // Of an ES module or a CommonJS file. The mock of a module of the library, and of a data file, goes other ways.
    // A load has called the factory: runCompiledMock(). Where mock.module() itself has called it, the promise is what the call returned: whoever made the call sees the failure.
    auto isFileOfProgram = [](JSC::AOT::ModuleID module) { return JSC::AOT::isESModule(module) || (!JSC::AOT::isOfLibrary(module) && !JSC::AOT::isDataFile(module)); };
    if (wasCalledByLoad && mock->compiledModuleThatNeverRan && isFileOfProgram(JSC::AOT::ModuleID(*mock->compiledModuleThatNeverRan))) {
        bool isOwedToImports = mock->numberOfImportsThatWait;
        if (isOwedToImports) {
            mock->errorOwedToImports.set(vm, mock, callFrame->argument(0));
            mock->numberOfImportsOwedError = std::exchange(mock->numberOfImportsThatWait, 0);
        }
        if (!isWaitedForByNobody && (!isOwedToImports || (started != notFound && factories[started].isWaitedForByLoadThatRequireLeft)))
            mock->errorOfLateFailure.set(vm, mock, callFrame->argument(0));
        uint32_t module = *mock->compiledModuleThatNeverRan;
        auto& waiting = globalObject->onLoadPlugins.compiledMocksToRun;
        waiting.removeAllMatching([&](const auto& entry) { return entry.first == module; });
        waiting.append({ module, JSC::Strong<JSC::JSObject> { vm, mock } });
        JSC::AOT::letMockWaitBehindLateFailure(globalObject, JSC::AOT::ModuleID(module));
        if (isWaitedForByNobody || (started != notFound && factories[started].isWaitedForByLoadThatRequireLeft && factories[started].cameToFetchInFlight))
            scope.throwException(globalObject, callFrame->argument(0));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
#endif
    scope.release();
    Zig::failPendingModulePatch(globalObject, mock, specifier, callFrame->argument(0));
    return {};
}

extern "C" JSC::EncodedJSValue Bun__runOnResolvePlugins(Zig::GlobalObject* globalObject, const BunString* namespaceString, const BunString* path, const BunString* from)
{
#if ENABLE(AOT)
    bool engineAsks = false;
    if (std::optional<JSC::EncodedJSValue> kept = Bun::takeAnswerKeptForLoader(globalObject, namespaceString, path, from, engineAsks))
        return *kept;
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    JSC::EncodedJSValue answer = globalObject->onResolvePlugins.run(globalObject, namespaceString, path, from);
    JSC::Exception* thrown = scope.exception();
    if (engineAsks) [[unlikely]]
        Bun::keepAnswerForLoader(globalObject, namespaceString, path, from, thrown ? thrown->value() : JSC::JSValue::decode(answer), !!thrown);
    return answer;
#else
    return globalObject->onResolvePlugins.run(globalObject, namespaceString, path, from);
#endif
}

extern "C" bool Bun__hasPlugins(Zig::GlobalObject* globalObject)
{
    return !globalObject->onLoadPlugins.isEmpty() || !globalObject->onResolvePlugins.isEmpty();
}

extern "C" uint8_t Bun__onResolveNamespaces(Zig::GlobalObject* globalObject)
{
#if ENABLE(AOT)
    if (Bun::hasCompiledModules() && Bun::holdsAnswersForLoader()) [[unlikely]]
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
void didDeleteKeyOfModuleMock(Zig::GlobalObject* globalObject, const String& key)
{
    auto* mock = Zig::registeredModuleMock(globalObject, key);
    if (mock && std::exchange(mock->cameBackAtEndOfMockOfTestFile, false))
        Zig::displaceMockOfPreloadAgain(globalObject, mock);
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

static bool hasUncalledFactoryThatAwaits(Zig::JSModuleMock* mock)
{
    if (!mock || mock->state != Zig::JSModuleMock::State::NotCalled)
        return false;
    // Empty for an automock.
    JSValue value = mock->factory.get();
#if ENABLE(AOT)
    // A compiled function has no executable. The build says of it what the parser says below, which says of no async generator that it is without an `await`.
    if (JSObject* compiled = value ? value.getObject() : nullptr; compiled && compiled->vm().hasCompiledCode() && JSC::AOT::CompiledCallee::isCompiledCallee(compiled))
        return JSC::AOT::awaitsByItself(compiled) || JSC::AOT::declaredAs(compiled) == JSC::AOT::DeclaredAs::AsyncGeneratorFunction;
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
    return hasUncalledFactoryThatAwaits(mock);
}

bool canRequireOriginalOfModuleMock(Zig::GlobalObject* globalObject, JSC::JSObject* moduleMock)
{
    auto* mock = dynamicDowncast<Zig::JSModuleMock>(moduleMock);
    if (!hasUncalledFactoryThatAwaits(mock))
        return false;
    // An import of the mock loads what the original imports before it calls a factory that takes the original.
    String key = Zig::originalModuleKey(mock->specifier->tryGetValue().data);
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(globalObject->vm(), key));
    if (!entry)
        return true;
    auto* cyclic = entry->record() ? dynamicDowncast<JSC::CyclicModuleRecord>(entry->record()) : nullptr;
    return entry->record() && (!cyclic || cyclic->isSCCEvaluated());
}

#if ENABLE(AOT)
bool canRequireOriginalOfModuleMockAt(Zig::GlobalObject* globalObject, const String& path)
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

    Ref provider = JSC::StringSourceProvider::create(text.toString(), JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(key)), key, JSC::SourceTaintedOrigin::Untainted, WTF::TextPosition(), JSC::SourceProviderSourceType::Module);
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
String keyOfImportByPackage(Zig::GlobalObject* globalObject, const String& key, const String& importer, bool isESM)
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
    // A compiled file has no record while its fetch waits for a factory, and a record of it lists no requests here: the image knows what it leads to.
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
            if (file && earlierFile && *earlierFile != *file && JSC::AOT::loadLeadsTo(globalObject, *file, *earlierFile))
                Zig::addImporter(importersOf, String(mapKey.first), earlier);
            if (file && laterFile && *laterFile != *file && JSC::AOT::loadLeadsTo(globalObject, *file, *laterFile))
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

    // The runner's own load of a test file has no importer, so no factory is asking.
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
    String asked;
    while (std::exchange(asked, given) != given) {
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
            // The loader holds no entry of a compiled module: the run time says whether an import has loaded it, as against a require() alone or the laying of an earlier mock, and whether it is still loaded. The file of a compiled factory is known only where mock.module() itself
            // called it and will patch: for a factory that a load called, whoever asks does wait.
            JSObject* factoryOfRunning = uncheckedDowncast<Zig::JSModuleMock>(running.mock.get())->factory ? uncheckedDowncast<Zig::JSModuleMock>(running.mock.get())->factory.get().getObject() : nullptr;
            bool willPatch = isESM && !running.file.isEmpty() && factoryOfRunning && globalObject->vm().hasCompiledCode() && JSC::AOT::CompiledCallee::isCompiledCallee(factoryOfRunning);
            if (auto module = willPatch ? Bun::compiledModuleForPath(mocked) : std::nullopt; module && JSC::AOT::hasImportBegunToLoad(globalObject, *module) && JSC::AOT::wasLoadedByImport(globalObject, *module) && !JSC::AOT::isEvictedFile(globalObject, *module))
                continue;
#endif
            String instead = given == mocked ? Zig::originalModuleKey(given) : given;
            String copy = Zig::keyOfModuleThatDoesNotWait(globalObject, running, instead, mocked);
            if (isESM)
                instead = copy;
            else
                Zig::addToImportChain(globalObject, running, instead);
            if (instead != given && isInChain && !importer.contains("?actual"_s) && !importer.contains("&actual"_s))
                running.givenTheOriginal.append(importer);
            given = instead;
        }
    }
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
JSC::JSObject* objectHoldingExportOfCompiledModuleMock(JSC::JSGlobalObject* globalObject, JSC::JSObject* moduleNamespace, const JSC::Identifier& name)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // A namespace object that was made under a mock reads its names off that mock for good. The record is the one that the module has now.
    JSObject* readThrough = JSC::AOT::mockInPlaceBehind(moduleNamespace);
    if (auto* mock = readThrough ? dynamicDowncast<Zig::JSModuleMock>(readThrough) : nullptr) {
        JSObject* exports = mock->exports.get();
        bool holdsName = exports && exports->hasProperty(globalObject, name);
        RETURN_IF_EXCEPTION(scope, nullptr);
        // Of a mock of Vitest the object has no other names: a read of a name that the mock lacks throws. A spy gives the mock the name.
        if (holdsName || (exports && mock->isOfVitest()))
            return exports;
    }
    JSC::AbstractModuleRecord* moduleRecord = JSC::AOT::isModuleNamespace(moduleNamespace) ? JSC::AOT::moduleRecordOfNamespace(globalObject, moduleNamespace) : nullptr;
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
            Zig::keepModuleMockOfLoadInFlight(global, mock, specifier, loaded);
        }
    }
#if ENABLE(AOT)
    for (auto& waiting : std::exchange(plugins.compiledMocksToRun, {})) {
        JSC::AOT::didEndMock(global, JSC::AOT::ModuleID(waiting.first));
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
