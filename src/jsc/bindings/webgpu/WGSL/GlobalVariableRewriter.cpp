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
#include "GlobalVariableRewriter.h"

#include "AST.h"
#include "ASTIdentifier.h"
#include "ASTVisitor.h"
#include "CallGraph.h"
#include "WGSL.h"
#include "WGSLShaderModule.h"
#include <ranges>
#include <wtf/DataLog.h>
#include <wtf/HashMap.h>
#include <wtf/ListHashSet.h>
#include <wtf/SetForScope.h>
#include <wtf/text/MakeString.h>

namespace WGSL {

constexpr bool shouldLogGlobalVariableRewriting = false;

class RewriteGlobalVariables : public AST::Visitor {
public:
    RewriteGlobalVariables(ShaderModule& shaderModule, const HashMap<String, PipelineLayout*>& pipelineLayouts, HashMap<String, Reflection::EntryPointInformation>& entryPointInformations)
        : AST::Visitor()
        , m_shaderModule(shaderModule)
        , m_pipelineLayouts(pipelineLayouts)
        , m_entryPointInformations(entryPointInformations)
    {
    }

    std::optional<Error> run();

    void visit(AST::Function&) override;
    void visit(AST::Variable&) override;
    void visit(AST::Parameter&) override;

    void visit(AST::CompoundStatement&) override;
    void visit(AST::AssignmentStatement&) override;
    void visit(AST::VariableStatement&) override;
    void visit(AST::PhonyAssignmentStatement&) override;
    void visit(AST::CompoundAssignmentStatement&) override;

    void visit(AST::Expression&) override;

private:
    using Global = CallGraph::Global;

    template<typename Value>
    using IndexMap = HashMap<uint64_t, Value, WTF::IntHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>>;

    using UsedResources = IndexMap<IndexMap<const Global*>>;
    using UsedPrivateGlobals = Vector<const Global*>;

    struct UsedGlobals {
        UsedResources resources;
        UsedPrivateGlobals privateGlobals;
    };

    struct Insertion {
        AST::Statement* statement;
        unsigned index;
    };

    static AST::Identifier argumentBufferParameterName(unsigned group);
    static AST::Identifier dynamicOffsetVariableName();

    AST::Identifier argumentBufferStructName(unsigned group);

    void def(const AST::Identifier&, AST::Variable*);

    std::optional<Error> collectGlobals();
    std::optional<Error> visitEntryPoint(const CallGraph::EntryPoint&);
    void visitCallee(const CallGraph::Callee&);
    Result<UsedGlobals> determineUsedGlobals(const CallGraph::EntryPoint&);
    void collectDynamicOffsetGlobals(const PipelineLayout&);
    void usesOverride(AST::Variable&);
    void validateUsedGlobals(const UsedGlobals&) const;
    Vector<unsigned> insertStructs(const UsedResources&);
    Result<Vector<unsigned>> insertStructs(PipelineLayout&, const UsedResources&);
    AST::StructureMember& createArgumentBufferEntry(unsigned binding, AST::Variable&);
    AST::StructureMember& createArgumentBufferEntry(unsigned binding, const SourceSpan&, const String& name, AST::Expression& type);
    void finalizeArgumentBufferStruct(unsigned group, Vector<std::pair<unsigned, AST::StructureMember*>>&);
    void insertDynamicOffsetsBufferIfNeeded(const AST::Function&);
    void insertDynamicOffsetsBufferIfNeeded(const SourceSpan&, const AST::Function&);
    void insertParameter(const SourceSpan&, const AST::Function&, unsigned, AST::Identifier&&, AST::Expression* = nullptr, AST::ParameterRole = AST::ParameterRole::BindGroup);

    void insertParameters(AST::Function&, const Vector<unsigned>&);
    void insertMaterializations(AST::Function&, const UsedResources&);
    void insertLocalDefinitions(AST::Function&, const UsedPrivateGlobals&);
    const Global* readVariable(AST::IdentifierExpression&);
    void insertBeforeCurrentStatement(AST::Statement&);
    AST::Expression& bufferLengthType();
    AST::Expression& bufferLengthReferenceType();

    // zero initialization
    void initializeVariables(AST::Function&, const UsedPrivateGlobals&, size_t);
    void insertWorkgroupBarrier(AST::Function&, size_t);
    AST::Identifier& findOrInsertLocalInvocationIndex(AST::Function&);
    AST::Statement::List storeInitialValue(const UsedPrivateGlobals&);
    void storeInitialValue(AST::Expression&, AST::Statement::List&, unsigned);

    void packResource(AST::Variable&);
    void packArrayResource(AST::Variable&, const Types::Array*);
    void packStructResource(AST::Variable&, const Types::Struct*);
    const Type* packType(const Type*);
    const Type* packStructType(const Types::Struct*);
    const Type* packArrayType(const Types::Array*);
    void updateReference(AST::Variable&, AST::Expression&);

    Packing pack(Packing, AST::Expression&);
    Packing getPacking(AST::IdentifierExpression&);
    Packing getPacking(AST::FieldAccessExpression&);
    Packing getPacking(AST::IndexAccessExpression&);
    Packing getPacking(AST::BinaryExpression&);
    Packing getPacking(AST::UnaryExpression&);
    Packing getPacking(AST::CallExpression&);
    Packing getPacking(AST::IdentityExpression&);
    Packing packingForType(const Type*);

    AST::IdentifierExpression& getBase(AST::Expression&, unsigned&);

    ShaderModule& m_shaderModule;
    HashMap<String, Global> m_globals;
    HashMap<std::tuple<unsigned, unsigned>, AST::Variable*> m_globalsByBinding;
    IndexMap<Vector<std::pair<unsigned, String>>> m_groupBindingMap;
    IndexMap<const Type*> m_structTypes;
    HashMap<String, AST::Variable*> m_defs;
    ListHashSet<String> m_reads;
    HashMap<AST::Function*, ListHashSet<String>> m_lengthParameters;
    HashMap<AST::Function*, ListHashSet<String>> m_visitedFunctions;
    Reflection::EntryPointInformation* m_entryPointInformation { nullptr };
    HashMap<uint32_t, uint32_t, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> m_generateLayoutGroupMapping;
    PipelineLayout* m_generatedLayout { nullptr };
    unsigned m_currentStatementIndex { 0 };
    unsigned m_entryPointID { 0 };
    Vector<Insertion> m_pendingInsertions;
    HashMap<const Types::Struct*, const Type*> m_packedStructTypes;
    ShaderStage m_stage { ShaderStage::Vertex };
    const HashMap<String, PipelineLayout*>& m_pipelineLayouts;
    HashMap<String, Reflection::EntryPointInformation>& m_entryPointInformations;
    HashMap<AST::Variable*, AST::Variable*> m_bufferLengthMap;
    HashMap<AST::Variable*, AST::Variable*> m_reverseBufferLengthMap;
    AST::Expression* m_bufferLengthType { nullptr };
    AST::Expression* m_bufferLengthReferenceType { nullptr };
    AST::Function* m_currentFunction { nullptr };
    HashMap<std::pair<unsigned, unsigned>, unsigned> m_globalsUsingDynamicOffset;
    HashSet<AST::Expression*> m_doNotUnpack;
    CheckedUint32 m_combinedFunctionVariablesSize;
    bool m_isTopLevelExpression { true };
    bool m_suppressOverrideValidation { false };
};

std::optional<Error> RewriteGlobalVariables::run()
{
    dataLogLnIf(shouldLogGlobalVariableRewriting, "BEGIN: GlobalVariableRewriter");

    if (auto error = collectGlobals())
        return error;
    for (auto& entryPoint : m_shaderModule.callGraph().entrypoints()) {
        auto maybeError = visitEntryPoint(entryPoint);
        ++m_entryPointID;
        if (maybeError.has_value())
            return maybeError;
    }

    dataLogLnIf(shouldLogGlobalVariableRewriting, "END: GlobalVariableRewriter");
    return std::nullopt;
}

void RewriteGlobalVariables::visitCallee(const CallGraph::Callee& callee)
{
    const auto& updateCallee = [&] {
        for (auto& read : m_reads) {
            auto it = m_globals.find(read);
            RELEASE_ASSERT(it != m_globals.end());
            auto& global = it->value;
            AST::Expression* type;
            if (global.declaration->flavor() == AST::VariableFlavor::Var)
                type = global.declaration->maybeReferenceType();
            else {
                ASSERT(global.declaration->flavor() == AST::VariableFlavor::Override);
                type = global.declaration->maybeTypeName();
                if (!type) {
                    auto* storeType = global.declaration->storeType();
                    auto& typeExpression = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(SourceSpan::empty(), AST::Identifier::make(storeType->toString()));
                    typeExpression.m_inferredType = storeType;
                    type = &typeExpression;
                }
            }
            ASSERT(type);

            auto parameterRole = global.declaration->role() == AST::VariableRole::PackedResource ? AST::ParameterRole::PackedResource : AST::ParameterRole::UserDefined;
            m_shaderModule.append(callee.target->parameters(), m_shaderModule.astBuilder().construct<AST::Parameter>(
                SourceSpan::empty(),
                AST::Identifier::make(read),
                *type,
                AST::Attribute::List { },
                parameterRole
            ));
        }

        auto it = m_lengthParameters.find(callee.target);
        if (it != m_lengthParameters.end() && !it->value.isEmpty()) {
            auto& lengthType = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(SourceSpan::empty(), AST::Identifier::make("u32"_s));
            lengthType.m_inferredType = m_shaderModule.types().u32Type();

            for (auto& length : it->value) {
                auto lengthName = makeString("__"_s, length, "_ArrayLength"_s);
                if (m_reads.contains(lengthName))
                    continue;
                m_shaderModule.append(callee.target->parameters(), m_shaderModule.astBuilder().construct<AST::Parameter>(
                    SourceSpan::empty(),
                    AST::Identifier::make(lengthName),
                    lengthType,
                    AST::Attribute::List { },
                    AST::ParameterRole::UserDefined
                ));
            }
        }
    };

    const auto& updateCallSites = [&] {
        for (auto& read : m_reads) {
            dataLogLnIf(shouldLogGlobalVariableRewriting, ">> Updating call site to pass global read: ", read);
            for (auto& [_, call] : callee.callSites) {
                auto it = m_globals.find(read);
                RELEASE_ASSERT(it != m_globals.end());
                auto& global = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
                    SourceSpan::empty(),
                    AST::Identifier::make(read)
                );
                global.m_inferredType = it->value.declaration->storeType();
                m_shaderModule.append(call->arguments(), global);
                m_doNotUnpack.add(&global);
            }
        }

        auto it = m_lengthParameters.find(callee.target);
        if (it != m_lengthParameters.end() && !it->value.isEmpty()) {
            auto& lengthType = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(SourceSpan::empty(), AST::Identifier::make("u32"_s));
            lengthType.m_inferredType = m_shaderModule.types().u32Type();

            Vector<std::pair<AST::Function*, String>> pendingLengthParameters;
            for (auto& lengthParameter : it->value) {
                auto lengthName = makeString("__"_s, lengthParameter, "_ArrayLength"_s);
                if (m_reads.contains(lengthName))
                    continue;

                unsigned index = 0;
                for (auto& parameter : callee.target->parameters()) {
                    if (parameter.name() == lengthParameter)
                        break;
                    ++index;
                }
                for (auto& [caller, call] : callee.callSites) {
                    dataLogLnIf(shouldLogGlobalVariableRewriting, ">> Updating call site ("_s, caller->name(), ") to pass array length: ", lengthName);
                    auto& argument = call->arguments()[index];
                    unsigned arrayOffset = 0;
                    auto& base = getBase(argument, arrayOffset);
                    auto& identifier = base.identifier();

                    pendingLengthParameters.append({ caller, identifier });

                    auto lengthName = makeString("__"_s, identifier, "_ArrayLength"_s);
                    auto& length = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
                        SourceSpan::empty(),
                        AST::Identifier::make(lengthName)
                    );
                    length.m_inferredType = m_shaderModule.types().u32Type();
                    AST::Expression* lhs = &length;
                    if (arrayOffset) {
                        auto& arrayOffsetExpression = m_shaderModule.astBuilder().construct<AST::Unsigned32Literal>(
                            SourceSpan::empty(),
                            arrayOffset
                        );
                        arrayOffsetExpression.m_inferredType = m_shaderModule.types().u32Type();
                        lhs = &m_shaderModule.astBuilder().construct<AST::BinaryExpression>(
                            SourceSpan::empty(),
                            length,
                            arrayOffsetExpression,
                            AST::BinaryOperation::Subtract
                        );
                        lhs->m_inferredType = m_shaderModule.types().u32Type();
                    }
                    m_shaderModule.append(call->arguments(), *lhs);
                }
            }

            for (auto&  [caller, lengthParameter] : pendingLengthParameters) {
                auto result = m_lengthParameters.add(caller, ListHashSet<String> { });
                result.iterator->value.add(lengthParameter);
            }
        }
    };

    dataLogLnIf(shouldLogGlobalVariableRewriting, "ENTER: ", callee.target->name());
    auto it = m_visitedFunctions.find(callee.target);
    if (it != m_visitedFunctions.end()) {
        dataLogLnIf(shouldLogGlobalVariableRewriting, "> Already visited callee: ", callee.target->name());
        m_reads = it->value;
        updateCallSites();
        dataLogLnIf(shouldLogGlobalVariableRewriting, "EXIT: ", callee.target->name());
        return;
    }

    dataLogLnIf(shouldLogGlobalVariableRewriting, "> Visiting callee: ", callee.target->name());

    visit(*callee.target);
    updateCallee();
    updateCallSites();

    m_visitedFunctions.add(callee.target, m_reads);
    dataLogLnIf(shouldLogGlobalVariableRewriting, "EXIT: ", callee.target->name());
}

