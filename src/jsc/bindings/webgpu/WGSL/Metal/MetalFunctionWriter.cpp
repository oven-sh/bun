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

#include "config.h"
#include "MetalFunctionWriter.h"

#include "API.h"
#include "AST.h"
#include "ASTInterpolateAttribute.h"
#include "ASTStringDumper.h"
#include "ASTVisitor.h"
#include "CallGraph.h"
#include "Constraints.h"
#include "Types.h"
#include "WGSLShaderModule.h"
#include <numbers>
#include <wtf/HashSet.h>
#include <wtf/SetForScope.h>
#include <wtf/SortedArrayMap.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>

namespace WGSL {

namespace Metal {

#define DECLARE_FORWARD_PROGRESS "volatile uint32_t __wgslEnsureForwardProgress = 0; if (!__wgslEnsureForwardProgress)"
#define CHECK_FORWARD_PROGRESS "if (++__wgslEnsureForwardProgress == 4294967295u) break;"

#define STRINGIFY_(__x) #__x##_s
#define STRINGIFY(__x) STRINGIFY_(__x)

#define DEFINE_HELPER(__name, ...) \
    void emit##__name() { m_output.append(STRINGIFY(__VA_ARGS__)); } \
    bool didEmit##__name { false };

#define DEFINE_BOUND_HELPER_RENAMED(__name, __capitalizedName, __metalFunction, __lowerBound, __upperBound, ...) \
    DEFINE_HELPER(__capitalizedName,  \
    template <typename T> \
    T __wgsl##__capitalizedName(T value) \
    { \
        return __metalFunction(select(value, T(0), value < T(__lowerBound) || value > T(__upperBound))); \
    })

#define DEFINE_BOUND_HELPER(__name, __capitalizedName, __lowerBound, __upperBound, ...) \
    DEFINE_BOUND_HELPER_RENAMED(__name, __capitalizedName, __name, __lowerBound, __upperBound, __VA_ARGS__)

#define DEFINE_VOLATILE_BOUND_HELPER_RENAMED(__name, __capitalizedName, __metalFunction, __lowerBound, __upperBound, ...) \
    DEFINE_HELPER(__capitalizedName,  \
    template <typename T> \
    T __wgsl##__capitalizedName(T value) \
    { \
    if constexpr(__wgslMetalAppleGPUFamily < 9) { \n\
        volatile auto result = __metalFunction(select(value, T(0), value < T(__lowerBound) || value > T(__upperBound))); \
        return result; \
    } else { \n\
        return __metalFunction(select(value, T(0), value < T(__lowerBound) || value > T(__upperBound))); \
    }\n \
    })

#define DEFINE_VOLATILE_BOUND_HELPER(__name, __capitalizedName, __lowerBound, __upperBound, ...) \
    DEFINE_VOLATILE_BOUND_HELPER_RENAMED(__name, __capitalizedName, __name, __lowerBound, __upperBound, __VA_ARGS__)

#define DEFINE_VOLATILE_HELPER_RENAMED(__name, __capitalizedName) \
    DEFINE_HELPER(__capitalizedName, \
    template <typename T>\n \
    auto __wgsl##__capitalizedName(T value)\n \
    {\n \
        if constexpr(__wgslMetalAppleGPUFamily < 9) { \n\
            volatile auto result = __name(value);\n \
            return result;\n \
        } else { \n\
            auto result = __name(value);\n \
            return result;\n \
        }\n \
    }\n)

#define DEFINE_VOLATILE_HELPER(__name, __capitalizedName) \
    DEFINE_VOLATILE_HELPER_RENAMED(__name, __capitalizedName)

struct HelperGenerator {
    StringBuilder& m_output;

    HelperGenerator(StringBuilder& output)
        : m_output(output)
    {
    }

DEFINE_BOUND_HELPER(acos, Acos, -1, 1)
DEFINE_BOUND_HELPER(asin, Asin, -1, 1)
DEFINE_BOUND_HELPER(acosh, Acosh, 1, numeric_limits<T>::max())
DEFINE_BOUND_HELPER(atanh, Atanh, -1, 1)
DEFINE_BOUND_HELPER_RENAMED(inverseSqrt, InverseSqrt, rsqrt, 0, numeric_limits<T>::infinity())
DEFINE_VOLATILE_BOUND_HELPER(log, Log, 0, numeric_limits<T>::infinity())
DEFINE_BOUND_HELPER(log2, Log2, 0, numeric_limits<T>::infinity())
DEFINE_BOUND_HELPER(sqrt, Sqrt, 0, numeric_limits<T>::infinity())
DEFINE_VOLATILE_HELPER(pack_float_to_snorm2x16, PackFloatToSnorm2x16)
DEFINE_VOLATILE_HELPER(pack_float_to_unorm2x16, PackFloatToUnorm2x16)
DEFINE_VOLATILE_HELPER(pack_float_to_snorm4x8, PackFloatToSnorm4x8)
DEFINE_VOLATILE_HELPER(pack_float_to_unorm4x8, PackFloatToUnorm4x8)

DEFINE_HELPER(TextureSampleBaseClampToEdge, \
    float4 __wgslTextureSampleBaseClampToEdge(texture2d<float> __texture, sampler __sampler, float2 __coords)\n \
    {\n \
        float2 const __bounds = (float2(0.5f) / float2(uint2(__texture.get_width(), __texture.get_height()))); \
        return __texture.sample(__sampler, clamp(__coords, __bounds, float2(1.0f) - __bounds)); \
    }\n)

DEFINE_HELPER(TextureExternalSampleBaseClampToEdge, \
    float4 __wgslTextureSampleBaseClampToEdge(texture_external __texture, sampler __sampler, float2 __inputCoords)\n \
    {\n \
        auto __coords = (__texture.UVRemapMatrix * float3(__inputCoords, 1)).xy; \
        auto __y = __texture.FirstPlane.sample(__sampler, __coords).r; \
        auto __cbcr = __texture.SecondPlane.sample(__sampler, __coords).rg; \
        auto __ycbcr = float3(__y, __cbcr); \
        return float4(__texture.ColorSpaceConversionMatrix * float4(__ycbcr, 1), 1); \
    }\n)

};

#undef DEFINE_TRIG_HELPER
#undef DEFINE_HELPER
#undef STRINGIFY
#undef STRINGIFY_


class FunctionDefinitionWriter : public AST::Visitor {
public:
    FunctionDefinitionWriter(ShaderModule& shaderModule, StringBuilder& stringBuilder, PrepareResult& prepareResult, const HashMap<String, ConstantValue>& constantValues, DeviceState&& deviceState)
        : m_helperGenerator(stringBuilder)
        , m_output(stringBuilder)
        , m_shaderModule(shaderModule)
        , m_prepareResult(prepareResult)
        , m_constantValues(constantValues)
        , m_deviceState(WTF::move(deviceState))
    {
    }

    virtual ~FunctionDefinitionWriter() = default;

    using AST::Visitor::visit;

    void write();

    void visit(AST::Attribute&) override;
    void visit(AST::BuiltinAttribute&) override;
    void visit(AST::LocationAttribute&) override;
    void visit(AST::StageAttribute&) override;
    void visit(AST::GroupAttribute&) override;
    void visit(AST::BindingAttribute&) override;
    void visit(AST::WorkgroupSizeAttribute&) override;
    void visit(AST::SizeAttribute&) override;
    void visit(AST::AlignAttribute&) override;
    void visit(AST::InterpolateAttribute&) override;
    void visit(AST::InvariantAttribute&) override;

    void visit(AST::Function&) override;
    void visit(AST::Structure&) override;
    void visit(AST::Variable&) override;
    void visit(AST::ConstAssert&) override;

    void visit(const Type*, AST::Expression&);
    void visit(const Type*, AST::CallExpression&);

    void visit(AST::BoolLiteral&) override;
    void visit(AST::AbstractFloatLiteral&) override;
    void visit(AST::AbstractIntegerLiteral&) override;
    void visit(AST::BinaryExpression&) override;
    void visit(AST::Expression&) override;
    void visit(AST::FieldAccessExpression&) override;
    void visit(AST::Float32Literal&) override;
    void visit(AST::Float16Literal&) override;
    void visit(AST::IdentifierExpression&) override;
    void visit(AST::IndexAccessExpression&) override;
    void visit(AST::PointerDereferenceExpression&) override;
    void visit(AST::UnaryExpression&) override;
    void visit(AST::Signed32Literal&) override;
    void visit(AST::Unsigned32Literal&) override;

    void visit(AST::Statement&) override;
    void visit(AST::AssignmentStatement&) override;
    void visit(AST::CallStatement&) override;
    void visit(AST::CompoundAssignmentStatement&) override;
    void visit(AST::CompoundStatement&) override;
    void visit(AST::DecrementIncrementStatement&) override;
    void visit(AST::DiscardStatement&) override;
    void visit(AST::IfStatement&) override;
    void visit(AST::PhonyAssignmentStatement&) override;
    void visit(AST::ReturnStatement&) override;
    void visit(AST::ForStatement&) override;
    void visit(AST::LoopStatement&) override;
    void visit(AST::Continuing&) override;
    void visit(AST::WhileStatement&) override;
    void visit(AST::SwitchStatement&) override;
    void visit(AST::BreakStatement&) override;
    void visit(AST::ContinueStatement&) override;

    void visit(AST::Parameter&) override;
    void visitArgumentBufferParameter(AST::Parameter&);

    void visit(const Type*, bool shouldPack = false);

    StringBuilder& NODELETE stringBuilder() { return m_body; }
    Indentation<4>& NODELETE indent() { return m_indent; }
    unsigned NODELETE metalAppleGPUFamily() const { return m_deviceState.appleGPUFamily; }
    bool NODELETE shaderValidationEnabled() const { return m_deviceState.shaderValidationEnabled; }

private:
    void emitNecessaryHelpers();
    void serializeVariable(AST::Variable&);
    void generatePackingHelpers(AST::Structure&);
    bool emitPackedVector(const Types::Vector&, bool shouldPack);

    bool outlineConstant(const Type*, AST::Expression&);
    void serializeConstant(const Type*, ConstantValue);
    void serializeBinaryExpression(AST::Expression&, AST::BinaryOperation, AST::Expression&);
    void visitStatements(AST::Statement::List&);
    bool NODELETE shouldPackType() const;

    HelperGenerator m_helperGenerator;
    StringBuilder m_body;
    StringBuilder m_constants;
    StringBuilder& m_output;
    ShaderModule& m_shaderModule;
    Indentation<4> m_indent { 0 };
    uint32_t m_constID { 0 };
    std::optional<AST::StructureRole> m_structRole;
    std::optional<AST::VariableRole> m_variableRole;
    std::optional<AST::ParameterRole> m_parameterRole;
    std::optional<ShaderStage> m_entryPointStage;
    AST::Function* m_currentFunction { nullptr };
    AST::Continuing*m_continuing { nullptr };
    HashSet<AST::Function*> m_visitedFunctions;
    PrepareResult& m_prepareResult;
    const HashMap<String, ConstantValue>& m_constantValues;
    DeviceState m_deviceState;
};

static ASCIILiteral serializeAddressSpace(AddressSpace addressSpace)
{
    switch (addressSpace) {
    case AddressSpace::Function:
    case AddressSpace::Private:
        return "thread"_s;
    case AddressSpace::Workgroup:
        return "threadgroup"_s;
    case AddressSpace::Uniform:
        return "constant"_s;
    case AddressSpace::Storage:
        return "device"_s;
    case AddressSpace::Handle:
        return { };
    }
}

void FunctionDefinitionWriter::write()
{
    emitNecessaryHelpers();

    for (auto& declaration : m_shaderModule.declarations()) {
        if (auto* structure = dynamicDowncast<AST::Structure>(declaration))
            visit(*structure);
    }

    for (auto& declaration : m_shaderModule.declarations()) {
        if (auto* structure = dynamicDowncast<AST::Structure>(declaration))
            generatePackingHelpers(*structure);
    }

    m_output.append(m_body);
    m_body.clear();

    for (auto& entryPoint : m_shaderModule.callGraph().entrypoints()) {
        if (m_prepareResult.entryPoints.contains(entryPoint.originalName))
            visit(entryPoint.function);
    }

    m_output.append(m_constants);
    m_output.append(m_body);
}

void FunctionDefinitionWriter::emitNecessaryHelpers()
{
    m_output.append("template<typename T>\n"_s,
        "struct __UnpackedTypeImpl;\n\n"_s,
        "template<typename T>\n"_s,
        "struct __PackedTypeImpl;\n\n"_s,
        "template<typename T>\n"_s,
        "using __UnpackedType = typename __UnpackedTypeImpl<T>::Type;\n\n"_s,
        "template<typename T>\n"_s,
        "using __PackedType = typename __PackedTypeImpl<T>::Type;\n\n"_s);

    if (m_shaderModule.usesPackedVec3()) {
        m_output.append(
            m_indent, "template<typename T>\n"_s,
            m_indent, "struct PackedVec3 {\n"_s
        );
        {
            IndentationScope scope(m_indent);
            m_output.append(
                m_indent, "union { T x; T r; };\n"_s,
                m_indent, "union { T y; T g; };\n"_s,
                m_indent, "union { T z; T b; };\n"_s,
                m_indent, "uint8_t __padding[sizeof(T)];\n"_s,
                m_indent, "\n"_s,
                m_indent, "PackedVec3() { }\n"_s,
                m_indent, "\n"_s,
                m_indent, "PackedVec3(packed_vec<T, 3> v) : x(v.x), y(v.y), z(v.z) { }\n"_s,
                m_indent, "\n"_s,
                m_indent, "operator vec<T, 3>() const thread { return vec<T, 3>(x, y, z); }\n"_s,
                m_indent, "operator vec<T, 3>() const device { return vec<T, 3>(x, y, z); }\n"_s,
                m_indent, "operator vec<T, 3>() const constant { return vec<T, 3>(x, y, z); }\n"_s,
                m_indent, "operator vec<T, 3>() const threadgroup { return vec<T, 3>(x, y, z); }\n"_s,
                m_indent, "operator packed_vec<T, 3>() const thread { return packed_vec<T, 3>(x, y, z); }\n"_s,
                m_indent, "operator packed_vec<T, 3>() const device { return packed_vec<T, 3>(x, y, z); }\n"_s,
                m_indent, "operator packed_vec<T, 3>() const constant { return packed_vec<T, 3>(x, y, z); }\n"_s,
                m_indent, "operator packed_vec<T, 3>() const threadgroup { return packed_vec<T, 3>(x, y, z); }\n"_s,
                m_indent, "\n"_s,
                m_indent, "T operator[](int i) const { return i ? i == 2 ? z : y : x; }\n"_s,
                m_indent, "T operator[](int i) const device { return i ? i == 2 ? z : y : x; }\n"_s,
                m_indent, "device T& operator[](int i) device { return i ? i == 2 ? z : y : x; }\n"_s,
                m_indent, "constant T& operator[](int i) constant { return i ? i == 2 ? z : y : x; }\n"_s,
                m_indent, "thread T& operator[](int i) thread { return i ? i == 2 ? z : y : x; }\n"_s,
                m_indent, "threadgroup T& operator[](int i) threadgroup { return i ? i == 2 ? z : y : x; }\n"_s
            );
        }
        m_output.append(m_indent, "};\n\n"_s);

        m_output.append(
            m_indent, "template<typename T, int C>\n"_s,
            m_indent, "struct PackedMatrix {\n"_s
        );
        {
            IndentationScope scope(m_indent);
            m_output.append(
                m_indent, "PackedVec3<T> columns[C];\n"_s
            );
        }
        m_output.append(m_indent, "};\n\n"_s);
    }

    if (m_shaderModule.usesExternalTextures()) {
        m_shaderModule.clearUsesExternalTextures();
        m_output.append("struct texture_external {\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "texture2d<float> FirstPlane;\n"_s,
                m_indent, "texture2d<float> SecondPlane;\n"_s,
                m_indent, "float3x2 UVRemapMatrix;\n"_s,
                m_indent, "float4x3 ColorSpaceConversionMatrix;\n"_s,
                m_indent, "uint get_width(uint lod = 0) const { return FirstPlane.get_width(lod); }\n"_s,
                m_indent, "uint get_height(uint lod = 0) const { return FirstPlane.get_height(lod); }\n"_s);
        }
        m_output.append("};\n\n"_s);
    }

