#include "ErrorCode.h"
#include "root.h"
#include "headers.h"

#include "ImportMetaObject.h"
#include "ZigGlobalObject.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "IDLTypes.h"
// #include "JSBlob.h"
#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperation.h"
#include "JSDOMWrapperCache.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/CallData.h>

#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>
#include <wtf/PointerPreparations.h>
#include <wtf/URL.h>
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>

#include "JSBufferEncodingType.h"
#include <JavaScriptCore/JSBase.h>

#include "JSDOMURL.h"
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "JSCommonJSModule.h"
#include <JavaScriptCore/JSPromise.h>
#include "PathInlines.h"
#include "wtf/text/StringView.h"

#include "isBuiltinModule.h"
#include "WebCoreJSBuiltins.h"

namespace Zig {
using namespace JSC;
using namespace WebCore;

ImportMetaObject* ImportMetaObject::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, const WTF::String& url)
{
    ImportMetaObject* ptr = new (NotNull, JSC::allocateCell<ImportMetaObject>(vm)) ImportMetaObject(vm, structure, url);
    ptr->finishCreation(vm);
    return ptr;
}

ImportMetaObject* ImportMetaObject::create(JSC::JSGlobalObject* globalObject, const WTF::String& url)
{
    VM& vm = globalObject->vm();
    Zig::GlobalObject* zigGlobalObject = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    bool isBake = url.startsWith("bake:"_s);

    // Get the appropriate structure
    Structure* structure = isBake
        ? zigGlobalObject->ImportMetaBakeObjectStructure()
        : zigGlobalObject->ImportMetaObjectStructure();

    return create(vm, globalObject, structure, url);
}

ImportMetaObject* ImportMetaObject::create(JSC::JSGlobalObject* globalObject, JSValue specifierOrURL)
{
    if (WebCore::DOMURL* url = WebCoreCast<WebCore::JSDOMURL, WebCore::DOMURL>(JSValue::encode(specifierOrURL))) {
        return create(globalObject, url->href().string());
    }

    WTF::String specifier = specifierOrURL.toWTFString(globalObject);
    ASSERT(specifier);
    return ImportMetaObject::createFromSpecifier(globalObject, specifier);
}

ImportMetaObject* ImportMetaObject::createFromSpecifier(JSC::JSGlobalObject* globalObject, const String& specifier)
{
    auto index = specifier.find('?');
    URL url;
    if (index != notFound) {
        StringView view = specifier;
        url = URL::fileURLWithFileSystemPath(view.substring(0, index));
        url.setQuery(view.substring(index + 1));
    } else {
        url = URL::fileURLWithFileSystemPath(specifier);
    }
    return create(globalObject, url.string());
}

extern "C" JSC::EncodedJSValue functionImportMeta__resolveSync(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    JSValue thisValue = callFrame->thisValue();
    JSC::JSValue moduleName = callFrame->argument(0);
    JSC::JSValue fromValue = callFrame->argument(1);

    if (moduleName.isUndefinedOrNull()) {
        JSC::throwTypeError(globalObject, scope, "expects a string"_s);
        scope.release();
        return {};
    }

    JSC::EncodedJSValue from = JSC::JSValue::encode(JSC::jsUndefined());
    bool isESM = true;

    if (callFrame->argumentCount() > 1) {

        if (callFrame->argumentCount() > 2) {
            JSC::JSValue isESMValue = callFrame->argument(2);
            if (isESMValue.isBoolean()) {
                isESM = isESMValue.toBoolean(globalObject);
            }
        }

        if (!fromValue.isUndefinedOrNull() && fromValue.isObject()) {

            auto pathsObject = fromValue.getObject()->getIfPropertyExists(globalObject, builtinNames(vm).pathsPublicName());
            RETURN_IF_EXCEPTION(scope, {});
            if (pathsObject) {
                if (pathsObject.isCell() && pathsObject.asCell()->type() == JSC::JSType::ArrayType) {
                    auto pathsArray = uncheckedDowncast<JSC::JSArray>(pathsObject);
                    if (pathsArray->length() > 0) {
                        fromValue = pathsArray->getIndex(globalObject, 0);
                        RETURN_IF_EXCEPTION(scope, {});
                    }
                }
            }

        } else if (fromValue.isBoolean()) {
            isESM = fromValue.toBoolean(globalObject);
            fromValue = JSC::jsUndefined();
        }

        if (fromValue.isString()) {
            from = JSC::JSValue::encode(fromValue);
        } else if (thisValue.isString()) {
            from = JSC::JSValue::encode(thisValue);
        }

    } else if (thisValue.isString()) {
        from = JSC::JSValue::encode(thisValue);
    } else {
        JSC::JSObject* thisObject = dynamicDowncast<JSC::JSObject>(thisValue);
        if (!thisObject) [[unlikely]] {
            JSC::throwTypeError(globalObject, scope, "import.meta.resolveSync must be bound to an import.meta object"_s);
            return {};
        }

        auto clientData = WebCore::clientData(vm);
        JSValue pathProperty = thisObject->getIfPropertyExists(globalObject, clientData->builtinNames().pathPublicName());
        RETURN_IF_EXCEPTION(scope, {});

        if (pathProperty && pathProperty.isString())
            from = JSC::JSValue::encode(pathProperty);
    }

    if (globalObject->onLoadPlugins.hasVirtualModules()) {
        if (moduleName.isString()) {
            auto moduleString = moduleName.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto fromString = JSValue::decode(from).toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (auto resolvedString = globalObject->onLoadPlugins.resolveVirtualModule(moduleString, fromString)) {
                if (moduleString == resolvedString.value())
                    return JSC::JSValue::encode(moduleName);
                return JSC::JSValue::encode(jsString(vm, resolvedString.value()));
            }
        }
    }

    auto result = Bun__resolveSync(globalObject, JSC::JSValue::encode(moduleName), from, isESM, false);
    RETURN_IF_EXCEPTION(scope, {});

    if (!JSC::JSValue::decode(result).isString()) {
        JSC::throwException(globalObject, scope, JSC::JSValue::decode(result));
        return {};
    }

    scope.release();
    return result;
}

