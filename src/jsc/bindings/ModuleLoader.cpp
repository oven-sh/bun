#include "root.h"

#include "headers-handwritten.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "ModuleLoader.h"
#include "CodeGenerationFromStrings.h"
#include "JavaScriptCore/Identifier.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

#include "ZigSourceProvider.h"

#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/OptionsList.h>
#include <JavaScriptCore/ParserError.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/JSONObject.h>

#include "EventEmitter.h"
#include "JSEventEmitter.h"

#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/ModuleRegistryEntry.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>

#include "../modules/ObjectModule.h"
#include "JSCommonJSModule.h"
#include "IsolatedModuleCache.h"
#include "ModuleGraph.h"
#include "../modules/_NativeModule.h"

#include "JSCommonJSExtensions.h"

#include "BunProcess.h"

namespace Bun {
using namespace JSC;
using namespace Zig;
using namespace WebCore;

extern "C" BunLoaderType Bun__getDefaultLoader(JSC::JSGlobalObject*, const BunString* specifier, const BunString* typeAttribute);

static JSC::JSPromise* rejectedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    auto scope = DECLARE_THROW_SCOPE(vm);
    scope.throwException(globalObject, value);
    return promise->rejectWithCaughtException(vm, scope);
}

static JSC::JSPromise* resolvedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    promise->fulfill(vm, value);
    return promise;
}

// Converts an object from InternalModuleRegistry into { ...obj, default: obj }
static JSC::SyntheticSourceProvider::LazySyntheticSourceGenerator generateInternalModuleSourceCode(JSC::JSGlobalObject* globalObject, InternalModuleRegistry::Field moduleId)
{
    return [moduleId](JSC::JSGlobalObject* lexicalGlobalObject,
               JSC::Identifier moduleKey,
               Vector<JSC::Identifier, 4>& exportNames,
               JSC::MarkedArgumentBuffer& exportValues) -> JSC::JSObject* {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        GlobalObject* globalObject = uncheckedDowncast<GlobalObject>(lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        JSValue requireResult = globalObject->internalModuleRegistry()->requireId(globalObject, vm, moduleId);
        RETURN_IF_EXCEPTION(throwScope, nullptr);
        auto* object = requireResult.getObject();
        ASSERT_WITH_MESSAGE(object, "Expected object from requireId %s", moduleKey.string().string().utf8().legacyCStringPointer());

        JSC::EnsureStillAliveScope stillAlive(object);

        PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        object->getOwnPropertyNames(object, globalObject, properties, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(throwScope, nullptr);

        auto len = properties.size() + 1;
        exportNames.reserveCapacity(len);
        exportValues.ensureCapacity(len);

        bool hasDefault = false;
        bool hasLazyExports = false;

        for (auto& entry : properties) {
            if (entry == vm.propertyNames->defaultKeyword) [[unlikely]] {
                hasDefault = true;
            }
            exportNames.append(entry);

            PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty);
            bool hasOwn = object->methodTable()->getOwnPropertySlot(object, globalObject, entry, slot);
            RETURN_IF_EXCEPTION(throwScope, nullptr);
            // Accessors are how builtins defer loading (fs.ReadStream pulls in node:stream); JSC reads them off `object` on
            // first binding. An accessor user code defined on the exports object is read now instead (see isBunDefinedGetter).
            if (hasOwn && (slot.isCustom() || (slot.isAccessor() && Zig::isBunDefinedGetter(slot.getterSetter()->getter())))) {
                exportValues.append(JSValue());
                hasLazyExports = true;
                continue;
            }

            JSValue value = hasOwn ? slot.getValue(globalObject, entry) : object->get(globalObject, entry);
            RETURN_IF_EXCEPTION(throwScope, nullptr);
            exportValues.append(value);
        }

        if (!hasDefault) {
            exportNames.append(vm.propertyNames->defaultKeyword);
            exportValues.append(object);
        }

        return hasLazyExports ? object : nullptr;
    };
}

static OnLoadResult handleOnLoadObjectResult(Zig::GlobalObject* globalObject, JSC::JSObject* object)
{
    OnLoadResult result {};
    result.type = OnLoadResultTypeObject;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& builtinNames = WebCore::builtinNames(vm);
    auto exportsValue = object->getIfPropertyExists(globalObject, builtinNames.exportsPublicName());
    if (scope.exception()) [[unlikely]] {
        result.type = OnLoadResultTypeError;
        result.value.error = scope.exception();
        (void)scope.tryClearException();
        return result;
    }
    if (exportsValue) {
        if (exportsValue.isObject()) {
            result.value.object = exportsValue;
            return result;
        }
    }

    scope.throwException(globalObject, createTypeError(globalObject, "\"object\" loader must return an \"exports\" object"_s));
    result.type = OnLoadResultTypeError;
    result.value.error = scope.exception();
    (void)scope.tryClearException();
    return result;
}

JSC::JSPromise* PendingVirtualModuleResult::internalPromise()
{
    return uncheckedDowncast<JSC::JSPromise>(internalField(2).get());
}

const ClassInfo PendingVirtualModuleResult::s_info = { "PendingVirtualModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(PendingVirtualModuleResult) };

PendingVirtualModuleResult* PendingVirtualModuleResult::create(VM& vm, Structure* structure)
{
    PendingVirtualModuleResult* mod = new (NotNull, allocateCell<PendingVirtualModuleResult>(vm)) PendingVirtualModuleResult(vm, structure);
    return mod;
}
Structure* PendingVirtualModuleResult::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

PendingVirtualModuleResult::PendingVirtualModuleResult(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void PendingVirtualModuleResult::finishCreation(VM& vm, const WTF::String& specifier, const WTF::String& referrer)
{
    Base::finishCreation(vm);
    Base::internalField(0).set(vm, this, JSC::jsString(vm, specifier));
    Base::internalField(1).set(vm, this, JSC::jsString(vm, referrer));
    Base::internalField(2).set(vm, this, JSC::JSPromise::create(vm, globalObject()->promiseStructure()));
}

template<typename Visitor>
void PendingVirtualModuleResult::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<PendingVirtualModuleResult>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(PendingVirtualModuleResult);

PendingVirtualModuleResult* PendingVirtualModuleResult::create(JSC::JSGlobalObject* globalObject, const WTF::String& specifier, const WTF::String& referrer)
{
    auto* virtualModule = create(globalObject->vm(), static_cast<Zig::GlobalObject*>(globalObject)->pendingVirtualModuleResultStructure());
    virtualModule->finishCreation(globalObject->vm(), specifier, referrer);
    return virtualModule;
}

// What a module is fetched with besides its specifier and referrer, and the onLoad callbacks that match it.
struct ModuleFetch {
    Bun::JSModuleGraph* graph;
    JSC::JSString* specifierJS;
    BunString* typeAttribute;
    BunPlugin::OnLoad::Matches& onLoad;
};

template<bool allowPromise>
static JSValue fetchESMSourceCode(
    Zig::GlobalObject* globalObject,
    Bun::JSModuleGraph* graph,
    JSC::JSString* specifierJS,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute,
    bool onLoadDeclined = false,
    const CodeString* pluginContents = nullptr);

static void waitForOnLoad(Zig::GlobalObject* globalObject, PendingVirtualModuleResult* pendingModule, JSC::JSPromise* promise, const BunPlugin::OnLoad::Matches& matches)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    pendingModule->internalField(PendingVirtualModuleResult::OnLoadPath).set(vm, pendingModule, matches.path);
    pendingModule->internalField(PendingVirtualModuleResult::OnLoadCallbacks).clear();
    if (matches.next < matches.callbacks.size()) {
        ArgList notAsked;
        ArgList(matches.callbacks).getSlice(matches.next, notAsked);
        JSArray* callbacks = JSC::constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), notAsked);
        RETURN_IF_EXCEPTION(scope, );
        pendingModule->internalField(PendingVirtualModuleResult::OnLoadCallbacks).set(vm, pendingModule, callbacks);
    }

    promise->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionOnLoadObjectResultResolve), globalObject->thenable(jsFunctionOnLoadObjectResultReject), jsUndefined(), pendingModule);
}

