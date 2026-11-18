#include "engine/text/MakeString.h"

#include <simdutf.h>

extern "C" {
WTF::StringImpl* engine_text_from_utf8(const char8_t*, size_t length);
WTF::StringImpl* engine_text_try_from_utf8_lossy(const char8_t*, size_t length);
bool engine_text_decode_utf8(const char8_t*, size_t length, char16_t* destination, size_t capacity);
size_t engine_text_utf8_length(WTF::StringView);
WTF::StringImpl* engine_text_to_ascii_lower_case(WTF::StringView);
WTF::StringImpl* engine_text_to_ascii_upper_case(WTF::StringView);
WTF::StringImpl* engine_text_to_upper_case(WTF::StringView);
WTF::StringImpl* engine_text_to_well_formed(WTF::StringView);
WTF::StringImpl* engine_text_replace_unit(WTF::StringView, char16_t target, char16_t replacement);
WTF::StringImpl* engine_text_replace_all(WTF::StringView, WTF::StringView pattern, WTF::StringView replacement);
}

namespace WTF {

template<typename T> static ALWAYS_INLINE Ref<StringImpl> copyOf(std::span<const T> source)
{
    std::span<T> characters;
    auto string = StringImpl::createUninitialized(source.size(), characters);
    Detail::copyBytes(characters.data(), source.data(), source.size_bytes());
    return string;
}

Ref<StringImpl> StringImpl::create(std::span<const Latin1Character> characters) { return copyOf(characters); }
Ref<StringImpl> StringImpl::create(std::span<const char16_t> characters) { return copyOf(characters); }

size_t StringImpl::tryConvertUTF16ToUTF8(std::span<const char16_t> source, std::span<char8_t> destination)
{
    RELEASE_ASSERT(destination.size() / 3 >= source.size());
    auto result = simdutf::convert_utf16le_to_utf8_with_errors(source, destination);
    return result.error == simdutf::error_code::SUCCESS ? result.count : notFound;
}

bool StringImpl::tryConvertUTF8ToUTF16(std::span<const char8_t> source, std::span<char16_t> destination)
{
    return engine_text_decode_utf8(source.data(), source.size(), destination.data(), destination.size());
}

bool equal(const StringImpl& a, const StringImpl& b)
{
    if (a.hasHash() && b.hasHash() && a.existingHash() != b.existingHash())
        return false;
    return equal(StringView { a }, StringView { b });
}

RefPtr<CStringBuffer> CStringBuffer::tryCreateUninitialized(size_t length)
{
    void* memory = FastMalloc::tryMalloc(sizeof(CStringBuffer) + length + 1);
    return memory ? adoptRef(new (NotNull, memory) CStringBuffer(length)) : nullptr;
}

Ref<CStringBuffer> CStringBuffer::create(std::span<const char> bytes)
{
    auto buffer = tryCreateUninitialized(bytes.size());
    if (!buffer) [[unlikely]]
        Support__outOfMemory();
    Detail::copyBytes(buffer->data(), bytes.data(), bytes.size());
    return buffer.releaseNonNull();
}

std::expected<UTF8CString, UTF8ConversionError> StringView::tryGetUTF8(ConversionMode) const
{
    // C interfaces count bytes with an `int`.
    constexpr size_t limit = std::numeric_limits<int32_t>::max();
    if (m_is8Bit && m_length > limit / 2) [[unlikely]]
        return makeUnexpected(UTF8ConversionError::OutOfMemory);

    // What is short is converted once, where there is room for the worst case, and then copied.
    char8_t buffer[768];
    std::span<const char8_t> converted;
    if (m_is8Bit && containsOnlyASCII()) [[likely]]
        converted = byteCast<char8_t>(span8());
    else if (m_length <= std::size(buffer) / 3)
        converted = { buffer, engine_text_write_utf8(*this, buffer, std::size(buffer)) };

    size_t length = converted.data() || isNull() ? converted.size() : engine_text_utf8_length(*this);
    if (length > limit) [[unlikely]]
        return makeUnexpected(UTF8ConversionError::OutOfMemory);
    std::span<char8_t> bytes;
    auto result = UTF8CString::tryCreateUninitialized(length, bytes);
    if (result.isNull()) [[unlikely]]
        return makeUnexpected(UTF8ConversionError::OutOfMemory);
    if (converted.size() == length) [[likely]]
        Detail::copyBytes(bytes.data(), converted.data(), length);
    else
        RELEASE_ASSERT(engine_text_write_utf8(*this, bytes.data(), length) == length);
    return result;
}

UTF8CString StringView::utf8(ConversionMode mode) const
{
    auto result = tryGetUTF8(mode);
    if (!result) [[unlikely]]
        Support__outOfMemory();
    return WTF::move(*result);
}

String StringView::convertToASCIILowercase() const
{
    if (auto* converted = engine_text_to_ascii_lower_case(*this))
        return adoptRef(converted);
    return toString();
}

AtomString StringView::convertToASCIILowercaseAtom() const
{
    if (auto* converted = engine_text_to_ascii_lower_case(*this))
        return AtomStringImpl::add(adoptRef(converted));
    return toAtomString();
}

String String::fromUTF8(std::span<const char8_t> bytes)
{
    return bytes.data() ? adoptRef(engine_text_from_utf8(bytes.data(), bytes.size())) : nullptr;
}

String String::tryFromUTF8ReplacingInvalidSequences(std::span<const char8_t> bytes)
{
    return bytes.data() ? adoptRef(engine_text_try_from_utf8_lossy(bytes.data(), bytes.size())) : nullptr;
}

String String::fromUTF8ReplacingInvalidSequences(std::span<const char8_t> bytes)
{
    auto string = tryFromUTF8ReplacingInvalidSequences(bytes);
    if (string.isNull() && bytes.data()) [[unlikely]]
        Support__outOfMemory();
    return string;
}

String String::number(int number) { return makeString(number); }
String String::number(unsigned number) { return makeString(number); }
String String::number(long number) { return makeString(number); }
String String::number(unsigned long number) { return makeString(number); }
String String::number(long long number) { return makeString(number); }
String String::number(unsigned long long number) { return makeString(number); }
String String::number(double number) { return makeString(number); }

Latin1CString String::latin1() const
{
    std::span<Latin1Character> characters;
    auto result = Latin1CString::tryCreateUninitialized(length(), characters);
    if (result.isNull()) [[unlikely]]
        Support__outOfMemory();
    if (is8Bit())
        StringImpl::copyCharacters(characters, span8());
    else
        std::ranges::transform(span16(), characters.begin(), [](char16_t character) { return Latin1Character { isLatin1(character) ? character : u'?' }; });
    return result;
}

String String::substringSharingImpl(unsigned start, unsigned length) const
{
    start = std::min(start, this->length());
    length = std::min(length, this->length() - start);
    if (length == this->length())
        return *this;
    return StringImpl::createSubstringSharingImpl(*m_impl, start, length);
}

static String unlessUnchanged(const String& original, StringImpl* changed)
{
    return changed ? String { adoptRef(changed) } : original;
}

String String::convertToASCIILowercase() const { return unlessUnchanged(*this, engine_text_to_ascii_lower_case(*this)); }
String String::convertToASCIIUppercase() const { return unlessUnchanged(*this, engine_text_to_ascii_upper_case(*this)); }
String String::convertToUppercaseWithoutLocale() const { return unlessUnchanged(*this, engine_text_to_upper_case(*this)); }

void String::convertTo16Bit()
{
    if (isNull() || !is8Bit())
        return;
    std::span<char16_t> characters;
    auto wide = createUninitialized(length(), characters);
    StringImpl::copyCharacters(characters, span8());
    *this = WTF::move(wide);
}

String String::isolatedCopy() const&
{
    return m_impl ? String { m_impl->isolatedCopy() } : String {};
}

String String::isolatedCopy() &&
{
    if (m_impl && m_impl->hasOneRef() && !m_impl->isAtom() && !m_impl->isSubString())
        return WTF::move(*this);
    return std::as_const(*this).isolatedCopy();
}

String makeStringByReplacingAll(const String& string, char16_t target, char16_t replacement)
{
    return unlessUnchanged(string, engine_text_replace_unit(string, target, replacement));
}

String makeStringByReplacingAll(const String& string, StringView target, StringView replacement)
{
    return unlessUnchanged(string, engine_text_replace_all(string, target, replacement));
}

String replaceUnpairedSurrogatesWithReplacementCharacter(String&& string)
{
    if (auto* changed = string.is8Bit() ? nullptr : engine_text_to_well_formed(string)) [[unlikely]]
        return adoptRef(changed);
    return WTF::move(string);
}

}
