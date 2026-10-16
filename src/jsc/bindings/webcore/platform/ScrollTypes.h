/*
 * Copyright (C) 2006 Apple Inc. All rights reserved.
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
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "Color.h"
#include "FloatPoint.h"
#include "FloatSize.h"
#include "ProcessQualified.h"
#include "RectEdges.h"
#include "ScrollbarMode.h"
#include "ScrollingNodeID.h"

namespace WTF {
class TextStream;
}

namespace WebCore {

class IntPoint;

enum class ScrollBehavior : uint8_t;

// scrollPosition is in content coordinates (0,0 is at scrollOrigin), so may have negative components.
using ScrollPosition = IntPoint;
// scrollOffset() is the value used by scrollbars (min is 0,0), and should never have negative components.
using ScrollOffset = IntPoint;

enum class ScrollType : bool {
    User,
    Programmatic
};

enum class OverscrollBehavior : uint8_t {
    Auto,
    Contain,
    None
};

enum class ScrollDirection : uint8_t {
    ScrollUp,
    ScrollDown,
    ScrollLeft,
    ScrollRight
};

enum ScrollLogicalDirection : uint8_t {
    ScrollBlockDirectionBackward,
    ScrollBlockDirectionForward,
    ScrollInlineDirectionBackward,
    ScrollInlineDirectionForward
};

enum class ScrollAnimationStatus : uint8_t {
    NotAnimating,
    Animating,
};

enum class ScrollIsAnimated : bool { No, Yes };
enum class InterruptScrollAnimation : bool { No, Yes };

enum class OverflowAnchor : bool {
    Auto,
    None
};

enum class ScrollAxisLock : uint8_t {
    Auto,
    None
};

inline ScrollDirection logicalToPhysical(ScrollLogicalDirection direction, bool isVertical, bool isFlipped)
{
    switch (direction) {
    case ScrollBlockDirectionBackward: {
        if (isVertical) {
            if (!isFlipped)
                return ScrollDirection::ScrollUp;
            return ScrollDirection::ScrollDown;
        } else {
            if (!isFlipped)
                return ScrollDirection::ScrollLeft;
            return ScrollDirection::ScrollRight;
        }
        break;
    }
    case ScrollBlockDirectionForward: {
        if (isVertical) {
            if (!isFlipped)
                return ScrollDirection::ScrollDown;
            return ScrollDirection::ScrollUp;
        } else {
            if (!isFlipped)
                return ScrollDirection::ScrollRight;
            return ScrollDirection::ScrollLeft;
        }
        break;
    }
    case ScrollInlineDirectionBackward: {
        if (isVertical) {
            if (!isFlipped)
                return ScrollDirection::ScrollLeft;
            return ScrollDirection::ScrollRight;
        } else {
            if (!isFlipped)
                return ScrollDirection::ScrollUp;
            return ScrollDirection::ScrollDown;
        }
        break;
    }
    case ScrollInlineDirectionForward: {
        if (isVertical) {
            if (!isFlipped)
                return ScrollDirection::ScrollRight;
            return ScrollDirection::ScrollLeft;
        } else {
            if (!isFlipped)
                return ScrollDirection::ScrollDown;
            return ScrollDirection::ScrollUp;
        }
        break;
    }
    }
    return ScrollDirection::ScrollUp;
}

enum class ScrollGranularity : uint8_t {
    Line,
    Page,
    Document,
    Pixel
};

enum class ScrollElasticity : uint8_t {
    Automatic,
    None,
    Allowed
};

// Determines if rubber-banding should be enabled if the content size is less than the scroll view size.
enum class RubberBandingBehavior : uint8_t {
    Always,
    Never,
    BasedOnSize
};

enum class ScrollbarOrientation : uint8_t {
    Horizontal,
    Vertical
};

enum class ScrollbarExpansionState : uint8_t {
    Regular,
    Expanded
};

enum class ScrollbarWidth : uint8_t {
    Auto,
    Thin,
    None
};

enum class NativeScrollbarVisibility : uint8_t {
    Visible,
    HiddenByStyle,
    ReplacedByCustomScrollbar
};

enum class ScrollEventAxis : uint8_t {
    Horizontal,
    Vertical
};

enum class ScrollEventType : bool {
    Scroll,
    Scrollend
};

inline constexpr ScrollEventAxis axisFromDirection(ScrollDirection direction)
{
    switch (direction) {
    case ScrollDirection::ScrollUp: return ScrollEventAxis::Vertical;
    case ScrollDirection::ScrollDown: return ScrollEventAxis::Vertical;
    case ScrollDirection::ScrollLeft: return ScrollEventAxis::Horizontal;
    case ScrollDirection::ScrollRight: return ScrollEventAxis::Horizontal;
    }
    ASSERT_NOT_REACHED();
    return ScrollEventAxis::Vertical;
}

inline float valueForAxis(FloatSize size, ScrollEventAxis axis)
{
    switch (axis) {
    case ScrollEventAxis::Horizontal: return size.width();
    case ScrollEventAxis::Vertical: return size.height();
    }
    ASSERT_NOT_REACHED();
    return 0;
}

inline FloatSize setValueForAxis(FloatSize size, ScrollEventAxis axis, float value)
{
    switch (axis) {
    case ScrollEventAxis::Horizontal:
        size.setWidth(value);
        return size;
    case ScrollEventAxis::Vertical:
        size.setHeight(value);
        return size;
    }
    ASSERT_NOT_REACHED();
    return size;
}

inline float valueForAxis(FloatPoint point, ScrollEventAxis axis)
{
    switch (axis) {
    case ScrollEventAxis::Horizontal: return point.x();
    case ScrollEventAxis::Vertical: return point.y();
    }
    ASSERT_NOT_REACHED();
    return 0;
}

inline FloatPoint setValueForAxis(FloatPoint point, ScrollEventAxis axis, float value)
{
    switch (axis) {
    case ScrollEventAxis::Horizontal:
        point.setX(value);
        return point;
    case ScrollEventAxis::Vertical:
        point.setY(value);
        return point;
    }
    ASSERT_NOT_REACHED();
    return point;
}

inline BoxSide boxSideForDirection(ScrollDirection direction)
{
    switch (direction) {
    case ScrollDirection::ScrollUp:
        return BoxSide::Top;
    case ScrollDirection::ScrollDown:
        return BoxSide::Bottom;
    case ScrollDirection::ScrollLeft:
        return BoxSide::Left;
    case ScrollDirection::ScrollRight:
        return BoxSide::Right;
    }
    ASSERT_NOT_REACHED();
    return BoxSide::Top;
}

enum class OverlayScrollbarSizeRelevancy : bool {
    IgnoreOverlayScrollbarSize,
    IncludeOverlayScrollbarSize
};

enum ScrollbarControlStateMask {
    ActiveScrollbarState = 1,
    EnabledScrollbarState = 1 << 1,
    PressedScrollbarState = 1 << 2
};

enum ScrollbarPart {
    NoPart = 0,
    BackButtonStartPart = 1,
    ForwardButtonStartPart = 1 << 1,
    BackTrackPart = 1 << 2,
    ThumbPart = 1 << 3,
    ForwardTrackPart = 1 << 4,
    BackButtonEndPart = 1 << 5,
    ForwardButtonEndPart = 1 << 6,
    ScrollbarBGPart = 1 << 7,
    TrackBGPart = 1 << 8,
    AllParts = 0xffffffff
};

enum ScrollbarButtonsPlacement : uint8_t {
    ScrollbarButtonsNone,
    ScrollbarButtonsSingle,
    ScrollbarButtonsDoubleStart,
    ScrollbarButtonsDoubleEnd,
    ScrollbarButtonsDoubleBoth
};

enum class ScrollbarStyle : uint8_t {
    AlwaysVisible,
    Overlay
};

enum class ScrollbarHitTestTolerance : uint8_t {
    None,
    Expanded
};

enum class ScrollbarOverlayStyle : uint8_t {
    Default,
    Dark,
    Light
};

enum class ScrollbarRevealBehavior : bool {
    DontReveal,
    Default,
};

enum class ScrollPinningBehavior : uint8_t {
    DoNotPin,
    PinToTop,
    PinToBottom
};

enum class ScrollClamping : bool {
    Unclamped,
    Clamped
};

enum class ScrollInterruptsAnimation : bool {
    No,
    Yes
};

enum class ScrollBehaviorForFixedElements : bool {
    StickToDocumentBounds,
    StickToViewportBounds
};

enum class ScrollbarButtonPressAction : uint8_t {
    None,
    CenterOnThumb,
    StartDrag,
    Scroll
};

enum class SelectionRevealMode : uint8_t  {
    Reveal,
    RevealUpToMainFrame, // Scroll overflow and iframes, but not the main frame.
    DelegateMainFrameScroll, // Similar to RevealUpToMainFrame, but make sure to manually call the main frame scroll.
    DoNotReveal
};

enum class ScrollPositioningBehavior : uint8_t {
    None,
    Moves,
    Stationary
};

// Directional: chooses snap points that are at or beyond the scroll destination in the direction of the scroll.
// Closest: chooses snap points that are closest in the direction of the scroll.
// Paging: chooses the farthest snap point that is within one page of the current position in the scroll direction, otherwise the nearest snap point beyond it.
enum class ScrollSnapPointSelectionMethod : uint8_t {
    Directional,
    Closest,
    Paging,
};

using ScrollbarControlState = unsigned;
using ScrollbarControlPartMask = unsigned;

struct ScrollPositionChangeOptions {
    ScrollType type;
    ScrollClamping clamping { ScrollClamping::Clamped };
    ScrollIsAnimated animated { ScrollIsAnimated::No };
    ScrollSnapPointSelectionMethod snapPointSelectionMethod { ScrollSnapPointSelectionMethod::Closest };
    std::optional<FloatSize> originalScrollDelta { };
    ScrollInterruptsAnimation interruptsAnimation { ScrollInterruptsAnimation::Yes };

    static ScrollPositionChangeOptions createProgrammatic()
    {
        return { ScrollType::Programmatic };
    }

    static ScrollPositionChangeOptions createProgrammaticWithOptions(ScrollClamping clamping, ScrollIsAnimated animated, ScrollSnapPointSelectionMethod snapPointSelectionMethod, std::optional<FloatSize> originalScrollDelta = std::nullopt)
    {
        return { ScrollType::Programmatic, clamping, animated, snapPointSelectionMethod, originalScrollDelta };
    }

    static ScrollPositionChangeOptions createUser()
    {
        return { ScrollType::User };
    }

    static ScrollPositionChangeOptions createProgrammaticUnclamped()
    {
        return { ScrollType::Programmatic, ScrollClamping::Unclamped };
    }
};

struct ScrollbarColor {
    Color thumbColor;
    Color trackColor;
    friend bool operator==(const ScrollbarColor&, const ScrollbarColor&) = default;
};

WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollType);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollClamping);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollBehaviorForFixedElements);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollBehavior);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollElasticity);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, RubberBandingBehavior);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollbarMode);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollbarRevealBehavior);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, OverflowAnchor);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollAxisLock);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollDirection);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollGranularity);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, NativeScrollbarVisibility);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollPositionChangeOptions);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollSnapPointSelectionMethod);
WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, ScrollbarWidth);

} // namespace WebCore

