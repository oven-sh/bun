

#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/ExceptionHelpers.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSCell.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "BufferEncodingType.h"
#include "JavaScriptCore/JSCJSValue.h"

#include "JSBuffer.h"

#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/ExceptionScope.h"

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

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>

#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>
#include <wtf/PointerPreparations.h>
#include <wtf/URL.h>
#include <wtf/text/WTFString.h>
#include <JavaScriptCore/BuiltinNames.h>

#include "JSBufferEncodingType.h"
#include "ErrorCode.h"
#include "NodeValidator.h"
#include "wtf/Assertions.h"
#include "wtf/Forward.h"
#include <JavaScriptCore/JSBase.h>
#if ENABLE(MEDIA_SOURCE)
#include "BufferMediaSource.h"
#include "JSMediaSource.h"
#endif

#if OS(WINDOWS)
#include <windows.h>
#endif

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"
#include <JavaScriptCore/DFGAbstractHeap.h>

// #include <JavaScriptCore/JSTypedArrayViewPrototype.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>

extern "C" bool Bun__Node__ZeroFillBuffers;

// SIMD-optimized search functions from highway_strings.cpp
extern "C" void* highway_memmem(const uint8_t* haystack, size_t haystack_len, const uint8_t* needle, size_t needle_len);
extern "C" size_t highway_index_of_char(const uint8_t* haystack, size_t haystack_len, uint8_t needle);

// export fn Bun__inspect_singleline(globalThis: *JSGlobalObject, value: JSValue) bun.String
extern "C" BunString Bun__inspect_singleline(JSC::JSGlobalObject* globalObject, JSC::JSValue value);

using namespace JSC;
using namespace WebCore;

static_assert(std::is_same_v<JSBigInt::Digit, uint64_t>, "all Buffer BigInt functions assume bigint digits are 64 bits");

JSC_DECLARE_HOST_FUNCTION(constructJSBuffer);
JSC_DECLARE_HOST_FUNCTION(callJSBuffer);

JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_alloc);
JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_allocUnsafe);
JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_allocUnsafeSlow);
JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_byteLength);
JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_compare);
JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_concat);
JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_copyBytesFrom);
JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_isBuffer);
JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_isEncoding);

JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_compare);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_copy);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_equals);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_fill);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_includes);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_indexOf);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_inspect);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_lastIndexOf);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_swap16);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_swap32);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_swap64);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_toString);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_write);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_writeBigInt64LE);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_writeBigInt64BE);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_writeBigUInt64LE);
JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_writeBigUInt64BE);

extern "C" EncodedJSValue WebCore_BufferEncodingType_toJS(JSC::JSGlobalObject* lexicalGlobalObject, WebCore::BufferEncodingType encoding)
{
    // clang-format off
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    switch (encoding) {
    case WebCore::BufferEncodingType::utf8:      return JSC::JSValue::encode(globalObject->commonStrings().utf8String(globalObject));
    case WebCore::BufferEncodingType::ucs2:      return JSC::JSValue::encode(globalObject->commonStrings().ucs2String(globalObject));
    case WebCore::BufferEncodingType::utf16le:   return JSC::JSValue::encode(globalObject->commonStrings().utf16leString(globalObject));
    case WebCore::BufferEncodingType::latin1:    return JSC::JSValue::encode(globalObject->commonStrings().latin1String(globalObject));
    case WebCore::BufferEncodingType::ascii:     return JSC::JSValue::encode(globalObject->commonStrings().asciiString(globalObject));
    case WebCore::BufferEncodingType::base64:    return JSC::JSValue::encode(globalObject->commonStrings().base64String(globalObject));
    case WebCore::BufferEncodingType::base64url: return JSC::JSValue::encode(globalObject->commonStrings().base64urlString(globalObject));
    case WebCore::BufferEncodingType::hex:       return JSC::JSValue::encode(globalObject->commonStrings().hexString(globalObject));
    case WebCore::BufferEncodingType::buffer:    return JSC::JSValue::encode(globalObject->commonStrings().bufferString(globalObject));
    }
    // clang-format on
}

namespace Bun {

// Use a JSString* here to avoid unnecessarily joining the rope string.
// If we're only getting the length property, it won't join the rope string.
std::optional<double> byteLength(JSC::JSString* str, JSC::JSGlobalObject* lexicalGlobalObject, WebCore::BufferEncodingType encoding)
{
    if (str->length() == 0)
        return 0;

    switch (encoding) {

    case WebCore::BufferEncodingType::ucs2:
    case WebCore::BufferEncodingType::utf16le: {
        // https://github.com/nodejs/node/blob/e676942f814915b2d24fc899bb42dc71ae6c8226/lib/buffer.js#L600
        return str->length() * 2;
    }

    case WebCore::BufferEncodingType::latin1:
    case WebCore::BufferEncodingType::ascii: {
        // https://github.com/nodejs/node/blob/e676942f814915b2d24fc899bb42dc71ae6c8226/lib/buffer.js#L627
        return str->length();
    }

    case WebCore::BufferEncodingType::base64:
    case WebCore::BufferEncodingType::base64url: {
        int64_t length = str->length();
        const auto view = str->view(lexicalGlobalObject);
        if (view->isNull()) [[unlikely]] {
            return std::nullopt;
        }

        if (view->is8Bit()) {
            const auto span = view->span8();
            if (span.data()[length - 1] == 0x3D) {
                length--;

                if (length > 1 && span.data()[length - 1] == '=')
                    length--;
            }
        } else {
            const auto span = view->span16();
            if (span.data()[length - 1] == 0x3D) {
                length--;

                if (length > 1 && span.data()[length - 1] == '=')
                    length--;
            }
        }

        // https://github.com/nodejs/node/blob/e676942f814915b2d24fc899bb42dc71ae6c8226/lib/buffer.js#L579
        return static_cast<double>((length * 3) >> 2);
    }

    case WebCore::BufferEncodingType::hex: {
        return str->length() >> 1;
    }

    case WebCore::BufferEncodingType::utf8: {
        const auto view = str->view(lexicalGlobalObject);
        if (view->isNull()) [[unlikely]] {
            return std::nullopt;
        }

        if (view->is8Bit()) {
            const auto span = view->span8();
            return Bun__encoding__byteLengthLatin1AsUTF8(span.data(), span.size());
        } else {
            const auto span = view->span16();
            return Bun__encoding__byteLengthUTF16AsUTF8(span.data(), span.size());
        }
    }
    default: {
        RELEASE_ASSERT_NOT_REACHED();
    }
    }

    return std::nullopt;
}
}

static JSUint8Array* allocBuffer(JSC::JSGlobalObject* lexicalGlobalObject, size_t byteLength)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* subclassStructure = globalObject->JSBufferSubclassStructure();

    auto* uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, byteLength);
    // it should have thrown an exception already
    EXCEPTION_ASSERT(!!throwScope.exception() == !uint8Array);

    return uint8Array;
}

static JSUint8Array* allocBufferUnsafe(JSC::JSGlobalObject* lexicalGlobalObject, size_t byteLength)
{

    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* result = createUninitializedBuffer(lexicalGlobalObject, byteLength);

    // it should have thrown an exception already
    EXCEPTION_ASSERT(!!throwScope.exception() == !result);

    return result;
}

// Normalize val to be an integer in the range of [1, -1] since
// implementations of memcmp() can vary by platform.
static int normalizeCompareVal(int val, size_t a_length, size_t b_length)
{
    if (val == 0) {
        if (a_length > b_length)
            return 1;
        else if (a_length < b_length)
            return -1;
    } else {
        if (val > 0)
            return 1;
        else
            return -1;
    }
    return val;
}

static WebCore::BufferEncodingType parseEncoding(JSC::ThrowScope& scope, JSC::JSGlobalObject* lexicalGlobalObject, JSValue arg, bool validateUnknown)
{
    auto arg_ = arg.toStringOrNull(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    const auto& view = arg_->view(lexicalGlobalObject);

    std::optional<BufferEncodingType> encoded = parseEnumerationFromView<BufferEncodingType>(view);
    if (!encoded) [[unlikely]] {
        if (validateUnknown) {
            Bun::V::validateString(scope, lexicalGlobalObject, arg, "encoding"_s);
            RETURN_IF_EXCEPTION(scope, WebCore::BufferEncodingType::utf8);
        }
        Bun::ERR::UNKNOWN_ENCODING(scope, lexicalGlobalObject, view);
        return WebCore::BufferEncodingType::utf8;
    }

    return encoded.value();
}

uint32_t validateOffset(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, JSC::JSValue name, uint32_t min, uint32_t max)
{
    if (!value.isNumber()) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "number"_s, value);
    auto value_num = value.asNumber();
    if (std::fmod(value_num, 1.0) != 0) [[unlikely]]
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, "an integer"_s, value);
    if (value_num < min || value_num > max) [[unlikely]]
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, min, max, value);
    uint32_t result = JSC::toInt32(value_num);
    return result;
}
uint32_t validateOffset(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, WTF::ASCIILiteral name, uint32_t min, uint32_t max)
{
    if (!value.isNumber()) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, name, "number"_s, value);
    auto value_num = value.asNumber();
    if (std::fmod(value_num, 1.0) != 0) [[unlikely]]
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, "an integer"_s, value);
    if (value_num < min || value_num > max) [[unlikely]]
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, name, min, max, value);
    uint32_t result = JSC::toInt32(value_num);
    return result;
}

namespace WebCore {
using namespace JSC;

template<> class IDLOperation<JSArrayBufferView> {
public:
    using ClassParameter = JSC::JSUint8Array*;
    using Operation = JSC::EncodedJSValue(JSC::JSGlobalObject*, JSC::CallFrame*, ClassParameter);

    template<Operation operation, CastedThisErrorBehavior = CastedThisErrorBehavior::Throw>
    static JSC::EncodedJSValue call(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, ASCIILiteral operationName)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        auto thisValue = callFrame.thisValue().toThis(&lexicalGlobalObject, JSC::ECMAMode::strict());
        if (thisValue.isUndefinedOrNull()) {
            throwTypeError(&lexicalGlobalObject, throwScope, "Cannot convert undefined or null to object"_s);
            return {};
        }

        auto thisObject = JSC::jsDynamicCast<JSC::JSUint8Array*>(thisValue);
        if (!thisObject) [[unlikely]]
            return throwThisTypeError(lexicalGlobalObject, throwScope, "Buffer"_s, operationName);

        RELEASE_AND_RETURN(throwScope, (operation(&lexicalGlobalObject, &callFrame, thisObject)));
    }
};

}

JSC::EncodedJSValue JSBuffer__bufferFromPointerAndLengthAndDeinit(JSC::JSGlobalObject* lexicalGlobalObject, char* ptr, size_t length, void* ctx, JSTypedArrayBytesDeallocator bytesDeallocator)
{
    JSC::JSUint8Array* uint8Array = nullptr;

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* subclassStructure = globalObject->JSBufferSubclassStructure();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(lexicalGlobalObject->vm());

    if (length > 0) [[likely]] {
        ASSERT(bytesDeallocator);
        auto buffer = ArrayBuffer::createFromBytes({ reinterpret_cast<const uint8_t*>(ptr), length }, createSharedTask<void(void*)>([=](void* p) {
            bytesDeallocator(p, ctx);
        }));

        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, WTF::move(buffer), 0, length);
    } else {
        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, 0);
    }

    // only JSC::JSUint8Array::create can throw and we control the ArrayBuffer passed in.
    scope.assertNoException();
    ASSERT(uint8Array);

    return JSC::JSValue::encode(uint8Array);
}

namespace WebCore {
using namespace JSC;

static JSC::EncodedJSValue writeToBuffer(JSC::JSGlobalObject* lexicalGlobalObject, JSArrayBufferView* castedThis, JSString* str, uint32_t offset, uint32_t length, BufferEncodingType encoding)
{
    if (str->length() == 0) [[unlikely]]
        return JSC::JSValue::encode(JSC::jsNumber(0));

    const auto& view = str->view(lexicalGlobalObject);
    if (view->isNull()) {
        return {};
    }

    size_t written = 0;

    switch (encoding) {
    case WebCore::BufferEncodingType::utf8:
    case WebCore::BufferEncodingType::latin1:
    case WebCore::BufferEncodingType::ascii:
    case WebCore::BufferEncodingType::ucs2:
    case WebCore::BufferEncodingType::utf16le:
    case WebCore::BufferEncodingType::base64:
    case WebCore::BufferEncodingType::base64url:
    case WebCore::BufferEncodingType::hex: {

        if (view->is8Bit()) {
            const auto span = view->span8();
            written = Bun__encoding__writeLatin1(span.data(), span.size(), reinterpret_cast<unsigned char*>(castedThis->vector()) + offset, length, static_cast<uint8_t>(encoding));
        } else {
            const auto span = view->span16();
            written = Bun__encoding__writeUTF16(span.data(), span.size(), reinterpret_cast<unsigned char*>(castedThis->vector()) + offset, length, static_cast<uint8_t>(encoding));
        }
        break;
    }
    default: {
        break;
    }
    }

    return JSC::JSValue::encode(JSC::jsNumber(written));
}

JSC::JSUint8Array* createBuffer(JSC::JSGlobalObject* lexicalGlobalObject, Ref<JSC::ArrayBuffer>&& backingStore)
{
    size_t length = backingStore->byteLength();
    return JSC::JSUint8Array::create(lexicalGlobalObject, defaultGlobalObject(lexicalGlobalObject)->JSBufferSubclassStructure(), WTF::move(backingStore), 0, length);
}

JSC::JSUint8Array* createBuffer(JSC::JSGlobalObject* lexicalGlobalObject, const uint8_t* ptr, size_t length)
{
    auto* buffer = createUninitializedBuffer(lexicalGlobalObject, length);

    if (ptr && length > 0 && buffer) [[likely]]
        memcpy(buffer->typedVector(), ptr, length);

    return buffer;
}

JSC::JSUint8Array* createBuffer(JSC::JSGlobalObject* lexicalGlobalObject, const std::span<const uint8_t> data)
{
    return createBuffer(lexicalGlobalObject, data.data(), data.size());
}

JSC::JSUint8Array* createBuffer(JSC::JSGlobalObject* lexicalGlobalObject, const char* ptr, size_t length)
{
    return createBuffer(lexicalGlobalObject, reinterpret_cast<const uint8_t*>(ptr), length);
}

JSC::JSUint8Array* createBuffer(JSC::JSGlobalObject* lexicalGlobalObject, const Vector<uint8_t>& data)
{
    return createBuffer(lexicalGlobalObject, data.begin(), data.size());
}

JSC::JSUint8Array* createEmptyBuffer(JSC::JSGlobalObject* lexicalGlobalObject)
{
    return createUninitializedBuffer(lexicalGlobalObject, 0);
}

JSC::JSUint8Array* createUninitializedBuffer(JSC::JSGlobalObject* lexicalGlobalObject, size_t length)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* subclassStructure = globalObject->JSBufferSubclassStructure();