void RewriteGlobalVariables::visit(AST::Function& function)
{
    ListHashSet<String> reads;
    for (auto& callee : m_shaderModule.callGraph().callees(function)) {
        visitCallee(callee);

        if (hasError())
            return;

        for (const auto& read : m_reads)
            reads.add(read);
    }
    m_reads = WTF::move(reads);
    m_defs.clear();
    m_combinedFunctionVariablesSize = 0;

    def(function.name(), nullptr);
    m_currentFunction = &function;
    AST::Visitor::visit(function);
    m_currentFunction = nullptr;

    // https://www.w3.org/TR/WGSL/#limits
    constexpr unsigned maximumCombinedFunctionVariablesSize = 8192;
    if (m_combinedFunctionVariablesSize.hasOverflowed() || m_combinedFunctionVariablesSize.value() > maximumCombinedFunctionVariablesSize) [[unlikely]]
        setError(Error(makeString("The combined byte size of all variables in this function exceeds "_s, String::number(maximumCombinedFunctionVariablesSize), " bytes"_s), function.span()));
}

void RewriteGlobalVariables::visit(AST::Parameter& parameter)
{
    def(parameter.name(), nullptr);
    AST::Visitor::visit(parameter);
}

void RewriteGlobalVariables::visit(AST::Variable& variable)
{
    def(variable.name(), &variable);
    AST::Visitor::visit(variable);
}

void RewriteGlobalVariables::visit(AST::CompoundStatement& statement)
{
    auto indexScope = SetForScope(m_currentStatementIndex, 0);
    auto insertionScope = SetForScope(m_pendingInsertions, Vector<Insertion>());

    for (auto& statement : statement.statements()) {
        AST::Visitor::visit(statement);
        ++m_currentStatementIndex;
    }

    unsigned offset = 0;
    for (auto& insertion : m_pendingInsertions) {
        m_shaderModule.insert(statement.statements(), insertion.index + offset, AST::Statement::Ref(*insertion.statement));
        ++offset;
    }
}

void RewriteGlobalVariables::visit(AST::CompoundAssignmentStatement& statement)
{
    Packing lhsPacking = pack(Packing::Unpacked, statement.leftExpression());
    pack(lhsPacking, statement.rightExpression());
}

void RewriteGlobalVariables::visit(AST::AssignmentStatement& statement)
{
    Packing lhsPacking = pack(Packing::Either, statement.lhs());
    ASSERT(lhsPacking != Packing::Either);
    if (lhsPacking == Packing::PackedVec3) {
        auto* lhsType = statement.lhs().inferredType();
        if (auto* ref = std::get_if<Types::Reference>(lhsType))
            lhsType = ref->element;
        if (std::holds_alternative<Types::Vector>(*lhsType))
            lhsPacking = Packing::Either;
    }
    pack(lhsPacking, statement.rhs());
}

void RewriteGlobalVariables::visit(AST::VariableStatement& statement)
{
    if (statement.variable().flavor() == AST::VariableFlavor::Var)
        m_combinedFunctionVariablesSize += statement.variable().storeType()->size();
    if (auto* initializer = statement.variable().maybeInitializer())
        pack(static_cast<Packing>(Packing::Unpacked), *initializer);
}

void RewriteGlobalVariables::visit(AST::PhonyAssignmentStatement& statement)
{
    pack(Packing::Either, statement.rhs());
}

void RewriteGlobalVariables::visit(AST::Expression& expression)
{
    pack(Packing::Unpacked, expression);
}

Packing RewriteGlobalVariables::pack(Packing expectedPacking, AST::Expression& expression)
{
    if (m_isTopLevelExpression && expression.maybeEvaluation().value_or(Evaluation::Runtime) == Evaluation::Override) {
        m_shaderModule.addOverrideValidation([&shaderModule = m_shaderModule, &expression](auto& overrideValues) -> std::optional<Error> {
            auto maybeValue = shaderModule.ensureOverrideValue(expression, overrideValues);
            if (!maybeValue)
                return maybeValue.error();
            return std::nullopt;
        });
    }

    SetForScope topLevelExpression(m_isTopLevelExpression, false);

    if (m_doNotUnpack.contains(&expression))
        return expectedPacking;

    const auto& visitAndReplace = [&](auto& expression) -> Packing {
        auto packing = getPacking(expression);
        if (expectedPacking & packing)
            return packing;

        auto* type = expression.inferredType();
        if (auto* referenceType = std::get_if<Types::Reference>(type))
            type = referenceType->element;
        ASCIILiteral operation;
        if (std::holds_alternative<Types::Struct>(*type)) {
            if (!type->isConstructible())
                return packing;
            operation = packing & Packing::Packed ? "__unpack"_s : "__pack"_s;
        } else if (std::holds_alternative<Types::Array>(*type)) {
            if (packing & Packing::Packed) {
                operation = "__unpack"_s;
                m_shaderModule.setUsesUnpackArray();
            } else {
                operation = "__pack"_s;
                m_shaderModule.setUsesPackArray();
            }
        } else {
            if (packing & Packing::Packed) {
                operation = "__unpack"_s;
                m_shaderModule.setUsesUnpackVector();
            } else {
                operation = "__pack"_s;
                m_shaderModule.setUsesPackVector();
            }
        }
        RELEASE_ASSERT(!operation.isNull());
        auto& callee = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
            SourceSpan::empty(),
            AST::Identifier::make(operation)
        );
        callee.m_inferredType = m_shaderModule.types().u32Type();
        auto& argument = m_shaderModule.astBuilder().construct<std::remove_cvref_t<decltype(expression)>>(expression);
        auto& call = m_shaderModule.astBuilder().construct<AST::CallExpression>(
            SourceSpan::empty(),
            callee,
            AST::Expression::List { argument }
        );
        call.m_inferredType = argument.inferredType();
        call.m_resolvedTarget = operation;
        m_shaderModule.replace(expression, call);
        return static_cast<Packing>(Packing::Either ^ packing);
    };

    switch (expression.kind()) {
    case AST::NodeKind::IdentifierExpression:
        return visitAndReplace(uncheckedDowncast<AST::IdentifierExpression>(expression));
    case AST::NodeKind::FieldAccessExpression:
        return visitAndReplace(uncheckedDowncast<AST::FieldAccessExpression>(expression));
    case AST::NodeKind::IndexAccessExpression:
        return visitAndReplace(uncheckedDowncast<AST::IndexAccessExpression>(expression));
    case AST::NodeKind::BinaryExpression:
        return visitAndReplace(uncheckedDowncast<AST::BinaryExpression>(expression));
    case AST::NodeKind::UnaryExpression:
        return visitAndReplace(uncheckedDowncast<AST::UnaryExpression>(expression));
    case AST::NodeKind::CallExpression:
        return visitAndReplace(uncheckedDowncast<AST::CallExpression>(expression));
    case AST::NodeKind::IdentityExpression:
        return visitAndReplace(uncheckedDowncast<AST::IdentityExpression>(expression));
    default:
        AST::Visitor::visit(expression);
        return Packing::Unpacked;
    }
}

Packing RewriteGlobalVariables::getPacking(AST::IdentifierExpression& identifier)
{
    auto* global = readVariable(identifier);
    if (global && global->resource.has_value())
        return packingForType(identifier.inferredType());

    return Packing::Unpacked;
}

Packing RewriteGlobalVariables::getPacking(AST::FieldAccessExpression& expression)
{
    auto* baseType = expression.base().inferredType();
    if (!baseType) {
        // All AST nodes should have an inferred type, but we create field
        // access nodes from the EntryPointRewriter which don't have a trivial
        // type, so we work around it by returning unpacked since those are only
        // used for marshalling inputs/outputs and don't need to packed/unpacked.
        return Packing::Unpacked;
    }

    if (auto* referenceType = std::get_if<Types::Reference>(baseType))
        baseType = referenceType->element;

    bool isPointer = false;
    if (auto* pointerType = std::get_if<Types::Pointer>(baseType)) {
        isPointer = true;
        baseType = pointerType->element;
    }

    if (std::holds_alternative<Types::Vector>(*baseType)) {
        if (std::holds_alternative<Types::Vector>(*expression.inferredType())) {
            if (isPointer) {
                auto& dereference = m_shaderModule.astBuilder().construct<AST::UnaryExpression>(
                    expression.base().span(),
                    expression.base(),
                    AST::UnaryOperation::Dereference
                );
                dereference.m_inferredType = baseType;

                auto& fieldAccessExpression = m_shaderModule.astBuilder().construct<AST::FieldAccessExpression>(
                    expression.span(),
                    dereference,
                    AST::Identifier::make(expression.fieldName())
                );
                fieldAccessExpression.m_inferredType = expression.inferredType();

                m_shaderModule.replace(expression, fieldAccessExpression);
            }
            pack(Packing::Unpacked, expression.base());
        } else
            pack(Packing::Either, expression.base());
        return Packing::Unpacked;
    }

    auto basePacking = pack(Packing::Either, expression.base());
    if (basePacking & Packing::Unpacked)
        return Packing::Unpacked;

    ASSERT(std::holds_alternative<Types::Struct>(*baseType));
    auto& structType = std::get<Types::Struct>(*baseType);
    auto* fieldType = structType.fields.get(expression.originalFieldName());
    return packingForType(fieldType);
}

Packing RewriteGlobalVariables::getPacking(AST::IndexAccessExpression& expression)
{
    auto basePacking = pack(Packing::Either, expression.base());
    pack(Packing::Unpacked, expression.index());
    if (basePacking & Packing::Unpacked)
        return Packing::Unpacked;
    auto* baseType = expression.base().inferredType();
    if (auto* referenceType = std::get_if<Types::Reference>(baseType))
        baseType = referenceType->element;
    if (auto* pointerType = std::get_if<Types::Pointer>(baseType))
        baseType = pointerType->element;
    if (std::holds_alternative<Types::Vector>(*baseType))
        return Packing::Unpacked;
    if (auto* matrixType = std::get_if<Types::Matrix>(baseType)) {
        // Indexing a packed matrix (rows == 3) yields a PackedVec3 column,
        // which still needs to be unpacked before it can be swizzled or used
        // as a vec3. See Type::packing().
        if (matrixType->rows == 3)
            return Packing::PackedVec3;
        return Packing::Unpacked;
    }
    ASSERT(std::holds_alternative<Types::Array>(*baseType));
    auto& arrayType = std::get<Types::Array>(*baseType);
    return packingForType(arrayType.element);
}

Packing RewriteGlobalVariables::getPacking(AST::BinaryExpression& expression)
{
    pack(Packing::Unpacked, expression.leftExpression());

    if (expression.operation() == AST::BinaryOperation::ShortCircuitAnd || expression.operation() == AST::BinaryOperation::ShortCircuitOr) {
        auto leftEval = expression.leftExpression().maybeEvaluation().value_or(Evaluation::Runtime);
        if (leftEval == Evaluation::Override) {
            SetForScope suppressScope(m_suppressOverrideValidation, true);
            pack(Packing::Unpacked, expression.rightExpression());
            return Packing::Unpacked;
        }
    }

    pack(Packing::Unpacked, expression.rightExpression());

    if (m_suppressOverrideValidation)
        return Packing::Unpacked;

    auto operation = toASCIILiteral(expression.operation());
    if (auto* overload = m_shaderModule.lookupOverload(operation)) {
        if (auto validate = overload->validationFunction) {
            auto leftEval = expression.leftExpression().maybeEvaluation().value_or(Evaluation::Runtime);
            auto rightEval = expression.rightExpression().maybeEvaluation().value_or(Evaluation::Runtime);
            if (leftEval == Evaluation::Override || rightEval == Evaluation::Override) {
                m_shaderModule.addOverrideValidation([&shaderModule = m_shaderModule, &expression, validate](auto& overrideValues) -> std::optional<Error> {
                    FixedVector<std::optional<ConstantValue>> validationArguments(2);
                    if (auto value = evaluate(shaderModule, expression.leftExpression(), overrideValues))
                        validationArguments[0] = { *value };
                    if (auto value = evaluate(shaderModule, expression.rightExpression(), overrideValues))
                        validationArguments[1] = { *value };

                    FixedVector<const Type*> paramTypes(2);
                    paramTypes[0] = expression.leftExpression().inferredType();
                    paramTypes[1] = expression.rightExpression().inferredType();

                    if (auto error = validate(WTF::move(validationArguments), paramTypes))
                        return Error(*error, expression.span());

                    return std::nullopt;
                });
            }
        }
    }

    return Packing::Unpacked;
}

Packing RewriteGlobalVariables::getPacking(AST::UnaryExpression& expression)
{
    if (expression.operation() == AST::UnaryOperation::AddressOf) {
        pack(Packing::Either, expression.expression());
        // we can't pack/unpack pointers, so we return Either to avoid that
        return Packing::Either;
    }
    if (expression.operation() == AST::UnaryOperation::Dereference) {
        // similarly to above, pointers are handled differently, so we can't trust
        // the packing of the underlying element and instead we skip any packing
        // of the operand (since we can't pack/unpack pointers) and return the
        // packing of the resulting type from dereferencing
        pack(Packing::Either, expression.expression());
        auto* pointer = std::get_if<Types::Pointer>(expression.expression().inferredType());
        if (pointer->addressSpace == AddressSpace::Storage || pointer->addressSpace == AddressSpace::Uniform)
            return expression.inferredType()->packing();
        return Packing::Unpacked;
    }
    return pack(Packing::Unpacked, expression.expression());
}

Packing RewriteGlobalVariables::getPacking(AST::IdentityExpression& expression)
{
    return pack(Packing::Either, expression.expression());
}

