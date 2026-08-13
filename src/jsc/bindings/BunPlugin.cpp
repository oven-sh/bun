#include "BunPlugin.h"

#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSCast.h"
#include "headers-handwritten.h"
#include "helpers.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/ModuleRegistryEntry.h>
#include <JavaScriptCore/CyclicModuleRecord.h>
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/SymbolTable.h>
#include <JavaScriptCore/SyntheticModuleRecord.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/JavaScript.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/RegularExpression.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/text/WTFString.h>

#include "BunClientData.h"
#include "JSCommonJSModule.h"
#include "isBuiltinModule.h"
#include "AsyncContextFrame.h"
#include "ImportMetaObject.h"

namespace Bun {
JSC::JSValue unwrapSpyOriginal(JSC::JSValue);
}

extern "C" bool Bun__Jest__moduleMockIsPersistent(JSC::JSGlobalObject*);

namespace Zig {

extern "C" void Bun__onDidAppendPlugin(void* bunVM, JSGlobalObject* globalObject);
using OnAppendPluginCallback = void (*)(void*, JSGlobalObject* globalObject);

static bool isValidNamespaceString(String& namespaceString)
{
    static JSC::Yarr::RegularExpression* namespaceRegex = nullptr;
    if (!namespaceRegex) {
        namespaceRegex = new JSC::Yarr::RegularExpression("^([/@a-zA-Z0-9_\\-]+)$"_s);
    }
    return namespaceRegex->match(namespaceString) > -1;
}

static JSC::EncodedJSValue jsFunctionAppendOnLoadPluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin, void* ctx, OnAppendPluginCallback callback)
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
    RETURN_IF_EXCEPTION(scope, {});

    if (!func.isCell() || !func.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() expects second argument to be a function"_s));
        return {};
    }

    plugin.append(vm, filter->regExp(), func.getObject(), namespaceString);
    callback(ctx, globalObject);

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
        auto* moduleLoader = global->moduleLoader();
        // JSModuleLoader::visitChildrenImpl iterates these maps on the GC thread
        // under cellLock(); take the same lock so the removal can't race it.
        WTF::Locker locker { moduleLoader->cellLock() };
        moduleLoader->removeEntry(idIdent);
    }

    return JSValue::encode(callframe->thisValue());
}

static JSC::EncodedJSValue jsFunctionAppendOnResolvePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin, void* ctx, OnAppendPluginCallback callback)
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
        RETURN_IF_EXCEPTION(scope, {});
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
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto func = callframe->uncheckedArgument(1);
    RETURN_IF_EXCEPTION(scope, {});

    if (!func.isCell() || !func.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "onResolve() expects second argument to be a function"_s));
        return {};
    }

    RETURN_IF_EXCEPTION(scope, {});
    plugin.append(vm, filter->regExp(), uncheckedDowncast<JSObject>(func), namespaceString);
    callback(ctx, globalObject);

    return JSValue::encode(callframe->thisValue());
}

static JSC::EncodedJSValue jsFunctionAppendOnResolvePluginGlobal(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    Zig::GlobalObject* global = defaultGlobalObject(globalObject);

    auto& plugins = global->onResolvePlugins;
    auto callback = Bun__onDidAppendPlugin;
    return jsFunctionAppendOnResolvePluginBody(globalObject, callframe, target, plugins, global->bunVM(), callback);
}

static JSC::EncodedJSValue jsFunctionAppendOnLoadPluginGlobal(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    Zig::GlobalObject* global = defaultGlobalObject(globalObject);

    auto& plugins = global->onLoadPlugins;
    auto callback = Bun__onDidAppendPlugin;
    return jsFunctionAppendOnLoadPluginBody(globalObject, callframe, target, plugins, global->bunVM(), callback);
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
    RETURN_IF_EXCEPTION(throwScope, {});

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
    size_t count = filters.size();
    for (size_t i = 0; i < count; i++) {
        if (filters[i].get()->match(globalObject, path, 0)) {
            return callbacks[i].get();
        }
    }

    return nullptr;
}

class JSModuleMock final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    mutable WriteBarrier<JSObject> callbackFunctionOrCachedResult;
    bool hasCalledModuleMock = false;
    // Installed by preload or a file's top level (see Bun__Jest__moduleMockIsPersistent): mock.restore() keeps it.
    bool persistent = false;

    static JSModuleMock* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* callback);
    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSObject* executeOnce(JSC::JSGlobalObject* lexicalGlobalObject);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSModuleMock, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSModuleMock.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSModuleMock = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSModuleMock.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSModuleMock = std::forward<decltype(space)>(space); });
    }

    void finishCreation(JSC::VM&);