    if (m_shaderModule.usesPackVector()) {
        m_shaderModule.clearUsesPackVector();
        m_output.append(m_indent, "template<typename T>\n"_s,
            m_indent, "static __attribute__((always_inline)) packed_vec<T, 3> __pack(vec<T, 3> unpacked) { return unpacked; }\n\n"_s);

        if (m_shaderModule.usesPackedVec3()) {
            m_output.append(m_indent, "template<typename T, int C>\n"_s,
                m_indent, "static __attribute__((always_inline)) PackedMatrix<T, C> __pack(matrix<T, C, 3> unpacked)\n"_s,
                m_indent, "{\n"_s);
            {
                IndentationScope scope(m_indent);
                m_output.append(m_indent, "PackedMatrix<T, C> packed;\n"_s,
                    m_indent, "for (int i = 0; i < C; i++)\n"_s);
                {
                    IndentationScope scope(m_indent);
                    m_output.append(m_indent, "packed.columns[i] = PackedVec3<T>(packed_vec<T, 3>(unpacked[i]));\n"_s);
                }
                m_output.append(m_indent, "return packed;\n"_s);
            }
            m_output.append(m_indent, "}\n\n"_s);
        }
    }

    if (m_shaderModule.usesUnpackVector()) {
        m_shaderModule.clearUsesUnpackVector();
        m_output.append(m_indent, "template<typename T>\n"_s,
            m_indent, "static __attribute__((always_inline)) vec<T, 3> __unpack(packed_vec<T, 3> packed) { return packed; }\n\n"_s);

        if (m_shaderModule.usesPackedVec3()) {
            m_output.append(m_indent, "template<typename T>\n"_s,
                m_indent, "static vec<T, 3> __unpack(PackedVec3<T> packed) { return packed; }\n\n"_s);

            m_output.append(m_indent, "template<typename T, int C>\n"_s,
                m_indent, "static __attribute__((always_inline)) matrix<T, C, 3> __unpack(PackedMatrix<T, C> packed)\n"_s,
                m_indent, "{\n"_s);
            {
                IndentationScope scope(m_indent);
                m_output.append(m_indent, "matrix<T, C, 3> unpacked;\n"_s,
                    m_indent, "for (int i = 0; i < C; i++)\n"_s);
                {
                    IndentationScope scope(m_indent);
                    m_output.append(m_indent, "unpacked[i] = vec<T, 3>(packed.columns[i]);\n"_s);
                }
                m_output.append(m_indent, "return unpacked;\n"_s);
            }
            m_output.append(m_indent, "}\n\n"_s);
        }
    }

    if (m_shaderModule.usesPackArray()) {
        m_shaderModule.clearUsesPackArray();

        m_output.append(m_indent, "template<typename T, size_t N>\n"_s,
            m_indent, "struct __PackedTypeImpl<array<T, N>> {\n"_s,
            m_indent, "using Type = array<__PackedType<T>, N>;\n"_s,
            m_indent, "};\n\n"_s);

        if (m_shaderModule.usesPackedVec3()) {
            m_output.append(m_indent, "template<typename T, size_t N>\n"_s,
                m_indent, "struct __PackedTypeImpl<array<vec<T, 3>, N>> {"_s,
                m_indent, "using Type = array<PackedVec3<T>, N>;"_s,
                m_indent, "};\n\n"_s);

            m_output.append(m_indent, "template<typename T, int C>\n"_s,
                m_indent, "struct __PackedTypeImpl<matrix<T, C, 3>> {"_s,
                m_indent, "using Type = PackedMatrix<T, C>;"_s,
                m_indent, "};\n\n"_s);

            m_output.append(m_indent, "template<typename T, size_t N>\n"_s,
                m_indent, "static __attribute__((always_inline)) array<PackedVec3<T>, N> __pack(array<vec<T, 3>, N> unpacked)\n"_s,
                m_indent, "{\n"_s);
            {
                IndentationScope scope(m_indent);
                m_output.append(m_indent, "array<PackedVec3<T>, N> packed;\n"_s,
                    m_indent, "for (size_t i = 0; i < N; ++i)\n"_s);
                {
                    IndentationScope scope(m_indent);
                    m_output.append(m_indent, "packed[i] = PackedVec3<T>(unpacked[i]);\n"_s);
                }
                m_output.append(m_indent, "return packed;\n"_s);
            }
            m_output.append(m_indent, "}\n\n"_s);
        }

        m_output.append(m_indent, "template<typename T, size_t N>\n"_s,
            m_indent, "static __attribute__((always_inline)) array<__PackedType<T>, N> __pack(array<T, N> unpacked)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "array<__PackedType<T>, N> packed;\n"_s,
                m_indent, "for (size_t i = 0; i < N; ++i)\n"_s);
            {
                IndentationScope scope(m_indent);
                m_output.append(m_indent, "packed[i] = __pack(unpacked[i]);\n"_s);
            }
            m_output.append(m_indent, "return packed;\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);

    }

    if (m_shaderModule.usesUnpackArray()) {
        m_shaderModule.clearUsesUnpackArray();

        m_output.append(m_indent, "template<typename T, size_t N>\n"_s,
            m_indent, "struct __UnpackedTypeImpl<array<T, N>> {\n"_s,
            m_indent, "using Type = array<__UnpackedType<T>, N>;\n"_s,
            m_indent, "};\n\n"_s);

        if (m_shaderModule.usesPackedVec3()) {
            m_output.append(m_indent, "template<typename T, size_t N>\n"_s,
                m_indent, "struct __UnpackedTypeImpl<array<PackedVec3<T>, N>> {"_s,
                m_indent, "using Type = array<vec<T, 3>, N>;"_s,
                m_indent, "};\n\n"_s);

            m_output.append(m_indent, "template<typename T, int C>\n"_s,
                m_indent, "struct __UnpackedTypeImpl<PackedMatrix<T, C>> {"_s,
                m_indent, "using Type = matrix<T, C, 3>;"_s,
                m_indent, "};\n\n"_s);

            m_output.append(m_indent, "template<typename T, size_t N>\n"_s,
                m_indent, "static __attribute__((always_inline)) array<vec<T, 3>, N> __unpack(array<PackedVec3<T>, N> packed)\n"_s,
                m_indent, "{\n"_s);
            {
                IndentationScope scope(m_indent);
                m_output.append(m_indent, "array<vec<T, 3>, N> unpacked;\n"_s,
                    m_indent, "for (size_t i = 0; i < N; ++i)\n"_s);
                {
                    IndentationScope scope(m_indent);
                    m_output.append(m_indent, "unpacked[i] = vec<T, 3>(packed[i]);\n"_s);
                }
                m_output.append(m_indent, "return unpacked;\n"_s);
            }
            m_output.append(m_indent, "}\n\n"_s);
        }

        m_output.append(m_indent, "template<typename T, size_t N>\n"_s,
            m_indent, "static __attribute__((always_inline)) array<__UnpackedType<T>, N> __unpack(array<T, N> packed)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "array<__UnpackedType<T>, N> unpacked;\n"_s,
                m_indent, "for (size_t i = 0; i < N; ++i)\n"_s);
            {
                IndentationScope scope(m_indent);
                m_output.append(m_indent, "unpacked[i] = __unpack(packed[i]);\n"_s);
            }
            m_output.append(m_indent, "return unpacked;\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);
    }

    if (m_shaderModule.usesWorkgroupUniformLoad()) {
        m_output.append(m_indent, "template<typename T>\n"_s,
            m_indent, (shaderValidationEnabled() ? "[[clang::optnone]] "_s : ""_s), "static T __workgroup_uniform_load(threadgroup T* const ptr)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "threadgroup_barrier(mem_flags::mem_threadgroup);\n"_s,
                m_indent, "auto result = *ptr;\n"_s,
                m_indent, "threadgroup_barrier(mem_flags::mem_threadgroup);\n"_s,
                m_indent, "return result;\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);
    }

    if (m_shaderModule.usesWorkgroupUniformLoadAtomic()) {
        m_output.append(m_indent, "template<typename T>\n"_s,
            m_indent, (shaderValidationEnabled() ? "[[clang::optnone]] "_s : ""_s), "static T __workgroup_uniform_load(threadgroup atomic<T>* const ptr)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "threadgroup_barrier(mem_flags::mem_threadgroup);\n"_s,
                m_indent, "auto result = atomic_load_explicit(ptr, memory_order_relaxed);\n"_s,
                m_indent, "threadgroup_barrier(mem_flags::mem_threadgroup);\n"_s,
                m_indent, "return result;\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);
    }

    if (m_shaderModule.usesDivision()) {
        m_output.append(m_indent, "template<typename T, typename U, typename V = conditional_t<is_scalar_v<U>, T, U>>\n"_s,
            m_indent, "static V __wgslDiv(T lhs, U rhs)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "auto predicate = V(rhs) == V(0);\n"_s,
                m_indent, "if constexpr (is_signed_v<U>)\n"_s);
            {
                IndentationScope scope(m_indent);
                m_output.append(m_indent, "predicate = predicate || (V(lhs) == V(numeric_limits<T>::lowest()) && V(rhs) == V(-1));\n"_s);
            }
            m_output.append(m_indent, "return lhs / select(V(rhs), V(1), predicate);\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);
    }

    if (m_shaderModule.usesModulo()) {
        m_output.append(m_indent, "template<typename T, typename U, typename V = conditional_t<is_scalar_v<U>, T, U>>\n"_s,
            m_indent, "static V __wgslMod(T lhs, U rhs)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "auto predicate = V(rhs) == V(0);\n"_s,
                m_indent, "if constexpr (is_signed_v<U>)\n"_s);
            {
                IndentationScope scope(m_indent);
                m_output.append(m_indent, "predicate = predicate || (V(lhs) == V(numeric_limits<T>::lowest()) && V(rhs) == V(-1));\n"_s);
            }
            m_output.append(m_indent, "return select(lhs % V(rhs), V(0), predicate);\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);
    }


    if (m_shaderModule.usesFrexp()) {
        m_output.append(m_indent, "template<typename T, typename U>\n"_s,
            m_indent, "struct __frexp_result {\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "T fract;\n"_s,
                m_indent, "U exp;\n"_s);
        }
        m_output.append(m_indent, "};\n\n"_s,
            m_indent, "template<typename T, typename U = conditional_t<is_vector_v<T>, vec<int, vec_elements<T>::value ?: 2>, int>>\n"_s,
            m_indent, "static __frexp_result<T, U> __wgslFrexp(T value)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "__frexp_result<T, U> result;\n"_s,
                m_indent, "result.fract = frexp(value, result.exp);\n"_s,
                m_indent, "return result;\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);
    }

    if (m_shaderModule.usesModf()) {
        m_output.append(m_indent, "template<typename T, typename U>\n"_s,
            m_indent, "struct __modf_result {\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "T fract;\n"_s,
                m_indent, "U whole;\n"_s);
        }
        m_output.append(m_indent, "};\n\n"_s,
            m_indent, "template<typename T>\n"_s,
            m_indent, "static __modf_result<T, T> __wgslModf(T value)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "__modf_result<T, T> result;\n"_s,
                m_indent, "result.fract = modf(value, result.whole);\n"_s,
                m_indent, "return result;\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);
    }

    if (m_shaderModule.usesAtomicCompareExchange()) {
        m_output.append(m_indent, "template<typename T, typename U = bool>\n"_s,
            m_indent, "struct __atomic_compare_exchange_result {\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "T old_value;\n"_s,
                m_indent, "U exchanged;\n"_s);
        }
        m_output.append(m_indent, "};\n\n"_s,
            m_indent, "template<typename T, typename S, typename V> __atomic_compare_exchange_result<S> __wgslAtomicCompareExchangeWeak(T atomic1, S compare, V value) {\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "auto innerCompare = compare; \n"_s,
                m_indent, "bool exchanged = atomic_compare_exchange_weak_explicit(atomic1, &innerCompare, value, memory_order_relaxed, memory_order_relaxed); \n"_s,
                m_indent, "return __atomic_compare_exchange_result<decltype(compare)> { innerCompare, exchanged }; \\\n"_s,
                m_indent, "}\n"_s);
        }
    }

    if (m_shaderModule.usesDot()) {
        m_output.append(m_indent, "template<typename T, unsigned N>\n"_s,
            m_indent, "static T __wgslDot(vec<T, N> lhs, vec<T, N> rhs)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "auto result = lhs[0] * rhs[0] + lhs[1] * rhs[1];\n"_s,
                m_indent, "if constexpr (N > 2) result += lhs[2] * rhs[2];\n"_s,
                m_indent, "if constexpr (N > 3) result += lhs[3] * rhs[3];\n"_s,
                m_indent, "return result;\n"_s);
        }
        m_output.append(m_indent, "}\n"_s);
    }

    if (m_shaderModule.usesDot4I8Packed()) {
        m_output.append(m_indent, "static int __wgslDot4I8Packed(uint lhs, uint rhs)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "auto vec1 = as_type<packed_char4>(lhs);"_s,
                m_indent, "auto vec2 = as_type<packed_char4>(rhs);"_s,
                m_indent, "return vec1[0] * vec2[0] + vec1[1] * vec2[1] + vec1[2] * vec2[2] + vec1[3] * vec2[3];"_s);
        }
        m_output.append(m_indent, "}\n"_s);
    }

    if (m_shaderModule.usesDot4U8Packed()) {
        m_output.append(m_indent, "static uint __wgslDot4U8Packed(uint lhs, uint rhs)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "auto vec1 = as_type<packed_uchar4>(lhs);"_s,
                m_indent, "auto vec2 = as_type<packed_uchar4>(rhs);"_s,
                m_indent, "return vec1[0] * vec2[0] + vec1[1] * vec2[1] + vec1[2] * vec2[2] + vec1[3] * vec2[3];"_s);
        }
        m_output.append(m_indent, "}\n"_s);
    }

    if (m_shaderModule.usesFirstLeadingBit()) {
        m_output.append(m_indent, "template<typename T>\n"_s,
            m_indent, "static T __wgslFirstLeadingBit(T e)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "if constexpr (is_signed_v<T>)\n"_s,
                m_indent, "    return select(T(31 - select(clz(e), clz(~e), e < T(0))), T(-1), e == T(0) || e == T(-1));\n"_s,
                m_indent, "else\n"_s,
                m_indent, "    return select(T(31 - clz(e)), T(-1), e == T(0));\n"_s);
        }
        m_output.append(m_indent, "}\n"_s);
    }

