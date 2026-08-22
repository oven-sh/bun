#include "BunPlugin.h"

#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSCast.h"
#include "headers-handwritten.h"
#include "helpers.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>
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
#include "JSMockFunction.h"
#include "isBuiltinModule.h"
#include "AsyncContextFrame.h"
#include "ImportMetaObject.h"

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

    if (!func.isCell() || !func.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() expects second argument to be a function"_s));
        return {};
    }

    plugin.append(vm, filter->regExp(), func.getObject(), namespaceString);
    callback(ctx, globalObject);
    RETURN_IF_EXCEPTION(scope, {});

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
    callback(ctx, globalObject);
    RETURN_IF_EXCEPTION(scope, {});

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

void BunPlugin::OnLoad::addModuleMock(JSC::VM& vm, const String& path, JSC::JSObject* mockObject, bool needsExpensiveRelativeLookup)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(mockObject->globalObject());

    if (globalObject->onLoadPlugins.virtualModules == nullptr) {
        globalObject->onLoadPlugins.virtualModules = new BunPlugin::VirtualModuleMap;
    }
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;

    virtualModules->set(path, JSC::Strong<JSC::JSObject> { vm, mockObject });

    // Set only after the map exists; moduleLoaderResolve asserts the flag
    // is false whenever virtualModules is null.
    if (needsExpensiveRelativeLookup) {
        globalObject->onLoadPlugins.mustDoExpensiveRelativeLookup = true;
    }
}

class JSModuleMock final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    mutable WriteBarrier<JSObject> callbackFunctionOrCachedResult;
    bool hasCalledModuleMock = false;
    // Auto-mocks of object-shaped exports already match what require() of the
    // real module returned, so CJS consumers must not apply the
    // `{ __esModule, default }` interop unwrap to them. Factory mocks and the
    // primitive auto-mock carrier keep the interop.
    bool suppressESModuleInterop = false;

    static JSModuleMock* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* callback);
    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSObject* executeOnce(JSC::JSGlobalObject* lexicalGlobalObject);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSModuleMock, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSModuleMock, m_subspaceForJSModuleMock));
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
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
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

// Resolve a module-mock specifier against the caller's source origin, in
// place, so jest.mock(id) and jest.requireMock(id) land on the same key.
// Throws on an invalid `file:` URL. `needsExpensiveLookup` reports whether
// the installed mock will need `mustDoExpensiveRelativeLookup`; only
// addModuleMock sets that flag, keeping it false while virtualModules is
// null (asserted in moduleLoaderResolve).
static void resolveModuleMockSpecifier(Zig::GlobalObject* globalObject, JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, JSC::ThrowScope& scope, WTF::String& specifier, JSC::JSString*& specifierString, bool& needsExpensiveLookup)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
    if (sourceOrigin.isNull())
        return;
    const URL& url = sourceOrigin.url();

    if (specifier.startsWith("file:"_s)) {
        URL fileURL = URL(url, specifier);
        if (fileURL.isValid()) {
            specifier = fileURL.fileSystemPath();
            specifierString = jsString(vm, specifier);
            needsExpensiveLookup = true;
            return;
        }
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "Invalid \"file:\" URL"_s));
        return;
    }

    if (url.isValid() && url.protocolIsFile()) {
        auto fromString = url.fileSystemPath();
        BunString from = Bun::toString(fromString);
        // Not resolving is fine (mocking a module that does not exist yet);
        // anything else thrown while resolving (e.g. by an onResolve plugin)
        // propagates.
        auto result = JSValue::decode(Bun__resolveSyncWithSourceIfExists(globalObject, JSValue::encode(specifierString), &from, true));
        if (scope.exception()) [[unlikely]]
            return;

        if (result.isString()) {
            auto* resolvedStr = asString(result);
            if (resolvedStr->length() > 0) {
                specifierString = resolvedStr;
                specifier = specifierString->value(globalObject);
            }
        } else if (specifier.startsWith("./"_s) || specifier.startsWith(".."_s)) {
            // If module resolution fails, we try to resolve it relative to the current file
            auto relativeURL = URL(url, specifier);

            if (relativeURL.isValid()) {
                needsExpensiveLookup = true;

                if (relativeURL.protocolIsFile())
                    specifier = relativeURL.fileSystemPath();
                else
                    specifier = relativeURL.string();

                specifierString = jsString(vm, specifier);
            }
        }
    }
}

