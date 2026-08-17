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

#include "ASTBuilder.h"
#include "ASTDeclaration.h"
#include "ASTDiagnostic.h"
#include "ASTDirective.h"
#include "ASTIdentityExpression.h"
#include "CallGraph.h"
#include "Overload.h"
#include "TypeStore.h"
#include "WGSL.h"
#include "WGSLEnums.h"

#include <wtf/HashSet.h>
#include <wtf/OptionSet.h>
#include <wtf/text/StringHash.h>
#include <wtf/text/WTFString.h>

namespace WGSL {

class ShaderModule : public AST::DiagnosticContainer {
    WTF_MAKE_TZONE_ALLOCATED(ShaderModule);
public:
    explicit ShaderModule(const String& source)
        : ShaderModule(source, { })
    { }
    
    ShaderModule(const String& source, const Configuration& configuration)
        : m_source(source)
        , m_configuration(configuration)
    {
        initializeOverloads();
    }

    const String& source() const LIFETIME_BOUND { return m_source; }
    const Configuration& configuration() const LIFETIME_BOUND { return m_configuration; }
    AST::Declaration::List& declarations() LIFETIME_BOUND { return m_declarations; }
    const AST::Declaration::List& declarations() const LIFETIME_BOUND { return m_declarations; }
    AST::Directive::List& directives() LIFETIME_BOUND { return m_directives; }
    TypeStore& types() LIFETIME_BOUND { return m_types; }
    AST::Builder& astBuilder() LIFETIME_BOUND { return m_astBuilder; }

    const CallGraph& callGraph() const { return *m_callGraph; }
    void setCallGraph(CallGraph&& callGraph)
    {
        m_callGraph = WTF::move(callGraph);
    }

    bool usesExternalTextures() const { return m_usesExternalTextures; }
    void setUsesExternalTextures() { m_usesExternalTextures = true; }
    void clearUsesExternalTextures() { m_usesExternalTextures = false; }

    bool usesPackArray() const { return m_usesPackArray; }
    void setUsesPackArray() { m_usesPackArray = true; }
    void clearUsesPackArray() { m_usesPackArray = false; }

    bool usesUnpackArray() const { return m_usesUnpackArray; }
    void setUsesUnpackArray() { m_usesUnpackArray = true; }
    void clearUsesUnpackArray() { m_usesUnpackArray = false; }

    bool usesPackVector() const { return m_usesPackVector; }
    void setUsesPackVector() { m_usesPackVector = true; }
    void clearUsesPackVector() { m_usesPackVector = false; }

    bool usesUnpackVector() const { return m_usesUnpackVector; }
    void setUsesUnpackVector() { m_usesUnpackVector = true; }
    void clearUsesUnpackVector() { m_usesUnpackVector = false; }

    bool usesWorkgroupUniformLoad() const { return m_usesWorkgroupUniformLoad; }
    void setUsesWorkgroupUniformLoad() { m_usesWorkgroupUniformLoad = true; }

    bool usesWorkgroupUniformLoadAtomic() const { return m_usesWorkgroupUniformLoadAtomic; }
    void setUsesWorkgroupUniformLoadAtomic() { m_usesWorkgroupUniformLoadAtomic = true; }

    bool usesDivision() const { return m_usesDivision; }
    void setUsesDivision() { m_usesDivision = true; }

    bool usesModulo() const { return m_usesModulo; }
    void setUsesModulo() { m_usesModulo = true; }

    bool usesFrexp() const { return m_usesFrexp; }
    void setUsesFrexp() { m_usesFrexp = true; }

    bool usesModf() const { return m_usesModf; }
    void setUsesModf() { m_usesModf = true; }

    bool usesAtomicCompareExchange() const { return m_usesAtomicCompareExchange; }
    void setUsesAtomicCompareExchange() { m_usesAtomicCompareExchange = true; }

    bool usesFragDepth() const { return m_usesFragDepth; }
    void setUsesFragDepth() { m_usesFragDepth = true; }

    bool usesDot() const { return m_usesDot; }
    void setUsesDot() { m_usesDot = true; }

    bool usesFirstLeadingBit() const { return m_usesFirstLeadingBit; }
    void setUsesFirstLeadingBit() { m_usesFirstLeadingBit = true; }

    bool usesFirstTrailingBit() const { return m_usesFirstTrailingBit; }
    void setUsesFirstTrailingBit() { m_usesFirstTrailingBit = true; }

    bool usesSign() const { return m_usesSign; }
    void setUsesSign() { m_usesSign = true; }

