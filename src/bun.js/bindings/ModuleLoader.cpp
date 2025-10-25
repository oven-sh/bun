#include "root.h"

#include "headers-handwritten.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "ModuleLoader.h"
#include "JavaScriptCore/Identifier.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSInternalPromise.h>
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

#include "BunSourceProvider.h"

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
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>

#include "../modules/ObjectModule.h"
#include "JSCommonJSModule.h"
#include "../modules/_NativeModule.h"

#include "JSCommonJSExtensions.h"

#include "BunProcess.h"

namespace Bun {
using namespace JSC;
using namespace Zig;
using namespace WebCore;

extern "C" BunLoaderType Bun__getDefaultLoader(JSC::JSGlobalObject*, BunString* specifier);

static JSC::JSInternalPromise* rejectedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    JSInternalPromise* promise = JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
    auto scope = DECLARE_THROW_SCOPE(vm);
    scope.throwException(globalObject, value);
    return promise->rejectWithCaughtException(globalObject, scope);
}

static JSC::JSInternalPromise* resolvedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    JSInternalPromise* promise = JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(vm, promise, value);
    promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32AsAnyInt() | JSC::JSPromise::isFirstResolvingFunctionCalledFlag | static_cast<unsigned>(JSC::JSPromise::Status::Fulfilled)));
    return promise;
}