// Bytes are what a file would hold: UTF-8. (Untagged, an EncodedSlice is Latin-1.)
static EncodedSlice contentsFromBytes(const void* data, size_t length)
{
    if (!length)
        return {};
    return { reinterpret_cast<const unsigned char*>(reinterpret_cast<uintptr_t>(data) | (static_cast<uint64_t>(1) << 61)), length };
}

static OnLoadResult handleOnLoadResultNotPromise(Zig::GlobalObject* globalObject, JSC::JSValue objectValue, BunString* specifier, const BunString* typeAttribute, bool wasModuleMock)
{
    OnLoadResult result = {};
    result.type = OnLoadResultTypeError;
    auto& vm = JSC::getVM(globalObject);
    result.value.error = JSC::jsUndefined();
    auto scope = DECLARE_THROW_SCOPE(vm);
    BunLoaderType loader = Bun__getDefaultLoader(globalObject, specifier, typeAttribute);

    if (JSC::Exception* exception = dynamicDowncast<JSC::Exception>(objectValue)) {
        result.value.error = exception->value();
        scope.release();
        return result;
    }

    JSC::JSObject* object = objectValue.getObject();
    if (!object) [[unlikely]] {
        scope.throwException(globalObject, JSC::createError(globalObject, "Expected module mock to return an object"_s));
        result.value.error = scope.exception();
        (void)scope.tryClearException();
        result.type = OnLoadResultTypeError;
        return result;
    }

    if (wasModuleMock) {
        result.type = OnLoadResultTypeObject;
        result.value.object = objectValue;
        return result;
    }

    auto loaderValue = object->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "loader"_s));
    if (scope.exception()) [[unlikely]] {
        result.value.error = scope.exception();
        (void)scope.tryClearException();
        return result;
    }
    if (loaderValue) {
        if (!loaderValue.isUndefinedOrNull()) {
            // If a loader is passed, we must validate it
            loader = BunLoaderTypeNone;

            JSC::JSString* loaderJSString = loaderValue.toStringOrNull(globalObject);
            if (auto ex = scope.exception()) [[unlikely]] {
                result.value.error = ex;
                (void)scope.tryClearException();
                return result;
            }
            if (loaderJSString) {
                WTF::String loaderString = loaderJSString->value(globalObject);
                RETURN_IF_EXCEPTION(scope, result);
                if (loaderString == "js"_s) {
                    loader = BunLoaderTypeJS;
                } else if (loaderString == "object"_s) {
                    RELEASE_AND_RETURN(scope, handleOnLoadObjectResult(globalObject, object));
                } else if (loaderString == "jsx"_s) {
                    loader = BunLoaderTypeJSX;
                } else if (loaderString == "ts"_s) {
                    loader = BunLoaderTypeTS;
                } else if (loaderString == "tsx"_s) {
                    loader = BunLoaderTypeTSX;
                } else if (loaderString == "json"_s) {
                    loader = BunLoaderTypeJSON;
                } else if (loaderString == "jsonc"_s) {
                    loader = BunLoaderTypeJSONC;
                } else if (loaderString == "json5"_s) {
                    loader = BunLoaderTypeJSON5;
                } else if (loaderString == "toml"_s) {
                    loader = BunLoaderTypeTOML;
                } else if (loaderString == "yaml"_s) {
                    loader = BunLoaderTypeYAML;
                } else if (loaderString == "md"_s) {
                    loader = BunLoaderTypeMD;
                } else if (loaderString == "xml"_s) {
                    loader = BunLoaderTypeXML;
                } else if (loaderString == "text"_s) {
                    loader = BunLoaderTypeText;
                } else if (loaderString == "css"_s) {
                    loader = BunLoaderTypeCSS;
                }
            }
        }
    }

    if (loader == BunLoaderTypeNone) [[unlikely]] {
        throwException(globalObject, scope, createError(globalObject, "Expected loader to be one of \"js\", \"jsx\", \"object\", \"ts\", \"tsx\", \"json\", \"jsonc\", \"json5\", \"toml\", \"yaml\", \"xml\", \"text\", \"md\", or \"css\""_s));
        result.value.error = scope.exception();
        (void)scope.tryClearException();
        return result;
    }

    // Source a plugin supplies is a string made into script. What it supplies for a loader of
    // data (json, toml, ...) or as an object is not.
    if (Bun::mayNotMakeScriptFromStrings() && (loader == BunLoaderTypeJS || loader == BunLoaderTypeJSX || loader == BunLoaderTypeTS || loader == BunLoaderTypeTSX)) [[unlikely]] {
        result.value.error = Bun::createCodeGenerationFromStringsError(globalObject);
        return result;
    }

    result.value.sourceText.loader = loader;
    result.value.sourceText.value = JSValue {};
    result.value.sourceText.string = {};

    auto contentsValue = object->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "contents"_s));
    if (scope.exception()) [[unlikely]] {
        result.value.error = scope.exception();
        (void)scope.tryClearException();
        return result;
    }
    if (contentsValue) {
        if (contentsValue.isString()) {
            JSC::JSString* contentsJSString = contentsValue.toStringOrNull(globalObject);
            RETURN_IF_EXCEPTION(scope, result);
            if (contentsJSString) {
                result.value.sourceText.string = Zig::toEncodedSlice(contentsJSString, globalObject);
                RETURN_IF_EXCEPTION(scope, result);
                result.value.sourceText.value = contentsValue;
            }
        } else if (JSC::JSArrayBufferView* view = dynamicDowncast<JSC::JSArrayBufferView>(contentsValue)) {
            result.value.sourceText.string = contentsFromBytes(view->vector(), view->byteLength());
            result.value.sourceText.value = contentsValue;
        } else if (JSC::JSArrayBuffer* buffer = dynamicDowncast<JSC::JSArrayBuffer>(contentsValue)) {
            result.value.sourceText.string = contentsFromBytes(buffer->impl()->data(), buffer->impl()->byteLength());
            result.value.sourceText.value = contentsValue;
        }
    }

    if (result.value.sourceText.value.isEmpty()) [[unlikely]] {
        throwException(globalObject, scope, createError(globalObject, "Expected \"contents\" to be a string, an ArrayBufferView or an ArrayBuffer"_s));
        result.value.error = scope.exception();
        (void)scope.tryClearException();
        return result;
    }

    result.type = OnLoadResultTypeCode;
    return result;
}

static OnLoadResult handleOnLoadResult(Zig::GlobalObject* globalObject, JSC::JSValue objectValue, BunString* specifier, const BunString* typeAttribute, bool wasModuleMock)
{
    if (dynamicDowncast<JSC::JSPromise>(objectValue)) {
        OnLoadResult result = {};
        result.type = OnLoadResultTypePromise;
        result.value.promise = objectValue;
        result.wasMock = wasModuleMock;
        return result;
    }

    return handleOnLoadResultNotPromise(globalObject, objectValue, specifier, typeAttribute, wasModuleMock);
}

// What require() gives for a module whose exports are `object`. Empty: its module namespace object.
static JSValue commonJSExportsOfObjectModule(Zig::GlobalObject* globalObject, JSC::JSObject* object, bool wasModuleMock)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto* mockedCommonJSModule = wasModuleMock ? dynamicDowncast<JSCommonJSModule>(object) : nullptr)
        RELEASE_AND_RETURN(scope, mockedCommonJSModule->exportsObject());

    auto esModuleValue = object->getIfPropertyExists(globalObject, vm.propertyNames->__esModule);
    RETURN_IF_EXCEPTION(scope, {});
    if (esModuleValue && esModuleValue.toBoolean(globalObject)) {
        auto defaultValue = object->getIfPropertyExists(globalObject, vm.propertyNames->defaultKeyword);
        RETURN_IF_EXCEPTION(scope, {});
        if (defaultValue && !defaultValue.isUndefined())
            return defaultValue;
    }
    return wasModuleMock ? object : JSValue();
}

