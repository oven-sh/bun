#include "root.h"

#include "BunClientData.h"
#include "GCDefferalContext.h"

#include "JavaScriptCore/AggregateError.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/DeferredWorkTimer.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/ExceptionHelpers.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/FunctionConstructor.h"
#include "JavaScriptCore/HeapSnapshotBuilder.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/IteratorOperations.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/JSArrayBuffer.h"
#include "JavaScriptCore/JSArrayInlines.h"
#include "JavaScriptCore/JSCInlines.h"
#include "JavaScriptCore/JSCallbackObject.h"
#include "JavaScriptCore/JSClassRef.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JavaScriptCore/JSONObject.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSSet.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/Microtask.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/ScriptExecutable.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/StackVisitor.h"
#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/WasmFaultSignalHandler.h"
#include "JavaScriptCore/Watchdog.h"
#include "ZigGlobalObject.h"
#include "helpers.h"

#include "wtf/text/ExternalStringImpl.h"
#include "wtf/text/StringCommon.h"
#include "wtf/text/StringImpl.h"
#include "wtf/text/StringView.h"
#include "wtf/text/WTFString.h"

#include "DOMURL.h"
#include "JSDOMURL.h"

extern "C" {

WebCore__DOMURL* WebCore__DOMURL__cast(JSC__JSValue JSValue0)
{
    auto* jsdomURL = JSC::jsCast<WebCore::JSDOMURL*>(JSC::JSValue::decode(JSValue0));
    if (jsdomURL == nullptr) {
        return nullptr;
    }

    return &jsdomURL->wrapped();
}
void WebCore__DOMURL__href_(WebCore__DOMURL* domURL, ZigString* arg1)
{
    const WTF::URL& href = domURL->href();
    *arg1 = Zig::toZigString(href.string());
}
void WebCore__DOMURL__pathname_(WebCore__DOMURL* domURL, ZigString* arg1)
{
    const WTF::URL& href = domURL->href();
    const WTF::StringView& pathname = href.path();
    *arg1 = Zig::toZigString(pathname);
}

JSC__JSValue SystemError__toErrorInstance(const SystemError* arg0,
    JSC__JSGlobalObject* globalObject)
{

    static const char* system_error_name = "SystemError";
    SystemError err = *arg0;

    JSC::VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue message = JSC::jsUndefined();
    if (err.message.len > 0) {
        message = Zig::toJSString(err.message, globalObject);
    }

    JSC::JSValue options = JSC::jsUndefined();

    JSC::Structure* errorStructure = globalObject->errorStructure();
    JSC::JSObject* result = JSC::ErrorInstance::create(globalObject, errorStructure, message, options);

    auto clientData = WebCore::clientData(vm);

    if (err.code.len > 0) {
        JSC::JSValue code = Zig::toJSString(err.code, globalObject);
        result->putDirect(vm, clientData->builtinNames().codePublicName(), code,
            JSC::PropertyAttribute::DontDelete | 0);

        result->putDirect(vm, vm.propertyNames->name, code, JSC::PropertyAttribute::DontEnum | 0);
    } else {

        result->putDirect(
            vm, vm.propertyNames->name,
            JSC::JSValue(JSC::jsOwnedString(
                vm, WTF::String(WTF::StringImpl::createWithoutCopying(system_error_name, 11)))),
            JSC::PropertyAttribute::DontEnum | 0);
    }

    if (err.path.len > 0) {
        JSC::JSValue path = JSC::JSValue(Zig::toJSStringGC(err.path, globalObject));
        result->putDirect(vm, clientData->builtinNames().pathPublicName(), path,
            JSC::PropertyAttribute::DontDelete | 0);
    }

    if (err.syscall.len > 0) {
        JSC::JSValue syscall = JSC::JSValue(Zig::toJSString(err.syscall, globalObject));
        result->putDirect(vm, clientData->builtinNames().syscallPublicName(), syscall,
            JSC::PropertyAttribute::DontDelete | 0);
    }

    result->putDirect(vm, clientData->builtinNames().errnoPublicName(), JSC::JSValue(err.errno_),
        JSC::PropertyAttribute::DontDelete | 0);

    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue()));
    scope.release();

    return JSC::JSValue::encode(JSC::JSValue(result));
}

JSC__JSValue
JSC__JSObject__create(JSC__JSGlobalObject* globalObject, size_t initialCapacity, void* arg2,
    void (*ArgFn3)(void* arg0, JSC__JSObject* arg1, JSC__JSGlobalObject* arg2))
{
    JSC::JSObject* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), initialCapacity);

    ArgFn3(arg2, object, globalObject);

    return JSC::JSValue::encode(object);
}

JSC__JSValue JSC__JSValue__createEmptyObject(JSC__JSGlobalObject* globalObject,
    size_t initialCapacity)
{
    return JSC::JSValue::encode(
        JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), initialCapacity));
}

uint32_t JSC__JSValue__getLengthOfArray(JSC__JSValue value, JSC__JSGlobalObject* globalObject)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(value);
    JSC::JSObject* object = jsValue.toObject(globalObject);
    return JSC::toLength(globalObject, object);
}

void JSC__JSObject__putRecord(JSC__JSObject* object, JSC__JSGlobalObject* global, ZigString* key,
    ZigString* values, size_t valuesLen)
{
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    auto ident = Zig::toIdentifier(*key, global);
    JSC::PropertyDescriptor descriptor;

    descriptor.setEnumerable(1);
    descriptor.setConfigurable(1);
    descriptor.setWritable(1);

    if (valuesLen == 1) {
        descriptor.setValue(JSC::jsString(global->vm(), Zig::toString(values[0])));
    } else {

        JSC::JSArray* array = nullptr;
        {
            JSC::ObjectInitializationScope initializationScope(global->vm());
            if ((array = JSC::JSArray::tryCreateUninitializedRestricted(
                     initializationScope, nullptr,
                     global->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                     valuesLen))) {

                for (size_t i = 0; i < valuesLen; ++i) {
                    array->initializeIndexWithoutBarrier(
                        initializationScope, i, JSC::jsString(global->vm(), Zig::toString(values[i])));
                }
            }
        }

        if (!array) {
            JSC::throwOutOfMemoryError(global, scope);
            return;
        }

        descriptor.setValue(array);
    }

    object->methodTable(global->vm())->defineOwnProperty(object, global, ident, descriptor, true);
    object->putDirect(global->vm(), ident, descriptor.value());
    scope.release();
}
void JSC__JSValue__putRecord(JSC__JSValue objectValue, JSC__JSGlobalObject* global, ZigString* key,
    ZigString* values, size_t valuesLen)
{
    JSC::JSValue objValue = JSC::JSValue::decode(objectValue);
    JSC::JSObject* object = objValue.asCell()->getObject();
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    auto ident = Zig::toIdentifier(*key, global);
    JSC::PropertyDescriptor descriptor;

    descriptor.setEnumerable(1);
    descriptor.setConfigurable(1);
    descriptor.setWritable(1);

    if (valuesLen == 1) {
        descriptor.setValue(JSC::jsString(global->vm(), Zig::toString(values[0])));
    } else {

        JSC::JSArray* array = nullptr;
        {
            JSC::ObjectInitializationScope initializationScope(global->vm());
            if ((array = JSC::JSArray::tryCreateUninitializedRestricted(
                     initializationScope, nullptr,
                     global->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                     valuesLen))) {

                for (size_t i = 0; i < valuesLen; ++i) {
                    array->initializeIndexWithoutBarrier(
                        initializationScope, i, JSC::jsString(global->vm(), Zig::toString(values[i])));
                }
            }
        }

        if (!array) {
            JSC::throwOutOfMemoryError(global, scope);
            return;
        }

        descriptor.setValue(array);
    }

    object->methodTable(global->vm())->defineOwnProperty(object, global, ident, descriptor, true);
    object->putDirect(global->vm(), ident, descriptor.value());
    scope.release();
}

JSC__JSInternalPromise* JSC__JSValue__asInternalPromise(JSC__JSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return JSC::jsCast<JSC::JSInternalPromise*>(value);
}

JSC__JSPromise* JSC__JSValue__asPromise(JSC__JSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return JSC::jsCast<JSC::JSPromise*>(value);
}
JSC__JSValue JSC__JSValue__createInternalPromise(JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    return JSC::JSValue::encode(
        JSC::JSValue(JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure())));
}

void JSC__JSValue__jsonStringify(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, uint32_t arg2,
    ZigString* arg3)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    WTF::String str = JSC::JSONStringify(arg1, value, (unsigned)arg2);
    *arg3 = Zig::toZigString(str);
}
unsigned char JSC__JSValue__jsType(JSC__JSValue JSValue0)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(JSValue0);
    // if the value is NOT a cell
    // asCell will return an invalid pointer rather than a nullptr
    if (jsValue.isCell())
        return jsValue.asCell()->type();

    return 0;
}

JSC__JSValue JSC__JSPromise__asValue(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1)
{
    return JSC::JSValue::encode(JSC::JSValue(arg0));
}
JSC__JSPromise* JSC__JSPromise__create(JSC__JSGlobalObject* arg0)
{
    return JSC::JSPromise::create(arg0->vm(), arg0->promiseStructure());
}

// TODO: prevent this from allocating so much memory
void JSC__JSValue___then(JSC__JSValue JSValue0, JSC__JSGlobalObject* globalObject, void* ctx, void (*ArgFn3)(JSC__JSGlobalObject* arg0, void* arg1, JSC__JSValue arg2, size_t arg3), void (*ArgFn4)(JSC__JSGlobalObject* arg0, void* arg1, JSC__JSValue arg2, size_t arg3))
{

    JSC::JSNativeStdFunction* resolverFunction = JSC::JSNativeStdFunction::create(
        globalObject->vm(), globalObject, 1, String(), [ctx, ArgFn3](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
            auto argCount = static_cast<uint16_t>(callFrame->argumentCount());
            WTF::Vector<JSC::EncodedJSValue, 16> arguments;
            arguments.reserveInitialCapacity(argCount);
            if (argCount) {
                for (uint16_t i = 0; i < argCount; ++i) {
                    arguments.uncheckedAppend(JSC::JSValue::encode(callFrame->uncheckedArgument(i)));
                }
            }

            ArgFn3(globalObject, ctx, reinterpret_cast<JSC__JSValue>(arguments.data()), argCount);
            return JSC::JSValue::encode(JSC::jsUndefined());
        });
    JSC::JSNativeStdFunction* rejecterFunction = JSC::JSNativeStdFunction::create(
        globalObject->vm(), globalObject, 1, String(),
        [ctx, ArgFn4](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
            auto argCount = static_cast<uint16_t>(callFrame->argumentCount());
            WTF::Vector<JSC::EncodedJSValue, 16> arguments;
            arguments.reserveInitialCapacity(argCount);
            if (argCount) {
                for (uint16_t i = 0; i < argCount; ++i) {
                    arguments.uncheckedAppend(JSC::JSValue::encode(callFrame->uncheckedArgument(i)));
                }
            }

            ArgFn4(globalObject, ctx, reinterpret_cast<JSC__JSValue>(arguments.data()), argCount);
            return JSC::JSValue::encode(JSC::jsUndefined());
        });

    globalObject->vm().drainMicrotasks();
    auto* cell = JSC::JSValue::decode(JSValue0).asCell();
    if (JSC::JSPromise* promise = JSC::jsDynamicCast<JSC::JSPromise*>(globalObject->vm(), cell)) {
        promise->performPromiseThen(globalObject, resolverFunction, rejecterFunction, JSC::jsUndefined());
    } else if (JSC::JSInternalPromise* promise = JSC::jsDynamicCast<JSC::JSInternalPromise*>(globalObject->vm(), cell)) {
        promise->then(globalObject, resolverFunction, rejecterFunction);
    }
}

JSC__JSValue JSC__JSValue__parseJSON(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(JSValue0);

    JSC::JSValue result = JSC::JSONParse(arg1, jsValue.toWTFString(arg1));

    if (!result) {
        result = JSC::JSValue(JSC::createSyntaxError(arg1->globalObject(), "Failed to parse JSON"));
    }

    return JSC::JSValue::encode(result);
}

JSC__JSValue JSC__JSGlobalObject__getCachedObject(JSC__JSGlobalObject* globalObject, const ZigString* arg1)
{
    JSC::VM& vm = globalObject->vm();
    WTF::String string = Zig::toString(*arg1);
    auto symbol = vm.privateSymbolRegistry().symbolForKey(string);
    JSC::Identifier ident = JSC::Identifier::fromUid(symbol);
    JSC::JSValue result = globalObject->getIfPropertyExists(globalObject, ident);
    return JSC::JSValue::encode(result);
}
JSC__JSValue JSC__JSGlobalObject__putCachedObject(JSC__JSGlobalObject* globalObject, const ZigString* arg1, JSC__JSValue JSValue2)
{
    JSC::VM& vm = globalObject->vm();
    WTF::String string = Zig::toString(*arg1);
    auto symbol = vm.privateSymbolRegistry().symbolForKey(string);
    JSC::Identifier ident = JSC::Identifier::fromUid(symbol);
    globalObject->putDirect(vm, ident, JSC::JSValue::decode(JSValue2), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::DontEnum);
    return JSValue2;
}