extern "C" JSC::EncodedJSValue functionImportMeta__resolveSyncPrivate(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject);

    JSC::JSValue moduleName = callFrame->argument(0);
    JSValue from = callFrame->argument(1);
    bool isESM = callFrame->argument(2).asBoolean();
    bool isRequireDotResolve = callFrame->argument(3).isTrue();
    JSValue userPathList = callFrame->argument(4);
    JSValue parentModule = callFrame->argument(5);
    JSValue resolveFilenameOptions = callFrame->argument(6);

    if (globalObject->onLoadPlugins.hasVirtualModules()) {
        if (moduleName.isString()) {
            auto moduleString = moduleName.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto fromString = from.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (auto resolvedString = globalObject->onLoadPlugins.resolveVirtualModule(moduleString, fromString)) {
                if (moduleString == resolvedString.value())
                    return JSC::JSValue::encode(moduleName);
                return JSC::JSValue::encode(jsString(vm, resolvedString.value()));
            }
        }
    }

    if (!isESM) {
        if (globalObject) [[likely]] {
            if (globalObject->hasOverriddenModuleResolveFilenameFunction) [[unlikely]] {
                auto overrideHandler = uncheckedDowncast<JSObject>(globalObject->m_moduleResolveFilenameFunction.getInitializedOnMainThread(globalObject));
                if (overrideHandler) [[likely]] {
                    ASSERT(overrideHandler->isCallable());

                    MarkedArgumentBuffer args;
                    args.append(moduleName);
                    args.append(parentModule);
                    args.append(jsBoolean(false));
                    args.append(resolveFilenameOptions);

                    JSValue thisValue = globalObject->m_nodeModuleConstructor.getInitializedOnMainThread(globalObject);
                    JSValue result = JSC::profiledCall(lexicalGlobalObject, ProfilingReason::API, overrideHandler, JSC::getCallData(overrideHandler), thisValue, args);
                    RETURN_IF_EXCEPTION(scope, {});
                    if (!isRequireDotResolve) {
                        JSString* string = result.toString(globalObject);
                        RETURN_IF_EXCEPTION(scope, {});
                        auto str = string->value(globalObject);
                        RETURN_IF_EXCEPTION(scope, {});
                        WTF::String prefixed = Bun::isUnprefixedNodeBuiltin(str);
                        if (!prefixed.isNull()) {
                            return JSValue::encode(jsString(vm, prefixed));
                        }
                        return JSC::JSValue::encode(string);
                    }
                    return JSC::JSValue::encode(result);
                }
            }
        }

        // node resolves builtin ids before validating `paths`, so `require.resolve("node:fs",
        // { paths: [0] })` must not throw. Only real builtins bypass; "node:nope" still validates.
        // https://github.com/nodejs/node/blob/main/lib/internal/modules/cjs/loader.js
        if (!userPathList.isUndefinedOrNull() && moduleName.isString()) {
            auto builtinCheckStr = moduleName.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (Bun::isBuiltinModule(builtinCheckStr))
                userPathList = jsUndefined();
        }

        if (!userPathList.isUndefinedOrNull()) {
            if (JSArray* userPathListArray = dynamicDowncast<JSArray>(userPathList)) {
                if (!moduleName.isString()) {
                    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "request"_s, "string"_s, moduleName);
                    scope.release();
                    return {};
                }

                JSC::EncodedJSValue result = {};
                WTF::Vector<BunString> paths;
                for (size_t i = 0; i < userPathListArray->length(); ++i) {
                    JSValue path = userPathListArray->getIndex(globalObject, i);
                    if (scope.exception()) [[unlikely]]
                        goto cleanup;
                    if (!path.isString()) {
                        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, makeString("paths["_s, i, "]"_s), "string"_s, path);
                        goto cleanup;
                    }
                    WTF::String pathStr = path.toWTFString(globalObject);
                    if (scope.exception()) [[unlikely]]
                        goto cleanup;
                    paths.append(Bun::toStringRef(pathStr));
                }

                result = Bun__resolveSyncWithPaths(lexicalGlobalObject, JSC::JSValue::encode(moduleName), JSValue::encode(from), isESM, isRequireDotResolve, paths.begin(), paths.size());
                if (scope.exception()) [[unlikely]]
                    goto cleanup;

                if (!JSC::JSValue::decode(result).isString()) {
                    JSC::throwException(lexicalGlobalObject, scope, JSC::JSValue::decode(result));
                    result = {};
                    goto cleanup;
                }

            cleanup:
                for (auto& path : paths) {
                    path.deref();
                }
                RELEASE_AND_RETURN(scope, result);
            } else {
                Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.paths"_s, userPathList);
                scope.release();
                return {};
            }
        }
    }

    if (!moduleName.isString()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, isRequireDotResolve ? "request"_s : "id"_s, "string"_s, moduleName);
        scope.release();
        return {};
    }

    auto result = Bun__resolveSync(lexicalGlobalObject, JSC::JSValue::encode(moduleName), JSValue::encode(from), isESM, isRequireDotResolve);
    RETURN_IF_EXCEPTION(scope, {});

    if (!JSC::JSValue::decode(result).isString()) {
        JSC::throwException(lexicalGlobalObject, scope, JSC::JSValue::decode(result));
        return {};
    }

    scope.release();
    return result;
}

