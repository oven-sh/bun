/*
 * Copyright (C) 2004, 2005, 2008 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2004, 2005, 2006, 2007 Rob Buis <buis@kde.org>
 * Copyright (C) 2010 Dirk Schulze <krit@webkit.org>
 * Copyright (C) 2022-2023 Apple Inc. All rights reserved.
 * Copyright (C) 2015 Google Inc. All rights reserved.
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
#include "SVGPreserveAspectRatioValue.h"

#include "ExceptionOr.h"
#include "SVGParserUtilities.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringParsingBuffer.h>
#include <wtf/text/StringView.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SVGPreserveAspectRatioValue);

SVGPreserveAspectRatioValue::SVGPreserveAspectRatioValue(StringView value)
{
    parse(value);
}

ExceptionOr<void> SVGPreserveAspectRatioValue::setAlign(unsigned short align)
{
    if (align == SVG_PRESERVEASPECTRATIO_UNKNOWN || align > SVG_PRESERVEASPECTRATIO_XMAXYMAX)
        return Exception { ExceptionCode::NotSupportedError };

    m_align = static_cast<SVGPreserveAspectRatioType>(align);
    return { };
}

ExceptionOr<void> SVGPreserveAspectRatioValue::setMeetOrSlice(unsigned short meetOrSlice)
{
    if (meetOrSlice == SVG_MEETORSLICE_UNKNOWN || meetOrSlice > SVG_MEETORSLICE_SLICE)
        return Exception { ExceptionCode::NotSupportedError };

    m_meetOrSlice = static_cast<SVGMeetOrSliceType>(meetOrSlice);
    return { };
}

bool SVGPreserveAspectRatioValue::parse(StringView value)
{
    return readCharactersForParsing(value, [&](auto buffer) {
        return parseInternal(buffer, true);
    });
}

template<typename CharacterType> static constexpr std::array<CharacterType, 4> noneDesc  { 'n', 'o', 'n', 'e' };
template<typename CharacterType> static constexpr std::array<CharacterType, 4> meetDesc  { 'm', 'e', 'e', 't' };
template<typename CharacterType> static constexpr std::array<CharacterType, 5> sliceDesc  { 's', 'l', 'i', 'c', 'e' };

template<typename CharacterType> bool SVGPreserveAspectRatioValue::parseInternal(StringParsingBuffer<CharacterType>& buffer, bool validate)
{
    SVGPreserveAspectRatioType align = SVG_PRESERVEASPECTRATIO_XMIDYMID;
    SVGMeetOrSliceType meetOrSlice = SVG_MEETORSLICE_MEET;

    m_align = align;
    m_meetOrSlice = meetOrSlice;

    if (!skipOptionalSVGSpaces(buffer))
        return false;

    if (*buffer == 'n') {
        if (!skipCharactersExactly(buffer, std::span { noneDesc<CharacterType> })) {
            LOG_ERROR("Skipped to parse except for *none* value.");
            return false;
        }
        align = SVG_PRESERVEASPECTRATIO_NONE;
        skipOptionalSVGSpaces(buffer);
    } else if (*buffer == 'x') {
        if (buffer.lengthRemaining() < 8)
            return false;
        if (buffer[1] != 'M' || buffer[4] != 'Y' || buffer[5] != 'M')
            return false;
        if (buffer[2] == 'i') {
            if (buffer[3] == 'n') {
                if (buffer[6] == 'i') {
                    if (buffer[7] == 'n')
                        align = SVG_PRESERVEASPECTRATIO_XMINYMIN;
                    else if (buffer[7] == 'd')
                        align = SVG_PRESERVEASPECTRATIO_XMINYMID;
                    else
                        return false;
                } else if (buffer[6] == 'a' && buffer[7] == 'x')
                    align = SVG_PRESERVEASPECTRATIO_XMINYMAX;
                else
                    return false;
            } else if (buffer[3] == 'd') {
                if (buffer[6] == 'i') {
                    if (buffer[7] == 'n')
                        align = SVG_PRESERVEASPECTRATIO_XMIDYMIN;
                    else if (buffer[7] == 'd')
                        align = SVG_PRESERVEASPECTRATIO_XMIDYMID;
                    else
                        return false;
                } else if (buffer[6] == 'a' && buffer[7] == 'x')
                    align = SVG_PRESERVEASPECTRATIO_XMIDYMAX;
                else
                    return false;
            } else
                return false;
        } else if (buffer[2] == 'a' && buffer[3] == 'x') {
            if (buffer[6] == 'i') {
                if (buffer[7] == 'n')
                    align = SVG_PRESERVEASPECTRATIO_XMAXYMIN;
                else if (buffer[7] == 'd')
                    align = SVG_PRESERVEASPECTRATIO_XMAXYMID;
                else
                    return false;
            } else if (buffer[6] == 'a' && buffer[7] == 'x')
                align = SVG_PRESERVEASPECTRATIO_XMAXYMAX;
            else
                return false;
        } else
            return false;
        buffer += 8;
        skipOptionalSVGSpaces(buffer);
    } else
        return false;

    if (buffer.hasCharactersRemaining()) {
        if (*buffer == 'm') {
            if (!skipCharactersExactly(buffer, std::span { meetDesc<CharacterType> })) {
                LOG_ERROR("Skipped to parse except for *meet* or *slice* value.");
                return false;
            }
            skipOptionalSVGSpaces(buffer);
        } else if (*buffer == 's') {
            if (!skipCharactersExactly(buffer, std::span { sliceDesc<CharacterType> })) {
                LOG_ERROR("Skipped to parse except for *meet* or *slice* value.");
                return false;
            }
            skipOptionalSVGSpaces(buffer);
            if (align != SVG_PRESERVEASPECTRATIO_NONE)
                meetOrSlice = SVG_MEETORSLICE_SLICE;
        }
    }

    if (!buffer.atEnd() && validate)
        return false;

    m_align = align;
    m_meetOrSlice = meetOrSlice;

    return true;
}

String SVGPreserveAspectRatioValue::valueAsString() const
{
    auto alignType = [&]() {
        switch (m_align) {
        case SVG_PRESERVEASPECTRATIO_NONE:
            return "none"_s;
        case SVG_PRESERVEASPECTRATIO_XMINYMIN:
            return "xMinYMin"_s;
        case SVG_PRESERVEASPECTRATIO_XMIDYMIN:
            return "xMidYMin"_s;
        case SVG_PRESERVEASPECTRATIO_XMAXYMIN:
            return "xMaxYMin"_s;
        case SVG_PRESERVEASPECTRATIO_XMINYMID:
            return "xMinYMid"_s;
        case SVG_PRESERVEASPECTRATIO_XMIDYMID:
            return "xMidYMid"_s;
        case SVG_PRESERVEASPECTRATIO_XMAXYMID:
            return "xMaxYMid"_s;
        case SVG_PRESERVEASPECTRATIO_XMINYMAX:
            return "xMinYMax"_s;
        case SVG_PRESERVEASPECTRATIO_XMIDYMAX:
            return "xMidYMax"_s;
        case SVG_PRESERVEASPECTRATIO_XMAXYMAX:
            return "xMaxYMax"_s;
        case SVG_PRESERVEASPECTRATIO_UNKNOWN:
            return "unknown"_s;
        };

        ASSERT_NOT_REACHED();
        return "unknown"_s;
    };

    switch (m_meetOrSlice) {
    default:
    case SVG_MEETORSLICE_UNKNOWN:
        return alignType();
    case SVG_MEETORSLICE_MEET:
        return makeString(alignType(), " meet"_s);
    case SVG_MEETORSLICE_SLICE:
        return makeString(alignType(), " slice"_s);
    }
}

}
