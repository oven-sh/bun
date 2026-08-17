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

#pragma once

#include "GPUIntegralTypes.h"
#include "GPUTextureAspect.h"
#include "GPUTextureDimension.h"
#include "GPUTextureFormat.h"
#include "WebGPUTexture.h"
#include <optional>
#include <wtf/Ref.h>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class GPUDevice;
class GPUTextureView;

struct GPUTextureDescriptor;
struct GPUTextureViewDescriptor;

template<typename> class ExceptionOr;

class GPUTexture : public RefCountedAndCanMakeWeakPtr<GPUTexture> {
public:
    static Ref<GPUTexture> create(Ref<WebGPU::Texture>&& backing, const GPUTextureDescriptor& descriptor, GPUDevice& device)
    {
        return adoptRef(*new GPUTexture(WTF::move(backing), descriptor, device));
    }

    String NODELETE label() const;
    void setLabel(String&&);

    ExceptionOr<Ref<GPUTextureView>> createView(const std::optional<GPUTextureViewDescriptor>&) const;

    void destroy();
    bool isDestroyed() const { return m_isDestroyed; }

    WebGPU::Texture& backing() { return m_backing; }
    const WebGPU::Texture& backing() const { return m_backing; }
    GPUTextureFormat format() const { return m_format; }

    GPUDevice* device() const;

    GPUIntegerCoordinateOut NODELETE width() const;
    GPUIntegerCoordinateOut NODELETE height() const;
    GPUIntegerCoordinateOut NODELETE depthOrArrayLayers() const;
    GPUIntegerCoordinateOut NODELETE mipLevelCount() const;
    GPUSize32Out NODELETE sampleCount() const;
    GPUTextureDimension NODELETE dimension() const;
    GPUFlagsConstant NODELETE usage() const;

    static GPUTextureFormat NODELETE aspectSpecificFormat(GPUTextureFormat, GPUTextureAspect);
    static uint32_t NODELETE texelBlockSize(GPUTextureFormat);
    static uint32_t NODELETE texelBlockWidth(GPUTextureFormat);
    static uint32_t NODELETE texelBlockHeight(GPUTextureFormat);

    virtual ~GPUTexture();

    bool hasActiveInspectorCanvasCallTracer() const;

private:
    GPUTexture(Ref<WebGPU::Texture>&&, const GPUTextureDescriptor&, GPUDevice&);

    GPUTexture(const GPUTexture&) = delete;
    GPUTexture(GPUTexture&&) = delete;
    GPUTexture& operator=(const GPUTexture&) = delete;
    GPUTexture& operator=(GPUTexture&&) = delete;

    const Ref<WebGPU::Texture> m_backing;
    const GPUTextureFormat m_format;
    const GPUIntegerCoordinateOut m_width;
    const GPUIntegerCoordinateOut m_height;
    const GPUIntegerCoordinateOut m_depthOrArrayLayers;
    const GPUIntegerCoordinateOut m_mipLevelCount;
    const GPUSize32Out m_sampleCount;
    const GPUTextureDimension m_dimension;
    const GPUFlagsConstant m_usage;
    const Ref<GPUDevice> m_device;
    bool m_isDestroyed { false };
};

}
