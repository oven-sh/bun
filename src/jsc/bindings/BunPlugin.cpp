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
#include <JavaScriptCore/JSMapIterator.h>
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
#include <wtf/text/WTFString.h>

#include "BunClientData.h"
#include "JSCommonJSModule.h"
#include "isBuiltinModule.h"
#include "AsyncContextFrame.h"
#include "ImportMetaObject.h"

namespace Zig {

extern "C" void Bun__onDidAppendPlugin(void* bunVM, JSGlobalObject* globalObject);
extern "C" bool Bun__VirtualMachine__isInPreload(void* bunVM);
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

    // `Bun.plugin({ module })` virtual modules persist across per-file
    // `bun test` teardown — they're process-level plugin registrations,
    // not test-local mocks.
    global->onLoadPlugins.addModuleMock(vm, moduleId, uncheckedDowncast<JSC::JSObject>(functionValue), /*persistent=*/true, /*mockBorn=*/false, /*cjsEntryPreExisted=*/false);

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

void BunPlugin::OnLoad::addModuleMock(JSC::VM& vm, const String& path, JSC::JSObject* mockObject, bool persistent, bool mockBorn, bool cjsEntryPreExisted)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(mockObject->globalObject());
    auto& onLoad = globalObject->onLoadPlugins;

    if (onLoad.virtualModules == nullptr) {
        onLoad.virtualModules = new BunPlugin::VirtualModuleMap;
    }
    auto* virtualModules = onLoad.virtualModules;

    // Capture the displaced entry *before* overwriting so transient teardown
    // can restore the preload / `Bun.plugin` mock this call is shadowing.
    JSC::Strong<JSC::JSObject> displacedEntry;
    bool displacedWasPersistent = false;
    if (auto existing = virtualModules->get(path)) {
        displacedEntry = JSC::Strong<JSC::JSObject> { vm, existing.get() };
        displacedWasPersistent = onLoad.persistentMockPaths && onLoad.persistentMockPaths->contains(path);
    }

    virtualModules->set(path, JSC::Strong<JSC::JSObject> { vm, mockObject });

    if (persistent) {
        if (onLoad.persistentMockPaths == nullptr) {
            onLoad.persistentMockPaths = new BunPlugin::PersistentMockPathSet;
        }
        onLoad.persistentMockPaths->add(path);
        // A persistent install clears any stale transient record for this
        // path — the persistent entry now owns the slot and teardown must
        // not evict it.
        if (onLoad.transientMockRecords) {
            onLoad.transientMockRecords->remove(path);
        }
    } else {
        // Transient install: track what we displaced so teardown can put it
        // back. Demote the path from `persistentMockPaths` — the current
        // value in `virtualModules` is the transient mock and is not itself
        // persistent. `displacedWasPersistent` remembers that the prior
        // owner was persistent so teardown can re-promote the path when it
        // restores the displaced entry.
        if (onLoad.persistentMockPaths) {
            onLoad.persistentMockPaths->remove(path);
        }
        if (onLoad.transientMockRecords == nullptr) {
            onLoad.transientMockRecords = new BunPlugin::InstalledMocksMap;
        }
        // If this is the *first* transient install for this path in the
        // current test file, record displacement state. If this overwrites
        // a previous transient install (test file mocks the same path
        // twice), keep the original displacement + the original ESM
        // snapshot we already took — re-snapshotting would capture the
        // previous mock's values, not the real module's.
        auto it = onLoad.transientMockRecords->find(path);
        if (it == onLoad.transientMockRecords->end()) {
            InstalledMockRecord record;
            record.displacedEntry = std::move(displacedEntry);
            record.displacedWasPersistent = displacedWasPersistent;
            record.wasMockBorn = mockBorn;
            record.cjsEntryPreExisted = cjsEntryPreExisted;
            onLoad.transientMockRecords->set(path, std::move(record));
        }
    }
}