private:
    JSModuleMock(JSC::VM&, JSC::Structure*, JSC::JSObject* callback);
};

// First-write-wins per binding / module / specifier, so re-mocks (or a barrel plus its leaf) restore to the pre-mock state.
struct ModuleMockUndoLog {
    struct Binding {
        // Identity of the binding (a leaf record's local name), shared by every re-export of it.
        JSC::Strong<JSC::AbstractModuleRecord> record;
        JSC::Identifier localName;
        // How to write it back: overrideExportValue() through the namespace the mock went through.
        JSC::Strong<JSC::JSModuleNamespaceObject> ns;
        JSC::Identifier exportName;
        // Either the value itself, or (for a builtin export nobody had materialized) the object to read it from.
        JSC::Strong<JSC::Unknown> original;
        JSC::Strong<JSC::JSObject> lazySource;
    };
    struct CommonJS {
        JSC::Strong<Bun::JSCommonJSModule> module;
        JSC::Strong<JSC::Unknown> originalExports;
    };
    struct Installed {
        String specifier;
        // Persistent entry (a preload mock or Bun.plugin module) the test's mock displaced; null removes the key.
        JSC::Strong<JSC::JSObject> displaced;
    };

    Vector<Binding> bindings;
    Vector<CommonJS> commonJSModules;
    Vector<Installed> installed;

    const Binding* findBinding(JSC::AbstractModuleRecord* record, const JSC::Identifier& localName) const
    {
        size_t index = bindings.findIf([&](auto& entry) { return entry.record.get() == record && entry.localName == localName; });
        return index == notFound ? nullptr : &bindings[index];
    }
    bool hasCommonJS(Bun::JSCommonJSModule* module) const
    {
        return commonJSModules.containsIf([&](auto& entry) { return entry.module.get() == module; });
    }
    size_t findInstalled(const String& specifier) const
    {
        return installed.findIf([&](auto& entry) { return entry.specifier == specifier; });
    }
};

static ModuleMockUndoLog& ensureUndoLog(BunPlugin::OnLoad& onLoad)
{
    if (!onLoad.moduleMockUndoLog)
        onLoad.moduleMockUndoLog = new ModuleMockUndoLog;
    return *onLoad.moduleMockUndoLog;
}

BunPlugin::OnLoad::~OnLoad()
{
    delete virtualModules;
    delete moduleMockUndoLog;
}

void BunPlugin::OnLoad::clearVirtualModules()
{
    delete virtualModules;
    virtualModules = nullptr;
    // The entries these would put back or remove are gone with the map.
    if (moduleMockUndoLog)
        moduleMockUndoLog->installed.clear();
}

void BunPlugin::OnLoad::addModuleMock(JSC::VM& vm, const String& path, JSC::JSObject* mockObject)
{
    if (!virtualModules)
        virtualModules = new BunPlugin::VirtualModuleMap;

    auto* mock = uncheckedDowncast<JSModuleMock>(mockObject);
    auto existing = virtualModules->find(path);
    JSObject* current = existing != virtualModules->end() ? existing->value.get() : nullptr;

    if (mock->persistent) {
        // File-level setup supersedes whatever an earlier test left behind for this specifier.
        if (moduleMockUndoLog) {
            if (size_t index = moduleMockUndoLog->findInstalled(path); index != notFound)
                moduleMockUndoLog->installed.removeAt(index);
        }
    } else {
        auto& log = ensureUndoLog(*this);
        if (log.findInstalled(path) == notFound) {
            auto* currentMock = dynamicDowncast<JSModuleMock>(current);
            bool currentIsPersistent = current && (!currentMock || currentMock->persistent);
            log.installed.append({ path, currentIsPersistent ? JSC::Strong<JSC::JSObject> { vm, current } : JSC::Strong<JSC::JSObject> {} });
        }
    }

    virtualModules->set(path, JSC::Strong<JSC::JSObject> { vm, mockObject });
}

