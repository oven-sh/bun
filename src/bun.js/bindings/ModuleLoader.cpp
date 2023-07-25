#include "root.h"
#include "headers-handwritten.h"

#include "ModuleLoader.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCInlines.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSInternalFieldObjectImpl.h"

#include "ZigSourceProvider.h"

#include "JavaScriptCore/JSSourceCode.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSValueInternal.h"
#include "JavaScriptCore/JSVirtualMachineInternal.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/OptionsList.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/ScriptExecutable.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/StackVisitor.h"

#include "EventEmitter.h"
#include "JSEventEmitter.h"

#include "CommonJSModuleRecord.h"
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>

#include "../modules/_NativeModule.h"
#include "../../js/out/NativeModuleImpl.h"

#include "../modules/ObjectModule.h"

namespace Bun {
using namespace Zig;
using namespace WebCore;

extern "C" BunLoaderType Bun__getDefaultLoader(JSC::JSGlobalObject*, BunString* specifier);

static JSC::JSInternalPromise* rejectedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    JSC::VM& vm = globalObject->vm();
    JSInternalPromise* promise = JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
    auto scope = DECLARE_THROW_SCOPE(vm);
    scope.throwException(globalObject, value);
    return promise->rejectWithCaughtException(globalObject, scope);
}

static JSC::JSInternalPromise* resolvedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    JSC::VM& vm = globalObject->vm();
    JSInternalPromise* promise = JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(vm, promise, value);
    promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32AsAnyInt() | JSC::JSPromise::isFirstResolvingFunctionCalledFlag | static_cast<unsigned>(JSC::JSPromise::Status::Fulfilled)));
    return promise;
}

using namespace JSC;

static OnLoadResult handleOnLoadObjectResult(Zig::GlobalObject* globalObject, JSC::JSObject* object)
{
    OnLoadResult result {};
    result.type = OnLoadResultTypeObject;
    JSC::VM& vm = globalObject->vm();
    if (JSC::JSValue exportsValue = object->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "exports"_s))) {
        if (exportsValue.isObject()) {
            result.value.object = exportsValue;
            return result;
        }
    }

    auto scope = DECLARE_THROW_SCOPE(vm);
    scope.throwException(globalObject, createTypeError(globalObject, "\"object\" loader must return an \"exports\" object"_s));
    result.type = OnLoadResultTypeError;
    result.value.error = scope.exception();
    scope.clearException();
    scope.release();
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
    return Structure::create(vm, globalObject, prototype, TypeInfo(CellType, StructureFlags), info());
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

PendingVirtualModuleResult* PendingVirtualModuleResult::create(JSC::JSGlobalObject* globalObject, const WTF::String& specifier, const WTF::String& referrer)
{
    auto* virtualModule = create(globalObject->vm(), reinterpret_cast<Zig::GlobalObject*>(globalObject)->pendingVirtualModuleResultStructure());
    virtualModule->finishCreation(globalObject->vm(), specifier, referrer);
    return virtualModule;
}

OnLoadResult handleOnLoadResultNotPromise(Zig::GlobalObject* globalObject, JSC::JSValue objectValue, BunString* specifier)
{
    OnLoadResult result = {};
    result.type = OnLoadResultTypeError;
    JSC::VM& vm = globalObject->vm();
    result.value.error = JSC::jsUndefined();
    auto scope = DECLARE_THROW_SCOPE(vm);
    BunLoaderType loader = Bun__getDefaultLoader(globalObject, specifier);

    if (JSC::Exception* exception = JSC::jsDynamicCast<JSC::Exception*>(objectValue)) {
        result.value.error = exception->value();
        scope.release();
        return result;
    }

    JSC::JSObject* object = objectValue.getObject();
    if (UNLIKELY(!object)) {
        scope.throwException(globalObject, JSC::createError(globalObject, "Expected onLoad callback to return an object"_s));
        result.value.error = scope.exception();
        result.type = OnLoadResultTypeError;
        return result;
    }

    if (JSC::JSValue loaderValue = object->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "loader"_s))) {
        if (!loaderValue.isUndefinedOrNull()) {
            // If a loader is passed, we must validate it
            loader = BunLoaderTypeNone;

            if (JSC::JSString* loaderJSString = loaderValue.toStringOrNull(globalObject)) {
                WTF::String loaderString = loaderJSString->value(globalObject);
                if (loaderString == "js"_s) {
                    loader = BunLoaderTypeJS;
                } else if (loaderString == "object"_s) {
                    return handleOnLoadObjectResult(globalObject, object);
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
                }
            }
        }
    }

    if (UNLIKELY(loader == BunLoaderTypeNone)) {
        throwException(globalObject, scope, createError(globalObject, "Expected loader to be one of \"js\", \"jsx\", \"object\", \"ts\", \"tsx\", \"toml\", or \"json\""_s));
        result.value.error = scope.exception();
        return result;
    }

    result.value.sourceText.loader = loader;
    result.value.sourceText.value = JSValue {};
    result.value.sourceText.string = {};

    if (JSC::JSValue contentsValue = object->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "contents"_s))) {
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

    if (UNLIKELY(result.value.sourceText.value.isEmpty())) {
        throwException(globalObject, scope, createError(globalObject, "Expected \"contents\" to be a string or an ArrayBufferView"_s));
        result.value.error = scope.exception();
        return result;
    }

    result.type = OnLoadResultTypeCode;
    return result;
}

