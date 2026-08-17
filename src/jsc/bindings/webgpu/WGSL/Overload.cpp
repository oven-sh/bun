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
#include "Overload.h"

#include "Types.h"
#include <wtf/DataLog.h>

namespace WGSL {

static constexpr bool shouldDumpOverloadDebugInformation = false;
static constexpr ASCIILiteral logPrefix = "> overload: "_s;

template<typename... Arguments>
inline void log(Arguments&&... arguments)
{
    if (shouldDumpOverloadDebugInformation)
        dataLog(logPrefix, std::forward<Arguments>(arguments)...);
}

template<typename... Arguments>
inline void logLn(Arguments&&... arguments)
{
    if (shouldDumpOverloadDebugInformation)
        dataLogLn(logPrefix, std::forward<Arguments>(arguments)...);
}

AbstractPointer::AbstractPointer(AbstractValue addressSpace, AbstractType element)
    : AbstractPointer(addressSpace, WTF::move(element), std::to_underlying(defaultAccessModeForAddressSpace(static_cast<AddressSpace>(std::get<unsigned>(addressSpace)))))
{
}

AbstractPointer::AbstractPointer(AbstractValue addressSpace, AbstractType element, AbstractValue accessMode)
    : addressSpace(addressSpace)
    , element(WTF::move(element))
    , accessMode(accessMode)
{
}

struct ViableOverload {
    const OverloadCandidate* candidate;
    FixedVector<unsigned> ranks;
    FixedVector<const Type*> parameters;
    const Type* result;
};

class OverloadResolver {
public:
    OverloadResolver(TypeStore&, const Vector<OverloadCandidate>&, const Vector<const Type*>& valueArguments, const Vector<const Type*>& typeArguments, unsigned numberOfTypeSubstitutions, unsigned numberOfValueSubstitutions);

    std::optional<SelectedOverload> resolve();

private:
    FixedVector<std::optional<ViableOverload>> considerCandidates();
    std::optional<ViableOverload> considerCandidate(const OverloadCandidate&);
    ConversionRank calculateRank(const AbstractType&, const Type*);
    ConversionRank conversionRank(const Type*, const Type*) const;

    bool unify(const TypeVariable*, const Type*);
    bool unify(const AbstractType&, const Type*);
    bool assign(TypeVariable, const Type*);
    const Type* NODELETE resolve(TypeVariable) const;
    const Type* materialize(const AbstractType&) const;

    bool unify(const AbstractValue&, unsigned);
    void assign(ValueVariable, unsigned);
    std::optional<unsigned> NODELETE resolve(ValueVariable) const;
    unsigned materialize(const AbstractValue&) const;