Packing RewriteGlobalVariables::getPacking(AST::CallExpression& call)
{
    if (auto target = dynamicDowncast<AST::IdentifierExpression>(call.target())) {
        if (target->identifier() == "arrayLength"_s) {
            ASSERT(call.arguments().size() == 1);
            auto& arrayPointer = call.arguments()[0];
            unsigned arrayOffset = 0;
            auto& base = getBase(arrayPointer, arrayOffset);
            auto& identifier = base.identifier();
            if (!m_globals.contains(identifier)) {
                auto result = m_lengthParameters.add(m_currentFunction, ListHashSet<String> { });
                result.iterator->value.add(identifier);
            }
            auto lengthName = makeString("__"_s, identifier, "_ArrayLength"_s);
            auto& length = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
                SourceSpan::empty(),
                AST::Identifier::make(lengthName)
            );
            length.m_inferredType = m_shaderModule.types().u32Type();

            auto* arrayPointerType = arrayPointer.inferredType();
            ASSERT(std::holds_alternative<Types::Pointer>(*arrayPointerType));
            auto& arrayType = std::get<Types::Pointer>(*arrayPointerType).element;
            ASSERT(std::holds_alternative<Types::Array>(*arrayType));
            auto* elementType = std::get<Types::Array>(*arrayType).element;
            auto arrayStride = elementType->size();
            arrayStride = WTF::roundUpToMultipleOf(elementType->alignment(), arrayStride);

            auto& strideExpression = m_shaderModule.astBuilder().construct<AST::Unsigned32Literal>(
                SourceSpan::empty(),
                arrayStride
            );
            strideExpression.m_inferredType = m_shaderModule.types().u32Type();

            AST::Expression* lhs = &length;
            if (arrayOffset) {
                auto& arrayOffsetExpression = m_shaderModule.astBuilder().construct<AST::Unsigned32Literal>(
                    SourceSpan::empty(),
                    arrayOffset
                );
                arrayOffsetExpression.m_inferredType = m_shaderModule.types().u32Type();
                lhs = &m_shaderModule.astBuilder().construct<AST::BinaryExpression>(
                    SourceSpan::empty(),
                    length,
                    arrayOffsetExpression,
                    AST::BinaryOperation::Subtract
                );
                lhs->m_inferredType = m_shaderModule.types().u32Type();
            }

            m_shaderModule.setUsesDivision();
            auto& elementCount = m_shaderModule.astBuilder().construct<AST::BinaryExpression>(
                SourceSpan::empty(),
                *lhs,
                strideExpression,
                AST::BinaryOperation::Divide
            );
            elementCount.m_inferredType = m_shaderModule.types().u32Type();

            m_shaderModule.replace(call, elementCount);
            // mark both the array and array length as read
            readVariable(base);
            readVariable(length);
            return Packing::Unpacked;
        }
    }

    for (auto& argument : call.arguments())
        pack(Packing::Unpacked, argument);

    if (!m_suppressOverrideValidation) {
        if (auto validate = call.validationFunction()) {
            m_shaderModule.addOverrideValidation([&shaderModule = m_shaderModule, &call, validate](auto& overrideValues) -> std::optional<Error> {
                unsigned argumentCount = call.arguments().size();
                FixedVector<std::optional<ConstantValue>> validationArguments(argumentCount);
                for (unsigned i = 0; i < argumentCount; ++i) {
                    if (auto value = evaluate(shaderModule, call.arguments()[i], overrideValues))
                        validationArguments[i] = { *value };
                }

                FixedVector<const Type*> paramTypes(argumentCount);
                for (unsigned i = 0; i < argumentCount; ++i)
                    paramTypes[i] = call.arguments()[i].inferredType();

                if (auto error = validate(WTF::move(validationArguments), paramTypes))
                    return Error(*error, call.span());

                return std::nullopt;
            });
        }
    }

    return Packing::Unpacked;
}

Packing RewriteGlobalVariables::packingForType(const Type* type)
{
    return type->packing();
}

AST::IdentifierExpression& RewriteGlobalVariables::getBase(AST::Expression& expression, unsigned& arrayOffset)
{
    if (auto* identityExpression = dynamicDowncast<AST::IdentityExpression>(expression))
        return getBase(identityExpression->expression(), arrayOffset);
    if (auto* unaryExpression = dynamicDowncast<AST::UnaryExpression>(expression))
        return getBase(unaryExpression->expression(), arrayOffset);
    if (auto* fieldAccess = dynamicDowncast<AST::FieldAccessExpression>(expression)) {
        auto& base = fieldAccess->base();
        auto* type = base.inferredType();
        if (auto* reference = std::get_if<Types::Reference>(type))
            type = reference->element;
        if (auto* pointer = std::get_if<Types::Pointer>(type))
            type = pointer->element;
        auto& structure = std::get<Types::Struct>(*type).structure;
        auto& lastMember = structure.members().last();
        RELEASE_ASSERT(lastMember.name().id() == fieldAccess->fieldName().id());
        arrayOffset += lastMember.offset();
        return getBase(base, arrayOffset);
    }
    if (auto* identifierExpression = dynamicDowncast<AST::IdentifierExpression>(expression))
        return *identifierExpression;
    RELEASE_ASSERT_NOT_REACHED();
}

static unsigned NODELETE buffersForStage(const Configuration& configuration, ShaderStage stage)
{
    switch (stage) {
    case ShaderStage::Compute:
        return configuration.maxBuffersForComputeStage;
    case ShaderStage::Vertex:
        return configuration.maxBuffersPlusVertexBuffersForVertexStage;
    case ShaderStage::Fragment:
        return configuration.maxBuffersForFragmentStage;
    }
}

std::optional<Error> RewriteGlobalVariables::collectGlobals()
{
    Vector<std::tuple<AST::Variable*, unsigned>> bufferLengths;
    // we can't use a range-based for loop here since we might create new structs
    // and insert them into the declarations vector
    auto size = m_shaderModule.declarations().size();
    for (unsigned i = 0; i < size; ++i) {
        auto* globalVar = dynamicDowncast<AST::Variable>(m_shaderModule.declarations()[i]);
        if (!globalVar)
            continue;
        std::optional<Global::Resource> resource;
        if (globalVar->group().has_value()) {
            RELEASE_ASSERT(globalVar->binding().has_value());
            unsigned bufferIndex = *globalVar->group();
            auto buffersCountForStage = buffersForStage(m_shaderModule.configuration(), m_stage);
            if (bufferIndex >= buffersCountForStage)
                return Error(makeString("global has buffer index "_s, bufferIndex, " which exceeds the max allowed buffer index "_s, buffersCountForStage, " for this stage"_s), SourceSpan::empty());

            resource = { *globalVar->group(), *globalVar->binding() };
        }

        dataLogLnIf(shouldLogGlobalVariableRewriting, "> Found global: ", globalVar->name(), ", isResource: ", resource.has_value() ? "yes" : "no");

        auto result = m_globals.add(globalVar->name(), Global {
            resource,
            globalVar
        });
        ASSERT_UNUSED(result, result.isNewEntry);

        if (resource.has_value()) {
            m_globalsByBinding.add({ resource->group + 1, resource->binding + 1 }, globalVar);

            auto result = m_groupBindingMap.add(resource->group, Vector<std::pair<unsigned, String>>());
            result.iterator->value.append({ resource->binding, globalVar->name() });
            packResource(*globalVar);

            bufferLengths.append({ globalVar, resource->group });
        }
    }

    for (auto& [_, vector] : m_groupBindingMap)
        std::ranges::sort(vector, { }, &std::pair<unsigned, String>::first);

    if (!bufferLengths.isEmpty()) {
        for (const auto& [variable, group] : bufferLengths) {
            auto name = AST::Identifier::make(makeString("__"_s, variable->name(), "_ArrayLength"_s));
            auto& lengthVariable = m_shaderModule.astBuilder().construct<AST::Variable>(
                SourceSpan::empty(),
                AST::VariableFlavor::Var,
                AST::Identifier::make(name),
                &bufferLengthType(),
                nullptr
            );
            lengthVariable.m_referenceType = &bufferLengthReferenceType();

            auto it = m_groupBindingMap.find(group);
            ASSERT(it != m_groupBindingMap.end());

            auto binding = it->value.last().first + 1;
            it->value.append({ binding, name });

            auto result = m_globals.add(name, Global {
                { {
                    group,
                    binding,
                } },
                &lengthVariable
            });
            ASSERT_UNUSED(result, result.isNewEntry);

            m_bufferLengthMap.add(variable, &lengthVariable);
            m_reverseBufferLengthMap.add(&lengthVariable, variable);
        }
    }

    return std::nullopt;
}

AST::Expression& RewriteGlobalVariables::bufferLengthType()
{
    if (m_bufferLengthType)
        return *m_bufferLengthType;
    m_bufferLengthType = &m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(SourceSpan::empty(), AST::Identifier::make("u32"_s));
    m_bufferLengthType->m_inferredType = m_shaderModule.types().u32Type();
    return *m_bufferLengthType;
}

AST::Expression& RewriteGlobalVariables::bufferLengthReferenceType()
{
    if (m_bufferLengthReferenceType)
        return *m_bufferLengthReferenceType;

    m_bufferLengthReferenceType = &m_shaderModule.astBuilder().construct<AST::ReferenceTypeExpression>(
        SourceSpan::empty(),
        bufferLengthType()
    );
    m_bufferLengthReferenceType->m_inferredType = m_shaderModule.types().referenceType(AddressSpace::Handle, m_shaderModule.types().u32Type(), AccessMode::Read);
    return *m_bufferLengthReferenceType;
}

void RewriteGlobalVariables::packResource(AST::Variable& global)
{
    auto* maybeTypeName = global.maybeTypeName();
    ASSERT(maybeTypeName);

    auto* resolvedType = maybeTypeName->inferredType();
    if (auto* arrayType = std::get_if<Types::Array>(resolvedType)) {
        packArrayResource(global, arrayType);
        return;
    }

    if (auto* structType = std::get_if<Types::Struct>(resolvedType)) {
        packStructResource(global, structType);
        return;
    }

    if (auto* matrixType = std::get_if<Types::Matrix>(resolvedType)) {
        if (matrixType->rows == 3) {
            m_shaderModule.setUsesPackedVec3();
            m_shaderModule.setUsesPackVector();
            m_shaderModule.setUsesUnpackVector();
            m_shaderModule.replace(&global.role(), AST::VariableRole::PackedResource);
        }
        return;
    }
}

void RewriteGlobalVariables::packStructResource(AST::Variable& global, const Types::Struct* structType)
{
    const Type* packedStructType = packStructType(structType);
    if (!packedStructType)
        return;

    auto& packedType = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
        SourceSpan::empty(),
        AST::Identifier::make(std::get<Types::Struct>(*packedStructType).structure.name().id())
    );
    packedType.m_inferredType = packedStructType;
    auto& namedTypeName = downcast<AST::IdentifierExpression>(*global.maybeTypeName());
    m_shaderModule.replace(namedTypeName, packedType);
    updateReference(global, packedType);
    m_shaderModule.replace(&global.role(), AST::VariableRole::PackedResource);
}

void RewriteGlobalVariables::packArrayResource(AST::Variable& global, const Types::Array* arrayType)
{
    const Type* packedArrayType = packArrayType(arrayType);
    if (!packedArrayType)
        return;

    const Type* packedElementType = std::get<Types::Array>(*packedArrayType).element;
    auto& packedType = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
        SourceSpan::empty(),
        AST::Identifier::make("__PackedArray"_s) // This name is not used by the codegen
    );
    packedType.m_inferredType = packedElementType;

    auto& arrayTypeName = downcast<AST::ArrayTypeExpression>(*global.maybeTypeName());
    auto& packedArrayTypeName = m_shaderModule.astBuilder().construct<AST::ArrayTypeExpression>(
        arrayTypeName.span(),
        &packedType,
        arrayTypeName.maybeElementCount()
    );
    packedArrayTypeName.m_inferredType = packedArrayType;

    m_shaderModule.replace(arrayTypeName, packedArrayTypeName);
    updateReference(global, packedArrayTypeName);
    m_shaderModule.replace(&global.role(), AST::VariableRole::PackedResource);
}

void RewriteGlobalVariables::updateReference(AST::Variable& global, AST::Expression& packedType)
{
    auto* maybeReference = global.maybeReferenceType();
    ASSERT(maybeReference);
    auto& reference = downcast<AST::ReferenceTypeExpression>(*maybeReference);
    auto* referenceType = std::get_if<Types::Reference>(reference.inferredType());
    ASSERT(referenceType);
    auto& packedTypeReference = m_shaderModule.astBuilder().construct<AST::ReferenceTypeExpression>(
        SourceSpan::empty(),
        packedType
    );
    packedTypeReference.m_inferredType = m_shaderModule.types().referenceType(
        referenceType->addressSpace,
        packedType.inferredType(),
        referenceType->accessMode
    );
    m_shaderModule.replace(reference, packedTypeReference);
}

const Type* RewriteGlobalVariables::packType(const Type* type)
{
    if (auto* structType = std::get_if<Types::Struct>(type))
        return packStructType(structType);
    if (auto* arrayType = std::get_if<Types::Array>(type))
        return packArrayType(arrayType);
    if (auto* vectorType = std::get_if<Types::Vector>(type)) {
        if (vectorType->size == 3) {
            m_shaderModule.setUsesPackedVec3();
            return type;
        }
    }
    if (auto* matrixType = std::get_if<Types::Matrix>(type)) {
        if (matrixType->rows == 3) {
            m_shaderModule.setUsesPackedVec3();
            m_shaderModule.setUsesPackVector();
            m_shaderModule.setUsesUnpackVector();
            return type;
        }
    }
    return nullptr;
}

const Type* RewriteGlobalVariables::packStructType(const Types::Struct* structType)
{
    if (structType->structure.role() == AST::StructureRole::UserDefinedResource)
        return m_packedStructTypes.get(structType);

    // Ensure we pack nested structs
    bool packedAnyMember = false;
    for (auto& member : structType->structure.members()) {
        if (packType(member.type().inferredType()))
            packedAnyMember = true;
    }
    if (!packedAnyMember && !structType->structure.hasSizeOrAlignmentAttributes())
        return nullptr;

    ASSERT(structType->structure.role() == AST::StructureRole::UserDefined);
    m_shaderModule.replace(&structType->structure.role(), AST::StructureRole::UserDefinedResource);

    String packedStructName = makeString("__"_s, structType->structure.name(), "_Packed"_s);

    auto& packedStruct = m_shaderModule.astBuilder().construct<AST::Structure>(
        SourceSpan::empty(),
        AST::Identifier::make(packedStructName),
        AST::StructureMember::List(structType->structure.members()),
        AST::StructureRole::PackedResource,
        &structType->structure
    );
    m_shaderModule.append(m_shaderModule.declarations(), packedStruct);
    const Type* packedStructType = m_shaderModule.types().structType(packedStruct);
    packedStruct.m_inferredType = packedStructType;
    m_packedStructTypes.add(structType, packedStructType);
    return packedStructType;
}

