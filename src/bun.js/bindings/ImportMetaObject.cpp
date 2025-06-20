#include "ErrorCode.h"
#include "root.h"
#include "headers.h"

#include "ImportMetaObject.h"
#include "ZigGlobalObject.h"
#include "ActiveDOMObject.h"
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
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "JSCommonJSModule.h"
#include <JavaScriptCore/JSPromise.h>
#include "PathInlines.h"
#include "wtf/text/StringView.h"

#include "isBuiltinModule.h"

namespace Zig {
using namespace JSC;
using namespace WebCore;

static JSC::EncodedJSValue functionRequireResolve(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, const WTF::String& fromStr)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    switch (callFrame->argumentCount()) {
    case 0: {
        // not "requires" because "require" could be confusing
        JSC::throwTypeError(globalObject, scope, "require.resolve needs 1 argument (a string)"_s);
        scope.release();
        return {};
    }
    default: {
        JSC::JSValue moduleName = callFrame->argument(0);

        auto doIt = [&](const WTF::String& fromStr) -> JSC::EncodedJSValue {
            Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
            if (zigGlobalObject->onLoadPlugins.hasVirtualModules()) {
                if (auto result = zigGlobalObject->onLoadPlugins.resolveVirtualModule(fromStr, String())) {
                    if (fromStr == result.value())
                        return JSC::JSValue::encode(moduleName);

                    return JSC::JSValue::encode(jsString(vm, result.value()));
                }
            }

            BunString from = Bun::toString(fromStr);
            auto result = Bun__resolveSyncWithSource(globalObject, JSC::JSValue::encode(moduleName), &from, false, true);
            RETURN_IF_EXCEPTION(scope, {});

            if (!JSC::JSValue::decode(result).isString()) {
                JSC::throwException(globalObject, scope, JSC::JSValue::decode(result));
                return JSC::JSValue::encode(JSValue {});
            }

            scope.release();
            return result;
        };

        if (moduleName.isUndefinedOrNull()) {
            JSC::throwTypeError(globalObject, scope, "require.resolve expects a string"_s);
            scope.release();
            return {};
        }

        if (callFrame->argumentCount() > 1) {
            JSC::JSValue fromValue = callFrame->argument(1);

            // require.resolve also supports a paths array
            // we only support a single path
            if (!fromValue.isUndefinedOrNull() && fromValue.isObject()) {
                if (auto pathsObject = fromValue.getObject()->getIfPropertyExists(globalObject, builtinNames(vm).pathsPublicName())) {
                    if (pathsObject.isCell() && pathsObject.asCell()->type() == JSC::JSType::ArrayType) {
                        auto pathsArray = JSC::jsCast<JSC::JSArray*>(pathsObject);
                        if (pathsArray->length() > 0) {
                            fromValue = pathsArray->getIndex(globalObject, 0);
                            RETURN_IF_EXCEPTION(scope, {});
                        }
                    }
                }
            }

            if (fromValue.isString()) {
                WTF::String str = fromValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                return doIt(str);
            }
        }

        return doIt(fromStr);
    }
    }
}

ImportMetaObject* ImportMetaObject::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, const WTF::String& url)
{
    ImportMetaObject* ptr = new (NotNull, JSC::allocateCell<ImportMetaObject>(vm)) ImportMetaObject(vm, structure, url);
    ptr->finishCreation(vm);
    return ptr;
}

ImportMetaObject* ImportMetaObject::create(JSC::JSGlobalObject* globalObject, const WTF::String& url)
{
    VM& vm = globalObject->vm();
    Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    auto structure = zigGlobalObject->ImportMetaObjectStructure();
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

JSC_DECLARE_HOST_FUNCTION(jsFunctionRequireResolve);
JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireResolve, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSValue thisValue = callFrame->thisValue();
    WTF::String fromStr;

    if (thisValue.isString()) {
        fromStr = thisValue.toWTFString(globalObject);
    }

    return functionRequireResolve(globalObject, callFrame, fromStr);
}