static OnLoadResult handleOnLoadResult(Zig::GlobalObject* globalObject, JSC::JSValue objectValue, BunString* specifier)
{
    if (JSC::JSPromise* promise = JSC::jsDynamicCast<JSC::JSPromise*>(objectValue)) {
        OnLoadResult result = {};
        result.type = OnLoadResultTypePromise;
        result.value.promise = objectValue;
        return result;
    }

    return handleOnLoadResultNotPromise(globalObject, objectValue, specifier);
}

template<bool allowPromise>
static JSValue handleVirtualModuleResult(
    Zig::GlobalObject* globalObject,
    JSValue virtualModuleResult,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer)
{
    auto onLoadResult = handleOnLoadResult(globalObject, virtualModuleResult, specifier);
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto reject = [&](JSC::JSValue exception) -> JSValue {
        if constexpr (allowPromise) {
            return rejectedInternalPromise(globalObject, exception);
        } else {
            throwException(globalObject, scope, exception);
            return exception;
        }
    };

    auto resolve = [&](JSValue code) -> JSValue {
        res->success = true;
        if constexpr (allowPromise) {
            scope.release();
            return resolvedInternalPromise(globalObject, code);
        } else {
            return code;
        }
    };

    auto rejectOrResolve = [&](JSValue code) -> JSValue {
        if (auto* exception = scope.exception()) {
            if constexpr (allowPromise) {
                scope.clearException();
                return rejectedInternalPromise(globalObject, exception);
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
        Bun__transpileVirtualModule(globalObject, specifier, referrer, &onLoadResult.value.sourceText.string, onLoadResult.value.sourceText.loader, res);
        if (!res->success) {
            return reject(JSValue::decode(reinterpret_cast<EncodedJSValue>(res->result.err.ptr)));
        }

        auto provider = Zig::SourceProvider::create(globalObject, res->result.value);
        return resolve(JSC::JSSourceCode::create(vm, JSC::SourceCode(provider)));
    }
    case OnLoadResultTypeError: {
        return reject(onLoadResult.value.error);
    }

    case OnLoadResultTypeObject: {
        JSC::JSObject* object = onLoadResult.value.object.getObject();
        JSC::ensureStillAliveHere(object);
        auto function = generateObjectModuleSourceCode(
            globalObject,
            object);
        auto source = JSC::SourceCode(
            JSC::SyntheticSourceProvider::create(WTFMove(function),
                JSC::SourceOrigin(), Bun::toWTFString(*specifier)));
        JSC::ensureStillAliveHere(object);
        return rejectOrResolve(JSSourceCode::create(globalObject->vm(), WTFMove(source)));
    }

    case OnLoadResultTypePromise: {
        JSC::JSPromise* promise = jsCast<JSC::JSPromise*>(onLoadResult.value.promise);
        JSFunction* performPromiseThenFunction = globalObject->performPromiseThenFunction();
        auto callData = JSC::getCallData(performPromiseThenFunction);
        ASSERT(callData.type != CallData::Type::None);
        auto specifierString = Bun::toWTFString(*specifier);
        auto referrerString = Bun::toWTFString(*referrer);
        PendingVirtualModuleResult* pendingModule = PendingVirtualModuleResult::create(globalObject, specifierString, referrerString);
        JSC::JSInternalPromise* internalPromise = pendingModule->internalPromise();
        MarkedArgumentBuffer arguments;
        arguments.append(promise);
        arguments.append(globalObject->thenable(jsFunctionOnLoadObjectResultResolve));
        arguments.append(globalObject->thenable(jsFunctionOnLoadObjectResultReject));
        arguments.append(jsUndefined());
        arguments.append(pendingModule);
        ASSERT(!arguments.hasOverflowed());
        JSC::call(globalObject, performPromiseThenFunction, callData, jsUndefined(), arguments);
        return internalPromise;
    }
    default: {
        __builtin_unreachable();
    }
    }
}

extern "C" void Bun__onFulfillAsyncModule(
    EncodedJSValue promiseValue,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer)
{
    JSC::JSValue value = JSValue::decode(promiseValue);
    JSC::JSInternalPromise* promise = jsCast<JSC::JSInternalPromise*>(value);
    auto* globalObject = promise->globalObject();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!res->success) {
        throwException(scope, res->result.err, globalObject);
        auto* exception = scope.exception();
        scope.clearException();
        return promise->reject(promise->globalObject(), exception);
    }

    if (res->result.value.commonJSExportsLen) {
        auto created = Bun::createCommonJSModule(jsCast<Zig::GlobalObject*>(globalObject), res->result.value);

        if (created.has_value()) {
            return promise->resolve(promise->globalObject(), JSSourceCode::create(vm, WTFMove(created.value())));
        } else {
            auto* exception = scope.exception();
            scope.clearException();
            return promise->reject(promise->globalObject(), exception);
        }
    }

    auto provider = Zig::SourceProvider::create(jsDynamicCast<Zig::GlobalObject*>(globalObject), res->result.value);
    promise->resolve(promise->globalObject(), JSC::JSSourceCode::create(vm, JSC::SourceCode(provider)));
}

