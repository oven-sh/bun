#include "JSStringDecoder.h"
#include "JSBuffer.h"
#include "JavaScriptCore/Lookup.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "ZigGlobalObject.h"
#include "JSDOMOperation.h"
#include "JSDOMAttribute.h"
#include "headers.h"
#include "JSDOMConvertEnumeration.h"
#include "JavaScriptCore/JSArrayBufferView.h"

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_write);
static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_end);
static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_text);

static JSC_DECLARE_CUSTOM_GETTER(jsStringDecoder_lastChar);
static JSC_DECLARE_CUSTOM_GETTER(jsStringDecoder_lastNeed);
static JSC_DECLARE_CUSTOM_GETTER(jsStringDecoder_lastTotal);

void JSStringDecoder::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

JSC::JSValue JSStringDecoder::fillLast(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint8_t* bufPtr, uint32_t length)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);

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
int8_t utf8CheckByte(uint8_t byte)
{
    if (byte <= 0x7F)
        return 0;
    else if ((byte >> 5) == 0x06)
        return 2;
    else if ((byte >> 4) == 0x0E)
        return 3;
    else if ((byte >> 3) == 0x1E)
        return 4;
    return (byte >> 6) == 0x02 ? -1 : -2;
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
    if (--j < i || nb == -2)
        return 0;
    nb = utf8CheckByte(bufPtr[j]);
    if (nb >= 0) {
        if (nb > 0)
            m_lastNeed = nb - 2;
        return nb;
    }
    if (--j < i || nb == -2)
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
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
    }
    }
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
}

JSC::JSValue JSStringDecoder::end(JSC::VM& vm, JSC::JSGlobalObject* globalObject, uint8_t* bufPtr, uint32_t length)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
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
            RELEASE_AND_RETURN(throwScope, m_lastNeed ? JSC::jsString(vm, WTF::String(u"\uFFFD", 1)) : JSC::jsEmptyString(vm));
        }
        JSString* firstHalf = write(vm, globalObject, bufPtr, length).toString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
        RELEASE_AND_RETURN(throwScope, m_lastNeed ? JSC::jsString(globalObject, firstHalf, WTF::String(u"\uFFFD", 1)) : firstHalf);
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
    JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
    if (UNLIKELY(!view || view->isDetached())) {
        // What node does:
        // StringDecoder.prototype.write = function write(buf) {
        // if (typeof buf === 'string')
        //     return buf;
        if (buffer.isString()) {
            return JSC::JSValue::encode(buffer);
        }

        throwVMTypeError(lexicalGlobalObject, throwScope, "Expected Uint8Array"_s);
        return JSValue::encode(jsUndefined());
    }
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->write(vm, lexicalGlobalObject, reinterpret_cast<uint8_t*>(view->vector()), view->byteLength())));
}
static inline JSC::EncodedJSValue jsStringDecoderPrototypeFunction_endBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSStringDecoder>::ClassParameter castedThis)
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
        return JSValue::encode(jsUndefined());
    }
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->end(vm, lexicalGlobalObject, reinterpret_cast<uint8_t*>(view->vector()), view->byteLength())));
}
static inline JSC::EncodedJSValue jsStringDecoderPrototypeFunction_textBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSStringDecoder>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 2) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }

    auto buffer = callFrame->uncheckedArgument(0);
    JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
    if (UNLIKELY(!view || view->isDetached())) {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Expected Uint8Array"_s);
        return JSValue::encode(jsUndefined());
    }
    int32_t offset = callFrame->uncheckedArgument(1).toInt32(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, JSC::JSValue::encode(JSC::jsUndefined()));
    uint32_t byteLength = view->byteLength();
    if (offset > byteLength)
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsEmptyString(vm)));
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->write(vm, lexicalGlobalObject, reinterpret_cast<uint8_t*>(view->vector()) + offset, byteLength - offset)));
}

static JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_write,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSStringDecoder>::call<jsStringDecoderPrototypeFunction_writeBody>(*globalObject, *callFrame, "write");
}
static JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_end,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSStringDecoder>::call<jsStringDecoderPrototypeFunction_endBody>(*globalObject, *callFrame, "end");
}
static JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_text,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSStringDecoder>::call<jsStringDecoderPrototypeFunction_textBody>(*globalObject, *callFrame, "text");
}

static JSC_DEFINE_CUSTOM_GETTER(jsStringDecoder_lastChar, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSStringDecoder* thisObject = jsCast<JSStringDecoder*>(JSValue::decode(thisValue));
    auto buffer = ArrayBuffer::createFromBytes(thisObject->m_lastChar, 4, nullptr);
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSC::JSUint8Array* uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(buffer), 0, 4);
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(uint8Array));
}
static JSC_DEFINE_CUSTOM_GETTER(jsStringDecoder_lastNeed, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSStringDecoder* thisObject = jsCast<JSStringDecoder*>(JSValue::decode(thisValue));
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNumber(thisObject->m_lastNeed)));
}
static JSC_DEFINE_CUSTOM_GETTER(jsStringDecoder_lastTotal, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSStringDecoder* thisObject = jsCast<JSStringDecoder*>(JSValue::decode(thisValue));
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNumber(thisObject->m_lastTotal)));
}

/* Hash table for prototype */
static const HashTableValue JSStringDecoderPrototypeTableValues[]
    = {
          { "lastChar"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsStringDecoder_lastChar, 0 } },
          { "lastNeed"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsStringDecoder_lastNeed, 0 } },
          { "lastTotal"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsStringDecoder_lastTotal, 0 } },
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
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto encoding = BufferEncodingType::utf8;
    if (callFrame->argumentCount() > 0) {
        auto encoding_ = callFrame->argument(0).toString(lexicalGlobalObject);
        std::optional<BufferEncodingType> opt = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, encoding_);
        if (opt.has_value()) {
            encoding = opt.value();
        }
    }
    JSStringDecoder* stringDecoder = JSStringDecoder::create(
        vm, lexicalGlobalObject, reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)->JSStringDecoderStructure(), encoding);
    return JSC::JSValue::encode(stringDecoder);
}

void JSStringDecoderConstructor::initializeProperties(VM& vm, JSC::JSGlobalObject* globalObject, JSStringDecoderPrototype* prototype)
{
}

const ClassInfo JSStringDecoderConstructor::s_info = { "StringDecoder"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStringDecoderConstructor) };

} // namespace Zig