    return JSC::JSUint8Array::createUninitialized(lexicalGlobalObject, subclassStructure, length);
}

static JSC::JSUint8Array* JSBuffer__bufferFromLengthAsArray(JSC::JSGlobalObject* lexicalGlobalObject, int64_t length)
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());

    if (length < 0) [[unlikely]] {
        throwNodeRangeError(lexicalGlobalObject, throwScope, "Invalid array length"_s);
        return nullptr;
    }
    if (length > MAX_ARRAY_BUFFER_SIZE) {
        Bun::ERR::OUT_OF_RANGE(throwScope, lexicalGlobalObject, "size"_s, 0, MAX_ARRAY_BUFFER_SIZE, jsNumber(length));
        return nullptr;
    }

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* subclassStructure = globalObject->JSBufferSubclassStructure();
    JSC::JSUint8Array* uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, static_cast<size_t>(length));
    RELEASE_AND_RETURN(throwScope, uint8Array);
}

extern "C" JSC::EncodedJSValue JSBuffer__bufferFromLength(JSC::JSGlobalObject* lexicalGlobalObject, int64_t length)
{
    return JSC::JSValue::encode(JSBuffer__bufferFromLengthAsArray(lexicalGlobalObject, length));
}

// https://github.com/nodejs/node/blob/v22.9.0/lib/buffer.js#L404
static JSC::EncodedJSValue jsBufferConstructorFunction_allocUnsafeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSValue lengthValue = callFrame->argument(0);
    Bun::V::validateNumber(throwScope, lexicalGlobalObject, lengthValue, "size"_s, jsNumber(0), jsNumber(Bun::Buffer::kMaxLength));
    RETURN_IF_EXCEPTION(throwScope, {});
    size_t length = lengthValue.toLength(lexicalGlobalObject);
    auto result = allocBufferUnsafe(lexicalGlobalObject, length);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (Bun__Node__ZeroFillBuffers) memset(result->typedVector(), 0, length);
    RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
}

// new Buffer()
static JSC::EncodedJSValue constructBufferEmpty(JSGlobalObject* lexicalGlobalObject)
{
    return JSBuffer__bufferFromLength(lexicalGlobalObject, 0);
}

JSC::EncodedJSValue constructFromEncoding(JSGlobalObject* lexicalGlobalObject, std::span<const uint8_t> bytes, WebCore::BufferEncodingType encoding)
{
    WTF::StringView view(bytes);
    return constructFromEncoding(lexicalGlobalObject, view, encoding);
}

JSC::EncodedJSValue constructFromEncoding(JSGlobalObject* lexicalGlobalObject, WTF::StringView view, WebCore::BufferEncodingType encoding)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::EncodedJSValue result;

    if (view.is8Bit()) {
        const auto span = view.span8();

        switch (encoding) {
        case WebCore::BufferEncodingType::utf8:
        case WebCore::BufferEncodingType::ucs2:
        case WebCore::BufferEncodingType::utf16le:
        case WebCore::BufferEncodingType::base64:
        case WebCore::BufferEncodingType::base64url:
        case WebCore::BufferEncodingType::hex: {

            result = Bun__encoding__constructFromLatin1(lexicalGlobalObject, span.data(), span.size(), static_cast<uint8_t>(encoding));
            break;
        }
        case WebCore::BufferEncodingType::ascii: // ascii is a noop for latin1
        case WebCore::BufferEncodingType::latin1: { // The native encoding is latin1, so we don't need to do any conversion.
            result = JSValue::encode(createBuffer(lexicalGlobalObject, span.data(), span.size()));
            break;
        }
        default: {
            result = 0;
            break;
        }
        }
    } else {
        const auto span = view.span16();
        switch (encoding) {
        case WebCore::BufferEncodingType::utf8:
        case WebCore::BufferEncodingType::base64:
        case WebCore::BufferEncodingType::base64url:
        case WebCore::BufferEncodingType::hex:
        case WebCore::BufferEncodingType::ascii:
        case WebCore::BufferEncodingType::latin1: {
            result = Bun__encoding__constructFromUTF16(lexicalGlobalObject, span.data(), span.size(), static_cast<uint8_t>(encoding));
            break;
        }
        case WebCore::BufferEncodingType::ucs2:
        case WebCore::BufferEncodingType::utf16le: {
            // The native encoding is UTF-16
            // so we don't need to do any conversion.
            result = JSValue::encode(createBuffer(lexicalGlobalObject, reinterpret_cast<const unsigned char*>(span.data()), span.size() * 2));
            break;
        }
        default: {
            result = 0;
            break;
        }
        }
    }
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSValue decoded = JSC::JSValue::decode(result);
    if (!result) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "An error occurred while decoding the string"_s);
        return {};
    }

    if (decoded.isCell() && decoded.getObject()->isErrorInstance()) {
        scope.throwException(lexicalGlobalObject, decoded);
        return {};
    }
    return result;
}

static JSC::EncodedJSValue constructBufferFromStringAndEncoding(JSC::JSGlobalObject* lexicalGlobalObject, JSValue arg0, JSValue arg1)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    WebCore::BufferEncodingType encoding = WebCore::BufferEncodingType::utf8;

    auto* str = arg0.toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto view = str->view(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (arg1 && arg1.isString()) {
        std::optional<BufferEncodingType> encoded = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, arg1);
        if (!encoded) {
            auto* encodingString = arg1.toString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            const auto& view = encodingString->view(lexicalGlobalObject);
            return Bun::ERR::UNKNOWN_ENCODING(scope, lexicalGlobalObject, view);
        }

        encoding = encoded.value();
    }

    if (str->length() == 0)
        RELEASE_AND_RETURN(scope, constructBufferEmpty(lexicalGlobalObject));

    JSC::EncodedJSValue result = constructFromEncoding(lexicalGlobalObject, view, encoding);

    RELEASE_AND_RETURN(scope, result);
}

// https://github.com/nodejs/node/blob/v22.9.0/lib/buffer.js#L391
static JSC::EncodedJSValue jsBufferConstructorFunction_allocBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue lengthValue = callFrame->argument(0);
    Bun::V::validateNumber(scope, lexicalGlobalObject, lengthValue, "size"_s, jsNumber(0), jsNumber(Bun::Buffer::kMaxLength));
    RETURN_IF_EXCEPTION(scope, {});
    size_t length = lengthValue.toLength(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (length == 0) {
        RELEASE_AND_RETURN(scope, JSValue::encode(createEmptyBuffer(lexicalGlobalObject)));
    }
    // fill argument
    if (callFrame->argumentCount() > 1) [[unlikely]] {
        auto* uint8Array = createUninitializedBuffer(lexicalGlobalObject, length);
        RETURN_IF_EXCEPTION(scope, {});

        auto value = callFrame->argument(1);

        if (value.isString()) {
            size_t length = uint8Array->byteLength();
            size_t start = 0;
            size_t end = length;
            WebCore::BufferEncodingType encoding = WebCore::BufferEncodingType::utf8;
            if (callFrame->argumentCount() > 2) {
                EnsureStillAliveScope arg2 = callFrame->uncheckedArgument(2);
                if (!arg2.value().isUndefined()) {
                    encoding = parseEncoding(scope, lexicalGlobalObject, arg2.value(), true);
                    RETURN_IF_EXCEPTION(scope, {});
                }
            }
            auto startPtr = uint8Array->typedVector() + start;
            auto str_ = value.toString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            const auto& view = str_->view(lexicalGlobalObject);
            if (view->isEmpty()) {
                memset(startPtr, 0, length);
                RELEASE_AND_RETURN(scope, JSC::JSValue::encode(uint8Array));
            }

            ZigString str = Zig::toZigString(view);

            if (!Bun__Buffer_fill(&str, startPtr, end - start, encoding)) [[unlikely]] {
                return Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "value"_s, value);
            }
        } else if (auto* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value)) {
            if (view->isDetached()) [[unlikely]] {
                throwVMTypeError(lexicalGlobalObject, scope, "Uint8Array is detached"_s);
                return {};
            }

            size_t length = view->byteLength();
            if (length == 0) [[unlikely]] {
                return Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "value"_s, value);
            }

            auto* start = uint8Array->typedVector();
            auto* head = start;
            size_t remain = uint8Array->byteLength();
            length = std::min(length, remain);

            memmove(head, view->vector(), length);
            remain -= length;
            head += length;
            while (remain >= length && length > 0) {
                memmove(head, start, length);
                remain -= length;
                head += length;
                length <<= 1;
            }
            if (remain > 0) {
                memmove(head, start, remain);
            }
        } else {
            auto value_ = value.toInt32(lexicalGlobalObject) & 0xFF;

            auto value_uint8 = static_cast<uint8_t>(value_);
            RETURN_IF_EXCEPTION(scope, {});

            auto length = uint8Array->byteLength();
            auto start = 0;
            auto end = length;

            auto startPtr = uint8Array->typedVector() + start;
            auto endPtr = uint8Array->typedVector() + end;
            memset(startPtr, value_uint8, endPtr - startPtr);
        }

        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(uint8Array));
    } else {
        RELEASE_AND_RETURN(scope, JSValue::encode(allocBuffer(lexicalGlobalObject, length)));
    }
}

static JSC::EncodedJSValue jsBufferConstructorFunction_allocUnsafeSlowBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    return jsBufferConstructorFunction_allocUnsafeBody(lexicalGlobalObject, callFrame);
}

// new SlowBuffer(size)
JSC_DEFINE_HOST_FUNCTION(constructSlowBuffer, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferConstructorFunction_allocUnsafeSlowBody(lexicalGlobalObject, callFrame);
}

static JSC::EncodedJSValue jsBufferByteLengthFromStringAndEncoding(JSC::JSGlobalObject* lexicalGlobalObject, JSString* str, WebCore::BufferEncodingType encoding)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!str) {
        throwTypeError(lexicalGlobalObject, scope, "byteLength() expects a string"_s);
        return {};
    }

    if (auto length = Bun::byteLength(str, lexicalGlobalObject, encoding)) {
        return JSValue::encode(jsNumber(*length));
    }
    if (!scope.exception()) {
        throwOutOfMemoryError(lexicalGlobalObject, scope);
    }

    return {};
}

static JSC::EncodedJSValue jsBufferConstructorFunction_byteLengthBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    WebCore::BufferEncodingType encoding = WebCore::BufferEncodingType::utf8;

    EnsureStillAliveScope arg0 = callFrame->argument(0);
    EnsureStillAliveScope arg1 = callFrame->argument(1);

    if (callFrame->argumentCount() > 1) {

        if (arg1.value().isString()) {
            std::optional<BufferEncodingType> encoded = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, arg1.value());

            // this one doesn't fail
            if (encoded) {
                encoding = encoded.value();
            }
        }
    }

    if (arg0.value().isString()) [[likely]]
        RELEASE_AND_RETURN(scope, jsBufferByteLengthFromStringAndEncoding(lexicalGlobalObject, asString(arg0.value()), encoding));

    if (auto* arrayBufferView = jsDynamicCast<JSC::JSArrayBufferView*>(arg0.value())) {
        return JSValue::encode(jsNumber(arrayBufferView->byteLength()));
    }

    if (auto* arrayBuffer = jsDynamicCast<JSC::JSArrayBuffer*>(arg0.value())) {
        return JSValue::encode(jsNumber(arrayBuffer->impl()->byteLength()));
    }

    return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "string"_s, "string or an instance of Buffer or ArrayBuffer"_s, callFrame->argument(0));
}

static JSC::EncodedJSValue jsBufferConstructorFunction_compareBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto castedThisValue = callFrame->argument(0);
    JSC::JSArrayBufferView* castedThis = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(castedThisValue);
    if (!castedThis) [[unlikely]] {
        return Bun::ERR::INVALID_ARG_TYPE(throwScope, lexicalGlobalObject, "buf1"_s, "Buffer or Uint8Array"_s, castedThisValue);
    }
    if (castedThis->isDetached()) [[unlikely]] {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Uint8Array (first argument) is detached"_s);
        return {};
    }

    auto buffer = callFrame->argument(1);
    JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
    if (!view) [[unlikely]] {
        return Bun::ERR::INVALID_ARG_TYPE(throwScope, lexicalGlobalObject, "buf2"_s, "Buffer or Uint8Array"_s, buffer);
    }
    if (view->isDetached()) [[unlikely]] {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Uint8Array (second argument) is detached"_s);
        return {};
    }

    size_t targetStart = 0;
    size_t targetEndInit = view->byteLength();
    size_t targetEnd = targetEndInit;

    size_t sourceStart = 0;
    size_t sourceEndInit = castedThis->byteLength();
    size_t sourceEnd = sourceEndInit;

    targetStart = std::min(targetStart, std::min(targetEnd, targetEndInit));
    sourceStart = std::min(sourceStart, std::min(sourceEnd, sourceEndInit));

    auto sourceLength = sourceEnd - sourceStart;
    auto targetLength = targetEnd - targetStart;
    auto actualLength = std::min(sourceLength, targetLength);

    auto sourceStartPtr = reinterpret_cast<unsigned char*>(castedThis->vector()) + sourceStart;
    auto targetStartPtr = reinterpret_cast<unsigned char*>(view->vector()) + targetStart;

    auto result = actualLength > 0 ? memcmp(sourceStartPtr, targetStartPtr, actualLength) : 0;

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNumber(normalizeCompareVal(result, sourceLength, targetLength))));
}

