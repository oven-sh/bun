#include "BunPlugin.h"

#include "headers-handwritten.h"
#include "helpers.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSModuleLoader.h>
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
#include "CommonJSModuleRecord.h"
#include "isBuiltinModule.h"

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
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callframe->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() requires at least 2 arguments"_s));
        return JSValue::encode(jsUndefined());
    }

    auto* filterObject = callframe->uncheckedArgument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());
    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();
    JSC::RegExpObject* filter = nullptr;
    if (JSValue filterValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "filter"_s))) {
        if (filterValue.isCell() && filterValue.asCell()->inherits<JSC::RegExpObject>())
            filter = jsCast<JSC::RegExpObject*>(filterValue);
    }

    if (!filter) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() expects first argument to be an object with a filter RegExp"_s));
        return JSValue::encode(jsUndefined());
    }

    String namespaceString = String();
    if (JSValue namespaceValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "namespace"_s))) {
        if (namespaceValue.isString()) {
            namespaceString = namespaceValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, encodedJSValue());
            if (!isValidNamespaceString(namespaceString)) {
                throwException(globalObject, scope, createError(globalObject, "namespace can only contain letters, numbers, dashes, or underscores"_s));
                return JSValue::encode(jsUndefined());
            }
        }
        RETURN_IF_EXCEPTION(scope, encodedJSValue());
    }

    auto func = callframe->uncheckedArgument(1);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    if (!func.isCell() || !func.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() expects second argument to be a function"_s));
        return JSValue::encode(jsUndefined());
    }

    plugin.append(vm, filter->regExp(), jsCast<JSFunction*>(func), namespaceString);
    callback(ctx, globalObject);

    return JSValue::encode(jsUndefined());
}

static EncodedJSValue jsFunctionAppendVirtualModulePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callframe->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "module() needs 2 arguments: a module ID and a function to call"_s));
        return JSValue::encode(jsUndefined());
    }

    JSValue moduleIdValue = callframe->uncheckedArgument(0);
    JSValue functionValue = callframe->uncheckedArgument(1);

    if (!moduleIdValue.isString()) {
        throwException(globalObject, scope, createError(globalObject, "module() expects first argument to be a string for the module ID"_s));
        return JSValue::encode(jsUndefined());
    }

    if (!functionValue.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "module() expects second argument to be a function"_s));
        return JSValue::encode(jsUndefined());
    }

    String moduleId = moduleIdValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    if (moduleId.isEmpty()) {
        throwException(globalObject, scope, createError(globalObject, "virtual module cannot be blank"_s));
        return JSValue::encode(jsUndefined());
    }

    if (Bun::isBuiltinModule(moduleId)) {
        throwException(globalObject, scope, createError(globalObject, makeString("module() cannot be used to override builtin module \""_s, moduleId, "\""_s)));
        return JSValue::encode(jsUndefined());
    }

    if (moduleId.startsWith("."_s)) {
        throwException(globalObject, scope, createError(globalObject, "virtual module cannot start with \".\""_s));
        return JSValue::encode(jsUndefined());
    }

    Zig::GlobalObject* global = Zig::jsCast<Zig::GlobalObject*>(globalObject);
    if (global->onLoadPlugins.virtualModules == nullptr) {
        global->onLoadPlugins.virtualModules = new BunPlugin::VirtualModuleMap;
    }
    auto* virtualModules = global->onLoadPlugins.virtualModules;

    virtualModules->set(moduleId, JSC::Strong<JSC::JSObject> { vm, jsCast<JSC::JSObject*>(functionValue) });

    JSMap* esmRegistry;

    if (auto loaderValue = global->getIfPropertyExists(global, JSC::Identifier::fromString(vm, "Loader"_s))) {
        if (auto registryValue = loaderValue.getObject()->getIfPropertyExists(global, JSC::Identifier::fromString(vm, "registry"_s))) {
            esmRegistry = jsCast<JSC::JSMap*>(registryValue);
        }
    }

    global->requireMap()->remove(globalObject, moduleIdValue);
    if (esmRegistry)
        esmRegistry->remove(globalObject, moduleIdValue);

    // bool hasBeenRequired = global->requireMap()->has(globalObject, moduleIdValue);
    // bool hasBeenImported = esmRegistry && esmRegistry->has(globalObject, moduleIdValue);
    // if (hasBeenRequired || hasBeenImported) {
    //     // callAndReplaceModule(global, moduleIdValue, functionValue, global->requireMap(), esmRegistry, hasBeenRequired, hasBeenImported);
    //     // RETURN_IF_EXCEPTION(scope, encodedJSValue());
    // }

    return JSValue::encode(jsUndefined());
}