const Type* RewriteGlobalVariables::packArrayType(const Types::Array* arrayType)
{
    auto* packedElementType = packType(arrayType->element);
    if (!packedElementType)
        return nullptr;

    m_shaderModule.setUsesUnpackArray();
    m_shaderModule.setUsesPackArray();
    return m_shaderModule.types().arrayType(packedElementType, arrayType->size);
}

static size_t getRoundedSize(const AST::Variable& variable)
{
    auto* type = variable.storeType();
    return roundUpToMultipleOf(16, type ? type->size() : 0);
}

void RewriteGlobalVariables::insertParameter(const SourceSpan& span, const AST::Function& function, unsigned group, AST::Identifier&& name, AST::Expression* type, AST::ParameterRole parameterRole)
{
    if (!type) {
        type = &m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(span, argumentBufferStructName(group));
        type->m_inferredType = m_structTypes.get(group);
    }
    auto& groupValue = m_shaderModule.astBuilder().construct<AST::AbstractIntegerLiteral>(span, group);
    groupValue.m_inferredType = m_shaderModule.types().abstractIntType();
    groupValue.setConstantValue(group);
    auto& groupAttribute = m_shaderModule.astBuilder().construct<AST::GroupAttribute>(span, groupValue);
    m_shaderModule.append(function.parameters(), m_shaderModule.astBuilder().construct<AST::Parameter>(
        span,
        WTF::move(name),
        *type,
        AST::Attribute::List { groupAttribute },
        parameterRole
    ));
};

std::optional<Error> RewriteGlobalVariables::visitEntryPoint(const CallGraph::EntryPoint& entryPoint)
{
    dataLogLnIf(shouldLogGlobalVariableRewriting, "> Visiting entrypoint: ", entryPoint.function.name());

    auto it = m_pipelineLayouts.find(entryPoint.originalName);
    if (it == m_pipelineLayouts.end())
        return std::nullopt;

    m_reads.clear();
    m_structTypes.clear();
    m_globalsUsingDynamicOffset.clear();
    m_generateLayoutGroupMapping.clear();

    auto result = m_entryPointInformations.add(entryPoint.originalName, Reflection::EntryPointInformation { });
    RELEASE_ASSERT(result.isNewEntry);

    m_stage = entryPoint.stage;
    m_entryPointInformation = &result.iterator->value;
    m_entryPointInformation->originalName = entryPoint.originalName;
    m_entryPointInformation->mangledName = entryPoint.function.name();

    switch (m_stage) {
    case ShaderStage::Compute: {
        for (auto& attribute : entryPoint.function.attributes()) {
            auto* workgroupSize = dynamicDowncast<AST::WorkgroupSizeAttribute>(attribute);
            if (!workgroupSize)
                continue;
            m_entryPointInformation->typedEntryPoint = Reflection::Compute { &workgroupSize->x(), workgroupSize->maybeY(), workgroupSize->maybeZ() };
            break;
        }
        break;
    }
    case ShaderStage::Vertex:
        m_entryPointInformation->typedEntryPoint = Reflection::Vertex { false };
        if (entryPoint.function.returnTypeInvariant())
            m_entryPointInformation->usesInvariant = true;
        else if (auto* returnType = entryPoint.function.maybeReturnType()) {
            if (auto* structType = std::get_if<Types::Struct>(returnType->inferredType())) {
                for (const auto& member : structType->structure.members()) {
                    if (member.invariant()) {
                        m_entryPointInformation->usesInvariant = true;
                        break;
                    }
                }
            }
        }
        break;
    case ShaderStage::Fragment:
        m_entryPointInformation->typedEntryPoint = Reflection::Fragment { };
        break;
    }


    if (!it->value) {
        m_entryPointInformation->defaultLayout = { PipelineLayout { } };
        m_generatedLayout = &*m_entryPointInformation->defaultLayout;
    } else {
        m_generatedLayout = nullptr;
        collectDynamicOffsetGlobals(*it->value);
    }

    visit(entryPoint.function);
    if (hasError())
        return AST::Visitor::result().error();

    if (m_reads.isEmpty()) {
        insertDynamicOffsetsBufferIfNeeded(entryPoint.function);
        return std::nullopt;
    }

    auto maybeUsedGlobals = determineUsedGlobals(entryPoint);
    if (!maybeUsedGlobals) {
        insertDynamicOffsetsBufferIfNeeded(entryPoint.function);
        return maybeUsedGlobals.error();
    }
    auto usedGlobals = *maybeUsedGlobals;
    auto maybeGroups = m_generatedLayout ? Result<Vector<unsigned>>(insertStructs(usedGlobals.resources)) : insertStructs(*it->value, usedGlobals.resources);
    if (!maybeGroups) {
        insertDynamicOffsetsBufferIfNeeded(entryPoint.function);
        return maybeGroups.error();
    }
    insertParameters(entryPoint.function, *maybeGroups);
    insertMaterializations(entryPoint.function, usedGlobals.resources);
    insertLocalDefinitions(entryPoint.function, usedGlobals.privateGlobals);
    validateUsedGlobals(usedGlobals);

    for (auto* global : usedGlobals.privateGlobals) {
        if (!global || !global->declaration)
            continue;
        auto* variable = global->declaration;
        if (variable->addressSpace() == AddressSpace::Workgroup)
            m_entryPointInformation->sizeForWorkgroupVariables += getRoundedSize(*variable);
    }
    return std::nullopt;
}

void RewriteGlobalVariables::validateUsedGlobals(const UsedGlobals& usedGlobals) const
{
    const auto& validateGlobal = [&](const Global* global) {
        auto* variable = global->declaration;
        if (auto* initializer = variable->maybeInitializer()) {
            if (initializer->constantValue())
                return;
            m_shaderModule.addOverrideValidation([&shaderModule = m_shaderModule, initializer](auto& overrideValues) -> std::optional<Error> {
                auto maybeValue = shaderModule.ensureOverrideValue(*initializer, overrideValues);
                if (!maybeValue)
                    return maybeValue.error();
                return std::nullopt;
            });
        }
    };

    for (const auto* global : usedGlobals.privateGlobals)
        validateGlobal(global);

    for (const auto& [_, bindings] : usedGlobals.resources) {
        for (const auto& [_, global] : bindings)
            validateGlobal(global);
    }
}

void RewriteGlobalVariables::collectDynamicOffsetGlobals(const PipelineLayout& pipelineLayout)
{
    unsigned group = 0;
    for (const auto& bindGroupLayout : pipelineLayout.bindGroupLayouts) {
        for (const auto& entry : bindGroupLayout.entries) {
            if (!entry.visibility.contains(m_stage))
                continue;

            auto bufferDynamicOffset = [&] {
                switch (m_stage) {
                case ShaderStage::Vertex:
                    return entry.vertexBufferDynamicOffset;
                case ShaderStage::Fragment:
                    return entry.fragmentBufferDynamicOffset;
                case ShaderStage::Compute:
                    return entry.computeBufferDynamicOffset;
                }
            }();

            if (!bufferDynamicOffset.has_value())
                continue;

            m_globalsUsingDynamicOffset.add({ group + 1, entry.binding + 1 }, *bufferDynamicOffset);
        }
        ++group;
    }
}

static WGSL::StorageTextureAccess NODELETE convertAccess(const AccessMode accessMode)
{
    switch (accessMode) {
    case AccessMode::Read:
        return WGSL::StorageTextureAccess::ReadOnly;
    case AccessMode::ReadWrite:
        return WGSL::StorageTextureAccess::ReadWrite;
    case AccessMode::Write:
        return WGSL::StorageTextureAccess::WriteOnly;
    }
}

static BindGroupLayoutEntry::BindingMember bindingMemberForGlobal(auto& global)
{
    auto* variable = global.declaration;
    ASSERT(variable);
    auto* maybeReference = variable->maybeReferenceType();
    auto* type = variable->storeType();
    ASSERT(type);
    auto addressSpace = [&]() {
        if (maybeReference) {
            auto& reference = downcast<AST::ReferenceTypeExpression>(*maybeReference);
            auto* referenceType = std::get_if<Types::Reference>(reference.inferredType());
            if (referenceType && referenceType->addressSpace == AddressSpace::Storage)
                return referenceType->accessMode == AccessMode::Read ? BufferBindingType::ReadOnlyStorage : BufferBindingType::Storage;
        }

        return BufferBindingType::Uniform;
    };

    using namespace WGSL::Types;
    return WTF::switchOn(*type, [&](const Primitive& primitive) -> BindGroupLayoutEntry::BindingMember {
        switch (primitive.kind) {
        case Types::Primitive::AbstractInt:
        case Types::Primitive::I32:
        case Types::Primitive::U32:
        case Types::Primitive::AbstractFloat:
        case Types::Primitive::F32:
        case Types::Primitive::F16:
        case Types::Primitive::Void:
        case Types::Primitive::Bool:
            return BufferBindingLayout {
                .type = addressSpace(),
                .hasDynamicOffset = false,
                .minBindingSize = type->size()
            };
        case Types::Primitive::Sampler:
            return SamplerBindingLayout {
                .type = SamplerBindingType::Filtering
            };
        case Types::Primitive::SamplerComparison:
            return SamplerBindingLayout {
                .type = SamplerBindingType::Comparison
            };
        case Types::Primitive::TextureExternal:
            return ExternalTextureBindingLayout { };
        case Types::Primitive::AccessMode:
        case Types::Primitive::TexelFormat:
        case Types::Primitive::AddressSpace:
            RELEASE_ASSERT_NOT_REACHED();
        }
    }, [&](const Vector& vector) -> BindGroupLayoutEntry::BindingMember {
        auto* primitive = std::get_if<Primitive>(vector.element);
        UNUSED_PARAM(primitive);
        return BufferBindingLayout {
            .type = addressSpace(),
            .hasDynamicOffset = false,
            .minBindingSize = type->size()
        };
    }, [&](const Matrix& matrix) -> BindGroupLayoutEntry::BindingMember {
        UNUSED_PARAM(matrix);
        return BufferBindingLayout {
            .type = addressSpace(),
            .hasDynamicOffset = false,
            .minBindingSize = type->size()
        };
    }, [&](const Array& array) -> BindGroupLayoutEntry::BindingMember {
        UNUSED_PARAM(array);
        return BufferBindingLayout {
            .type = addressSpace(),
            .hasDynamicOffset = false,
            .minBindingSize = type->size()
        };
    }, [&](const Struct& structure) -> BindGroupLayoutEntry::BindingMember {
        UNUSED_PARAM(structure);
        return BufferBindingLayout {
            .type = addressSpace(),
            .hasDynamicOffset = false,
            .minBindingSize = type->size()
        };
    }, [&](const Texture& texture) -> BindGroupLayoutEntry::BindingMember {
        TextureViewDimension viewDimension;
        bool multisampled = false;
        switch (texture.kind) {
        case Types::Texture::Kind::Texture1d:
            viewDimension = TextureViewDimension::OneDimensional;
            break;
        case Types::Texture::Kind::Texture2d:
            viewDimension = TextureViewDimension::TwoDimensional;
            break;
        case Types::Texture::Kind::Texture2dArray:
            viewDimension = TextureViewDimension::TwoDimensionalArray;
            break;
        case Types::Texture::Kind::Texture3d:
            viewDimension = TextureViewDimension::ThreeDimensional;
            break;
        case Types::Texture::Kind::TextureCube:
            viewDimension = TextureViewDimension::Cube;
            break;
        case Types::Texture::Kind::TextureCubeArray:
            viewDimension = TextureViewDimension::CubeArray;
            break;
        case Types::Texture::Kind::TextureMultisampled2d:
            viewDimension = TextureViewDimension::TwoDimensional;
            multisampled = true;
            break;
        }

        return TextureBindingLayout {
            .sampleType = TextureSampleType::UnfilterableFloat,
            .viewDimension = viewDimension,
            .multisampled = multisampled
        };
    }, [&](const TextureStorage& texture) -> BindGroupLayoutEntry::BindingMember {
        TextureViewDimension viewDimension;
        switch (texture.kind) {
        case Types::TextureStorage::Kind::TextureStorage1d:
            viewDimension = TextureViewDimension::OneDimensional;
            break;
        case Types::TextureStorage::Kind::TextureStorage2d:
            viewDimension = TextureViewDimension::TwoDimensional;
            break;
        case Types::TextureStorage::Kind::TextureStorage2dArray:
            viewDimension = TextureViewDimension::TwoDimensionalArray;
            break;
        case Types::TextureStorage::Kind::TextureStorage3d:
            viewDimension = TextureViewDimension::ThreeDimensional;
            break;
        }

        return StorageTextureBindingLayout {
            .access = convertAccess(texture.access),
            .format = texture.format,
            .viewDimension = viewDimension
        };
    }, [&](const TextureDepth& texture) -> BindGroupLayoutEntry::BindingMember {
        TextureViewDimension viewDimension;
        bool multisampled = false;
        switch (texture.kind) {
        case Types::TextureDepth::Kind::TextureDepth2d:
            viewDimension = TextureViewDimension::TwoDimensional;
            break;
        case Types::TextureDepth::Kind::TextureDepth2dArray:
            viewDimension = TextureViewDimension::TwoDimensionalArray;
            break;
        case Types::TextureDepth::Kind::TextureDepthCube:
            viewDimension = TextureViewDimension::Cube;
            break;
        case Types::TextureDepth::Kind::TextureDepthCubeArray:
            viewDimension = TextureViewDimension::CubeArray;
            break;
        case Types::TextureDepth::Kind::TextureDepthMultisampled2d:
            viewDimension = TextureViewDimension::TwoDimensional;
            multisampled = true;
            break;
        }

        return TextureBindingLayout {
            .sampleType = TextureSampleType::Depth,
            .viewDimension = viewDimension,
            .multisampled = multisampled
        };
    }, [&](const Atomic&) -> BindGroupLayoutEntry::BindingMember {
        return BufferBindingLayout {
            .type = addressSpace(),
            .hasDynamicOffset = false,
            .minBindingSize = type->size()
        };
    }, [&](const PrimitiveStruct&) -> BindGroupLayoutEntry::BindingMember {
        RELEASE_ASSERT_NOT_REACHED();
    }, [&](const Reference&) -> BindGroupLayoutEntry::BindingMember {
        RELEASE_ASSERT_NOT_REACHED();
    }, [&](const Pointer&) -> BindGroupLayoutEntry::BindingMember {
        RELEASE_ASSERT_NOT_REACHED();
    }, [&](const Function&) -> BindGroupLayoutEntry::BindingMember {
        RELEASE_ASSERT_NOT_REACHED();
    }, [&](const TypeConstructor&) -> BindGroupLayoutEntry::BindingMember {
        RELEASE_ASSERT_NOT_REACHED();
    });
}