class JSModuleMock final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    mutable WriteBarrier<JSObject> callbackFunctionOrCachedResult;
    bool hasCalledModuleMock = false;

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

    // Mocks installed while `--preload` is executing persist across `bun test`
    // per-file teardown; mocks installed by a test file are transient. We need
    // the flag here (not only inside `addModuleMock`) so we know whether to
    // capture the original ESM namespace values for teardown-time restore.
    const bool persistent = Bun__VirtualMachine__isInPreload(globalObject->bunVM());

    // Snapshot of the module-environment values the mock is about to overwrite.
    // Populated only for transient mocks against already-loaded ESM modules;
    // replayed by `BunPlugin__clearTransientModuleMocks` so re-exporters that
    // bind through this module's environment slots revert to the real values.
    JSC::JSModuleNamespaceObject* mockedNamespace = nullptr;
    WTF::Vector<std::pair<JSC::Identifier, JSC::Strong<JSC::Unknown>>> esmOriginals;

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
                        if (!persistent) {
                            mockedNamespace = moduleNamespaceObject;
                        }

                        auto snapshotAndOverride = [&](JSC::Identifier name, JSValue value) -> bool {
                            if (!persistent) {
                                auto topExceptionScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
                                JSValue original = moduleNamespaceObject->get(globalObject, name);
                                if (scope.exception()) [[unlikely]] {
                                    (void)scope.tryClearException();
                                    original = jsUndefined();
                                }
                                esmOriginals.append({ name, JSC::Strong<JSC::Unknown> { vm, original } });
                            }
                            moduleNamespaceObject->overrideExportValue(globalObject, name, value);
                            return !scope.exception();
                        };

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
                                if (!snapshotAndOverride(name, value)) {
                                    RETURN_IF_EXCEPTION(scope, {});
                                }
                            }

                        } else {
                            // if it's not an object, I guess we just set the default export?
                            if (!snapshotAndOverride(vm.propertyNames->defaultKeyword, exportsValue)) {
                                RETURN_IF_EXCEPTION(scope, {});
                            }
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

    // No loaded-and-linked namespace at install time means any module record
    // this path acquires afterwards was materialized from the mock factory.
    // A require-cache entry kept in place (exports replaced above) means its
    // first requirer predates the mock and captured real values.
    globalObject->onLoadPlugins.addModuleMock(vm, specifier, mock, persistent,
        /*mockBorn=*/!mockedNamespace,
        /*cjsEntryPreExisted=*/entryValue && !removeFromCJS);

    // Attach the ESM teardown snapshot (if any) to the freshly-created
    // transient record. `addModuleMock` already set up the record slot;
    // filling in the namespace + originals here keeps the data-collection
    // logic local to the overrideExportValue loop above.
    if (!persistent && mockedNamespace) {
        auto& onLoad = globalObject->onLoadPlugins;
        if (onLoad.transientMockRecords) {
            // Skip records whose first install was mock-born: the namespace a
            // later re-mock finds was itself materialized from a mock factory,
            // so "originals" snapshotted from it are mock values. Leaving the
            // record snapshot-free keeps teardown on the eviction path.
            if (auto it = onLoad.transientMockRecords->find(specifier); it != onLoad.transientMockRecords->end() && !it->value.wasMockBorn) {
                if (!it->value.esmNamespace) {
                    it->value.esmNamespace = JSC::Strong<JSC::JSModuleNamespaceObject> { vm, mockedNamespace };
                }
                // Merge per export name, keeping the first snapshot of each:
                // it reflects the value the name held before any mock in this
                // file touched it. A later mock of the same path may override
                // a *different* export set (first `{a}`, then `{b}`) — `b`'s
                // original comes from the second call's snapshot, while a
                // re-snapshot of `a` would capture the first mock's value and
                // must be ignored.
                for (auto& pair : esmOriginals) {
                    bool alreadyRecorded = false;
                    for (const auto& existing : it->value.esmOriginals) {
                        if (existing.first == pair.first) {
                            alreadyRecorded = true;
                            break;
                        }
                    }
                    if (!alreadyRecorded) {
                        it->value.esmOriginals.append(std::move(pair));
                    }
                }
            }
        }
    }

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

    delete global->onLoadPlugins.virtualModules;
    global->onLoadPlugins.virtualModules = nullptr;
    global->onLoadPlugins.mustDoExpensiveRelativeLookup = false;

    delete global->onLoadPlugins.persistentMockPaths;
    global->onLoadPlugins.persistentMockPaths = nullptr;

    delete global->onLoadPlugins.transientMockRecords;
    global->onLoadPlugins.transientMockRecords = nullptr;

    return JSC::JSValue::encode(JSC::jsUndefined());
}