    bool usesSampleMask() const { return m_usesSampleMask; }
    void setUsesSampleMask() { m_usesSampleMask = true; }

    bool usesFrontFacing() const { return m_usesFrontFacing; }
    void setUsesFrontFacing() { m_usesFrontFacing = true; }

    bool usesSampleIndex() const { return m_usesSampleIndex; }
    void setUsesSampleIndex() { m_usesSampleIndex = true; }

    bool usesDot4I8Packed() const { return m_usesDot4I8Packed; }
    void setUsesDot4I8Packed() { m_usesDot4I8Packed = true; }

    bool usesDot4U8Packed() const { return m_usesDot4U8Packed; }
    void setUsesDot4U8Packed() { m_usesDot4U8Packed = true; }

    bool usesExtractBits() const { return m_usesExtractBits; }
    void setUsesExtractBits() { m_usesExtractBits = true; }

    bool usesPackedVec3() const { return m_usesPackedVec3; }
    void setUsesPackedVec3() { m_usesPackedVec3 = true; }
    void clearUsesPackedVec3() { m_usesPackedVec3 = false; }

    bool usesMin() const { return m_usesMin; }
    void setUsesMin() { m_usesMin = true; }

    bool usesFtoi() const { return m_usesFtoi; }
    void setUsesFtoi() { m_usesFtoi = true; }

    bool usesInsertBits() const { return m_usesInsertBits; }
    void setUsesInsertBits() { m_usesInsertBits = true; }

    bool usesZeroWorkgroupVar() const { return m_usesZeroWorkgroupVar; }
    void setUsesZeroWorkgroupVar() { m_usesZeroWorkgroupVar = true; }

    template<typename T>
    std::enable_if_t<std::is_base_of_v<AST::Node, T>, void> replace(T* current, T&& replacement)
    {
        RELEASE_ASSERT(current->kind() == replacement.kind());
        std::swap(*current, replacement);
        m_replacements.append([current, replacement = std::forward<T>(replacement)]() mutable {
            std::exchange(*current, WTF::move(replacement));
        });
    }

    template<typename T>
    std::enable_if_t<std::is_fundamental_v<T> || std::is_enum_v<T>, void> replace(T* current, T&& replacement)
    {
        std::swap(*current, replacement);
        m_replacements.append([current, replacement = WTF::move(replacement)]() mutable {
            std::exchange(*current, WTF::move(replacement));
        });
    }

    template<typename CurrentType, typename ReplacementType>
    std::enable_if_t<sizeof(CurrentType) < sizeof(ReplacementType) || std::is_same_v<ReplacementType, AST::Expression>, void> replace(CurrentType& current, ReplacementType& replacement)
    {
        m_replacements.append([&current, currentCopy = current]() mutable {
            std::bit_cast<AST::IdentityExpression*>(&current)->~IdentityExpression();
            new (std::bit_cast<void*>(&current)) CurrentType(WTF::move(currentCopy));
        });

        current.~CurrentType();
        new (std::bit_cast<void*>(&current)) AST::IdentityExpression(replacement.span(), replacement);
    }

    template<typename CurrentType, typename ReplacementType>
    std::enable_if_t<sizeof(CurrentType) >= sizeof(ReplacementType) && !std::is_same_v<ReplacementType, AST::Expression>, void> replace(CurrentType& current, ReplacementType& replacement)
    {
        m_replacements.append([&current, currentCopy = current]() mutable {
            std::bit_cast<ReplacementType*>(&current)->~ReplacementType();
            new (std::bit_cast<void*>(&current)) CurrentType(WTF::move(currentCopy));
        });

        current.~CurrentType();
        new (std::bit_cast<void*>(&current)) ReplacementType(replacement);
    }

    template<typename T, size_t size>
    T takeLast(const Vector<T, size>& constVector)
    {
        auto& vector = const_cast<Vector<T, size>&>(constVector);
        auto last = vector.takeLast();
        m_replacements.append([&vector, last]() mutable {
            vector.append(WTF::move(last));
        });
        return last;
    }

    template<typename T, typename U, size_t size>
    void append(const Vector<U, size>& constVector, T&& value)
    {
        auto& vector = const_cast<Vector<U, size>&>(constVector);
        vector.append(std::forward<T>(value));
        m_replacements.append([&vector]() {
            vector.takeLast();
        });
    }

    template<typename T, size_t size>
    void insert(const Vector<T, size>& constVector, size_t position, T&& value)
    {
        auto& vector = const_cast<Vector<T, size>&>(constVector);
        vector.insert(position, std::forward<T>(value));
        m_replacements.append([&vector, position]() {
            vector.removeAt(position);
        });
    }

