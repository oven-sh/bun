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

#include "JSFetchHeaders.h"
#include "FetchHeaders.h"
#include "DOMURL.h"
#include "JSDOMURL.h"

#include <string_view>
#include <uws/src/App.h>
#include <uws/uSockets/src/internal/internal.h>
#include "IDLTypes.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertRecord.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMConvertUnion.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMIterator.h"
#include "JSDOMOperation.h"
#include "JSDOMWrapperCache.h"

#include "wtf/text/AtomString.h"
#include "HTTPHeaderNames.h"
#include "JSDOMPromiseDeferred.h"
#include "JavaScriptCore/TestRunnerUtils.h"

template<typename UWSResponse>
static void copyToUWS(WebCore::FetchHeaders* headers, UWSResponse* res)
{
    auto& internalHeaders = headers->internalHeaders();

    for (auto& header : internalHeaders.commonHeaders()) {
        const auto& name = WebCore::httpHeaderNameString(header.key);
        auto& value = header.value;
        res->writeHeader(std::string_view(reinterpret_cast<const char*>(name.characters8()), name.length()), std::string_view(reinterpret_cast<const char*>(value.characters8()), value.length()));
    }

    for (auto& header : internalHeaders.uncommonHeaders()) {
        auto& name = header.key;
        auto& value = header.value;
        res->writeHeader(std::string_view(reinterpret_cast<const char*>(name.characters8()), name.length()), std::string_view(reinterpret_cast<const char*>(value.characters8()), value.length()));
    }
}

using namespace JSC;

template<typename PromiseType, bool isInternal>
static void handlePromise(PromiseType* promise, JSC__JSGlobalObject* globalObject, JSC::EncodedJSValue ctx, JSC__JSValue (*resolverFunction)(JSC__JSGlobalObject* arg0, JSC__CallFrame* callFrame), JSC__JSValue (*rejecterFunction)(JSC__JSGlobalObject* arg0, JSC__CallFrame* callFrame))
{

    auto globalThis = reinterpret_cast<Zig::GlobalObject*>(globalObject);

    if constexpr (!isInternal) {
        JSFunction* performPromiseThenFunction = globalObject->performPromiseThenFunction();
        auto callData = JSC::getCallData(performPromiseThenFunction);
        ASSERT(callData.type != CallData::Type::None);

        MarkedArgumentBuffer arguments;
        arguments.append(promise);
        arguments.append(globalThis->thenable(resolverFunction));
        arguments.append(globalThis->thenable(rejecterFunction));
        arguments.append(jsUndefined());
        arguments.append(JSValue::decode(ctx));
        ASSERT(!arguments.hasOverflowed());
        JSC::call(globalThis, performPromiseThenFunction, callData, jsUndefined(), arguments);
    } else {
        promise->then(globalThis, resolverFunction, rejecterFunction);
    }
}

extern "C" {

void WebCore__FetchHeaders__toUWSResponse(WebCore__FetchHeaders* arg0, bool is_ssl, void* arg2)
{
    if (is_ssl) {
        copyToUWS<uWS::HttpResponse<true>>(arg0, reinterpret_cast<uWS::HttpResponse<true>*>(arg2));
    } else {
        copyToUWS<uWS::HttpResponse<false>>(arg0, reinterpret_cast<uWS::HttpResponse<false>*>(arg2));
    }
}

WebCore__FetchHeaders* WebCore__FetchHeaders__createEmpty()
{
    return new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
}
void WebCore__FetchHeaders__append(WebCore__FetchHeaders* headers, const ZigString* arg1, const ZigString* arg2)
{
    headers->append(Zig::toString(*arg1), Zig::toString(*arg2));
}
WebCore__FetchHeaders* WebCore__FetchHeaders__cast_(JSC__JSValue JSValue0, JSC__VM* vm)
{
    return WebCoreCast<WebCore::JSFetchHeaders, WebCore__FetchHeaders>(JSValue0);
}

using namespace WebCore;

WebCore__FetchHeaders* WebCore__FetchHeaders__createFromJS(JSC__JSGlobalObject* lexicalGlobalObject, JSC__JSValue argument0_)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    EnsureStillAliveScope argument0 = JSC::JSValue::decode(argument0_);
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    auto init = argument0.value().isUndefined() ? std::optional<Converter<IDLUnion<IDLSequence<IDLSequence<IDLByteString>>, IDLRecord<IDLByteString, IDLByteString>>>::ReturnType>() : std::optional<Converter<IDLUnion<IDLSequence<IDLSequence<IDLByteString>>, IDLRecord<IDLByteString, IDLByteString>>>::ReturnType>(convert<IDLUnion<IDLSequence<IDLSequence<IDLByteString>>, IDLRecord<IDLByteString, IDLByteString>>>(*lexicalGlobalObject, argument0.value()));
    RETURN_IF_EXCEPTION(throwScope, nullptr);
    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    if (init)
        headers->fill(WTFMove(init.value()));
    return headers;
}