// Converts an object from InternalModuleRegistry into { ...obj, default: obj }
static JSC::SyntheticSourceProvider::SyntheticSourceGenerator generateInternalModuleSourceCode(JSC::JSGlobalObject* globalObject, InternalModuleRegistry::Field moduleId)
{
    return [moduleId](JSC::JSGlobalObject* lexicalGlobalObject,
               JSC::Identifier moduleKey,
               Vector<JSC::Identifier, 4>& exportNames,
               JSC::MarkedArgumentBuffer& exportValues) -> void {
        auto& vm = JSC::getVM(lexicalGlobalObject);
        GlobalObject* globalObject = jsCast<GlobalObject*>(lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        JSValue requireResult = globalObject->internalModuleRegistry()->requireId(globalObject, vm, moduleId);
        RETURN_IF_EXCEPTION(throwScope, void());
        auto* object = requireResult.getObject();
        ASSERT_WITH_MESSAGE(object, "Expected object from requireId %s", moduleKey.string().string().utf8().data());

        JSC::EnsureStillAliveScope stillAlive(object);

        PropertyNameArray properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        object->getOwnPropertyNames(object, globalObject, properties, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(throwScope, void());

        auto len = properties.size() + 1;
        exportNames.reserveCapacity(len);
        exportValues.ensureCapacity(len);

        bool hasDefault = false;

        for (auto& entry : properties) {
            if (entry == vm.propertyNames->defaultKeyword) [[unlikely]] {
                hasDefault = true;
            }
            exportNames.append(entry);
            JSValue value = object->get(globalObject, entry);
            RETURN_IF_EXCEPTION(throwScope, void());
            exportValues.append(value);
        }

        if (!hasDefault) {
            exportNames.append(vm.propertyNames->defaultKeyword);
            exportValues.append(object);
        }
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
        result.value.error = scope.exception();
        scope.clearException();
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
    scope.clearException();
    return result;
}

JSC::JSInternalPromise* PendingVirtualModuleResult::internalPromise()
{
    return jsCast<JSC::JSInternalPromise*>(internalField(2).get());
}

const ClassInfo PendingVirtualModuleResult::s_info = { "PendingVirtualModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(PendingVirtualModuleResult) };

PendingVirtualModuleResult* PendingVirtualModuleResult::create(VM& vm, Structure* structure)
{
    PendingVirtualModuleResult* mod = new (NotNull, allocateCell<PendingVirtualModuleResult>(vm)) PendingVirtualModuleResult(vm, structure);
    return mod;
}
Structure* PendingVirtualModuleResult::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
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
    Base::internalField(2).set(vm, this, JSC::JSInternalPromise::create(vm, globalObject()->internalPromiseStructure()));
}

template<typename Visitor>
void PendingVirtualModuleResult::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<PendingVirtualModuleResult*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(PendingVirtualModuleResult);

PendingVirtualModuleResult* PendingVirtualModuleResult::create(JSC::JSGlobalObject* globalObject, const WTF::String& specifier, const WTF::String& referrer, bool wasModuleLock)
{
    auto* virtualModule = create(globalObject->vm(), static_cast<Zig::GlobalObject*>(globalObject)->pendingVirtualModuleResultStructure());
    virtualModule->finishCreation(globalObject->vm(), specifier, referrer);
    virtualModule->wasModuleMock = wasModuleLock;
    return virtualModule;
}

OnLoadResult handleOnLoadResultNotPromise(Zig::GlobalObject* globalObject, JSC::JSValue objectValue, BunString* specifier, bool wasModuleMock)
{
    OnLoadResult result = {};
    result.type = OnLoadResultTypeError;
    auto& vm = JSC::getVM(globalObject);
    result.value.error = JSC::jsUndefined();
    auto scope = DECLARE_THROW_SCOPE(vm);
    BunLoaderType loader = Bun__getDefaultLoader(globalObject, specifier);

    if (JSC::Exception* exception = JSC::jsDynamicCast<JSC::Exception*>(objectValue)) {
        result.value.error = exception->value();
        scope.release();
        return result;
    }

    if (wasModuleMock) {
        result.type = OnLoadResultTypeObject;
        result.value.object = objectValue;
        return result;
    }

    JSC::JSObject* object = objectValue.getObject();
    if (!object) [[unlikely]] {
        scope.throwException(globalObject, JSC::createError(globalObject, "Expected module mock to return an object"_s));
        result.value.error = scope.exception();
        scope.clearException();
        result.type = OnLoadResultTypeError;
        return result;
    }

    auto loaderValue = object->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "loader"_s));
    if (scope.exception()) [[unlikely]] {
        result.value.error = scope.exception();
        scope.clearException();
        return result;
    }
    if (loaderValue) {
        if (!loaderValue.isUndefinedOrNull()) {
            // If a loader is passed, we must validate it
            loader = BunLoaderTypeNone;

            JSC::JSString* loaderJSString = loaderValue.toStringOrNull(globalObject);
            if (auto ex = scope.exception()) [[unlikely]] {
                result.value.error = ex;
                scope.clearException();
                return result;
            }
            if (loaderJSString) {
                WTF::String loaderString = loaderJSString->value(globalObject);
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
                } else if (loaderString == "toml"_s) {
                    loader = BunLoaderTypeTOML;
                } else if (loaderString == "yaml"_s) {
                    loader = BunLoaderTypeYAML;
                }
            }
        }
    }

    if (loader == BunLoaderTypeNone) [[unlikely]] {
        throwException(globalObject, scope, createError(globalObject, "Expected loader to be one of \"js\", \"jsx\", \"object\", \"ts\", \"tsx\", \"toml\", \"yaml\", or \"json\""_s));
        result.value.error = scope.exception();
        scope.clearException();
        return result;
    }

    result.value.sourceText.loader = loader;
    result.value.sourceText.value = JSValue {};
    result.value.sourceText.string = {};

    auto contentsValue = object->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "contents"_s));
    if (scope.exception()) [[unlikely]] {
        result.value.error = scope.exception();
        scope.clearException();
        return result;
    }
    if (contentsValue) {
        if (contentsValue.isString()) {
            if (JSC::JSString* contentsJSString = contentsValue.toStringOrNull(globalObject)) {
                result.value.sourceText.string = Zig::toZigString(contentsJSString, globalObject);
                result.value.sourceText.value = contentsValue;
            }
        } else if (JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(contentsValue)) {
            result.value.sourceText.string = ZigString { reinterpret_cast<const unsigned char*>(view->vector()), view->byteLength() };
            result.value.sourceText.value = contentsValue;
        }
    }

    if (result.value.sourceText.value.isEmpty()) [[unlikely]] {
        throwException(globalObject, scope, createError(globalObject, "Expected \"contents\" to be a string or an ArrayBufferView"_s));
        result.value.error = scope.exception();
        scope.clearException();
        return result;
    }

    result.type = OnLoadResultTypeCode;
    return result;
}

static OnLoadResult handleOnLoadResult(Zig::GlobalObject* globalObject, JSC::JSValue objectValue, BunString* specifier, bool wasModuleMock = false)
{
    if (JSC::jsDynamicCast<JSC::JSPromise*>(objectValue)) {
        OnLoadResult result = {};
        result.type = OnLoadResultTypePromise;
        result.value.promise = objectValue;
        result.wasMock = wasModuleMock;
        return result;
    }

    return handleOnLoadResultNotPromise(globalObject, objectValue, specifier, wasModuleMock);
}