void JSC__JSGlobalObject__deleteModuleRegistryEntry(JSC__JSGlobalObject* global, ZigString* arg1)
{
    JSC::JSMap* map = JSC::jsDynamicCast<JSC::JSMap*>(
        global->vm(), global->moduleLoader()->getDirect(global->vm(), JSC::Identifier::fromString(global->vm(), "registry")));
    if (!map)
        return;
    const JSC::Identifier identifier = Zig::toIdentifier(*arg1, global);
    JSC::JSValue val = JSC::identifierToJSValue(global->vm(), identifier);

    map->remove(global, val);
}
// This is very naive!
JSC__JSInternalPromise* JSC__VM__reloadModule(JSC__VM* vm, JSC__JSGlobalObject* arg1,
    ZigString arg2)
{
    return nullptr;
    // JSC::JSMap *map = JSC::jsDynamicCast<JSC::JSMap *>(
    //   arg1->vm(), arg1->moduleLoader()->getDirect(
    //                 arg1->vm(), JSC::Identifier::fromString(arg1->vm(), "registry")));

    // const JSC::Identifier identifier = Zig::toIdentifier(arg2, arg1);
    // JSC::JSValue val = JSC::identifierToJSValue(arg1->vm(), identifier);

    // if (!map->has(arg1, val)) return nullptr;

    // if (JSC::JSObject *registryEntry =
    //       JSC::jsDynamicCast<JSC::JSObject *>(arg1->vm(), map->get(arg1, val))) {
    //   auto moduleIdent = JSC::Identifier::fromString(arg1->vm(), "module");
    //   if (JSC::JSModuleRecord *record = JSC::jsDynamicCast<JSC::JSModuleRecord *>(
    //         arg1->vm(), registryEntry->getDirect(arg1->vm(), moduleIdent))) {
    //     registryEntry->putDirect(arg1->vm(), moduleIdent, JSC::jsUndefined());
    //     JSC::JSModuleRecord::destroy(static_cast<JSC::JSCell *>(record));
    //   }
    //   map->remove(arg1, val);
    //   return JSC__JSModuleLoader__loadAndEvaluateModule(arg1, arg2);
    // }

    // return nullptr;
}

bool JSC__JSValue__isSameValue(JSC__JSValue JSValue0, JSC__JSValue JSValue1,
    JSC__JSGlobalObject* globalObject)
{
    return JSC::sameValue(globalObject, JSC::JSValue::decode(JSValue0),
        JSC::JSValue::decode(JSValue1));
}

// This is the same as the C API version, except it returns a JSValue which may be a *Exception
// We want that so we can return stack traces.
JSC__JSValue JSObjectCallAsFunctionReturnValue(JSContextRef ctx, JSObjectRef object,
    JSObjectRef thisObject, size_t argumentCount,
    const JSValueRef* arguments);

JSC__JSValue JSObjectCallAsFunctionReturnValue(JSContextRef ctx, JSObjectRef object,
    JSObjectRef thisObject, size_t argumentCount,
    const JSValueRef* arguments)
{
    JSC::JSGlobalObject* globalObject = toJS(ctx);
    JSC::VM& vm = globalObject->vm();

    if (!object)
        return JSC::JSValue::encode(JSC::JSValue());

    JSC::JSObject* jsObject = toJS(object);
    JSC::JSObject* jsThisObject = toJS(thisObject);

    if (!jsThisObject)
        jsThisObject = globalObject->globalThis();

    JSC::MarkedArgumentBuffer argList;
    for (size_t i = 0; i < argumentCount; i++)
        argList.append(toJS(globalObject, arguments[i]));

    auto callData = getCallData(vm, jsObject);
    if (callData.type == JSC::CallData::Type::None)
        return JSC::JSValue::encode(JSC::JSValue());

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, jsObject, callData, jsThisObject, argList, returnedException);

    if (returnedException.get()) {
        return JSC::JSValue::encode(JSC::JSValue(returnedException.get()));
    }

    return JSC::JSValue::encode(result);
}

JSC__JSValue JSObjectCallAsFunctionReturnValueHoldingAPILock(JSContextRef ctx, JSObjectRef object,
    JSObjectRef thisObject,
    size_t argumentCount,
    const JSValueRef* arguments);

JSC__JSValue JSObjectCallAsFunctionReturnValueHoldingAPILock(JSContextRef ctx, JSObjectRef object,
    JSObjectRef thisObject,
    size_t argumentCount,
    const JSValueRef* arguments)
{
    JSC::JSGlobalObject* globalObject = toJS(ctx);
    JSC::VM& vm = globalObject->vm();

    JSC::JSLockHolder lock(vm);

    if (!object)
        return JSC::JSValue::encode(JSC::JSValue());

    JSC::JSObject* jsObject = toJS(object);
    JSC::JSObject* jsThisObject = toJS(thisObject);

    if (!jsThisObject)
        jsThisObject = globalObject->globalThis();

    JSC::MarkedArgumentBuffer argList;
    for (size_t i = 0; i < argumentCount; i++)
        argList.append(toJS(globalObject, arguments[i]));

    auto callData = getCallData(vm, jsObject);
    if (callData.type == JSC::CallData::Type::None)
        return JSC::JSValue::encode(JSC::JSValue());

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, jsObject, callData, jsThisObject, argList, returnedException);

    if (returnedException.get()) {
        return JSC::JSValue::encode(JSC::JSValue(returnedException.get()));
    }

    return JSC::JSValue::encode(result);
}

#pragma mark - JSC::Exception

JSC__Exception* JSC__Exception__create(JSC__JSGlobalObject* arg0, JSC__JSObject* arg1,
    unsigned char StackCaptureAction2)
{
    return JSC::Exception::create(arg0->vm(), JSC::JSValue(arg1),
        StackCaptureAction2 == 0
            ? JSC::Exception::StackCaptureAction::CaptureStack
            : JSC::Exception::StackCaptureAction::DoNotCaptureStack);
}
JSC__JSValue JSC__Exception__value(JSC__Exception* arg0)
{
    return JSC::JSValue::encode(arg0->value());
}

//     #pragma mark - JSC::PropertyNameArray

// CPP_DECL size_t JSC__PropertyNameArray__length(JSC__PropertyNameArray* arg0);
// CPP_DECL const JSC__PropertyName*
// JSC__PropertyNameArray__next(JSC__PropertyNameArray* arg0, size_t arg1);
// CPP_DECL void JSC__PropertyNameArray__release(JSC__PropertyNameArray* arg0);
size_t JSC__JSObject__getArrayLength(JSC__JSObject* arg0) { return arg0->getArrayLength(); }
JSC__JSValue JSC__JSObject__getIndex(JSC__JSValue jsValue, JSC__JSGlobalObject* arg1,
    uint32_t arg3)
{
    return JSC::JSValue::encode(JSC::JSValue::decode(jsValue).toObject(arg1)->getIndex(arg1, arg3));
}
JSC__JSValue JSC__JSObject__getDirect(JSC__JSObject* arg0, JSC__JSGlobalObject* arg1,
    const ZigString* arg2)
{
    return JSC::JSValue::encode(arg0->getDirect(arg1->vm(), Zig::toIdentifier(*arg2, arg1)));
}
void JSC__JSObject__putDirect(JSC__JSObject* arg0, JSC__JSGlobalObject* arg1, const ZigString* key,
    JSC__JSValue value)
{
    auto prop = Zig::toIdentifier(*key, arg1);

    arg0->putDirect(arg1->vm(), prop, JSC::JSValue::decode(value));
}

#pragma mark - JSC::JSCell

JSC__JSObject* JSC__JSCell__getObject(JSC__JSCell* arg0)
{
    return arg0->getObject();
}
bWTF__String JSC__JSCell__getString(JSC__JSCell* arg0, JSC__JSGlobalObject* arg1)
{
    return Wrap<WTF__String, bWTF__String>::wrap(arg0->getString(arg1));
}
unsigned char JSC__JSCell__getType(JSC__JSCell* arg0) { return arg0->type(); }

#pragma mark - JSC::JSString

JSC__JSString* JSC__JSString__createFromOwnedString(JSC__VM* arg0, const WTF__String* arg1)
{
    return JSC::jsOwnedString(reinterpret_cast<JSC__VM&>(arg0),
        reinterpret_cast<const WTF__String&>(arg1));
}
JSC__JSString* JSC__JSString__createFromString(JSC__VM* arg0, const WTF__String* arg1)
{
    return JSC::jsString(reinterpret_cast<JSC__VM&>(arg0),
        reinterpret_cast<const WTF__String&>(arg1));
}
bool JSC__JSString__eql(const JSC__JSString* arg0, JSC__JSGlobalObject* obj, JSC__JSString* arg2)
{
    return arg0->equal(obj, arg2);
}
bool JSC__JSString__is8Bit(const JSC__JSString* arg0) { return arg0->is8Bit(); };
size_t JSC__JSString__length(const JSC__JSString* arg0) { return arg0->length(); }
JSC__JSObject* JSC__JSString__toObject(JSC__JSString* arg0, JSC__JSGlobalObject* arg1)
{
    return arg0->toObject(arg1);
}

bWTF__String JSC__JSString__value(JSC__JSString* arg0, JSC__JSGlobalObject* arg1)
{
    return Wrap<WTF__String, bWTF__String>::wrap(arg0->value(arg1));
}

#pragma mark - JSC::JSModuleLoader

// JSC__JSValue
// JSC__JSModuleLoader__dependencyKeysIfEvaluated(JSC__JSModuleLoader* arg0,
// JSC__JSGlobalObject* arg1, JSC__JSModuleRecord* arg2) {
//     arg2->depen
// }

void Microtask__run(void* microtask, void* global)
{
    reinterpret_cast<Zig::JSMicrotaskCallback*>(microtask)->call();
}

bool JSC__JSModuleLoader__checkSyntax(JSC__JSGlobalObject* arg0, const JSC__SourceCode* arg1,
    bool arg2)
{
    JSC::ParserError error;
    bool result = false;
    if (arg2) {
        result = JSC::checkModuleSyntax(arg0, reinterpret_cast<const JSC::SourceCode&>(arg1), error);
    } else {
        result = JSC::checkSyntax(reinterpret_cast<JSC__VM&>(arg0->vm()),
            reinterpret_cast<const JSC::SourceCode&>(arg1), error);
    }

    return result;
}
JSC__JSValue JSC__JSModuleLoader__evaluate(JSC__JSGlobalObject* arg0, const unsigned char* arg1,
    size_t arg2, const unsigned char* arg3, size_t arg4,
    JSC__JSValue JSValue5, JSC__JSValue* arg6)
{
    WTF::String src = WTF::String(WTF::StringImpl::createWithoutCopying(arg1, arg2));
    WTF::URL origin = WTF::URL::fileURLWithFileSystemPath(WTF::StringView(arg3, arg4));

    JSC::VM& vm = arg0->vm();
    JSC::JSLockHolder locker(vm);

    JSC::SourceCode sourceCode = JSC::makeSource(
        src, JSC::SourceOrigin { origin }, origin.lastPathComponent().toStringWithoutCopying(),
        WTF::TextPosition(), JSC::SourceProviderSourceType::Module);
    WTF::NakedPtr<JSC::Exception> exception;
    auto val = JSC::evaluate(arg0, sourceCode, JSC::JSValue(), exception);
    if (exception.get()) {
        *arg6 = JSC::JSValue::encode(JSC::JSValue(exception.get()));
    }

    vm.drainMicrotasks();
    return JSC::JSValue::encode(val);
}
JSC__JSInternalPromise* JSC__JSModuleLoader__importModule(JSC__JSGlobalObject* arg0,
    const JSC__Identifier* arg1)
{
    return JSC::importModule(arg0, *arg1, JSC::JSValue {}, JSC::JSValue {});
}
JSC__JSValue JSC__JSModuleLoader__linkAndEvaluateModule(JSC__JSGlobalObject* arg0,
    const JSC__Identifier* arg1)
{
    return JSC::JSValue::encode(JSC::linkAndEvaluateModule(arg0, *arg1, JSC::JSValue {}));
}

static JSC::Identifier jsValueToModuleKey(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::JSValue value)
{
    if (value.isSymbol())
        return JSC::Identifier::fromUid(JSC::jsCast<JSC::Symbol*>(value)->privateName());
    return JSC::asString(value)->toIdentifier(lexicalGlobalObject);
}

static JSC::JSValue doLink(JSC__JSGlobalObject* globalObject, JSC::JSValue moduleKeyValue)
{
    JSC::VM& vm = globalObject->vm();
    JSC::JSLockHolder lock { vm };
    if (!(moduleKeyValue.isString() || moduleKeyValue.isSymbol())) {
        return JSC::jsUndefined();
    }
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::Identifier moduleKey = jsValueToModuleKey(globalObject, moduleKeyValue);
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::linkAndEvaluateModule(globalObject, moduleKey, JSC::JSValue());
}