JSC__JSValue WebCore__FetchHeaders__toJS(WebCore__FetchHeaders* headers, JSC__JSGlobalObject* lexicalGlobalObject)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);

    return JSC::JSValue::encode(WebCore::toJS(lexicalGlobalObject, globalObject, headers));
}
JSC__JSValue WebCore__FetchHeaders__clone(WebCore__FetchHeaders* headers, JSC__JSGlobalObject* arg1)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(arg1);
    auto* clone = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    clone->fill(*headers);
    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(arg1, globalObject, WTFMove(clone)));
}

WebCore__FetchHeaders* WebCore__FetchHeaders__cloneThis(WebCore__FetchHeaders* headers)
{
    auto* clone = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    clone->fill(*headers);
    return clone;
}

bool WebCore__FetchHeaders__fastHas_(WebCore__FetchHeaders* arg0, unsigned char HTTPHeaderName1)
{
    return arg0->fastHas(static_cast<HTTPHeaderName>(HTTPHeaderName1));
}

void WebCore__FetchHeaders__copyTo(WebCore__FetchHeaders* headers, StringPointer* names, StringPointer* values, unsigned char* buf)
{
    auto iter = headers->createIterator();
    uint32_t i = 0;
    unsigned count = 0;
    for (auto pair = iter.next(); pair; pair = iter.next()) {
        auto name = pair->key;
        auto value = pair->value;
        names[count] = { i, name.length() };
        memcpy(&buf[i], name.characters8(), name.length());
        i += name.length();
        values[count++] = { i, value.length() };
        memcpy(&buf[i], value.characters8(), value.length());
        i += value.length();
    }
}
void WebCore__FetchHeaders__count(WebCore__FetchHeaders* headers, uint32_t* count, uint32_t* buf_len)
{
    auto iter = headers->createIterator();
    uint32_t i = 0;
    for (auto pair = iter.next(); pair; pair = iter.next()) {
        i += pair->key.length();
        i += pair->value.length();
    }

    *count = headers->size();
    *buf_len = i;
}

typedef struct ZigSliceString {
    const unsigned char* ptr;
    size_t len;
} ZigSliceString;

typedef struct PicoHTTPHeader {
    ZigSliceString name;
    ZigSliceString value;
} PicoHTTPHeader;

typedef struct PicoHTTPHeaders {
    const PicoHTTPHeader* ptr;
    size_t len;
} PicoHTTPHeaders;

WebCore::FetchHeaders* WebCore__FetchHeaders__createFromPicoHeaders_(const void* arg1)
{
    PicoHTTPHeaders pico_headers = *reinterpret_cast<const PicoHTTPHeaders*>(arg1);
    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });

    if (pico_headers.len > 0) {
        HTTPHeaderMap map = HTTPHeaderMap();

        size_t end = pico_headers.len;

        for (size_t j = 0; j < end; j++) {
            PicoHTTPHeader header = pico_headers.ptr[j];
            if (header.value.len == 0)
                continue;

            StringView nameView = StringView(reinterpret_cast<const char*>(header.name.ptr), header.name.len);

            LChar* data = nullptr;
            auto value = String::createUninitialized(header.value.len, data);
            memcpy(data, header.value.ptr, header.value.len);

            HTTPHeaderName name;

            // memory safety: the header names must be cloned if they're not statically known
            // the value must also be cloned
            // isolatedCopy() doesn't actually clone, it's only for threadlocal isolation
            if (WebCore::findHTTPHeaderName(nameView, name)) {
                map.add(name, value);
            } else {
                // the case where we do not need to clone the name
                // when the header name is already present in the list
                // we don't have that information here, so map.setUncommonHeaderCloneName exists
                map.setUncommonHeaderCloneName(nameView, value);
            }
        }

        headers->setInternalHeaders(WTFMove(map));
    }
    return headers;
}
WebCore::FetchHeaders* WebCore__FetchHeaders__createFromUWS(JSC__JSGlobalObject* arg0, void* arg1)
{
    uWS::HttpRequest req = *reinterpret_cast<uWS::HttpRequest*>(arg1);
    size_t i = 0;

    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    HTTPHeaderMap map = HTTPHeaderMap();

    for (const auto& header : req) {
        StringView nameView = StringView(reinterpret_cast<const LChar*>(header.first.data()), header.first.length());
        size_t name_len = nameView.length();

        LChar* data = nullptr;
        auto value = String::createUninitialized(header.second.length(), data);
        memcpy(data, header.second.data(), header.second.length());

        HTTPHeaderName name;

        if (WebCore::findHTTPHeaderName(nameView, name)) {
            map.add(name, WTFMove(value));
        } else {
            map.setUncommonHeader(nameView.toString().isolatedCopy(), WTFMove(value));
        }

        // seenHeaderSizes[name_len] = true;

        if (i > 56)
            __builtin_unreachable();
    }

    headers->setInternalHeaders(WTFMove(map));
    return headers;
}
void WebCore__FetchHeaders__deref(WebCore__FetchHeaders* arg0)
{
    arg0->deref();
}

