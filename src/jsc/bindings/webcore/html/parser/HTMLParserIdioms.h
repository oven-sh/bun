/*
 * Copyright (C) 2010-2017 Apple Inc. All rights reserved.
 * Copyright (C) 2025 Samuel Weinig <sam@webkit.org>
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <unicode/uchar.h>
#include <wtf/text/StringView.h>

namespace WebCore {

class Decimal;
class QualifiedName;

template<typename CharacterType> bool isComma(CharacterType);
template<typename CharacterType> bool isHTMLSpaceOrComma(CharacterType);
bool isHTMLLineBreak(char16_t);
bool isHTMLSpaceButNotLineBreak(char16_t);

// 2147483647 is 2^31 - 1.
static const unsigned maxHTMLNonNegativeInteger = 2147483647;

// An implementation of the HTML specification's algorithm to convert a number to a string for number and range types.
String serializeForNumberType(const Decimal&);
String serializeForNumberType(double);

// Convert the specified string to a decimal/double. If the conversion fails, the return value is fallback value or NaN if not specified.
// Leading or trailing illegal characters cause failure, as does passing an empty string.
// The double* parameter may be 0 to check if the string can be parsed without getting the result.
Decimal parseToDecimalForNumberType(StringView);
Decimal parseToDecimalForNumberType(StringView, const Decimal& fallbackValue);
double parseToDoubleForNumberType(StringView);
double parseToDoubleForNumberType(StringView, double fallbackValue);

// http://www.whatwg.org/specs/web-apps/current-work/#rules-for-parsing-integers
enum class HTMLIntegerParsingError { NegativeOverflow, PositiveOverflow, Other };

WEBCORE_EXPORT std::expected<int, HTMLIntegerParsingError> parseHTMLInteger(StringView);

// http://www.whatwg.org/specs/web-apps/current-work/#rules-for-parsing-non-negative-integers
WEBCORE_EXPORT std::expected<unsigned, HTMLIntegerParsingError> parseHTMLNonNegativeInteger(StringView);

// https://html.spec.whatwg.org/#valid-non-negative-integer
std::optional<int> parseValidHTMLNonNegativeInteger(StringView);

// https://html.spec.whatwg.org/#valid-floating-point-number
std::optional<double> parseValidHTMLFloatingPointNumber(StringView);

// https://html.spec.whatwg.org/#rules-for-parsing-floating-point-number-values
double parseHTMLFloatingPointNumberValue(StringView, double fallbackValue = std::numeric_limits<double>::quiet_NaN());

// https://html.spec.whatwg.org/multipage/infrastructure.html#rules-for-parsing-floating-point-number-values
Vector<double> parseHTMLListOfOfFloatingPointNumberValues(StringView);

// https://html.spec.whatwg.org/multipage/semantics.html#attr-meta-http-equiv-refresh
bool parseMetaHTTPEquivRefresh(StringView, double& delay, String& url);

// https://html.spec.whatwg.org/multipage/infrastructure.html#cors-settings-attribute
String parseCORSSettingsAttribute(const AtomString&);

bool threadSafeMatch(const QualifiedName&, const QualifiedName&);

AtomString parseHTMLHashNameReference(StringView);

// https://html.spec.whatwg.org/#rules-for-parsing-dimension-values
struct HTMLDimension {
    enum class Type : bool { Percentage, Pixel };
    double number;
    Type type;
};
std::optional<HTMLDimension> parseHTMLDimension(StringView);
std::optional<HTMLDimension> parseHTMLMultiLength(StringView);

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#lists-of-dimensions
struct HTMLDimensionsListValue {
    enum class Unit : uint8_t { Percentage, Relative, Absolute };
    double number;
    Unit unit;
};
WEBCORE_EXPORT FixedVector<HTMLDimensionsListValue> parseHTMLDimensionsList(StringView);

// Inline implementations of some of the functions declared above.

inline bool isHTMLLineBreak(char16_t character)
{
    return character <= '\r' && (character == '\n' || character == '\r');
}

ALWAYS_INLINE bool containsHTMLLineBreak(StringView view)
{
    if (view.is8Bit())
        return charactersContain<Latin1Character, '\r', '\n'>(view.span8());
    return charactersContain<char16_t, '\r', '\n'>(view.span16());
}

template<typename CharacterType> inline bool isComma(CharacterType character)
{
    return character == ',';
}

template<typename CharacterType> inline bool isHTMLSpaceOrComma(CharacterType character)
{
    return isComma(character) || isASCIIWhitespace(character);
}

inline bool isHTMLSpaceButNotLineBreak(char16_t character)
{
    return isASCIIWhitespace(character) && !isHTMLLineBreak(character);
}

// https://html.spec.whatwg.org/multipage/infrastructure.html#limited-to-only-non-negative-numbers-greater-than-zero
inline unsigned limitToOnlyHTMLNonNegativeNumbersGreaterThanZero(unsigned value, unsigned defaultValue = 1)
{
    return (value > 0 && value <= maxHTMLNonNegativeInteger) ? value : defaultValue;
}

inline unsigned limitToOnlyHTMLNonNegativeNumbersGreaterThanZero(StringView stringValue, unsigned defaultValue = 1)
{
    ASSERT(defaultValue > 0);
    ASSERT(defaultValue <= maxHTMLNonNegativeInteger);
    auto optionalValue = parseHTMLNonNegativeInteger(stringValue);
    unsigned value = optionalValue && optionalValue.value() ? optionalValue.value() : defaultValue;
    ASSERT(value > 0);
    ASSERT(value <= maxHTMLNonNegativeInteger);
    return value;
}

// https://html.spec.whatwg.org/#reflecting-content-attributes-in-idl-attributes:idl-unsigned-long
inline unsigned limitToOnlyHTMLNonNegative(unsigned value, unsigned defaultValue = 0)
{
    ASSERT(defaultValue <= maxHTMLNonNegativeInteger);
    return value <= maxHTMLNonNegativeInteger ? value : defaultValue;
}

inline unsigned limitToOnlyHTMLNonNegative(StringView stringValue, unsigned defaultValue = 0)
{
    ASSERT(defaultValue <= maxHTMLNonNegativeInteger);
    unsigned value = parseHTMLNonNegativeInteger(stringValue).value_or(defaultValue);
    ASSERT(value <= maxHTMLNonNegativeInteger);
    return value;
}

// https://html.spec.whatwg.org/#clamped-to-the-range
inline unsigned clampHTMLNonNegativeIntegerToRange(StringView stringValue, unsigned min, unsigned max, unsigned defaultValue = 0)
{
    ASSERT(defaultValue >= min);
    ASSERT(defaultValue <= max);
    auto optionalValue = parseHTMLNonNegativeInteger(stringValue);
    if (optionalValue)
        return std::min(std::max(optionalValue.value(), min), max);

    return optionalValue.error() == HTMLIntegerParsingError::PositiveOverflow ? max : defaultValue;
}

} // namespace WebCore
