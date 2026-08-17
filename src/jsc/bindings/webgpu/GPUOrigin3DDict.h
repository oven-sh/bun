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

#include "GPUIntegralTypes.h"
#include "WebGPUOrigin3D.h"
#include <wtf/Vector.h>

namespace WebCore {

struct GPUOrigin3DDict {
    WebGPU::Origin3DDict convertToBacking() const
    {
        return {
            x,
            y,
            z,
        };
    }

    GPUIntegerCoordinate x { 0 };
    GPUIntegerCoordinate y { 0 };
    GPUIntegerCoordinate z { 0 };
};

using GPUOrigin3D = Variant<Vector<GPUIntegerCoordinate>, GPUOrigin3DDict>;

inline WebGPU::Origin3D convertToBacking(const GPUOrigin3D& origin3D)
{
    return WTF::switchOn(origin3D, [](const Vector<GPUIntegerCoordinate>& vector) -> WebGPU::Origin3D {
        return vector;
    }, [](const GPUOrigin3DDict& origin3D) -> WebGPU::Origin3D {
        return origin3D.convertToBacking();
    });
}

}