JSC_DEFINE_HOST_FUNCTION(functionImportMeta__resolve,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    auto thisValue = callFrame->thisValue();
    auto specifierValue = callFrame->argument(0);
    // 1. Set specifier to ? ToString(specifier).
    auto specifier = specifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Node.js allows a second argument for parent
    JSValue from = {};

    if (callFrame->argumentCount() >= 2) {
        JSValue fromValue = callFrame->uncheckedArgument(1);

        if (!fromValue.isUndefinedOrNull() && fromValue.isObject()) {
            auto pathsObject = fromValue.getObject()->getIfPropertyExists(globalObject, builtinNames(vm).pathsPublicName());
            RETURN_IF_EXCEPTION(scope, {});
            if (pathsObject) {
                if (pathsObject.isCell() && pathsObject.asCell()->type() == JSC::JSType::ArrayType) {
                    auto* pathsArray = uncheckedDowncast<JSC::JSArray>(pathsObject);
                    if (pathsArray->length() > 0) {
                        fromValue = pathsArray->getIndex(globalObject, 0);
                        RETURN_IF_EXCEPTION(scope, {});
                    }
                }
            }
        }

        if (fromValue.isString()) {
            from = fromValue;
        }
    }

    if (!from) {
        auto* thisObject = dynamicDowncast<JSC::JSObject>(thisValue);
        if (!thisObject) [[unlikely]] {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope, "import.meta.resolve must be bound to an import.meta object"_s);
            RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::JSValue {}));
        }

        auto clientData = WebCore::clientData(vm);
        JSValue pathProperty = thisObject->getIfPropertyExists(globalObject, clientData->builtinNames().pathPublicName());
        RETURN_IF_EXCEPTION(scope, {});

        if (pathProperty && pathProperty.isString()) [[likely]] {
            from = pathProperty;
        } else {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope, "import.meta.resolve must be bound to an import.meta object"_s);
            RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::JSValue {}));
        }
    }
    ASSERT(from);

    // from.toWTFString() *should* always be the fast case, since above we check that it's a string.
    auto fromWTFString = from.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Try to resolve it to a relative file path. This path is not meant to throw module resolution errors.
    if (specifier.startsWith("./"_s) || specifier.startsWith("../"_s) || specifier.startsWith("/"_s) || specifier.startsWith("file://"_s)
#if OS(WINDOWS)
        || specifier.startsWith(".\\"_s) || specifier.startsWith("..\\"_s) || specifier.startsWith("\\"_s)
#endif
    ) {
        auto fromURL = fromWTFString.startsWith("file://"_s) ? WTF::URL(fromWTFString) : WTF::URL::fileURLWithFileSystemPath(fromWTFString);
        if (!fromURL.isValid()) {
            JSC::throwTypeError(globalObject, scope, "`parent` is not a valid Filepath / URL"_s);
            RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::JSValue {}));
        }

        WTF::URL url(fromURL, specifier);
        RELEASE_AND_RETURN(scope, JSValue::encode(jsString(vm, url.string())));
    }

    // In Node.js, `node:doesnotexist` resolves to `node:doesnotexist`
    if (specifier.startsWith("node:"_s) || specifier.startsWith("bun:"_s)) [[unlikely]] {
        return JSValue::encode(jsString(vm, specifier));
    }

    // Run it through the module resolver, errors at this point are actual errors.
    auto a = Bun::toString(specifier);
    auto b = Bun::toString(fromWTFString);
    auto result = JSValue::decode(Bun__resolveSyncWithStrings(globalObject, &a, &b, true));
    RETURN_IF_EXCEPTION(scope, {});

    if (!result.isString()) {
        JSC::throwException(globalObject, scope, result);
        return {};
    }

    auto resultString = result.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (isAbsolutePath(resultString)) {
        // file path -> url
        RELEASE_AND_RETURN(scope, JSValue::encode(jsString(vm, WTF::URL::fileURLWithFileSystemPath(resultString).string())));
    }
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_url, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = dynamicDowncast<ImportMetaObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->urlProperty.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_dir, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = dynamicDowncast<ImportMetaObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->dirProperty.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_file, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = dynamicDowncast<ImportMetaObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->fileProperty.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_path, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = dynamicDowncast<ImportMetaObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->pathProperty.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_require, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = dynamicDowncast<ImportMetaObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    auto* nullable = thisObject->requireProperty.getInitializedOnMainThread(thisObject);
    return JSValue::encode(nullable ? nullable : jsUndefined());
}