    TypeStore& m_types;
    const Vector<OverloadCandidate>& m_candidates;
    const Vector<const Type*>& m_valueArguments;
    const Vector<const Type*>& m_typeArguments;
    FixedVector<const Type*> m_typeSubstitutions;
    FixedVector<std::optional<unsigned>> m_valueSubstitutions;
};

OverloadResolver::OverloadResolver(TypeStore& types, const Vector<OverloadCandidate>& candidates, const Vector<const Type*>& valueArguments, const Vector<const Type*>& typeArguments, unsigned numberOfTypeSubstitutions, unsigned numberOfValueSubstitutions)
    : m_types(types)
    , m_candidates(candidates)
    , m_valueArguments(valueArguments)
    , m_typeArguments(typeArguments)
    , m_typeSubstitutions(numberOfTypeSubstitutions)
    , m_valueSubstitutions(numberOfValueSubstitutions)
{
}

std::optional<SelectedOverload> OverloadResolver::resolve()
{
    auto candidates = considerCandidates();
    std::optional<ViableOverload> selectedCandidate;

    for (auto& candidate : candidates) {
        if (!candidate.has_value())
            continue;

        if (!selectedCandidate.has_value()) {
            std::exchange(selectedCandidate, candidate);
            continue;
        }
        ASSERT(selectedCandidate->ranks.size() == candidate->ranks.size());

        bool isBetterOrEqual = true;
        bool hasStrictlyBetter = false;
        for (unsigned i = 0; i < candidate->ranks.size(); ++i) {
            if (candidate->ranks[i] > selectedCandidate->ranks[i]) {
                isBetterOrEqual = false;
                break;
            }
            if (candidate->ranks[i] < selectedCandidate->ranks[i])
                hasStrictlyBetter = true;
        }
        if (isBetterOrEqual && hasStrictlyBetter)
            std::exchange(selectedCandidate, candidate);
    }

    if (!selectedCandidate.has_value()) {
        logLn("no suitable overload found");
        return std::nullopt;
    }

    logLn("selected overload: ", *selectedCandidate->candidate);
    logLn("materialized result type: ", *selectedCandidate->result);

    return { { WTF::move(selectedCandidate->parameters), selectedCandidate->result } };
}

const Type* OverloadResolver::materialize(const AbstractType& abstractType) const
{
    return WTF::switchOn(*abstractType,
        [&](const Type* type) -> const Type* {
            return type;
        },
        [&](TypeVariable variable) -> const Type* {
            const Type* type = resolve(variable);
            if (!type)
                return nullptr;
            type = satisfyOrPromote(type, variable.constraints, m_types);
            RELEASE_ASSERT(type);
            return type;
        },
        [&](const AbstractVector& vector) -> const Type* {
            if (auto* element = materialize(vector.element)) {
                auto size = materialize(vector.size);
                return m_types.vectorType(size, element);
            }
            return nullptr;
        },
        [&](const AbstractMatrix& matrix) -> const Type* {
            if (auto* element = materialize(matrix.element)) {
                auto columns = materialize(matrix.columns);
                auto rows = materialize(matrix.rows);
                return m_types.matrixType(columns, rows, element);
            }
            return nullptr;
        },
        [&](const AbstractTexture& texture) -> const Type* {
            if (auto* element = materialize(texture.element))
                return m_types.textureType(texture.kind, element);
            return nullptr;
        },
        [&](const AbstractTextureStorage& texture) -> const Type* {
            auto format = materialize(texture.format);
            auto access = materialize(texture.access);
            return m_types.textureStorageType(texture.kind, static_cast<TexelFormat>(format), static_cast<AccessMode>(access));
        },
        [&](const AbstractChannelFormat& channelFormat) -> const Type* {
            auto format = materialize(channelFormat.format);
            return shaderTypeForTexelFormat(static_cast<TexelFormat>(format), m_types);
        },
        [&](const AbstractReference& reference) -> const Type* {
            if (auto* element = materialize(reference.element)) {
                auto addressSpace = materialize(reference.addressSpace);
                auto accessMode = materialize(reference.accessMode);
                return m_types.referenceType(static_cast<AddressSpace>(addressSpace), element, static_cast<AccessMode>(accessMode));
            }
            return nullptr;
        },
        [&](const AbstractPointer& pointer) -> const Type* {
            if (auto* element = materialize(pointer.element)) {
                auto addressSpace = materialize(pointer.addressSpace);
                auto accessMode = materialize(pointer.accessMode);
                return m_types.pointerType(static_cast<AddressSpace>(addressSpace), element, static_cast<AccessMode>(accessMode));
            }
            return nullptr;
        },
        [&](const AbstractArray& array) -> const Type* {
            if (auto* element = materialize(array.element))
                return m_types.arrayType(element, std::monostate { });
            return nullptr;
        },
        [&](const AbstractAtomic& atomic) -> const Type* {
            if (auto* element = materialize(atomic.element))
                return m_types.atomicType(element);
            return nullptr;
        });
}

unsigned OverloadResolver::materialize(const AbstractValue& abstractValue) const
{
    return WTF::switchOn(abstractValue,
        [&](unsigned value) -> unsigned {
            return value;
        },
        [&](ValueVariable variable) -> unsigned {
            std::optional<unsigned> resolvedValue = resolve(variable);
            ASSERT(resolvedValue.has_value());
            return *resolvedValue;
        });
}

FixedVector<std::optional<ViableOverload>> OverloadResolver::considerCandidates()
{
    FixedVector<std::optional<ViableOverload>> candidates(m_candidates.size());
    for (unsigned i = 0; i < m_candidates.size(); ++i)
        candidates[i] = considerCandidate(m_candidates[i]);
    return candidates;
}

std::optional<ViableOverload> OverloadResolver::considerCandidate(const OverloadCandidate& candidate)
{
    if (candidate.parameters.size() != m_valueArguments.size())
        return std::nullopt;

    if (m_typeArguments.size() > candidate.typeVariables.size())
        return std::nullopt;

    m_typeSubstitutions.fill(nullptr);
    m_valueSubstitutions.fill(std::nullopt);

    for (unsigned i = 0; i < m_typeArguments.size(); ++i) {
        if (!assign(candidate.typeVariables[i], m_typeArguments[i]))
            return std::nullopt;
    }

    logLn("Considering overload: ", candidate);

    ViableOverload viableOverload {
        &candidate,
        FixedVector<unsigned>(m_valueArguments.size()),
        FixedVector<const Type*>(m_valueArguments.size()),
        nullptr
    };
    for (unsigned i = 0; i < m_valueArguments.size(); ++i) {
        auto& parameter = candidate.parameters[i];
        auto* argument = m_valueArguments[i];
        logLn("matching parameter #", i, " '", parameter, "' with argument '", *argument, "'");
        if (!unify(parameter, argument)) {
            logLn("rejected on parameter #", i);
            return std::nullopt;
        }
    }
    for (unsigned i = 0; i < m_valueArguments.size(); ++i) {
        auto& parameter = candidate.parameters[i];
        auto* argument = m_valueArguments[i];
        auto rank = calculateRank(parameter, argument);
        ASSERT(!!rank);
        viableOverload.ranks[i] = *rank;
        viableOverload.parameters[i] = materialize(parameter);
    }

    viableOverload.result = materialize(candidate.result);
    if (!viableOverload.result)
        return std::nullopt;

    if (shouldDumpOverloadDebugInformation) {
        log("found a viable candidate '", candidate, "' materialized as '(");
        bool first = true;
        for (auto& parameter : candidate.parameters) {
            if (!first)
                dataLog(", ");
            first = false;
            dataLog(*materialize(parameter));
        }
        dataLog(") -> ", *viableOverload.result, "'");
        dataLogLn();
    }


    return { WTF::move(viableOverload) };
}

ConversionRank OverloadResolver::calculateRank(const AbstractType& parameter, const Type* argumentType)
{
    if (auto* variable = std::get_if<TypeVariable>(parameter.get())) {
        auto* resolvedType = resolve(*variable);
        ASSERT(resolvedType);
        if (variable->constraints) {
            resolvedType = satisfyOrPromote(resolvedType, variable->constraints, m_types);
            RELEASE_ASSERT(resolvedType);
        }
        return conversionRank(argumentType, resolvedType);
    }

    if (auto* referenceParameter = std::get_if<AbstractReference>(parameter.get())) {
        auto& referenceArgument = std::get<Types::Reference>(*argumentType);
        return calculateRank(referenceParameter->element, referenceArgument.element);
    }

    if (auto* pointerParameter = std::get_if<AbstractPointer>(parameter.get())) {
        auto& pointerArgument = std::get<Types::Pointer>(*argumentType);
        return calculateRank(pointerParameter->element, pointerArgument.element);
    }

    if (auto* reference = std::get_if<Types::Reference>(argumentType)) {
        ASSERT(reference->accessMode != AccessMode::Write);
        return calculateRank(parameter, reference->element);
    }

    if (auto* vectorParameter = std::get_if<AbstractVector>(parameter.get())) {
        auto& vectorArgument = std::get<Types::Vector>(*argumentType);
        return calculateRank(vectorParameter->element, vectorArgument.element);
    }

    if (auto* matrixParameter = std::get_if<AbstractMatrix>(parameter.get())) {
        auto& matrixArgument = std::get<Types::Matrix>(*argumentType);
        return calculateRank(matrixParameter->element, matrixArgument.element);
    }

    if (auto* textureParameter = std::get_if<AbstractTexture>(parameter.get())) {
        auto& textureArgument = std::get<Types::Texture>(*argumentType);
        return calculateRank(textureParameter->element, textureArgument.element);
    }

    if (auto* arrayParameter = std::get_if<AbstractArray>(parameter.get())) {
        auto& arrayArgument = std::get<Types::Array>(*argumentType);
        return calculateRank(arrayParameter->element, arrayArgument.element);
    }

    if (auto* atomicParameter = std::get_if<AbstractAtomic>(parameter.get())) {
        auto& atomicArgument = std::get<Types::Atomic>(*argumentType);
        return calculateRank(atomicParameter->element, atomicArgument.element);
    }

    if (std::holds_alternative<AbstractTextureStorage>(*parameter.get()))
        return 0;

    if (auto* channelFormat = std::get_if<AbstractChannelFormat>(parameter.get())) {
        auto format = materialize(channelFormat->format);
        return conversionRank(argumentType, shaderTypeForTexelFormat(static_cast<TexelFormat>(format), m_types));
    }

    auto* parameterType = std::get<const Type*>(*parameter);
    return conversionRank(argumentType, parameterType);
}

bool OverloadResolver::unify(const TypeVariable* variable, const Type* argumentType)
{
    auto* resolvedType = resolve(*variable);
    if (!resolvedType)
        return assign(*variable, argumentType);

    logLn("resolved '", *variable, "' to '", *resolvedType, "'");

    // Consider the following:
    // + :: (T, T) -> T
    // 1 + 1u
    //
    // We first unify `Var(T)` with `Type(AbstractInt)`, and assign `T` to `AbstractInt`
    // Next, we unify `Var(T) with `Type(u32)`, we look up `T => AbstractInt`,
    //   and promote `T` to `u32`.
    //
    // A few more examples to illustrate it:
    //
    // vec3 :: (T, T, T) -> T
    // vec3(1, 1.0, 1.0f) -> vec3<f32>
    // 1) unify(Var(T), Type(AbstractInt); T => AbstractInt (assign)
    // 2) unify(Var(T), Type(AbstractFloat); T => AbstractFloat (promote T)
    // 3) unify(Var(T), Type(f32); T => f32 (promote T again)
    //
    // vec3 :: (T, T, T) -> T
    // vec3(1.0, 1, 1.0f) -> vec3<f32>
    // 1) unify(Var(T), Type(AbstractFloat); T => AbstractFloat (assign)
    // 2) unify(Var(T), Type(AbstractInt); T => AbstractFloat (convert the argument to AbstractInt)
    // 3) unify(Var(T), Type(f32); T => f32 (promote T)
    //
    // vec3 :: (T, T, T) -> T
    // vec3(1.0, 1u, 1.0f) -> vec3<f32>
    // 1) unify(Var(T), Type(AbstractInt); T => AbstractFloat (assign)
    // 2) unify(Var(T), Type(u32); Failed! Can't unify AbstractFloat and u32
    auto variablePromotionRank = conversionRank(resolvedType, argumentType);
    auto argumentConversionRank = conversionRank(argumentType, resolvedType);
    logLn("variablePromotionRank: ", variablePromotionRank.unsafeValue(), ", argumentConversionRank: ", argumentConversionRank.unsafeValue());
    if (variablePromotionRank.unsafeValue() < argumentConversionRank.unsafeValue())
        return assign(*variable, argumentType);

    return !!argumentConversionRank;
}

bool OverloadResolver::unify(const AbstractType& parameter, const Type* argumentType)
{
    logLn("unify parameter type '", parameter, "' with argument '", *argumentType, "'");
    if (auto* variable = std::get_if<TypeVariable>(parameter.get()))
        return unify(variable, argumentType);

    if (auto* referenceParameter = std::get_if<AbstractReference>(parameter.get())) {
        auto* referenceArgument = std::get_if<Types::Reference>(argumentType);
        if (!referenceArgument)
            return false;
        if (!unify(referenceParameter->addressSpace, std::to_underlying(referenceArgument->addressSpace)))
            return false;
        if (!unify(referenceParameter->accessMode, std::to_underlying(referenceArgument->accessMode)))
            return false;
        return unify(referenceParameter->element, referenceArgument->element);
    }

    if (auto* pointerParameter = std::get_if<AbstractPointer>(parameter.get())) {
        auto* pointerArgument = std::get_if<Types::Pointer>(argumentType);
        if (!pointerArgument)
            return false;
        if (!unify(pointerParameter->addressSpace, std::to_underlying(pointerArgument->addressSpace)))
            return false;
        if (!unify(pointerParameter->accessMode, std::to_underlying(pointerArgument->accessMode)))
            return false;
        return unify(pointerParameter->element, pointerArgument->element);
    }

    if (auto* reference = std::get_if<Types::Reference>(argumentType)) {
        if (reference->accessMode == AccessMode::Write)
            return false;
        return unify(parameter, reference->element);
    }

    if (auto* vectorParameter = std::get_if<AbstractVector>(parameter.get())) {
        auto* vectorArgument = std::get_if<Types::Vector>(argumentType);
        if (!vectorArgument)
            return false;
        if (!unify(vectorParameter->element, vectorArgument->element))
            return false;
        return unify(vectorParameter->size, vectorArgument->size);
    }

    if (auto* matrixParameter = std::get_if<AbstractMatrix>(parameter.get())) {
        auto* matrixArgument = std::get_if<Types::Matrix>(argumentType);
        if (!matrixArgument)
            return false;
        if (!unify(matrixParameter->element, matrixArgument->element))
            return false;
        if (!unify(matrixParameter->columns, matrixArgument->columns))
            return false;
        return unify(matrixParameter->rows, matrixArgument->rows);
    }

    if (auto* textureParameter = std::get_if<AbstractTexture>(parameter.get())) {
        auto* textureArgument = std::get_if<Types::Texture>(argumentType);
        if (!textureArgument)
            return false;
        if (textureParameter->kind != textureArgument->kind)
            return false;
        return unify(textureParameter->element, textureArgument->element);
    }

    if (auto* textureStorageParameter = std::get_if<AbstractTextureStorage>(parameter.get())) {
        auto* textureStorageArgument = std::get_if<Types::TextureStorage>(argumentType);
        if (!textureStorageArgument)
            return false;
        if (textureStorageParameter->kind != textureStorageArgument->kind)
            return false;
        if (!unify(textureStorageParameter->format, std::to_underlying(textureStorageArgument->format)))
            return false;
        return unify(textureStorageParameter->access, std::to_underlying(textureStorageArgument->access));
    }

    if (auto* channelFormat = std::get_if<AbstractChannelFormat>(parameter.get())) {
        auto format = materialize(channelFormat->format);
        return !!conversionRank(argumentType, shaderTypeForTexelFormat(static_cast<TexelFormat>(format), m_types));
    }

    if (auto* arrayParameter = std::get_if<AbstractArray>(parameter.get())) {
        auto* arrayArgument = std::get_if<Types::Array>(argumentType);
        if (!arrayArgument)
            return false;
        // For now, we only support dynamic arrays
        if (!arrayArgument->isRuntimeSized())
            return false;
        return unify(arrayParameter->element, arrayArgument->element);
    }

    if (auto* atomicParameter = std::get_if<AbstractAtomic>(parameter.get())) {
        auto* atomicArgument = std::get_if<Types::Atomic>(argumentType);
        if (!atomicArgument)
            return false;
        return unify(atomicParameter->element, atomicArgument->element);
    }

    auto* parameterType = std::get<const Type*>(*parameter);
    return !!conversionRank(argumentType, parameterType);
}

bool OverloadResolver::unify(const AbstractValue& parameter, unsigned argumentValue)
{
    if (auto* parameterValue = std::get_if<unsigned>(&parameter))
        return *parameterValue == argumentValue;

    auto variable = std::get<ValueVariable>(parameter);
    auto resolvedValue = resolve(variable);
    if (!resolvedValue.has_value()) {
        assign(variable, argumentValue);
        return true;
    }
    return *resolvedValue == argumentValue;
}

bool OverloadResolver::assign(TypeVariable variable, const Type* type)
{
    logLn("assign ", variable, " => ", *type);
    if (variable.constraints) {
        if (!satisfies(type, variable.constraints))
            return false;
    }
    m_typeSubstitutions[variable.id] = type;
    return true;
}

void OverloadResolver::assign(ValueVariable variable, unsigned value)
{
    logLn("assign ", variable, " => ", value);
    m_valueSubstitutions[variable.id] = { value };
}

const Type* OverloadResolver::resolve(TypeVariable variable) const
{
    return m_typeSubstitutions[variable.id];
}

std::optional<unsigned> OverloadResolver::resolve(ValueVariable variable) const
{
    return m_valueSubstitutions[variable.id];
}

ConversionRank OverloadResolver::conversionRank(const Type* from, const Type* to) const
{
    auto rank = ::WGSL::conversionRank(from, to);
    logLn("conversionRank(from: ", *from, ", to: ", *to, ") = ", rank.unsafeValue());
    return rank;
}

std::optional<SelectedOverload> resolveOverloads(TypeStore& types, const Vector<OverloadCandidate>& candidates, const Vector<const Type*>& valueArguments, const Vector<const Type*>& typeArguments)
{

    unsigned numberOfTypeSubstitutions = 0;
    unsigned numberOfValueSubstitutions = 0;
    for (const auto& candidate : candidates) {
        numberOfTypeSubstitutions = std::max(numberOfTypeSubstitutions, static_cast<unsigned>(candidate.typeVariables.size()));
        numberOfValueSubstitutions = std::max(numberOfValueSubstitutions, static_cast<unsigned>(candidate.valueVariables.size()));
    }
    OverloadResolver resolver(types, candidates, valueArguments, typeArguments, numberOfTypeSubstitutions, numberOfValueSubstitutions);
    return resolver.resolve();
}

} // namespace WGSL

