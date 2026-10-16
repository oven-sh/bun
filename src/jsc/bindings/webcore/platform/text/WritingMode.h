/*
 * Copyright (c) 2012 Google Inc. All rights reserved.
 * Copyright (C) 2015-2024 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <wtf/text/TextStream.h>

namespace WebCore {

/**
 * WritingMode efficiently stores a writing mode and can rapidly compute
 * interesting things about it for use in layout. It fits in 1 byte,
 * and can be cheaply copied or passed around by value.
 *
 * Writing modes are computed from the CSS 'writing-mode', 'direction', and
 * 'text-orientation' properties. See CSS Writing Modes for more information.
 *   http://www.w3.org/TR/css-writing-modes/
 *
 * Be careful with the distinctions among these:
 *   - isBidiLTR/RTL (for typesetting, i.e. within a line box)
 *   - isInlineLeftToRight/TopToBottom (absolute physical directions)
 *   - isLogicalLeftInlineStart (flow-relative cmp coordinate-relative)
 *   - isLogicalLeftLineLeft (line-relative cmp coordinate-relative)
 *   - computedTextDirection (style computation / element directionality)
 */

enum class StyleWritingMode : uint8_t;
enum class TextDirection : bool;
enum class TextOrientation : uint8_t;
enum class FlowDirection : uint8_t;
enum class BoxAxis : uint8_t;
enum class LogicalBoxAxis : uint8_t;
class FlowMode;

class WritingMode final {
public:
    constexpr WritingMode(StyleWritingMode, TextDirection, TextOrientation);

    // Writing axis.
    constexpr bool isHorizontal() const;
    constexpr bool isVertical() const;

    // (Mis)Matching.
    constexpr bool isOrthogonal(WritingMode) const;
    constexpr bool isBlockOpposing(WritingMode) const;
    constexpr bool isInlineOpposing(WritingMode) const;
    constexpr bool isBlockMatchingAny(WritingMode) const;
    constexpr bool isInlineMatchingAny(WritingMode) const;

    // Text directionality. (FOR TYPESETTING ONLY)
    constexpr bool isBidiRTL() const; // line-right to line-left
    constexpr bool isBidiLTR() const; // line-left to line-right

    // Physical flow directions.
    constexpr bool isBlockTopToBottom() const;
    constexpr bool isBlockLeftToRight() const;
    constexpr bool isInlineTopToBottom() const;
    constexpr bool isInlineLeftToRight() const;
    // Block OR inline flow is top-to-bottom.
    constexpr bool isAnyTopToBottom() const;
    // Block OR inline flow is left-to-right.
    constexpr bool isAnyLeftToRight() const;

    // Typesetting modes.
    constexpr bool isVerticalTypographic() const;
    constexpr bool prefersCentralBaseline() const;
    constexpr bool isMixedOrientation() const;
    constexpr bool isUprightOrientation() const;
    constexpr bool isSidewaysOrientation() const;

    // Line orientation.
    constexpr bool isLineInverted() const;  // line-over != block-start
    constexpr bool isLineOverRight() const; // line-over == right
    constexpr bool isLineOverLeft() const;  // line-over == left

    // Coordinate flow queries.
    constexpr bool isLogicalLeftLineLeft() const; // Not true for sideways-lr.
    constexpr bool isLogicalLeftInlineStart() const; // == !isInlineFlipped()
    constexpr bool isInlineFlipped() const; // Inline direction is RTL or BTT.
    constexpr bool isBlockFlipped() const;  // Block direction is RL or BT.

    // Directions as enums. Prefer booleans if doing boolean checks.
    constexpr FlowDirection blockDirection() const;
    constexpr TextDirection bidiDirection() const;
    constexpr FlowDirection inlineDirection() const;

    // Axes as enums. Prefer booleans if doing boolean checks.
    constexpr BoxAxis blockAxis() const;
    constexpr BoxAxis inlineAxis() const;
    constexpr LogicalBoxAxis horizontalAxis() const;
    constexpr LogicalBoxAxis verticalAxis() const;

