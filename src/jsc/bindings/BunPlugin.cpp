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
#include "ModuleGraph.h"
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
    ModuleMockFunction function;
    // The factory's promise is pending and will patch the already-loaded module when it settles.
    bool hasPendingPatch { false };
    bool spy { false };
    bool isFromPreload { false };
    // unmockModule() registers that module under its own key again.
    bool hasSetLoadedModuleAside { false };
    // Loaded as a generated ES module that imports the original (or the `__mocks__` file) and calls the factory when evaluated.
    bool importsOriginal { false };

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
    JSC::JSPromise* promise = Bun::testFileModuleLoader(globalObject)->requestImportModule(globalObject, JSC::Identifier::fromString(vm, specifier), JSC::Identifier::fromString(vm, from), nullptr, nullptr);
    if (scope.exception()) [[unlikely]]
        return JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope);
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
static JSC::JSPromise* importOriginalModule(Zig::GlobalObject*, JSModuleMock*, bool mayLoadOthersFirst, const String& from);
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
    JSC::JSPromise* loading = importOriginalModule(defaultGlobalObject(lexicalGlobalObject), mock, false, String());
    if (scope.exception()) [[unlikely]]
        original->rejectWithCaughtException(vm, scope);
    else
        original->pipeFrom(vm, loading);
    return JSValue::encode(jsUndefined());
}

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
    JSC::JSPromise* loading = importsMock ? importModuleKey(globalObject, specifier) : importOriginalModule(globalObject, mock, false, String());
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

