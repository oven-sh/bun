/*
 * Copyright (c) 2026 Apple Inc. All rights reserved.
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
#include "IOValidator.h"

#include "AST.h"
#include "ASTScopedVisitorInlines.h"
#include "Constraints.h"
#include "WGSLShaderModule.h"
#include <wtf/CheckedArithmetic.h>
#include <wtf/MathExtras.h>
#include <wtf/text/MakeString.h>

#define CHECK(__expression) { \
    __expression; \
    if (hasError()) [[unlikely]] \
        return; \
}

namespace WGSL {

enum class Direction : uint8_t {
    Input,
    Output,
};

class IOValidator : public AST::ScopedVisitor<const CallGraph::Global*> {
public:
    using AST::Visitor::visit;

    IOValidator(ShaderModule&);

    void validateIO();

    void visit(AST::Function&) override;
    void visit(AST::Parameter&) override;
    void visit(AST::VariableStatement&) override;
    void visit(AST::IdentifierExpression&) override;

private:
    using Builtins = HashSet<Builtin, WTF::IntHash<Builtin>, WTF::StrongEnumHashTraits<Builtin>>;
    using Locations = HashSet<uint64_t, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>>;

    void collectGlobals();
    void validateResources(const CallGraph::EntryPoint&);
    void validateEntryPointIO(const CallGraph::EntryPoint&);

    void validateBuiltinIO(const SourceSpan&, const Type*, ShaderStage, Builtin, Direction, Builtins&);
    void validateLocationIO(const SourceSpan&, const Type*, ShaderStage, unsigned, Locations&);
    void validateStructIO(ShaderStage, const Types::Struct&, Direction, Builtins&, Locations&);
    void validateInterpolationIO(const SourceSpan&, ShaderStage, Direction, const Type*, const std::optional<AST::Interpolation>&);

    template<typename... Arguments>
    void error(const SourceSpan&, Arguments&&...);

    ShaderModule& m_shaderModule;
    HashSet<const CallGraph::Global*> m_usedGlobals { };
    ShaderStage m_stage { ShaderStage::Vertex };
};

IOValidator::IOValidator(ShaderModule& shaderModule)
    : m_shaderModule(shaderModule)
{
}

void IOValidator::validateIO()
{
    collectGlobals();

    for (auto& entryPoint : m_shaderModule.callGraph().entrypoints()) {
        CHECK(validateEntryPointIO(entryPoint));

        m_stage = entryPoint.stage;
        CHECK(visit(entryPoint.function));

        const_cast<CallGraph::EntryPoint&>(entryPoint).usedGlobals.addAll(m_usedGlobals);
        m_usedGlobals.clear();

        CHECK(validateResources(entryPoint));
    }
}

void IOValidator::collectGlobals()
{
    for (auto& declaration : m_shaderModule.declarations()) {
        auto* globalVar = dynamicDowncast<AST::Variable>(declaration);
        if (!globalVar)
            continue;
        std::optional<CallGraph::Global::Resource> resource;
        if (globalVar->group().has_value()) {
            RELEASE_ASSERT(globalVar->binding().has_value());
            resource = { *globalVar->group(), *globalVar->binding() };
        }

        auto* global = m_shaderModule.callGraph().addGlobal(CallGraph::Global {
            resource,
            globalVar
        });
        introduceVariable(globalVar->name(), global);
    }
}

void IOValidator::visit(AST::Function& function)
{
    HashSet<const CallGraph::Global*> usedGlobals;
    for (auto& callee : m_shaderModule.callGraph().callees(function)) {
        if (!callee.usedGlobals.isEmpty()) {
            usedGlobals.addAll(callee.usedGlobals);
            continue;
        }

        visit(*callee.target);
        const_cast<CallGraph::Callee&>(callee).usedGlobals.addAll(m_usedGlobals);
        usedGlobals.addAll(m_usedGlobals);
        m_usedGlobals.clear();
    }

    m_usedGlobals.addAll(usedGlobals);
    AST::Visitor::visit(function);
}

void IOValidator::visit(AST::VariableStatement& statement)
{
    introduceVariable(statement.variable().name(), nullptr);
    AST::Visitor::visit(statement);
}

void IOValidator::visit(AST::Parameter& parameter)
{
    introduceVariable(parameter.name(), nullptr);
    AST::Visitor::visit(parameter);
}

void IOValidator::visit(AST::IdentifierExpression& identifier)
{
    AST::Visitor::visit(identifier);

    auto* variable = readVariable(identifier.identifier());
    if (!variable || !*variable)
        return;

    auto& var = *(*variable)->declaration;
    if (auto addressSpace = var.addressSpace()) {
        if (m_stage != ShaderStage::Compute && *addressSpace == AddressSpace::Workgroup) {
            error(identifier.span(), "var with `workgroup` address space cannot be used by `"_s, toString(m_stage), "` pipeline stage"_s);
            return;
        }

        if (m_stage == ShaderStage::Vertex) {
            auto* textureStorage = std::get_if<Types::TextureStorage>(var.storeType());
            if (textureStorage && std::to_underlying(textureStorage->access) & std::to_underlying(AccessMode::Write)) {
                error(identifier.span(), "storage texture with `read_write` access mode cannot be used by `vertex` pipeline stage"_s);
                return;
            }

            if (auto accessMode = var.accessMode(); *addressSpace == AddressSpace::Storage && accessMode.has_value() && std::to_underlying(*accessMode) & std::to_underlying(AccessMode::Write)) {
                error(identifier.span(), "var with `storage` address space and `read_write` access mode cannot be used by `vertex` pipeline stage"_s);
                return;
            }
        }
    }
    m_usedGlobals.add(*variable);
}

void IOValidator::validateResources(const CallGraph::EntryPoint& entryPoint)
{
    HashMap<std::pair<unsigned, unsigned>, const CallGraph::Global*> usedGlobals;
    for (auto* global : entryPoint.usedGlobals) {
        if (!global->resource)
            continue;

        auto result = usedGlobals.add({ global->resource->group + 1, global->resource->binding + 1 }, global);
        if (!result.isNewEntry) [[unlikely]] {
            auto& var = *global->declaration;
            auto& resource = *global->resource;
            auto& entryPointName = entryPoint.originalName;
            auto& originalDeclaration = result.iterator->value->declaration->originalName();
            error(var.span(), "entry point '"_s, entryPointName, "' uses variables '"_s, originalDeclaration, "' and '"_s, var.originalName(), "', both which use the same resource binding: @group("_s, resource.group, ") @binding("_s, resource.binding, ')');
            return;
        }
    }
}

void IOValidator::validateEntryPointIO(const CallGraph::EntryPoint& entryPoint)
{
    auto& function = entryPoint.function;
    Builtins builtins;
    Locations locations;
    for (auto& parameter : function.parameters()) {
        const auto& span = parameter.span();
        const auto* type = parameter.typeName().inferredType();

        if (auto builtin = parameter.builtin()) {
            CHECK(validateBuiltinIO(span, type, entryPoint.stage, *builtin, Direction::Input, builtins));
            continue;
        }

        if (auto location = parameter.location()) {
            CHECK(validateLocationIO(span, type, entryPoint.stage, *location, locations));
            CHECK(validateInterpolationIO(span, entryPoint.stage, Direction::Input, type, parameter.interpolation()));
            continue;
        }

        if (auto* structType = std::get_if<Types::Struct>(type)) {
            CHECK(validateStructIO(entryPoint.stage, *structType, Direction::Input, builtins, locations));
            continue;
        }

        error(span, "missing entry point IO attribute on parameter"_s);
        return;
    }

    if (!function.maybeReturnType()) {
        if (entryPoint.stage == ShaderStage::Vertex) [[unlikely]]
            error(function.span(), "a vertex shader must include the 'position' builtin in its return type"_s);
        return;
    }

    builtins.clear();
    locations.clear();
    const auto& span = function.maybeReturnType()->span();
    const auto* type = function.maybeReturnType()->inferredType();

    if (auto builtin = function.returnTypeBuiltin()) {
        CHECK(validateBuiltinIO(span, type, entryPoint.stage, *builtin, Direction::Output, builtins));
    } else if (auto location = function.returnTypeLocation()) {
        CHECK(validateLocationIO(span, type, entryPoint.stage, *location, locations));
    } else if (auto* structType = std::get_if<Types::Struct>(type)) {
        CHECK(validateStructIO(entryPoint.stage, *structType, Direction::Output, builtins, locations));
    } else [[unlikely]] {
        error(span, "missing entry point IO attribute on return type"_s);
        return;
    }

    if (entryPoint.stage == ShaderStage::Vertex && !builtins.contains(Builtin::Position)) [[unlikely]]
        error(span, "a vertex shader must include the 'position' builtin in its return type"_s);
}

void IOValidator::validateBuiltinIO(const SourceSpan& span, const Type* type, ShaderStage stage, Builtin builtin, Direction direction, Builtins& builtins)
{
#define TYPE_CHECK(__type) \
    type != m_shaderModule.types().__type##Type(), *m_shaderModule.types().__type##Type()

#define VEC_CHECK(__count, __elementType) \
    auto* vector = std::get_if<Types::Vector>(type); !vector || vector->size != __count || vector->element != m_shaderModule.types().__elementType##Type(), "vec" #__count "<" #__elementType ">"_s

#define CASE_(__case, __typeCheck, __type) \
case Builtin::__case: \
    if (__typeCheck)  [[unlikely]] { \
        error(span, "store type of @builtin("_s, toString(Builtin::__case), ") must be '"_s, __type, '\''); \
        return; \
    } \

#define CASE(__case, __typeCheck, __stage, __direction) \
    CASE_(__case, __typeCheck); \
    if (stage != ShaderStage::__stage || direction != Direction::__direction) [[unlikely]] { \
        error(span, "@builtin("_s, toString(Builtin::__case), ") cannot be used for "_s, toString(stage), " shader "_s, direction == Direction::Input ? "input"_s : "output"_s); \
        return; \
    } \
    break;

#define CASE2(__case, __typeCheck, __stage1, __direction1, __stage2, __direction2) \
    CASE_(__case, __typeCheck); \
    if ((stage != ShaderStage::__stage1 || direction != Direction::__direction1) && (stage != ShaderStage::__stage2 || direction != Direction::__direction2)) [[unlikely]] { \
        error(span, "@builtin("_s, toString(Builtin::__case), ") cannot be used for "_s, toString(stage), " shader "_s, direction == Direction::Input ? "input"_s : "output"_s); \
        return; \
    } \
    break;

    switch (builtin) {
    case Builtin::ClipDistances: {
        // clip_distances requires the extension to be enabled
        if (!m_shaderModule.enabledExtensions().contains(Extension::ClipDistances)) [[unlikely]] {
            error(span, "@builtin(clip_distances) requires the 'clip_distances' extension to be enabled"_s);
            return;
        }
        // @builtin(clip_distances) must be array<f32, N> where N is determined by the array size
        auto* arrayType = std::get_if<Types::Array>(type);
        bool isValidType
            = arrayType
            && arrayType->element == m_shaderModule.types().f32Type()
            && std::holds_alternative<unsigned>(arrayType->size)
            && std::get<unsigned>(arrayType->size) <= 8;
        if (!isValidType) [[unlikely]] {
            error(span, "store type of @builtin(clip_distances) must be 'array<f32, N>' (N <= 8)"_s);
            return;
        }
        if (stage != ShaderStage::Vertex || direction != Direction::Output) [[unlikely]] {
            error(span, "@builtin(clip_distances) can only be used for vertex shader output"_s);
            return;
        }
        break;
    }
    CASE(FragDepth, TYPE_CHECK(f32), Fragment, Output)
    CASE(FrontFacing, TYPE_CHECK(bool), Fragment, Input)
    CASE(GlobalInvocationId, VEC_CHECK(3, u32), Compute, Input)
    CASE(InstanceIndex, TYPE_CHECK(u32), Vertex, Input)
    CASE(LocalInvocationId, VEC_CHECK(3, u32), Compute, Input)
    CASE(LocalInvocationIndex, TYPE_CHECK(u32), Compute, Input)
    CASE(NumWorkgroups, VEC_CHECK(3, u32), Compute, Input)
    case Builtin::PrimitiveIndex: {
        // primitive_index requires the extension to be enabled
        if (!m_shaderModule.enabledExtensions().contains(Extension::PrimitiveIndex)) [[unlikely]] {
            error(span, "@builtin(primitive_index) requires the 'primitive_index' extension to be enabled"_s);
            return;
        }
        // Type check: must be u32
        if (type != m_shaderModule.types().u32Type()) [[unlikely]] {
            error(span, "store type of @builtin(primitive_index) must be 'u32'"_s);
            return;
        }
        // Stage and direction check: must be fragment shader input
        if (stage != ShaderStage::Fragment || direction != Direction::Input) [[unlikely]] {
            error(span, "@builtin(primitive_index) can only be used for fragment shader input"_s);
            return;
        }
        break;
    }
    CASE(SampleIndex, TYPE_CHECK(u32), Fragment, Input)
    case Builtin::SubgroupInvocationId:
    case Builtin::SubgroupSize: {
        // subgroup_invocation_id / subgroup_size require the 'subgroups' extension.
        if (!m_shaderModule.enabledExtensions().contains(Extension::Subgroups)) [[unlikely]] {
            error(span, "@builtin("_s, toString(builtin), ") requires the 'subgroups' extension to be enabled"_s);
            return;
        }
        if (type != m_shaderModule.types().u32Type()) [[unlikely]] {
            error(span, "store type of @builtin("_s, toString(builtin), ") must be 'u32'"_s);
            return;
        }
        if ((stage != ShaderStage::Compute && stage != ShaderStage::Fragment) || direction != Direction::Input) [[unlikely]] {
            error(span, "@builtin("_s, toString(builtin), ") can only be used for compute or fragment shader input"_s);
            return;
        }
        break;
    }
    case Builtin::SubgroupId:
    case Builtin::NumSubgroups: {
        // subgroup_id / num_subgroups are gated on the 'subgroups' enable-extension. The
        // 'subgroup_id' language extension is reported (and 'requires subgroup_id;' is
        // accepted), but per WGSL §3.8.5 it is not required to be explicitly requested.
        if (!m_shaderModule.enabledExtensions().contains(Extension::Subgroups)) [[unlikely]] {
            error(span, "@builtin("_s, toString(builtin), ") requires the 'subgroups' extension to be enabled"_s);
            return;
        }
        if (type != m_shaderModule.types().u32Type()) [[unlikely]] {
            error(span, "store type of @builtin("_s, toString(builtin), ") must be 'u32'"_s);
            return;
        }
        if (stage != ShaderStage::Compute || direction != Direction::Input) [[unlikely]] {
            error(span, "@builtin("_s, toString(builtin), ") can only be used for compute shader input"_s);
            return;
        }
        break;
    }
    CASE(VertexIndex, TYPE_CHECK(u32), Vertex, Input)
    CASE(WorkgroupId, VEC_CHECK(3, u32), Compute, Input)
    CASE2(SampleMask, TYPE_CHECK(u32), Fragment, Input, Fragment, Output)
    CASE2(Position, VEC_CHECK(4, f32), Vertex, Output, Fragment, Input)
    }

    auto result = builtins.add(builtin);
    if (!result.isNewEntry) [[unlikely]]
        error(span, "@builtin("_s, toString(builtin), ") appears multiple times as pipeline input"_s);
}

void IOValidator::validateLocationIO(const SourceSpan& span, const Type* type, ShaderStage stage, unsigned location, Locations& locations)
{
    if (stage == ShaderStage::Compute) [[unlikely]] {
        error(span, "@location cannot be used by compute shaders"_s);
        return;
    }

    if (!satisfies(type, Constraints::Number)) {
        auto* vector = std::get_if<Types::Vector>(type);
        if (!vector || !satisfies(vector->element, Constraints::Number)) [[unlikely]] {
            error(span, "cannot apply @location to declaration of type '"_s, *type, '\'');
            return;
        }
    }

    auto result = locations.add(location);
    if (!result.isNewEntry) [[unlikely]]
        error(span, "@location("_s, location, ") appears multiple times"_s);
}

void IOValidator::validateInterpolationIO(const SourceSpan& span, ShaderStage stage, Direction direction, const Type* type, const std::optional<AST::Interpolation>& interpolation)
{
    if (!(stage == ShaderStage::Vertex && direction == Direction::Output) && !(stage == ShaderStage::Fragment && direction == Direction::Input)) [[unlikely]]
        return;

    if (!satisfies(type, Constraints::Integer)) {
        auto* vector = std::get_if<Types::Vector>(type);
        if (!vector || !satisfies(vector->element, Constraints::Integer)) [[unlikely]]
            return;
    }

    if (!interpolation || interpolation->type != InterpolationType::Flat) [[unlikely]] {
        auto location = stage == ShaderStage::Vertex ? "vertex output"_s : "fragment input"_s;
        error(span, makeString("integral user-defined "_s, location, " must have a @interpolate(flat) attribute"_s));
    }
}

void IOValidator::validateStructIO(ShaderStage stage, const Types::Struct& structType, Direction direction, Builtins& builtins, Locations& locations)
{
    for (auto& member : structType.structure.members()) {
        const auto& span = member.span();
        const auto* type = member.type().inferredType();

        if (auto builtin = member.builtin()) {
            validateBuiltinIO(span, type, stage, *builtin, direction, builtins);
            if (hasError()) [[unlikely]]
                return;
            continue;
        }

        if (auto location = member.location()) {
            validateLocationIO(span, type, stage, *location, locations);
            if (hasError()) [[unlikely]]
                return;
            validateInterpolationIO(span, stage, direction, type, member.interpolation());
            if (hasError()) [[unlikely]]
                return;
            continue;
        }

        if (auto inferredType = member.type().inferredType(); inferredType && std::holds_alternative<Types::Struct>(*inferredType)) {
            error(span, "nested structures cannot be used for entry point IO"_s);
            return;
        }

        error(span, "missing entry point IO attribute"_s);
        return;
    }
}

template<typename... Arguments>
void IOValidator::error(const SourceSpan& span, Arguments&&... arguments)
{
    setError({ makeString(std::forward<Arguments>(arguments)...), span });
}

std::optional<FailedCheck> validateIO(ShaderModule& shaderModule)
{
    IOValidator validator(shaderModule);
    validator.validateIO();
    if (validator.hasError()) [[unlikely]]
        return FailedCheck { Vector<Error> { validator.result().error() }, { } };
    return std::nullopt;
}

} // namespace WGSL

#undef CHECK
#undef TYPE_CHECK
#undef VEC_CHECK
#undef CASE_
#undef CASE
#undef CASE2
