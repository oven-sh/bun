#include "JSStringDecoder.h"
#include "JSBuffer.h"
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "JavaScriptCore/ExceptionScope.h"
#include "ZigGlobalObject.h"
#include "JSDOMOperation.h"
#include "JSDOMAttribute.h"
#include "headers.h"
#include "JSDOMConvertEnumeration.h"
#include <JavaScriptCore/JSArrayBufferView.h>
#include "BunClientData.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/text/StringImpl.h"
#include "wtf/unicode/CharacterNames.h"
#include "wtf/SIMDUTF.h"
#include "ErrorCode.h"

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_write);
static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_end);
static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_text);

static JSC_DECLARE_CUSTOM_GETTER(jsStringDecoder_lastChar);
static JSC_DECLARE_CUSTOM_GETTER(jsStringDecoder_lastNeed);
static JSC_DECLARE_CUSTOM_GETTER(jsStringDecoder_lastTotal);
static JSC_DECLARE_CUSTOM_GETTER(jsStringDecoder_encoding);

static WTF::String replacementString()
{
    return WTF::String(std::span<const UChar> { u"\uFFFD", 1 });
}
static WTF::String replacementString2()
{
    return WTF::String(std::span<const UChar> { u"\uFFFD\uFFFD", 2 });
}
static WTF::String replacementString3()
{
    return WTF::String(std::span<const UChar> { u"\uFFFD\uFFFD\uFFFD", 3 });
}

// Checks the type of a UTF-8 byte, whether it's ASCII, a leading byte, or a
// continuation byte.
//     0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F
// 0   0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0
// 1   0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0
// 2   0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0
// 3   0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0
// 4   0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0
// 5   0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0
// 6   0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0
// 7   0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0
// 8  -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1
// 9  -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1
// A  -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1
// B  -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1
// C   2  2  2  2  2  2  2  2  2  2  2  2  2  2  2  2
// D   2  2  2  2  2  2  2  2  2  2  2  2  2  2  2  2
// E   3  3  3  3  3  3  3  3  3  3  3  3  3  3  3  3
// F   4  4  4  4  4  4  4  4 -2 -2 -2 -2 -2 -2 -2 -2
int8_t utf8CheckByte(uint8_t byte)
{
    if (byte <= 0x7F)
        return 0; // ASCII
    else if ((byte >> 5) == 0x06)
        return 2; // 2-byte Start
    else if ((byte >> 4) == 0x0E)
        return 3; // 3-byte Start
    else if ((byte >> 3) == 0x1E)
        return 4; // 4-byte Start
    return (byte >> 6) == 0x02
        ? -1 // Continuation
        : -2; // Invalid
}

ALWAYS_INLINE bool isContinuation(uint8_t byte)
{
    return (byte & 0xC0) == 0x80;
}

static inline JSStringDecoder* jsStringDecoderCast(JSGlobalObject* globalObject, JSValue stringDecoderValue, WTF::ASCIILiteral functionName)
{
    ASSERT(stringDecoderValue);
    if (auto cast = jsDynamicCast<JSStringDecoder*>(stringDecoderValue); LIKELY(cast))
        return cast;

    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (JSC::JSObject* thisObject = stringDecoderValue.getObject()) {
        auto clientData = WebCore::clientData(vm);
        JSValue existingDecoderValue = thisObject->getIfPropertyExists(globalObject, clientData->builtinNames().decodePrivateName());
        if (LIKELY(existingDecoderValue)) {
            if (auto cast = jsDynamicCast<JSStringDecoder*>(existingDecoderValue); LIKELY(cast))
                return cast;
        }
    }

    throwThisTypeError(*globalObject, throwScope, JSStringDecoder::info()->className, functionName);
    return nullptr;
}

void JSStringDecoder::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

// Checks at most 3 bytes at the end of a Buffer in order to detect an
// incomplete multi-byte UTF-8 character. The total number of bytes (2, 3, or 4)
// needed to complete the UTF-8 character (if applicable) are returned.
uint8_t JSStringDecoder::utf8CheckIncomplete(uint8_t* bufPtr, uint32_t length, uint32_t i)
{
    uint32_t j = length - 1;
    if (j < i)
        return 0;
    int8_t nb = utf8CheckByte(bufPtr[j]);
    if (nb >= 0) {
        if (nb > 0)
            m_lastNeed = nb - 1;
        return nb;
    }
    if (j == 0 || --j < i || nb == -2)
        return 0;
    nb = utf8CheckByte(bufPtr[j]);
    if (nb >= 0) {
        if (nb > 0)
            m_lastNeed = nb - 2;
        return nb;
    }
    if (j == 0 || --j < i || nb == -2)
        return 0;
    nb = utf8CheckByte(bufPtr[j]);
    if (nb >= 0) {
        if (nb > 0) {
            if (nb == 2)
                nb = 0;
            else
                m_lastNeed = nb - 3;
        }
        return nb;
    }
    return 0;
}