const JSC::ClassInfo JSModuleMock::s_info = { "ModuleMock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleMock) };

JSModuleMock* JSModuleMock::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* callback)
{
    JSModuleMock* ptr = new (NotNull, JSC::allocateCell<JSModuleMock>(vm)) JSModuleMock(vm, structure, callback);
    ptr->finishCreation(vm);
    return ptr;
}

void JSModuleMock::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

JSModuleMock::JSModuleMock(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* callback)
    : Base(vm, structure)
    , callbackFunctionOrCachedResult(callback, JSC::WriteBarrierEarlyInit)
{
}

Structure* JSModuleMock::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

JSObject* JSModuleMock::executeOnce(JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (hasCalledModuleMock) {
        return callbackFunctionOrCachedResult.get();
    }

    hasCalledModuleMock = true;

    if (!callbackFunctionOrCachedResult) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "Cannot call mock without a callback"_s));
        return nullptr;
    }

    JSC::JSValue callbackValue = callbackFunctionOrCachedResult.get();
    if (!callbackValue.isCell() || !callbackValue.isCallable()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a function"_s));
        return nullptr;
    }

    JSObject* callback = callbackValue.getObject();
    JSC::JSValue result = JSC::profiledCall(lexicalGlobalObject, ProfilingReason::API, callback, JSC::getCallData(callback), JSC::jsUndefined(), ArgList());
    RETURN_IF_EXCEPTION(scope, {});

    if (!result.isObject()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a function that returns an object"_s));
        return nullptr;
    }

    auto* object = result.getObject();
    this->callbackFunctionOrCachedResult.set(vm, this, object);

    return object;
}

struct ExportBinding {
    JSC::AbstractModuleRecord* record = nullptr;
    // The binding's own name inside `record`; differs from the export name across `export { a as b }`.
    JSC::Identifier localName;
    // Empty for a lazy builtin export nothing has materialized yet (see SyntheticModuleRecord::materializeLazyExport).
    JSC::JSValue value;
};

// Reads the slot an export currently binds to. Unlike namespace->get(), this never runs a lazy export's getter.
static std::optional<ExportBinding> readExportBinding(JSC::JSGlobalObject* globalObject, JSC::AbstractModuleRecord* record, const JSC::Identifier& exportName)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto resolution = record->resolveExport(globalObject, exportName);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    if (resolution.type != JSC::AbstractModuleRecord::Resolution::Type::Resolved)
        return std::nullopt;
    auto* environment = resolution.moduleRecord->moduleEnvironmentMayBeNull();
    if (!environment)
        return std::nullopt;
    JSC::SymbolTable& symbolTable = *environment->symbolTable();
    JSC::ConcurrentJSLocker locker(symbolTable.m_lock);
    auto iter = symbolTable.find(locker, resolution.localName.impl());
    if (iter == symbolTable.end(locker))
        return std::nullopt;
    JSC::ScopeOffset offset = iter->value.scopeOffset();
    if (!environment->isValidScopeOffset(offset))
        return std::nullopt;
    return ExportBinding { resolution.moduleRecord, resolution.localName, environment->variableAt(offset).get() };
}

// Records what `exportName` of `ns` binds to right now, unless that binding is already in the log.
static void recordBindingBeforeOverride(Zig::GlobalObject* globalObject, ModuleMockUndoLog& log, JSC::JSModuleNamespaceObject* ns, const JSC::Identifier& exportName)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto binding = readExportBinding(globalObject, ns->moduleRecord(), exportName);
    RETURN_IF_EXCEPTION(scope, void());
    // Not an export of this module (overrideExportValue will not write it either), or logged already.
    if (!binding || log.findBinding(binding->record, binding->localName))
        return;

    ModuleMockUndoLog::Binding entry {
        .record = JSC::Strong<JSC::AbstractModuleRecord> { vm, binding->record },
        .localName = binding->localName,
        .ns = JSC::Strong<JSC::JSModuleNamespaceObject> { vm, ns },
        .exportName = exportName,
    };

    if (binding->value) {
        entry.original = JSC::Strong<JSC::Unknown> { vm, Bun::unwrapSpyOriginal(binding->value) };
        log.bindings.append(WTF::move(entry));
        return;
    }

    // An empty slot in any other record is a TDZ binding; the module's own evaluation initializes it later.
    auto* synthetic = dynamicDowncast<JSC::SyntheticModuleRecord>(binding->record);
    if (!synthetic || !synthetic->hasLazyExports())
        return;
    // Unmaterialized builtin export: restore reads it off the default export, the object the engine itself reads lazy exports from.
    auto source = readExportBinding(globalObject, binding->record, vm.propertyNames->defaultKeyword);
    RETURN_IF_EXCEPTION(scope, void());
    if (!source)
        return;
    // If this test already mocked `default` too, the live slot holds the mock; the log has the real object.
    JSValue sourceValue = source->value;
    if (const auto* loggedDefault = log.findBinding(source->record, source->localName))
        sourceValue = loggedDefault->original.get();
    JSObject* sourceObject = sourceValue ? sourceValue.getObject() : nullptr;
    if (!sourceObject)
        return;
    entry.lazySource = JSC::Strong<JSC::JSObject> { vm, sourceObject };
    log.bindings.append(WTF::move(entry));
}

