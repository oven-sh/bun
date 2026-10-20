/*
 * Copyright (C) 2024 Apple Inc. All rights reserved.
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

#include "WritingMode.h"
#include <array>
#include <wtf/EnumSet.h>
#include <wtf/text/ASCIILiteral.h>

namespace WebCore {

/* Axes */

enum class LogicalBoxAxis : uint8_t {
    Inline,
    Block
};

enum class BoxAxis : uint8_t {
    Horizontal,
    Vertical,

    HighestEnumValue = Vertical
};

enum class AxisDirection : bool {
    Normal = 0,
    Reverse = 1,
};

constexpr BoxAxis mapAxisLogicalToPhysical(const WritingMode, const LogicalBoxAxis);
constexpr LogicalBoxAxis mapAxisPhysicalToLogical(const WritingMode, const BoxAxis);
constexpr LogicalBoxAxis oppositeAxis(LogicalBoxAxis axis) { return axis == LogicalBoxAxis::Inline ? LogicalBoxAxis::Block : LogicalBoxAxis::Inline; }
constexpr BoxAxis oppositeAxis(BoxAxis axis) { return axis == BoxAxis::Horizontal ? BoxAxis::Vertical : BoxAxis::Horizontal; }

/* Sides */

enum class LogicalBoxSide : uint8_t {
    // Flow-Relative sides.
    BlockStart,
    InlineEnd,
    BlockEnd,
    InlineStart,

    // Coordinate-relative sides (per WebKit-internal logic).
    LogicalLeft, // low-coord inline side
    LogicalRight, // high-coord inline side
    LogicalTop = BlockStart,
    LogicalBottom = BlockEnd,

    // Line-relative sides are currently unused.
    // Add LineOver/LineUnder/LineLeft/LineRight if needed.
};

enum class BoxSide : uint8_t {
    Top,
    Right,
    Bottom,
    Left,

    HighestEnumValue = Left
};

constexpr std::array<BoxSide, 4> allBoxSides = {
    BoxSide::Top,
    BoxSide::Right,
    BoxSide::Bottom,
    BoxSide::Left
};

inline ASCIILiteral nameForBoxSide(BoxSide side)
{
    switch (side) {
    case BoxSide::Top:
        return "Top"_s;
    case BoxSide::Right:
        return "Right"_s;
    case BoxSide::Bottom:
        return "Bottom"_s;
    case BoxSide::Left:
        return "Left"_s;
    }
    ASSERT_NOT_REACHED();
    return ""_s;
}

using BoxSideSet = EnumSet<BoxSide>;

constexpr BoxSide mapSideLogicalToPhysical(const WritingMode, const LogicalBoxSide);
constexpr LogicalBoxSide mapSidePhysicalToLogical(const WritingMode, const BoxSide);

/* Corners */

enum class LogicalBoxCorner : uint8_t {
    // Follows BlockInline naming convention.
    StartStart = 0,
    StartEnd = 1,
    EndStart = 2,
    EndEnd = 3,
};

enum class BoxCorner : uint8_t {
    TopLeft = 0,
    TopRight = 1,
    BottomLeft = 2,
    BottomRight = 3,
};

// Numeric values used below for bit-hacking; don't change without adjusting mapping methods.

constexpr BoxCorner mapCornerLogicalToPhysical(const WritingMode, const LogicalBoxCorner);
constexpr LogicalBoxCorner mapCornerPhysicalToLogical(const WritingMode, const BoxCorner);

/** Implementation Below **********************************************/

constexpr BoxAxis WritingMode::inlineAxis() const
{
    return isHorizontal() ? BoxAxis::Horizontal : BoxAxis::Vertical;
}

constexpr BoxAxis WritingMode::blockAxis() const
{
    return isHorizontal() ? BoxAxis::Vertical : BoxAxis::Horizontal;
}

constexpr LogicalBoxAxis WritingMode::horizontalAxis() const
{
    return isHorizontal() ? LogicalBoxAxis::Inline : LogicalBoxAxis::Block;
}