JSC::JSValue JSStringDecoder::fillLast(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint8_t* bufPtr, uint32_t length)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (m_encoding == BufferEncodingType::utf8) {
        // Check if the start has a failing UTF-8 code point. This is checking
        // for situations where the a new character starts instead of a
        // continuation byte. In this case, lastNeed (offset for decoding the
        // rest of bufPtr) needs to be set less than the number of codepoints
        // from what lastChar[0] requests since a new character starts.
        // Example:
        // [ 0xcc ] + [ 0xcc, 0x8c ]
        // The first byte is not known to be an error until the second chunk
        // comes in, to which the error is just the first 0xcc, and then
        // the second two bytes are seen as the valid code point.
        uint32_t max = std::min<uint32_t>(length, m_lastNeed);
        for (uint32_t i = 0; i < max; i++) {
            if (!isContinuation(bufPtr[i])) {
                // copy the continuation bytes to lastChar, then run it through
                // originally this had an abridged version of the utf-8 decoder,
                // but doing that is going to be more error prone.
                // Example: [ 0xf2, 0x90 ] + [ 0xD0 ] -> '' + '\uFFFD' + '\uFFFD'
                //            ~~~~~~~~~~       ~~~~  two total errors
                // Example: [ 0xf6, 0x90 ] + [ 0xD0 ] -> '' + '\uFFFD\uFFFD' + '\uFFFD'
                //            ~~~~  ~~~~       ~~~~  three total errors
                //            ^ 0xF6 is an invalid start byte
                uint32_t chars = m_lastTotal - m_lastNeed + i;
                memmove(m_lastChar + m_lastTotal - m_lastNeed, bufPtr, i);
                m_lastNeed = i;
                RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, chars, globalObject, static_cast<uint8_t>(m_encoding))));
            }
        }
    }
    if (m_lastNeed <= length) {
        memmove(m_lastChar + m_lastTotal - m_lastNeed, bufPtr, m_lastNeed);
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, m_lastTotal, globalObject, static_cast<uint8_t>(m_encoding))));
    }

    memmove(m_lastChar + m_lastTotal - m_lastNeed, bufPtr, length);
    if (m_encoding == BufferEncodingType::utf8) {
        uint32_t lastLastNeed = m_lastNeed;
        uint32_t total = utf8CheckIncomplete(m_lastChar, m_lastTotal - lastLastNeed + length, 0);
        if (total == 0) {
            uint32_t len = m_lastTotal - m_lastNeed + length;
            m_lastNeed = length;
            RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, len, globalObject, static_cast<uint8_t>(m_encoding))));
        }
        m_lastNeed = lastLastNeed;
    }

    m_lastNeed -= length;
    RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
}

// This is not the exposed text
JSC::JSValue JSStringDecoder::text(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint8_t* bufPtr, uint32_t length, uint32_t offset)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    switch (m_encoding) {
    case BufferEncodingType::ucs2:
    case BufferEncodingType::utf16le: {
        if (length == offset)
            RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
        if ((length - offset) % 2 == 0) {
            UChar c = (static_cast<uint16_t>(bufPtr[length - 1]) << 8) + static_cast<uint16_t>(bufPtr[length - 2]);
            if (c >= 0xD800 && c <= 0xDBFF) {
                m_lastNeed = 2;
                m_lastTotal = 4;
                m_lastChar[0] = bufPtr[length - 2];
                m_lastChar[1] = bufPtr[length - 1];
                RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(bufPtr + offset, length - offset - 2, globalObject, static_cast<uint8_t>(m_encoding))));
            }
            RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(bufPtr + offset, length - offset, globalObject, static_cast<uint8_t>(m_encoding))));
        }
        m_lastNeed = 1;
        m_lastTotal = 2;
        m_lastChar[0] = bufPtr[length - 1];
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(bufPtr + offset, length - offset - 1, globalObject, static_cast<uint8_t>(m_encoding))));
    }
    case BufferEncodingType::utf8: {
        uint32_t total = utf8CheckIncomplete(bufPtr, length, offset);
        if (!m_lastNeed)
            RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(bufPtr + offset, length - offset, globalObject, static_cast<uint8_t>(m_encoding))));
        m_lastTotal = total;
        uint32_t end = length - (total - m_lastNeed);
        if (end < length)
            memmove(m_lastChar, bufPtr + end, std::min(4U, length - end));
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(bufPtr + offset, end - offset, globalObject, static_cast<uint8_t>(m_encoding))));
    }
    case BufferEncodingType::base64:
    case BufferEncodingType::base64url: {
        uint32_t n = (length - offset) % 3;
        if (n == 0)
            RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(bufPtr + offset, length - offset, globalObject, static_cast<uint8_t>(m_encoding))));
        m_lastNeed = 3 - n;
        m_lastTotal = 3;
        if (n == 1) {
            m_lastChar[0] = bufPtr[length - 1];
        } else {
            m_lastChar[0] = bufPtr[length - 2];
            m_lastChar[1] = bufPtr[length - 1];
        }
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(bufPtr + offset, length - offset - n, globalObject, static_cast<uint8_t>(m_encoding))));
    }
    default: {
        // should never reach here.
        RELEASE_AND_RETURN(throwScope, JSC::jsUndefined());
        break;
    }
    }

    __builtin_unreachable();
}