namespace WTF {

void printInternal(PrintStream& out, const WGSL::ValueVariable& variable)
{
    out.print("val", variable.id);
}

void printInternal(PrintStream& out, const WGSL::AbstractValue& value)
{
    WTF::switchOn(value,
        [&](unsigned value) {
            out.print(value);
        },
        [&](WGSL::ValueVariable variable) {
            printInternal(out, variable);
        });
}

void printInternal(PrintStream& out, const WGSL::TypeVariable& variable)
{
    out.print("type", variable.id);
}

void printInternal(PrintStream& out, const WGSL::AbstractType& type)
{
    WTF::switchOn(*type,
        [&](const WGSL::Type* type) {
            printInternal(out, *type);
        },
        [&](WGSL::TypeVariable variable) {
            printInternal(out, variable);
        },
        [&](const WGSL::AbstractVector& vector) {
            out.print("vector<");
            printInternal(out, vector.element);
            out.print(", ");
            printInternal(out, vector.size);
            out.print(">");
        },
        [&](const WGSL::AbstractMatrix& matrix) {
            out.print("matrix<");
            printInternal(out, matrix.element);
            out.print(", ");
            printInternal(out, matrix.columns);
            out.print(", ");
            printInternal(out, matrix.rows);
            out.print(">");
        },
        [&](const WGSL::AbstractTexture& texture) {
            printInternal(out, texture.kind);
            out.print("<");
            printInternal(out, texture.element);
            out.print(">");
        },
        [&](const WGSL::AbstractTextureStorage& texture) {
            printInternal(out, texture.kind);
            out.print("<");
            printInternal(out, texture.format);
            out.print(", ");
            printInternal(out, texture.access);
            out.print(">");
        },
        [&](const WGSL::AbstractChannelFormat& channelFormat) {
            out.print("ChannelFormat<", channelFormat.format, ">");
        },
        [&](const WGSL::AbstractReference& reference) {
            out.print("ref<");
            printInternal(out, reference.addressSpace);
            out.print(", ");
            printInternal(out, reference.element);
            out.print(", ");
            printInternal(out, reference.accessMode);
            out.print(">");
        },
        [&](const WGSL::AbstractPointer& pointer) {
            out.print("ptr<");
            printInternal(out, pointer.addressSpace);
            out.print(", ");
            printInternal(out, pointer.element);
            out.print(", ");
            printInternal(out, pointer.accessMode);
            out.print(">");
        },
        [&](const WGSL::AbstractArray& array) {
            out.print("array<");
            printInternal(out, array.element);
            out.print(">");
        },
        [&](const WGSL::AbstractAtomic& atomic) {
            out.print("atomic<");
            printInternal(out, atomic.element);
            out.print(">");
        });
}

void printInternal(PrintStream& out, const WGSL::OverloadCandidate& candidate)
{
    if (candidate.typeVariables.size() || candidate.valueVariables.size()) {
        bool first = true;
        out.print("<");
        for (auto& typeVariable : candidate.typeVariables) {
            if (!first)
                out.print(", ");
            first = false;
            printInternal(out, typeVariable);
        }
        for (auto& valueVariable : candidate.valueVariables) {
            if (!first)
                out.print(", ");
            first = false;
            printInternal(out, valueVariable);
        }
        out.print(">");
    }
    out.print("(");
    bool first = true;
    for (auto& parameter : candidate.parameters) {
        if (!first)
            out.print(", ");
        first = false;
        printInternal(out, parameter);
    }
    out.print(") -> ");
    printInternal(out, candidate.result);
}

void printInternal(PrintStream& out, WGSL::Types::Texture::Kind textureKind)
{
    switch (textureKind) {
    case WGSL::Types::Texture::Kind::Texture1d:
        out.print("texture_1d");
        return;
    case WGSL::Types::Texture::Kind::Texture2d:
        out.print("texture_2d");
        return;
    case WGSL::Types::Texture::Kind::Texture2dArray:
        out.print("texture_2d_array");
        return;
    case WGSL::Types::Texture::Kind::Texture3d:
        out.print("texture_3d");
        return;
    case WGSL::Types::Texture::Kind::TextureCube:
        out.print("texture_cube");
        return;
    case WGSL::Types::Texture::Kind::TextureCubeArray:
        out.print("texture_cube_array");
        return;
    case WGSL::Types::Texture::Kind::TextureMultisampled2d:
        out.print("texture_multisampled_2d");
        return;
    }
}

void printInternal(PrintStream& out, WGSL::Types::TextureStorage::Kind textureKind)
{
    switch (textureKind) {
    case WGSL::Types::TextureStorage::Kind::TextureStorage1d:
        out.print("texture_storage_1d");
        return;
    case WGSL::Types::TextureStorage::Kind::TextureStorage2d:
        out.print("texture_storage_2d");
        return;
    case WGSL::Types::TextureStorage::Kind::TextureStorage2dArray:
        out.print("texture_storage_2d_array");
        return;
    case WGSL::Types::TextureStorage::Kind::TextureStorage3d:
        out.print("texture_storage_3d");
        return;
    }
}


} // namespace WTF
