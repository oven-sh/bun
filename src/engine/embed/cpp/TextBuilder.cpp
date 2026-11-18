#include "engine/text/StringBuilder.h"

extern "C" {
void engine_text_builder_overflow(WTF::Detail::StringBuilderState&);
void engine_text_builder_reserve(WTF::Detail::StringBuilderState&, size_t additionalLength);
void engine_text_builder_grow(WTF::Detail::StringBuilderState&, size_t additionalLength);
void engine_text_builder_widen(WTF::Detail::StringBuilderState&, size_t additionalLength);
void engine_text_builder_push_json_quoted(WTF::Detail::StringBuilderState&, WTF::StringView);
WTF::StringImpl* engine_text_builder_take(WTF::Detail::StringBuilderState&);
}

namespace WTF {

static_assert(sizeof(Detail::StringBuilderState) == 56);

StringBuilder::StringBuilder(StringBuilder&& other)
    : m_state(other.m_state)
    , m_string(WTF::move(other.m_string))
    , m_overflowPolicy(other.m_overflowPolicy)
{
    m_state.scratch = m_scratch;
    if (m_state.characters == other.m_scratch) {
        m_state.characters = m_scratch;
        memcpy(m_scratch, other.m_scratch, sizeof(m_scratch));
    }
    other.m_state.isAllocated = false;
    other.clear();
}

bool StringBuilder::checkForOverflow()
{
    if (!hasOverflowed()) [[likely]]
        return true;
    if (m_overflowPolicy == OverflowPolicy::CrashOnOverflow)
        Support__outOfMemory();
    return false;
}

void StringBuilder::didOverflow()
{
    engine_text_builder_overflow(m_state);
    checkForOverflow();
}

bool StringBuilder::grow(size_t count)
{
    if (isSharingString() && is8Bit() && m_state.length + count <= sizeof(m_scratch)) {
        Detail::copyBytes(m_scratch, m_state.characters, m_state.length);
        m_state.characters = m_scratch;
        m_state.capacity8 = sizeof(m_scratch);
        return true;
    }
    engine_text_builder_grow(m_state, count);
    return checkForOverflow();
}

bool StringBuilder::widen(size_t count)
{
    engine_text_builder_widen(m_state, count);
    return checkForOverflow();
}

void StringBuilder::share(String&& string)
{
    ASSERT(!m_state.isAllocated && !hasOverflowed());
    m_string = WTF::move(string);
    m_state.characters = const_cast<void*>(m_string.impl()->rawCharacters());
    m_state.is8Bit = m_string.is8Bit();
    m_state.length = m_string.length();
    m_state.capacity8 = is8Bit() ? m_state.length : 0;
    m_state.capacity16 = is8Bit() ? 0 : m_state.length;
}

void StringBuilder::appendSlowly(char16_t character)
{
    if (is8Bit() && isLatin1(character)) {
        if (grow(1))
            *extend<Latin1Character>(1) = character;
    } else if (hasRoom<char16_t>(1) || widen(1))
        *extend<char16_t>(1) = character;
}

void StringBuilder::append(std::span<const Latin1Character> characters)
{
    size_t count = characters.size();
    if (hasRoom<Latin1Character>(count) || (is8Bit() && grow(count))) [[likely]]
        Detail::copyBytes(extend<Latin1Character>(count), characters.data(), count);
    else if (hasRoom<char16_t>(count) || widen(count))
        Detail::widen(extend<char16_t>(count), characters.data(), count);
}

void StringBuilder::append(std::span<const char16_t> characters)
{
    size_t count = characters.size();
    if (count == 1)
        append(characters[0]);
    else if (count && (hasRoom<char16_t>(count) || widen(count)))
        Detail::copyBytes(extend<char16_t>(count), characters.data(), characters.size_bytes());
}

void StringBuilder::append(StringView string)
{
    string.visitCharacters([&](auto characters) { append(characters); });
}

void StringBuilder::append(const String& string)
{
    if (isEmpty() && !m_state.isAllocated && !string.isEmpty())
        share(String { string });
    else
        append(StringView { string });
}

void StringBuilder::appendQuotedJSONString(const String& string)
{
    engine_text_builder_push_json_quoted(m_state, string);
    checkForOverflow();
}

void StringBuilder::reserveCapacity(unsigned capacity)
{
    if (capacity <= m_state.length)
        return;
    engine_text_builder_reserve(m_state, capacity - m_state.length);
    checkForOverflow();
}

void StringBuilder::shrink(unsigned length)
{
    ASSERT(length <= m_state.length || hasOverflowed());
    m_state.length = std::min<size_t>(m_state.length, length);
    if (isSharingString())
        (is8Bit() ? m_state.capacity8 : m_state.capacity16) = m_state.length;
}

void StringBuilder::shrinkToFit()
{
    if (hasOverflowed() || (isSharingString() && m_state.length == m_string.length()))
        return;
    if (auto* string = engine_text_builder_take(m_state)) [[likely]]
        share(adoptRef(string));
    else
        didOverflow();
}

String StringBuilder::toString() &&
{
    toString();
    String string = WTF::move(m_string);
    clear();
    return string;
}

}