static JSC::EncodedJSValue jsBufferConstructorFunction_concatBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        return constructBufferEmpty(lexicalGlobalObject);
    }
    auto listValue = callFrame->argument(0);

    Bun::V::validateArray(throwScope, lexicalGlobalObject, listValue, "list"_s, jsUndefined());
    RETURN_IF_EXCEPTION(throwScope, {});

    auto array = JSC::jsDynamicCast<JSC::JSArray*>(listValue);
    size_t arrayLength = array->length();
    if (arrayLength < 1) {
        RELEASE_AND_RETURN(throwScope, constructBufferEmpty(lexicalGlobalObject));
    }

    JSValue totalLengthValue = callFrame->argument(1);

    size_t byteLength = 0;

    // Use an argument buffer to avoid calling `getIndex` more than once per element.
    // This is a small optimization
    MarkedArgumentBuffer args;
    args.ensureCapacity(arrayLength);
    if (args.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        return {};
    }

    for (unsigned i = 0; i < arrayLength; i++) {
        JSValue element = array->getIndex(lexicalGlobalObject, i);
        RETURN_IF_EXCEPTION(throwScope, {});

        auto* typedArray = JSC::jsDynamicCast<JSC::JSUint8Array*>(element);
        if (!typedArray) {
            return Bun::ERR::INVALID_ARG_TYPE(throwScope, lexicalGlobalObject, makeString("list["_s, i, "]"_s), "Buffer or Uint8Array"_s, element);
        }
        if (typedArray->isDetached()) [[unlikely]] {
            return throwVMTypeError(lexicalGlobalObject, throwScope, "ArrayBufferView is detached"_s);
        }

        auto length = typedArray->byteLength();

        if (length > 0)
            args.append(element);

        byteLength += length;
    }

    size_t availableLength = byteLength;
    if (!totalLengthValue.isUndefined()) {
        if (!totalLengthValue.isNumber()) [[unlikely]] {
            throwTypeError(lexicalGlobalObject, throwScope, "totalLength must be a valid number"_s);
            return {};
        }

        auto totalLength = totalLengthValue.toTypedArrayIndex(lexicalGlobalObject, "totalLength must be a valid number"_s);
        RETURN_IF_EXCEPTION(throwScope, {});
        byteLength = totalLength;
    }

    if (byteLength == 0) {
        RELEASE_AND_RETURN(throwScope, constructBufferEmpty(lexicalGlobalObject));
    } else if (byteLength > MAX_ARRAY_BUFFER_SIZE) [[unlikely]] {
        throwRangeError(lexicalGlobalObject, throwScope, makeString("JavaScriptCore typed arrays are currently limited to "_s, MAX_ARRAY_BUFFER_SIZE, " bytes. To use an array this large, use an ArrayBuffer instead. If this is causing issues for you, please file an issue in Bun's GitHub repository."_s));
        return {};
    }

    JSC::JSUint8Array* outBuffer = byteLength <= availableLength
        ?
        // all pages will be copied in, so we can use uninitialized buffer
        createUninitializedBuffer(lexicalGlobalObject, byteLength)
        :
        // there will be some data that needs to be zeroed out
        // let's let the operating system do that for us
        allocBuffer(lexicalGlobalObject, byteLength);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto output = outBuffer->typedSpan();
    const size_t arrayLengthI = args.size();
    for (size_t i = 0; i < arrayLengthI && output.size() > 0; i++) {
        auto* bufferView = JSC::jsCast<JSC::JSArrayBufferView*>(args.at(i));
        auto source = bufferView->span();
        size_t length = std::min(output.size(), source.size());

        ASSERT_WITH_MESSAGE(length > 0, "length should be greater than 0. This should be checked before appending to the MarkedArgumentBuffer.");

        WTF::memcpySpan(output.first(length), source.first(length));
        output = output.subspan(length);
    }

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(outBuffer));
}

// https://github.com/nodejs/node/blob/v22.9.0/lib/buffer.js#L337
static JSC::EncodedJSValue jsBufferConstructorFunction_copyBytesFromBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto viewValue = callFrame->argument(0);
    auto offsetValue = callFrame->argument(1);
    auto lengthValue = callFrame->argument(2);

    auto view = jsDynamicCast<JSArrayBufferView*>(viewValue);
    if (!view) {
        return Bun::ERR::INVALID_ARG_TYPE(throwScope, lexicalGlobalObject, "view"_s, "TypedArray"_s, viewValue);
    }

    auto ty = JSC::typedArrayType(view->type());

    auto viewLength = view->length();
    if (viewLength == 0) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(createEmptyBuffer(lexicalGlobalObject)));
    }

    size_t offset;
    size_t length;

    if (!offsetValue.isUndefined() || !lengthValue.isUndefined()) {
        if (!offsetValue.isUndefined()) {
            Bun::V::validateInteger(throwScope, lexicalGlobalObject, offsetValue, "offset"_s, jsNumber(0), jsUndefined(), &offset);
            RETURN_IF_EXCEPTION(throwScope, {});
            if (offset >= viewLength) RELEASE_AND_RETURN(throwScope, JSValue::encode(createEmptyBuffer(lexicalGlobalObject)));
        } else {
            offset = 0;
        }

        double end = 0;
        if (!lengthValue.isUndefined()) {
            Bun::V::validateInteger(throwScope, lexicalGlobalObject, lengthValue, "length"_s, jsNumber(0), jsUndefined(), &length);
            RETURN_IF_EXCEPTION(throwScope, {});
            end = offset + length;
        } else {
            end = viewLength;
        }
        end = std::min(end, (double)viewLength);

        auto elemSize = JSC::elementSize(ty);
        auto offset_r = offset * elemSize;
        auto end_r = end * elemSize;
        auto span = view->span().subspan(offset_r, end_r - offset_r);
        RELEASE_AND_RETURN(throwScope, JSValue::encode(createBuffer(lexicalGlobalObject, span.data(), span.size())));
    }

    auto boffset = view->byteOffset();
    auto blength = view->byteLength();
    auto span = view->span().subspan(boffset, blength - boffset);
    RELEASE_AND_RETURN(throwScope, JSValue::encode(createBuffer(lexicalGlobalObject, span.data(), span.size())));
}

static JSC::EncodedJSValue jsBufferConstructorFunction_isEncodingBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto encodingValue = callFrame->argument(0);
    if (!encodingValue.isString()) {
        return JSValue::encode(jsBoolean(false));
    }
    auto* encoding = encodingValue.toString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    std::optional<BufferEncodingType> encoded = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, encoding);
    return JSValue::encode(jsBoolean(!!encoded));
}

class JSBufferPrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSBufferPrototype* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSBufferPrototype* ptr = new (NotNull, JSC::allocateCell<JSBufferPrototype>(vm)) JSBufferPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBufferPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSBufferPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBufferPrototype, JSBufferPrototype::Base);

static JSC::EncodedJSValue jsBufferPrototypeFunction_compareBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto arg0 = callFrame->argument(0);
    JSC::JSUint8Array* view = JSC::jsDynamicCast<JSC::JSUint8Array*>(arg0);

    if (!view) [[unlikely]] {
        return Bun::ERR::INVALID_ARG_TYPE(throwScope, lexicalGlobalObject, "target"_s, "Buffer or Uint8Array"_s, arg0);
    }

    if (view->isDetached()) [[unlikely]] {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Uint8Array is detached"_s);
        return {};
    }

    size_t targetStart = 0;
    size_t targetEndInit = view->byteLength();
    size_t targetEnd = targetEndInit;

    size_t sourceStart = 0;
    size_t sourceEndInit = castedThis->byteLength();
    size_t sourceEnd = sourceEndInit;

    JSValue targetStartValue = jsUndefined();
    JSValue targetEndValue = jsUndefined();
    JSValue sourceStartValue = jsUndefined();
    JSValue sourceEndValue = jsUndefined();

    switch (callFrame->argumentCount()) {
    default:
        sourceEndValue = callFrame->uncheckedArgument(4);
        if (sourceEndValue != jsUndefined()) {
            Bun::V::validateInteger(throwScope, lexicalGlobalObject, sourceEndValue, "sourceEnd"_s, jsNumber(0), jsNumber(Bun::Buffer::kMaxLength), &sourceEnd);
            RETURN_IF_EXCEPTION(throwScope, {});
        }
        RETURN_IF_EXCEPTION(throwScope, {});
        [[fallthrough]];
    case 4:
        sourceStartValue = callFrame->uncheckedArgument(3);
        if (sourceStartValue != jsUndefined()) {
            Bun::V::validateInteger(throwScope, lexicalGlobalObject, sourceStartValue, "sourceStart"_s, jsNumber(0), jsNumber(Bun::Buffer::kMaxLength), &sourceStart);
            RETURN_IF_EXCEPTION(throwScope, {});
        }
        RETURN_IF_EXCEPTION(throwScope, {});
        [[fallthrough]];
    case 3:
        targetEndValue = callFrame->uncheckedArgument(2);
        if (targetEndValue != jsUndefined()) {
            Bun::V::validateInteger(throwScope, lexicalGlobalObject, targetEndValue, "targetEnd"_s, jsNumber(0), jsNumber(Bun::Buffer::kMaxLength), &targetEnd);
            RETURN_IF_EXCEPTION(throwScope, {});
        }
        RETURN_IF_EXCEPTION(throwScope, {});
        [[fallthrough]];
    case 2:
        targetStartValue = callFrame->uncheckedArgument(1);
        if (targetStartValue != jsUndefined()) {
            Bun::V::validateInteger(throwScope, lexicalGlobalObject, targetStartValue, "targetStart"_s, jsNumber(0), jsNumber(Bun::Buffer::kMaxLength), &targetStart);
            RETURN_IF_EXCEPTION(throwScope, {});
        }
        RETURN_IF_EXCEPTION(throwScope, {});
        break;
    case 1:
    case 0:
        break;
    }

    if (targetStart > targetEndInit && targetStart <= targetEnd) {
        return Bun::ERR::OUT_OF_RANGE(throwScope, lexicalGlobalObject, "targetStart"_s, 0, targetEndInit, targetStartValue);
    }
    if (targetEnd > targetEndInit && targetEnd >= targetStart) {
        return Bun::ERR::OUT_OF_RANGE(throwScope, lexicalGlobalObject, "targetEnd"_s, 0, targetEndInit, targetEndValue);
    }
    if (sourceStart > sourceEndInit && sourceStart <= sourceEnd) {
        return Bun::ERR::OUT_OF_RANGE(throwScope, lexicalGlobalObject, "sourceStart"_s, 0, sourceEndInit, sourceStartValue);
    }
    if (sourceEnd > sourceEndInit && sourceEnd >= sourceStart) {
        return Bun::ERR::OUT_OF_RANGE(throwScope, lexicalGlobalObject, "sourceEnd"_s, 0, sourceEndInit, sourceEndValue);
    }

    targetStart = std::min(targetStart, std::min(targetEnd, targetEndInit));
    sourceStart = std::min(sourceStart, std::min(sourceEnd, sourceEndInit));

    auto sourceLength = sourceEnd - sourceStart;
    auto targetLength = targetEnd - targetStart;
    auto actualLength = std::min(sourceLength, targetLength);

    auto sourceStartPtr = castedThis->typedVector() + sourceStart;
    auto targetStartPtr = view->typedVector() + targetStart;

    auto result = actualLength > 0 ? memcmp(sourceStartPtr, targetStartPtr, actualLength) : 0;

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNumber(normalizeCompareVal(result, sourceLength, targetLength))));
}

static double toInteger(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, double defaultVal)
{
    auto n = value.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (std::isnan(n)) return defaultVal;
    if (n < JSC::minSafeInteger()) return defaultVal;
    if (n > JSC::maxSafeInteger()) return defaultVal;
    return std::trunc(n);
}

// https://github.com/nodejs/node/blob/v22.9.0/lib/buffer.js#L825
// https://github.com/nodejs/node/blob/v22.9.0/lib/buffer.js#L205
static JSC::EncodedJSValue jsBufferPrototypeFunction_copyBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto targetValue = callFrame->argument(0);
    auto targetStartValue = callFrame->argument(1);
    auto sourceStartValue = callFrame->argument(2);
    auto sourceEndValue = callFrame->argument(3);

    auto source = castedThis;
    auto target = jsDynamicCast<JSArrayBufferView*>(targetValue);
    if (!target) {
        return Bun::ERR::INVALID_ARG_TYPE(throwScope, lexicalGlobalObject, "target"_s, "Buffer or Uint8Array"_s, targetValue);
    }

    auto sourceLength = source->byteLength();
    auto targetLength = target->byteLength();

    size_t targetStart = 0;
    if (targetStartValue.isUndefined()) {
    } else {
        double targetStartD = targetStartValue.isAnyInt() ? targetStartValue.asNumber() : toInteger(throwScope, lexicalGlobalObject, targetStartValue, 0);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (targetStartD < 0) return Bun::ERR::OUT_OF_RANGE(throwScope, lexicalGlobalObject, "targetStart"_s, 0, targetLength, targetStartValue);
        targetStart = static_cast<size_t>(targetStartD);
    }

    size_t sourceStart = 0;
    if (sourceStartValue.isUndefined()) {
    } else {
        double sourceStartD = sourceStartValue.isAnyInt() ? sourceStartValue.asNumber() : toInteger(throwScope, lexicalGlobalObject, sourceStartValue, 0);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (sourceStartD < 0 || sourceStartD > sourceLength) return Bun::ERR::OUT_OF_RANGE(throwScope, lexicalGlobalObject, "sourceStart"_s, 0, sourceLength, sourceStartValue);
        sourceStart = static_cast<size_t>(sourceStartD);
    }

    size_t sourceEnd = sourceLength;
    if (sourceEndValue.isUndefined()) {
    } else {
        double sourceEndD = sourceEndValue.isAnyInt() ? sourceEndValue.asNumber() : toInteger(throwScope, lexicalGlobalObject, sourceEndValue, 0);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (sourceEndD < 0) return Bun::ERR::OUT_OF_RANGE(throwScope, lexicalGlobalObject, "sourceEnd"_s, 0, sourceLength, sourceEndValue);
        sourceEnd = static_cast<size_t>(sourceEndD);
    }

    if (targetStart >= targetLength || sourceStart >= sourceEnd) {
        return JSValue::encode(jsNumber(0));
    }

    if (sourceEnd - sourceStart > targetLength - targetStart)
        sourceEnd = sourceStart + targetLength - targetStart;

    ssize_t nb = sourceEnd - sourceStart;
    auto sourceLen = sourceLength - sourceStart;
    if (nb > sourceLen) nb = sourceLen;

    if (nb <= 0) return JSValue::encode(jsNumber(0));

    auto sourceStartPtr = reinterpret_cast<unsigned char*>(source->vector()) + sourceStart;
    auto targetStartPtr = reinterpret_cast<unsigned char*>(target->vector()) + targetStart;
    memmove(targetStartPtr, sourceStartPtr, nb);

    return JSValue::encode(jsNumber(nb));
}