static void recordCommonJSBeforeOverride(JSC::VM& vm, ModuleMockUndoLog& log, Bun::JSCommonJSModule* module)
{
    if (log.hasCommonJS(module))
        return;
    // module.exports is always a data property of ours (see JSCommonJSModule::setExportsObject).
    JSValue exports = module->getDirect(vm, Bun::builtinNames(vm).exportsPublicName());
    if (!exports || exports.isGetterSetter())
        return;
    log.commonJSModules.append({ JSC::Strong<Bun::JSCommonJSModule> { vm, module }, JSC::Strong<JSC::Unknown> { vm, exports } });
}

BUN_DECLARE_HOST_FUNCTION(JSMock__jsModuleMock);
extern "C" JSC_DEFINE_HOST_FUNCTION(JSMock__jsModuleMock, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
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

    JSC::JSValue callbackValue = callframe->argument(1);
    if (!callbackValue.isCell() || !callbackValue.isCallable()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a function"_s));
        return {};
    }

    auto resolveSpecifier = [&]() -> void {
        JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
        if (sourceOrigin.isNull())
            return;
        const URL& url = sourceOrigin.url();

        if (specifier.startsWith("file:"_s)) {
            URL fileURL = URL(url, specifier);
            if (fileURL.isValid()) {
                specifier = fileURL.fileSystemPath();
                specifierString = jsString(vm, specifier);
                globalObject->onLoadPlugins.mustDoExpensiveRelativeLookup = true;
                return;
            } else {
                scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "Invalid \"file:\" URL"_s));
                return;
            }
        }

        if (url.isValid() && url.protocolIsFile()) {
            auto fromString = url.fileSystemPath();
            BunString from = Bun::toString(fromString);
            auto topExceptionScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            auto result = JSValue::decode(Bun__resolveSyncWithSource(globalObject, JSValue::encode(specifierString), &from, true, false));
            if (topExceptionScope.exception()) {
                (void)topExceptionScope.tryClearException();
            }

            if (result && result.isString()) {
                auto* specifierStr = result.toString(globalObject);
                if (specifierStr->length() > 0) {
                    specifierString = specifierStr;
                    specifier = specifierString->value(globalObject);
                }
            } else if (specifier.startsWith("./"_s) || specifier.startsWith(".."_s)) {
                // If module resolution fails, we try to resolve it relative to the current file
                auto relativeURL = URL(url, specifier);

                if (relativeURL.isValid()) {
                    globalObject->onLoadPlugins.mustDoExpensiveRelativeLookup = true;

                    if (relativeURL.protocolIsFile())
                        specifier = relativeURL.fileSystemPath();
                    else
                        specifier = relativeURL.string();

                    specifierString = jsString(vm, specifier);
                }
            }
        }
    };

    resolveSpecifier();
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSObject* callback = callbackValue.getObject();

    JSModuleMock* mock = JSModuleMock::create(vm, globalObject->mockModule.mockModuleStructure.getInitializedOnMainThread(globalObject), callback);
    mock->persistent = Bun__Jest__moduleMockIsPersistent(globalObject);
    ModuleMockUndoLog* undoLog = mock->persistent ? nullptr : &ensureUndoLog(globalObject->onLoadPlugins);

    auto getJSValue = [&]() -> JSValue {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue result = mock->executeOnce(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        if (result && result.isObject()) {
            while (JSC::JSPromise* promise = dynamicDowncast<JSC::JSPromise>(result)) {
                switch (promise->status()) {
                case JSC::JSPromise::Status::Rejected: {
                    result = promise->result();
                    scope.throwException(globalObject, result);
                    return {};
                    break;
                }
                case JSC::JSPromise::Status::Fulfilled: {
                    result = promise->result();
                    break;
                }
                // TODO: blocking wait for promise
                default: {
                    break;
                }
                }
            }
        }

        return result;
    };

    bool removeFromESM = false;
    bool removeFromCJS = false;

    auto specifierIdent = JSC::Identifier::fromString(vm, specifierString->value(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    if (auto* entry = globalObject->moduleLoader()->registryEntry(specifierIdent)) {
        removeFromESM = true;
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
                {
                    JSC::JSModuleNamespaceObject* moduleNamespaceObject = mod->getModuleNamespace(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                    if (moduleNamespaceObject) {
                        JSValue exportsValue = getJSValue();
                        RETURN_IF_EXCEPTION(scope, {});
                        auto* object = exportsValue.getObject();
                        removeFromESM = false;

                        if (object) {
                            JSC::PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
                            JSObject::getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Exclude);
                            RETURN_IF_EXCEPTION(scope, {});

                            for (auto& name : names) {
                                // consistent with regular esm handling code
                                auto topExceptionScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
                                JSValue value = object->get(globalObject, name);
                                if (scope.exception()) [[unlikely]] {
                                    (void)scope.tryClearException();
                                    value = jsUndefined();
                                }
                                if (undoLog) {
                                    recordBindingBeforeOverride(globalObject, *undoLog, moduleNamespaceObject, name);
                                    RETURN_IF_EXCEPTION(scope, {});
                                }
                                moduleNamespaceObject->overrideExportValue(globalObject, name, value);
                                RETURN_IF_EXCEPTION(scope, {});
                            }

                        } else {
                            // if it's not an object, I guess we just set the default export?
                            if (undoLog) {
                                recordBindingBeforeOverride(globalObject, *undoLog, moduleNamespaceObject, vm.propertyNames->defaultKeyword);
                                RETURN_IF_EXCEPTION(scope, {});
                            }
                            moduleNamespaceObject->overrideExportValue(globalObject, vm.propertyNames->defaultKeyword, exportsValue);
                            RETURN_IF_EXCEPTION(scope, {});
                        }

                        // TODO: do we need to handle intermediate loading state here?
                        // entry->putDirect(vm, Identifier::fromString(vm, String("evaluated"_s)), jsBoolean(true), 0);
                        // entry->putDirect(vm, Identifier::fromString(vm, String("state"_s)), jsNumber(JSC::JSModuleLoader::Status::Ready), 0);
                    }
                }
            }
        }
    }

    JSValue entryValue = globalObject->requireMap()->get(globalObject, specifierString);
    RETURN_IF_EXCEPTION(scope, {});
    if (entryValue) {
        removeFromCJS = true;
        if (auto* moduleObject = entryValue ? dynamicDowncast<Bun::JSCommonJSModule>(entryValue) : nullptr) {
            if (undoLog)
                recordCommonJSBeforeOverride(vm, *undoLog, moduleObject);

            JSValue exportsValue = getJSValue();
            RETURN_IF_EXCEPTION(scope, {});

            moduleObject->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), exportsValue, 0);
            moduleObject->hasEvaluated = true;
            removeFromCJS = false;
        }
    }

    if (removeFromESM) {
        auto* moduleLoader = globalObject->moduleLoader();
        WTF::Locker locker { moduleLoader->cellLock() };
        moduleLoader->removeEntry(specifierIdent);
    }

    if (removeFromCJS) {
        globalObject->requireMap()->remove(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }

    globalObject->onLoadPlugins.addModuleMock(vm, specifier, mock);

    return JSValue::encode(jsUndefined());
}