// https://github.com/oven-sh/bun/issues/11754#issuecomment-2452626172
// This setter exists mainly to support various libraries doing weird things wrapping the require function.
JSC_DEFINE_CUSTOM_SETTER(jsImportMetaObjectSetter_require, (JSGlobalObject * jsGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = dynamicDowncast<ImportMetaObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return false;

    JSValue value = JSValue::decode(encodedValue);
    if (!value.isCell()) {
        // TODO:
        return true;
    }

    thisObject->requireProperty.set(thisObject->vm(), thisObject, value.asCell());
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_env, (JSGlobalObject * jsGlobalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(jsGlobalObject);
    return JSValue::encode(globalObject->m_processEnvObject.getInitializedOnMainThread(globalObject));
}

extern "C" JSC::EncodedJSValue SYSV_ABI BunObject_getter_main(JSC::JSGlobalObject*);

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_main, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = dynamicDowncast<ImportMetaObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    // Only Zig::GlobalObject creates ImportMetaObject structures (see createStructure). Its Bun.main and thread
    // are the ones that matter, no matter which realm reads the property.
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(thisObject->globalObject());
    if (!globalObject->scriptExecutionContext()->isMainThread())
        return JSValue::encode(jsBoolean(false));

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue path = thisObject->pathProperty.getInitializedOnMainThread(thisObject);
    JSValue bunMain = JSValue::decode(BunObject_getter_main(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    bool isMain = JSValue::strictEqual(globalObject, path, bunMain);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(isMain));
}

// import.meta.hot (bun --hot): a per-module object holding only its URL under a
// private name. `data` lives in GlobalObject::importMetaHotDataMap() keyed by URL;
// dispose() queues (callback, URL) tuples on the global, drained on reload.

extern "C" void Bun__logUnhandledException(JSC::EncodedJSValue exception);

static JSString* importMetaHotThisURL(JSC::VM& vm, JSValue thisValue)
{
    auto* object = thisValue.getObject();
    if (!object)
        return nullptr;
    JSValue url = object->getDirect(vm, WebCore::builtinNames(vm).urlPrivateName());
    return url ? dynamicDowncast<JSString>(url) : nullptr;
}

// Creates the module's `data` object on first use.
static JSValue importMetaHotDataForURL(Zig::GlobalObject* globalObject, JSString* url)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* map = globalObject->importMetaHotDataMap();
    JSValue data = map->get(globalObject, url);
    RETURN_IF_EXCEPTION(scope, {});
    if (data.isUndefined()) {
        data = JSC::constructEmptyObject(globalObject);
        map->set(globalObject, url, data);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return data;
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaHotGetter_data, (JSGlobalObject * jsGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = jsGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* url = importMetaHotThisURL(vm, JSValue::decode(thisValue));
    if (!url) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, jsGlobalObject, "ImportMetaHot"_s);
    RELEASE_AND_RETURN(scope, JSValue::encode(importMetaHotDataForURL(defaultGlobalObject(jsGlobalObject), url)));
}

JSC_DEFINE_CUSTOM_SETTER(jsImportMetaHotSetter_data, (JSGlobalObject * jsGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = jsGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* url = importMetaHotThisURL(vm, JSValue::decode(thisValue));
    if (!url) [[unlikely]] {
        Bun::ERR::INVALID_THIS(scope, jsGlobalObject, "ImportMetaHot"_s);
        return false;
    }
    auto* globalObject = defaultGlobalObject(jsGlobalObject);
    globalObject->importMetaHotDataMap()->set(globalObject, url, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(scope, false);
    return true;
}

JSC_DEFINE_HOST_FUNCTION(functionImportMetaHotDispose, (JSC::JSGlobalObject * jsGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = jsGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* url = importMetaHotThisURL(vm, callFrame->thisValue());
    if (!url) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, jsGlobalObject, "ImportMetaHot"_s);
    JSValue callback = callFrame->argument(0);
    if (!callback.isCallable()) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, jsGlobalObject, "callback"_s, "function"_s, callback);

    auto* globalObject = defaultGlobalObject(jsGlobalObject);
    auto* entry = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), callback, url);
    globalObject->addImportMetaHotDisposeCallback(entry);
    return JSValue::encode(jsUndefined());
}

// --hot re-evaluates every module, so the Vite accept/event API has nothing to
// do; the methods exist so code written against it does not throw.
JSC_DEFINE_HOST_FUNCTION(functionImportMetaHotNoop, (JSC::JSGlobalObject * jsGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = jsGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!importMetaHotThisURL(vm, callFrame->thisValue())) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, jsGlobalObject, "ImportMetaHot"_s);
    return JSValue::encode(jsUndefined());
}

