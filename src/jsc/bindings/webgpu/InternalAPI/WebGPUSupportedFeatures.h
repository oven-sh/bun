/*
 * Copyright (C) 2021-2023 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <wtf/RefCounted.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace WebCore::WebGPU {

class SupportedFeatures final : public RefCounted<SupportedFeatures> {
public:
    static Ref<SupportedFeatures> create(Vector<String>&& features)
    {
        return adoptRef(*new SupportedFeatures(WTF::move(features)));
    }

    static Ref<SupportedFeatures> create(const Vector<String>& features)
    {
        return adoptRef(*new SupportedFeatures(features));
    }

    static Ref<SupportedFeatures> clone(const SupportedFeatures& features)
    {
        return adoptRef(*new SupportedFeatures(Vector<String>(features.features())));
    }

    const Vector<String>& features() const LIFETIME_BOUND { return m_features; }

private:
    SupportedFeatures(Vector<String>&& features)
        : m_features(WTF::move(features))
    {
    }

    SupportedFeatures(const Vector<String>& features)
        : m_features(features)
    {
    }

    SupportedFeatures(const SupportedFeatures&) = delete;
    SupportedFeatures(SupportedFeatures&&) = delete;
    SupportedFeatures& operator=(const SupportedFeatures&) = delete;
    SupportedFeatures& operator=(SupportedFeatures&&) = delete;

    Vector<String> m_features;
};

} // namespace WebCore::WebGPU
