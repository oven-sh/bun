/*
 * Copyright (C) 2002, 2003 The Karbon Developers
 * Copyright (C) 2006, 2007 Rob Buis <buis@kde.org>
 * Copyright (C) 2013-2024 Apple Inc. All rights reserved.
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

#pragma once

#include <wtf/Forward.h>
#include <wtf/text/ParsingUtilities.h>

namespace WebCore {

enum class SuffixSkippingPolicy {
    DontSkip,
    Skip
};

std::optional<float> LEGACY_NODELETE parseNumber(StringParsingBuffer<Latin1Character>&, SuffixSkippingPolicy = SuffixSkippingPolicy::Skip);
std::optional<float> LEGACY_NODELETE parseNumber(StringParsingBuffer<char16_t>&, SuffixSkippingPolicy = SuffixSkippingPolicy::Skip);

template<typename CharacterType> constexpr bool skipOptionalSVGSpaces(StringParsingBuffer<CharacterType>& characters)
{
    skipWhile<isASCIIWhitespace>(characters);
    return characters.hasCharactersRemaining();
}

template<typename CharacterType> constexpr bool skipOptionalSVGSpacesOrDelimiter(StringParsingBuffer<CharacterType>& characters, char delimiter = ',')
{
    if (!characters.hasCharactersRemaining())
        return false;

    if (!isASCIIWhitespace(*characters) && *characters != delimiter)
        return false;

    // There are only spaces in the remaining characters.
    if (!skipOptionalSVGSpaces(characters))
        return false;

    if (*characters != delimiter)
        return true;

    // A delimiter is hit. Skip the following spaces also e.g. " , ".
    return skipOptionalSVGSpaces(++characters);
}

} // namespace WebCore