/// Clears per-test-file `mock.module(...)` registrations:
/// - restores the ESM module-environment values the mock overrode (so cached
///   re-exporters that bind through the same slot see the real value again),
/// - restores the displaced preload / `Bun.plugin({ module })` entry if the
///   transient mock shadowed one, or removes the `virtualModules` slot
///   entirely if there was nothing to restore,
/// - evicts the ESM registry entry and CJS require-cache entry for fully
///   removed mocks, so the next import re-executes the real source,
/// - transitively evicts cached modules that imported a module materialized
///   from a transient mock factory (their bindings chain into environment
///   slots that never held real values).
///
/// Persistent mocks (paths currently in `persistentMockPaths`) are left
/// untouched. Called from Rust's per-file teardown in `bun test`.
extern "C" void BunPlugin__clearTransientModuleMocks(Zig::GlobalObject* global)
{
    auto& onLoad = global->onLoadPlugins;
    auto* transientRecords = onLoad.transientMockRecords;
    if (transientRecords == nullptr || transientRecords->isEmpty()) {
        return;
    }

    // Take ownership of the map so iteration doesn't alias with re-entry
    // from any JS the restore path might invoke (overrideExportValue,
    // requireMap::remove). A fresh empty map covers the tail case of a JS
    // callback that itself calls mock.module() during teardown.
    std::unique_ptr<Zig::BunPlugin::InstalledMocksMap> records { transientRecords };
    onLoad.transientMockRecords = nullptr;

    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* moduleLoader = global->moduleLoader();
    auto* requireMap = global->requireMap();
    auto* virtualModules = onLoad.virtualModules;

    // Module records that were materialized *from* a transient mock factory
    // (install saw no registry entry, so there were no original values to
    // snapshot — the record's environment was born holding mock values).
    // Evicting only such a record is not enough: cached importers hold live
    // bindings into its environment slots, so they (and their importers) are
    // evicted transitively below.
    WTF::HashSet<JSC::AbstractModuleRecord*> mockBornRecords;
    auto collectMockBornRecord = [&](const WTF::String& path) {
        auto ident = JSC::Identifier::fromString(vm, path);
        if (auto* regEntry = moduleLoader->registryEntry(ident)) {
            if (auto* rec = regEntry->record()) {
                mockBornRecords.add(rec);
            }
        }
        return ident;
    };

    // CJS modules whose cached exports came from a transient mock: the
    // require-map values of every evicted transient path, plus (transitively)
    // any cached module whose `m_children` reaches one. A CJS consumer copies
    // values out of the mocked module at require time, so unlike ESM there is
    // no binding to restore — the consumer itself must re-run.
    WTF::HashSet<JSC::JSCell*> poisonedCJSModules;
    // Require-map keys (filenames) queued for eviction by the CJS walk.
    // MarkedArgumentBuffer, not a plain Vector: these JSValues are held
    // across allocating calls (jsString, JSMapIterator::create, map
    // mutations), and heap-backed storage is invisible to the conservative
    // scanner — an eviction below can sever a queued string's last other
    // root before its turn comes.
    JSC::MarkedArgumentBuffer cjsKeysToEvict;
    size_t cjsKeysDrained = 0;
    // Poison a cached CJS module and walk its `m_parent` chain: the *first*
    // requirer of an ESM(-mocked) module gets no `m_children` edge (the
    // namespace early-return in `overridableRequire` skips the recording
    // call), but module creation recorded the requirer as the parent.
    auto poisonModuleAndParents = [&](Bun::JSCommonJSModule* mod) {
        while (mod && !poisonedCJSModules.contains(mod)) {
            poisonedCJSModules.add(mod);
            if (JSC::JSValue filename = mod->filename(); filename && filename.isString()) {
                cjsKeysToEvict.append(filename);
            }
            mod = mod->m_parent.get();
        }
    };
    // Callers skip this entirely when the require-cache entry predates the
    // mock install: pre-mock requirers captured real values, and both the
    // `m_parent` back-edge and `m_children` edges point at the same kept
    // cell for pre- and post-mock requirers alike, so poisoning it would
    // re-run pre-mock side effects (e.g. preload setup) on every file.
    auto poisonRequireMapEntry = [&](JSC::JSString* pathString) {
        JSC::JSValue cached = requireMap->get(global, pathString);
        if (scope.clearExceptionExceptTermination() && cached && cached.isCell()) {
            poisonedCJSModules.add(cached.asCell());
            if (auto* mod = dynamicDowncast<Bun::JSCommonJSModule>(cached)) {
                poisonModuleAndParents(mod->m_parent.get());
            }
        }
    };

    for (auto& entry : *records) {
        const auto& path = entry.key;
        auto& record = entry.value;

        // Skip paths that were re-installed as persistent after this
        // transient record was created. `addModuleMock(persistent=true)`
        // already cleared the path from `transientMockRecords`, but guard
        // again — the map could have been mutated by a re-entry.
        if (onLoad.persistentMockPaths && onLoad.persistentMockPaths->contains(path)
            && !record.displacedWasPersistent) {
            continue;
        }

        // 1. Revert the module-environment slots we wrote into at install.
        //    Covers transitive re-exporters that bind through the same slot.
        if (auto* ns = record.esmNamespace.get()) {
            for (auto& [name, strong] : record.esmOriginals) {
                ns->overrideExportValue(global, name, strong.get());
                if (!scope.clearExceptionExceptTermination()) {
                    break;
                }
            }
        }
        if (!scope.clearExceptionExceptTermination()) {
            break;
        }

        // 2. Restore or remove the `virtualModules` slot.
        if (record.displacedEntry && virtualModules) {
            virtualModules->set(path, std::move(record.displacedEntry));
            if (record.displacedWasPersistent) {
                if (onLoad.persistentMockPaths == nullptr) {
                    onLoad.persistentMockPaths = new Zig::BunPlugin::PersistentMockPathSet;
                }
                onLoad.persistentMockPaths->add(path);
            }
            // Install wrote the transient mock's exports in place into any
            // cached `JSCommonJSModule` and there is no CJS snapshot to
            // replay, so always drop the require-cache entry — the next
            // `require()` misses and re-runs the restored (preload) factory.
            auto* pathString = JSC::jsString(vm, path);
            if (!record.cjsEntryPreExisted) {
                poisonRequireMapEntry(pathString);
            }
            requireMap->remove(global, pathString);
            if (!scope.clearExceptionExceptTermination()) {
                break;
            }
            // ESM: with a snapshot, step 1 already restored the cached
            // record's environment to the values it held before this
            // install (the preload mock's values), so keep it. Mock-born:
            // any registry record was materialized from the transient
            // factory after install — evict it so the next import
            // re-resolves through the restored preload shim.
            if (record.wasMockBorn) {
                auto ident = collectMockBornRecord(path);
                WTF::Locker locker { moduleLoader->cellLock() };
                moduleLoader->removeEntry(ident);
            }
        } else {
            if (virtualModules) {
                virtualModules->remove(path);
            }
            // Mock-born: the registry record was materialized from the mock
            // factory — evict it so the next import re-executes the real
            // source (its importers are evicted transitively below).
            // Otherwise step 1 restored the record's env slots in place, so
            // keep the entry: cached re-exporters bind through it, and a
            // later file's mock.module() must find it to override those
            // bindings again.
            if (record.wasMockBorn) {
                auto ident = collectMockBornRecord(path);
                // JSModuleLoader::visitChildrenImpl iterates the registry maps
                // on the GC thread under cellLock(); take the same lock so
                // the removal can't race it.
                WTF::Locker locker { moduleLoader->cellLock() };
                moduleLoader->removeEntry(ident);
            }
            auto* pathString = JSC::jsString(vm, path);
            if (!record.cjsEntryPreExisted) {
                poisonRequireMapEntry(pathString);
            }
            requireMap->remove(global, pathString);
            if (!scope.clearExceptionExceptTermination()) {
                break;
            }
        }
    }

    // Transitively evict cached modules whose dependency graph reaches a
    // mock-born record. Their import bindings chain into environment slots
    // that never held real values, so unlike the snapshot/restore path there
    // is nothing to revert in place — they must re-import. Reads of the
    // registry don't race the GC marker (it only iterates under its own
    // lock and never mutates); removals are deferred past each pass because
    // `removeEntry` invalidates iteration, and they take `cellLock()` like
    // every other registry mutation.
    if (!mockBornRecords.isEmpty()) {
        bool changed = true;
        while (changed) {
            changed = false;
            WTF::Vector<JSC::Identifier> dependentKeys;
            for (auto& [key, entryBarrier] : moduleLoader->moduleMap()) {
                if (!key.first) {
                    continue;
                }
                auto* regEntry = entryBarrier.get();
                if (!regEntry) {
                    continue;
                }
                auto* rec = regEntry->record();
                if (!rec || mockBornRecords.contains(rec)) {
                    continue;
                }
                for (auto& [requestKey, loaded] : rec->loadedModules()) {
                    if (loaded.m_module && mockBornRecords.contains(loaded.m_module.get())) {
                        dependentKeys.append(JSC::Identifier::fromUid(vm, key.first));
                        mockBornRecords.add(rec);
                        changed = true;
                        break;
                    }
                }
            }
            if (!dependentKeys.isEmpty()) {
                // A dependent that was also `require()`d has a require-map
                // entry wrapping the same (now-evicted) module; drop and
                // poison it so the CJS walk below catches its own consumers.
                // Dependents were loaded under the mock, so their requirers
                // captured tainted values: walk their parent chains.
                for (auto& ident : dependentKeys) {
                    auto* keyString = JSC::jsString(vm, ident.string());
                    poisonRequireMapEntry(keyString);
                    requireMap->remove(global, keyString);
                    if (!scope.clearExceptionExceptTermination()) {
                        break;
                    }
                }
                WTF::Locker locker { moduleLoader->cellLock() };
                for (auto& ident : dependentKeys) {
                    moduleLoader->removeEntry(ident);
                }
            }
        }
    }

    // Transitively evict CJS consumers of poisoned modules. Two edge kinds
    // link a consumer to what it required: `m_children` (recorded for
    // second-and-later requirers and for plain-CJS first requires) and the
    // dep's `m_parent` back-edge (first requirer — the only edge when the
    // require resolved to an ESM/mocked namespace). A consumer copies values
    // out at require time, so there is nothing to restore in place — it must
    // re-run. Pure-CJS consumers never appear in the ESM registry, hence the
    // separate walk over the require map. Keys are collected per pass and
    // removed afterwards to keep iteration and mutation separate.
    if (!poisonedCJSModules.isEmpty() && !cjsKeysToEvict.hasOverflowed()) {
        bool changed = true;
        while (changed || cjsKeysDrained < cjsKeysToEvict.size()) {
            changed = false;
            auto* iter = JSC::JSMapIterator::create(vm, global->mapIteratorStructure(), requireMap, JSC::IterationKind::Entries);
            if (!scope.clearExceptionExceptTermination() || !iter) {
                break;
            }
            JSC::JSValue key;
            JSC::JSValue value;
            while (iter->nextKeyValue(global, key, value)) {
                auto* mod = dynamicDowncast<Bun::JSCommonJSModule>(value);
                if (!mod || poisonedCJSModules.contains(mod)) {
                    continue;
                }
                for (const auto& childBarrier : mod->m_children) {
                    JSC::JSValue child = childBarrier.get();
                    if (child && child.isCell() && poisonedCJSModules.contains(child.asCell())) {
                        cjsKeysToEvict.append(key);
                        poisonedCJSModules.add(mod);
                        poisonModuleAndParents(mod->m_parent.get());
                        changed = true;
                        break;
                    }
                }
            }
            if (!scope.clearExceptionExceptTermination() || cjsKeysToEvict.hasOverflowed()) {
                break;
            }
            size_t drainEnd = cjsKeysToEvict.size();
            for (size_t i = cjsKeysDrained; i < drainEnd; ++i) {
                JSC::JSValue depKey = cjsKeysToEvict.at(i);
                requireMap->remove(global, depKey);
                if (!scope.clearExceptionExceptTermination()) {
                    break;
                }
                // Drop any same-path ESM wrapper record so `import` of this
                // consumer re-evaluates as well.
                auto keyStr = depKey.toWTFString(global);
                if (!scope.clearExceptionExceptTermination()) {
                    break;
                }
                auto ident = JSC::Identifier::fromString(vm, keyStr);
                WTF::Locker locker { moduleLoader->cellLock() };
                moduleLoader->removeEntry(ident);
            }
            cjsKeysDrained = drainEnd;
        }
    }

    // `mustDoExpensiveRelativeLookup` is set when a `file:` URL or
    // unresolvable relative specifier is mocked (see lines ~555, ~583). If
    // no virtual modules remain, drop the flag — `moduleLoaderResolve`
    // asserts `!mustDoExpensiveRelativeLookup` when `hasVirtualModules()`
    // is false (ZigGlobalObject.cpp:3393). If persistent entries still
    // exist, leave it alone: we don't know which ones need the flag.
    if (virtualModules && virtualModules->isEmpty()) {
        delete onLoad.virtualModules;
        onLoad.virtualModules = nullptr;
        onLoad.mustDoExpensiveRelativeLookup = false;
    }
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPlugin, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return Bun::setupBunPlugin(globalObject, callframe, BunPluginTargetBun);
}