static JSC::EncodedJSValue jsFunctionAppendOnResolvePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin, void* ctx, OnAppendPluginCallback callback)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callframe->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "onResolve() requires at least 2 arguments"_s));
        return JSValue::encode(jsUndefined());
    }

    auto* filterObject = callframe->uncheckedArgument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());
    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();
    JSC::RegExpObject* filter = nullptr;
    if (JSValue filterValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "filter"_s))) {
        if (filterValue.isCell() && filterValue.asCell()->inherits<JSC::RegExpObject>())
            filter = jsCast<JSC::RegExpObject*>(filterValue);
    }

    if (!filter) {
        throwException(globalObject, scope, createError(globalObject, "onResolve() expects first argument to be an object with a filter RegExp"_s));
        return JSValue::encode(jsUndefined());
    }

    String namespaceString = String();
    if (JSValue namespaceValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "namespace"_s))) {
        if (namespaceValue.isString()) {
            namespaceString = namespaceValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, encodedJSValue());
            if (!isValidNamespaceString(namespaceString)) {
                throwException(globalObject, scope, createError(globalObject, "namespace can only contain letters, numbers, dashes, or underscores"_s));
                return JSValue::encode(jsUndefined());
            }
        }

        RETURN_IF_EXCEPTION(scope, encodedJSValue());
    }

    auto func = callframe->uncheckedArgument(1);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    if (!func.isCell() || !func.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "onResolve() expects second argument to be a function"_s));
        return JSValue::encode(jsUndefined());
    }

    plugin.append(vm, filter->regExp(), jsCast<JSFunction*>(func), namespaceString);
    callback(ctx, globalObject);

    return JSValue::encode(jsUndefined());
}

static JSC::EncodedJSValue jsFunctionAppendOnResolvePluginGlobal(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    Zig::GlobalObject* global = Zig::jsCast<Zig::GlobalObject*>(globalObject);

    auto& plugins = global->onResolvePlugins;
    auto callback = Bun__onDidAppendPlugin;
    return jsFunctionAppendOnResolvePluginBody(globalObject, callframe, target, plugins, global->bunVM(), callback);
}

static JSC::EncodedJSValue jsFunctionAppendOnLoadPluginGlobal(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    Zig::GlobalObject* global = Zig::jsCast<Zig::GlobalObject*>(globalObject);

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

extern "C" JSC::EncodedJSValue jsFunctionBunPluginClear(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
{
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    global->onLoadPlugins.fileNamespace.clear();
    global->onResolvePlugins.fileNamespace.clear();
    global->onLoadPlugins.groups.clear();
    global->onResolvePlugins.namespaces.clear();

    delete global->onLoadPlugins.virtualModules;

    return JSValue::encode(jsUndefined());
}

extern "C" JSC::EncodedJSValue setupBunPlugin(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    JSC::VM& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callframe->argumentCount() < 1) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs at least one argument (an object)"_s);
        return JSValue::encode(jsUndefined());
    }

    JSC::JSObject* obj = callframe->uncheckedArgument(0).getObject();
    if (!obj) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs an object as first argument"_s);
        return JSValue::encode(jsUndefined());
    }

    JSC::JSValue setupFunctionValue = obj->getIfPropertyExists(globalObject, Identifier::fromString(vm, "setup"_s));
    if (!setupFunctionValue || setupFunctionValue.isUndefinedOrNull() || !setupFunctionValue.isCell() || !setupFunctionValue.isCallable()) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs a setup() function"_s);
        return JSValue::encode(jsUndefined());
    }

    if (JSValue targetValue = obj->getIfPropertyExists(globalObject, Identifier::fromString(vm, "target"_s))) {
        if (auto* targetJSString = targetValue.toStringOrNull(globalObject)) {
            auto targetString = targetJSString->value(globalObject);
            if (targetString == "node"_s) {
                target = BunPluginTargetNode;
            } else if (targetString == "bun"_s) {
                target = BunPluginTargetBun;
            } else if (targetString == "browser"_s) {
                target = BunPluginTargetBrowser;
            } else {
                JSC::throwTypeError(globalObject, throwScope, "plugin target must be one of 'node', 'bun' or 'browser'"_s);
                return JSValue::encode(jsUndefined());
            }
        }
    }

    JSFunction* setupFunction = jsCast<JSFunction*>(setupFunctionValue);
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

    JSFunction* function = jsCast<JSFunction*>(setupFunctionValue);
    JSC::CallData callData = JSC::getCallData(function);
    JSValue result = call(globalObject, function, callData, JSC::jsUndefined(), args);

    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());

    if (auto* promise = JSC::jsDynamicCast<JSC::JSPromise*>(result)) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(promise));
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

