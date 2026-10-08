#include "BunPlugin.h"

#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSCast.h"
#include "headers-handwritten.h"
#include "helpers.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSMap.h>
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
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/JavaScript.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/RegularExpression.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/SyntheticModuleRecord.h>
#include <wtf/Deque.h>
#include <wtf/SetForScope.h>
#include <wtf/text/WTFString.h>

#include "BunClientData.h"
#include "BuiltinModuleKeys.h"
#include "JSCommonJSModule.h"
#include "ModuleLoader.h"
#include "PathInlines.h"
#include "isBuiltinModule.h"
#include "AsyncContextFrame.h"
#include "ImportMetaObject.h"

namespace Zig {

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

    return JSValue::encode(callframe->thisValue());
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

    Zig::GlobalObject* global = defaultGlobalObject(globalObject);

    if (global->onLoadPlugins.virtualModules == nullptr) {
        global->onLoadPlugins.virtualModules = new BunPlugin::VirtualModuleMap;
    }
    auto* virtualModules = global->onLoadPlugins.virtualModules;

    virtualModules->set(moduleId, JSC::Strong<JSC::JSObject> { vm, uncheckedDowncast<JSC::JSObject>(functionValue) });

    auto* requireMap = global->requireMap();
    RETURN_IF_EXCEPTION(scope, {});
    requireMap->remove(globalObject, moduleIdValue);
    RETURN_IF_EXCEPTION(scope, {});

    if (moduleIdValue.isString()) {
        auto idIdent = JSC::Identifier::fromString(vm, asString(moduleIdValue)->value(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        global->moduleLoader()->removeEntry(idIdent); // takes the loader's cellLock itself
    }

    return JSValue::encode(callframe->thisValue());
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

    return JSValue::encode(callframe->thisValue());
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

class JSModuleMock final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    enum class State : uint8_t {
        NotCalled,
        Calling,
        Called,
    };

    // A function, the path of a `__mocks__` file (a string), or empty: the exports are mocks of the original's.
    WriteBarrier<Unknown> factory;
    // What the factory made: the exports, a CommonJS module that has them as `module.exports`, or a promise for either.
    WriteBarrier<JSObject> result;
    WriteBarrier<JSString> specifier;
    // Set when the ES module was loaded first and so is patched in place: the values overwritten, by export name (itself: there was none yet).
    WriteBarrier<JSObject> originalExports;
    // The same for the require.cache entry: its `module.exports`.
    WriteBarrier<Unknown> originalCommonJSExports;
    // Pending while the original loads under its own registry key.
    WriteBarrier<JSPromise> originalPromise;
    State state { State::NotCalled };
    // The factory's promise is pending and will patch the already-loaded module when it settles.
    bool hasPendingPatch { false };
    bool spy { false };
    bool isHoisted { false };
    bool isFromPreload { false };

    static JSModuleMock* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue factory, JSC::JSString* specifier);
    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    // `synchronous`: for require(), which cannot wait for the original or a `__mocks__` file to load.
    JSObject* executeOnce(Zig::GlobalObject* globalObject, bool synchronous);
    bool waitsForOriginal() const;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSModuleMock, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSModuleMock, m_subspaceForJSModuleMock));
    }

    void finishCreation(JSC::VM&);

private:
    JSModuleMock(JSC::VM&, JSC::Structure*, JSC::JSValue factory, JSC::JSString* specifier);

    JSValue callFactory(Zig::GlobalObject* globalObject, bool synchronous);
};

const JSC::ClassInfo JSModuleMock::s_info = { "ModuleMock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleMock) };

JSModuleMock* JSModuleMock::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue factory, JSC::JSString* specifier)
{
    JSModuleMock* ptr = new (NotNull, JSC::allocateCell<JSModuleMock>(vm)) JSModuleMock(vm, structure, factory, specifier);
    ptr->finishCreation(vm);
    return ptr;
}

void JSModuleMock::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

JSModuleMock::JSModuleMock(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue factory, JSC::JSString* specifier)
    : Base(vm, structure)
    , factory(factory, JSC::WriteBarrierEarlyInit)
    , specifier(specifier, JSC::WriteBarrierEarlyInit)
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