static const HashTableValue ImportMetaHotPrototypeValues[] = {
    { "accept"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMetaHotNoop, 1 } },
    { "data"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaHotGetter_data, jsImportMetaHotSetter_data } },
    { "decline"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMetaHotNoop, 0 } },
    { "dispose"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMetaHotDispose, 1 } },
    { "invalidate"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMetaHotNoop, 0 } },
    { "off"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMetaHotNoop, 2 } },
    { "on"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMetaHotNoop, 2 } },
    { "prune"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMetaHotNoop, 1 } },
    { "send"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMetaHotNoop, 2 } },
};

class ImportMetaHotPrototype final : public JSC::JSNonFinalObject {
public:
    DECLARE_INFO;
    using Base = JSC::JSNonFinalObject;

    static ImportMetaHotPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        auto* structure = Bun::createClassStructure(vm, globalObject, globalObject->objectPrototype(), JSC::TypeInfo(ObjectType, StructureFlags), info());
        auto* prototype = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(ImportMetaHotPrototype))) ImportMetaHotPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(ImportMetaHotPrototype, Base);
        return &vm.plainObjectSpace();
    }

private:
    ImportMetaHotPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        Bun::reifyStaticPropertyTable(vm, info(), ImportMetaHotPrototypeValues, *this);
        Bun::putToStringTagWithoutTransition(vm, this, info());
    }
};

const ClassInfo ImportMetaHotPrototype::s_info = { "ImportMetaHot"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ImportMetaHotPrototype) };

JSC::Structure* ImportMetaObject::createHotStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto* prototype = ImportMetaHotPrototype::create(vm, globalObject);
    // One inline slot: the private URL property put by hotProperty's initializer.
    return JSC::JSFinalObject::createStructure(vm, globalObject, prototype, 1);
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_hot, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    ImportMetaObject* thisObject = dynamicDowncast<ImportMetaObject>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());
    auto* nullable = thisObject->hotProperty.getInitializedOnMainThread(thisObject);
    return JSValue::encode(nullable ? nullable : jsUndefined());
}

