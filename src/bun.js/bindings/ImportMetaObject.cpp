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
#include "CommonJSModuleRecord.h"
#include <JavaScriptCore/JSPromise.h>
#include "PathInlines.h"

namespace Zig {
using namespace JSC;
using namespace WebCore;

static JSC::EncodedJSValue functionRequireResolve(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, const WTF::String& fromStr)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    switch (callFrame->argumentCount()) {
    case 0: {
        // not "requires" because "require" could be confusing
        JSC::throwTypeError(globalObject, scope, "require.resolve needs 1 argument (a string)"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    default: {
        JSValue thisValue = callFrame->thisValue();
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
            auto result = Bun__resolveSyncWithSource(globalObject, JSC::JSValue::encode(moduleName), &from, false);

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
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        if (callFrame->argumentCount() > 1) {
            JSC::JSValue fromValue = callFrame->argument(1);

            // require.resolve also supports a paths array
            // we only support a single path
            if (!fromValue.isUndefinedOrNull() && fromValue.isObject()) {
                if (auto pathsObject = fromValue.getObject()->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "paths"_s))) {
                    if (pathsObject.isCell() && pathsObject.asCell()->type() == JSC::JSType::ArrayType) {
                        auto pathsArray = JSC::jsCast<JSC::JSArray*>(pathsObject);
                        if (pathsArray->length() > 0) {
                            fromValue = pathsArray->getIndex(globalObject, 0);
                            RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));
                        }
                    }
                }
            }

            if (fromValue.isString()) {
                WTF::String str = fromValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));
                return doIt(str);
            }
        }

        return doIt(fromStr);
    }
    }
}

Zig::ImportMetaObject* Zig::ImportMetaObject::create(JSC::JSGlobalObject* globalObject, JSValue key)
{
    if (WebCore::DOMURL* domURL = WebCoreCast<WebCore::JSDOMURL, WebCore__DOMURL>(JSValue::encode(key))) {
        return create(globalObject, JSC::jsString(globalObject->vm(), domURL->href().fileSystemPath()));
    }

    auto* keyString = key.toStringOrNull(globalObject);
    if (UNLIKELY(!keyString)) {
        return nullptr;
    }

    if (keyString->value(globalObject).startsWith("file://"_s)) {
        return create(globalObject, JSC::jsString(globalObject->vm(), WTF::URL(keyString->value(globalObject)).fileSystemPath()));
    }

    return create(globalObject, keyString);
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
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    JSValue thisValue = callFrame->thisValue();
    JSC::JSValue moduleName = callFrame->argument(0);
    JSC::JSValue fromValue = callFrame->argument(1);

    if (moduleName.isUndefinedOrNull()) {
        JSC::throwTypeError(globalObject, scope, "expects a string"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    JSC__JSValue from;
    bool isESM = true;

    if (callFrame->argumentCount() > 1) {

        if (callFrame->argumentCount() > 2) {
            JSC::JSValue isESMValue = callFrame->argument(2);
            if (isESMValue.isBoolean()) {
                isESM = isESMValue.toBoolean(globalObject);
                RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));
            }
        }

        if (!fromValue.isUndefinedOrNull() && fromValue.isObject()) {

            if (auto pathsObject = fromValue.getObject()->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "paths"_s))) {
                if (pathsObject.isCell() && pathsObject.asCell()->type() == JSC::JSType::ArrayType) {
                    auto pathsArray = JSC::jsCast<JSC::JSArray*>(pathsObject);
                    if (pathsArray->length() > 0) {
                        fromValue = pathsArray->getIndex(globalObject, 0);
                        RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));
                    }
                }
            }

        } else if (fromValue.isBoolean()) {
            isESM = fromValue.toBoolean(globalObject);
            RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));
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
        if (UNLIKELY(!thisObject)) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope, "import.meta.resolveSync must be bound to an import.meta object"_s);
            return JSC::JSValue::encode(JSC::JSValue {});
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

    auto result = Bun__resolveSync(globalObject, JSC::JSValue::encode(moduleName), from, isESM);

    if (!JSC::JSValue::decode(result).isString()) {
        JSC::throwException(globalObject, scope, JSC::JSValue::decode(result));
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    scope.release();
    return result;
}