static JSC::EncodedJSValue jsBufferPrototypeFunction_equalsBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return {};
    }

    auto buffer = callFrame->uncheckedArgument(0);
    JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
    if (!view) [[unlikely]] {
        return Bun::ERR::INVALID_ARG_TYPE(throwScope, lexicalGlobalObject, "otherBuffer"_s, "Buffer or Uint8Array"_s, buffer);
    }

    if (view->isDetached()) [[unlikely]] {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Uint8Array is detached"_s);
        return {};
    }

    size_t a_length = castedThis->byteLength();
    size_t b_length = view->byteLength();
    auto sourceStartPtr = castedThis->typedVector();
    auto targetStartPtr = reinterpret_cast<unsigned char*>(view->vector());

    // same pointer, same length, same contents
    if (sourceStartPtr == targetStartPtr && a_length == b_length)
        RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(true)));

    size_t compare_length = std::min(a_length, b_length);
    auto result = compare_length > 0 ? memcmp(sourceStartPtr, targetStartPtr, compare_length) : 0;

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsBoolean(normalizeCompareVal(result, a_length, b_length) == 0)));
}

static JSC::EncodedJSValue jsBufferPrototypeFunction_fillBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        return JSValue::encode(castedThis);
    }

    auto value = callFrame->uncheckedArgument(0);
    const size_t limit = castedThis->byteLength();
    size_t offset = 0;
    size_t end = limit;
    WebCore::BufferEncodingType encoding = WebCore::BufferEncodingType::utf8;
    JSValue encodingValue = jsUndefined();
    JSValue offsetValue = jsUndefined();
    JSValue endValue = jsUndefined();

    switch (callFrame->argumentCount()) {
    case 4:
        encodingValue = callFrame->uncheckedArgument(3);
        [[fallthrough]];
    case 3:
        endValue = callFrame->uncheckedArgument(2);
        [[fallthrough]];
    case 2:
        offsetValue = callFrame->uncheckedArgument(1);
        [[fallthrough]];
    default:
        break;
    }

    if (offsetValue.isUndefined() || offsetValue.isString()) {
        encodingValue = offsetValue;
        offsetValue = jsUndefined();
    } else if (endValue.isString()) {
        encodingValue = endValue;
        endValue = jsUndefined();
    }

    if (!encodingValue.isUndefined() && value.isString()) {
        encoding = parseEncoding(scope, lexicalGlobalObject, encodingValue, true);
        RETURN_IF_EXCEPTION(scope, {});
    }

    // https://github.com/nodejs/node/blob/v22.9.0/lib/buffer.js#L1066-L1079
    // https://github.com/nodejs/node/blob/v22.9.0/lib/buffer.js#L122
    if (!offsetValue.isUndefined()) {
        Bun::V::validateNumber(scope, lexicalGlobalObject, offsetValue, "offset"_s, jsNumber(0), jsNumber(Bun::Buffer::kMaxLength));
        RETURN_IF_EXCEPTION(scope, {});
        offset = offsetValue.toLength(lexicalGlobalObject);
    }
    if (!endValue.isUndefined()) {
        Bun::V::validateNumber(scope, lexicalGlobalObject, endValue, "end"_s, jsNumber(0), jsNumber(limit));
        RETURN_IF_EXCEPTION(scope, {});
        end = endValue.toLength(lexicalGlobalObject);
    }
    if (offset >= end) {
        RELEASE_AND_RETURN(scope, JSValue::encode(castedThis));
    }

    if (value.isString()) {
        auto startPtr = castedThis->typedVector() + offset;
        auto str_ = value.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        ZigString str = Zig::toZigString(str_);

        if (str.len == 0) {
            memset(startPtr, 0, end - offset);
        } else if (!Bun__Buffer_fill(&str, startPtr, end - offset, encoding)) [[unlikely]] {
            return Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "value"_s, value);
        }
    } else if (auto* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value)) {
        auto* startPtr = castedThis->typedVector() + offset;
        auto* head = startPtr;
        size_t remain = end - offset;

        if (view->isDetached()) [[unlikely]] {
            throwVMTypeError(lexicalGlobalObject, scope, "Uint8Array is detached"_s);
            return {};
        }

        size_t length = view->byteLength();
        if (length == 0) [[unlikely]] {
            scope.throwException(lexicalGlobalObject, createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_ARG_VALUE, "Buffer cannot be empty"_s));
            return {};
        }

        length = std::min(length, remain);

        memmove(head, view->vector(), length);
        remain -= length;
        head += length;
        while (remain >= length && length > 0) {
            memmove(head, startPtr, length);
            remain -= length;
            head += length;
            length <<= 1;
        }
        if (remain > 0) {
            memmove(head, startPtr, remain);
        }
    } else {
        auto value_ = value.toInt32(lexicalGlobalObject) & 0xFF;
        RETURN_IF_EXCEPTION(scope, {});

        auto value_uint8 = static_cast<uint8_t>(value_);
        RETURN_IF_EXCEPTION(scope, {});

        auto startPtr = castedThis->typedVector() + offset;
        auto endPtr = castedThis->typedVector() + end;
        memset(startPtr, value_uint8, endPtr - startPtr);
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(castedThis));
}

static ssize_t indexOfOffset(size_t length, ssize_t offset_i64, ssize_t needle_length, bool is_forward)
{
    auto length_i64 = static_cast<ssize_t>(length);
    if (offset_i64 < 0) {
        if (offset_i64 + length_i64 >= 0) {
            // Negative offsets count backwards from the end of the buffer.
            return length_i64 + offset_i64;
        } else if (is_forward || needle_length == 0) {
            // indexOf from before the start of the buffer: search the whole buffer.
            return 0;
        } else {
            // lastIndexOf from before the start of the buffer: no match.
            return -1;
        }
    } else {
        if (offset_i64 + needle_length <= length_i64) {
            // Valid positive offset.
            return offset_i64;
        } else if (needle_length == 0) {
            // Out of buffer bounds, but empty needle: point to end of buffer.
            return length_i64;
        } else if (is_forward) {
            // indexOf from past the end of the buffer: no match.
            return -1;
        } else {
            // lastIndexOf from past the end of the buffer: search the whole buffer.
            return length_i64 - 1;
        }
    }
}

static int64_t indexOf(const uint8_t* thisPtr, int64_t thisLength, const uint8_t* valuePtr, int64_t valueLength, int64_t byteOffset)
{
    const size_t haystackLen = static_cast<size_t>(thisLength - byteOffset);
    const uint8_t* haystackPtr = thisPtr + byteOffset;

    if (valueLength == 1) {
        // Use SIMD-optimized single-byte search
        size_t result = highway_index_of_char(haystackPtr, haystackLen, valuePtr[0]);
        if (result == haystackLen) return -1;
        return byteOffset + static_cast<int64_t>(result);
    }

    // Use SIMD-optimized multi-byte search
    void* result = highway_memmem(haystackPtr, haystackLen, valuePtr, static_cast<size_t>(valueLength));
    if (result == nullptr) return -1;
    return byteOffset + static_cast<int64_t>(static_cast<const uint8_t*>(result) - haystackPtr);
}

static int64_t indexOf16(const uint8_t* thisPtr, int64_t thisLength, const uint8_t* valuePtr, int64_t valueLength, int64_t byteOffset)
{
    if (thisLength == 1) return -1;
    if (valueLength == 1) return -1;
    thisLength /= 2;
    valueLength /= 2;
    byteOffset /= 2;
    auto haystack = std::span<const uint16_t>((const uint16_t*)(thisPtr), thisLength).subspan(byteOffset);
    auto needle = std::span<const uint16_t>((const uint16_t*)(valuePtr), valueLength);
    auto it = std::search(haystack.begin(), haystack.end(), needle.begin(), needle.end());
    if (it == haystack.end()) return -1;
    auto idx = byteOffset + std::distance(haystack.begin(), it);
    return idx * 2;
}

static int64_t lastIndexOf(const uint8_t* thisPtr, int64_t thisLength, const uint8_t* valuePtr, int64_t valueLength, int64_t byteOffset)
{
    auto start = thisPtr;
    auto end = thisPtr + std::min(thisLength, byteOffset + valueLength);
    auto it = std::find_end(start, end, valuePtr, valuePtr + valueLength);
    if (it != end) {
        return it - thisPtr;
    }
    return -1;
}

static int64_t indexOfNumber(JSC::JSGlobalObject* lexicalGlobalObject, bool last, const uint8_t* typedVector, size_t byteLength, double byteOffsetD, uint8_t byteValue)
{
    ssize_t byteOffset = indexOfOffset(byteLength, byteOffsetD, 1, !last);
    if (byteOffset == -1) return -1;
    auto span = std::span<const uint8_t>(typedVector, byteLength);
    if (last) {
        span = span.subspan(0, byteOffset + 1);
        return WTF::reverseFind(span, byteValue);
    }
    span = span.subspan(byteOffset);
    auto result = WTF::find<uint8_t>(span, byteValue);
    if (result == WTF::notFound) return -1;
    return result + byteOffset;
}

static int64_t indexOfString(JSC::JSGlobalObject* lexicalGlobalObject, bool last, const uint8_t* typedVector, size_t byteLength, double byteOffsetD, JSString* str, BufferEncodingType encoding)
{
    ssize_t byteOffset = indexOfOffset(byteLength, byteOffsetD, str->length(), !last);
    if (byteOffset == -1) return -1;
    if (str->length() == 0) return byteOffset;

    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto view = str->view(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, -1);
    JSC::EncodedJSValue encodedBuffer = constructFromEncoding(lexicalGlobalObject, view, encoding);
    RETURN_IF_EXCEPTION(scope, -1);

    auto* arrayValue = JSC::jsCast<JSC::JSUint8Array*>(JSC::JSValue::decode(encodedBuffer));
    auto lengthValue = static_cast<int64_t>(arrayValue->byteLength());
    if (lengthValue == 0) return byteOffset;

    const uint8_t* typedVectorValue = arrayValue->typedVector();
    if (last) {
        return lastIndexOf(typedVector, byteLength, typedVectorValue, lengthValue, byteOffset);
    }
    if (encoding == BufferEncodingType::ucs2) {
        return indexOf16(typedVector, byteLength, typedVectorValue, lengthValue, byteOffset);
    }

    return indexOf(typedVector, byteLength, typedVectorValue, lengthValue, byteOffset);
}

static int64_t indexOfBuffer(JSC::JSGlobalObject* lexicalGlobalObject, bool last, const uint8_t* typedVector, size_t byteLength, double byteOffsetD, JSC::JSGenericTypedArrayView<JSC::Uint8Adaptor>* array, BufferEncodingType encoding)
{
    size_t lengthValue = array->byteLength();
    ssize_t byteOffset = indexOfOffset(byteLength, byteOffsetD, lengthValue, !last);
    if (byteOffset == -1) return -1;
    if (lengthValue == 0) return byteOffset;
    const uint8_t* typedVectorValue = array->typedVector();
    if (last) {
        return lastIndexOf(typedVector, byteLength, typedVectorValue, lengthValue, byteOffset);
    }
    if (encoding == BufferEncodingType::ucs2) {
        return indexOf16(typedVector, byteLength, typedVectorValue, lengthValue, byteOffset);
    }
    return indexOf(typedVector, byteLength, typedVectorValue, lengthValue, byteOffset);
}

static int64_t indexOf(JSC::JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter buffer, bool last)
{
    bool dir = !last;
    const uint8_t* typedVector = buffer->typedVector();
    size_t byteLength = buffer->byteLength();
    std::optional<BufferEncodingType> encoding = std::nullopt;
    double byteOffsetD = 0;

    if (byteLength == 0) return -1;

    auto valueValue = callFrame->argument(0);
    auto byteOffsetValue = callFrame->argument(1);
    auto encodingValue = callFrame->argument(2);

    if (byteOffsetValue.isString()) {
        encodingValue = byteOffsetValue;
        byteOffsetValue = jsUndefined();
        byteOffsetD = 0;
    } else {
        byteOffsetD = byteOffsetValue.toNumber(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, -1);
        if (byteOffsetD > 0x7fffffffp0f) byteOffsetD = 0x7fffffffp0f;
        if (byteOffsetD < -0x80000000p0f) byteOffsetD = -0x80000000p0f;
    }

    if (std::isnan(byteOffsetD)) byteOffsetD = dir ? 0 : byteLength;

    if (valueValue.isNumber()) {
        auto byteValue = static_cast<uint8_t>((valueValue.toInt32(lexicalGlobalObject)) % 256);
        RETURN_IF_EXCEPTION(scope, -1);
        return indexOfNumber(lexicalGlobalObject, last, typedVector, byteLength, byteOffsetD, byteValue);
    }

    WTF::String encodingString;
    if (!encodingValue.isUndefined()) {
        encodingString = encodingValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        encoding = parseEnumerationFromString<BufferEncodingType>(encodingString);
    } else {
        encoding = BufferEncodingType::utf8;
    }

    if (valueValue.isString()) {
        if (!encoding.has_value()) {
            return Bun::ERR::UNKNOWN_ENCODING(scope, lexicalGlobalObject, encodingString);
        }
        auto* str = valueValue.toStringOrNull(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, -1);
        return indexOfString(lexicalGlobalObject, last, typedVector, byteLength, byteOffsetD, str, encoding.value());
    }

    if (auto* array = JSC::jsDynamicCast<JSC::JSUint8Array*>(valueValue)) {
        if (!encoding.has_value()) encoding = BufferEncodingType::utf8;
        return indexOfBuffer(lexicalGlobalObject, last, typedVector, byteLength, byteOffsetD, array, encoding.value());
    }

    Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "value"_s, "number, string, Buffer, or Uint8Array"_s, valueValue);
    return -1;
}