extern "C" JSC::EncodedJSValue functionImportMeta__resolveSync(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
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

            if (auto pathsObject = fromValue.getObject()->getIfPropertyExists(globalObject, builtinNames(vm).pathsPublicName())) {
                if (pathsObject.isCell() && pathsObject.asCell()->type() == JSC::JSType::ArrayType) {
                    auto pathsArray = JSC::jsCast<JSC::JSArray*>(pathsObject);
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
        JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(thisValue);
        if (!thisObject) [[unlikely]] {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope, "import.meta.resolveSync must be bound to an import.meta object"_s);
            return {};
        }

        auto clientData = WebCore::clientData(vm);
        JSValue pathProperty = thisObject->getIfPropertyExists(globalObject, clientData->builtinNames().pathPublicName());

        if (pathProperty && pathProperty.isString())
            from = JSC::JSValue::encode(pathProperty);
    }

    if (globalObject->onLoadPlugins.hasVirtualModules()) {
        if (moduleName.isString()) {
            auto moduleString = moduleName.toWTFString(globalObject);
            if (auto resolvedString = globalObject->onLoadPlugins.resolveVirtualModule(moduleString, JSValue::decode(from).toWTFString(globalObject))) {
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

extern "C" bool Bun__isBunMain(JSC::JSGlobalObject* global, const BunString*);

extern "C" JSC::EncodedJSValue functionImportMeta__resolveSyncPrivate(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);

    JSC::JSValue moduleName = callFrame->argument(0);
    JSValue from = callFrame->argument(1);
    bool isESM = callFrame->argument(2).asBoolean();
    bool isRequireDotResolve = callFrame->argument(3).isTrue();
    JSValue userPathList = callFrame->argument(4);

    RETURN_IF_EXCEPTION(scope, {});

    if (globalObject->onLoadPlugins.hasVirtualModules()) {
        if (moduleName.isString()) {
            auto moduleString = moduleName.toWTFString(globalObject);
            if (auto resolvedString = globalObject->onLoadPlugins.resolveVirtualModule(moduleString, from.toWTFString(globalObject))) {
                if (moduleString == resolvedString.value())
                    return JSC::JSValue::encode(moduleName);
                return JSC::JSValue::encode(jsString(vm, resolvedString.value()));
            }
        }
    }

    if (!isESM) {
        if (globalObject) [[likely]] {
            if (globalObject->hasOverriddenModuleResolveFilenameFunction) [[unlikely]] {
                auto overrideHandler = jsCast<JSObject*>(globalObject->m_moduleResolveFilenameFunction.getInitializedOnMainThread(globalObject));
                if (overrideHandler) [[likely]] {
                    ASSERT(overrideHandler->isCallable());
                    JSValue parentModuleObject = globalObject->requireMap()->get(globalObject, from);

                    JSValue parentID = jsUndefined();
                    if (auto* parent = jsDynamicCast<Bun::JSCommonJSModule*>(parentModuleObject)) {
                        parentID = parent->filename();
                    } else {
                        parentID = from;
                    }

                    MarkedArgumentBuffer args;
                    args.append(moduleName);
                    args.append(parentModuleObject);
                    auto parentIdStr = parentID.toWTFString(globalObject);
                    auto bunStr = Bun::toString(parentIdStr);
                    args.append(jsBoolean(Bun__isBunMain(lexicalGlobalObject, &bunStr)));

                    JSValue result = JSC::profiledCall(lexicalGlobalObject, ProfilingReason::API, overrideHandler, JSC::getCallData(overrideHandler), parentModuleObject, args);
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

        if (!userPathList.isUndefinedOrNull()) {
            if (JSArray* userPathListArray = jsDynamicCast<JSArray*>(userPathList)) {
                if (!moduleName.isString()) {
                    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "id"_s, "string"_s, moduleName);
                    scope.release();
                    return {};
                }

                JSC::EncodedJSValue result = {};
                WTF::Vector<BunString> paths;
                for (size_t i = 0; i < userPathListArray->length(); ++i) {
                    JSValue path = userPathListArray->getIndex(globalObject, i);
                    WTF::String pathStr = path.toWTFString(globalObject);
                    if (scope.exception()) goto cleanup;
                    paths.append(Bun::toStringRef(pathStr));
                }

                result = Bun__resolveSyncWithPaths(lexicalGlobalObject, JSC::JSValue::encode(moduleName), JSValue::encode(from), isESM, isRequireDotResolve, paths.begin(), paths.size());
                if (scope.exception()) goto cleanup;

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
                Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "option.paths"_s, userPathList);
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
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
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
            if (JSValue pathsObject = fromValue.getObject()->getIfPropertyExists(globalObject, builtinNames(vm).pathsPublicName())) {
                if (pathsObject.isCell() && pathsObject.asCell()->type() == JSC::JSType::ArrayType) {
                    auto* pathsArray = JSC::jsCast<JSC::JSArray*>(pathsObject);
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
        auto* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(thisValue);
        if (!thisObject) [[unlikely]] {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope, "import.meta.resolve must be bound to an import.meta object"_s);
            RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::JSValue {}));
        }

        auto clientData = WebCore::clientData(vm);
        JSValue pathProperty = thisObject->getIfPropertyExists(globalObject, clientData->builtinNames().pathPublicName());

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
    if (isAbsolutePath(resultString)) {
        // file path -> url
        RELEASE_AND_RETURN(scope, JSValue::encode(jsString(vm, WTF::URL::fileURLWithFileSystemPath(resultString).string())));
    }
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_url, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->urlProperty.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_dir, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->dirProperty.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_file, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->fileProperty.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_path, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->pathProperty.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_require, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    auto* nullable = thisObject->requireProperty.getInitializedOnMainThread(thisObject);
    return JSValue::encode(nullable ? nullable : jsUndefined());
}

// https://github.com/oven-sh/bun/issues/11754#issuecomment-2452626172
// This setter exists mainly to support various libraries doing weird things wrapping the require function.
JSC_DEFINE_CUSTOM_SETTER(jsImportMetaObjectSetter_require, (JSGlobalObject * jsGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
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
    auto* globalObject = jsCast<Zig::GlobalObject*>(jsGlobalObject);
    return JSValue::encode(globalObject->m_processEnvObject.getInitializedOnMainThread(globalObject));
}

static const HashTableValue ImportMetaObjectPrototypeValues[] = {
    { "dir"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_dir, 0 } },
    { "dirname"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_dir, 0 } },
    { "env"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_env, 0 } },
    { "file"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_file, 0 } },
    { "filename"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_path, 0 } },
    { "path"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_path, 0 } },
    { "require"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_require, jsImportMetaObjectSetter_require } },
    { "resolve"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMeta__resolve, 0 } },
    { "resolveSync"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, functionImportMeta__resolveSync, 0 } },
    { "url"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_url, 0 } },
};

