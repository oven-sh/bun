/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

#include <wtf/ASCIICType.h>
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class GPUAdapterInfo : public RefCounted<GPUAdapterInfo> {
public:
    static Ref<GPUAdapterInfo> create(String&& name, uint32_t subgroupMinSize, uint32_t subgroupMaxSize)
    {
        return adoptRef(*new GPUAdapterInfo(WTF::move(name), subgroupMinSize, subgroupMaxSize));
    }

    String vendor() const { auto v = m_name.split(' '); return v.size() ? normalizedIdentifier(v[0]) : ""_s; }
    String architecture() const { return vendor(); }
    String device() const { return vendor(); }
    String description() const { return vendor(); }
    bool isFallbackAdapter() const { return false; }
    uint32_t subgroupMinSize() const { return m_subgroupMinSize; }
    uint32_t subgroupMaxSize() const { return m_subgroupMaxSize; }

private:
    GPUAdapterInfo(String&& name, uint32_t subgroupMinSize, uint32_t subgroupMaxSize)
        : m_name(name)
        , m_subgroupMinSize(subgroupMinSize)
        , m_subgroupMaxSize(subgroupMaxSize)
    {
    }
    static String normalizedIdentifier(const String& s) { return s.convertToLowercaseWithoutLocale().removeCharacters([](auto c) { return !isASCIIAlphanumeric(c); }); }

    String m_name;
    uint32_t m_subgroupMinSize { 0 };
    uint32_t m_subgroupMaxSize { 0 };
};

}