static const HashTableValue ImportMetaObjectPrototypeValues[] = {
    { "dir"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_dir, 0 } },
    { "dirname"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_dir, 0 } },
    { "env"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_env, 0 } },
    { "file"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_file, 0 } },
    { "filename"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_path, 0 } },
    { "main"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_main, 0 } },
    { "path"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_path, 0 } },
    { "require"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_require, jsImportMetaObjectSetter_require } },
    { "resolve"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMeta__resolve, 0 } },
    { "resolveSync"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMeta__resolveSync, 0 } },
    { "url"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_url, 0 } },
};

static const HashTableValue ImportMetaObjectBakePrototypeValues[] = {
    { "bakeBuiltin"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, commonJSRequireESMCodeGenerator, 0 } },
    { "dir"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_dir, 0 } },
    { "dirname"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_dir, 0 } },
    { "env"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_env, 0 } },
    { "file"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_file, 0 } },
    { "filename"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_path, 0 } },
    { "main"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_main, 0 } },
    { "path"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_path, 0 } },
    { "require"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_require, jsImportMetaObjectSetter_require } },
    { "resolve"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMeta__resolve, 0 } },
    { "resolveSync"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMeta__resolveSync, 0 } },
    { "url"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_url, 0 } },
};

class ImportMetaObjectPrototype : public JSC::JSNonFinalObject {
public:
    DECLARE_INFO;
    using Base = JSC::JSNonFinalObject;

    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return Structure::create(vm, globalObject, globalObject->objectPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    }

    static ImportMetaObjectPrototype* create(JSC::VM& vm, JSC::Structure* structure, bool isBake = false)
    {
        ImportMetaObjectPrototype* prototype = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(ImportMetaObjectPrototype))) ImportMetaObjectPrototype(vm, structure);
        prototype->finishCreation(vm, isBake);
        return prototype;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(ImportMetaObjectPrototype, Base);
        return &vm.plainObjectSpace();
    }

    void finishCreation(JSC::VM& vm, bool isBake)
    {
        Base::finishCreation(vm);

        // Use the appropriate prototype values based on whether this is a bake import meta object
        if (isBake) {
            Bun::reifyStaticPropertyTable(vm, ImportMetaObject::info(), ImportMetaObjectBakePrototypeValues, *this);
        } else {
            Bun::reifyStaticPropertyTable(vm, ImportMetaObject::info(), ImportMetaObjectPrototypeValues, *this);
            // Outside --hot the property does not exist at all, matching what the
            // transpiler folds `import.meta.hot` to.
            if (Bun__VirtualMachine__isHotReloadEnabled(defaultGlobalObject(this->globalObject())->bunVM())) {
                this->putDirectCustomAccessor(vm, Identifier::fromString(vm, "hot"_s),
                    JSC::CustomGetterSetter::create(vm, jsImportMetaObjectGetter_hot, nullptr),
                    JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);
            }
        }
        Bun::putToStringTagWithoutTransition(vm, this, info());
    }

    ImportMetaObjectPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

const ClassInfo ImportMetaObjectPrototype::s_info = {
    "ImportMeta"_s,

    &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ImportMetaObjectPrototype)
};

JSC::Structure* ImportMetaObject::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, bool isBake)
{
    ImportMetaObjectPrototype* prototype = ImportMetaObjectPrototype::create(vm,
        ImportMetaObjectPrototype::createStructure(vm, globalObject),
        isBake);

    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), ImportMetaObject::info());
}