class ImportMetaObjectPrototype final : public JSC::JSNonFinalObject {
public:
    DECLARE_INFO;
    using Base = JSC::JSNonFinalObject;

    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return Structure::create(vm, globalObject, globalObject->objectPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    }

    static ImportMetaObjectPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        ImportMetaObjectPrototype* prototype = new (NotNull, JSC::allocateCell<ImportMetaObjectPrototype>(vm)) ImportMetaObjectPrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(ImportMetaObjectPrototype, Base);
        return &vm.plainObjectSpace();
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);

        auto* clientData = WebCore::clientData(vm);
        auto& builtinNames = clientData->builtinNames();

        reifyStaticProperties(vm, ImportMetaObject::info(), ImportMetaObjectPrototypeValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();

        auto mainGetter = JSFunction::create(vm, globalObject, importMetaObjectMainCodeGenerator(vm), globalObject);

        this->putDirectAccessor(
            this->globalObject(),
            builtinNames.mainPublicName(),
            GetterSetter::create(vm, globalObject, mainGetter, mainGetter),
            JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::Accessor | 0);
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

JSC::Structure* ImportMetaObject::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    ImportMetaObjectPrototype* prototype = ImportMetaObjectPrototype::create(vm,
        globalObject,
        ImportMetaObjectPrototype::createStructure(vm, globalObject));

    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), ImportMetaObject::info());
}

void ImportMetaObject::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    this->requireProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSCell>::Initializer& init) {
        auto scope = DECLARE_THROW_SCOPE(init.vm);
        ImportMetaObject* meta = jsCast<ImportMetaObject*>(init.owner);

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
        init.set(jsCast<JSFunction*>(object));
    });
    this->urlProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSString>::Initializer& init) {
        ImportMetaObject* meta = jsCast<ImportMetaObject*>(init.owner);
        init.set(jsString(init.vm, meta->url));
    });
    this->dirProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSString>::Initializer& init) {
        ImportMetaObject* meta = jsCast<ImportMetaObject*>(init.owner);

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
        ImportMetaObject* meta = jsCast<ImportMetaObject*>(init.owner);

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
        ImportMetaObject* meta = jsCast<ImportMetaObject*>(init.owner);

        WTF::URL url(meta->url);
        if (url.protocolIsFile()) {
            init.set(jsString(init.vm, url.fileSystemPath()));
        } else {
            init.set(jsString(init.vm, url.path()));
        }
    });
}

template<typename Visitor>
void ImportMetaObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ImportMetaObject* fn = jsCast<ImportMetaObject*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    fn->requireProperty.visit(visitor);
    fn->urlProperty.visit(visitor);
    fn->dirProperty.visit(visitor);
    fn->fileProperty.visit(visitor);
    fn->pathProperty.visit(visitor);
}

DEFINE_VISIT_CHILDREN(ImportMetaObject);

void ImportMetaObject::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    // if (void* wrapped = thisObject->wrapped()) {
    // if (thisObject->scriptExecutionContext())
    //     analyzer.setLabelForCell(cell, makeString("url "_s, thisObject->scriptExecutionContext()->url().string()));
    // }
    Base::analyzeHeap(cell, analyzer);
}

JSValue ImportMetaObject::getPrototype(JSObject* object, JSC::JSGlobalObject* globalObject)
{
    ASSERT(object->inherits(info()));
    return jsNull();
}

const JSC::ClassInfo ImportMetaObject::s_info = { "ImportMeta"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(ImportMetaObject) };
}