JSC__JSValue JSC__JSValue__createRangeError(const ZigString* message, const ZigString* arg1,
    JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    ZigString code = *arg1;
    JSC::JSObject* rangeError = Zig::getErrorInstance(message, globalObject).asCell()->getObject();
    static const char* range_error_name = "RangeError";

    rangeError->putDirect(
        vm, vm.propertyNames->name,
        JSC::JSValue(JSC::jsOwnedString(
            vm, WTF::String(WTF::StringImpl::createWithoutCopying(range_error_name, 10)))),
        0);

    if (code.len > 0) {
        auto clientData = WebCore::clientData(vm);
        JSC::JSValue codeValue = Zig::toJSStringValue(code, globalObject);
        rangeError->putDirect(vm, clientData->builtinNames().codePublicName(), codeValue,
            JSC::PropertyAttribute::ReadOnly | 0);
    }

    return JSC::JSValue::encode(rangeError);
}
JSC__JSValue JSC__JSValue__createTypeError(const ZigString* message, const ZigString* arg1,
    JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    ZigString code = *arg1;
    JSC::JSObject* typeError = Zig::getErrorInstance(message, globalObject).asCell()->getObject();
    static const char* range_error_name = "TypeError";

    typeError->putDirect(
        vm, vm.propertyNames->name,
        JSC::JSValue(JSC::jsOwnedString(
            vm, WTF::String(WTF::StringImpl::createWithoutCopying(range_error_name, 10)))),
        0);

    if (code.len > 0) {
        auto clientData = WebCore::clientData(vm);
        JSC::JSValue codeValue = Zig::toJSStringValue(code, globalObject);
        typeError->putDirect(vm, clientData->builtinNames().codePublicName(), codeValue, 0);
    }

    return JSC::JSValue::encode(typeError);
}

JSC__JSValue JSC__JSValue__fromEntries(JSC__JSGlobalObject* globalObject, ZigString* keys,
    ZigString* values, size_t initialCapacity, bool clone)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (initialCapacity == 0) {
        return JSC::JSValue::encode(JSC::constructEmptyObject(globalObject));
    }

    JSC::JSObject* object = nullptr;
    {
        JSC::ObjectInitializationScope initializationScope(vm);
        object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), initialCapacity);

        if (!clone) {
            for (size_t i = 0; i < initialCapacity; ++i) {
                object->putDirect(
                    vm, JSC::PropertyName(JSC::Identifier::fromString(vm, Zig::toString(keys[i]))),
                    Zig::toJSStringValueGC(values[i], globalObject), 0);
            }
        } else {
            for (size_t i = 0; i < initialCapacity; ++i) {
                object->putDirect(vm, JSC::PropertyName(Zig::toIdentifier(keys[i], globalObject)),
                    Zig::toJSStringValueGC(values[i], globalObject), 0);
            }
        }
    }

    return JSC::JSValue::encode(object);
}

bool JSC__JSValue__asArrayBuffer_(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1,
    Bun__ArrayBuffer* arg2)
{
    JSC::VM& vm = arg1->vm();

    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (!value.isObject()) {
        return false;
    }

    JSC::JSObject* object = value.getObject();

    if (JSC::JSArrayBufferView* typedArray = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(vm, object)) {
        if (JSC::ArrayBuffer* buffer = typedArray->possiblySharedBuffer()) {
            buffer->pinAndLock();
            arg2->ptr = reinterpret_cast<char*>(buffer->data());
            arg2->len = typedArray->length();
            arg2->byte_len = buffer->byteLength();
            arg2->offset = typedArray->byteOffset();
            arg2->cell_type = typedArray->type();
            return true;
        }
    }

    if (JSC::ArrayBuffer* buffer = JSC::toPossiblySharedArrayBuffer(vm, value)) {
        buffer->pinAndLock();
        arg2->ptr = reinterpret_cast<char*>(buffer->data());
        arg2->len = buffer->byteLength();
        arg2->byte_len = buffer->byteLength();
        arg2->offset = 0;
        arg2->cell_type = 40;
        return true;
    }

    return false;
}
JSC__JSValue JSC__JSValue__createStringArray(JSC__JSGlobalObject* globalObject, ZigString* arg1,
    size_t arg2, bool clone)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (arg2 == 0) {
        return JSC::JSValue::encode(JSC::JSArray::create(vm, 0));
    }

    JSC::JSArray* array = nullptr;
    {
        JSC::ObjectInitializationScope initializationScope(vm);
        if ((array = JSC::JSArray::tryCreateUninitializedRestricted(
                 initializationScope, nullptr,
                 globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                 arg2))) {

            if (!clone) {
                for (size_t i = 0; i < arg2; ++i) {
                    array->putDirectIndex(globalObject, i, JSC::jsString(vm, Zig::toString(arg1[i])));
                }
            } else {
                for (size_t i = 0; i < arg2; ++i) {
                    array->putDirectIndex(globalObject, i, JSC::jsString(vm, Zig::toStringCopy(arg1[i])));
                }
            }
        }
    }
    if (!array) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return JSC::JSValue::encode(JSC::JSValue());
    }

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::JSValue(array)));
}

JSC__JSValue JSC__JSGlobalObject__createAggregateError(JSC__JSGlobalObject* globalObject,
    void** errors, uint16_t errors_count,
    const ZigString* arg3)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue message = JSC::JSValue(JSC::jsOwnedString(vm, Zig::toString(*arg3)));
    JSC::JSValue options = JSC::jsUndefined();
    JSC::JSArray* array = nullptr;
    {
        JSC::ObjectInitializationScope initializationScope(vm);
        if ((array = JSC::JSArray::tryCreateUninitializedRestricted(
                 initializationScope, nullptr,
                 globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                 errors_count))) {

            for (uint16_t i = 0; i < errors_count; ++i) {
                array->initializeIndexWithoutBarrier(
                    initializationScope, i, JSC::JSValue(reinterpret_cast<JSC::JSCell*>(errors[i])));
            }
        }
    }
    if (!array) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return JSC::JSValue::encode(JSC::JSValue());
    }

    JSC::Structure* errorStructure = globalObject->errorStructure(JSC::ErrorType::AggregateError);

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::createAggregateError(globalObject, vm, errorStructure, array, message, options, nullptr, JSC::TypeNothing, false)));
}
// static JSC::JSNativeStdFunction* resolverFunction;
// static JSC::JSNativeStdFunction* rejecterFunction;
// static bool resolverFunctionInitialized = false;

JSC__JSValue ZigString__toValue(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(arg1->vm(), Zig::toString(*arg0))));
}

JSC__JSValue ZigString__to16BitValue(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    auto str = WTF::String::fromUTF8(arg0->ptr, arg0->len);
    return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(arg1->vm(), str)));
}

static void free_global_string(void* str, void* ptr, unsigned len)
{
    // i don't understand why this happens
    if (ptr == nullptr)
        return;

    ZigString__free_global(reinterpret_cast<const unsigned char*>(ptr), len);
}

JSC__JSValue ZigString__toExternalU16(const uint16_t* arg0, size_t len, JSC__JSGlobalObject* global)
{
    return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(
        global->vm(),
        ExternalStringImpl::create(reinterpret_cast<const UChar*>(arg0), len, nullptr, free_global_string))));
}
// This must be a globally allocated string
JSC__JSValue ZigString__toExternalValue(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    ZigString str = *arg0;
    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(
            arg1->vm(),
            ExternalStringImpl::create(reinterpret_cast<const UChar*>(Zig::untag(str.ptr)), str.len, nullptr, free_global_string))));
    }

    return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(
        arg1->vm(),
        ExternalStringImpl::create(Zig::untag(str.ptr), str.len, nullptr, free_global_string))));
}

JSC__JSValue ZigString__toValueGC(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(arg1->vm(), Zig::toStringCopy(*arg0))));
}

void JSC__JSValue__toZigString(JSC__JSValue JSValue0, ZigString* arg1, JSC__JSGlobalObject* arg2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    // if (!value.isString()) {
    //   arg1->len = 0;
    //   arg1->ptr = nullptr;
    //   return;
    // }

    auto str = value.toWTFString(arg2);

    if (str.is8Bit()) {
        arg1->ptr = str.characters8();
    } else {
        arg1->ptr = Zig::taggedUTF16Ptr(str.characters16());
    }

    arg1->len = str.length();
}

JSC__JSValue ZigString__external(const ZigString* arg0, JSC__JSGlobalObject* arg1, void* arg2, void (*ArgFn3)(void* arg0, void* arg1, size_t arg2))
{
    ZigString str
        = *arg0;
    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(
            arg1->vm(),
            WTF::String(ExternalStringImpl::create(reinterpret_cast<const UChar*>(Zig::untag(str.ptr)), str.len, arg2, ArgFn3)))));
    } else {
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(
            arg1->vm(),
            WTF::String(ExternalStringImpl::create(reinterpret_cast<const LChar*>(Zig::untag(str.ptr)), str.len, arg2, ArgFn3)))));
    }
}

JSC__JSValue ZigString__toExternalValueWithCallback(const ZigString* arg0, JSC__JSGlobalObject* arg1, void (*ArgFn2)(void* arg2, void* arg0, size_t arg1))
{

    ZigString str
        = *arg0;
    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(
            arg1->vm(),
            WTF::String(ExternalStringImpl::create(reinterpret_cast<const UChar*>(Zig::untag(str.ptr)), str.len, nullptr, ArgFn2)))));
    } else {
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(
            arg1->vm(),
            WTF::String(ExternalStringImpl::create(reinterpret_cast<const LChar*>(Zig::untag(str.ptr)), str.len, nullptr, ArgFn2)))));
    }
}

JSC__JSValue ZigString__toErrorInstance(const ZigString* str, JSC__JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(Zig::getErrorInstance(str, globalObject));
}

static JSC::EncodedJSValue resolverFunctionCallback(JSC::JSGlobalObject* globalObject,
    JSC::CallFrame* callFrame)
{
    return JSC::JSValue::encode(doLink(globalObject, callFrame->argument(0)));
}

JSC__JSInternalPromise*
JSC__JSModuleLoader__loadAndEvaluateModule(JSC__JSGlobalObject* globalObject,
    const ZigString* arg1)
{
    globalObject->vm().drainMicrotasks();
    auto name = Zig::toString(*arg1);
    name.impl()->ref();

    auto* promise = JSC::loadAndEvaluateModule(globalObject, name, JSC::jsUndefined(), JSC::jsUndefined());

    JSC::JSNativeStdFunction* resolverFunction = JSC::JSNativeStdFunction::create(
        globalObject->vm(), globalObject, 1, String(), resolverFunctionCallback);
    JSC::JSNativeStdFunction* rejecterFunction = JSC::JSNativeStdFunction::create(
        globalObject->vm(), globalObject, 1, String(),
        [&arg1](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
            return JSC::JSValue::encode(
                JSC::JSInternalPromise::rejectedPromise(globalObject, callFrame->argument(0)));
        });

    globalObject->vm().drainMicrotasks();
    auto result = promise->then(globalObject, resolverFunction, rejecterFunction);
    globalObject->vm().drainMicrotasks();

    // if (promise->status(globalObject->vm()) ==
    // JSC::JSPromise::Status::Fulfilled) {
    //     return reinterpret_cast<JSC::JSInternalPromise*>(
    //         JSC::JSInternalPromise::resolvedPromise(
    //             globalObject,
    //             doLink(globalObject, promise->result(globalObject->vm()))
    //         )
    //     );
    // }

    return result;
}
JSC__JSInternalPromise*
JSC__JSModuleLoader__loadAndEvaluateModuleEntryPoint(JSC__JSGlobalObject* arg0,
    const JSC__SourceCode* arg1)
{
    return JSC::loadAndEvaluateModule(arg0, *arg1, JSC::JSValue {});
}

#pragma mark - JSC::JSModuleRecord

bJSC__SourceCode JSC__JSModuleRecord__sourceCode(JSC__JSModuleRecord* arg0)
{
    Wrap<JSC::SourceCode, bJSC__SourceCode> wrapped = Wrap<JSC::SourceCode, bJSC__SourceCode>(arg0->sourceCode());
    return wrapped.result;
}

#pragma mark - JSC::JSPromise

