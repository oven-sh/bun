#include "V8String.h"
#include "V8HandleScope.h"
#include "wtf/SIMDUTF.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::String)

ASSERT_V8_ENUM_MATCHES(NewStringType, kNormal)
ASSERT_V8_ENUM_MATCHES(NewStringType, kInternalized)

// V8 14 removed String::WriteOptions along with the legacy Write/WriteOneByte/WriteUtf8
// APIs (crbug.com/373485796), so it can no longer be checked against the real headers.
// The replacement V2 write APIs take String::WriteFlags.
ASSERT_V8_ENUM_MATCHES(String::WriteFlags, kNone)
ASSERT_V8_ENUM_MATCHES(String::WriteFlags, kNullTerminate)
ASSERT_V8_ENUM_MATCHES(String::WriteFlags, kReplaceInvalidUtf8)

using JSC::JSString;

namespace v8 {

MaybeLocal<String> String::NewFromUtf8(Isolate* isolate, char const* data, NewStringType type, int signed_length)
{
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
    JSString* jsString = nullptr;
    // ReplacingInvalidSequences matches how v8 behaves here
    auto string = WTF::String::fromUTF8ReplacingInvalidSequences(span);
    switch (type) {
    case NewStringType::kNormal:
        jsString = JSC::jsString(vm, string);
        break;

    case NewStringType::kInternalized:
        // don't create AtomString directly from the characters, as that gives an empty string
        // instead of replacing invalid UTF-8 sequences
        WTF::AtomString atom_string(string);
        jsString = JSC::jsString(vm, atom_string);
        break;
    }
    return MaybeLocal<String>(isolate->currentHandleScope()->createLocal<String>(vm, jsString));
}

MaybeLocal<String> String::NewFromOneByte(Isolate* isolate, const uint8_t* data, NewStringType type, int signed_length)
{
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
    JSString* jsString = nullptr;
    switch (type) {
    case NewStringType::kNormal: {
        WTF::String string(span);
        jsString = JSC::jsString(vm, string);
        break;
    }
    case NewStringType::kInternalized: {
        WTF::AtomString atom_string(span);
        jsString = JSC::jsString(vm, atom_string);
        break;
    }
    }
    return MaybeLocal<String>(isolate->currentHandleScope()->createLocal<String>(vm, jsString));
}

int String::Utf8Length(Isolate* isolate) const
{
    size_t len = Utf8LengthV2(isolate);
    return static_cast<int>(std::min(len, static_cast<size_t>(std::numeric_limits<int>::max())));
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

extern "C" size_t TextEncoder__encodeInto8(const Latin1Character* stringPtr, size_t stringLen, void* ptr, size_t len);
extern "C" size_t TextEncoder__encodeInto16(const char16_t* stringPtr, size_t stringLen, void* ptr, size_t len);

int String::WriteUtf8(Isolate* isolate, char* buffer, int length, int* nchars_ref, int options) const
{
    RELEASE_ASSERT(options == 0);
    auto jsString = localToObjectPointer<JSString>();
    WTF::String string = jsString->getString(isolate->globalObject());

    size_t unsigned_length = length < 0 ? static_cast<size_t>(std::numeric_limits<int>::max()) : static_cast<size_t>(length);

    uint64_t result = string.is8Bit() ? TextEncoder__encodeInto8(string.span8().data(), string.span8().size(), buffer, unsigned_length)
                                      : TextEncoder__encodeInto16(string.span16().data(), string.span16().size(), buffer, unsigned_length);
    uint32_t read = static_cast<uint32_t>(result);
    uint32_t written = static_cast<uint32_t>(result >> 32);

    if (written < length && read == string.length()) {
        buffer[written] = 0;
        written++;
    }
    if (read < string.length() && U16_IS_SURROGATE(string[read]) && written + 3 <= unsigned_length) {
        // encode unpaired surrogate
        char16_t surrogate = string[read];
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

void String::WriteV2(Isolate* isolate, uint32_t offset, uint32_t length, uint16_t* buffer, int flags) const
{
    auto jsString = localToObjectPointer<JSString>();
    RELEASE_ASSERT(static_cast<uint64_t>(offset) + length <= jsString->length());
    if (length > 0) {
        auto str = jsString->view(isolate->globalObject());
        if (str->is8Bit()) {
            WTF::copyElements(std::span<uint16_t>(buffer, length), str->span8().subspan(offset, length));
        } else {
            memcpy(buffer, str->span16().subspan(offset, length).data(), static_cast<size_t>(length) * sizeof(uint16_t));
        }
    }
    if (flags & WriteFlags::kNullTerminate) {
        buffer[length] = 0;
    }
}

void String::WriteOneByteV2(Isolate* isolate, uint32_t offset, uint32_t length, uint8_t* buffer, int flags) const
{
    auto jsString = localToObjectPointer<JSString>();
    RELEASE_ASSERT(static_cast<uint64_t>(offset) + length <= jsString->length());
    if (length > 0) {
        auto str = jsString->view(isolate->globalObject());
        if (str->is8Bit()) {
            memcpy(buffer, str->span8().subspan(offset, length).data(), length);
        } else {
            // like V8, only the least significant byte of each code unit is written
            WTF::copyElements(std::span<Latin1Character>(buffer, length), str->span16().subspan(offset, length));
        }
    }
    if (flags & WriteFlags::kNullTerminate) {
        buffer[length] = 0;
    }
}

size_t String::WriteUtf8V2(Isolate* isolate, char* buffer, size_t capacity, int flags, size_t* processed_characters_return) const
{
    auto jsString = localToObjectPointer<JSString>();
    auto str = jsString->view(isolate->globalObject());

    size_t writableCapacity = capacity;
    if (flags & WriteFlags::kNullTerminate) {
        RELEASE_ASSERT(capacity >= 1);
        writableCapacity--;
    }

    size_t read = 0;
    size_t written = 0;
    if (!str->isEmpty()) {
        // TextEncoder__encodeInto never writes partial UTF-8 sequences, and replaces
        // unpaired surrogates with U+FFFD (same byte length as the WTF-8 encoding V8
        // uses when kReplaceInvalidUtf8 is not set, so the result size matches either
        // way).
        if (str->is8Bit()) {
            // Latin-1 expands at most 2x: 2 * (2^31 - 1) < 2^32, so the packed
            // 32-bit counts cannot wrap.
            const auto span = str->span8();
            uint64_t result = TextEncoder__encodeInto8(span.data(), span.size(), buffer, writableCapacity);
            read = static_cast<uint32_t>(result);
            written = static_cast<uint32_t>(result >> 32);
        } else {
            // UTF-16 expands up to 3x, which can exceed the 32-bit counts
            // TextEncoder__encodeInto packs its result into (3 * (2^31 - 1) >
            // 2^32). Encode in chunks small enough that each chunk's counts
            // fit, accumulating in size_t.
            const auto span = str->span16();
            const size_t total = span.size();
            constexpr size_t maxChunk = static_cast<size_t>(1) << 30; // <= 3 GiB UTF-8 per chunk
            while (read < total) {
                size_t chunkLength = std::min(maxChunk, total - read);
                // Never split a surrogate pair across chunks: the encoder
                // would see two unpaired halves and write U+FFFD twice.
                if (read + chunkLength < total && U16_IS_LEAD(span[read + chunkLength - 1])) {
                    chunkLength--;
                }
                uint64_t result = TextEncoder__encodeInto16(span.data() + read, chunkLength, buffer + written, writableCapacity - written);
                const uint32_t chunkRead = static_cast<uint32_t>(result);
                const uint32_t chunkWritten = static_cast<uint32_t>(result >> 32);
                read += chunkRead;
                written += chunkWritten;
                if (chunkRead < chunkLength) {
                    // Ran out of output capacity.
                    break;
                }
            }
        }
    }

    if (processed_characters_return) {
        *processed_characters_return = read;
    }
    if (flags & WriteFlags::kNullTerminate) {
        buffer[written] = '\0';
        written++;
    }
    return written;
}

size_t String::Utf8LengthV2(Isolate* isolate) const
{
    auto jsString = localToObjectPointer<JSString>();
    if (jsString->length() == 0) {
        return 0;
    }

    auto str = jsString->view(isolate->globalObject());
    if (str->is8Bit()) {
        const auto span = str->span8();
        return simdutf::utf8_length_from_latin1(reinterpret_cast<const char*>(span.data()), span.size());
    }

    const auto span = str->span16();
    // simdutf's answer is implementation-defined for invalid UTF-16, so only use it
    // for valid input. Otherwise count exactly: V8 charges an unpaired surrogate 3
    // bytes, the size both writers produce for it (U+FFFD or its WTF-8 encoding).
    if (simdutf::validate_utf16(span.data(), span.size())) {
        return simdutf::utf8_length_from_utf16(span.data(), span.size());
    }
    size_t len = 0;
    for (size_t i = 0; i < span.size(); i++) {
        const char16_t c = span[i];
        if (c <= 0x7f) {
            len += 1;
        } else if (c <= 0x7ff) {
            len += 2;
        } else if (U16_IS_LEAD(c) && i + 1 < span.size() && U16_IS_TRAIL(span[i + 1])) {
            len += 4;
            i++;
        } else {
            len += 3;
        }
    }
    return len;
}

int String::Length() const
{
    auto jsString = localToObjectPointer<JSString>();
    return static_cast<int>(jsString->length());
}

} // namespace v8