constexpr LogicalBoxAxis WritingMode::verticalAxis() const
{
    return isHorizontal() ? LogicalBoxAxis::Block : LogicalBoxAxis::Inline;
}

constexpr BoxAxis mapAxisLogicalToPhysical(const WritingMode writingMode, const LogicalBoxAxis logicalAxis)
{
    bool isBlock = logicalAxis == LogicalBoxAxis::Block;
    bool isVertical = isBlock != writingMode.isVertical();
    return isVertical ? BoxAxis::Vertical : BoxAxis::Horizontal;
}

constexpr LogicalBoxAxis mapAxisPhysicalToLogical(const WritingMode writingMode, const BoxAxis axis)
{
    bool isVertical = axis == BoxAxis::Vertical;
    bool isBlock = isVertical != writingMode.isVertical();
    return isBlock ? LogicalBoxAxis::Block : LogicalBoxAxis::Inline;
}

constexpr BoxSide mapSideLogicalToPhysical(const WritingMode writingMode, const LogicalBoxSide logicalSide)
{
    switch (logicalSide) {
    case LogicalBoxSide::BlockStart:
        switch (writingMode.blockDirection()) {
        case FlowDirection::TopToBottom:
            return BoxSide::Top;
        case FlowDirection::RightToLeft:
            return BoxSide::Right;
        case FlowDirection::BottomToTop:
            return BoxSide::Bottom;
        case FlowDirection::LeftToRight:
            return BoxSide::Left;
        }
        ASSERT_NOT_REACHED();
        return BoxSide::Top;

    case LogicalBoxSide::BlockEnd:
        switch (writingMode.blockDirection()) {
        case FlowDirection::TopToBottom:
            return BoxSide::Bottom;
        case FlowDirection::RightToLeft:
            return BoxSide::Left;
        case FlowDirection::BottomToTop:
            return BoxSide::Top;
        case FlowDirection::LeftToRight:
            return BoxSide::Right;
        }
        ASSERT_NOT_REACHED();
        return BoxSide::Top;

    case LogicalBoxSide::InlineStart:
        if (writingMode.isHorizontal())
            return writingMode.isInlineLeftToRight() ? BoxSide::Left : BoxSide::Right;
        return writingMode.isInlineTopToBottom() ? BoxSide::Top : BoxSide::Bottom;

    case LogicalBoxSide::InlineEnd:
        if (writingMode.isHorizontal())
            return writingMode.isInlineLeftToRight() ? BoxSide::Right : BoxSide::Left;
        return writingMode.isInlineTopToBottom() ? BoxSide::Bottom : BoxSide::Top;

    case LogicalBoxSide::LogicalLeft:
        if (writingMode.isHorizontal())
            return BoxSide::Left;
        return BoxSide::Top;

    case LogicalBoxSide::LogicalRight:
        if (writingMode.isHorizontal())
            return BoxSide::Right;
        return BoxSide::Bottom;
    }
    ASSERT_NOT_REACHED();
    return BoxSide::Top;
}

