#include "JSBundlerPlugin.h"

#include "headers-handwritten.h"
#include "JavaScriptCore/CatchScope.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSTypeInfo.h"
#include "JavaScriptCore/Structure.h"
#include "helpers.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JavaScript.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "wtf/text/WTFString.h"
#include "JavaScriptCore/JSCInlines.h"

#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "JavaScriptCore/RegExpObject.h"
#include "JavaScriptCore/JSPromise.h"
#include "BunClientData.h"
#include "ModuleLoader.h"
#include "JavaScriptCore/RegularExpression.h"

namespace Bun {

#define WRAP_BUNDLER_PLUGIN(argName) JSValue(bitwise_cast<double>(reinterpret_cast<uintptr_t>(argName)))
#define UNWRAP_BUNDLER_PLUGIN(callFrame) reinterpret_cast<JSBundlerPlugin*>(bitwise_cast<uintptr_t>(callFrame->thisValue().asDouble()))

WTF_MAKE_ISO_ALLOCATED_IMPL(JSBundlerPlugin);

static bool isValidNamespaceString(String& namespaceString)
{
    static JSC::Yarr::RegularExpression* namespaceRegex = nullptr;
    if (!namespaceRegex) {
        namespaceRegex = new JSC::Yarr::RegularExpression("^([/@a-zA-Z0-9_\\-]+)$"_s);
    }
    return namespaceRegex->match(namespaceString) > -1;
}

static EncodedJSValue jsFunctionAppendOnLoadPluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, JSBundlerPlugin& plugin)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Ref protect(plugin);

    if (callframe->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() requires at least 2 arguments"_s));
        return JSValue::encode(jsUndefined());
    }

    auto* filterObject = callframe->uncheckedArgument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());
    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();
    JSC::RegExpObject* filter = nullptr;
    if (JSValue filterValue = filterObject->getIfPropertyExists(globalObject, builtinNames.filterPublicName())) {
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

    plugin.onLoad.append(vm, filter->regExp(), jsCast<JSFunction*>(func), namespaceString);

    return JSValue::encode(jsUndefined());
}

static EncodedJSValue jsFunctionAppendOnResolvePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, JSBundlerPlugin& plugin)
{
    Ref protect(plugin);
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
    if (JSValue filterValue = filterObject->getIfPropertyExists(globalObject, builtinNames.filterPublicName())) {
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

    plugin.onResolve.append(vm, filter->regExp(), jsCast<JSFunction*>(func), namespaceString);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnLoadJSBundlerPlugin, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& plugin = *UNWRAP_BUNDLER_PLUGIN(callframe);
    return jsFunctionAppendOnLoadPluginBody(globalObject, callframe, plugin);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnResolveJSBundlerPlugin, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& plugin = *UNWRAP_BUNDLER_PLUGIN(callframe);
    return jsFunctionAppendOnResolvePluginBody(globalObject, callframe, plugin);
}

extern "C" EncodedJSValue setupJSBundlerPlugin(JSBundlerPlugin* bundlerPlugin, JSC::JSGlobalObject* globalObject, JSValue objValue)
{
    JSC::VM& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (!objValue || !objValue.isObject()) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs to be an object"_s);
        return JSValue::encode(throwScope.exception());
    }

    JSC::JSObject* obj = objValue.toObject(globalObject);

    JSC::JSValue setupFunctionValue = obj->getIfPropertyExists(globalObject, Identifier::fromString(vm, "setup"_s));
    if (!setupFunctionValue || setupFunctionValue.isUndefinedOrNull() || !setupFunctionValue.isCell() || !setupFunctionValue.isCallable()) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs a setup() function"_s);
        return JSValue::encode(throwScope.exception());
    }

    JSFunction* setupFunction = jsCast<JSFunction*>(setupFunctionValue);
    JSObject* builderObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 3);

    JSC::JSFunction* onLoadFunction = JSC::JSFunction::create(vm, globalObject, 1, "onLoad"_s, jsFunctionAppendOnLoadJSBundlerPlugin, ImplementationVisibility::Public);
    JSC::JSFunction* onResolveFunction = JSC::JSFunction::create(vm, globalObject, 1, "onResolve"_s, jsFunctionAppendOnResolveJSBundlerPlugin, ImplementationVisibility::Public);
    JSC::JSBoundFunction* boundOnLoadFunction = JSC::JSBoundFunction::create(
        vm,
        globalObject,
        onLoadFunction,
        WRAP_BUNDLER_PLUGIN(bundlerPlugin),
        JSC::ArgList(),
        1,
        jsString(vm, String("onLoad"_s)));

    JSC::JSBoundFunction* boundOnResolveFunction = JSC::JSBoundFunction::create(
        vm,
        globalObject,
        onResolveFunction,
        WRAP_BUNDLER_PLUGIN(bundlerPlugin),
        JSC::ArgList(),
        1,
        jsString(vm, String("onResolve"_s)));

    bundlerPlugin->ref();
    vm.heap.addFinalizer(boundOnLoadFunction, [bundlerPlugin](JSC::JSCell* cell) {
        bundlerPlugin->deref();
    });

    bundlerPlugin->ref();
    vm.heap.addFinalizer(boundOnResolveFunction, [bundlerPlugin](JSC::JSCell* cell) {
        bundlerPlugin->deref();
    });

    builderObject->putDirect(
        vm,
        JSC::Identifier::fromString(vm, "onLoad"_s),
        boundOnLoadFunction,
        JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
    builderObject->putDirect(
        vm,
        JSC::Identifier::fromString(vm, "onResolve"_s),
        boundOnResolveFunction,
        JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);

    JSC::MarkedArgumentBuffer args;
    args.append(builderObject);

    JSFunction* function = jsCast<JSFunction*>(setupFunctionValue);
    JSC::CallData callData = JSC::getCallData(function);
    JSValue result = call(globalObject, function, callData, JSC::jsUndefined(), args);

    RETURN_IF_EXCEPTION(throwScope, JSValue::encode(throwScope.exception()));

    if (auto* promise = JSC::jsDynamicCast<JSC::JSPromise*>(result)) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(promise));
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