void ImportMetaObject::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    this->requireProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSCell>::Initializer& init) {
        auto scope = DECLARE_THROW_SCOPE(init.vm);
        ImportMetaObject* meta = uncheckedDowncast<ImportMetaObject>(init.owner);

        WTF::URL url = isAbsolutePath(meta->url) ? WTF::URL::fileURLWithFileSystemPath(meta->url) : WTF::URL(meta->url);
        WTF::String path;

        if (url.isValid()) {
            if (url.protocolIsFile()) {
                path = url.fileSystemPath();
            } else {
                path = url.path().toString();
            }
        } else {
            path = meta->url;
        }

        auto* object = Bun::JSCommonJSModule::createBoundRequireFunction(init.vm, meta->globalObject(), path);
        RETURN_IF_EXCEPTION(scope, );
        ASSERT(object);
        init.set(uncheckedDowncast<JSFunction>(object));
    });
    this->urlProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSString>::Initializer& init) {
        ImportMetaObject* meta = uncheckedDowncast<ImportMetaObject>(init.owner);
        init.set(jsString(init.vm, meta->url));
    });
    this->dirProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSString>::Initializer& init) {
        ImportMetaObject* meta = uncheckedDowncast<ImportMetaObject>(init.owner);

        WTF::URL url(meta->url);
        WTF::String dirname;

        if (url.protocolIsFile()) {
            dirname = url.fileSystemPath();
        } else {
            dirname = url.path().toString();
        }

        if (dirname.endsWith(PLATFORM_SEP_s)) {
            dirname = dirname.substring(0, dirname.length() - 1);
        } else if (dirname.contains(PLATFORM_SEP)) {
            dirname = dirname.substring(0, dirname.reverseFind(PLATFORM_SEP));
        }

        init.set(jsString(init.vm, dirname));
    });
    this->fileProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSString>::Initializer& init) {
        ImportMetaObject* meta = uncheckedDowncast<ImportMetaObject>(init.owner);

        WTF::URL url(meta->url);
        WTF::String path;

        if (url.protocolIsFile()) {
            path = url.fileSystemPath();
        } else {
            path = url.path().toString();
        }

        WTF::String filename;
        if (path.endsWith(PLATFORM_SEP_s)) {
            filename = path.substring(path.reverseFind(PLATFORM_SEP, path.length() - 2) + 1);
        } else {
            filename = path.substring(path.reverseFind(PLATFORM_SEP) + 1);
        }

        init.set(jsString(init.vm, filename));
    });
    this->pathProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSString>::Initializer& init) {
        ImportMetaObject* meta = uncheckedDowncast<ImportMetaObject>(init.owner);

        WTF::URL url(meta->url);
        if (url.protocolIsFile()) {
            init.set(jsString(init.vm, url.fileSystemPath()));
        } else {
            init.set(jsString(init.vm, url.path()));
        }
    });
    this->hotProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSObject>::Initializer& init) {
        auto& vm = init.vm;
        ImportMetaObject* meta = uncheckedDowncast<ImportMetaObject>(init.owner);
        auto* globalObject = defaultGlobalObject(meta->globalObject());
        auto* hot = JSC::constructEmptyObject(vm, globalObject->importMetaHotStructure());
        hot->putDirect(vm, WebCore::builtinNames(vm).urlPrivateName(), meta->urlProperty.getInitializedOnMainThread(meta),
            JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
        init.set(hot);
    });
}

template<typename Visitor>
void ImportMetaObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ImportMetaObject* fn = uncheckedDowncast<ImportMetaObject>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    fn->requireProperty.visit(visitor);
    fn->urlProperty.visit(visitor);
    fn->dirProperty.visit(visitor);
    fn->fileProperty.visit(visitor);
    fn->pathProperty.visit(visitor);
    fn->hotProperty.visit(visitor);
}

DEFINE_VISIT_CHILDREN(ImportMetaObject);

void ImportMetaObject::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    Base::analyzeHeap(cell, analyzer);
}

JSValue ImportMetaObject::getPrototype(JSObject* object, JSC::JSGlobalObject* globalObject)
{
    ASSERT(object->inherits(info()));
    return jsNull();
}

const JSC::ClassInfo ImportMetaObject::s_info = { "ImportMeta"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(ImportMetaObject) };

void Zig::GlobalObject::addImportMetaHotDisposeCallback(JSC::InternalFieldTuple* callbackAndURL)
{
    m_importMetaHotDisposeCallbacks.append(vm(), this, callbackAndURL);
}

JSC::JSMap* Zig::GlobalObject::importMetaHotDataMap()
{
    auto* map = m_importMetaHotDataMap.get();
    if (!map) [[unlikely]] {
        map = JSC::JSMap::create(vm(), mapStructure());
        m_importMetaHotDataMap.set(vm(), this, map);
    }
    return map;
}