template<bool allowPromise>
static JSValue handleVirtualModuleResult(
    Zig::GlobalObject* globalObject,
    JSValue virtualModuleResult,
    ModuleResult* res,
    BunString* specifier,
    BunString* referrer,
    bool wasModuleMock = false,
    JSCommonJSModule* commonJSModule = nullptr)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto onLoadResult = handleOnLoadResult(globalObject, virtualModuleResult, specifier, wasModuleMock);
    RETURN_IF_EXCEPTION(scope, {});

    const auto reject = [&](JSC::JSValue exception) -> JSValue {
        if constexpr (allowPromise) {
            return rejectedInternalPromise(globalObject, exception);
        } else {
            throwException(globalObject, scope, exception);
            return exception;
        }
    };

    const auto resolve = [&](JSValue code) -> JSValue {
        if constexpr (allowPromise) {
            scope.release();
            return resolvedInternalPromise(globalObject, code);
        } else {
            return code;
        }
    };

    const auto rejectOrResolve = [&](JSValue code) -> JSValue {
        if (auto* exception = scope.exception()) {
            if constexpr (allowPromise) {
                scope.clearException();
                RELEASE_AND_RETURN(scope, rejectedInternalPromise(globalObject, exception));
            } else {
                return exception;
            }
        }

        if constexpr (allowPromise) {
            scope.release();
            return resolvedInternalPromise(globalObject, code);
        } else {
            return code;
        }
    };

    switch (onLoadResult.type) {
    case OnLoadResultTypeCode: {
        Bun__transpileVirtualModule(globalObject, specifier, referrer, &onLoadResult.value.sourceText.string, onLoadResult.value.sourceText.loader, res);
        if (res->tag == ModuleResult::Tag::err) {
            RELEASE_AND_RETURN(scope, reject(JSValue::decode(res->value.err.exception)));
        }

        auto* provider = Bun__createSourceProvider(globalObject, &res->value.transpiled);
        return resolve(JSC::JSSourceCode::create(vm, JSC::SourceCode(adoptRef(*provider))));
    }
    case OnLoadResultTypeError: {
        RELEASE_AND_RETURN(scope, reject(onLoadResult.value.error));
    }

    case OnLoadResultTypeObject: {
        JSC::JSObject* object = onLoadResult.value.object.getObject();
        if (commonJSModule) {
            const auto& __esModuleIdentifier = vm.propertyNames->__esModule;
            auto esModuleValue = object->getIfPropertyExists(globalObject, __esModuleIdentifier);
            if (scope.exception()) [[unlikely]] {
                RELEASE_AND_RETURN(scope, reject(scope.exception()));
            }
            if (esModuleValue && esModuleValue.toBoolean(globalObject)) {
                auto defaultValue = object->getIfPropertyExists(globalObject, vm.propertyNames->defaultKeyword);
                if (scope.exception()) [[unlikely]] {
                    RELEASE_AND_RETURN(scope, reject(scope.exception()));
                }
                if (defaultValue && !defaultValue.isUndefined()) {
                    commonJSModule->setExportsObject(defaultValue);
                    commonJSModule->hasEvaluated = true;
                    return commonJSModule;
                }
            }
        }

        JSC::ensureStillAliveHere(object);
        auto function = generateObjectModuleSourceCode(
            globalObject,
            object);
        auto source = JSC::SourceCode(
            JSC::SyntheticSourceProvider::create(WTFMove(function),
                JSC::SourceOrigin(), specifier->toWTFString(BunString::ZeroCopy)));
        JSC::ensureStillAliveHere(object);
        RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(globalObject->vm(), WTFMove(source))));
    }

    case OnLoadResultTypePromise: {
        JSC::JSPromise* promise = jsCast<JSC::JSPromise*>(onLoadResult.value.promise);
        JSFunction* performPromiseThenFunction = globalObject->performPromiseThenFunction();
        auto callData = JSC::getCallData(performPromiseThenFunction);
        ASSERT(callData.type != CallData::Type::None);
        auto specifierString = specifier->toWTFString(BunString::ZeroCopy);
        auto referrerString = referrer->toWTFString(BunString::ZeroCopy);
        PendingVirtualModuleResult* pendingModule = PendingVirtualModuleResult::create(globalObject, specifierString, referrerString, wasModuleMock);
        JSC::JSInternalPromise* internalPromise = pendingModule->internalPromise();
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
    ModuleResult* res,
    BunString* specifier,
    BunString* referrer)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSInternalPromise* promise = jsCast<JSC::JSInternalPromise*>(JSC::JSValue::decode(encodedPromiseValue));

    if (res->tag == ModuleResult::Tag::err) {
        RELEASE_AND_RETURN(scope, promise->reject(globalObject, JSValue::decode(res->value.err.exception)));
    }

    auto specifierValue = Bun::toJS(globalObject, *specifier);

    auto* map = globalObject->esmRegistryMap();
    RETURN_IF_EXCEPTION(scope, );
    auto entry = map->get(globalObject, specifierValue);
    RETURN_IF_EXCEPTION(scope, );
    if (entry) {
        if (entry.isObject()) {

            auto* object = entry.getObject();
            auto state = object->getIfPropertyExists(globalObject, Bun::builtinNames(vm).statePublicName());
            RETURN_IF_EXCEPTION(scope, );
            if (state && state.isInt32()) {
                if (state.asInt32() > JSC::JSModuleLoader::Status::Fetch) {
                    // it's a race! we lost.
                    // https://github.com/oven-sh/bun/issues/6946
                    // https://github.com/oven-sh/bun/issues/12910
                    return;
                }
            }
        }

        if (res->tag == ModuleResult::Tag::transpiled && res->value.transpiled.flags.is_commonjs) {
            auto created = Bun::createCommonJSModule(jsCast<Zig::GlobalObject*>(globalObject), specifierValue, res->value.transpiled);
            EXCEPTION_ASSERT(created.has_value() == !scope.exception());
            if (created.has_value()) {
                JSSourceCode* code = JSSourceCode::create(vm, WTFMove(created.value()));
                promise->resolve(globalObject, code);
                scope.assertNoExceptionExceptTermination();
            } else {
                auto* exception = scope.exception();
                if (!vm.isTerminationException(exception)) {
                    scope.clearException();
                    promise->reject(globalObject, exception);
                    scope.assertNoExceptionExceptTermination();
                }
            }
        } else if (res->tag == ModuleResult::Tag::transpiled) {
            auto* provider = Bun__createSourceProvider(globalObject, &res->value.transpiled);
            promise->resolve(globalObject, JSC::JSSourceCode::create(vm, JSC::SourceCode(adoptRef(*provider))));
            scope.assertNoExceptionExceptTermination();
        }
        // NOTE: builtin and special tags shouldn't reach here in async path
    } else {
        // the module has since been deleted from the registry.
        // let's not keep it forever for no reason.
    }
}