__attribute__((minsize)) static JSC::JSPromise* importOriginalModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, bool mayLoadOthersFirst = true, const String& from = String())
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

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
    if (!exports && mock->originalCommonJSExports) {
        exports = esmExportsOfCommonJSExports(globalObject, mock->originalCommonJSExports.get());
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
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
        addToImportChain(globalObject, *running, key);
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

static void addHoistingNote(JSC::VM& vm, JSValue error)
{
    String message = messageOfUninitializedVariableError(vm, error);
    if (message.isNull())
        return;
    uncheckedDowncast<JSC::ErrorInstance>(error)->putDirect(vm, vm.propertyNames->message, jsString(vm, makeString(message, "\nnote: vi.mock() and jest.mock() are hoisted above the file's imports and top-level variables, so a factory can't use them. Declare what it needs with vi.hoisted()."_s)), static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
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
        // The context survives the factory's awaits, so an import() it makes later can still be traced back to it.
        globalObject->setAsyncContextTrackingEnabled(true);
        auto* asyncContext = globalObject->m_asyncContextData.get();
        JSValue previous = asyncContext->getInternalField(0);
        asyncContext->putInternalField(vm, 0, Bun::createAsyncContextFrame(globalObject, this, previous));
        JSValue result = JSC::profiledCall(globalObject, ProfilingReason::API, factoryValue, JSC::getCallData(factoryValue), JSC::jsUndefined(), arguments);
        asyncContext->putInternalField(vm, 0, previous);
        RELEASE_AND_RETURN(scope, result);
    }

    if (!dependency && !factoryValue && !spy)
        dependency = originalNamespace.get();
    if (dependency)
        RELEASE_AND_RETURN(scope, exportsOfModuleMockWithoutFactory(globalObject, this, dependency));

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
    if (isHoisted())
        addHoistingNote(globalObject->vm(), error);
    didStopRunning(globalObject, this);
}

void JSModuleMock::abandon(Zig::GlobalObject* globalObject)
{
    state = State::NotCalled;
    result.clear();
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
    globalObject->onLoadPlugins.runningModuleMocks.append(BunPlugin::OnLoad::RunningModuleMock { JSC::Strong<JSC::JSObject> { vm, this }, fileOfFunction(factory.get()), {}, {}, {}, {} });

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
    return !entry->record() && entry->status() == JSC::ModuleRegistryEntry::Status::Fetching && isFetchedWithoutFactory(globalObject, entry->key().string());
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
__attribute__((noinline)) static void rankWaitingModuleMocks(Zig::GlobalObject* globalObject)
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
    auto addFetch = [&](const String& key, JSC::JSPromise* fetch) {
        fetches.append(fetch);
        isReadingFile = isReadingFile || !isLoadedByPlugin(globalObject, key);
    };
    // A mock passed to import() gets its own turn right away, even if another load also imports it and already has a factory running. Vitest does the same.
    Vector<bool> isAskedForDirectly;
    isAskedForDirectly.fill(false, plugins.waitingModuleMocks.size());
    size_t askedForDirectly = 0;
    for (auto& key : plugins.modulesAskedFor) {
        if (auto index = indexOf.find(JSC::Identifier::fromString(vm, key).impl()); index != indexOf.end()) {
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
        if (load == loads.size() && !hasOtherLoads && found.size() + askedForDirectly < indexOf.size()) {
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

    // Nothing unfinished imports these: import() asked for them.
    for (auto& [key, index] : indexOf) {
        if (seen.contains(key) && !isAskedForDirectly[index])
            continue;
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

    // Like Vitest, vi.mock() and vi.doMock() throw on an export the factory left out. For mock.module() and jest.mock() it's undefined.
    if (!mock->isOfVitest())
        return false;
    // Promise resolution probes `then` and CommonJS interop probes `__esModule`, so those must not throw.
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
        // A getter above may have re-mocked or unmocked the module, and that wins.
        if (!isStillRegisteredModuleMock(globalObject, specifier, registered))
            return;

        if (JSObject* overwritten = mock->originalExports.get()) {
            static std::atomic<unsigned> patches { 0 };
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

        if (mock->originalExports && !mock->originalExportsOfEvictedModule)
            mock->patchedNamespace.set(vm, mock, moduleNamespaceObject);
        for (size_t i = 0; i < names.size(); ++i) {
            moduleNamespaceObject->overrideExportValue(globalObject, names[i], values.at(i));
            RETURN_IF_EXCEPTION(scope, );
        }
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

static void addRequirer(Zig::GlobalObject* globalObject, ModuleImporters& importersOf, Bun::JSCommonJSModule* importer, JSValue importedValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* imported = importedValue ? dynamicDowncast<Bun::JSCommonJSModule>(importedValue) : nullptr;
    if (!imported || !importer->filename().isString() || !imported->filename().isString())
        return;
    JSValue registered = JSValue::decode(JSC__JSMap__get(Bun::testFileRequireMap(globalObject), globalObject, JSValue::encode(imported->filename())));
    RETURN_IF_EXCEPTION(scope, );
    if (registered != imported)
        return;
    String importerKey = asString(importer->filename())->value(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    String importedKey = asString(imported->filename())->value(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    addImporter(importersOf, importerKey, importedKey);
}

static bool isInNodeModules(const String& path)
{
    return path.contains(makeString(PLATFORM_SEP, "node_modules"_s, PLATFORM_SEP));
}

struct ModulesToEvict {
    Vector<String> modules;
    // Patched in place: these stay registered, but their exports changed, so their importers go.
    Vector<String> patchedESModules;
    Vector<String> patchedCommonJSModules;
    // Mocked modules whose factory was abandoned, so their pending fetch never settles.
    Vector<String> abandonedModules;
    bool all { false };
    // With `all`: modules in node_modules stay, as in Vitest, which doesn't load packages through the registry it resets.
    bool exceptPackages { false };
    // Packages that vi.mock() no longer mocks. See setLoadedModuleAside().
    Vector<String> packagesToBringBack;
    bool onlyImportersFromEarlierTestFiles { false };
    // Forces a pass even with nothing listed, to sweep the modules that failed to load or threw.
    bool isEndOfTestFile { false };
    bool hasLoadSettled { false };
};

static JSC::JSPromise* pendingLoadOf(JSC::JSGlobalObject* globalObject, JSC::ModuleRegistryEntry* entry)
{
    JSC::JSPromise* promise = entry->loadPromise();
    if (!promise && entry->status() == JSC::ModuleRegistryEntry::Status::Fetching)
        promise = entry->ensureModulePromise(globalObject);
    return promise && promise->status() == JSC::JSPromise::Status::Pending ? promise : nullptr;
}

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
__attribute__((minsize)) static void evictModulesAndTheirImporters(Zig::GlobalObject* globalObject, ModulesToEvict&& evict)
{
    auto& plugins = globalObject->onLoadPlugins;
    Vector<String>& keys = evict.modules;
    keys.removeAllMatching([&](const String& key) { return plugins.modulesToEvictOnceLoaded.contains(key); });
    if (keys.isEmpty() && evict.patchedESModules.isEmpty() && evict.patchedCommonJSModules.isEmpty() && evict.abandonedModules.isEmpty() && evict.packagesToBringBack.isEmpty() && !evict.all && !evict.isEndOfTestFile && !evict.hasLoadSettled)
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* loader = Bun::testFileModuleLoader(globalObject);
    JSC::JSMap* requireMap = Bun::testFileRequireMap(globalObject);

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
        bool isEvictedWithAll = evict.all && !(evict.exceptPackages && isInNodeModules(key));
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
            auto* registered = loader->registryEntry(imported->moduleKey());
            if (registered && registered->record() == imported)
                addImporter(importersOf, key, imported->moduleKey().string());
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

    auto* iterator = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), requireMap, JSC::IterationKind::Entries);
    RETURN_IF_EXCEPTION(scope, );
    JSValue requireKey, value;
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
            addRequirer(globalObject, importersOf, parent, commonJSModule);
            RETURN_IF_EXCEPTION(scope, );
        }
        for (auto& child : commonJSModule->m_children) {
            addRequirer(globalObject, importersOf, commonJSModule, child.get());
            RETURN_IF_EXCEPTION(scope, );
        }
        if (auto* children = commonJSModule->m_childrenValue ? dynamicDowncast<JSC::JSArray>(commonJSModule->m_childrenValue.get()) : nullptr) {
            for (unsigned i = 0; i < children->length(); ++i) {
                // canGetIndexQuickly() skips accessors, so no script runs here.
                addRequirer(globalObject, importersOf, commonJSModule, children->canGetIndexQuickly(i) ? children->getIndexQuickly(i) : JSValue());
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
            // It imported the real package before vi.mock() mocked it, and never the mock.
            if (isInNodeModules(importer) && evict.packagesToBringBack.contains(key))
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

__attribute__((minsize)) static void unmockModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, ModulesToEvict& evict)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules)
        virtualModules->remove(specifier);

    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, );
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

// Returns true if importers can only reach the mock through resolveVirtualModule()'s relative lookup.
__attribute__((minsize)) static bool resolveModuleMockSpecifier(Zig::GlobalObject* globalObject, JSC::CallFrame* callframe, JSC::JSString*& specifierString, WTF::String& specifier, bool& exists)
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

// Whether a module outside node_modules is linked to `record` and has yet to run. `running` is the one that asks.
__attribute__((minsize)) static bool isImportedByModuleYetToRun(Zig::GlobalObject* globalObject, JSC::AbstractModuleRecord* record, const String& running)
{
    for (auto& [mapKey, entry] : Bun::testFileModuleLoader(globalObject)->moduleMap()) {
        auto* importer = dynamicDowncast<JSC::CyclicModuleRecord>(entry->record());
        if (!importer || importer->status() < JSC::CyclicModuleRecord::Status::Linked || importer->status() > JSC::CyclicModuleRecord::Status::Evaluating)
            continue;
        String key(mapKey.first);
        if (key == running || isInNodeModules(key))
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
    }

    LoadedModule loaded = findLoadedModule(globalObject, specifierString);
    RETURN_IF_EXCEPTION(scope, {});
    JSModuleMock* previous = registeredModuleMock(globalObject, specifier);

    // Like Vitest, vi.mock() in a test file doesn't patch a module that a preload loaded. The file loads its own mocked copy,
    // and the preload's module is restored when the file ends. mock.module() and jest.mock() patch it in place.
    // Nor does it patch a package, which vi.resetModules() leaves loaded, or what vi.importActual() returned: the factory has to stay lazy.
    // Nor does vi.doMock() patch what a test file loaded. This file's importers keep it. What an earlier file left is loaded again: in Vitest a file starts with nothing loaded.
    bool isDoMock = function == ModuleMockFunction::ViDoMock;
    unsigned loadedByTestFile = globalObject->onLoadPlugins.testFileOfModule.get(specifier);
    bool wasLoadedByImportActual = globalObject->onLoadPlugins.loadedByImportActual.remove(specifier);
    bool staysTheOriginal = wasLoadedByImportActual || isInNodeModules(specifier) || (isDoMock && loadedByTestFile == globalObject->onLoadPlugins.testFile);
    bool leavesLoadedModuleAlone = mock->isOfVitest() && Bun::isBunTest && !mock->isFromPreload && !isBuiltinModuleKey(specifier) && (!loadedByTestFile || staysTheOriginal || isDoMock);
    // In Vitest a module that has yet to run imports it after this call, and gets the mock. Here it is linked already, so only a patch reaches it.
    if (leavesLoadedModuleAlone && loaded.esmNamespace && isImportedByModuleYetToRun(globalObject, loaded.esmNamespace->moduleRecord(), callerPath(vm, callframe)))
        leavesLoadedModuleAlone = false;
    if (leavesLoadedModuleAlone && previous && !previous->isFromPreload) {
        unmockModule(globalObject, previous, specifier);
        RETURN_IF_EXCEPTION(scope, {});
        previous = nullptr;
        loaded = findLoadedModule(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }
    bool isLoadInFlight = loaded.staleESMEntry;
    if (leavesLoadedModuleAlone && staysTheOriginal && (loaded.esmNamespace || loaded.commonJSModule)) {
        setLoadedModuleAside(globalObject, specifier);
        RETURN_IF_EXCEPTION(scope, {});
        mock->hasSetLoadedModuleAside = !wasLoadedByImportActual;
        loaded = findLoadedModule(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }
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

    // With an earlier mock in place, what's loaded isn't the original any more, so inherit what that mock saved.
    if (previous && !leavesLoadedModuleAlone) {
        mock->originalExports.setMayBeNull(vm, mock, previous->originalExports.get());
        mock->originalNamespace.setMayBeNull(vm, mock, previous->originalNamespace.get());
        mock->patchedNamespace.setMayBeNull(vm, mock, previous->patchedNamespace.get());
        mock->originalExportsOfEvictedModule.setMayBeNull(vm, mock, previous->originalExportsOfEvictedModule.get());
        mock->patchOrder = previous->patchOrder;
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
    // False once the factory itself has re-mocked or unmocked the module, which wins.
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
    // Its functions are the mock's from here on. What the body assigns is the mock's once it is patched again.
    if (bodyYetToRun && isCurrent)
        pendingFactory = thenWithContext(globalObject, bodyYetToRun, jsFunctionBodyOfPatchedModuleDidRun, nullptr, mock);

    auto& plugins = globalObject->onLoadPlugins;
    if (isCurrent) {
        plugins.addModuleMock(vm, specifier, mock);
        if (previous && isLoadInFlight)
            keepModuleMockOfLoadInFlight(globalObject, previous, specifier, loaded);
        if (previous && previous->isFromPreload && !mock->isFromPreload)
            plugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, previous });

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

    LoadedModule loaded = findLoadedModule(globalObject, specifier.keyString);
    RETURN_IF_EXCEPTION(scope, {});
    // What a preload loads is given back to the next test file under its own key.
    if (!loaded.esmNamespace && !loaded.commonJSModule && !loaded.staleESMEntry && !loaded.staleCommonJSEntry && !JSMock__isInPreload(globalObject))
        globalObject->onLoadPlugins.loadedByImportActual.add(specifier.key);
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

    specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    return isRegisteredModuleMock(globalObject, mock, specifier);
}

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

extern "C" [[ZIG_EXPORT(nothrow)]] __attribute__((minsize)) void JSMock__undoModuleMocksOfTestFile(Zig::GlobalObject* globalObject, bool nextLoadSharesModules)
{
    auto& plugins = globalObject->onLoadPlugins;
    plugins.testFile++;
    plugins.loadedByImportActual.clear();
    ModulesToEvict evict;
    for (auto& waiting : std::exchange(plugins.waitingModuleMocks, {}))
        evict.abandonedModules.append(uncheckedDowncast<JSModuleMock>(waiting.mock.get())->specifier->tryGetValue().data);
    plugins.moduleMocksWithTurn.clear();
    plugins.modulesGivenTimeToRequestImports.clear();
    plugins.modulesAskedFor.clear();
    plugins.fetchesOfModulesAskedFor.clear();
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
    Vector<JSModuleMock*> lastPatchFirst;
    for (size_t i = 0; i < mocks.size(); ++i)
        lastPatchFirst.append(uncheckedDowncast<JSModuleMock>(mocks.at(i)));
    std::ranges::sort(lastPatchFirst, [](auto* a, auto* b) { return a->patchOrder > b->patchOrder; });
    for (auto* mock : lastPatchFirst) {
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
    auto* entry = Bun::testFileModuleLoader(globalObject)->registryEntry(JSC::Identifier::fromString(vm, testFile));
    auto* record = entry ? dynamicDowncast<JSC::CyclicModuleRecord>(entry->record()) : nullptr;
    if (record && record->status() == JSC::CyclicModuleRecord::Status::Evaluated && !record->evaluationError()) {
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
static String keyOfModuleThatDoesNotWait(Zig::GlobalObject* globalObject, BunPlugin::OnLoad::RunningModuleMock& running, const String& key, const String& mocked)
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

static JSC::JSObject* generateSettledModuleMock(JSValue source, JSC::JSGlobalObject* globalObject, Vector<JSC::Identifier, 4>& exportNames, JSC::MarkedArgumentBuffer& exportValues)
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

// Vitest loads packages outside the module graph it mocks, so a module in node_modules gets the original of what vi.mock() mocked.
// Jest's mocks reach packages too.
String keyOfImportByPackage(Zig::GlobalObject* globalObject, const String& key, const String& importer)
{
    if (!Zig::isInNodeModules(importer) || Zig::isBuiltinModuleKey(key))
        return key;
    auto* mock = Zig::registeredModuleMock(globalObject, key);
    // A module that was patched in place is the only instance there is.
    bool hasOriginal = mock && mock->isOfVitest() && !mock->originalExports && !mock->originalCommonJSExports;
    return hasOriginal ? Zig::originalModuleKey(key) : key;
}

// Whether some unfinished module imports both, directly or through other modules. The factories of two loads run at the same time.
// If a third load imports both modules, the later factory waits for the earlier one's mock, as if one load had called both.
__attribute__((minsize)) static bool haveUnfinishedImporterInCommon(Zig::GlobalObject* globalObject, const String& earlier, const String& later)
{
    Zig::ModuleImporters importersOf;
    for (auto& [mapKey, entry] : Bun::testFileModuleLoader(globalObject)->moduleMap()) {
        auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(entry->record());
        if (!cyclic || cyclic->isSCCEvaluated())
            continue;
        for (auto& resolved : cyclic->resolvedRequests().values())
            Zig::addImporter(importersOf, String(mapKey.first), String { resolved.get() });
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
    auto waitingModuleMocks = std::exchange(plugins.waitingModuleMocks, {});
    auto moduleMocksWithTurn = std::exchange(plugins.moduleMocksWithTurn, {});
    plugins.clear();
    plugins.moduleMocksBeingLoaded = WTF::move(moduleMocksBeingLoaded);
    plugins.runningModuleMocks = WTF::move(runningModuleMocks);
    plugins.waitingModuleMocks = WTF::move(waitingModuleMocks);
    plugins.moduleMocksWithTurn = WTF::move(moduleMocksWithTurn);
    global->onResolvePlugins.clear();

    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPlugin, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return Bun::setupBunPlugin(globalObject, callframe, BunPluginTargetBun);
}