template<bool allowPromise>
static JSValue handleVirtualModuleResult(
    Zig::GlobalObject* globalObject,
    JSValue virtualModuleResult,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    const ModuleFetch& fetch,
    bool wasModuleMock = false,
    JSCommonJSModule* commonJSModule = nullptr)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* moduleMock = wasModuleMock ? virtualModuleResult.getObject() : nullptr;
    if (wasModuleMock) {
        JSC::JSPromise* pending = Bun::runModuleMock(globalObject, moduleMock, !allowPromise || commonJSModule);
        RETURN_IF_EXCEPTION(scope, {});
        if (pending)
            virtualModuleResult = pending;
    }
    auto onLoadResult = handleOnLoadResult(globalObject, virtualModuleResult, specifier, fetch.typeAttribute, wasModuleMock);
    RETURN_IF_EXCEPTION(scope, {});

    const auto reject = [&](JSC::JSValue exception) -> JSValue {
        if constexpr (allowPromise) {
            return rejectedInternalPromise(globalObject, exception);
        } else {
            throwException(globalObject, scope, exception);
            return exception;
        }
    };

    const auto rejectOrResolve = [&](JSValue code) -> JSValue {
        if (auto* exception = scope.exception()) {
            if constexpr (allowPromise) {
                TRY_CLEAR_EXCEPTION(scope, {});
                RELEASE_AND_RETURN(scope, rejectedInternalPromise(globalObject, exception));
            } else {
                return exception;
            }
        }

        res->success = true;

        if constexpr (allowPromise) {
            scope.release();
            return resolvedInternalPromise(globalObject, code);
        } else {
            return code;
        }
    };

    switch (onLoadResult.type) {
    case OnLoadResultTypeCode: {
        if (commonJSModule)
            RELEASE_AND_RETURN(scope, fetchCommonJSModuleNonBuiltin<false>(globalObject->bunVM(), vm, globalObject, specifier, fetch.specifierJS, referrer, fetch.typeAttribute, res, commonJSModule, specifier->toWTFString(BunString::ZeroCopy), BunLoaderTypeNone, scope, &onLoadResult.value.sourceText));
        RELEASE_AND_RETURN(scope, fetchESMSourceCode<allowPromise>(globalObject, fetch.graph, fetch.specifierJS, res, specifier, referrer, fetch.typeAttribute, false, &onLoadResult.value.sourceText));
    }
    case OnLoadResultTypeError: {
        RELEASE_AND_RETURN(scope, reject(onLoadResult.value.error));
    }

    case OnLoadResultTypeObject: {
        JSC::JSObject* object = onLoadResult.value.object.getObject();
        JSC::JSObject* exportsObject = wasModuleMock ? Bun::resultOfModuleMock(object) : object;
        if (commonJSModule && exportsObject) {
            JSValue exports = commonJSExportsOfObjectModule(globalObject, exportsObject, wasModuleMock);
            if (scope.exception()) [[unlikely]] {
                return rejectOrResolve({});
            }
            if (exports) {
                commonJSModule->setExportsObject(exports);
                commonJSModule->hasEvaluated = true;
                return commonJSModule;
            }
        }

        if (wasModuleMock) {
            JSSourceCode* source = Bun::sourceCodeOfModuleMock(globalObject, object, specifier->toWTFString(), fetch.typeAttribute ? fetch.typeAttribute->toWTFString() : String());
            RELEASE_AND_RETURN(scope, rejectOrResolve(source));
        }

        RELEASE_AND_RETURN(scope, rejectOrResolve(createObjectModuleSourceCode(vm, object, specifier->toWTFString(BunString::ZeroCopy))));
    }

    case OnLoadResultTypePromise: {
        JSC::JSPromise* promise = uncheckedDowncast<JSC::JSPromise>(onLoadResult.value.promise);
        // require() throws instead of waiting.
        if (commonJSModule && !wasModuleMock && promise->status() == JSPromise::Status::Pending)
            return promise;
        JSFunction* performPromiseThenFunction = globalObject->performPromiseThenFunction();
        auto callData = JSC::getCallData(performPromiseThenFunction);
        ASSERT(callData.type != CallData::Type::None);
        auto specifierString = specifier->toWTFString(BunString::ZeroCopy);
        auto referrerString = referrer->toWTFString(BunString::ZeroCopy);
        PendingVirtualModuleResult* pendingModule = PendingVirtualModuleResult::create(globalObject, specifierString, referrerString);
        JSC::JSPromise* internalPromise = pendingModule->internalPromise();
        if (moduleMock)
            pendingModule->internalField(PendingVirtualModuleResult::ModuleMock).set(vm, pendingModule, moduleMock);
        if (fetch.typeAttribute)
            pendingModule->internalField(PendingVirtualModuleResult::TypeAttribute).set(vm, pendingModule, jsString(vm, fetch.typeAttribute->toWTFString()));
        if (fetch.graph)
            pendingModule->internalField(PendingVirtualModuleResult::ModuleGraph).set(vm, pendingModule, fetch.graph);
        if (fetch.onLoad.path) {
            waitForOnLoad(globalObject, pendingModule, promise, fetch.onLoad);
            RETURN_IF_EXCEPTION(scope, {});
            return internalPromise;
        }
        MarkedArgumentBuffer arguments;
        arguments.append(promise);
        arguments.append(globalObject->thenable(jsFunctionOnLoadObjectResultResolve));
        arguments.append(globalObject->thenable(jsFunctionOnLoadObjectResultReject));
        arguments.append(jsUndefined());
        arguments.append(pendingModule);
        ASSERT(!arguments.hasOverflowed());
        JSC::profiledCall(globalObject, ProfilingReason::Microtask, performPromiseThenFunction, callData, jsUndefined(), arguments);
        RETURN_IF_EXCEPTION(scope, {});
        return internalPromise;
    }
    default: {
        __builtin_unreachable();
    }
    }
}

extern "C" void Bun__onFulfillAsyncModule(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue encodedPromiseValue,
    JSC::EncodedJSValue encodedModuleLoader,
    ErrorableResolvedSource* res,
    const BunString* specifier,
    const BunString* referrer)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSPromise* promise = uncheckedDowncast<JSC::JSPromise>(JSC::JSValue::decode(encodedPromiseValue));
    // The loader that fetched: a Bun.ModuleGraph's, or (empty) the global object's.
    JSValue moduleLoader = JSC::JSValue::decode(encodedModuleLoader);
    Bun::JSModuleGraph* graph = moduleLoader ? Bun::moduleGraphOfLoader(globalObject, uncheckedDowncast<JSC::JSModuleLoader>(moduleLoader)) : nullptr;

    if (!res->success) {
        RELEASE_AND_RETURN(scope, promise->reject(vm, JSValue::decode(res->result.err)));
    }

    auto* specifierValue = Bun::toJS(globalObject, *specifier);
    RETURN_IF_EXCEPTION(scope, );

    // The new C++ module loader does not create a registry entry until *after*
    // this fetch promise resolves (provideFetch runs inside the
    // ModuleLoadTopSettled microtask). Two concurrent dynamic imports of the
    // same key therefore each get their own embedder fetch promise, and the
    // loser of that race must still resolve so its loadModule chain can reach
    // the (idempotent) provideFetch and reuse the already-loaded record.
    // The old #6946/#12910 short-circuit was for the JS loader's *shared*
    // entry.fetch promise; under the new loader returning here would strand
    // the loser's promise pending forever.
    //
    // FIXME(module-loader): the loser still re-transpiled the file. The right
    // fix is for JSModuleLoader::loadModule to ensureRegistered() *before*
    // calling fetch so concurrent importers share the entry's fetchPromise
    // instead of each round-tripping through the embedder.

    if (res->result.value.isCommonJSModule) {
        auto created = Bun::createCommonJSModule(globalObject, graph, specifierValue, res->result.value);
        EXCEPTION_ASSERT(created.has_value() == !scope.exception());
        if (created.has_value()) {
            JSSourceCode* code = JSSourceCode::create(vm, WTF::move(created.value()));
            promise->fulfill(vm, code);
            scope.assertNoExceptionExceptTermination();
        } else {
            auto* exception = scope.exception();
            if (!vm.isTerminationException(exception)) {
                (void)scope.tryClearException();
                promise->reject(vm, exception);
                scope.assertNoExceptionExceptTermination();
            }
        }
    } else {
        auto provider = Zig::SourceProvider::create(globalObject, res->result.value);
        if (Bun::IsolatedModuleCache::canUse(vm, globalObject->bunVM())) {
            Bun::IsolatedModuleCache::insert(vm, specifier->toWTFString(BunString::ZeroCopy), provider.get());
        }
        promise->fulfill(vm, JSC::JSSourceCode::create(vm, JSC::SourceCode(WTF::move(provider))));
        scope.assertNoExceptionExceptTermination();
    }
}