JSC::JSValue JSStringDecoder::write(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint8_t* bufPtr, uint32_t length)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (length == 0)
        RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));

    switch (m_encoding) {
    case BufferEncodingType::ucs2:
    case BufferEncodingType::utf16le:
    case BufferEncodingType::utf8:
    case BufferEncodingType::base64:
    case BufferEncodingType::base64url: {
        uint32_t offset = 0;
        if (m_lastNeed) {
            JSString* firstHalf = fillLast(vm, globalObject, bufPtr, length).toString(globalObject);
            RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
            if (firstHalf->length() == 0)
                RELEASE_AND_RETURN(throwScope, firstHalf);
            offset = m_lastNeed;
            m_lastNeed = 0;
            if (offset == length)
                RELEASE_AND_RETURN(throwScope, firstHalf);

            JSString* secondHalf = text(vm, globalObject, bufPtr, length, offset).toString(globalObject);
            RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
            if (secondHalf->length() == 0)
                RELEASE_AND_RETURN(throwScope, firstHalf);
            RELEASE_AND_RETURN(throwScope, JSC::jsString(globalObject, firstHalf, secondHalf));
        }
        JSString* str = text(vm, globalObject, bufPtr, length, offset).toString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
        RELEASE_AND_RETURN(throwScope, str);
    }
    default: {
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(bufPtr, length, globalObject, static_cast<uint8_t>(m_encoding))));
    }
    }

    __builtin_unreachable();
}

class ResetScope final {
public:
    ResetScope(JSStringDecoder* decoder);
    ~ResetScope();
    JSStringDecoder* m_decoder;
};

ResetScope::ResetScope(JSStringDecoder* decoder)
{
    m_decoder = decoder;
}

ResetScope::~ResetScope()
{
    m_decoder->m_lastTotal = 0;
    m_decoder->m_lastNeed = 0;
    memset(m_decoder->m_lastChar, 0, 4);
}

JSC::JSValue
JSStringDecoder::end(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint8_t* bufPtr, uint32_t length)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto resetScope = ResetScope(this);
    switch (m_encoding) {
    case BufferEncodingType::ucs2:
    case BufferEncodingType::utf16le: {
        if (length == 0) {
            if (m_lastNeed) {
                RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, m_lastTotal - m_lastNeed, globalObject, static_cast<uint8_t>(m_encoding))));
            } else {
                RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
            }
        }
        JSString* firstHalf = write(vm, globalObject, bufPtr, length).toString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
        if (m_lastNeed) {
            JSString* secondHalf = JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, m_lastTotal - m_lastNeed, globalObject, static_cast<uint8_t>(m_encoding))).toString(globalObject);
            RELEASE_AND_RETURN(throwScope, JSC::jsString(globalObject, firstHalf, secondHalf));
        } else {
            RELEASE_AND_RETURN(throwScope, firstHalf);
        }
    }
    case BufferEncodingType::utf8: {
        if (length == 0) {
            RELEASE_AND_RETURN(throwScope, m_lastNeed ? JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, m_lastTotal - m_lastNeed, globalObject, static_cast<uint8_t>(m_encoding))) : JSC::jsEmptyString(vm));
        }
        JSString* firstHalf = write(vm, globalObject, bufPtr, length).toString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
        RELEASE_AND_RETURN(throwScope,
            m_lastNeed
                ? JSC::jsString(
                      globalObject,
                      firstHalf,
                      jsCast<JSString*>(JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, m_lastTotal - m_lastNeed, globalObject, static_cast<uint8_t>(m_encoding)))))
                : firstHalf);
    }
    case BufferEncodingType::base64:
    case BufferEncodingType::base64url: {
        if (length == 0) {
            if (m_lastNeed) {
                RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, 3 - m_lastNeed, globalObject, static_cast<uint8_t>(m_encoding))));
            } else {
                RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
            }
        }
        JSString* firstHalf = write(vm, globalObject, bufPtr, length).toString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
        if (m_lastNeed) {
            JSString* secondHalf = JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, 3 - m_lastNeed, globalObject, static_cast<uint8_t>(m_encoding))).toString(globalObject);
            RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
            RELEASE_AND_RETURN(throwScope, JSC::jsString(globalObject, firstHalf, secondHalf));
        } else {
            RELEASE_AND_RETURN(throwScope, firstHalf);
        }
    }
    default: {
        if (length == 0) {
            RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
        }
        RELEASE_AND_RETURN(throwScope, write(vm, globalObject, bufPtr, length));
    }
    }
}

