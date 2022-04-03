/*
 * Copyright (C) 2008 Apple Inc. All Rights Reserved.
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

#include <wtf/Ref.h>
#include <wtf/RefCounted.h>

namespace WebCore {

class TextMetrics : public RefCounted<TextMetrics> {
public:
    static Ref<TextMetrics> create() { return adoptRef(*new TextMetrics); }

    float width() const { return m_width; }
    void setWidth(float w) { m_width = w; }

    float actualBoundingBoxLeft() const { return m_actualBoundingBoxLeft; }
    void setActualBoundingBoxLeft(float value) { m_actualBoundingBoxLeft = value; }

    float actualBoundingBoxRight() const { return m_actualBoundingBoxRight; }
    void setActualBoundingBoxRight(float value) { m_actualBoundingBoxRight = value; }

    float fontBoundingBoxAscent() const { return m_fontBoundingBoxAscent; }
    void setFontBoundingBoxAscent(float value) {  m_fontBoundingBoxAscent = value; }

    float fontBoundingBoxDescent() const { return m_fontBoundingBoxDescent; }
    void setFontBoundingBoxDescent(float value) {  m_fontBoundingBoxDescent = value; }

    float actualBoundingBoxAscent() const { return m_actualBoundingBoxAscent; }
    void setActualBoundingBoxAscent(float value) {  m_actualBoundingBoxAscent = value; }

    float actualBoundingBoxDescent() const { return m_actualBoundingBoxDescent; }
    void setActualBoundingBoxDescent(float value) {  m_actualBoundingBoxDescent = value; }

    float emHeightAscent() const { return m_emHeightAscent; }
    void setEmHeightAscent(float value) {  m_emHeightAscent = value; }

    float emHeightDescent() const { return m_emHeightDescent; }
    void setEmHeightDescent(float value) {  m_emHeightDescent = value; }

    float hangingBaseline() const { return m_hangingBaseline; }
    void setHangingBaseline(float value) {  m_hangingBaseline = value; }

    float alphabeticBaseline() const { return m_alphabeticBaseline; }
    void setAlphabeticBaseline(float value) {  m_alphabeticBaseline = value; }

    float ideographicBaseline() const { return m_ideographicBaseline; }
    void setIdeographicBaseline(float value) {  m_ideographicBaseline = value; }

private:
    float m_width { 0 };
    float m_actualBoundingBoxLeft { 0 };
    float m_actualBoundingBoxRight { 0 };
    float m_fontBoundingBoxAscent { 0 };
    float m_fontBoundingBoxDescent { 0 };
    float m_actualBoundingBoxAscent { 0 };
    float m_actualBoundingBoxDescent { 0 };
    float m_emHeightAscent { 0 };
    float m_emHeightDescent { 0 };
    float m_hangingBaseline { 0 };
    float m_alphabeticBaseline { 0 };
    float m_ideographicBaseline { 0 };
};

} // namespace WebCore