    if (m_shaderModule.usesFirstTrailingBit()) {
        m_output.append(m_indent, "template<typename T>\n"_s,
            m_indent, "static T __wgslFirstTrailingBit(T e)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "return select(ctz(e), T(-1), e == T(0));\n"_s);
        }
        m_output.append(m_indent, "}\n"_s);
    }

    if (m_shaderModule.usesSign()) {
        m_output.append(m_indent, "template<typename T>\n"_s,
            m_indent, "static T __wgslSign(T e)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "return select(select(T(-1), T(1), e > 0), T(0), e == 0);\n"_s);
        }
        m_output.append(m_indent, "}\n"_s);
    }

    if (m_shaderModule.usesExtractBits()) {
        m_output.append(m_indent, "template<typename T>\n"_s,
            m_indent, "static T __wgslExtractBits(T e, uint offset, uint count)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "auto o = min(offset, 32u);\n"_s,
                m_indent, "auto c = min(count, 32u - o);\n"_s,
                m_indent, "return select((T)0, extract_bits(e, min(o, 31u), c), c);\n"_s);
        }
        m_output.append(m_indent, "}\n"_s);
    }

    if (m_shaderModule.usesMin()) {
        m_output.append(m_indent, "static uint __attribute__((always_inline)) __wgslMin(uint a, uint b)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append("return min(a, b);\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);
    }

