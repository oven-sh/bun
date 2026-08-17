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

#include "WebGPUIntegralTypes.h"
#include <cstdint>
#include <optional>
#include <wtf/Ref.h>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace WebCore::WebGPU {

class BindGroup;
class Buffer;
class ComputePipeline;
class QuerySet;

class ComputePassEncoder : public RefCountedAndCanMakeWeakPtr<ComputePassEncoder> {
public:
    virtual ~ComputePassEncoder() = default;

    String label() const { return m_label; }

    void setLabel(String&& label)
    {
        m_label = WTF::move(label);
        setLabelInternal(m_label);
    }

    virtual void setPipeline(const ComputePipeline&) = 0;
    virtual void dispatch(Size32 workgroupCountX, Size32 workgroupCountY = 1, Size32 workgroupCountZ = 1) = 0;
    virtual void dispatchIndirect(const Buffer& indirectBuffer, Size64 indirectOffset) = 0;

    virtual void end() = 0;

    virtual void setBindGroup(Index32, const BindGroup*,
        std::optional<Vector<BufferDynamicOffset>>&&) = 0;

    virtual void setBindGroup(Index32, const BindGroup*,
        std::span<const uint32_t> dynamicOffsetsArrayBuffer,
        Size64 dynamicOffsetsDataStart,
        Size32 dynamicOffsetsDataLength) = 0;

    virtual void pushDebugGroup(String&& groupLabel) = 0;
    virtual void popDebugGroup() = 0;
    virtual void insertDebugMarker(String&& markerLabel) = 0;
    virtual bool isRemoteComputePassEncoderProxy() const { return false; }
    virtual bool isComputePassEncoderImpl() const { return false; }

protected:
    ComputePassEncoder() = default;

private:
    ComputePassEncoder(const ComputePassEncoder&) = delete;
    ComputePassEncoder(ComputePassEncoder&&) = delete;
    ComputePassEncoder& operator=(const ComputePassEncoder&) = delete;
    ComputePassEncoder& operator=(ComputePassEncoder&&) = delete;

    virtual void setLabelInternal(const String&) = 0;

    String m_label;
};

} // namespace WebCore::WebGPU