void JSC__JSPromise__reject(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__JSValue JSValue2)
{
    arg0->reject(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSPromise__rejectAsHandled(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__JSValue JSValue2)
{
    arg0->rejectAsHandled(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSPromise__rejectAsHandledException(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__Exception* arg2)
{
    arg0->rejectAsHandled(arg1, arg2);
}
JSC__JSPromise* JSC__JSPromise__rejectedPromise(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1)
{
    return JSC::JSPromise::rejectedPromise(arg0, JSC::JSValue::decode(JSValue1));
}

void JSC__JSPromise__rejectWithCaughtException(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1,
    bJSC__ThrowScope arg2)
{
    Wrap<JSC::ThrowScope, bJSC__ThrowScope> wrapped = Wrap<JSC::ThrowScope, bJSC__ThrowScope>(arg2);

    arg0->rejectWithCaughtException(arg1, *wrapped.cpp);
}
void JSC__JSPromise__resolve(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__JSValue JSValue2)
{
    arg0->resolve(arg1, JSC::JSValue::decode(JSValue2));
}
JSC__JSPromise* JSC__JSPromise__resolvedPromise(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1)
{
    return JSC::JSPromise::resolvedPromise(arg0, JSC::JSValue::decode(JSValue1));
}

JSC__JSValue JSC__JSPromise__result(const JSC__JSPromise* arg0, JSC__VM* arg1)
{
    return JSC::JSValue::encode(arg0->result(reinterpret_cast<JSC::VM&>(arg1)));
}
uint32_t JSC__JSPromise__status(const JSC__JSPromise* arg0, JSC__VM* arg1)
{
    switch (arg0->status(reinterpret_cast<JSC::VM&>(arg1))) {
    case JSC::JSPromise::Status::Pending:
        return 0;
    case JSC::JSPromise::Status::Fulfilled:
        return 1;
    case JSC::JSPromise::Status::Rejected:
        return 2;
    default:
        return 255;
    }
}
bool JSC__JSPromise__isHandled(const JSC__JSPromise* arg0, JSC__VM* arg1)
{
    return arg0->isHandled(reinterpret_cast<JSC::VM&>(arg1));
}

#pragma mark - JSC::JSInternalPromise

JSC__JSInternalPromise* JSC__JSInternalPromise__create(JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    return JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
}

void JSC__JSInternalPromise__reject(JSC__JSInternalPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__JSValue JSValue2)
{
    arg0->reject(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSInternalPromise__rejectAsHandled(JSC__JSInternalPromise* arg0,
    JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2)
{
    arg0->rejectAsHandled(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSInternalPromise__rejectAsHandledException(JSC__JSInternalPromise* arg0,
    JSC__JSGlobalObject* arg1,
    JSC__Exception* arg2)
{
    arg0->rejectAsHandled(arg1, arg2);
}
JSC__JSInternalPromise* JSC__JSInternalPromise__rejectedPromise(JSC__JSGlobalObject* arg0,
    JSC__JSValue JSValue1)
{
    return reinterpret_cast<JSC::JSInternalPromise*>(
        JSC::JSInternalPromise::rejectedPromise(arg0, JSC::JSValue::decode(JSValue1)));
}

void JSC__JSInternalPromise__rejectWithCaughtException(JSC__JSInternalPromise* arg0,
    JSC__JSGlobalObject* arg1,
    bJSC__ThrowScope arg2)
{
    Wrap<JSC::ThrowScope, bJSC__ThrowScope> wrapped = Wrap<JSC::ThrowScope, bJSC__ThrowScope>(arg2);

    arg0->rejectWithCaughtException(arg1, *wrapped.cpp);
}
void JSC__JSInternalPromise__resolve(JSC__JSInternalPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__JSValue JSValue2)
{
    arg0->resolve(arg1, JSC::JSValue::decode(JSValue2));
}
JSC__JSInternalPromise* JSC__JSInternalPromise__resolvedPromise(JSC__JSGlobalObject* arg0,
    JSC__JSValue JSValue1)
{
    return reinterpret_cast<JSC::JSInternalPromise*>(
        JSC::JSInternalPromise::resolvedPromise(arg0, JSC::JSValue::decode(JSValue1)));
}

JSC__JSValue JSC__JSInternalPromise__result(const JSC__JSInternalPromise* arg0, JSC__VM* arg1)
{
    return JSC::JSValue::encode(arg0->result(reinterpret_cast<JSC::VM&>(arg1)));
}
uint32_t JSC__JSInternalPromise__status(const JSC__JSInternalPromise* arg0, JSC__VM* arg1)
{
    switch (arg0->status(reinterpret_cast<JSC::VM&>(arg1))) {
    case JSC::JSInternalPromise::Status::Pending:
        return 0;
    case JSC::JSInternalPromise::Status::Fulfilled:
        return 1;
    case JSC::JSInternalPromise::Status::Rejected:
        return 2;
    default:
        return 255;
    }
}
bool JSC__JSInternalPromise__isHandled(const JSC__JSInternalPromise* arg0, JSC__VM* arg1)
{
    return arg0->isHandled(reinterpret_cast<JSC::VM&>(arg1));
}

// static JSC::JSFunction* nativeFunctionCallback(JSC__JSGlobalObject* globalObject, void* ctx, JSC__JSValue (*Callback)(void* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue* arg2, size_t arg3));

// static JSC::JSFunction* nativeFunctionCallback(JSC__JSGlobalObject* globalObject, void* ctx, JSC__JSValue (*Callback)(void* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue* arg2, size_t arg3))
// {
//     return JSC::JSNativeStdFunction::create(
//         globalObject->vm(), globalObject, 1, String(), [&ctx, &Callback](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
//             size_t argumentCount = callFrame->argumentCount();
//             Vector<JSC__JSValue, 16> arguments;
//             arguments.reserveInitialCapacity(argumentCount);
//             for (size_t i = 0; i < argumentCount; ++i)
//                 arguments.uncheckedAppend(JSC::JSValue::encode(callFrame->uncheckedArgument(i)));

//             return Callback(ctx, globalObject, arguments.data(), argumentCount);
//         });
// }

// JSC__JSInternalPromise* JSC__JSInternalPromise__then_(JSC__JSInternalPromise* promise, JSC__JSGlobalObject* global, void* resolveCtx, JSC__JSValue (*onResolve)(void* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue* arg2, size_t arg3), void* arg4, JSC__JSValue (*ArgFn5)(void* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue* arg2, size_t arg3))
// {

//     return promise->then(global, nativeFunctionCallback(global, resolveCtx, onResolve), nativeFunctionCallback(global, arg4, ArgFn5));
// }
// JSC__JSInternalPromise* JSC__JSInternalPromise__thenReject_(JSC__JSInternalPromise* promise, JSC__JSGlobalObject* global, void* arg2, JSC__JSValue (*ArgFn3)(void* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue* arg2, size_t arg3))
// {
//     return promise->then(global, nullptr, nativeFunctionCallback(global, arg2, ArgFn3));
// }
// JSC__JSInternalPromise* JSC__JSInternalPromise__thenResolve_(JSC__JSInternalPromise* promise, JSC__JSGlobalObject* global, void* arg2, JSC__JSValue (*ArgFn3)(void* arg0, JSC__JSGlobalObject* arg1, JSC__JSValue* arg2, size_t arg3))
// {
//     return promise->then(global, nativeFunctionCallback(global, arg2, ArgFn3), nullptr);
// }
// bool JSC__JSPromise__isInternal(JSC__JSPromise* arg0, JSC__VM* arg1) {
//     return arg0->inf
// }

#pragma mark - JSC::SourceOrigin

bJSC__SourceOrigin JSC__SourceOrigin__fromURL(const WTF__URL* arg0)
{

    Wrap<JSC::SourceOrigin, bJSC__SourceOrigin> wrap;
    wrap.cpp = new (&wrap.result.bytes) JSC::SourceOrigin(WTF::URL(*arg0));
    return wrap.result;
}

#pragma mark - JSC::SourceCode

// class StringSourceProvider : public JSC::SourceProvider {
//     public:
//         unsigned hash() const override
//         {
//             return m_source->hash();
//         }

//         StringView source() const override
//         {
//             return WTF::StringView(m_source);
//         }

//         ~StringSourceProvider() {

//         }
//         WTF::StringImpl *m_source;

//         StringSourceProvider(const WTF::String& source, const
//         JSC::SourceOrigin& sourceOrigin, WTF::String&& sourceURL, const
//         WTF::TextPosition& startPosition, JSC::SourceProviderSourceType
//         sourceType)
//             : JSC::SourceProvider(sourceOrigin, WTFMove(sourceURL),
//             startPosition, sourceType) , m_source(source.isNull() ?
//             WTF::StringImpl::empty() : source.impl())
//         {
//         }
// };

void JSC__SourceCode__fromString(JSC__SourceCode* arg0, const WTF__String* arg1,
    const JSC__SourceOrigin* arg2, WTF__String* arg3,
    unsigned char SourceType4) {}

#pragma mark - JSC::JSFunction

// JSC__JSValue JSC__JSFunction__callWithArguments(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1,
//     JSC__JSValue* arg2, size_t arg3,
//     JSC__Exception** arg4, const unsigned char* arg5)
// {
//     auto args = makeArgs(arg2, arg3);
//     return JSC::JSValue::encode(JSC::call(arg1, JSC::JSValue::decode(JSValue0),
//         JSC::JSValue::decode(JSValue0), args, (const char*)arg5));
// }
// JSC__JSValue JSC__JSFunction__callWithArgumentsAndThis(JSC__JSValue JSValue0, JSC__JSValue JSValue1,
//     JSC__JSGlobalObject* arg2,
//     JSC__JSValue* arg3, size_t arg4,
//     JSC__Exception** arg5,
//     const unsigned char* arg6)
// {
//     auto args = makeArgs(arg3, arg4);
//     return JSC::JSValue::encode(JSC::call(arg2, JSC::JSValue::decode(JSValue0),
//         JSC::JSValue::decode(JSValue1), args, (const char*)arg6));
// }
// JSC__JSValue JSC__JSFunction__callWithoutAnyArgumentsOrThis(JSC__JSValue JSValue0,
//     JSC__JSGlobalObject* arg1,
//     JSC__Exception** arg2,
//     const unsigned char* arg3)
// {
//     return JSC::JSValue::encode(JSC::call(arg1, JSC::JSValue::decode(JSValue0),
//         JSC::JSValue::decode(JSValue0), JSC::ArgList(),
//         (const char*)arg3));
// }
// JSC__JSValue JSC__JSFunction__callWithThis(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1,
//     JSC__JSValue JSValue2, JSC__Exception** arg3,
//     const unsigned char* arg4)
// {
//     return JSC::JSValue::encode(JSC::call(arg1, JSC::JSValue::decode(JSValue0),
//         JSC::JSValue::decode(JSValue2), JSC::ArgList(),
//         (const char*)arg4));
// }
// JSC__JSValue JSC__JSFunction__constructWithArguments(JSC__JSValue JSValue0,
//     JSC__JSGlobalObject* arg1, JSC__JSValue* arg2,
//     size_t arg3, JSC__Exception** arg4,
//     const unsigned char* arg5)
// {
//     auto args = makeArgs(arg2, arg3);
//     return JSC::JSValue::encode(
//         JSC::construct(arg1, JSC::JSValue::decode(JSValue0), args, (const char*)arg5));
// }

// JSC__JSValue JSC__JSFunction__constructWithArgumentsAndNewTarget(
//     JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* arg2, JSC__JSValue* arg3,
//     size_t arg4, JSC__Exception** arg5, const unsigned char* arg6)
// {
//     auto args = makeArgs(arg3, arg4);
//     return JSC::JSValue::encode(JSC::construct(arg2, JSC::JSValue::decode(JSValue0),
//         JSC::JSValue::decode(JSValue0), args,
//         (const char*)arg6));
// }
// JSC__JSValue JSC__JSFunction__constructWithNewTarget(JSC__JSValue JSValue0,
//     JSC__JSGlobalObject* arg1,
//     JSC__JSValue JSValue2, JSC__Exception** arg3,
//     const unsigned char* arg4)
// {
//     return JSC::JSValue::encode(JSC::construct(arg1, JSC::JSValue::decode(JSValue0),
//         JSC::JSValue::decode(JSValue2), JSC::ArgList(),
//         (const char*)arg4));
// }
// JSC__JSValue JSC__JSFunction__constructWithoutAnyArgumentsOrNewTarget(JSC__JSValue JSValue0,
//     JSC__JSGlobalObject* arg1,
//     JSC__Exception** arg2,
//     const unsigned char* arg3)
// {
//     return JSC::JSValue::encode(
//         JSC::construct(arg1, JSC::JSValue::decode(JSValue0), JSC::ArgList(), (const char*)arg3));
// }

JSC__JSFunction* JSC__JSFunction__createFromNative(JSC__JSGlobalObject* arg0, uint16_t arg1,
    const WTF__String* arg2, void* ctx,
    NativeCallbackFunction callback)
{
    return JSC::JSNativeStdFunction::create(
        reinterpret_cast<JSC::VM&>(arg0->vm()), arg0, arg1, arg2 != nullptr ? *arg2 : WTF::String(),
        [ctx, callback](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
            -> JSC::EncodedJSValue { return callback(ctx, globalObject, callFrame); });
}
// JSC__JSFunction* JSC__JSFunction__createFromSourceCode(
//     JSC__JSGlobalObject* arg0,
//     const unsigned char* arg1,
//     uint16_t arg2,
//     JSC__JSValue arg3,
//     uint16_t arg4,
//     const JSC__SourceCode* source,
//     JSC__SourceOrigin* origin,
//     JSC__JSObject** exception
// ) {
//     JSC::VM& vm = reinterpret_cast<JSC::VM&>(arg0->vm());
//     JSC::Identifier functionName = JSC::Identifier::fromString(vm, arg2 &&
//     arg1 != nullptr ? WTF::StringImpl(static_cast<const LChar*>(arg1), arg2)
//     : vm->propertyNames->anonymous.impl());

//     JSC::FunctionExecutable* function =
//     JSC::FunctionExecutable::fromGlobalCode(
//         functionName,
//         arg0,
//         source,
//         exception,
//         0,
//         nullptr,
//     );

// }

bWTF__String JSC__JSFunction__displayName(JSC__JSFunction* arg0, JSC__VM* arg1)
{
    auto wrap = Wrap<WTF::String, bWTF__String>(arg0->displayName(reinterpret_cast<JSC::VM&>(arg1)));
    return wrap.result;
};
bWTF__String JSC__JSFunction__getName(JSC__JSFunction* arg0, JSC__VM* arg1)
{
    auto wrap = Wrap<WTF::String, bWTF__String>(arg0->name(reinterpret_cast<JSC::VM&>(arg1)));
    return wrap.result;
};
bWTF__String JSC__JSFunction__calculatedDisplayName(JSC__JSFunction* arg0, JSC__VM* arg1)
{
    auto wrap = Wrap<WTF::String, bWTF__String>(arg0->calculatedDisplayName(reinterpret_cast<JSC::VM&>(arg1)));
    return wrap.result;
};
#pragma mark - JSC::JSGlobalObject

JSC__JSValue JSC__JSGlobalObject__generateHeapSnapshot(JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSLockHolder lock(vm);
    // JSC::DeferTermination deferScope(vm);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::HeapSnapshotBuilder snapshotBuilder(vm.ensureHeapProfiler());
    snapshotBuilder.buildSnapshot();

    WTF::String jsonString = snapshotBuilder.json();
    JSC::EncodedJSValue result = JSC::JSValue::encode(JSONParse(globalObject, jsonString));
    scope.releaseAssertNoException();
    return result;
}

JSC__ArrayIteratorPrototype*
JSC__JSGlobalObject__arrayIteratorPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->arrayIteratorPrototype();
};
JSC__ArrayPrototype* JSC__JSGlobalObject__arrayPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->arrayPrototype();
};
JSC__AsyncFunctionPrototype*
JSC__JSGlobalObject__asyncFunctionPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->asyncFunctionPrototype();
};
JSC__AsyncGeneratorFunctionPrototype*
JSC__JSGlobalObject__asyncGeneratorFunctionPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->asyncGeneratorFunctionPrototype();
};
JSC__AsyncGeneratorPrototype*
JSC__JSGlobalObject__asyncGeneratorPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->asyncGeneratorPrototype();
};
JSC__AsyncIteratorPrototype*
JSC__JSGlobalObject__asyncIteratorPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->asyncIteratorPrototype();
};
JSC__BigIntPrototype* JSC__JSGlobalObject__bigIntPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->bigIntPrototype();
};
JSC__JSObject* JSC__JSGlobalObject__booleanPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->booleanPrototype();
};
JSC__JSObject* JSC__JSGlobalObject__datePrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->datePrototype();
};
JSC__JSObject* JSC__JSGlobalObject__errorPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->errorPrototype();
};
JSC__FunctionPrototype* JSC__JSGlobalObject__functionPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->functionPrototype();
};
JSC__GeneratorFunctionPrototype*
JSC__JSGlobalObject__generatorFunctionPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->generatorFunctionPrototype();
};
JSC__GeneratorPrototype* JSC__JSGlobalObject__generatorPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->generatorPrototype();
};
JSC__IteratorPrototype* JSC__JSGlobalObject__iteratorPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->iteratorPrototype();
};
JSC__JSObject* JSC__JSGlobalObject__jsSetPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->jsSetPrototype();
};
JSC__MapIteratorPrototype* JSC__JSGlobalObject__mapIteratorPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->mapIteratorPrototype();
};
JSC__JSObject* JSC__JSGlobalObject__mapPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->mapPrototype();
};
JSC__JSObject* JSC__JSGlobalObject__numberPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->numberPrototype();
};
JSC__ObjectPrototype* JSC__JSGlobalObject__objectPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->objectPrototype();
};
JSC__JSPromisePrototype* JSC__JSGlobalObject__promisePrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->promisePrototype();
};
JSC__RegExpPrototype* JSC__JSGlobalObject__regExpPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->regExpPrototype();
};
JSC__SetIteratorPrototype* JSC__JSGlobalObject__setIteratorPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->setIteratorPrototype();
};
JSC__StringPrototype* JSC__JSGlobalObject__stringPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->stringPrototype();
};
JSC__JSObject* JSC__JSGlobalObject__symbolPrototype(JSC__JSGlobalObject* arg0)
{
    return arg0->symbolPrototype();
};