static JSModuleMock* registeredModuleMock(Zig::GlobalObject* globalObject, const String& specifier)
{
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;
    if (!virtualModules)
        return nullptr;
    auto entry = virtualModules->find(specifier);
    return entry == virtualModules->end() ? nullptr : dynamicDowncast<JSModuleMock>(entry->value.get());
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
    auto* entry = globalObject->moduleLoader()->registryEntry(specifierIdent);
    if (!entry)
        return;

    loaded.staleESMEntry = true;
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

    JSValue entryValue = globalObject->requireMap()->get(globalObject, specifierString);
    RETURN_IF_EXCEPTION(scope, );
    if (entryValue) {
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
    JSValue entry = globalObject->requireMap()->get(globalObject, jsString(vm, key));
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

// From `start` to a module that imports `target`. An importer only records a module once all that module imports is loaded, so this resolves the requests.
static Vector<String> findImportChain(Zig::GlobalObject* globalObject, JSC::AbstractModuleRecord* start, const String& target)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    UncheckedKeyHashMap<JSC::AbstractModuleRecord*, JSC::AbstractModuleRecord*> importerOf;
    Deque<JSC::AbstractModuleRecord*> queue;
    importerOf.add(start, nullptr);
    queue.append(start);
    while (!queue.isEmpty()) {
        auto* record = queue.takeFirst();
        BunString from = Bun::toString(record->moduleKey().string());
        for (auto& request : record->requestedModules()) {
            JSValue resolved = JSValue::decode(Bun__resolveSyncWithSourceIfExists(globalObject, JSValue::encode(jsString(vm, request.m_specifier.string())), &from, true));
            RETURN_IF_EXCEPTION(scope, {});
            if (!resolved.isString())
                continue;
            String key = asString(resolved)->tryGetValue().data;
            if (key == target) {
                Vector<String> chain;
                for (; record; record = importerOf.get(record))
                    chain.append(record->moduleKey().string());
                chain.reverse();
                return chain;
            }
            auto* entry = globalObject->moduleLoader()->registryEntry(JSC::Identifier::fromString(vm, key));
            if (entry && entry->record() && importerOf.add(entry->record(), record).isNewEntry)
                queue.append(entry->record());
        }
    }
    return {};
}

bool JSModuleMock::waitsForOriginal() const
{
    auto* original = originalPromise.get();
    if (!original || original->status() != JSC::JSPromise::Status::Pending)
        return false;
    if (state != State::Called)
        return state == State::Calling;
    auto* promise = dynamicDowncast<JSC::JSPromise>(result.get());
    return promise && promise->status() == JSC::JSPromise::Status::Pending;
}

// The mock waits for the original. If the original's imports wait for the mock, none of them would ever settle.
static void rejectOriginalThatImportsItsMock(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& plugins = globalObject->onLoadPlugins;
    if (!mock->waitsForOriginal() || plugins.isLookingForModuleMockCycle)
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    String key = mock->specifier->tryGetValue().data;
    auto* entry = globalObject->moduleLoader()->registryEntry(JSC::Identifier::fromString(vm, originalModuleKey(key)));
    if (!entry || !entry->record())
        return;

    // Resolving asks about virtual modules, which looks for cycles.
    SetForScope isLooking(plugins.isLookingForModuleMockCycle, true);
    Vector<String> chain = findImportChain(globalObject, entry->record(), key);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return;
    }
    if (chain.isEmpty())
        return;

    StringBuilder message;
    message.append("Circular import: "_s, key);
    for (size_t i = 1; i < chain.size(); ++i)
        message.append(" -> "_s, chain[i]);
    message.append(" -> "_s, key, "\nThe original of a mocked module cannot be loaded while a module that imports the mock is one of the original's own imports."_s);
    mock->originalPromise->rejectPromise(vm, JSC::createError(globalObject, message.toString()));
}