JSValue fetchCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSCommonJSModule* target,
    JSValue specifierValue,
    BunString* specifier,
    BunString* referrer)
{
    void* bunVM = globalObject->bunVM();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ErrorableResolvedSource resValue;
    ErrorableResolvedSource* res = &resValue;

    auto& builtinNames = WebCore::clientData(vm)->builtinNames();

    if (Bun__fetchBuiltinModule(bunVM, globalObject, specifier, referrer, res)) {
        if (!res->success) {
            throwException(scope, res->result.err, globalObject);
            return JSValue();
        }

        auto tag = res->result.value.tag;
        switch (tag) {
            // Generated native module cases
            // #define CASE(str, name, id)                                                                        \
//     case SyntheticModuleType::name: {                                                              \
//         target->evaluate(globalObject, Bun::toWTFString(*specifier), generateNativeModule_##name); \
//         RETURN_IF_EXCEPTION(scope, {});                                                            \
//         RELEASE_AND_RETURN(scope, target);                                                         \
//     }
            //             BUN_FOREACH_NATIVE_MODULE(CASE)
            // #undef CASE

        case SyntheticModuleType::ESM: {
            RELEASE_AND_RETURN(scope, jsNumber(-1));
        }

        default: {
            if (tag & SyntheticModuleType::InternalModuleRegistryFlag) {
                constexpr auto mask = (SyntheticModuleType::InternalModuleRegistryFlag - 1);
                target->putDirect(
                    vm,
                    builtinNames.exportsPublicName(),
                    globalObject->internalModuleRegistry.get(globalObject, tag & mask),
                    JSC::PropertyAttribute::ReadOnly | 0);
                RETURN_IF_EXCEPTION(scope, {});
                RELEASE_AND_RETURN(scope, target);
            }
        }
        }
    }

    if (JSC::JSValue virtualModuleResult = JSValue::decode(Bun__runVirtualModule(globalObject, specifier))) {
        JSPromise* promise = jsCast<JSPromise*>(handleVirtualModuleResult<true>(globalObject, virtualModuleResult, res, specifier, referrer));
        switch (promise->status(vm)) {
        case JSPromise::Status::Rejected: {
            uint32_t promiseFlags = promise->internalField(JSPromise::Field::Flags).get().asUInt32AsAnyInt();
            promise->internalField(JSPromise::Field::Flags).set(vm, promise, jsNumber(promiseFlags | JSPromise::isHandledFlag));
            JSC::throwException(globalObject, scope, promise->result(vm));
            RELEASE_AND_RETURN(scope, JSValue {});
        }
        case JSPromise::Status::Pending: {
            JSC::throwTypeError(globalObject, scope, makeString("require() async module \""_s, Bun::toWTFString(*specifier), "\" is unsupported. use \"await import()\" instead."_s));
            RELEASE_AND_RETURN(scope, JSValue {});
        }
        case JSPromise::Status::Fulfilled: {
            if (!res->success) {
                throwException(scope, res->result.err, globalObject);
                RELEASE_AND_RETURN(scope, {});
            }
            auto* jsSourceCode = jsCast<JSSourceCode*>(promise->result(vm));
            globalObject->moduleLoader()->provideFetch(globalObject, specifierValue, jsSourceCode->sourceCode());
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, jsNumber(-1));
        }
        }
    }

    auto* loader = globalObject->moduleLoader();
    JSMap* registry = jsCast<JSMap*>(loader->getDirect(vm, Identifier::fromString(vm, "registry"_s)));

    auto hasAlreadyLoadedESMVersionSoWeShouldntTranspileItTwice = [&]() -> bool {
        JSValue entry = registry->get(globalObject, specifierValue);

        if (!entry || !entry.isObject()) {
            return false;
        }

        int status = entry.getObject()->getDirect(vm, WebCore::clientData(vm)->builtinNames().statePublicName()).asInt32();
        return status > JSModuleLoader::Status::Fetch;
    };

    if (hasAlreadyLoadedESMVersionSoWeShouldntTranspileItTwice()) {
        RELEASE_AND_RETURN(scope, jsNumber(-1));
    }

    Bun__transpileFile(bunVM, globalObject, specifier, referrer, res, false);

    if (res->success && res->result.value.commonJSExportsLen) {
        target->evaluate(globalObject, Bun::toWTFString(*specifier).isolatedCopy(), res->result.value);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, target);
    }

    if (!res->success) {
        throwException(scope, res->result.err, globalObject);
        RELEASE_AND_RETURN(scope, {});
    }

    auto&& provider = Zig::SourceProvider::create(globalObject, res->result.value);
    globalObject->moduleLoader()->provideFetch(globalObject, specifierValue, JSC::SourceCode(provider));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, jsNumber(-1));
}