JSC__JSValue WebCore__FetchHeaders__createValue(JSC__JSGlobalObject* arg0, StringPointer* arg1, StringPointer* arg2, const ZigString* arg3, uint32_t count)
{
    Vector<KeyValuePair<String, String>> pairs;
    pairs.reserveCapacity(count);
    ZigString buf = *arg3;
    for (uint32_t i = 0; i < count; i++) {
        WTF::String name = Zig::toStringCopy(buf, arg1[i]);
        WTF::String value = Zig::toStringCopy(buf, arg2[i]);
        pairs.uncheckedAppend(KeyValuePair<String, String>(name, value));
    }

    Ref<WebCore::FetchHeaders> headers = WebCore::FetchHeaders::create();
    headers->fill(WebCore::FetchHeaders::Init(WTFMove(pairs)));
    pairs.releaseBuffer();
    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(arg0, reinterpret_cast<Zig::GlobalObject*>(arg0), WTFMove(headers)));
}
void WebCore__FetchHeaders__get_(WebCore__FetchHeaders* headers, const ZigString* arg1, ZigString* arg2)
{
    *arg2 = Zig::toZigString(headers->get(Zig::toString(*arg1)).releaseReturnValue());
}
bool WebCore__FetchHeaders__has(WebCore__FetchHeaders* headers, const ZigString* arg1)
{
    return headers->has(Zig::toString(*arg1)).releaseReturnValue();
}
void WebCore__FetchHeaders__put_(WebCore__FetchHeaders* headers, const ZigString* arg1, const ZigString* arg2)
{
    headers->set(Zig::toString(*arg1), Zig::toString(*arg2));
}
void WebCore__FetchHeaders__remove(WebCore__FetchHeaders* headers, const ZigString* arg1)
{
    headers->remove(Zig::toString(*arg1));
}

void WebCore__FetchHeaders__fastRemove_(WebCore__FetchHeaders* headers, unsigned char headerName)
{
    headers->fastRemove(static_cast<WebCore::HTTPHeaderName>(headerName));
}

void WebCore__FetchHeaders__fastGet_(WebCore__FetchHeaders* headers, unsigned char headerName, ZigString* arg2)
{
    auto str = headers->fastGet(static_cast<WebCore::HTTPHeaderName>(headerName));
    if (!str) {
        return;
    }

    *arg2 = Zig::toZigString(str);
}

