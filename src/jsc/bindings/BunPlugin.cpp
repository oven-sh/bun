#include "BunPlugin.h"

#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSCast.h"
#include "headers-handwritten.h"
#include "headers.h"
#include "helpers.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/ErrorInstance.h>
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
#include <JavaScriptCore/RegularExpression.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/SyntheticModuleRecord.h>
#include <wtf/text/WTFString.h>

#include "BunClientData.h"
#include "BuiltinModuleKeys.h"
#include "JSCommonJSModule.h"
#include "ModuleLoader.h"
#include "PathInlines.h"
#include "isBuiltinModule.h"
#include "AsyncContextFrame.h"
#include "ImportMetaObject.h"
#include "../modules/ObjectModule.h"

namespace Zig {

static void evictModulesAndTheirImporters(Zig::GlobalObject*, Vector<String>&& modules);

static bool isValidNamespaceString(String& namespaceString)
{
    static JSC::Yarr::RegularExpression* namespaceRegex = nullptr;
    if (!namespaceRegex) {
        namespaceRegex = new JSC::Yarr::RegularExpression("^([/@a-zA-Z0-9_\\-]+)$"_s);
    }
    return namespaceRegex->match(namespaceString) > -1;
}

static JSC::EncodedJSValue jsFunctionAppendOnLoadPluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

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

    plugin.append(vm, filter->regExp(), func.getObject(), namespaceString);

    return JSValue::encode(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
}

static EncodedJSValue jsFunctionAppendVirtualModulePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

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

    Zig::GlobalObject* global = defaultGlobalObject(globalObject);

    if (global->onLoadPlugins.virtualModules == nullptr) {
        global->onLoadPlugins.virtualModules = new BunPlugin::VirtualModuleMap;
    }
    auto* virtualModules = global->onLoadPlugins.virtualModules;

    virtualModules->set(moduleId, JSC::Strong<JSC::JSObject> { vm, uncheckedDowncast<JSC::JSObject>(functionValue) });

    evictModulesAndTheirImporters(global, Vector<String> { moduleId });
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(callframe->thisValue().toThis(globalObject, JSC::ECMAMode::strict()));
}

static JSC::EncodedJSValue jsFunctionAppendOnResolvePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

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

    plugin.append(vm, filter->regExp(), uncheckedDowncast<JSObject>(func), namespaceString);

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

    builderObject->putDirect(vm, Identifier::fromString(vm, "target"_s), jsString(vm, String("bun"_s)), 0);
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
    // mock.module(): the factory is required.
    MockModule,
    // The transpiler moves these calls above the imports.
    ViMock,
    JestMock,
    ViDoMock,
    JestDoMock,
};

// Also the object that the exports of the ES module it is loaded as are read from (AbstractModuleRecord::liveExportsSource).
class JSModuleMock final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesGetOwnPropertySlot | JSC::OverridesGetOwnPropertyNames | JSC::InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero | JSC::GetOwnPropertySlotIsImpureForPropertyAbsence;

    enum class State : uint8_t {
        NotCalled,
        // From the call of the factory until what it returns has settled.
        Running,
        Settled,
    };

    // A function, the path of a `__mocks__` file (a string), or empty: the exports are mocks of the original's.
    WriteBarrier<Unknown> factory;
    // Settled: the exports, or a CommonJS module that has them as `module.exports`. Running: what run() returned, if the factory returned a promise.
    WriteBarrier<JSObject> result;
    // What ES modules import: `result`, or what `import * as` gives for its `module.exports`.
    WriteBarrier<JSObject> exports;
    WriteBarrier<JSString> specifier;
    WriteBarrier<JSString> writtenSpecifier;
    // Set when the ES module was loaded first and so is patched in place: the values overwritten, by export name (itself: there was none yet).
    WriteBarrier<JSObject> originalExports;
    // The same for the require.cache entry: its `module.exports`.
    WriteBarrier<Unknown> originalCommonJSExports;
    // The namespace object of the original, once the ES module this is loaded as has imported it.
    WriteBarrier<JSObject> originalNamespace;
    // The namespace object that was patched, and once that module has been evicted, `originalExports` as it was: what a preload loaded, and
    // whatever script holds, stays linked to that module, which has its exports back when the mock is removed.
    WriteBarrier<JSC::JSModuleNamespaceObject> patchedNamespace;
    WriteBarrier<JSObject> originalExportsOfEvictedModule;
    State state { State::NotCalled };
    ModuleMockFunction function;
    // The factory's promise is pending and will patch the already-loaded module when it settles.
    bool hasPendingPatch { false };
    bool spy { false };
    bool isFromPreload { false };
    // Loaded as an ES module that imports the original (or the `__mocks__` file) and calls the factory when it is evaluated.
    bool importsOriginal { false };

    static JSModuleMock* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue factory, JSC::JSString* specifier, JSC::JSString* writtenSpecifier, ModuleMockFunction);
    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static bool getOwnPropertySlot(JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool getOwnPropertySlotByIndex(JSObject*, JSC::JSGlobalObject*, unsigned, JSC::PropertySlot&);
    static void getOwnPropertyNames(JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);

    // Returns null once it is settled, or a promise that is fulfilled with undefined when it is. `dependency`: the namespace object of dependencyKeyOfModuleMock(), if it is loaded.
    JSC::JSPromise* run(Zig::GlobalObject* globalObject, bool synchronous, JSObject* dependency = nullptr);
    void settle(Zig::GlobalObject* globalObject, JSValue value);
    // `value`: what the promise that callFactory() returned was fulfilled with.
    void settleWithPromised(Zig::GlobalObject* globalObject, JSValue value);
    void didFail(Zig::GlobalObject* globalObject, JSValue error);
    // The factory will not be heard of again. Calls nothing: script may have been terminated.
    void abandon(Zig::GlobalObject* globalObject);
    // Whatever waits for the factory to return goes on with what the module is now.
    void giveUp(Zig::GlobalObject* globalObject);
    bool isHoisted() const { return function == ModuleMockFunction::ViMock || function == ModuleMockFunction::JestMock; }

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

// A reaction's context: a module mock, and what the reaction is to settle or change.
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

// Whether `mock` is still the mock of the module, or there is none as there was none. (jest.resetModules() puts another with the same factory
// in its place: that is not script mocking the module again.)
static bool isStillRegisteredModuleMock(Zig::GlobalObject* globalObject, const String& specifier, JSModuleMock* mock)
{
    auto* registered = registeredModuleMock(globalObject, specifier);
    return registered == mock || (registered && mock && registered->factory.get() == mock->factory.get() && registered->function == mock->function);
}

struct LoadedModule {
    JSC::JSModuleNamespaceObject* esmNamespace { nullptr };
    Bun::JSCommonJSModule* commonJSModule { nullptr };
    // In the registry / require.cache with nothing to patch: removed so the next import loads the mock.
    bool staleESMEntry { false };
    bool staleCommonJSEntry { false };
};

static void findLoadedESModule(Zig::GlobalObject* globalObject, JSC::JSString* specifierString, LoadedModule& loaded)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    loaded.esmNamespace = nullptr;
    loaded.staleESMEntry = false;

    auto specifierIdent = JSC::Identifier::fromString(vm, specifierString->value(globalObject));
    RETURN_IF_EXCEPTION(scope, );
    auto* loader = globalObject->moduleLoader();
    auto* entry = loader->registryEntry(specifierIdent);
    if (!entry)
        return;

    loaded.staleESMEntry = true;
    // Imported `with { type: "json" }` and without, say: several modules, and only one would be patched.
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

    JSValue entryValue = JSValue::decode(JSC__JSMap__get(globalObject->requireMap(), globalObject, JSValue::encode(specifierString)));
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
    return loaded;
}

// The registry key the original of a mocked module is loaded under. Mocks are looked up by exact key, so it loads the file.
static String originalModuleKey(const String& specifier)
{
    return makeString(specifier, specifier.contains('?') ? '&' : '?', "actual"_s);
}

// Whether `key` is `module`, or a copy of it that a factory was given (keyOfModuleThatDoesNotWait).
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

// `record` is null when the module has no such export.
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

// import() of a registry key, which is not resolved.
static JSC::JSPromise* importModuleKey(Zig::GlobalObject* globalObject, const String& key)
{
    return globalObject->moduleLoader()->loadModule(globalObject, JSC::Identifier::fromString(globalObject->vm(), key), nullptr, nullptr, { JSC::ModuleLoadFlag::Evaluate, JSC::ModuleLoadFlag::Dynamic });
}

static JSC::JSPromise* importModuleFrom(Zig::GlobalObject* globalObject, const String& from, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    globalObject->onLoadPlugins.isResolvingImportCall = true;
    JSC::JSPromise* promise = globalObject->moduleLoader()->requestImportModule(globalObject, JSC::Identifier::fromString(vm, specifier), JSC::Identifier::fromString(vm, from), nullptr, nullptr);
    if (scope.exception()) [[unlikely]]
        return JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
    return promise;
}

