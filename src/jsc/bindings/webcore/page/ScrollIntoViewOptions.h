/*
 * Copyright (C) 2018 Igalia S.L.
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

#include "ScrollIntoViewContainer.h"
#include "ScrollLogicalPosition.h"
#include "ScrollOptions.h"

namespace WebCore {

struct ScrollIntoViewOptions : ScrollOptions {
    // These are std::optional so that we can tell whether the author explicitly requested an
    // alignment for an axis. An unspecified axis defaults to "start" (block) / "nearest" (inline),
    // and is eligible to be adjusted to honor the target's scroll-snap-align.
    std::optional<ScrollLogicalPosition> blockPosition;
    std::optional<ScrollLogicalPosition> inlinePosition;
    ScrollIntoViewContainer container { ScrollIntoViewContainer::All };
};

} // namespace WebCore