// Shared reaction context: slot 0 = promise returned to VirtualMachine::reload(),
// slot 1 = number of dispose promises still pending.
static void importMetaHotDisposePromiseSettled(JSC::VM& vm, JSValue contextValue)
{
    auto* context = dynamicDowncast<JSC::InternalFieldTuple>(contextValue);
    if (!context) [[unlikely]]
        return;
    int32_t remaining = context->getInternalField(1).asInt32() - 1;
    context->putInternalField(vm, 1, jsNumber(remaining));
    if (remaining == 0)
        uncheckedDowncast<JSC::JSPromise>(context->getInternalField(0).asCell())->fulfill(vm, jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(functionImportMetaHotDisposeFulfilled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    importMetaHotDisposePromiseSettled(globalObject->vm(), callFrame->argument(1));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(functionImportMetaHotDisposeRejected, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    Bun__logUnhandledException(JSValue::encode(callFrame->argument(0)));
    importMetaHotDisposePromiseSettled(globalObject->vm(), callFrame->argument(1));
    return JSValue::encode(jsUndefined());
}

// Runs the queued dispose callbacks. Returns undefined, or a promise that
// fulfills once every promise they returned has settled. Callback errors are
// printed (never fatal) and never block the reload.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSC__JSGlobalObject__runImportMetaHotDispose(JSC::JSGlobalObject* jsGlobalObject)
{
    auto* globalObject = static_cast<Zig::GlobalObject*>(jsGlobalObject);
    if (globalObject->m_importMetaHotDisposeCallbacks.isEmpty())
        return JSValue::encode(jsUndefined());

    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // Drain first: dispose() calls made while running belong to the next generation.
    JSC::MarkedArgumentBuffer entries;
    globalObject->m_importMetaHotDisposeCallbacks.drainTo(globalObject, entries);
    RELEASE_ASSERT(!entries.hasOverflowed());

    JSC::MarkedArgumentBuffer pending;
    for (size_t i = 0, size = entries.size(); i < size; i++) {
        auto* entry = uncheckedDowncast<JSC::InternalFieldTuple>(entries.at(i).asCell());
        JSValue callback = entry->getInternalField(0);
        auto* url = uncheckedDowncast<JSString>(entry->getInternalField(1).asCell());

        JSValue data = importMetaHotDataForURL(globalObject, url);
        if (auto* exception = scope.exception()) [[unlikely]] {
            if (vm.isTerminationException(exception))
                return JSValue::encode(jsUndefined());
            scope.clearException();
            Bun__logUnhandledException(JSValue::encode(JSValue(exception)));
            continue;
        }

        JSC::MarkedArgumentBuffer args;
        args.append(data);
        NakedPtr<JSC::Exception> returnedException;
        JSValue result = JSC::profiledCall(globalObject, ProfilingReason::API, callback, JSC::getCallData(callback), jsUndefined(), args, returnedException);
        if (auto* exception = returnedException.get()) {
            if (vm.isTerminationException(exception))
                return JSValue::encode(jsUndefined());
            Bun__logUnhandledException(JSValue::encode(JSValue(exception)));
            continue;
        }

        // Like the bundler's HMR runtime, only a real Promise delays the reload.
        auto* promise = dynamicDowncast<JSC::JSPromise>(result);
        if (!promise)
            continue;
        switch (promise->status()) {
        case JSC::JSPromise::Status::Pending:
            pending.append(promise);
            break;
        case JSC::JSPromise::Status::Rejected:
            promise->markAsHandled();
            Bun__logUnhandledException(JSValue::encode(promise->result()));
            break;
        case JSC::JSPromise::Status::Fulfilled:
            break;
        }
    }
    RELEASE_ASSERT(!pending.hasOverflowed());
    if (pending.isEmpty())
        return JSValue::encode(jsUndefined());

    auto* aggregate = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    auto* context = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), aggregate, jsNumber(static_cast<int32_t>(pending.size())));
    auto* onFulfilled = JSC::JSFunction::create(vm, globalObject, 2, String(), functionImportMetaHotDisposeFulfilled, ImplementationVisibility::Private);
    auto* onRejected = JSC::JSFunction::create(vm, globalObject, 2, String(), functionImportMetaHotDisposeRejected, ImplementationVisibility::Private);
    for (size_t i = 0, size = pending.size(); i < size; i++) {
        uncheckedDowncast<JSC::JSPromise>(pending.at(i).asCell())->performPromiseThenWithContext(vm, globalObject, onFulfilled, onRejected, jsUndefined(), context);
        if (auto* exception = scope.exception()) [[unlikely]] {
            if (vm.isTerminationException(exception))
                return JSValue::encode(jsUndefined());
            scope.clearException();
            Bun__logUnhandledException(JSValue::encode(JSValue(exception)));
            // Count it as settled so the reload is not blocked on it.
            importMetaHotDisposePromiseSettled(vm, context);
        }
    }
    return JSValue::encode(aggregate);
}

}