// The loader's own steps run here, like for require() of an ES module.
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
    JSObject* require = Bun::JSCommonJSModule::createBoundRequireFunction(vm, globalObject, from);
    RETURN_IF_EXCEPTION(scope, {});
    MarkedArgumentBuffer arguments;
    arguments.append(jsString(vm, key));
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, require, JSC::getCallData(require), jsUndefined(), arguments));
}

// The CommonJS module in require.cache as `key`, unless it only holds the namespace object of an ES module.
static Bun::JSCommonJSModule* loadedCommonJSModule(Zig::GlobalObject* globalObject, const String& key)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue entry = JSValue::decode(JSC__JSMap__get(globalObject->requireMap(), globalObject, JSValue::encode(jsString(vm, key))));
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

// What JSModuleMock::getOwnPropertySlot() throws.
static bool isMissingExportError(JSC::VM& vm, JSValue error)
{
    auto* instance = dynamicDowncast<JSC::ErrorInstance>(error);
    JSValue message = instance ? instance->getDirect(vm, vm.propertyNames->message) : JSValue();
    return message && message.isString() && asString(message)->tryGetValue().data.contains(missingExportMessage);
}

// Null for any other error.
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

// In an import cycle a module can re-export from one that is not evaluated yet, and any module a name that a mock lacks. Spreading it would throw:
// those exports are undefined in a copy.
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

// Null when `mock` does not patch an ES module in place.
static JSObject* esmExportsBeforePatches(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* overwritten = mock->originalExports.get();
    if (!overwritten)
        return nullptr;

    // Listing the exports of a builtin would make the ones that are made on first use. It costs nothing to load again.
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

static BunPlugin::OnLoad::RunningModuleMock* findRunningModuleMock(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
        if (running.mock.get() == mock)
            return &running;
    }
    return nullptr;
}

static void addToImportChain(BunPlugin::OnLoad::RunningModuleMock& running, const String& key)
{
    running.importChain.add(key);
    if (size_t query = key.find('?'); query != notFound)
        running.importChainWithoutQuery.add(key.left(query));
}

// The module the exports of a mock without a factory function are made from.
static String dependencyKeyOfModuleMock(JSC::JSGlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (JSValue manualMock = mock->factory.get(); manualMock && manualMock.isString())
        RELEASE_AND_RETURN(scope, asString(manualMock)->value(globalObject));
    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    // Spying changes the objects nested in the exports in place, so it has an instance of its own.
    return mock->spy ? makeString(originalModuleKey(specifier), "&spy"_s) : originalModuleKey(specifier);
}

static JSC::JSPromise* thenWithContext(Zig::GlobalObject*, JSC::JSPromise*, JSC::NativeFunction onFulfilled, JSC::NativeFunction onRejected, JSValue context);
static JSC::JSPromise* importOriginalModule(Zig::GlobalObject*, JSModuleMock*, bool mayLoadMock, const String& from);
static String keyOfModuleThatDoesNotWait(Zig::GlobalObject*, BunPlugin::OnLoad::RunningModuleMock&, const String& key, const String& mocked);

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockDidLoadBeforeOriginal, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto [mock, original] = toModuleMockWith<JSC::JSPromise>(lexicalGlobalObject, scope, callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSPromise* loading = importOriginalModule(defaultGlobalObject(lexicalGlobalObject), mock, false, String());
    if (scope.exception()) [[unlikely]]
        original->rejectWithCaughtException(vm, scope);
    else
        original->pipeFrom(vm, loading);
    return JSValue::encode(jsUndefined());
}

// `from`: the file that asks with vi.importActual(). It may be the factory of another mock.
static JSC::JSPromise* importOriginalModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, bool mayLoadMock = true, const String& from = String())
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* exports = mock->originalNamespace.get();
    if (exports)
        exports = withoutUninitializedExports(globalObject, exports);
    else
        exports = esmExportsBeforePatches(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!exports && mock->originalCommonJSExports) {
        exports = esmExportsOfCommonJSExports(globalObject, mock->originalCommonJSExports.get());
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    if (exports)
        RELEASE_AND_RETURN(scope, JSC::JSPromise::resolvedPromise(globalObject, exports));

    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    String key = originalModuleKey(specifier);

    auto* running = findRunningModuleMock(globalObject, mock);
    bool mayBeAnotherFactory = !running && !from.isNull() && !globalObject->onLoadPlugins.runningModuleMocks.isEmpty();

    // Entered through the original, an import cycle evaluates the module that imports the original before the original.
    if (mayLoadMock && !mayBeAnotherFactory && mock->importsOriginal && mock->state == JSModuleMock::State::NotCalled) {
        String dependency = dependencyKeyOfModuleMock(globalObject, mock);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (dependency == key) {
            JSC::JSPromise* loading = importModuleKey(globalObject, specifier);
            RETURN_IF_EXCEPTION(scope, nullptr);
            JSC::JSPromise* original = JSC::JSPromise::create(vm, globalObject->promiseStructure());
            JSC::JSFunction* didLoad = JSC::JSFunction::create(vm, globalObject, 2, String(), jsFunctionModuleMockDidLoadBeforeOriginal, ImplementationVisibility::Private);
            loading->performPromiseThenWithContext(vm, globalObject, didLoad, didLoad, jsUndefined(), moduleMockWith(globalObject, mock, original));
            return original;
        }
    }

    if (running) {
        key = keyOfModuleThatDoesNotWait(globalObject, *running, key, specifier);
        addToImportChain(*running, key);
    } else if (mayBeAnotherFactory)
        key = Bun::keyOfImportWhileModuleMocksRun(globalObject, key, from, true);
    RELEASE_AND_RETURN(scope, importModuleKey(globalObject, key));
}

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

    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String key = originalModuleKey(specifier);
    if (JSObject* moduleNamespace = mock->originalNamespace.get()) {
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
        addToImportChain(*running, key);
    }
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
    if (commonJSModule) {
        isCommonJS = true;
        exports = commonJSModule->exportsObject();
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

// The promise returned is resolved with what the reaction returns, which asks that for `then`: it returns undefined, or what script may hold.
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

static void addHoistingNote(JSC::VM& vm, JSValue error)
{
    String message = messageOfUninitializedVariableError(vm, error);
    if (message.isNull())
        return;
    uncheckedDowncast<JSC::ErrorInstance>(error)->putDirect(vm, vm.propertyNames->message, jsString(vm, makeString(message, "\nnote: vi.mock() and jest.mock() run before the imports and the top-level variables of the file, so a factory cannot use them. Declare what it needs with vi.hoisted()."_s)), static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
}

JSValue JSModuleMock::callFactory(Zig::GlobalObject* globalObject, bool synchronous, JSObject* dependency)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue factoryValue = factory.get();
    if (factoryValue && factoryValue.isCallable()) {
        JSC::JSFunction* importOriginal = JSC::JSFunction::create(vm, globalObject, 0, "importOriginal"_s, jsFunctionModuleMockImportOriginal, ImplementationVisibility::Public);
        MarkedArgumentBuffer arguments;
        arguments.append(JSC::JSBoundFunction::create(vm, globalObject, importOriginal, this, ArgList(), 0, nullptr, makeSource("importOriginal"_s, JSC::SourceOrigin(), JSC::SourceTaintedOrigin::Untainted)));
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, JSC::profiledCall(globalObject, ProfilingReason::API, factoryValue, JSC::getCallData(factoryValue), JSC::jsUndefined(), arguments));
    }

    if (!dependency && !factoryValue && !spy)
        dependency = originalNamespace.get();
    if (dependency)
        RELEASE_AND_RETURN(scope, exportsOfModuleMockWithoutFactory(globalObject, this, dependency));

    if (!factoryValue) {
        // Nothing to load: patched in place, or a builtin.
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

    String key = dependencyKeyOfModuleMock(globalObject, this);
    RETURN_IF_EXCEPTION(scope, {});
    if (auto* running = findRunningModuleMock(globalObject, this)) {
        keyOfModuleThatDoesNotWait(globalObject, *running, key, specifier->tryGetValue().data);
        addToImportChain(*running, key);
    }

    if (synchronous) {
        JSValue moduleNamespace = importModuleKeySync(globalObject, key);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, exportsOfModuleMockWithoutFactory(globalObject, this, moduleNamespace));
    }

    RELEASE_AND_RETURN(scope, importModuleKey(globalObject, key));
}

// What was given the original is the factory's own: whatever imports it from now on loads it again, and gets the mock.
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
}

void JSModuleMock::didFail(Zig::GlobalObject* globalObject, JSValue error)
{
    state = State::NotCalled;
    result.clear();
    if (isHoisted())
        addHoistingNote(globalObject->vm(), error);
    didStopRunning(globalObject, this);
}