extern "C" bool Bun__isBunMain(JSC::JSGlobalObject* global, const BunString*);

extern "C" JSC::EncodedJSValue functionImportMeta__resolveSyncPrivate(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = jsDynamicCast<Zig::GlobalObject*>(lexicalGlobalObject);

    JSC::JSValue moduleName = callFrame->argument(0);
    JSValue from = callFrame->argument(1);
    bool isESM = callFrame->argument(2).asBoolean();

    if (moduleName.isUndefinedOrNull()) {
        JSC::throwTypeError(lexicalGlobalObject, scope, "expected module name as a string"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));

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
        if (LIKELY(globalObject)) {
            auto overrideHandler = globalObject->m_nodeModuleOverriddenResolveFilename.get();
            if (UNLIKELY(overrideHandler)) {
                ASSERT(overrideHandler->isCallable());
                JSValue parentModuleObject = globalObject->requireMap()->get(globalObject, from);

                JSValue parentID = jsUndefined();
                if (auto* parent = jsDynamicCast<Bun::JSCommonJSModule*>(parentModuleObject)) {
                    parentID = parent->id();
                } else {
                    parentID = from;
                }

                MarkedArgumentBuffer args;
                args.append(moduleName);
                args.append(parentModuleObject);
                auto parentIdStr = parentID.toWTFString(globalObject);
                auto bunStr = Bun::toString(parentIdStr);
                args.append(jsBoolean(Bun__isBunMain(lexicalGlobalObject, &bunStr)));

                return JSValue::encode(JSC::call(lexicalGlobalObject, overrideHandler, JSC::getCallData(overrideHandler), parentModuleObject, args));
            }
        }
    }

    auto result = Bun__resolveSync(lexicalGlobalObject, JSC::JSValue::encode(moduleName), JSValue::encode(from), isESM);

    if (!JSC::JSValue::decode(result).isString()) {
        JSC::throwException(lexicalGlobalObject, scope, JSC::JSValue::decode(result));
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    scope.release();
    return result;
}

JSC_DEFINE_HOST_FUNCTION(functionImportMeta__resolve,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    switch (callFrame->argumentCount()) {
    case 0: {
        // not "requires" because "require" could be confusing
        JSC::throwTypeError(globalObject, scope, "import.meta.resolve needs 1 argument (a string)"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    default: {
        JSC::JSValue moduleName = callFrame->argument(0);

        if (moduleName.isUndefinedOrNull()) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope, "import.meta.resolve expects a string"_s);
            scope.release();
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        JSC__JSValue from;

        if (callFrame->argumentCount() > 1 && callFrame->argument(1).isString()) {
            from = JSC::JSValue::encode(callFrame->argument(1));
        } else {
            JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(callFrame->thisValue());
            if (UNLIKELY(!thisObject)) {
                auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
                JSC::throwTypeError(globalObject, scope, "import.meta.resolve must be bound to an import.meta object"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }

            auto clientData = WebCore::clientData(vm);

            from = JSC::JSValue::encode(thisObject->getIfPropertyExists(globalObject, clientData->builtinNames().pathPublicName()));
            RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));
        }

        if (globalObject->onLoadPlugins.hasVirtualModules()) {
            if (moduleName.isString()) {
                auto moduleString = moduleName.toWTFString(globalObject);
                if (auto resolvedString = globalObject->onLoadPlugins.resolveVirtualModule(moduleString, JSValue::decode(from).toWTFString(globalObject))) {
                    if (moduleString == resolvedString.value())
                        return JSC::JSValue::encode(JSPromise::resolvedPromise(globalObject, moduleName));
                    return JSC::JSValue::encode(JSPromise::resolvedPromise(globalObject, jsString(vm, resolvedString.value())));
                }
            }
        }

        return Bun__resolve(globalObject, JSC::JSValue::encode(moduleName), from, true);
    }
    }
}

enum class ImportMetaPropertyOffset : uint32_t {
    url,
    dir,
    file,
    path,
    require,
};
static constexpr uint32_t numberOfImportMetaProperties = 5;