    template<typename T, size_t size, typename T2, size_t size2>
    void insertVector(const Vector<T, size>& constVector, size_t position, const Vector<T2, size2>& value)
    {
        auto& vector = const_cast<Vector<T, size>&>(constVector);
        vector.insertVector(position, value);
        m_replacements.append([&vector, position, length = value.size()]() {
            vector.removeAt(position, length);
        });
    }

    template<typename T, size_t size>
    void remove(const Vector<T, size>& constVector, size_t position)
    {
        auto& vector = const_cast<Vector<T, size>&>(constVector);
        auto entry = vector[position];
        m_replacements.append([&vector, position, entry]() mutable {
            vector.insert(position, entry);
        });
        vector.removeAt(position);
    }

    template<typename T, size_t size>
    void clear(const Vector<T, size>& constVector)
    {
        auto& vector = const_cast<Vector<T, size>&>(constVector);
        m_replacements.append([&vector, contents = WTF::move(vector)]() mutable {
            vector = contents;
        });
        vector.clear();
    }

    size_t currentReplacementSize() const
    {
        return m_replacements.size();
    }

    void revertReplacements(size_t limit)
    {
        if (m_replacements.size() == limit)
            return;
        for (size_t i = m_replacements.size() - 1; i >= limit; --i)
            m_replacements[i]();
        m_replacements.shrinkCapacity(limit);
    }

    OptionSet<Extension>& enabledExtensions() LIFETIME_BOUND { return m_enabledExtensions; }
    OptionSet<LanguageFeature>& requiredFeatures() LIFETIME_BOUND { return m_requiredFeatures; }
    bool containsOverrideID(uint32_t idValue) const
    {
        return m_pipelineOverrideIds.contains(idValue);
    }
    void addOverrideID(uint32_t idValue)
    {
        m_pipelineOverrideIds.add(idValue);
    }
    bool hasFeature(const String& featureName) const { return m_configuration.supportedFeatures.contains(featureName); }

    template<typename Validator>
    void addOverrideValidation(Validator&& validator)
    {
        m_overrideValidations.append(WTF::move(validator));
    }

    std::optional<Error> validateOverrides(const PrepareResult&, HashMap<String, ConstantValue>&);

    const OverloadedDeclaration* lookupOverload(const String&) const;

    void addOverride(AST::Variable& variable) { m_overrides.append(&variable); }
    bool containsOverride(const String& key) const;

    Result<ConstantValue> ensureOverrideValue(const AST::Expression&, const HashMap<String, ConstantValue>&) const;

private:
    void initializeOverloads();

    String m_source;
    bool m_usesExternalTextures { false };
    bool m_usesPackArray { false };
    bool m_usesUnpackArray { false };
    bool m_usesPackVector { false };
    bool m_usesUnpackVector { false };
    bool m_usesWorkgroupUniformLoad { false };
    bool m_usesWorkgroupUniformLoadAtomic { false };
    bool m_usesDivision { false };
    bool m_usesModulo { false };
    bool m_usesFrexp { false };
    bool m_usesModf { false };
    bool m_usesAtomicCompareExchange { false };
    bool m_usesFragDepth { false };
    bool m_usesDot { false };
    bool m_usesFirstLeadingBit { false };
    bool m_usesFirstTrailingBit { false };
    bool m_usesSign { false };
    bool m_usesSampleMask { false };
    bool m_usesFrontFacing { false };
    bool m_usesSampleIndex { false };
    bool m_usesDot4I8Packed { false };
    bool m_usesDot4U8Packed { false };
    bool m_usesExtractBits { false };
    bool m_usesPackedVec3 { false };
    bool m_usesMin { false };
    bool m_usesFtoi { false };
    bool m_usesInsertBits { false };
    bool m_usesZeroWorkgroupVar { false };
    OptionSet<Extension> m_enabledExtensions;
    OptionSet<LanguageFeature> m_requiredFeatures;
    Configuration m_configuration;
    AST::Declaration::List m_declarations;
    AST::Directive::List m_directives;
    TypeStore m_types;
    AST::Builder m_astBuilder;
    std::optional<CallGraph> m_callGraph;
    Vector<std::function<void()>> m_replacements;
    HashSet<uint32_t, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> m_pipelineOverrideIds;
    Vector<Function<std::optional<Error>(const HashMap<String, ConstantValue>&)>> m_overrideValidations;
    HashMap<String, OverloadedDeclaration> m_overloadedOperations;
    Vector<AST::Variable*> m_overrides;
};

} // namespace WGSL
