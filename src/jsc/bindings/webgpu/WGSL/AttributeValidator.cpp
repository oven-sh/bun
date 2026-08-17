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

#include "config.h"
#include "AttributeValidator.h"

#include "AST.h"
#include "ASTVisitor.h"
#include "Constraints.h"
#include "WGSLShaderModule.h"
#include <wtf/CheckedArithmetic.h>
#include <wtf/MathExtras.h>
#include <wtf/text/MakeString.h>

namespace WGSL {

class AttributeValidator : public AST::Visitor {
public:
    AttributeValidator(ShaderModule&);

    std::optional<FailedCheck> validate();

    void visit(AST::DiagnosticDirective&) override;
    void visit(AST::Function&) override;
    void visit(AST::Parameter&) override;
    void visit(AST::Variable&) override;
    void visit(AST::Structure&) override;
    void visit(AST::StructureMember&) override;
    void visit(AST::CompoundStatement&) override;
    void visit(AST::ForStatement&) override;
    void visit(AST::WhileStatement&) override;
    void visit(AST::LoopStatement&) override;
    void visit(AST::Continuing&) override;
    void visit(AST::SwitchStatement&) override;
    void visit(AST::IfStatement&) override;

private:
    bool parseBuiltin(AST::Function*, std::optional<Builtin>&, AST::Attribute&);
    bool parseInterpolate(std::optional<AST::Interpolation>&, AST::Attribute&);
    bool parseInvariant(bool&, AST::Attribute&);
    bool parseLocation(AST::Function*, std::optional<unsigned>&, AST::Attribute&, const Type*);
    bool parseDiagnostic(AST::DiagnosticContainer&, AST::Attribute&);

    void validateInterpolation(const SourceSpan&, const std::optional<AST::Interpolation>&, const std::optional<unsigned>&);
    void validateInvariant(const SourceSpan&, const std::optional<Builtin>&, bool);

    void validateAlignment(const SourceSpan&, AddressSpace, const Type*);

    template<typename T>
    void update(const SourceSpan&, std::optional<T>&, const T&);
    void set(const SourceSpan&, bool&);

    template<typename... Arguments>
    void error(const SourceSpan&, Arguments&&...);