BuiltinModule fetchBuiltinModuleWithoutResolution(
    Zig::GlobalObject* globalObject,
    const BunString* specifier,
    ErrorableResolvedSource* res)
{
    using Kind = BuiltinModule::Kind;
    void* bunVM = globalObject->bunVM();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (globalObject->onLoadPlugins.hasVirtualModules() && isBunTest) [[unlikely]] {
        if (JSValue moduleMock = Bun::findModuleMock(globalObject, specifier)) {
            JSC::JSPromise* pending = Bun::runModuleMock(globalObject, moduleMock.getObject(), true);
            RETURN_IF_EXCEPTION(scope, {});
            JSC::JSObject* result = pending ? nullptr : Bun::resultOfModuleMock(moduleMock.getObject());
            if (!result) {
                JSC::throwTypeError(globalObject, scope, makeString("require() async module \""_s, specifier->toWTFString(BunString::ZeroCopy), "\" is unsupported. use \"await import()\" instead."_s));
                return {};
            }
            JSValue exports = commonJSExportsOfObjectModule(globalObject, result, true);
            RETURN_IF_EXCEPTION(scope, {});
            return { Kind::Exports, exports };
        }
    }
    if (Bun__fetchBuiltinModule(bunVM, globalObject, specifier, res)) {
        ASSERT(res->success);

        auto tag = res->result.value.tag;
        switch (tag) {
        // require("bun")
        case SyntheticModuleType::BunObject: {
            return { Kind::Exports, globalObject->bunObject() };
        }
        // require("module"), require("node:module")
        case SyntheticModuleType::NodeModule: {
            return { Kind::Exports, globalObject->m_nodeModuleConstructor.getInitializedOnMainThread(globalObject) };
        }
        // require("process"), require("node:process")
        case SyntheticModuleType::NodeProcess: {
            return { Kind::Exports, globalObject->processObject() };
        }

        case SyntheticModuleType::ESM: {
            return { Kind::Source };
        }

        // A text file embedded by `bun build --compile`: the string is `module.exports`.
        case SyntheticModuleType::ExportDefaultObject: {
            return { Kind::Exports, JSC::JSValue::decode(res->result.value.jsvalue_for_export) };
        }

        default: {
            if (tag & SyntheticModuleType::InternalModuleRegistryFlag) {
                constexpr auto mask = (SyntheticModuleType::InternalModuleRegistryFlag - 1);
                auto result = globalObject->internalModuleRegistry()->requireId(globalObject, vm, static_cast<InternalModuleRegistry::Field>(tag & mask));
                RETURN_IF_EXCEPTION(scope, {});
                return { Kind::Exports, result };
            }
            return { Kind::Source };
        }
        }
    }
    return {};
}

JSValue resolveAndFetchBuiltinModule(
    Zig::GlobalObject* globalObject,
    const BunString* specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ErrorableResolvedSource res;
    if (Bun__resolveAndFetchBuiltinModule(specifier, &res)) {
        ASSERT(res.success);

        auto tag = res.result.value.tag;
        switch (tag) {
        // require("bun")
        case SyntheticModuleType::BunObject: {
            return globalObject->bunObject();
        }
        // require("module"), require("node:module")
        case SyntheticModuleType::NodeModule: {
            return globalObject->m_nodeModuleConstructor.getInitializedOnMainThread(globalObject);
        }
        // require("process"), require("node:process")
        case SyntheticModuleType::NodeProcess: {
            return globalObject->processObject();
        }

        case SyntheticModuleType::ESM: {
            return {};
        }

        default: {
            if (tag & SyntheticModuleType::InternalModuleRegistryFlag) {
                constexpr auto mask = (SyntheticModuleType::InternalModuleRegistryFlag - 1);
                auto result = globalObject->internalModuleRegistry()->requireId(globalObject, vm, static_cast<InternalModuleRegistry::Field>(tag & mask));
                RETURN_IF_EXCEPTION(scope, {});
                return result;
            }

            return {};
        }
        }
    }
    return {};
}

void evaluateCommonJSCustomExtension(
    Zig::GlobalObject* globalObject,
    JSCommonJSModule* target,
    String filename,
    JSValue filenameValue,
    JSValue extension)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!extension) {
        throwTypeError(globalObject, scope, makeString("require.extension is not a function"_s));
        return;
    }
    JSC::CallData callData = JSC::getCallData(extension.asCell());
    if (callData.type == JSC::CallData::Type::None) {
        throwTypeError(globalObject, scope, makeString("require.extension is not a function"_s));
        return;
    }
    MarkedArgumentBuffer arguments;
    arguments.append(target);
    arguments.append(filenameValue);
    JSC::profiledCall(globalObject, ProfilingReason::API, extension, callData, target, arguments);
    RETURN_IF_EXCEPTION(scope, );
}

// A CommonJS module made from a ResolvedSource goes into IsolatedModuleCache as the file's (unless the wrapper is overridden).
static RefPtr<JSC::SourceProvider> commonJSProviderOfPluginContents(Zig::GlobalObject* globalObject, const String& key, const BunString* typeAttribute, const CodeString* pluginContents, ResolvedSource& source)
{
    if (!pluginContents || globalObject->hasOverriddenModuleWrapper)
        return nullptr;
    auto provider = Zig::SourceProvider::create(globalObject, source, JSC::SourceProviderSourceType::Program);
    if (Bun::IsolatedModuleCache::canUse(globalObject->vm(), globalObject->bunVM(), typeAttribute))
        Bun::IsolatedModuleCache::insert(globalObject->vm(), key, provider.get(), pluginContents);
    return RefPtr<JSC::SourceProvider>(WTF::move(provider));
}

// require() of a module whose provider IsolatedModuleCache has. Empty if it does not.
static JSValue requireFromIsolatedModuleCache(Zig::GlobalObject* globalObject, JSC::JSModuleLoader* loader, JSCommonJSModule* target, const String& key, const BunString* typeAttribute, const CodeString* pluginContents)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!Bun::IsolatedModuleCache::canUse(vm, globalObject->bunVM(), typeAttribute))
        return {};
    auto* cached = Bun::IsolatedModuleCache::lookup(vm, key, pluginContents);
    if (!cached)
        return {};
    if (cached->sourceType() == JSC::SourceProviderSourceType::Program) {
        // The wrapper override only affects CJS evaluation; if it's
        // active, re-transpile so the override can run.
        if (globalObject->hasOverriddenModuleWrapper)
            return {};
        target->evaluate(globalObject, Ref(*cached), cached->m_tag == ResolvedSourceTagPackageJSONTypeModule);
        RETURN_IF_EXCEPTION(scope, {});
        return target;
    }
    JSC::VM::SynchronousModuleQueue queue;
    queue.prev = vm.m_synchronousModuleQueue;
    vm.m_synchronousModuleQueue = &queue;
    loader->provideFetch(globalObject, JSC::Identifier::fromString(vm, key), JSC::ScriptFetchParameters::Type::JavaScript, JSC::SourceCode(Ref(*cached)));
    if (!scope.exception()) JSC::JSModuleLoader::drainSynchronousModuleQueue(globalObject);
    vm.m_synchronousModuleQueue = queue.prev;
    RETURN_IF_EXCEPTION(scope, {});
    return jsNumber(-1);
}