// require() of a mock shaped `{ __esModule: true, default: X }` yields `X`
// (handleVirtualModuleResult in ModuleLoader.cpp); apply the same rule at
// every CJS consumer so the shape doesn't depend on which ran first.
static JSC::JSValue unwrapESModuleDefaultForCJS(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* object = value.getObject();
    if (!object)
        return value;
    auto esModuleValue = object->getIfPropertyExists(globalObject, vm.propertyNames->__esModule);
    RETURN_IF_EXCEPTION(scope, {});
    if (!esModuleValue || !esModuleValue.toBoolean(globalObject))
        return value;
    auto defaultValue = object->getIfPropertyExists(globalObject, vm.propertyNames->defaultKeyword);
    RETURN_IF_EXCEPTION(scope, {});
    if (defaultValue && !defaultValue.isUndefined())
        return defaultValue;
    return value;
}

// Unwrap a chain of synchronously-settled promises: throws the rejection
// reason, returns the fulfillment value, or returns a still-pending promise
// as-is so the caller can surface it for the user to await.
static JSC::JSValue unwrapSynchronouslySettledPromise(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue value)
{
    while (auto* promise = dynamicDowncast<JSC::JSPromise>(value)) {
        switch (promise->status()) {
        case JSC::JSPromise::Status::Rejected:
            promise->markAsHandled();
            scope.throwException(globalObject, promise->result());
            return {};
        case JSC::JSPromise::Status::Fulfilled:
            value = promise->result();
            continue;
        case JSC::JSPromise::Status::Pending:
            break;
        }
        break;
    }
    return value;
}