WebCore__DOMURL* WebCore__DOMURL__cast_(JSC__JSValue JSValue0, JSC::VM* vm)
{
    return WebCoreCast<WebCore::JSDOMURL, WebCore__DOMURL>(JSValue0);
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

    JSC::JSObject* result
        = JSC::ErrorInstance::create(globalObject, JSC::ErrorInstance::createStructure(vm, globalObject, globalObject->errorPrototype()), message, options);

    auto clientData = WebCore::clientData(vm);

    if (err.code.len > 0 && !(err.code.len == 1 and err.code.ptr[0] == 0)) {
        JSC::JSValue code = Zig::toJSStringGC(err.code, globalObject);
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

    if (err.fd != -1) {
        JSC::JSValue fd = JSC::JSValue(jsNumber(err.fd));
        result->putDirect(vm, JSC::Identifier::fromString(vm, "fd"_s), fd,
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

    object->methodTable()->defineOwnProperty(object, global, ident, descriptor, true);
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

    object->methodTable()->defineOwnProperty(object, global, ident, descriptor, true);
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

void JSC__JSFunction__optimizeSoon(JSC__JSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    JSC::optimizeNextInvocation(value);
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
void JSC__JSValue___then(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, JSC__JSValue arg2, JSC__JSValue (*ArgFn3)(JSC__JSGlobalObject* arg0, JSC__CallFrame* arg1), JSC__JSValue (*ArgFn4)(JSC__JSGlobalObject* arg0, JSC__CallFrame* arg1))
{

    auto* cell = JSC::JSValue::decode(JSValue0).asCell();

    if (JSC::JSPromise* promise = JSC::jsDynamicCast<JSC::JSPromise*>(cell)) {
        handlePromise<JSC::JSPromise, false>(promise, arg1, arg2, ArgFn3, ArgFn4);
    } else if (JSC::JSInternalPromise* promise = JSC::jsDynamicCast<JSC::JSInternalPromise*>(cell)) {
        RELEASE_ASSERT(false);
    }
}

JSC__JSValue JSC__JSValue__parseJSON(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(JSValue0);

    JSC::JSValue result = JSC::JSONParse(arg1, jsValue.toWTFString(arg1));

    if (!result) {
        result = JSC::JSValue(JSC::createSyntaxError(arg1->globalObject(), "Failed to parse JSON"_s));
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
        global->moduleLoader()->getDirect(global->vm(), JSC::Identifier::fromString(global->vm(), "registry"_s)));
    if (!map)
        return;
    const JSC::Identifier identifier = Zig::toIdentifier(*arg1, global);
    JSC::JSValue val = JSC::identifierToJSValue(global->vm(), identifier);

    map->remove(global, val);
}

void JSC__VM__collectAsync(JSC__VM* vm)
{
    vm->heap.collectAsync();
}

size_t JSC__VM__heapSize(JSC__VM* arg0)
{
    return arg0->heap.size();
}

// This is very naive!
JSC__JSInternalPromise* JSC__VM__reloadModule(JSC__VM* vm, JSC__JSGlobalObject* arg1,
    ZigString arg2)
{
    return nullptr;
    // JSC::JSMap *map = JSC::jsDynamicCast<JSC::JSMap *>(
    //   arg1->vm(), arg1->moduleLoader()->getDirect(
    //                 arg1->vm(), JSC::Identifier::fromString(arg1->vm(), "registry"_s)));

    // const JSC::Identifier identifier = Zig::toIdentifier(arg2, arg1);
    // JSC::JSValue val = JSC::identifierToJSValue(arg1->vm(), identifier);

    // if (!map->has(arg1, val)) return nullptr;

    // if (JSC::JSObject *registryEntry =
    //       JSC::jsDynamicCast<JSC::JSObject *>(arg1-> map->get(arg1, val))) {
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
    JSC::JSValue left = JSC::JSValue::decode(JSValue0);
    JSC::JSValue right = JSC::JSValue::decode(JSValue1);
    return JSC::sameValue(globalObject, left, right);
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

    auto callData = getCallData(jsObject);
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

    auto callData = getCallData(jsObject);
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

void JSC__JSString__toZigString(JSC__JSString* arg0, JSC__JSGlobalObject* arg1, ZigString* arg2)
{
    *arg2 = Zig::toZigString(arg0->value(arg1));
}

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

void Microtask__run_default(void* microtask, void* global)
{
    reinterpret_cast<Zig::JSMicrotaskCallbackDefaultGlobal*>(microtask)->call(reinterpret_cast<Zig::GlobalObject*>(global));
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
JSC__JSValue JSC__JSModuleLoader__evaluate(JSC__JSGlobalObject* globalObject, const unsigned char* arg1,
    size_t arg2, const unsigned char* originUrlPtr, size_t originURLLen, const unsigned char* referrerUrlPtr, size_t referrerUrlLen,
    JSC__JSValue JSValue5, JSC__JSValue* arg6)
{
    WTF::String src = WTF::String::fromUTF8(arg1, arg2).isolatedCopy();
    WTF::URL origin = WTF::URL::fileURLWithFileSystemPath(WTF::String::fromUTF8(originUrlPtr, originURLLen)).isolatedCopy();
    WTF::URL referrer = WTF::URL::fileURLWithFileSystemPath(WTF::String::fromUTF8(referrerUrlPtr, referrerUrlLen)).isolatedCopy();

    JSC::VM& vm = globalObject->vm();

    JSC::SourceCode sourceCode = JSC::makeSource(
        src, JSC::SourceOrigin { origin }, origin.fileSystemPath(),
        WTF::TextPosition(), JSC::SourceProviderSourceType::Module);
    globalObject->moduleLoader()->provideFetch(globalObject, jsString(vm, origin.fileSystemPath()), WTFMove(sourceCode));
    auto* promise = JSC::importModule(globalObject, JSC::Identifier::fromString(vm, origin.fileSystemPath()), JSValue(jsString(vm, referrer.fileSystemPath())), JSValue(), JSValue());

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (scope.exception()) {
        promise->rejectWithCaughtException(globalObject, scope);
    }

    if (promise->status(vm) == JSC::JSPromise::Status::Fulfilled) {
        return JSC::JSValue::encode(promise->result(vm));
    } else if (promise->status(vm) == JSC::JSPromise::Status::Rejected) {
        *arg6 = JSC::JSValue::encode(promise->result(vm));
        return JSC::JSValue::encode(JSC::jsUndefined());
    } else {
        return JSC::JSValue::encode(promise);
    }
}
JSC__JSInternalPromise* JSC__JSModuleLoader__importModule(JSC__JSGlobalObject* arg0,
    const JSC__Identifier* arg1)
{
    return JSC::importModule(arg0, *arg1, JSC::JSValue {}, JSC::JSValue {}, JSC::JSValue {});
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

JSC__JSValue ReadableStream__empty(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);
    auto* function = globalObject->getDirect(vm, clientData->builtinNames().createEmptyReadableStreamPrivateName()).getObject();
    return JSValue::encode(JSC::call(globalObject, function, JSC::ArgList(), "ReadableStream.create"_s));
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
    if (UNLIKELY(!value) || !value.isCell()) {
        return false;
    }

    auto type = value.asCell()->type();

    switch (type) {
    case JSC::JSType::Uint8ArrayType:
    case JSC::JSType::Int8ArrayType:
    case JSC::JSType::DataViewType:
    case JSC::JSType::Uint8ClampedArrayType:
    case JSC::JSType::Int16ArrayType:
    case JSC::JSType::Uint16ArrayType:
    case JSC::JSType::Int32ArrayType:
    case JSC::JSType::Uint32ArrayType:
    case JSC::JSType::Float32ArrayType:
    case JSC::JSType::Float64ArrayType:
    case JSC::JSType::BigInt64ArrayType:
    case JSC::JSType::BigUint64ArrayType: {
        JSC::JSArrayBufferView* typedArray = JSC::jsCast<JSC::JSArrayBufferView*>(value);
        arg2->len = typedArray->length();
        arg2->byte_len = typedArray->byteLength();
        // the offset is already set by vector()
        // https://github.com/oven-sh/bun/issues/561
        arg2->offset = 0;
        arg2->cell_type = type;
        arg2->ptr = (char*)typedArray->vectorWithoutPACValidation();
        arg2->_value = JSValue::encode(value);
        return true;
    }
    case JSC::JSType::ArrayBufferType: {
        JSC::ArrayBuffer* typedArray = JSC::jsCast<JSC::JSArrayBuffer*>(value)->impl();
        arg2->len = typedArray->byteLength();
        arg2->byte_len = typedArray->byteLength();
        arg2->offset = 0;
        arg2->cell_type = JSC::JSType::ArrayBufferType;
        arg2->ptr = (char*)typedArray->data();
        arg2->shared = typedArray->isShared();
        arg2->_value = JSValue::encode(value);
        return true;
    }
    case JSC::JSType::ObjectType:
    case JSC::JSType::FinalObjectType: {
        if (JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value)) {
            arg2->len = view->length();
            arg2->byte_len = view->byteLength();
            arg2->offset = 0;
            arg2->cell_type = view->type();
            arg2->ptr = (char*)view->vectorWithoutPACValidation();
            arg2->_value = JSValue::encode(value);
            return true;
        }

        if (JSC::JSArrayBuffer* jsBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(value)) {
            JSC::ArrayBuffer* buffer = jsBuffer->impl();
            if (!buffer)
                return false;
            arg2->len = buffer->byteLength();
            arg2->byte_len = buffer->byteLength();
            arg2->offset = 0;
            arg2->cell_type = JSC::JSType::ArrayBufferType;
            arg2->ptr = (char*)buffer->data();
            arg2->_value = JSValue::encode(value);
            return true;
        }
        break;
    }
    }

    return false;
}
JSC__JSValue JSC__JSValue__createStringArray(JSC__JSGlobalObject* globalObject, ZigString* arg1,
    size_t arg2, bool clone)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (arg2 == 0) {
        return JSC::JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr));
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

JSC__JSValue ZigString__toAtomicValue(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    if (arg0->len == 0) {
        return JSC::JSValue::encode(JSC::jsEmptyString(arg1->vm()));
    }

    if (isTaggedUTF16Ptr(arg0->ptr)) {
        if (auto impl = WTF::AtomStringImpl::lookUp(reinterpret_cast<const UChar*>(untag(arg0->ptr)), arg0->len)) {
            return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::String(WTFMove(impl))));
        }
    } else {
        if (auto impl = WTF::AtomStringImpl::lookUp(untag(arg0->ptr), arg0->len)) {
            return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::String(WTFMove(impl))));
        }
    }

    return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(arg1->vm(), makeAtomString(Zig::toStringCopy(*arg0)))));
}