static JSC::EncodedJSValue jsBufferPrototypeFunction_includesBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto index = indexOf(lexicalGlobalObject, scope, callFrame, castedThis, false);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(jsBoolean(index != -1));
}

static JSC::EncodedJSValue jsBufferPrototypeFunction_indexOfBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto index = indexOf(lexicalGlobalObject, scope, callFrame, castedThis, false);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(jsNumber(index));
}

static JSC::EncodedJSValue jsBufferPrototypeFunction_inspectBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto recurseTimes = callFrame->argument(0);
    UNUSED_PARAM(recurseTimes);
    auto ctx = callFrame->argument(1);

    WTF::StringBuilder result;
    auto data = castedThis->span();
    auto alphabet = "0123456789abcdef"_s;
    auto any = false;

    result.append("<Buffer"_s);
    auto max = globalObject->INSPECT_MAX_BYTES;
    auto actualMaxD = std::min<double>(max, data.size());
    size_t actualMax = actualMaxD;

    for (auto item : data.first(actualMax)) {
        any = true;
        result.append(' ');
        result.append(alphabet[item / 16]);
        result.append(alphabet[item % 16]);
    }
    if (data.size() > max) {
        auto remaining = data.size() - max;
        result.append(makeString(" ... "_s, remaining, " more byte"_s));
        if (remaining > 1) result.append('s');
    }

    // Inspect special properties as well, if possible.
    if (ctx.toBoolean(globalObject)) {
        auto showHidden = ctx.get(globalObject, Identifier::fromString(vm, "showHidden"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSC::PropertyNameArrayBuilder array(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);

        auto filter = showHidden.toBoolean(globalObject) ? DontEnumPropertiesMode::Include : DontEnumPropertiesMode::Exclude;

        if (castedThis->hasNonReifiedStaticProperties()) [[unlikely]] {
            castedThis->reifyAllStaticProperties(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        castedThis->getOwnNonIndexPropertyNames(globalObject, array, filter);
        RETURN_IF_EXCEPTION(scope, {});

        if (array.size() > 0) {
            any = true;
            if (data.size() > 0) {
                result.append(',');
            }
            result.append(' ');
            size_t i = 0;
            for (auto ident : array) {
                if (i > 0) result.append(", "_s);
                result.append(ident.string());
                result.append(": "_s);
                auto value = castedThis->get(globalObject, ident);
                RETURN_IF_EXCEPTION(scope, {});
                auto inspected = Bun__inspect_singleline(globalObject, value).transferToWTFString();
                RETURN_IF_EXCEPTION(scope, {});
                result.append(inspected);
                i++;
            }
        }
    }
    if (!any) result.append(' ');
    result.append('>');
    return JSValue::encode(JSC::jsString(vm, result.toString()));
}

static JSC::EncodedJSValue jsBufferPrototypeFunction_lastIndexOfBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto index = indexOf(lexicalGlobalObject, scope, callFrame, castedThis, true);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(jsNumber(index));
}

static JSC::EncodedJSValue jsBufferPrototypeFunction_swap16Body(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    constexpr size_t elemSize = 2;
    size_t length = castedThis->byteLength();
    if (length % elemSize != 0) {
        throwNodeRangeError(lexicalGlobalObject, scope, "Buffer size must be a multiple of 16-bits"_s);
        return {};
    }

    if (castedThis->isDetached()) [[unlikely]] {
        throwVMTypeError(lexicalGlobalObject, scope, "Buffer is detached"_s);
        return {};
    }

    uint8_t* data = castedThis->typedVector();
    size_t count = length / elemSize;

    for (size_t i = 0; i < count; i++) {
        uint16_t val;
        memcpy(&val, data + i * elemSize, sizeof(val));
        val = __builtin_bswap16(val);
        memcpy(data + i * elemSize, &val, sizeof(val));
    }

    return JSC::JSValue::encode(castedThis);
}

static JSC::EncodedJSValue jsBufferPrototypeFunction_swap32Body(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    constexpr int elemSize = 4;
    int64_t length = static_cast<int64_t>(castedThis->byteLength());
    if (length % elemSize != 0) {
        throwNodeRangeError(lexicalGlobalObject, scope, "Buffer size must be a multiple of 32-bits"_s);
        return {};
    }

    if (castedThis->isDetached()) [[unlikely]] {
        throwVMTypeError(lexicalGlobalObject, scope, "Buffer is detached"_s);
        return {};
    }

    uint8_t* typedVector = castedThis->typedVector();

    constexpr size_t swaps = elemSize / 2;
    for (size_t elem = 0; elem < length; elem += elemSize) {
        const size_t right = elem + elemSize - 1;
        for (size_t k = 0; k < swaps; k++) {
            const size_t i = right - k;
            const size_t j = elem + k;

            uint8_t temp = typedVector[i];
            typedVector[i] = typedVector[j];
            typedVector[j] = temp;
        }
    }

    return JSC::JSValue::encode(castedThis);
}

static JSC::EncodedJSValue jsBufferPrototypeFunction_swap64Body(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    constexpr size_t elemSize = 8;
    size_t length = castedThis->byteLength();
    if (length % elemSize != 0) {
        throwNodeRangeError(lexicalGlobalObject, scope, "Buffer size must be a multiple of 64-bits"_s);
        return {};
    }

    if (castedThis->isDetached()) [[unlikely]] {
        throwVMTypeError(lexicalGlobalObject, scope, "Buffer is detached"_s);
        return {};
    }

    uint8_t* data = castedThis->typedVector();
    size_t count = length / elemSize;

    for (size_t i = 0; i < count; i++) {
        uint64_t val;
        memcpy(&val, data + i * elemSize, sizeof(val));
        val = __builtin_bswap64(val);
        memcpy(data + i * elemSize, &val, sizeof(val));
    }

    return JSC::JSValue::encode(castedThis);
}

JSC::EncodedJSValue jsBufferToStringFromBytes(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, std::span<const uint8_t> bytes, BufferEncodingType encoding)
{
    auto& vm = lexicalGlobalObject->vm();

    if (bytes.size() == 0) [[unlikely]] {
        RELEASE_AND_RETURN(scope, JSValue::encode(jsEmptyString(vm)));
    }

    if (bytes.size() > WTF::String::MaxLength) {
        return Bun::ERR::STRING_TOO_LONG(scope, lexicalGlobalObject);
    }

    // Check encoding-specific output size limits
    // For hex, output is 2x input size
    if (encoding == BufferEncodingType::hex && bytes.size() > WTF::String::MaxLength / 2) {
        return Bun::ERR::STRING_TOO_LONG(scope, lexicalGlobalObject);
    }
    // For base64, output is ceil(input * 4 / 3)
    if ((encoding == BufferEncodingType::base64 || encoding == BufferEncodingType::base64url) && bytes.size() > (WTF::String::MaxLength / 4) * 3) {
        return Bun::ERR::STRING_TOO_LONG(scope, lexicalGlobalObject);
    }

    switch (encoding) {
    case WebCore::BufferEncodingType::buffer: {
        auto* buffer = createUninitializedBuffer(lexicalGlobalObject, bytes.size());
        RETURN_IF_EXCEPTION(scope, {});
        if (!buffer) [[unlikely]] {
            throwOutOfMemoryError(lexicalGlobalObject, scope);
            return {};
        }
        memcpy(buffer->vector(), bytes.data(), bytes.size());
        return JSC::JSValue::encode(buffer);
    }
    case BufferEncodingType::latin1: {
        std::span<Latin1Character> data;
        auto str = String::tryCreateUninitialized(bytes.size(), data);
        if (str.isNull()) [[unlikely]] {
            throwOutOfMemoryError(lexicalGlobalObject, scope);
            return {};
        }

        memcpy(data.data(), bytes.data(), bytes.size());
        return JSValue::encode(jsString(vm, WTF::move(str)));
    }
    case BufferEncodingType::ucs2:
    case BufferEncodingType::utf16le: {
        std::span<char16_t> data;
        size_t u16length = bytes.size() / 2;
        if (u16length == 0) {
            return JSValue::encode(jsEmptyString(vm));
        }
        auto str = String::tryCreateUninitialized(u16length, data);
        if (str.isNull()) [[unlikely]] {
            throwOutOfMemoryError(lexicalGlobalObject, scope);
            return {};
        }
        memcpy(reinterpret_cast<void*>(data.data()), bytes.data(), u16length * 2);
        return JSValue::encode(jsString(vm, WTF::move(str)));
    }
    case BufferEncodingType::ascii: {
        std::span<Latin1Character> data;
        auto str = String::tryCreateUninitialized(bytes.size(), data);
        if (str.isNull()) [[unlikely]] {
            throwOutOfMemoryError(lexicalGlobalObject, scope);
            return {};
        }
        Bun__encoding__writeLatin1(bytes.data(), bytes.size(), data.data(), data.size(), static_cast<uint8_t>(encoding));
        return JSValue::encode(jsString(vm, WTF::move(str)));
    }

    case WebCore::BufferEncodingType::utf8:
    case WebCore::BufferEncodingType::base64:
    case WebCore::BufferEncodingType::base64url:
    case WebCore::BufferEncodingType::hex: {
        EncodedJSValue res = Bun__encoding__toString(bytes.data(), bytes.size(), lexicalGlobalObject, static_cast<uint8_t>(encoding));
        RETURN_IF_EXCEPTION(scope, {});

        JSValue stringValue = JSValue::decode(res);
        if (!stringValue.isString()) [[unlikely]] {
            scope.throwException(lexicalGlobalObject, stringValue);
            return {};
        }

        RELEASE_AND_RETURN(scope, JSValue::encode(stringValue));
    }
    default: {
        throwTypeError(lexicalGlobalObject, scope, "Unsupported encoding? This shouldn't happen"_s);
        return {};
    }
    }
}

JSC::EncodedJSValue jsBufferToString(JSC::JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, JSC::JSArrayBufferView* castedThis, size_t offset, size_t length, WebCore::BufferEncodingType encoding)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);

    auto byteLength = castedThis->byteLength();

    if (!byteLength) [[unlikely]] {
        RELEASE_AND_RETURN(scope, JSValue::encode(jsEmptyString(vm)));
    }

    ASSERT(offset <= byteLength);
    ASSERT(length <= byteLength);
    ASSERT(offset + length <= byteLength);

    if (offset >= byteLength) {
        offset = byteLength;
    }

    if (length > byteLength) {
        length = byteLength;
    }

    if (offset + length > byteLength) {
        length = byteLength - offset;
    }

    return jsBufferToStringFromBytes(lexicalGlobalObject, scope, castedThis->span().subspan(offset, length), encoding);
}

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/node_buffer.cc#L208-L233
bool inline parseArrayIndex(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, size_t& out, ASCIILiteral errorMessage)
{
    if (value.isUndefined()) {
        return true;
    }

    int64_t index = static_cast<int64_t>(value.toIntegerWithTruncation(globalObject));
    RETURN_IF_EXCEPTION(scope, false);

    if (index < 0) {
        throwNodeRangeError(globalObject, scope, errorMessage);
        return false;
    }

    out = static_cast<size_t>(index);
    return true;
}

// https://github.com/nodejs/node/blob/v22.9.0/lib/buffer.js#L834
// using byteLength and byte offsets here is intentional
static JSC::EncodedJSValue jsBufferPrototypeFunction_toStringBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    uint32_t start = 0;
    uint32_t end = castedThis->byteLength();
    uint32_t byteLength = end;
    WebCore::BufferEncodingType encoding = WebCore::BufferEncodingType::utf8;

    if (end == 0)
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));

    size_t argsCount = callFrame->argumentCount();

    JSC::JSValue arg1 = callFrame->argument(0);
    JSC::JSValue arg2 = callFrame->argument(1);
    JSC::JSValue arg3 = callFrame->argument(2);

    if (argsCount == 0)
        return jsBufferToString(lexicalGlobalObject, scope, castedThis, start, end, encoding);

    if (!arg1.isUndefined()) {
        encoding = parseEncoding(scope, lexicalGlobalObject, arg1, false);
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto fstart = arg2.toNumber(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (fstart < 0) {
        fstart = 0;
        goto lstart;
    }
    if (fstart > byteLength) {
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    }
    start = static_cast<uint32_t>(fstart);
lstart:

    if (!arg3.isUndefined()) {
        auto lend = arg3.toLength(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (lend < byteLength) end = lend;
    }

    if (end <= start)
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));

    auto offset = start;
    auto length = end > start ? end - start : 0;
    return jsBufferToString(lexicalGlobalObject, scope, castedThis, offset, length, encoding);
}

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/node_buffer.cc#L544
template<BufferEncodingType encoding>
static JSC::EncodedJSValue jsBufferPrototypeFunction_SliceWithEncoding(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* castedThis = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(callFrame->thisValue());
    const JSValue startValue = callFrame->argument(0);
    const JSValue endValue = callFrame->argument(1);

    if (!castedThis) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "Expected ArrayBufferView"_s);
        return {};
    }

    const size_t length = castedThis->byteLength();
    if (length == 0) [[unlikely]] {
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    }

    size_t start = 0;
    size_t end = length;

    if (!parseArrayIndex(scope, lexicalGlobalObject, startValue, start, "start must be a positive integer"_s)) [[unlikely]] {
        return {};
    }

    if (!parseArrayIndex(scope, lexicalGlobalObject, endValue, end, "end must be a positive integer"_s)) [[unlikely]] {
        return {};
    }

    if (end < start)
        end = start;

    if (!(end <= length)) {
        throwNodeRangeError(lexicalGlobalObject, scope, "end out of range"_s);
        return {};
    }

    return jsBufferToString(lexicalGlobalObject, scope, castedThis, start, end - start, encoding);
}

