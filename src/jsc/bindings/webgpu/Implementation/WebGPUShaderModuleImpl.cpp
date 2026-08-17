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

#include "config.h"
#include "WebGPUShaderModuleImpl.h"

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUCompilationInfo.h"
#include "WebGPUCompilationMessage.h"
#include "WebGPUCompilationMessageType.h"
#include "WebGPUConvertToBackingContext.h"
#include <WebGPU/WebGPUExt.h>

#include <wtf/BlockPtr.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore::WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ShaderModuleImpl);

ShaderModuleImpl::ShaderModuleImpl(WebGPUPtr<WGPUShaderModule>&& shaderModule, ConvertToBackingContext& convertToBackingContext)
    : m_backing(WTF::move(shaderModule))
    , m_convertToBackingContext(convertToBackingContext)
{
}

ShaderModuleImpl::~ShaderModuleImpl() = default;

static CompilationMessageType NODELETE convertFromBacking(WGPUCompilationMessageType type)
{
    switch (type) {
    case WGPUCompilationMessageType_Error:
        return CompilationMessageType::Error;
    case WGPUCompilationMessageType_Warning:
        return CompilationMessageType::Warning;
    case WGPUCompilationMessageType_Info:
        return CompilationMessageType::Info;
    case WGPUCompilationMessageType_Force32:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

static void compilationInfoCallback(WGPUCompilationInfoRequestStatus status, const WGPUCompilationInfo* compilationInfo, void* userdata)
{
    auto block = reinterpret_cast<void(^)(WGPUCompilationInfoRequestStatus, const WGPUCompilationInfo*)>(userdata);
    block(status, compilationInfo);
    Block_release(block); // Block_release is matched with Block_copy below in AdapterImpl::requestDevice().
}

void ShaderModuleImpl::compilationInfo(CompletionHandler<void(Ref<CompilationInfo>&&)>&& callback)
{
    auto blockPtr = makeBlockPtr([callback = WTF::move(callback)](WGPUCompilationInfoRequestStatus, const WGPUCompilationInfo* compilationInfo) mutable {
        Vector<Ref<CompilationMessage>> messages;
        if (!compilationInfo || !compilationInfo->messageCount) {
            callback(CompilationInfo::create(WTF::move(messages)));
            return;
        }

        for (auto& message : messagesSpan(*compilationInfo))
            messages.append(CompilationMessage::create(message.message, convertFromBacking(message.type), message.lineNum, message.linePos + 1, message.offset, message.length));

        callback(CompilationInfo::create(WTF::move(messages)));
    });

    wgpuShaderModuleGetCompilationInfo(m_backing.get(), &compilationInfoCallback, Block_copy(blockPtr.get()));
}

void ShaderModuleImpl::setLabelInternal(const String& label)
{
    wgpuShaderModuleSetLabel(m_backing.get(), label.utf8().data());
}

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