void JSBundlerPlugin::Group::append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSFunction* func)
{
    Yarr::RegularExpression regex(
        StringView(filter->pattern()),
        filter->flags().contains(Yarr::Flags::IgnoreCase) ? Yarr::TextCaseSensitivity::TextCaseInsensitive : Yarr::TextCaseSensitivity::TextCaseInsensitive,
        filter->multiline() ? Yarr::MultilineMode::MultilineEnabled : Yarr::MultilineMode::MultilineDisabled,
        filter->eitherUnicode() ? Yarr::UnicodeMode::UnicodeAwareMode : Yarr::UnicodeMode::UnicodeUnawareMode);
    filters.append(WTFMove(regex));
    callbacks.append(JSC::Strong<JSC::JSFunction> { vm, func });
}

void JSBundlerPlugin::Base::append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSFunction* func, String& namespaceString)
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

JSFunction* JSBundlerPlugin::Group::find(String& path)
{
    size_t count = filters.size();
    for (size_t i = 0; i < count; i++) {
        int matchLength = 0;
        if (filters[i].match(path, 0, &matchLength)) {
            return callbacks[i].get();
        }
    }

    return nullptr;
}

EncodedJSValue JSBundlerPlugin::OnResolve::run(const ZigString* namespaceString, const ZigString* path, const ZigString* importer, void* context)
{
    Group* groupPtr = this->group(namespaceString ? Zig::toString(*namespaceString) : String());
    if (groupPtr == nullptr) {
        return JSValue::encode(jsUndefined());
    }
    Group& group = *groupPtr;

    auto pathString = Zig::toString(*path);

    JSC::JSFunction* function = group.find(pathString);
    if (!function) {
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::MarkedArgumentBuffer arguments;
    JSC::JSGlobalObject* globalObject = function->globalObject();
    auto& vm = globalObject->vm();

    JSC::JSObject* paramsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();
    paramsObject->putDirect(
        vm, clientData->builtinNames().pathPublicName(),
        Zig::toJSStringValue(*path, globalObject));
    paramsObject->putDirect(
        vm, clientData->builtinNames().importerPublicName(),
        Zig::toJSStringValue(*importer, globalObject));
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
        case JSPromise::Status::Pending: {
            return JSValue::encode(promise);
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
        JSC::throwTypeError(globalObject, throwScope, "onLoad() expects an object returned"_s);
        return JSValue::encode({});
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
}

EncodedJSValue JSBundlerPlugin::OnLoad::run(const ZigString* namespaceString, const ZigString* path, void* context)
{
    Group* groupPtr = this->group(namespaceString ? Zig::toString(*namespaceString) : String());
    if (groupPtr == nullptr) {
        return JSValue::encode(jsUndefined());
    }
    Group& group = *groupPtr;

    auto pathString = Zig::toString(*path);

    JSC::JSFunction* function = group.find(pathString);
    if (!function) {
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::MarkedArgumentBuffer arguments;
    JSC::JSGlobalObject* globalObject = function->globalObject();
    auto& vm = globalObject->vm();

    auto& callbacks = group.callbacks;

    auto& filters = group.filters;

    for (size_t i = 0; i < filters.size(); i++) {
        if (!filters[i].match(pathString)) {
            continue;
        }
        JSC::JSFunction* function = callbacks[i].get();
        if (UNLIKELY(!function)) {
            continue;
        }

        JSC::MarkedArgumentBuffer arguments;
        JSC::VM& vm = globalObject->vm();

        JSC::JSObject* paramsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
        auto clientData = WebCore::clientData(vm);
        auto& builtinNames = clientData->builtinNames();
        paramsObject->putDirect(
            vm, clientData->builtinNames().pathPublicName(),
            Zig::toJSStringValue(*path, globalObject));
        arguments.append(paramsObject);

        auto throwScope = DECLARE_THROW_SCOPE(vm);
        auto scope = DECLARE_CATCH_SCOPE(vm);
        scope.assertNoExceptionExceptTermination();

        JSC::CallData callData = JSC::getCallData(function);

        auto result = call(globalObject, function, callData, JSC::jsUndefined(), arguments);

        if (UNLIKELY(!scope.exception() && result && !result.isUndefinedOrNull() && !result.isCell())) {
            throwTypeError(globalObject, throwScope, "onLoad() expects an object returned"_s);
        }

        if (UNLIKELY(scope.exception())) {
            JSC::Exception* exception = scope.exception();
            scope.clearException();
            return JSValue::encode(exception);
        }

        result = Bun::handleVirtualModuleResultForJSBundlerPlugin(
            reinterpret_cast<Zig::GlobalObject*>(globalObject),
            result,
            path,
            nullptr,
            context);

        if (UNLIKELY(scope.exception())) {
            JSC::Exception* exception = scope.exception();
            scope.clearException();
            return JSValue::encode(exception);
        }

        if (!result || result.isUndefined()) {
            RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
        }

        if (auto* promise = JSC::jsDynamicCast<JSPromise*>(result)) {
            switch (promise->status(vm)) {
            case JSPromise::Status::Pending: {
                RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
            }
            case JSPromise::Status::Rejected: {
                promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Fulfilled)));
                result = promise->result(vm);
                RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
            }
            case JSPromise::Status::Fulfilled: {
                result = promise->result(vm);
                break;
            }
            }
        }

        if (!result.isObject()) {
            JSC::throwTypeError(globalObject, throwScope, "onResolve() expects an object returned"_s);
            JSC::Exception* exception = scope.exception();
            scope.clearException();
            return JSValue::encode(exception);
        }

        RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
    }

    return JSValue::encode(JSC::jsUndefined());
}