// DOMJIT makes it slower! TODO: investigate why
// JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(jsBufferPrototypeToStringWithoutTypeChecks, JSValue, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::JSUint8Array* thisValue, JSC::JSString* encodingValue));

// JSC_DEFINE_JIT_OPERATION(jsBufferPrototypeToStringWithoutTypeChecks, JSValue, (JSC::JSGlobalObject * lexicalGlobalObject, JSUint8Array* thisValue, JSString* encodingValue))
// {
//     auto& vm = JSC::getVM(lexicalGlobalObject);
//     IGNORE_WARNINGS_BEGIN("frame-address")
//     CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
//     IGNORE_WARNINGS_END
//     JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);

//     std::optional<BufferEncodingType> encoded = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, encodingValue);
//     if (!encoded) {
//         auto scope = DECLARE_THROW_SCOPE(vm);

//         throwTypeError(lexicalGlobalObject, scope, "Invalid encoding"_s);
//         return {};
//     }

//     auto encoding = encoded.value();

//     return JSValue::decode(jsBufferToString(vm, lexicalGlobalObject, thisValue, 0, thisValue->byteLength(), encoding));
// }

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/node_buffer.cc#L711
template<BufferEncodingType encoding>
static JSC::EncodedJSValue jsBufferPrototypeFunction_writeEncodingBody(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSArrayBufferView* castedThis, JSString* str, JSValue offsetValue, JSValue lengthValue)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    double offset;
    double length = 0;
    bool lengthWasUndefined = lengthValue.isUndefined();

    // Convert offset and length to numbers BEFORE caching byteLength,
    // as toNumber can call arbitrary JS (via Symbol.toPrimitive) which
    // could detach the buffer or cause GC.
    if (offsetValue.isUndefined()) {
        offset = 0;
    } else if (offsetValue.isNumber()) {
        offset = offsetValue.asNumber();
    } else {
        offset = offsetValue.toNumber(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!lengthWasUndefined) {
        if (lengthValue.isNumber()) {
            length = lengthValue.asNumber();
        } else {
            length = lengthValue.toNumber(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    // Re-check if detached after potential JS execution
    if (castedThis->isDetached()) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "ArrayBufferView is detached"_s);
        return {};
    }

    // Now safe to cache byteLength after all JS calls
    size_t byteLength = castedThis->byteLength();

    // Node.js JS wrapper checks: if (offset < 0 || offset > this.byteLength)
    // When offset is NaN, both comparisons return false, so no error is thrown.
    // We need to match this behavior exactly.
    bool offsetWasNaN = std::isnan(offset);
    if (!offsetWasNaN && (offset < 0 || offset > byteLength)) {
        return Bun::ERR::BUFFER_OUT_OF_BOUNDS(scope, lexicalGlobalObject, "offset");
    }
    // Convert NaN offset to 0 for actual use (matching V8's IntegerValue behavior)
    size_t safeOffset = offsetWasNaN ? 0 : static_cast<size_t>(offset);

    // Calculate max_length
    size_t maxLength;
    if (lengthWasUndefined) {
        maxLength = byteLength - safeOffset;
    } else {
        // Node.js JS wrapper checks: if (length < 0 || length > this.byteLength - offset)
        // When offset is NaN, (byteLength - offset) is NaN, so (length > NaN) is false.
        // This means the check passes even for large lengths when offset is NaN.
        if (!offsetWasNaN && (length < 0 || length > byteLength - offset)) {
            return Bun::ERR::BUFFER_OUT_OF_BOUNDS(scope, lexicalGlobalObject, "length");
        }
        // Convert NaN length to 0, negative to 0 (for NaN offset case)
        int64_t intLength = (std::isnan(length) || length < 0) ? 0 : static_cast<int64_t>(length);
        // Clamp to available buffer space
        maxLength = std::min(byteLength - safeOffset, static_cast<size_t>(intLength));
    }

    RELEASE_AND_RETURN(scope, writeToBuffer(lexicalGlobalObject, castedThis, str, safeOffset, maxLength, encoding));
}

template<BufferEncodingType encoding>
static JSC::EncodedJSValue jsBufferPrototypeFunctionWriteWithEncoding(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* castedThis = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(callFrame->thisValue());

    auto arg0 = callFrame->argument(0);
    JSString* text = arg0.toStringOrNull(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue offsetValue = callFrame->argument(1);
    JSValue lengthValue = callFrame->argument(2);

    if (!castedThis) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "Expected ArrayBufferView"_s);
        return {};
    }

    if (castedThis->isDetached()) [[unlikely]] {
        throwTypeError(lexicalGlobalObject, scope, "ArrayBufferView is detached"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, jsBufferPrototypeFunction_writeEncodingBody<encoding>(vm, lexicalGlobalObject, castedThis, text, offsetValue, lengthValue));
}

static JSC::EncodedJSValue jsBufferPrototypeFunction_writeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSArrayBufferView>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto stringValue = callFrame->argument(0);
    auto offsetValue = callFrame->argument(1);
    auto lengthValue = callFrame->argument(2);
    auto encodingValue = callFrame->argument(3);

    uint32_t offset;
    uint32_t length;

    if (offsetValue.isUndefined()) {
        Bun::V::validateString(scope, lexicalGlobalObject, stringValue, "string"_s);
        RETURN_IF_EXCEPTION(scope, {});
        auto* str = stringValue.toString(lexicalGlobalObject);
        offset = 0;
        length = castedThis->byteLength();
        RELEASE_AND_RETURN(scope, writeToBuffer(lexicalGlobalObject, castedThis, str, offset, length, WebCore::BufferEncodingType::utf8));
    }
    if (lengthValue.isUndefined() && offsetValue.isString()) {
        encodingValue = offsetValue;
        offset = 0;
        length = castedThis->byteLength();

        auto* str = stringValue.toString(lexicalGlobalObject);
        auto encoding = parseEncoding(scope, lexicalGlobalObject, encodingValue, false);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, writeToBuffer(lexicalGlobalObject, castedThis, str, offset, length, encoding));
    } else {
        length = castedThis->byteLength();
        offset = validateOffset(scope, lexicalGlobalObject, offsetValue, "offset"_s, 0, length);
        RETURN_IF_EXCEPTION(scope, {});
        uint32_t remaining = castedThis->byteLength() - offset;

        if (lengthValue.isUndefined()) {
            length = remaining;
        } else if (lengthValue.isString()) {
            encodingValue = lengthValue;
            length = remaining;
        } else {
            length = validateOffset(scope, lexicalGlobalObject, lengthValue, "length"_s, 0, length);
            RETURN_IF_EXCEPTION(scope, {});
            if (length > remaining) {
                length = remaining;
            }
        }
    }

    Bun::V::validateString(scope, lexicalGlobalObject, stringValue, "string"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* str = stringValue.toString(lexicalGlobalObject);

    if (!encodingValue.toBoolean(lexicalGlobalObject)) {
        RELEASE_AND_RETURN(scope, writeToBuffer(lexicalGlobalObject, castedThis, str, offset, length, WebCore::BufferEncodingType::utf8));
    }

    auto encoding = parseEncoding(scope, lexicalGlobalObject, encodingValue, false);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, writeToBuffer(lexicalGlobalObject, castedThis, str, offset, length, encoding));
}

extern "C" JSC::EncodedJSValue JSBuffer__fromMmap(Zig::GlobalObject* globalObject, void* ptr, size_t length)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* structure = globalObject->JSBufferSubclassStructure();

    auto buffer = ArrayBuffer::createFromBytes({ static_cast<const uint8_t*>(ptr), length }, createSharedTask<void(void*)>([length](void* p) {
#if !OS(WINDOWS)
        munmap(p, length);
#else
        UnmapViewOfFile(p);
#endif
    }));

    auto* view = JSC::JSUint8Array::create(globalObject, structure, WTF::move(buffer), 0, length);
    RETURN_IF_EXCEPTION(scope, {});

    if (!view) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    return JSC::JSValue::encode(view);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_alloc, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferConstructorFunction_allocBody(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_allocUnsafe, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferConstructorFunction_allocUnsafeBody(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_allocUnsafeSlow, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferConstructorFunction_allocUnsafeSlowBody(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_byteLength, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferConstructorFunction_byteLengthBody(lexicalGlobalObject, callFrame);
}

class JSBufferConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    ~JSBufferConstructor() = default;

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<JSBufferConstructor*>(cell)->JSBufferConstructor::~JSBufferConstructor();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        JSValue prototype = globalObject->m_typedArrayUint8.constructorInitializedOnMainThread(globalObject);
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(prototype.asCell()->type(), StructureFlags), info());
    }

    DECLARE_INFO;

    static JSBufferConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSBufferConstructor* constructor = new (NotNull, JSC::allocateCell<JSBufferConstructor>(vm)) JSBufferConstructor(vm, globalObject, structure);
        constructor->finishCreation(vm, globalObject, prototype);
        return constructor;
    }

private:
    JSBufferConstructor(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure, callJSBuffer, constructJSBuffer)

    {
    }

    void finishCreation(JSC::VM&, JSGlobalObject*, JSC::JSObject* prototype);

}

JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_isEncoding, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferConstructorFunction_isEncodingBody(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_compare, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferConstructorFunction_compareBody(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_concat, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferConstructorFunction_concatBody(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_copyBytesFrom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferConstructorFunction_copyBytesFromBody(lexicalGlobalObject, callFrame);
}

extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(jsBufferConstructorAllocWithoutTypeChecks, JSUint8Array*, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int size));
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(jsBufferConstructorAllocUnsafeWithoutTypeChecks, JSUint8Array*, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int size));
extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(jsBufferConstructorAllocUnsafeSlowWithoutTypeChecks, JSUint8Array*, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int size));

static size_t validateOffsetBigInt64(JSC::JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& scope, JSC::JSValue offsetVal, size_t byteLength)
{
    if (byteLength < 8) [[unlikely]] {
        auto* error = Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_BUFFER_OUT_OF_BOUNDS, "Attempt to access memory outside buffer bounds"_s);
        scope.throwException(lexicalGlobalObject, error);
        return 0;
    }

    if (offsetVal.isUndefined()) {
        return 0;
    }

    size_t offset;
    size_t maxOffset = byteLength - 8;

    if (offsetVal.isInt32()) {
        int32_t offsetI = offsetVal.asInt32();
        if (offsetI < 0) [[unlikely]] {
            Bun::ERR::BUFFER_OUT_OF_BOUNDS(scope, lexicalGlobalObject, "offset"_s);
            return 0;
        }

        offset = static_cast<size_t>(offsetI);

        if (offset > maxOffset) [[unlikely]] {
            Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "offset"_s, 0, maxOffset, offsetVal);
            return 0;
        }

        return offset;
    }

    if (!offsetVal.isNumber()) [[unlikely]] {
        Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "offset"_s, "number"_s, offsetVal);
        return 0;
    }

    auto offsetD = offsetVal.asNumber();
    if (offsetD < 0) [[unlikely]] {
        Bun::ERR::BUFFER_OUT_OF_BOUNDS(scope, lexicalGlobalObject, "offset"_s);
        return 0;
    }

    if (std::fmod(offsetD, 1.0) != 0) [[unlikely]] {
        Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "offset"_s, "an integer"_s, offsetVal);
        return 0;
    }

    offset = static_cast<size_t>(offsetD);

    if (offset > maxOffset) [[unlikely]] {
        Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "offset"_s, 0, maxOffset, offsetVal);
        return 0;
    }

    return offset;
}

JSC_DEFINE_JIT_OPERATION(jsBufferConstructorAllocWithoutTypeChecks, JSUint8Array*, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int byteLength))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    return { allocBuffer(lexicalGlobalObject, byteLength) };
}

JSC_DEFINE_JIT_OPERATION(jsBufferConstructorAllocUnsafeWithoutTypeChecks, JSUint8Array*, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int byteLength))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    return { allocBufferUnsafe(lexicalGlobalObject, byteLength) };
}

JSC_DEFINE_JIT_OPERATION(jsBufferConstructorAllocUnsafeSlowWithoutTypeChecks, JSUint8Array*, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue, int byteLength))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    return { allocBufferUnsafe(lexicalGlobalObject, byteLength) };
}

JSC_ANNOTATE_HOST_FUNCTION(JSBufferConstructorConstruct, JSBufferConstructor::construct);

class JSBuffer : public JSC::JSNonFinalObject {

    DECLARE_INFO;

    static constexpr JSC::JSTypeRange typeRange = { Uint8ArrayType, Uint8ArrayType };
};