auto RewriteGlobalVariables::determineUsedGlobals(const CallGraph::EntryPoint& entryPoint) -> Result<UsedGlobals>
{
    UsedGlobals usedGlobals;
    const auto& function = entryPoint.function;

    // https://www.w3.org/TR/WGSL/#limits
    constexpr unsigned maximumCombinedPrivateVariablesSize = 8192;
    unsigned maximumCombinedWorkgroupVariablesSize = m_shaderModule.configuration().maximumCombinedWorkgroupVariablesSize;
    Vector<const Type*, 16> workgroupVariables;
    Vector<const Type*, 16> privateVariables;


    for (const auto& globalName : m_reads) {
        auto it = m_globals.find(globalName);
        RELEASE_ASSERT(it != m_globals.end());
        auto& global = it->value;
        AST::Variable& variable = *global.declaration;
        switch (variable.flavor()) {
        case AST::VariableFlavor::Override:
            usesOverride(variable);
            continue;
        case AST::VariableFlavor::Var:
        case AST::VariableFlavor::Let:
        case AST::VariableFlavor::Const:
            if (!global.resource.has_value()) {
                usedGlobals.privateGlobals.append(&global);

                if (auto* qualifier = variable.maybeQualifier(); qualifier && qualifier->addressSpace() == AddressSpace::Workgroup)
                    workgroupVariables.append(variable.storeType());
                else
                    privateVariables.append(variable.storeType());
                continue;
            }
            break;
        }

        auto group = global.resource->group;
        auto binding = global.resource->binding;
        auto groupResult = usedGlobals.resources.add(group, IndexMap<const Global*>());
        auto bindingResult = groupResult.iterator->value.add(binding, &global);
        ASSERT_UNUSED(bindingResult, bindingResult.isNewEntry);
    }

    m_shaderModule.addOverrideValidation([span = function.span(), variables = WTF::move(workgroupVariables), maximumCombinedWorkgroupVariablesSize](auto&) -> std::optional<Error> {
        CheckedUint32 combinedWorkgroupVariablesSize = 0;
        for (const Type* type : variables)
            combinedWorkgroupVariablesSize += type->size();
        if (combinedWorkgroupVariablesSize.hasOverflowed() || combinedWorkgroupVariablesSize.value() > maximumCombinedWorkgroupVariablesSize) [[unlikely]]
            return { Error(makeString("The combined byte size of all variables in the workgroup address space exceeds "_s, String::number(maximumCombinedWorkgroupVariablesSize), " bytes"_s), span) };
        return std::nullopt;
    });
    m_shaderModule.addOverrideValidation([span = function.span(), variables = WTF::move(privateVariables)](auto&) -> std::optional<Error> {
        CheckedUint32 combinedPrivateVariablesSize = 0;
        for (const Type* type : variables)
            combinedPrivateVariablesSize += type->size();
        if (combinedPrivateVariablesSize.hasOverflowed() || combinedPrivateVariablesSize.value() > maximumCombinedPrivateVariablesSize) [[unlikely]]
            return { Error(makeString("The combined byte size of all variables in the private address space exceeds "_s, String::number(maximumCombinedPrivateVariablesSize), " bytes"_s), span) };
        return std::nullopt;
    });


    return usedGlobals;
}

void RewriteGlobalVariables::usesOverride(AST::Variable& variable)
{
    Reflection::SpecializationConstantType constantType;
    const Type* type = variable.storeType();
    ASSERT(std::holds_alternative<Types::Primitive>(*type));
    const auto& primitive = std::get<Types::Primitive>(*type);
    switch (primitive.kind) {
    case Types::Primitive::Bool:
        constantType = Reflection::SpecializationConstantType::Boolean;
        break;
    case Types::Primitive::F32:
        constantType = Reflection::SpecializationConstantType::Float;
        break;
    case Types::Primitive::F16:
        constantType = Reflection::SpecializationConstantType::Half;
        break;
    case Types::Primitive::I32:
        constantType = Reflection::SpecializationConstantType::Int;
        break;
    case Types::Primitive::U32:
        constantType = Reflection::SpecializationConstantType::Unsigned;
        break;
    case Types::Primitive::Void:
    case Types::Primitive::AbstractInt:
    case Types::Primitive::AbstractFloat:
    case Types::Primitive::Sampler:
    case Types::Primitive::SamplerComparison:
    case Types::Primitive::TextureExternal:
    case Types::Primitive::AccessMode:
    case Types::Primitive::TexelFormat:
    case Types::Primitive::AddressSpace:
        RELEASE_ASSERT_NOT_REACHED();
    }

    String entryName = variable.originalName();
    if (variable.id())
        entryName = String::number(*variable.id());
    m_entryPointInformation->specializationConstants.add(entryName, Reflection::SpecializationConstant { variable.name(), constantType, variable.maybeInitializer() });
}

enum class BindingType {
    Undefined,
    Buffer,
    Texture,
    TextureMultisampled,
    TextureStorageReadOnly,
    TextureStorageReadWrite,
    TextureStorageWriteOnly,
    Sampler,
    SamplerComparison,
    TextureExternal,
};

static BindingType NODELETE bindingTypeForPrimitive(const Types::Primitive& primitive)
{
    switch (primitive.kind) {
    case Types::Primitive::AbstractInt:
    case Types::Primitive::AbstractFloat:
    case Types::Primitive::I32:
    case Types::Primitive::U32:
    case Types::Primitive::F32:
    case Types::Primitive::F16:
    case Types::Primitive::Bool:
    case Types::Primitive::Void:
        return BindingType::Buffer;
    case Types::Primitive::Sampler:
        return BindingType::Sampler;
    case Types::Primitive::SamplerComparison:
        return BindingType::SamplerComparison;

    case Types::Primitive::TextureExternal:
        return BindingType::TextureExternal;

    case Types::Primitive::AccessMode:
    case Types::Primitive::TexelFormat:
    case Types::Primitive::AddressSpace:
        return BindingType::Undefined;
    }
}

static BindingType bindingTypeForType(const Type* type)
{
    if (!type)
        return BindingType::Undefined;

    return WTF::switchOn(*type,
        [&](const Types::Primitive& primitive) {
            return bindingTypeForPrimitive(primitive);
        },
        [&](const Types::Vector&) {
            return BindingType::Buffer;
        },
        [&](const Types::Array&) -> BindingType {
            return BindingType::Buffer;
        },
        [&](const Types::Struct&) -> BindingType {
            return BindingType::Buffer;
        },
        [&](const Types::PrimitiveStruct&) -> BindingType {
            return BindingType::Buffer;
        },
        [&](const Types::Matrix&) {
            return BindingType::Buffer;
        },
        [&](const Types::Reference&) -> BindingType {
            return BindingType::Buffer;
        },
        [&](const Types::Pointer&) -> BindingType {
            return BindingType::Buffer;
        },
        [&](const Types::Function&) -> BindingType {
            RELEASE_ASSERT_NOT_REACHED();
        },
        [&](const Types::Texture& texture) {
        return texture.kind == Types::Texture::Kind::TextureMultisampled2d ? BindingType::TextureMultisampled : BindingType::Texture;
        },
        [&](const Types::TextureStorage& storageTexture) {
        switch (storageTexture.access) {
        case AccessMode::Read:
            return BindingType::TextureStorageReadOnly;
        case AccessMode::ReadWrite:
            return BindingType::TextureStorageReadWrite;
        case AccessMode::Write:
            return BindingType::TextureStorageWriteOnly;
        }
        },
        [&](const Types::TextureDepth& texture) {
            return texture.kind == Types::TextureDepth::Kind::TextureDepthMultisampled2d ? BindingType::TextureMultisampled : BindingType::Texture;
        },
        [&](const Types::Atomic&) -> BindingType {
            return BindingType::Buffer;
        },
        [&](const Types::TypeConstructor&) -> BindingType {
            RELEASE_ASSERT_NOT_REACHED();
        });
}

static bool isExternalTexture(const AST::Variable& variable)
{
    return bindingTypeForType(variable.storeType()) == BindingType::TextureExternal;
}

Vector<unsigned> RewriteGlobalVariables::insertStructs(const UsedResources& usedResources)
{
    Vector<unsigned> groups;
    for (auto& groupBinding : m_groupBindingMap) {
        auto usedResource = usedResources.find(groupBinding.key);
        if (usedResource == usedResources.end())
            continue;

        auto& bindingGlobalMap = groupBinding.value;
        const IndexMap<const Global*>& usedBindings = usedResource->value;

        Vector<std::pair<unsigned, AST::StructureMember*>> entries;
        unsigned metalId = 0;
        HashMap<AST::Variable*, unsigned> bufferSizeToOwnerMap;
        for (auto [binding, globalName] : bindingGlobalMap) {
            unsigned group = groupBinding.key;
            auto it = m_globals.find(globalName);
            RELEASE_ASSERT(it != m_globals.end());
            auto& global = it->value;

            if (auto bufferIt = m_reverseBufferLengthMap.find(global.declaration); bufferIt != m_reverseBufferLengthMap.end()) {
                if (isExternalTexture(*bufferIt->value))
                    continue;
                if (bufferIt->value->addressSpace() != AddressSpace::Storage)
                    continue;
                if (!bufferSizeToOwnerMap.contains(global.declaration))
                    continue;
            } else if (!usedBindings.contains(binding))
                continue;
            else if (!m_reads.contains(globalName))
                continue;
            ASSERT(global.declaration->maybeTypeName());

            entries.append({ metalId, &createArgumentBufferEntry(metalId, *global.declaration) });

            if (auto it = m_generateLayoutGroupMapping.find(groupBinding.key); it != m_generateLayoutGroupMapping.end())
                group = it->value;
            else {
                auto newGroup = m_generatedLayout->bindGroupLayouts.size();
                m_generateLayoutGroupMapping.add(group, newGroup);
                m_generatedLayout->bindGroupLayouts.append({ group, { } });
                group = newGroup;
            }

            BindGroupLayoutEntry entry {
                .binding = metalId,
                .webBinding = global.resource->binding,
                .visibility = m_stage,
                .bindingMember = bindingMemberForGlobal(global),
                .name = global.declaration->name(),
                .vertexArgumentBufferIndex = std::nullopt,
                .vertexArgumentBufferSizeIndex = std::nullopt,
                .vertexBufferDynamicOffset = std::nullopt,
                .fragmentArgumentBufferIndex = std::nullopt,
                .fragmentArgumentBufferSizeIndex = std::nullopt,
                .fragmentBufferDynamicOffset = std::nullopt,
                .computeArgumentBufferIndex = std::nullopt,
                .computeArgumentBufferSizeIndex = std::nullopt,
                .computeBufferDynamicOffset = std::nullopt
            };

            auto bufferSizeIt = m_bufferLengthMap.find(global.declaration);
            if (bufferSizeIt != m_bufferLengthMap.end()) {
                auto* variable = bufferSizeIt->value;
                bufferSizeToOwnerMap.add(variable, m_generatedLayout->bindGroupLayouts[group].entries.size());
            } else if (auto ownerIt = bufferSizeToOwnerMap.find(global.declaration); ownerIt != bufferSizeToOwnerMap.end()) {
                // FIXME: <rdar://150369108> since we only ever generate a layout
                // for one shader stage at a time, we always store the indices in
                // the vertex slot, but we should use a structs to pass information
                // from the compiler to the API (instead of reusing the same struct
                // the API uses to pass information to the compiler)
                m_generatedLayout->bindGroupLayouts[group].entries[ownerIt->value].vertexArgumentBufferSizeIndex = metalId;
            }

            auto* type = global.declaration->storeType();
            if (isPrimitive(type, Types::Primitive::TextureExternal))
                metalId += 4;
            else
                ++metalId;

            m_generatedLayout->bindGroupLayouts[group].entries.append(WTF::move(entry));
        }

        if (entries.isEmpty())
            continue;

        groups.append(groupBinding.key);
        finalizeArgumentBufferStruct(groupBinding.key, entries);
    }
    return groups;
}

AST::StructureMember& RewriteGlobalVariables::createArgumentBufferEntry(unsigned binding, AST::Variable& variable)
{
    return createArgumentBufferEntry(binding, variable.span(), variable.name(), *variable.maybeReferenceType());
}