JSValue fetchBuiltinModuleWithoutResolution(
    Zig::GlobalObject* globalObject,
    BunString* specifier,
    ModuleResult* res)
{
    void* bunVM = globalObject->bunVM();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BunString referrer = BunStringEmpty;
    if (Bun__fetchBuiltinModule(bunVM, globalObject, specifier, &referrer, res)) {
        switch (res->tag) {
        case ModuleResult::Tag::err: {
            return {};
        }

        case ModuleResult::Tag::special: {
            // Special modules return JSValue directly (bun, process, module, etc.)
            return JSValue::decode(res->value.special.jsvalue);
        }

        case ModuleResult::Tag::builtin: {
            // InternalModuleRegistry items
            auto result = globalObject->internalModuleRegistry()->requireId(
                globalObject, vm, static_cast<InternalModuleRegistry::Field>(res->value.builtin_id));
            RETURN_IF_EXCEPTION(scope, {});
            return result;
        }

        case ModuleResult::Tag::transpiled: {
            // ESM or transpiled code - signal to caller this needs further processing
            RELEASE_AND_RETURN(scope, jsNumber(-1));
        }
        }
    }
    return {};
}

JSValue resolveAndFetchBuiltinModule(
    Zig::GlobalObject* globalObject,
    BunString* specifier)
{
    void* bunVM = globalObject->bunVM();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ModuleResult res;
    memset(&res, 0, sizeof res);
    if (Bun__resolveAndFetchBuiltinModule(bunVM, specifier, &res)) {
        switch (res.tag) {
        case ModuleResult::Tag::special: {
            // Special modules return JSValue directly (bun, process, module, etc.)
            return JSValue::decode(res.value.special.jsvalue);
        }

        case ModuleResult::Tag::builtin: {
            // InternalModuleRegistry items
            auto result = globalObject->internalModuleRegistry()->requireId(
                globalObject, vm, static_cast<InternalModuleRegistry::Field>(res.value.builtin_id));
            RETURN_IF_EXCEPTION(scope, {});
            return result;
        }

        case ModuleResult::Tag::transpiled:
        case ModuleResult::Tag::err: {
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
    ModuleResult resValue;
    memset(&resValue, 0, sizeof resValue);

    ModuleResult* res = &resValue;

    BunString specifier = Bun::toString(specifierWtfString);

    bool wasModuleMock = false;

    // When "bun test" is enabled, allow users to override builtin modules
    // This is important for being able to trivially mock things like the filesystem.
    if (isBunTest) {
        JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, &specifier, wasModuleMock);
        RETURN_IF_EXCEPTION(scope, {});
        if (virtualModuleResult) {
            JSValue promiseOrCommonJSModule = handleVirtualModuleResult<true>(globalObject, virtualModuleResult, res, &specifier, referrer, wasModuleMock, target);
            RETURN_IF_EXCEPTION(scope, {});

            // If we assigned module.exports to the virtual module, we're done here.
            if (promiseOrCommonJSModule == target) {
                RELEASE_AND_RETURN(scope, target);
            }
            JSPromise* promise = jsCast<JSPromise*>(promiseOrCommonJSModule);
            switch (promise->status(vm)) {
            case JSPromise::Status::Rejected: {
                uint32_t promiseFlags = promise->internalField(JSPromise::Field::Flags).get().asUInt32AsAnyInt();
                promise->internalField(JSPromise::Field::Flags).set(vm, promise, jsNumber(promiseFlags | JSPromise::isHandledFlag));
                JSC::throwException(globalObject, scope, promise->result(vm));
                RELEASE_AND_RETURN(scope, JSValue {});
            }
            case JSPromise::Status::Pending: {
                JSC::throwTypeError(globalObject, scope, makeString("require() async module \""_s, specifierWtfString, "\" is unsupported. use \"await import()\" instead."_s));
                RELEASE_AND_RETURN(scope, JSValue {});
            }
            case JSPromise::Status::Fulfilled: {
                if (res->tag == ModuleResult::Tag::err) {
                    throwException(globalObject, scope, JSValue::decode(res->value.err.exception));
                    RELEASE_AND_RETURN(scope, {});
                }
                if (!wasModuleMock) {
                    auto* jsSourceCode = jsCast<JSSourceCode*>(promise->result(vm));
                    globalObject->moduleLoader()->provideFetch(globalObject, specifierValue, jsSourceCode->sourceCode());
                    RETURN_IF_EXCEPTION(scope, {});
                }
                RELEASE_AND_RETURN(scope, jsNumber(-1));
            }
            }
        }
    }

    auto builtin = fetchBuiltinModuleWithoutResolution(globalObject, &specifier, res);
    RETURN_IF_EXCEPTION(scope, {});
    if (builtin) {
        if (res->tag == ModuleResult::Tag::err) {
            RELEASE_AND_RETURN(scope, builtin);
        }
        target->setExportsObject(builtin);
        target->hasEvaluated = true;
        RELEASE_AND_RETURN(scope, target);
    }

    // When "bun test" is NOT enabled, disable users from overriding builtin modules
    if (!isBunTest) {
        JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, &specifier, wasModuleMock);
        RETURN_IF_EXCEPTION(scope, {});
        if (virtualModuleResult) {
            JSValue promiseOrCommonJSModule = handleVirtualModuleResult<true>(globalObject, virtualModuleResult, res, &specifier, referrer, wasModuleMock, target);
            RETURN_IF_EXCEPTION(scope, {});

            // If we assigned module.exports to the virtual module, we're done here.
            if (promiseOrCommonJSModule == target) {
                RELEASE_AND_RETURN(scope, target);
            }
            JSPromise* promise = jsCast<JSPromise*>(promiseOrCommonJSModule);
            switch (promise->status(vm)) {
            case JSPromise::Status::Rejected: {
                uint32_t promiseFlags = promise->internalField(JSPromise::Field::Flags).get().asUInt32AsAnyInt();
                promise->internalField(JSPromise::Field::Flags).set(vm, promise, jsNumber(promiseFlags | JSPromise::isHandledFlag));
                JSC::throwException(globalObject, scope, promise->result(vm));
                RELEASE_AND_RETURN(scope, JSValue {});
            }
            case JSPromise::Status::Pending: {
                JSC::throwTypeError(globalObject, scope, makeString("require() async module \""_s, specifierWtfString, "\" is unsupported. use \"await import()\" instead."_s));
                RELEASE_AND_RETURN(scope, JSValue {});
            }
            case JSPromise::Status::Fulfilled: {
                if (res->tag == ModuleResult::Tag::err) {
                    throwException(globalObject, scope, JSValue::decode(res->value.err.exception));
                    RELEASE_AND_RETURN(scope, {});
                }
                if (!wasModuleMock) {
                    auto* jsSourceCode = jsCast<JSSourceCode*>(promise->result(vm));
                    globalObject->moduleLoader()->provideFetch(globalObject, specifierValue, jsSourceCode->sourceCode());
                    RETURN_IF_EXCEPTION(scope, {});
                }
                RELEASE_AND_RETURN(scope, jsNumber(-1));
            }
            }
        }
    }

    JSMap* registry = globalObject->esmRegistryMap();
    RETURN_IF_EXCEPTION(scope, {});

    bool hasAlreadyLoadedESMVersionSoWeShouldntTranspileItTwice = [&]() -> bool {
        JSValue entry = registry->get(globalObject, specifierValue);

        if (!entry || !entry.isObject()) {
            return false;
        }
        // return value doesn't matter since we check for exceptions after calling this lambda and
        // before checking the returned bool
        RETURN_IF_EXCEPTION(scope, false);

        int status = entry.getObject()->getDirect(vm, WebCore::clientData(vm)->builtinNames().statePublicName()).asInt32();
        return status > JSModuleLoader::Status::Fetch;
    }();
    RETURN_IF_EXCEPTION(scope, {});

    if (hasAlreadyLoadedESMVersionSoWeShouldntTranspileItTwice) {
        RELEASE_AND_RETURN(scope, jsNumber(-1));
    }
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
    ModuleResult* res,
    JSCommonJSModule* target,
    String specifierWtfString,
    BunLoaderType forceLoaderType,
    JSC::ThrowScope& scope)
{
    Bun__transpileFile(bunVM, globalObject, specifier, referrer, typeAttribute, res, false, !isExtension, forceLoaderType);

    switch (res->tag) {
    case ModuleResult::Tag::err: {
        throwException(globalObject, scope, JSValue::decode(res->value.err.exception));
        RELEASE_AND_RETURN(scope, {});
    }

    case ModuleResult::Tag::transpiled: {
        if (res->value.transpiled.flags.is_commonjs) {
            if constexpr (isExtension) {
                target->evaluateWithPotentiallyOverriddenCompile(globalObject, specifierWtfString, specifierValue, res->value.transpiled);
            } else {
                target->evaluate(globalObject, specifierWtfString, res->value.transpiled);
            }
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, target);
        }

        // ESM - provide fetch and signal to caller
        auto* provider = Bun__createSourceProvider(globalObject, &res->value.transpiled);
        globalObject->moduleLoader()->provideFetch(globalObject, specifierValue, JSC::SourceCode(adoptRef(*provider)));
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, jsNumber(-1));
    }

    case ModuleResult::Tag::special: {
        auto& special = res->value.special;
        switch (special.tag) {
        case SpecialModule::Tag::exports_object:
        case SpecialModule::Tag::export_default_object: {
            JSC::JSValue value = JSC::JSValue::decode(special.jsvalue);
            if (!value) {
                JSC::throwException(globalObject, scope, JSC::createSyntaxError(globalObject, "Failed to parse Object"_s));
                RELEASE_AND_RETURN(scope, {});
            }

            target->putDirect(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), value, 0);
            target->hasEvaluated = true;
            RELEASE_AND_RETURN(scope, target);
        }

        case SpecialModule::Tag::custom_extension: {
            if constexpr (isExtension) {
                ASSERT_NOT_REACHED();
                JSC::throwException(globalObject, scope, JSC::createSyntaxError(globalObject, "Recursive extension. This is a bug in Bun"_s));
                RELEASE_AND_RETURN(scope, {});
            }
            evaluateCommonJSCustomExtension(globalObject, target, specifierWtfString, specifierValue, JSC::JSValue::decode(special.jsvalue));
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, target);
        }
        }
    }

    case ModuleResult::Tag::builtin: {
        // Shouldn't reach here for CommonJS
        ASSERT_NOT_REACHED();
        RELEASE_AND_RETURN(scope, jsNumber(-1));
    }
    }
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
    ModuleResult* res,
    JSCommonJSModule* target,
    String specifierWtfString,
    BunLoaderType forceLoaderType,
    JSC::ThrowScope& scope);
