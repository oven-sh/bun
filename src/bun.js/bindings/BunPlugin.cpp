#include "BunPlugin.h"

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

#include "JavaScriptCore/RegularExpression.h"

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

static EncodedJSValue jsFunctionAppendOnLoadPluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin, void* ctx, OnAppendPluginCallback callback)
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

    plugin.append(vm, filter->regExp(), jsCast<JSFunction*>(func), namespaceString);
    callback(ctx, globalObject);

    return JSValue::encode(jsUndefined());
}

static EncodedJSValue jsFunctionAppendOnResolvePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin, void* ctx, OnAppendPluginCallback callback)
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

    plugin.append(vm, filter->regExp(), jsCast<JSFunction*>(func), namespaceString);
    callback(ctx, globalObject);

    return JSValue::encode(jsUndefined());
}

static EncodedJSValue jsFunctionAppendOnResolvePluginGlobal(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    Zig::GlobalObject* global = Zig::jsCast<Zig::GlobalObject*>(globalObject);

    auto& plugins = global->onResolvePlugins[target];
    auto callback = Bun__onDidAppendPlugin;
    return jsFunctionAppendOnResolvePluginBody(globalObject, callframe, target, plugins, global->bunVM(), callback);
}

static EncodedJSValue jsFunctionAppendOnLoadPluginGlobal(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    Zig::GlobalObject* global = Zig::jsCast<Zig::GlobalObject*>(globalObject);

    auto& plugins = global->onLoadPlugins[target];
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnResolvePluginBrowser, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnResolvePluginGlobal(globalObject, callframe, BunPluginTargetBrowser);
}

extern "C" EncodedJSValue jsFunctionBunPluginClear(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
{
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    for (uint8_t i = 0; i < BunPluginTargetMax + 1; i++) {
        global->onLoadPlugins[i].fileNamespace.clear();
        global->onResolvePlugins[i].fileNamespace.clear();
        global->onLoadPlugins[i].groups.clear();
        global->onResolvePlugins[i].namespaces.clear();
    }

    return JSValue::encode(jsUndefined());
}

extern "C" EncodedJSValue setupBunPlugin(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
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
    JSObject* builderObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 3);

    switch (target) {
    case BunPluginTargetNode: {
        builderObject->putDirect(vm, Identifier::fromString(vm, "target"_s), jsString(vm, String("node"_s)), 0);
        builderObject->putDirectNativeFunction(
            vm,
            globalObject,
            JSC::Identifier::fromString(vm, "onLoad"_s),
            1,
            jsFunctionAppendOnLoadPluginNode,
            ImplementationVisibility::Public,
            NoIntrinsic,
            JSC::PropertyAttribute::DontDelete | 0);
        builderObject->putDirectNativeFunction(
            vm,
            globalObject,
            JSC::Identifier::fromString(vm, "onResolve"_s),
            1,
            jsFunctionAppendOnResolvePluginNode,
            ImplementationVisibility::Public,
            NoIntrinsic,
            JSC::PropertyAttribute::DontDelete | 0);
        break;
    }
    case BunPluginTargetBun: {
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
        break;
    }
    case BunPluginTargetBrowser: {
        builderObject->putDirect(vm, Identifier::fromString(vm, "target"_s), jsString(vm, String("browser"_s)), 0);
        builderObject->putDirectNativeFunction(
            vm,
            globalObject,
            JSC::Identifier::fromString(vm, "onLoad"_s),
            1,
            jsFunctionAppendOnLoadPluginBrowser,
            ImplementationVisibility::Public,
            NoIntrinsic,
            JSC::PropertyAttribute::DontDelete | 0);
        builderObject->putDirectNativeFunction(
            vm,
            globalObject,
            JSC::Identifier::fromString(vm, "onResolve"_s),
            1,
            jsFunctionAppendOnResolvePluginBrowser,
            ImplementationVisibility::Public,
            NoIntrinsic,
            JSC::PropertyAttribute::DontDelete | 0);
        break;
    }
    }

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

extern "C" EncodedJSValue jsFunctionBunPlugin(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
{
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(globalObject);
    BunPluginTarget target = global->defaultBunPluginTarget;

    return setupBunPlugin(globalObject, callframe, target);
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
    return globalObject->onResolvePlugins[target].run(globalObject, namespaceString, path, from);
}

extern "C" JSC::EncodedJSValue Bun__runOnLoadPlugins(Zig::GlobalObject* globalObject, BunString* namespaceString, BunString* path, BunPluginTarget target)
{
    return globalObject->onLoadPlugins[target].run(globalObject, namespaceString, path);
}
