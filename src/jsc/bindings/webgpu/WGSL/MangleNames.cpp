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
#include "MangleNames.h"

#include "AST.h"
#include "ASTScopedVisitorInlines.h"
#include "CallGraph.h"
#include "ContextProviderInlines.h"
#include "WGSL.h"
#include "WGSLShaderModule.h"
#include <wtf/HashSet.h>
#include <wtf/text/MakeString.h>

namespace WGSL {

struct MangledName {
    enum Kind : uint8_t {
        Type,
        Local,
        Global,
        Parameter,
        Function,
        Field,
    };
    static constexpr unsigned numberOfKinds = 6;

    Kind kind;
    uint32_t index;
    String originalName;

    String toString() const
    {
        static const auto prefixes = WTF::toArray<ASCIILiteral>({
            "type"_s,
            "local"_s,
            "global"_s,
            "parameter"_s,
            "function"_s,
            "field"_s,
        });
        return makeString(prefixes[std::to_underlying(kind)], String::number(index));
    }
};

class NameManglerVisitor : public AST::ScopedVisitor<MangledName> {
    using Base = AST::ScopedVisitor<MangledName>;
    using Base::visit;

public:
    NameManglerVisitor(ShaderModule& shaderModule)
        : m_shaderModule(shaderModule)
    {
    }

    void run();

    void visit(AST::Function&) override;
    void visit(AST::Parameter&) override;
    void visit(AST::VariableStatement&) override;
    void visit(AST::Structure&) override;
    void visit(AST::Variable&) override;
    void visit(AST::IdentifierExpression&) override;
    void visit(AST::FieldAccessExpression&) override;

private:
    using NameMap = ContextProvider::ContextMap;

    void introduceVariable(AST::Identifier&, MangledName::Kind);
    void readVariable(AST::Identifier&) const;

    MangledName NODELETE makeMangledName(const String&, MangledName::Kind);

    void visitVariableDeclaration(AST::Variable&, MangledName::Kind);

    ShaderModule& m_shaderModule;
    HashMap<AST::Structure*, NameMap> m_structFieldMapping;
    std::array<uint32_t, MangledName::numberOfKinds> m_indexPerType { 0 };
};

void NameManglerVisitor::run()
{
    Base::visit(m_shaderModule);
}

void NameManglerVisitor::visit(AST::Function& function)
{
    String originalName = function.name();
    introduceVariable(function.name(), MangledName::Function);
    Base::visit(function);
}

void NameManglerVisitor::visit(AST::Parameter& parameter)
{
    Base::visit(parameter.typeName());
    introduceVariable(parameter.name(), MangledName::Parameter);
}

void NameManglerVisitor::visit(AST::Structure& structure)
{
    introduceVariable(structure.name(), MangledName::Type);

    NameMap fieldMap;
    for (auto& member : structure.members()) {
        Base::visit(member.type());
        auto mangledName = makeMangledName(member.name(), MangledName::Field);
        fieldMap.add(member.name(), mangledName);
        m_shaderModule.replace(&member.name(), AST::Identifier::makeWithSpan(member.name().span(), mangledName.toString()));
    }
    auto result = m_structFieldMapping.add(&structure, WTF::move(fieldMap));
    ASSERT_UNUSED(result, result.isNewEntry);
}

void NameManglerVisitor::visit(AST::Variable& variable)
{
    visitVariableDeclaration(variable, MangledName::Global);
}

void NameManglerVisitor::visit(AST::VariableStatement& variable)
{
    visitVariableDeclaration(variable.variable(), MangledName::Local);
}

void NameManglerVisitor::visitVariableDeclaration(AST::Variable& variable, MangledName::Kind kind)
{
    Base::visit(variable);

    introduceVariable(variable.name(), kind);
}

void NameManglerVisitor::visit(AST::IdentifierExpression& identifier)
{
    readVariable(identifier.identifier());
}

void NameManglerVisitor::visit(AST::FieldAccessExpression& access)
{
    Base::visit(access);

    auto* baseType = access.base().inferredType();
    if (auto* reference = std::get_if<Types::Reference>(baseType))
        baseType = reference->element;
    if (auto* pointer = std::get_if<Types::Pointer>(baseType))
        baseType = pointer->element;
    auto* structType = std::get_if<Types::Struct>(baseType);
    if (!structType)
        return;
    auto structMapIt = m_structFieldMapping.find(&structType->structure);
    RELEASE_ASSERT(structMapIt != m_structFieldMapping.end());

    auto fieldIt = structMapIt->value.find(access.fieldName());
    ASSERT(fieldIt != structMapIt->value.end());
    m_shaderModule.replace(&access.fieldName(), AST::Identifier::makeWithSpan(access.fieldName().span(), fieldIt->value.toString()));
}

void NameManglerVisitor::introduceVariable(AST::Identifier& name, MangledName::Kind kind)
{
    const auto* mangledName = ContextProvider::introduceVariable(name, makeMangledName(name, kind));
    ASSERT(mangledName);
    m_shaderModule.replace(&name, AST::Identifier::makeWithSpan(name.span(), mangledName->toString()));
}

MangledName NameManglerVisitor::makeMangledName(const String& name, MangledName::Kind kind)
{
    return MangledName {
        kind,
        m_indexPerType[std::to_underlying(kind)]++,
        name
    };
}

void NameManglerVisitor::readVariable(AST::Identifier& name) const
{
    if (const auto* mangledName = ContextProvider::readVariable(name))
        m_shaderModule.replace(&name, AST::Identifier::makeWithSpan(name.span(), mangledName->toString()));
}

void mangleNames(ShaderModule& shaderModule)
{
    NameManglerVisitor(shaderModule).run();
}

} // namespace WGSL