template<bool allowPromise>
static JSValue fetchESMSourceCode(
    Zig::GlobalObject* globalObject,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer)
{
    void* bunVM = globalObject->bunVM();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto reject = [&](JSC::JSValue exception) -> JSValue {
        if constexpr (allowPromise) {
            return rejectedInternalPromise(globalObject, exception);
        } else {
            throwException(globalObject, scope, exception);
            return JSC::jsUndefined();
        }
    };

    auto resolve = [&](JSValue code) -> JSValue {
        if constexpr (allowPromise) {
            auto* ret = resolvedInternalPromise(globalObject, code);
            scope.release();
            return ret;
        } else {
            return code;
        }
    };

    auto rejectOrResolve = [&](JSValue code) -> JSValue {
        if (auto* exception = scope.exception()) {
            if constexpr (!allowPromise) {
                scope.release();
                return {};
            }

            scope.clearException();
            return rejectedInternalPromise(globalObject, exception);
        }

        if constexpr (allowPromise) {
            auto* ret = resolvedInternalPromise(globalObject, code);
            scope.release();
            return ret;
        } else {
            return code;
        }
    };

    if (Bun__fetchBuiltinModule(bunVM, globalObject, specifier, referrer, res)) {
        if (!res->success) {
            throwException(scope, res->result.err, globalObject);
            auto* exception = scope.exception();
            scope.clearException();
            return reject(exception);
        }

        auto moduleKey = Bun::toWTFString(*specifier);

        auto tag = res->result.value.tag;
        switch (tag) {
        case SyntheticModuleType::ESM: {
            auto&& provider = Zig::SourceProvider::create(globalObject, res->result.value, JSC::SourceProviderSourceType::Module, true);
            return rejectOrResolve(JSSourceCode::create(vm, JSC::SourceCode(provider)));
        }

            // #define CASE(str, name, id)                                                                                                                        \
//     case SyntheticModuleType::name: {                                                                                                              \
//         auto source = JSC::SourceCode(JSC::SyntheticSourceProvider::create(generateNativeModule_##name, JSC::SourceOrigin(), WTFMove(moduleKey))); \
//         return rejectOrResolve(JSSourceCode::create(vm, WTFMove(source)));                                                                         \
//     }
            //             BUN_FOREACH_NATIVE_MODULE(CASE)
            // #undef CASE

        // CommonJS modules from src/js/*
        default: {
            if (tag & SyntheticModuleType::InternalModuleRegistryFlag) {
                auto created = Bun::createCommonJSModule(globalObject, res->result.value, true);

                if (created.has_value()) {
                    return rejectOrResolve(JSSourceCode::create(vm, WTFMove(created.value())));
                }

                if constexpr (allowPromise) {
                    auto* exception = scope.exception();
                    scope.clearException();
                    return rejectedInternalPromise(globalObject, exception);
                } else {
                    return JSC::jsUndefined();
                }
            }
        }
        }
    }

    if (JSC::JSValue virtualModuleResult = JSValue::decode(Bun__runVirtualModule(globalObject, specifier))) {
        return handleVirtualModuleResult<allowPromise>(globalObject, virtualModuleResult, res, specifier, referrer);
    }

    if constexpr (allowPromise) {
        void* pendingCtx = Bun__transpileFile(bunVM, globalObject, specifier, referrer, res, true);
        if (pendingCtx) {
            return reinterpret_cast<JSC::JSInternalPromise*>(pendingCtx);
        }
    } else {
        Bun__transpileFile(bunVM, globalObject, specifier, referrer, res, false);
    }

    if (res->success && res->result.value.commonJSExportsLen) {
        auto created = Bun::createCommonJSModule(globalObject, res->result.value);

        if (created.has_value()) {
            return rejectOrResolve(JSSourceCode::create(vm, WTFMove(created.value())));
        }

        if constexpr (allowPromise) {
            auto* exception = scope.exception();
            scope.clearException();
            return rejectedInternalPromise(globalObject, exception);
        } else {
            return JSC::jsUndefined();
        }
    }

    if (!res->success) {
        throwException(scope, res->result.err, globalObject);
        auto* exception = scope.exception();
        scope.clearException();
        return reject(exception);
    }

    auto&& provider = Zig::SourceProvider::create(globalObject, res->result.value);
    return rejectOrResolve(JSC::JSSourceCode::create(vm, JSC::SourceCode(provider)));
}

