/*
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2007 Alp Toker <alp@atoker.com>
 * Copyright (C) 2010 Torch Mobile (Beijing) Co. Ltd. All rights reserved.
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

#include "config.h"
#include "HTMLCanvasElement.h"

#include "ElementInlines.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLCanvasElement);

using namespace HTMLNames;

// These values come from the WhatWG/W3C HTML spec.
constexpr int defaultWidth = 300;
constexpr int defaultHeight = 150;

inline HTMLCanvasElement::HTMLCanvasElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(canvasTag));
}

Ref<HTMLCanvasElement> HTMLCanvasElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLCanvasElement(tagName, document));
}

unsigned HTMLCanvasElement::width() const
{
    return limitToOnlyHTMLNonNegative(attributeWithoutSynchronization(widthAttr), defaultWidth);
}

unsigned HTMLCanvasElement::height() const
{
    return limitToOnlyHTMLNonNegative(attributeWithoutSynchronization(heightAttr), defaultHeight);
}

void HTMLCanvasElement::setHeight(unsigned value)
{
    setAttributeWithoutSynchronization(heightAttr, AtomString::number(limitToOnlyHTMLNonNegative(value, defaultHeight)));
}

void HTMLCanvasElement::setWidth(unsigned value)
{
    setAttributeWithoutSynchronization(widthAttr, AtomString::number(limitToOnlyHTMLNonNegative(value, defaultWidth)));
}

}