const ClassInfo JSBuffer::s_info = {
    "Buffer"_s,
    &JSC::JSUint8Array::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSBuffer)
};

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_compare, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_compareBody>(*lexicalGlobalObject, *callFrame, "compare");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_copy, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_copyBody>(*lexicalGlobalObject, *callFrame, "copy");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_equals, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_equalsBody>(*lexicalGlobalObject, *callFrame, "equals");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_fill, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_fillBody>(*lexicalGlobalObject, *callFrame, "fill");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_includes, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_includesBody>(*lexicalGlobalObject, *callFrame, "includes");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_indexOf, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_indexOfBody>(*lexicalGlobalObject, *callFrame, "indexOf");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_inspect, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_inspectBody>(*lexicalGlobalObject, *callFrame, "inspect");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_lastIndexOf, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_lastIndexOfBody>(*lexicalGlobalObject, *callFrame, "lastIndexOf");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_swap16, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_swap16Body>(*lexicalGlobalObject, *callFrame, "swap16");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_swap32, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_swap32Body>(*lexicalGlobalObject, *callFrame, "swap32");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_swap64, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_swap64Body>(*lexicalGlobalObject, *callFrame, "swap64");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_toString, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_toStringBody>(*lexicalGlobalObject, *callFrame, "toString");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_write, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSArrayBufferView>::call<jsBufferPrototypeFunction_writeBody>(*lexicalGlobalObject, *callFrame, "write");
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_utf16leWrite, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunctionWriteWithEncoding<WebCore::BufferEncodingType::utf16le>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_utf8Write, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunctionWriteWithEncoding<WebCore::BufferEncodingType::utf8>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_latin1Write, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunctionWriteWithEncoding<WebCore::BufferEncodingType::latin1>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_asciiWrite, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunctionWriteWithEncoding<WebCore::BufferEncodingType::ascii>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_base64Write, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunctionWriteWithEncoding<WebCore::BufferEncodingType::base64>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_base64urlWrite, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunctionWriteWithEncoding<WebCore::BufferEncodingType::base64url>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_hexWrite, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunctionWriteWithEncoding<WebCore::BufferEncodingType::hex>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_utf8Slice, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunction_SliceWithEncoding<WebCore::BufferEncodingType::utf8>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_utf16leSlice, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunction_SliceWithEncoding<WebCore::BufferEncodingType::utf16le>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_latin1Slice, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunction_SliceWithEncoding<WebCore::BufferEncodingType::latin1>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_asciiSlice, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunction_SliceWithEncoding<WebCore::BufferEncodingType::ascii>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_base64Slice, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunction_SliceWithEncoding<WebCore::BufferEncodingType::base64>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_base64urlSlice, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunction_SliceWithEncoding<WebCore::BufferEncodingType::base64url>(lexicalGlobalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_hexSlice, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return jsBufferPrototypeFunction_SliceWithEncoding<WebCore::BufferEncodingType::hex>(lexicalGlobalObject, callFrame);
}

template<typename I> void write_int64_le(uint8_t* buffer, I value)
{
    static_assert(std::endian::native == std::endian::little);
    auto val = reinterpret_cast<uint8_t*>(&value);
    buffer[0] = val[0];
    buffer[1] = val[1];
    buffer[2] = val[2];
    buffer[3] = val[3];
    buffer[4] = val[4];
    buffer[5] = val[5];
    buffer[6] = val[6];
    buffer[7] = val[7];
}

template<typename I> void write_int64_be(uint8_t* buffer, I value)
{
    static_assert(std::endian::native == std::endian::little);
    auto val = reinterpret_cast<uint8_t*>(&value);
    buffer[0] = val[7];
    buffer[1] = val[6];
    buffer[2] = val[5];
    buffer[3] = val[4];
    buffer[4] = val[3];
    buffer[5] = val[2];
    buffer[6] = val[1];
    buffer[7] = val[0];
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_writeBigInt64LE, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* castedThis = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(callFrame->thisValue());
    if (!castedThis) [[unlikely]]
        return throwVMError(lexicalGlobalObject, scope, "Expected ArrayBufferView"_s);
    auto byteLength = castedThis->byteLength();

    auto valueVal = callFrame->argument(0);
    auto offsetVal = callFrame->argument(1);

    if (!valueVal.isBigInt()) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "value"_s, "bigint"_s, valueVal);
    auto* bigint = valueVal.asHeapBigInt();
    if (bigint->length() > 1) [[unlikely]]
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "value"_s, ">= -(2n ** 63n) and < 2n ** 63n"_s, valueVal);
    auto limb = valueVal.toBigUInt64(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!bigint->sign() && limb > 0x7fffffffffffffff) return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "value"_s, ">= -(2n ** 63n) and < 2n ** 63n"_s, valueVal);
    if (bigint->sign() && limb - 0x8000000000000000 > 0x7fffffffffffffff) return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "value"_s, ">= -(2n ** 63n) and < 2n ** 63n"_s, valueVal);
    int64_t value = static_cast<int64_t>(limb);

    size_t offset = validateOffsetBigInt64(lexicalGlobalObject, scope, offsetVal, byteLength);
    RETURN_IF_EXCEPTION(scope, {});
    write_int64_le(static_cast<uint8_t*>(castedThis->vector()) + offset, value);
    return JSValue::encode(jsNumber(offset + 8));
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_writeBigInt64BE, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* castedThis = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(callFrame->thisValue());
    if (!castedThis) [[unlikely]]
        return throwVMError(lexicalGlobalObject, scope, "Expected ArrayBufferView"_s);
    auto byteLength = castedThis->byteLength();

    auto valueVal = callFrame->argument(0);
    auto offsetVal = callFrame->argument(1);

    if (!valueVal.isBigInt()) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "value"_s, "bigint"_s, valueVal);
    auto* bigint = valueVal.asHeapBigInt();
    if (bigint->length() > 1) [[unlikely]]
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "value"_s, ">= -(2n ** 63n) and < 2n ** 63n"_s, valueVal);
    auto limb = valueVal.toBigUInt64(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!bigint->sign() && limb > 0x7fffffffffffffff) return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "value"_s, ">= -(2n ** 63n) and < 2n ** 63n"_s, valueVal);
    if (bigint->sign() && limb - 0x8000000000000000 > 0x7fffffffffffffff) return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "value"_s, ">= -(2n ** 63n) and < 2n ** 63n"_s, valueVal);
    int64_t value = static_cast<int64_t>(limb);

    size_t offset = validateOffsetBigInt64(lexicalGlobalObject, scope, offsetVal, byteLength);
    RETURN_IF_EXCEPTION(scope, {});
    write_int64_be(static_cast<uint8_t*>(castedThis->vector()) + offset, value);
    return JSValue::encode(jsNumber(offset + 8));
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_writeBigUInt64LE, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* castedThis = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(callFrame->thisValue());
    if (!castedThis) [[unlikely]]
        return throwVMError(lexicalGlobalObject, scope, "Expected ArrayBufferView"_s);
    auto byteLength = castedThis->byteLength();

    auto valueVal = callFrame->argument(0);
    auto offsetVal = callFrame->argument(1);

    if (!valueVal.isBigInt()) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "value"_s, "bigint"_s, valueVal);
    auto* bigint = valueVal.asHeapBigInt();
    if (bigint->sign()) [[unlikely]]
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "value"_s, ">= 0n and < 2n ** 64n"_s, valueVal);
    if (bigint->length() > 1) [[unlikely]]
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "value"_s, ">= 0n and < 2n ** 64n"_s, valueVal);
    uint64_t value = valueVal.toBigUInt64(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    size_t offset = validateOffsetBigInt64(lexicalGlobalObject, scope, offsetVal, byteLength);
    RETURN_IF_EXCEPTION(scope, {});
    write_int64_le(static_cast<uint8_t*>(castedThis->vector()) + offset, value);
    return JSValue::encode(jsNumber(offset + 8));
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_writeBigUInt64BE, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* castedThis = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(callFrame->thisValue());
    if (!castedThis) [[unlikely]]
        return throwVMError(lexicalGlobalObject, scope, "Expected ArrayBufferView"_s);
    auto byteLength = castedThis->byteLength();

    auto valueVal = callFrame->argument(0);
    auto offsetVal = callFrame->argument(1);

    if (!valueVal.isBigInt()) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "value"_s, "bigint"_s, valueVal);
    auto* bigint = valueVal.asHeapBigInt();
    if (bigint->sign()) [[unlikely]]
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "value"_s, ">= 0n and < 2n ** 64n"_s, valueVal);
    if (bigint->length() > 1) [[unlikely]]
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "value"_s, ">= 0n and < 2n ** 64n"_s, valueVal);
    uint64_t value = valueVal.toBigUInt64(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    size_t offset = validateOffsetBigInt64(lexicalGlobalObject, scope, offsetVal, byteLength);
    RETURN_IF_EXCEPTION(scope, {});
    write_int64_be(static_cast<uint8_t*>(castedThis->vector()) + offset, value);
    return JSValue::encode(jsNumber(offset + 8));
}

/* */

/* Hash table for prototype */

