#include "V8String.h"

#include "V8HandleScope.h"
#include "wtf/SIMDUTF.h"

using JSC::JSString;

namespace v8 {

MaybeLocal<String> String::NewFromUtf8(Isolate* isolate, char const* data, NewStringType type, int signed_length)
{
    // TODO(@190n) maybe use JSC::AtomString instead of ignoring type
    (void)type;
    size_t length = 0;
    if (signed_length < 0) {
        length = strlen(data);
    } else {
        length = static_cast<int>(signed_length);
    }

    if (length > JSString::MaxLength) {
        // empty
        return MaybeLocal<String>();
    }

    auto& vm = isolate->vm();
    std::span<const unsigned char> span(reinterpret_cast<const unsigned char*>(data), length);
    // ReplacingInvalidSequences matches how v8 behaves here
    auto string = WTF::String::fromUTF8ReplacingInvalidSequences(span);
    JSString* jsString = JSC::jsString(vm, string);
    return MaybeLocal<String>(isolate->currentHandleScope()->createLocal<String>(vm, jsString));
}

MaybeLocal<String> String::NewFromOneByte(Isolate* isolate, const uint8_t* data, NewStringType type, int signed_length)
{
    (void)type;
    size_t length = 0;
    if (signed_length < 0) {
        length = strlen(reinterpret_cast<const char*>(data));
    } else {
        length = static_cast<int>(signed_length);
    }

    if (length > JSString::MaxLength) {
        // empty
        return MaybeLocal<String>();
    }

    auto& vm = isolate->vm();
    std::span<const unsigned char> span(data, length);
    WTF::String string(span);
    JSString* jsString = JSC::jsString(vm, string);
    return MaybeLocal<String>(isolate->currentHandleScope()->createLocal<String>(vm, jsString));
}

int String::Utf8Length(Isolate* isolate) const
{
    auto jsString = localToObjectPointer<JSString>();
    if (jsString->length() == 0) {
        return 0;
    }

    auto str = jsString->view(isolate->globalObject());
    if (str->is8Bit()) {
        const auto span = str->span8();
        size_t len = simdutf::utf8_length_from_latin1(reinterpret_cast<const char*>(span.data()), span.size());
        return static_cast<int>(len);
    } else {
        const auto span = str->span16();
        size_t len = simdutf::utf8_length_from_utf16(span.data(), span.size());
        return static_cast<int>(len);
    }
}

bool String::IsOneByte() const
{
    auto jsString = localToObjectPointer<JSString>();
    if (jsString->length() == 0) {
        return true;
    }
    auto impl = jsString->tryGetValue();
    return impl->is8Bit();
}

bool String::ContainsOnlyOneByte() const
{
    auto jsString = localToObjectPointer<JSString>();
    if (jsString->length() == 0) {
        return true;
    }
    auto impl = jsString->tryGetValue();
    return impl->containsOnlyLatin1();
}

bool String::IsExternal() const
{
    auto jsString = localToObjectPointer<JSString>();
    if (jsString->length() == 0) {
        return false;
    }
    auto impl = jsString->tryGetValue();
    return !impl->isNull() && impl->impl()->isExternal();
}

bool String::IsExternalTwoByte() const
{
    auto jsString = localToObjectPointer<JSString>();
    if (jsString->length() == 0) {
        return false;
    }
    auto impl = jsString->tryGetValue();
    return !impl->isNull() && impl->impl()->isExternal() && !impl->is8Bit();
}

bool String::IsExternalOneByte() const
{
    auto jsString = localToObjectPointer<JSString>();
    if (jsString->length() == 0) {
        return false;
    }
    auto impl = jsString->tryGetValue();
    return !impl->isNull() && impl->impl()->isExternal() && impl->is8Bit();
}

extern "C" size_t TextEncoder__encodeInto8(const LChar* stringPtr, size_t stringLen, void* ptr, size_t len);
extern "C" size_t TextEncoder__encodeInto16(const UChar* stringPtr, size_t stringLen, void* ptr, size_t len);

int String::WriteUtf8(Isolate* isolate, char* buffer, int length, int* nchars_ref, int options) const
{
    RELEASE_ASSERT(options == 0);
    auto jsString = localToObjectPointer<JSString>();
    WTF::String string = jsString->getString(isolate->globalObject());

    size_t unsigned_length = length < 0 ? SIZE_MAX : length;

    uint64_t result = string.is8Bit() ? TextEncoder__encodeInto8(string.span8().data(), string.span8().size(), buffer, unsigned_length)
                                      : TextEncoder__encodeInto16(string.span16().data(), string.span16().size(), buffer, unsigned_length);
    uint32_t read = static_cast<uint32_t>(result);
    uint32_t written = static_cast<uint32_t>(result >> 32);

    if (written < length && read == string.length()) {
        buffer[written] = 0;
        written++;
    }
    if (read < string.length() && U16_IS_SURROGATE(string[read]) && written + 3 <= length) {
        // encode unpaired surrogate
        UChar surrogate = string[read];
        buffer[written + 0] = 0xe0 | (surrogate >> 12);
        buffer[written + 1] = 0x80 | ((surrogate >> 6) & 0x3f);
        buffer[written + 2] = 0x80 | (surrogate & 0x3f);
        written += 3;
        read += 1;
    }
    if (nchars_ref) {
        *nchars_ref = read;
    }

    return written;
}

int String::Length() const
{
    auto jsString = localToObjectPointer<JSString>();
    return static_cast<int>(jsString->length());
}

}