void JSModuleMock::abandon(Zig::GlobalObject* globalObject)
{
    state = State::NotCalled;
    result.clear();
    for (auto& module : stopRunning(globalObject, this))
        globalObject->onLoadPlugins.modulesToEvictOnceLoaded.add(module);
}

void JSModuleMock::giveUp(Zig::GlobalObject* globalObject)
{
    auto* pending = state == State::Running && result ? dynamicDowncast<JSC::JSPromise>(result.get()) : nullptr;
    if (!pending)
        return;
    abandon(globalObject);
    pending->fulfill(globalObject->vm(), jsUndefined());
}

// Whether reading an export of `object` can end in reading one of the module `key` with no script in between.
static bool readsExportsOfModule(JSC::JSGlobalObject* globalObject, JSObject* object, const String& key, UncheckedKeyHashSet<JSObject*>& seen)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

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

    // The namespace object of a mocked module stands for what it reads from now: that of this module would read from itself.
    while (auto* moduleNamespace = dynamicDowncast<JSC::JSModuleNamespaceObject>(esmExports)) {
        JSObject* source = moduleNamespace->moduleRecord()->hasLiveExports() ? moduleNamespace->moduleRecord()->liveExportsSource() : nullptr;
        if (auto* mock = source ? dynamicDowncast<JSModuleMock>(source) : nullptr)
            source = mock->exports.get();
        if (!source)
            break;
        esmExports = source;
    }
    String key = specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    UncheckedKeyHashSet<JSObject*> seen;
    bool readsItself = readsExportsOfModule(globalObject, esmExports, key, seen);
    RETURN_IF_EXCEPTION(scope, );
    if (readsItself) {
        JSC::throwTypeError(globalObject, scope, "mock(module, fn) requires a function that does not return the namespace object of a module that re-exports the mocked module"_s);
        return;
    }

    state = State::Settled;
    result.set(vm, this, object);
    exports.set(vm, this, esmExports);
    RELEASE_AND_RETURN(scope, didStopRunning(globalObject, this));
}

