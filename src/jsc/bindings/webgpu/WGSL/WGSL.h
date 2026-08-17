/*
 * Copyright (c) 2021-2024 Apple Inc. All rights reserved.
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

#pragma once

#include "CompilationMessage.h"
#include "CompilationScope.h"
#include "ConstantValue.h"
#include "WGSLEnums.h"
#include <cinttypes>
#include <cstdint>
#include <memory>
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/OptionSet.h>
#include <wtf/UniqueRef.h>
#include <wtf/Variant.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace WGSL {

//
// Step 1
//

class ShaderModule;
class CompilationScope;

namespace AST {
class Expression;
}

struct SuccessfulCheck {
    SuccessfulCheck() = delete;
    SuccessfulCheck(SuccessfulCheck&&);
    SuccessfulCheck(Vector<Warning>&&, UniqueRef<ShaderModule>&&);
    ~SuccessfulCheck();
    Vector<Warning> warnings;
    UniqueRef<ShaderModule> ast;
};

struct FailedCheck {
    Vector<Error> errors;
    Vector<Warning> warnings;
};

struct SourceMap {
    // I don't know what goes in here.
    // https://sourcemaps.info/spec.html
};

struct Configuration {
    uint32_t maxBuffersPlusVertexBuffersForVertexStage = 8;
    uint32_t maxBuffersForFragmentStage = 8;
    uint32_t maxBuffersForComputeStage = 8;
    uint32_t maximumCombinedWorkgroupVariablesSize = 16384;
    const HashSet<String> supportedFeatures = { };
};

Variant<SuccessfulCheck, FailedCheck> staticCheck(const String& wgsl, const std::optional<SourceMap>&, const Configuration&);

//
// Step 2
//

enum class BufferBindingType : uint8_t {
    Uniform,
    Storage,
    ReadOnlyStorage
};

struct BufferBindingLayout {
    BufferBindingType type;
    bool hasDynamicOffset;
    uint64_t minBindingSize;
};

enum class SamplerBindingType : uint8_t {
    Filtering,
    NonFiltering,
    Comparison
};

struct SamplerBindingLayout {
    SamplerBindingType type;
};

enum class TextureSampleType : uint8_t {
    Float,
    UnfilterableFloat,
    Depth,
    SignedInt,
    UnsignedInt
};

enum class TextureViewDimension : uint8_t {
    OneDimensional,
    TwoDimensional,
    TwoDimensionalArray,
    Cube,
    CubeArray,
    ThreeDimensional
};

struct TextureBindingLayout {
    TextureSampleType sampleType;
    TextureViewDimension viewDimension;
    bool multisampled;
};

enum class StorageTextureAccess : uint8_t {
    WriteOnly,
    ReadOnly,
    ReadWrite,
};

struct StorageTextureBindingLayout {
    StorageTextureAccess access { StorageTextureAccess::WriteOnly };
    TexelFormat format;
    TextureViewDimension viewDimension;
};

struct ExternalTextureBindingLayout {
    // Sentinel
};

struct BindGroupLayoutEntry {
    uint32_t binding;
    uint32_t webBinding;
    OptionSet<ShaderStage> visibility;
    using BindingMember = Variant<BufferBindingLayout, SamplerBindingLayout, TextureBindingLayout, StorageTextureBindingLayout, ExternalTextureBindingLayout>;
    BindingMember bindingMember;
    String name;
    std::optional<uint32_t> vertexArgumentBufferIndex;
    std::optional<uint32_t> vertexArgumentBufferSizeIndex;
    std::optional<uint32_t> vertexBufferDynamicOffset;

    std::optional<uint32_t> fragmentArgumentBufferIndex;
    std::optional<uint32_t> fragmentArgumentBufferSizeIndex;
    std::optional<uint32_t> fragmentBufferDynamicOffset;

    std::optional<uint32_t> computeArgumentBufferIndex;
    std::optional<uint32_t> computeArgumentBufferSizeIndex;
    std::optional<uint32_t> computeBufferDynamicOffset;
};

struct BindGroupLayout {
    // Metal's [[id(n)]] indices are equal to the index into this vector.
    uint32_t group;
    Vector<BindGroupLayoutEntry> entries;
};

struct PipelineLayout {
    // Metal's [[buffer(n)]] indices are equal to the index into this vector.
    Vector<BindGroupLayout> bindGroupLayouts;
};

namespace Reflection {

struct Vertex {
    bool invariantIsPresent;
    // Tons of reflection data to appear here in the future.
};

struct Fragment {
    // Tons of reflection data to appear here in the future.
};

struct WorkgroupSize {
    const AST::Expression* width;
    const AST::Expression* height;
    const AST::Expression* depth;
};

struct Compute {
    WorkgroupSize workgroupSize;
};

enum class SpecializationConstantType : uint8_t {
    Boolean,
    Float,
    Int,
    Unsigned,
    Half
};

struct SpecializationConstant {
    String mangledName;
    SpecializationConstantType type;
    AST::Expression* defaultValue;
};

struct EntryPointInformation {
    String originalName;
    String mangledName;
    std::optional<PipelineLayout> defaultLayout; // If the input PipelineLayout is nullopt, the compiler computes a layout and returns it. https://gpuweb.github.io/gpuweb/#default-pipeline-layout
    HashMap<String, SpecializationConstant> specializationConstants;
    Variant<Vertex, Fragment, Compute> typedEntryPoint;
    size_t sizeForWorkgroupVariables { 0 };
    size_t bindingCount { 0 };
    bool usesInvariant { false };
};

} // namespace Reflection

struct PrepareResult {
    HashMap<String, Reflection::EntryPointInformation> entryPoints;
    CompilationScope compilationScope;
};

struct DeviceState {
    unsigned appleGPUFamily { 4 };
    bool shaderValidationEnabled { false };
    bool usesInvariant { false };
};

Variant<PrepareResult, Error> prepare(ShaderModule&, const HashMap<String, PipelineLayout*>&);
Variant<PrepareResult, Error> prepare(ShaderModule&, const String& entryPointName, PipelineLayout*);

Variant<String, Error> generate(ShaderModule&, PrepareResult&, HashMap<String, ConstantValue>&, DeviceState&&);

std::optional<ConstantValue> evaluate(const ShaderModule&, const AST::Expression&, const HashMap<String, ConstantValue>&);

} // namespace WGSL