    if (m_shaderModule.usesFtoi()) {
        m_output.append(m_indent, "template <typename T, typename S>\n"_s,
            m_indent, "static T __wgslFtoi(S value)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "if constexpr (is_same_v<make_scalar_t<S>, half>)\n"_s);
            m_output.append(m_indent, "return T(select(clamp(value, max(S(numeric_limits<T>::min()), numeric_limits<S>::lowest()), numeric_limits<S>::max()), S(0), isnan(value)));\n"_s);
            m_output.append(m_indent, "else\n"_s);
            m_output.append(m_indent, "return T(select(clamp(value, S(numeric_limits<T>::min()), S(numeric_limits<T>::max() - ((128 << (!is_signed_v<T>)) - 1))), S(0), isnan(value)));\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);
    }

    if (m_shaderModule.usesInsertBits()) {
        m_output.append(m_indent, "template <typename T>\n"_s,
            m_indent, "static T __wgslInsertBits(T e, T newBits, unsigned offset, unsigned count)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "constexpr unsigned w = 8 * static_cast<unsigned>(sizeof(make_scalar_t<T>));\n"_s);
            m_output.append(m_indent, "const unsigned o = min(offset, w);\n"_s);
            m_output.append(m_indent, "const unsigned c = min(count, w - o);\n"_s);
            m_output.append(m_indent, "return insert_bits(e, newBits, min(o, w - 1), c);\n"_s);
        }
        m_output.append(m_indent, "}\n\n"_s);
    }

    if (m_shaderModule.usesZeroWorkgroupVar()) {
        m_output.append(m_indent, "template<typename T>\n"_s,
            m_indent, "static void __wgslZeroWorkgroupVar(threadgroup T& v)\n"_s,
            m_indent, "{\n"_s);
        {
            IndentationScope scope(m_indent);
            m_output.append(m_indent, "threadgroup char* p = (threadgroup char*)(&v);\n"_s);
            m_output.append(m_indent, "for (uint i = 0u; i < sizeof(T); i++)\n"_s);
            {
                IndentationScope scope(m_indent);
                m_output.append(m_indent, "p[i] = 0;\n"_s);
            }
        }
        m_output.append(m_indent, "}\n\n"_s);
    }

    m_shaderModule.clearUsesPackedVec3();
}

void FunctionDefinitionWriter::visit(AST::Function& functionDefinition)
{
    if (!m_visitedFunctions.add(&functionDefinition).isNewEntry)
        return;

    for (auto& callee : m_shaderModule.callGraph().callees(functionDefinition))
        visit(*callee.target);

    for (auto& attribute : functionDefinition.attributes()) {
        checkErrorAndVisit(attribute);
        m_body.append(' ');
    }

    if (functionDefinition.maybeReturnType())
        visit(functionDefinition.maybeReturnType()->inferredType());
    else
        m_body.append("void"_s);

    m_body.append(' ', functionDefinition.name(), '(');
    bool first = true;
    for (auto& parameter : functionDefinition.parameters()) {
        if (!first)
            m_body.append(", "_s);
        switch (parameter.role()) {
        case AST::ParameterRole::UserDefined:
        case AST::ParameterRole::PackedResource:
            checkErrorAndVisit(parameter);
            break;
        case AST::ParameterRole::StageIn:
            checkErrorAndVisit(parameter);
            m_body.append(" [[stage_in]]"_s);
            break;
        case AST::ParameterRole::BindGroup:
            visitArgumentBufferParameter(parameter);
            break;
        }
        first = false;
    }

    // Clear the flag set while serializing StageAttribute
    m_entryPointStage = std::nullopt;

    m_currentFunction = &functionDefinition;
    m_body.append(")\n"_s);
    checkErrorAndVisit(functionDefinition.body());

    m_body.append("\n\n"_s);

    m_currentFunction = nullptr;
}

void FunctionDefinitionWriter::visit(AST::Structure& structDecl)
{
    m_structRole = { structDecl.role() };
    m_body.append(m_indent, "struct "_s, structDecl.name(), " {\n"_s);
    {
        IndentationScope scope(m_indent);
        unsigned paddingID = 0;
        bool shouldPack = structDecl.role() == AST::StructureRole::PackedResource;
        const auto& addPadding = [&](unsigned paddingSize) {
            ASSERT(shouldPack);
            m_body.append(m_indent, "uint8_t __padding"_s, ++paddingID, '[', String::number(paddingSize), "]; \n"_s);
        };

        for (auto& member : structDecl.members()) {
            auto& name = member.name();
            auto* type = member.type().inferredType();
            if (isPrimitive(type, Types::Primitive::TextureExternal) || isPrimitiveReference(type, Types::Primitive::TextureExternal))  {
                decltype(std::declval<ConstantValue>().integerValue()) bindingIndex = 0;
                for (auto& attribute : member.attributes()) {
                    if (auto* bindingAttribute = dynamicDowncast<AST::BindingAttribute>(attribute)) {
                        if (auto bindingIndexValue = bindingAttribute->binding().constantValue()) {
                            bindingIndex = bindingIndexValue->integerValue();
                            break;
                        }
                    }
                }
                m_body.append(m_indent, "texture2d<float> __"_s, name, "_FirstPlane [[id("_s, bindingIndex, ")]];\n"_s,
                    m_indent, "texture2d<float> __"_s, name, "_SecondPlane [[id("_s, (bindingIndex + 1), ")]];\n"_s,
                    m_indent, "float3x2 __"_s, name, "_UVRemapMatrix [[id("_s, (bindingIndex + 2), ")]];\n"_s,
                    m_indent, "float4x3 __"_s, name, "_ColorSpaceConversionMatrix [[id("_s, (bindingIndex + 3), ")]];\n"_s);
                continue;
            }

            m_body.append(m_indent);

            // Check if this member has @builtin(clip_distances) attribute
            // Metal requires: float name [[clip_distance]] [N];
            bool isClipDistances = false;
            for (auto& attribute : member.attributes()) {
                if (auto* builtinAttr = dynamicDowncast<AST::BuiltinAttribute>(attribute)) {
                    if (builtinAttr->builtin() == Builtin::ClipDistances) {
                        isClipDistances = true;
                        break;
                    }
                }
            }

            if (isClipDistances) {
                // For clip_distances, generate: float name [[clip_distance]] [N];
                auto* arrayType = std::get_if<Types::Array>(member.type().inferredType());
                ASSERT(arrayType);
                visit(arrayType->element); // Generate float
                m_body.append(' ', name);

                // Generate attributes (e.g., [[clip_distance]])
                for (auto &attribute : member.attributes()) {
                    m_body.append(' ');
                    visit(attribute);
                }

                // Generate array subscript [N]
                m_body.append(" ["_s);
                if (auto* size = std::get_if<unsigned>(&arrayType->size))
                    m_body.append(*size);
                m_body.append(']');
            } else {
                visit(member.type().inferredType());
                m_body.append(' ', name);

                for (auto &attribute : member.attributes()) {
                    m_body.append(' ');
                    visit(attribute);
                }
            }
            m_body.append(";\n"_s);

            if (shouldPack && member.padding())
                addPadding(member.padding());
        }

        if (structDecl.role() == AST::StructureRole::VertexOutput || structDecl.role() == AST::StructureRole::FragmentOutput) {
            m_body.append('\n', m_indent, "template<typename T>\n"_s,
                m_indent, structDecl.name(), "(const thread T& other)\n"_s);
            {
                IndentationScope scope(m_indent);
                char prefix = ':';

                // First pass: initialize non-clip_distances members in initializer list
                for (auto& member : structDecl.members()) {
                    // Check if this is a clip_distances member
                    bool isClipDistances = false;
                    for (auto& attribute : member.attributes()) {
                        if (auto* builtinAttr = dynamicDowncast<AST::BuiltinAttribute>(attribute)) {
                            if (builtinAttr->builtin() == Builtin::ClipDistances) {
                                isClipDistances = true;
                                break;
                            }
                        }
                    }

                    if (isClipDistances)
                        continue; // Skip C-style arrays in member initializer list

                    auto& name = member.name();
                    m_body.append(m_indent, prefix, ' ', name, "(other."_s, name, ")\n"_s);
                    prefix = ',';
                }
            }
            m_body.append(m_indent, "{\n"_s);
            {
                IndentationScope scope(m_indent);

                // Second pass: copy clip_distances arrays in constructor body
                for (auto& member : structDecl.members()) {
                    bool isClipDistances = false;
                    for (auto& attribute : member.attributes()) {
                        if (auto* builtinAttr = dynamicDowncast<AST::BuiltinAttribute>(attribute)) {
                            if (builtinAttr->builtin() == Builtin::ClipDistances) {
                                isClipDistances = true;
                                break;
                            }
                        }
                    }

                    if (isClipDistances) {
                        auto& name = member.name();
                        auto* arrayType = std::get_if<Types::Array>(member.type().inferredType());
                        ASSERT(arrayType);

                        // Generate: for (unsigned i = 0; i < N; ++i) field5[i] = other.field5[i];
                        m_body.append(m_indent, "for (unsigned __i = 0; __i < "_s);
                        if (auto* size = std::get_if<unsigned>(&arrayType->size))
                            m_body.append(*size);
                        m_body.append("; ++__i) "_s, name, "[__i] = other."_s, name, "[__i];\n"_s);
                    }
                }
            }
            m_body.append(m_indent, "}\n"_s);
        } else if (structDecl.role() == AST::StructureRole::FragmentOutputWrapper || structDecl.role() == AST::StructureRole::VertexOutputWrapper) {
            ASSERT(structDecl.members().size() == 1);
            auto& member = structDecl.members()[0];

            m_body.append('\n', m_indent, "template<typename T>\n"_s,
                m_indent, structDecl.name(), "(T value)\n"_s);
            {
                IndentationScope scope(m_indent);
                m_body.append(m_indent, ": "_s, member.name(), "(value)\n"_s);
            }
            m_body.append(m_indent, "{ }\n"_s);
        }
    }
    m_body.append(m_indent, "};\n\n"_s);

    if (structDecl.role() == AST::StructureRole::PackedResource) {
        m_body.append(m_indent, "template<> struct __PackedTypeImpl<"_s, structDecl.original()->name(), "> { using Type = "_s, structDecl.name(), "; };\n"_s);
        m_body.append(m_indent, "template<> struct __UnpackedTypeImpl<"_s, structDecl.name(), "> { using Type = "_s, structDecl.original()->name(), "; };\n\n"_s);
    }

    m_structRole = std::nullopt;

    if (structDecl.role() == AST::StructureRole::BindGroup) {
        for (auto& member : structDecl.members()) {
            auto* type = member.type().inferredType();
            if (auto* reference = std::get_if<Types::Reference>(type))
                type = reference->element;
            if (auto maybeSize = type->maybeSize(); maybeSize && *maybeSize < std::numeric_limits<unsigned>::max())
                m_body.append(m_indent, "static_assert(sizeof("_s, structDecl.name(), "::"_s, member.name(), ") == "_s, *maybeSize, ");\n\n"_s);
        }
    }

}

void FunctionDefinitionWriter::generatePackingHelpers(AST::Structure& structure)
{
    if (structure.role() != AST::StructureRole::PackedResource || !structure.inferredType()->isConstructible())
        return;

    const String& packedName = structure.name();
    auto unpackedName = structure.original()->name();

    m_body.append(m_indent, "static __attribute__((always_inline)) "_s, packedName, " __pack("_s, unpackedName, " unpacked)\n"_s,
        m_indent, "{\n"_s);
    {
        IndentationScope scope(m_indent);
        m_body.append(m_indent, packedName, " packed;\n"_s);
        for (auto& member : structure.members()) {
            auto& name = member.name();
            auto* memberType = member.type().inferredType();
            bool needsPack = memberType->packing() & (Packing::PStruct | Packing::PArray);
            if (!needsPack) {
                if (auto* matrix = std::get_if<Types::Matrix>(memberType))
                    needsPack = matrix->rows == 3;
            }
            if (needsPack)
                m_body.append(m_indent, "packed."_s, name, " = __pack(unpacked."_s, name, ");\n"_s);
            else
                m_body.append(m_indent, "packed."_s, name, " = unpacked."_s, name, ";\n"_s);
        }
        m_body.append(m_indent, "return packed;\n"_s);
    }
    m_body.append(m_indent, "}\n\n"_s,
        m_indent, "static "_s, unpackedName, " __unpack("_s, packedName, " packed)\n"_s,
        m_indent, "{\n"_s);
    {
        IndentationScope scope(m_indent);
        m_body.append(m_indent, unpackedName, " unpacked;\n"_s);
        for (auto& member : structure.members()) {
            auto& name = member.name();
            auto* memberType = member.type().inferredType();
            bool needsUnpack = memberType->packing() & (Packing::PStruct | Packing::PArray);
            if (!needsUnpack) {
                if (auto* matrix = std::get_if<Types::Matrix>(memberType))
                    needsUnpack = matrix->rows == 3;
            }
            if (needsUnpack)
                m_body.append(m_indent, "unpacked."_s, name, " = __unpack(packed."_s, name, ");\n"_s);
            else
                m_body.append(m_indent, "unpacked."_s, name, " = packed."_s, name, ";\n"_s);
        }
        m_body.append(m_indent, "return unpacked;\n"_s);
    }
    m_body.append(m_indent, "}\n\n"_s);
}

bool FunctionDefinitionWriter::shouldPackType() const
{
    if (m_structRole.has_value() && (*m_structRole == AST::StructureRole::PackedResource || *m_structRole == AST::StructureRole::BindGroup))
        return true;
    if (m_variableRole.has_value() && *m_variableRole == AST::VariableRole::PackedResource)
        return true;
    if (m_parameterRole.has_value() && (*m_parameterRole == AST::ParameterRole::PackedResource))
        return true;
    return false;
}

bool FunctionDefinitionWriter::emitPackedVector(const Types::Vector& vector, bool shouldPack)
{
    if (!shouldPack)
        return false;

    // The only vectors that need to be packed are the vectors with 3 elements,
    // because their size differs between Metal and WGSL (4 * element size vs
    // 3 * element size, respectively)
    if (vector.size != 3)
        return false;

    auto& primitive = std::get<Types::Primitive>(*vector.element);
    switch (primitive.kind) {
    case Types::Primitive::AbstractInt:
    case Types::Primitive::I32:
        m_body.append("packed_int"_s, vector.size);
        break;
    case Types::Primitive::U32:
        m_body.append("packed_uint"_s, vector.size);
        break;
    case Types::Primitive::AbstractFloat:
    case Types::Primitive::F32:
        m_body.append("packed_float"_s, vector.size);
        break;
    case Types::Primitive::F16:
        m_body.append("packed_half"_s, vector.size);
        break;
    case Types::Primitive::Bool:
    case Types::Primitive::Void:
    case Types::Primitive::Sampler:
    case Types::Primitive::SamplerComparison:
    case Types::Primitive::TextureExternal:
    case Types::Primitive::AccessMode:
    case Types::Primitive::TexelFormat:
    case Types::Primitive::AddressSpace:
        RELEASE_ASSERT_NOT_REACHED();
    }
    return true;
}

void FunctionDefinitionWriter::visit(AST::Variable& variable)
{
    serializeVariable(variable);
}

void FunctionDefinitionWriter::visit(AST::ConstAssert&)
{
    // const_assert should not generate any code
}

void FunctionDefinitionWriter::serializeVariable(AST::Variable& variable)
{
    if (variable.flavor() == AST::VariableFlavor::Const)
        return;

    auto variableRoleScope = SetForScope(m_variableRole, std::optional<AST::VariableRole> { variable.role() });

    const Type* type = variable.storeType();
    if (isPrimitiveReference(type, Types::Primitive::TextureExternal)) {
        ASSERT(variable.maybeInitializer());
        m_body.append("texture_external "_s, variable.name(), " { "_s);
        visit(*variable.maybeInitializer());
        m_body.append("_FirstPlane, "_s);
        visit(*variable.maybeInitializer());
        m_body.append("_SecondPlane, "_s);
        visit(*variable.maybeInitializer());
        m_body.append("_UVRemapMatrix, "_s);
        visit(*variable.maybeInitializer());
        m_body.append("_ColorSpaceConversionMatrix }"_s);
        return;
    }

    if (auto* qualifier = variable.maybeQualifier()) {
        switch (qualifier->addressSpace()) {
        case AddressSpace::Workgroup:
            m_body.append("threadgroup "_s);
            break;
        case AddressSpace::Function:
        case AddressSpace::Handle:
        case AddressSpace::Private:
        case AddressSpace::Storage:
        case AddressSpace::Uniform:
            break;
        }
    }

    visit(type);
    m_body.append(' ', variable.name());

    if (variable.flavor() == AST::VariableFlavor::Override)
        return;

    if (auto* initializer = variable.maybeInitializer()) {
        m_body.append(" = "_s);
        visit(type, *initializer);
    } else
        m_body.append(" { }"_s);
}

void FunctionDefinitionWriter::visit(AST::Attribute& attribute)
{
    AST::Visitor::visit(attribute);
}

void FunctionDefinitionWriter::visit(AST::BuiltinAttribute& builtin)
{
    // Built-in attributes are only valid for parameters. If a struct member originally
    // had a built-in attribute it must have already been hoisted into a parameter, but
    // we keep the original struct so we can reconstruct it.
    if (m_structRole.has_value() && *m_structRole != AST::StructureRole::VertexOutput && *m_structRole != AST::StructureRole::VertexOutputWrapper && *m_structRole != AST::StructureRole::FragmentOutput && *m_structRole != AST::StructureRole::FragmentOutputWrapper)
        return;

    switch (builtin.builtin()) {
    case Builtin::ClipDistances:
        m_body.append("[[clip_distance]]"_s);
        break;
    case Builtin::FragDepth:
        m_body.append("[[depth(any)]]"_s);
        break;
    case Builtin::FrontFacing:
        m_body.append("[[front_facing]]"_s);
        break;
    case Builtin::GlobalInvocationId:
        m_body.append("[[thread_position_in_grid]]"_s);
        break;
    case Builtin::InstanceIndex:
        m_body.append("[[instance_id]]"_s);
        break;
        break;
    case Builtin::LocalInvocationId:
        m_body.append("[[thread_position_in_threadgroup]]"_s);
        break;
    case Builtin::LocalInvocationIndex:
        m_body.append("[[thread_index_in_threadgroup]]"_s);
        break;
    case Builtin::NumWorkgroups:
        m_body.append("[[threadgroups_per_grid]]"_s);
        break;
    case Builtin::Position:
        m_body.append("[[position]]"_s);
        break;
    case Builtin::PrimitiveIndex:
        m_body.append("[[primitive_id]]"_s);
        break;
    case Builtin::SampleIndex:
        m_body.append("[[sample_id]]"_s);
        break;
    case Builtin::SampleMask:
        m_body.append("[[sample_mask]]"_s);
        break;
    case Builtin::SubgroupInvocationId:
        m_body.append("[[thread_index_in_simdgroup]]"_s);
        break;
    case Builtin::SubgroupSize:
        m_body.append("[[threads_per_simdgroup]]"_s);
        break;
    case Builtin::SubgroupId:
        m_body.append("[[simdgroup_index_in_threadgroup]]"_s);
        break;
    case Builtin::NumSubgroups:
        m_body.append("[[simdgroups_per_threadgroup]]"_s);
        break;
    case Builtin::VertexIndex:
        m_body.append("[[vertex_id]]"_s);
        break;
    case Builtin::WorkgroupId:
        m_body.append("[[threadgroup_position_in_grid]]"_s);
        break;
    }
}

void FunctionDefinitionWriter::visit(AST::StageAttribute& stage)
{
    m_entryPointStage = { stage.stage() };
    switch (stage.stage()) {
    case ShaderStage::Vertex:
        m_body.append("[[vertex]]"_s);
        break;
    case ShaderStage::Fragment:
        m_body.append("[[fragment]]"_s);
        break;
    case ShaderStage::Compute:
        m_body.append("[[kernel]]"_s);
        break;
    }
}

void FunctionDefinitionWriter::visit(AST::GroupAttribute& group)
{
    unsigned bufferIndex = group.group().constantValue()->integerValue();
    if (m_entryPointStage.has_value() && *m_entryPointStage == ShaderStage::Vertex) {
        ASSERT(m_shaderModule.configuration().maxBuffersPlusVertexBuffersForVertexStage > 0);
        auto max = m_shaderModule.configuration().maxBuffersPlusVertexBuffersForVertexStage - 1;
        bufferIndex = vertexBufferIndexForBindGroup(bufferIndex, max);
    }
    m_body.append("[[buffer("_s, bufferIndex, ")]]"_s);
}

void FunctionDefinitionWriter::visit(AST::BindingAttribute& binding)
{
    m_body.append("[[id("_s, binding.binding().constantValue()->integerValue(), ")]]"_s);
}

void FunctionDefinitionWriter::visit(AST::LocationAttribute& location)
{
    if (m_structRole.has_value()) {
        auto role = *m_structRole;
        switch (role) {
        case AST::StructureRole::VertexOutput:
        case AST::StructureRole::FragmentInput:
        case AST::StructureRole::VertexOutputWrapper:
            m_body.append("[[user(loc"_s, location.location().constantValue()->integerValue(), ")]]"_s);
            return;
        case AST::StructureRole::BindGroup:
        case AST::StructureRole::UserDefined:
        case AST::StructureRole::ComputeInput:
        case AST::StructureRole::UserDefinedResource:
        case AST::StructureRole::PackedResource:
            return;
        case AST::StructureRole::FragmentOutputWrapper:
        case AST::StructureRole::FragmentOutput:
            m_body.append("[[color("_s, location.location().constantValue()->integerValue(), ")]]"_s);
            return;
        case AST::StructureRole::VertexInput:
            m_body.append("[[attribute("_s, location.location().constantValue()->integerValue(), ")]]"_s);
            break;
        }
    }
}

void FunctionDefinitionWriter::visit(AST::WorkgroupSizeAttribute&)
{
    // This attribute shouldn't generate any code. The workgroup size is passed
    // to the API through the EntryPointInformation.
}

void FunctionDefinitionWriter::visit(AST::SizeAttribute&)
{
    // This attribute shouldn't generate any code. The size is used when serializing
    // structs.
}

void FunctionDefinitionWriter::visit(AST::AlignAttribute&)
{
    // This attribute shouldn't generate any code. The alignment is used when
    // serializing structs.
}

static ASCIILiteral convertToSampleMode(InterpolationType type, InterpolationSampling sampleType)
{
    switch (type) {
    case InterpolationType::Flat:
        return "flat"_s;
    case InterpolationType::Linear:
        switch (sampleType) {
        case InterpolationSampling::First:
        case InterpolationSampling::Either:
            RELEASE_ASSERT_NOT_REACHED();
        case InterpolationSampling::Center:
            return "center_no_perspective"_s;
        case InterpolationSampling::Centroid:
            return "centroid_no_perspective"_s;
        case InterpolationSampling::Sample:
            return "sample_no_perspective"_s;
        }
    case InterpolationType::Perspective:
        switch (sampleType) {
        case InterpolationSampling::First:
        case InterpolationSampling::Either:
            RELEASE_ASSERT_NOT_REACHED();
        case InterpolationSampling::Center:
            return "center_perspective"_s;
        case InterpolationSampling::Centroid:
            return "centroid_perspective"_s;
        case InterpolationSampling::Sample:
            return "sample_perspective"_s;
        }
    }

    ASSERT_NOT_REACHED();
    return "flat"_s;
}

void FunctionDefinitionWriter::visit(AST::InterpolateAttribute& attribute)
{
    m_body.append("[["_s, convertToSampleMode(attribute.type(), attribute.sampling()), "]]"_s);
}

void FunctionDefinitionWriter::visit(AST::InvariantAttribute&)
{
    if (!m_structRole.has_value() || (*m_structRole != AST::StructureRole::VertexOutput && *m_structRole != AST::StructureRole::VertexOutputWrapper))
        return;

    m_body.append("[[invariant]]"_s);
}

// Types
void FunctionDefinitionWriter::visit(const Type* type, bool shouldPack)
{
    using namespace WGSL::Types;

    shouldPack |= shouldPackType();

    WTF::switchOn(*type,
        [&](const Primitive& primitive) {
            switch (primitive.kind) {
            case Types::Primitive::AbstractInt:
            case Types::Primitive::I32:
                m_body.append("int"_s);
                break;
            case Types::Primitive::U32:
                m_body.append("unsigned"_s);
                break;
            case Types::Primitive::AbstractFloat:
            case Types::Primitive::F32:
                m_body.append("float"_s);
                break;
            case Types::Primitive::F16:
                m_body.append("half"_s);
                break;
            case Types::Primitive::Void:
            case Types::Primitive::Bool:
            case Types::Primitive::Sampler:
                m_body.append(*type);
                break;
            case Types::Primitive::SamplerComparison:
                m_body.append("sampler"_s);
                break;
            case Types::Primitive::TextureExternal:
                m_body.append("texture_external"_s);
                break;
            case Types::Primitive::AccessMode:
            case Types::Primitive::TexelFormat:
            case Types::Primitive::AddressSpace:
                RELEASE_ASSERT_NOT_REACHED();
            }
        },
        [&](const Vector& vector) {
            if (emitPackedVector(vector, shouldPack))
                return;
            m_body.append("vec<"_s);
            visit(vector.element, shouldPack);
            m_body.append(", "_s, vector.size, '>');
        },
        [&](const Matrix& matrix) {
            if (shouldPack && matrix.rows == 3) {
                m_body.append("PackedMatrix<"_s);
                visit(matrix.element, shouldPack);
                m_body.append(", "_s, matrix.columns, '>');
            } else {
                m_body.append("matrix<"_s);
                visit(matrix.element, shouldPack);
                m_body.append(", "_s, matrix.columns, ", "_s, matrix.rows, '>');
            }
        },
        [&](const Array& array) {
            m_body.append("array<"_s);
            auto* vector = std::get_if<Types::Vector>(array.element);
            if (vector && vector->size == 3 && shouldPack) {
                m_body.append("PackedVec3<"_s);
                visit(vector->element, shouldPack);
                m_body.append(">"_s);
            } else
                visit(array.element, shouldPack);
            m_body.append(", "_s);
            WTF::switchOn(array.size,
                [&](unsigned size) { m_body.append(size); },
                [&](std::monostate) { m_body.append(1); },
                [&](AST::Expression* size) {
                    visit(*size);
                });
            m_body.append('>');
        },
        [&](const Struct& structure) {
            if (shouldPack && structure.structure.role() == AST::StructureRole::UserDefinedResource)
                m_body.append("__PackedType<"_s, structure.structure.name(), ">"_s);
            else
                m_body.append(structure.structure.name());
        },
        [&](const PrimitiveStruct& structure) {
            m_body.append(structure.name, '<');
            bool first = true;
            for (auto& value : structure.values) {
                if (!first)
                    m_body.append(", "_s);
                first = false;
                visit(value, shouldPack);
            }
            m_body.append('>');
        },
        [&](const Texture& texture) {
            ASCIILiteral type;
            ASCIILiteral access = "sample"_s;
            switch (texture.kind) {
            case Types::Texture::Kind::Texture1d:
                type = "texture1d"_s;
                break;
            case Types::Texture::Kind::Texture2d:
                type = "texture2d"_s;
                break;
            case Types::Texture::Kind::Texture2dArray:
                type = "texture2d_array"_s;
                break;
            case Types::Texture::Kind::Texture3d:
                type = "texture3d"_s;
                break;
            case Types::Texture::Kind::TextureCube:
                type = "texturecube"_s;
                break;
            case Types::Texture::Kind::TextureCubeArray:
                type = "texturecube_array"_s;
                break;
            case Types::Texture::Kind::TextureMultisampled2d:
                type = "texture2d_ms"_s;
                access = "read"_s;
                break;
            }
            m_body.append(type, '<');
            visit(texture.element, shouldPack);
            m_body.append(", access::"_s, access, '>');
        },
        [&](const TextureStorage& texture) {
            ASCIILiteral base;
            ASCIILiteral mode;
            switch (texture.kind) {
            case Types::TextureStorage::Kind::TextureStorage1d:
                base = "texture1d"_s;
                break;
            case Types::TextureStorage::Kind::TextureStorage2d:
                base = "texture2d"_s;
                break;
            case Types::TextureStorage::Kind::TextureStorage2dArray:
                base = "texture2d_array"_s;
                break;
            case Types::TextureStorage::Kind::TextureStorage3d:
                base = "texture3d"_s;
                break;
            }
            switch (texture.access) {
            case AccessMode::Read:
                mode = "read"_s;
                break;
            case AccessMode::Write:
                mode = "write"_s;
                break;
            case AccessMode::ReadWrite:
                mode = "read_write"_s;
                break;
            }
            m_body.append(base, '<');
            visit(shaderTypeForTexelFormat(texture.format, m_shaderModule.types()));
            m_body.append(", access::"_s, mode, '>');
        },
        [&](const TextureDepth& texture) {
            ASCIILiteral base;
            switch (texture.kind) {
            case TextureDepth::Kind::TextureDepth2d:
                base = "depth2d"_s;
                break;
            case TextureDepth::Kind::TextureDepth2dArray:
                base = "depth2d_array"_s;
                break;
            case TextureDepth::Kind::TextureDepthCube:
                base = "depthcube"_s;
                break;
            case TextureDepth::Kind::TextureDepthCubeArray:
                base = "depthcube_array"_s;
                break;
            case TextureDepth::Kind::TextureDepthMultisampled2d:
                base = "depth2d_ms"_s;
                break;
            }
            m_body.append(base, "<float>"_s);
        },
        [&](const Reference& reference) {
            auto addressSpace = serializeAddressSpace(reference.addressSpace);
            if (addressSpace.isNull()) {
                visit(reference.element);
                return;
            }
            if (reference.accessMode == AccessMode::Read)
                m_body.append("const "_s);
            m_body.append(addressSpace, ' ');
            visit(reference.element);
            m_body.append('&');
        },
        [&](const Pointer& pointer) {
            auto addressSpace = serializeAddressSpace(pointer.addressSpace);
            if (pointer.accessMode == AccessMode::Read)
                m_body.append("const "_s);
            if (addressSpace)
                m_body.append(addressSpace, ' ');
            bool shouldPack = pointer.addressSpace == AddressSpace::Storage || pointer.addressSpace == AddressSpace::Uniform;
            visit(pointer.element, shouldPack);
            m_body.append('*');
        },
        [&](const Atomic& atomic) {
            if (atomic.element == m_shaderModule.types().i32Type())
                m_body.append("atomic_int"_s);
            else
                m_body.append("atomic_uint"_s);
        },
        [&](const Function&) {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const TypeConstructor&) {
            RELEASE_ASSERT_NOT_REACHED();
        });
}

void FunctionDefinitionWriter::visit(AST::Parameter& parameter)
{
    auto parameterRoleScope = SetForScope(m_parameterRole, parameter.role());
    visit(parameter.typeName().inferredType());
    m_body.append(' ', parameter.name());
    for (auto& attribute : parameter.attributes()) {
        m_body.append(' ');
        checkErrorAndVisit(attribute);
    }
}

void FunctionDefinitionWriter::visitArgumentBufferParameter(AST::Parameter& parameter)
{
    m_body.append("constant "_s);
    visit(parameter.typeName().inferredType());
    m_body.append("& "_s, parameter.name());
    for (auto& attribute : parameter.attributes()) {
        m_body.append(' ');
        checkErrorAndVisit(attribute);
    }
}

void FunctionDefinitionWriter::visit(AST::Expression& expression)
{
    visit(expression.inferredType(), expression);
}

bool FunctionDefinitionWriter::outlineConstant(const Type* type, AST::Expression& expression)
{
    auto constantValue = expression.constantValue();
    if (!constantValue)
        return false;

    auto* maybeArrayValue = std::get_if<ConstantArray>(&*constantValue);
    if (!maybeArrayValue)
        return false;

    auto constantName = makeString("__wgslConst"_s, m_constID++);

    std::swap(m_body, m_constants);

    m_body.append("const constant "_s);
    visit(type);
    m_body.append(' ', constantName, " = "_s);
    serializeConstant(type, *constantValue);
    m_body.append(";\n"_s);

    std::swap(m_body, m_constants);

    m_body.append(constantName);
    return true;
}

void FunctionDefinitionWriter::visit(const Type* type, AST::Expression& expression)
{
    if (outlineConstant(type, expression))
        return;

    if (auto constantValue = expression.constantValue()) {
        serializeConstant(type, *constantValue);
        return;
    }

    if (auto* call = dynamicDowncast<AST::CallExpression>(expression))
        visit(type, *call);
    else if (auto* identity = dynamicDowncast<AST::IdentityExpression>(expression))
        visit(type, identity->expression());
    else
        AST::Visitor::visit(expression);
}

static void visitArguments(FunctionDefinitionWriter* writer, AST::CallExpression& call, unsigned startOffset = 0)
{
    writer->stringBuilder().append('(');
    for (unsigned i = startOffset; i < call.arguments().size(); ++i) {
        if (i != startOffset)
            writer->stringBuilder().append(", "_s);
        writer->visit(call.arguments()[i]);
    }
    writer->stringBuilder().append(')');
}

static void emitTextureDimensions(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    const auto* vector = std::get_if<Types::Vector>(call.inferredType());
    const auto& get = [&](ASCIILiteral property) {
        writer->visit(call.arguments()[0]);
        writer->stringBuilder().append(".get_"_s, property, '(');
        if (vector && call.arguments().size() > 1) {
            writer->stringBuilder().append("min("_s);
            writer->visit(call.arguments()[0]);
            writer->stringBuilder().append(".get_num_mip_levels() - 1, uint("_s);
            writer->visit(call.arguments()[1]);
            writer->stringBuilder().append(')');
            writer->stringBuilder().append(')');
        }
        writer->stringBuilder().append(')');
    };

    if (!vector) {
        get("width"_s);
        return;
    }

    auto size = vector->size;
    ASSERT(size >= 2 && size <= 3);
    writer->stringBuilder().append("uint"_s, String::number(size), '(');
    get("width"_s);
    writer->stringBuilder().append(", "_s);
    get("height"_s);
    if (size > 2) {
        writer->stringBuilder().append(", "_s);
        get("depth"_s);
    }
    writer->stringBuilder().append(')');
}

static void emitTextureGather(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    ASSERT(call.arguments().size() > 1);
    unsigned offset = 0;
    ASCIILiteral component;
    bool hasOffset = true;
    auto& firstArgument = call.arguments()[0];
    if (std::holds_alternative<Types::Primitive>(*firstArgument.inferredType())) {
        offset = 1;
        switch (firstArgument.constantValue()->integerValue()) {
        case 0:
            component = "x"_s;
            break;
        case 1:
            component = "y"_s;
            break;
        case 2:
            component = "z"_s;
            break;
        case 3:
            component = "w"_s;
            break;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }

        auto& textureType = std::get<Types::Texture>(*call.arguments()[1].inferredType());
        if (textureType.kind == Types::Texture::Kind::Texture2d || textureType.kind == Types::Texture::Kind::Texture2dArray) {
            auto& lastArgument = call.arguments().last();
            auto* vectorType = std::get_if<Types::Vector>(lastArgument.inferredType());
            if (!vectorType || !satisfies(vectorType->element, Constraints::Integer))
                hasOffset = false;
        }
    }
    writer->visit(call.arguments()[offset]);
    writer->stringBuilder().append(".gather("_s);
    for (unsigned i = offset + 1; i < call.arguments().size(); ++i) {
        if (i != offset + 1)
            writer->stringBuilder().append(", "_s);
        writer->visit(call.arguments()[i]);
    }
    if (!hasOffset)
        writer->stringBuilder().append(", int2(0)"_s);
    if (!component.isNull())
        writer->stringBuilder().append(", component::"_s, component);
    writer->stringBuilder().append(')');
}

static void emitTextureGatherCompare(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    ASSERT(call.arguments().size() > 1);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(".gather_compare"_s);
    visitArguments(writer, call, 1);
}

static void emitTextureLoad(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    auto& texture = call.arguments()[0];
    auto* textureType = texture.inferredType();

    auto* primitive = std::get_if<Types::Primitive>(textureType);
    bool isExternalTexture = primitive && primitive->kind == Types::Primitive::TextureExternal;
    if (!isExternalTexture) {
        writer->visit(call.arguments()[0]);
        writer->stringBuilder().append(".read"_s);
        writer->stringBuilder().append('(');
        bool is1d = true;
        auto cast = "uint"_s;
        if (const auto* vector = std::get_if<Types::Vector>(call.arguments()[1].inferredType())) {
            is1d = false;
            switch (vector->size) {
            case 2:
                cast = "uint2"_s;
                break;
            case 3:
                cast = "uint3"_s;
                break;
            default:
                RELEASE_ASSERT_NOT_REACHED();
            }
        }
        bool first = true;
        auto argumentCount = call.arguments().size();
        for (unsigned i = 1; i < argumentCount; ++i) {
            if (first) {
                writer->stringBuilder().append(cast, '(');
                writer->visit(call.arguments()[i]);
                writer->stringBuilder().append(')');
            } else if (is1d && i == argumentCount - 1) {
                // From the MSL spec for texture1d::read:
                // > Since mipmaps are not supported for 1D textures, lod must be 0.
                continue;
            } else {
                writer->stringBuilder().append(", "_s);
                writer->visit(call.arguments()[i]);
            }
            first = false;
        }
        writer->stringBuilder().append(')');
        return;
    }

    auto& coordinates = call.arguments()[1];
    writer->stringBuilder().append("({\n"_s);
    {
        IndentationScope scope(writer->indent());
        {
            writer->stringBuilder().append(writer->indent(), "auto __coords = uint2(("_s);
            writer->visit(texture);
            writer->stringBuilder().append(".UVRemapMatrix * float3(float2("_s);
            writer->visit(coordinates);
            writer->stringBuilder().append("), 1)).xy);\n"_s);
        }
        {
            writer->stringBuilder().append(writer->indent(), "auto __y = float("_s);
            writer->visit(texture);
            writer->stringBuilder().append(".FirstPlane.read(__coords).r);\n"_s);
        }
        {
            writer->stringBuilder().append(writer->indent(), "auto __xAdjustment = "_s);
            writer->visit(texture);
            writer->stringBuilder().append(writer->indent(), ".SecondPlane.get_width(0) / static_cast<float>("_s);
            writer->visit(texture);
            writer->stringBuilder().append(writer->indent(), ".FirstPlane.get_width(0));"_s);

            writer->stringBuilder().append(writer->indent(), "auto __yAdjustment = "_s);
            writer->visit(texture);
            writer->stringBuilder().append(writer->indent(), ".SecondPlane.get_height(0) / static_cast<float>("_s);
            writer->visit(texture);
            writer->stringBuilder().append(writer->indent(), ".FirstPlane.get_height(0));"_s);

            writer->stringBuilder().append(writer->indent(), "auto __cbcr = float2("_s);
            writer->visit(texture);
            writer->stringBuilder().append(".SecondPlane.read(uint2(uint(__coords.x * __xAdjustment), uint(__coords.y * __yAdjustment))).rg);\n"_s);
        }
        writer->stringBuilder().append(writer->indent(), "auto __ycbcr = float3(__y, __cbcr);\n"_s);
        {
            writer->stringBuilder().append(writer->indent(), "float4("_s);
            writer->visit(texture);
            writer->stringBuilder().append(".ColorSpaceConversionMatrix * float4(__ycbcr, 1), 1);\n"_s);
        }
    }
    writer->stringBuilder().append(writer->indent(), "})"_s);
}

static void emitTextureSample(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    ASSERT(call.arguments().size() > 1);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(".sample"_s);
    visitArguments(writer, call, 1);
}

static void emitTextureSampleCompare(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    ASSERT(call.arguments().size() > 1);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(".sample_compare"_s);
    visitArguments(writer, call, 1);
}

static void emitTextureSampleGrad(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{

    ASSERT(call.arguments().size() > 1);
    auto& texture = call.arguments()[0];
    auto& textureType = std::get<Types::Texture>(*texture.inferredType());

    unsigned gradientIndex;
    ASCIILiteral gradientFunction;
    switch (textureType.kind) {
    case Types::Texture::Kind::Texture1d:
    case Types::Texture::Kind::Texture2d:
    case Types::Texture::Kind::TextureMultisampled2d:
        gradientIndex = 3;
        gradientFunction = "gradient2d"_s;
        break;

    case Types::Texture::Kind::Texture3d:
        gradientIndex = 3;
        gradientFunction = "gradient3d"_s;
        break;

    case Types::Texture::Kind::TextureCube:
        gradientIndex = 3;
        gradientFunction = "gradientcube"_s;
        break;

    case Types::Texture::Kind::Texture2dArray:
        gradientIndex = 4;
        gradientFunction = "gradient2d"_s;
        break;

    case Types::Texture::Kind::TextureCubeArray:
        gradientIndex = 4;
        gradientFunction = "gradientcube"_s;
        break;
    }
    writer->visit(texture);
    writer->stringBuilder().append(".sample("_s);
    for (unsigned i = 1; i < gradientIndex; ++i) {
        if (i != 1)
            writer->stringBuilder().append(", "_s);
        writer->visit(call.arguments()[i]);
    }
    writer->stringBuilder().append(", "_s, gradientFunction, '(');
    writer->visit(call.arguments()[gradientIndex]);
    writer->stringBuilder().append(", "_s);
    writer->visit(call.arguments()[gradientIndex + 1]);
    writer->stringBuilder().append(')');
    for (unsigned i = gradientIndex + 2; i < call.arguments().size(); ++i) {
        writer->stringBuilder().append(", "_s);
        writer->visit(call.arguments()[i]);
    }
    writer->stringBuilder().append(')');
}

static void emitTextureSampleLevel(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    bool isArray = false;
    bool is1d = false;
    auto& texture = call.arguments()[0];
    if (auto* textureType = std::get_if<Types::Texture>(texture.inferredType())) {
        switch (textureType->kind) {
        case Types::Texture::Kind::Texture2dArray:
        case Types::Texture::Kind::TextureCubeArray:
            isArray = true;
            break;
        case Types::Texture::Kind::Texture1d:
            is1d = true;
            break;
        case Types::Texture::Kind::Texture2d:
        case Types::Texture::Kind::Texture3d:
        case Types::Texture::Kind::TextureCube:
        case Types::Texture::Kind::TextureMultisampled2d:
            break;
        }
    } else if (auto* textureStorageType = std::get_if<Types::TextureStorage>(texture.inferredType())) {
        switch (textureStorageType->kind) {
        case Types::TextureStorage::Kind::TextureStorage2dArray:
            isArray = true;
            break;
        case Types::TextureStorage::Kind::TextureStorage1d:
            is1d = true;
            break;
        case Types::TextureStorage::Kind::TextureStorage2d:
        case Types::TextureStorage::Kind::TextureStorage3d:
            break;
        }
    } else {
        auto& textureDepthType = std::get<Types::TextureDepth>(*texture.inferredType());
        switch (textureDepthType.kind) {
        case Types::TextureDepth::Kind::TextureDepth2dArray:
        case Types::TextureDepth::Kind::TextureDepthCubeArray:
            isArray = true;
            break;
        case Types::TextureDepth::Kind::TextureDepth2d:
        case Types::TextureDepth::Kind::TextureDepthCube:
        case Types::TextureDepth::Kind::TextureDepthMultisampled2d:
            break;
        }
    }

    unsigned levelIndex = isArray ? 4 : 3;
    writer->visit(texture);
    writer->stringBuilder().append(".sample("_s);
    for (unsigned i = 1; i < levelIndex; ++i) {
        if (i != 1)
            writer->stringBuilder().append(',');
        writer->visit(call.arguments()[i]);
    }
    if (!is1d) {
        writer->stringBuilder().append(", level("_s);
        writer->visit(call.arguments()[levelIndex]);
        writer->stringBuilder().append(')');
    }
    for (unsigned i = levelIndex + 1; i < call.arguments().size(); ++i) {
        writer->stringBuilder().append(',');
        writer->visit(call.arguments()[i]);
    }
    writer->stringBuilder().append(')');
}

static void emitTextureSampleBias(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    auto& texture = call.arguments()[0];
    auto& textureType = std::get<Types::Texture>(*texture.inferredType());
    bool isArray = false;
    switch (textureType.kind) {
    case Types::Texture::Kind::Texture2dArray:
    case Types::Texture::Kind::TextureCubeArray:
        isArray = true;
        break;
    case Types::Texture::Kind::Texture1d:
    case Types::Texture::Kind::Texture2d:
    case Types::Texture::Kind::Texture3d:
    case Types::Texture::Kind::TextureCube:
    case Types::Texture::Kind::TextureMultisampled2d:
        break;
    }

    unsigned biasIndex = isArray ? 4 : 3;
    writer->visit(texture);
    writer->stringBuilder().append(".sample("_s);
    for (unsigned i = 1; i < biasIndex; ++i) {
        if (i != 1)
            writer->stringBuilder().append(", "_s);
        writer->visit(call.arguments()[i]);
    }
    writer->stringBuilder().append(", bias("_s);
    writer->visit(call.arguments()[biasIndex]);
    writer->stringBuilder().append(')');
    for (unsigned i = biasIndex + 1; i < call.arguments().size(); ++i) {
        writer->stringBuilder().append(", "_s);
        writer->visit(call.arguments()[i]);
    }
    writer->stringBuilder().append(')');
}

static void emitTextureNumLayers(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(".get_array_size()"_s);
}

static void emitTextureNumLevels(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(".get_num_mip_levels()"_s);
}

static void emitTextureNumSamples(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(".get_num_samples()"_s);
}

static void emitTextureStore(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    auto cast = "uint"_s;
    if (const auto* vector = std::get_if<Types::Vector>(call.arguments()[1].inferredType())) {
        switch (vector->size) {
        case 2:
            cast = "uint2"_s;
            break;
        case 3:
            cast = "uint3"_s;
            break;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    }

    AST::Expression& texture = call.arguments()[0];
    AST::Expression& coords = call.arguments()[1];
    AST::Expression* arrayIndex = nullptr;
    AST::Expression* value = nullptr;
    if (call.arguments().size() == 3)
        value = &call.arguments()[2];
    else {
        arrayIndex = &call.arguments()[2];
        value = &call.arguments()[3];
    }

    writer->visit(texture);
    writer->stringBuilder().append(".write("_s);
    writer->visit(*value);
    writer->stringBuilder().append(", "_s, cast, '(');
    writer->visit(coords);
    writer->stringBuilder().append(')');
    if (arrayIndex) {
        writer->stringBuilder().append(", "_s);
        writer->visit(*arrayIndex);
    }
    writer->stringBuilder().append(')');

    auto& textureType = std::get<Types::TextureStorage>(*texture.inferredType());
    if (textureType.access == AccessMode::ReadWrite) {
        writer->stringBuilder().append(";\n"_s, writer->indent());
        writer->visit(texture);
        writer->stringBuilder().append(".fence()"_s);
    }
}

static void emitStorageBarrier(FunctionDefinitionWriter* writer, AST::CallExpression&)
{
    writer->stringBuilder().append("threadgroup_barrier(mem_flags::mem_device)"_s);
}

static void emitTextureBarrier(FunctionDefinitionWriter* writer, AST::CallExpression&)
{
    writer->stringBuilder().append("threadgroup_barrier(mem_flags::mem_texture)"_s);
}

static void emitWorkgroupBarrier(FunctionDefinitionWriter* writer, AST::CallExpression&)
{
    writer->stringBuilder().append("threadgroup_barrier(mem_flags::mem_threadgroup)"_s);
}

static void emitWorkgroupUniformLoad(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("__workgroup_uniform_load("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(')');
}

static void emitSubgroupBallot(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    // WGSL's subgroupBallot returns a vec4<u32> bitmask (x: lanes 0-31, y: 32-63, ...).
    // Metal's simd_ballot returns a simd_vote; reinterpret its bits into the vec4 layout.
    writer->stringBuilder().append("uint4(as_type<uint2>((uint64_t)(simd_vote::vote_t)simd_ballot("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(")), 0u, 0u)"_s);
}

static void emitQuadSwap(FunctionDefinitionWriter* writer, AST::CallExpression& call, unsigned mask)
{
    // WGSL's quadSwap* map to Metal's quad_shuffle_xor with a fixed mask.
    writer->stringBuilder().append("quad_shuffle_xor("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(", "_s, mask, ')');
}

static void emitQuadSwapDiagonal(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    emitQuadSwap(writer, call, 3);
}

static void emitQuadSwapX(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    emitQuadSwap(writer, call, 1);
}

static void emitQuadSwapY(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    emitQuadSwap(writer, call, 2);
}

static void atomicFunction(ASCIILiteral name, FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append(name, '(');
    bool first = true;
    for (auto& argument : call.arguments()) {
        if (!first)
            writer->stringBuilder().append(", "_s);
        first = false;
        writer->visit(argument);
    }
    writer->stringBuilder().append(", memory_order_relaxed)"_s);
}

static void emitAtomicLoad(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    if (writer->metalAppleGPUFamily() >= 9)
        writer->stringBuilder().append("({ volatile auto __wgslAtomicLoadResult = "_s);
    atomicFunction("atomic_load_explicit"_s, writer, call);
    if (writer->metalAppleGPUFamily() >= 9)
        writer->stringBuilder().append("; __wgslAtomicLoadResult; })"_s);
}

static void emitAtomicStore(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    atomicFunction("atomic_store_explicit"_s, writer, call);
}

static void emitAtomicAdd(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    atomicFunction("atomic_fetch_add_explicit"_s, writer, call);
}

static void emitAtomicSub(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    atomicFunction("atomic_fetch_sub_explicit"_s, writer, call);
}

static void emitAtomicMax(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    atomicFunction("atomic_fetch_max_explicit"_s, writer, call);
}

static void emitAtomicMin(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    atomicFunction("atomic_fetch_min_explicit"_s, writer, call);
}

static void emitAtomicAnd(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    atomicFunction("atomic_fetch_and_explicit"_s, writer, call);
}

static void emitAtomicOr(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    atomicFunction("atomic_fetch_or_explicit"_s, writer, call);
}

static void emitAtomicXor(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    atomicFunction("atomic_fetch_xor_explicit"_s, writer, call);
}

static void emitAtomicExchange(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    atomicFunction("atomic_exchange_explicit"_s, writer, call);
}

[[noreturn]] static void NODELETE emitArrayLength(FunctionDefinitionWriter*, AST::CallExpression&)
{
    RELEASE_ASSERT_NOT_REACHED();
}

static void emitDistance(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    auto* argumentType = call.arguments()[0].inferredType();
    if (std::holds_alternative<Types::Primitive>(*argumentType)) {
        writer->stringBuilder().append("abs("_s);
        writer->visit(call.arguments()[0]);
        writer->stringBuilder().append(" - "_s);
        writer->visit(call.arguments()[1]);
        writer->stringBuilder().append(')');
        return;
    }
    writer->visit(call.target());
    visitArguments(writer, call);
}

static void emitLength(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    auto* argumentType = call.arguments()[0].inferredType();
    if (!holds_alternative<Types::Vector>(*argumentType))
        writer->stringBuilder().append("abs"_s);
    else
        writer->stringBuilder().append("length"_s);
    visitArguments(writer, call);
}

static void emitDegrees(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("static_cast<"_s);
    writer->visit(call.inferredType());
    writer->stringBuilder().append(">("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(" * "_s, String::number(180 / std::numbers::pi), ')');
}

static void emitDynamicOffset(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    auto* targetType = call.target().inferredType();
    auto& pointer = std::get<Types::Pointer>(*targetType);
    auto addressSpace = serializeAddressSpace(pointer.addressSpace);

    writer->stringBuilder().append("(*("_s);
    writer->visit(targetType);
    writer->stringBuilder().append(")((("_s, addressSpace, " uint8_t*)&("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(")) + __DynamicOffsets["_s);
    writer->visit(call.arguments()[1]);
    writer->stringBuilder().append("]))"_s);
}

static void emitBitcast(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("as_type<"_s);
    writer->visit(call.target().inferredType());
    writer->stringBuilder().append(">("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(')');
}

static void emitPack2x16Float(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("as_type<uint>(half2("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append("))"_s);
}

static void emitUnpack2x16Float(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("float2(as_type<half2>("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append("))"_s);
}

static void emitPack4xI8(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("as_type<uint>(char4("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append("))"_s);
}

static void emitPack4xI8Clamp(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("as_type<uint>(char4(clamp("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(", -128, 127)))"_s);
}

static void emitUnpack4xI8(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("int4(as_type<char4>("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append("))"_s);
}

static void emitPack4xU8(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("as_type<uint>(uchar4("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append("))"_s);
}

static void emitPack4xU8Clamp(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("as_type<uint>(uchar4(min("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(", 255)))"_s);
}

static void emitQuantizeToF16(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    auto& argument = call.arguments()[0];
    String suffix = ""_s;
    if (auto* vectorType = std::get_if<Types::Vector>(argument.inferredType()))
        suffix = String::number(vectorType->size);
    writer->stringBuilder().append("float"_s, suffix, "(half"_s, suffix, '(');
    writer->visit(argument);
    writer->stringBuilder().append("))"_s);
}

static void emitRadians(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("static_cast<"_s);
    writer->visit(call.inferredType());
    writer->stringBuilder().append(">("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append(" * "_s, String::number(std::numbers::pi / 180), ')');
}

static void emitUnpack4xU8(FunctionDefinitionWriter* writer, AST::CallExpression& call)
{
    writer->stringBuilder().append("uint4(as_type<uchar4>("_s);
    writer->visit(call.arguments()[0]);
    writer->stringBuilder().append("))"_s);
}

void FunctionDefinitionWriter::visit(const Type* type, AST::CallExpression& call)
{
    if (auto* target = dynamicDowncast<AST::ElaboratedTypeExpression>(call.target())) {
        if (target->base() == "bitcast"_s) {
            emitBitcast(this, call);
            return;
        }
    }

    auto isArray = is<AST::ArrayTypeExpression>(call.target());
    auto isStruct = !isArray && std::holds_alternative<Types::Struct>(*call.target().inferredType());
    if (call.isConstructor() && (isArray || isStruct)) {
        visit(type);
        m_body.append('(');
        const Type* arrayElementType = nullptr;
        if (isArray)
            arrayElementType = std::get<Types::Array>(*type).element;

        m_body.append("{\n"_s);
        {
            IndentationScope scope(m_indent);
            for (auto& argument : call.arguments()) {
                m_body.append(m_indent);
                if (isStruct)
                    visit(argument);
                else
                    visit(arrayElementType, argument);
                m_body.append(",\n"_s);
            }
        }
        m_body.append(m_indent, "})"_s);
        return;
    }

    if (auto* target = dynamicDowncast<AST::IdentifierExpression>(call.target())) {
        static constexpr SortedArrayMap builtins { WTF::toArray<std::pair<ComparableASCIILiteral, void(*)(FunctionDefinitionWriter*, AST::CallExpression&)>>({
            { "__dynamicOffset"_s, emitDynamicOffset },
            { "arrayLength"_s, emitArrayLength },
            { "atomicAdd"_s, emitAtomicAdd },
            { "atomicAnd"_s, emitAtomicAnd },
            { "atomicExchange"_s, emitAtomicExchange },
            { "atomicLoad"_s, emitAtomicLoad },
            { "atomicMax"_s, emitAtomicMax },
            { "atomicMin"_s, emitAtomicMin },
            { "atomicOr"_s, emitAtomicOr },
            { "atomicStore"_s, emitAtomicStore },
            { "atomicSub"_s, emitAtomicSub },
            { "atomicXor"_s, emitAtomicXor },
            { "degrees"_s, emitDegrees },
            { "distance"_s, emitDistance },
            { "length"_s, emitLength },
            { "pack2x16float"_s, emitPack2x16Float },
            { "pack4xI8"_s, emitPack4xI8 },
            { "pack4xI8Clamp"_s, emitPack4xI8Clamp },
            { "pack4xU8"_s, emitPack4xU8 },
            { "pack4xU8Clamp"_s, emitPack4xU8Clamp },
            { "quadSwapDiagonal"_s, emitQuadSwapDiagonal },
            { "quadSwapX"_s, emitQuadSwapX },
            { "quadSwapY"_s, emitQuadSwapY },
            { "quantizeToF16"_s, emitQuantizeToF16 },
            { "radians"_s, emitRadians },
            { "storageBarrier"_s, emitStorageBarrier },
            { "subgroupBallot"_s, emitSubgroupBallot },
            { "textureBarrier"_s, emitTextureBarrier },
            { "textureDimensions"_s, emitTextureDimensions },
            { "textureGather"_s, emitTextureGather },
            { "textureGatherCompare"_s, emitTextureGatherCompare },
            { "textureLoad"_s, emitTextureLoad },
            { "textureNumLayers"_s, emitTextureNumLayers },
            { "textureNumLevels"_s, emitTextureNumLevels },
            { "textureNumSamples"_s, emitTextureNumSamples },
            { "textureSample"_s, emitTextureSample },
            { "textureSampleBias"_s, emitTextureSampleBias },
            { "textureSampleCompare"_s, emitTextureSampleCompare },
            { "textureSampleCompareLevel"_s, emitTextureSampleCompare },
            { "textureSampleGrad"_s, emitTextureSampleGrad },
            { "textureSampleLevel"_s, emitTextureSampleLevel },
            { "textureStore"_s, emitTextureStore },
            { "unpack2x16float"_s, emitUnpack2x16Float },
            { "unpack4xI8"_s, emitUnpack4xI8 },
            { "unpack4xU8"_s, emitUnpack4xU8 },
            { "workgroupBarrier"_s, emitWorkgroupBarrier },
            { "workgroupUniformLoad"_s, emitWorkgroupUniformLoad },
        }) };
        const auto& targetName = target->identifier().id();
        if (auto mappedBuiltin = builtins.get(targetName)) {
            mappedBuiltin(this, call);
            return;
        }

#define EMIT_HELPER(name) \
    [](HelperGenerator& helperGenerator, AST::CallExpression&) { \
        if (!std::exchange(helperGenerator.didEmit##name, true)) \
            helperGenerator.emit##name(); \
        return "__wgsl"#name##_s;\
    }

#define NOOP_HELPER(name) \
    [](HelperGenerator&, AST::CallExpression&) { return #name##_s; }

        static constexpr SortedArrayMap mappedNames { WTF::toArray<std::pair<ComparableASCIILiteral, ASCIILiteral(*)(HelperGenerator&, AST::CallExpression&)>>({
            { "acos"_s, EMIT_HELPER(Acos) },
            { "acosh"_s, EMIT_HELPER(Acosh) },
            { "asin"_s, EMIT_HELPER(Asin) },
            { "atanh"_s, EMIT_HELPER(Atanh) },
            { "atomicCompareExchangeWeak"_s, NOOP_HELPER(__wgslAtomicCompareExchangeWeak) },
            { "countLeadingZeros"_s, NOOP_HELPER(clz) },
            { "countOneBits"_s, NOOP_HELPER(popcount) },
            { "countTrailingZeros"_s, NOOP_HELPER(ctz) },
            { "dot"_s, NOOP_HELPER(__wgslDot) },
            { "dot4I8Packed"_s, NOOP_HELPER(__wgslDot4I8Packed) },
            { "dot4U8Packed"_s, NOOP_HELPER(__wgslDot4U8Packed) },
            { "dpdx"_s, NOOP_HELPER(dfdx) },
            { "dpdxCoarse"_s, NOOP_HELPER(dfdx) },
            { "dpdxFine"_s, NOOP_HELPER(dfdx) },
            { "dpdy"_s, NOOP_HELPER(dfdy) },
            { "dpdyCoarse"_s, NOOP_HELPER(dfdy) },
            { "dpdyFine"_s, NOOP_HELPER(dfdy) },
            { "extractBits"_s, NOOP_HELPER(__wgslExtractBits) },
            { "faceForward"_s, NOOP_HELPER(faceforward) },
            { "firstLeadingBit"_s, NOOP_HELPER(__wgslFirstLeadingBit) },
            { "firstTrailingBit"_s, NOOP_HELPER(__wgslFirstTrailingBit) },
            { "frexp"_s, NOOP_HELPER(__wgslFrexp) },
            { "fwidthCoarse"_s, NOOP_HELPER(fwidth) },
            { "fwidthFine"_s, NOOP_HELPER(fwidth) },
            { "insertBits"_s, NOOP_HELPER(__wgslInsertBits) },
            { "inverseSqrt"_s, EMIT_HELPER(InverseSqrt) },
            { "log"_s, EMIT_HELPER(Log) },
            { "log2"_s, EMIT_HELPER(Log2) },
            { "modf"_s, NOOP_HELPER(__wgslModf) },
            { "pack2x16snorm"_s, EMIT_HELPER(PackFloatToSnorm2x16) },
            { "pack2x16unorm"_s, EMIT_HELPER(PackFloatToUnorm2x16) },
            { "pack4x8snorm"_s, EMIT_HELPER(PackFloatToSnorm4x8) },
            { "pack4x8unorm"_s, EMIT_HELPER(PackFloatToUnorm4x8) },
            { "quadBroadcast"_s, NOOP_HELPER(quad_broadcast) },
            { "reverseBits"_s, NOOP_HELPER(reverse_bits) },
            { "round"_s, NOOP_HELPER(rint) },
            { "sign"_s, NOOP_HELPER(__wgslSign) },
            { "sqrt"_s, EMIT_HELPER(Sqrt) },
            { "subgroupAdd"_s, NOOP_HELPER(simd_sum) },
            { "subgroupAll"_s, NOOP_HELPER(simd_all) },
            { "subgroupAnd"_s, NOOP_HELPER(simd_and) },
            { "subgroupAny"_s, NOOP_HELPER(simd_any) },
            { "subgroupBroadcast"_s, NOOP_HELPER(simd_broadcast) },
            { "subgroupBroadcastFirst"_s, NOOP_HELPER(simd_broadcast_first) },
            { "subgroupElect"_s, NOOP_HELPER(simd_is_first) },
            { "subgroupExclusiveAdd"_s, NOOP_HELPER(simd_prefix_exclusive_sum) },
            { "subgroupExclusiveMul"_s, NOOP_HELPER(simd_prefix_exclusive_product) },
            { "subgroupInclusiveAdd"_s, NOOP_HELPER(simd_prefix_inclusive_sum) },
            { "subgroupInclusiveMul"_s, NOOP_HELPER(simd_prefix_inclusive_product) },
            { "subgroupMax"_s, NOOP_HELPER(simd_max) },
            { "subgroupMin"_s, NOOP_HELPER(simd_min) },
            { "subgroupMul"_s, NOOP_HELPER(simd_product) },
            { "subgroupOr"_s, NOOP_HELPER(simd_or) },
            { "subgroupShuffle"_s, NOOP_HELPER(simd_shuffle) },
            { "subgroupShuffleDown"_s, NOOP_HELPER(simd_shuffle_down) },
            { "subgroupShuffleUp"_s, NOOP_HELPER(simd_shuffle_up) },
            { "subgroupShuffleXor"_s, NOOP_HELPER(simd_shuffle_xor) },
            { "subgroupXor"_s, NOOP_HELPER(simd_xor) },
            { "textureSampleBaseClampToEdge"_s, [](HelperGenerator& helperGenerator, AST::CallExpression& call) {
                auto& texture = call.arguments()[0];
                if (std::holds_alternative<Types::Texture>(*texture.inferredType())) {
                    if (!std::exchange(helperGenerator.didEmitTextureSampleBaseClampToEdge, true))
                        helperGenerator.emitTextureSampleBaseClampToEdge();
                } else {
                    if (!std::exchange(helperGenerator.didEmitTextureExternalSampleBaseClampToEdge, true))
                        helperGenerator.emitTextureExternalSampleBaseClampToEdge();
                }
                return "__wgslTextureSampleBaseClampToEdge"_s;
            } },
            { "unpack2x16snorm"_s, NOOP_HELPER(unpack_snorm2x16_to_float) },
            { "unpack2x16unorm"_s, NOOP_HELPER(unpack_unorm2x16_to_float) },
            { "unpack4x8snorm"_s, NOOP_HELPER(unpack_snorm4x8_to_float) },
            { "unpack4x8unorm"_s, NOOP_HELPER(unpack_unorm4x8_to_float) },
        }) };
#undef EMIT_HELPER
#undef NOOP_HELPER

        if (call.isConstructor()) {
            if (call.isFloatToIntConversion()) {
                m_body.append("__wgslFtoi<"_s);
                visit(type);
                m_body.append(">"_s);
            } else
                visit(type);
        } else if (auto mappedName = mappedNames.get(targetName))
            m_body.append(mappedName(m_helperGenerator, call));
        else
            m_body.append(targetName);
        visitArguments(this, call);
        return;
    }

    if (call.isFloatToIntConversion()) {
        m_body.append("__wgslFtoi<"_s);
        visit(type);
        m_body.append(">"_s);
    } else
        visit(type);
    visitArguments(this, call);
}

void FunctionDefinitionWriter::visit(AST::UnaryExpression& unary)
{
    m_body.append('(');
    switch (unary.operation()) {
    case AST::UnaryOperation::Complement:
        m_body.append('~');
        break;
    case AST::UnaryOperation::Negate:
        m_body.append('-');
        break;
    case AST::UnaryOperation::Not:
        m_body.append('!');
        break;
    case AST::UnaryOperation::AddressOf:
        m_body.append('&');
        break;
    case AST::UnaryOperation::Dereference:
        m_body.append('*');
        break;
    }
    visit(unary.expression());
    m_body.append(')');
}

void FunctionDefinitionWriter::serializeBinaryExpression(AST::Expression& lhs, AST::BinaryOperation operation, AST::Expression& rhs)
{
    bool isDiv = operation == AST::BinaryOperation::Divide;
    bool isMod = !isDiv && operation == AST::BinaryOperation::Modulo;

    if (isDiv || isMod) {
        auto* rightType = rhs.inferredType();
        if (auto* vectorType = std::get_if<Types::Vector>(rightType))
            rightType = vectorType->element;

        ASCIILiteral helperFunction;
        if (satisfies(rightType, Constraints::Integer)) {
            if (isDiv)
                helperFunction = "__wgslDiv"_s;
            else
                helperFunction = "__wgslMod"_s;
        } else if (isMod)
            helperFunction = "fmod"_s;

        if (!helperFunction.isNull()) {
            m_body.append(helperFunction, '(');
            visit(lhs);
            m_body.append(", "_s);
            visit(rhs);
            m_body.append(')');
            return;
        }
    }

    m_body.append('(');
    visit(lhs);
    switch (operation) {
    case AST::BinaryOperation::Add:
        m_body.append(" + "_s);
        break;
    case AST::BinaryOperation::Subtract:
        m_body.append(" - "_s);
        break;
    case AST::BinaryOperation::Multiply:
        m_body.append(" * "_s);
        break;
    case AST::BinaryOperation::Divide:
        m_body.append(" / "_s);
        break;
    case AST::BinaryOperation::Modulo:
        m_body.append(" % "_s);
        break;
    case AST::BinaryOperation::And:
        m_body.append(" & "_s);
        break;
    case AST::BinaryOperation::Or:
        m_body.append(" | "_s);
        break;
    case AST::BinaryOperation::Xor:
        m_body.append(" ^ "_s);
        break;

    case AST::BinaryOperation::LeftShift:
        m_body.append(" << "_s);
        break;
    case AST::BinaryOperation::RightShift:
        m_body.append(" >> "_s);
        break;

    case AST::BinaryOperation::Equal:
        m_body.append(" == "_s);
        break;
    case AST::BinaryOperation::NotEqual:
        m_body.append(" != "_s);
        break;
    case AST::BinaryOperation::GreaterThan:
        m_body.append(" > "_s);
        break;
    case AST::BinaryOperation::GreaterEqual:
        m_body.append(" >= "_s);
        break;
    case AST::BinaryOperation::LessThan:
        m_body.append(" < "_s);
        break;
    case AST::BinaryOperation::LessEqual:
        m_body.append(" <= "_s);
        break;

    case AST::BinaryOperation::ShortCircuitAnd:
        m_body.append(" && "_s);
        break;
    case AST::BinaryOperation::ShortCircuitOr:
        m_body.append(" || "_s);
        break;
    }
    visit(rhs);
    m_body.append(')');
}

void FunctionDefinitionWriter::visit(AST::BinaryExpression& binary)
{
    serializeBinaryExpression(binary.leftExpression(), binary.operation(), binary.rightExpression());
}

void FunctionDefinitionWriter::visit(AST::PointerDereferenceExpression& pointerDereference)
{
    m_body.append("(*"_s);
    visit(pointerDereference.target());
    m_body.append(')');
}
void FunctionDefinitionWriter::visit(AST::IndexAccessExpression& access)
{
    auto* baseType = access.base().inferredType();
    bool isPointer = std::holds_alternative<Types::Pointer>(*baseType);

    bool isPackedMatrix = false;
    {
        const Type* elementType = nullptr;
        if (auto* ref = std::get_if<Types::Reference>(baseType)) {
            if (ref->addressSpace == AddressSpace::Storage || ref->addressSpace == AddressSpace::Uniform)
                elementType = ref->element;
        } else if (auto* ptr = std::get_if<Types::Pointer>(baseType)) {
            if (ptr->addressSpace == AddressSpace::Storage || ptr->addressSpace == AddressSpace::Uniform)
                elementType = ptr->element;
        }
        if (elementType) {
            if (auto* matrix = std::get_if<Types::Matrix>(elementType))
                isPackedMatrix = matrix->rows == 3;
        }
    }

    if (isPointer)
        m_body.append("(*("_s);
    visit(access.base());
    if (isPointer)
        m_body.append("))"_s);
    if (isPackedMatrix)
        m_body.append(".columns"_s);
    m_body.append('[');
    visit(access.index());
    m_body.append(']');
}

void FunctionDefinitionWriter::visit(AST::IdentifierExpression& identifier)
{
    auto it = m_constantValues.find(identifier.identifier());
    if (it != m_constantValues.end()) [[unlikely]] {
        m_body.append('(');
        serializeConstant(identifier.inferredType(), it->value);
        m_body.append(')');
        return;
    }
    m_body.append(identifier.identifier());
}

void FunctionDefinitionWriter::visit(AST::FieldAccessExpression& access)
{
    visit(access.base());
    auto* baseType = access.base().inferredType();
    if (baseType && std::holds_alternative<Types::Pointer>(*baseType))
        m_body.append("->"_s);
    else
        m_body.append('.');
    m_body.append(access.fieldName());
}

void FunctionDefinitionWriter::visit(AST::BoolLiteral& literal)
{
    m_body.append(literal.value() ? "true"_s : "false"_s);
}

void FunctionDefinitionWriter::visit(AST::AbstractIntegerLiteral& literal)
{
    m_body.append(literal.value());
    auto& primitiveType = std::get<Types::Primitive>(*literal.inferredType());
    if (primitiveType.kind == Types::Primitive::U32)
        m_body.append('u');
}

void FunctionDefinitionWriter::visit(AST::Signed32Literal& literal)
{
    m_body.append(literal.value());
}

void FunctionDefinitionWriter::visit(AST::Unsigned32Literal& literal)
{
    m_body.append(literal.value(), 'u');
}

void FunctionDefinitionWriter::visit(AST::AbstractFloatLiteral& literal)
{
    NumberToStringBuffer buffer;
    m_body.append(WTF::numberToStringWithTrailingPoint(literal.value(), buffer));
}

void FunctionDefinitionWriter::visit(AST::Float32Literal& literal)
{
    NumberToStringBuffer buffer;
    m_body.append(WTF::numberToStringWithTrailingPoint(literal.value(), buffer));
}

void FunctionDefinitionWriter::visit(AST::Float16Literal& literal)
{
    NumberToStringBuffer buffer;
    m_body.append(WTF::numberToStringWithTrailingPoint(literal.value(), buffer));
}

void FunctionDefinitionWriter::visit(AST::Statement& statement)
{
    AST::Visitor::visit(statement);
}

void FunctionDefinitionWriter::visit(AST::AssignmentStatement& assignment)
{
    visit(assignment.lhs());
    m_body.append(" = "_s);
    const auto* assignmentType = assignment.lhs().inferredType();
    if (!assignmentType) {
        visit(assignment.rhs());
        return;
    }

    const auto& reference = std::get<Types::Reference>(*assignmentType);
    visit(reference.element, assignment.rhs());
}

void FunctionDefinitionWriter::visit(AST::CallStatement& statement)
{
    visit(statement.call().inferredType(), statement.call());
}

void FunctionDefinitionWriter::visit(AST::CompoundAssignmentStatement& statement)
{
    bool serialized = false;
    bool needsPack = false;
    auto* leftExpression = &statement.leftExpression();
    if (auto* identity = dynamicDowncast<AST::IdentityExpression>(*leftExpression))
        leftExpression = &identity->expression();
    if (auto* call = dynamicDowncast<AST::CallExpression>(*leftExpression)) {
        auto& target = call->target();
        if (auto* identifier = dynamicDowncast<AST::IdentifierExpression>(target)) {
            if (identifier->identifier() == "__unpack"_s) {
                serialized = true;
                auto& rawExpr = call->arguments()[0];
                visit(rawExpr);
                auto* rawType = rawExpr.inferredType();
                if (auto* ref = std::get_if<Types::Reference>(rawType))
                    rawType = ref->element;
                if (auto* matrix = std::get_if<Types::Matrix>(rawType))
                    needsPack = matrix->rows == 3;
            }
        }
    }
    if (!serialized)
        visit(statement.leftExpression());

    m_body.append(" = "_s);
    if (needsPack)
        m_body.append("__pack("_s);
    serializeBinaryExpression(statement.leftExpression(), statement.operation(), statement.rightExpression());
    if (needsPack)
        m_body.append(')');
}

void FunctionDefinitionWriter::visit(AST::CompoundStatement& statement)
{
    m_body.append("{\n"_s);
    {
        IndentationScope scope(m_indent);
        visitStatements(statement.statements());
    }
    m_body.append(m_indent, '}');
}

void FunctionDefinitionWriter::visitStatements(AST::Statement::List& statements)
{
    for (auto& statement : statements) {
        m_body.append(m_indent);
        checkErrorAndVisit(statement);
        switch (statement.kind()) {
        case AST::NodeKind::AssignmentStatement:
        case AST::NodeKind::BreakStatement:
        case AST::NodeKind::CallStatement:
        case AST::NodeKind::CompoundAssignmentStatement:
        case AST::NodeKind::ContinueStatement:
        case AST::NodeKind::DecrementIncrementStatement:
        case AST::NodeKind::DiscardStatement:
        case AST::NodeKind::PhonyAssignmentStatement:
        case AST::NodeKind::ReturnStatement:
        case AST::NodeKind::VariableStatement:
            m_body.append(';');
            break;
        default:
            break;
        }
        m_body.append('\n');
    }
}

void FunctionDefinitionWriter::visit(AST::DecrementIncrementStatement& statement)
{
    visit(statement.expression());
    switch (statement.operation()) {
    case AST::DecrementIncrementStatement::Operation::Increment:
        m_body.append("++"_s);
        break;
    case AST::DecrementIncrementStatement::Operation::Decrement:
        m_body.append("--"_s);
        break;
    }
}

void FunctionDefinitionWriter::visit(AST::DiscardStatement&)
{
#if CPU(X86_64)
    m_body.append("__asm volatile(\"\"); discard_fragment()"_s);
#else
    m_body.append("discard_fragment();"_s);
#endif
}

void FunctionDefinitionWriter::visit(AST::IfStatement& statement)
{
    m_body.append("if ("_s);
    visit(statement.test());
    m_body.append(") "_s);
    visit(statement.trueBody());
    if (statement.maybeFalseBody()) {
        m_body.append(" else "_s);
        visit(*statement.maybeFalseBody());
    }
}

void FunctionDefinitionWriter::visit(AST::PhonyAssignmentStatement& statement)
{
    m_body.append("(void)("_s);
    visit(statement.rhs());
    m_body.append(')');
}

static std::optional<std::pair<String, String>> returnIdentifierForFunction(WGSL::Builtin builtIn, AST::Function* function)
{
    if (!function || function->stage() != ShaderStage::Fragment)
        return std::nullopt;

    if (auto expression = function->maybeReturnType()) {
        if (auto* inferredType = expression->inferredType()) {
            auto& type = *inferredType;
            auto* returnStruct = std::get_if<WGSL::Types::Struct>(&type);
            if (!returnStruct)
                return std::nullopt;

            for (auto& member : returnStruct->structure.members()) {
                if (member.builtin() == builtIn)
                    return std::make_pair(returnStruct->structure.name(), member.name());
                for (auto& attribute : member.attributes()) {
                    auto* builtinAttribute = dynamicDowncast<AST::BuiltinAttribute>(attribute);
                    if (builtinAttribute && builtinAttribute->builtin() == builtIn)
                        return std::make_pair(returnStruct->structure.name(), member.name());
                }
            }
        }
    }

    return std::nullopt;
}

void FunctionDefinitionWriter::visit(AST::ReturnStatement& statement)
{
    auto fragDepthIdentifier = returnIdentifierForFunction(WGSL::Builtin::FragDepth, m_currentFunction);
    auto sampleMaskIdentifier = returnIdentifierForFunction(WGSL::Builtin::SampleMask, m_currentFunction);
    if (fragDepthIdentifier)
        m_body.append(fragDepthIdentifier->first, " __wgslFragmentReturnResult = "_s);
    else if (sampleMaskIdentifier)
        m_body.append(sampleMaskIdentifier->first, " __wgslFragmentReturnResult = "_s);
    else
        m_body.append("return"_s);
    if (statement.maybeExpression()) {
        m_body.append(' ');
        visit(*statement.maybeExpression());
    }

    if (fragDepthIdentifier)
        m_body.append(";\n__wgslFragmentReturnResult."_s, fragDepthIdentifier->second, " = clamp(__wgslFragmentReturnResult."_s, fragDepthIdentifier->second, ", as_type<float>(__DynamicOffsets[0]), as_type<float>(__DynamicOffsets[1]));\n"_s);
    if (sampleMaskIdentifier)
        m_body.append(";\n__wgslFragmentReturnResult."_s, sampleMaskIdentifier->second, " = (__wgslFragmentReturnResult."_s, sampleMaskIdentifier->second, " & __DynamicOffsets[2]);\n"_s);
    if (fragDepthIdentifier || sampleMaskIdentifier)
        m_body.append("return __wgslFragmentReturnResult"_s);
}

void FunctionDefinitionWriter::visit(AST::ForStatement& statement)
{
    if (statement.isInternallyGenerated())
        m_body.append("for ("_s);
    else
        m_body.append("{ " DECLARE_FORWARD_PROGRESS " for ("_s);

    if (auto* initializer = statement.maybeInitializer())
        visit(*initializer);
    m_body.append(';');
    if (auto* test = statement.maybeTest()) {
        m_body.append(' ');
        visit(*test);
    }
    m_body.append(';');
    if (auto* update = statement.maybeUpdate()) {
        m_body.append(' ');
        visit(*update);
    }

    if (statement.isInternallyGenerated())
        m_body.append(')');
    else
        m_body.append(") { " CHECK_FORWARD_PROGRESS " "_s);
    visit(statement.body());
    if (!statement.isInternallyGenerated()) {
        m_body.append('}');
        m_body.append('}');
    }
}

void FunctionDefinitionWriter::visit(AST::LoopStatement& statement)
{
    m_body.append("{ " DECLARE_FORWARD_PROGRESS " while (true) { " CHECK_FORWARD_PROGRESS " \n"_s);
    {
        if (statement.containsSwitch())
            m_body.append("bool __continuing = false;\n"_s, m_indent);
        auto& continuing = statement.continuing();
        SetForScope continuingScope(m_continuing, continuing.has_value() ? &*continuing : nullptr);

        IndentationScope scope(m_indent);
        visitStatements(statement.body());

        if (continuing.has_value()) {
            m_body.append(m_indent);
            visit(*continuing);
        }
    }
    m_body.append(m_indent, '}');
    m_body.append(m_indent, '}');
}

void FunctionDefinitionWriter::visit(AST::Continuing& continuing)
{
    // Do not emit the same continuing for continue statements within the continuing block
    SetForScope continuingScope(m_continuing, nullptr);

    m_body.append("{\n"_s);
    {
        IndentationScope scope(m_indent);
        visitStatements(continuing.body);

        if (auto* breakIf = continuing.breakIf) {
            m_body.append(m_indent, "if ("_s);
            visit(*breakIf);
            m_body.append(")\n"_s);

            IndentationScope scope(m_indent);
            m_body.append(m_indent, "break;\n"_s);
        }
    }
    m_body.append(m_indent, "}\n"_s);
}

void FunctionDefinitionWriter::visit(AST::WhileStatement& statement)
{
    m_body.append("{ " DECLARE_FORWARD_PROGRESS " while ("_s);
    visit(statement.test());
    m_body.append(") { " CHECK_FORWARD_PROGRESS " "_s);
    visit(statement.body());
    m_body.append('}');
    m_body.append('}');
}

void FunctionDefinitionWriter::visit(AST::SwitchStatement& statement)
{
    const auto& visitClause = [&](AST::SwitchClause& clause, bool isDefault = false) {
        for (auto& selector : clause.selectors) {
            m_body.append('\n', m_indent, "case "_s);
            visit(selector);
            m_body.append(':');
        }
        if (isDefault)
            m_body.append('\n', m_indent, "default:"_s);
        m_body.append("\n{ " DECLARE_FORWARD_PROGRESS "\n"_s);
        visit(clause.body);

        IndentationScope scope(m_indent);
        m_body.append('\n', m_indent, "\n}\nbreak;"_s);
    };

    m_body.append("switch ("_s);
    visit(statement.value());
    m_body.append(") {"_s);
    for (auto& clause : statement.clauses())
        visitClause(clause);
    visitClause(statement.defaultClause(), true);
    m_body.append('\n', m_indent, '}');
    if (statement.isInsideLoop()) {
        m_body.append('\n', m_indent, "if (__continuing) {"_s);
        {
            auto scope = IndentationScope(m_indent);
            visit(*m_continuing);
        }
        m_body.append('\n', m_indent, '}');
    } else if (statement.isNestedInsideLoop()) {
        m_body.append('\n', m_indent, "if (__continuing) {"_s);
        {
            auto scope = IndentationScope(m_indent);
            m_body.append('\n', m_indent, "break;"_s);
        }
        m_body.append('\n', m_indent, '}');
    }
}

void FunctionDefinitionWriter::visit(AST::BreakStatement&)
{
    m_body.append("break"_s);
}

void FunctionDefinitionWriter::visit(AST::ContinueStatement& statement)
{
    if (statement.isFromSwitchToContinuing()) {
        m_body.append("__continuing = true;\n"_s);
        m_body.append(m_indent, "break"_s);
        return;
    }
    if (m_continuing) {
        visit(*m_continuing);
        m_body.append(m_indent);
    }
    m_body.append("continue"_s);
}

void FunctionDefinitionWriter::serializeConstant(const Type* type, ConstantValue value)
{
    using namespace Types;

    WTF::switchOn(*type,
        [&](const Primitive& primitive) {
            switch (primitive.kind) {
            case Primitive::AbstractInt:
                m_body.append(std::get<int64_t>(value));
                break;
            case Primitive::I32:
                m_body.append(std::get<int32_t>(value));
                break;
            case Primitive::U32:
                m_body.append(std::get<uint32_t>(value), 'u');
                break;
            case Primitive::AbstractFloat: {
                NumberToStringBuffer buffer;
                m_body.append(WTF::numberToStringWithTrailingPoint(std::get<double>(value), buffer));
                break;
            }
            case Primitive::F32: {
                NumberToStringBuffer buffer;
                m_body.append(WTF::numberToStringWithTrailingPoint(std::get<float>(value), buffer));
                break;
            }
            case Primitive::F16: {
                NumberToStringBuffer buffer;
                m_body.append(WTF::numberToStringWithTrailingPoint(std::get<half>(value), buffer), 'h');
                break;
            }
            case Primitive::Bool:
                m_body.append(std::get<bool>(value) ? "true"_s : "false"_s);
                break;
            case Primitive::Void:
            case Primitive::Sampler:
            case Primitive::SamplerComparison:
            case Primitive::TextureExternal:
            case Primitive::AccessMode:
            case Primitive::TexelFormat:
            case Primitive::AddressSpace:
                RELEASE_ASSERT_NOT_REACHED();
            }
        },
        [&](const Reference& reference) {
            return serializeConstant(reference.element, value);
        },
        [&](const Vector& vectorType) {
            auto& vector = std::get<ConstantVector>(value);
            visit(type);
            m_body.append('(');
            bool first = true;
            for (auto& element : vector.elements) {
                if (!first)
                    m_body.append(", "_s);
                first = false;
                serializeConstant(vectorType.element, element);
            }
            m_body.append(')');
        },
        [&](const Array& arrayType) {
            auto& array = std::get<ConstantArray>(value);
            visit(type);
            m_body.append('{');
            bool first = true;
            for (auto& element : array.elements) {
                if (!first)
                    m_body.append(", "_s);
                first = false;
                serializeConstant(arrayType.element, element);
            }
            m_body.append('}');
        },
        [&](const Matrix& matrixType) {
            auto& matrix = std::get<ConstantMatrix>(value);
            m_body.append("matrix<"_s);
            visit(matrixType.element);
            m_body.append(", "_s, matrixType.columns, ", "_s, matrixType.rows, ">("_s);
            bool first = true;
            for (auto& element : matrix.elements) {
                if (!first)
                    m_body.append(", "_s);
                first = false;
                serializeConstant(matrixType.element, element);
            }
            m_body.append(')');
        },
        [&](const Struct& structType) {
            auto& constantStruct = std::get<ConstantStruct>(value);
            m_body.append(structType.structure.name(), " { "_s);
            for (auto& member : structType.structure.members()) {
                m_body.append('.', member.name(), " = "_s);
                serializeConstant(structType.fields.get(member.originalName()), constantStruct.fields.get(member.originalName()));
                m_body.append(", "_s);
            }
            m_body.append(" }"_s);
        },
        [&](const PrimitiveStruct& primitiveStruct) {
            auto& constantStruct = std::get<ConstantStruct>(value);
            const auto& keys = Types::PrimitiveStruct::keys[primitiveStruct.kind];

            m_body.append(primitiveStruct.name, '<');
            bool first = true;
            for (auto& value : primitiveStruct.values) {
                if (!first)
                    m_body.append(", "_s);
                first = false;
                visit(value);
            }
            m_body.append("> {"_s);
            first = true;
            for (auto& entry : constantStruct.fields) {
                if (!first)
                    m_body.append(", "_s);
                first = false;
                m_body.append('.', entry.key, " = "_s);
                auto* key = keys.tryGet(entry.key);
                RELEASE_ASSERT(key);
                auto* type = primitiveStruct.values[*key];
                serializeConstant(type, entry.value);
            }
            m_body.append('}');
        },
        [&](const Pointer&) {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Function&) {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Texture&) {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const TextureStorage&) {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const TextureDepth&) {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Atomic&) {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const TypeConstructor&) {
            RELEASE_ASSERT_NOT_REACHED();
        });
}

void emitMetalFunctions(StringBuilder& stringBuilder, ShaderModule& shaderModule, PrepareResult& prepareResult, const HashMap<String, ConstantValue>& constantValues, DeviceState&& deviceState)
{
    FunctionDefinitionWriter functionDefinitionWriter(shaderModule, stringBuilder, prepareResult, constantValues, WTF::move(deviceState));
    functionDefinitionWriter.write();
}

#undef DECLARE_FORWARD_PROGRESS
#undef CHECK_FORWARD_PROGRESS

} // namespace Metal
} // namespace WGSL
