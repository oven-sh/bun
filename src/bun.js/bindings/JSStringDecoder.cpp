#include "JSStringDecoder.h"
#include "JSBuffer.h"
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "ZigGlobalObject.h"
#include "JSDOMOperation.h"
#include "JSDOMAttribute.h"
#include "headers.h"
#include "JSDOMConvertEnumeration.h"
#include <JavaScriptCore/JSArrayBufferView.h>
#include "BunClientData.h"
#include "wtf/text/StringImpl.h"
#include "wtf/unicode/CharacterNames.h"

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_write);
static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_end);
static JSC_DECLARE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_text);

static JSC_DECLARE_CUSTOM_GETTER(jsStringDecoder_lastChar);
static JSC_DECLARE_CUSTOM_GETTER(jsStringDecoder_lastNeed);
static JSC_DECLARE_CUSTOM_GETTER(jsStringDecoder_lastTotal);

static WTF::String replacementString()
{

    return WTF::String(std::span<const UChar> { u"\uFFFD", 1 });
}

static inline JSC::EncodedJSValue jsStringDecoderCast(JSGlobalObject* globalObject, JSValue stringDecoderValue)
{
    if (LIKELY(jsDynamicCast<JSStringDecoder*>(stringDecoderValue)))
        return JSValue::encode(stringDecoderValue);

    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (stringDecoderValue.isEmpty() || stringDecoderValue.isUndefinedOrNull()) {
        return JSC::JSValue::encode(jsUndefined());
    }

    if (!stringDecoderValue.isObject()) {
        return throwThisTypeError(*globalObject, throwScope, JSStringDecoder::info()->className, "write");
    }

    JSC::JSObject* thisObject = JSC::asObject(stringDecoderValue);
    JSStringDecoder* castedThis = nullptr;
    auto clientData = WebCore::clientData(vm);
    if (JSValue existingDecoderValue = thisObject->getIfPropertyExists(globalObject, clientData->builtinNames().decodePrivateName())) {
        castedThis = jsDynamicCast<JSStringDecoder*>(existingDecoderValue);
    }

    if (!castedThis) {
        BufferEncodingType encoding = BufferEncodingType::utf8;
        if (JSValue encodingValue = thisObject->getIfPropertyExists(globalObject, clientData->builtinNames().encodingPrivateName())) {
            if (encodingValue.isString()) {
                std::optional<BufferEncodingType> opt = parseEnumeration<BufferEncodingType>(*globalObject, encodingValue);
                if (opt.has_value()) {
                    encoding = opt.value();
                }
            }
        }
        castedThis = JSStringDecoder::create(globalObject->vm(), globalObject, reinterpret_cast<Zig::GlobalObject*>(globalObject)->JSStringDecoderStructure(), encoding);
        thisObject->putDirect(vm, clientData->builtinNames().decodePrivateName(), castedThis, 0);
    }

    return JSValue::encode(castedThis);
}

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
            RELEASE_AND_RETURN(throwScope, JSC::jsString(vm, replacementString()));
        }
        if (m_lastNeed > 1 && length > 1) {
            if ((bufPtr[1] & 0xC0) != 0x80) {
                m_lastNeed = 1;
                RELEASE_AND_RETURN(throwScope, JSC::jsString(vm, replacementString()));
            }
            if (m_lastNeed > 2 && length > 2) {
                if ((bufPtr[2] & 0xC0) != 0x80) {
                    m_lastNeed = 2;
                    RELEASE_AND_RETURN(throwScope, JSC::jsString(vm, replacementString()));
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
            RELEASE_AND_RETURN(throwScope, m_lastNeed ? JSC::jsString(vm, replacementString()) : JSC::jsEmptyString(vm));
        }
        JSString* firstHalf = write(vm, globalObject, bufPtr, length).toString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());
        RELEASE_AND_RETURN(throwScope, m_lastNeed ? JSC::jsString(globalObject, firstHalf, replacementString()) : firstHalf);
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
        return JSValue::encode(jsUndefined());
    }
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(castedThis->end(vm, lexicalGlobalObject, reinterpret_cast<uint8_t*>(view->vector()), view->byteLength())));
}
static inline JSC::EncodedJSValue jsStringDecoderPrototypeFunction_textBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, JSStringDecoder* castedThis)
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

JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_write,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSValue stringDecoderValue = JSValue::decode(jsStringDecoderCast(globalObject, callFrame->thisValue()));
    if (stringDecoderValue.isEmpty() || !stringDecoderValue.isCell()) {
        return JSValue::encode(stringDecoderValue);
    }
    JSStringDecoder* castedThis = jsCast<JSStringDecoder*>(stringDecoderValue);
    return jsStringDecoderPrototypeFunction_writeBody(globalObject, callFrame, castedThis);
}
JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_end,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSValue stringDecoderValue = JSValue::decode(jsStringDecoderCast(globalObject, callFrame->thisValue()));
    if (stringDecoderValue.isEmpty() || !stringDecoderValue.isCell()) {
        return JSValue::encode(stringDecoderValue);
    }
    JSStringDecoder* castedThis = jsCast<JSStringDecoder*>(stringDecoderValue);
    return jsStringDecoderPrototypeFunction_endBody(globalObject, callFrame, castedThis);
}
JSC_DEFINE_HOST_FUNCTION(jsStringDecoderPrototypeFunction_text,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSValue stringDecoderValue = JSValue::decode(jsStringDecoderCast(globalObject, callFrame->thisValue()));
    if (stringDecoderValue.isEmpty() || !stringDecoderValue.isCell()) {
        return JSValue::encode(stringDecoderValue);
    }
    JSStringDecoder* castedThis = jsCast<JSStringDecoder*>(stringDecoderValue);

    return jsStringDecoderPrototypeFunction_textBody(globalObject, callFrame, castedThis);
}

static JSC_DEFINE_CUSTOM_GETTER(jsStringDecoder_lastChar, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSValue stringDecoderValue = JSValue::decode(jsStringDecoderCast(lexicalGlobalObject, JSValue::decode(thisValue)));
    if (stringDecoderValue.isEmpty() || !stringDecoderValue.isCell()) {
        return JSValue::encode(stringDecoderValue);
    }
    JSStringDecoder* thisObject = jsCast<JSStringDecoder*>(stringDecoderValue);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto buffer = ArrayBuffer::create({ thisObject->m_lastChar, 4 });
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSC::JSUint8Array* uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(buffer), 0, 4);
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(uint8Array));
}
static JSC_DEFINE_CUSTOM_GETTER(jsStringDecoder_lastNeed, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSValue stringDecoderValue = JSValue::decode(jsStringDecoderCast(lexicalGlobalObject, JSValue::decode(thisValue)));
    if (stringDecoderValue.isEmpty() || !stringDecoderValue.isCell()) {
        return JSValue::encode(stringDecoderValue);
    }
    JSStringDecoder* thisObject = jsCast<JSStringDecoder*>(stringDecoderValue);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(JSC::jsNumber(thisObject->m_lastNeed)));
}
static JSC_DEFINE_CUSTOM_GETTER(jsStringDecoder_lastTotal, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    JSValue stringDecoderValue = JSValue::decode(jsStringDecoderCast(lexicalGlobalObject, JSValue::decode(thisValue)));
    if (stringDecoderValue.isEmpty() || !stringDecoderValue.isCell()) {
        return JSValue::encode(stringDecoderValue);
    }
    JSStringDecoder* thisObject = jsCast<JSStringDecoder*>(stringDecoderValue);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
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

        auto encoding_ = callFrame->argument(0);
        if (encoding_.isString()) {
            std::optional<BufferEncodingType> opt = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, encoding_);
            if (opt.has_value()) {
                encoding = opt.value();
            }
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
