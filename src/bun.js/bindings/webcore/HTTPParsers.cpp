/*
 * Copyright (C) 2006 Alexey Proskuryakov (ap@webkit.org)
 * Copyright (C) 2006-2017 Apple Inc. All rights reserved.
 * Copyright (C) 2009 Torch Mobile Inc. http://www.torchmobile.com/
 * Copyright (C) 2009 Google Inc. All rights reserved.
 * Copyright (C) 2011 Apple Inc. All Rights Reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
#include "config.h"
#include "HTTPParsers.h"

#include "CommonAtomStrings.h"
#include "HTTPHeaderField.h"
#include "HTTPHeaderNames.h"
#include <wtf/CheckedArithmetic.h>
#include <wtf/DateMath.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/StringToIntegerConversion.h>
#include <wtf/unicode/CharacterNames.h>

namespace WebCore {

// True if characters which satisfy the predicate are present, incrementing
// "pos" to the next character which does not satisfy the predicate.
// Note: might return pos == str.length().
static inline bool skipWhile(const String& str, unsigned& pos, const Function<bool(const char16_t)>& predicate)
{
    const unsigned start = pos;
    const unsigned len = str.length();
    while (pos < len && predicate(str[pos]))
        ++pos;
    return pos != start;
}

// true if there is more to parse, after incrementing pos past whitespace.
// Note: Might return pos == str.length()
static inline bool skipWhiteSpace(const String& str, unsigned& pos)
{
    skipWhile(str, pos, isTabOrSpace<char16_t>);
    return pos < str.length();
}

// Returns true if the function can match the whole token (case insensitive)
// incrementing pos on match, otherwise leaving pos unchanged.
// Note: Might return pos == str.length()
static inline bool skipToken(const String& str, unsigned& pos, const char* token)
{
    unsigned len = str.length();
    unsigned current = pos;

    while (current < len && *token) {
        if (toASCIILower(str[current]) != *token++)
            return false;
        ++current;
    }

    if (*token)
        return false;

    pos = current;
    return true;
}

// True if the expected equals sign is seen and there is more to follow.
static inline bool skipEquals(const String& str, unsigned& pos)
{
    return skipWhiteSpace(str, pos) && str[pos++] == '=' && skipWhiteSpace(str, pos);
}

// True if a value present, incrementing pos to next space or semicolon, if any.
// Note: might return pos == str.length().
static inline bool skipValue(const String& str, unsigned& pos)
{
    unsigned start = pos;
    unsigned len = str.length();
    while (pos < len) {
        if (isTabOrSpace(str[pos]) || str[pos] == ';')
            break;
        ++pos;
    }
    return pos != start;
}

// See RFC 7230, Section 3.1.2.
bool isValidReasonPhrase(const String& value)
{
    for (unsigned i = 0; i < value.length(); ++i) {
        char16_t c = value[i];
        if (c == 0x7F || !isLatin1(c) || (c < 0x20 && c != '\t'))
            return false;
    }
    return true;
}

// See https://fetch.spec.whatwg.org/#concept-header
bool isValidHTTPHeaderValue(const StringView& value)
{
    auto length = value.length();
    if (length == 0) return true;
    char16_t c = value[0];
    if (isTabOrSpace(c))
        return false;
    c = value[length - 1];
    if (isTabOrSpace(c))
        return false;
    if (value.is8Bit()) {
        const LChar* begin = value.span8().data();
        const LChar* end = begin + value.length();
        for (const LChar* p = begin; p != end; ++p) {
            if (*p <= 13) [[unlikely]] {
                LChar c = *p;
                if (c == 0x00 || c == 0x0A || c == 0x0D)
                    return false;
            }
        }
    } else {
        for (unsigned i = 0; i < value.length(); ++i) {
            c = value[i];
            if (c == 0x00 || c == 0x0A || c == 0x0D || c > 0x7F)
                return false;
        }
    }

    return true;
}

// See RFC 7231, Section 5.3.2.
bool isValidAcceptHeaderValue(const StringView& value)
{
    for (unsigned i = 0; i < value.length(); ++i) {
        char16_t c = value[i];

        // First check for alphanumeric for performance reasons then allowlist four delimiter characters.
        if (isASCIIAlphanumeric(c) || c == ',' || c == '/' || c == ';' || c == '=')
            continue;

        ASSERT(isLatin1(c));
        if (c == 0x7F || (c < 0x20 && c != '\t'))
            return false;

        if (RFC7230::isDelimiter(c))
            return false;
    }

    return true;
}

static bool containsCORSUnsafeRequestHeaderBytes(const String& value)
{
    for (unsigned i = 0; i < value.length(); ++i) {
        char16_t c = value[i];
        // https://fetch.spec.whatwg.org/#cors-unsafe-request-header-byte
        if ((c < 0x20 && c != '\t') || (c == '"' || c == '(' || c == ')' || c == ':' || c == '<' || c == '>' || c == '?' || c == '@' || c == '[' || c == '\\' || c == ']' || c == 0x7B || c == '{' || c == '}' || c == 0x7F))
            return true;
    }

    return false;
}

// See RFC 7231, Section 5.3.5 and 3.1.3.2.
// https://fetch.spec.whatwg.org/#cors-safelisted-request-header
bool isValidLanguageHeaderValue(const StringView& value)
{
    for (unsigned i = 0; i < value.length(); ++i) {
        char16_t c = value[i];
        if (isASCIIAlphanumeric(c) || c == ' ' || c == '*' || c == ',' || c == '-' || c == '.' || c == ';' || c == '=')
            continue;
        return false;
    }
    return true;
}

// See RFC 7230, Section 3.2.6.
bool isValidHTTPToken(const StringView& value)
{
    if (value.isEmpty())
        return false;

    if (value.is8Bit()) {
        const LChar* characters = value.span8().data();
        const LChar* end = characters + value.length();
        while (characters < end) {
            if (!RFC7230::isTokenCharacter(*characters++))
                return false;
        }
        return true;
    }

    for (char16_t c : value.codeUnits()) {
        if (!RFC7230::isTokenCharacter(c))
            return false;
    }
    return true;
}

#if USE(GLIB)
// True if the character at the given position satisifies a predicate, incrementing "pos" by one.
// Note: Might return pos == str.length()
static inline bool skipCharacter(const String& value, unsigned& pos, Function<bool(const char16_t)>&& predicate)
{
    if (pos < value.length() && predicate(value[pos])) {
        ++pos;
        return true;
    }
    return false;
}

// True if the "expected" character is at the given position, incrementing "pos" by one.
// Note: Might return pos == str.length()
static inline bool skipCharacter(const String& value, unsigned& pos, const char16_t expected)
{
    return skipCharacter(value, pos, [expected](const char16_t c) {
        return c == expected;
    });
}

// True if a quoted pair is present, incrementing "pos" to the position after the quoted pair.
// Note: Might return pos == str.length()
// See RFC 7230, Section 3.2.6.
static constexpr auto QuotedPairStartCharacter = '\\';
static bool skipQuotedPair(const String& value, unsigned& pos)
{
    // quoted-pair = "\" ( HTAB / SP / VCHAR / obs-text )
    return skipCharacter(value, pos, QuotedPairStartCharacter)
        && skipCharacter(value, pos, RFC7230::isQuotedPairSecondOctet);
}

// True if a comment is present, incrementing "pos" to the position after the comment.
// Note: Might return pos == str.length()
// See RFC 7230, Section 3.2.6.
static constexpr auto CommentStartCharacter = '(';
static constexpr auto CommentEndCharacter = ')';
static bool skipComment(const String& value, unsigned& pos)
{
    // comment = "(" *( ctext / quoted-pair / comment ) ")"
    // ctext   = HTAB / SP / %x21-27 / %x2A-5B / %x5D-7E / obs-text
    if (!skipCharacter(value, pos, CommentStartCharacter))
        return false;

    const unsigned end = value.length();
    while (pos < end && value[pos] != CommentEndCharacter) {
        switch (value[pos]) {
        case CommentStartCharacter:
            if (!skipComment(value, pos))
                return false;
            break;
        case QuotedPairStartCharacter:
            if (!skipQuotedPair(value, pos))
                return false;
            break;
        default:
            if (!skipWhile(value, pos, RFC7230::isCommentText))
                return false;
        }
    }
    return skipCharacter(value, pos, CommentEndCharacter);
}

// True if an HTTP header token is present, incrementing "pos" to the position after it.
// Note: Might return pos == str.length()
// See RFC 7230, Section 3.2.6.
static bool skipHTTPToken(const String& value, unsigned& pos)
{
    return skipWhile(value, pos, RFC7230::isTokenCharacter);
}

// True if a product specifier (as in an User-Agent header) is present, incrementing "pos" to the position after it.
// Note: Might return pos == str.length()
// See RFC 7231, Section 5.5.3.
static bool skipUserAgentProduct(const String& value, unsigned& pos)
{
    // product         = token ["/" product-version]
    // product-version = token
    if (!skipHTTPToken(value, pos))
        return false;
    if (skipCharacter(value, pos, '/'))
        return skipHTTPToken(value, pos);
    return true;
}

// See RFC 7231, Section 5.5.3
bool isValidUserAgentHeaderValue(const String& value)
{
    // User-Agent = product *( RWS ( product / comment ) )
    unsigned pos = 0;
    if (!skipUserAgentProduct(value, pos))
        return false;

    while (pos < value.length()) {
        if (!skipWhiteSpace(value, pos))
            return false;
        if (value[pos] == CommentStartCharacter) {
            if (!skipComment(value, pos))
                return false;
        } else {
            if (!skipUserAgentProduct(value, pos))
                return false;
        }
    }

    return pos == value.length();
}
#endif

static const size_t maxInputSampleSize = 128;
template<typename CharType>
static String trimInputSample(CharType* p, size_t length)
{
    if (length <= maxInputSampleSize)
        return String({ p, length });
    return makeString(StringView(std::span { p, length }).left(maxInputSampleSize), horizontalEllipsis);
}

std::optional<WallTime> parseHTTPDate(const String& value)
{
    auto utf8Data = value.utf8();
    double dateInMillisecondsSinceEpoch = parseDate({ reinterpret_cast<const LChar*>(utf8Data.data()), utf8Data.length() });
    if (!std::isfinite(dateInMillisecondsSinceEpoch))
        return std::nullopt;
    // This assumes system_clock epoch equals Unix epoch which is true for all implementations but unspecified.
    // FIXME: The parsing function should be switched to WallTime too.
    return WallTime::fromRawSeconds(dateInMillisecondsSinceEpoch / 1000.0);
}

// FIXME: This function doesn't comply with RFC 6266.
// For example, this function doesn't handle the interaction between " and ;
// that arises from quoted-string, nor does this function properly unquote
// attribute values. Further this function appears to process parameter names
// in a case-sensitive manner. (There are likely other bugs as well.)
StringView filenameFromHTTPContentDisposition(StringView value)
{
    for (auto keyValuePair : value.split(';')) {
        size_t valueStartPos = keyValuePair.find('=');
        if (valueStartPos == notFound)
            continue;

        auto key = keyValuePair.left(valueStartPos).trim(isUnicodeCompatibleASCIIWhitespace<char16_t>);

        if (key.isEmpty() || key != "filename"_s)
            continue;

        auto value = keyValuePair.substring(valueStartPos + 1).trim(isUnicodeCompatibleASCIIWhitespace<char16_t>);

        // Remove quotes if there are any
        if (value.length() > 1 && value[0] == '\"')
            value = value.substring(1, value.length() - 2);

        return value;
    }

    return emptyString();
}

String extractMIMETypeFromMediaType(const String& mediaType)
{
    unsigned position = 0;
    unsigned length = mediaType.length();

    for (; position < length; ++position) {
        char16_t c = mediaType[position];
        if (!isTabOrSpace(c))
            break;
    }

    if (position == length)
        return mediaType;

    unsigned typeStart = position;

    unsigned typeEnd = position;
    for (; position < length; ++position) {
        char16_t c = mediaType[position];

        // While RFC 2616 does not allow it, other browsers allow multiple values in the HTTP media
        // type header field, Content-Type. In such cases, the media type string passed here may contain
        // the multiple values separated by commas. For now, this code ignores text after the first comma,
        // which prevents it from simply failing to parse such types altogether. Later for better
        // compatibility we could consider using the first or last valid MIME type instead.
        // See https://bugs.webkit.org/show_bug.cgi?id=25352 for more discussion.
        if (c == ',')
            break;

        if (isTabOrSpace(c) || c == ';')
            break;

        typeEnd = position + 1;
    }

    return mediaType.substring(typeStart, typeEnd - typeStart);
}

StringView extractCharsetFromMediaType(StringView mediaType)
{
    unsigned charsetPos = 0, charsetLen = 0;
    size_t pos = 0;
    unsigned length = mediaType.length();

    while (pos < length) {
        pos = mediaType.findIgnoringASCIICase("charset"_s, pos);
        if (pos == notFound || pos == 0) {
            charsetLen = 0;
            break;
        }

        // is what we found a beginning of a word?
        if (mediaType[pos - 1] > ' ' && mediaType[pos - 1] != ';') {
            pos += 7;
            continue;
        }

        pos += 7;

        // skip whitespace
        while (pos < length && mediaType[pos] <= ' ')
            ++pos;

        if (pos >= length)
            break;

        if (mediaType[pos++] != '=') // this "charset" substring wasn't a parameter name, but there may be others
            continue;

        while (pos < length && (mediaType[pos] <= ' ' || mediaType[pos] == '"' || mediaType[pos] == '\''))
            ++pos;

        // we don't handle spaces within quoted parameter values, because charset names cannot have any
        unsigned endpos = pos;
        while (endpos < length && mediaType[endpos] > ' ' && mediaType[endpos] != '"' && mediaType[endpos] != '\'' && mediaType[endpos] != ';')
            ++endpos;

        charsetPos = pos;
        charsetLen = endpos - pos;
        break;
    }
    return mediaType.substring(charsetPos, charsetLen);
}

XSSProtectionDisposition parseXSSProtectionHeader(const String& header, String& failureReason, unsigned& failurePosition, String& reportURL)
{
    static NeverDestroyed<String> failureReasonInvalidToggle(MAKE_STATIC_STRING_IMPL("expected 0 or 1"));
    static NeverDestroyed<String> failureReasonInvalidSeparator(MAKE_STATIC_STRING_IMPL("expected semicolon"));
    static NeverDestroyed<String> failureReasonInvalidEquals(MAKE_STATIC_STRING_IMPL("expected equals sign"));
    static NeverDestroyed<String> failureReasonInvalidMode(MAKE_STATIC_STRING_IMPL("invalid mode directive"));
    static NeverDestroyed<String> failureReasonInvalidReport(MAKE_STATIC_STRING_IMPL("invalid report directive"));
    static NeverDestroyed<String> failureReasonDuplicateMode(MAKE_STATIC_STRING_IMPL("duplicate mode directive"));
    static NeverDestroyed<String> failureReasonDuplicateReport(MAKE_STATIC_STRING_IMPL("duplicate report directive"));
    static NeverDestroyed<String> failureReasonInvalidDirective(MAKE_STATIC_STRING_IMPL("unrecognized directive"));

    unsigned pos = 0;

    if (!skipWhiteSpace(header, pos))
        return XSSProtectionDisposition::Enabled;

    if (header[pos] == '0')
        return XSSProtectionDisposition::Disabled;

    if (header[pos++] != '1') {
        failureReason = failureReasonInvalidToggle;
        return XSSProtectionDisposition::Invalid;
    }

    XSSProtectionDisposition result = XSSProtectionDisposition::Enabled;
    bool modeDirectiveSeen = false;
    bool reportDirectiveSeen = false;

    while (1) {
        // At end of previous directive: consume whitespace, semicolon, and whitespace.
        if (!skipWhiteSpace(header, pos))
            return result;

        if (header[pos++] != ';') {
            failureReason = failureReasonInvalidSeparator;
            failurePosition = pos;
            return XSSProtectionDisposition::Invalid;
        }

        if (!skipWhiteSpace(header, pos))
            return result;

        // At start of next directive.
        if (skipToken(header, pos, "mode")) {
            if (modeDirectiveSeen) {
                failureReason = failureReasonDuplicateMode;
                failurePosition = pos;
                return XSSProtectionDisposition::Invalid;
            }
            modeDirectiveSeen = true;
            if (!skipEquals(header, pos)) {
                failureReason = failureReasonInvalidEquals;
                failurePosition = pos;
                return XSSProtectionDisposition::Invalid;
            }
            if (!skipToken(header, pos, "block")) {
                failureReason = failureReasonInvalidMode;
                failurePosition = pos;
                return XSSProtectionDisposition::Invalid;
            }
            result = XSSProtectionDisposition::BlockEnabled;
        } else if (skipToken(header, pos, "report")) {
            if (reportDirectiveSeen) {
                failureReason = failureReasonDuplicateReport;
                failurePosition = pos;
                return XSSProtectionDisposition::Invalid;
            }
            reportDirectiveSeen = true;
            if (!skipEquals(header, pos)) {
                failureReason = failureReasonInvalidEquals;
                failurePosition = pos;
                return XSSProtectionDisposition::Invalid;
            }
            size_t startPos = pos;
            if (!skipValue(header, pos)) {
                failureReason = failureReasonInvalidReport;
                failurePosition = pos;
                return XSSProtectionDisposition::Invalid;
            }
            reportURL = header.substring(startPos, pos - startPos);
            failurePosition = startPos; // If later semantic check deems unacceptable.
        } else {
            failureReason = failureReasonInvalidDirective;
            failurePosition = pos;
            return XSSProtectionDisposition::Invalid;
        }
    }
}

ContentTypeOptionsDisposition parseContentTypeOptionsHeader(StringView header)
{
    StringView leftToken = header.left(header.find(','));
    if (equalLettersIgnoringASCIICase(leftToken.trim(isASCIIWhitespaceWithoutFF<char16_t>), "nosniff"_s))
        return ContentTypeOptionsDisposition::Nosniff;
    return ContentTypeOptionsDisposition::None;
}

// For example: "HTTP/1.1 200 OK" => "OK".
// Note that HTTP/2 does not include a reason phrase, so we return the empty atom.
AtomString extractReasonPhraseFromHTTPStatusLine(const String& statusLine)
{
    StringView view = statusLine;
    size_t spacePos = view.find(' ');

    // Remove status code from the status line.
    spacePos = view.find(' ', spacePos + 1);
    if (spacePos == notFound)
        return emptyAtom();

    return view.substring(spacePos + 1).toAtomString();
}

XFrameOptionsDisposition parseXFrameOptionsHeader(StringView header)
{
    XFrameOptionsDisposition result = XFrameOptionsDisposition::None;

    if (header.isEmpty())
        return result;

    for (auto currentHeader : header.splitAllowingEmptyEntries(',')) {
        currentHeader = currentHeader.trim(isUnicodeCompatibleASCIIWhitespace<char16_t>);
        XFrameOptionsDisposition currentValue = XFrameOptionsDisposition::None;
        if (equalLettersIgnoringASCIICase(currentHeader, "deny"_s))
            currentValue = XFrameOptionsDisposition::Deny;
        else if (equalLettersIgnoringASCIICase(currentHeader, "sameorigin"_s))
            currentValue = XFrameOptionsDisposition::SameOrigin;
        else if (equalLettersIgnoringASCIICase(currentHeader, "allowall"_s))
            currentValue = XFrameOptionsDisposition::AllowAll;
        else
            currentValue = XFrameOptionsDisposition::Invalid;

        if (result == XFrameOptionsDisposition::None)
            result = currentValue;
        else if (result != currentValue)
            return XFrameOptionsDisposition::Conflict;
    }
    return result;
}

// OptionSet<ClearSiteDataValue> parseClearSiteDataHeader(const ResourceResponse& response)
// {
//     OptionSet<ClearSiteDataValue> result;

//     auto headerValue = response.httpHeaderField(HTTPHeaderName::ClearSiteData);
//     if (headerValue.isEmpty())
//         return result;

//     if (!WebCore::shouldTreatAsPotentiallyTrustworthy(response.url()))
//         return result;

//     for (auto value : StringView(headerValue).split(',')) {
//         auto trimmedValue = value.trim(isASCIIWhitespaceWithoutFF<char16_t>);
//         if (trimmedValue == "\"cache\""_s)
//             result.add(ClearSiteDataValue::Cache);
//         else if (trimmedValue == "\"cookies\""_s)
//             result.add(ClearSiteDataValue::Cookies);
//         else if (trimmedValue == "\"executionContexts\""_s)
//             result.add(ClearSiteDataValue::ExecutionContexts);
//         else if (trimmedValue == "\"storage\""_s)
//             result.add(ClearSiteDataValue::Storage);
//         else if (trimmedValue == "\"*\""_s)
//             result.add({ ClearSiteDataValue::Cache, ClearSiteDataValue::Cookies, ClearSiteDataValue::ExecutionContexts, ClearSiteDataValue::Storage });
//     }
//     return result;
// }

// Implements <https://fetch.spec.whatwg.org/#simple-range-header-value>.
// FIXME: this whole function could be more efficient by walking through the range value once.
bool parseRange(StringView range, RangeAllowWhitespace allowWhitespace, long long& rangeStart, long long& rangeEnd)
{
    rangeStart = rangeEnd = -1;

    // Only 0x20 and 0x09 matter as newlines are already gone by the time we parse a header value.
    if (allowWhitespace == RangeAllowWhitespace::No && range.find(isTabOrSpace<char16_t>) != notFound)
        return false;

    // The "bytes" unit identifier should be present.
    static const unsigned bytesLength = 5;
    if (!startsWithLettersIgnoringASCIICase(range, "bytes"_s))
        return false;

    auto byteRange = range.substring(bytesLength).trim(isASCIIWhitespaceWithoutFF<char16_t>);

    if (!byteRange.startsWith('='))
        return false;

    byteRange = byteRange.substring(1);

    // The '-' character needs to be present.
    int index = byteRange.find('-');
    if (index == -1)
        return false;

    // If the '-' character is at the beginning, the suffix length, which specifies the last N bytes, is provided.
    // Example:
    //     -500
    if (!index) {
        auto value = parseInteger<long long>(byteRange.substring(index + 1));
        if (!value)
            return false;
        rangeEnd = *value;
        return true;
    }

    // Otherwise, the first-byte-position and the last-byte-position are provied.
    // Examples:
    //     0-499
    //     500-
    auto firstBytePos = parseInteger<long long>(byteRange.left(index));
    if (!firstBytePos)
        return false;

    auto lastBytePosStr = byteRange.substring(index + 1);
    long long lastBytePos = -1;
    if (!lastBytePosStr.isEmpty()) {
        auto value = parseInteger<long long>(lastBytePosStr);
        if (!value)
            return false;
        lastBytePos = *value;
    }

    if (*firstBytePos < 0 || !(lastBytePos == -1 || lastBytePos >= *firstBytePos))
        return false;

    rangeStart = *firstBytePos;
    rangeEnd = lastBytePos;
    return true;
}

template<typename CharacterType>
static inline bool isValidHeaderNameCharacter(CharacterType character)
{
    // https://tools.ietf.org/html/rfc7230#section-3.2
    // A header name should only contain one or more of
    // alphanumeric or ! # $ % & ' * + - . ^ _ ` | ~
    if (isASCIIAlphanumeric(character))
        return true;
    switch (character) {
    case '!':
    case '#':
    case '$':
    case '%':
    case '&':
    case '\'':
    case '*':
    case '+':
    case '-':
    case '.':
    case '^':
    case '_':
    case '`':
    case '|':
    case '~':
        return true;
    default:
        return false;
    }
}

size_t parseHTTPHeader(const uint8_t* start, size_t length, String& failureReason, StringView& nameStr, String& valueStr, bool strict)
{
    auto p = start;
    auto end = start + length;

    Vector<uint8_t> name;
    Vector<uint8_t> value;

    bool foundFirstNameChar = false;
    const uint8_t* namePtr = nullptr;
    size_t nameSize = 0;

    nameStr = StringView();
    valueStr = String();

    for (; p < end; p++) {
        switch (*p) {
        case '\r':
            if (name.isEmpty()) {
                if (p + 1 < end && *(p + 1) == '\n')
                    return (p + 2) - start;
                failureReason = makeString("CR doesn't follow LF in header name at "_s, trimInputSample(p, end - p));
                return 0;
            }
            failureReason = makeString("Unexpected CR in header name at "_s, trimInputSample(name.begin(), name.size()));
            return 0;
        case '\n':
            failureReason = makeString("Unexpected LF in header name at "_s, trimInputSample(name.begin(), name.size()));
            return 0;
        case ':':
            break;
        default:
            if (!isValidHeaderNameCharacter(*p)) {
                if (name.size() < 1)
                    failureReason = "Unexpected start character in header name"_s;
                else
                    failureReason = makeString("Unexpected character in header name at "_s, trimInputSample(name.begin(), name.size()));
                return 0;
            }
            name.append(*p);
            if (!foundFirstNameChar) {
                namePtr = p;
                foundFirstNameChar = true;
            }
            continue;
        }
        if (*p == ':') {
            ++p;
            break;
        }
    }

    nameSize = name.size();
    nameStr = StringView(std::span { namePtr, nameSize });

    for (; p < end && *p == 0x20; p++) {
    }

    for (; p < end; p++) {
        switch (*p) {
        case '\r':
            break;
        case '\n':
            if (strict) {
                failureReason = makeString("Unexpected LF in header value at "_s, trimInputSample(value.begin(), value.size()));
                return 0;
            }
            break;
        default:
            value.append(*p);
        }
        if (*p == '\r' || (!strict && *p == '\n')) {
            ++p;
            break;
        }
    }
    if (p >= end || (strict && *p != '\n')) {
        failureReason = makeString("CR doesn't follow LF after header value at "_s, trimInputSample(p, end - p));
        return 0;
    }
    valueStr = String::fromUTF8({ value.begin(), value.size() });
    if (valueStr.isNull()) {
        failureReason = "Invalid UTF-8 sequence in header value"_s;
        return 0;
    }
    return p - start;
}

size_t parseHTTPRequestBody(const uint8_t* data, size_t length, Vector<uint8_t>& body)
{
    body.clear();
    body.append(std::span { data, length });

    return length;
}

// Implements <https://fetch.spec.whatwg.org/#forbidden-header-name>.
bool isForbiddenHeaderName(const StringView name)
{
    return false;
}

bool isForbiddenHeader(const StringView name, StringView value)
{
    return false;
}

// Implements <https://fetch.spec.whatwg.org/#no-cors-safelisted-request-header-name>.
bool isNoCORSSafelistedRequestHeaderName(const StringView name)
{
    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName)) {
        switch (headerName) {
        case HTTPHeaderName::Accept:
        case HTTPHeaderName::AcceptLanguage:
        case HTTPHeaderName::ContentLanguage:
        case HTTPHeaderName::ContentType:
            return true;
        default:
            break;
        }
    }
    return false;
}

// Implements <https://fetch.spec.whatwg.org/#privileged-no-cors-request-header-name>.
bool isPriviledgedNoCORSRequestHeaderName(const StringView name)
{
    return false;
    // return equalLettersIgnoringASCIICase(name, "range"_s);
}

// Implements <https://fetch.spec.whatwg.org/#forbidden-response-header-name>.
bool isForbiddenResponseHeaderName(const StringView name)
{
    return false;
    // return equalLettersIgnoringASCIICase(name, "set-cookie"_s) || equalLettersIgnoringASCIICase(name, "set-cookie2"_s);
}

// Implements <https://fetch.spec.whatwg.org/#forbidden-method>.
bool isForbiddenMethod(const StringView name)
{
    // return equalLettersIgnoringASCIICase(name, "connect"_s) || equalLettersIgnoringASCIICase(name, "trace"_s) || equalLettersIgnoringASCIICase(name, "track"_s);
    return false;
}

bool isSimpleHeader(const StringView name, const StringView value)
{
    HTTPHeaderName headerName;
    return !findHTTPHeaderName(name, headerName);
}

// bool isCrossOriginSafeHeader(HTTPHeaderName name, const HTTPHeaderSet& accessControlExposeHeaderSet)
// {
//     // switch (name) {
//     // case HTTPHeaderName::CacheControl:
//     // case HTTPHeaderName::ContentLanguage:
//     // case HTTPHeaderName::ContentLength:
//     // case HTTPHeaderName::ContentType:
//     // case HTTPHeaderName::Expires:
//     // case HTTPHeaderName::LastModified:
//     // case HTTPHeaderName::Pragma:
//     // case HTTPHeaderName::Accept:
//     //     return true;
//     // case HTTPHeaderName::SetCookie:
//     // case HTTPHeaderName::SetCookie2:
//     //     return false;
//     // default:
//     //     break;
//     // }
//     // return accessControlExposeHeaderSet.contains<HashTranslatorASCIILiteralCaseInsensitive>(httpHeaderNameString(name));
// }

// bool isCrossOriginSafeHeader(const String& name, const HTTPHeaderSet& accessControlExposeHeaderSet)
// {
// #if ASSERT_ENABLED
//     HTTPHeaderName headerName;
//     ASSERT(!findHTTPHeaderName(name, headerName));
// #endif
//     return accessControlExposeHeaderSet.contains(name);
// }

// Implements https://fetch.spec.whatwg.org/#cors-safelisted-request-header
bool isCrossOriginSafeRequestHeader(HTTPHeaderName name, const String& value)
{
    // if (value.length() > 128)
    //     return false;

    // switch (name) {
    // case HTTPHeaderName::Accept:
    //     if (!isValidAcceptHeaderValue(value))
    //         return false;
    //     break;
    // case HTTPHeaderName::AcceptLanguage:
    // case HTTPHeaderName::ContentLanguage:
    //     if (!isValidLanguageHeaderValue(value))
    //         return false;
    //     break;
    // case HTTPHeaderName::ContentType: {
    //     // Preflight is required for MIME types that can not be sent via form submission.
    //     if (containsCORSUnsafeRequestHeaderBytes(value))
    //         return false;
    //     auto parsedContentType = ParsedContentType::create(value);
    //     if (!parsedContentType)
    //         return false;
    //     String mimeType = parsedContentType->mimeType();
    //     if (!(equalLettersIgnoringASCIICase(mimeType, "application/x-www-form-urlencoded"_s) || equalLettersIgnoringASCIICase(mimeType, "multipart/form-data"_s) || equalLettersIgnoringASCIICase(mimeType, "text/plain"_s)))
    //         return false;
    //     break;
    // }
    // case HTTPHeaderName::Range:
    //     long long start;
    //     long long end;
    //     if (!parseRange(value, RangeAllowWhitespace::No, start, end))
    //         return false;
    //     if (start == -1)
    //         return false;
    //     break;
    // default:
    //     return false;
    // }
    return true;
}

// Implements <https://fetch.spec.whatwg.org/#concept-method-normalize>.
String normalizeHTTPMethod(const String& method)
{
    // static constexpr ASCIILiteral methods[] = { "DELETE"_s, "GET"_s, "HEAD"_s, "OPTIONS"_s, "POST"_s, "PUT"_s };
    // for (auto value : methods) {
    //     if (equalIgnoringASCIICase(method, value)) {
    //         // Don't bother allocating a new string if it's already all uppercase.
    //         if (method == value)
    //             break;
    //         return value;
    //     }
    // }
    return method;
}

// Defined by https://tools.ietf.org/html/rfc7231#section-4.2.1
bool isSafeMethod(const String& method)
{
    // const ASCIILiteral safeMethods[] = { "GET"_s, "HEAD"_s, "OPTIONS"_s, "TRACE"_s };
    // for (auto value : safeMethods) {
    //     if (equalIgnoringASCIICase(method, value))
    //         return true;
    // }
    return true;
}

CrossOriginResourcePolicy parseCrossOriginResourcePolicyHeader(StringView header)
{
    auto trimmedHeader = header.trim(isASCIIWhitespaceWithoutFF<char16_t>);

    if (trimmedHeader.isEmpty())
        return CrossOriginResourcePolicy::None;

    if (trimmedHeader == "same-origin"_s)
        return CrossOriginResourcePolicy::SameOrigin;

    if (trimmedHeader == "same-site"_s)
        return CrossOriginResourcePolicy::SameSite;

    if (trimmedHeader == "cross-origin"_s)
        return CrossOriginResourcePolicy::CrossOrigin;

    return CrossOriginResourcePolicy::Invalid;
}

extern "C" int Bun__writeHTTPDate(char* buffer, size_t length, uint64_t timestampMs)
{
    if (timestampMs == 0) {
        return 0;
    }

    time_t timestamp = timestampMs / 1000;
    struct tm tstruct = {};
#ifdef _WIN32
    gmtime_s(&tstruct, &timestamp);
#else
    gmtime_r(&timestamp, &tstruct);
#endif
    static const char wday_name[][4] = {
        "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
    };
    static const char mon_name[][4] = {
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    };
    return snprintf(buffer, length, "%.3s, %.2u %.3s %.4u %.2u:%.2u:%.2u GMT",
        wday_name[tstruct.tm_wday],
        tstruct.tm_mday % 99,
        mon_name[tstruct.tm_mon],
        (1900 + tstruct.tm_year) % 9999,
        tstruct.tm_hour % 99,
        tstruct.tm_min % 99,
        tstruct.tm_sec % 99);
}

}