static bool hasAlreadyLoadedESMVersionSoWeShouldntTranspileItTwice(JSC::VM& vm, JSC::JSModuleLoader* loader, const String& specifier)
{
    auto* entry = loader->registryEntry(JSC::Identifier::fromString(vm, specifier));
    return entry && entry->status() >= JSC::ModuleRegistryEntry::Status::Fetched;
}

JSValue fetchCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSCommonJSModule* target,
    JSValue specifierValue,
    String specifierWtfString,
    BunString* referrer,
    BunString* typeAttribute)
{
    void* bunVM = globalObject->bunVM();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ErrorableResolvedSource resValue;
    ErrorableResolvedSource* res = &resValue;
    // An ES module reached from here is loaded by the requiring module's loader.
    JSC::JSModuleLoader* loader = Bun::moduleLoaderOf(globalObject, scope, target->moduleGraph());
    RETURN_IF_EXCEPTION(scope, {});

    if (Bun::isDataOrBlobURL(specifierWtfString)) [[unlikely]] {
        RETURN_IF_MAY_NOT_MAKE_SCRIPT_FROM_STRINGS(globalObject, scope, {});
    }

    BunString specifier = Bun::toString(specifierWtfString);

    bool wasModuleMock = false;
    BunPlugin::OnLoad::Matches onLoad;
    const ModuleFetch fetch { target->moduleGraph(), specifierValue.isString() ? asString(specifierValue) : nullptr, typeAttribute, onLoad };

    const auto requireVirtualModule = [&](JSValue virtualModuleResult) -> JSValue {
        JSValue promiseOrCommonJSModule = handleVirtualModuleResult<true>(globalObject, virtualModuleResult, res, &specifier, referrer, fetch, wasModuleMock, target);
        RETURN_IF_EXCEPTION(scope, {});

        // If we assigned module.exports to the virtual module, or gave the loader its source, we're done here.
        if (promiseOrCommonJSModule == target || promiseOrCommonJSModule.isNumber()) {
            RELEASE_AND_RETURN(scope, promiseOrCommonJSModule);
        }
        JSPromise* promise = uncheckedDowncast<JSPromise>(promiseOrCommonJSModule);
        switch (promise->status()) {
        case JSPromise::Status::Rejected: {
            promise->markAsHandled();
            JSC::throwException(globalObject, scope, promise->result());
            RELEASE_AND_RETURN(scope, JSValue {});
        }
        case JSPromise::Status::Pending:
            break;
        case JSPromise::Status::Fulfilled: {
            if (!res->success) {
                throwException(scope, res->result.err, globalObject);
                RELEASE_AND_RETURN(scope, {});
            }
            auto* jsSourceCode = dynamicDowncast<JSSourceCode>(promise->result());
            if (!jsSourceCode) [[unlikely]]
                break;
            JSC::VM::SynchronousModuleQueue queue;
            queue.prev = vm.m_synchronousModuleQueue;
            vm.m_synchronousModuleQueue = &queue;
            loader->provideFetch(globalObject, JSC::Identifier::fromString(vm, specifierWtfString), JSC::ScriptFetchParameters::Type::JavaScript, jsSourceCode);
            if (!scope.exception()) JSC::JSModuleLoader::drainSynchronousModuleQueue(globalObject);
            vm.m_synchronousModuleQueue = queue.prev;
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, jsNumber(-1));
        }
        }
        JSC::throwTypeError(globalObject, scope, makeString("require() async module \""_s, specifierWtfString, "\" is unsupported. use \"await import()\" instead."_s));
        RELEASE_AND_RETURN(scope, JSValue {});
    };

    // When "bun test" is enabled, allow users to override builtin modules
    // This is important for being able to trivially mock things like the filesystem.
    if (isBunTest) {
        JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, &specifier, wasModuleMock, onLoad);
        RETURN_IF_EXCEPTION(scope, {});
        if (virtualModuleResult)
            return requireVirtualModule(virtualModuleResult);
    }

    auto builtin = fetchBuiltinModuleWithoutResolution(globalObject, &specifier, res);
    RETURN_IF_EXCEPTION(scope, {});
    switch (builtin.kind) {
    case BuiltinModule::Kind::Source: {
        // A file embedded in a standalone executable is served by the builtin probe.
        // A CommonJS one is evaluated right here like any require()d CJS file (the
        // module loader path would find `target` already in the require map and
        // never give it its source); only ES modules go through the loader, which
        // fetches its own copy — this one is released with `res`.
        if (res->result.value.isCommonJSModule) {
            target->evaluate(globalObject, specifierWtfString, res->result.value);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, target);
        }
        RELEASE_AND_RETURN(scope, jsNumber(-1));
    }
    case BuiltinModule::Kind::Exports: {
        target->setExportsObject(builtin.exports);
        target->hasEvaluated = true;
        RELEASE_AND_RETURN(scope, target);
    }
    case BuiltinModule::Kind::None:
        break;
    }

    // When "bun test" is NOT enabled, disable users from overriding builtin modules
    if (!isBunTest) {
        JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, &specifier, wasModuleMock, onLoad);
        RETURN_IF_EXCEPTION(scope, {});
        if (virtualModuleResult)
            return requireVirtualModule(virtualModuleResult);
    }

    if (hasAlreadyLoadedESMVersionSoWeShouldntTranspileItTwice(vm, loader, specifierWtfString)) {
        RELEASE_AND_RETURN(scope, jsNumber(-1));
    }

    JSValue cached = requireFromIsolatedModuleCache(globalObject, loader, target, specifierWtfString, typeAttribute, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    if (cached)
        return cached;

    return fetchCommonJSModuleNonBuiltin<false>(bunVM, vm, globalObject, &specifier, specifierValue, referrer, typeAttribute, res, target, specifierWtfString, BunLoaderTypeNone, scope);
}