constexpr LogicalBoxSide mapSidePhysicalToLogical(const WritingMode writingMode, const BoxSide side)
{
    switch (side) {
    case BoxSide::Top:
        switch (writingMode.blockDirection()) {
        case FlowDirection::TopToBottom:
            return LogicalBoxSide::BlockStart;
        case FlowDirection::RightToLeft:
        case FlowDirection::LeftToRight:
            return writingMode.isInlineTopToBottom()
                ? LogicalBoxSide::InlineStart
                : LogicalBoxSide::InlineEnd;
        case FlowDirection::BottomToTop:
            return LogicalBoxSide::BlockEnd;
        }
        ASSERT_NOT_REACHED();
        return LogicalBoxSide::BlockStart;

    case BoxSide::Left:
        switch (writingMode.blockDirection()) {
        case FlowDirection::TopToBottom:
        case FlowDirection::BottomToTop:
            return writingMode.isInlineLeftToRight()
                ? LogicalBoxSide::InlineStart
                : LogicalBoxSide::InlineEnd;
        case FlowDirection::LeftToRight:
            return LogicalBoxSide::BlockStart;
        case FlowDirection::RightToLeft:
            return LogicalBoxSide::BlockEnd;
        }
        ASSERT_NOT_REACHED();
        return LogicalBoxSide::InlineStart;

    case BoxSide::Bottom:
        switch (writingMode.blockDirection()) {
        case FlowDirection::TopToBottom:
            return LogicalBoxSide::BlockEnd;
        case FlowDirection::RightToLeft:
        case FlowDirection::LeftToRight:
            return writingMode.isInlineTopToBottom()
                ? LogicalBoxSide::InlineEnd
                : LogicalBoxSide::InlineStart;
        case FlowDirection::BottomToTop:
            return LogicalBoxSide::BlockStart;
        }
        ASSERT_NOT_REACHED();
        return LogicalBoxSide::BlockEnd;

    case BoxSide::Right:
        switch (writingMode.blockDirection()) {
        case FlowDirection::TopToBottom:
        case FlowDirection::BottomToTop:
            return writingMode.isInlineLeftToRight()
                ? LogicalBoxSide::InlineEnd
                : LogicalBoxSide::InlineStart;
        case FlowDirection::LeftToRight:
            return LogicalBoxSide::BlockEnd;
        case FlowDirection::RightToLeft:
            return LogicalBoxSide::BlockStart;
        }
        ASSERT_NOT_REACHED();
        return LogicalBoxSide::InlineEnd;
    }
    ASSERT_NOT_REACHED();
    return LogicalBoxSide::BlockStart;
}

constexpr BoxCorner mapCornerLogicalToPhysical(const WritingMode writingMode, const LogicalBoxCorner logicalBoxCorner)
{
    bool isBlockStart = !(static_cast<uint8_t>(logicalBoxCorner) & 2);
    bool isInlineStart = !(static_cast<uint8_t>(logicalBoxCorner) & 1);

    bool isTop, isLeft;
    if (writingMode.isHorizontal()) {
        isTop = isBlockStart != writingMode.isBlockFlipped();
        isLeft = isInlineStart == writingMode.isInlineLeftToRight();
    } else {
        isTop = isInlineStart == writingMode.isInlineTopToBottom();
        isLeft = isBlockStart != writingMode.isBlockFlipped();
    }

    if (isTop)
        return isLeft ? BoxCorner::TopLeft : BoxCorner::TopRight;
    return isLeft ? BoxCorner::BottomLeft : BoxCorner::BottomRight;
}

constexpr LogicalBoxCorner mapCornerPhysicalToLogical(const WritingMode writingMode, const BoxCorner boxCorner)
{
    bool isTop = !(static_cast<uint8_t>(boxCorner) & 2);
    bool isLeft = !(static_cast<uint8_t>(boxCorner) & 1);

    bool isBlockStart, isInlineStart;
    if (writingMode.isHorizontal()) {
        isBlockStart = isTop != writingMode.isBlockFlipped();
        isInlineStart = isLeft == writingMode.isInlineLeftToRight();
    } else {
        isBlockStart = isLeft != writingMode.isBlockFlipped();
        isInlineStart = isTop == writingMode.isInlineTopToBottom();
    }

    if (isBlockStart)
        return isInlineStart ? LogicalBoxCorner::StartStart : LogicalBoxCorner::StartEnd;
    return isInlineStart ? LogicalBoxCorner::EndStart : LogicalBoxCorner::EndEnd;
}

constexpr BoxAxis boxAxisForSide(BoxSide side)
{
    switch (side) {
    case BoxSide::Top:
    case BoxSide::Bottom:
        return BoxAxis::Vertical;
    case BoxSide::Left:
    case BoxSide::Right:
        return BoxAxis::Horizontal;
    }
    ASSERT_NOT_REACHED();
    return BoxAxis::Vertical;
}

} // namespace WebCore