extern "C" JSC::EncodedJSValue jsFunctionOnLoadObjectResultResolve(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    ErrorableResolvedSource res = {};
    res.success = false;
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
    JSC::JSValue result = handleVirtualModuleResult<false>(reinterpret_cast<Zig::GlobalObject*>(globalObject), objectResult, &res, &specifier, &referrer);
    if (res.success) {
        if (scope.exception()) {
            auto retValue = JSValue::encode(promise->rejectWithCaughtException(globalObject, scope));
            pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
            return retValue;
        }
        scope.release();
        promise->resolve(globalObject, result);
        pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
    } else {
        throwException(globalObject, scope, result);
        auto retValue = JSValue::encode(promise->rejectWithCaughtException(globalObject, scope));
        pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
        return retValue;
    }
    return JSValue::encode(jsUndefined());
}

extern "C" JSC::EncodedJSValue jsFunctionOnLoadObjectResultReject(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    ErrorableResolvedSource res = {};
    JSC::JSValue reason = callFrame->argument(0);
    PendingVirtualModuleResult* pendingModule = JSC::jsCast<PendingVirtualModuleResult*>(callFrame->argument(1));
    JSC::JSValue specifierString = pendingModule->internalField(0).get();
    JSC::JSValue referrerString = pendingModule->internalField(1).get();
    pendingModule->internalField(0).set(vm, pendingModule, JSC::jsUndefined());
    pendingModule->internalField(1).set(vm, pendingModule, JSC::jsUndefined());
    JSC::JSInternalPromise* promise = pendingModule->internalPromise();

    ZigString specifier = Zig::toZigString(specifierString, globalObject);
    ZigString referrer = Zig::toZigString(referrerString, globalObject);
    pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
    promise->reject(globalObject, reason);

    return JSValue::encode(reason);
}

JSValue fetchESMSourceCodeSync(
    Zig::GlobalObject* globalObject,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer)
{
    return fetchESMSourceCode<false>(globalObject, res, specifier, referrer);
}

JSValue fetchESMSourceCodeAsync(
    Zig::GlobalObject* globalObject,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer)
{
    return fetchESMSourceCode<true>(globalObject, res, specifier, referrer);
}
}
namespace JSC {

template<unsigned passedNumberOfInternalFields>
template<typename Visitor>
void JSInternalFieldObjectImpl<passedNumberOfInternalFields>::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSInternalFieldObjectImpl*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendValues(thisObject->m_internalFields, numberOfInternalFields);
}

DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<unsigned passedNumberOfInternalFields>, JSInternalFieldObjectImpl<passedNumberOfInternalFields>);

} // namespace JSC