    // FIXME: Callers need to be audited to determine which of the "is it LTR?" WritingMode methods is the right one for that instance.
    constexpr bool deprecatedIsLeftToRightDirection() const { return isBidiLTR(); }

    // Computed values. May differ from used values above.
    constexpr StyleWritingMode computedWritingMode() const;
    constexpr TextDirection computedTextDirection() const;
    constexpr TextOrientation computedTextOrientation() const;
    // ^ USE THESE FOR STYLE COMPUTATION ^ //

    // Setters.
    inline void setWritingMode(StyleWritingMode);
    inline void setTextOrientation(TextOrientation);
    inline void setTextDirection(TextDirection);

    // To aid in packing.
    using Data = uint8_t;
    Data toData() const { return m_bits; }
    constexpr WritingMode(Data bits = 0) { m_bits = bits; }

    friend bool operator==(WritingMode, WritingMode) = default;

private:
    Data m_bits { 0 };
    friend FlowMode;

public: // Private except StyleWritingMode, FlowDirection, and FlowMode are friends
    enum Bits : Data {
        kIsVerticalText  = 1 << 0, // Vertical writing modes.
        kIsFlippedBlock  = 1 << 1, // RL or BT block flow directions.
        kIsVerticalType  = 1 << 2, // Vertical typographic mode.
        kIsBidiRTL       = 1 << 3, // Bidi directionality.
        kIsUprightType   = 1 << 4, // Upright text orientation.
        kIsSidewaysType  = 1 << 5, // Sideways text orientation.

        kBlockFlowMask   = kIsVerticalText | kIsFlippedBlock,
        kWritingModeMask = kBlockFlowMask  | kIsVerticalType,
        kOrientationMask = kIsSidewaysType | kIsUprightType, // Both is an error.
        kOrientationShift = 4,

        kIsMainBlock     = 1 << 5, // Alternate use in FlowMode.
        kIsMainReverse   = 1 << 6, // Reserved for FlowMode.
        kIsCrossReverse  = 1 << 7, // Reserved for FlowMode.
        kFlowModeMask    = kIsMainBlock | kIsMainReverse | kIsCrossReverse,
    };
};

enum class StyleWritingMode : uint8_t {
    HorizontalTb = 0,
    HorizontalBt = WritingMode::kIsFlippedBlock, // Non-standard.
    VerticalLr   = WritingMode::kIsVerticalText | WritingMode::kIsVerticalType,
    VerticalRl   = WritingMode::kIsVerticalText | WritingMode::kIsVerticalType | WritingMode::kIsFlippedBlock,
    SidewaysLr   = WritingMode::kIsVerticalText,
    SidewaysRl   = WritingMode::kIsVerticalText | WritingMode::kIsFlippedBlock,
};

enum class TextDirection : bool {
    LTR = 0,
    RTL = 1
};

enum class TextOrientation : uint8_t {
    Mixed = 0,
    Upright = 1,
    Sideways = 2,
};

enum class FlowDirection : uint8_t {
    TopToBottom = 0,
    BottomToTop = WritingMode::kIsFlippedBlock,
    LeftToRight = WritingMode::kIsVerticalText,
    RightToLeft = WritingMode::kIsVerticalText | WritingMode::kIsFlippedBlock,
};

/** Implementation Below **********************************************/

constexpr WritingMode::WritingMode(StyleWritingMode writingMode, TextDirection bidiDirection, TextOrientation verticalOrientation)
    : m_bits(static_cast<Data>(writingMode)
        | (bidiDirection == TextDirection::RTL ? kIsBidiRTL : 0)
        | (static_cast<Data>(verticalOrientation) << kOrientationShift))
{
}

/* Writing axis and direction */

constexpr bool WritingMode::isHorizontal() const
{
    return !(m_bits & kIsVerticalText);
}

constexpr bool WritingMode::isVertical() const
{
    return m_bits & kIsVerticalText;
}

/* Text directionality */

constexpr bool WritingMode::isBidiRTL() const
{
    // FIXME: https://bugs.webkit.org/show_bug.cgi?id=164507
    return m_bits & kIsBidiRTL;
}

constexpr bool WritingMode::isBidiLTR() const
{
    return !isBidiRTL();
}