extern "C" JSC::EncodedJSValue jsFunctionBunPlugin(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
{
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    return setupBunPlugin(globalObject, callframe, BunPluginTargetBun);
}

void BunPlugin::Group::append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSFunction* func)
{
    filters.append(JSC::Strong<JSC::RegExp> { vm, filter });
    callbacks.append(JSC::Strong<JSC::JSFunction> { vm, func });
}

void BunPlugin::Base::append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSFunction* func, String& namespaceString)
{
    if (namespaceString.isEmpty() || namespaceString == "file"_s) {
        this->fileNamespace.append(vm, filter, func);
    } else if (auto found = this->group(namespaceString)) {
        found->append(vm, filter, func);
    } else {
        Group newGroup;
        newGroup.append(vm, filter, func);
        this->groups.append(WTFMove(newGroup));
        this->namespaces.append(namespaceString);
    }
}

JSFunction* BunPlugin::Group::find(JSC::JSGlobalObject* globalObject, String& path)
{
    size_t count = filters.size();
    for (size_t i = 0; i < count; i++) {
        if (filters[i].get()->match(globalObject, path, 0)) {
            return callbacks[i].get();
        }
    }

    return nullptr;
}

void BunPlugin::OnLoad::addModuleMock(JSC::VM& vm, const String& path, JSC::JSObject* mockObject)
{
    Zig::GlobalObject* globalObject = Zig::jsCast<Zig::GlobalObject*>(mockObject->globalObject());

    if (globalObject->onLoadPlugins.virtualModules == nullptr) {
        globalObject->onLoadPlugins.virtualModules = new BunPlugin::VirtualModuleMap;
    }
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;

    virtualModules->set(path, JSC::Strong<JSC::JSObject> { vm, mockObject });
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

    void finishCreation(JSC::VM&, JSC::JSObject* callback);

private:
    JSModuleMock(JSC::VM&, JSC::Structure*);
};

const JSC::ClassInfo JSModuleMock::s_info = { "ModuleMock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleMock) };

JSModuleMock* JSModuleMock::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* callback)
{
    JSModuleMock* ptr = new (NotNull, JSC::allocateCell<JSModuleMock>(vm)) JSModuleMock(vm, structure);
    ptr->finishCreation(vm, callback);
    return ptr;
}

void JSModuleMock::finishCreation(JSC::VM& vm, JSObject* callback)
{
    Base::finishCreation(vm);
    callbackFunctionOrCachedResult.set(vm, this, callback);
}

