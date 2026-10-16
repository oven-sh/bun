/*
 * Copyright (C) 2002, 2003 The Karbon Developers
 * Copyright (C) 2006 Alexander Kellett <lypanov@kde.org>
 * Copyright (C) 2006, 2007 Rob Buis <buis@kde.org>
 * Copyright (C) 2007-2024 Apple Inc. All rights reserved.
 * Copyright (C) 2016-2018 Google Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 */

#include "config.h"
#include "SVGParserUtilities.h"

#include <limits>
#include <wtf/ASCIICType.h>
#include <wtf/text/StringParsingBuffer.h>
#include <wtf/text/StringView.h>

namespace WebCore {

template <typename FloatType> static inline bool LEGACY_NODELETE isValidRange(const FloatType x)
{
    static const FloatType max = std::numeric_limits<FloatType>::max();
    return x >= -max && x <= max;
}

// We use this generic parseNumber function to allow the Path parsing code to work 
// at a higher precision internally, without any unnecessary runtime cost or code
// complexity.
// FIXME: Can this be shared/replaced with number parsing in WTF?
template <typename CharacterType, typename FloatType = float> static std::optional<FloatType> LEGACY_NODELETE genericParseNumber(StringParsingBuffer<CharacterType>& buffer, SuffixSkippingPolicy skip = SuffixSkippingPolicy::Skip)
{
    // read the sign
    int sign = 1;
    if (buffer.hasCharactersRemaining() && *buffer == '+')
        ++buffer;
    else if (buffer.hasCharactersRemaining() && *buffer == '-') {
        ++buffer;
        sign = -1;
    } 
    
    if (buffer.atEnd() || (!isASCIIDigit(*buffer) && *buffer != '.'))
        return std::nullopt;

    // read the integer part, build right-to-left
    auto spanDigitsStart = buffer.span();
    
    // Advance to first non-digit.
    skipWhile<isASCIIDigit>(buffer);

    FloatType integer = 0;
    if (buffer.position() > spanDigitsStart.data()) {
        size_t indexScanIntPart = buffer.position() - spanDigitsStart.data();
        FloatType multiplier = 1;
        for (size_t i = indexScanIntPart; i > 0; --i) {
            integer += multiplier * static_cast<FloatType>(spanDigitsStart[i - 1] - '0');
            multiplier *= 10;
        }
        // Bail out early if this overflows.
        if (!isValidRange(integer))
            return std::nullopt;
    }

    // read the decimals
    FloatType decimal = 0;
    if (buffer.hasCharactersRemaining() && *buffer == '.') {
        ++buffer;
        
        // There must be a least one digit following the .
        if (buffer.atEnd() || !isASCIIDigit(*buffer))
            return std::nullopt;
        
        FloatType frac = 1;
        while (buffer.hasCharactersRemaining() && isASCIIDigit(*buffer)) {
            frac *= static_cast<FloatType>(0.1);
            decimal += (*(buffer++) - '0') * frac;
        }
    }

    // When we get here we should have consumed either a digit for the integer
    // part or a fractional part (with at least one digit after the '.'.)
    ASSERT(spanDigitsStart.data() != buffer.position());

    FloatType number = 0;
    number = integer + decimal;
    number *= sign;

    // read the exponent part
    if (buffer.span().size() > 1 && (*buffer == 'e' || *buffer == 'E')
        && (buffer[1] != 'x' && buffer[1] != 'm')) {
        ++buffer;

        // read the sign of the exponent
        bool exponentIsNegative = false;
        if (*buffer == '+')
            ++buffer;
        else if (*buffer == '-') {
            ++buffer;
            exponentIsNegative = true;
        }

        // There must be an exponent
        if (buffer.atEnd() || !isASCIIDigit(*buffer))
            return std::nullopt;

        FloatType exponent = 0;
        while (buffer.hasCharactersRemaining() && isASCIIDigit(*buffer)) {
            exponent *= static_cast<FloatType>(10);
            exponent += *buffer++ - '0';
        }

        // FIXME: This is unnecessairly strict - the position of the decimal point
        // is not taken into account when limiting 'exponent'.
        if (exponentIsNegative)
            exponent = -exponent;
        // Fail if the exponent is greater than the largest positive power of ten
        // (that would yield a representable float).
        if (exponent > std::numeric_limits<FloatType>::max_exponent10)
            return std::nullopt;

        // If the exponent is smaller than smallest negative power of 10 (that
        // would yield a representable float), then rely on the pow()+rounding to
        // produce a reasonable result (likely zero.)
        if (exponent)
            number *= static_cast<FloatType>(std::pow(10.0, exponent));
    }

    // Don't return Infinity() or NaN().
    if (!isValidRange(number))
        return std::nullopt;

    if (skip == SuffixSkippingPolicy::Skip)
        skipOptionalSVGSpacesOrDelimiter(buffer);

    return number;
}

std::optional<float> parseNumber(StringParsingBuffer<Latin1Character>& buffer, SuffixSkippingPolicy skip)
{
    return genericParseNumber(buffer, skip);
}

std::optional<float> parseNumber(StringParsingBuffer<char16_t>& buffer, SuffixSkippingPolicy skip)
{
    return genericParseNumber(buffer, skip);
}

}