AST::StructureMember& RewriteGlobalVariables::createArgumentBufferEntry(unsigned binding, const SourceSpan& span, const String& name, AST::Expression& type)
{
    auto& bindingValue = m_shaderModule.astBuilder().construct<AST::AbstractIntegerLiteral>(span, binding);
    bindingValue.m_inferredType = m_shaderModule.types().abstractIntType();
    bindingValue.setConstantValue(binding);
    auto& bindingAttribute = m_shaderModule.astBuilder().construct<AST::BindingAttribute>(span, bindingValue);
    ++m_entryPointInformation->bindingCount;
    return m_shaderModule.astBuilder().construct<AST::StructureMember>(
        span,
        AST::Identifier::make(name),
        type,
        AST::Attribute::List { bindingAttribute }
    );
}

void RewriteGlobalVariables::finalizeArgumentBufferStruct(unsigned group, Vector<std::pair<unsigned, AST::StructureMember*>>& entries)
{
    std::ranges::sort(entries, { }, &std::pair<unsigned, AST::StructureMember*>::first);

    AST::StructureMember::List structMembers;
    for (auto& [_, member] : entries)
        structMembers.append(*member);

    auto& argumentBufferStruct = m_shaderModule.astBuilder().construct<AST::Structure>(
        SourceSpan::empty(),
        argumentBufferStructName(group),
        WTF::move(structMembers),
        AST::StructureRole::BindGroup
    );
    argumentBufferStruct.m_inferredType = m_shaderModule.types().structType(argumentBufferStruct);
    m_shaderModule.append(m_shaderModule.declarations(), argumentBufferStruct);
    m_structTypes.add(group, argumentBufferStruct.m_inferredType);
}

static AddressSpace addressSpaceForBindingMember(const BindGroupLayoutEntry::BindingMember& bindingMember)
{
    return WTF::switchOn(bindingMember, [](const BufferBindingLayout& bufferBinding) {
        switch (bufferBinding.type) {
        case BufferBindingType::Uniform:
            return AddressSpace::Uniform;
        case BufferBindingType::Storage:
            return AddressSpace::Storage;
        case BufferBindingType::ReadOnlyStorage:
            return AddressSpace::Storage;
        }
    }, [](const SamplerBindingLayout&) {
        return AddressSpace::Handle;
    }, [](const TextureBindingLayout&) {
        return AddressSpace::Handle;
    }, [](const StorageTextureBindingLayout&) {
        return AddressSpace::Handle;
    }, [](const ExternalTextureBindingLayout&) {
        return AddressSpace::Handle;
    });
}

static AccessMode accessModeForBindingMember(const BindGroupLayoutEntry::BindingMember& bindingMember)
{
    return WTF::switchOn(bindingMember, [](const BufferBindingLayout& bufferBinding) {
        switch (bufferBinding.type) {
        case BufferBindingType::Uniform:
            return AccessMode::Read;
        case BufferBindingType::Storage:
            return AccessMode::ReadWrite;
        case BufferBindingType::ReadOnlyStorage:
            return AccessMode::Read;
        }
    }, [](const SamplerBindingLayout&) {
        return AccessMode::Read;
    }, [](const TextureBindingLayout&) {
        return AccessMode::Read;
    }, [](const StorageTextureBindingLayout&) {
        return AccessMode::Read;
    }, [](const ExternalTextureBindingLayout&) {
        return AccessMode::Read;
    });
}

static bool isBuffer(const AST::Variable& variable)
{
    return bindingTypeForType(variable.storeType()) == BindingType::Buffer;
}

static bool isSampler(const AST::Variable& variable, SamplerBindingType bindingType)
{
    switch (bindingType) {
    case SamplerBindingType::Filtering:
    case SamplerBindingType::NonFiltering:
        return bindingTypeForType(variable.storeType()) == BindingType::Sampler;
    case SamplerBindingType::Comparison:
        return bindingTypeForType(variable.storeType()) == BindingType::SamplerComparison;
    }
}

static bool NODELETE textureKindEqualsViewDimension(Types::Texture::Kind kind, TextureViewDimension viewDimension, bool isMultisampled, TextureSampleType sampleType)
{
    if (isMultisampled)
        return kind == Types::Texture::Kind::TextureMultisampled2d && viewDimension == TextureViewDimension::TwoDimensional;

    switch (viewDimension) {
    case TextureViewDimension::OneDimensional:
        return kind == Types::Texture::Kind::Texture1d && sampleType != TextureSampleType::Depth;
    case TextureViewDimension::TwoDimensional:
        return kind == Types::Texture::Kind::Texture2d;
    case TextureViewDimension::TwoDimensionalArray:
        return kind == Types::Texture::Kind::Texture2dArray;
    case TextureViewDimension::Cube:
        return kind == Types::Texture::Kind::TextureCube;
    case TextureViewDimension::CubeArray:
        return kind == Types::Texture::Kind::TextureCubeArray;
    case TextureViewDimension::ThreeDimensional:
        return kind == Types::Texture::Kind::Texture3d && sampleType != TextureSampleType::Depth;
    }

    return false;
}

static bool NODELETE depthTextureKindEqualsViewDimension(Types::TextureDepth::Kind kind, TextureViewDimension viewDimension, bool isMultisampled)
{
    if (isMultisampled)
        return kind == Types::TextureDepth::Kind::TextureDepthMultisampled2d && viewDimension == TextureViewDimension::TwoDimensional;

    switch (viewDimension) {
    case TextureViewDimension::OneDimensional:
        return false;
    case TextureViewDimension::TwoDimensional:
        return kind == Types::TextureDepth::Kind::TextureDepth2d;
    case TextureViewDimension::TwoDimensionalArray:
        return kind == Types::TextureDepth::Kind::TextureDepth2dArray;
    case TextureViewDimension::Cube:
        return kind == Types::TextureDepth::Kind::TextureDepthCube;
    case TextureViewDimension::CubeArray:
        return kind == Types::TextureDepth::Kind::TextureDepthCubeArray;
    case TextureViewDimension::ThreeDimensional:
        return false;
    }

    return false;
}

static ASCIILiteral nameForBindingType(BindingType bindingType)
{
    switch (bindingType) {
    default:
    case BindingType::Undefined:
        return "Undefined"_s;
    case BindingType::Buffer:
        return "Buffer"_s;
    case BindingType::Texture:
        return "Texture"_s;
    case BindingType::TextureMultisampled:
        return "TextureMultisampled"_s;
    case BindingType::TextureStorageReadOnly:
        return "TextureStorageReadOnly"_s;
    case BindingType::TextureStorageReadWrite:
        return "TextureStorageReadWrite"_s;
    case BindingType::TextureStorageWriteOnly:
        return "TextureStorageWriteOnly"_s;
    case BindingType::Sampler:
        return "Sampler"_s;
    case BindingType::SamplerComparison:
        return "SamplerComparison"_s;
    case BindingType::TextureExternal:
        return "TextureExternal"_s;
    }
}

static ASCIILiteral nameForTextureSampleType(TextureSampleType sampleType)
{
    switch (sampleType) {
    case TextureSampleType::Float:
        return "Float"_s;
    case TextureSampleType::UnfilterableFloat:
        return "UnfilterableFloat"_s;
    case TextureSampleType::Depth:
        return "Depth"_s;
    case TextureSampleType::SignedInt:
        return "SignedInt"_s;
    case TextureSampleType::UnsignedInt:
        return "UnsignedInt"_s;
    default:
        return "Undefined"_s;
    }
}

static ASCIILiteral nameForTextureDepthKind(Types::TextureDepth::Kind kind)
{
    switch (kind) {
    case Types::TextureDepth::Kind::TextureDepth2d:
        return "TextureDepth2d"_s;
    case Types::TextureDepth::Kind::TextureDepth2dArray:
        return "TextureDepth2d"_s;
    case Types::TextureDepth::Kind::TextureDepthCube:
        return "TextureDepth2d"_s;
    case Types::TextureDepth::Kind::TextureDepthCubeArray:
        return "TextureDepth2d"_s;
    case Types::TextureDepth::Kind::TextureDepthMultisampled2d:
        return "Texture2d"_s;
    default:
        return "Undefined"_s;
    }
}

static ASCIILiteral nameForTextureKind(Types::Texture::Kind kind)
{
    switch (kind) {
    case Types::Texture::Kind::Texture1d:
        return "Texture1d"_s;
    case Types::Texture::Kind::Texture2d:
        return "Texture2d"_s;
    case Types::Texture::Kind::Texture2dArray:
        return "Texture2d"_s;
    case Types::Texture::Kind::TextureCube:
        return "Texture2d"_s;
    case Types::Texture::Kind::TextureCubeArray:
        return "Texture2d"_s;
    case Types::Texture::Kind::TextureMultisampled2d:
        return "Texture2d"_s;
    case Types::Texture::Kind::Texture3d:
        return "Texture3d"_s;
    default:
        return "Undefined"_s;
    }
}

static ASCIILiteral nameForTextureViewDimension(TextureViewDimension viewDimension)
{
    switch (viewDimension) {
    case TextureViewDimension::OneDimensional:
        return "1d"_s;
    case TextureViewDimension::TwoDimensional:
        return "2d"_s;
    case TextureViewDimension::TwoDimensionalArray:
        return "2d_array"_s;
    case TextureViewDimension::Cube:
        return "cube"_s;
    case TextureViewDimension::CubeArray:
        return "cube-array"_s;
    case TextureViewDimension::ThreeDimensional:
        return "3d"_s;
    }

    return "undefined"_s;
}

static ASCIILiteral nameForPrimitiveKind(Types::Primitive::Kind primitiveKind)
{
    switch (primitiveKind) {
    case Types::Primitive::AbstractInt:
        return "<AbstractInt>"_s;
    case Types::Primitive::I32:
        return "int32"_s;
    case Types::Primitive::U32:
        return "uint32"_s;
    case Types::Primitive::AbstractFloat:
        return "<AbstractFloat>"_s;
    case Types::Primitive::F16:
        return "f16"_s;
    case Types::Primitive::F32:
        return "f32"_s;
    case Types::Primitive::Void:
        return "void"_s;
    case Types::Primitive::Bool:
        return "bool"_s;
    case Types::Primitive::Sampler:
        return "sampler"_s;
    case Types::Primitive::SamplerComparison:
        return "sampler_comparion"_s;
    case Types::Primitive::TextureExternal:
        return "texture_external"_s;
    case Types::Primitive::AccessMode:
        return "access_mode"_s;
    case Types::Primitive::TexelFormat:
        return "texel_format"_s;
    case Types::Primitive::AddressSpace:
        return "address_space"_s;
    }

    return "undefined"_s;
}

static String errorValidatingTexture(const AST::Variable& variable, const TextureBindingLayout& textureBinding)
{
    bool isMultisampled = textureBinding.multisampled;
    auto targetValue = isMultisampled ? BindingType::TextureMultisampled : BindingType::Texture;
    auto storeType = variable.storeType();
    auto bindingForType = bindingTypeForType(storeType);
    if (bindingForType != targetValue)
        return makeString("types don't match: WGSL type "_s, nameForBindingType(bindingForType), " target type "_s, nameForBindingType(targetValue));

    auto sampleType = textureBinding.sampleType;
    const Types::Texture* possibleTexture = std::get_if<Types::Texture>(storeType);
    if (!possibleTexture) {
        const Types::TextureDepth* possibleTextureDepth = std::get_if<Types::TextureDepth>(storeType);
        if (!possibleTextureDepth || sampleType != TextureSampleType::Depth)
            return makeString("depth validation failed: "_s, nameForTextureSampleType(sampleType));

        bool result = depthTextureKindEqualsViewDimension(possibleTextureDepth->kind, textureBinding.viewDimension, isMultisampled);
        if (!result)
            return makeString("viewDimensions don't match: "_s, nameForTextureDepthKind(possibleTextureDepth->kind), ", textureBinding view dimension "_s, nameForTextureViewDimension(textureBinding.viewDimension), ", multisampled = "_s, isMultisampled ? "yes"_s : "no"_s);

        return emptyString();
    }

    if (!textureKindEqualsViewDimension(possibleTexture->kind, textureBinding.viewDimension, isMultisampled, sampleType) || !possibleTexture->element)
        return makeString("viewDimensions don't match: "_s, nameForTextureKind(possibleTexture->kind), ", bindingViewDimension = "_s, nameForTextureViewDimension(textureBinding.viewDimension), ", multisampled = "_s, isMultisampled ? "yes"_s : "no"_s, ", bindingSampleType = "_s, nameForTextureSampleType(sampleType));

    bool result = false;
    if (const auto* primitive = std::get_if<Types::Primitive>(possibleTexture->element)) {
        switch (sampleType) {
        case TextureSampleType::Float:
        case TextureSampleType::UnfilterableFloat:
            result = primitive->kind == Types::Primitive::F32 || primitive->kind == Types::Primitive::F16;
            break;
        case TextureSampleType::Depth:
            break;
        case TextureSampleType::SignedInt:
            result = primitive->kind == Types::Primitive::I32;
            break;
        case TextureSampleType::UnsignedInt:
            result = primitive->kind == Types::Primitive::U32;
            break;
        }

        if (!result)
            return makeString("element types don't match: sampleType "_s, nameForTextureSampleType(sampleType), ", primitive->kind "_s, nameForPrimitiveKind(primitive->kind));
    }

    if (!result)
        return makeString("WGSL texture has no elementType: sampleType "_s, nameForTextureSampleType(sampleType));

    return emptyString();
}

static bool NODELETE storageTextureKindEqualsViewDimension(Types::TextureStorage::Kind kind, TextureViewDimension viewDimension)
{
    switch (viewDimension) {
    case TextureViewDimension::OneDimensional:
        return kind == Types::TextureStorage::Kind::TextureStorage1d;
    case TextureViewDimension::TwoDimensional:
        return kind == Types::TextureStorage::Kind::TextureStorage2d;
    case TextureViewDimension::TwoDimensionalArray:
        return kind == Types::TextureStorage::Kind::TextureStorage2dArray;
    case TextureViewDimension::Cube:
        return false;
    case TextureViewDimension::CubeArray:
        return false;
    case TextureViewDimension::ThreeDimensional:
        return kind == Types::TextureStorage::Kind::TextureStorage3d;
    }

    return false;
}