JSC__VM* JSC__JSGlobalObject__vm(JSC__JSGlobalObject* arg0) { return &arg0->vm(); };
    // JSC__JSObject* JSC__JSGlobalObject__createError(JSC__JSGlobalObject* arg0,
    // unsigned char ErrorType1, WTF__String* arg2) {}; JSC__JSObject*
    // JSC__JSGlobalObject__throwError(JSC__JSGlobalObject* arg0, JSC__JSObject*
    // arg1) {};

#pragma mark - JSC::JSValue

JSC__JSCell* JSC__JSValue__asCell(JSC__JSValue JSValue0)
{
    auto value = JSC::JSValue::decode(JSValue0);
    return value.asCell();
}
double JSC__JSValue__asNumber(JSC__JSValue JSValue0)
{
    auto value = JSC::JSValue::decode(JSValue0);
    return value.asNumber();
};
bJSC__JSObject JSC__JSValue__asObject(JSC__JSValue JSValue0)
{
    auto value = JSC::JSValue::decode(JSValue0);
    auto obj = JSC::asObject(value);
    return cast<bJSC__JSObject>(&obj);
};
JSC__JSString* JSC__JSValue__asString(JSC__JSValue JSValue0)
{
    auto value = JSC::JSValue::decode(JSValue0);
    return JSC::asString(value);
};
// uint64_t JSC__JSValue__encode(JSC__JSValue JSValue0) {

// }
bool JSC__JSValue__eqlCell(JSC__JSValue JSValue0, JSC__JSCell* arg1)
{
    return JSC::JSValue::decode(JSValue0) == arg1;
};
bool JSC__JSValue__eqlValue(JSC__JSValue JSValue0, JSC__JSValue JSValue1)
{
    return JSC::JSValue::decode(JSValue0) == JSC::JSValue::decode(JSValue1);
};
JSC__JSValue JSC__JSValue__getPrototype(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    auto value = JSC::JSValue::decode(JSValue0);
    return JSC::JSValue::encode(value.getPrototype(arg1));
}
bool JSC__JSValue__isException(JSC__JSValue JSValue0, JSC__VM* arg1)
{
    return JSC::jsDynamicCast<JSC::Exception*>(*arg1, JSC::JSValue::decode(JSValue0)) != nullptr;
}
bool JSC__JSValue__isAnyInt(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isAnyInt();
}
bool JSC__JSValue__isBigInt(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isBigInt();
}
bool JSC__JSValue__isBigInt32(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isBigInt32();
}
bool JSC__JSValue__isBoolean(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isBoolean();
}

void JSC__JSValue__put(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, const ZigString* arg2, JSC__JSValue JSValue3)
{
    JSC::JSObject* object = JSC::JSValue::decode(JSValue0).asCell()->getObject();
    object->putDirect(arg1->vm(), Zig::toIdentifier(*arg2, arg1), JSC::JSValue::decode(JSValue3));
}

bool JSC__JSValue__isClass(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.isConstructor(arg1->vm());
}
bool JSC__JSValue__isCell(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isCell(); }
bool JSC__JSValue__isCustomGetterSetter(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isCustomGetterSetter();
}
bool JSC__JSValue__isError(JSC__JSValue JSValue0)
{
    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();
    return obj != nullptr && obj->isErrorInstance();
}

bool JSC__JSValue__isAggregateError(JSC__JSValue JSValue0, JSC__JSGlobalObject* global)
{
    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();

    if (obj != nullptr) {
        if (JSC::ErrorInstance* err = JSC::jsDynamicCast<JSC::ErrorInstance*>(global->vm(), obj)) {
            return err->errorType() == JSC::ErrorType::AggregateError;
        }
    }

    return false;
}

bool JSC__JSValue__isIterable(JSC__JSValue JSValue, JSC__JSGlobalObject* global)
{
    return JSC::hasIteratorMethod(global, JSC::JSValue::decode(JSValue));
}

void JSC__JSValue__forEach(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, void* ctx, void (*ArgFn3)(JSC__VM* arg0, JSC__JSGlobalObject* arg1, void* arg2, JSC__JSValue JSValue3))
{

    JSC::forEachInIterable(
        arg1, JSC::JSValue::decode(JSValue0),
        [ArgFn3, ctx](JSC::VM& vm, JSC::JSGlobalObject* global, JSC::JSValue value) -> void {
            ArgFn3(&vm, global, ctx, JSC::JSValue::encode(value));
        });
}

