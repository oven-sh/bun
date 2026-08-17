/*
 * Copyright (c) 2023 Apple Inc. All rights reserved.
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

#import "ConstantValue.h"
#import "ShaderModule.h"

namespace WebGPU {

class BindGroup;
class ShaderModule;

using BufferBindingSizesForBindGroup = HashMap<uint32_t, uint64_t, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>>;
using BufferBindingSizesForPipeline = HashMap<uint32_t, BufferBindingSizesForBindGroup, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>>;

struct LibraryCreationResult {
    id<MTLLibrary> library;
    WGSL::Reflection::EntryPointInformation entryPointInformation; // FIXME(PERFORMANCE): This is big. Don't copy this around.
    HashMap<String, WGSL::ConstantValue> wgslConstantValues;
};

std::optional<LibraryCreationResult> createLibrary(id<MTLDevice>, const ShaderModule&, PipelineLayout*, const String& entryPointName, NSString *label, std::span<const WGPUConstantEntry> constants, BufferBindingSizesForPipeline&, NSError **, String& metalShaderSource);

id<MTLFunction> createFunction(id<MTLLibrary>, const WGSL::Reflection::EntryPointInformation&, NSString *label);

NSString* errorValidatingBindGroup(const BindGroup&, const BufferBindingSizesForBindGroup*, const Vector<uint32_t>*);

#if !defined(NDEBUG) || (defined(ENABLE_LIBFUZZER) && ENABLE_LIBFUZZER && defined(ASAN_ENABLED) && ASAN_ENABLED)
void dumpMetalReproCaseComputePSO(String&& shaderSource, String&& functionName);
bool dumpMetalReproCaseRenderPSO(String&& vertexShaderSource, String&& vertexFunctionName, String&& fragmentShaderSource, String&& fragmentFunctionName, MTLRenderPipelineDescriptor*, ShaderModule::VertexStageIn& shaderLocations, const Device&);
void clearMetalPSORepro();
#endif

} // namespace WebGPU