static JSC::JSPromise* importOriginalModule(Zig::GlobalObject* globalObject, JSModuleMock* mock)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* loading = mock->originalPromise.get(); loading && loading->status() == JSC::JSPromise::Status::Pending) {
        rejectOriginalThatImportsItsMock(globalObject, mock);
        return loading;
    }

    JSObject* exports = esmExportsBeforePatches(globalObject, mock);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!exports && mock->originalCommonJSExports) {
        exports = esmExportsOfCommonJSExports(globalObject, mock->originalCommonJSExports.get());
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    if (exports)
        RELEASE_AND_RETURN(scope, JSC::JSPromise::resolvedPromise(globalObject, exports));

    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSC::JSPromise* loading = importModuleKey(globalObject, originalModuleKey(specifier));
    RETURN_IF_EXCEPTION(scope, nullptr);
    // Its own promise: an import cycle through the mock rejects it while `loading` can never settle.
    JSC::JSPromise* original = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    original->pipeFrom(vm, loading);
    mock->originalPromise.set(vm, mock, original);
    return original;
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
    BunString specifierString = Bun::toString(specifier);
    JSValue builtin = Bun::resolveAndFetchBuiltinModule(globalObject, &specifierString);
    RETURN_IF_EXCEPTION(scope, {});
    if (builtin)
        return builtin;
    RELEASE_AND_RETURN(scope, requireModuleKey(globalObject, specifier, originalModuleKey(specifier)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockImportOriginal, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(importOriginalModule(defaultGlobalObject(lexicalGlobalObject), uncheckedDowncast<JSModuleMock>(callframe->thisValue())));
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
        RETURN_IF_EXCEPTION(scope, {});
    }
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

    String specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    bool isCommonJS = false;
    JSValue mocked = mockExportsOfLoadedModule(globalObject, originalModuleKey(specifier), moduleNamespace, mock->spy, isCommonJS);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!isCommonJS)
        return mocked.getObject();
    RELEASE_AND_RETURN(scope, Bun::JSCommonJSModule::create(globalObject, mock->specifier.get(), mocked, true, jsUndefined()));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockDidLoadOriginal, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(exportsOfModuleMockWithoutFactory(defaultGlobalObject(lexicalGlobalObject), uncheckedDowncast<JSModuleMock>(callframe->argument(1)), callframe->argument(0)));
}

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

// May be called with `error` still being thrown.
static void addHoistingNote(JSC::VM& vm, JSValue error)
{
    auto* instance = dynamicDowncast<JSC::ErrorInstance>(error);
    if (!instance || instance->errorType() != JSC::ErrorType::ReferenceError)
        return;
    JSValue messageValue = instance->getDirect(vm, vm.propertyNames->message);
    if (!messageValue || !messageValue.isString())
        return;
    String message = asString(messageValue)->tryGetValue().data;
    if (!message.startsWith("Cannot access "_s) || !(message.endsWith("before initialization."_s) || message.endsWith("uninitialized variable."_s)))
        return;
    instance->putDirect(vm, vm.propertyNames->message, jsString(vm, makeString(message, "\nnote: vi.mock() and jest.mock() run before the imports and the top-level variables of the file, so a factory cannot use them. Declare what it needs with vi.hoisted()."_s)), static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleMockFactoryDidReject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    addHoistingNote(vm, callframe->argument(0));
    scope.throwException(globalObject, callframe->argument(0));
    return {};
}

JSValue JSModuleMock::callFactory(Zig::GlobalObject* globalObject, bool synchronous)
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

    if (synchronous) {
        String key = (factoryValue ? asString(factoryValue) : specifier.get())->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue moduleNamespace = importModuleKeySync(globalObject, factoryValue ? key : originalModuleKey(key));
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, exportsOfModuleMockWithoutFactory(globalObject, this, moduleNamespace));
    }

    JSC::JSPromise* loading;
    if (factoryValue) {
        String key = asString(factoryValue)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        loading = importModuleKey(globalObject, key);
    } else
        loading = importOriginalModule(globalObject, this);
    RETURN_IF_EXCEPTION(scope, {});
    return thenWithContext(globalObject, loading, jsFunctionModuleMockDidLoadOriginal, nullptr, this);
}

JSObject* JSModuleMock::executeOnce(Zig::GlobalObject* globalObject, bool synchronous)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    switch (state) {
    case State::Called:
        return result.get();
    case State::Calling: {
        String specifierString = specifier->value(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        scope.throwException(globalObject, JSC::createError(globalObject, makeString("Circular import: \""_s, specifierString, "\" is imported by a module that its own mock factory loads while it runs"_s)));
        return nullptr;
    }
    case State::NotCalled:
        break;
    }

    state = State::Calling;
    JSValue value = callFactory(globalObject, synchronous);
    state = State::NotCalled;
    if (auto* exception = scope.exception()) [[unlikely]] {
        if (isHoisted && !vm.isTerminationException(exception))
            addHoistingNote(vm, exception->value());
        return nullptr;
    }

    if (!value.isObject()) {
        throwFactoryMustReturnObject(globalObject, scope);
        return nullptr;
    }

    if (auto* promise = isHoisted ? dynamicDowncast<JSC::JSPromise>(value) : nullptr) {
        if (promise->status() == JSC::JSPromise::Status::Rejected)
            addHoistingNote(vm, promise->result());
        else if (promise->status() == JSC::JSPromise::Status::Pending)
            value = thenWithContext(globalObject, promise, nullptr, jsFunctionModuleMockFactoryDidReject, jsUndefined());
    }

    state = State::Called;
    result.set(vm, this, value.getObject());
    return value.getObject();
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionCallModuleMockFactory, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(uncheckedDowncast<JSModuleMock>(callframe->argument(1))->executeOnce(defaultGlobalObject(lexicalGlobalObject), false));
}