Zig::ImportMetaObject* ImportMetaObject::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, const WTF::String& url)
{
    ImportMetaObject* ptr = new (NotNull, JSC::allocateCell<ImportMetaObject>(vm)) ImportMetaObject(vm, structure, url);
    ptr->finishCreation(vm);
    return ptr;
}
Zig::ImportMetaObject* ImportMetaObject::create(JSC::JSGlobalObject* jslobalObject, JSC::JSString* keyString)
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(jslobalObject);
    auto& vm = globalObject->vm();
    auto view = keyString->value(globalObject);
    JSC::Structure* structure = globalObject->ImportMetaObjectStructure();
    return Zig::ImportMetaObject::create(vm, globalObject, structure, view);
}

JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_url, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->urlProperty.getInitializedOnMainThread(thisObject));
}
JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_dir, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->dirProperty.getInitializedOnMainThread(thisObject));
}
JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_file, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->fileProperty.getInitializedOnMainThread(thisObject));
}
JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_path, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->pathProperty.getInitializedOnMainThread(thisObject));
}
JSC_DEFINE_CUSTOM_GETTER(jsImportMetaObjectGetter_require, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    ImportMetaObject* thisObject = jsDynamicCast<ImportMetaObject*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return JSValue::encode(jsUndefined());

    return JSValue::encode(thisObject->requireProperty.getInitializedOnMainThread(thisObject));
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
    { "require"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsImportMetaObjectGetter_require, 0 } },
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

        auto mainGetter = JSFunction::create(vm, importMetaObjectMainCodeGenerator(vm), globalObject);

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

    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();

    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), ImportMetaObject::info());
}

void ImportMetaObject::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    this->requireProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSFunction>::Initializer& init) {
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

        JSFunction* value = jsCast<JSFunction*>(Bun::JSCommonJSModule::createBoundRequireFunction(init.vm, meta->globalObject(), path));
        init.set(value);
    });
    this->urlProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSString>::Initializer& init) {
        ImportMetaObject* meta = jsCast<ImportMetaObject*>(init.owner);
        WTF::URL url = isAbsolutePath(meta->url) ? WTF::URL::fileURLWithFileSystemPath(meta->url) : WTF::URL(meta->url);

        init.set(jsString(init.vm, url.string()));
    });
    this->dirProperty.initLater([](const JSC::LazyProperty<JSC::JSObject, JSC::JSString>::Initializer& init) {
        ImportMetaObject* meta = jsCast<ImportMetaObject*>(init.owner);

        WTF::URL url = isAbsolutePath(meta->url) ? WTF::URL::fileURLWithFileSystemPath(meta->url) : WTF::URL(meta->url);
        WTF::String dirname;

        if (url.isValid()) {
            if (url.protocolIsFile()) {
                dirname = url.fileSystemPath();
            } else {
                dirname = url.path().toString();
            }
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

        WTF::URL url = isAbsolutePath(meta->url) ? WTF::URL::fileURLWithFileSystemPath(meta->url) : WTF::URL(meta->url);
        WTF::String path;

        if (!url.isValid()) {
            path = meta->url;
        } else {
            if (url.protocolIsFile()) {
                path = url.fileSystemPath();
            } else {
                path = url.path().toString();
            }
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

        WTF::URL url = isAbsolutePath(meta->url) ? WTF::URL::fileURLWithFileSystemPath(meta->url) : WTF::URL(meta->url);

        if (!url.isValid()) {
            init.set(jsString(init.vm, meta->url));
        } else if (url.protocolIsFile()) {
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
    auto* thisObject = jsCast<ImportMetaObject*>(cell);
    // if (void* wrapped = thisObject->wrapped()) {
    // if (thisObject->scriptExecutionContext())
    //     analyzer.setLabelForCell(cell, "url " + thisObject->scriptExecutionContext()->url().string());
    // }
    Base::analyzeHeap(cell, analyzer);
}

const JSC::ClassInfo ImportMetaObject::s_info = { "ImportMeta"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(ImportMetaObject) };
}