template<bool isExtension>
JSValue fetchCommonJSModuleNonBuiltin(
    void* bunVM,
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    BunString* specifier,
    JSC::JSValue specifierValue,
    BunString* referrer,
    BunString* typeAttribute,
    ErrorableResolvedSource* res,
    JSCommonJSModule* target,
    String specifierWtfString,
    BunLoaderType forceLoaderType,
    JSC::ThrowScope& scope,
    const CodeString* pluginContents)
{
    JSC::JSModuleLoader* loader = Bun::moduleLoaderOf(globalObject, scope, target->moduleGraph());
    RETURN_IF_EXCEPTION(scope, {});
    if (Bun::isDataOrBlobURL(specifierWtfString)) [[unlikely]] {
        RETURN_IF_MAY_NOT_MAKE_SCRIPT_FROM_STRINGS(globalObject, scope, {});
    }
    if (pluginContents) {
        if (hasAlreadyLoadedESMVersionSoWeShouldntTranspileItTwice(vm, loader, specifierWtfString))
            RELEASE_AND_RETURN(scope, jsNumber(-1));
        JSValue cached = requireFromIsolatedModuleCache(globalObject, loader, target, specifierWtfString, typeAttribute, pluginContents);
        RETURN_IF_EXCEPTION(scope, {});
        if (cached)
            return cached;
        Bun__transpileVirtualModule(globalObject, specifier, referrer, &pluginContents->string, pluginContents->loader, res);
    } else {
        Bun__transpileFile(bunVM, globalObject, specifier, referrer, typeAttribute, res, false, !isExtension, forceLoaderType);
    }
    if (res->success && res->result.value.isCommonJSModule) {
        if constexpr (isExtension) {
            target->evaluateWithPotentiallyOverriddenCompile(globalObject, specifierWtfString, specifierValue, res->result.value);
        } else if (auto provider = commonJSProviderOfPluginContents(globalObject, specifierWtfString, typeAttribute, pluginContents, res->result.value)) {
            target->evaluate(globalObject, provider.releaseNonNull(), res->result.value.tag == ResolvedSourceTagPackageJSONTypeModule);
        } else {
            target->evaluate(globalObject, specifierWtfString, res->result.value);
        }
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, target);
    }

    if (!res->success) {
        throwException(scope, res->result.err, globalObject);
        RELEASE_AND_RETURN(scope, {});
    }

    // The JSONForObjectLoader tag is source code returned from Bun that needs
    // to go through the JSON parser in JSC.
    //
    // We don't use JSON.parse directly in JS because we want the top-level keys of the JSON
    // object to be accessible as named imports.
    //
    // We don't use Bun's JSON parser because JSON.parse is faster and
    // handles stack overflow better.
    //
    // When parsing tsconfig.*.json or jsconfig.*.json, we go through Bun's JSON
    // parser instead to support comments and trailing commas.
    if (res->result.value.tag == SyntheticModuleType::JSONForObjectLoader) {
        WTF::String jsonSource = res->result.value.source_code.toWTFString(BunString::NonNull);
        JSC::JSValue value = JSC::JSONParseWithException(globalObject, jsonSource);
        RETURN_IF_EXCEPTION(scope, {});

        target->putDirect(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), value, 0);
        target->hasEvaluated = true;
        RELEASE_AND_RETURN(scope, target);

    }
    // TOML and JSONC may go through here
    else if (res->result.value.tag == SyntheticModuleType::ExportsObject || res->result.value.tag == SyntheticModuleType::ExportDefaultObject) {
        JSC::JSValue value = JSC::JSValue::decode(res->result.value.jsvalue_for_export);
        if (!value) {
            JSC::throwException(globalObject, scope, JSC::createSyntaxError(globalObject, "Failed to parse Object"_s));
            RELEASE_AND_RETURN(scope, {});
        }

        target->putDirect(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), value, 0);
        target->hasEvaluated = true;
        RELEASE_AND_RETURN(scope, target);
    } else if (res->result.value.tag == SyntheticModuleType::CommonJSCustomExtension) {
        if constexpr (isExtension) {
            ASSERT_NOT_REACHED();
            JSC::throwException(globalObject, scope, JSC::createSyntaxError(globalObject, "Recursive extension. This is a bug in Bun"_s));
            RELEASE_AND_RETURN(scope, {});
        }
        evaluateCommonJSCustomExtension(globalObject, target, specifierWtfString, specifierValue, JSC::JSValue::decode(res->result.value.cjsCustomExtension));
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, target);
    }

    auto&& provider = Zig::SourceProvider::create(globalObject, res->result.value);
    if (Bun::IsolatedModuleCache::canUse(vm, bunVM, typeAttribute))
        Bun::IsolatedModuleCache::insert(vm, specifierWtfString, provider.get(), pluginContents);
    // provideFetch() now drives the C++ loader pipeline (parse -> module record)
    // via internal microtasks. We're about to hand this entry to require(esm)'s
    // synchronous load path, so run those reactions through the loader's
    // private queue instead of leaving them on the user microtask queue we're
    // currently inside of.
    {
        JSC::VM::SynchronousModuleQueue queue;
        queue.prev = vm.m_synchronousModuleQueue;
        vm.m_synchronousModuleQueue = &queue;
        loader->provideFetch(globalObject, JSC::Identifier::fromString(vm, specifierWtfString), JSC::ScriptFetchParameters::Type::JavaScript, JSC::SourceCode(provider));
        if (!scope.exception()) JSC::JSModuleLoader::drainSynchronousModuleQueue(globalObject);
        vm.m_synchronousModuleQueue = queue.prev;
    }
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, jsNumber(-1));
}

extern "C" JSC::JSPromise* JSC__JSModuleLoader__resolveAndLoadAndEvaluateModule(JSC::JSGlobalObject* globalObject, const BunString* specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto key = globalObject->moduleLoader()->resolve(globalObject, JSC::Identifier::fromString(vm, specifier->toWTFString()), {}, nullptr, /* useImportMap */ true);
    if (scope.exception()) [[unlikely]]
        return nullptr;

    auto* promise = JSC::loadAndEvaluateModule(globalObject, key.string(), nullptr, nullptr);
    EXCEPTION_ASSERT(!!promise == !scope.exception());
    return promise;
}

// Explicit instantiations of fetchCommonJSModuleNonBuiltin
template JSValue fetchCommonJSModuleNonBuiltin<true>(
    void* bunVM,
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    BunString* specifier,
    JSC::JSValue specifierValue,
    BunString* referrer,
    BunString* typeAttribute,
    ErrorableResolvedSource* res,
    JSCommonJSModule* target,
    String specifierWtfString,
    BunLoaderType forceLoaderType,
    JSC::ThrowScope& scope,
    const CodeString* pluginContents);
template JSValue fetchCommonJSModuleNonBuiltin<false>(
    void* bunVM,
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    BunString* specifier,
    JSC::JSValue specifierValue,
    BunString* referrer,
    BunString* typeAttribute,
    ErrorableResolvedSource* res,
    JSCommonJSModule* target,
    String specifierWtfString,
    BunLoaderType forceLoaderType,
    JSC::ThrowScope& scope,
    const CodeString* pluginContents);

extern "C" bool isBunTest;

template<bool allowPromise>
static JSValue fetchESMSourceCode(
    Zig::GlobalObject* globalObject,
    Bun::JSModuleGraph* graph,
    JSC::JSString* specifierJS,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute,
    bool onLoadDeclined,
    const CodeString* pluginContents)
{
    void* bunVM = globalObject->bunVM();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    const auto reject = [&](JSC::JSValue exception) -> JSValue {
        if constexpr (allowPromise) {
            RELEASE_AND_RETURN(scope, rejectedInternalPromise(globalObject, exception));
        } else {
            throwException(globalObject, scope, exception);
            return {};
        }
    };

    const auto rejectOrResolve = [&](JSValue code) -> JSValue {
        if (auto* exception = scope.exception()) {
            if constexpr (!allowPromise) {
                scope.release();
                return {};
            }

            (void)scope.tryClearException();
            RELEASE_AND_RETURN(scope, rejectedInternalPromise(globalObject, exception));
        }

        if constexpr (allowPromise) {
            auto* ret = resolvedInternalPromise(globalObject, code);
            scope.release();
            return ret;
        } else {
            return code;
        }
    };

    if (Bun::mayNotMakeScriptFromStrings() && Bun::isDataOrBlobURL(specifier->toWTFString(BunString::ZeroCopy))) [[unlikely]]
        return reject(Bun::createCodeGenerationFromStringsError(globalObject));

    bool wasModuleMock = false;
    BunPlugin::OnLoad::Matches onLoad;
    const ModuleFetch fetch { graph, specifierJS, typeAttribute, onLoad };
    const bool asksPlugins = !onLoadDeclined && !pluginContents;

    // When "bun test" is enabled, allow users to override builtin modules
    // This is important for being able to trivially mock things like the filesystem.
    if (isBunTest && asksPlugins) {
        JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, specifier, wasModuleMock, onLoad);
        RETURN_IF_EXCEPTION(scope, {});
        if (virtualModuleResult) {
            RELEASE_AND_RETURN(scope, handleVirtualModuleResult<allowPromise>(globalObject, virtualModuleResult, res, specifier, referrer, fetch, wasModuleMock));
        }
    }

    if (!pluginContents && Bun__fetchBuiltinModule(bunVM, globalObject, specifier, res)) {
        ASSERT(res->success);

        // This can happen if it's a `bun build --compile`'d CommonJS file
        if (res->result.value.isCommonJSModule) {
            auto created = Bun::createCommonJSModule(globalObject, graph, specifierJS, res->result.value);
            EXCEPTION_ASSERT(created.has_value() == !scope.exception());
            if (created.has_value()) {
                RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, WTF::move(created.value()))));
            }

            if constexpr (allowPromise) {
                auto* exception = scope.exception();
                (void)scope.tryClearException();
                RELEASE_AND_RETURN(scope, rejectedInternalPromise(globalObject, exception));
            } else {
                scope.release();
                return {};
            }
        }

        auto moduleKey = specifier->toWTFString(BunString::ZeroCopy);

        // bun:wrap and a few other builtins return real JS source (not a
        // synthetic generator). Their providers are identical across globals,
        // so check the isolation cache before re-creating one.
        const bool useIsolationCacheForBuiltin = Bun::IsolatedModuleCache::canUse(vm, bunVM, typeAttribute);
        if (useIsolationCacheForBuiltin) {
            if (auto* cached = Bun::IsolatedModuleCache::lookup(vm, moduleKey)) {
                RELEASE_AND_RETURN(scope, rejectOrResolve(JSC::JSSourceCode::create(vm, JSC::SourceCode(Ref(*cached)))));
            }
        }

        auto tag = res->result.value.tag;
        switch (tag) {
        case SyntheticModuleType::ESM: {
            auto&& provider = Zig::SourceProvider::create(globalObject, res->result.value, JSC::SourceProviderSourceType::Module, true);
            if (useIsolationCacheForBuiltin)
                Bun::IsolatedModuleCache::insert(vm, moduleKey, provider.get());
            RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, JSC::SourceCode(provider))));
        }

