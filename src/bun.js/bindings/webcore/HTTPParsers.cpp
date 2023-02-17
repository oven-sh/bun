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
#include "ParsedContentType.h"
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
static inline bool skipWhile(const String& str, unsigned& pos, const Function<bool(const UChar)>& predicate)
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
    skipWhile(str, pos, RFC7230::isWhitespace);
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
        if (str[pos] == ' ' || str[pos] == '\t' || str[pos] == ';')
            break;
        ++pos;
    }
    return pos != start;
}

// See RFC 7230, Section 3.1.2.
bool isValidReasonPhrase(const String& value)
{
    for (unsigned i = 0; i < value.length(); ++i) {
        UChar c = value[i];
        if (c == 0x7F || !isLatin1(c) || (c < 0x20 && c != '\t'))
            return false;
    }
    return true;
}

// See https://fetch.spec.whatwg.org/#concept-header
bool isValidHTTPHeaderValue(const String& value)
{
    UChar c = value[0];
    if (c == ' ' || c == '\t')
        return false;
    c = value[value.length() - 1];
    if (c == ' ' || c == '\t')
        return false;
    for (unsigned i = 0; i < value.length(); ++i) {
        c = value[i];
        if (c == 0x00 || c == 0x0A || c == 0x0D)
            return false;
    }
    return true;
}

// See RFC 7231, Section 5.3.2.
bool isValidAcceptHeaderValue(const String& value)
{
    for (unsigned i = 0; i < value.length(); ++i) {
        UChar c = value[i];

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
        UChar c = value[i];
        // https://fetch.spec.whatwg.org/#cors-unsafe-request-header-byte
        if ((c < 0x20 && c != '\t') || (c == '"' || c == '(' || c == ')' || c == ':' || c == '<' || c == '>' || c == '?' || c == '@' || c == '[' || c == '\\' || c == ']' || c == 0x7B || c == '{' || c == '}' || c == 0x7F))
            return true;
    }

    return false;
}

// See RFC 7231, Section 5.3.5 and 3.1.3.2.
// https://fetch.spec.whatwg.org/#cors-safelisted-request-header
bool isValidLanguageHeaderValue(const String& value)
{
    for (unsigned i = 0; i < value.length(); ++i) {
        UChar c = value[i];
        if (isASCIIAlphanumeric(c) || c == ' ' || c == '*' || c == ',' || c == '-' || c == '.' || c == ';' || c == '=')
            continue;
        return false;
    }
    return true;
}

// See RFC 7230, Section 3.2.6.
bool isValidHTTPToken(StringView value)
{
    if (value.isEmpty())
        return false;
    for (UChar c : value.codeUnits()) {
        if (!RFC7230::isTokenCharacter(c))
            return false;
    }
    return true;
}

bool isValidHTTPToken(const String& value)
{
    return isValidHTTPToken(StringView(value));
}

#if USE(GLIB)
// True if the character at the given position satisifies a predicate, incrementing "pos" by one.
// Note: Might return pos == str.length()
static inline bool skipCharacter(const String& value, unsigned& pos, Function<bool(const UChar)>&& predicate)
{
    if (pos < value.length() && predicate(value[pos])) {
        ++pos;
        return true;
    }
    return false;
}