void JSModuleMock::settleWithPromised(Zig::GlobalObject* globalObject, JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
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

static String fileOfFunction(JSValue function)
{
    auto* jsFunction = function ? dynamicDowncast<JSC::JSFunction>(function) : nullptr;
    if (!jsFunction || jsFunction->isHostFunction())
        return {};
    const URL& url = jsFunction->jsExecutable()->sourceOrigin().url();
    return url.isValid() && url.protocolIsFile() ? url.fileSystemPath() : String();
}

JSC::JSPromise* JSModuleMock::run(Zig::GlobalObject* globalObject, bool synchronous, JSObject* dependency)
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
    globalObject->onLoadPlugins.runningModuleMocks.append(BunPlugin::OnLoad::RunningModuleMock { JSC::Strong<JSC::JSObject> { vm, this }, fileOfFunction(factory.get()), {}, {}, {}, {} });

    JSValue value = callFactory(globalObject, synchronous, dependency);
    if (!scope.exception()) [[likely]] {
        if (auto* promise = dynamicDowncast<JSC::JSPromise>(value)) {
            switch (promise->status()) {
            case JSC::JSPromise::Status::Pending: {
                // Not what the reactions return settles it: once this is abandoned, nothing does.
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

// Whether the module is being fetched, and not as a mock: its fetch settles without a factory.
static bool isBeingFetchedAsItself(Zig::GlobalObject* globalObject, JSC::ModuleRegistryEntry* entry)
{
    if (entry->record() || entry->status() != JSC::ModuleRegistryEntry::Status::Fetching)
        return false;
    String key = entry->key().string();
    return !registeredModuleMock(globalObject, key) && !globalObject->onLoadPlugins.moduleMocksBeingLoaded.contains(key);
}

static void appendImportsOf(JSC::AbstractModuleRecord* record, Vector<UniquedStringImpl*>& imports)
{
    for (auto& resolved : record->resolvedRequests().values())
        imports.append(resolved.get());
    for (auto& loaded : record->loadedModules().values())
        imports.append(loaded.m_module->moduleKey().impl());
}

// What jsFunctionRunModuleMockLater keeps between its calls, so that each module is gone through once: an array of registry entries.
// [0] is the set of those it has come by; the others are those of them whose fetch it has yet to wait for.
// Returns whether it comes by `entry` for the first time.
static bool comesBy(Zig::GlobalObject* globalObject, JSC::JSArray* fetches, JSC::ModuleRegistryEntry* entry, bool remembers = true)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto* comeBy = uncheckedDowncast<JSC::JSSet>(fetches->getIndexQuickly(0).asCell());
    bool has = comeBy->has(globalObject, entry);
    RETURN_IF_EXCEPTION(scope, false);
    if (has)
        return false;
    if (remembers) {
        comeBy->add(globalObject, entry);
        RETURN_IF_EXCEPTION(scope, false);
    }
    return true;
}

// Comes by `start` and all that it imports, directly or not. (A module that has loaded has nothing being fetched for it.)
static void followImports(Zig::GlobalObject* globalObject, JSC::JSArray* fetches, JSC::ModuleRegistryEntry* start)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* loader = globalObject->moduleLoader();
    Vector<JSC::ModuleRegistryEntry*> work { start };
    Vector<UniquedStringImpl*> imports;
    while (!work.isEmpty()) {
        auto* entry = work.takeLast();
        if (!entry->record()) {
            if (isBeingFetchedAsItself(globalObject, entry)) {
                fetches->push(globalObject, entry);
                RETURN_IF_EXCEPTION(scope, );
            }
            continue;
        }
        if (entry->isLoaded())
            continue;
        imports.shrink(0);
        appendImportsOf(entry->record(), imports);
        for (auto* key : imports) {
            auto* imported = loader->registryEntry(JSC::Identifier::fromUid(vm, key));
            bool isNew = imported && comesBy(globalObject, fetches, imported);
            RETURN_IF_EXCEPTION(scope, );
            if (isNew)
                work.append(imported);
        }
    }
}

// Comes by the modules that import `mocked`, directly or not, and all that they import.
static void followImporters(Zig::GlobalObject* globalObject, JSC::JSArray* fetches, const String& mocked)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* loader = globalObject->moduleLoader();

    // (What imports a module that is being fetched has not loaded.)
    UncheckedKeyHashMap<UniquedStringImpl*, Vector<JSC::ModuleRegistryEntry*>> importersOf;
    Vector<UniquedStringImpl*> imports;
    for (auto& entry : loader->moduleMap().values()) {
        if (!entry->record() || entry->isLoaded())
            continue;
        imports.shrink(0);
        appendImportsOf(entry->record(), imports);
        for (auto* key : imports)
            importersOf.add(key, Vector<JSC::ModuleRegistryEntry*>()).iterator->value.append(entry.get());
    }

    UncheckedKeyHashSet<UniquedStringImpl*> seen;
    Vector<UniquedStringImpl*> work { JSC::Identifier::fromString(vm, mocked).impl() };
    while (!work.isEmpty()) {
        auto importers = importersOf.find(work.takeLast());
        if (importers == importersOf.end())
            continue;
        for (auto* importer : importers->value) {
            if (!seen.add(importer->key().impl()).isNewEntry)
                continue;
            work.append(importer->key().impl());
            bool isNew = comesBy(globalObject, fetches, importer);
            RETURN_IF_EXCEPTION(scope, );
            if (!isNew)
                continue;
            followImports(globalObject, fetches, importer);
            RETURN_IF_EXCEPTION(scope, );
        }
    }
}

// Whether something is being fetched (as itself) that `fetches`, if there is one, has not come by.
static bool isFetchingAnythingElse(Zig::GlobalObject* globalObject, JSC::JSArray* fetches)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    for (auto& entry : globalObject->moduleLoader()->moduleMap().values()) {
        if (!isBeingFetchedAsItself(globalObject, entry.get()))
            continue;
        bool isNew = !fetches || comesBy(globalObject, fetches, entry.get(), false);
        RETURN_IF_EXCEPTION(scope, false);
        if (isNew)
            return true;
    }
    return false;
}

// The context has what Bun::runModuleMock() made: the promise it returned, and the fetches this waits for (none yet).
JSC_DEFINE_HOST_FUNCTION(jsFunctionRunModuleMockLater, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
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

    // Before a factory is called, what is being fetched for the modules that import the mock has to have been: then it is known which of the
    // modules they share with the factory wait for the mock (isWaitingForModule), and stay linked to it. Only fetches that settle without a
    // factory are waited for, so none that is fetched as a mock, and only by a mock whose factory is about to be called: one that was removed
    // lets go of its module at once. What another load fetches is not waited for: that load may never end.
    bool callsFactory = isInUse && mock->state == JSModuleMock::State::NotCalled;
    auto& moduleMocksBeingLoaded = globalObject->onLoadPlugins.moduleMocksBeingLoaded;
    auto* fetches = dynamicDowncast<JSC::JSArray>(waiting->getInternalField(1));
    while (callsFactory) {
        while (fetches && fetches->length() > 1) {
            auto* entry = uncheckedDowncast<JSC::ModuleRegistryEntry>(fetches->pop(globalObject));
            RETURN_IF_EXCEPTION(scope, {});
            JSC::JSPromise* fetching = isBeingFetchedAsItself(globalObject, entry) ? entry->ensureModulePromise(globalObject) : nullptr;
            if (fetching && fetching->status() == JSC::JSPromise::Status::Pending) {
                fetches->push(globalObject, entry);
                RETURN_IF_EXCEPTION(scope, {});
                JSValue later = callframe->jsCallee();
                fetching->performPromiseThenWithContext(vm, globalObject, later, later, jsUndefined(), context);
                return JSValue::encode(jsUndefined());
            }
            followImports(globalObject, fetches, entry);
            RETURN_IF_EXCEPTION(scope, {});
        }
        // Another load may have turned out to import the mock.
        bool isFetching = isFetchingAnythingElse(globalObject, fetches);
        RETURN_IF_EXCEPTION(scope, {});
        if (!isFetching)
            break;
        if (!fetches) {
            fetches = JSC::constructEmptyArray(globalObject, nullptr);
            RETURN_IF_EXCEPTION(scope, {});
            fetches->push(globalObject, JSC::JSSet::create(vm, globalObject->setStructure()));
            RETURN_IF_EXCEPTION(scope, {});
            waiting->putInternalField(vm, 1, fetches);
        }
        followImporters(globalObject, fetches, specifier);
        RETURN_IF_EXCEPTION(scope, {});
        if (fetches->length() == 1)
            break;
    }

    // (Bun::runModuleMock() put it there. One that was called and then removed stays: keepModuleMockOfLoadInFlight.)
    if (auto waiting = moduleMocksBeingLoaded.find(specifier); waiting != moduleMocksBeingLoaded.end() && waiting->value.get() == mock && (!isInUse || registeredModuleMock(globalObject, specifier) == mock))
        moduleMocksBeingLoaded.remove(waiting);

    JSC::JSPromise* pending = isInUse ? mock->run(globalObject, false) : nullptr;
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

    // As in Vitest. With mock.module() and jest.mock() a name the factory left out is undefined.
    if (mock->function != ModuleMockFunction::ViMock && mock->function != ModuleMockFunction::ViDoMock)
        return false;
    // Promise resolution asks any object for `then`, and interop with CommonJS for `__esModule`.
    JSValue factory = mock->factory.get();
    if (slot.internalMethodType() != JSC::PropertySlot::InternalMethodType::Get || !factory || !factory.isCallable() || propertyName.isSymbol() || propertyName == vm.propertyNames->then || propertyName == vm.propertyNames->__esModule)
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

static void overrideLoadedModuleExports(Zig::GlobalObject* globalObject, JSModuleMock* mock, const LoadedModule& loaded)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* exports = mock->result.get();
    auto* commonJSExports = dynamicDowncast<Bun::JSCommonJSModule>(exports);
    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    JSModuleMock* registered = registeredModuleMock(globalObject, specifier);

    if (loaded.esmNamespace && loaded.esmNamespace->moduleRecord()->hasLiveExports())
        loaded.esmNamespace->moduleRecord()->setLiveExportsSource(vm, mock);
    else if (auto* moduleNamespaceObject = loaded.esmNamespace) {
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
        // A getter may have mocked the module again, or removed its mock: that holds.
        if (!isStillRegisteredModuleMock(globalObject, specifier, registered))
            return;

        if (JSObject* overwritten = mock->originalExports.get()) {
            for (auto& name : names) {
                bool isSaved = overwritten->hasProperty(globalObject, name);
                RETURN_IF_EXCEPTION(scope, );
                if (isSaved)
                    continue;
                // Not through the namespace object, which makes an export that is made on first use.
                ExportVariable variable = findExportVariable(globalObject, moduleNamespaceObject, name);
                RETURN_IF_EXCEPTION(scope, );
                if (!variable.record)
                    continue;
                JSValue original = variable.record->moduleEnvironment()->readVariable(vm, variable.offset);
                overwritten->putDirectMayBeIndex(globalObject, name, original ? original : JSValue(overwritten));
                RETURN_IF_EXCEPTION(scope, );
            }
        }

        if (mock->originalExports && !mock->originalExportsOfEvictedModule)
            mock->patchedNamespace.set(vm, mock, moduleNamespaceObject);
        for (size_t i = 0; i < names.size(); ++i) {
            moduleNamespaceObject->overrideExportValue(globalObject, names[i], values.at(i));
            RETURN_IF_EXCEPTION(scope, );
        }
    }

    if (auto* moduleObject = loaded.commonJSModule) {
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

static void addRequirer(Zig::GlobalObject* globalObject, ModuleImporters& importersOf, Bun::JSCommonJSModule* importer, JSValue importedValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* imported = importedValue ? dynamicDowncast<Bun::JSCommonJSModule>(importedValue) : nullptr;
    if (!imported || !importer->filename().isString() || !imported->filename().isString())
        return;
    JSValue registered = JSValue::decode(JSC__JSMap__get(globalObject->requireMap(), globalObject, JSValue::encode(imported->filename())));
    RETURN_IF_EXCEPTION(scope, );
    if (registered != imported)
        return;
    String importerKey = asString(importer->filename())->value(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    String importedKey = asString(imported->filename())->value(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    addImporter(importersOf, importerKey, importedKey);
}

struct ModulesToEvict {
    Vector<String> modules;
    // Patched in place, these stay where they were patched: what they export changed, so the modules that import them go.
    Vector<String> patchedESModules;
    Vector<String> patchedCommonJSModules;
    // Mocked modules whose factory is not waited for any more: the fetch that waits for it never settles.
    Vector<String> abandonedModules;
    bool all { false };
    bool onlyImportersFromEarlierTestFiles { false };
    // Though there may be nothing else to evict: the modules that failed to load, or threw.
    bool isEndOfTestFile { false };
    // Nothing else to evict: a load that modules stayed for has settled.
    bool hasLoadSettled { false };
};

// Null unless `entry` is being loaded: fetched, or waiting for what its module imports to be loaded. Settles when it goes on, or fails.
static JSC::JSPromise* pendingLoadOf(JSC::JSGlobalObject* globalObject, JSC::ModuleRegistryEntry* entry)
{
    JSC::JSPromise* promise = entry->loadPromise();
    if (!promise && entry->status() == JSC::ModuleRegistryEntry::Status::Fetching)
        promise = entry->ensureModulePromise(globalObject);
    return promise && promise->status() == JSC::JSPromise::Status::Pending ? promise : nullptr;
}

// When the fetch of an import() fails with the error of another module (one that a factory imported, say), JSC makes an entry to keep the
// error in. Nothing fetches that entry, so a module that imports it would wait for ever.
static bool isNeverFetched(JSC::ModuleRegistryEntry* entry)
{
    return !entry->record() && entry->status() > JSC::ModuleRegistryEntry::Status::FetchFailed;
}

JSC_DECLARE_HOST_FUNCTION(jsFunctionEvictModulesThatHaveLoaded);

// What a preload loaded is never loaded again, so it stays linked to the module that was loaded as the preload's mock. A test file that mocks
// the module again changes what that module exports: not for longer than the module is there to be changed back, or the file lasts.
static void giveLoadedModuleBackToPreloadModuleMock(Zig::GlobalObject* globalObject, const String& key)
{
    auto& plugins = globalObject->onLoadPlugins;
    if (plugins.displacedPreloadModuleMocks.isEmpty() || plugins.testFileOfModule.get(key))
        return;
    auto* entry = globalObject->moduleLoader()->registryEntry(JSC::Identifier::fromString(globalObject->vm(), key));
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

// The only code that takes a module out of the registry or require.cache. A module stays linked to what it imported, so its importers go too
// (not what a preload loaded: nothing loads a preload again).
// While a module is being loaded, the loader looks up the entry of each module it imports more than once and takes what it finds for the same
// one. So an entry that is being loaded, or that a module being loaded has asked for, stays: that load goes on, and whoever waits for it gets
// what it loads. The entry goes when its load has settled. Linking and evaluating ask nothing of the registry: all other modules go at once.
static void evictModulesAndTheirImporters(Zig::GlobalObject* globalObject, ModulesToEvict&& evict)
{
    auto& plugins = globalObject->onLoadPlugins;
    Vector<String>& keys = evict.modules;
    keys.removeAllMatching([&](const String& key) { return plugins.modulesToEvictOnceLoaded.contains(key); });
    if (keys.isEmpty() && evict.patchedESModules.isEmpty() && evict.patchedCommonJSModules.isEmpty() && evict.abandonedModules.isEmpty() && !evict.all && !evict.isEndOfTestFile && !evict.hasLoadSettled)
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* loader = globalObject->moduleLoader();
    JSC::JSMap* requireMap = globalObject->requireMap();

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
    // What has to stay, each with a promise that settles before it can go.
    UncheckedKeyHashMap<String, JSC::JSPromise*> loading;
    MarkedArgumentBuffer pendingLoads;
    Vector<std::pair<JSC::AbstractModuleRecord*, JSC::JSPromise*>> asking;
    UncheckedKeyHashSet<JSC::AbstractModuleRecord*> asks;
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
        // A module that failed to load, or threw, may have done so because of a mock. JSC forgets what such a module had asked for.
        auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record);
        if (evict.all || entry->status() >= JSC::ModuleRegistryEntry::Status::FetchFailed || (cyclic && cyclic->evaluationError()))
            keys.append(key);
        if (!record || evict.all)
            continue;
        for (auto& resolved : record->resolvedRequests().values())
            addImporter(importersOf, key, String { resolved.get() });
        for (auto& loaded : record->loadedModules().values()) {
            auto* imported = loaded.m_module.get();
            auto* registered = loader->registryEntry(imported->moduleKey());
            if (registered && registered->record() == imported)
                addImporter(importersOf, key, imported->moduleKey().string());
            else if (evict.isEndOfTestFile && imported->hasLiveExports() && plugins.testFileOfModule.get(key))
                keys.append(key); // `delete require.cache[mocked]`: it is linked to a mock that nothing finds any more.
        }
    }

    // The load of a module asks for what the module imports, and for what those of them import that have not loaded (or failed to, before).
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

    auto* iterator = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), requireMap, JSC::IterationKind::Entries);
    RETURN_IF_EXCEPTION(scope, );
    JSValue requireKey, value;
    while (iterator->nextKeyValue(globalObject, requireKey, value)) {
        if (evict.all) {
            if (!requireKey.isString())
                continue;
            String path = asString(requireKey)->value(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            // A native addon is loaded once per process.
            size_t query = path.find('?');
            if (!(query == notFound ? StringView(path) : StringView(path).left(query)).endsWith(".node"_s))
                keys.append(path);
            continue;
        }
        auto* commonJSModule = dynamicDowncast<Bun::JSCommonJSModule>(value);
        if (!commonJSModule)
            continue;
        // The first module to require() it, which for an ES module is not among that module's children.
        if (auto* parent = commonJSModule->m_parent.get()) {
            addRequirer(globalObject, importersOf, parent, commonJSModule);
            RETURN_IF_EXCEPTION(scope, );
        }
        for (auto& child : commonJSModule->m_children) {
            addRequirer(globalObject, importersOf, commonJSModule, child.get());
            RETURN_IF_EXCEPTION(scope, );
        }
        if (auto* children = commonJSModule->m_childrenValue ? dynamicDowncast<JSC::JSArray>(commonJSModule->m_childrenValue.get()) : nullptr) {
            for (unsigned i = 0; i < children->length(); ++i) {
                // (Not an accessor: no script runs here.)
                addRequirer(globalObject, importersOf, commonJSModule, children->canGetIndexQuickly(i) ? children->getIndexQuickly(i) : JSValue());
                RETURN_IF_EXCEPTION(scope, );
            }
        }
    }

    // What waits for a fetch that never settles never loads, so no module is ever found for what has asked for it: it need not stay.
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

    // A module that goes takes all that import it along, patched in place or not: they are linked to it, not to what is loaded in its place.
    // (One that turns out to go after it was taken to stay is gone through again.)
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
    bool clearsRegistry = evict.all && loading.isEmpty();
    if (clearsRegistry) {
        for (auto& displaced : plugins.displacedPreloadModuleMocks)
            giveLoadedModuleBackToPreloadModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(displaced.get())->specifier->tryGetValue().data);
        for (auto& [mapKey, entry] : loader->moduleMap()) {
            if (mapKey.second == JSC::ScriptFetchParameters::Type::JavaScript)
                keepPreloadModule(String(mapKey.first), entry.get());
        }
        loader->clearAll();
    }
    // Each goes as soon as its own load has settled, whatever else is being loaded. (What stayed before has a reaction on what it stayed for.)
    UncheckedKeyHashSet<JSC::JSPromise*> awaited;
    WTF::ListHashSet<String> stay;
    for (auto& key : keys) {
        if (JSC::JSPromise* pendingLoad = loading.get(key)) {
            stay.add(key);
            if (evict.hasLoadSettled || !waitedFor.contains(key))
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
        }
        if (leavesRegistry)
            plugins.moduleMocksBeingLoaded.remove(key);
        if (leavesRequireCache) {
            JSString* keyString = jsString(vm, key);
            if (isTestFileRunning && !plugins.testFileOfModule.get(key)) {
                JSValue commonJSModule = requireMap->get(globalObject, keyString);
                RETURN_IF_EXCEPTION(scope, );
                if (commonJSModule.isCell())
                    plugins.evictedPreloadCommonJSModules.add(key, JSC::Strong<JSC::JSCell> { vm, commonJSModule.asCell() });
            }
            JSC__JSMap__remove(requireMap, globalObject, JSValue::encode(keyString));
            RETURN_IF_EXCEPTION(scope, );
        }
        // What was patched in place is not there any more.
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
    plugins.modulesToEvictOnceLoaded = WTF::move(stay);

    if (awaited.isEmpty())
        return;
    JSC::JSFunction* didSettle = JSC::JSFunction::create(vm, globalObject, 0, String(), jsFunctionEvictModulesThatHaveLoaded, ImplementationVisibility::Private);
    for (auto* pendingLoad : awaited)
        pendingLoad->performPromiseThenWithContext(vm, globalObject, didSettle, didSettle, jsUndefined(), jsUndefined());
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

// The loader may fetch a module more than once for one load, and takes what it is given for the same. So once its factory has been called,
// a mock goes on being what a module that is being loaded is fetched as, until the module is evicted.
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
        // A variable that has a value never goes back to having none: optimized code does not check again.
        // A module initializes its own. An export of a builtin that is made on first use is made now.
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

static void unmockModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, ModulesToEvict& evict)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules)
        virtualModules->remove(specifier);

    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, );
    keepModuleMockOfLoadInFlight(globalObject, mock, specifier, loaded);

    // What was patched has its exports back, loaded or not.
    JSObject* saved = mock->originalExportsOfEvictedModule ? mock->originalExportsOfEvictedModule.get() : mock->originalExports.get();
    if (auto* patched = mock->patchedNamespace.get(); patched && saved) {
        restoreOverwrittenExports(globalObject, patched, saved);
        RETURN_IF_EXCEPTION(scope, );
    }
    // (What is loaded as a mock is not what was patched.)
    JSObject* overwritten = loaded.esmNamespace && loaded.esmNamespace->moduleRecord()->hasLiveExports() ? nullptr : mock->originalExports.get();

    if (JSValue original = mock->originalCommonJSExports.get()) {
        if (loaded.commonJSModule)
            loaded.commonJSModule->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), original, 0);
    }

    if (!overwritten && !mock->originalCommonJSExports) {
        if (loaded.esmNamespace || loaded.staleESMEntry || loaded.commonJSModule)
            evict.modules.append(specifier);
        return;
    }
    if (overwritten)
        evict.patchedESModules.append(specifier);
    if (mock->originalCommonJSExports)
        evict.patchedCommonJSModules.append(specifier);
}