template JSValue fetchCommonJSModuleNonBuiltin<false>(
    void* bunVM,
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    BunString* specifier,
    JSC::JSValue specifierValue,
    BunString* referrer,
    BunString* typeAttribute,
    ModuleResult* res,
    JSCommonJSModule* target,
    String specifierWtfString,
    BunLoaderType forceLoaderType,
    JSC::ThrowScope& scope);

extern "C" bool isBunTest;

template<bool allowPromise>
static JSValue fetchESMSourceCode(
    Zig::GlobalObject* globalObject,
    JSC::JSString* specifierJS,
    ModuleResult* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute)
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

            scope.clearException();
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

    bool wasModuleMock = false;

    // When "bun test" is enabled, allow users to override builtin modules
    // This is important for being able to trivially mock things like the filesystem.
    if (isBunTest) {
        JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, specifier, wasModuleMock);
        RETURN_IF_EXCEPTION(scope, {});
        if (virtualModuleResult) {
            RELEASE_AND_RETURN(scope, handleVirtualModuleResult<allowPromise>(globalObject, virtualModuleResult, res, specifier, referrer, wasModuleMock));
        }
    }

    if (Bun__fetchBuiltinModule(bunVM, globalObject, specifier, referrer, res)) {
        switch (res->tag) {
        case ModuleResult::Tag::err: {
            throwException(globalObject, scope, JSValue::decode(res->value.err.exception));
            auto* exception = scope.exception();
            scope.clearException();
            RELEASE_AND_RETURN(scope, reject(exception));
        }

        case ModuleResult::Tag::transpiled: {
            auto& transpiled = res->value.transpiled;
            // This can happen if it's a `bun build --compile`'d CommonJS file
            if (transpiled.flags.is_commonjs) {
                auto created = Bun::createCommonJSModule(globalObject, specifierJS, transpiled);
                EXCEPTION_ASSERT(created.has_value() == !scope.exception());
                if (created.has_value()) {
                    RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, WTFMove(created.value()))));
                }

                if constexpr (allowPromise) {
                    auto* exception = scope.exception();
                    scope.clearException();
                    RELEASE_AND_RETURN(scope, rejectedInternalPromise(globalObject, exception));
                } else {
                    scope.release();
                    return {};
                }
            }

            // ESM builtin
            auto* provider = Bun__createSourceProvider(globalObject, &transpiled);
            RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, JSC::SourceCode(adoptRef(*provider)))));
        }

        case ModuleResult::Tag::builtin: {
            // InternalModuleRegistry item - generate synthetic source
            auto moduleKey = specifier->toWTFString(BunString::ZeroCopy);
            auto source = JSC::SourceCode(JSC::SyntheticSourceProvider::create(
                generateInternalModuleSourceCode(globalObject, static_cast<InternalModuleRegistry::Field>(res->value.builtin_id)),
                JSC::SourceOrigin(URL(makeString("builtins://"_s, moduleKey))),
                moduleKey));
            RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, WTFMove(source))));
        }

        case ModuleResult::Tag::special: {
            // Special modules shouldn't reach ESM import path
            ASSERT_NOT_REACHED();
            RELEASE_AND_RETURN(scope, reject(createError(globalObject, "Unexpected special module in ESM import"_s)));
        }
        }
    }

    // When "bun test" is NOT enabled, disable users from overriding builtin modules
    if (!isBunTest) {
        JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, specifier, wasModuleMock);
        RETURN_IF_EXCEPTION(scope, {});
        if (virtualModuleResult) {
            RELEASE_AND_RETURN(scope, handleVirtualModuleResult<allowPromise>(globalObject, virtualModuleResult, res, specifier, referrer, wasModuleMock));
        }
    }

    if constexpr (allowPromise) {
        auto* pendingCtx = Bun__transpileFile(bunVM, globalObject, specifier, referrer, typeAttribute, res, true, false, BunLoaderTypeNone);
        if (pendingCtx) {
            return pendingCtx;
        }
    } else {
        Bun__transpileFile(bunVM, globalObject, specifier, referrer, typeAttribute, res, false, false, BunLoaderTypeNone);
    }

    switch (res->tag) {
    case ModuleResult::Tag::err: {
        throwException(globalObject, scope, JSValue::decode(res->value.err.exception));
        auto* exception = scope.exception();
        scope.clearException();
        RELEASE_AND_RETURN(scope, reject(exception));
    }

    case ModuleResult::Tag::transpiled: {
        auto& transpiled = res->value.transpiled;
        if (transpiled.flags.is_commonjs) {
            auto created = Bun::createCommonJSModule(globalObject, specifierJS, transpiled);
            EXCEPTION_ASSERT(created.has_value() == !scope.exception());
            if (created.has_value()) {
                RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, WTFMove(created.value()))));
            }

            if constexpr (allowPromise) {
                auto* exception = scope.exception();
                scope.clearException();
                RELEASE_AND_RETURN(scope, rejectedInternalPromise(globalObject, exception));
            } else {
                scope.release();
                return {};
            }
        }

        // Regular ESM
        auto* provider = Bun__createSourceProvider(globalObject, &transpiled);
        RELEASE_AND_RETURN(scope, rejectOrResolve(JSC::JSSourceCode::create(vm, JSC::SourceCode(adoptRef(*provider)))));
    }

    case ModuleResult::Tag::special: {
        auto& special = res->value.special;
        JSC::JSValue value = JSC::JSValue::decode(special.jsvalue);
        if (!value) {
            RELEASE_AND_RETURN(scope, reject(JSC::createSyntaxError(globalObject, "Failed to parse Object"_s)));
        }

        // Generate synthetic source based on special module type
        JSC::SyntheticSourceProvider::SyntheticSourceGenerator generator;
        switch (special.tag) {
        case SpecialModule::Tag::exports_object: {
            generator = generateJSValueModuleSourceCode(globalObject, value);
            break;
        }
        case SpecialModule::Tag::export_default_object: {
            generator = generateJSValueExportDefaultObjectSourceCode(globalObject, value);
            break;
        }
        case SpecialModule::Tag::custom_extension: {
            // Shouldn't reach here for ESM
            RELEASE_AND_RETURN(scope, reject(createError(globalObject, "Unexpected custom extension in ESM import"_s)));
        }
        }

        auto source = JSC::SourceCode(
            JSC::SyntheticSourceProvider::create(WTFMove(generator),
                JSC::SourceOrigin(), specifier->toWTFString(BunString::ZeroCopy)));
        JSC::ensureStillAliveHere(value);
        RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(globalObject->vm(), WTFMove(source))));
    }

    case ModuleResult::Tag::builtin: {
        // InternalModuleRegistry - generate synthetic source
        auto moduleKey = specifier->toWTFString(BunString::ZeroCopy);
        auto source = JSC::SourceCode(JSC::SyntheticSourceProvider::create(
            generateInternalModuleSourceCode(globalObject, static_cast<InternalModuleRegistry::Field>(res->value.builtin_id)),
            JSC::SourceOrigin(URL(makeString("builtins://"_s, moduleKey))),
            moduleKey));
        RELEASE_AND_RETURN(scope, rejectOrResolve(JSSourceCode::create(vm, WTFMove(source))));
    }
    }
}

