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

#include "WebGPUError.h"
#include "WebGPUUncapturedErrorEventInit.h"
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>

namespace WebCore::WebGPU {

class UncapturedErrorEvent final : public RefCounted<UncapturedErrorEvent> {
public:
    static Ref<UncapturedErrorEvent> create(String&& type, UncapturedErrorEventInit&& uncapturedErrorEventInit)
    {
        return adoptRef(*new UncapturedErrorEvent(WTF::move(type), WTF::move(uncapturedErrorEventInit)));
    }

    const Error& error() const LIFETIME_BOUND { return m_uncapturedErrorEventInit.error; }

protected:
    UncapturedErrorEvent(String&& type, UncapturedErrorEventInit&& uncapturedErrorEventInit)
        : m_type(WTF::move(type))
        , m_uncapturedErrorEventInit(WTF::move(uncapturedErrorEventInit))
    {
    }

private:
    UncapturedErrorEvent(const UncapturedErrorEvent&) = delete;
    UncapturedErrorEvent(UncapturedErrorEvent&&) = delete;
    UncapturedErrorEvent& operator=(const UncapturedErrorEvent&) = delete;
    UncapturedErrorEvent& operator=(UncapturedErrorEvent&&) = delete;

    String m_type;
    UncapturedErrorEventInit m_uncapturedErrorEventInit;
};

} // namespace WebCore::WebGPU