JSModuleMock::JSModuleMock(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

Structure* JSModuleMock::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

JSObject* JSModuleMock::executeOnce(JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto& vm = lexicalGlobalObject->vm();
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
    JSC::JSValue result = JSC::call(lexicalGlobalObject, callback, JSC::getCallData(callback), JSC::jsUndefined(), ArgList());
    RETURN_IF_EXCEPTION(scope, {});

    if (!result.isObject()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a function that returns an object"_s));
        return nullptr;
    }

    auto* object = result.getObject();
    this->callbackFunctionOrCachedResult.set(vm, this, object);

    return object;
}

extern "C" JSC::EncodedJSValue Bun__resolveSyncWithSource(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, BunString* from, bool is_esm);
extern "C" EncodedJSValue JSMock__jsModuleMock(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject* globalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(!globalObject)) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "Cannot run mock from a different global context"_s));
        return {};
    }

    if (callframe->argumentCount() < 1) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a module and function"_s));
        return {};
    }

    JSC::JSString* specifierString = callframe->argument(0).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::String specifier = specifierString->value(globalObject);

    if (specifier.isEmpty()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a module and function"_s));
        return {};
    }

    auto resolveSpecifier = [&]() -> void {
        JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
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
            auto catchScope = DECLARE_CATCH_SCOPE(vm);
            auto result = JSValue::decode(Bun__resolveSyncWithSource(globalObject, JSValue::encode(specifierString), &from, true));
            if (catchScope.exception()) {
                catchScope.clearException();
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

    JSC::JSValue callbackValue = callframe->argument(1);
    if (!callbackValue.isCell() || !callbackValue.isCallable()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a function"_s));
        return {};
    }

    JSC::JSObject* callback = callbackValue.getObject();

    JSModuleMock* mock = JSModuleMock::create(vm, globalObject->mockModule.mockModuleStructure.getInitializedOnMainThread(globalObject), callback);

    auto* esm = globalObject->esmRegistryMap();

    auto getJSValue = [&]() -> JSValue {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue result = mock->executeOnce(globalObject);
        RETURN_IF_EXCEPTION(scope, JSValue());

        if (result && result.isObject()) {
            while (JSC::JSPromise* promise = jsDynamicCast<JSC::JSPromise*>(result)) {
                switch (promise->status(vm)) {
                case JSC::JSPromise::Status::Rejected: {
                    result = promise->result(vm);
                    scope.throwException(globalObject, result);
                    return {};
                    break;
                }
                case JSC::JSPromise::Status::Fulfilled: {
                    result = promise->result(vm);
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

    if (JSValue entryValue = esm->get(globalObject, specifierString)) {
        removeFromESM = true;

        if (entryValue.isObject()) {
            JSObject* entry = entryValue.getObject();
            if (JSValue moduleValue = entry->getIfPropertyExists(globalObject, Identifier::fromString(vm, String("module"_s)))) {
                if (auto* mod = jsDynamicCast<JSC::AbstractModuleRecord*>(moduleValue)) {
                    JSC::JSModuleNamespaceObject* moduleNamespaceObject = mod->getModuleNamespace(globalObject);
                    JSValue exportsValue = getJSValue();
                    RETURN_IF_EXCEPTION(scope, {});
                    removeFromESM = false;

                    if (exportsValue.isObject()) {
                        // TODO: use fast path for property iteration
                        auto* object = exportsValue.getObject();
                        JSC::PropertyNameArray names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
                        JSObject::getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Exclude);
                        RETURN_IF_EXCEPTION(scope, {});

                        for (auto& name : names) {
                            // consistent with regular esm handling code
                            auto catchScope = DECLARE_CATCH_SCOPE(vm);
                            JSValue value = object->get(globalObject, name);
                            if (scope.exception()) {
                                scope.clearException();
                                value = jsUndefined();
                            }
                            moduleNamespaceObject->overrideExportValue(globalObject, name, value);
                        }

                    } else {
                        // if it's not an object, I guess we just set the default export?
                        moduleNamespaceObject->overrideExportValue(globalObject, vm.propertyNames->defaultKeyword, exportsValue);
                    }

                    RETURN_IF_EXCEPTION(scope, {});

                    // TODO: do we need to handle intermediate loading state here?
                    // entry->putDirect(vm, Identifier::fromString(vm, String("evaluated"_s)), jsBoolean(true), 0);
                    // entry->putDirect(vm, Identifier::fromString(vm, String("state"_s)), jsNumber(JSC::JSModuleLoader::Status::Ready), 0);
                }
            }
        }
    }

    if (auto entryValue = globalObject->requireMap()->get(globalObject, specifierString)) {
        removeFromCJS = true;
        if (auto* moduleObject = jsDynamicCast<Bun::JSCommonJSModule*>(entryValue)) {
            JSValue exportsValue = getJSValue();
            RETURN_IF_EXCEPTION(scope, {});

            moduleObject->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), exportsValue, 0);
            moduleObject->hasEvaluated = true;
            removeFromCJS = false;
        }
    }

    if (removeFromESM) {
        esm->remove(globalObject, specifierString);
    }

    if (removeFromCJS) {
        globalObject->requireMap()->remove(globalObject, specifierString);
    }

    globalObject->onLoadPlugins.addModuleMock(vm, specifier, mock);

    return JSValue::encode(jsUndefined());
}

template<typename Visitor>
void JSModuleMock::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSModuleMock* mock = jsCast<JSModuleMock*>(cell);
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

    JSC::JSFunction* function = group.find(globalObject, pathString);
    if (!function) {
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::MarkedArgumentBuffer arguments;
    JSC::VM& vm = globalObject->vm();

    JSC::JSObject* paramsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();
    paramsObject->putDirect(
        vm, clientData->builtinNames().pathPublicName(),
        jsString(vm, pathString));
    arguments.append(paramsObject);

    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto scope = DECLARE_CATCH_SCOPE(vm);
    scope.assertNoExceptionExceptTermination();

    JSC::CallData callData = JSC::getCallData(function);

    auto result = call(globalObject, function, callData, JSC::jsUndefined(), arguments);
    if (UNLIKELY(scope.exception())) {
        return JSValue::encode(scope.exception());
    }

    if (auto* promise = JSC::jsDynamicCast<JSPromise*>(result)) {
        switch (promise->status(vm)) {
        case JSPromise::Status::Rejected:
        case JSPromise::Status::Pending: {
            return JSValue::encode(promise);
        }
        case JSPromise::Status::Fulfilled: {
            result = promise->result(vm);
            break;
        }
        }
    }

    if (!result.isObject()) {
        JSC::throwTypeError(globalObject, throwScope, "onLoad() expects an object returned"_s);
        return JSValue::encode({});
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
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

    WTF::String pathString = path->toWTFString(BunString::ZeroCopy);
    for (size_t i = 0; i < filters.size(); i++) {
        if (!filters[i].get()->match(globalObject, pathString, 0)) {
            continue;
        }
        JSC::JSFunction* function = callbacks[i].get();
        if (UNLIKELY(!function)) {
            continue;
        }

        JSC::MarkedArgumentBuffer arguments;
        JSC::VM& vm = globalObject->vm();

        JSC::JSObject* paramsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        auto clientData = WebCore::clientData(vm);
        auto& builtinNames = clientData->builtinNames();
        paramsObject->putDirect(
            vm, clientData->builtinNames().pathPublicName(),
            Bun::toJS(globalObject, *path));
        paramsObject->putDirect(
            vm, clientData->builtinNames().importerPublicName(),
            Bun::toJS(globalObject, *importer));
        arguments.append(paramsObject);

        auto throwScope = DECLARE_THROW_SCOPE(vm);
        auto scope = DECLARE_CATCH_SCOPE(vm);
        scope.assertNoExceptionExceptTermination();

        JSC::CallData callData = JSC::getCallData(function);

        auto result = call(globalObject, function, callData, JSC::jsUndefined(), arguments);
        if (UNLIKELY(scope.exception())) {
            JSC::Exception* exception = scope.exception();
            scope.clearException();
            return JSValue::encode(exception);
        }

        if (result.isUndefinedOrNull()) {
            continue;
        }

        if (auto* promise = JSC::jsDynamicCast<JSPromise*>(result)) {
            switch (promise->status(vm)) {
            case JSPromise::Status::Pending: {
                JSC::throwTypeError(globalObject, throwScope, "onResolve() doesn't support pending promises yet"_s);
                return JSValue::encode({});
            }
            case JSPromise::Status::Rejected: {
                promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Fulfilled)));
                result = promise->result(vm);
                return JSValue::encode(result);
            }
            case JSPromise::Status::Fulfilled: {
                result = promise->result(vm);
                break;
            }
            }
        }

        if (!result.isObject()) {
            JSC::throwTypeError(globalObject, throwScope, "onResolve() expects an object returned"_s);
            return JSValue::encode({});
        }

        RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
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
        auto& vm = globalObject->vm();
        JSC::JSObject* function = virtualModuleFn.get();
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        JSValue result;

        if (Zig::JSModuleMock* moduleMock = jsDynamicCast<Zig::JSModuleMock*>(function)) {
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

        if (auto* promise = JSC::jsDynamicCast<JSPromise*>(result)) {
            switch (promise->status(vm)) {
            case JSPromise::Status::Rejected:
            case JSPromise::Status::Pending: {
                return promise;
            }
            case JSPromise::Status::Fulfilled: {
                result = promise->result(vm);
                break;
            }
            }
        }

        if (!result.isObject()) {
            JSC::throwTypeError(globalObject, throwScope, "virtual module expects an object returned"_s);
            return JSC::jsUndefined();
        }

        return result;
    }

    return fallback();
}

} // namespace Bun