JSValue fetchESMSourceCodeSync(
    Zig::GlobalObject* globalObject,
    JSC::JSString* specifierJS,
    ModuleResult* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute)
{
    return fetchESMSourceCode<false>(globalObject, specifierJS, res, specifier, referrer, typeAttribute);
}

JSValue fetchESMSourceCodeAsync(
    Zig::GlobalObject* globalObject,
    JSC::JSString* specifierJS,
    ModuleResult* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute)
{
    return fetchESMSourceCode<true>(globalObject, specifierJS, res, specifier, referrer, typeAttribute);
}
}

using namespace Bun;

BUN_DEFINE_HOST_FUNCTION(jsFunctionOnLoadObjectResultResolve, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    ModuleResult res;
    memset(&res, 0, sizeof res);
    JSC::JSValue objectResult = callFrame->argument(0);
    PendingVirtualModuleResult* pendingModule = JSC::jsCast<PendingVirtualModuleResult*>(callFrame->argument(1));
    JSC::JSValue specifierString = pendingModule->internalField(0).get();
    JSC::JSValue referrerString = pendingModule->internalField(1).get();
    pendingModule->internalField(0).set(vm, pendingModule, JSC::jsUndefined());
    pendingModule->internalField(1).set(vm, pendingModule, JSC::jsUndefined());
    JSC::JSInternalPromise* promise = pendingModule->internalPromise();

    BunString specifier = Bun::toString(globalObject, specifierString);
    BunString referrer = Bun::toString(globalObject, referrerString);
    auto scope = DECLARE_THROW_SCOPE(vm);

    bool wasModuleMock = pendingModule->wasModuleMock;

    JSC::JSValue result = handleVirtualModuleResult<false>(static_cast<Zig::GlobalObject*>(globalObject), objectResult, &res, &specifier, &referrer, wasModuleMock);
    if (!scope.exception() && res.tag == ModuleResult::Tag::err) [[unlikely]] {
        throwException(globalObject, scope, JSValue::decode(res.value.err.exception));
    }
    if (scope.exception()) [[unlikely]] {
        auto retValue = JSValue::encode(promise->rejectWithCaughtException(globalObject, scope));
        pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
        return retValue;
    }
    scope.release();
    promise->resolve(globalObject, result);
    pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
    return JSValue::encode(jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionOnLoadObjectResultReject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue reason = callFrame->argument(0);
    PendingVirtualModuleResult* pendingModule = JSC::jsCast<PendingVirtualModuleResult*>(callFrame->argument(1));
    pendingModule->internalField(0).set(vm, pendingModule, JSC::jsUndefined());
    pendingModule->internalField(1).set(vm, pendingModule, JSC::jsUndefined());
    JSC::JSInternalPromise* promise = pendingModule->internalPromise();

    pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
    promise->reject(globalObject, reason);

    return JSValue::encode(reason);
}