#define CASE(str, name)                                                                                                                              \
    case (SyntheticModuleType::name): {                                                                                                              \
        auto source = JSC::SourceCode(JSC::SyntheticSourceProvider::create(generateNativeModule_##name, JSC::SourceOrigin(), WTF::move(moduleKey))); \
        RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, WTF::move(source))));                                                     \
    }
            BUN_FOREACH_ESM_NATIVE_MODULE(CASE)
#undef CASE

#define LAZY_CASE(str, name)                                                                                                                                        \
    case (SyntheticModuleType::name): {                                                                                                                             \
        auto source = JSC::SourceCode(JSC::SyntheticSourceProvider::createWithLazyExports(generateNativeModule_##name, JSC::SourceOrigin(), WTF::move(moduleKey))); \
        RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, WTF::move(source))));                                                                    \
    }
            BUN_FOREACH_LAZY_ESM_NATIVE_MODULE(LAZY_CASE)
#undef LAZY_CASE

        // A text file embedded by `bun build --compile`: the string is the default export.
        case SyntheticModuleType::ExportDefaultObject: {
            JSC::JSValue value = JSC::JSValue::decode(res->result.value.jsvalue_for_export);
            if (!value) {
                RELEASE_AND_RETURN(scope, reject(JSC::createSyntaxError(globalObject, "Failed to parse Object"_s)));
            }
            RELEASE_AND_RETURN(scope, rejectOrResolve(createJSValueExportDefaultObjectSourceCode(vm, value, moduleKey)));
        }

        // CommonJS modules from src/js/*
        default: {
            if (tag & SyntheticModuleType::InternalModuleRegistryFlag) {
                constexpr auto mask = (SyntheticModuleType::InternalModuleRegistryFlag - 1);
                auto source = JSC::SourceCode(JSC::SyntheticSourceProvider::createWithLazyExports(generateInternalModuleSourceCode(globalObject, static_cast<InternalModuleRegistry::Field>(tag & mask)), JSC::SourceOrigin(URL(makeString("builtins://"_s, moduleKey))), moduleKey));
                RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, WTF::move(source))));
            } else {
                auto&& provider = Zig::SourceProvider::create(globalObject, res->result.value, JSC::SourceProviderSourceType::Module, true);
                if (useIsolationCacheForBuiltin)
                    Bun::IsolatedModuleCache::insert(vm, moduleKey, provider.get());
                RELEASE_AND_RETURN(scope, rejectOrResolve(JSC::JSSourceCode::create(vm, JSC::SourceCode(provider))));
            }
        }
        }
    }

    // When "bun test" is NOT enabled, disable users from overriding builtin modules
    if (!isBunTest && asksPlugins) {
        JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, specifier, wasModuleMock, onLoad);
        RETURN_IF_EXCEPTION(scope, {});
        if (virtualModuleResult) {
            RELEASE_AND_RETURN(scope, handleVirtualModuleResult<allowPromise>(globalObject, virtualModuleResult, res, specifier, referrer, fetch, wasModuleMock));
        }
    }

    const bool useIsolationCache = Bun::IsolatedModuleCache::canUse(vm, bunVM, typeAttribute);
    if (useIsolationCache) {
        if (auto* cached = Bun::IsolatedModuleCache::lookup(vm, specifier->toWTFString(BunString::ZeroCopy), pluginContents)) {
            // As after a transpilation: didFulfillPendingVirtualModule tells a source from an error by it.
            res->success = true;
            if (cached->sourceType() != JSC::SourceProviderSourceType::Program) {
                RELEASE_AND_RETURN(scope, rejectOrResolve(JSC::JSSourceCode::create(vm, JSC::SourceCode(Ref(*cached)))));
            }
            // Mirror the guard in fetchCommonJSModule: a Module.wrap override only
            // affects CJS evaluation, so don't serve a cached Program-type provider
            // when one is active in this global — fall through to re-transpile.
            if (!globalObject->hasOverriddenModuleWrapper) {
                auto created = Bun::createCommonJSModule(globalObject, graph, specifierJS, Ref(*cached), cached->m_tag == ResolvedSourceTagPackageJSONTypeModule);
                EXCEPTION_ASSERT(created.has_value() == !scope.exception());
                if (created.has_value()) {
                    RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, WTF::move(created.value()))));
                }
                if constexpr (allowPromise) {
                    auto* exception = scope.exception();
                    (void)scope.tryClearException();
                    RELEASE_AND_RETURN(scope, rejectedInternalPromise(globalObject, exception));
                } else {
                    scope.release();
                    return {};
                }
            }
        }
    }

    if (pluginContents) {
        Bun__transpileVirtualModule(globalObject, specifier, referrer, &pluginContents->string, pluginContents->loader, res);
    } else if constexpr (allowPromise) {
        auto* pendingCtx = Bun__transpileFile(bunVM, globalObject, specifier, referrer, typeAttribute, res, true, false, BunLoaderTypeNone, graph ? JSValue::encode(graph->loader()) : JSC::EncodedJSValue {});
        if (pendingCtx) {
            return pendingCtx;
        }
    } else {
        Bun__transpileFile(bunVM, globalObject, specifier, referrer, typeAttribute, res, false, false, BunLoaderTypeNone);
    }

    if (res->success && res->result.value.isCommonJSModule) {
        auto provider = commonJSProviderOfPluginContents(globalObject, specifier->toWTFString(BunString::ZeroCopy), typeAttribute, pluginContents, res->result.value);
        auto created = provider
            ? Bun::createCommonJSModule(globalObject, graph, specifierJS, provider.releaseNonNull(), res->result.value.tag == ResolvedSourceTagPackageJSONTypeModule)
            : Bun::createCommonJSModule(globalObject, graph, specifierJS, res->result.value);
        EXCEPTION_ASSERT(created.has_value() == !scope.exception());
        if (created.has_value()) {
            RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, WTF::move(created.value()))));
        }

        if constexpr (allowPromise) {
            auto* exception = scope.exception();
            (void)scope.tryClearException();
            RELEASE_AND_RETURN(scope, rejectedInternalPromise(globalObject, exception));
        } else {
            scope.release();
            return {};
        }
    }

    if (!res->success) {
        throwException(scope, res->result.err, globalObject);
        auto* exception = scope.exception();
        (void)scope.tryClearException();
        RELEASE_AND_RETURN(scope, reject(exception));
    }

    // The JSONForObjectLoader tag is source code returned from Bun that needs
    // to go through the JSON parser in JSC.
    //
    // We don't use JSON.parse directly in JS because we want the top-level keys of the JSON
    // object to be accessible as named imports.
    //
    // We don't use Bun's JSON parser because JSON.parse is faster and
    // handles stack overflow better.
    //
    // When parsing tsconfig.*.json or jsconfig.*.json, we go through Bun's JSON
    // parser instead to support comments and trailing commas.
    if (res->result.value.tag == SyntheticModuleType::JSONForObjectLoader) {
        WTF::String jsonSource = res->result.value.source_code.toWTFString(BunString::NonNull);
        JSC::JSValue value = JSC::JSONParseWithException(globalObject, jsonSource);
        if (scope.exception()) [[unlikely]] {
            auto* exception = scope.exception();
            (void)scope.tryClearException();
            RELEASE_AND_RETURN(scope, reject(exception));
        }

        // JSON can become strings, null, numbers, booleans so we must handle "export default 123"
        RELEASE_AND_RETURN(scope, rejectOrResolve(createJSValueModuleSourceCode(vm, value, specifier->toWTFString(BunString::ZeroCopy))));
    }
    // TOML and JSONC may go through here
    else if (res->result.value.tag == SyntheticModuleType::ExportsObject) {
        JSC::JSValue value = JSC::JSValue::decode(res->result.value.jsvalue_for_export);
        if (!value) {
            RELEASE_AND_RETURN(scope, reject(JSC::createSyntaxError(globalObject, "Failed to parse Object"_s)));
        }

        // JSON can become strings, null, numbers, booleans so we must handle "export default 123"
        RELEASE_AND_RETURN(scope, rejectOrResolve(createJSValueModuleSourceCode(vm, value, specifier->toWTFString(BunString::ZeroCopy))));
    } else if (res->result.value.tag == SyntheticModuleType::ExportDefaultObject) {
        JSC::JSValue value = JSC::JSValue::decode(res->result.value.jsvalue_for_export);
        if (!value) {
            RELEASE_AND_RETURN(scope, reject(JSC::createSyntaxError(globalObject, "Failed to parse Object"_s)));
        }

        // JSON can become strings, null, numbers, booleans so we must handle "export default 123"
        RELEASE_AND_RETURN(scope, rejectOrResolve(createJSValueExportDefaultObjectSourceCode(vm, value, specifier->toWTFString(BunString::ZeroCopy))));
    }

    auto provider = Zig::SourceProvider::create(globalObject, res->result.value);
    if (useIsolationCache) {
        Bun::IsolatedModuleCache::insert(vm, specifier->toWTFString(BunString::ZeroCopy), provider.get(), pluginContents);
    }
    RELEASE_AND_RETURN(scope, rejectOrResolve(JSC::JSSourceCode::create(vm, JSC::SourceCode(WTF::move(provider)))));
}