    AST::Function* m_currentFunction { nullptr };
    ShaderModule& m_shaderModule;
    bool m_hasSizeOrAlignmentAttributes { false };
};

AttributeValidator::AttributeValidator(ShaderModule& shaderModule)
    : m_shaderModule(shaderModule)
{
}

std::optional<FailedCheck> AttributeValidator::validate()
{
    AST::Visitor::visit(m_shaderModule);

    if (!hasError()) [[likely]]
        return std::nullopt;
    return FailedCheck { Vector<Error> { result().error() }, { } };
}

void AttributeValidator::visit(AST::DiagnosticDirective& diagnosticDirective)
{
    auto& diagnostic = diagnosticDirective.diagnostic();
    if (auto& severity = m_shaderModule.severityFor(diagnostic.triggeringRule)) {
        if (severity != diagnostic.severity) {
            error(diagnosticDirective.span(), "conflicting diagnostic directive"_s);
            return;
        }
    }

    m_shaderModule.setSeverityFor(diagnostic.triggeringRule, diagnostic.severity);
}

void AttributeValidator::visit(AST::Function& function)
{
    for (auto& attribute : function.attributes()) {
        if (is<AST::MustUseAttribute>(attribute)) {
            if (!function.maybeReturnType()) [[unlikely]] {
                error(attribute.span(), "@must_use can only be applied to functions that return a value"_s);
                return;
            }
            set(attribute.span(), function.m_mustUse);
            continue;
        }

        if (auto* stageAttribute = dynamicDowncast<AST::StageAttribute>(attribute)) {
            update(attribute.span(), function.m_stage, stageAttribute->stage());
            continue;
        }

        if (auto* workgroupSizeAttribute = dynamicDowncast<AST::WorkgroupSizeAttribute>(attribute)) {
            auto& workgroupSize = workgroupSizeAttribute->workgroupSize();
            const auto& check = [&](AST::Expression* dimension) {
                if (!dimension)
                    return;
                auto value = dimension->constantValue();
                if (!value.has_value())
                    return;
                if (value->integerValue() < 1) [[unlikely]] {
                    error(dimension->span(), "@workgroup_size argument must be at least 1"_s);
                    return;
                }
            };
            check(workgroupSize.x);
            if (hasError()) [[unlikely]]
                return;

            check(workgroupSize.y);
            if (hasError()) [[unlikely]]
                return;

            check(workgroupSize.z);
            if (hasError()) [[unlikely]]
                return;

            update(attribute.span(), function.m_workgroupSize, workgroupSize);
            continue;
        }

        if (parseDiagnostic(function, attribute))
            continue;

        error(attribute.span(), "invalid attribute for function declaration"_s);
        return;
    }

    if (function.workgroupSize().has_value() && (!function.stage().has_value() || *function.stage() != ShaderStage::Compute)) [[unlikely]] {
        error(function.span(), "@workgroup_size must only be applied to compute shader entry point function"_s);
        return;
    }

    for (auto& attribute : function.returnAttributes()) {
        if (hasError()) [[unlikely]]
            return;

        if (parseBuiltin(&function, function.m_returnTypeBuiltin, attribute))
            continue;

        if (parseInterpolate(function.m_returnTypeInterpolation, attribute))
            continue;

        if (parseInvariant(function.m_returnTypeInvariant, attribute))
            continue;

        if (parseLocation(&function, function.m_returnTypeLocation, attribute, function.maybeReturnType()->inferredType()))
            continue;

        error(attribute.span(), "invalid attribute for function return type"_s);
        return;
    }

    if (function.maybeReturnType()) {
        validateInterpolation(function.maybeReturnType()->span(), function.returnTypeInterpolation(), function.returnTypeLocation());
        if (hasError()) [[unlikely]]
            return;

        validateInvariant(function.maybeReturnType()->span(), function.returnTypeBuiltin(), function.returnTypeInvariant());
        if (hasError()) [[unlikely]]
            return;
    }

    m_currentFunction = &function;
    AST::Visitor::visit(function);
    m_currentFunction = nullptr;
}

void AttributeValidator::visit(AST::Parameter& parameter)
{
    for (auto& attribute : parameter.attributes()) {
        if (hasError()) [[unlikely]]
            return;

        if (parseBuiltin(m_currentFunction, parameter.m_builtin, attribute))
            continue;

        if (parseInterpolate(parameter.m_interpolation, attribute))
            continue;

        if (parseInvariant(parameter.m_invariant, attribute))
            continue;

        if (parseLocation(m_currentFunction, parameter.m_location, attribute, parameter.typeName().inferredType()))
            continue;

        error(attribute.span(), "invalid attribute for function parameter"_s);
        return;
    }

    validateInterpolation(parameter.span(), parameter.interpolation(), parameter.location());
    if (hasError()) [[unlikely]]
        return;

    validateInvariant(parameter.span(), parameter.builtin(), parameter.invariant());
    if (hasError()) [[unlikely]]
        return;

    AST::Visitor::visit(parameter);
}

void AttributeValidator::visit(AST::Variable& variable)
{
    bool isResource = [&]() -> bool {
        auto addressSpace = variable.addressSpace();
        if (!addressSpace.has_value())
            return false;
        switch (*addressSpace) {
        case AddressSpace::Handle:
        case AddressSpace::Storage:
        case AddressSpace::Uniform:
            return true;
        case AddressSpace::Function:
        case AddressSpace::Private:
        case AddressSpace::Workgroup:
            return false;
        }
    }();

    for (auto& attribute : variable.attributes()) {
        if (auto* bindingAttribute = dynamicDowncast<AST::BindingAttribute>(attribute)) {
            if (!isResource) [[unlikely]] {
                error(attribute.span(), "@binding attribute must only be applied to resource variables"_s);
                return;
            }

            // https://gpuweb.github.io/cts/standalone/?q=webgpu:shader,validation,parse,attribute:expressions:value=%22override%22;attribute=%22binding%22
            auto& constantValue = bindingAttribute->binding().constantValue();
            if (!constantValue) [[unlikely]] {
                error(attribute.span(), "@binding attribute must only be applied to resource variables"_s);
                return;
            }

            auto bindingValue = constantValue->integerValue();
            if (bindingValue < 0) [[unlikely]] {
                error(attribute.span(), "@binding value must be non-negative"_s);
                return;
            }

            update(attribute.span(), variable.m_binding, static_cast<unsigned>(bindingValue));
            continue;
        }

        if (auto* groupAttribute = dynamicDowncast<AST::GroupAttribute>(attribute)) {
            if (!isResource) [[unlikely]] {
                error(attribute.span(), "@group attribute must only be applied to resource variables"_s);
                return;
            }

            // https://gpuweb.github.io/cts/standalone/?q=webgpu:shader,validation,parse,attribute:expressions:value=%22override%22;attribute=%22binding%22
            auto& constantValue = groupAttribute->group().constantValue();
            if (!constantValue) [[unlikely]] {
                error(attribute.span(), "@group attribute must only be applied to resource variables"_s);
                return;
            }

            auto groupValue = constantValue->integerValue();
            if (groupValue < 0) [[unlikely]] {
                error(attribute.span(), "@group value must be non-negative"_s);
                return;
            }

            update(attribute.span(), variable.m_group, static_cast<unsigned>(groupValue));
            continue;
        }

        if (auto* idAttribute = dynamicDowncast<AST::IdAttribute>(attribute)) {
            auto& idExpression = idAttribute->value();
            if (variable.flavor() != AST::VariableFlavor::Override) [[unlikely]] {
                error(attribute.span(), "@id attribute must only be applied to override variables"_s);
                return;
            }

            RELEASE_ASSERT(satisfies(variable.storeType(), Constraints::Scalar));

            // https://gpuweb.github.io/cts/standalone/?q=webgpu:shader,validation,parse,attribute:expressions:value=%22override%22;attribute=%22binding%22
            auto& constantValue = idExpression.constantValue();
            RELEASE_ASSERT(constantValue);

            auto idValue = constantValue->integerValue();
            if (idValue < 0) [[unlikely]] {
                error(attribute.span(), "@id value must be non-negative"_s);
                return;
            }

            if (idValue > std::numeric_limits<uint16_t>::max()) [[unlikely]] {
                error(attribute.span(), "@id value must be between 0 and 65535"_s);
                return;
            }

            auto uintIdValue = static_cast<unsigned>(idValue);
            if (m_shaderModule.containsOverrideID(uintIdValue)) [[unlikely]] {
                error(attribute.span(), "@id value must be unique"_s);
                return;
            }

            update(attribute.span(), variable.m_id, uintIdValue);
            m_shaderModule.addOverrideID(uintIdValue);
            continue;
        }

        error(attribute.span(), "invalid attribute for variable declaration"_s);
        return;
    }

    if (isResource && (!variable.m_group || !variable.m_binding)) [[unlikely]] {
        error(variable.span(), "resource variables require @group and @binding attributes"_s);
        return;
    }

    if (isResource)
        validateAlignment(variable.span(), *variable.addressSpace(), variable.storeType());
}

void AttributeValidator::validateAlignment(const SourceSpan& span, AddressSpace addressSpace, const Type* type)
{
    const auto& requiredAlignment = [&](const Type* type) {
        auto alignment = type->alignment();
        if (addressSpace == AddressSpace::Uniform && (std::holds_alternative<Types::Array>(*type) || std::holds_alternative<Types::Struct>(*type)))
            alignment = WTF::roundUpToMultipleOf(16, alignment);
        return alignment;
    };

    if (auto* arrayType = std::get_if<Types::Array>(type)) {
        if (arrayType->stride() % requiredAlignment(arrayType->element)) [[unlikely]] {
            error(span, "array must have a stride multiple of "_s, String::number(requiredAlignment(arrayType->element)), " bytes, but has a stride of "_s, String::number(arrayType->stride()), " bytes"_s);
            return;
        }

        if (addressSpace == AddressSpace::Uniform && (arrayType->stride() % 16)) [[unlikely]] {
            error(span, "arrays in the uniform address space must have a stride multiple of 16 bytes, but has a stride of "_s, String::number(arrayType->stride()), " bytes"_s);
            return;
        }

        validateAlignment(span, addressSpace, arrayType->element);
        if (hasError()) [[unlikely]]
            return;
    }

    if (auto* structType = std::get_if<Types::Struct>(type)) {
        auto& structure = structType->structure;
        auto memberCount = structure.members().size();
        for (unsigned i = 0; i < memberCount; ++i) {
            auto& member = structure.members()[i];
            auto* type = member.type().inferredType();

            validateAlignment(member.span(), addressSpace, type);
            if (hasError()) [[unlikely]]
                return;

            if (member.offset() % requiredAlignment(type)) [[unlikely]] {
                error(member.span(), "offset of struct member "_s, structure.name(), "::"_s, member.name(), " must be a multiple of "_s, String::number(requiredAlignment(type)), " bytes, but its offset is "_s, String::number(member.offset()), " bytes"_s);
                return;
            }

            if (addressSpace == AddressSpace::Uniform && std::holds_alternative<Types::Struct>(*type) && (i + 1) < memberCount) {
                auto& nextMember = structure.members()[i + 1];
                auto spaceBetweenMembers = nextMember.offset() - member.offset();
                auto minimumNumberOfBytes = WTF::roundUpToMultipleOf(16, type->size());
                if (spaceBetweenMembers < minimumNumberOfBytes) [[unlikely]] {
                    error(member.span(), "uniform address space requires that the number of bytes between "_s, structure.name(), "::"_s, member.name(), " and "_s, structure.name(), "::"_s, nextMember.name(), " must be at least "_s, String::number(minimumNumberOfBytes), " bytes, but it is "_s, String::number(spaceBetweenMembers), " bytes"_s);
                    return;
                }
            }
        }

    }
}

void AttributeValidator::visit(AST::Structure& structure)
{
    AST::Visitor::visit(structure);

    structure.m_hasSizeOrAlignmentAttributes = std::exchange(m_hasSizeOrAlignmentAttributes, false);

    CheckedUint32 previousSize = 0;
    unsigned alignment = 0;
    CheckedUint32 size = 0;
    AST::StructureMember* previousMember = nullptr;
    for (auto& member : structure.members()) {
        auto* type = member.type().inferredType();
        auto fieldAlignment = member.m_alignment;
        if (!fieldAlignment) {
            fieldAlignment = type->alignment();
            member.m_alignment = fieldAlignment;
        }

        auto typeSize = type->size();
        auto fieldSize = member.m_size;
        if (!fieldSize) {
            fieldSize = typeSize;
            member.m_size = fieldSize;
        }

        unsigned currentSize = [&] {
            if (size.hasOverflowed()) [[unlikely]]
                return std::numeric_limits<unsigned>::max();
            return size.value();
        }();
        unsigned offset;
        if (size.hasOverflowed()) [[unlikely]]
            offset = currentSize;
        else {
            CheckedUint32 checkedOffset = WTF::roundUpToMultipleOf(*fieldAlignment, static_cast<uint64_t>(currentSize));
            if (checkedOffset.hasOverflowed()) [[unlikely]]
                offset = std::numeric_limits<unsigned>::max();
            else
                offset = checkedOffset.value();
        }

        member.m_offset = offset;

        alignment = std::max(alignment, *fieldAlignment);
        size = offset;
        size += *fieldSize;
        if (size.hasOverflowed()) [[unlikely]]
            size = std::numeric_limits<unsigned>::max();

        if (previousMember)
            previousMember->m_padding = offset - previousSize;

        previousMember = &member;

        previousSize = offset;
        previousSize += typeSize;
        if (previousSize.hasOverflowed()) [[unlikely]]
            previousSize = currentSize;
    }
    unsigned finalSize;
    if (size.hasOverflowed()) [[unlikely]]
        finalSize = std::numeric_limits<unsigned>::max();
    else {
        CheckedUint32 checkedFinalSize = WTF::roundUpToMultipleOf(alignment, static_cast<uint64_t>(size.value()));
        if (checkedFinalSize.hasOverflowed()) [[unlikely]]
            finalSize = std::numeric_limits<unsigned>::max();
        else
            finalSize = checkedFinalSize.value();
    }
    previousMember->m_padding = finalSize - previousSize;
    structure.m_alignment = alignment;
    structure.m_size = finalSize;
}

void AttributeValidator::visit(AST::StructureMember& member)
{
    for (auto& attribute : member.attributes()) {
        if (hasError()) [[unlikely]]
            return;

        if (parseBuiltin(nullptr, member.m_builtin, attribute))
            continue;

        if (parseInterpolate(member.m_interpolation, attribute))
            continue;

        if (parseInvariant(member.m_invariant, attribute))
            continue;

        if (parseLocation(nullptr, member.m_location, attribute, member.type().inferredType()))
            continue;

        if (auto* sizeAttribute = dynamicDowncast<AST::SizeAttribute>(attribute)) {
            m_hasSizeOrAlignmentAttributes = true;

            if (!member.type().inferredType()->hasCreationFixedFootprint()) [[unlikely]] {
                error(attribute.span(), "@size can only be applied to members that have a type with a size that is fully determined at shader creation time."_s);
                return;
            }

            // https://gpuweb.github.io/cts/standalone/?q=webgpu:shader,validation,parse,attribute:expressions:value=%22override%22;*
            auto& constantValue = sizeAttribute->size().constantValue();
            if (!constantValue) [[unlikely]] {
                error(attribute.span(), "@size constant value is not found"_s);
                return;
            }
            auto sizeValue = constantValue->integerValue();
            if (sizeValue < 0) [[unlikely]] {
                error(attribute.span(), "@size value must be non-negative"_s);
                return;
            }

            if (sizeValue < member.type().inferredType()->size()) [[unlikely]] {
                // We can't call Type::size() if we already have errors, as we might
                // try to read the size of a struct, which we will not have computed
                // if we already encountered errors
                error(attribute.span(), "@size value must be at least the byte-size of the type of the member"_s);
                return;
            }

            update(attribute.span(), member.m_size, static_cast<unsigned>(sizeValue));
            continue;
        }

        if (auto* alignAttribute = dynamicDowncast<AST::AlignAttribute>(attribute)) {
            m_hasSizeOrAlignmentAttributes = true;
            // https://gpuweb.github.io/cts/standalone/?q=webgpu:shader,validation,parse,attribute:expressions:value=%22override%22;attribute=%22align%22
            auto constantValue = alignAttribute->alignment().constantValue();
            if (!constantValue) [[unlikely]] {
                error(attribute.span(), "@align constant value does not exist"_s);
                return;
            }

            auto alignmentValue = constantValue->integerValue();
            if (alignmentValue < 1) [[unlikely]] {
                error(attribute.span(), "@align value must be positive"_s);
                return;
            }

            if (!isPowerOfTwo(unsignedCast(alignmentValue))) [[unlikely]] {
                error(attribute.span(), "@align value must be a power of two"_s);
                return;
            }

            auto* type = member.type().inferredType();
            if (type && (alignmentValue % type->alignment())) [[unlikely]] {
                error(attribute.span(), "@align attribute "_s, alignmentValue, " of struct member is not a multiple of the type's alignment "_s, type->alignment());
                return;
            }

            update<unsigned>(attribute.span(), member.m_alignment, alignmentValue);
            continue;
        }

        error(attribute.span(), "invalid attribute for structure member"_s);
        return;
    }

    validateInterpolation(member.span(), member.interpolation(), member.location());
    if (hasError()) [[unlikely]]
        return;

    validateInvariant(member.span(), member.builtin(), member.invariant());
    if (hasError()) [[unlikely]]
        return;

    AST::Visitor::visit(member);
}

void AttributeValidator::visit(AST::CompoundStatement& statement)
{
    for (auto& attribute : statement.attributes()) {
        if (parseDiagnostic(statement, attribute))
            continue;

        error(attribute.span(), "invalid attribute for compound statement"_s);
        return;
    }

    AST::Visitor::visit(statement);
}

void AttributeValidator::visit(AST::ForStatement& statement)
{
    for (auto& attribute : statement.attributes()) {
        if (parseDiagnostic(statement, attribute))
            continue;

        error(attribute.span(), "invalid attribute for `for` statement"_s);
        return;
    }

    AST::Visitor::visit(statement);
}

void AttributeValidator::visit(AST::WhileStatement& statement)
{
    for (auto& attribute : statement.attributes()) {
        if (parseDiagnostic(statement, attribute))
            continue;

        error(attribute.span(), "invalid attribute for compound statement"_s);
        return;
    }

    AST::Visitor::visit(statement);
}

void AttributeValidator::visit(AST::LoopStatement& statement)
{
    for (auto& attribute : statement.attributes()) {
        if (parseDiagnostic(statement, attribute))
            continue;

        error(attribute.span(), "invalid attribute for `loop` statement"_s);
        return;
    }

    for (auto& attribute : statement.bodyAttributes()) {
        if (parseDiagnostic(statement.bodyDiagnostics(), attribute))
            continue;

        error(attribute.span(), "invalid attribute for `loop` body"_s);
        return;
    }

    AST::Visitor::visit(statement);
}

void AttributeValidator::visit(AST::Continuing& continuing)
{
    for (auto& attribute : continuing.attributes) {
        if (parseDiagnostic(continuing, attribute))
            continue;

        error(attribute.span(), "invalid attribute for `continuing` body"_s);
        return;
    }

    AST::Visitor::visit(continuing);
}

void AttributeValidator::visit(AST::SwitchStatement& statement)
{
    for (auto& attribute : statement.attributes()) {
        if (parseDiagnostic(statement, attribute))
            continue;

        error(attribute.span(), "invalid attribute for `switch` statement"_s);
        return;
    }

    for (auto& attribute : statement.bodyAttributes()) {
        if (parseDiagnostic(statement.bodyDiagnostics(), attribute))
            continue;

        error(attribute.span(), "invalid attribute for `switch` body"_s);
        return;
    }

    AST::Visitor::visit(statement);
}

void AttributeValidator::visit(AST::IfStatement& statement)
{
    for (auto& attribute : statement.attributes()) {
        if (parseDiagnostic(statement, attribute))
            continue;

        error(attribute.span(), "invalid attribute for `if` statement"_s);
        return;
    }

    AST::Visitor::visit(statement);
}

bool AttributeValidator::parseBuiltin(AST::Function* function, std::optional<Builtin>& builtin, AST::Attribute& attribute)
{
    auto* builtinAttribute = dynamicDowncast<AST::BuiltinAttribute>(attribute);
    if (!builtinAttribute)
        return false;

    if (function && !function->stage()) [[unlikely]] {
        error(attribute.span(), "@builtin is not valid for non-entry point function types"_s);
        return true;
    }

    update(attribute.span(), builtin, builtinAttribute->builtin());
    return true;
}

bool AttributeValidator::parseInterpolate(std::optional<AST::Interpolation>& interpolation, AST::Attribute& attribute)
{
    auto* interpolateAttribute = dynamicDowncast<AST::InterpolateAttribute>(attribute);
    if (!interpolateAttribute)
        return false;

    update(attribute.span(), interpolation, interpolateAttribute->interpolation());
    return true;
}

bool AttributeValidator::parseInvariant(bool& invariant, AST::Attribute& attribute)
{
    if (!is<AST::InvariantAttribute>(attribute))
        return false;

    set(attribute.span(), invariant);
    return true;
}

bool AttributeValidator::parseLocation(AST::Function* function, std::optional<unsigned>& location, AST::Attribute& attribute, const Type* declarationType)
{
    auto* locationAttribute = dynamicDowncast<AST::LocationAttribute>(attribute);
    if (!locationAttribute)
        return false;
    if (function && !function->stage()) [[unlikely]] {
        error(attribute.span(), "@location is not valid for non-entry point function types"_s);
        return true;
    }

    if (function && *function->stage() == ShaderStage::Compute) [[unlikely]] {
        error(attribute.span(), "@location may not be used in the compute shader stage"_s);
        return true;
    }

    bool isNumeric = satisfies(declarationType, Constraints::Number);
    bool isNumericVector = false;
    if (!isNumeric) {
        if (auto* vectorType = std::get_if<Types::Vector>(declarationType))
            isNumericVector = satisfies(vectorType->element, Constraints::Number);
    }

    if (!isNumeric && !isNumericVector) [[unlikely]] {
        error(attribute.span(), "@location must only be applied to declarations of numeric scalar or numeric vector type"_s);
        return true;
    }

    auto& constantValue = locationAttribute->location().constantValue();
    // https://gpuweb.github.io/cts/standalone/?q=webgpu:shader,validation,parse,attribute:expressions:value=%22override%22;*
    if (!constantValue) [[unlikely]] {
        error(attribute.span(), "@location constant value is missing"_s);
        return true;
    }

    auto locationValue = constantValue->integerValue();
    if (locationValue < 0) [[unlikely]] {
        error(attribute.span(), "@location value must be non-negative"_s);
        return true;
    }

    update(attribute.span(), location, static_cast<unsigned>(locationValue));
    return true;
}

bool AttributeValidator::parseDiagnostic(AST::DiagnosticContainer& statement, AST::Attribute& attribute)
{
    auto* diagnosticAttribute = dynamicDowncast<AST::DiagnosticAttribute>(&attribute);
    if (!diagnosticAttribute)
        return false;

    auto& diagnostic = diagnosticAttribute->diagnostic();
    if (statement.severityFor(diagnostic.triggeringRule)) {
        error(attribute.span(), "duplicate @diagnostic attribute"_s);
        return true;
    }

    statement.setSeverityFor(diagnostic.triggeringRule, diagnostic.severity);
    return true;
}

void AttributeValidator::validateInterpolation(const SourceSpan& span, const std::optional<AST::Interpolation>& interpolation, const std::optional<unsigned>& location)
{
    if (interpolation && !location) [[unlikely]]
        error(span, "@interpolate is only allowed on declarations that have a @location attribute"_s);
    if (!interpolation)
        return;
    auto type = interpolation->type;
    auto sampling = interpolation->sampling;

    if (type == InterpolationType::Flat) {
        if (sampling != InterpolationSampling::First && sampling != InterpolationSampling::Either) [[unlikely]]
            error(span, "flat interpolation attribute must have a sampling parameter of `first` or `either`"_s);
    } else {
        if (sampling != InterpolationSampling::Center && sampling != InterpolationSampling::Centroid && sampling != InterpolationSampling::Sample) [[unlikely]]
            error(span, makeString(toString(type), " interpolation attribute must have a sampling parameter of `center`, `centroid` or `sample`"_s));
    }
}

void AttributeValidator::validateInvariant(const SourceSpan& span, const std::optional<Builtin>& builtin, bool invariant)
{
    if (invariant && (!builtin || *builtin != Builtin::Position)) [[unlikely]]
        error(span, "@invariant is only allowed on declarations that have a @builtin(position) attribute"_s);
}


template<typename T>
void AttributeValidator::update(const SourceSpan& span, std::optional<T>& destination, const T& source)
{
    if (destination.has_value()) [[unlikely]] {
        error(span, "duplicate attribute"_s);
        return;
    }

    destination = source;
}

void AttributeValidator::set(const SourceSpan& span, bool& destination)
{
    if (destination) [[unlikely]] {
        error(span, "duplicate attribute"_s);
        return;
    }

    destination = true;
}

template<typename... Arguments>
void AttributeValidator::error(const SourceSpan& span, Arguments&&... arguments)
{
    setError({ makeString(std::forward<Arguments>(arguments)...), span });
}

std::optional<FailedCheck> validateAttributes(ShaderModule& shaderModule)
{
    return AttributeValidator(shaderModule).validate();
}

} // namespace WGSL