static bool isStorageTexture(const AST::Variable& variable, const StorageTextureBindingLayout& storageTexture)
{
    auto textureAccess = storageTexture.access;
    auto storeType = variable.storeType();
    const Types::TextureStorage* possibleStorageTexture = std::get_if<Types::TextureStorage>(storeType);
    if (!possibleStorageTexture)
        return false;

    if (!storageTextureKindEqualsViewDimension(possibleStorageTexture->kind, storageTexture.viewDimension) || possibleStorageTexture->format != storageTexture.format)
        return false;

    switch (bindingTypeForType(storeType)) {
    case BindingType::TextureStorageReadOnly:
        return textureAccess == StorageTextureAccess::ReadOnly;
    case BindingType::TextureStorageReadWrite:
        return textureAccess == StorageTextureAccess::ReadWrite;
    case BindingType::TextureStorageWriteOnly:
        return textureAccess == StorageTextureAccess::WriteOnly || textureAccess == StorageTextureAccess::ReadWrite;
    default:
        return false;
    }
}

static String errorValidatingTypes(const AST::Variable& variable, const BindGroupLayoutEntry::BindingMember& bindingMember)
{
    return WTF::switchOn(bindingMember, [&](const BufferBindingLayout&) {
        return isBuffer(variable) ? emptyString() : "WGSL variable is not a buffer"_s;
    }, [&](const SamplerBindingLayout& samplerBinding) {
        return isSampler(variable, samplerBinding.type) ? emptyString() : "WGSL variable is not a sampler"_s;
    }, [&](const TextureBindingLayout& textureBinding) {
        return errorValidatingTexture(variable, textureBinding);
    }, [&](const StorageTextureBindingLayout& storageTexture) {
        return isStorageTexture(variable, storageTexture) ? emptyString() : "WGSL variable is not a storage texture"_s;
    }, [&](const ExternalTextureBindingLayout&) {
        return isExternalTexture(variable) ? emptyString() : "WGSL variable is not an external texture"_s;
    });
}

static String errorValidatingVariableAndEntryMatch(const AST::Variable& variable, const BindGroupLayoutEntry& entry)
{
    if (auto error = errorValidatingTypes(variable, entry.bindingMember); error.length())
        return error;

    auto variableAddressSpace = variable.addressSpace();
    auto entryAddressSpace = addressSpaceForBindingMember(entry.bindingMember);
    if (variableAddressSpace && *variableAddressSpace != entryAddressSpace)
        return "variableAddressSpace != entryAddressSpace"_s;

    auto variableAccessMode = variable.accessMode();
    auto entryAccessMode = accessModeForBindingMember(entry.bindingMember);
    if (variableAccessMode && *variableAccessMode != entryAccessMode)
        return "variableAccessMode != entryAccessMode"_s;

    return emptyString();
}

Result<Vector<unsigned>> RewriteGlobalVariables::insertStructs(PipelineLayout& layout, const UsedResources& usedResources)
{
    Vector<unsigned> groups;
    unsigned group = 0;
    HashMap<AST::Variable*, BindGroupLayoutEntry*> serializedVariables;
    for (auto& bindGroupLayout : layout.bindGroupLayouts) {
        Vector<std::pair<unsigned, AST::StructureMember*>> entries;
        Vector<std::pair<unsigned, AST::Variable*>> bufferLengths;
        for (auto& entry : bindGroupLayout.entries) {
            if (!entry.visibility.contains(m_stage))
                continue;

            auto argumentBufferIndex = [&] {
                switch (m_stage) {
                case ShaderStage::Vertex:
                    return entry.vertexArgumentBufferIndex;
                case ShaderStage::Fragment:
                    return entry.fragmentArgumentBufferIndex;
                case ShaderStage::Compute:
                    return entry.computeArgumentBufferIndex;
                }
            }();
            auto argumentBufferSizeIndex = [&] {
                switch (m_stage) {
                case ShaderStage::Vertex:
                    return entry.vertexArgumentBufferSizeIndex;
                case ShaderStage::Fragment:
                    return entry.fragmentArgumentBufferSizeIndex;
                case ShaderStage::Compute:
                    return entry.computeArgumentBufferSizeIndex;
                }
            }();

            AST::Variable* variable = nullptr;

            auto globalIt = m_globalsByBinding.find({ group + 1, entry.binding + 1 });
            if (globalIt != m_globalsByBinding.end()) {
                auto groupIt = usedResources.find(group);
                if (groupIt != usedResources.end()) {
                    auto& bindings = groupIt->value;
                    auto bindingIt = bindings.find(entry.binding);
                    if (bindingIt != bindings.end()) {
                        variable = bindingIt->value->declaration;
                        serializedVariables.add(variable, &entry);
                        entries.append({ *argumentBufferIndex, &createArgumentBufferEntry(*argumentBufferIndex, *variable) });
                    }
                }
            }

            if (!variable) {
                auto& type = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(SourceSpan::empty(), AST::Identifier::make("void"_s));
                type.m_inferredType = WTF::switchOn(entry.bindingMember,
                    [&](const BufferBindingLayout& buffer) -> const Type* {
                        AddressSpace addressSpace;
                        AccessMode accessMode;
                        switch (buffer.type) {
                        case BufferBindingType::Uniform:
                            addressSpace = AddressSpace::Uniform;
                            accessMode = AccessMode::Read;
                            break;
                        case BufferBindingType::Storage:
                            addressSpace = AddressSpace::Storage;
                            accessMode = AccessMode::ReadWrite;
                            break;
                        case BufferBindingType::ReadOnlyStorage:
                            addressSpace = AddressSpace::Storage;
                            accessMode = AccessMode::Read;
                            break;
                        }
                        return m_shaderModule.types().pointerType(addressSpace, m_shaderModule.types().voidType(), accessMode);
                    },
                    [&](const SamplerBindingLayout&) -> const Type* {
                        return m_shaderModule.types().samplerType();
                    },
                    [&](const TextureBindingLayout& layout) -> const Type* {
                        const Type* sampleType;
                        switch (layout.sampleType) {
                        case TextureSampleType::Float:
                        case TextureSampleType::UnfilterableFloat:
                        case TextureSampleType::Depth:
                            sampleType = m_shaderModule.types().f32Type();
                            break;
                        case TextureSampleType::SignedInt:
                            sampleType = m_shaderModule.types().i32Type();
                            break;
                        case TextureSampleType::UnsignedInt:
                            sampleType = m_shaderModule.types().u32Type();
                            break;
                        }
                        Types::Texture::Kind textureKind;
                        switch (layout.viewDimension) {
                        case TextureViewDimension::OneDimensional:
                            textureKind = Types::Texture::Kind::Texture1d;
                            break;
                        case TextureViewDimension::TwoDimensional:
                            if (layout.multisampled)
                                textureKind = Types::Texture::Kind::TextureMultisampled2d;
                            else
                                textureKind = Types::Texture::Kind::Texture2d;
                            break;
                        case TextureViewDimension::TwoDimensionalArray:
                            textureKind = Types::Texture::Kind::Texture2dArray;
                            break;
                        case TextureViewDimension::Cube:
                            textureKind = Types::Texture::Kind::TextureCube;
                            break;
                        case TextureViewDimension::CubeArray:
                            textureKind = Types::Texture::Kind::TextureCubeArray;
                            break;
                        case TextureViewDimension::ThreeDimensional:
                            textureKind = Types::Texture::Kind::Texture3d;
                            break;
                        }
                        return m_shaderModule.types().textureType(textureKind, sampleType);
                    },
                    [&](const StorageTextureBindingLayout& layout) -> const Type* {
                        Types::TextureStorage::Kind textureStorageKind;
                        switch (layout.viewDimension) {
                        case TextureViewDimension::OneDimensional:
                            textureStorageKind = Types::TextureStorage::Kind::TextureStorage1d;
                            break;
                        case TextureViewDimension::TwoDimensional:
                            textureStorageKind = Types::TextureStorage::Kind::TextureStorage2d;
                            break;
                        case TextureViewDimension::TwoDimensionalArray:
                            textureStorageKind = Types::TextureStorage::Kind::TextureStorage2dArray;
                            break;
                        case TextureViewDimension::ThreeDimensional:
                            textureStorageKind = Types::TextureStorage::Kind::TextureStorage3d;
                            break;
                        default:
                            RELEASE_ASSERT_NOT_REACHED();
                        }
                        AccessMode accessMode;
                        switch (layout.access) {
                        case StorageTextureAccess::WriteOnly:
                            accessMode = AccessMode::Write;
                            break;
                        case StorageTextureAccess::ReadOnly:
                            accessMode = AccessMode::Read;
                            break;
                        case StorageTextureAccess::ReadWrite:
                            accessMode = AccessMode::ReadWrite;
                            break;
                        }
                        return m_shaderModule.types().textureStorageType(textureStorageKind, layout.format, accessMode);
                    },
                    [&](const ExternalTextureBindingLayout&) -> const Type* {
                        m_shaderModule.setUsesExternalTextures();
                        return m_shaderModule.types().textureExternalType();
                    });

                entries.append({
                    *argumentBufferIndex,
                    &createArgumentBufferEntry(*argumentBufferIndex, SourceSpan::empty(), makeString("__ArgumentBufferPlaceholder_"_s, String::number(*argumentBufferIndex)), type)
                });
            }

            if (argumentBufferSizeIndex.has_value())
                bufferLengths.append({ *argumentBufferSizeIndex, variable });
        }

        for (auto [binding, variable] : bufferLengths) {
            if (variable) {
                auto it = m_bufferLengthMap.find(variable);
                RELEASE_ASSERT(it != m_bufferLengthMap.end());
                serializedVariables.add(it->value, nullptr);
                entries.append({ binding, &createArgumentBufferEntry(binding, *it->value) });
            } else {
                entries.append({
                    binding,
                    &createArgumentBufferEntry(binding, SourceSpan::empty(), makeString("__ArgumentBufferPlaceholder_"_s, String::number(binding)), bufferLengthType())
                });
            }
        }

        if (entries.isEmpty()) {
            ++group;
            continue;
        }

        groups.append(group);
        finalizeArgumentBufferStruct(group++, entries);
    }

    for (auto& [_, bindingGlobalMap] : usedResources) {
        for (auto [_, global] : bindingGlobalMap) {
            auto* variable = global->declaration;
            if (auto entryIt = serializedVariables.find(variable); entryIt != serializedVariables.end() && entryIt->value) {
                if (auto error = errorValidatingVariableAndEntryMatch(*variable, *entryIt->value); error.length())
                    return makeUnexpected(Error(makeString("Shader is incompatible with layout pipeline: "_s, error), SourceSpan::empty()));

                if (auto* bufferBindingLayout = std::get_if<BufferBindingLayout>(&entryIt->value->bindingMember))
                    bufferBindingLayout->minBindingSize = variable->storeType()->size();
            }

            if (!m_reads.contains(variable->name()))
                continue;

            if (!serializedVariables.contains(variable))
                return makeUnexpected(Error("Shader is incompatible with layout pipeline"_s, SourceSpan::empty()));
        }
    }

    return { groups };
}

void RewriteGlobalVariables::insertDynamicOffsetsBufferIfNeeded(const SourceSpan& span, const AST::Function& function)
{
    if (!m_globalsUsingDynamicOffset.isEmpty() || (m_stage == ShaderStage::Fragment && (m_shaderModule.usesFragDepth() || m_shaderModule.usesSampleMask()))) {
        unsigned group;
        switch (m_stage) {
        case ShaderStage::Vertex:
            group = m_shaderModule.configuration().maxBuffersPlusVertexBuffersForVertexStage;
            break;
        case ShaderStage::Fragment:
            group = m_shaderModule.configuration().maxBuffersForFragmentStage;
            break;
        case ShaderStage::Compute:
            group = m_shaderModule.configuration().maxBuffersForComputeStage;
            break;
        }

        auto& type = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(span, AST::Identifier::make("u32"_s));
        type.m_inferredType = m_shaderModule.types().pointerType(AddressSpace::Uniform, m_shaderModule.types().u32Type(), AccessMode::Read);

        insertParameter(span, function, group, AST::Identifier::make(dynamicOffsetVariableName()), &type, AST::ParameterRole::UserDefined);
    }
}

void RewriteGlobalVariables::insertDynamicOffsetsBufferIfNeeded(const AST::Function& function)
{
    insertDynamicOffsetsBufferIfNeeded(function.span(), function);
}

void RewriteGlobalVariables::insertParameters(AST::Function& function, const Vector<unsigned>& groups)
{
    auto span = function.span();
    for (auto group : groups)
        insertParameter(span, function, group, argumentBufferParameterName(group));
    insertDynamicOffsetsBufferIfNeeded(span, function);
}

