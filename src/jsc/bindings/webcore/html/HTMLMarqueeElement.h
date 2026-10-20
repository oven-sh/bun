/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2007, 2010 Apple Inc. All rights reserved.
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

#include "HTMLElement.h"

namespace WebCore {

class HTMLMarqueeElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLMarqueeElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLMarqueeElement);
public:
    static Ref<HTMLMarqueeElement> create(const QualifiedName&, Document&);

    void start() { }
    void stop() { }

    // Number of pixels to move on each scroll movement. Defaults to 6.
    WEBCORE_EXPORT unsigned scrollAmount() const;
    WEBCORE_EXPORT void setScrollAmount(unsigned);

    // Interval between each scroll movement, in milliseconds. Defaults to 60.
    WEBCORE_EXPORT unsigned scrollDelay() const;
    WEBCORE_EXPORT void setScrollDelay(unsigned);

    // Loop count. -1 means loop indefinitely.
    WEBCORE_EXPORT int loop() const;
    WEBCORE_EXPORT ExceptionOr<void> setLoop(int);

private:
    HTMLMarqueeElement(const QualifiedName&, Document&);
};

} // namespace WebCore