BUN_DECLARE_HOST_FUNCTION(JSMock__jsModuleMock);
extern "C" JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(JSMock__jsModuleMock, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
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

    // If the second argument is missing, this is an auto-mock request
    // (Jest's `jest.mock("foo")` form). Otherwise it must be a function.
    JSC::JSValue callbackValue = callframe->argument(1);
    bool isAutoMock = callframe->argumentCount() < 2 || callbackValue.isUndefined();
    if (!isAutoMock && (!callbackValue.isCell() || !callbackValue.isCallable())) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a function"_s));
        return {};
    }

    bool needsExpensiveLookup = false;
    resolveModuleMockSpecifier(globalObject, lexicalGlobalObject, callframe, scope, specifier, specifierString, needsExpensiveLookup);
    RETURN_IF_EXCEPTION(scope, {});

    // For auto-mock, synchronously require the real module and generate a
    // mock from its exports, bypassing any leftover mock in virtualModules
    // and any mock-patched requireMap entry so the real exports are seen.
    JSC::JSObject* callback = nullptr;
    bool suppressESModuleInterop = false;
    if (isAutoMock) {
        JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
        WTF::String fromPath;
        if (sourceOrigin.url().isValid() && sourceOrigin.url().protocolIsFile()) {
            fromPath = sourceOrigin.url().fileSystemPath();
        }
        if (fromPath.isEmpty()) {
            // Fall back to a relative path so bare-name resolution starts at
            // the current working directory.
            fromPath = "."_s;
        }

        auto* boundRequire = Bun::JSCommonJSModule::createBoundRequireFunction(vm, globalObject, fromPath);
        RETURN_IF_EXCEPTION(scope, {});

        // Stash any prior mock so the internal require() hits the real module,
        // restoring it if require() throws. Only JSModuleMock entries: a
        // `builder.module()` plugin callback lives exclusively in this map,
        // and removing it would make the require() below unable to resolve.
        JSC::Strong<JSC::JSObject> stashedVirtualEntry;
        if (globalObject->onLoadPlugins.hasVirtualModules()) {
            auto& virtualModules = *globalObject->onLoadPlugins.virtualModules;
            auto it = virtualModules.find(specifier);
            if (it != virtualModules.end() && dynamicDowncast<JSModuleMock>(it->value.get())) {
                stashedVirtualEntry = virtualModules.take(specifier);
            }
        }

        // Runs on every failure path below, usually with an exception already
        // pending: snapshot it, restore the stashed entries under a clean
        // scope, and rethrow the original. jsUndefined() (not the empty
        // JSValue) so the isUndefined() guard holds before the stash is set.
        JSC::JSValue stashedRequireMapEntry = JSC::jsUndefined();
        auto* requireMap = globalObject->requireMap();
        auto restoreStash = [&]() {
            // User JS under boundRequire() may have called
            // Bun.plugin.clearAll(), deleting the map — don't resurrect.
            if (stashedVirtualEntry && globalObject->onLoadPlugins.hasVirtualModules()) {
                globalObject->onLoadPlugins.virtualModules->set(specifier, WTF::move(stashedVirtualEntry));
            }
            if (!stashedRequireMapEntry.isUndefined()) {
                JSC::Exception* savedException = scope.exception();
                if (savedException) {
                    (void)scope.tryClearException();
                }
                requireMap->set(globalObject, specifierString, stashedRequireMapEntry);
                // Drop a secondary exception from set(); surface the original.
                if (scope.exception()) {
                    (void)scope.tryClearException();
                }
                if (savedException) {
                    scope.throwException(globalObject, savedException);
                }
            }
        };

        // A prior mock may have patched the cached JSCommonJSModule's
        // `.exports`; drop that entry so the real source re-evaluates. A
        // merely-require()'d module keeps its cache (real exports, no
        // side-effect re-run).
        if (stashedVirtualEntry) {
            stashedRequireMapEntry = requireMap->get(globalObject, specifierString);
            if (scope.exception()) [[unlikely]] {
                restoreStash();
                return {};
            }
            if (!stashedRequireMapEntry.isUndefined()) {
                requireMap->remove(globalObject, specifierString);
                if (scope.exception()) [[unlikely]] {
                    restoreStash();
                    return {};
                }
            }
        }

        JSC::JSValue realExports;
        if (boundRequire) {
            JSC::CallData callData = JSC::getCallData(boundRequire);
            JSC::MarkedArgumentBuffer args;
            args.append(specifierString);
            NakedPtr<JSC::Exception> requireException = nullptr;
            realExports = JSC::profiledCall(globalObject, JSC::ProfilingReason::API, boundRequire, callData, JSC::jsUndefined(), args, requireException);
            if (requireException) {
                restoreStash();
                scope.throwException(globalObject, requireException->value());
                return {};
            }
            if (scope.exception()) [[unlikely]] {
                restoreStash();
                return {};
            }
        }

        JSC::JSValue mockValue = Bun::createAutoMockFromExports(globalObject, realExports);
        if (scope.exception()) [[unlikely]] {
            restoreStash();
            return {};
        }

        bool realExportsWasNamespace = realExports && realExports.isObject()
            && realExports.getObject()->type() == JSC::ModuleNamespaceObjectType;

        JSC::JSObject* mockObject = mockValue.isObject() ? mockValue.getObject() : nullptr;
        // Exotic exports (Array, Date, Map, ...) pass through the walker
        // unchanged, so `mockObject` would alias the real user-owned object;
        // writing `default` onto it would be an observable mutation.
        bool walkerAliasesRealExports = mockObject
            && realExports && realExports.isObject()
            && mockObject == realExports.getObject();
        // A freshly built walker mock already matches what require() of the
        // real module returned, so CJS consumers must not unwrap
        // `{ __esModule, default }` out of it; the carriers below need the
        // interop to hand the raw value back.
        suppressESModuleInterop = mockObject != nullptr && !walkerAliasesRealExports;
        if (!mockObject || walkerAliasesRealExports) {
            // Primitive and exotic exports need an object carrier;
            // `{ default, __esModule }` is the shape Bun's interop unwraps
            // back to the raw value for both require() and default imports.
            JSC::JSObject* carrier = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype());
            if (scope.exception()) [[unlikely]] {
                restoreStash();
                return {};
            }
            carrier->putDirect(vm, vm.propertyNames->defaultKeyword, mockValue, 0);
            carrier->putDirect(vm, vm.propertyNames->__esModule, JSC::jsBoolean(true), 0);
            mockObject = carrier;
        } else if (!realExportsWasNamespace) {
            // CJS/builtin sources have no `default`, so `import pkg from`
            // would fail to link. Mirror require-to-import interop: default
            // is the exports object itself; an existing default wins.
            auto hasDefault = mockObject->hasOwnProperty(globalObject, vm.propertyNames->defaultKeyword);
            if (scope.exception()) [[unlikely]] {
                restoreStash();
                return {};
            }
            if (!hasDefault) {
                mockObject->putDirect(vm, vm.propertyNames->defaultKeyword, mockObject, 0);
            }
        }

        // Re-seat the prior entry in case a shared post-block step throws
        // before addModuleMock() replaces it; on success the replace makes
        // this a no-op. Same clearAll() re-check as restoreStash.
        if (stashedVirtualEntry && globalObject->onLoadPlugins.hasVirtualModules()) {
            globalObject->onLoadPlugins.virtualModules->set(specifier, WTF::move(stashedVirtualEntry));
        }

        callback = mockObject;
    } else {
        callback = callbackValue.getObject();
    }

    JSModuleMock* mock = JSModuleMock::create(vm, globalObject->mockModule.mockModuleStructure.getInitializedOnMainThread(globalObject), callback);
    if (isAutoMock) {
        // Pre-cache the result so `executeOnce` returns it directly instead
        // of trying to call the mock object as a factory.
        mock->hasCalledModuleMock = true;
        mock->suppressESModuleInterop = suppressESModuleInterop;
    }

    auto getJSValue = [&]() -> JSValue {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue result = mock->executeOnce(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        if (result && result.isObject()) {
            result = unwrapSynchronouslySettledPromise(globalObject, scope, result);
            RETURN_IF_EXCEPTION(scope, {});
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

                            // Read every export before overriding any, so a throwing getter leaves the
                            // namespace untouched.
                            MarkedArgumentBuffer values;
                            values.ensureCapacity(names.size());
                            for (auto& name : names) {
                                JSValue value = object->get(globalObject, name);
                                RETURN_IF_EXCEPTION(scope, {});
                                values.append(value);
                            }
                            if (values.hasOverflowed()) [[unlikely]] {
                                throwOutOfMemoryError(globalObject, scope);
                                return {};
                            }
                            for (size_t i = 0; i < names.size(); ++i) {
                                moduleNamespaceObject->overrideExportValue(globalObject, names[i], values.at(i));
                                RETURN_IF_EXCEPTION(scope, {});
                            }

                        } else {
                            // if it's not an object, I guess we just set the default export?
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
            JSValue exportsValue = getJSValue();
            RETURN_IF_EXCEPTION(scope, {});

            // Same interop unwrap a fresh require() of this mock would do.
            if (!mock->suppressESModuleInterop) {
                exportsValue = unwrapESModuleDefaultForCJS(globalObject, exportsValue);
                RETURN_IF_EXCEPTION(scope, {});
            }

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

    globalObject->onLoadPlugins.addModuleMock(vm, specifier, mock, needsExpensiveLookup);

    return JSValue::encode(jsUndefined());
}

// jest.requireMock(specifier) — return the mocked version of a module.
// If a mock has already been registered with jest.mock(), return its cached
// result. Otherwise synthesise an auto-mock from the real module's exports.
BUN_DECLARE_HOST_FUNCTION(JSMock__jsRequireMock);
extern "C" JSC_DEFINE_HOST_FUNCTION(JSMock__jsRequireMock, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!globalObject) [[unlikely]] {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "Cannot run requireMock from a different global context"_s));
        return {};
    }

    if (callframe->argumentCount() < 1) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "requireMock(module) requires a module name"_s));
        return {};
    }

    if (!callframe->argument(0).isString()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "requireMock(module) requires a module name string"_s));
        return {};
    }

    JSC::JSString* specifierString = callframe->argument(0).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    WTF::String specifier = specifierString->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (specifier.isEmpty()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "requireMock(module) requires a module name"_s));
        return {};
    }

    // requireMock never installs into virtualModules, so the expensive-lookup
    // report is ignored.
    bool ignoredNeedsExpensiveLookup = false;
    resolveModuleMockSpecifier(globalObject, lexicalGlobalObject, callframe, scope, specifier, specifierString, ignoredNeedsExpensiveLookup);
    RETURN_IF_EXCEPTION(scope, {});

    // A jest.mock(specifier) already installed a mock: return its cached
    // result. builder.module() callbacks are not mocks; fall through.
    if (globalObject->onLoadPlugins.hasVirtualModules()) {
        auto& virtualModules = *globalObject->onLoadPlugins.virtualModules;
        if (auto existing = virtualModules.get(specifier)) {
            if (auto* moduleMock = dynamicDowncast<JSModuleMock>(existing.get())) {
                JSObject* result = moduleMock->executeOnce(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                if (result) {
                    JSValue resultValue = unwrapSynchronouslySettledPromise(globalObject, scope, JSValue(result));
                    RETURN_IF_EXCEPTION(scope, {});
                    // Match what `require()` returns for this mock, so the
                    // shape doesn't depend on which call came first.
                    if (!moduleMock->suppressESModuleInterop) {
                        resultValue = unwrapESModuleDefaultForCJS(globalObject, resultValue);
                        RETURN_IF_EXCEPTION(scope, {});
                    }
                    return JSValue::encode(resultValue);
                }
            }
            // Not a JSModuleMock (e.g. a builder.module() callback) — fall
            // through and build an auto-mock from the real module.
        }
    }

    // The side-map keeps require()/import() seeing the real module, matching
    // Jest: jest.mock() patches imports, jest.requireMock() does not.
    if (auto& cache = globalObject->mockModule.requireMockCache) {
        JSC::JSMap* map = cache.get();
        JSValue cached = map->get(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
        if (!cached.isUndefined()) {
            return JSValue::encode(cached);
        }
    }

    // Not cached — synthesise from the real module.
    WTF::String fromPath;
    JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
    if (sourceOrigin.url().isValid() && sourceOrigin.url().protocolIsFile()) {
        fromPath = sourceOrigin.url().fileSystemPath();
    }
    if (fromPath.isEmpty()) {
        fromPath = "."_s;
    }

    auto* boundRequire = Bun::JSCommonJSModule::createBoundRequireFunction(vm, globalObject, fromPath);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSValue realExports;
    if (boundRequire) {
        JSC::CallData callData = JSC::getCallData(boundRequire);
        JSC::MarkedArgumentBuffer args;
        args.append(specifierString);
        NakedPtr<JSC::Exception> requireException = nullptr;
        realExports = JSC::profiledCall(globalObject, JSC::ProfilingReason::API, boundRequire, callData, JSC::jsUndefined(), args, requireException);
        if (requireException) {
            scope.throwException(globalObject, requireException->value());
            return {};
        }
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSC::JSValue mockValue = Bun::createAutoMockFromExports(globalObject, realExports);
    RETURN_IF_EXCEPTION(scope, {});

    // Cache so repeat calls return the same instance. Primitives are cached
    // bare, the same shape require() would have returned.
    if (!globalObject->mockModule.requireMockCache) {
        JSC::JSMap* map = JSC::JSMap::create(vm, globalObject->mapStructure());
        globalObject->mockModule.requireMockCache.set(vm, map);
    }
    globalObject->mockModule.requireMockCache.get()->set(globalObject, specifierString, mockValue);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(mockValue);
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

EncodedJSValue BunPlugin::OnLoad::run(JSC::JSGlobalObject* globalObject, const BunString* namespaceString, const BunString* path)
{
    Group* groupPtr = this->group(namespaceString ? namespaceString->toWTFString(BunString::ZeroCopy) : String());
    if (groupPtr == nullptr) {
        return JSValue::encode(jsUndefined());
    }
    Group& group = *groupPtr;

    auto pathString = path->toWTFString(BunString::ZeroCopy);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* function = group.find(globalObject, pathString);
    RETURN_IF_EXCEPTION(scope, {});
    if (!function) {
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::MarkedArgumentBuffer arguments;

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

extern "C" JSC::EncodedJSValue Bun__runOnResolvePlugins(Zig::GlobalObject* globalObject, const BunString* namespaceString, const BunString* path, const BunString* from, BunPluginTarget target)
{
    return globalObject->onResolvePlugins.run(globalObject, namespaceString, path, from);
}

extern "C" JSC::EncodedJSValue Bun__runOnLoadPlugins(Zig::GlobalObject* globalObject, const BunString* namespaceString, const BunString* path, BunPluginTarget target)
{
    return globalObject->onLoadPlugins.run(globalObject, namespaceString, path);
}

namespace Bun {

Structure* createModuleMockStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Zig::JSModuleMock::createStructure(vm, globalObject, prototype);
}

JSC::JSValue runVirtualModule(Zig::GlobalObject* globalObject, BunString* specifier, bool& wasModuleMock, bool& suppressESModuleInterop)
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
            suppressESModuleInterop = moduleMock->suppressESModuleInterop;
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
    global->onLoadPlugins.clear();
    global->onResolvePlugins.clear();

    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPlugin, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return Bun::setupBunPlugin(globalObject, callframe, BunPluginTargetBun);
}