// True if the "expected" character is at the given position, incrementing "pos" by one.
// Note: Might return pos == str.length()
static inline bool skipCharacter(const String& value, unsigned& pos, const UChar expected)
{
    return skipCharacter(value, pos, [expected](const UChar c) {
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
        return String(p, length);
    return makeString(StringView(p, length).left(maxInputSampleSize), horizontalEllipsis);
}

std::optional<WallTime> parseHTTPDate(const String& value)
{
    double dateInMillisecondsSinceEpoch = parseDateFromNullTerminatedCharacters(value.utf8().data());
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

        auto key = keyValuePair.left(valueStartPos).stripWhiteSpace();

        if (key.isEmpty() || key != "filename"_s)
            continue;

        auto value = keyValuePair.substring(valueStartPos + 1).stripWhiteSpace();

        // Remove quotes if there are any
        if (value.length() > 1 && value[0] == '\"')
            value = value.substring(1, value.length() - 2);

        return value;
    }

    return String();
}

String extractMIMETypeFromMediaType(const String& mediaType)
{
    unsigned position = 0;
    unsigned length = mediaType.length();

    for (; position < length; ++position) {
        UChar c = mediaType[position];
        if (c != '\t' && c != ' ')
            break;
    }

    if (position == length)
        return mediaType;

    unsigned typeStart = position;

    unsigned typeEnd = position;
    for (; position < length; ++position) {
        UChar c = mediaType[position];

        // While RFC 2616 does not allow it, other browsers allow multiple values in the HTTP media
        // type header field, Content-Type. In such cases, the media type string passed here may contain
        // the multiple values separated by commas. For now, this code ignores text after the first comma,
        // which prevents it from simply failing to parse such types altogether. Later for better
        // compatibility we could consider using the first or last valid MIME type instead.
        // See https://bugs.webkit.org/show_bug.cgi?id=25352 for more discussion.
        if (c == ',')
            break;

        if (c == '\t' || c == ' ' || c == ';')
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
    if (equalLettersIgnoringASCIICase(stripLeadingAndTrailingHTTPSpaces(leftToken), "nosniff"_s))
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

    for (auto currentHeader : header.split(',')) {
        currentHeader = currentHeader.stripWhiteSpace();
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

// https://fetch.spec.whatwg.org/#concept-header-list-get-structured-header
// FIXME: For now, this assumes the type is "item".
std::optional<std::pair<StringView, HashMap<String, String>>> parseStructuredFieldValue(StringView header)
{
    header = stripLeadingAndTrailingHTTPSpaces(header);
    if (header.isEmpty())
        return std::nullopt;

    // Parse a token (https://datatracker.ietf.org/doc/html/rfc8941#section-4.2.6).
    if (!isASCIIAlpha(header[0]) && header[0] != '*')
        return std::nullopt;
    size_t index = 1;
    while (index < header.length()) {
        UChar c = header[index];
        if (!RFC7230::isTokenCharacter(c) && c != ':' && c != '/')
            break;
        ++index;
    }
    StringView bareItem = header.left(index);

    // Parse parameters (https://datatracker.ietf.org/doc/html/rfc8941#section-4.2.3.2).
    HashMap<String, String> parameters;
    while (index < header.length()) {
        if (header[index] != ';')
            break;
        ++index; // Consume ';'.
        while (index < header.length() && header[index] == ' ')
            ++index;
        if (index == header.length())
            return std::nullopt;
        // Parse a key (https://datatracker.ietf.org/doc/html/rfc8941#section-4.2.3.3)
        if (!isASCIILower(header[index]))
            return std::nullopt;
        size_t keyStart = index++;
        while (index < header.length()) {
            UChar c = header[index];
            if (!isASCIILower(c) && !isASCIIDigit(c) && c != '_' && c != '-' && c != '.' && c != '*')
                break;
            ++index;
        }
        StringView key = header.substring(keyStart, index - keyStart);
        String value = trueAtom();
        if (index < header.length() && header[index] == '=') {
            ++index; // Consume '='.
            if (isASCIIAlpha(header[index]) || header[index] == '*') {
                // https://datatracker.ietf.org/doc/html/rfc8941#section-4.2.6
                size_t valueStart = index++;
                while (index < header.length()) {
                    UChar c = header[index];
                    if (!RFC7230::isTokenCharacter(c) && c != ':' && c != '/')
                        break;
                    ++index;
                }
                value = header.substring(valueStart, index - valueStart).toString();
            } else if (header[index] == '"') {
                // https://datatracker.ietf.org/doc/html/rfc8941#section-4.2.5
                StringBuilder valueBuilder;
                ++index; // Skip DQUOTE.
                while (index < header.length()) {
                    if (header[index] == '\\') {
                        ++index;
                        if (index == header.length())
                            return std::nullopt;
                        if (header[index] != '\\' && header[index] != '"')
                            return std::nullopt;
                        valueBuilder.append(header[index]);
                    } else if (header[index] == '\"') {
                        value = valueBuilder.toString();
                        break;
                    } else if (header[index] <= 0x1F || (header[index] >= 0x7F && header[index] <= 0xFF)) // Not in VCHAR or SP.
                        return std::nullopt;
                    else
                        valueBuilder.append(header[index]);
                    ++index;
                }
                if (index == header.length())
                    return std::nullopt;
                ++index; // Skip DQUOTE.
            } else
                return std::nullopt;
        }
        parameters.set(key.toString(), WTFMove(value));
    }
    if (index != header.length())
        return std::nullopt;
    return std::make_pair(bareItem, parameters);
}

bool parseRange(StringView range, long long& rangeOffset, long long& rangeEnd, long long& rangeSuffixLength)
{
    // The format of "Range" header is defined in RFC 2616 Section 14.35.1.
    // http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.35.1
    // We don't support multiple range requests.

    rangeOffset = rangeEnd = rangeSuffixLength = -1;

    // The "bytes" unit identifier should be present.
    static const unsigned bytesLength = 6;
    if (!startsWithLettersIgnoringASCIICase(range, "bytes="_s))
        return false;

    StringView byteRange = range.substring(bytesLength);

    // The '-' character needs to be present.
    int index = byteRange.find('-');
    if (index == -1)
        return false;

    // If the '-' character is at the beginning, the suffix length, which specifies the last N bytes, is provided.
    // Example:
    //     -500
    if (!index) {
        if (auto value = parseInteger<long long>(byteRange.substring(index + 1)))
            rangeSuffixLength = *value;
        return true;
    }

    // Otherwise, the first-byte-position and the last-byte-position are provied.
    // Examples:
    //     0-499
    //     500-
    auto firstBytePos = parseInteger<long long>(byteRange.left(index));
    if (!firstBytePos)
        return false;

    auto lastBytePosStr = stripLeadingAndTrailingHTTPSpaces(byteRange.substring(index + 1));
    long long lastBytePos = -1;
    if (!lastBytePosStr.isEmpty()) {
        auto value = parseInteger<long long>(lastBytePosStr);
        if (!value)
            return false;
        lastBytePos = *value;
    }

    if (*firstBytePos < 0 || !(lastBytePos == -1 || lastBytePos >= *firstBytePos))
        return false;

    rangeOffset = *firstBytePos;
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
                failureReason = makeString("CR doesn't follow LF in header name at ", trimInputSample(p, end - p));
                return 0;
            }
            failureReason = makeString("Unexpected CR in header name at ", trimInputSample(name.data(), name.size()));
            return 0;
        case '\n':
            failureReason = makeString("Unexpected LF in header name at ", trimInputSample(name.data(), name.size()));
            return 0;
        case ':':
            break;
        default:
            if (!isValidHeaderNameCharacter(*p)) {
                if (name.size() < 1)
                    failureReason = "Unexpected start character in header name"_s;
                else
                    failureReason = makeString("Unexpected character in header name at ", trimInputSample(name.data(), name.size()));
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
    nameStr = StringView(namePtr, nameSize);

    for (; p < end && *p == 0x20; p++) {
    }

    for (; p < end; p++) {
        switch (*p) {
        case '\r':
            break;
        case '\n':
            if (strict) {
                failureReason = makeString("Unexpected LF in header value at ", trimInputSample(value.data(), value.size()));
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
        failureReason = makeString("CR doesn't follow LF after header value at ", trimInputSample(p, end - p));
        return 0;
    }
    valueStr = String::fromUTF8(value.data(), value.size());
    if (valueStr.isNull()) {
        failureReason = "Invalid UTF-8 sequence in header value"_s;
        return 0;
    }
    return p - start;
}

size_t parseHTTPRequestBody(const uint8_t* data, size_t length, Vector<uint8_t>& body)
{
    body.clear();
    body.append(data, length);

    return length;
}

// Implements <https://fetch.spec.whatwg.org/#forbidden-header-name>.
bool isForbiddenHeaderName(const String& name)
{
    return false;
    // HTTPHeaderName headerName;
    // if (findHTTPHeaderName(name, headerName)) {
    //     switch (headerName) {
    //     case HTTPHeaderName::AcceptCharset:
    //     case HTTPHeaderName::AcceptEncoding:
    //     case HTTPHeaderName::AccessControlRequestHeaders:
    //     case HTTPHeaderName::AccessControlRequestMethod:
    //     case HTTPHeaderName::Connection:
    //     case HTTPHeaderName::ContentLength:
    //     case HTTPHeaderName::Cookie:
    //     case HTTPHeaderName::Cookie2:
    //     case HTTPHeaderName::Date:
    //     case HTTPHeaderName::DNT:
    //     case HTTPHeaderName::Expect:
    //     case HTTPHeaderName::Host:
    //     case HTTPHeaderName::KeepAlive:
    //     case HTTPHeaderName::Origin:
    //     case HTTPHeaderName::Referer:
    //     case HTTPHeaderName::TE:
    //     case HTTPHeaderName::Trailer:
    //     case HTTPHeaderName::TransferEncoding:
    //     case HTTPHeaderName::Upgrade:
    //     case HTTPHeaderName::Via:
    //         return true;
    //     default:
    //         break;
    //     }
    // }
    // return startsWithLettersIgnoringASCIICase(name, "sec-"_s) || startsWithLettersIgnoringASCIICase(name, "proxy-"_s);
}

// Implements <https://fetch.spec.whatwg.org/#no-cors-safelisted-request-header-name>.
bool isNoCORSSafelistedRequestHeaderName(const String& name)
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
bool isPriviledgedNoCORSRequestHeaderName(const String& name)
{
    return equalLettersIgnoringASCIICase(name, "range"_s);
}

// Implements <https://fetch.spec.whatwg.org/#forbidden-response-header-name>.
bool isForbiddenResponseHeaderName(const String& name)
{
    return equalLettersIgnoringASCIICase(name, "set-cookie"_s) || equalLettersIgnoringASCIICase(name, "set-cookie2"_s);
}

// Implements <https://fetch.spec.whatwg.org/#forbidden-method>.
bool isForbiddenMethod(const String& name)
{
    return equalLettersIgnoringASCIICase(name, "connect"_s) || equalLettersIgnoringASCIICase(name, "trace"_s) || equalLettersIgnoringASCIICase(name, "track"_s);
}

bool isSimpleHeader(const String& name, const String& value)
{
    HTTPHeaderName headerName;
    if (!findHTTPHeaderName(name, headerName))
        return false;
    return isCrossOriginSafeRequestHeader(headerName, value);
}

bool isCrossOriginSafeHeader(HTTPHeaderName name, const HTTPHeaderSet& accessControlExposeHeaderSet)
{
    switch (name) {
    case HTTPHeaderName::CacheControl:
    case HTTPHeaderName::ContentLanguage:
    case HTTPHeaderName::ContentLength:
    case HTTPHeaderName::ContentType:
    case HTTPHeaderName::Expires:
    case HTTPHeaderName::LastModified:
    case HTTPHeaderName::Pragma:
    case HTTPHeaderName::Accept:
        return true;
    case HTTPHeaderName::SetCookie:
    case HTTPHeaderName::SetCookie2:
        return false;
    default:
        break;
    }
    return accessControlExposeHeaderSet.contains<ASCIICaseInsensitiveStringViewHashTranslator>(httpHeaderNameString(name));
}

bool isCrossOriginSafeHeader(const String& name, const HTTPHeaderSet& accessControlExposeHeaderSet)
{
#if ASSERT_ENABLED
    HTTPHeaderName headerName;
    ASSERT(!findHTTPHeaderName(name, headerName));
#endif
    return accessControlExposeHeaderSet.contains(name);
}

static bool isSimpleRangeHeaderValue(const String& value)
{
    if (!value.startsWith("bytes="_s))
        return false;

    unsigned start = 0;
    unsigned end = 0;
    bool hasHyphen = false;

    for (size_t cptr = 6; cptr < value.length(); ++cptr) {
        auto character = value[cptr];
        if (character >= '0' && character <= '9') {
            if (productOverflows<unsigned>(hasHyphen ? end : start, 10))
                return false;
            auto newDecimal = (hasHyphen ? end : start) * 10;
            auto sum = Checked<unsigned, RecordOverflow>(newDecimal) + Checked<unsigned, RecordOverflow>(character - '0');
            if (sum.hasOverflowed())
                return false;

            if (hasHyphen)
                end = sum.value();
            else
                start = sum.value();
            continue;
        }
        if (character == '-' && !hasHyphen) {
            hasHyphen = true;
            continue;
        }
        return false;
    }

    return hasHyphen && (!end || start < end);
}

// Implements https://fetch.spec.whatwg.org/#cors-safelisted-request-header
bool isCrossOriginSafeRequestHeader(HTTPHeaderName name, const String& value)
{
    if (value.length() > 128)
        return false;

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
    //     if (!isSimpleRangeHeaderValue(value))
    //         return false;
    //     break;
    // default:
    //     // FIXME: Should we also make safe other headers (DPR, Downlink, Save-Data...)? That would require validating their values.
    //     return false;
    // }
    return true;
}

// Implements <https://fetch.spec.whatwg.org/#concept-method-normalize>.
String normalizeHTTPMethod(const String& method)
{
    const ASCIILiteral methods[] = { "DELETE"_s, "GET"_s, "HEAD"_s, "OPTIONS"_s, "POST"_s, "PUT"_s };
    for (auto value : methods) {
        if (equalIgnoringASCIICase(method, value)) {
            // Don't bother allocating a new string if it's already all uppercase.
            if (method == value)
                break;
            return value;
        }
    }
    return method;
}

// Defined by https://tools.ietf.org/html/rfc7231#section-4.2.1
bool isSafeMethod(const String& method)
{
    const ASCIILiteral safeMethods[] = { "GET"_s, "HEAD"_s, "OPTIONS"_s, "TRACE"_s };
    for (auto value : safeMethods) {
        if (equalIgnoringASCIICase(method, value))
            return true;
    }
    return false;
}

CrossOriginResourcePolicy parseCrossOriginResourcePolicyHeader(StringView header)
{
    auto strippedHeader = stripLeadingAndTrailingHTTPSpaces(header);

    if (strippedHeader.isEmpty())
        return CrossOriginResourcePolicy::None;

    if (strippedHeader == "same-origin"_s)
        return CrossOriginResourcePolicy::SameOrigin;

    if (strippedHeader == "same-site"_s)
        return CrossOriginResourcePolicy::SameSite;

    if (strippedHeader == "cross-origin"_s)
        return CrossOriginResourcePolicy::CrossOrigin;

    return CrossOriginResourcePolicy::Invalid;
}

}