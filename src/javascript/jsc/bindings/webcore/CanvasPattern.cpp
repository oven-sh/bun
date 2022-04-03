/*
 * Copyright (C) 2006, 2008, 2017 Apple Inc. All rights reserved.
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
#include "CanvasPattern.h"

#include "DOMMatrix2DInit.h"
// #include "DOMMatrixReadOnly.h"
// #include "NativeImage.h"
// #include "Pattern.h"
#include <wtf/text/WTFString.h>

namespace WebCore {

Ref<CanvasPattern> CanvasPattern::create(SourceImage&& image, bool repeatX, bool repeatY, bool originClean)
{
    return adoptRef(*new CanvasPattern(WTFMove(image), repeatX, repeatY, originClean));
}

CanvasPattern::CanvasPattern(SourceImage&& image, bool repeatX, bool repeatY, bool originClean)
    // : m_pattern(Pattern::create(WTFMove(image), { repeatX, repeatY }))
    : m_originClean(originClean)
{
}

CanvasPattern::~CanvasPattern() = default;

bool CanvasPattern::parseRepetitionType(const String& type, bool& repeatX, bool& repeatY)
{
    //     if (type.isEmpty() || type == "repeat") {
    //         repeatX = true;
    //         repeatY = true;
    //         return true;
    //     }
    //     if (type == "no-repeat") {
    //         repeatX = false;
    //         repeatY = false;
    //         return true;
    //     }
    //     if (type == "repeat-x") {
    //         repeatX = true;
    //         repeatY = false;
    //         return true;
    //     }
    //     if (type == "repeat-y") {
    //         repeatX = false;
    //         repeatY = true;
    //         return true;
    //     }
    return false;
}

ExceptionOr<void> CanvasPattern::setTransform(DOMMatrix2DInit&& matrixInit)
{
}

} // namespace WebCore