constexpr TextDirection WritingMode::bidiDirection() const
{
    return computedTextDirection();
}

/* Absolute flow directions */

constexpr bool WritingMode::isBlockTopToBottom() const
{
    return !(m_bits & kBlockFlowMask);
}

constexpr bool WritingMode::isBlockLeftToRight() const
{
    return (m_bits & (kIsVerticalText | kIsFlippedBlock)) == kIsVerticalText;
}

constexpr bool WritingMode::isInlineTopToBottom() const
{
    // Using bitwise operators to avoid conditionals due to short-circuiting...
    return static_cast<unsigned>(isVertical())
        & (static_cast<unsigned>(isBidiRTL())
        ^ (static_cast<unsigned>(isVerticalTypographic()) | static_cast<unsigned>(isBlockFlipped())));
}

constexpr bool WritingMode::isInlineLeftToRight() const
{
    return !(m_bits & (kIsVerticalText | kIsBidiRTL));
}

constexpr bool WritingMode::isAnyTopToBottom() const
{
    return isBlockTopToBottom() || isInlineTopToBottom();
}

constexpr bool WritingMode::isAnyLeftToRight() const
{
    return isInlineLeftToRight() || isBlockLeftToRight();
}

constexpr FlowDirection WritingMode::blockDirection() const
{
    return static_cast<FlowDirection>(m_bits & kBlockFlowMask);
}

constexpr FlowDirection WritingMode::inlineDirection() const
{
    if (isHorizontal())
        return isInlineLeftToRight() ? FlowDirection::LeftToRight : FlowDirection::RightToLeft;
    return isInlineTopToBottom() ? FlowDirection::TopToBottom : FlowDirection::BottomToTop;
}

/* Typesetting modes */

constexpr bool WritingMode::isVerticalTypographic() const
{
    return m_bits & kIsVerticalType;
}

constexpr bool WritingMode::prefersCentralBaseline() const
{
    return isVerticalTypographic() && !isSidewaysOrientation();
}

constexpr bool WritingMode::isMixedOrientation() const
{
    return !(m_bits & kOrientationMask);
}

constexpr bool WritingMode::isUprightOrientation() const
{
    return m_bits & kIsUprightType;
}

constexpr bool WritingMode::isSidewaysOrientation() const
{
    return m_bits & kIsSidewaysType;
}

/* Line orientation */

constexpr bool WritingMode::isLineInverted() const
{
    auto bits = m_bits & kWritingModeMask;
    bool isHorizontalBt = kIsFlippedBlock == bits;
    bool isVerticalLr = (kIsVerticalText | kIsVerticalType) == bits;
    return isHorizontalBt | isVerticalLr;
}

constexpr bool WritingMode::isLineOverRight() const
{
    return isVerticalTypographic()
        || (m_bits & kWritingModeMask) == (kIsVerticalText | kIsFlippedBlock); // sideways-rl
}

constexpr bool WritingMode::isLineOverLeft() const
{
    return (m_bits & kWritingModeMask) == kIsVerticalText; // sideways-lr
}

constexpr bool WritingMode::isLogicalLeftLineLeft() const
{
    return computedWritingMode() != StyleWritingMode::SidewaysLr;
}

constexpr bool WritingMode::isLogicalLeftInlineStart() const
{
    return !isInlineFlipped();
}

/* Coordinate flow directions */
constexpr bool WritingMode::isBlockFlipped() const
{
    return m_bits & kIsFlippedBlock;
}

constexpr bool WritingMode::isInlineFlipped() const
{
    if (isHorizontal())
        return isBidiRTL();
    return !isInlineTopToBottom();
}

/* (Mis)Matching */

constexpr bool WritingMode::isOrthogonal(WritingMode writingMode) const
{
    return isVertical() != (writingMode.isVertical());
}

constexpr bool WritingMode::isBlockOpposing(WritingMode writingMode) const
{
    Data self = (m_bits & (kIsVerticalText | kIsFlippedBlock));
    Data other = (writingMode.m_bits & (kIsVerticalText | kIsFlippedBlock));
    return (self ^ other) == kIsFlippedBlock;
}