static void unmockModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ModulesToEvict evict;
    unmockModule(globalObject, mock, specifier, evict);
    RETURN_IF_EXCEPTION(scope, );
    RELEASE_AND_RETURN(scope, evictModulesAndTheirImporters(globalObject, WTF::move(evict)));
}

static String callerPath(JSC::VM& vm, JSC::CallFrame* callframe)
{
    JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
    const URL& url = sourceOrigin.url();
    return !sourceOrigin.isNull() && url.isValid() && url.protocolIsFile() ? url.fileSystemPath() : String("."_s);
}

// Returns true for a path nothing exists at, which only BunPlugin::OnLoad::resolveVirtualModule's relative lookup finds.
static bool resolveModuleMockSpecifier(Zig::GlobalObject* globalObject, JSC::CallFrame* callframe, JSC::JSString*& specifierString, WTF::String& specifier, bool& exists)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
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
    specifier = relativeURL.protocolIsFile() ? relativeURL.fileSystemPath() : relativeURL.string();
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

// `__mocks__/<name>` next to a file, or in the working directory for a package or a builtin.
extern "C" JSC::EncodedJSValue Bun__Process__getCwd(JSC::JSGlobalObject*);

static JSC::JSString* findManualModuleMock(Zig::GlobalObject* globalObject, const String& from, const String& written, const String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String candidate;
    if (isAbsolutePath(specifier) && !specifier.contains(makeString(PLATFORM_SEP, "node_modules"_s, PLATFORM_SEP))) {
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

// Whether a factory with this source may ask for the original of the module it mocks.
static bool mentionsOriginalModule(StringView source)
{
    if (source.contains("importOriginal"_s))
        return true;
    for (auto name : { "importActual"_s, "requireActual"_s }) {
        for (size_t at = source.find(name); at != notFound; at = source.find(name, at + 1)) {
            size_t i = at + name.length();
            if (i + 2 >= source.length() || source[i] != '(' || source[i + 1] != '"')
                return true;
            size_t end = source.find('"', i + 2);
            if (end == notFound || !Bun::isBuiltinModule(source.substring(i + 2, end - i - 2).toString()))
                return true;
        }
    }
    return false;
}

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
    }
    return JSValue::encode(jsUndefined());
}

