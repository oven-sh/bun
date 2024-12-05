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

#include "EventEmitter.h"
#include "JSEventEmitter.h"

#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>

#include "../modules/_NativeModule.h"
#include "NativeModuleImpl.h"

#include "../modules/ObjectModule.h"
#include "wtf/Assertions.h"

namespace Bun {
using namespace JSC;
using namespace Zig;
using namespace WebCore;

class ResolvedSourceCodeHolder {
public:
    ResolvedSourceCodeHolder(ErrorableResolvedSource* res_)
        : res(res_)
    {
    }

    ~ResolvedSourceCodeHolder()
    {
        if (res->success && res->result.value.source_code.tag == BunStringTag::WTFStringImpl && res->result.value.needsDeref) {
            res->result.value.needsDeref = false;
            res->result.value.source_code.impl.wtf->deref();
        }
    }

    ErrorableResolvedSource* res;
};

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

// Converts an object from InternalModuleRegistry into { ...obj, default: obj }
static JSC::SyntheticSourceProvider::SyntheticSourceGenerator generateInternalModuleSourceCode(JSC::JSGlobalObject* globalObject, InternalModuleRegistry::Field moduleId)
{
    return [moduleId](JSC::JSGlobalObject* lexicalGlobalObject,
               JSC::Identifier moduleKey,
               Vector<JSC::Identifier, 4>& exportNames,
               JSC::MarkedArgumentBuffer& exportValues) -> void {
        JSC::VM& vm = lexicalGlobalObject->vm();
        GlobalObject* globalObject = jsCast<GlobalObject*>(lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        JSValue requireResult = globalObject->internalModuleRegistry()->requireId(globalObject, vm, moduleId);
        RETURN_IF_EXCEPTION(throwScope, void());
        auto* object = requireResult.getObject();
        ASSERT_WITH_MESSAGE(object, "Expected object from requireId %s", moduleKey.string().string().utf8().data());

        JSC::EnsureStillAliveScope stillAlive(object);

        PropertyNameArray properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        object->getPropertyNames(globalObject, properties, DontEnumPropertiesMode::Exclude);

        RETURN_IF_EXCEPTION(throwScope, void());

        auto len = properties.size() + 1;
        exportNames.reserveCapacity(len);
        exportValues.ensureCapacity(len);

        bool hasDefault = false;

        for (auto& entry : properties) {
            if (UNLIKELY(entry == vm.propertyNames->defaultKeyword)) {
                hasDefault = true;
            }
            exportNames.append(entry);
            exportValues.append(object->get(globalObject, entry));
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
    JSC::VM& vm = globalObject->vm();
    auto& builtinNames = WebCore::builtinNames(vm);
    if (JSC::JSValue exportsValue = object->getIfPropertyExists(globalObject, builtinNames.exportsPublicName())) {
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
    auto* virtualModule = create(globalObject->vm(), reinterpret_cast<Zig::GlobalObject*>(globalObject)->pendingVirtualModuleResultStructure());
    virtualModule->finishCreation(globalObject->vm(), specifier, referrer);
    virtualModule->wasModuleMock = wasModuleLock;
    return virtualModule;
}

OnLoadResult handleOnLoadResultNotPromise(Zig::GlobalObject* globalObject, JSC::JSValue objectValue, BunString* specifier, bool wasModuleMock)
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

    if (wasModuleMock) {
        result.type = OnLoadResultTypeObject;
        result.value.object = objectValue;
        return result;
    }

    JSC::JSObject* object = objectValue.getObject();
    if (UNLIKELY(!object)) {
        scope.throwException(globalObject, JSC::createError(globalObject, "Expected module mock to return an object"_s));

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

static OnLoadResult handleOnLoadResult(Zig::GlobalObject* globalObject, JSC::JSValue objectValue, BunString* specifier, bool wasModuleMock = false)
{
    if (JSC::JSPromise* promise = JSC::jsDynamicCast<JSC::JSPromise*>(objectValue)) {
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
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    bool wasModuleMock = false)
{
    auto onLoadResult = handleOnLoadResult(globalObject, virtualModuleResult, specifier, wasModuleMock);
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ResolvedSourceCodeHolder sourceCodeHolder(res);

    const auto reject = [&](JSC::JSValue exception) -> JSValue {
        if constexpr (allowPromise) {
            return rejectedInternalPromise(globalObject, exception);
        } else {
            throwException(globalObject, scope, exception);
            return exception;
        }
    };

    const auto resolve = [&](JSValue code) -> JSValue {
        res->success = true;
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
                JSC::SourceOrigin(), specifier->toWTFString(BunString::ZeroCopy)));
        JSC::ensureStillAliveHere(object);
        return rejectOrResolve(JSSourceCode::create(globalObject->vm(), WTFMove(source)));
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
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer)
{
    ResolvedSourceCodeHolder sourceCodeHolder(res);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSInternalPromise* promise = jsCast<JSC::JSInternalPromise*>(JSC::JSValue::decode(encodedPromiseValue));

    if (!res->success) {
        throwException(scope, res->result.err, globalObject);
        auto* exception = scope.exception();
        scope.clearException();
        return promise->reject(globalObject, exception);
    }

    auto specifierValue = Bun::toJS(globalObject, *specifier);

    if (auto entry = globalObject->esmRegistryMap()->get(globalObject, specifierValue)) {
        if (entry.isObject()) {

            auto* object = entry.getObject();
            if (auto state = object->getIfPropertyExists(globalObject, Bun::builtinNames(vm).statePublicName())) {
                if (state.toInt32(globalObject) > JSC::JSModuleLoader::Status::Fetch) {
                    // it's a race! we lost.
                    // https://github.com/oven-sh/bun/issues/6946
                    // https://github.com/oven-sh/bun/issues/12910
                    return;
                }
            }
        }

        if (res->result.value.isCommonJSModule) {
            auto created = Bun::createCommonJSModule(jsCast<Zig::GlobalObject*>(globalObject), specifierValue, res->result.value);
            if (created.has_value()) {
                JSSourceCode* code = JSSourceCode::create(vm, WTFMove(created.value()));
                promise->resolve(globalObject, code);
            } else {
                auto* exception = scope.exception();
                scope.clearException();
                promise->reject(globalObject, exception);
            }
        } else {
            auto&& provider = Zig::SourceProvider::create(jsDynamicCast<Zig::GlobalObject*>(globalObject), res->result.value);
            promise->resolve(globalObject, JSC::JSSourceCode::create(vm, JSC::SourceCode(provider)));
        }
    } else {
        // the module has since been deleted from the registry.
        // let's not keep it forever for no reason.
    }
}

JSValue fetchCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSCommonJSModule* target,
    JSValue specifierValue,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute)
{
    void* bunVM = globalObject->bunVM();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ErrorableResolvedSource resValue;
    memset(&resValue, 0, sizeof(ErrorableResolvedSource));

    ErrorableResolvedSource* res = &resValue;
    ResolvedSourceCodeHolder sourceCodeHolder(res);
    auto& builtinNames = WebCore::clientData(vm)->builtinNames();

    bool wasModuleMock = false;

    // When "bun test" is enabled, allow users to override builtin modules
    // This is important for being able to trivially mock things like the filesystem.
    if (isBunTest) {
        if (JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, specifier, wasModuleMock)) {
            JSPromise* promise = jsCast<JSPromise*>(handleVirtualModuleResult<true>(globalObject, virtualModuleResult, res, specifier, referrer, wasModuleMock));
            switch (promise->status(vm)) {
            case JSPromise::Status::Rejected: {
                uint32_t promiseFlags = promise->internalField(JSPromise::Field::Flags).get().asUInt32AsAnyInt();
                promise->internalField(JSPromise::Field::Flags).set(vm, promise, jsNumber(promiseFlags | JSPromise::isHandledFlag));
                JSC::throwException(globalObject, scope, promise->result(vm));
                RELEASE_AND_RETURN(scope, JSValue {});
            }
            case JSPromise::Status::Pending: {
                JSC::throwTypeError(globalObject, scope, makeString("require() async module \""_s, specifier->toWTFString(BunString::ZeroCopy), "\" is unsupported. use \"await import()\" instead."_s));
                RELEASE_AND_RETURN(scope, JSValue {});
            }
            case JSPromise::Status::Fulfilled: {
                if (!res->success) {
                    throwException(scope, res->result.err, globalObject);
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

    if (Bun__fetchBuiltinModule(bunVM, globalObject, specifier, referrer, res)) {
        if (!res->success) {
            throwException(scope, res->result.err, globalObject);
            return JSValue();
        }

        auto tag = res->result.value.tag;
        switch (tag) {
        case SyntheticModuleType::NodeModule: {
            target->setExportsObject(globalObject->m_nodeModuleConstructor.getInitializedOnMainThread(globalObject));
            target->hasEvaluated = true;
            RELEASE_AND_RETURN(scope, target);
        }
        case SyntheticModuleType::NodeProcess: {
            target->setExportsObject(globalObject->processObject());
            target->hasEvaluated = true;
            RELEASE_AND_RETURN(scope, target);
        }
// Generated native module cases
#define CASE(str, name)                                                                                           \
    case SyntheticModuleType::name: {                                                                             \
        target->evaluate(globalObject, specifier->toWTFString(BunString::ZeroCopy), generateNativeModule_##name); \
        RETURN_IF_EXCEPTION(scope, {});                                                                           \
        RELEASE_AND_RETURN(scope, target);                                                                        \
    }
            BUN_FOREACH_CJS_NATIVE_MODULE(CASE)
#undef CASE

        case SyntheticModuleType::ESM: {
            RELEASE_AND_RETURN(scope, jsNumber(-1));
        }

        default: {
            if (tag & SyntheticModuleType::InternalModuleRegistryFlag) {
                constexpr auto mask = (SyntheticModuleType::InternalModuleRegistryFlag - 1);
                auto result = globalObject->internalModuleRegistry()->requireId(globalObject, vm, static_cast<InternalModuleRegistry::Field>(tag & mask));
                RETURN_IF_EXCEPTION(scope, {});

                target->putDirect(
                    vm,
                    builtinNames.exportsPublicName(),
                    result,
                    JSC::PropertyAttribute::ReadOnly | 0);
                RELEASE_AND_RETURN(scope, target);
            } else {
                RELEASE_AND_RETURN(scope, jsNumber(-1));
            }
        }
        }
    }

    // When "bun test" is NOT enabled, disable users from overriding builtin modules
    if (!isBunTest) {
        if (JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, specifier, wasModuleMock)) {
            JSPromise* promise = jsCast<JSPromise*>(handleVirtualModuleResult<true>(globalObject, virtualModuleResult, res, specifier, referrer, wasModuleMock));
            switch (promise->status(vm)) {
            case JSPromise::Status::Rejected: {
                uint32_t promiseFlags = promise->internalField(JSPromise::Field::Flags).get().asUInt32AsAnyInt();
                promise->internalField(JSPromise::Field::Flags).set(vm, promise, jsNumber(promiseFlags | JSPromise::isHandledFlag));
                JSC::throwException(globalObject, scope, promise->result(vm));
                RELEASE_AND_RETURN(scope, JSValue {});
            }
            case JSPromise::Status::Pending: {
                JSC::throwTypeError(globalObject, scope, makeString("require() async module \""_s, specifier->toWTFString(BunString::ZeroCopy), "\" is unsupported. use \"await import()\" instead."_s));
                RELEASE_AND_RETURN(scope, JSValue {});
            }
            case JSPromise::Status::Fulfilled: {
                if (!res->success) {
                    throwException(scope, res->result.err, globalObject);
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

    const auto hasAlreadyLoadedESMVersionSoWeShouldntTranspileItTwice = [&]() -> bool {
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

    Bun__transpileFile(bunVM, globalObject, specifier, referrer, typeAttribute, res, false);
    if (res->success && res->result.value.isCommonJSModule) {
        target->evaluate(globalObject, specifier->toWTFString(BunString::ZeroCopy), res->result.value);
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
        JSC::JSValue value = JSC::JSONParse(globalObject, res->result.value.source_code.toWTFString(BunString::ZeroCopy));
        if (!value) {
            JSC::throwException(globalObject, scope, JSC::createSyntaxError(globalObject, "Failed to parse JSON"_s));
            RELEASE_AND_RETURN(scope, {});
        }

        target->putDirect(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), value, 0);
        target->hasEvaluated = true;
        RELEASE_AND_RETURN(scope, target);

    }
    // TOML and JSONC may go through here
    else if (res->result.value.tag == SyntheticModuleType::ExportsObject) {
        JSC::JSValue value = JSC::JSValue::decode(res->result.value.jsvalue_for_export);
        if (!value) {
            JSC::throwException(globalObject, scope, JSC::createSyntaxError(globalObject, "Failed to parse Object"_s));
            RELEASE_AND_RETURN(scope, {});
        }

        target->putDirect(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), value, 0);
        target->hasEvaluated = true;
        RELEASE_AND_RETURN(scope, target);
    }

    auto&& provider = Zig::SourceProvider::create(globalObject, res->result.value);
    globalObject->moduleLoader()->provideFetch(globalObject, specifierValue, JSC::SourceCode(provider));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, jsNumber(-1));
}

extern "C" bool isBunTest;

template<bool allowPromise>
static JSValue fetchESMSourceCode(
    Zig::GlobalObject* globalObject,
    JSC::JSValue specifierJS,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute)
{
    void* bunVM = globalObject->bunVM();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ResolvedSourceCodeHolder sourceCodeHolder(res);

    const auto reject = [&](JSC::JSValue exception) -> JSValue {
        if constexpr (allowPromise) {
            return rejectedInternalPromise(globalObject, exception);
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

    bool wasModuleMock = false;

    // When "bun test" is enabled, allow users to override builtin modules
    // This is important for being able to trivially mock things like the filesystem.
    if (isBunTest) {
        if (JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, specifier, wasModuleMock)) {
            return handleVirtualModuleResult<allowPromise>(globalObject, virtualModuleResult, res, specifier, referrer, wasModuleMock);
        }
    }

    if (Bun__fetchBuiltinModule(bunVM, globalObject, specifier, referrer, res)) {
        if (!res->success) {
            throwException(scope, res->result.err, globalObject);
            auto* exception = scope.exception();
            scope.clearException();
            return reject(exception);
        }

        // This can happen if it's a `bun build --compile`'d CommonJS file
        if (res->result.value.isCommonJSModule) {
            auto created = Bun::createCommonJSModule(globalObject, specifierJS, res->result.value);

            if (created.has_value()) {
                return rejectOrResolve(JSSourceCode::create(vm, WTFMove(created.value())));
            }

            if constexpr (allowPromise) {
                auto* exception = scope.exception();
                scope.clearException();
                return rejectedInternalPromise(globalObject, exception);
            } else {
                return {};
            }
        }

        auto moduleKey = specifier->toWTFString(BunString::ZeroCopy);

        auto tag = res->result.value.tag;
        switch (tag) {
        case SyntheticModuleType::ESM: {
            auto&& provider = Zig::SourceProvider::create(globalObject, res->result.value, JSC::SourceProviderSourceType::Module, true);
            return rejectOrResolve(JSSourceCode::create(vm, JSC::SourceCode(provider)));
        }

#define CASE(str, name)                                                                                                                            \
    case (SyntheticModuleType::name): {                                                                                                            \
        auto source = JSC::SourceCode(JSC::SyntheticSourceProvider::create(generateNativeModule_##name, JSC::SourceOrigin(), WTFMove(moduleKey))); \
        return rejectOrResolve(JSSourceCode::create(vm, WTFMove(source)));                                                                         \
    }
            BUN_FOREACH_ESM_NATIVE_MODULE(CASE)
#undef CASE

        // CommonJS modules from src/js/*
        default: {
            if (tag & SyntheticModuleType::InternalModuleRegistryFlag) {
                constexpr auto mask = (SyntheticModuleType::InternalModuleRegistryFlag - 1);
                auto source = JSC::SourceCode(JSC::SyntheticSourceProvider::create(generateInternalModuleSourceCode(globalObject, static_cast<InternalModuleRegistry::Field>(tag & mask)), JSC::SourceOrigin(URL(makeString("builtins://"_s, moduleKey))), moduleKey));
                return rejectOrResolve(JSSourceCode::create(vm, WTFMove(source)));
            } else {
                auto&& provider = Zig::SourceProvider::create(globalObject, res->result.value, JSC::SourceProviderSourceType::Module, true);
                return rejectOrResolve(JSC::JSSourceCode::create(vm, JSC::SourceCode(provider)));
            }
        }
        }
    }

    // When "bun test" is NOT enabled, disable users from overriding builtin modules
    if (!isBunTest) {
        if (JSC::JSValue virtualModuleResult = Bun::runVirtualModule(globalObject, specifier, wasModuleMock)) {
            return handleVirtualModuleResult<allowPromise>(globalObject, virtualModuleResult, res, specifier, referrer, wasModuleMock);
        }
    }

    if constexpr (allowPromise) {
        auto* pendingCtx = Bun__transpileFile(bunVM, globalObject, specifier, referrer, typeAttribute, res, true);
        if (pendingCtx) {
            return pendingCtx;
        }
    } else {
        Bun__transpileFile(bunVM, globalObject, specifier, referrer, typeAttribute, res, false);
    }

    if (res->success && res->result.value.isCommonJSModule) {
        auto created = Bun::createCommonJSModule(globalObject, specifierJS, res->result.value);

        if (created.has_value()) {
            return rejectOrResolve(JSSourceCode::create(vm, WTFMove(created.value())));
        }

        if constexpr (allowPromise) {
            auto* exception = scope.exception();
            scope.clearException();
            return rejectedInternalPromise(globalObject, exception);
        } else {
            return {};
        }
    }

    if (!res->success) {
        throwException(scope, res->result.err, globalObject);
        auto* exception = scope.exception();
        scope.clearException();
        return reject(exception);
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
        JSC::JSValue value = JSC::JSONParse(globalObject, res->result.value.source_code.toWTFString(BunString::ZeroCopy));
        if (!value) {
            return reject(JSC::JSValue(JSC::createSyntaxError(globalObject, "Failed to parse JSON"_s)));
        }

        // JSON can become strings, null, numbers, booleans so we must handle "export default 123"
        auto function = generateJSValueModuleSourceCode(
            globalObject,
            value);
        auto source = JSC::SourceCode(
            JSC::SyntheticSourceProvider::create(WTFMove(function),
                JSC::SourceOrigin(), specifier->toWTFString(BunString::ZeroCopy)));
        JSC::ensureStillAliveHere(value);
        return rejectOrResolve(JSSourceCode::create(globalObject->vm(), WTFMove(source)));
    }
    // TOML and JSONC may go through here
    else if (res->result.value.tag == SyntheticModuleType::ExportsObject) {
        JSC::JSValue value = JSC::JSValue::decode(res->result.value.jsvalue_for_export);
        if (!value) {
            return reject(JSC::JSValue(JSC::createSyntaxError(globalObject, "Failed to parse Object"_s)));
        }

        // JSON can become strings, null, numbers, booleans so we must handle "export default 123"
        auto function = generateJSValueModuleSourceCode(
            globalObject,
            value);
        auto source = JSC::SourceCode(
            JSC::SyntheticSourceProvider::create(WTFMove(function),
                JSC::SourceOrigin(), specifier->toWTFString(BunString::ZeroCopy)));
        JSC::ensureStillAliveHere(value);
        return rejectOrResolve(JSSourceCode::create(globalObject->vm(), WTFMove(source)));
    }

    return rejectOrResolve(JSC::JSSourceCode::create(vm,
        JSC::SourceCode(Zig::SourceProvider::create(globalObject, res->result.value))));
}

JSValue fetchESMSourceCodeSync(
    Zig::GlobalObject* globalObject,
    JSC::JSValue specifierJS,
    ErrorableResolvedSource* res,
    BunString* specifier,
    BunString* referrer,
    BunString* typeAttribute)
{
    return fetchESMSourceCode<false>(globalObject, specifierJS, res, specifier, referrer, typeAttribute);
}

JSValue fetchESMSourceCodeAsync(
    Zig::GlobalObject* globalObject,
    JSC::JSValue specifierJS,
    ErrorableResolvedSource* res,
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

    bool wasModuleMock = pendingModule->wasModuleMock;

    JSC::JSValue result = handleVirtualModuleResult<false>(reinterpret_cast<Zig::GlobalObject*>(globalObject), objectResult, &res, &specifier, &referrer, wasModuleMock);
    if (res.success) {
        if (scope.exception()) {
            auto retValue = JSValue::encode(promise->rejectWithCaughtException(globalObject, scope));
            pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
            return retValue;
        }
        scope.release();
        promise->resolve(globalObject, result);
        pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
        return JSValue::encode(jsUndefined());
    } else {
        throwException(globalObject, scope, result);
        auto retValue = JSValue::encode(promise->rejectWithCaughtException(globalObject, scope));
        pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
        return retValue;
    }
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionOnLoadObjectResultReject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    JSC::JSValue reason = callFrame->argument(0);
    PendingVirtualModuleResult* pendingModule = JSC::jsCast<PendingVirtualModuleResult*>(callFrame->argument(1));
    pendingModule->internalField(0).set(vm, pendingModule, JSC::jsUndefined());
    pendingModule->internalField(1).set(vm, pendingModule, JSC::jsUndefined());
    JSC::JSInternalPromise* promise = pendingModule->internalPromise();

    pendingModule->internalField(2).set(vm, pendingModule, JSC::jsUndefined());
    promise->reject(globalObject, reason);

    return JSValue::encode(reason);
}