JSC__JSValue ZigString__to16BitValue(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    auto str = WTF::String::fromUTF8(arg0->ptr, arg0->len);
    return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(arg1->vm(), str)));
}

JSC__JSValue ZigString__toExternalU16(const uint16_t* arg0, size_t len, JSC__JSGlobalObject* global)
{
    auto ref = String(ExternalStringImpl::create(reinterpret_cast<const UChar*>(arg0), len, reinterpret_cast<void*>(const_cast<uint16_t*>(arg0)), free_global_string));

    return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(
        global->vm(), WTFMove(ref))));
}
// This must be a globally allocated string
JSC__JSValue ZigString__toExternalValue(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    ZigString str = *arg0;
    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        auto ref = String(ExternalStringImpl::create(reinterpret_cast<const UChar*>(Zig::untag(str.ptr)), str.len, Zig::untagVoid(str.ptr), free_global_string));

        return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(
            arg1->vm(), WTFMove(ref))));
    } else {
        auto ref = String(ExternalStringImpl::create(Zig::untag(str.ptr), str.len, Zig::untagVoid(str.ptr), free_global_string));
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(
            arg1->vm(),
            WTFMove(ref))));
    }
}

VirtualMachine* JSC__JSGlobalObject__bunVM(JSC__JSGlobalObject* arg0)
{
    return reinterpret_cast<VirtualMachine*>(reinterpret_cast<Zig::GlobalObject*>(arg0)->bunVM());
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
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(
            arg1->vm(),
            WTF::String(ExternalStringImpl::create(reinterpret_cast<const UChar*>(Zig::untag(str.ptr)), str.len, arg2, ArgFn3)))));
    } else {
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(
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
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(arg0);
    JSC::JSPromise* promise = JSC::JSPromise::create(arg0->vm(), arg0->promiseStructure());
    promise->internalField(JSC::JSPromise::Field::Flags).set(arg0->vm(), promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Fulfilled)));
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(arg0->vm(), promise, JSC::JSValue::decode(JSValue1));
    JSC::ensureStillAliveHere(promise);
    JSC::ensureStillAliveHere(JSC::JSValue::decode(JSValue1));
    return promise;
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