static JSC::EncodedJSValue mockModule(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, ModuleMockFunction function)
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

    if (!factory && !spy) {
        if (JSC::JSString* manualMock = findManualModuleMock(globalObject, callerPath(vm, callframe), written, specifier))
            factory = manualMock;
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSModuleMock* mock = JSModuleMock::create(vm, globalObject->mockModule.mockModuleStructure.getInitializedOnMainThread(globalObject), factory, specifierString, writtenString, function);
    mock->spy = spy;
    mock->isFromPreload = JSMock__isInPreload(globalObject);
    globalObject->onLoadPlugins.hasTestFileMockedModules |= !mock->isFromPreload;
    // Nothing a builtin imports can import the mock.
    if (exists && !isBuiltinModuleKey(specifier)) {
        auto* factoryFunction = factory ? dynamicDowncast<JSC::JSFunction>(factory) : nullptr;
        if (!factory || factory.isString())
            mock->importsOriginal = true;
        else if (factoryFunction && !factoryFunction->isHostFunction()) {
            auto* executable = factoryFunction->jsExecutable();
            mock->importsOriginal = executable->parameterCount() || mentionsOriginalModule(executable->source().view());
        }
    }

    LoadedModule loaded = findLoadedModule(globalObject, specifierString);
    RETURN_IF_EXCEPTION(scope, {});

    // What is loaded is the original unless an earlier mock was loaded in its place.
    JSModuleMock* previous = registeredModuleMock(globalObject, specifier);
    if (previous) {
        mock->originalExports.setMayBeNull(vm, mock, previous->originalExports.get());
        mock->originalNamespace.setMayBeNull(vm, mock, previous->originalNamespace.get());
        mock->patchedNamespace.setMayBeNull(vm, mock, previous->patchedNamespace.get());
        mock->originalExportsOfEvictedModule.setMayBeNull(vm, mock, previous->originalExportsOfEvictedModule.get());
        if (JSValue exports = previous->originalCommonJSExports.get())
            mock->originalCommonJSExports.set(vm, mock, exports);
    } else {
        if (loaded.esmNamespace)
            mock->originalExports.set(vm, mock, JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure()));
        if (loaded.commonJSModule) {
            JSValue exports = loaded.commonJSModule->exportsObject();
            RETURN_IF_EXCEPTION(scope, {});
            mock->originalCommonJSExports.set(vm, mock, exports);
        }
    }

    JSC::JSPromise* pendingFactory = nullptr;
    // False once the factory has mocked the module again, or removed its mock: that holds.
    bool isCurrent = true;
    if (loaded.esmNamespace || loaded.commonJSModule) {
        pendingFactory = mock->run(globalObject, false);
        RETURN_IF_EXCEPTION(scope, {});
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
    }

    auto& plugins = globalObject->onLoadPlugins;
    if (isCurrent) {
        plugins.addModuleMock(vm, specifier, mock);
        if (previous)
            keepModuleMockOfLoadInFlight(globalObject, previous, specifier, loaded);
        if (previous && previous->isFromPreload && !mock->isFromPreload)
            plugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, previous });

        // The modules an earlier test file loaded have read the original's exports. This file loads them again.
        bool wasLoadedByEarlierTestFile = (mock->originalExports || mock->originalCommonJSExports) && !mock->isFromPreload && (!previous || previous->isFromPreload) && plugins.testFile > 1 && plugins.testFileOfModule.get(specifier) != plugins.testFile;
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
    }

    JSObject* returned = nullptr;
    if (pendingFactory && isCurrent) {
        JSC::JSPromise* patched = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        pendingFactory->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionMockModuleFactoryResolve), globalObject->thenable(jsFunctionMockModuleFactoryReject), patched, mock);
        mock->hasPendingPatch = true;
        returned = patched;
    }

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

static JSC::EncodedJSValue unmock(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, JSValue returned)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto specifier = moduleMockSpecifierArgument(globalObject, callframe, "unmock(module)"_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (JSModuleMock* mock = registeredModuleMock(globalObject, specifier.key)) {
        if (mock->isFromPreload && !JSMock__isInPreload(globalObject))
            globalObject->onLoadPlugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, mock });
        unmockModule(globalObject, mock, specifier.key);
        RETURN_IF_EXCEPTION(scope, {});
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

    JSC::JSPromise* loading = importModuleFrom(globalObject, from, specifier.key);
    RETURN_IF_EXCEPTION(scope, {});
    if (isMocked)
        return JSValue::encode(loading);
    return JSValue::encode(thenWithContext(globalObject, loading, jsFunctionImportMockDidLoad, nullptr, specifier.keyString));
}

// `fromOriginal`: createMockFromModule(), which ignores a mock that is registered and `__mocks__`.
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

// `callFactoriesAgain`: Jest makes the exports of every mock anew after a reset, vitest keeps them.
static JSC::EncodedJSValue resetModules(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, bool callFactoriesAgain)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    ModulesToEvict evict;
    evict.all = true;
    evictModulesAndTheirImporters(globalObject, WTF::move(evict));
    RETURN_IF_EXCEPTION(scope, {});

    // What is linked to a mock goes on reading from it.
    if (auto* virtualModules = callFactoriesAgain ? globalObject->onLoadPlugins.virtualModules : nullptr) {
        for (auto& value : virtualModules->values()) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            if (!mock || mock->state != JSModuleMock::State::Settled)
                continue;
            auto* again = JSModuleMock::create(vm, mock->structure(), mock->factory.get(), mock->specifier.get(), mock->writtenSpecifier.get(), mock->function);
            again->spy = mock->spy;
            again->isFromPreload = mock->isFromPreload;
            again->importsOriginal = mock->importsOriginal;
            again->patchedNamespace.setMayBeNull(vm, again, mock->patchedNamespace.get());
            again->originalExportsOfEvictedModule.setMayBeNull(vm, again, mock->originalExportsOfEvictedModule.get());
            value.set(vm, again);
        }
    }

    return JSValue::encode(callframe->thisValue().toThis(lexicalGlobalObject, JSC::ECMAMode::strict()));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionViResetModules, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return resetModules(globalObject, callframe, false);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionJestResetModules, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
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

extern "C" void JSMock__putModuleMockFunctions(Zig::GlobalObject* globalObject, JSC::EncodedJSValue encodedMockFn, JSC::EncodedJSValue encodedJest, JSC::EncodedJSValue encodedVi)
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

    specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    return isRegisteredModuleMock(globalObject, mock, specifier);
}

// The factory that was to patch a loaded module failed: the module is not mocked, by an earlier mock either.
static void failPendingModulePatch(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, JSValue error)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // What failed may have been script, which may have replaced or removed the mock.
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

// The next test file, or the next run of this one, finds the modules as the preloads left them.
// What the test file has loaded in their place goes, with all that imports it.
static void giveBackPreloadModules(Zig::GlobalObject* globalObject)
{
    auto& plugins = globalObject->onLoadPlugins;
    if (plugins.evictedPreloadModules.isEmpty() && plugins.evictedPreloadCommonJSModules.isEmpty()) [[likely]]
        return;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* loader = globalObject->moduleLoader();
    JSC::JSMap* requireMap = globalObject->requireMap();

    Vector<String> keys;
    for (auto& key : plugins.evictedPreloadModules.keys())
        keys.append(key);
    for (auto& key : plugins.evictedPreloadCommonJSModules.keys())
        keys.append(key);
    Vector<String> loadedInTheirPlace = keys;
    evictModulesAndTheirImporters(globalObject, WTF::move(loadedInTheirPlace));
    RETURN_IF_EXCEPTION(scope, );

    Vector<JSC::AbstractModuleRecord*> records;
    for (auto& key : keys) {
        // (One that is being loaded in its place goes first: this is called again.)
        if (plugins.modulesToEvictOnceLoaded.contains(key))
            continue;
        plugins.testFileOfModule.remove(key);
        if (auto kept = plugins.evictedPreloadModules.take(key)) {
            auto* entry = loader->ensureRegistered(globalObject, JSC::Identifier::fromString(vm, key), JSC::ScriptFetchParameters::Type::JavaScript);
            RETURN_IF_EXCEPTION(scope, );
            if (!entry->record()) {
                records.append(uncheckedDowncast<JSC::AbstractModuleRecord>(kept.get()));
                entry->provideModule(vm, records.last());
                entry->markLoaded();
            }
        }
        if (auto kept = plugins.evictedPreloadCommonJSModules.take(key)) {
            requireMap->set(globalObject, jsString(vm, key), kept.get());
            RETURN_IF_EXCEPTION(scope, );
        }
    }
    // The loader takes what a module has imported for registered.
    for (auto* record : records) {
        record->loadedModules().removeIf([&](auto& loaded) {
            auto* entry = loader->registryEntry(loaded.value.m_module->moduleKey());
            return !entry || entry->record() != loaded.value.m_module.get();
        });
    }
}

extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__undoModuleMocksOfTestFile(Zig::GlobalObject* globalObject, bool nextLoadSharesModules)
{
    auto& plugins = globalObject->onLoadPlugins;
    plugins.testFile++;
    ModulesToEvict evict;
    while (!plugins.runningModuleMocks.isEmpty()) {
        auto* mock = uncheckedDowncast<JSModuleMock>(plugins.runningModuleMocks.last().mock.get());
        evict.abandonedModules.append(mock->specifier->tryGetValue().data);
        mock->abandon(globalObject);
    }
    if (!nextLoadSharesModules)
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    MarkedArgumentBuffer mocks;
    if (plugins.virtualModules) {
        for (auto& value : plugins.virtualModules->values()) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            if (mock && !mock->isFromPreload)
                mocks.append(mock);
        }
    }
    for (size_t i = 0; i < mocks.size(); ++i) {
        auto* mock = uncheckedDowncast<JSModuleMock>(mocks.at(i));
        unmockModule(globalObject, mock, mock->specifier->tryGetValue().data, evict);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
    }

    giveBackPreloadModules(globalObject);
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();

    for (auto& displaced : plugins.displacedPreloadModuleMocks)
        giveLoadedModuleBackToPreloadModuleMock(globalObject, uncheckedDowncast<JSModuleMock>(displaced.get())->specifier->tryGetValue().data);
    for (auto& displaced : std::exchange(plugins.displacedPreloadModuleMocks, {})) {
        auto* mock = uncheckedDowncast<JSModuleMock>(displaced.get());
        String specifier = mock->specifier->tryGetValue().data;
        plugins.addModuleMock(vm, specifier, mock);
        if (!mock->originalExports && !mock->originalCommonJSExports) {
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
    auto* loader = globalObject->moduleLoader();
    if (!loader->registryEntry(key))
        RELEASE_AND_RETURN(scope, loader->provideFetch(globalObject, key, JSC::ScriptFetchParameters::Type::JavaScript, Zig::createObjectModuleSourceCode(vm, exports, key.string())));
}

// A test file that has mocked modules holds on to its own copies of all that imported them, and not only by imports that make it an importer:
// `vi.mock()` turns those into variables. So it goes when it has ended. It is not evaluated again by whatever names or imports it after that:
// a module that has what it exported takes its place.
extern "C" void JSMock__replaceModuleOfTestFile(Zig::GlobalObject* globalObject, const BunString* path)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    giveBackPreloadModules(globalObject);
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
    if (!std::exchange(globalObject->onLoadPlugins.hasTestFileMockedModules, false))
        return;
    auto* entry = globalObject->moduleLoader()->registryEntry(JSC::Identifier::fromString(vm, path->toWTFString()));
    auto* record = entry ? dynamicDowncast<JSC::CyclicModuleRecord>(entry->record()) : nullptr;
    if (!record || record->status() != JSC::CyclicModuleRecord::Status::Evaluated || record->evaluationError())
        return;
    replaceModuleWithItsExports(globalObject, record);
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
}

// The next test file would get a module of this one that is still being loaded, with what that has imported.
extern "C" [[ZIG_EXPORT(nothrow)]] bool JSMock__hasModulesToEvict(Zig::GlobalObject* globalObject)
{
    return !globalObject->onLoadPlugins.modulesToEvictOnceLoaded.isEmpty();
}

// The key is NUL, then this: nothing resolves to a key with a NUL in it, whatever a plugin answers.
static constexpr ASCIILiteral moduleMockEvaluatorName = "bun:module-mock"_s;

static bool isModuleMockEvaluatorKey(const String& key)
{
    return key.length() == moduleMockEvaluatorName.length() + 1 && !key[0] && key.endsWith(moduleMockEvaluatorName);
}

// The next import of the module, or of one that failed with it, calls the factory again.
static void forgetModuleThatFailedToEvaluate(Zig::GlobalObject* globalObject, JSC::AbstractModuleRecord* record)
{
    auto* entry = globalObject->moduleLoader()->registryEntry(record->moduleKey());
    if (!entry || entry->record() != record)
        return;
    evictModulesAndTheirImporters(globalObject, Vector<String> { record->moduleKey().string() });
}

// (If the factory has mocked the module again, `record` reads from that mock.)
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
        // JSModuleMock::giveUp()
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

// evaluate(mock, original) in sourceCodeOfModuleMock().
JSC_DEFINE_HOST_FUNCTION(jsFunctionEvaluateModuleMock, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto* moduleNamespace = dynamicDowncast<JSC::JSModuleNamespaceObject>(callframe->argument(0));
    auto* dependency = dynamicDowncast<JSC::JSModuleNamespaceObject>(callframe->argument(1));
    if (!moduleNamespace || !dependency || !moduleNamespace->moduleRecord()->hasLiveExports())
        return JSValue::encode(jsUndefined());
    RELEASE_AND_RETURN(scope, JSValue::encode(evaluateModuleMock(globalObject, moduleNamespace->moduleRecord(), dependency)));
}

static JSValue evaluateModuleMock(Zig::GlobalObject* globalObject, JSC::AbstractModuleRecord* record, JSC::JSModuleNamespaceObject* dependency)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String specifier = record->moduleKey().string();

    const String& dependencyKey = dependency->moduleRecord()->moduleKey().string();
    bool isOriginal = isModuleOrCopyOfIt(dependencyKey, originalModuleKey(specifier));

    JSModuleMock* mock = registeredModuleMock(globalObject, specifier);
    if (!mock) {
        // Not mocked any more.
        UncheckedKeyHashSet<JSObject*> seen;
        bool readsItself = record->liveExportsSource() || readsExportsOfModule(globalObject, dependency, specifier, seen);
        RETURN_IF_EXCEPTION(scope, {});
        if (!readsItself)
            record->setLiveExportsSource(vm, dependency);
        return jsUndefined();
    }

    // A later mock of the module may be made from another one than this module imported.
    if (isOriginal)
        mock->originalNamespace.set(vm, mock, dependency);
    String wanted = dependencyKeyOfModuleMock(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, {});

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

