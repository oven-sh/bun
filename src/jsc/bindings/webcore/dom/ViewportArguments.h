/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 *           (C) 2006 Alexey Proskuryakov (ap@webkit.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2008 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 * Copyright (C) 2010 Nokia Corporation and/or its subsidiary(-ies)
 * Copyright (C) 2012 Intel Corporation. All rights reserved.
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
 *
 */

#pragma once

#include "FloatSize.h"
#include <wtf/Forward.h>
#include <wtf/Platform.h>

namespace WebCore {

class Document;

enum class ViewportErrorCode : uint8_t {
    UnrecognizedViewportArgumentKey,
    UnrecognizedViewportArgumentValue,
    TruncatedViewportArgumentValue,
    MaximumScaleTooLarge,
};

enum class ViewportFit : uint8_t {
    Auto,
    Contain,
    Cover
};

enum class InteractiveWidgetValue : uint8_t {
    ResizesVisual,
    ResizesContent,
    OverlaysContent
};

struct ViewportAttributes {
    FloatSize layoutSize;

    float initialScale;
    float minimumScale;
    float maximumScale;

    float userScalable;
    float orientation;
    float shrinkToFit;

    ViewportFit viewportFit;

    InteractiveWidgetValue interactiveWidgetValue;
};

struct ViewportArguments {
    WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(ViewportArguments);

    enum class Type : uint8_t {
        // These are ordered in increasing importance.
        Implicit,
#if PLATFORM(IOS_FAMILY)
        ImageDocument,
#endif
        ViewportMeta,
    };

    static constexpr int ValueAuto = -1;
    static constexpr int ValueDeviceWidth = -2;
    static constexpr int ValueDeviceHeight = -3;
    static constexpr int ValuePortrait = -4;
    static constexpr int ValueLandscape = -5;

    explicit ViewportArguments(Type type = Type::Implicit)
        : type(type)
    {
    }

    ViewportArguments(float width, float height, float zoom, float minZoom, float maxZoom, float userZoom, float orientation, float shrinkToFit, Type type, ViewportFit viewportFit, bool widthWasExplicit, InteractiveWidgetValue interactiveWidgetValue)
        : width(width)
        , height(height)
        , zoom(zoom)
        , minZoom(minZoom)
        , maxZoom(maxZoom)
        , userZoom(userZoom)
        , orientation(orientation)
        , shrinkToFit(shrinkToFit)
        , type(type)
        , viewportFit(viewportFit)
        , widthWasExplicit(widthWasExplicit)
        , interactiveWidgetValue(interactiveWidgetValue)
    {
    }

    // All arguments are in CSS units.
    ViewportAttributes resolve(const FloatSize& initialViewportSize, const FloatSize& deviceSize, int defaultWidth) const;

    float width { ValueAuto };
    float height { ValueAuto };
    float zoom { ValueAuto };
    float minZoom { ValueAuto };
    float maxZoom { ValueAuto };
    float userZoom { ValueAuto };
    float orientation { ValueAuto };
    float shrinkToFit { ValueAuto };
    Type type { Type::Implicit };
    ViewportFit viewportFit { ViewportFit::Auto };
    bool widthWasExplicit { false };
    InteractiveWidgetValue interactiveWidgetValue { InteractiveWidgetValue::ResizesVisual };

    bool operator==(const ViewportArguments& other) const
    {
        // Used for figuring out whether to reset the viewport or not,
        // thus we are not taking type into account.
        return width == other.width
            && height == other.height
            && zoom == other.zoom
            && minZoom == other.minZoom
            && maxZoom == other.maxZoom
            && userZoom == other.userZoom
            && orientation == other.orientation
            && shrinkToFit == other.shrinkToFit
            && viewportFit == other.viewportFit
            && widthWasExplicit == other.widthWasExplicit
            && interactiveWidgetValue == other.interactiveWidgetValue;
    }

#if PLATFORM(GTK)
    // FIXME: We're going to keep this constant around until all embedders
    // refactor their code to no longer need it.
    static const float deprecatedTargetDPI;
#endif
};

WEBCORE_EXPORT ViewportAttributes computeViewportAttributes(const ViewportArguments&, int desktopWidth, int deviceWidth, int deviceHeight, float devicePixelRatio, IntSize visibleViewport);

WEBCORE_EXPORT void restrictMinimumScaleFactorToViewportSize(ViewportAttributes& result, IntSize visibleViewport, float devicePixelRatio);
WEBCORE_EXPORT void LEGACY_NODELETE restrictScaleFactorToInitialScaleIfNotUserScalable(ViewportAttributes& result);
WEBCORE_EXPORT float computeMinimumScaleFactorForContentContained(const ViewportAttributes& result, const IntSize& viewportSize, const IntSize& contentSize);

typedef Function<void(ViewportErrorCode, const String&)> ViewportErrorHandler;
void setViewportFeature(ViewportArguments&, Document&, StringView key, StringView value);
WEBCORE_EXPORT void setViewportFeature(ViewportArguments&, StringView key, StringView value, bool metaViewportInteractiveWidgetEnabled, NOESCAPE const ViewportErrorHandler&);

WEBCORE_EXPORT WTF::TextStream& operator<<(WTF::TextStream&, const ViewportArguments&);

} // namespace WebCore
