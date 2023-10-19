#include "BunPlugin.h"

#include "headers-handwritten.h"
#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/Structure.h>
#include "helpers.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JavaScript.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <wtf/text/WTFString.h>
#include <JavaScriptCore/JSCInlines.h>

#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/JSPromise.h>
#include "BunClientData.h"

#include <JavaScriptCore/RegularExpression.h>

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

EncodedJSValue BunPlugin::OnLoad::run(JSC::JSGlobalObject* globalObject, BunString* namespaceString, BunString* path)
{
    Group* groupPtr = this->group(namespaceString ? Bun::toWTFString(*namespaceString) : String());
    if (groupPtr == nullptr) {
        return JSValue::encode(jsUndefined());
    }
    Group& group = *groupPtr;

    auto pathString = Bun::toWTFString(*path);

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

EncodedJSValue BunPlugin::OnResolve::run(JSC::JSGlobalObject* globalObject, BunString* namespaceString, BunString* path, BunString* importer)
{
    Group* groupPtr = this->group(namespaceString ? Bun::toWTFString(*namespaceString) : String());
    if (groupPtr == nullptr) {
        return JSValue::encode(jsUndefined());
    }
    Group& group = *groupPtr;
    auto& filters = group.filters;

    if (filters.size() == 0) {
        return JSValue::encode(jsUndefined());
    }

    auto& callbacks = group.callbacks;

    WTF::String pathString = Bun::toWTFString(*path);
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
JSC::JSValue runVirtualModule(Zig::GlobalObject* globalObject, BunString* specifier)
{
    auto fallback = [&]() -> JSC::JSValue {
        return JSValue::decode(Bun__runVirtualModule(globalObject, specifier));
    };

    if (!globalObject->onLoadPlugins.virtualModules) {
        return fallback();
    }
    auto& virtualModules = *globalObject->onLoadPlugins.virtualModules;
    WTF::String specifierString = Bun::toWTFString(*specifier);
    if (auto virtualModuleFn = virtualModules.get(specifierString)) {
        auto& vm = globalObject->vm();
        JSC::JSObject* function = virtualModuleFn.get();
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        JSC::MarkedArgumentBuffer arguments;
        JSC::CallData callData = JSC::getCallData(function);
        RELEASE_ASSERT(callData.type != JSC::CallData::Type::None);

        auto result = call(globalObject, function, callData, JSC::jsUndefined(), arguments);
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

}