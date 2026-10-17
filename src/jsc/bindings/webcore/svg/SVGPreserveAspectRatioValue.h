/*
 * Copyright (C) 2004, 2005, 2008 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2004, 2005, 2006, 2007 Rob Buis <buis@kde.org>
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
#include <wtf/TZoneMalloc.h>

namespace WebCore {

template<typename> class ExceptionOr;

class SVGPreserveAspectRatioValue {
    WTF_MAKE_TZONE_ALLOCATED(SVGPreserveAspectRatioValue);
public:
    enum SVGPreserveAspectRatioType : uint8_t {
        SVG_PRESERVEASPECTRATIO_UNKNOWN = 0,
        SVG_PRESERVEASPECTRATIO_NONE = 1,
        SVG_PRESERVEASPECTRATIO_XMINYMIN = 2,
        SVG_PRESERVEASPECTRATIO_XMIDYMIN = 3,
        SVG_PRESERVEASPECTRATIO_XMAXYMIN = 4,
        SVG_PRESERVEASPECTRATIO_XMINYMID = 5,
        SVG_PRESERVEASPECTRATIO_XMIDYMID = 6,
        SVG_PRESERVEASPECTRATIO_XMAXYMID = 7,
        SVG_PRESERVEASPECTRATIO_XMINYMAX = 8,
        SVG_PRESERVEASPECTRATIO_XMIDYMAX = 9,
        SVG_PRESERVEASPECTRATIO_XMAXYMAX = 10
    };

    enum SVGMeetOrSliceType : uint8_t {
        SVG_MEETORSLICE_UNKNOWN = 0,
        SVG_MEETORSLICE_MEET = 1,
        SVG_MEETORSLICE_SLICE = 2
    };

    SVGPreserveAspectRatioValue() = default;
    SVGPreserveAspectRatioValue(StringView);

    ExceptionOr<void> setAlign(unsigned short);
    unsigned short align() const { return m_align; }

    ExceptionOr<void> setMeetOrSlice(unsigned short);
    unsigned short meetOrSlice() const { return m_meetOrSlice; }

    bool parse(StringView);

    String valueAsString() const;

private:
    SVGPreserveAspectRatioType m_align { SVGPreserveAspectRatioValue::SVG_PRESERVEASPECTRATIO_XMIDYMID };
    SVGMeetOrSliceType m_meetOrSlice { SVGPreserveAspectRatioValue::SVG_MEETORSLICE_MEET };

    template<typename CharacterType> bool parseInternal(StringParsingBuffer<CharacterType>&, bool validate);
};

} // namespace WebCore