bool JSC__JSValue__isCallable(JSC__JSValue JSValue0, JSC__VM* arg1)
{
    return JSC::JSValue::decode(JSValue0).isCallable(reinterpret_cast<JSC::VM&>(arg1));
}
bool JSC__JSValue__isGetterSetter(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isGetterSetter();
}
bool JSC__JSValue__isHeapBigInt(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isHeapBigInt();
}
bool JSC__JSValue__isInt32(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isInt32();
}
bool JSC__JSValue__isInt32AsAnyInt(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isInt32AsAnyInt();
}
bool JSC__JSValue__isNull(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isNull(); }
bool JSC__JSValue__isNumber(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isNumber();
}
bool JSC__JSValue__isObject(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isObject();
}
bool JSC__JSValue__isPrimitive(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isPrimitive();
}
bool JSC__JSValue__isString(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isString();
}
bool JSC__JSValue__isSymbol(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isSymbol();
}
bool JSC__JSValue__isUInt32AsAnyInt(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isUInt32AsAnyInt();
}
bool JSC__JSValue__isUndefined(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isUndefined();
}
bool JSC__JSValue__isUndefinedOrNull(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isUndefinedOrNull();
}
JSC__JSValue JSC__JSValue__jsBoolean(bool arg0)
{
    return JSC::JSValue::encode(JSC::jsBoolean(arg0));
};
JSC__JSValue JSC__JSValue__jsDoubleNumber(double arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
}
JSC__JSValue JSC__JSValue__jsNull() { return JSC::JSValue::encode(JSC::jsNull()); };
JSC__JSValue JSC__JSValue__jsNumberFromChar(unsigned char arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromDouble(double arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromInt32(int32_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromInt64(int64_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromU16(uint16_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromUint64(uint64_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};

int64_t JSC__JSValue__toInt64(JSC__JSValue val)
{
    JSC::JSValue _val = JSC::JSValue::decode(val);

    int64_t result = JSC::tryConvertToInt52(_val.asDouble());
    if (result != JSC::JSValue::notInt52) {
        return result;
    }

    if (_val.isHeapBigInt()) {

        if (auto* heapBigInt = _val.asHeapBigInt()) {
            return heapBigInt->toBigInt64(heapBigInt);
        }
    }
    return _val.asAnyInt();
}

JSC__JSValue JSC__JSValue__createObject2(JSC__JSGlobalObject* globalObject, const ZigString* arg1,
    const ZigString* arg2, JSC__JSValue JSValue3,
    JSC__JSValue JSValue4)
{
    JSC::JSObject* object = JSC::constructEmptyObject(globalObject);
    auto key1 = Zig::toIdentifier(*arg1, globalObject);
    JSC::PropertyDescriptor descriptor1;
    JSC::PropertyDescriptor descriptor2;

    descriptor1.setEnumerable(1);
    descriptor1.setConfigurable(1);
    descriptor1.setWritable(1);
    descriptor1.setValue(JSC::JSValue::decode(JSValue3));

    auto key2 = Zig::toIdentifier(*arg2, globalObject);

    descriptor2.setEnumerable(1);
    descriptor2.setConfigurable(1);
    descriptor2.setWritable(1);
    descriptor2.setValue(JSC::JSValue::decode(JSValue4));

    object->methodTable(globalObject->vm())
        ->defineOwnProperty(object, globalObject, key2, descriptor2, true);
    object->methodTable(globalObject->vm())
        ->defineOwnProperty(object, globalObject, key1, descriptor1, true);

    return JSC::JSValue::encode(object);
}

JSC__JSValue JSC__JSValue__getIfPropertyExistsImpl(JSC__JSValue JSValue0,
    JSC__JSGlobalObject* globalObject,
    const unsigned char* arg1, uint32_t arg2)
{

    JSC::VM& vm = globalObject->vm();
    JSC::JSObject* object = JSC::JSValue::decode(JSValue0).asCell()->getObject();
    auto propertyName = JSC::PropertyName(
        JSC::Identifier::fromString(vm, reinterpret_cast<const LChar*>(arg1), (int)arg2));
    return JSC::JSValue::encode(object->getIfPropertyExists(globalObject, propertyName));
}

void JSC__JSValue__getSymbolDescription(JSC__JSValue symbolValue_, JSC__JSGlobalObject* arg1, ZigString* arg2)

{
    JSC::JSValue symbolValue = JSC::JSValue::decode(symbolValue_);

    if (!symbolValue.isSymbol())
        return;

    JSC::Symbol* symbol = JSC::asSymbol(symbolValue);
    JSC::VM& vm = arg1->vm();
    WTF::String string = symbol->description();

    *arg2 = Zig::toZigString(string);
}

JSC__JSValue JSC__JSValue__symbolFor(JSC__JSGlobalObject* globalObject, ZigString* arg2)
{

    JSC::VM& vm = globalObject->vm();
    WTF::String string = Zig::toString(*arg2);
    return JSC::JSValue::encode(JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey(string)));
}

bool JSC__JSValue__symbolKeyFor(JSC__JSValue symbolValue_, JSC__JSGlobalObject* arg1, ZigString* arg2)
{
    JSC::JSValue symbolValue = JSC::JSValue::decode(symbolValue_);
    JSC::VM& vm = arg1->vm();

    if (!symbolValue.isSymbol())
        return false;

    JSC::PrivateName privateName = JSC::asSymbol(symbolValue)->privateName();
    SymbolImpl& uid = privateName.uid();
    if (!uid.symbolRegistry())
        return false;

    *arg2 = Zig::toZigString(JSC::jsString(vm, &uid), arg1);
    return true;
}

bool JSC__JSValue__toBoolean(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).asBoolean();
}
int32_t JSC__JSValue__toInt32(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).asInt32();
}

JSC__JSValue JSC__JSValue__getErrorsProperty(JSC__JSValue JSValue0, JSC__JSGlobalObject* global)
{
    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();
    return JSC::JSValue::encode(obj->getDirect(global->vm(), global->vm().propertyNames->errors));
}

JSC__JSValue JSC__JSValue__jsTDZValue() { return JSC::JSValue::encode(JSC::jsTDZValue()); };
JSC__JSValue JSC__JSValue__jsUndefined() { return JSC::JSValue::encode(JSC::jsUndefined()); };
JSC__JSObject* JSC__JSValue__toObject(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toObject(arg1);
}

bJSC__Identifier JSC__JSValue__toPropertyKey(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    auto ident = value.toPropertyKey(arg1);
    return cast<bJSC__Identifier>(&ident);
}
JSC__JSValue JSC__JSValue__toPropertyKeyValue(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return JSC::JSValue::encode(value.toPropertyKeyValue(arg1));
}
JSC__JSString* JSC__JSValue__toString(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toString(arg1);
};
JSC__JSString* JSC__JSValue__toStringOrNull(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toStringOrNull(arg1);
}
bWTF__String JSC__JSValue__toWTFString(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return Wrap<WTF::String, bWTF__String>::wrap(value.toWTFString(arg1));
};

static void populateStackFrameMetadata(const JSC::StackFrame* stackFrame, ZigStackFrame* frame)
{
    frame->source_url = Zig::toZigString(stackFrame->sourceURL());

    if (stackFrame->isWasmFrame()) {
        frame->code_type = ZigStackFrameCodeWasm;
        return;
    }

    auto m_codeBlock = stackFrame->codeBlock();
    if (m_codeBlock) {
        switch (m_codeBlock->codeType()) {
        case JSC::EvalCode: {
            frame->code_type = ZigStackFrameCodeEval;
            return;
        }
        case JSC::ModuleCode: {
            frame->code_type = ZigStackFrameCodeModule;
            return;
        }
        case JSC::GlobalCode: {
            frame->code_type = ZigStackFrameCodeGlobal;
            return;
        }
        case JSC::FunctionCode: {
            frame->code_type = !m_codeBlock->isConstructor() ? ZigStackFrameCodeFunction : ZigStackFrameCodeConstructor;
            break;
        }
        default:
            ASSERT_NOT_REACHED();
        }
    }

    auto calleeCell = stackFrame->callee();
    if (!calleeCell || !calleeCell->isObject())
        return;

    JSC::JSObject* callee = JSC::jsCast<JSC::JSObject*>(calleeCell);
    // Does the code block have a user-defined name property?
    JSC::JSValue name = callee->getDirect(m_codeBlock->vm(), m_codeBlock->vm().propertyNames->name);
    if (name && name.isString()) {
        auto str = name.toWTFString(m_codeBlock->globalObject());
        frame->function_name = Zig::toZigString(str);
        return;
    }

    /* For functions (either JSFunction or InternalFunction), fallback to their "native" name
     * property. Based on JSC::getCalculatedDisplayName, "inlining" the
     * JSFunction::calculatedDisplayName\InternalFunction::calculatedDisplayName calls */
    if (JSC::JSFunction* function = JSC::jsDynamicCast<JSC::JSFunction*>(m_codeBlock->vm(), callee)) {

        WTF::String actualName = function->name(m_codeBlock->vm());
        if (!actualName.isEmpty() || function->isHostOrBuiltinFunction()) {
            frame->function_name = Zig::toZigString(actualName);
            return;
        }

        auto inferred_name = function->jsExecutable()->name();
        frame->function_name = Zig::toZigString(inferred_name.string());
    }

    if (JSC::InternalFunction* function = JSC::jsDynamicCast<JSC::InternalFunction*>(m_codeBlock->vm(), callee)) {
        // Based on JSC::InternalFunction::calculatedDisplayName, skipping the "displayName" property
        frame->function_name = Zig::toZigString(function->name());
    }
}
// Based on
// https://github.com/mceSystems/node-jsc/blob/master/deps/jscshim/src/shim/JSCStackTrace.cpp#L298
static void populateStackFramePosition(const JSC::StackFrame* stackFrame, ZigString* source_lines,
    int32_t* source_line_numbers, uint8_t source_lines_count,
    ZigStackFramePosition* position)
{
    auto m_codeBlock = stackFrame->codeBlock();
    if (!m_codeBlock)
        return;

    JSC::BytecodeIndex bytecodeOffset = stackFrame->hasBytecodeIndex() ? stackFrame->bytecodeIndex() : JSC::BytecodeIndex();

    /* Get the "raw" position info.
     * Note that we're using m_codeBlock->unlinkedCodeBlock()->expressionRangeForBytecodeOffset
     * rather than m_codeBlock->expressionRangeForBytecodeOffset in order get the "raw" offsets and
     * avoid the CodeBlock's expressionRangeForBytecodeOffset modifications to the line and column
     * numbers, (we don't need the column number from it, and we'll calculate the line "fixes"
     * ourselves). */
    int startOffset = 0;
    int endOffset = 0;
    int divotPoint = 0;
    unsigned line = 0;
    unsigned unusedColumn = 0;
    m_codeBlock->unlinkedCodeBlock()->expressionRangeForBytecodeIndex(
        bytecodeOffset, divotPoint, startOffset, endOffset, line, unusedColumn);
    divotPoint += m_codeBlock->sourceOffset();

    // TODO: evaluate if using the API from UnlinkedCodeBlock can be used instead of iterating
    // through source text.

    /* On the first line of the source code, it seems that we need to "fix" the column with the
     * starting offset. We currently use codeBlock->source()->startPosition().m_column.oneBasedInt()
     * as the offset in the first line rather than codeBlock->firstLineColumnOffset(), which seems
     * simpler (and what CodeBlock::expressionRangeForBytecodeOffset does). This is because
     * firstLineColumnOffset values seems different from what we expect (according to v8's tests)
     * and I haven't dove into the relevant parts in JSC (yet) to figure out why. */
    unsigned columnOffset = line ? 0 : m_codeBlock->source().startColumn().zeroBasedInt();

    // "Fix" the line number
    JSC::ScriptExecutable* executable = m_codeBlock->ownerExecutable();
    if (std::optional<int> overrideLine = executable->overrideLineNumber(m_codeBlock->vm())) {
        line = overrideLine.value();
    } else {
        line += executable->firstLine();
    }

    // Calculate the staring\ending offsets of the entire expression
    int expressionStart = divotPoint - startOffset;
    int expressionStop = divotPoint + endOffset;

    // Make sure the range is valid
    WTF::StringView sourceString = m_codeBlock->source().provider()->source();
    if (!expressionStop || expressionStart > static_cast<int>(sourceString.length())) {
        return;
    }

    // Search for the beginning of the line
    unsigned int lineStart = expressionStart;
    while ((lineStart > 0) && ('\n' != sourceString[lineStart - 1])) {
        lineStart--;
    }
    // Search for the end of the line
    unsigned int lineStop = expressionStop;
    unsigned int sourceLength = sourceString.length();
    while ((lineStop < sourceLength) && ('\n' != sourceString[lineStop])) {
        lineStop++;
    }
    if (source_lines_count > 1 && source_lines != nullptr) {
        auto chars = sourceString.characters8();

        // Most of the time, when you look at a stack trace, you want a couple lines above

        source_lines[0] = { &chars[lineStart], lineStop - lineStart };
        source_line_numbers[0] = line;

        if (lineStart > 0) {
            auto byte_offset_in_source_string = lineStart - 1;
            uint8_t source_line_i = 1;
            auto remaining_lines_to_grab = source_lines_count - 1;

            while (byte_offset_in_source_string > 0 && remaining_lines_to_grab > 0) {
                unsigned int end_of_line_offset = byte_offset_in_source_string;

                // This should probably be code points instead of newlines
                while (byte_offset_in_source_string > 0 && chars[byte_offset_in_source_string] != '\n') {
                    byte_offset_in_source_string--;
                }

                // We are at the beginning of the line
                source_lines[source_line_i] = { &chars[byte_offset_in_source_string],
                    end_of_line_offset - byte_offset_in_source_string + 1 };

                source_line_numbers[source_line_i] = line - source_line_i;
                source_line_i++;

                remaining_lines_to_grab--;

                byte_offset_in_source_string -= byte_offset_in_source_string > 0;
            }
        }
    }

    /* Finally, store the source "positions" info.
     * Notes:
     * - The retrieved column seem to point the "end column". To make sure we're current, we'll
     *calculate the columns ourselves, since we've already found where the line starts. Note that in
     *v8 it should be 0-based here (in contrast the 1-based column number in v8::StackFrame).
     * - The static_casts are ugly, but comes from differences between JSC and v8's api, and should
     *be OK since no source should be longer than "max int" chars.
     * TODO: If expressionStart == expressionStop, then m_endColumn will be equal to m_startColumn.
     *Should we handle this case?
     */
    position->expression_start = expressionStart;
    position->expression_stop = expressionStop;
    position->line = WTF::OrdinalNumber::fromOneBasedInt(static_cast<int>(line)).zeroBasedInt();
    position->column_start = (expressionStart - lineStart) + columnOffset;
    position->column_stop = position->column_start + (expressionStop - expressionStart);
    position->line_start = lineStart;
    position->line_stop = lineStop;

    return;
}
static void populateStackFrame(ZigStackTrace* trace, const JSC::StackFrame* stackFrame,
    ZigStackFrame* frame, bool is_top)
{
    populateStackFrameMetadata(stackFrame, frame);
    populateStackFramePosition(stackFrame, is_top ? trace->source_lines_ptr : nullptr,
        is_top ? trace->source_lines_numbers : nullptr,
        is_top ? trace->source_lines_to_collect : 0, &frame->position);
}
static void populateStackTrace(const WTF::Vector<JSC::StackFrame>& frames, ZigStackTrace* trace)
{
    uint8_t frame_i = 0;
    size_t stack_frame_i = 0;
    const size_t total_frame_count = frames.size();
    const uint8_t frame_count = total_frame_count < trace->frames_len ? total_frame_count : trace->frames_len;

    while (frame_i < frame_count && stack_frame_i < total_frame_count) {
        // Skip native frames
        while (stack_frame_i < total_frame_count && !(&frames.at(stack_frame_i))->codeBlock() && !(&frames.at(stack_frame_i))->isWasmFrame()) {
            stack_frame_i++;
        }
        if (stack_frame_i >= total_frame_count)
            break;

        ZigStackFrame* frame = &trace->frames_ptr[frame_i];
        populateStackFrame(trace, &frames[stack_frame_i], frame, frame_i == 0);
        stack_frame_i++;
        frame_i++;
    }
    trace->frames_len = frame_i;
}

#define SYNTAX_ERROR_CODE 4

static void fromErrorInstance(ZigException* except, JSC::JSGlobalObject* global,
    JSC::ErrorInstance* err, const Vector<JSC::StackFrame>* stackTrace,
    JSC::JSValue val)
{
    JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(global->vm(), val);

    bool getFromSourceURL = false;
    if (stackTrace != nullptr && stackTrace->size() > 0) {
        populateStackTrace(*stackTrace, &except->stack);
    } else if (err->stackTrace() != nullptr && err->stackTrace()->size() > 0) {
        populateStackTrace(*err->stackTrace(), &except->stack);
    } else {
        getFromSourceURL = true;
    }
    except->code = (unsigned char)err->errorType();
    if (err->isStackOverflowError()) {
        except->code = 253;
    }
    if (err->isOutOfMemoryError()) {
        except->code = 8;
    }
    if (except->code == SYNTAX_ERROR_CODE) {
        except->message = Zig::toZigString(err->sanitizedMessageString(global));
    } else if (JSC::JSValue message = obj->getIfPropertyExists(global, global->vm().propertyNames->message)) {

        except->message = Zig::toZigString(message, global);

    } else {
        except->message = Zig::toZigString(err->sanitizedMessageString(global));
    }
    except->name = Zig::toZigString(err->sanitizedNameString(global));
    except->runtime_type = err->runtimeTypeForCause();

    auto clientData = WebCore::clientData(global->vm());
    if (except->code != SYNTAX_ERROR_CODE) {

        if (JSC::JSValue syscall = obj->getIfPropertyExists(global, clientData->builtinNames().syscallPublicName())) {
            except->syscall = Zig::toZigString(syscall, global);
        }

        if (JSC::JSValue code = obj->getIfPropertyExists(global, clientData->builtinNames().codePublicName())) {
            except->code_ = Zig::toZigString(code, global);
        }

        if (JSC::JSValue path = obj->getIfPropertyExists(global, clientData->builtinNames().pathPublicName())) {
            except->path = Zig::toZigString(path, global);
        }

        if (JSC::JSValue errno_ = obj->getIfPropertyExists(global, clientData->builtinNames().errnoPublicName())) {
            except->errno_ = errno_.toInt32(global);
        }
    }

    if (getFromSourceURL) {
        if (JSC::JSValue sourceURL = obj->getIfPropertyExists(global, global->vm().propertyNames->sourceURL)) {
            except->stack.frames_ptr[0].source_url = Zig::toZigString(sourceURL, global);

            if (JSC::JSValue line = obj->getIfPropertyExists(global, global->vm().propertyNames->line)) {
                except->stack.frames_ptr[0].position.line = line.toInt32(global);
            }

            if (JSC::JSValue column = obj->getIfPropertyExists(global, global->vm().propertyNames->column)) {
                except->stack.frames_ptr[0].position.column_start = column.toInt32(global);
            }
            except->stack.frames_len = 1;
        }
    }

    except->exception = err;
}

void exceptionFromString(ZigException* except, JSC::JSValue value, JSC::JSGlobalObject* global)
{
    // Fallback case for when it's a user-defined ErrorLike-object that doesn't inherit from
    // ErrorInstance
    if (JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(global->vm(), value)) {
        if (obj->hasProperty(global, global->vm().propertyNames->name)) {
            auto name_str = obj->getIfPropertyExists(global, global->vm().propertyNames->name).toWTFString(global);
            except->name = Zig::toZigString(name_str);
            if (name_str == "Error"_s) {
                except->code = JSErrorCodeError;
            } else if (name_str == "EvalError"_s) {
                except->code = JSErrorCodeEvalError;
            } else if (name_str == "RangeError"_s) {
                except->code = JSErrorCodeRangeError;
            } else if (name_str == "ReferenceError"_s) {
                except->code = JSErrorCodeReferenceError;
            } else if (name_str == "SyntaxError"_s) {
                except->code = JSErrorCodeSyntaxError;
            } else if (name_str == "TypeError"_s) {
                except->code = JSErrorCodeTypeError;
            } else if (name_str == "URIError"_s) {
                except->code = JSErrorCodeURIError;
            } else if (name_str == "AggregateError"_s) {
                except->code = JSErrorCodeAggregateError;
            }
        }

        if (JSC::JSValue message = obj->getIfPropertyExists(global, global->vm().propertyNames->message)) {
            if (message) {
                except->message = Zig::toZigString(
                    message.toWTFString(global));
            }
        }

        if (JSC::JSValue sourceURL = obj->getIfPropertyExists(global, global->vm().propertyNames->sourceURL)) {
            if (sourceURL) {
                except->stack.frames_ptr[0].source_url = Zig::toZigString(
                    sourceURL.toWTFString(global));
                except->stack.frames_len = 1;
            }
        }

        if (JSC::JSValue line = obj->getIfPropertyExists(global, global->vm().propertyNames->line)) {
            if (line) {
                except->stack.frames_ptr[0].position.line = line.toInt32(global);
                except->stack.frames_len = 1;
            }
        }

        return;
    }
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    auto str = value.toWTFString(global);
    if (scope.exception()) {
        scope.clearException();
        scope.release();
        return;
    }
    scope.release();

    auto ref = OpaqueJSString::tryCreate(str);
    except->message = ZigString { ref->characters8(), ref->length() };
    ref->ref();
}

static WTF::StringView function_string_view = WTF::StringView("Function");
void JSC__JSValue__getClassName(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigString* arg2)
{
    JSC::JSCell* cell = JSC::JSValue::decode(JSValue0).asCell();
    if (cell == nullptr) {
        arg2->len = 0;
        return;
    }

    const char* ptr = cell->className(arg1->vm());
    auto view = WTF::StringView(ptr);

    // Fallback to .name if className is empty
    if (view.length() == 0 || view == function_string_view) {
        JSC__JSValue__getNameProperty(JSValue0, arg1, arg2);
        return;
    } else {
        *arg2 = Zig::toZigString(view);
        return;
    }

    arg2->len = 0;
}
void JSC__JSValue__getNameProperty(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1,
    ZigString* arg2)
{

    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();

    if (obj == nullptr) {
        arg2->len = 0;
        return;
    }

    JSC::JSValue name = obj->getDirect(arg1->vm(), arg1->vm().propertyNames->name);
    if (name && name.isString()) {
        auto str = name.toWTFString(arg1);
        if (!str.isEmpty()) {
            *arg2 = Zig::toZigString(str);
            return;
        }
    }

    if (JSC::JSFunction* function = JSC::jsDynamicCast<JSC::JSFunction*>(arg1->vm(), obj)) {

        WTF::String actualName = function->name(arg1->vm());
        if (!actualName.isEmpty() || function->isHostOrBuiltinFunction()) {
            *arg2 = Zig::toZigString(actualName);
            return;
        }

        actualName = function->jsExecutable()->name().string();

        *arg2 = Zig::toZigString(actualName);
        return;
    }

    if (JSC::InternalFunction* function = JSC::jsDynamicCast<JSC::InternalFunction*>(arg1->vm(), obj)) {
        auto view = WTF::StringView(function->name());
        *arg2 = Zig::toZigString(view);
        return;
    }

    arg2->len = 0;
}

void JSC__JSValue__toZigException(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1,
    ZigException* exception)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    if (JSC::Exception* jscException = JSC::jsDynamicCast<JSC::Exception*>(arg1->vm(), value)) {
        if (JSC::ErrorInstance* error = JSC::jsDynamicCast<JSC::ErrorInstance*>(arg1->vm(), jscException->value())) {
            fromErrorInstance(exception, arg1, error, &jscException->stack(), value);
            return;
        }
    }

    if (JSC::ErrorInstance* error = JSC::jsDynamicCast<JSC::ErrorInstance*>(arg1->vm(), value)) {
        fromErrorInstance(exception, arg1, error, nullptr, value);
        return;
    }

    exceptionFromString(exception, value, arg1);
}

void JSC__Exception__getStackTrace(JSC__Exception* arg0, ZigStackTrace* trace)
{
    populateStackTrace(arg0->stack(), trace);
}

#pragma mark - JSC::PropertyName

bool JSC__PropertyName__eqlToIdentifier(JSC__PropertyName* arg0, const JSC__Identifier* arg1)
{
    return (*arg0) == (*arg1);
};
bool JSC__PropertyName__eqlToPropertyName(JSC__PropertyName* arg0, const JSC__PropertyName* arg1)
{
    return (*arg0) == (*arg1);
};
const WTF__StringImpl* JSC__PropertyName__publicName(JSC__PropertyName* arg0)
{
    return arg0->publicName();
};
const WTF__StringImpl* JSC__PropertyName__uid(JSC__PropertyName* arg0) { return arg0->uid(); };

#pragma mark - JSC::VM

JSC__JSValue JSC__VM__runGC(JSC__VM* vm, bool sync)
{
    JSC::JSLockHolder lock(vm);

    if (sync) {
        vm->heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
    } else {
        vm->heap.collectSync(JSC::CollectionScope::Full);
    }

    return JSC::JSValue::encode(JSC::jsNumber(vm->heap.sizeAfterLastFullCollection()));
}

bool JSC__VM__isJITEnabled() { return JSC::Options::useJIT(); }

void JSC__VM__clearExecutionTimeLimit(JSC__VM* vm)
{
    JSC::JSLockHolder locker(vm);
    if (vm->watchdog())
        vm->watchdog()->setTimeLimit(JSC::Watchdog::noTimeLimit);
}
void JSC__VM__setExecutionTimeLimit(JSC__VM* vm, double limit)
{
    JSC::JSLockHolder locker(vm);
    JSC::Watchdog& watchdog = vm->ensureWatchdog();
    watchdog.setTimeLimit(WTF::Seconds { limit });
}

bool JSC__JSValue__isTerminationException(JSC__JSValue JSValue0, JSC__VM* arg1)
{
    JSC::Exception* exception = JSC::jsDynamicCast<JSC::Exception*>(*arg1, JSC::JSValue::decode(JSValue0));
    return exception != NULL && arg1->isTerminationException(exception);
}

void JSC__VM__shrinkFootprint(JSC__VM* arg0) { arg0->shrinkFootprintWhenIdle(); };
void JSC__VM__whenIdle(JSC__VM* arg0, void (*ArgFn1)()) { arg0->whenIdle(ArgFn1); };

JSC__VM* JSC__VM__create(unsigned char HeapType0)
{
}

void JSC__VM__holdAPILock(JSC__VM* arg0, void* ctx, void (*callback)(void* arg0))
{
    JSC::JSLockHolder locker(arg0);
    callback(ctx);
}

void JSC__VM__deferGC(JSC__VM* vm, void* ctx, void (*callback)(void* arg0))
{
    JSC::GCDeferralContext deferralContext(reinterpret_cast<JSC__VM&>(vm));
    JSC::DisallowGC disallowGC;

    callback(ctx);
}

void JSC__VM__deleteAllCode(JSC__VM* arg1, JSC__JSGlobalObject* globalObject)
{
    JSC::JSLockHolder locker(globalObject->vm());

    arg1->drainMicrotasks();
    if (JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(globalObject->vm(), globalObject->moduleLoader())) {
        auto id = JSC::Identifier::fromString(globalObject->vm(), "registry");
        JSC::JSMap* map = JSC::JSMap::create(globalObject, globalObject->vm(), globalObject->mapStructure());
        obj->putDirect(globalObject->vm(), id, map);
    }
    arg1->deleteAllCode(JSC::DeleteAllCodeEffort::PreventCollectionAndDeleteAllCode);
    arg1->heap.reportAbandonedObjectGraph();
}

void JSC__VM__doWork(JSC__VM* vm)
{
    vm->deferredWorkTimer->runRunLoop();
}

void JSC__VM__deinit(JSC__VM* arg1, JSC__JSGlobalObject* globalObject) {}
void JSC__VM__drainMicrotasks(JSC__VM* arg0) { arg0->drainMicrotasks(); }

bool JSC__VM__executionForbidden(JSC__VM* arg0) { return (*arg0).executionForbidden(); }

bool JSC__VM__isEntered(JSC__VM* arg0) { return (*arg0).isEntered(); }

void JSC__VM__setExecutionForbidden(JSC__VM* arg0, bool arg1) { (*arg0).setExecutionForbidden(); }

bool JSC__VM__throwError(JSC__VM* arg0, JSC__JSGlobalObject* arg1, JSC__ThrowScope* arg2,
    const unsigned char* arg3, size_t arg4)
{
    auto scope = arg2;
    auto global = arg1;
    const String& message = WTF::String(arg3, arg4);
    return JSC::throwException(global, (*scope), createError(global, message));
}

#pragma mark - JSC::ThrowScope

void JSC__ThrowScope__clearException(JSC__ThrowScope* arg0)
{
    arg0->clearException();
};
bJSC__ThrowScope JSC__ThrowScope__declare(JSC__VM* arg0, unsigned char* arg1, unsigned char* arg2,
    size_t arg3)
{
    Wrap<JSC::ThrowScope, bJSC__ThrowScope> wrapped = Wrap<JSC::ThrowScope, bJSC__ThrowScope>();
    wrapped.cpp = new (wrapped.alignedBuffer()) JSC::ThrowScope(reinterpret_cast<JSC::VM&>(arg0));
    return wrapped.result;
};
JSC__Exception* JSC__ThrowScope__exception(JSC__ThrowScope* arg0) { return arg0->exception(); }
void JSC__ThrowScope__release(JSC__ThrowScope* arg0) { arg0->release(); }

#pragma mark - JSC::CatchScope

void JSC__CatchScope__clearException(JSC__CatchScope* arg0)
{
    arg0->clearException();
}
bJSC__CatchScope JSC__CatchScope__declare(JSC__VM* arg0, unsigned char* arg1, unsigned char* arg2,
    size_t arg3)
{
    JSC::CatchScope scope = JSC::CatchScope(reinterpret_cast<JSC::VM&>(arg0));
    return cast<bJSC__CatchScope>(&scope);
}
JSC__Exception* JSC__CatchScope__exception(JSC__CatchScope* arg0) { return arg0->exception(); }

#pragma mark - JSC::CallFrame

JSC__JSValue JSC__CallFrame__argument(const JSC__CallFrame* arg0, uint16_t arg1)
{
    return JSC::JSValue::encode(arg0->argument(arg1));
};
size_t JSC__CallFrame__argumentsCount(const JSC__CallFrame* arg0) { return arg0->argumentCount(); }
JSC__JSObject* JSC__CallFrame__jsCallee(const JSC__CallFrame* arg0) { return arg0->jsCallee(); }
JSC__JSValue JSC__CallFrame__newTarget(const JSC__CallFrame* arg0)
{
    return JSC::JSValue::encode(arg0->newTarget());
};
JSC__JSValue JSC__CallFrame__thisValue(const JSC__CallFrame* arg0)
{
    return JSC::JSValue::encode(arg0->thisValue());
}
JSC__JSValue JSC__CallFrame__uncheckedArgument(const JSC__CallFrame* arg0, uint16_t arg1)
{
    return JSC::JSValue::encode(arg0->uncheckedArgument(arg1));
}

#pragma mark - JSC::Identifier

void JSC__Identifier__deinit(const JSC__Identifier* arg0)
{
}

bool JSC__Identifier__eqlIdent(const JSC__Identifier* arg0, const JSC__Identifier* arg1)
{
    return arg0 == arg1;
};
bool JSC__Identifier__eqlStringImpl(const JSC__Identifier* arg0, const WTF__StringImpl* arg1)
{
    return JSC::Identifier::equal(arg0->string().impl(), arg1);
};
bool JSC__Identifier__eqlUTF8(const JSC__Identifier* arg0, const unsigned char* arg1, size_t arg2)
{
    return JSC::Identifier::equal(arg0->string().impl(), reinterpret_cast<const LChar*>(arg1), arg2);
};
bool JSC__Identifier__neqlIdent(const JSC__Identifier* arg0, const JSC__Identifier* arg1)
{
    return arg0 != arg1;
}
bool JSC__Identifier__neqlStringImpl(const JSC__Identifier* arg0, const WTF__StringImpl* arg1)
{
    return !JSC::Identifier::equal(arg0->string().impl(), arg1);
};

bJSC__Identifier JSC__Identifier__fromSlice(JSC__VM* arg0, const unsigned char* arg1, size_t arg2)
{
    JSC::Identifier ident = JSC::Identifier::fromString(reinterpret_cast<JSC__VM&>(arg0),
        reinterpret_cast<const LChar*>(arg1), static_cast<int>(arg2));
    return cast<bJSC__Identifier>(&ident);
};
bJSC__Identifier JSC__Identifier__fromString(JSC__VM* arg0, const WTF__String* arg1)
{
    JSC::Identifier ident = JSC::Identifier::fromString(reinterpret_cast<JSC__VM&>(arg0),
        reinterpret_cast<const WTF__String&>(arg1));
    return cast<bJSC__Identifier>(&ident);
};
// bJSC__Identifier JSC__Identifier__fromUid(JSC__VM* arg0, const
// WTF__StringImpl* arg1) {
//     auto ident = JSC::Identifier::fromUid(&arg0, &arg1);
//     return *cast<bJSC__Identifier>(&ident);
// };
bool JSC__Identifier__isEmpty(const JSC__Identifier* arg0) { return arg0->isEmpty(); };
bool JSC__Identifier__isNull(const JSC__Identifier* arg0) { return arg0->isNull(); };
bool JSC__Identifier__isPrivateName(const JSC__Identifier* arg0) { return arg0->isPrivateName(); };
bool JSC__Identifier__isSymbol(const JSC__Identifier* arg0) { return arg0->isSymbol(); };
size_t JSC__Identifier__length(const JSC__Identifier* arg0) { return arg0->length(); };

bWTF__String JSC__Identifier__toString(const JSC__Identifier* arg0)
{
    auto string = arg0->string();
    return cast<bWTF__String>(&string);
};

#pragma mark - WTF::StringView

const uint16_t* WTF__StringView__characters16(const WTF__StringView* arg0)
{
    WTF::StringView* view = (WTF::StringView*)arg0;
    return reinterpret_cast<const uint16_t*>(view->characters16());
}
const unsigned char* WTF__StringView__characters8(const WTF__StringView* arg0)
{
    return reinterpret_cast<const unsigned char*>(arg0->characters8());
};

bool WTF__StringView__is16Bit(const WTF__StringView* arg0) { return !arg0->is8Bit(); };
bool WTF__StringView__is8Bit(const WTF__StringView* arg0) { return arg0->is8Bit(); };
bool WTF__StringView__isEmpty(const WTF__StringView* arg0) { return arg0->isEmpty(); };
size_t WTF__StringView__length(const WTF__StringView* arg0) { return arg0->length(); };

#pragma mark - WTF::StringImpl

const uint16_t* WTF__StringImpl__characters16(const WTF__StringImpl* arg0)
{
    return reinterpret_cast<const uint16_t*>(arg0->characters16());
}
const unsigned char* WTF__StringImpl__characters8(const WTF__StringImpl* arg0)
{
    return reinterpret_cast<const unsigned char*>(arg0->characters8());
}

void WTF__StringView__from8Bit(WTF__StringView* arg0, const unsigned char* arg1, size_t arg2)
{
    *arg0 = WTF::StringView(arg1, arg2);
}

bool WTF__StringImpl__is16Bit(const WTF__StringImpl* arg0) { return !arg0->is8Bit(); }
bool WTF__StringImpl__is8Bit(const WTF__StringImpl* arg0) { return arg0->is8Bit(); }
bool WTF__StringImpl__isEmpty(const WTF__StringImpl* arg0) { return arg0->isEmpty(); }
bool WTF__StringImpl__isExternal(const WTF__StringImpl* arg0) { return arg0->isExternal(); }
bool WTF__StringImpl__isStatic(const WTF__StringImpl* arg0) { return arg0->isStatic(); }
size_t WTF__StringImpl__length(const WTF__StringImpl* arg0) { return arg0->length(); }

#pragma mark - WTF::ExternalStringImpl

const uint16_t* WTF__ExternalStringImpl__characters16(const WTF__ExternalStringImpl* arg0)
{
    return reinterpret_cast<const uint16_t*>(arg0->characters16());
}
const unsigned char* WTF__ExternalStringImpl__characters8(const WTF__ExternalStringImpl* arg0)
{
    return reinterpret_cast<const unsigned char*>(arg0->characters8());
}

bool WTF__ExternalStringImpl__is16Bit(const WTF__ExternalStringImpl* arg0)
{
    return !arg0->is8Bit();
}
bool WTF__ExternalStringImpl__is8Bit(const WTF__ExternalStringImpl* arg0) { return arg0->is8Bit(); }
bool WTF__ExternalStringImpl__isEmpty(const WTF__ExternalStringImpl* arg0)
{
    return arg0->isEmpty();
}
bool WTF__ExternalStringImpl__isExternal(const WTF__ExternalStringImpl* arg0)
{
    return arg0->isExternal();
}
bool WTF__ExternalStringImpl__isStatic(const WTF__ExternalStringImpl* arg0)
{
    return arg0->isStatic();
}
size_t WTF__ExternalStringImpl__length(const WTF__ExternalStringImpl* arg0)
{
    return arg0->length();
}

#pragma mark - WTF::String

const uint16_t* WTF__String__characters16(WTF__String* arg0)
{
    return reinterpret_cast<const uint16_t*>(arg0->characters16());
};
const unsigned char* WTF__String__characters8(WTF__String* arg0)
{
    return reinterpret_cast<const unsigned char*>(arg0->characters8());
};

bool WTF__String__eqlSlice(WTF__String* arg0, const unsigned char* arg1, size_t arg2)
{
    return WTF::equal(arg0->impl(), reinterpret_cast<const LChar*>(arg1), arg2);
}
bool WTF__String__eqlString(WTF__String* arg0, const WTF__String* arg1) { return arg0 == arg1; }
const WTF__StringImpl* WTF__String__impl(WTF__String* arg0) { return arg0->impl(); }

bool WTF__String__is16Bit(WTF__String* arg0) { return !arg0->is8Bit(); }
bool WTF__String__is8Bit(WTF__String* arg0) { return arg0->is8Bit(); }
bool WTF__String__isEmpty(WTF__String* arg0) { return arg0->isEmpty(); }
bool WTF__String__isExternal(WTF__String* arg0) { return arg0->impl()->isExternal(); }
bool WTF__String__isStatic(WTF__String* arg0) { return arg0->impl()->isStatic(); }
size_t WTF__String__length(WTF__String* arg0) { return arg0->length(); }

bWTF__String WTF__String__createFromExternalString(bWTF__ExternalStringImpl arg0)
{
    auto external = Wrap<WTF::ExternalStringImpl, bWTF__ExternalStringImpl>(arg0);
    return Wrap<WTF::String, bWTF__String>(WTF::String(external.cpp)).result;
};

void WTF__String__createWithoutCopyingFromPtr(WTF__String* str, const unsigned char* arg0,
    size_t arg1)
{
    auto new_str = new (reinterpret_cast<char*>(str)) WTF::String(arg0, arg1);
    new_str->impl()->ref();
}

#pragma mark - WTF::URL

bWTF__StringView WTF__URL__encodedPassword(WTF__URL* arg0)
{
    auto result = arg0->encodedPassword();
    return cast<bWTF__StringView>(&result);
};
bWTF__StringView WTF__URL__encodedUser(WTF__URL* arg0)
{
    auto result = arg0->encodedUser();
    return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__fileSystemPath(WTF__URL* arg0)
{
    auto result = arg0->fileSystemPath();
    return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__fragmentIdentifier(WTF__URL* arg0)
{
    auto result = arg0->fragmentIdentifier();
    return cast<bWTF__StringView>(&result);
};
bWTF__StringView WTF__URL__fragmentIdentifierWithLeadingNumberSign(WTF__URL* arg0)
{
    auto result = arg0->fragmentIdentifierWithLeadingNumberSign();
    return cast<bWTF__StringView>(&result);
};
void WTF__URL__fromFileSystemPath(WTF::URL* result, bWTF__StringView arg0)
{
    Wrap<WTF::StringView, bWTF__StringView> fsPath = Wrap<WTF::StringView, bWTF__StringView>(&arg0);
    *result = WTF::URL::fileURLWithFileSystemPath(*fsPath.cpp);
    result->string().impl()->ref();
};
bWTF__URL WTF__URL__fromString(bWTF__String arg0, bWTF__String arg1)
{
    WTF::URL url = WTF::URL(WTF::URL(), cast<WTF::String>(&arg1));
    return cast<bWTF__URL>(&url);
};
bWTF__StringView WTF__URL__host(WTF__URL* arg0)
{
    auto result = arg0->host();
    return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__hostAndPort(WTF__URL* arg0)
{
    auto result = arg0->hostAndPort();
    return cast<bWTF__String>(&result);
};
bool WTF__URL__isEmpty(const WTF__URL* arg0) { return arg0->isEmpty(); };
bool WTF__URL__isValid(const WTF__URL* arg0) { return arg0->isValid(); };
bWTF__StringView WTF__URL__lastPathComponent(WTF__URL* arg0)
{
    auto result = arg0->lastPathComponent();
    return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__password(WTF__URL* arg0)
{
    auto result = arg0->password();
    return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__path(WTF__URL* arg0)
{
    auto wrap = Wrap<WTF::StringView, bWTF__StringView>(arg0->path());
    return wrap.result;
};
bWTF__StringView WTF__URL__protocol(WTF__URL* arg0)
{
    auto result = arg0->protocol();
    return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__protocolHostAndPort(WTF__URL* arg0)
{
    auto result = arg0->protocolHostAndPort();
    return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__query(WTF__URL* arg0)
{
    auto result = arg0->query();
    return cast<bWTF__StringView>(&result);
};
bWTF__StringView WTF__URL__queryWithLeadingQuestionMark(WTF__URL* arg0)
{
    auto result = arg0->queryWithLeadingQuestionMark();
    return cast<bWTF__StringView>(&result);
};
bWTF__String WTF__URL__stringWithoutFragmentIdentifier(WTF__URL* arg0)
{
    auto result = arg0->stringWithoutFragmentIdentifier();
    return cast<bWTF__String>(&result);
};
bWTF__StringView WTF__URL__stringWithoutQueryOrFragmentIdentifier(WTF__URL* arg0)
{
    auto result = arg0->viewWithoutQueryOrFragmentIdentifier();
    return cast<bWTF__StringView>(&result);
};
bWTF__URL WTF__URL__truncatedForUseAsBase(WTF__URL* arg0)
{
    auto result = arg0->truncatedForUseAsBase();
    return cast<bWTF__URL>(&result);
};
bWTF__String WTF__URL__user(WTF__URL* arg0)
{
    auto result = arg0->user();
    return cast<bWTF__String>(&result);
};

void WTF__URL__setHost(WTF__URL* arg0, bWTF__StringView arg1)
{
    arg0->setHost(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setHostAndPort(WTF__URL* arg0, bWTF__StringView arg1)
{
    arg0->setHostAndPort(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setPassword(WTF__URL* arg0, bWTF__StringView arg1)
{
    arg0->setPassword(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setPath(WTF__URL* arg0, bWTF__StringView arg1)
{
    arg0->setPath(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setProtocol(WTF__URL* arg0, bWTF__StringView arg1)
{
    arg0->setProtocol(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setQuery(WTF__URL* arg0, bWTF__StringView arg1)
{
    arg0->setQuery(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};
void WTF__URL__setUser(WTF__URL* arg0, bWTF__StringView arg1)
{
    arg0->setUser(*Wrap<WTF::StringView, bWTF__StringView>::unwrap(&arg1));
};

JSC__JSValue JSC__JSPromise__rejectedPromiseValue(JSC__JSGlobalObject* arg0,
    JSC__JSValue JSValue1)
{
    return JSC::JSValue::encode(
        JSC::JSPromise::rejectedPromise(arg0, JSC::JSValue::decode(JSValue1)));
}
JSC__JSValue JSC__JSPromise__resolvedPromiseValue(JSC__JSGlobalObject* arg0,
    JSC__JSValue JSValue1)
{
    return JSC::JSValue::encode(
        JSC::JSPromise::resolvedPromise(arg0, JSC::JSValue::decode(JSValue1)));
}
}