static void overrideLoadedModuleExports(Zig::GlobalObject* globalObject, JSModuleMock* mock, const LoadedModule& loaded, JSC::JSObject* exports)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* commonJSExports = dynamicDowncast<Bun::JSCommonJSModule>(exports);

    if (auto* moduleNamespaceObject = loaded.esmNamespace) {
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
    JSValue registered = globalObject->requireMap()->get(globalObject, imported->filename());
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
    // Patched in place, these stay: what they export changed, so only the modules that import them go.
    Vector<String> patchedModules;
};

// A module stays linked to what it imported, so the importers go too. What a preload loaded stays: nothing loads a preload again.
static void evictModulesAndTheirImporters(Zig::GlobalObject* globalObject, ModulesToEvict&& evict, bool onlyImportersFromEarlierTestFiles = false)
{
    if (evict.modules.isEmpty() && evict.patchedModules.isEmpty())
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* loader = globalObject->moduleLoader();
    JSC::JSMap* requireMap = globalObject->requireMap();

    ModuleImporters importersOf;
    for (auto& [mapKey, entry] : loader->moduleMap()) {
        auto* record = entry->record();
        if (!record)
            continue;
        for (auto& loaded : record->loadedModules().values()) {
            auto* imported = loaded.m_module.get();
            auto* registered = loader->registryEntry(imported->moduleKey());
            if (registered && registered->record() == imported)
                addImporter(importersOf, String(mapKey.first), imported->moduleKey().string());
        }
    }

    auto* iterator = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), requireMap, JSC::IterationKind::Values);
    RETURN_IF_EXCEPTION(scope, );
    JSValue value;
    while (iterator->next(globalObject, value)) {
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
                addRequirer(globalObject, importersOf, commonJSModule, children->getDirectIndex(globalObject, i));
                RETURN_IF_EXCEPTION(scope, );
            }
        }
    }

    auto& plugins = globalObject->onLoadPlugins;
    Vector<String>& keys = evict.modules;
    UncheckedKeyHashSet<String> evicted;
    for (auto& key : keys)
        evicted.add(key);
    auto evictImportersOf = [&](const String& key) {
        auto importers = importersOf.find(key);
        if (importers == importersOf.end())
            return;
        for (auto& importer : importers->value) {
            unsigned testFile = plugins.testFileOfModule.get(importer);
            if (!testFile || (onlyImportersFromEarlierTestFiles && testFile == plugins.testFile))
                continue;
            if (evicted.add(importer).isNewEntry)
                keys.append(importer);
        }
    };
    for (auto& key : evict.patchedModules)
        evictImportersOf(key);
    for (size_t i = 0; i < keys.size(); ++i)
        evictImportersOf(String(keys[i]));

    for (auto& key : keys) {
        loader->removeEntry(JSC::Identifier::fromString(vm, key));
        requireMap->remove(globalObject, jsString(vm, key));
        RETURN_IF_EXCEPTION(scope, );
    }
}