const JSC::ClassInfo JSStringDecoder::s_info = { "StringDecoder"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStringDecoder) };

JSC::GCClient::IsoSubspace* JSStringDecoder::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSStringDecoder, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForStringDecoder.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForStringDecoder = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForStringDecoder.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForStringDecoder = std::forward<decltype(space)>(space); });
}

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSStringDecoderPrototype, JSStringDecoderPrototype::Base);

static inline JSC::EncodedJSValue jsStringDecoderPrototypeFunction_writeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, JSStringDecoder* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return {};
    }

    auto buffer = callFrame->uncheckedArgument(0);
    JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
    if (UNLIKELY(!view || view->isDetached())) {
        // What node does:
        // StringDecoder.prototype.write = function write(buf) {
        // if (typeof buf === 'string')
        //     return buf;
        if (buffer.isString()) {
            return JSC::JSValue::encode(buffer);
        }

        return Bun::ERR::INVALID_ARG_TYPE(throwScope, lexicalGlobalObject, "buf"_s, "Buffer, TypedArray, or DataView"_s, buffer);
    }
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->write(vm, lexicalGlobalObject, reinterpret_cast<uint8_t*>(view->vector()), view->byteLength())));
}
static inline JSC::EncodedJSValue jsStringDecoderPrototypeFunction_endBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, JSStringDecoder* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) {
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->end(vm, lexicalGlobalObject, nullptr, 0)));
    }

    auto buffer = callFrame->uncheckedArgument(0);
    JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
    if (UNLIKELY(!view || view->isDetached())) {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Expected Uint8Array"_s);
        return {};
    }
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->end(vm, lexicalGlobalObject, reinterpret_cast<uint8_t*>(view->vector()), view->byteLength())));
}
static inline JSC::EncodedJSValue jsStringDecoderPrototypeFunction_textBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, JSStringDecoder* castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 2) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return {};
    }

    auto buffer = callFrame->uncheckedArgument(0);
    JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
    if (UNLIKELY(!view || view->isDetached())) {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Expected Uint8Array"_s);
        return {};
    }
    int32_t offset = callFrame->uncheckedArgument(1).toInt32(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
    uint32_t byteLength = view->byteLength();
    if (offset > byteLength)
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsEmptyString(vm)));
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->write(vm, lexicalGlobalObject, reinterpret_cast<uint8_t*>(view->vector()) + offset, byteLength - offset)));
}

JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_write,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSStringDecoder* castedThis = jsStringDecoderCast(globalObject, callFrame->thisValue(), "write"_s);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));
    return jsStringDecoderPrototypeFunction_writeBody(globalObject, callFrame, castedThis);
}
JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_end,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSStringDecoder* castedThis = jsStringDecoderCast(globalObject, callFrame->thisValue(), "end"_s);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));
    return jsStringDecoderPrototypeFunction_endBody(globalObject, callFrame, castedThis);
}
JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_text,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSStringDecoder* castedThis = jsStringDecoderCast(globalObject, callFrame->thisValue(), "text"_s);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));
    return jsStringDecoderPrototypeFunction_textBody(globalObject, callFrame, castedThis);
}

