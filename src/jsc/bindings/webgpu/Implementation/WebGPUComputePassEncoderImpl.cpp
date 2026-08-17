/*
 * Copyright (C) 2021-2025 Apple Inc. All rights reserved.
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

#include "config.h"
#include "WebGPUComputePassEncoderImpl.h"

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUBindGroupImpl.h"
#include "WebGPUBufferImpl.h"
#include "WebGPUComputePipelineImpl.h"
#include "WebGPUConvertToBackingContext.h"
#include "WebGPUQuerySetImpl.h"
#include <WebGPU/WebGPUExt.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore::WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ComputePassEncoderImpl);

ComputePassEncoderImpl::ComputePassEncoderImpl(WebGPUPtr<WGPUComputePassEncoder>&& computePassEncoder, ConvertToBackingContext& convertToBackingContext)
    : m_backing(WTF::move(computePassEncoder))
    , m_convertToBackingContext(convertToBackingContext)
{
}

ComputePassEncoderImpl::~ComputePassEncoderImpl() = default;

void ComputePassEncoderImpl::setPipeline(const ComputePipeline& computePipeline)
{
    wgpuComputePassEncoderSetPipeline(m_backing.get(), m_convertToBackingContext->convertToBacking(computePipeline));
}

void ComputePassEncoderImpl::dispatch(Size32 workgroupCountX, Size32 workgroupCountY, Size32 workgroupCountZ)
{
    wgpuComputePassEncoderDispatchWorkgroups(m_backing.get(), workgroupCountX, workgroupCountY, workgroupCountZ);
}

void ComputePassEncoderImpl::dispatchIndirect(const Buffer& indirectBuffer, Size64 indirectOffset)
{
    wgpuComputePassEncoderDispatchWorkgroupsIndirect(m_backing.get(), m_convertToBackingContext->convertToBacking(indirectBuffer), indirectOffset);
}

void ComputePassEncoderImpl::end()
{
    wgpuComputePassEncoderEnd(m_backing.get());
}

void ComputePassEncoderImpl::setBindGroup(Index32 index, const BindGroup* bindGroup,
    std::optional<Vector<BufferDynamicOffset>>&& offsets)
{
    wgpuComputePassEncoderSetBindGroup(m_backing.get(), index, bindGroup ? m_convertToBackingContext->convertToBacking(*bindGroup) : nullptr, WTF::move(offsets));
}

void ComputePassEncoderImpl::setBindGroup(Index32, const BindGroup*, std::span<const uint32_t>, Size64, Size32)
{
    RELEASE_ASSERT_NOT_REACHED();
}

void ComputePassEncoderImpl::pushDebugGroup(String&& groupLabel)
{
    wgpuComputePassEncoderPushDebugGroup(m_backing.get(), groupLabel.utf8().data());
}

void ComputePassEncoderImpl::popDebugGroup()
{
    wgpuComputePassEncoderPopDebugGroup(m_backing.get());
}

void ComputePassEncoderImpl::insertDebugMarker(String&& markerLabel)
{
    wgpuComputePassEncoderInsertDebugMarker(m_backing.get(), markerLabel.utf8().data());
}

void ComputePassEncoderImpl::setLabelInternal(const String& label)
{
    wgpuComputePassEncoderSetLabel(m_backing.get(), label.utf8().data());
}

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
