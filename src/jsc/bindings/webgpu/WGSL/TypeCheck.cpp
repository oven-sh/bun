/*
 * Copyright (c) 2023-2024 Apple Inc. All rights reserved.
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

#include "config.h"
#include "TypeCheck.h"

#include "AST.h"
#include "ASTScopedVisitorInlines.h"
#include "ASTStringDumper.h"
#include "CompilationMessage.h"
#include "ConstantFunctions.h"
#include "ContextProviderInlines.h"
#include "Overload.h"
#include "TypeStore.h"
#include "Types.h"
#include "WGSLShaderModule.h"
#include <wtf/DataLog.h>
#include <wtf/OptionSet.h>
#include <wtf/SetForScope.h>
#include <wtf/SortedArrayMap.h>
#include <wtf/text/MakeString.h>

namespace WGSL {

static constexpr bool shouldDumpInferredTypes = false;
static constexpr bool shouldDumpConstantValues = false;

#define TYPE_ERROR(__span, ...) \
    return makeUnexpected(Error(makeString(__VA_ARGS__), __span))

#define UNWRAP(__target, ...) \
    auto __target##Expected = __VA_ARGS__; \
    if (!__target##Expected) [[unlikely]] \
        return makeUnexpected(__target##Expected.error()); \
    auto& __target = *__target##Expected; \

#define UNWRAP_ASSIGN(__target, ...) \
{ \
    auto __target##Expected = __VA_ARGS__; \
    if (!__target##Expected) [[unlikely]] \
        return makeUnexpected(__target##Expected.error()); \
    __target = *__target##Expected; \
}

#define CHECK(...) CHECK_IMPL(WTF_LAZY_JOIN(__expected, __COUNTER__), __VA_ARGS__)

#define CHECK_IMPL(__expected, ...) \
{ \
    auto __expected = __VA_ARGS__; \
    if (!__expected) [[unlikely]] \
        return makeUnexpected(__expected.error()); \
}

enum class DiscardResult : bool {
    No,
    Yes,
};

struct Binding {
    enum Kind : uint8_t {
        Value,
        Type,
        Function,
    };

    Kind kind;
    const struct Type* type;
    Evaluation evaluation;
    std::optional<ConstantValue> constantValue;
};

using Behavior = AST::Behavior;
using Behaviors = AST::Behaviors;

using BreakTarget = Variant<
    AST::SwitchStatement*,
    AST::LoopStatement*,
    AST::ForStatement*,
    AST::WhileStatement*,
    AST::Continuing*
>;

static ASCIILiteral bindingKindToString(Binding::Kind kind)
{
    switch (kind) {
    case Binding::Value:
        return "value"_s;
    case Binding::Type:
        return "type"_s;
    case Binding::Function:
        return "function"_s;
    }
}

static ASCIILiteral evaluationToString(Evaluation evaluation)
{
    switch (evaluation) {
    case Evaluation::Constant:
        return "constant"_s;
    case Evaluation::Override:
        return "override"_s;
    case Evaluation::Runtime:
        return "runtime"_s;
    }
}

static ASCIILiteral variableFlavorToString(AST::VariableFlavor flavor)
{
    switch (flavor) {
    case AST::VariableFlavor::Var:
        return "var"_s;
    case AST::VariableFlavor::Let:
        return "let"_s;
    case AST::VariableFlavor::Const:
        return "const"_s;
    case AST::VariableFlavor::Override:
        return "override"_s;
    }
}

class TypeChecker : public ContextProvider<Binding> {
    using ContextProvider = ContextProvider<Binding>;
    using ContextScope = typename ContextProvider::ContextScope;

public:
    TypeChecker(ShaderModule&);

    std::optional<FailedCheck> check();

    [[nodiscard]] Result<void> visit(ShaderModule&);

    // Declarations
    [[nodiscard]] Result<void> visit(AST::Declaration&);
    [[nodiscard]] Result<void> visit(AST::Structure&);
    [[nodiscard]] Result<void> visit(AST::Variable&);
    [[nodiscard]] Result<void> visit(AST::Function&);
    [[nodiscard]] Result<void> visit(AST::TypeAlias&);
    [[nodiscard]] Result<void> visit(AST::ConstAssert&);

    // Attributes
    [[nodiscard]] Result<void> visit(AST::Attribute&);
    [[nodiscard]] Result<void> visit(AST::AlignAttribute&);
    [[nodiscard]] Result<void> visit(AST::BindingAttribute&);
    [[nodiscard]] Result<void> visit(AST::GroupAttribute&);
    [[nodiscard]] Result<void> visit(AST::IdAttribute&);
    [[nodiscard]] Result<void> visit(AST::LocationAttribute&);
    [[nodiscard]] Result<void> visit(AST::SizeAttribute&);
    [[nodiscard]] Result<void> visit(AST::WorkgroupSizeAttribute&);

    // Statements
    [[nodiscard]] Result<void> visit(AST::Statement&);
    [[nodiscard]] Result<void> visit(AST::AssignmentStatement&);
    [[nodiscard]] Result<void> visit(AST::CallStatement&);
    [[nodiscard]] Result<void> visit(AST::CompoundAssignmentStatement&);
    [[nodiscard]] Result<void> visit(AST::CompoundStatement&);
    [[nodiscard]] Result<void> visit(AST::DecrementIncrementStatement&);
    [[nodiscard]] Result<void> visit(AST::IfStatement&);
    [[nodiscard]] Result<void> visit(AST::PhonyAssignmentStatement&);
    [[nodiscard]] Result<void> visit(AST::ReturnStatement&);
    [[nodiscard]] Result<void> visit(AST::ForStatement&);
    [[nodiscard]] Result<void> visit(AST::LoopStatement&);
    [[nodiscard]] Result<void> visit(AST::WhileStatement&);
    [[nodiscard]] Result<void> visit(AST::SwitchStatement&);

    // Expressions
    [[nodiscard]] Result<void> visit(AST::Expression&);
    [[nodiscard]] Result<void> visit(AST::FieldAccessExpression&);
    [[nodiscard]] Result<void> visit(AST::IndexAccessExpression&);
    [[nodiscard]] Result<void> visit(AST::BinaryExpression&);
    [[nodiscard]] Result<void> visit(AST::IdentifierExpression&);
    [[nodiscard]] Result<void> visit(AST::CallExpression&);
    [[nodiscard]] Result<void> visit(AST::UnaryExpression&);

    // Literal Expressions
    void visit(AST::BoolLiteral&);
    void visit(AST::Signed32Literal&);
    void visit(AST::Float32Literal&);
    void visit(AST::Float16Literal&);
    void visit(AST::Unsigned32Literal&);
    void visit(AST::AbstractIntegerLiteral&);
    void visit(AST::AbstractFloatLiteral&);

    // Types
    [[nodiscard]] Result<void> visit(AST::ArrayTypeExpression&);
    [[nodiscard]] Result<void> visit(AST::ElaboratedTypeExpression&);

    [[nodiscard]] Result<void> visit(AST::Continuing&);

private:
    [[nodiscard]] Result<void> declareBuiltins();

    [[nodiscard]] Result<const Type*> vectorFieldAccess(const Types::Vector&, AST::FieldAccessExpression&);
    [[nodiscard]] Result<void> visitAttributes(AST::Attribute::List&);
    [[nodiscard]] Result<void> visitStatements(AST::Statement::List&);
    [[nodiscard]] Result<void> bitcast(AST::CallExpression&, const Vector<const Type*>&);

    [[nodiscard]] Result<const Type*> check(AST::Expression&, Constraint, Evaluation);
    [[nodiscard]] Result<const Type*> infer(AST::Expression&, Evaluation, DiscardResult = DiscardResult::No);
    [[nodiscard]] Result<const Type*> resolve(AST::Expression&);
    [[nodiscard]] Result<const Type*> lookupType(const AST::Identifier&);
    [[nodiscard]] Result<void> validateF16Usage(const SourceSpan&, const Type*);
    [[nodiscard]] Result<void> introduceType(const AST::Identifier&, const Type*);
    [[nodiscard]] Result<void> introduceValue(const AST::Identifier&, const Type*, Evaluation = Evaluation::Runtime, std::optional<ConstantValue> = std::nullopt);
    [[nodiscard]] Result<void> introduceFunction(const AST::Identifier&, const Type*);
    [[nodiscard]] Result<void> convertValue(const SourceSpan&, const Type*, std::optional<ConstantValue>&);

    void NODELETE evaluated(Evaluation);
    void NODELETE inferred(const Type*);
    [[nodiscard]] bool unify(const Type*, const Type*);

    [[nodiscard]] Result<void> binaryExpression(const SourceSpan&, AST::Expression*, AST::BinaryOperation, AST::Expression&, AST::Expression&);

    template<typename TargetConstructor, typename Validator, typename... Arguments>
    [[nodiscard]] Result<void> allocateSimpleConstructor(ASCIILiteral, TargetConstructor, const Validator&, Arguments&&...);
    [[nodiscard]] Result<void> allocateTextureStorageConstructor(ASCIILiteral, Types::TextureStorage::Kind);

    bool NODELETE isModuleScope() const;

    [[nodiscard]] Result<AccessMode> accessMode(AST::Expression&);
    [[nodiscard]] Result<TexelFormat> texelFormat(AST::Expression&);
    [[nodiscard]] Result<AddressSpace> addressSpace(AST::Expression&);

    template<typename CallArguments>
    [[nodiscard]] Result<const Type*> chooseOverload(ASCIILiteral, const SourceSpan&, AST::Expression*, const String&, CallArguments&& valueArguments, const Vector<const Type*>& typeArguments);

    template<typename Node>
    [[nodiscard]] Result<void> setConstantValue(Node&, const Type*, const ConstantValue&);

    [[nodiscard]] Result<Behaviors> analyze(AST::Statement&);
    [[nodiscard]] Result<Behaviors> analyze(AST::CompoundStatement&);
    [[nodiscard]] Result<Behaviors> analyze(AST::ForStatement&);
    [[nodiscard]] Result<Behaviors> analyze(AST::IfStatement&);
    [[nodiscard]] Result<Behaviors> analyze(AST::LoopStatement&);
    [[nodiscard]] Result<Behaviors> analyze(AST::SwitchStatement&);
    [[nodiscard]] Result<Behaviors> analyze(AST::WhileStatement&);
    [[nodiscard]] Result<Behaviors> analyzeStatements(AST::Statement::List&);

    ShaderModule& m_shaderModule;
    const Type* m_inferredType { nullptr };
    const Type* m_returnType { nullptr };
    std::optional<Evaluation> m_currentEvaluation { std::nullopt };
    Evaluation m_maxEvaluation { Evaluation::Runtime };
    DiscardResult m_discardResult { DiscardResult::No };
    bool m_suppressConstantErrors { false };

    TypeStore& m_types;
    Vector<BreakTarget> m_breakTargetStack;
    HashMap<String, AST::IdentifierExpression*> m_arrayCountOverrides;
};

TypeChecker::TypeChecker(ShaderModule& shaderModule)
    : m_shaderModule(shaderModule)
    , m_types(shaderModule.types())
{
}

Result<void> TypeChecker::declareBuiltins()
{
    CHECK(introduceType(AST::Identifier::make("bool"_s), m_types.boolType()));
    CHECK(introduceType(AST::Identifier::make("i32"_s), m_types.i32Type()));
    CHECK(introduceType(AST::Identifier::make("u32"_s), m_types.u32Type()));
    CHECK(introduceType(AST::Identifier::make("f32"_s), m_types.f32Type()));
    CHECK(introduceType(AST::Identifier::make("f16"_s), m_types.f16Type()));
    CHECK(introduceType(AST::Identifier::make("sampler"_s), m_types.samplerType()));
    CHECK(introduceType(AST::Identifier::make("sampler_comparison"_s), m_types.samplerComparisonType()));
    CHECK(introduceType(AST::Identifier::make("texture_external"_s), m_types.textureExternalType()));

    CHECK(introduceType(AST::Identifier::make("texture_depth_2d"_s), m_types.textureDepth2dType()));
    CHECK(introduceType(AST::Identifier::make("texture_depth_2d_array"_s), m_types.textureDepth2dArrayType()));
    CHECK(introduceType(AST::Identifier::make("texture_depth_cube"_s), m_types.textureDepthCubeType()));
    CHECK(introduceType(AST::Identifier::make("texture_depth_cube_array"_s), m_types.textureDepthCubeArrayType()));
    CHECK(introduceType(AST::Identifier::make("texture_depth_multisampled_2d"_s), m_types.textureDepthMultisampled2dType()));

    CHECK(introduceType(AST::Identifier::make("ptr"_s), m_types.typeConstructorType(
        "ptr"_s,
        [this](AST::ElaboratedTypeExpression& type) -> Result<const Type*> {
            auto argumentCount = type.arguments().size();
            if (argumentCount < 2) [[unlikely]]
                TYPE_ERROR(type.span(), "'ptr' requires at least 2 template arguments"_s);

            if (argumentCount > 3) [[unlikely]]
                TYPE_ERROR(type.span(), "'ptr' requires at most 3 template arguments"_s);

            UNWRAP(addressSpace, addressSpace(type.arguments()[0]));
            UNWRAP(elementType, resolve(type.arguments()[1]));

            if (!elementType->isStorable()) [[unlikely]]
                TYPE_ERROR(type.span(), '\'', *elementType, "' cannot be used as the store type of a pointer"_s);

            if (std::holds_alternative<Types::Atomic>(*elementType) && addressSpace != AddressSpace::Storage && addressSpace != AddressSpace::Workgroup) [[unlikely]]
                TYPE_ERROR(type.span(), '\'', *elementType, "' atomic variables must have <storage> or <workgroup> address space"_s);

            if (elementType->containsRuntimeArray() && addressSpace != AddressSpace::Storage) [[unlikely]]
                TYPE_ERROR(type.span(), "runtime-sized arrays can only be used in the <storage> address space"_s);

            AccessMode accessMode;
            if (argumentCount > 2) {
                if (addressSpace != AddressSpace::Storage) [[unlikely]]
                    TYPE_ERROR(type.arguments()[2].span(), "only pointers in <storage> address space may specify an access mode"_s);

                UNWRAP_ASSIGN(accessMode, this->accessMode(type.arguments()[2]));

                if (accessMode == AccessMode::Write) [[unlikely]]
                    TYPE_ERROR(type.arguments()[2].span(), "access mode 'write' is not valid for the <storage> address space"_s);
            } else {
                switch (addressSpace) {
                case AddressSpace::Function:
                case AddressSpace::Private:
                case AddressSpace::Workgroup:
                    accessMode = AccessMode::ReadWrite;
                    break;
                case AddressSpace::Uniform:
                case AddressSpace::Storage:
                case AddressSpace::Handle:
                    accessMode = AccessMode::Read;
                    break;
                }
            }

            return { m_types.pointerType(addressSpace, elementType, accessMode) };
        }
    )));

    CHECK(introduceType(AST::Identifier::make("atomic"_s), m_types.typeConstructorType(
        "atomic"_s,
        [this](AST::ElaboratedTypeExpression& type) -> Result<const Type*> {
            if (type.arguments().size() != 1) [[unlikely]]
                TYPE_ERROR(type.span(), "'atomic' requires 1 template argument"_s);

            UNWRAP(elementType, resolve(type.arguments()[0]));

            if (elementType != m_types.i32Type() && elementType != m_types.u32Type()) [[unlikely]]
                TYPE_ERROR(type.arguments()[0].span(), "atomic only supports i32 or u32 types"_s);

            return { m_types.atomicType(elementType) };
        }
    )));

    const auto& validateVector = [&](const Type* element) -> std::optional<String> {
        if (!satisfies(element, Constraints::Scalar))
            return { "vector element type must be a scalar type"_s };
        return std::nullopt;
    };

    CHECK(allocateSimpleConstructor("vec2"_s, &TypeStore::vectorType, validateVector, 2));
    CHECK(allocateSimpleConstructor("vec3"_s, &TypeStore::vectorType, validateVector, 3));
    CHECK(allocateSimpleConstructor("vec4"_s, &TypeStore::vectorType, validateVector, 4));

    const auto& validateMatrix = [&](const Type* element) -> std::optional<String> {
        if (!satisfies(element, Constraints::Float))
            return { "matrix element type must be a floating point type"_s };
        return std::nullopt;
    };
    CHECK(allocateSimpleConstructor("mat2x2"_s, &TypeStore::matrixType, validateMatrix, 2, 2));
    CHECK(allocateSimpleConstructor("mat2x3"_s, &TypeStore::matrixType, validateMatrix, 2, 3));
    CHECK(allocateSimpleConstructor("mat2x4"_s, &TypeStore::matrixType, validateMatrix, 2, 4));
    CHECK(allocateSimpleConstructor("mat3x2"_s, &TypeStore::matrixType, validateMatrix, 3, 2));
    CHECK(allocateSimpleConstructor("mat3x3"_s, &TypeStore::matrixType, validateMatrix, 3, 3));
    CHECK(allocateSimpleConstructor("mat3x4"_s, &TypeStore::matrixType, validateMatrix, 3, 4));
    CHECK(allocateSimpleConstructor("mat4x2"_s, &TypeStore::matrixType, validateMatrix, 4, 2));
    CHECK(allocateSimpleConstructor("mat4x3"_s, &TypeStore::matrixType, validateMatrix, 4, 3));
    CHECK(allocateSimpleConstructor("mat4x4"_s, &TypeStore::matrixType, validateMatrix, 4, 4));

    const auto& validateTexture = [&](const Type* element) -> std::optional<String> {
        if (!satisfies(element, Constraints::Concrete32BitNumber))
            return { "texture sampled type must be one 'i32', 'u32' or 'f32'"_s };
        return std::nullopt;
    };
    CHECK(allocateSimpleConstructor("texture_1d"_s, &TypeStore::textureType, validateTexture, Types::Texture::Kind::Texture1d));
    CHECK(allocateSimpleConstructor("texture_2d"_s, &TypeStore::textureType, validateTexture, Types::Texture::Kind::Texture2d));
    CHECK(allocateSimpleConstructor("texture_2d_array"_s, &TypeStore::textureType, validateTexture, Types::Texture::Kind::Texture2dArray));
    CHECK(allocateSimpleConstructor("texture_3d"_s, &TypeStore::textureType, validateTexture, Types::Texture::Kind::Texture3d));
    CHECK(allocateSimpleConstructor("texture_cube"_s, &TypeStore::textureType, validateTexture, Types::Texture::Kind::TextureCube));
    CHECK(allocateSimpleConstructor("texture_cube_array"_s, &TypeStore::textureType, validateTexture, Types::Texture::Kind::TextureCubeArray));
    CHECK(allocateSimpleConstructor("texture_multisampled_2d"_s, &TypeStore::textureType, validateTexture, Types::Texture::Kind::TextureMultisampled2d));

    CHECK(allocateTextureStorageConstructor("texture_storage_1d"_s, Types::TextureStorage::Kind::TextureStorage1d));
    CHECK(allocateTextureStorageConstructor("texture_storage_2d"_s, Types::TextureStorage::Kind::TextureStorage2d));
    CHECK(allocateTextureStorageConstructor("texture_storage_2d_array"_s, Types::TextureStorage::Kind::TextureStorage2dArray));
    CHECK(allocateTextureStorageConstructor("texture_storage_3d"_s, Types::TextureStorage::Kind::TextureStorage3d));

    CHECK(introduceValue(AST::Identifier::make("read"_s), m_types.accessModeType()));
    CHECK(introduceValue(AST::Identifier::make("write"_s), m_types.accessModeType()));
    CHECK(introduceValue(AST::Identifier::make("read_write"_s), m_types.accessModeType()));

    CHECK(introduceValue(AST::Identifier::make("bgra8unorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r32float"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r32sint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r32uint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg32float"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg32sint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg32uint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba16float"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba16sint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba16uint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba32float"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba32sint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba32uint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba8sint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba8snorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba8uint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba8unorm"_s), m_types.texelFormatType()));

    CHECK(introduceValue(AST::Identifier::make("r16float"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r16sint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r16uint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r8sint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r8snorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r8uint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r8unorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg16float"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg8sint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg8snorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg8uint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg8unorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgb10a2uint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgb10a2unorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg16sint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg16uint"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg11b10ufloat"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r16unorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("r16snorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg16snorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rg16unorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba16snorm"_s), m_types.texelFormatType()));
    CHECK(introduceValue(AST::Identifier::make("rgba16unorm"_s), m_types.texelFormatType()));

    CHECK(introduceValue(AST::Identifier::make("function"_s), m_types.addressSpaceType()));
    CHECK(introduceValue(AST::Identifier::make("private"_s), m_types.addressSpaceType()));
    CHECK(introduceValue(AST::Identifier::make("workgroup"_s), m_types.addressSpaceType()));
    CHECK(introduceValue(AST::Identifier::make("uniform"_s), m_types.addressSpaceType()));
    CHECK(introduceValue(AST::Identifier::make("storage"_s), m_types.addressSpaceType()));

    // This file contains the declarations generated from `TypeDeclarations.rb`
#include "TypeDeclarations.h" // NOLINT

    return { };
}

std::optional<FailedCheck> TypeChecker::check()
{

    auto result = [&] [[nodiscard]] -> Result<void> {
        CHECK(declareBuiltins());

        ContextScope moduleScope(this);

        CHECK(visit(m_shaderModule));
        return { };
    }();

    if (!!result) [[likely]]
        return std::nullopt;

    auto error = result.error();
    if (shouldDumpInferredTypes) [[unlikely]]
        dataLogLn(result.error());

    Vector<Warning> warnings { };
    return FailedCheck { { result.error() }, WTF::move(warnings) };
}

Result<void> TypeChecker::visit(ShaderModule& shaderModule)
{
    for (auto& declaration : shaderModule.declarations())
        CHECK(visit(declaration));
    return { };
}

// Declarations
Result<void> TypeChecker::visit(AST::Declaration& declaration)
{
    switch (declaration.kind()) {
    case AST::NodeKind::Function:
        return visit(uncheckedDowncast<AST::Function>(declaration));
    case AST::NodeKind::Variable:
        return visit(uncheckedDowncast<AST::Variable>(declaration));
    case AST::NodeKind::Structure:
        return visit(uncheckedDowncast<AST::Structure>(declaration));
    case AST::NodeKind::TypeAlias:
        return visit(uncheckedDowncast<AST::TypeAlias>(declaration));
    case AST::NodeKind::ConstAssert:
        return visit(uncheckedDowncast<AST::ConstAssert>(declaration));
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

Result<void> TypeChecker::visit(AST::Structure& structure)
{
    HashMap<String, const Type*> fields;
    for (unsigned i = 0; i < structure.members().size(); ++i) {
        auto& member = structure.members()[i];
        CHECK(visitAttributes(member.attributes()));
        UNWRAP(memberType, resolve(member.type()));

        if (!memberType->hasCreationFixedFootprint()) {
            if (!memberType->containsRuntimeArray()) [[unlikely]]
                TYPE_ERROR(member.span(), "type '"_s, *memberType, "' cannot be used as a struct member because it does not have creation-fixed footprint"_s);

            if (!std::holds_alternative<Types::Array>(*memberType)) [[unlikely]]
                TYPE_ERROR(member.span(), "a struct that contains a runtime array cannot be nested inside another struct"_s);

            if (i != structure.members().size() - 1) [[unlikely]]
                TYPE_ERROR(member.span(), "runtime arrays may only appear as the last member of a struct"_s);
        }

        auto result = fields.add(member.name().id(), memberType);
        ASSERT_UNUSED(result, result.isNewEntry);
    }

    const Type* structType = m_types.structType(structure, WTF::move(fields));
    structure.m_inferredType = structType;
    CHECK(introduceType(structure.name(), structType));
    return { };
}

Result<void> TypeChecker::visit(AST::Variable& variable)
{
    CHECK(visitAttributes(variable.attributes()));

    const Type* result = nullptr;
    std::optional<ConstantValue>* value = nullptr;

    Evaluation evaluation { Evaluation::Runtime };
    if (variable.flavor() == AST::VariableFlavor::Const)
        evaluation = Evaluation::Constant;
    else if (variable.flavor() == AST::VariableFlavor::Override)
        evaluation = Evaluation::Override;

    if (variable.maybeTypeName())
        UNWRAP_ASSIGN(result, resolve(*variable.maybeTypeName()));

    if (variable.maybeInitializer()) {
        auto initializerEvaluation = evaluation;
        if (variable.flavor() == AST::VariableFlavor::Var && isModuleScope())
            initializerEvaluation = Evaluation::Override;
        UNWRAP(initializerType, infer(*variable.maybeInitializer(), initializerEvaluation));
        auto& constantValue = variable.maybeInitializer()->m_constantValue;
        if (constantValue.has_value())
            value = &constantValue;

        if (auto* reference = std::get_if<Types::Reference>(initializerType)) {
            initializerType = reference->element;
            variable.maybeInitializer()->m_inferredType = initializerType;
        }

        if (!result) {
            if (initializerType == m_types.voidType()) [[unlikely]]
                TYPE_ERROR(variable.span(), "cannot initialize variable with expression of type 'void'"_s);

            if (variable.flavor() == AST::VariableFlavor::Const)
                result = initializerType;
            else {
                result = concretize(initializerType, m_types);
                if (!result) [[unlikely]]
                    TYPE_ERROR(variable.span(), '\'', *initializerType, "' cannot be used as the type of a '"_s, variableFlavorToString(variable.flavor()), '\'');
                variable.maybeInitializer()->m_inferredType = result;
            }
        } else if (unify(result, initializerType))
            variable.maybeInitializer()->m_inferredType = result;
        else [[unlikely]]
            TYPE_ERROR(variable.span(), "cannot initialize var of type '"_s, *result, "' with value of type '"_s, *initializerType, '\'');
    }

    switch (variable.flavor()) {
    case AST::VariableFlavor::Let:
        if (isModuleScope()) [[unlikely]]
            TYPE_ERROR(variable.span(), "module-scope 'let' is invalid, use 'const'"_s);
        if (!result->isConstructible() && !std::holds_alternative<Types::Pointer>(*result)) [[unlikely]]
            TYPE_ERROR(variable.span(), '\'', *result, "' cannot be used as the type of a 'let'"_s);
        RELEASE_ASSERT(variable.maybeInitializer());
        break;
    case AST::VariableFlavor::Const:
        RELEASE_ASSERT(variable.maybeInitializer());
        if (!result->isConstructible()) [[unlikely]]
            TYPE_ERROR(variable.span(), '\'', *result, "' cannot be used as the type of a 'const'"_s);
        break;
    case AST::VariableFlavor::Override:
        RELEASE_ASSERT(isModuleScope());
        if (!satisfies(result, Constraints::ConcreteScalar)) [[unlikely]]
            TYPE_ERROR(variable.span(), '\'', *result, "' cannot be used as the type of an 'override'"_s);
        m_shaderModule.addOverride(variable);
        break;
    case AST::VariableFlavor::Var:
        AddressSpace addressSpace;
        AccessMode accessMode;
        if (auto* maybeQualifier = variable.maybeQualifier()) {
            addressSpace = maybeQualifier->addressSpace();
            accessMode = maybeQualifier->accessMode();
        } else if (!isModuleScope()) {
            addressSpace = AddressSpace::Function;
            accessMode = AccessMode::ReadWrite;
        } else {
            addressSpace = AddressSpace::Handle;
            accessMode = AccessMode::Read;
        }
        variable.m_addressSpace = addressSpace;
        variable.m_accessMode = accessMode;

        // https://www.w3.org/TR/WGSL/#var-and-value
        switch (addressSpace) {
        case AddressSpace::Storage:
            if (accessMode == AccessMode::Write) [[unlikely]]
                TYPE_ERROR(variable.span(), "access mode 'write' is not valid for the <storage> address space"_s);
            if (!result->isHostShareable()) [[unlikely]]
                TYPE_ERROR(variable.span(), "type '"_s, *result, "' cannot be used in address space <storage> because it's not host-shareable"_s);
            if (accessMode == AccessMode::Read && std::holds_alternative<Types::Atomic>(*result)) [[unlikely]]
                TYPE_ERROR(variable.span(), "atomic variables in <storage> address space must have read_write access mode"_s);
            break;
        case AddressSpace::Uniform:
            if (!result->isHostShareable()) [[unlikely]]
                TYPE_ERROR(variable.span(), "type '"_s, *result, "' cannot be used in address space <uniform> because it's not host-shareable"_s);
            if (!result->isConstructible()) [[unlikely]]
                TYPE_ERROR(variable.span(), "type '"_s, *result, "' cannot be used in address space <uniform> because it's not constructible"_s);
            break;
        case AddressSpace::Workgroup:
            if (!result->hasFixedFootprint()) [[unlikely]]
                TYPE_ERROR(variable.span(), "type '"_s, *result, "' cannot be used in address space <workgroup> because it doesn't have fixed footprint"_s);
            break;
        case AddressSpace::Function:
            if (!result->isConstructible()) [[unlikely]]
                TYPE_ERROR(variable.span(), "type '"_s, *result, "' cannot be used in address space <function> because it's not constructible"_s);
            break;
        case AddressSpace::Private:
            if (!result->isConstructible()) [[unlikely]]
                TYPE_ERROR(variable.span(), "type '"_s, *result, "' cannot be used in address space <private> because it's not constructible"_s);
            break;
        case AddressSpace::Handle: {
            auto* primitive = std::get_if<Types::Primitive>(result);
            bool isTextureOrSampler = std::holds_alternative<Types::Texture>(*result)
                || std::holds_alternative<Types::TextureStorage>(*result)
                || std::holds_alternative<Types::TextureDepth>(*result)
                || (primitive && (
                    primitive->kind == Types::Primitive::TextureExternal
                    || primitive->kind == Types::Primitive::Sampler
                    || primitive->kind == Types::Primitive::SamplerComparison
                ));
            if (!isTextureOrSampler) [[unlikely]]
                TYPE_ERROR(variable.span(), "module-scope 'var' declarations that are not of texture or sampler types must provide an address space"_s);
            break;
        }
        }

        if (addressSpace == AddressSpace::Function && isModuleScope()) [[unlikely]]
            TYPE_ERROR(variable.span(), "module-scope 'var' must not use address space 'function'"_s);
        if (addressSpace != AddressSpace::Function && !isModuleScope()) [[unlikely]]
            TYPE_ERROR(variable.span(), "function-scope 'var' declaration must use 'function' address space"_s);
        if ((addressSpace == AddressSpace::Storage || addressSpace == AddressSpace::Uniform || addressSpace == AddressSpace::Handle || addressSpace == AddressSpace::Workgroup) && variable.maybeInitializer()) [[unlikely]]
            TYPE_ERROR(variable.span(), "variables in the address space '"_s, toString(addressSpace), "' cannot have an initializer"_s);
        if (addressSpace != AddressSpace::Workgroup && result->containsOverrideArray()) [[unlikely]]
            TYPE_ERROR(variable.span(), "array with an 'override' element count can only be used as the store type of a 'var<workgroup>'"_s);
    }

    if (value)
        CHECK(convertValue(variable.span(), result, *value));

    if (variable.flavor() != AST::VariableFlavor::Const)
        value = nullptr;

    variable.m_storeType = result;

    if (variable.flavor() == AST::VariableFlavor::Var) {
        result = m_types.referenceType(*variable.addressSpace(), result, *variable.accessMode());
        auto* typeName = variable.maybeTypeName();
        if (!typeName)
            typeName = &m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(SourceSpan::empty(), AST::Identifier::make(result->toString()));
        auto& referenceType = m_shaderModule.astBuilder().construct<AST::ReferenceTypeExpression>(
            typeName->span(),
            *typeName
        );
        referenceType.m_inferredType = result;
        variable.m_referenceType = &referenceType;
    }

    CHECK(introduceValue(variable.name(), result, evaluation, value ? std::optional<ConstantValue>(*value) : std::nullopt));
    return { };
}

Result<void> TypeChecker::visit(AST::TypeAlias& alias)
{
    UNWRAP(type, resolve(alias.type()));
    CHECK(introduceType(alias.name(), type));
    return { };
}

Result<void> TypeChecker::visit(AST::ConstAssert& assertion)
{
    UNWRAP(testType, infer(assertion.test(), Evaluation::Constant));
    if (!unify(m_types.boolType(), testType)) [[unlikely]]
        TYPE_ERROR(assertion.test().span(), "const assertion condition must be a bool, got '"_s, *testType, '\'');

    // TODO: we might be able to remove this since we introduced the Evaluation abovee
    auto constantValue = assertion.test().constantValue();
    if (!constantValue) [[unlikely]]
        TYPE_ERROR(assertion.test().span(), "const assertion requires a const-expression"_s);

    if (!std::get<bool>(*constantValue)) [[unlikely]]
        TYPE_ERROR(assertion.span(), "const assertion failed"_s);

    return { };
}

Result<void> TypeChecker::visit(AST::Function& function)
{
    bool mustUse = false;
    for (auto& attribute : function.attributes()) {
        if (is<AST::MustUseAttribute>(attribute)) {
            mustUse = true;
            continue;
        }

        CHECK(visit(attribute));
    }

    Vector<const Type*> parameters;
    parameters.reserveInitialCapacity(function.parameters().size());
    for (auto& parameter : function.parameters()) {
        CHECK(visitAttributes(parameter.attributes()));
        UNWRAP(parameterType, resolve(parameter.typeName()));
        if (!parameterType->isConstructible() && !std::holds_alternative<Types::Pointer>(*parameterType) && !parameterType->isTexture() && !parameterType->isSampler()) [[unlikely]]
            TYPE_ERROR(parameter.span(), "type of function parameter must be constructible or a pointer, sampler or texture"_s);
        parameters.append(parameterType);
    }

    CHECK(visitAttributes(function.returnAttributes()));
    if (!function.maybeReturnType())
        m_returnType = m_types.voidType();
    else {
        UNWRAP_ASSIGN(m_returnType, resolve(*function.maybeReturnType()));
        if (!m_returnType->isConstructible()) [[unlikely]]
            TYPE_ERROR(function.maybeReturnType()->span(), "function return type must be a constructible type"_s);
    }

    {
        ContextScope functionContext(this);
        for (unsigned i = 0; i < parameters.size(); ++i)
            CHECK(introduceValue(function.parameters()[i].name(), parameters[i]));
        // We visit the statements here instead of the compound statement since
        // we don't want to introduce an extra context scope
        CHECK(visitStatements(function.body().statements()));

        UNWRAP(behaviors, analyze(function.body()));
        if (behaviors.contains(Behavior::Next) && function.maybeReturnType()) [[unlikely]]
            TYPE_ERROR(function.span(), "missing return at end of function"_s);
        ASSERT(!behaviors.containsAny({ Behavior::Break, Behavior::Continue }));
    }

    const Type* functionType = m_types.functionType(WTF::move(parameters), m_returnType, mustUse);
    CHECK(introduceFunction(function.name(), functionType));

    m_returnType = nullptr;

    return { };
}

// Attributes
Result<void> TypeChecker::visit(AST::Attribute& attribute)
{
    switch (attribute.kind()) {
    case AST::NodeKind::AlignAttribute:
        return visit(uncheckedDowncast<AST::AlignAttribute>(attribute));
    case AST::NodeKind::BindingAttribute:
        return visit(uncheckedDowncast<AST::BindingAttribute>(attribute));
    case AST::NodeKind::GroupAttribute:
        return visit(uncheckedDowncast<AST::GroupAttribute>(attribute));
    case AST::NodeKind::IdAttribute:
        return visit(uncheckedDowncast<AST::IdAttribute>(attribute));
    case AST::NodeKind::LocationAttribute:
        return visit(uncheckedDowncast<AST::LocationAttribute>(attribute));
    case AST::NodeKind::SizeAttribute:
        return visit(uncheckedDowncast<AST::SizeAttribute>(attribute));
    case AST::NodeKind::WorkgroupSizeAttribute:
        return visit(uncheckedDowncast<AST::WorkgroupSizeAttribute>(attribute));
    case AST::NodeKind::BuiltinAttribute:
    case AST::NodeKind::ConstAttribute:
    case AST::NodeKind::DiagnosticAttribute:
    case AST::NodeKind::InterpolateAttribute:
    case AST::NodeKind::InvariantAttribute:
    case AST::NodeKind::MustUseAttribute:
    case AST::NodeKind::StageAttribute:
        return { };
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

Result<void> TypeChecker::visit(AST::AlignAttribute& attribute)
{
    UNWRAP(type, check(attribute.alignment(), Constraints::ConcreteInteger, Evaluation::Constant));
    if (!type) [[unlikely]]
        TYPE_ERROR(attribute.span(), "@align must be an i32 or u32 value"_s);
    return { };
}

Result<void> TypeChecker::visit(AST::BindingAttribute& attribute)
{
    UNWRAP(type, check(attribute.binding(), Constraints::ConcreteInteger, Evaluation::Constant));
    if (!type) [[unlikely]]
        TYPE_ERROR(attribute.span(), "@binding must be an i32 or u32 value"_s);
    return { };
}

Result<void> TypeChecker::visit(AST::GroupAttribute& attribute)
{
    UNWRAP(type, check(attribute.group(), Constraints::ConcreteInteger, Evaluation::Constant));
    if (!type) [[unlikely]]
        TYPE_ERROR(attribute.span(), "@group must be an i32 or u32 value"_s);
    return { };
}

Result<void> TypeChecker::visit(AST::IdAttribute& attribute)
{
    UNWRAP(type, check(attribute.value(), Constraints::ConcreteInteger, Evaluation::Constant));
    if (!type) [[unlikely]]
        TYPE_ERROR(attribute.span(), "@id must be an i32 or u32 value"_s);
    return { };
}

Result<void> TypeChecker::visit(AST::LocationAttribute& attribute)
{
    UNWRAP(type, check(attribute.location(), Constraints::ConcreteInteger, Evaluation::Constant));
    if (!type) [[unlikely]]
        TYPE_ERROR(attribute.span(), "@location must be an i32 or u32 value"_s);
    return { };
}

Result<void> TypeChecker::visit(AST::SizeAttribute& attribute)
{
    UNWRAP(type, check(attribute.size(), Constraints::ConcreteInteger, Evaluation::Constant));
    if (!type) [[unlikely]]
        TYPE_ERROR(attribute.span(), "@size must be an i32 or u32 value"_s);
    return { };
}

Result<void> TypeChecker::visit(AST::WorkgroupSizeAttribute& attribute)
{
    UNWRAP(xType, infer(attribute.x(), Evaluation::Override));
    if (!satisfies(xType, Constraints::ConcreteInteger)) [[unlikely]]
        TYPE_ERROR(attribute.span(), "@workgroup_size x dimension must be an i32 or u32 value"_s);

    const Type* yType = nullptr;
    const Type* zType = nullptr;
    if (auto* y = attribute.maybeY()) {
        UNWRAP_ASSIGN(yType, infer(*y, Evaluation::Override));
        if (!satisfies(yType, Constraints::ConcreteInteger)) [[unlikely]]
            TYPE_ERROR(attribute.span(), "@workgroup_size y dimension must be an i32 or u32 value"_s);

        if (auto* z = attribute.maybeZ()) {
            UNWRAP_ASSIGN(zType, infer(*z, Evaluation::Override));
            if (!satisfies(zType, Constraints::ConcreteInteger)) [[unlikely]]
                TYPE_ERROR(attribute.span(), "@workgroup_size z dimension must be an i32 or u32 value"_s);
        }

    }

    const auto& satisfies = [&](const Type* type) {
        return unify(type, xType)
            && (!yType || unify(type, yType))
            && (!zType || unify(type, zType));
    };

    if (!satisfies(m_types.i32Type()) && !satisfies(m_types.u32Type())) [[unlikely]]
        TYPE_ERROR(attribute.span(), "@workgroup_size arguments must be of the same type, either i32 or u32"_s);

    return { };
}

// Statements
Result<void> TypeChecker::visit(AST::Statement& statement)
{
    switch (statement.kind()) {
    case AST::NodeKind::AssignmentStatement:
        return visit(uncheckedDowncast<AST::AssignmentStatement>(statement));
    case AST::NodeKind::CallStatement:
        return visit(uncheckedDowncast<AST::CallStatement>(statement));
    case AST::NodeKind::CompoundAssignmentStatement:
        return visit(uncheckedDowncast<AST::CompoundAssignmentStatement>(statement));
    case AST::NodeKind::CompoundStatement:
        return visit(uncheckedDowncast<AST::CompoundStatement>(statement));
    case AST::NodeKind::ConstAssertStatement:
        return visit(uncheckedDowncast<AST::ConstAssertStatement>(statement).assertion());
    case AST::NodeKind::DecrementIncrementStatement:
        return visit(uncheckedDowncast<AST::DecrementIncrementStatement>(statement));
    case AST::NodeKind::ForStatement:
        return visit(uncheckedDowncast<AST::ForStatement>(statement));
    case AST::NodeKind::IfStatement:
        return visit(uncheckedDowncast<AST::IfStatement>(statement));
    case AST::NodeKind::LoopStatement:
        return visit(uncheckedDowncast<AST::LoopStatement>(statement));
    case AST::NodeKind::PhonyAssignmentStatement:
        return visit(uncheckedDowncast<AST::PhonyAssignmentStatement>(statement));
    case AST::NodeKind::ReturnStatement:
        return visit(uncheckedDowncast<AST::ReturnStatement>(statement));
    case AST::NodeKind::SwitchStatement:
        return visit(uncheckedDowncast<AST::SwitchStatement>(statement));
    case AST::NodeKind::VariableStatement:
        return visit(uncheckedDowncast<AST::VariableStatement>(statement).variable());
    case AST::NodeKind::WhileStatement:
        return visit(uncheckedDowncast<AST::WhileStatement>(statement));
    case AST::NodeKind::BreakStatement:
    case AST::NodeKind::ContinueStatement:
    case AST::NodeKind::DiscardStatement:
        return { };
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

Result<void> TypeChecker::visit(AST::AssignmentStatement& statement)
{
    UNWRAP(lhs, infer(statement.lhs(), Evaluation::Runtime));
    UNWRAP(rhs, infer(statement.rhs(), Evaluation::Runtime));

    auto* reference = std::get_if<Types::Reference>(lhs);
    if (!reference)  [[unlikely]]
        TYPE_ERROR(statement.span(), "cannot assign to a value of type '"_s, *lhs, '\'');

    if (reference->accessMode == AccessMode::Read) [[unlikely]]
        TYPE_ERROR(statement.span(), "cannot store into a read-only type '"_s, *lhs, '\'');

    if (!unify(reference->element, rhs)) [[unlikely]]
        TYPE_ERROR(statement.span(), "cannot assign value of type '"_s, *rhs, "' to '"_s, *reference->element, '\'');

    statement.rhs().m_inferredType = reference->element;
    auto& value = statement.rhs().m_constantValue;
    if (value.has_value())
        CHECK(convertValue(statement.rhs().span(), statement.rhs().inferredType(), value));

    return { };
}

Result<void> TypeChecker::visit(AST::CallStatement& statement)
{
    CHECK(infer(statement.call(), Evaluation::Runtime, DiscardResult::Yes));
    return { };
}

Result<void> TypeChecker::visit(AST::CompoundAssignmentStatement& statement)
{
    UNWRAP(left, infer(statement.leftExpression(), Evaluation::Runtime));
    auto* referenceType = std::get_if<Types::Reference>(left);
    if (!referenceType) [[unlikely]]
        TYPE_ERROR(statement.span(), "cannot assign to a value of type '"_s, *left, '\'');

    CHECK(binaryExpression(statement.span(), nullptr, statement.operation(), statement.leftExpression(), statement.rightExpression()));

    if (m_inferredType != referenceType->element) [[unlikely]]
        TYPE_ERROR(statement.span(), "cannot assign '"_s, *m_inferredType, "' to '"_s, *referenceType->element, '\'');

    // Reset the inferred type since this is a statement
    m_inferredType = nullptr;
    m_currentEvaluation = std::nullopt;

    return { };
}

Result<void> TypeChecker::visit(AST::CompoundStatement& statement)
{
    ContextScope blockScope(this);
    return visitStatements(statement.statements());
}

Result<void> TypeChecker::visitStatements(AST::Statement::List& statements)
{
    for (auto& statement : statements)
        CHECK(visit(statement));
    return { };
}

Result<void> TypeChecker::visit(AST::DecrementIncrementStatement& statement)
{
    UNWRAP(expression, infer(statement.expression(), Evaluation::Runtime));

    auto* reference = std::get_if<Types::Reference>(expression);
    if (!reference) [[unlikely]]
        TYPE_ERROR(statement.span(), "cannot modify a value of type '"_s, *expression, '\'');

    if (reference->accessMode == AccessMode::Read) [[unlikely]]
        TYPE_ERROR(statement.span(), "cannot modify read-only type '"_s, *expression, '\'');

    if (!unify(m_types.i32Type(), reference->element) && !unify(m_types.u32Type(), reference->element)) [[unlikely]] {
        ASCIILiteral operation;
        switch (statement.operation()) {
        case AST::DecrementIncrementStatement::Operation::Increment:
            operation = "increment"_s;
            break;
        case AST::DecrementIncrementStatement::Operation::Decrement:
            operation = "decrement"_s;
            break;
        }
        TYPE_ERROR(statement.span(), operation, " can only be applied to integers, found "_s, *reference->element);
    }

    return { };
}

Result<void> TypeChecker::visit(AST::IfStatement& statement)
{
    UNWRAP(test, infer(statement.test(), Evaluation::Runtime));

    if (!unify(test, m_types.boolType())) [[unlikely]]
        TYPE_ERROR(statement.test().span(), "expected 'bool', found '"_s, *test, "'"_s);

    CHECK(visit(statement.trueBody()));
    if (statement.maybeFalseBody())
        CHECK(visit(*statement.maybeFalseBody()));

    return { };
}

Result<void> TypeChecker::visit(AST::PhonyAssignmentStatement& statement)
{
    CHECK(infer(statement.rhs(), Evaluation::Runtime));
    return { };
}

Result<void> TypeChecker::visit(AST::ReturnStatement& statement)
{
    const Type* type;
    auto* expression = statement.maybeExpression();
    if (expression)
        UNWRAP_ASSIGN(type, infer(*expression, Evaluation::Runtime))
    else
        type = m_types.voidType();

    if (!unify(m_returnType, type)) [[unlikely]]
        TYPE_ERROR(statement.span(), "return statement type does not match its function return type, returned '"_s, *type, "', expected '"_s, *m_returnType, '\'');

    if (expression) {
        expression->m_inferredType = m_returnType;
        if (auto& value = expression->m_constantValue)
            CHECK(convertValue(expression->span(), m_returnType, value));
    }

    return { };
}

Result<void> TypeChecker::visit(AST::ForStatement& statement)
{
    ContextScope forScope(this);
    if (auto* initializer = statement.maybeInitializer())
        CHECK(visit(*initializer));

    if (auto* test = statement.maybeTest()) {
        UNWRAP(testType, infer(*test, Evaluation::Runtime));
        if (!unify(m_types.boolType(), testType)) [[unlikely]]
            TYPE_ERROR(test->span(), "for-loop condition must be bool, got "_s, *testType);
    }

    if (auto* update = statement.maybeUpdate())
        CHECK(visit(*update));

    CHECK(visit(statement.body()));

    return { };
}

Result<void> TypeChecker::visit(AST::LoopStatement& statement)
{
    ContextScope loopScope(this);
    CHECK(visitAttributes(statement.attributes()));

    for (auto& statement : statement.body())
        CHECK(visit(statement));

    if (auto& continuing = statement.continuing())
        CHECK(visit(*continuing));

    return { };
}

Result<void> TypeChecker::visit(AST::WhileStatement& statement)
{
    UNWRAP(testType, infer(statement.test(), Evaluation::Runtime));
    if (!unify(m_types.boolType(), testType)) [[unlikely]]
        TYPE_ERROR(statement.test().span(), "while condition must be bool, got "_s, *testType);

    CHECK(visit(statement.body()));

    return { };
}

Result<void> TypeChecker::visit(AST::SwitchStatement& statement)
{
    UNWRAP(valueType, infer(statement.value(), Evaluation::Runtime));
    if (!satisfies(valueType, Constraints::ConcreteInteger)) [[unlikely]]
        TYPE_ERROR(statement.value().span(), "switch selector must be of type i32 or u32"_s);

    const auto& visitClause = [&](AST::SwitchClause& clause) -> Result<void> {
        for (auto& selector : clause.selectors) {
            UNWRAP(selectorType, infer(selector, Evaluation::Runtime));
            if (unify(valueType, selectorType)) {
                // If the selectorType can satisfy the value type, we're good to go.
                // e.g. valueType is i32 or u32 and the selector is a literal of type AbstractInt
                continue;
            }
            if (unify(selectorType, valueType)) {
                // If the opposite is true, we have to promote valueType
                // e.g. valueType is a constant of type AbstractInt and the selector has type i32 or u32
                valueType = selectorType;
                continue;
            }
            // Otherwise, the types are incompatible, and we have an error
            // e.g. valueType has type u32 the selector has type i32
            TYPE_ERROR(selector.span(), "the case selector values must have the same type as the selector expression: the selector expression has type '"_s, *valueType, "' and case selector has type '"_s, *selectorType, '\'');
        }
        CHECK(visit(clause.body));

        return { };
    };

    CHECK(visitAttributes(statement.bodyAttributes()));
    CHECK(visitClause(statement.defaultClause()));
    for (auto& clause : statement.clauses())
        CHECK(visitClause(clause));

    return { };
}

// Expressions
Result<void> TypeChecker::visit(AST::Expression& expression)
{
    switch (expression.kind()) {
    case AST::NodeKind::AbstractFloatLiteral:
        visit(uncheckedDowncast<AST::AbstractFloatLiteral>(expression));
        return { };
    case AST::NodeKind::AbstractIntegerLiteral:
        visit(uncheckedDowncast<AST::AbstractIntegerLiteral>(expression));
        return { };
    case AST::NodeKind::BoolLiteral:
        visit(uncheckedDowncast<AST::BoolLiteral>(expression));
        return { };
    case AST::NodeKind::Float32Literal:
        visit(uncheckedDowncast<AST::Float32Literal>(expression));
        return { };
    case AST::NodeKind::Float16Literal:
        visit(uncheckedDowncast<AST::Float16Literal>(expression));
        return { };
    case AST::NodeKind::Signed32Literal:
        visit(uncheckedDowncast<AST::Signed32Literal>(expression));
        return { };
    case AST::NodeKind::Unsigned32Literal:
        visit(uncheckedDowncast<AST::Unsigned32Literal>(expression));
        return { };

    case AST::NodeKind::BinaryExpression:
        return visit(uncheckedDowncast<AST::BinaryExpression>(expression));
    case AST::NodeKind::CallExpression:
        return visit(uncheckedDowncast<AST::CallExpression>(expression));
    case AST::NodeKind::FieldAccessExpression:
        return visit(uncheckedDowncast<AST::FieldAccessExpression>(expression));
    case AST::NodeKind::IdentifierExpression:
        return visit(uncheckedDowncast<AST::IdentifierExpression>(expression));
    case AST::NodeKind::IndexAccessExpression:
        return visit(uncheckedDowncast<AST::IndexAccessExpression>(expression));
    case AST::NodeKind::UnaryExpression:
        return visit(uncheckedDowncast<AST::UnaryExpression>(expression));
    case AST::NodeKind::ArrayTypeExpression:
        return visit(uncheckedDowncast<AST::ArrayTypeExpression>(expression));
    case AST::NodeKind::ElaboratedTypeExpression:
        return visit(uncheckedDowncast<AST::ElaboratedTypeExpression>(expression));

    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

Result<void> TypeChecker::visit(AST::FieldAccessExpression& access)
{
    const auto& accessImpl = [&](const Type* baseType, bool* canBeReference = nullptr, bool* isVector = nullptr) -> Result<const Type*> {
        if (std::holds_alternative<Types::Struct>(*baseType)) {
            auto& structType = std::get<Types::Struct>(*baseType);
            auto it = structType.fields.find(access.fieldName().id());
            if (it == structType.fields.end()) [[unlikely]]
                TYPE_ERROR(access.span(), "struct '"_s, *baseType, "' does not have a member called '"_s, access.fieldName(), '\'');

            if (auto constant = access.base().constantValue()) {
                auto& constantStruct = std::get<ConstantStruct>(*constant);
                access.setConstantValue(constantStruct.fields.get(access.fieldName().id()));
            }
            return { it->value };
        }

        if (auto* primitiveStruct = std::get_if<Types::PrimitiveStruct>(baseType)) {
            const auto& keys = Types::PrimitiveStruct::keys[primitiveStruct->kind];
            auto* key = keys.tryGet(access.fieldName().id());
            if (!key) [[unlikely]]
                TYPE_ERROR(access.span(), "struct '"_s, *baseType, "' does not have a member called '"_s, access.fieldName(), '\'');

            if (auto constant = access.base().constantValue()) {
                auto& constantStruct = std::get<ConstantStruct>(*constant);
                access.setConstantValue(constantStruct.fields.get(access.fieldName().id()));
            }

            return { primitiveStruct->values[*key] };
        }

        if (std::holds_alternative<Types::Vector>(*baseType)) {
            auto& vector = std::get<Types::Vector>(*baseType);
            UNWRAP(result, vectorFieldAccess(vector, access));
            if (isVector)
                *isVector = true;
            if (result && canBeReference)
                *canBeReference = !std::holds_alternative<Types::Vector>(*result);
            return { result };
        }

        TYPE_ERROR(access.span(), "invalid member access expression. Expected vector or struct, got '"_s, *baseType, '\'');
    };

    const auto& referenceImpl = [&](const auto& type) -> Result<void> {
        bool canBeReference = true;
        bool isVector = false;

        UNWRAP(result, accessImpl(type.element, &canBeReference, &isVector));

        if (canBeReference)
            result = m_types.referenceType(type.addressSpace, result, type.accessMode, isVector);

        inferred(result);
        evaluated(access.base().evaluation());

        return { };
    };

    UNWRAP(baseType, infer(access.base(), m_maxEvaluation));
    if (const auto* reference = std::get_if<Types::Reference>(baseType))
        return referenceImpl(*reference);

    if (const auto* pointer = std::get_if<Types::Pointer>(baseType))
        return referenceImpl(*pointer);

    UNWRAP(result, accessImpl(baseType));
    inferred(result);
    evaluated(access.base().evaluation());
    return { };
}

Result<void> TypeChecker::visit(AST::IndexAccessExpression& access)
{
    const auto& constantAccess = [&]<typename T>(std::optional<unsigned> typeSize) -> Result<void> {
        auto constantBase = access.base().constantValue();
        auto constantIndex = access.index().constantValue();

        if (!constantIndex)
            return { };

        auto size = typeSize.value_or(0);
        if (!size && constantBase)
            size = std::get<T>(*constantBase).upperBound();

        auto index = constantIndex->integerValue();
        if (index < 0 || (size && static_cast<size_t>(index) >= size)) [[unlikely]] {
            String bounds = size ?  makeString(" [0.."_s, size - 1, "]"_s) : ""_s;
            TYPE_ERROR(access.span(), "index "_s, index, " is out of bounds"_s, bounds);
        }

        if (constantBase)
            access.setConstantValue(std::get<T>(*constantBase)[index]);
        return { };
    };

    const auto& accessImpl = [&](const Type* base, bool* isVector = nullptr) -> Result<const Type*> {
        const Type* result = nullptr;
        if (auto* array = std::get_if<Types::Array>(base)) {
            result = array->element;
            std::optional<unsigned> size;
            if (auto* constantSize = std::get_if<unsigned>(&array->size))
                size = *constantSize;
            CHECK(constantAccess.operator()<ConstantArray>(size));
        } else if (auto* vector = std::get_if<Types::Vector>(base)) {
            if (isVector)
                *isVector = true;
            result = vector->element;
            CHECK(constantAccess.operator()<ConstantVector>(vector->size));
        } else if (auto* matrix = std::get_if<Types::Matrix>(base)) {
            result = m_types.vectorType(matrix->rows, matrix->element);
            CHECK(constantAccess.operator()<ConstantMatrix>(matrix->columns));
        }

        if (!result) [[unlikely]]
            TYPE_ERROR(access.span(), "cannot index type '"_s, *base, '\'');

        if (!access.index().constantValue().has_value()) {
            result = concretize(result, m_types);
            RELEASE_ASSERT(result);
        }
        evaluated(std::max(access.base().evaluation(), access.index().evaluation()));
        return { result };
    };

    UNWRAP(base, infer(access.base(), m_maxEvaluation));
    UNWRAP(index, infer(access.index(), m_maxEvaluation));

    if (!unify(m_types.i32Type(), index) && !unify(m_types.u32Type(), index) && !unify(m_types.abstractIntType(), index)) [[unlikely]]
        TYPE_ERROR(access.span(), "index must be of type 'i32' or 'u32', found: '"_s, *index, '\'');

    const auto& referenceImpl = [&](const auto& type) -> Result<void> {
        bool isVector = false;
        UNWRAP(result, accessImpl(type.element, &isVector));
        result = m_types.referenceType(type.addressSpace, result, type.accessMode, isVector);
        inferred(result);
        return { };
    };

    if (const auto* reference = std::get_if<Types::Reference>(base)) {
        CHECK(referenceImpl(*reference));
        return { };
    }

    if (const auto* pointer = std::get_if<Types::Pointer>(base)) {
        CHECK(referenceImpl(*pointer));
        return { };
    }

    UNWRAP(result, accessImpl(base));
    inferred(result);
    return { };
}

Result<void> TypeChecker::visit(AST::BinaryExpression& binary)
{
    CHECK(binaryExpression(binary.span(), &binary, binary.operation(), binary.leftExpression(), binary.rightExpression()));
    return { };
}

Result<void> TypeChecker::binaryExpression(const SourceSpan& span, AST::Expression* expression, AST::BinaryOperation operation, AST::Expression& leftExpression, AST::Expression& rightExpression)
{
    if (operation == AST::BinaryOperation::ShortCircuitAnd || operation == AST::BinaryOperation::ShortCircuitOr) {
        UNWRAP(lhsType, infer(leftExpression, m_maxEvaluation));
        if (lhsType == m_types.boolType()) {
            if (auto lhsValue = leftExpression.constantValue()) {
                bool lhsBool = std::get<bool>(*lhsValue);
                bool shortCircuits = (operation == AST::BinaryOperation::ShortCircuitAnd && !lhsBool)
                    || (operation == AST::BinaryOperation::ShortCircuitOr && lhsBool);
                if (shortCircuits) {
                    auto suppressScope = SetForScope(m_suppressConstantErrors, true);
                    UNWRAP(rhsType, infer(rightExpression, m_maxEvaluation));
                    if (auto* reference = std::get_if<Types::Reference>(rhsType))
                        rhsType = reference->element;
                    if (rhsType != m_types.boolType())
                        TYPE_ERROR(span, "no matching overload for operator "_s, toASCIILiteral(operation), '(', *lhsType, ", "_s, *rhsType, ')');
                    inferred(m_types.boolType());
                    evaluated(leftExpression.evaluation());
                    if (expression)
                        expression->setConstantValue(operation == AST::BinaryOperation::ShortCircuitAnd ? false : true);
                    return { };
                }
            }
        }
    }

    CHECK(chooseOverload("operator"_s, span, expression, toASCIILiteral(operation), ReferenceWrapperVector<AST::Expression, 2> { leftExpression, rightExpression }, { }));

    ASCIILiteral operationName;
    if (operation == AST::BinaryOperation::Divide)
        operationName = "division"_s;
    else if (operation == AST::BinaryOperation::Modulo)
        operationName = "modulo"_s;
    if (!operationName.isNull()) {
        auto* rightType = rightExpression.inferredType();
        if (auto* vectorType = std::get_if<Types::Vector>(rightType))
            rightType = vectorType->element;
        if (satisfies(rightType, Constraints::Integer)) {
            if (operation == AST::BinaryOperation::Divide)
                m_shaderModule.setUsesDivision();
            else
                m_shaderModule.setUsesModulo();
            auto leftValue = leftExpression.constantValue();
            auto rightValue = rightExpression.constantValue();
            if (!leftValue && rightValue && containsZero(*rightValue, rightExpression.inferredType())) [[unlikely]]
                TYPE_ERROR(span, "invalid "_s, operationName, " by zero"_s);
        }
    }

    return { };
}

Result<void> TypeChecker::visit(AST::IdentifierExpression& identifier)
{
    auto* binding = readVariable(identifier.identifier());
    if (!binding) [[unlikely]]
        TYPE_ERROR(identifier.span(), "unresolved identifier '"_s, identifier.identifier(), '\'');

    if (binding->kind != Binding::Value) [[unlikely]]
        TYPE_ERROR(identifier.span(), "cannot use "_s, bindingKindToString(binding->kind), " '"_s, identifier.identifier(), "' as value"_s);

    if (binding->evaluation > m_maxEvaluation) [[unlikely]]
        TYPE_ERROR(identifier.span(), "cannot use "_s, evaluationToString(binding->evaluation), " value in "_s, evaluationToString(m_maxEvaluation), " expression"_s);

    evaluated(binding->evaluation);
    inferred(binding->type);
    if (binding->constantValue.has_value())
        CHECK(setConstantValue(identifier, binding->type, *binding->constantValue));

    return { };
}

Result<void> TypeChecker::visit(AST::CallExpression& call)
{
    auto& target = call.target();
    bool isNamedType = is<AST::IdentifierExpression>(target);
    bool isParameterizedType = is<AST::ElaboratedTypeExpression>(target);
    bool isArrayType = is<AST::ArrayTypeExpression>(target);

    Vector<const Type*> typeArguments;
    UNWRAP(targetName, [&]() -> Result<String> {
        if (isNamedType)
            return { downcast<AST::IdentifierExpression>(target).identifier() };
        if (isArrayType)
            return { "array"_s };
        auto& elaborated = downcast<AST::ElaboratedTypeExpression>(target);
        for (auto& argument : elaborated.arguments()) {
            UNWRAP(argumentType, resolve(argument));
            typeArguments.append(argumentType);
        }
        return { elaborated.base() };
    }());

    auto* targetBinding = readVariable(targetName);
    if (targetBinding) {
        target.m_inferredType = targetBinding->type;
        if (targetBinding->kind == Binding::Type) {
            CHECK(validateF16Usage(call.span(), targetBinding->type));

            call.m_isConstructor = true;
            if (auto* structType = std::get_if<Types::Struct>(targetBinding->type)) {
                if (!targetBinding->type->isConstructible()) [[unlikely]]
                    TYPE_ERROR(call.span(), "struct is not constructible"_s);

                if (m_discardResult == DiscardResult::Yes) [[unlikely]]
                    TYPE_ERROR(call.span(), "value constructor evaluated but not used"_s);

                auto numberOfArguments = call.arguments().size();
                auto numberOfFields = structType->fields.size();
                if (numberOfArguments && numberOfArguments != numberOfFields) [[unlikely]] {
                    auto errorKind = numberOfArguments < numberOfFields ? "few"_s : "many"_s;
                    TYPE_ERROR(call.span(), "struct initializer has too "_s, errorKind, " inputs: expected "_s, numberOfFields, ", found "_s, numberOfArguments);
                }

                HashMap<String, ConstantValue> constantFields;
                bool isConstant = true;
                Evaluation evaluation = Evaluation::Constant;
                for (unsigned i = 0; i < numberOfArguments; ++i) {
                    auto& argument = call.arguments()[i];
                    auto& member = structType->structure.members()[i];
                    auto* fieldType = structType->fields.get(member.name());
                    UNWRAP(argumentType, infer(argument, m_maxEvaluation));
                    evaluation = std::max(evaluation, argument.evaluation());
                    if (!unify(fieldType, argumentType)) [[unlikely]]
                        TYPE_ERROR(argument.span(), "type in struct initializer does not match struct member type: expected '"_s, *fieldType, "', found '"_s, *argumentType, '\'');

                    argument.m_inferredType = fieldType;
                    auto& value = argument.m_constantValue;
                    if (value.has_value()) {
                        CHECK(convertValue(argument.span(), argument.inferredType(), value));
                        constantFields.set(member.name(), *value);
                        continue;
                    }
                    isConstant = false;
                }
                if (isConstant) {
                    if (numberOfArguments)
                        CHECK(setConstantValue(call, targetBinding->type, ConstantStruct { WTF::move(constantFields) }))
                    else
                        CHECK(setConstantValue(call, targetBinding->type, zeroValue(targetBinding->type)));
                }
                inferred(targetBinding->type);
                evaluated(evaluation);
                return { };
            }

            if (auto* vectorType = std::get_if<Types::Vector>(targetBinding->type)) {
                typeArguments.append(vectorType->element);
                switch (vectorType->size) {
                case 2:
                    targetName = "vec2"_s;
                    break;
                case 3:
                    targetName = "vec3"_s;
                    break;
                case 4:
                    targetName = "vec4"_s;
                    break;
                default:
                    RELEASE_ASSERT_NOT_REACHED();
                }
            }

            if (auto* matrixType = std::get_if<Types::Matrix>(targetBinding->type)) {
                typeArguments.append(matrixType->element);
                targetName = makeString("mat"_s, matrixType->columns, 'x', matrixType->rows);
            }

            if (std::holds_alternative<Types::Primitive>(*targetBinding->type))
                targetName = targetBinding->type->toString();

            if (std::holds_alternative<Types::Array>(*targetBinding->type)) {
                isNamedType = false;
                isParameterizedType = false;
                isArrayType = true;
            }
        } else if (targetBinding->kind == Binding::Function) {
            auto& functionType = std::get<Types::Function>(*targetBinding->type);
            auto numberOfArguments = call.arguments().size();
            auto numberOfParameters = functionType.parameters.size();
            if (m_maxEvaluation < Evaluation::Runtime) [[unlikely]]
                TYPE_ERROR(call.span(), "cannot call function from "_s, evaluationToString(m_maxEvaluation), " context"_s);

            if (numberOfArguments != numberOfParameters) [[unlikely]] {
                auto errorKind = numberOfArguments < numberOfParameters ? "few"_s : "many"_s;
                TYPE_ERROR(call.span(), "funtion call has too "_s, errorKind, " arguments: expected "_s, numberOfParameters, ", found "_s, numberOfArguments);
            }

            if (m_discardResult == DiscardResult::Yes && functionType.mustUse) [[unlikely]]
                TYPE_ERROR(call.span(), "ignoring return value of function '"_s, targetName, "' annotated with @must_use"_s);

            if (m_discardResult == DiscardResult::No && isPrimitive(functionType.result, Types::Primitive::Void)) [[unlikely]]
                TYPE_ERROR(call.span(), "function '"_s, targetName, "' does not return a value"_s);

            for (unsigned i = 0; i < numberOfArguments; ++i) {
                auto& argument = call.arguments()[i];
                auto* parameterType = functionType.parameters[i];
                UNWRAP(argumentType, infer(argument, m_maxEvaluation));
                if (!unify(parameterType, argumentType)) [[unlikely]]
                    TYPE_ERROR(argument.span(), "type in function call does not match parameter type: expected '"_s, *parameterType, "', found '"_s, *argumentType, '\'');

                argument.m_inferredType = parameterType;
                auto& value = argument.m_constantValue;
                if (value.has_value())
                    CHECK(convertValue(argument.span(), argument.inferredType(), value));
            }
            inferred(functionType.result);
            evaluated(Evaluation::Runtime);
            return { };
        } else [[unlikely]]
            TYPE_ERROR(target.span(), "cannot call value of type '"_s, *targetBinding->type, '\'');
    }

    if (isNamedType || isParameterizedType) {
        call.m_resolvedTarget = targetName;
        UNWRAP(result, chooseOverload("initializer"_s, call.span(), &call, targetName, call.arguments(), typeArguments));
        if (result) {
            target.m_inferredType = result;

            // Subgroup and quad built-in functions require the 'subgroups' extension to be enabled.
            if ((targetName.startsWith("subgroup"_s) || targetName.startsWith("quad"_s)) && !m_shaderModule.enabledExtensions().contains(Extension::Subgroups)) [[unlikely]]
                TYPE_ERROR(call.span(), "'"_s, targetName, "' requires the 'subgroups' extension to be enabled"_s);

            // FIXME: <rdar://150366527> this will go away once we track used intrinsics properly
            if (targetName == "workgroupUniformLoad"_s) {
                auto* argument = call.arguments()[0].inferredType();
                if (std::holds_alternative<Types::Atomic>(*std::get<Types::Pointer>(*argument).element))
                    m_shaderModule.setUsesWorkgroupUniformLoadAtomic();
                else
                    m_shaderModule.setUsesWorkgroupUniformLoad();
            } else if (targetName == "frexp"_s)
                m_shaderModule.setUsesFrexp();
            else if (targetName == "modf"_s)
                m_shaderModule.setUsesModf();
            else if (targetName == "atomicCompareExchangeWeak"_s)
                m_shaderModule.setUsesAtomicCompareExchange();
            else if (targetName == "dot"_s)
                m_shaderModule.setUsesDot();
            else if (targetName == "firstLeadingBit"_s)
                m_shaderModule.setUsesFirstLeadingBit();
            else if (targetName == "firstTrailingBit"_s)
                m_shaderModule.setUsesFirstTrailingBit();
            else if (targetName == "sign"_s)
                m_shaderModule.setUsesSign();
            else if (targetName == "dot4I8Packed"_s)
                m_shaderModule.setUsesDot4I8Packed();
            else if (targetName == "dot4U8Packed"_s)
                m_shaderModule.setUsesDot4U8Packed();
            else if (targetName == "extractBits"_s)
                m_shaderModule.setUsesExtractBits();
            else if (targetName == "insertBits"_s)
                m_shaderModule.setUsesInsertBits();
            else if (
                targetName == "textureGather"_s
                || targetName == "textureGatherCompare"_s
                || targetName == "textureSample"_s
                || targetName == "textureSampleBias"_s
                || targetName == "textureSampleCompare"_s
                || targetName == "textureSampleCompareLevel"_s
                || targetName == "textureSampleGrad"_s
                || targetName == "textureSampleLevel"_s
            ) {
                if (targetName == "textureGather"_s) {
                    auto& component = call.arguments()[0];
                    if (satisfies(component.inferredType(), Constraints::ConcreteInteger)) {
                        auto& constant = component.constantValue();
                        if (!constant) [[unlikely]]
                            TYPE_ERROR(component.span(), "the component argument must be a const-expression"_s);
                        else {
                            auto componentValue = constant->integerValue();
                            if (componentValue < 0 || componentValue > 3) [[unlikely]]
                                TYPE_ERROR(component.span(), "the component argument must be at least 0 and at most 3. component is "_s, String::number(componentValue));
                        }
                    }
                }

                auto& lastArg = call.arguments().last();
                auto* vectorType = std::get_if<Types::Vector>(lastArg.inferredType());
                if (!vectorType || vectorType->size != 2 || vectorType->element != m_types.i32Type())
                    return { };

                auto& maybeConstant = lastArg.constantValue();
                if (!maybeConstant.has_value()) [[unlikely]]
                    TYPE_ERROR(lastArg.span(), "the offset argument must be a const-expression"_s);

                auto& vector = std::get<ConstantVector>(*maybeConstant);
                for (unsigned i = 0; i < 2; ++i) {
                    auto& i32 = std::get<int32_t>(vector.elements[i]);
                    if (i32 < -8 || i32 > 7) [[unlikely]]
                        TYPE_ERROR(lastArg.span(), "each component of the offset argument must be at least -8 and at most 7. offset component "_s, String::number(i), " is "_s, String::number(i32));
                }
            }
            return { };
        }

        // FIXME: <rdar://150366527> similarly to above: this shouldn't be a string check
        if (targetName == "bitcast"_s) {
            CHECK(bitcast(call, typeArguments));
            return { };
        }

        TYPE_ERROR(target.span(), "unresolved call target '"_s, targetName, '\'');
    }

    RELEASE_ASSERT(isArrayType);
    call.m_resolvedTarget = "array"_s;
    auto* array = dynamicDowncast<AST::ArrayTypeExpression>(target);
    const Types::Array* arrayType = targetBinding ? std::get_if<Types::Array>(targetBinding->type) : nullptr;
    const Type* elementType = nullptr;
    unsigned elementCount;

    if ((array && array->maybeElementType()) || arrayType) {
        if ((array && !array->maybeElementCount()) || (arrayType && arrayType->isRuntimeSized())) [[unlikely]]
            TYPE_ERROR(call.span(), "cannot construct a runtime-sized array"_s);

        const Type* elementCountType;
        if (arrayType) {
            elementType = arrayType->element;
            elementCountType = m_types.u32Type();
        } else {
            UNWRAP_ASSIGN(elementType, resolve(*array->maybeElementType()));
            UNWRAP_ASSIGN(elementCountType, infer(*array->maybeElementCount(), m_maxEvaluation));
        }


        if (!unify(m_types.i32Type(), elementCountType) && !unify(m_types.u32Type(), elementCountType)) [[unlikely]]
            TYPE_ERROR(array->span(), "array count must be an i32 or u32 value, found '"_s, *elementCountType, '\'');

        if (!elementType->isConstructible()) [[unlikely]]
            TYPE_ERROR(array->span(), '\'', *elementType, "' cannot be used as an element type of an array"_s);

        std::optional<ConstantValue> constantValue;
        if (!arrayType)
            constantValue = array->maybeElementCount()->constantValue();
        else {
            auto* maybeConstant = std::get_if<unsigned>(&arrayType->size);
            constantValue = maybeConstant ? std::optional(ConstantValue(*maybeConstant)) : std::nullopt;
        }

        if (!constantValue) [[unlikely]]
            TYPE_ERROR(call.span(), "array must have constant size in order to be constructed"_s);

        auto intElementCount = constantValue->integerValue();
        if (intElementCount < 1) [[unlikely]]
            TYPE_ERROR(call.span(), "array count must be greater than 0"_s);

        if (intElementCount > std::numeric_limits<uint16_t>::max()) [[unlikely]]
            TYPE_ERROR(call.span(), "array count ("_s, intElementCount, ") must be less than 65536"_s);
        elementCount = static_cast<unsigned>(intElementCount);

        unsigned numberOfArguments = call.arguments().size();
        if (numberOfArguments && numberOfArguments != elementCount) [[unlikely]] {
            auto errorKind = call.arguments().size() < elementCount ? "few"_s : "many"_s;
            TYPE_ERROR(call.span(), "array constructor has too "_s, errorKind, " elements: expected "_s, elementCount, ", found "_s, call.arguments().size());
        }

        for (auto& argument : call.arguments()) {
            UNWRAP(argumentType, infer(argument, m_maxEvaluation));
            if (!unify(elementType, argumentType)) [[unlikely]]
                TYPE_ERROR(argument.span(), '\'', *argumentType, "' cannot be used to construct an array of '"_s, *elementType, '\'');
            argument.m_inferredType = elementType;
        }
    } else {
        ASSERT(!array->maybeElementCount());
        elementCount = call.arguments().size();
        if (!elementCount) [[unlikely]]
            TYPE_ERROR(call.span(), "cannot infer array element type from constructor"_s);

        for (auto& argument : call.arguments()) {
            UNWRAP(argumentType, infer(argument, m_maxEvaluation));
            if (auto* reference = std::get_if<Types::Reference>(argumentType))
                argumentType = reference->element;

            if (!elementType) {
                elementType = argumentType;

                if (!elementType->isConstructible()) [[unlikely]]
                    TYPE_ERROR(array->span(), '\'', *elementType, "' cannot be used as an element type of an array"_s);

                continue;
            }
            if (unify(elementType, argumentType))
                continue;
            if (unify(argumentType, elementType)) {
                elementType = argumentType;
                continue;
            }
            TYPE_ERROR(argument.span(), "cannot infer common array element type from constructor arguments"_s);
        }

        for (auto& argument : call.arguments())
            argument.m_inferredType = elementType;
    }

    call.m_isConstructor = true;
    auto* result = m_types.arrayType(elementType, { elementCount });
    inferred(result);

    unsigned argumentCount = call.arguments().size();
    FixedVector<ConstantValue> arguments(argumentCount);
    bool isConstant = true;
    Evaluation evaluation = Evaluation::Constant;
    for (unsigned i = 0; i < argumentCount; ++i) {
        auto& argument = call.arguments()[i];
        auto& value = argument.m_constantValue;
        evaluation = std::max(evaluation, argument.evaluation());
        if (!value.has_value())
            isConstant = false;
        else {
            CHECK(convertValue(argument.span(), argument.inferredType(), value));
            arguments[i] = *value;
        }
    }
    evaluated(evaluation);
    if (isConstant) {
        if (argumentCount) {
            // https://www.w3.org/TR/WGSL/#limits
            constexpr unsigned maximumConstantArraySize = 2047;
            if (argumentCount > maximumConstantArraySize) [[unlikely]]
                TYPE_ERROR(call.span(), "constant array cannot have more than "_s, String::number(maximumConstantArraySize), " elements"_s);
            CHECK(setConstantValue(call, result, ConstantArray(WTF::move(arguments))));
        } else
            CHECK(setConstantValue(call, result, zeroValue(result)));
    }

    return { };
}

Result<void> TypeChecker::bitcast(AST::CallExpression& call, const Vector<const Type*>& typeArguments)
{
    if (call.arguments().size() != 1) [[unlikely]]
        TYPE_ERROR(call.span(), "bitcast expects a single argument, found "_s, call.arguments().size());

    if (typeArguments.size() != 1) [[unlikely]]
        TYPE_ERROR(call.span(), "bitcast expects a single template argument, found "_s, typeArguments.size());

    if (m_discardResult == DiscardResult::Yes) [[unlikely]]
        TYPE_ERROR(call.span(), "cannot discard the result of bitcast"_s);

    auto& argument = call.arguments()[0];
    auto* destinationType = typeArguments[0];
    UNWRAP(sourceType, infer(argument, m_maxEvaluation));

    if (auto* reference = std::get_if<Types::Reference>(sourceType))
        sourceType = reference->element;

    const auto& primitivePrimitive = [&](const Type* p1, const Type* p2) {
        return (satisfies(p1, Constraints::Concrete32BitNumber) && satisfies(p2, Constraints::Concrete32BitNumber))
            || (p1 == m_types.f16Type() && p2 == m_types.f16Type());
    };

    const auto& vectorVector16To32Bit = [&](const Types::Vector& v1, const Types::Vector& v2) {
        return v1.size == 2 && satisfies(v1.element, Constraints::Concrete32BitNumber) && v2.size == 4 && v2.element == m_types.f16Type();
    };

    const auto& vectorVector = [&](const Types::Vector& v1, const Types::Vector& v2) {
        return (v1.size == v2.size && primitivePrimitive(v1.element, v2.element))
        || vectorVector16To32Bit(v1, v2)
        || vectorVector16To32Bit(v2, v1);
    };

    const auto& vectorPrimitive = [&](const Types::Vector& v, const Type* p) {
        return v.size == 2 && v.element == m_types.f16Type() && satisfies(p, Constraints::Concrete32BitNumber);
    };

    bool allowed = false;
    if (auto* dstVector = std::get_if<Types::Vector>(destinationType)) {
        if (auto* srcVector = std::get_if<Types::Vector>(sourceType))
            allowed = vectorVector(*srcVector, *dstVector);
        else
            allowed = vectorPrimitive(*dstVector, sourceType);
    } else if (auto* srcVector = std::get_if<Types::Vector>(sourceType))
        allowed = vectorPrimitive(*srcVector, destinationType);
    else
        allowed = primitivePrimitive(sourceType, destinationType);

    if (allowed) {
        call.target().m_inferredType = destinationType;
        if (argument.m_constantValue.has_value()) {
            auto result = constantBitcast(destinationType, { *argument.m_constantValue });
            if (!result) [[unlikely]]
                TYPE_ERROR(call.span(), result.error());
            else
                CHECK(setConstantValue(call, destinationType, WTF::move(*result)));
        }
        evaluated(argument.evaluation());
        inferred(destinationType);
        return { };
    }

    auto* concreteType = concretize(sourceType, m_types) ?: sourceType;
    TYPE_ERROR(call.span(), "cannot bitcast from '"_s, *concreteType, "' to '"_s, *destinationType, '\'');
}

Result<void> TypeChecker::visit(AST::UnaryExpression& unary)
{
    if (unary.operation() == AST::UnaryOperation::AddressOf) {
        UNWRAP(type, infer(unary.expression(), Evaluation::Runtime));
        auto* reference = std::get_if<Types::Reference>(type);
        if (!reference) [[unlikely]]
            TYPE_ERROR(unary.span(), "cannot take address of expression"_s);

        if (reference->addressSpace == AddressSpace::Handle) [[unlikely]]
            TYPE_ERROR(unary.span(), "cannot take the address of expression in handle address space"_s);

        if (reference->isVectorComponent) [[unlikely]]
            TYPE_ERROR(unary.span(), "cannot take the address of a vector component"_s);

        evaluated(Evaluation::Runtime);
        inferred(m_types.pointerType(reference->addressSpace, reference->element, reference->accessMode));
        return { };
    }

    if (unary.operation() == AST::UnaryOperation::Dereference) {
        UNWRAP(type, infer(unary.expression(), Evaluation::Runtime));
        auto* pointer = std::get_if<Types::Pointer>(type);
        if (!pointer) [[unlikely]]
            TYPE_ERROR(unary.span(), "cannot dereference expression of type '"_s, *type, '\'');

        evaluated(Evaluation::Runtime);
        inferred(m_types.referenceType(pointer->addressSpace, pointer->element, pointer->accessMode));
        return { };
    }

    CHECK(chooseOverload("operator"_s, unary.span(), &unary, toASCIILiteral(unary.operation()), ReferenceWrapperVector<AST::Expression, 1> { unary.expression() }, { }));
    return { };
}

// Literal Expressions
void TypeChecker::visit(AST::BoolLiteral& literal)
{
    evaluated(Evaluation::Constant);
    inferred(m_types.boolType());
    literal.setConstantValue(literal.value());
}

void TypeChecker::visit(AST::Signed32Literal& literal)
{
    evaluated(Evaluation::Constant);
    inferred(m_types.i32Type());
    literal.setConstantValue(literal.value());
}

void TypeChecker::visit(AST::Float32Literal& literal)
{
    evaluated(Evaluation::Constant);
    inferred(m_types.f32Type());
    literal.setConstantValue(literal.value());
}

void TypeChecker::visit(AST::Float16Literal& literal)
{
    evaluated(Evaluation::Constant);
    inferred(m_types.f16Type());
    literal.setConstantValue(literal.value());
}

void TypeChecker::visit(AST::Unsigned32Literal& literal)
{
    evaluated(Evaluation::Constant);
    inferred(m_types.u32Type());
    literal.setConstantValue(literal.value());
}

void TypeChecker::visit(AST::AbstractIntegerLiteral& literal)
{
    evaluated(Evaluation::Constant);
    inferred(m_types.abstractIntType());
    literal.setConstantValue(literal.value());
}

void TypeChecker::visit(AST::AbstractFloatLiteral& literal)
{
    evaluated(Evaluation::Constant);
    inferred(m_types.abstractFloatType());
    literal.setConstantValue(literal.value());
}

// Types
Result<void> TypeChecker::visit(AST::ArrayTypeExpression& array)
{
    if (!array.maybeElementType()) [[unlikely]]
        TYPE_ERROR(array.span(), "'array' requires at least 1 template argument"_s);

    UNWRAP(elementType, resolve(*array.maybeElementType()));
    if (!elementType->hasCreationFixedFootprint()) [[unlikely]]
        TYPE_ERROR(array.span(), '\'', *elementType, "' cannot be used as an element type of an array"_s);

    Types::Array::Size size;
    if (array.maybeElementCount()) {
        UNWRAP(elementCountType, infer(*array.maybeElementCount(), std::min(m_maxEvaluation, Evaluation::Override)));
        if (!unify(m_types.i32Type(), elementCountType) && !unify(m_types.u32Type(), elementCountType)) [[unlikely]]
            TYPE_ERROR(array.span(), "array count must be an i32 or u32 value, found '"_s, *elementCountType, '\'');

        auto value = array.maybeElementCount()->constantValue();
        if (value.has_value()) {
            int64_t elementCount = 0;
            CHECK(convertValue(array.maybeElementCount()->span(), concretize(elementCountType, m_types), value));
            elementCount = value->integerValue();
            if (elementCount < 1) [[unlikely]]
                TYPE_ERROR(array.span(), "array count must be greater than 0"_s);
            size = { static_cast<unsigned>(elementCount) };
        } else {
            auto* countExpression = array.maybeElementCount();
            if (auto* identifier = dynamicDowncast<AST::IdentifierExpression>(countExpression)) {
                auto result = m_arrayCountOverrides.add(identifier->identifier().id(), identifier);
                countExpression = result.iterator->value;
            }
            size = { countExpression };
        }
    }

    inferred(m_types.arrayType(elementType, size));
    evaluated(Evaluation::Constant);
    return { };
}

Result<const Type*> TypeChecker::lookupType(const AST::Identifier& name)
{
    auto* binding = readVariable(name);
    if (!binding) [[unlikely]]
        TYPE_ERROR(name.span(), "unresolved type '"_s, name, '\'');

    if (binding->kind != Binding::Type) [[unlikely]]
        TYPE_ERROR(name.span(), "cannot use "_s, bindingKindToString(binding->kind), " '"_s, name, "' as type"_s);

    CHECK(validateF16Usage(name.span(), binding->type));

    return { binding->type };
}

Result<void> TypeChecker::validateF16Usage(const SourceSpan& span, const Type* type)
{
    if (m_shaderModule.enabledExtensions().contains(Extension::F16))
        return { };

    if (auto* matrix = std::get_if<Types::Matrix>(type))
        type = matrix->element;
    else if (auto* vector = std::get_if<Types::Vector>(type))
        type = vector->element;

    if (type == m_types.f16Type()) [[unlikely]]
        TYPE_ERROR(span, "f16 type used without f16 extension enabled"_s);

    return { };
}

Result<void> TypeChecker::visit(AST::ElaboratedTypeExpression& type)
{
    UNWRAP(base, lookupType(type.base()));

    auto* constructor = std::get_if<Types::TypeConstructor>(base);
    if (!constructor) [[unlikely]]
        TYPE_ERROR(type.span(), "type '"_s, *base, "' does not take template arguments"_s);

    UNWRAP(constructedType, constructor->construct(type));

    inferred(constructedType);
    evaluated(Evaluation::Constant);

    return { };
}

Result<void> TypeChecker::visit(AST::Continuing& continuing)
{
    ContextScope continuingScope(this);

    CHECK(visitAttributes(continuing.attributes));

    for (auto& statement : continuing.body)
        CHECK(visit(statement));

    if (auto* breakIf = continuing.breakIf) {
        UNWRAP(type, infer(*breakIf, Evaluation::Runtime));
        if (!unify(m_types.boolType(), type)) [[unlikely]]
            TYPE_ERROR(breakIf->span(), "expected 'bool', found "_s, *type);
    }

    return { };
}

Result<void> TypeChecker::visitAttributes(AST::Attribute::List& attributes)
{
    for (auto& attribute : attributes)
        CHECK(visit(attribute));

    return { };
}

// Private helpers
Result<const Type*> TypeChecker::vectorFieldAccess(const Types::Vector& vector, AST::FieldAccessExpression& access)
{
    const auto& fieldName = access.fieldName().id();
    auto length = fieldName.length();
    auto vectorSize = vector.size;

    bool isValid = true;
    const auto& isXYZW = [&](char c) {
        switch (c) {
        case 'x':
        case 'y':
            return true;
        case 'z':
            isValid &= vectorSize >= 3;
            return true;
        case 'w':
            isValid &= vectorSize == 4;
            return true;
        default:
            return false;
        }
    };
    const auto& isRGBA = [&](char c) {
        switch (c) {
        case 'r':
        case 'g':
            return true;
        case 'b':
            isValid &= vectorSize >= 3;
            return true;
        case 'a':
            isValid &= vectorSize == 4;
            return true;
        default:
            return false;
        }
    };

    bool hasXYZW = false;
    bool hasRGBA = false;
    for (unsigned i = 0; i < length; ++i) {
        char c = fieldName[i];
        if (isXYZW(c))
            hasXYZW = true;
        else if (isRGBA(c))
            hasRGBA = true;
        else [[unlikely]]
            TYPE_ERROR(access.span(), "invalid vector swizzle character"_s);
    }

    if (!isValid || (hasRGBA && hasXYZW)) [[unlikely]]
        TYPE_ERROR(access.span(), "invalid vector swizzle member"_s);

    const auto& constAccess = [&](const ConstantVector& vector, char field) -> ConstantValue {
        switch (field) {
        case 'r':
        case 'x':
            return vector.elements[0];
        case 'g':
        case 'y':
            return vector.elements[1];
        case 'b':
        case 'z':
            return vector.elements[2];
        case 'a':
        case 'w':
            return vector.elements[3];
        default:
            RELEASE_ASSERT_NOT_REACHED();
        };
    };

    const auto& constantValue = access.base().constantValue();

    switch (length) {
    case 1:
        if (constantValue)
            access.setConstantValue(constAccess(std::get<ConstantVector>(*constantValue), fieldName[0]));
        return vector.element;
    case 2:
    case 3:
    case 4:
        break;
    [[unlikely]] default:
        TYPE_ERROR(access.span(), "invalid vector swizzle size"_s);
    }

    if (constantValue) {
        const auto& vector = std::get<ConstantVector>(*constantValue);
        ConstantVector result(length);
        for (unsigned i = 0; i < length; ++i)
            result.elements[i] = constAccess(vector, fieldName[i]);
        access.setConstantValue(result);
    }
    return { m_types.vectorType(length, vector.element) };
}

template<typename CallArguments>
Result<const Type*> TypeChecker::chooseOverload(ASCIILiteral kind, const SourceSpan& span, AST::Expression* expression, const String& target, CallArguments&& callArguments, const Vector<const Type*>& typeArguments)
{
    auto* overload = m_shaderModule.lookupOverload(target);
    if (!overload)
        return { nullptr };

    Vector<const Type*> valueArguments;
    valueArguments.reserveInitialCapacity(callArguments.size());
    for (unsigned i = 0; i < callArguments.size(); ++i) {
        UNWRAP(type, infer(callArguments[i], m_maxEvaluation));
        valueArguments.append(type);
    }

    auto selectedOverload = resolveOverloads(m_types, overload->overloads, valueArguments, typeArguments);
    if (selectedOverload.has_value()) {
        ASSERT(selectedOverload->parameters.size() == callArguments.size());
        if (m_discardResult == DiscardResult::Yes && overload->mustUse) [[unlikely]]
            TYPE_ERROR(span, "ignoring return value of builtin '"_s, target, '\'');

        for (unsigned i = 0; i < callArguments.size(); ++i)
            callArguments[i].m_inferredType = selectedOverload->parameters[i];
        inferred(selectedOverload->result);

        if (expression && is<AST::CallExpression>(*expression)) {
            auto& call = uncheckedDowncast<AST::CallExpression>(*expression);
            call.m_isConstructor = overload->kind == OverloadedDeclaration::Constructor;
            call.m_visibility = overload->visibility;
            call.m_validationFunction = overload->validationFunction;

            if (call.isFloatToIntConversion(selectedOverload->result))
                m_shaderModule.setUsesFtoi();
        }

        unsigned argumentCount = callArguments.size();
        FixedVector<ConstantValue> arguments(argumentCount);
        FixedVector<std::optional<ConstantValue>> validationArguments(argumentCount);
        bool isConstant = true;
        Evaluation evaluation = Evaluation::Constant;
        for (unsigned i = 0; i < argumentCount; ++i) {
            auto& argument = callArguments[i];
            auto& value = argument.m_constantValue;
            evaluation = std::max(evaluation, argument.evaluation());
            if (!value.has_value())
                isConstant = false;
            else {
                CHECK(convertValue(argument.span(), argument.inferredType(), value));
                arguments[i] = *value;
                validationArguments[i] = { *value };
            }
        }

        auto constantFunction = overload->constantFunction;
        if (!constantFunction && m_maxEvaluation < Evaluation::Runtime) [[unlikely]] {
            if (!m_suppressConstantErrors)
                TYPE_ERROR(span, "cannot call function from "_s, evaluationToString(m_maxEvaluation), " context"_s);
        }

        if (!constantFunction)
            evaluation = Evaluation::Runtime;
        evaluated(evaluation);

        if (isConstant && constantFunction) {
            auto result = constantFunction(selectedOverload->result, WTF::move(arguments));
            if (!result) [[unlikely]] {
                if (!m_suppressConstantErrors)
                    TYPE_ERROR(span, result.error());
            } else if (expression)
                CHECK(setConstantValue(*expression, selectedOverload->result, WTF::move(*result)));
        } else if (auto* validate = overload->validationFunction) {
            if (auto error = validate(WTF::move(validationArguments), selectedOverload->parameters))
                TYPE_ERROR(span, *error);
        }

        return { selectedOverload->result };
    }

    StringPrintStream valueArgumentsStream;
    bool first = true;
    for (auto* argument : valueArguments) {
        if (!first)
            valueArgumentsStream.print(", ");
        first = false;
        valueArgumentsStream.print(*argument);
    }
    StringPrintStream typeArgumentsStream;
    first = true;
    if (typeArguments.size()) {
        typeArgumentsStream.print("<");
        for (auto* typeArgument : typeArguments) {
            if (!first)
                typeArgumentsStream.print(", ");
            first = false;
            typeArgumentsStream.print(*typeArgument);
        }
        typeArgumentsStream.print(">");
    }

    TYPE_ERROR(span, "no matching overload for "_s, kind, ' ', target, typeArgumentsStream.toString(), '(', valueArgumentsStream.toString(), ')');
}

Result<const Type*> TypeChecker::infer(AST::Expression& expression, Evaluation evaluation, DiscardResult discardResult)
{
    if (evaluation > m_maxEvaluation) [[unlikely]]
        TYPE_ERROR(expression.span(), "cannot use "_s, evaluationToString(evaluation), " value in "_s, evaluationToString(m_maxEvaluation), " expression"_s);

    auto discardResultScope = SetForScope(m_discardResult, discardResult);
    auto evaluationScope = SetForScope(m_maxEvaluation, evaluation);

    ASSERT(!m_inferredType);
    ASSERT(!m_currentEvaluation);
    CHECK(visit(expression));
    ASSERT(m_inferredType);
    ASSERT(m_currentEvaluation);

    if (shouldDumpInferredTypes) [[unlikely]] {
        dataLog("> Type inference [expression]: ");
        dumpNode(WTF::dataFile(), expression);
        dataLog(" : ");
        dataLogLn(*m_inferredType);
    }

    expression.m_inferredType = m_inferredType;
    expression.m_evaluation = *m_currentEvaluation;
    const Type* inferredType = m_inferredType;
    m_inferredType = nullptr;
    m_currentEvaluation = std::nullopt;

    return inferredType;
}

Result<Behaviors> TypeChecker::analyze(AST::Statement& statement)
{
    Behaviors behaviors;
    switch (statement.kind()) {
    case AST::NodeKind::AssignmentStatement:
    case AST::NodeKind::CallStatement:
    case AST::NodeKind::CompoundAssignmentStatement:
    case AST::NodeKind::ConstAssertStatement:
    case AST::NodeKind::DecrementIncrementStatement:
    case AST::NodeKind::DiscardStatement:
    case AST::NodeKind::PhonyAssignmentStatement:
    case AST::NodeKind::VariableStatement:
        behaviors = { Behavior::Next };
        break;
    case AST::NodeKind::BreakStatement:
        if (m_breakTargetStack.isEmpty()) [[unlikely]]
            TYPE_ERROR(statement.span(), "break statement must be in a loop or switch case"_s);

        if (std::holds_alternative<AST::Continuing*>(m_breakTargetStack.last())) [[unlikely]]
            TYPE_ERROR(statement.span(), "`break` must not be used to exit from a continuing block. Use `break-if` instead"_s);

        behaviors = { Behavior::Break };
        break;
    case AST::NodeKind::ReturnStatement:
        if (m_breakTargetStack.containsIf([&](auto& it) { return std::holds_alternative<AST::Continuing*>(it); })) [[unlikely]]
            TYPE_ERROR(statement.span(), "continuing blocks must not contain a return statement"_s);

        behaviors = { Behavior::Return };
        break;
    case AST::NodeKind::ContinueStatement: {
        bool hasLoopTarget = false;
        bool hasSwitchTarget = false;
        for (int i = m_breakTargetStack.size() - 1; i >= 0; --i) {
            auto& target = m_breakTargetStack[i];
            if (std::holds_alternative<AST::SwitchStatement*>(target)) {
                hasSwitchTarget = true;
                continue;
            }

            hasLoopTarget = true;

            if (std::holds_alternative<AST::Continuing*>(target)) [[unlikely]]
                TYPE_ERROR(statement.span(), "continuing blocks must not contain a continue statement"_s);

            if (auto** loop = std::get_if<AST::LoopStatement*>(&target)) {
                if (hasSwitchTarget && (*loop)->continuing().has_value()) {
                    (*loop)->setContainsSwitch();
                    auto& continueStatement = downcast<AST::ContinueStatement>(statement);
                    continueStatement.setIsFromSwitchToContinuing();
                    for (size_t j = i + 1; j < m_breakTargetStack.size(); ++j) {
                        auto* switchStatement = std::get<AST::SwitchStatement*>(m_breakTargetStack[j]);
                        if (j == static_cast<size_t>(i + 1))
                            switchStatement->setIsInsideLoop();
                        else
                            switchStatement->setIsNestedInsideLoop();
                    }
                }
                break;
            }

            ASSERT(std::holds_alternative<AST::ForStatement*>(target) || std::holds_alternative<AST::WhileStatement*>(target));
            break;

        }

        if (!hasLoopTarget) [[unlikely]]
            TYPE_ERROR(statement.span(), "continue statement must be in a loop"_s);

        behaviors = { Behavior::Continue };
        break;
    }
    case AST::NodeKind::CompoundStatement:
        UNWRAP_ASSIGN(behaviors, analyze(uncheckedDowncast<AST::CompoundStatement>(statement)));
        break;
    case AST::NodeKind::ForStatement:
        UNWRAP_ASSIGN(behaviors, analyze(uncheckedDowncast<AST::ForStatement>(statement)));
        break;
    case AST::NodeKind::IfStatement:
        UNWRAP_ASSIGN(behaviors, analyze(uncheckedDowncast<AST::IfStatement>(statement)));
        break;
    case AST::NodeKind::LoopStatement:
        UNWRAP_ASSIGN(behaviors, analyze(uncheckedDowncast<AST::LoopStatement>(statement)));
        break;
    case AST::NodeKind::SwitchStatement:
        UNWRAP_ASSIGN(behaviors, analyze(uncheckedDowncast<AST::SwitchStatement>(statement)));
        break;
    case AST::NodeKind::WhileStatement:
        UNWRAP_ASSIGN(behaviors, analyze(uncheckedDowncast<AST::WhileStatement>(statement)));
        break;
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
    statement.setBehaviors(behaviors);
    return { behaviors };
}

Result<Behaviors> TypeChecker::analyze(AST::CompoundStatement& statement)
{
    UNWRAP(behaviors, analyzeStatements(statement.statements()));
    statement.setBehaviors(behaviors);
    return { behaviors };
}

Result<Behaviors> TypeChecker::analyze(AST::ForStatement& statement)
{
    auto behaviors = Behaviors();
    if (statement.maybeTest())
        behaviors.add({ Behavior::Next, Behavior::Break });

    m_breakTargetStack.append(&statement);
    UNWRAP(bodyBehaviors, analyze(statement.body()));
    behaviors.add(bodyBehaviors);
    m_breakTargetStack.removeLast();

    if (behaviors.contains(Behavior::Break)) {
        behaviors.remove({ Behavior::Break, Behavior::Continue });
        behaviors.add(Behavior::Next);
    } else
        behaviors.remove({ Behavior::Next, Behavior::Continue });

    if (behaviors.isEmpty()) [[unlikely]]
        TYPE_ERROR(statement.span(), "for-loop does not exit"_s);

    return { behaviors };
}

Result<Behaviors> TypeChecker::analyze(AST::IfStatement& statement)
{
    UNWRAP(behaviors, analyze(statement.trueBody()));
    if (auto* elseBody = statement.maybeFalseBody()) {
        UNWRAP(elseBehaviors, analyze(*elseBody));
        behaviors.add(elseBehaviors);
    } else
        behaviors.add(Behavior::Next);
    return { behaviors };
}

Result<Behaviors> TypeChecker::analyze(AST::LoopStatement& statement)
{
    m_breakTargetStack.append(&statement);
    UNWRAP(behaviors, analyzeStatements(statement.body()));
    statement.setBodyBehaviors(behaviors);
    if (auto& continuing = statement.continuing()) {
        m_breakTargetStack.append(&continuing.value());
        UNWRAP(body, analyzeStatements(continuing->body));
        behaviors.add(body);
        m_breakTargetStack.removeLast();
        if (continuing->breakIf)
            behaviors.add({ Behavior::Break, Behavior::Continue });
    }
    m_breakTargetStack.removeLast();
    if (behaviors.contains(Behavior::Break)) {
        behaviors.remove({ Behavior::Break, Behavior::Continue });
        behaviors.add(Behavior::Next);
    } else
        behaviors.remove({ Behavior::Next, Behavior::Continue });

    if (behaviors.isEmpty()) [[unlikely]]
        TYPE_ERROR(statement.span(), "loop does not exit"_s);

    return { behaviors };
}

Result<Behaviors> TypeChecker::analyze(AST::SwitchStatement& statement)
{
    m_breakTargetStack.append(&statement);
    UNWRAP(behaviors, analyze(statement.defaultClause().body));
    for (auto& clause : statement.clauses()) {
        UNWRAP(clauseBehaviors, analyze(clause.body));
        behaviors.add(clauseBehaviors);
    }
    m_breakTargetStack.removeLast();

    if (behaviors.contains(Behavior::Break)) {
        behaviors.remove(Behavior::Break);
        behaviors.add(Behavior::Next);
    }

    return { behaviors };
}

Result<Behaviors> TypeChecker::analyze(AST::WhileStatement& statement)
{
    auto behaviors = Behaviors({ Behavior::Next, Behavior::Break });
    m_breakTargetStack.append(&statement);
    UNWRAP(statementBehaviors, analyze(statement.body()));
    behaviors.add(statementBehaviors);
    m_breakTargetStack.removeLast();
    behaviors.remove({ Behavior::Break, Behavior::Continue });
    return { behaviors };
}

Result<Behaviors> TypeChecker::analyzeStatements(AST::Statement::List& statements)
{
    auto behaviors = Behaviors(Behavior::Next);
    for (auto& statement : statements) {
        UNWRAP(behavior, analyze(statement));
        if (behaviors.contains(Behavior::Next)) {
            behaviors.remove(Behavior::Next);
            behaviors.add(behavior);
        }
    }
    return { behaviors };
}

Result<const Type*> TypeChecker::check(AST::Expression& expression, Constraint constraint, Evaluation evaluation)
{
    UNWRAP(type, infer(expression, evaluation));
    type = satisfyOrPromote(type, constraint, m_types);
    if (!type)
        return { nullptr };
    CHECK(convertValue(expression.span(), type, expression.m_constantValue));
    return type;
}

Result<const Type*> TypeChecker::resolve(AST::Expression& type)
{
    ASSERT(!m_inferredType);
    ASSERT(!m_currentEvaluation);
    if (auto* identifierExpression = dynamicDowncast<AST::IdentifierExpression>(type)) {
        UNWRAP(identifierType, lookupType(identifierExpression->identifier()));
        inferred(identifierType);
        evaluated(Evaluation::Constant);
    } else
        CHECK(visit(type));
    ASSERT(m_inferredType);
    ASSERT(m_currentEvaluation);

    if (std::holds_alternative<Types::TypeConstructor>(*m_inferredType)) [[unlikely]]
        TYPE_ERROR(type.span(), "type '"_s, *m_inferredType, "' requires template arguments"_s);

    if (shouldDumpInferredTypes) [[unlikely]] {
        dataLog("> Type inference [type]: ");
        dumpNode(WTF::dataFile(), type);
        dataLog(" : ");
        dataLogLn(*m_inferredType);
    }

    type.m_evaluation = Evaluation::Constant;
    type.m_inferredType = m_inferredType;
    const Type* inferredType = m_inferredType;
    m_inferredType = nullptr;
    m_currentEvaluation = std::nullopt;

    return inferredType;
}

void TypeChecker::evaluated(Evaluation evaluation)
{
    ASSERT(!m_currentEvaluation);
    m_currentEvaluation = evaluation;
}

void TypeChecker::inferred(const Type* type)
{
    ASSERT(type);
    ASSERT(!m_inferredType);
    m_inferredType = type;
}

bool TypeChecker::unify(const Type* lhs, const Type* rhs)
{
    if (shouldDumpInferredTypes) [[unlikely]]
        dataLogLn("[unify] '", *lhs, "' <", RawPointer(lhs), ">  and '", *rhs, "' <", RawPointer(rhs), ">");

    if (lhs == rhs)
        return true;

    return !!conversionRank(rhs, lhs);
}

Result<void> TypeChecker::introduceType(const AST::Identifier& name, const Type* type)
{
    ASSERT(type);
    if (!introduceVariable(name, { Binding::Type, type, Evaluation::Runtime, std::nullopt })) [[unlikely]]
        TYPE_ERROR(name.span(), "redeclaration of '"_s, name, '\'');
    return { };
}

Result<void> TypeChecker::convertValue(const SourceSpan& span, const Type* type, std::optional<ConstantValue>& value)
{
    if (!value)
        return { };

    if (shouldDumpConstantValues) [[unlikely]] {
        StringPrintStream valueString;
        value->dump(valueString);
        dataLogLn("converting value ", valueString.toString(), " to '", *type, "'");
    }

    if (!convertValueImpl(span, type, *value)) [[unlikely]] {
        if (m_suppressConstantErrors) {
            value = std::nullopt;
            return { };
        }
        StringPrintStream valueString;
        value->dump(valueString);
        TYPE_ERROR(span, "value "_s, valueString.toString(), " cannot be represented as '"_s, *type, '\'');
    }

    return { };
}


Result<void> TypeChecker::introduceValue(const AST::Identifier& name, const Type* type, Evaluation evaluation, std::optional<ConstantValue> value)
{
    ASSERT(type);
    if (shouldDumpConstantValues && value.has_value()) [[unlikely]]
        dataLogLn("> Assigning value: ", name, " => ", value);
    if (!introduceVariable(name, { Binding::Value, type, evaluation, value })) [[unlikely]]
        TYPE_ERROR(name.span(), "redeclaration of '"_s, name, '\'');
    return { };
}

Result<void> TypeChecker::introduceFunction(const AST::Identifier& name, const Type* type)
{
    ASSERT(type);
    if (!introduceVariable(name, { Binding::Function, type, Evaluation::Runtime , std::nullopt })) [[unlikely]]
        TYPE_ERROR(name.span(), "redeclaration of '"_s, name, '\'');
    return { };
}

std::optional<FailedCheck> typeCheck(ShaderModule& shaderModule)
{
    return TypeChecker(shaderModule).check();
}

template<typename TargetConstructor, typename Validator, typename... Arguments>
Result<void> TypeChecker::allocateSimpleConstructor(ASCIILiteral name, TargetConstructor constructor, const Validator& validate, Arguments&&... arguments)
{
    return introduceType(AST::Identifier::make(name), m_types.typeConstructorType(
        name,
        [this, constructor, &validate, arguments...](AST::ElaboratedTypeExpression& type) -> Result<const Type*> {
            if (type.arguments().size() != 1) [[unlikely]]
                TYPE_ERROR(type.span(), '\'', type.base(), "' requires 1 template argument"_s);

            UNWRAP(elementType, resolve(type.arguments().first()));

            if (auto error = validate(elementType)) [[unlikely]]
                TYPE_ERROR(type.span(), *error);

            return { (m_types.*constructor)(arguments..., elementType) };
        }
    ));
}

Result<void> TypeChecker::allocateTextureStorageConstructor(ASCIILiteral name, Types::TextureStorage::Kind kind)
{
    return introduceType(AST::Identifier::make(name), m_types.typeConstructorType(
        name,
        [this, kind](AST::ElaboratedTypeExpression& type) -> Result<const Type*> {
            if (type.arguments().size() != 2) [[unlikely]]
                TYPE_ERROR(type.span(), '\'', type.base(), "' requires 2 template argument"_s);

            UNWRAP(format, texelFormat(type.arguments()[0]));
            UNWRAP(access, accessMode(type.arguments()[1]));

            return { m_types.textureStorageType(kind, format, access) };
        }
    ));
}

Result<TexelFormat> TypeChecker::texelFormat(AST::Expression& expression)
{
    UNWRAP(formatType, infer(expression, Evaluation::Runtime));

    if (!unify(formatType, m_types.texelFormatType())) [[unlikely]]
        TYPE_ERROR(expression.span(), "cannot use '"_s, *formatType, "' as texel format"_s);

    auto& formatName = downcast<AST::IdentifierExpression>(expression).identifier();
    auto* format = parseTexelFormat(formatName.id());
    ASSERT(format);

    return { *format };
}

Result<AccessMode> TypeChecker::accessMode(AST::Expression& expression)
{
    UNWRAP(accessType, infer(expression, Evaluation::Runtime));

    if (!unify(accessType, m_types.accessModeType())) [[unlikely]]
        TYPE_ERROR(expression.span(), "cannot use '"_s, *accessType, "' as access mode"_s);

    auto& accessName = downcast<AST::IdentifierExpression>(expression).identifier();
    auto* accessMode = parseAccessMode(accessName.id());
    ASSERT(accessMode);

    return { *accessMode };
}

Result<AddressSpace> TypeChecker::addressSpace(AST::Expression& expression)
{
    UNWRAP(addressSpaceType, infer(expression, Evaluation::Runtime));

    if (!unify(addressSpaceType, m_types.addressSpaceType())) [[unlikely]]
        TYPE_ERROR(expression.span(), "cannot use '"_s, *addressSpaceType, "' as address space"_s);

    auto& addressSpaceName = downcast<AST::IdentifierExpression>(expression).identifier();
    auto* addressSpace = parseAddressSpace(addressSpaceName.id());
    ASSERT(addressSpace);

    return { *addressSpace };
}

template<typename Node>
Result<void> TypeChecker::setConstantValue(Node& expression, const Type* type, const ConstantValue& value)
{
    using namespace Types;

    if (shouldDumpConstantValues) [[unlikely]] {
        dataLog("> Setting constantValue for expression: ");
        dumpNode(WTF::dataFile(), expression);
        dataLogLn(" = ", value);
    }

    expression.setConstantValue(value);
    CHECK(convertValue(expression.span(), type, expression.m_constantValue));
    return { };
}

bool TypeChecker::isModuleScope() const
{
    return !m_returnType;
}


} // namespace WGSL

#undef TYPE_ERROR
#undef UNWRAP
#undef UNWRAP_ASSIGN
#undef CHECK
#undef CHECK_IMPL
