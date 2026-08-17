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
#include "AliasAnalysis.h"

#include "AST.h"
#include "ASTScopedVisitorInlines.h"
#include "ASTIdentifier.h"
#include "ASTVisitor.h"
#include "CallGraph.h"
#include "WGSL.h"
#include "WGSLShaderModule.h"
#include <wtf/DataLog.h>
#include <wtf/HashMap.h>
#include <wtf/HashTraits.h>

namespace WGSL {

constexpr bool shouldLogAliasAnalysis = false;

class MemoryLocation {
    friend struct MemoryLocationHashTraits;

public:
    enum class Kind : uint8_t {
        Invalid,
        Local,
        Global,
        Parameter,
    };

    MemoryLocation()
        : m_kind(Kind::Invalid)
    {
    }

    static MemoryLocation NODELETE parameter(unsigned id) { return MemoryLocation { Kind::Parameter, id }; }
    static MemoryLocation NODELETE global(unsigned id) { return MemoryLocation { Kind::Global, id }; }
    static MemoryLocation NODELETE local(unsigned id) { return MemoryLocation { Kind::Local, id }; }

    Kind NODELETE kind() const { return m_kind; }
    unsigned NODELETE id() const { return m_id; }

    bool NODELETE isParameter() const { return m_kind == Kind::Parameter; }
    bool NODELETE isGlobal() const { return m_kind == Kind::Global; }

    bool NODELETE operator==(const MemoryLocation& other) const
    {
        return m_kind == other.m_kind && m_id == other.m_id;
    }

    static constexpr bool safeToCompareToHashTableEmptyOrDeletedValue = true;

    void dump(PrintStream& out) const
    {
        switch (m_kind) {
        case Kind::Invalid:
            out.print("invalid");
            break;
        case Kind::Local:
            out.print("local");
            break;
        case Kind::Global:
            out.print("global");
            break;
        case Kind::Parameter:
            out.print("parameter");
            break;
        }
        out.print(':', m_id);
    }

private:
    MemoryLocation(Kind kind, unsigned id)
        : m_kind(kind)
        , m_id(id)
    {
    }

    static MemoryLocation NODELETE hashTableDeletedValue()
    {
        return MemoryLocation { Kind::Invalid, std::numeric_limits<unsigned>::max() };
    }

    Kind m_kind { Kind::Invalid };
    unsigned m_id { 0 };
};

} // namespace WGSL

namespace WTF {

template<> class StringTypeAdapter<WGSL::MemoryLocation> {
public:
    StringTypeAdapter(const WGSL::MemoryLocation& value)
    {
        StringPrintStream valueString;
        value.dump(valueString);
        m_string = valueString.toString();
    }

    unsigned NODELETE length() const { return m_string.length(); }
    bool NODELETE is8Bit() const { return m_string.is8Bit(); }
    template<typename CharacterType>
    void writeTo(std::span<CharacterType> destination) const
    {
        StringView { m_string }.getCharacters(destination);
        WTF_STRINGTYPEADAPTER_COPIED_WTF_STRING();
    }

private:
    String m_string;
};

} // namespace WTF

namespace WGSL {

inline void NODELETE add(Hasher& hasher, const MemoryLocation& input)
{
    WTF::add(hasher, input.kind());
    WTF::add(hasher, input.id());
}

struct MemoryLocationHashTraits : SimpleClassHashTraits<MemoryLocation> {
    static const bool emptyValueIsZero = false;
    static MemoryLocation NODELETE emptyValue() { return MemoryLocation(); }

    static void NODELETE constructDeletedValue(MemoryLocation& slot) { new (NotNull, &slot) MemoryLocation { MemoryLocation::Kind::Invalid, std::numeric_limits<unsigned>::max() }; }
    static bool NODELETE isDeletedValue(const MemoryLocation& value)
    {
        MemoryLocation deleted;
        constructDeletedValue(deleted);
        return value == deleted;
    }
};

using MemoryLocationSet = HashSet<MemoryLocation, DefaultHash<MemoryLocation>, MemoryLocationHashTraits>;

struct FunctionInfo {
    FunctionInfo() = default;

    FunctionInfo(size_t parameterCount)
        : parameters(parameterCount)
    {
    }

    FixedVector<MemoryLocation> parameters;
    MemoryLocationSet readParameters;
    MemoryLocationSet writtenParameters;
    MemoryLocationSet readGlobals;
    MemoryLocationSet writtenGlobals;
};

class AliasAnalysis : public AST::ScopedVisitor<MemoryLocation> {
    using Base = AST::ScopedVisitor<MemoryLocation>;
    using Base::visit;

public:
    AliasAnalysis(ShaderModule& shaderModule)
        : Base()
        , m_shaderModule(shaderModule)
    {
    }

