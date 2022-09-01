#include "JSStringDecoder.h"
#include "JSBuffer.h"
#include "JavaScriptCore/Lookup.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "ZigGlobalObject.h"
#include "JSDOMOperation.h"
#include "headers.h"
#include "JSDOMConvertEnumeration.h"

namespace WebCore {

using namespace JSC;

void JSStringDecoder::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

JSC::JSValue JSStringDecoder::fillLast(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSUint8Array* buf)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    uint32_t length = buf->length();
    uint8_t* bufPtr = buf->typedVector();

    if (m_encoding == BufferEncodingType::utf8) {
        // utf8CheckExtraBytes
        if ((bufPtr[0] & 0xC0) != 0x80) {
            m_lastNeed = 0;
            RELEASE_AND_RETURN(throwScope, JSC::jsString(vm, WTF::String(u"\uFFFD", 1)));
        }
        if (m_lastNeed > 1 && length > 1) {
            if ((bufPtr[1] & 0xC0) != 0x80) {
                m_lastNeed = 1;
                RELEASE_AND_RETURN(throwScope, JSC::jsString(vm, WTF::String(u"\uFFFD", 1)));
            }
            if (m_lastNeed > 2 && length > 2) {
                 if ((bufPtr[2] & 0xC0) != 0x80) {
                    m_lastNeed = 2;
                    RELEASE_AND_RETURN(throwScope, JSC::jsString(vm, WTF::String(u"\uFFFD", 1)));
                }
            }
        }
    }

    if (m_lastNeed <= length) {
        memmove(m_lastChar + m_lastTotal - m_lastNeed, bufPtr, m_lastNeed);
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, m_lastTotal, globalObject, static_cast<uint8_t>(m_encoding))));
    }
    memmove(m_lastChar + m_lastTotal - m_lastNeed, bufPtr, length);
    m_lastNeed -= length;
    RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
}

// Checks the type of a UTF-8 byte, whether it's ASCII, a leading byte, or a
// continuation byte. If an invalid byte is detected, -2 is returned.
int8_t utf8CheckByte(uint8_t byte) {
    if (byte <= 0x7F) return 0;
    else if ((byte >> 5) == 0x06) return 2;
    else if ((byte >> 4) == 0x0E) return 3;
    else if ((byte >> 3) == 0x1E) return 4;
    return (byte >> 6) == 0x02 ? -1 : -2;
}

// Checks at most 3 bytes at the end of a Buffer in order to detect an
// incomplete multi-byte UTF-8 character. The total number of bytes (2, 3, or 4)
// needed to complete the UTF-8 character (if applicable) are returned.
uint8_t JSStringDecoder::utf8CheckIncomplete(JSC::JSUint8Array* buf, uint32_t i)
{
    uint32_t j = buf->length() - 1;
    uint8_t* bufPtr = buf->typedVector();
    if (j < i) return 0;
    int8_t nb = utf8CheckByte(bufPtr[j]);
    if (nb >= 0) {
        if (nb > 0) m_lastNeed = nb - 1;
        return nb;
    }
    if (--j < i || nb == -2) return 0;
    nb = utf8CheckByte(bufPtr[j]);
    if (nb >= 0) {
        if (nb > 0) m_lastNeed = nb - 2;
        return nb;
    }
    if (--j < i || nb == -2) return 0;
    nb = utf8CheckByte(bufPtr[j]);
    if (nb >= 0) {
        if (nb > 0) {
            if (nb == 2) nb = 0;else m_lastNeed = nb - 3;
        }
        return nb;
    }
    return 0;
}

JSC::JSValue JSStringDecoder::text(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSUint8Array* buf, uint32_t offset)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    uint32_t length = buf->length();
    uint8_t* bufPtr = buf->typedVector();

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
        uint32_t total = utf8CheckIncomplete(buf, offset);
        if (!m_lastNeed)
            RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(bufPtr + offset, length - offset, globalObject, static_cast<uint8_t>(m_encoding))));
        m_lastTotal = total;
        uint32_t end = length - (total - m_lastNeed);
        if (end < length)
            memmove(m_lastChar, bufPtr + end, std::min(4U, length - end));
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(bufPtr + offset, end - offset, globalObject, static_cast<uint8_t>(m_encoding))));
    }
    case BufferEncodingType::base64: {
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
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
    }
    }
    
}

JSC::JSValue JSStringDecoder::write(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSUint8Array* buf)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (buf->length() == 0)
        RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));

    switch (m_encoding) {
    case BufferEncodingType::ucs2:
    case BufferEncodingType::utf16le:
    case BufferEncodingType::utf8:
    case BufferEncodingType::base64: {
        uint32_t offset = 0;
        if (m_lastNeed) {
            JSString* firstHalf = fillLast(vm, globalObject, buf).toString(globalObject);
            RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
            if (firstHalf->length() == 0)
                RELEASE_AND_RETURN(throwScope, firstHalf);
            offset = m_lastNeed;
            m_lastNeed = 0;

            JSString* secondHalf = text(vm, globalObject, buf, offset).toString(globalObject);
            RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
            if (secondHalf->length() == 0)
                RELEASE_AND_RETURN(throwScope, firstHalf);
            RELEASE_AND_RETURN(throwScope, JSC::jsString(globalObject, firstHalf, secondHalf));
        }
        JSString* str = text(vm, globalObject, buf, offset).toString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
        RELEASE_AND_RETURN(throwScope, str);
    }
    default: {
        uint32_t length = buf->length();
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(buf->typedVector(), length, globalObject, static_cast<uint8_t>(m_encoding))));
    }
    }
}