template<typename Visitor>
void JSModuleMock::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSModuleMock* mock = uncheckedDowncast<JSModuleMock>(cell);
    ASSERT_GC_OBJECT_INHERITS(mock, info());
    Base::visitChildren(mock, visitor);

    visitor.append(mock->callbackFunctionOrCachedResult);
}

DEFINE_VISIT_CHILDREN(JSModuleMock);

void BunPlugin::OnLoad::restoreModuleMocks(Zig::GlobalObject* globalObject)
{
    auto* log = moduleMockUndoLog;
    if (!log)
        return;

    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // If one throws (a lazy export's getter can), what is done is dropped and the rest stays for the next restore().
    size_t restored = 0;
    for (auto& binding : log->bindings) {
        JSValue value = binding.original.get();
        if (auto* lazySource = binding.lazySource.get()) {
            value = lazySource->get(globalObject, binding.localName);
            if (scope.exception()) [[unlikely]]
                break;
        }
        binding.ns->overrideExportValue(globalObject, binding.exportName, value);
        if (scope.exception()) [[unlikely]]
            break;
        restored++;
    }
    log->bindings.removeAt(0, restored);
    RETURN_IF_EXCEPTION(scope, void());

    for (auto& entry : log->commonJSModules)
        entry.module->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), entry.originalExports.get(), 0);
    log->commonJSModules.clear();

    if (virtualModules) {
        for (auto& entry : log->installed) {
            if (entry.displaced)
                virtualModules->set(entry.specifier, JSC::Strong<JSC::JSObject> { vm, entry.displaced.get() });
            else
                virtualModules->remove(entry.specifier);
        }
    }
    log->installed.clear();
}