    std::optional<Error> run();

    void visit(AST::Function&) override;

    void visit(AST::AssignmentStatement&) override;
    void visit(AST::VariableStatement&) override;
    void visit(AST::CompoundAssignmentStatement&) override;
    void visit(AST::DecrementIncrementStatement&) override;

    void visit(AST::CallExpression&) override;
    void visit(AST::IdentifierExpression&) override;

private:
    void read(MemoryLocation);
    void write(MemoryLocation);
    void write(const AST::Expression&);

    const MemoryLocation* getRootIdentifier(const AST::Expression&) const;

    ShaderModule& m_shaderModule;
    HashSet<AST::Function*> m_visitedFunctions;
    HashMap<String, FunctionInfo> m_functions;
    FunctionInfo* m_function;
    Vector<MemoryLocation> m_globals;
    unsigned m_globalID { 0 };
    unsigned m_localID { 0 };
    unsigned m_parameterID { 0 };
};

std::optional<Error> AliasAnalysis::run()
{
    unsigned globalCount = 0;
    unsigned functionCount = 0;
    for (auto& declaration : m_shaderModule.declarations()) {
        switch (declaration.kind()) {
        case AST::NodeKind::Function:
            ++functionCount;
            break;
        case AST::NodeKind::Variable:
            ++globalCount;
            break;
        default:
            break;
        }
    }

    m_globals.resize(globalCount);
    m_functions.reserveInitialCapacity(functionCount);

    for (auto& declaration : m_shaderModule.declarations()) {
        if (auto* globalVar = dynamicDowncast<AST::Variable>(declaration)) {
            m_globals.append(MemoryLocation::global(m_globalID++));
            introduceVariable(globalVar->name(), m_globals.last());
        } else if (auto* function = dynamicDowncast<AST::Function>(declaration)) {
            visit(*function);
            if (hasError()) [[unlikely]]
                return AST::Visitor::result().error();
        }
    }


    return std::nullopt;
}

void AliasAnalysis::visit(AST::Function& function)
{
    ContextScope functionScope(this);

    dataLogLnIf(shouldLogAliasAnalysis, "visiting function `"_s, function.name(), '`');
    auto parameterCount = function.parameters().size();
    auto result = m_functions.add(function.name(), FunctionInfo(parameterCount));

    m_function = &result.iterator->value;

    for (unsigned i = 0; i < parameterCount; ++i) {
        auto& parameter = function.parameters()[i];
        m_function->parameters[i] = MemoryLocation::parameter(m_parameterID++);
        introduceVariable(parameter.name(), m_function->parameters[i]);
        dataLogLnIf(shouldLogAliasAnalysis, "+ parameter `"_s, function.name(), "` => "_s, RawPointer(&m_function->parameters[i]));
    }

    AST::Visitor::visit(function);
    m_function = nullptr;
    m_localID = 0;
    m_parameterID = 0;
}

void AliasAnalysis::visit(AST::CallExpression& call)
{
    auto* target = dynamicDowncast<AST::IdentifierExpression>(call.target());
    if (!target) {
        AST::Visitor::visit(call);
        return;
    }

    auto it = m_functions.find(target->identifier().id());
    if (it == m_functions.end()) {
        static constexpr SortedArraySet atomicWriteFunctions { WTF::toArray<ComparableASCIILiteral>({
            "atomicAdd"_s,
            "atomicAnd"_s,
            "atomicCompareExchangeWeak"_s,
            "atomicExchange"_s,
            "atomicMax"_s,
            "atomicMin"_s,
            "atomicOr"_s,
            "atomicStore"_s,
            "atomicSub"_s,
            "atomicXor"_s,
        }) };

        if (atomicWriteFunctions.contains(target->identifier().id()))
            write(call.arguments()[0]);

        AST::Visitor::visit(call);
        return;
    }

    auto& function = it->value;
    auto argumentCount = call.arguments().size();
    MemoryLocationSet writtenArguments;
    MemoryLocationSet readArguments;

    m_function->writtenGlobals.addAll(function.writtenGlobals);
    m_function->readGlobals.addAll(function.readGlobals);

    dataLogIf(shouldLogAliasAnalysis, "call "_s, target->identifier().id(), "(");
    if constexpr (shouldLogAliasAnalysis) {
        for (unsigned i = 0; i < argumentCount; ++i) {
            if (i > 0)
                dataLog(", ");
            dataLog(RawPointer(&function.parameters[i]));
        }
        dataLogLn(")"_s);
    }

    for (unsigned i = 0; i < argumentCount; ++i) {
        auto& argument = call.arguments()[i];

        if (!std::holds_alternative<Types::Pointer>(*argument.inferredType()))
            continue;

        auto* argumentLocation = getRootIdentifier(argument);
        if (!argumentLocation)
            continue;

        auto parameter = function.parameters[i];
        bool isParameterRead = function.readParameters.contains(parameter);
        bool isParameterWritten = function.writtenParameters.contains(parameter);

        dataLogLnIf(shouldLogAliasAnalysis, '@', String::number(i), " arg:"_s, *argumentLocation, " param:"_s, parameter);

        if (isParameterWritten)
            write(*argumentLocation);
        if (isParameterRead)
            read(*argumentLocation);

        bool alreadyWritten = isParameterWritten
            ? !writtenArguments.add(*argumentLocation).isNewEntry
            : writtenArguments.contains(*argumentLocation);

        bool alreadyRead = isParameterRead
            ? !readArguments.add(*argumentLocation).isNewEntry
            : readArguments.contains(*argumentLocation);

        if ((isParameterWritten && (alreadyWritten || alreadyRead)) || (isParameterRead && alreadyWritten)) [[unlikely]] {
            setError({ "invalid aliased pointer argument"_s, argument.span() });
            return;
        }

        if (argumentLocation->isGlobal()) {
            bool isGlobalRead = function.readGlobals.contains(*argumentLocation);
            bool isGlobalWritten = function.writtenGlobals.contains(*argumentLocation);
            if ((isGlobalWritten && isParameterWritten) || (isGlobalWritten && isParameterRead) || (isGlobalRead && isParameterWritten)) {
                setError({ "invalid aliased pointer argument"_s, argument.span() });
                return;
            }
        }
    }
}

void AliasAnalysis::visit(AST::CompoundAssignmentStatement& statement)
{
    write(statement.leftExpression());
    visit(statement.rightExpression());
}

void AliasAnalysis::visit(AST::DecrementIncrementStatement& statement)
{
    write(statement.expression());
}

void AliasAnalysis::visit(AST::AssignmentStatement& statement)
{
    write(statement.lhs());
    visit(statement.rhs());
}

void AliasAnalysis::visit(AST::VariableStatement& statement)
{
    introduceVariable(statement.variable().name(), MemoryLocation::local(m_localID++));
    maybeCheckErrorAndVisit(statement.variable().maybeInitializer());
}

const MemoryLocation* AliasAnalysis::getRootIdentifier(const AST::Expression& expression) const
{
    if (auto* identityExpression = dynamicDowncast<AST::IdentityExpression>(expression))
        return getRootIdentifier(identityExpression->expression());
    if (auto* unaryExpression = dynamicDowncast<AST::UnaryExpression>(expression))
        return getRootIdentifier(unaryExpression->expression());
    if (auto* fieldAccess = dynamicDowncast<AST::FieldAccessExpression>(expression))
        return getRootIdentifier(fieldAccess->base());
    if (auto* indexAccess = dynamicDowncast<AST::IndexAccessExpression>(expression))
        return getRootIdentifier(indexAccess->base());
    if (auto* identifierExpression = dynamicDowncast<AST::IdentifierExpression>(expression))
        return readVariable(identifierExpression->identifier().id());
    return nullptr;
}

void AliasAnalysis::visit(AST::IdentifierExpression& expression)
{
    auto* rootIdentifier = readVariable(expression.identifier().id());
    if (!rootIdentifier)
        return;

    read(*rootIdentifier);
}

void AliasAnalysis::read(MemoryLocation rootIdentifier)
{
    if (rootIdentifier.isParameter()) {
        dataLogLnIf(shouldLogAliasAnalysis, "- reading parameter "_s, rootIdentifier);
        m_function->readParameters.add(rootIdentifier);
    } else if (rootIdentifier.isGlobal()) {
        dataLogLnIf(shouldLogAliasAnalysis, "- reading global "_s, rootIdentifier);
        m_function->readGlobals.add(rootIdentifier);
    }
}

void AliasAnalysis::write(const AST::Expression& expression)
{
    auto* rootIdentifier = getRootIdentifier(expression);
    if (!rootIdentifier)
        return;
    write(*rootIdentifier);
}

void AliasAnalysis::write(MemoryLocation rootIdentifier)
{
    if (rootIdentifier.isParameter()) {
        dataLogLnIf(shouldLogAliasAnalysis, "writing parameter "_s, rootIdentifier);
        m_function->writtenParameters.add(rootIdentifier);
    } else if (rootIdentifier.isGlobal()) {
        dataLogLnIf(shouldLogAliasAnalysis, "writing global "_s, rootIdentifier);
        m_function->writtenGlobals.add(rootIdentifier);
    }
}

std::optional<FailedCheck> aliasAnalysis(ShaderModule& shaderModule)
{
    if (auto error = AliasAnalysis(shaderModule).run())
        return FailedCheck { Vector<Error> { *error }, { } };
    return std::nullopt;
}

} // namespace WGSL