JSC::JSValue JSStringDecoder::end(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSUint8Array* buf)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    switch (m_encoding) {
    case BufferEncodingType::ucs2:
    case BufferEncodingType::utf16le: {
        if (buf == nullptr || buf->length() == 0) {
            if (m_lastNeed) {
                RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, m_lastTotal - m_lastNeed, globalObject, static_cast<uint8_t>(m_encoding))));
            } else {
                RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
            }
        }
        JSString* firstHalf = write(vm, globalObject, buf).toString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
        if (m_lastNeed) {
            JSString* secondHalf = JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, m_lastTotal - m_lastNeed, globalObject, static_cast<uint8_t>(m_encoding))).toString(globalObject);
            RELEASE_AND_RETURN(throwScope, JSC::jsString(globalObject, firstHalf, secondHalf));
        } else {
            RELEASE_AND_RETURN(throwScope, firstHalf);
        }
    }
    case BufferEncodingType::utf8: {
        if (buf == nullptr || buf->length() == 0) {
            RELEASE_AND_RETURN(throwScope, m_lastNeed ? JSC::jsString(vm, WTF::String(u"\uFFFD", 1)) : JSC::jsEmptyString(vm));
        }
        JSString* firstHalf = write(vm, globalObject, buf).toString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
        RELEASE_AND_RETURN(throwScope, m_lastNeed ? JSC::jsString(globalObject, firstHalf, WTF::String(u"\uFFFD", 1)) : firstHalf);
    }
    case BufferEncodingType::base64: {
        if (buf == nullptr || buf->length() == 0) {
            if (m_lastNeed) {
                RELEASE_AND_RETURN(throwScope, JSC::JSValue::decode(Bun__encoding__toString(m_lastChar, 3 - m_lastNeed, globalObject, static_cast<uint8_t>(m_encoding))));
            } else {
                RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
            }
        }
        JSString* firstHalf = write(vm, globalObject, buf).toString(globalObject);
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
        if (buf == nullptr) {
            RELEASE_AND_RETURN(throwScope, JSC::jsEmptyString(vm));
        }
        RELEASE_AND_RETURN(throwScope, write(vm, globalObject, buf));
    }
    }
}

const JSC::ClassInfo JSStringDecoder::s_info = { "StringDecoder"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStringDecoder) };

JSC::GCClient::IsoSubspace* JSStringDecoder::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSStringDecoder, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForStringDecoder.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForStringDecoder = WTFMove(space); },
        [](auto& spaces) { return spaces.m_subspaceForStringDecoder.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForStringDecoder = WTFMove(space); });
}

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSStringDecoderPrototype, JSStringDecoderPrototype::Base);

static inline JSC::EncodedJSValue jsStringDecoderPrototypeFunction_writeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSStringDecoder>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }

    auto buffer = callFrame->uncheckedArgument(0);
    JSC::JSUint8Array* view = JSC::jsDynamicCast<JSC::JSUint8Array*>(buffer);
    if (!view) {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Expected Uint8Array"_s);
        return JSValue::encode(jsUndefined());
    }
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->write(vm, lexicalGlobalObject, view)));
}

static inline JSC::EncodedJSValue jsStringDecoderPrototypeFunction_endBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSStringDecoder>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) {
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->end(vm, lexicalGlobalObject, nullptr)));
    }

    auto buffer = callFrame->uncheckedArgument(0);
    JSC::JSUint8Array* view = JSC::jsDynamicCast<JSC::JSUint8Array*>(buffer);
    if (!view) {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Expected Uint8Array"_s);
        return JSValue::encode(jsUndefined());
    }
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->end(vm, lexicalGlobalObject, view)));
}

static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_write);
static JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_write,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSStringDecoder>::call<jsStringDecoderPrototypeFunction_writeBody>(*globalObject, *callFrame, "write");
}
static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_end);
static JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_end,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSStringDecoder>::call<jsStringDecoderPrototypeFunction_endBody>(*globalObject, *callFrame, "end");
}

/* Hash table for prototype */
static const HashTableValue JSStringDecoderPrototypeTableValues[]
    = {
          { "write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStringDecoderPrototypeFunction_write, 1 } },
          { "end"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsStringDecoderPrototypeFunction_end, 1 } },
      };

void JSStringDecoderPrototype::finishCreation(VM& vm, JSC::JSGlobalObject* globalThis)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSStringDecoder::info(), JSStringDecoderPrototypeTableValues, *this);
}

const ClassInfo JSStringDecoderPrototype::s_info = { "StringDecoder"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(JSStringDecoderPrototype) };

EncodedJSValue constructJSStringDecoder(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto encoding = BufferEncodingType::utf8;
    if (callFrame->argumentCount() > 0) {
      auto encoding_ = callFrame->argument(0).toString(globalObject);
      std::optional<BufferEncodingType> opt = parseEnumeration<BufferEncodingType>(*globalObject, encoding_);
      if (opt.has_value()) {
        encoding = opt.value();
      }
    }
    JSStringDecoderPrototype* prototype = JSStringDecoderPrototype::create(
        vm, globalObject, JSStringDecoderPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
    JSStringDecoder* stringDecoder = JSStringDecoder::create(
        vm, globalObject, JSStringDecoder::createStructure(vm, globalObject, prototype), encoding);
    return JSC::JSValue::encode(stringDecoder);
}

} // namespace Zig