EncodedJSValue BunPlugin::OnLoad::run(JSC::JSGlobalObject* globalObject, BunString* namespaceString, BunString* path)
{
    Group* groupPtr = this->group(namespaceString ? namespaceString->toWTFString(BunString::ZeroCopy) : String());
    if (groupPtr == nullptr) {
        return JSValue::encode(jsUndefined());
    }
    Group& group = *groupPtr;

    auto pathString = path->toWTFString(BunString::ZeroCopy);

    auto* function = group.find(globalObject, pathString);
    if (!function) {
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::MarkedArgumentBuffer arguments;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    scope.assertNoExceptionExceptTermination();

    JSC::JSObject* paramsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
    const auto& builtinNames = WebCore::builtinNames(vm);
    paramsObject->putDirect(
        vm, builtinNames.pathPublicName(),
        jsString(vm, pathString));
    arguments.append(paramsObject);

    auto result = AsyncContextFrame::call(globalObject, function, JSC::jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, {});

    if (auto* promise = dynamicDowncast<JSPromise>(result)) {
        switch (promise->status()) {
        case JSPromise::Status::Rejected:
        case JSPromise::Status::Pending: {
            return JSValue::encode(promise);
        }
        case JSPromise::Status::Fulfilled: {
            result = promise->result();
            break;
        }
        }
    }

    if (!result.isObject()) {
        JSC::throwTypeError(globalObject, scope, "onLoad() expects an object returned"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(result));
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

EncodedJSValue BunPlugin::OnResolve::run(JSC::JSGlobalObject* globalObject, BunString* namespaceString, BunString* path, BunString* importer)
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
        if (!filters[i].get()->match(globalObject, pathString, 0)) {
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

extern "C" JSC::EncodedJSValue Bun__runOnResolvePlugins(Zig::GlobalObject* globalObject, BunString* namespaceString, BunString* path, BunString* from, BunPluginTarget target)
{
    return globalObject->onResolvePlugins.run(globalObject, namespaceString, path, from);
}

extern "C" JSC::EncodedJSValue Bun__runOnLoadPlugins(Zig::GlobalObject* globalObject, BunString* namespaceString, BunString* path, BunPluginTarget target)
{
    return globalObject->onLoadPlugins.run(globalObject, namespaceString, path);
}

namespace Bun {

Structure* createModuleMockStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Zig::JSModuleMock::createStructure(vm, globalObject, prototype);
}

JSC::JSValue runVirtualModule(Zig::GlobalObject* globalObject, BunString* specifier, bool& wasModuleMock)
{
    auto fallback = [&]() -> JSC::JSValue {
        return JSValue::decode(Bun__runVirtualModule(globalObject, specifier));
    };

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
            // module mock
            result = moduleMock->executeOnce(globalObject);
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

    return fallback();
}

} // namespace Bun

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPluginClear, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    Zig::GlobalObject* global = static_cast<Zig::GlobalObject*>(globalObject);
    global->onLoadPlugins.fileNamespace.clear();
    global->onResolvePlugins.fileNamespace.clear();
    global->onLoadPlugins.groups.clear();
    global->onResolvePlugins.namespaces.clear();

    global->onLoadPlugins.clearVirtualModules();

    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPlugin, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return Bun::setupBunPlugin(globalObject, callframe, BunPluginTargetBun);
}