constexpr bool WritingMode::isInlineOpposing(WritingMode writingMode) const
{
    return isHorizontal()
        ? isBidiRTL() != writingMode.isBidiRTL()
        : isInlineTopToBottom() != writingMode.isInlineTopToBottom();
}

constexpr bool WritingMode::isBlockMatchingAny(WritingMode writingMode) const
{
    return isHorizontal()
        ? isBlockTopToBottom() == writingMode.isAnyTopToBottom()
        : isBlockLeftToRight() == writingMode.isAnyLeftToRight();
}

constexpr bool WritingMode::isInlineMatchingAny(WritingMode writingMode) const
{
    return isHorizontal()
        ? isBidiLTR() == writingMode.isAnyLeftToRight()
        : isInlineTopToBottom() == writingMode.isAnyTopToBottom();
}

/* Computed values */

constexpr StyleWritingMode WritingMode::computedWritingMode() const
{
    return static_cast<StyleWritingMode>(m_bits & kWritingModeMask);
}

constexpr TextDirection WritingMode::computedTextDirection() const
{
    return static_cast<TextDirection>(isBidiRTL());
}

constexpr TextOrientation WritingMode::computedTextOrientation() const
{
    Data data = (m_bits & kOrientationMask) >> kOrientationShift;
    return static_cast<TextOrientation>(data);
}

/* Setters */

inline void WritingMode::setWritingMode(StyleWritingMode writingMode)
{
    m_bits &= ~kWritingModeMask;
    m_bits |= static_cast<Data>(writingMode);
}

inline void WritingMode::setTextDirection(TextDirection bidiDirection)
{
    if (bidiDirection == TextDirection::RTL)
        m_bits |= kIsBidiRTL;
    else
        m_bits &= ~kIsBidiRTL;
}

inline void WritingMode::setTextOrientation(TextOrientation verticalOrientation)
{
    m_bits &= ~kOrientationMask;
    m_bits |= static_cast<Data>(verticalOrientation) << kOrientationShift;
}

/** Logging ***********************************************************/

inline TextStream& operator<<(TextStream& stream, StyleWritingMode writingMode)
{
    switch (writingMode) {
    case StyleWritingMode::HorizontalTb:
        stream << "horizontal-tb";
        break;
    case StyleWritingMode::HorizontalBt:
        stream << "horizontal-bt";
        break;
    case StyleWritingMode::VerticalLr:
        stream << "vertical-lr";
        break;
    case StyleWritingMode::VerticalRl:
        stream << "vertical-rl";
        break;
    case StyleWritingMode::SidewaysLr:
        stream << "sideways-lr";
        break;
    case StyleWritingMode::SidewaysRl:
        stream << "sideways-rl";
        break;
    }
    return stream;
}

inline TextStream& operator<<(TextStream& ts, TextDirection textDirection)
{
    switch (textDirection) {
    case TextDirection::LTR: ts << "ltr"_s; break;
    case TextDirection::RTL: ts << "rtl"_s; break;
    }
    return ts;
}

inline TextStream& operator<<(TextStream& stream, TextOrientation orientation)
{
    switch (orientation) {
    case TextOrientation::Mixed:
        stream << "mixed";
        break;
    case TextOrientation::Upright:
        stream << "upright";
        break;
    case TextOrientation::Sideways:
        stream << "sideways";
        break;
    }
    return stream;
}

inline TextStream& operator<<(TextStream& stream, FlowDirection direction)
{
    switch (direction) {
    case FlowDirection::TopToBottom:
        stream << "top-to-bottom";
        break;
    case FlowDirection::BottomToTop:
        stream << "bottom-to-top";
        break;
    case FlowDirection::LeftToRight:
        stream << "left-to-right";
        break;
    case FlowDirection::RightToLeft:
        stream << "right-to-left";
        break;
    }
    return stream;
}

inline TextStream& operator<<(TextStream& stream, WritingMode writingMode)
{
    stream << "(" << writingMode.computedWritingMode()
        << ", " << writingMode.computedTextDirection()
        << ", " << writingMode.computedTextOrientation() << ")";
    return stream;
}

} // namespace WebCore