static void unmockModule(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier, ModulesToEvict& evict)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    globalObject->onLoadPlugins.virtualModules->remove(specifier);

    LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
    RETURN_IF_EXCEPTION(scope, );

    if (JSObject* overwritten = mock->originalExports.get()) {
        if (loaded.esmNamespace) {
            JSC::PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            overwritten->getOwnPropertyNames(overwritten, globalObject, names, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, );
            for (auto& name : names) {
                JSValue original = overwritten->get(globalObject, name);
                RETURN_IF_EXCEPTION(scope, );
                if (original != overwritten) {
                    loaded.esmNamespace->overrideExportValue(globalObject, name, original);
                    RETURN_IF_EXCEPTION(scope, );
                    continue;
                }
                ExportVariable variable = findExportVariable(globalObject, loaded.esmNamespace, name);
                RETURN_IF_EXCEPTION(scope, );
                if (!variable.record)
                    continue;
                variable.record->moduleEnvironment()->variableAt(variable.offset).clear();
                // Whoever was linked to the export while it was mocked reads the variable, which nothing would fill.
                if (auto* synthetic = dynamicDowncast<JSC::SyntheticModuleRecord>(variable.record)) {
                    synthetic->materializeLazyExport(globalObject, variable.localName);
                    RETURN_IF_EXCEPTION(scope, );
                }
            }
        }
    }

    if (JSValue original = mock->originalCommonJSExports.get()) {
        if (loaded.commonJSModule)
            loaded.commonJSModule->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), original, 0);
    }

    if (!mock->originalExports && !mock->originalCommonJSExports) {
        if (loaded.esmNamespace || loaded.staleESMEntry || loaded.commonJSModule)
            evict.modules.append(specifier);
        return;
    }

    evict.patchedModules.append(specifier);
    if (!mock->originalCommonJSExports) {
        globalObject->requireMap()->remove(globalObject, mock->specifier.get());
        RETURN_IF_EXCEPTION(scope, );
    } else if (!mock->originalExports)
        globalObject->moduleLoader()->removeEntry(JSC::Identifier::fromString(vm, specifier));
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
static bool resolveModuleMockSpecifier(Zig::GlobalObject* globalObject, JSC::CallFrame* callframe, JSC::JSString*& specifierString, WTF::String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
    if (sourceOrigin.isNull())
        return false;
    const URL& url = sourceOrigin.url();

    if (specifier.startsWith("file:"_s)) {
        URL fileURL = URL(url, specifier);
        if (!fileURL.isValid()) {
            scope.throwException(globalObject, JSC::createTypeError(globalObject, "Invalid \"file:\" URL"_s));
            return false;
        }
        specifier = fileURL.fileSystemPath();
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
    specifier.key = specifier.written;
    resolveModuleMockSpecifier(globalObject, callframe, specifier.keyString, specifier.key);
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

extern "C" bool JSMock__isInPreload(Zig::GlobalObject*);
extern "C" bool JSMock__testFilesShareModules(Zig::GlobalObject*);

enum class ModuleMockFunction : uint8_t {
    // mock.module(): the factory is required.
    MockModule,
    // vi.mock(), jest.mock(): the transpiler moves the call above the imports.
    Mock,
    DoMock,
};

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
    if (resolveModuleMockSpecifier(globalObject, callframe, specifierString, specifier))
        globalObject->onLoadPlugins.mustDoExpensiveRelativeLookup = true;
    RETURN_IF_EXCEPTION(scope, {});

    if (!factory && !spy) {
        if (JSC::JSString* manualMock = findManualModuleMock(globalObject, callerPath(vm, callframe), written, specifier))
            factory = manualMock;
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSModuleMock* mock = JSModuleMock::create(vm, globalObject->mockModule.mockModuleStructure.getInitializedOnMainThread(globalObject), factory, specifierString);
    mock->spy = spy;
    mock->isHoisted = function == ModuleMockFunction::Mock;
    mock->isFromPreload = JSMock__isInPreload(globalObject);

    LoadedModule loaded = findLoadedModule(globalObject, specifierString);
    RETURN_IF_EXCEPTION(scope, {});

    // What is loaded is the original unless an earlier mock was loaded in its place.
    JSModuleMock* previous = registeredModuleMock(globalObject, specifier);
    if (previous) {
        mock->originalExports.setMayBeNull(vm, mock, previous->originalExports.get());
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
    if (loaded.esmNamespace || loaded.commonJSModule) {
        JSValue exportsValue = mock->executeOnce(globalObject, false);
        RETURN_IF_EXCEPTION(scope, {});

        if (auto* promise = dynamicDowncast<JSC::JSPromise>(exportsValue)) {
            switch (promise->status()) {
            case JSC::JSPromise::Status::Rejected: {
                promise->markAsHandled();
                scope.throwException(globalObject, promise->result());
                return {};
            }
            case JSC::JSPromise::Status::Fulfilled: {
                exportsValue = promise->result();
                break;
            }
            case JSC::JSPromise::Status::Pending: {
                pendingFactory = promise;
                break;
            }
            }
        }

        // The factory may have require()d the module itself: `() => ({ ...require("./m"), extra })`.
        findLoadedCommonJSModule(globalObject, specifierString, loaded);
        RETURN_IF_EXCEPTION(scope, {});

        if (!pendingFactory) {
            if (!exportsValue.isObject()) {
                throwFactoryMustReturnObject(globalObject, scope);
                return {};
            }
            overrideLoadedModuleExports(globalObject, mock, loaded, exportsValue.getObject());
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    if (loaded.staleESMEntry) {
        auto specifierIdent = JSC::Identifier::fromString(vm, specifier);
        globalObject->moduleLoader()->removeEntry(specifierIdent); // takes the loader's cellLock itself
    }

    if (loaded.staleCommonJSEntry) {
        globalObject->requireMap()->remove(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }

    globalObject->onLoadPlugins.addModuleMock(vm, specifier, mock);
    if (previous && previous->isFromPreload && !mock->isFromPreload)
        globalObject->onLoadPlugins.displacedPreloadModuleMocks.append(JSC::Strong<JSC::JSObject> { vm, previous });

    // The modules an earlier test file loaded have read the original's exports. This file loads them again.
    auto& plugins = globalObject->onLoadPlugins;
    if ((mock->originalExports || mock->originalCommonJSExports) && !mock->isFromPreload && (!previous || previous->isFromPreload) && plugins.testFile > 1 && plugins.testFileOfModule.get(specifier) != plugins.testFile) {
        ModulesToEvict evict;
        evict.patchedModules.append(specifier);
        evictModulesAndTheirImporters(globalObject, WTF::move(evict), true);
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (!pendingFactory)
        return JSValue::encode(jsUndefined());

    JSC::JSPromise* patched = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    pendingFactory->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionMockModuleFactoryResolve), globalObject->thenable(jsFunctionMockModuleFactoryReject), patched, mock);
    mock->hasPendingPatch = true;

    return JSValue::encode(patched);
}

BUN_DECLARE_HOST_FUNCTION(JSMock__jsModuleMock);
extern "C" JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(JSMock__jsModuleMock, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return mockModule(lexicalGlobalObject, callframe, ModuleMockFunction::MockModule);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionMockModuleHoisted, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return mockModule(lexicalGlobalObject, callframe, ModuleMockFunction::Mock);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDoMockModule, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    return mockModule(lexicalGlobalObject, callframe, ModuleMockFunction::DoMock);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionUnmockModule, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
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
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionImportActualModule, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto specifier = moduleMockSpecifierArgument(globalObject, callframe, "importActual(module)"_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (JSModuleMock* mock = registeredModuleMock(globalObject, specifier.key))
        RELEASE_AND_RETURN(scope, JSValue::encode(importOriginalModule(globalObject, mock)));
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

    globalObject->moduleLoader()->clearAll();

    // A native addon is loaded once per process.
    JSC::JSMap* requireMap = globalObject->requireMap();
    MarkedArgumentBuffer addons;
    auto* iterator = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), requireMap, JSC::IterationKind::Entries);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue key, value;
    while (iterator->nextKeyValue(globalObject, key, value)) {
        if (!key.isString())
            continue;
        String path = asString(key)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        size_t query = path.find('?');
        if ((query == notFound ? StringView(path) : StringView(path).left(query)).endsWith(".node"_s)) {
            addons.append(key);
            addons.append(value);
        }
    }
    requireMap->clear(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    for (size_t i = 0; i < addons.size(); i += 2) {
        requireMap->set(globalObject, addons.at(i), addons.at(i + 1));
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (auto* virtualModules = globalObject->onLoadPlugins.virtualModules) {
        for (auto& value : virtualModules->values()) {
            auto* mock = dynamicDowncast<JSModuleMock>(value.get());
            if (!mock)
                continue;
            // What was patched in place is not registered any more.
            mock->originalExports.clear();
            mock->originalCommonJSExports.clear();
            if (callFactoriesAgain && mock->state == JSModuleMock::State::Called) {
                mock->state = JSModuleMock::State::NotCalled;
                mock->result.clear();
            }
        }
    }

    return JSValue::encode(callframe->thisValue());
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
    for (auto target : { encodedJest, encodedVi }) {
        put(target, "mock"_s, 2, jsFunctionMockModuleHoisted);
        put(target, "doMock"_s, 2, jsFunctionDoMockModule);
        put(target, "unmock"_s, 1, jsFunctionUnmockModule);
    }
    put(encodedVi, "doUnmock"_s, 1, jsFunctionUnmockModule);
    put(encodedVi, "importActual"_s, 1, jsFunctionImportActualModule);
    put(encodedVi, "importMock"_s, 1, jsFunctionImportMockModule);
    put(encodedVi, "resetModules"_s, 0, jsFunctionViResetModules);
    put(encodedVi, "hoisted"_s, 1, jsFunctionMockHoisted);
    put(encodedJest, "dontMock"_s, 1, jsFunctionUnmockModule);
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
    unmockModule(globalObject, mock, specifier);
    RETURN_IF_EXCEPTION(scope, );
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

// The next test file finds the modules as the preloads left them.
extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__undoModuleMocksOfTestFile(Zig::GlobalObject* globalObject)
{
    auto& plugins = globalObject->onLoadPlugins;
    plugins.testFile++;
    if (!plugins.virtualModules || !JSMock__testFilesShareModules(globalObject))
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    ModulesToEvict evict;

    MarkedArgumentBuffer mocks;
    for (auto& value : plugins.virtualModules->values()) {
        auto* mock = dynamicDowncast<JSModuleMock>(value.get());
        if (mock && !mock->isFromPreload)
            mocks.append(mock);
    }
    for (size_t i = 0; i < mocks.size(); ++i) {
        auto* mock = uncheckedDowncast<JSModuleMock>(mocks.at(i));
        unmockModule(globalObject, mock, mock->specifier->tryGetValue().data, evict);
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
    }

    for (auto& displaced : std::exchange(plugins.displacedPreloadModuleMocks, {})) {
        auto* mock = uncheckedDowncast<JSModuleMock>(displaced.get());
        String specifier = mock->specifier->tryGetValue().data;
        plugins.addModuleMock(vm, specifier, mock);
        if (!mock->originalExports && !mock->originalCommonJSExports) {
            evict.modules.append(specifier);
            continue;
        }
        evict.patchedModules.append(specifier);
        if (mock->state != JSModuleMock::State::Called)
            continue;
        JSValue exports = mock->result.get();
        if (auto* promise = dynamicDowncast<JSC::JSPromise>(exports); promise && promise->status() == JSC::JSPromise::Status::Fulfilled)
            exports = promise->result();
        if (!exports.isObject() || exports.inherits<JSC::JSPromise>())
            continue;
        LoadedModule loaded = findLoadedModule(globalObject, mock->specifier.get());
        if (!scope.exception()) [[likely]]
            overrideLoadedModuleExports(globalObject, mock, loaded, exports.getObject());
        if (scope.exception()) [[unlikely]]
            (void)scope.tryClearException();
    }

    evictModulesAndTheirImporters(globalObject, WTF::move(evict));
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();
}

template<typename Visitor>
void JSModuleMock::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSModuleMock* mock = uncheckedDowncast<JSModuleMock>(cell);
    ASSERT_GC_OBJECT_INHERITS(mock, info());
    Base::visitChildren(mock, visitor);

    visitor.append(mock->factory);
    visitor.append(mock->result);
    visitor.append(mock->specifier);
    visitor.append(mock->originalExports);
    visitor.append(mock->originalCommonJSExports);
    visitor.append(mock->originalPromise);
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

static void rejectOriginalsWaitingFor(BunPlugin::OnLoad& plugins, const String& specifier, const String& importer)
{
    if (plugins.isLookingForModuleMockCycle)
        return;

    MarkedArgumentBuffer waiting;
    for (auto& value : plugins.virtualModules->values()) {
        auto* mock = dynamicDowncast<JSModuleMock>(value.get());
        if (mock && mock->waitsForOriginal())
            waiting.append(mock);
    }
    if (waiting.isEmpty())
        return;

    Zig::GlobalObject* globalObject = defaultGlobalObject(waiting.at(0).getObject()->globalObject());
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSValue resolved;
    {
        // Resolving asks about virtual modules again.
        SetForScope isLooking(plugins.isLookingForModuleMockCycle, true);
        BunString from = Bun::toString(importer);
        resolved = JSValue::decode(Bun__resolveSyncWithSourceIfExists(globalObject, JSValue::encode(jsString(vm, specifier)), &from, true));
    }
    // The caller resolves it next and throws the same.
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return;
    }
    if (!resolved.isString())
        return;

    for (size_t i = 0; i < waiting.size(); ++i) {
        auto* mock = uncheckedDowncast<JSModuleMock>(waiting.at(i));
        if (mock->specifier->tryGetValue().data == asString(resolved)->tryGetValue().data)
            rejectOriginalThatImportsItsMock(globalObject, mock);
    }
}

std::optional<String> BunPlugin::OnLoad::resolveVirtualModule(const String& path, const String& from)
{
    ASSERT(virtualModules);
    rejectOriginalsWaitingFor(*this, path, from);

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
                promise->setFlags(static_cast<uint16_t>(JSC::JSPromise::Status::Fulfilled));
                result = promise->result();
                return JSValue::encode(result);
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
    auto* mock = uncheckedDowncast<Zig::JSModuleMock>(callFrame->argument(1));
    String specifier;
    bool isCurrent = Zig::didSettlePendingModulePatch(globalObject, mock, specifier);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isCurrent)
        return JSC::JSValue::encode(JSC::jsUndefined());

    JSC::JSValue exportsValue = callFrame->argument(0);
    if (!exportsValue.isObject()) {
        Zig::throwFactoryMustReturnObject(globalObject, scope);
    } else {
        Zig::LoadedModule loaded = Zig::findLoadedModule(globalObject, mock->specifier.get());
        if (!scope.exception()) [[likely]]
            Zig::overrideLoadedModuleExports(globalObject, mock, loaded, exportsValue.getObject());
    }
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
    auto* mock = uncheckedDowncast<Zig::JSModuleMock>(callFrame->argument(1));
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

    if (isBunTest && Zig::JSMock__testFilesShareModules(globalObject) && !Zig::JSMock__isInPreload(globalObject))
        globalObject->onLoadPlugins.testFileOfModule.set(specifier->toWTFString(BunString::ZeroCopy), globalObject->onLoadPlugins.testFile);

    if (!globalObject->onLoadPlugins.hasVirtualModules()) {
        return fallback();
    }
    auto& virtualModules = *globalObject->onLoadPlugins.virtualModules;
    WTF::String specifierString = specifier->toWTFString(BunString::ZeroCopy);

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

    return fallback();
}

JSC::JSValue findModuleMock(Zig::GlobalObject* globalObject, const BunString* specifier)
{
    if (!globalObject->onLoadPlugins.hasVirtualModules())
        return {};
    return Zig::registeredModuleMock(globalObject, specifier->toWTFString(BunString::ZeroCopy));
}

JSC::JSValue runModuleMock(Zig::GlobalObject* globalObject, JSC::JSValue moduleMock, bool synchronous)
{
    auto* mock = dynamicDowncast<Zig::JSModuleMock>(moduleMock);
    if (!mock)
        return moduleMock;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Not under the module loader, which is asking for the module: what the factory loads may import it too.
    if (!synchronous && mock->state == Zig::JSModuleMock::State::NotCalled) {
        JSC::JSPromise* fulfilled = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        fulfilled->fulfill(vm, jsUndefined());
        return Zig::thenWithContext(globalObject, fulfilled, Zig::jsFunctionCallModuleMockFactory, nullptr, mock);
    }

    JSValue exports = mock->executeOnce(globalObject, synchronous);
    RETURN_IF_EXCEPTION(scope, {});
    if (auto* promise = dynamicDowncast<JSC::JSPromise>(exports)) {
        if (promise->status() == JSC::JSPromise::Status::Fulfilled)
            exports = promise->result();
        else if (synchronous && promise->status() == JSC::JSPromise::Status::Rejected) {
            promise->markAsHandled();
            scope.throwException(globalObject, promise->result());
            return {};
        }
    }
    if (!exports.isObject()) {
        Zig::throwFactoryMustReturnObject(globalObject, scope);
        return {};
    }
    return exports;
}

} // namespace Bun

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPluginClear, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    Zig::GlobalObject* global = static_cast<Zig::GlobalObject*>(globalObject);
    global->onLoadPlugins.clear();
    global->onResolvePlugins.clear();

    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPlugin, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return Bun::setupBunPlugin(globalObject, callframe, BunPluginTargetBun);
}