bool JSBundlerPlugin::anyMatchesCrossThread(const ZigString* namespaceStr, const ZigString* path, bool isOnLoad)
{
    auto namespaceString = namespaceStr ? Zig::toString(*namespaceStr) : String();
    auto pathString = Zig::toString(*path);

    if (isOnLoad) {
        auto* group = this->onLoad.group(namespaceString);
        if (group == nullptr) {
            return false;
        }

        auto& filters = group->filters;

        for (auto& filter : filters) {
            if (filter.match(pathString) > -1) {
                return true;
            }
        }

    } else {
        auto* group = this->onResolve.group(namespaceString);
        if (group == nullptr) {
            return false;
        }

        auto& filters = group->filters;

        for (auto& filter : filters) {
            if (filter.match(pathString) > -1) {
                return true;
            }
        }
    }

    return false;
}

} // namespace Bun

extern "C" bool JSBundlerPlugin__anyMatches(Bun::JSBundlerPlugin* plugin, const ZigString* namespaceString, const ZigString* path, bool isOnLoad)
{
    return plugin->anyMatchesCrossThread(namespaceString, path, isOnLoad);
}

extern "C" JSC::EncodedJSValue JSBundlerPlugin__matchOnLoad(JSC::JSGlobalObject* globalObject, Bun::JSBundlerPlugin* plugin, const ZigString* namespaceString, const ZigString* path, void* context)
{
    Ref protect(*plugin);
    return plugin->onLoad.run(
        namespaceString,
        path,
        context);
}

extern "C" JSC::EncodedJSValue JSBundlerPlugin__matchOnResolve(JSC::JSGlobalObject* globalObject, Bun::JSBundlerPlugin* plugin, const ZigString* namespaceString, const ZigString* path, const ZigString* importer, void* context)
{
    Ref protect(*plugin);
    return plugin->onResolve.run(
        namespaceString,
        path,
        importer,
        context);
}

extern "C" Bun::JSBundlerPlugin* JSBundlerPlugin__create(Zig::GlobalObject* globalObject, BunPluginTarget target)
{
    RefPtr<Bun::JSBundlerPlugin> plugin = adoptRef(*new Bun::JSBundlerPlugin(target, nullptr));
    plugin->ref();
    return plugin.leakRef();
}

extern "C" void JSBundlerPlugin__setConfig(Bun::JSBundlerPlugin* plugin, void* config)
{
    plugin->config = config;
}

extern "C" void JSBundlerPlugin__tombestone(Bun::JSBundlerPlugin* plugin)
{
    plugin->tombstone();
    plugin->deref();
}