void RewriteGlobalVariables::insertMaterializations(AST::Function& function, const UsedResources& usedResources)
{
    auto span = function.span();
    for (auto& [group, bindings] : usedResources) {
        auto& argument = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
            span,
            AST::Identifier::make(argumentBufferParameterName(group))
        );

        for (auto& [binding, global] : bindings) {
            auto& name = global->declaration->name();
            String fieldName = name;
            auto* storeType = global->declaration->storeType();
            if (isPrimitive(storeType, Types::Primitive::TextureExternal)) {
                fieldName = makeString("__"_s, name);
                m_shaderModule.setUsesExternalTextures();
            }
            auto& access = m_shaderModule.astBuilder().construct<AST::FieldAccessExpression>(
                SourceSpan::empty(),
                argument,
                AST::Identifier::make(WTF::move(fieldName))
            );
            AST::Expression* initializer = &access;

            auto it = global->declaration->binding() ? m_globalsUsingDynamicOffset.find({ group + 1, binding + 1 }) : m_globalsUsingDynamicOffset.end();
            if (it != m_globalsUsingDynamicOffset.end()) {
                auto offset = it->value;
                auto& target = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
                    SourceSpan::empty(),
                    AST::Identifier::make("__dynamicOffset"_s)
                );
                auto& reference = std::get<Types::Reference>(*global->declaration->maybeReferenceType()->inferredType());
                target.m_inferredType = m_shaderModule.types().pointerType(reference.addressSpace, storeType, reference.accessMode);

                auto& offsetExpression = m_shaderModule.astBuilder().construct<AST::Unsigned32Literal>(span, offset);
                offsetExpression.m_inferredType = m_shaderModule.types().u32Type();
                offsetExpression.setConstantValue(offset);
                initializer = &m_shaderModule.astBuilder().construct<AST::CallExpression>(
                    SourceSpan::empty(),
                    target,
                    AST::Expression::List { access, offsetExpression }
                );
            }

            auto& variable = m_shaderModule.astBuilder().construct<AST::Variable>(
                SourceSpan::empty(),
                AST::VariableFlavor::Let,
                AST::Identifier::make(name),
                nullptr,
                global->declaration->maybeReferenceType(),
                initializer,
                AST::Attribute::List { },
                AST::VariableRole::PackedResource
            );

            auto& variableStatement = m_shaderModule.astBuilder().construct<AST::VariableStatement>(SourceSpan::empty(), variable);
            m_shaderModule.insert(function.body().statements(), 0, std::reference_wrapper<AST::Statement>(variableStatement));
        }
    }
}

void RewriteGlobalVariables::insertLocalDefinitions(AST::Function& function, const UsedPrivateGlobals& usedPrivateGlobals)
{
    auto initialBodySize = function.body().statements().size();
    for (auto* global : usedPrivateGlobals) {
        auto& variableStatement = m_shaderModule.astBuilder().construct<AST::VariableStatement>(SourceSpan::empty(), *global->declaration);
        m_shaderModule.insert(function.body().statements(), 0, std::reference_wrapper<AST::Statement>(variableStatement));
    }

    auto offset = function.body().statements().size() - initialBodySize;
    initializeVariables(function, usedPrivateGlobals, offset);
}

void RewriteGlobalVariables::initializeVariables(AST::Function& function, const UsedPrivateGlobals& globals, size_t offset)
{
    auto initializations = storeInitialValue(globals);
    if (initializations.isEmpty())
        return;

    insertWorkgroupBarrier(function, offset);

    auto localInvocationIndex = findOrInsertLocalInvocationIndex(function);

    auto& testLhs = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
        SourceSpan::empty(),
        AST::Identifier::make(localInvocationIndex.id())
    );
    testLhs.m_inferredType = m_shaderModule.types().u32Type();

    auto& testRhs = m_shaderModule.astBuilder().construct<AST::Unsigned32Literal>(SourceSpan::empty(), 0);
    testLhs.m_inferredType = m_shaderModule.types().u32Type();


    auto& testExpression = m_shaderModule.astBuilder().construct<AST::BinaryExpression>(
        SourceSpan::empty(),
        testLhs,
        testRhs,
        AST::BinaryOperation::Equal
    );
    testExpression.m_inferredType = m_shaderModule.types().boolType();

    auto& body = m_shaderModule.astBuilder().construct<AST::CompoundStatement>(
        SourceSpan::empty(),
        AST::Attribute::List { },
        WTF::move(initializations)
    );

    auto& ifStatement = m_shaderModule.astBuilder().construct<AST::IfStatement>(
        SourceSpan::empty(),
        testExpression,
        body,
        nullptr,
        AST::Attribute::List { }
    );
    m_shaderModule.insert(function.body().statements(), offset, std::reference_wrapper<AST::Statement>(ifStatement));
}

void RewriteGlobalVariables::insertWorkgroupBarrier(AST::Function& function, size_t offset)
{
    auto& callee = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(SourceSpan::empty(), AST::Identifier::make("workgroupBarrier"_s));
    callee.m_inferredType = m_shaderModule.types().voidType();

    auto& call = m_shaderModule.astBuilder().construct<AST::CallExpression>(
        SourceSpan::empty(),
        callee,
        AST::Expression::List { }
    );
    call.m_inferredType = m_shaderModule.types().voidType();

    auto& callStatement = m_shaderModule.astBuilder().construct<AST::CallStatement>(
        SourceSpan::empty(),
        call
    );
    m_shaderModule.insert(function.body().statements(), offset, std::reference_wrapper<AST::Statement>(callStatement));
}

AST::Identifier& RewriteGlobalVariables::findOrInsertLocalInvocationIndex(AST::Function& function)
{
    for (auto& parameter : function.parameters()) {
        if (auto builtin = parameter.builtin(); builtin.has_value() && *builtin == Builtin::LocalInvocationIndex)
            return parameter.name();
    }

    auto& type = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
        SourceSpan::empty(),
        AST::Identifier::make("u32"_s)
    );
    type.m_inferredType = m_shaderModule.types().u32Type();

    auto& builtinAttribute = m_shaderModule.astBuilder().construct<AST::BuiltinAttribute>(
        SourceSpan::empty(),
        Builtin::LocalInvocationIndex
    );

    auto& parameter = m_shaderModule.astBuilder().construct<AST::Parameter>(
        SourceSpan::empty(),
        AST::Identifier::make("__localInvocationIndex"_s),
        type,
        AST::Attribute::List { builtinAttribute },
        AST::ParameterRole::UserDefined
    );

    m_shaderModule.append(function.parameters(), parameter);

    return parameter.name();
}

AST::Statement::List RewriteGlobalVariables::storeInitialValue(const UsedPrivateGlobals& globals)
{
    AST::Statement::List statements;
    for (auto* global : globals) {
        auto& variable = *global->declaration;

        if (auto addressSpace = variable.addressSpace(); !addressSpace.has_value() || *addressSpace != AddressSpace::Workgroup)
            continue;

        auto* type = variable.storeType();
        auto& target = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
            SourceSpan::empty(),
            AST::Identifier::make(variable.name().id())
        );
        target.m_inferredType = type;
        storeInitialValue(target, statements, 0);
    }
    return statements;
}

void RewriteGlobalVariables::storeInitialValue(AST::Expression& target, AST::Statement::List& statements, unsigned arrayDepth)
{
    const auto& zeroInitialize = [&]() {
        m_shaderModule.setUsesZeroWorkgroupVar();

        auto& callee = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(SourceSpan::empty(), AST::Identifier::make("__wgslZeroWorkgroupVar"_s));
        callee.m_inferredType = m_shaderModule.types().voidType();

        auto& call = m_shaderModule.astBuilder().construct<AST::CallExpression>(
            SourceSpan::empty(),
            callee,
            AST::Expression::List { target }
        );
        call.m_inferredType = m_shaderModule.types().voidType();

        auto& callStatement = m_shaderModule.astBuilder().construct<AST::CallStatement>(
            SourceSpan::empty(),
            call
        );
        statements.append(AST::Statement::Ref(callStatement));
    };

    auto* type = target.inferredType();
    if (auto* arrayType = std::get_if<Types::Array>(type)) {
        RELEASE_ASSERT(!arrayType->isRuntimeSized());
        String indexVariableName = makeString("__i"_s, arrayDepth);

        auto& indexVariable = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(
            SourceSpan::empty(),
            AST::Identifier::make(indexVariableName)
        );
        indexVariable.m_inferredType = m_shaderModule.types().u32Type();

        auto& arrayAccess = m_shaderModule.astBuilder().construct<AST::IndexAccessExpression>(
            SourceSpan::empty(),
            target,
            indexVariable
        );
        arrayAccess.m_inferredType = arrayType->element;

        AST::Statement::List forBodyStatements;
        storeInitialValue(arrayAccess, forBodyStatements, arrayDepth + 1);

        auto& zero = m_shaderModule.astBuilder().construct<AST::Unsigned32Literal>(
            SourceSpan::empty(),
            0
        );
        zero.m_inferredType = m_shaderModule.types().u32Type();

        auto& forVariable = m_shaderModule.astBuilder().construct<AST::Variable>(
            SourceSpan::empty(),
            AST::VariableFlavor::Var,
            AST::Identifier::make(indexVariableName),
            nullptr,
            &zero
        );

        auto& forInitializer = m_shaderModule.astBuilder().construct<AST::VariableStatement>(
            SourceSpan::empty(),
            forVariable
        );

        auto* arrayLength = [&]() -> AST::Expression* {
            if (auto* overrideExpression = std::get_if<AST::Expression*>(&arrayType->size))
                return *overrideExpression;

            auto& arrayLength = m_shaderModule.astBuilder().construct<AST::Unsigned32Literal>(
                SourceSpan::empty(),
                std::get<unsigned>(arrayType->size)
            );
            arrayLength.m_inferredType = m_shaderModule.types().u32Type();
            return &arrayLength;
        }();


        auto& forTest = m_shaderModule.astBuilder().construct<AST::BinaryExpression>(
            SourceSpan::empty(),
            indexVariable,
            *arrayLength,
            AST::BinaryOperation::LessThan
        );
        forTest.m_inferredType = m_shaderModule.types().boolType();

        auto& one = m_shaderModule.astBuilder().construct<AST::Unsigned32Literal>(
            SourceSpan::empty(),
            1
        );
        one.m_inferredType = m_shaderModule.types().u32Type();

        auto& forUpdate = m_shaderModule.astBuilder().construct<AST::CompoundAssignmentStatement>(
            SourceSpan::empty(),
            indexVariable,
            one,
            AST::BinaryOperation::Add
        );

        auto& forBody = m_shaderModule.astBuilder().construct<AST::CompoundStatement>(
            SourceSpan::empty(),
            AST::Attribute::List { },
            WTF::move(forBodyStatements)
        );

        auto& forStatement = m_shaderModule.astBuilder().construct<AST::ForStatement>(
            SourceSpan::empty(),
            AST::Attribute::List { },
            &forInitializer,
            &forTest,
            &forUpdate,
            forBody
        );
        forStatement.setInternallyGenerated();

        statements.append(AST::Statement::Ref(forStatement));
        return;
    }

    if (auto* structType = std::get_if<Types::Struct>(type)) {
        if (type->isConstructible()) {
            zeroInitialize();
            return;
        }

        for (auto& member : structType->structure.members()) {
            auto* fieldType = member.type().inferredType();
            auto& fieldAccess = m_shaderModule.astBuilder().construct<AST::FieldAccessExpression>(
                SourceSpan::empty(),
                target,
                AST::Identifier::make(member.name())
            );
            fieldAccess.m_inferredType = fieldType;
            storeInitialValue(fieldAccess, statements, arrayDepth);
        }
        return;
    }

    if (type && std::holds_alternative<Types::Atomic>(*type)) {
        auto& callee = m_shaderModule.astBuilder().construct<AST::IdentifierExpression>(SourceSpan::empty(), AST::Identifier::make("atomicStore"_s));
        callee.m_inferredType = m_shaderModule.types().voidType();

        auto& pointer = m_shaderModule.astBuilder().construct<AST::UnaryExpression>(
            SourceSpan::empty(),
            target,
            AST::UnaryOperation::AddressOf
        );
        pointer.m_inferredType = m_shaderModule.types().voidType();

        auto& value = m_shaderModule.astBuilder().construct<AST::AbstractIntegerLiteral>(SourceSpan::empty(), 0);
        value.m_inferredType = m_shaderModule.types().abstractIntType();

        auto& call = m_shaderModule.astBuilder().construct<AST::CallExpression>(
            SourceSpan::empty(),
            callee,
            AST::Expression::List { pointer, value }
        );
        call.m_inferredType = m_shaderModule.types().voidType();

        auto& callStatement = m_shaderModule.astBuilder().construct<AST::CallStatement>(
            SourceSpan::empty(),
            call
        );
        statements.append(AST::Statement::Ref(callStatement));
        return;
    }

    zeroInitialize();
}

void RewriteGlobalVariables::def(const AST::Identifier& name, AST::Variable* variable)
{
    dataLogLnIf(shouldLogGlobalVariableRewriting, "> def: ", name, " at line:", name.span().line, " column: ", name.span().lineOffset);
    m_defs.add(name, variable);
}

auto RewriteGlobalVariables::readVariable(AST::IdentifierExpression& identifier) -> const Global*
{
    auto def = m_defs.find(identifier.identifier());
    if (def != m_defs.end())
        return nullptr;

    auto it = m_globals.find(identifier.identifier());
    if (it == m_globals.end())
        return nullptr;

    auto& global = it->value;
    if (global.declaration->flavor() == AST::VariableFlavor::Const)
        return nullptr;

    dataLogLnIf(shouldLogGlobalVariableRewriting, "> read global: ", identifier.identifier(), " at line:", identifier.span().line, " column: ", identifier.span().lineOffset);
    auto addResult = m_reads.add(identifier.identifier());
    if (addResult.isNewEntry) {
        if (auto* type = global.declaration->maybeTypeName())
            visit(*type);
        if (auto* initializer = global.declaration->maybeInitializer())
            visit(*initializer);
    }

    return &global;
}

void RewriteGlobalVariables::insertBeforeCurrentStatement(AST::Statement& statement)
{
    m_pendingInsertions.append({ &statement, m_currentStatementIndex });
}

AST::Identifier RewriteGlobalVariables::argumentBufferParameterName(unsigned group)
{
    return AST::Identifier::make(makeString("__ArgumentBuffer_"_s, group));
}

AST::Identifier RewriteGlobalVariables::argumentBufferStructName(unsigned group)
{
    return AST::Identifier::make(makeString("__ArgumentBufferT_"_s, m_entryPointID, "_"_s, group));
}

AST::Identifier RewriteGlobalVariables::dynamicOffsetVariableName()
{
    return AST::Identifier::make("__DynamicOffsets"_str);
}

std::optional<Error> rewriteGlobalVariables(ShaderModule& shaderModule, const HashMap<String, PipelineLayout*>& pipelineLayouts, HashMap<String, Reflection::EntryPointInformation>& entryPointInformations)
{
    return RewriteGlobalVariables(shaderModule, pipelineLayouts, entryPointInformations).run();
}

} // namespace WGSL