// Whether the module `start` cannot finish evaluating before the one that `running` mocks, `target`, has. If it can: `unfinished` is what has to
// finish first, and is not in the import chain yet. A module that waits does so for as long as the factory runs, so each is walked through once.
static bool isWaitingForModule(Zig::GlobalObject* globalObject, BunPlugin::OnLoad::RunningModuleMock& running, const String& start, const String& target, Vector<String>& unfinished)
{
    if (running.waitingModules.contains(start))
        return true;

    auto& vm = JSC::getVM(globalObject);
    auto* loader = globalObject->moduleLoader();
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
        if (running.importChain.contains(key))
            return;
        if (auto* record = recordOf(key)) {
            auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(record);
            if (!cyclic || cyclic->isSCCEvaluated())
                return;
        } else if (auto* entry = loader->registryEntry(JSC::Identifier::fromString(vm, key)); entry && isBeingFetchedAsItself(globalObject, entry)) {
            // Another load is fetching it. Whether it imports the mock is not known yet: if it did, and joined the chain, that load would get the original.
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
        // What a module that is still loading imports is only among its loaded modules once all that imports is loaded too.
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

// `key`, or if that module waits for the one that `running` mocks, `mocked`: the key of a copy of it, which the factory has to itself.
// Nothing joins the import chain that this has not been asked about: isWaitingForModule() takes the chain for modules that do not wait.
static String keyOfModuleThatDoesNotWait(Zig::GlobalObject* globalObject, BunPlugin::OnLoad::RunningModuleMock& running, const String& key, const String& mocked)
{
    String instead = key;
    Vector<String> unfinished;
    while (isWaitingForModule(globalObject, running, instead, mocked, unfinished)) {
        instead = originalModuleKey(instead);
        unfinished.clear();
    }
    for (auto& module : unfinished)
        addToImportChain(running, module);
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
}

DEFINE_VISIT_CHILDREN(JSModuleMock);

extern "C" int32_t Bun__onLoadNamespaceLength(const BunString* key);

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
    String path = namespaceLength ? key.substringSharingImpl(namespaceLength + 1) : key;

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

    matches.path = jsString(vm, path);
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

    if (this->mustDoExpensiveRelativeLookup) {
        String joinedPath = path;

        if (path.startsWith("./"_s) || path.startsWith(".."_s)) {
            auto url = WTF::URL::fileURLWithFileSystemPath(from);
            ASSERT(url.isValid());
            joinedPath = URL(url, path).fileSystemPath();
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
    if (!isCurrent)
        return JSC::JSValue::encode(JSC::jsUndefined());

    Zig::LoadedModule loaded = Zig::findLoadedModule(globalObject, mock->specifier.get());
    if (!scope.exception()) [[likely]]
        Zig::overrideLoadedModuleExports(globalObject, mock, loaded);
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
    if (!isCurrent)
        return JSC::JSValue::encode(JSC::jsUndefined());

    scope.release();
    Zig::failPendingModulePatch(globalObject, mock, specifier, callFrame->argument(0));
    return {};
}

extern "C" JSC::EncodedJSValue Bun__runOnResolvePlugins(Zig::GlobalObject* globalObject, const BunString* namespaceString, const BunString* path, const BunString* from)
{
    return globalObject->onResolvePlugins.run(globalObject, namespaceString, path, from);
}

extern "C" bool Bun__hasPlugins(Zig::GlobalObject* globalObject)
{
    return !globalObject->onLoadPlugins.isEmpty() || !globalObject->onResolvePlugins.isEmpty();
}

// Bit 0: an onResolve is registered in the "file" namespace. Bit 1: one is in another namespace.
extern "C" uint8_t Bun__onResolveNamespaces(Zig::GlobalObject* globalObject)
{
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

Structure* createModuleMockStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Zig::JSModuleMock::createStructure(vm, globalObject, prototype);
}

JSC::JSValue runVirtualModule(Zig::GlobalObject* globalObject, BunString* specifier, bool& wasModuleMock, Zig::BunPlugin::OnLoad::Matches& onLoad)
{
    auto fallback = [&]() -> JSC::JSValue {
        return globalObject->onLoadPlugins.run(globalObject, specifier->toWTFString(BunString::ZeroCopy), onLoad);
    };

    if (isBunTest && !Zig::JSMock__isInPreload(globalObject))
        globalObject->onLoadPlugins.testFileOfModule.set(specifier->toWTFString(), globalObject->onLoadPlugins.testFile);

    WTF::String specifierString = specifier->toWTFString(BunString::ZeroCopy);
    if (auto& beingLoaded = globalObject->onLoadPlugins.moduleMocksBeingLoaded; !beingLoaded.isEmpty()) [[unlikely]] {
        auto* moduleMock = dynamicDowncast<Zig::JSModuleMock>(beingLoaded.get(specifierString).get());
        if (moduleMock && moduleMock->state != Zig::JSModuleMock::State::NotCalled) {
            // (Not for a load that starts now: the one it was kept for has made the entry, and has no module yet.)
            auto* entry = globalObject->moduleLoader()->registryEntry(JSC::Identifier::fromString(globalObject->vm(), specifierString));
            if (entry && !entry->record()) {
                wasModuleMock = true;
                return moduleMock;
            }
            beingLoaded.remove(specifierString);
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

JSC::JSPromise* runModuleMock(Zig::GlobalObject* globalObject, JSC::JSObject* moduleMock, bool synchronous)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* mock = Zig::toModuleMock(globalObject, scope, moduleMock);
    RETURN_IF_EXCEPTION(scope, nullptr);

    if (!synchronous && mock->state == Zig::JSModuleMock::State::NotCalled) {
        if (mock->importsOriginal)
            return nullptr;
        // Not under the module loader, which is asking for the module: what the factory loads may import it too.
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
    auto* entry = globalObject->moduleLoader()->registryEntry(key);
    if (entry && Zig::isNeverFetched(entry)) [[unlikely]]
        Zig::evictModulesAndTheirImporters(globalObject, Vector<String> { key.string() });
}

JSC::JSObject* resultOfModuleMock(JSC::JSObject* moduleMock)
{
    auto* mock = dynamicDowncast<Zig::JSModuleMock>(moduleMock);
    return mock && mock->state == Zig::JSModuleMock::State::Settled ? mock->result.get() : nullptr;
}

static JSC::JSObject* generateSettledModuleMock(JSValue source, JSC::JSGlobalObject* globalObject, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* mock = uncheckedDowncast<Zig::JSModuleMock>(source);
    String key = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Since it was fetched the module may have been mocked again, or its mock removed: then whoever waits for it gets this, and nobody else.
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

JSC::JSSourceCode* sourceCodeOfModuleMock(Zig::GlobalObject* globalObject, JSC::JSObject* moduleMock, const String& key, const String& typeAttribute)
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

    // A specifier that starts with NUL is a registry key (GlobalObject::moduleLoaderResolve).
    StringBuilder text;
    // With the type the module was imported with: without it `mock` would be another module than this one.
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
    text.append(";import * as original from "_s);
    appendKey(dependency);
    text.append(";export * from "_s);
    appendKey(dependency);
    text.append(";import evaluate from "_s);
    appendKey(makeString('\0', Zig::moduleMockEvaluatorName));
    text.append(factory && factory.isCallable() ? ";await evaluate(mock, original);"_s : ";evaluate(mock, original);"_s);

    Ref provider = JSC::StringSourceProvider::create(text.toString(), JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(key)), key, JSC::SourceTaintedOrigin::Untainted, WTF::TextPosition(), JSC::SourceProviderSourceType::Module);
    provider->setModuleHasLiveExports();
    return JSC::JSSourceCode::create(vm, JSC::SourceCode(WTF::move(provider)));
}

bool moduleMockImportsByKey(Zig::GlobalObject* globalObject, const String& key)
{
    auto* mock = Zig::registeredModuleMock(globalObject, key);
    if (!mock)
        mock = dynamicDowncast<Zig::JSModuleMock>(globalObject->onLoadPlugins.moduleMocksBeingLoaded.get(key).get());
    return mock && mock->importsOriginal;
}

String keyOfImportWhileModuleMocksRun(Zig::GlobalObject* globalObject, const String& key, const String& importer, bool isESM)
{
    // A module is loaded once at a time. One that is being fetched as a mock which has been removed or replaced since waits for the factory
    // of that mock. Once it, or a module that waits for it, is imported again, that import and whatever waits get what the module is now.
    Vector<Zig::JSModuleMock*, 1> replaced;
    for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
        auto* mock = uncheckedDowncast<Zig::JSModuleMock>(running.mock.get());
        String mocked = mock->specifier->tryGetValue().data;
        if (Zig::isStillRegisteredModuleMock(globalObject, mocked, mock)) [[likely]]
            continue;
        auto* entry = globalObject->moduleLoader()->registryEntry(JSC::Identifier::fromString(globalObject->vm(), mocked));
        Vector<String> unfinished;
        if (entry && !entry->record() && (mocked == key || Zig::isWaitingForModule(globalObject, running, key, mocked, unfinished)))
            replaced.append(mock);
    }
    for (auto* mock : replaced)
        mock->giveUp(globalObject);

    // A module that is still being loaded runs no script: it is the module of this very key that imports, not a copy of it that a factory has.
    auto* importerEntry = globalObject->moduleLoader()->registryEntry(JSC::Identifier::fromString(globalObject->vm(), importer));
    auto* importerRecord = importerEntry ? dynamicDowncast<JSC::CyclicModuleRecord>(importerEntry->record()) : nullptr;
    bool isImporterBeingLoaded = importerRecord && importerRecord->status() == JSC::CyclicModuleRecord::Status::New;

    // Each factory that is running has its say, until all agree: what one is given must not wait for the mock of another that imports it either.
    String given = key;
    String asked;
    while (std::exchange(asked, given) != given) {
        for (auto& running : globalObject->onLoadPlugins.runningModuleMocks) {
            bool isInChain = running.importChain.contains(importer);
            String mocked = uncheckedDowncast<Zig::JSModuleMock>(running.mock.get())->specifier->tryGetValue().data;
            // (Once another mock has taken its place, what the file imports is not the factory's doing.)
            bool isFactory = importer == running.file && (!Zig::registeredModuleMock(globalObject, mocked) || Zig::isStillRegisteredModuleMock(globalObject, mocked, uncheckedDowncast<Zig::JSModuleMock>(running.mock.get())));
            if (!isInChain && !isFactory && (isImporterBeingLoaded || !running.importChainWithoutQuery.contains(importer)))
                continue;
            String instead = given == mocked ? Zig::originalModuleKey(given) : given;
            String copy = Zig::keyOfModuleThatDoesNotWait(globalObject, running, instead, mocked);
            if (isESM)
                instead = copy;
            else
                Zig::addToImportChain(running, instead);
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
    auto moduleMocksBeingLoaded = std::exchange(plugins.moduleMocksBeingLoaded, {});
    auto runningModuleMocks = std::exchange(plugins.runningModuleMocks, {});
    plugins.clear();
    plugins.moduleMocksBeingLoaded = WTF::move(moduleMocksBeingLoaded);
    plugins.runningModuleMocks = WTF::move(runningModuleMocks);
    global->onResolvePlugins.clear();

    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPlugin, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return Bun::setupBunPlugin(globalObject, callframe, BunPluginTargetBun);
}
