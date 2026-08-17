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

#include "WebGPUCompareFunction.h"
#include <cstdint>

namespace WebCore {

enum class GPUCompareFunction : uint8_t {
    Never,
    Less,
    Equal,
    LessEqual,
    Greater,
    NotEqual,
    GreaterEqual,
    Always,
};

inline WebGPU::CompareFunction convertToBacking(GPUCompareFunction compareFunction)
{
    switch (compareFunction) {
    case GPUCompareFunction::Never:
        return WebGPU::CompareFunction::Never;
    case GPUCompareFunction::Less:
        return WebGPU::CompareFunction::Less;
    case GPUCompareFunction::Equal:
        return WebGPU::CompareFunction::Equal;
    case GPUCompareFunction::LessEqual:
        return WebGPU::CompareFunction::LessEqual;
    case GPUCompareFunction::Greater:
        return WebGPU::CompareFunction::Greater;
    case GPUCompareFunction::NotEqual:
        return WebGPU::CompareFunction::NotEqual;
    case GPUCompareFunction::GreaterEqual:
        return WebGPU::CompareFunction::GreaterEqual;
    case GPUCompareFunction::Always:
        return WebGPU::CompareFunction::Always;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

}