static JSC_DEFINE_CUSTOM_GETTER(jsStringDecoder_lastChar, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSStringDecoder* castedThis = jsStringDecoderCast(lexicalGlobalObject, JSC::JSValue::decode(thisValue), "text"_s);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));
    auto buffer = ArrayBuffer::create({ castedThis->m_lastChar, 4 });
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSC::JSUint8Array* uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(buffer), 0, 4);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(uint8Array));
}
static JSC_DEFINE_CUSTOM_GETTER(jsStringDecoder_lastNeed, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSStringDecoder* castedThis = jsStringDecoderCast(lexicalGlobalObject, JSC::JSValue::decode(thisValue), "lastNeed"_s);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsNumber(castedThis->m_lastNeed)));
}
static JSC_DEFINE_CUSTOM_GETTER(jsStringDecoder_lastTotal, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSStringDecoder* castedThis = jsStringDecoderCast(lexicalGlobalObject, JSC::JSValue::decode(thisValue), "lastTotal"_s);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsNumber(castedThis->m_lastTotal)));
}

static JSC_DEFINE_CUSTOM_GETTER(jsStringDecoder_encoding, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSStringDecoder* castedThis = jsStringDecoderCast(lexicalGlobalObject, JSC::JSValue::decode(thisValue), "lastTotal"_s);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode({}));
    return JSC::JSValue::encode(WebCore::convertEnumerationToJS<BufferEncodingType>(*lexicalGlobalObject, castedThis->m_encoding));
}

/* Hash table for prototype */
static const HashTableValue JSStringDecoderPrototypeTableValues[]
    = {
          { "lastChar"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsStringDecoder_lastChar, 0 } },
          { "lastNeed"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsStringDecoder_lastNeed, 0 } },
          { "lastTotal"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsStringDecoder_lastTotal, 0 } },
          { "encoding"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsStringDecoder_encoding, 0 } },
          { "write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStringDecoderPrototypeFunction_write, 1 } },
          { "end"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStringDecoderPrototypeFunction_end, 1 } },
          { "text"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStringDecoderPrototypeFunction_text, 2 } },
      };

void JSStringDecoderPrototype::finishCreation(VM& vm, JSC::JSGlobalObject* globalThis)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSStringDecoder::info(), JSStringDecoderPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSStringDecoderPrototype::s_info = { "StringDecoder"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStringDecoderPrototype) };

void JSStringDecoderConstructor::finishCreation(VM& vm, JSC::JSGlobalObject* globalObject, JSStringDecoderPrototype* prototype)
{
    Base::finishCreation(vm, 0, "StringDecoder"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

JSStringDecoderConstructor* JSStringDecoderConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSStringDecoderPrototype* prototype)
{
    JSStringDecoderConstructor* ptr = new (NotNull, JSC::allocateCell<JSStringDecoderConstructor>(vm)) JSStringDecoderConstructor(vm, structure, construct);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

JSC::EncodedJSValue JSStringDecoderConstructor::construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto encoding = BufferEncodingType::utf8;
    auto jsEncoding = callFrame->argument(0);
    if (!jsEncoding.isUndefinedOrNull()) {
        std::optional<BufferEncodingType> opt = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, jsEncoding);
        if (opt.has_value()) {
            encoding = opt.value();
        } else {
            auto* encodingString = jsEncoding.toString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(throwScope, {});
            const auto& view = encodingString->view(lexicalGlobalObject);
            return Bun::ERR::UNKNOWN_ENCODING(throwScope, lexicalGlobalObject, view);
        }
    }
    JSValue thisValue = callFrame->newTarget();
    auto* globalObject = JSC::jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSObject* newTarget = asObject(thisValue);
    auto* constructor = globalObject->JSStringDecoder();
    Structure* structure = globalObject->JSStringDecoderStructure();

    JSStringDecoder* jsObject = JSStringDecoder::create(
        vm, lexicalGlobalObject, structure, encoding);

    // StringDecodeer is a Weird one
    // This is a hack to make express' body-parser work
    // It does something weird with the prototype
    // Not exactly a subclass
    if (constructor != newTarget && callFrame->thisValue().isObject()) {
        auto clientData = WebCore::clientData(vm);
        JSObject* thisObject = asObject(callFrame->thisValue());

        thisObject->putDirect(vm, clientData->builtinNames().decodePrivateName(), jsObject, JSC::PropertyAttribute::DontEnum | 0);
        thisObject->putDirect(vm, clientData->builtinNames().encodingPublicName(), convertEnumerationToJS<BufferEncodingType>(*lexicalGlobalObject, encoding), JSC::PropertyAttribute::DontEnum | 0);
        return JSC::JSValue::encode(thisObject);
    }

    return JSC::JSValue::encode(jsObject);
}

void JSStringDecoderConstructor::initializeProperties(VM& vm, JSC::JSGlobalObject* globalObject, JSStringDecoderPrototype* prototype)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "StringDecoder"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

const ClassInfo JSStringDecoderConstructor::s_info = { "StringDecoder"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStringDecoderConstructor) };

} // namespace Zig