void JSC__JSGlobalObject__handleRejectedPromises(JSC__JSGlobalObject* arg0)
{
    return static_cast<Zig::GlobalObject*>(arg0)->handleRejectedPromises();
}

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
    return JSC::jsDynamicCast<JSC::Exception*>(JSC::JSValue::decode(JSValue0)) != nullptr;
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
    return value.isConstructor();
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
    JSValue value = JSC::JSValue::decode(JSValue0);
    if (value.isUndefinedOrNull() || !value || !value.isObject()) {
        return false;
    }

    if (JSC::ErrorInstance* err = JSC::jsDynamicCast<JSC::ErrorInstance*>(value)) {
        return err->errorType() == JSC::ErrorType::AggregateError;
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
    return JSC::JSValue::decode(JSValue0).isCallable();
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
    return JSValue0 != 0 && JSC::JSValue::decode(JSValue0).isObject();
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

JSC__JSValue JSC__JSValue__fromInt64NoTruncate(JSC__JSGlobalObject* globalObject, int64_t val)
{
    return JSC::JSValue::encode(JSC::JSValue(JSC::JSBigInt::createFrom(globalObject, val)));
}

JSC__JSValue JSC__JSValue__fromUInt64NoTruncate(JSC__JSGlobalObject* globalObject, uint64_t val)
{
    return JSC::JSValue::encode(JSC::JSValue(JSC::JSBigInt::createFrom(globalObject, val)));
}

uint64_t JSC__JSValue__toUInt64NoTruncate(JSC__JSValue val)
{
    JSC::JSValue _val = JSC::JSValue::decode(val);

    int64_t result = JSC::tryConvertToInt52(_val.asDouble());
    if (result != JSC::JSValue::notInt52) {
        if (result < 0)
            return 0;

        return static_cast<uint64_t>(result);
    }

    if (_val.isHeapBigInt()) {

        if (auto* heapBigInt = _val.asHeapBigInt()) {
            return heapBigInt->toBigUInt64(heapBigInt);
        }
    }

    if (!_val.isNumber()) {
        return 0;
    }

    return static_cast<uint64_t>(_val.asAnyInt());
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

    object->methodTable()
        ->defineOwnProperty(object, globalObject, key2, descriptor2, true);
    object->methodTable()
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

    *arg2 = Zig::toZigString(JSC::jsString(vm, String { uid }), arg1);
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

static void populateStackFrameMetadata(JSC::VM& vm, const JSC::StackFrame* stackFrame, ZigStackFrame* frame)
{
    frame->source_url = Zig::toZigString(stackFrame->sourceURL(vm));

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
    JSC::JSValue name = callee->getDirect(vm, vm.propertyNames->name);
    if (name && name.isString()) {
        auto str = name.toWTFString(m_codeBlock->globalObject());
        frame->function_name = Zig::toZigString(str);
        return;
    }

    /* For functions (either JSFunction or InternalFunction), fallback to their "native" name
     * property. Based on JSC::getCalculatedDisplayName, "inlining" the
     * JSFunction::calculatedDisplayName\InternalFunction::calculatedDisplayName calls */
    if (JSC::JSFunction* function = JSC::jsDynamicCast<JSC::JSFunction*>(callee)) {

        WTF::String actualName = function->name(vm);
        if (!actualName.isEmpty() || function->isHostOrBuiltinFunction()) {
            frame->function_name = Zig::toZigString(actualName);
            return;
        }

        auto inferred_name = function->jsExecutable()->name();
        frame->function_name = Zig::toZigString(inferred_name.string());
    }

    if (JSC::InternalFunction* function = JSC::jsDynamicCast<JSC::InternalFunction*>(callee)) {
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
static void populateStackFrame(JSC::VM& vm, ZigStackTrace* trace, const JSC::StackFrame* stackFrame,
    ZigStackFrame* frame, bool is_top)
{
    populateStackFrameMetadata(vm, stackFrame, frame);
    populateStackFramePosition(stackFrame, is_top ? trace->source_lines_ptr : nullptr,
        is_top ? trace->source_lines_numbers : nullptr,
        is_top ? trace->source_lines_to_collect : 0, &frame->position);
}
static void populateStackTrace(JSC::VM& vm, const WTF::Vector<JSC::StackFrame>& frames, ZigStackTrace* trace)
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
        populateStackFrame(vm, trace, &frames[stack_frame_i], frame, frame_i == 0);
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
    JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(val);

    bool getFromSourceURL = false;
    if (stackTrace != nullptr && stackTrace->size() > 0) {
        populateStackTrace(global->vm(), *stackTrace, &except->stack);
    } else if (err->stackTrace() != nullptr && err->stackTrace()->size() > 0) {
        populateStackTrace(global->vm(), *err->stackTrace(), &except->stack);
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

        if (JSC::JSValue fd = obj->getIfPropertyExists(global, Identifier::fromString(global->vm(), "fd"_s))) {
            if (fd.isAnyInt()) {
                except->fd = fd.toInt32(global);
            }
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
    if (JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(value)) {
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

void JSC__VM__releaseWeakRefs(JSC__VM* arg0)
{
    arg0->finalizeSynchronousJSExecution();
}

static auto function_string_view = MAKE_STATIC_STRING_IMPL("Function");
void JSC__JSValue__getClassName(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigString* arg2)
{
    JSC::JSCell* cell = JSC::JSValue::decode(JSValue0).asCell();
    if (cell == nullptr) {
        arg2->len = 0;
        return;
    }

    const char* ptr = cell->className();
    auto view = WTF::StringView(ptr, strlen(ptr));

    // Fallback to .name if className is empty
    if (view.length() == 0 || StringView(String(function_string_view)) == view) {
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
    JSC::VM& vm = arg1->vm();

    if (obj == nullptr) {
        arg2->len = 0;
        return;
    }

    JSC::JSValue name = obj->getDirect(vm, vm.propertyNames->toStringTagSymbol);
    if (name == JSC::JSValue {}) {
        name = obj->getDirect(vm, vm.propertyNames->name);
    }

    if (name && name.isString()) {
        auto str = name.toWTFString(arg1);
        if (!str.isEmpty()) {
            *arg2 = Zig::toZigString(str);
            return;
        }
    }

    if (JSC::JSFunction* function = JSC::jsDynamicCast<JSC::JSFunction*>(obj)) {

        WTF::String actualName = function->name(vm);
        if (!actualName.isEmpty() || function->isHostOrBuiltinFunction()) {
            *arg2 = Zig::toZigString(actualName);
            return;
        }

        actualName = function->jsExecutable()->name().string();

        *arg2 = Zig::toZigString(actualName);
        return;
    }

    if (JSC::InternalFunction* function = JSC::jsDynamicCast<JSC::InternalFunction*>(obj)) {
        auto view = WTF::StringView(function->name());
        *arg2 = Zig::toZigString(view);
        return;
    }

    arg2->len = 0;
}

JSC__JSValue JSC__JSValue__toError(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (JSC::Exception* jscException = JSC::jsDynamicCast<JSC::Exception*>(value)) {
        if (JSC::ErrorInstance* error = JSC::jsDynamicCast<JSC::ErrorInstance*>(jscException->value())) {
            return JSC::JSValue::encode(JSC::JSValue(error));
        }
    }
    if (JSC::ErrorInstance* error = JSC::jsDynamicCast<JSC::ErrorInstance*>(value)) {
        return JSC::JSValue::encode(JSC::JSValue(error));
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

void JSC__JSValue__toZigException(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1,
    ZigException* exception)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (value == JSC::JSValue {}) {
        exception->code = JSErrorCodeError;
        exception->name = Zig::toZigString("Error"_s);
        exception->message = Zig::toZigString("Unknown error"_s);
        return;
    }

    if (JSC::Exception* jscException = JSC::jsDynamicCast<JSC::Exception*>(value)) {
        if (JSC::ErrorInstance* error = JSC::jsDynamicCast<JSC::ErrorInstance*>(jscException->value())) {
            fromErrorInstance(exception, arg1, error, &jscException->stack(), value);
            return;
        }
    }

    if (JSC::ErrorInstance* error = JSC::jsDynamicCast<JSC::ErrorInstance*>(value)) {
        fromErrorInstance(exception, arg1, error, nullptr, value);
        return;
    }

    exceptionFromString(exception, value, arg1);
}

void JSC__Exception__getStackTrace(JSC__Exception* arg0, ZigStackTrace* trace)
{
    populateStackTrace(arg0->vm(), arg0->stack(), trace);
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

    vm->finalizeSynchronousJSExecution();

    if (sync) {
        vm->heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
    } else {
        vm->heap.collectSync(JSC::CollectionScope::Full);
    }

    vm->finalizeSynchronousJSExecution();

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
    JSC::Exception* exception = JSC::jsDynamicCast<JSC::Exception*>(JSC::JSValue::decode(JSValue0));
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

void JSC__JSString__iterator(JSC__JSString* arg0, JSC__JSGlobalObject* arg1, void* arg2)
{
    jsstring_iterator* iter = (jsstring_iterator*)arg2;
    arg0->value(iter);
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
    if (JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(globalObject->moduleLoader())) {
        auto id = JSC::Identifier::fromString(globalObject->vm(), "registry"_s);
        JSC::JSMap* map = JSC::JSMap::create(globalObject->vm(), globalObject->mapStructure());
        obj->putDirect(globalObject->vm(), id, map);
    }
    arg1->deleteAllCode(JSC::DeleteAllCodeEffort::PreventCollectionAndDeleteAllCode);
    arg1->heap.reportAbandonedObjectGraph();
}

void JSC__VM__doWork(JSC__VM* vm)
{
    vm->deferredWorkTimer->doWork(*vm);
}

void JSC__VM__deinit(JSC__VM* arg1, JSC__JSGlobalObject* globalObject) {}
void JSC__VM__drainMicrotasks(JSC__VM* arg0) { arg0->drainMicrotasks(); }

bool JSC__VM__executionForbidden(JSC__VM* arg0) { return (*arg0).executionForbidden(); }

bool JSC__VM__isEntered(JSC__VM* arg0) { return (*arg0).isEntered(); }

void JSC__VM__setExecutionForbidden(JSC__VM* arg0, bool arg1) { (*arg0).setExecutionForbidden(); }

void JSC__VM__throwError(JSC__VM* vm_, JSC__JSGlobalObject* arg1, JSC__JSValue value)
{
    JSC::VM& vm = *reinterpret_cast<JSC::VM*>(vm_);

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* error = JSC::JSValue::decode(value).getObject();
    JSC::Exception* exception = JSC::Exception::create(vm, error);
    scope.throwException(arg1, exception);
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
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(arg0);
    JSC::JSPromise* promise = JSC::JSPromise::create(arg0->vm(), arg0->promiseStructure());
    promise->internalField(JSC::JSPromise::Field::Flags).set(arg0->vm(), promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Rejected)));
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(arg0->vm(), promise, JSC::JSValue::decode(JSValue1));
    JSC::ensureStillAliveHere(promise);
    JSC::ensureStillAliveHere(JSC::JSValue::decode(JSValue1));
    return JSC::JSValue::encode(promise);
}
JSC__JSValue JSC__JSPromise__resolvedPromiseValue(JSC__JSGlobalObject* arg0,
    JSC__JSValue JSValue1)
{
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(arg0);
    JSC::JSPromise* promise = JSC::JSPromise::create(arg0->vm(), arg0->promiseStructure());
    promise->internalField(JSC::JSPromise::Field::Flags).set(arg0->vm(), promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Fulfilled)));
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(arg0->vm(), promise, JSC::JSValue::decode(JSValue1));
    JSC::ensureStillAliveHere(promise);
    JSC::ensureStillAliveHere(JSC::JSValue::decode(JSValue1));
    return JSC::JSValue::encode(promise);
}
}

JSC__JSValue JSC__JSValue__createUninitializedUint8Array(JSC__JSGlobalObject* arg0, size_t arg1)
{
    JSC::JSValue value = JSC::JSUint8Array::createUninitialized(arg0, arg0->m_typedArrayUint8.get(arg0), arg1);
    return JSC::JSValue::encode(value);
}

enum class BuiltinNamesMap : uint8_t {
    method,
    headers,
    status,
    url,
    body,
    data,
};

static JSC::Identifier builtinNameMap(JSC::JSGlobalObject* globalObject, unsigned char name)
{
    auto clientData = WebCore::clientData(globalObject->vm());
    switch (static_cast<BuiltinNamesMap>(name)) {
    case BuiltinNamesMap::method: {
        return clientData->builtinNames().methodPublicName();
    }
    case BuiltinNamesMap::headers: {
        return clientData->builtinNames().headersPublicName();
    }
    case BuiltinNamesMap::status: {
        return clientData->builtinNames().statusPublicName();
    }
    case BuiltinNamesMap::url: {
        return clientData->builtinNames().urlPublicName();
    }
    case BuiltinNamesMap::body: {
        return clientData->builtinNames().bodyPublicName();
    }
    case BuiltinNamesMap::data: {
        return clientData->builtinNames().dataPublicName();
    }
    }
}

JSC__JSValue JSC__JSValue__fastGet_(JSC__JSValue JSValue0, JSC__JSGlobalObject* globalObject, unsigned char arg2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (!value.isCell()) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    return JSValue::encode(
        value.getObject()->getIfPropertyExists(globalObject, builtinNameMap(globalObject, arg2)));
}