JSValue fetchESMSourceCodeSync(
    Zig::GlobalObject* globalObject,
    Bun::JSModuleGraph* graph,
    JSC::JSString* specifierJS,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute)
{
    return fetchESMSourceCode<false>(globalObject, graph, specifierJS, res, specifier, referrer, typeAttribute);
}

JSValue fetchESMSourceCodeAsync(
    Zig::GlobalObject* globalObject,
    Bun::JSModuleGraph* graph,
    JSC::JSString* specifierJS,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute)
{
    return fetchESMSourceCode<true>(globalObject, graph, specifierJS, res, specifier, referrer, typeAttribute);
}

// Returns the JSSourceCode, or a promise of the loader's own for it. Empty with nothing thrown: it waits for the promise of the next onLoad callback.
static JSValue didFulfillPendingVirtualModule(Zig::GlobalObject* globalObject, PendingVirtualModuleResult* pendingModule, JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue moduleMock = pendingModule->internalField(PendingVirtualModuleResult::ModuleMock).get();
    bool fetchesAgain = false;
    if (moduleMock) {
        fetchesAgain = !Bun::isModuleMockInUse(globalObject, moduleMock.getObject());
        RETURN_IF_EXCEPTION(scope, {});
        value = fetchesAgain ? JSValue() : moduleMock;
    }

    BunPlugin::OnLoad::Matches matches;
    if (JSValue onLoadPath = pendingModule->internalField(PendingVirtualModuleResult::OnLoadPath).get()) {
        matches.path = asString(onLoadPath);
        if (JSValue callbacks = pendingModule->internalField(PendingVirtualModuleResult::OnLoadCallbacks).get()) {
            auto* array = uncheckedDowncast<JSArray>(callbacks);
            for (unsigned i = 0; i < array->length(); i++)
                matches.callbacks.append(array->getIndexQuickly(i));
            if (matches.callbacks.hasOverflowed()) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
        }

        value = BunPlugin::OnLoad::ask(globalObject, matches, value);
        RETURN_IF_EXCEPTION(scope, {});
        if (auto* promise = value ? dynamicDowncast<JSC::JSPromise>(value) : nullptr) {
            waitForOnLoad(globalObject, pendingModule, promise, matches);
            RELEASE_AND_RETURN(scope, JSValue());
        }
    }

    JSString* specifierJS = asString(pendingModule->internalField(0).get());
    WTF::String specifierWtf = specifierJS->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    WTF::String referrerWtf = asString(pendingModule->internalField(1).get())->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    BunString specifier = Bun::toString(specifierWtf);
    BunString referrer = Bun::toString(referrerWtf);
    WTF::String typeAttributeWtf;
    if (JSValue typeAttributeJS = pendingModule->internalField(PendingVirtualModuleResult::TypeAttribute).get()) {
        typeAttributeWtf = asString(typeAttributeJS)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    BunString typeAttribute = Bun::toString(typeAttributeWtf);
    JSValue graph = pendingModule->internalField(PendingVirtualModuleResult::ModuleGraph).get();
    const ModuleFetch fetch { graph ? uncheckedDowncast<Bun::JSModuleGraph>(graph) : nullptr, specifierJS, typeAttributeWtf.isNull() ? nullptr : &typeAttribute, matches };
    ErrorableResolvedSource res;

    if (!value)
        RELEASE_AND_RETURN(scope, fetchESMSourceCode<true>(globalObject, fetch.graph, specifierJS, &res, &specifier, &referrer, fetch.typeAttribute, !fetchesAgain));

    JSValue result = handleVirtualModuleResult<false>(globalObject, value, &res, &specifier, &referrer, fetch, !!moduleMock);
    RETURN_IF_EXCEPTION(scope, {});
    if (!res.success && !result.inherits<JSC::JSPromise>()) [[unlikely]] {
        throwException(globalObject, scope, result);
        return {};
    }
    return result;
}
}

using namespace Bun;

BUN_DEFINE_HOST_FUNCTION(jsFunctionEvictIsolationSourceProviderCache, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue arg = callFrame->argument(0);
    if (arg.isUndefined()) {
        Bun::IsolatedModuleCache::clear(vm);
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    auto* str = arg.toStringOrNull(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (str) {
        WTF::String key = str->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        Bun::IsolatedModuleCache::evict(vm, key);
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionOnLoadObjectResultResolve, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PendingVirtualModuleResult* pendingModule = dynamicDowncast<PendingVirtualModuleResult>(callFrame->argument(1));
    if (!pendingModule) [[unlikely]]
        return JSValue::encode(jsUndefined());

    JSC::JSValue result = didFulfillPendingVirtualModule(static_cast<Zig::GlobalObject*>(globalObject), pendingModule, callFrame->argument(0));
    if (!result && !scope.exception())
        return JSValue::encode(jsUndefined());

    JSC::JSPromise* promise = pendingModule->internalPromise();
    pendingModule->internalField(0).set(vm, pendingModule, JSC::jsUndefined());
    pendingModule->internalField(1).set(vm, pendingModule, JSC::jsUndefined());
    pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
    if (scope.exception()) [[unlikely]] {
        promise->rejectWithCaughtException(vm, scope);
        return JSValue::encode(jsUndefined());
    }
    scope.release();
    if (auto* fetching = dynamicDowncast<JSC::JSPromise>(result))
        promise->pipeFrom(vm, fetching);
    else
        promise->fulfill(vm, result);
    return JSValue::encode(jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionOnLoadObjectResultReject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue reason = callFrame->argument(0);
    PendingVirtualModuleResult* pendingModule = dynamicDowncast<PendingVirtualModuleResult>(callFrame->argument(1));
    if (!pendingModule) [[unlikely]]
        return JSValue::encode(jsUndefined());
    pendingModule->internalField(0).set(vm, pendingModule, JSC::jsUndefined());
    pendingModule->internalField(1).set(vm, pendingModule, JSC::jsUndefined());
    JSC::JSPromise* promise = pendingModule->internalPromise();

    pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
    promise->reject(vm, reason);

    return JSValue::encode(jsUndefined());
}
