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
#include "helpers.h"
#include "JSURLSearchParams.h"
#include "VectorSizeLimit.h"

namespace WebCore {

static ExceptionOr<void> appendPair(Vector<KeyValuePair<String, String>>& pairs, KeyValuePair<String, String>&& pair)
{
    size_t maxSize = Bun::maxVectorSize<KeyValuePair<String, String>>();
    if (!Bun::appendWithinLimit(pairs, WTF::move(pair), maxSize)) [[unlikely]]
        return Exception { RangeError, makeString("URLSearchParams cannot hold more than "_s, maxSize, " entries."_s) };
    return {};
}

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

// Same as WTF::URLParser::parseURLEncodedForm, with the pair count bounded.
static ExceptionOr<Vector<KeyValuePair<String, String>>> parseURLEncodedForm(StringView input)
{
    Vector<KeyValuePair<String, String>> pairs;
    for (StringView bytes : input.split('&')) {
        auto nameAndValue = WTF::URLParser::parseQueryNameAndValue(bytes);
        if (!nameAndValue)
            continue;
        auto result = appendPair(pairs, WTF::move(*nameAndValue));
        if (result.hasException()) [[unlikely]]
            return result.releaseException();
    }
    return pairs;
}

static ExceptionOr<Vector<KeyValuePair<String, String>>> parseSearch(const String& init)
{
    return parseURLEncodedForm(init.startsWith('?') ? StringView(init).substring(1) : StringView(init));
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
    auto pairs = parseSearch(init);
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
            auto result = appendPair(pairs, { pair[0], pair[1] });
            if (result.hasException()) [[unlikely]]
                return result.releaseException();
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

ExceptionOr<void> URLSearchParams::set(const String& name, const String& value)
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
        return {};
    }
    return append(name, value);
}

ExceptionOr<void> URLSearchParams::append(const String& name, const String& value)
{
    auto result = appendPair(m_pairs, { name, value });
    if (result.hasException()) [[unlikely]]
        return result;
    updateURL();
    needsSorting = true;
    return {};
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
    // The URL is already updated. A failed parse leaves the params empty, not stale.
    m_pairs.clear();
    auto pairs = parseSearch(m_associatedURL->search());
    if (pairs.hasException()) [[unlikely]]
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