static const HashTableValue JSBufferPrototypeTableValues[]
    = {
          { "asciiSlice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_asciiSlice, 2 } },
          { "asciiWrite"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_asciiWrite, 3 } },
          { "base64Slice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_base64Slice, 2 } },
          { "base64Write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_base64Write, 3 } },
          { "base64urlSlice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_base64urlSlice, 2 } },
          { "base64urlWrite"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_base64urlWrite, 3 } },
          { "compare"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_compare, 5 } },
          { "copy"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_copy, 4 } },
          { "equals"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_equals, 1 } },
          { "fill"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_fill, 4 } },
          { "hexSlice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_hexSlice, 2 } },
          { "hexWrite"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_hexWrite, 3 } },
          { "includes"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_includes, 3 } },
          { "indexOf"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_indexOf, 3 } },
          { "inspect"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_inspect, 2 } },
          { "lastIndexOf"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_lastIndexOf, 3 } },
          { "latin1Slice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_latin1Slice, 2 } },
          { "latin1Write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_latin1Write, 3 } },
          { "offset"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinAccessorType, jsBufferPrototypeOffsetCodeGenerator, 0 } },
          { "parent"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinAccessorType, jsBufferPrototypeParentCodeGenerator, 0 } },
          { "readBigInt64"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadBigInt64LECodeGenerator, 1 } },
          { "readBigInt64BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadBigInt64BECodeGenerator, 1 } },
          { "readBigInt64LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadBigInt64LECodeGenerator, 1 } },
          { "readBigUInt64"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadBigUInt64LECodeGenerator, 1 } },
          { "readBigUInt64BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadBigUInt64BECodeGenerator, 1 } },
          { "readBigUInt64LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadBigUInt64LECodeGenerator, 1 } },
          { "readDouble"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadDoubleLECodeGenerator, 1 } },
          { "readDoubleBE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadDoubleBECodeGenerator, 1 } },
          { "readDoubleLE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadDoubleLECodeGenerator, 1 } },
          { "readFloat"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadFloatLECodeGenerator, 1 } },
          { "readFloatBE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadFloatBECodeGenerator, 1 } },
          { "readFloatLE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadFloatLECodeGenerator, 1 } },
          { "readInt16"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadInt16LECodeGenerator, 1 } },
          { "readInt16BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadInt16BECodeGenerator, 1 } },
          { "readInt16LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadInt16LECodeGenerator, 1 } },
          { "readInt32"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadInt32LECodeGenerator, 1 } },
          { "readInt32BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadInt32BECodeGenerator, 1 } },
          { "readInt32LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadInt32LECodeGenerator, 1 } },
          { "readInt8"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadInt8CodeGenerator, 2 } },
          { "readIntBE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadIntBECodeGenerator, 1 } },
          { "readIntLE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadIntLECodeGenerator, 1 } },
          { "readUInt16BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadUInt16BECodeGenerator, 1 } },
          { "readUInt16LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadUInt16LECodeGenerator, 1 } },
          { "readUInt32BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadUInt32BECodeGenerator, 1 } },
          { "readUInt32LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadUInt32LECodeGenerator, 1 } },
          { "readUInt8"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadUInt8CodeGenerator, 1 } },
          { "readUIntBE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadUIntBECodeGenerator, 1 } },
          { "readUIntLE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeReadUIntLECodeGenerator, 1 } },

          { "slice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeSliceCodeGenerator, 2 } },
          { "subarray"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeSliceCodeGenerator, 2 } },
          { "swap16"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_swap16, 0 } },
          { "swap32"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_swap32, 0 } },
          { "swap64"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_swap64, 0 } },
          { "toJSON"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeToJSONCodeGenerator, 1 } },
          { "toLocaleString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_toString, 4 } },
          { "toString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_toString, 4 } },
          { "ucs2Slice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_utf16leSlice, 2 } },
          { "ucs2Write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_utf16leWrite, 3 } },
          { "utf16leSlice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_utf16leSlice, 2 } },
          { "utf16leWrite"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_utf16leWrite, 3 } },
          { "utf8Slice"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_utf8Slice, 2 } },
          { "utf8Write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_utf8Write, 3 } },
          { "write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_write, 4 } },
          { "writeBigInt64BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_writeBigInt64BE, 3 } },
          { "writeBigInt64LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_writeBigInt64LE, 3 } },
          { "writeBigUInt64BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_writeBigUInt64BE, 3 } },
          { "writeBigUInt64LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBufferPrototypeFunction_writeBigUInt64LE, 3 } },
          { "writeDouble"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteDoubleLECodeGenerator, 1 } },
          { "writeDoubleBE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteDoubleBECodeGenerator, 1 } },
          { "writeDoubleLE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteDoubleLECodeGenerator, 1 } },
          { "writeFloat"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteFloatLECodeGenerator, 1 } },
          { "writeFloatBE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteFloatBECodeGenerator, 1 } },
          { "writeFloatLE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteFloatLECodeGenerator, 1 } },
          { "writeInt16BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteInt16BECodeGenerator, 1 } },
          { "writeInt16LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteInt16LECodeGenerator, 1 } },
          { "writeInt32BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteInt32BECodeGenerator, 1 } },
          { "writeInt32LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteInt32LECodeGenerator, 1 } },
          { "writeInt8"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteInt8CodeGenerator, 1 } },
          { "writeIntBE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteIntBECodeGenerator, 1 } },
          { "writeIntLE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteIntLECodeGenerator, 1 } },
          { "writeUInt16"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteUInt16LECodeGenerator, 1 } },
          { "writeUInt16BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteUInt16BECodeGenerator, 1 } },
          { "writeUInt16LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteUInt16LECodeGenerator, 1 } },
          { "writeUInt32"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteUInt32LECodeGenerator, 1 } },
          { "writeUInt32BE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteUInt32BECodeGenerator, 1 } },
          { "writeUInt32LE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteUInt32LECodeGenerator, 1 } },
          { "writeUInt8"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteUInt8CodeGenerator, 1 } },
          { "writeUIntBE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteUIntBECodeGenerator, 1 } },
          { "writeUIntLE"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, jsBufferPrototypeWriteUIntLECodeGenerator, 1 } },
      };

// TODO: add this as a feature to the hash table generator mechanism above so that we can avoid all the unnecessary extra calls to `Identifier::fromString` and `this->getDirect`.
#define ALIAS(to, from)                                                                          \
    do {                                                                                         \
        auto original_ident = Identifier::fromString(vm, ASCIILiteral::fromLiteralUnsafe(from)); \
        auto original = this->getDirect(vm, original_ident);                                     \
        auto alias_ident = Identifier::fromString(vm, ASCIILiteral::fromLiteralUnsafe(to));      \
        this->putDirect(vm, alias_ident, original, PropertyAttribute::Builtin | 0);              \
    } while (false);

void JSBufferPrototype::finishCreation(VM& vm, JSC::JSGlobalObject* globalThis)
{
    Base::finishCreation(vm);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    reifyStaticProperties(vm, JSBuffer::info(), JSBufferPrototypeTableValues, *this);

    ALIAS("toLocaleString", "toString");

    ALIAS("readUintBE", "readUIntBE");
    ALIAS("readUintLE", "readUIntLE");
    ALIAS("readUint8", "readUInt8");
    ALIAS("readUint16BE", "readUInt16BE");
    ALIAS("readUint16LE", "readUInt16LE");
    ALIAS("readUint32BE", "readUInt32BE");
    ALIAS("readUint32LE", "readUInt32LE");
    ALIAS("readBigUint64BE", "readBigUInt64BE");
    ALIAS("readBigUint64LE", "readBigUInt64LE");

    ALIAS("writeUintBE", "writeUIntBE");
    ALIAS("writeUintLE", "writeUIntLE");
    ALIAS("writeUint8", "writeUInt8");
    ALIAS("writeUint16", "writeUInt16");
    ALIAS("writeUint16BE", "writeUInt16BE");
    ALIAS("writeUint16LE", "writeUInt16LE");
    ALIAS("writeUint32", "writeUInt32");
    ALIAS("writeUint32BE", "writeUInt32BE");
    ALIAS("writeUint32LE", "writeUInt32LE");
    ALIAS("writeBigUint64BE", "writeBigUInt64BE");
    ALIAS("writeBigUint64LE", "writeBigUInt64LE");

    this->putDirect(vm, Identifier::fromUid(vm.symbolRegistry().symbolForKey("nodejs.util.inspect.custom"_s)), this->getDirect(vm, Identifier::fromString(vm, "inspect"_s)), PropertyAttribute::Builtin | 0);
}
#undef ALIAS

const ClassInfo JSBufferPrototype::s_info = {
    // In Node.js, Object.prototype.toString.call(new Buffer(0)) returns "[object Uint8Array]".
    // We must use the same naming convention to match Node
    // Some packages (like MongoDB's official Node.js client) rely on this behavior.
    "Uint8Array"_s,
    &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBufferPrototype)
};

/* Source for JSBuffer.lut.h
@begin jsBufferConstructorTable
    alloc           jsBufferConstructorFunction_alloc              Constructable|Function 1
    allocUnsafe     jsBufferConstructorFunction_allocUnsafe        Constructable|Function 1
    allocUnsafeSlow jsBufferConstructorFunction_allocUnsafeSlow    Constructable|Function 1
    byteLength      jsBufferConstructorFunction_byteLength         Function 2
    compare         jsBufferConstructorFunction_compare            Function 2
    concat          jsBufferConstructorFunction_concat             Function 2
    copyBytesFrom   jsBufferConstructorFunction_copyBytesFrom      Function 1
    from            JSBuiltin                                      Builtin|Function 1
    isBuffer        JSBuiltin                                      Builtin|Function 1
    isEncoding      jsBufferConstructorFunction_isEncoding         Function 1
@end
*/
#include "JSBuffer.lut.h"

const ClassInfo JSBufferConstructor::s_info = { "Buffer"_s, &Base::s_info, &jsBufferConstructorTable, nullptr, CREATE_METHOD_TABLE(JSBufferConstructor) };

void JSBufferConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 3, "Buffer"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    prototype->putDirect(vm, vm.propertyNames->speciesSymbol, this, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirectWithoutTransition(vm, Identifier::fromString(vm, "poolSize"_s), jsNumber(8192));
}

JSC::Structure* createBufferStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSBuffer::createStructure(vm, globalObject, prototype);
}

JSC::JSObject* createBufferPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSBufferPrototype::create(vm, globalObject, JSBufferPrototype::createStructure(vm, globalObject, globalObject->m_typedArrayUint8.prototype(globalObject)));
}

JSC::JSObject* createBufferConstructor(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* bufferPrototype)
{
    return JSBufferConstructor::create(
        vm,
        globalObject,
        JSBufferConstructor::createStructure(vm, globalObject),
        bufferPrototype);
}

} // namespace WebCore

EncodedJSValue constructBufferFromArray(JSC::ThrowScope& throwScope, JSGlobalObject* lexicalGlobalObject, JSValue arrayValue)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    // FIXME: Further optimization possible by calling copyFromInt32ShapeArray/copyFromDoubleShapeArray.
    if (JSArray* array = jsDynamicCast<JSArray*>(arrayValue)) {
        if (isJSArray(array)) {
            size_t length = array->length();

            // Empty array case
            if (length == 0)
                RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(createEmptyBuffer(lexicalGlobalObject)));

            // Allocate uninitialized buffer
            auto* uint8Array = createUninitializedBuffer(lexicalGlobalObject, length);
            RETURN_IF_EXCEPTION(throwScope, {});
            if (!uint8Array) [[unlikely]] {
                throwOutOfMemoryError(lexicalGlobalObject, throwScope);
                return {};
            }

            // setFromArrayLike internally detects Int32Shape/DoubleShape and uses
            // copyFromInt32ShapeArray/copyFromDoubleShapeArray for bulk copy
            bool success = uint8Array->setFromArrayLike(lexicalGlobalObject, 0, array, 0, length);
            RETURN_IF_EXCEPTION(throwScope, {});
            if (!success)
                return {};
            RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(uint8Array));
        }
    }

    // Slow path: array-like objects, iterables
    auto* constructor = lexicalGlobalObject->m_typedArrayUint8.constructor(lexicalGlobalObject);
    MarkedArgumentBuffer argsBuffer;
    argsBuffer.append(arrayValue);
    JSValue target = globalObject->JSBufferConstructor();
    auto* object = JSC::construct(lexicalGlobalObject, constructor, target, argsBuffer, "Buffer failed to construct"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(object));
}

EncodedJSValue constructBufferFromArrayBuffer(JSC::ThrowScope& throwScope, JSGlobalObject* lexicalGlobalObject, size_t argsCount, JSValue arrayBufferValue, JSValue offsetValue, JSValue lengthValue)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto* jsBuffer = jsCast<JSC::JSArrayBuffer*>(arrayBufferValue.asCell());
    RefPtr<ArrayBuffer> buffer = jsBuffer->impl();
    if (buffer->isDetached()) {
        return throwVMTypeError(globalObject, throwScope, "Buffer is detached"_s);
    }
    size_t byteLength = buffer->byteLength();
    size_t offset = 0;
    size_t length = byteLength;

    if (!offsetValue.isUndefined()) {
        double offsetD = offsetValue.toNumber(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (std::isnan(offsetD)) offsetD = 0;
        offset = offsetD;
        if (offset > byteLength) return Bun::ERR::BUFFER_OUT_OF_BOUNDS(throwScope, lexicalGlobalObject, "offset"_s);
        length -= offset;
    }

    if (!lengthValue.isUndefined()) {
        double lengthD = lengthValue.toNumber(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (std::isnan(lengthD)) lengthD = 0;
        length = lengthD;
        if (length > byteLength - offset) return Bun::ERR::BUFFER_OUT_OF_BOUNDS(throwScope, lexicalGlobalObject, "length"_s);
    }

    auto isResizableOrGrowableShared = jsBuffer->isResizableOrGrowableShared();
    if (isResizableOrGrowableShared) {
        auto* subclassStructure = globalObject->JSResizableOrGrowableSharedBufferSubclassStructure();
        auto* uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, WTF::move(buffer), offset, std::nullopt);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!uint8Array) [[unlikely]] {
            throwOutOfMemoryError(globalObject, throwScope);
            return {};
        }
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(uint8Array));
    }
    auto* subclassStructure = globalObject->JSBufferSubclassStructure();
    auto* uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, WTF::move(buffer), offset, length);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!uint8Array) [[unlikely]] {
        throwOutOfMemoryError(globalObject, throwScope);
        return {};
    }

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(uint8Array));
}

static JSC::EncodedJSValue createJSBufferFromJS(JSC::JSGlobalObject* lexicalGlobalObject, JSValue newTarget, ArgList args)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    size_t argsCount = args.size();
    if (argsCount == 0) {
        RELEASE_AND_RETURN(throwScope, constructBufferEmpty(lexicalGlobalObject));
    }
    JSValue distinguishingArg = args.at(0);
    JSValue encodingArg = argsCount > 1 ? args.at(1) : JSValue();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (distinguishingArg.isAnyInt()) {
        throwScope.release();
        if (args.at(1).isString()) {
            return Bun::ERR::INVALID_ARG_TYPE(throwScope, lexicalGlobalObject, "string"_s, "string"_s, distinguishingArg);
        }
        auto anyint = distinguishingArg.asAnyInt();
        if (anyint < 0 or anyint > Bun::Buffer::kMaxLength) return Bun::ERR::OUT_OF_RANGE(throwScope, lexicalGlobalObject, "size"_s, 0, Bun::Buffer::kMaxLength, distinguishingArg);
        RELEASE_AND_RETURN(throwScope, JSValue::encode(allocBuffer(lexicalGlobalObject, anyint)));
    } else if (distinguishingArg.isNumber()) {
        JSValue lengthValue = distinguishingArg;
        Bun::V::validateNumber(throwScope, lexicalGlobalObject, lengthValue, "size"_s, jsNumber(0), jsNumber(Bun::Buffer::kMaxLength));
        RETURN_IF_EXCEPTION(throwScope, {});
        size_t length = lengthValue.toLength(lexicalGlobalObject);
        RELEASE_AND_RETURN(throwScope, JSValue::encode(allocBuffer(lexicalGlobalObject, length)));
    } else if (distinguishingArg.isUndefinedOrNull() || distinguishingArg.isBoolean()) {
        auto arg_string = distinguishingArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        auto message = makeString("The first argument must be of type string or an instance of Buffer, ArrayBuffer, Array or an Array-like object. Received "_s, arg_string);
        return throwVMTypeError(globalObject, throwScope, message);
    } else if (distinguishingArg.isCell()) {
        auto type = distinguishingArg.asCell()->type();
        switch (type) {
        case StringType:
        case StringObjectType:
        case DerivedStringObjectType: {
            throwScope.release();
            return constructBufferFromStringAndEncoding(lexicalGlobalObject, distinguishingArg, encodingArg);
        }
        case Uint16ArrayType:
        case Uint32ArrayType:
        case Int8ArrayType:
        case Int16ArrayType:
        case Int32ArrayType:
        case Float16ArrayType:
        case Float32ArrayType:
        case Float64ArrayType:
        case BigInt64ArrayType:
        case BigUint64ArrayType: {
            // byteOffset and byteLength are ignored in this case, which is consitent with Node.js and new Uint8Array()
            JSC::JSArrayBufferView* view = jsCast<JSC::JSArrayBufferView*>(distinguishingArg.asCell());
            void* data = view->vector();
            size_t byteLength = view->length();
            if (!data) [[unlikely]] {
                throwException(globalObject, throwScope, createRangeError(globalObject, "Buffer is detached"_s));
                return {};
            }
            auto* uint8Array = createUninitializedBuffer(lexicalGlobalObject, byteLength);
            RETURN_IF_EXCEPTION(throwScope, {});
            if (byteLength) {
                uint8Array->setFromTypedArray(lexicalGlobalObject, 0, view, 0, byteLength, CopyType::LeftToRight);
            }
            RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(uint8Array));
            break;
        }
        case DataViewType:
        case Uint8ArrayType:
        case Uint8ClampedArrayType: {
            // byteOffset and byteLength are ignored in this case, which is consitent with Node.js and new Uint8Array()
            JSC::JSArrayBufferView* view = jsCast<JSC::JSArrayBufferView*>(distinguishingArg.asCell());
            void* data = view->vector();
            size_t byteLength = view->byteLength();
            if (!data) [[unlikely]] {
                throwException(globalObject, throwScope, createRangeError(globalObject, "Buffer is detached"_s));
                return {};
            }
            auto* uint8Array = createBuffer(lexicalGlobalObject, static_cast<uint8_t*>(data), byteLength);
            RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(uint8Array));
        }
        case ArrayBufferType: {
            // This closely matches `new Uint8Array(buffer, byteOffset, length)` in JavaScriptCore's implementation.
            // See Source/JavaScriptCore/runtime/JSGenericTypedArrayViewConstructorInlines.h
            return constructBufferFromArrayBuffer(throwScope, lexicalGlobalObject, args.size(), distinguishingArg, args.at(1), args.at(2));
        }
        default: {
            break;
        }
        }
    }

    return constructBufferFromArray(throwScope, lexicalGlobalObject, distinguishingArg);
}
JSC_DEFINE_HOST_FUNCTION(callJSBuffer, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return createJSBufferFromJS(lexicalGlobalObject, callFrame->thisValue(), ArgList(callFrame));
}

JSC_DEFINE_HOST_FUNCTION(constructJSBuffer, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return createJSBufferFromJS(lexicalGlobalObject, callFrame->newTarget(), ArgList(callFrame));
}

bool JSBuffer__isBuffer(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue value)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(value);
    if (!jsValue || !jsValue.isCell())
        return false;

    JSC::JSUint8Array* cell = jsDynamicCast<JSC::JSUint8Array*>(jsValue.asCell());
    if (!cell)
        return false;

    JSValue prototype = cell->getPrototype(lexicalGlobalObject);
    return prototype.inherits<WebCore::JSBufferPrototype>();
}
