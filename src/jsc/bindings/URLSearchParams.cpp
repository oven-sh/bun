/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "URLSearchParams.h"

#include "DOMURL.h"
#include <wtf/URLParser.h>
#include <wtf/SIMDUTF.h>
#include "helpers.h"
#include "JSURLSearchParams.h"

namespace WebCore {

extern "C" WebCore::URLSearchParams* URLSearchParams__fromJS(JSC::EncodedJSValue value)
{
    return WebCoreCast<WebCore::JSURLSearchParams, WebCore::URLSearchParams>(value);
}

// callback accepting a void* and a const EncodedSlice*, returning void
typedef void (*URLSearchParams__toStringCallback)(void* ctx, const EncodedSlice* str);

extern "C" void URLSearchParams__toString(WebCore::URLSearchParams* urlSearchParams, void* ctx, URLSearchParams__toStringCallback callback)
{
    String str = urlSearchParams->toString();
    auto slice = Zig::toEncodedSlice(str);
    callback(ctx, &slice);
}

// String::fromUTF8ReplacingInvalidSequences sizes a Vector<char16_t> by the UTF-8 byte count.
static constexpr size_t maxURLEncodedFormUTF8Length = (std::numeric_limits<unsigned>::max() >> 1) / sizeof(char16_t);
static_assert(WTF::isValidCapacityForVector<char16_t>(maxURLEncodedFormUTF8Length));
static_assert(!WTF::isValidCapacityForVector<char16_t>(maxURLEncodedFormUTF8Length + 1));

static size_t utf8Length(StringView string)
{
    if (string.is8Bit())
        return simdutf::utf8_length_from_latin1(reinterpret_cast<const char*>(string.span8().data()), string.length());
    return simdutf::utf8_length_from_utf16le(string.span16().data(), string.length());
}

ExceptionOr<void> URLSearchParams::checkURLEncodedFormLength(StringView input)
{
    size_t maxLength = std::min(maxURLEncodedFormUTF8Length, Bun__stringSyntheticAllocationLimit);
    // A UTF-16 code unit is at most 3 UTF-8 bytes and a Latin-1 character at most 2.
    if (static_cast<size_t>(input.length()) * 3 <= maxLength) [[likely]]
        return {};
    // The parser decodes each name and value on its own: split the same way it does.
    for (StringView pair : input.split('&')) {
        size_t equalIndex = pair.find('=');
        StringView name = equalIndex == notFound ? pair : pair.left(equalIndex);
        StringView value = equalIndex == notFound ? StringView() : pair.substring(equalIndex + 1);
        size_t length = std::max(utf8Length(name), utf8Length(value));
        if (length > maxLength) [[unlikely]]
            return Exception { RangeError, makeString("A URL-encoded name or value must not be longer than "_s, maxLength, " bytes as UTF-8. Received "_s, length, " bytes."_s) };
    }
    return {};
}

static ExceptionOr<WTF::URLParser::URLEncodedForm> parseURLEncodedForm(const String& init)
{
    StringView query = init.startsWith('?') ? StringView(init).substring(1) : StringView(init);
    auto check = URLSearchParams::checkURLEncodedFormLength(query);
    if (check.hasException())
        return check.releaseException();
    return WTF::URLParser::parseURLEncodedForm(query);
}

URLSearchParams::URLSearchParams(Vector<KeyValuePair<String, String>>&& pairs, DOMURL* associatedURL)
    : m_associatedURL(associatedURL)
    , m_pairs(WTF::move(pairs))
{
}

URLSearchParams::URLSearchParams(const Vector<KeyValuePair<String, String>>& pairs)
    : m_pairs(pairs)
{
}

URLSearchParams::~URLSearchParams() = default;

ExceptionOr<Ref<URLSearchParams>> URLSearchParams::create(const String& init, DOMURL* associatedURL)
{
    auto pairs = parseURLEncodedForm(init);
    if (pairs.hasException())
        return pairs.releaseException();
    return adoptRef(*new URLSearchParams(pairs.releaseReturnValue(), associatedURL));
}

ExceptionOr<Ref<URLSearchParams>> URLSearchParams::create(std::variant<Vector<Vector<String>>, Vector<KeyValuePair<String, String>>, String>&& variant)
{
    auto visitor = WTF::makeVisitor([&](const Vector<Vector<String>>& vector) -> ExceptionOr<Ref<URLSearchParams>> {
        Vector<KeyValuePair<String, String>> pairs;
        for (const auto& pair : vector) {
            if (pair.size() != 2)
                return Exception { TypeError };
            pairs.append({pair[0], pair[1]});
        }
        return adoptRef(*new URLSearchParams(WTF::move(pairs))); }, [&](const Vector<KeyValuePair<String, String>>& pairs) -> ExceptionOr<Ref<URLSearchParams>> { return adoptRef(*new URLSearchParams(pairs)); }, [&](const String& string) -> ExceptionOr<Ref<URLSearchParams>> { return create(string, nullptr); });
    return std::visit(visitor, variant);
}

String URLSearchParams::get(const StringView name) const
{
    for (const auto& pair : m_pairs) {
        if (pair.key == name)
            return pair.value;
    }
    return String();
}

bool URLSearchParams::has(const StringView name, const String& value) const
{
    for (const auto& pair : m_pairs) {
        if (pair.key == name && (value.isNull() || pair.value == value))
            return true;
    }
    return false;
}

void URLSearchParams::sort()
{
    std::stable_sort(m_pairs.begin(), m_pairs.end(), [](const auto& a, const auto& b) {
        return WTF::codePointCompareLessThan(a.key, b.key);
    });
    updateURL();
    needsSorting = false;
}

void URLSearchParams::set(const String& name, const String& value)
{
    for (auto& pair : m_pairs) {
        if (pair.key != name)
            continue;
        if (pair.value != value)
            pair.value = value;
        bool skippedFirstMatch = false;
        m_pairs.removeAllMatching([&](const auto& pair) {
            if (pair.key == name) {
                if (skippedFirstMatch)
                    return true;
                skippedFirstMatch = true;
            }
            return false;
        });
        updateURL();
        needsSorting = true;
        return;
    }
    m_pairs.append({ name, value });
    needsSorting = true;
    updateURL();
}

void URLSearchParams::append(const String& name, const String& value)
{
    m_pairs.append({ name, value });
    updateURL();
    needsSorting = true;
}

Vector<String> URLSearchParams::getAll(const StringView name) const
{
    Vector<String> values;
    values.reserveInitialCapacity(m_pairs.size());
    for (const auto& pair : m_pairs) {
        if (pair.key == name)
            values.unsafeAppendWithoutCapacityCheck(pair.value);
    }
    values.shrinkToFit();
    return values;
}

void URLSearchParams::remove(const StringView name, const String& value)
{
    m_pairs.removeAllMatching([&](const auto& pair) {
        return pair.key == name && (value.isNull() || pair.value == value);
    });
    updateURL();
    needsSorting = true;
}

String URLSearchParams::toString() const
{
    return WTF::URLParser::serialize(m_pairs);
}

void URLSearchParams::updateURL()
{
    if (m_associatedURL)
        m_associatedURL->markSearchParamsDirty();
}

ExceptionOr<void> URLSearchParams::updateFromAssociatedURL()
{
    ASSERT(m_associatedURL);
    m_pairs.clear();
    auto pairs = parseURLEncodedForm(m_associatedURL->search());
    if (pairs.hasException())
        return pairs.releaseException();
    m_pairs = pairs.releaseReturnValue();
    return {};
}

std::optional<KeyValuePair<String, String>> URLSearchParams::Iterator::next()
{
    auto& pairs = m_target->pairs();
    if (m_index >= pairs.size())
        return std::nullopt;

    auto& pair = pairs[m_index++];
    return KeyValuePair<String, String> { pair.key, pair.value };
}

URLSearchParams::Iterator::Iterator(URLSearchParams& params)
    : m_target(params)
{
}

size_t URLSearchParams::memoryCost() const
{
    size_t cost = sizeof(URLSearchParams);
    for (const auto& pair : m_pairs) {
        cost += pair.key.sizeInBytes();
        cost += pair.value.sizeInBytes();
    }
    return cost;
}
}
