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
#include "UniformityAnalysis.h"

#include "AST.h"
#include "ASTIdentifier.h"
#include "WGSL.h"
#include "WGSLShaderModule.h"
#include <wtf/DataLog.h>
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/Scope.h>
#include <wtf/text/MakeString.h>

namespace WGSL {

namespace {

constexpr bool shouldLogUniformityAnalysis = false;

struct Node {
    Vector<Node*, 4> edges;
    const AST::Node* ast { nullptr };
    Node* visitedFrom { nullptr };
    bool affectsControlFlow { false };

    void addEdge(Node* to)
    {
        ASSERT(to);
        edges.append(to);
    }
};

enum class ParameterTag : uint8_t {
    NoRestriction,
    ValueRequiredToBeUniform,
    ContentsRequiredToBeUniform,
};

enum class CallSiteTag : uint8_t {
    NoRestriction,
    RequiredToBeUniform,
};

enum class FunctionTag : uint8_t {
    NoRestriction,
    ReturnValueMayBeNonUniform,
};

struct CallSiteRequirement {
    CallSiteTag tag { CallSiteTag::NoRestriction };
    SeverityControl severity { SeverityControl::Error };
};

struct ParameterRequirement {
    ParameterTag tag { ParameterTag::NoRestriction };
    SeverityControl severity { SeverityControl::Error };
};

struct ParameterInfo {
    String name;
    unsigned index;
    Node* value { nullptr };
    Node* ptrInputContents { nullptr };
    Node* ptrOutputContents { nullptr };

    ParameterRequirement tagDirect;
    ParameterTag tagRetval { ParameterTag::NoRestriction };

    bool pointerMayBecomeNonUniform { false };
    Vector<unsigned> ptrOutputSourceParamValues;
    Vector<unsigned> ptrOutputSourceParamContents;
};

using Behavior = AST::Behavior;
using Behaviors = AST::Behaviors;

struct LoopSwitchInfo {
    HashMap<String, Node*> varInNodes;
    HashMap<String, Node*> varExitNodes;
};

struct FunctionInfo {
    AST::Function* astNode;
    Node* requiredToBeUniform[3] { nullptr, nullptr, nullptr }; // indexed: 0=Error, 1=Warning, 2=Info
    Node* mayBeNonUniform { nullptr };
    Node* cfStart { nullptr };
    Node* valueReturn { nullptr };

    CallSiteRequirement callSiteTag;
    FunctionTag functionTag { FunctionTag::NoRestriction };

    Node* NODELETE requiredToBeUniformForSeverity(SeverityControl severity)
    {
        switch (severity) {
        case SeverityControl::Error:   return requiredToBeUniform[0];
        case SeverityControl::Warning: return requiredToBeUniform[1];
        case SeverityControl::Info:    return requiredToBeUniform[2];
        case SeverityControl::Off:     return nullptr;
        }
        RELEASE_ASSERT_NOT_REACHED();
    }

    Vector<ParameterInfo> parameters;

    Vector<std::unique_ptr<Node>> nodes;
    Vector<HashMap<String, Node*>> scopes;
    HashSet<String> localVarDecls;

    Node* createNode(const AST::Node* ast = nullptr)
    {
        auto node = std::unique_ptr<Node>(new Node);
        node->ast = ast;
        auto* raw = node.get();
        nodes.append(WTF::move(node));
        return raw;
    }

    void pushScope()
    {
        scopes.append({ });
    }

    HashMap<String, Node*> popScopeCapture()
    {
        ASSERT(scopes.size() > 1);
        auto top = WTF::move(scopes.last());
        scopes.removeLast();
        return top;
    }

    Node* getVariable(const String& name)
    {
        for (int i = scopes.size() - 1; i >= 0; --i) {
            auto it = scopes[i].find(name);
            if (it != scopes[i].end())
                return it->value;
        }
        return nullptr;
    }

    void setVariable(const String& name, Node* node)
    {
        ASSERT(!scopes.isEmpty());
        scopes.last().set(name, node);
    }

    void NODELETE resetVisited()
    {
        for (auto& node : nodes)
            node->visitedFrom = nullptr;
    }
};

static void traverse(Node* source, HashSet<Node*>* reachable = nullptr)
{
    Vector<Node*, 32> stack;
    stack.append(source);
    if (reachable)
        reachable->add(source);

    while (!stack.isEmpty()) {
        auto* node = stack.takeLast();
        for (auto* to : node->edges) {
            if (!to->visitedFrom) {
                to->visitedFrom = node;
                if (reachable)
                    reachable->add(to);
                stack.append(to);
            }
        }
    }
}

class UniformityGraph {
public:
    UniformityGraph(ShaderModule& shaderModule)
        : m_shaderModule(shaderModule)
    {
    }

    std::optional<FailedCheck> run();

private:
    std::optional<Error> processFunction(AST::Function&);
    Node* processStatement(Node*, AST::Statement&);
    Node* processStatements(Node*, AST::Statement::List&);
    std::pair<Node*, Node*> processExpression(Node*, AST::Expression&);
    std::pair<Node*, Node*> processAddressOf(Node*, AST::Expression&);
    std::pair<Node*, Node*> processCall(Node*, AST::CallExpression&);

    struct LValue {
        Node* cf;
        Node* newVal;
        String rootIdentifier;
    };
    LValue processLValueExpression(Node*, AST::Expression&, bool isPartialReference = false);

    static AST::IdentifierExpression* NODELETE rootIdentifier(AST::Expression&);
    static bool isGlobalNonUniform(AST::Variable&);

    SeverityControl NODELETE currentSeverity() const
    {
        return m_severityStack.last();
    }

    SeverityControl NODELETE currentSubgroupSeverity() const
    {
        return m_subgroupSeverityStack.last();
    }

    ShaderModule& m_shaderModule;
    HashMap<String, FunctionInfo> m_functions;
    FunctionInfo* m_currentFunction { nullptr };
    Vector<SeverityControl> m_severityStack;
    Vector<SeverityControl> m_subgroupSeverityStack;
    Vector<Warning> m_warnings;
    Vector<LoopSwitchInfo*> m_loopSwitchStack;
    Vector<std::unique_ptr<LoopSwitchInfo>> m_loopSwitchInfos;
    // When the subgroup_uniformity language feature is supported, the analysis runs
    // once per uniformity scope (workgroup/draw, then subgroup). In the subgroup scope,
    // subgroup/quad ops relax to the subgroup's narrower uniformity requirements while
    // barriers/derivatives (workgroup concerns) impose no requirement.
    bool m_analyzingSubgroupScope { false };
    bool m_supportsSubgroupUniformity { false };
};

AST::IdentifierExpression* UniformityGraph::rootIdentifier(AST::Expression& expr)
{
    if (auto* ident = dynamicDowncast<AST::IdentifierExpression>(expr))
        return ident;
    if (auto* field = dynamicDowncast<AST::FieldAccessExpression>(expr))
        return rootIdentifier(field->base());
    if (auto* index = dynamicDowncast<AST::IndexAccessExpression>(expr))
        return rootIdentifier(index->base());
    if (auto* identity = dynamicDowncast<AST::IdentityExpression>(expr))
        return rootIdentifier(identity->expression());
    if (auto* unary = dynamicDowncast<AST::UnaryExpression>(expr))
        return rootIdentifier(unary->expression());
    if (auto* deref = dynamicDowncast<AST::PointerDereferenceExpression>(expr))
        return rootIdentifier(deref->target());
    return nullptr;
}

bool UniformityGraph::isGlobalNonUniform(AST::Variable& globalVar)
{
    if (auto addressSpace = globalVar.addressSpace()) {
        switch (*addressSpace) {
        case AddressSpace::Private:
        case AddressSpace::Workgroup:
            return true;
        case AddressSpace::Storage:
            if (globalVar.accessMode() && *globalVar.accessMode() != AccessMode::Read)
                return true;
            break;
        case AddressSpace::Handle:
            if (auto* storeType = globalVar.storeType()) {
                if (auto* texStorage = std::get_if<Types::TextureStorage>(storeType)) {
                    if (texStorage->access != AccessMode::Read)
                        return true;
                }
            }
            break;
        case AddressSpace::Function:
        case AddressSpace::Uniform:
            break;
        }
    }
    return false;
}

std::optional<FailedCheck> UniformityGraph::run()
{
    dataLogLnIf(shouldLogUniformityAnalysis, "Starting graph-based uniformity analysis");

    // subgroup_uniformity is a WGSL language feature (advertised unconditionally via
    // WGSLLanguageFeatures) rather than a device feature, and WebKit's WGSL implementation
    // always supports it. When supported, the analysis runs an additional subgroup scope.
    //
    // Subgroup/quad ops require `enable subgroups;` (enforced in TypeCheck), and they are
    // the only construct the subgroup scope enforces more strictly than the workgroup/draw
    // scope -- every other subgroup-scope difference is a relaxation. So when the extension
    // is not enabled, no subgroup/quad op can reach this analysis and the subgroup scope
    // can only reproduce (never add) diagnostics, making it safe to skip.
    m_supportsSubgroupUniformity = m_shaderModule.enabledExtensions().contains(Extension::Subgroups);

    // https://www.w3.org/TR/WGSL/#uniformity
    // The analysis runs once per uniformity scope. Workgroup and draw scopes are
    // equivalent (they differ only by shader stage). When the subgroup_uniformity
    // feature is supported there is an additional, narrower subgroup scope, and a
    // program is valid only if it passes in every scope.
    auto analyzeScope = [&](bool subgroupScope) -> std::optional<FailedCheck> {
        m_analyzingSubgroupScope = subgroupScope;
        m_functions.clear();
        m_loopSwitchStack.clear();
        m_loopSwitchInfos.clear();
        m_severityStack.clear();
        m_subgroupSeverityStack.clear();
        m_severityStack.append(m_shaderModule.severityFor(TriggeringRule::DerivativeUniformity).value_or(SeverityControl::Error));
        m_subgroupSeverityStack.append(m_shaderModule.severityFor(TriggeringRule::SubgroupUniformity).value_or(SeverityControl::Error));

        for (auto& declaration : m_shaderModule.declarations()) {
            if (auto* function = dynamicDowncast<AST::Function>(declaration)) {
                if (auto error = processFunction(*function))
                    return FailedCheck { Vector<Error> { *error }, WTF::move(m_warnings) };
            }
        }

        if (!m_warnings.isEmpty())
            return FailedCheck { { }, WTF::move(m_warnings) };
        return std::nullopt;
    };

    // Workgroup/draw scope.
    if (auto failure = analyzeScope(false))
        return failure;

    // Subgroup scope (only distinct when the feature is supported).
    if (m_supportsSubgroupUniformity) {
        if (auto failure = analyzeScope(true))
            return failure;
    }

    return std::nullopt;
}

std::optional<Error> UniformityGraph::processFunction(AST::Function& function)
{
    bool isEntryPoint = function.stage().has_value();

    dataLogLnIf(shouldLogUniformityAnalysis, "Processing function: "_s, function.name());

    auto result = m_functions.add(function.name(), FunctionInfo { });
    auto& info = result.iterator->value;
    info.astNode = &function;
    m_currentFunction = &info;

    info.requiredToBeUniform[0] = info.createNode();
    info.requiredToBeUniform[1] = info.createNode();
    info.requiredToBeUniform[2] = info.createNode();
    info.mayBeNonUniform = info.createNode();
    info.cfStart = info.createNode();

    if (function.maybeReturnType())
        info.valueReturn = info.createNode();

    info.pushScope();

    info.parameters.resize(function.parameters().size());
    for (unsigned i = 0; i < function.parameters().size(); ++i) {
        auto& param = function.parameters()[i];
        auto& paramInfo = info.parameters[i];
        paramInfo.name = param.name();
        paramInfo.index = i;

        paramInfo.value = info.createNode(&param);

        if (isEntryPoint) {
            bool isNonUniform = true;
            if (auto builtin = param.builtin()) {
                switch (*builtin) {
                case Builtin::NumWorkgroups:
                case Builtin::WorkgroupId:
                case Builtin::NumSubgroups:
                    isNonUniform = false;
                    break;
                case Builtin::SubgroupSize:
                    // subgroup_size is uniform within a workgroup (compute) but may
                    // vary between invocations within a draw command (fragment). At
                    // subgroup scope it is always uniform.
                    if (function.stage() == ShaderStage::Compute || m_analyzingSubgroupScope)
                        isNonUniform = false;
                    break;
                case Builtin::SubgroupId:
                    // subgroup_id is uniform only at subgroup uniformity scope.
                    if (m_analyzingSubgroupScope)
                        isNonUniform = false;
                    break;
                default:
                    break;
                }
            }

            if (isNonUniform)
                paramInfo.value->addEdge(info.mayBeNonUniform);
            else
                paramInfo.value->addEdge(info.cfStart);
        } else
            paramInfo.value->addEdge(info.cfStart);

        bool isPointerParam = std::holds_alternative<Types::Pointer>(*param.typeName().inferredType());

        if (isPointerParam) {
            paramInfo.ptrInputContents = info.createNode(&param);
            paramInfo.ptrInputContents->addEdge(info.cfStart);
            paramInfo.ptrOutputContents = info.createNode();
            info.setVariable(param.name(), paramInfo.ptrInputContents);
            info.localVarDecls.add(param.name());
        } else
            info.setVariable(param.name(), paramInfo.value);
    }

    for (auto& declaration : m_shaderModule.declarations()) {
        if (auto* globalVar = dynamicDowncast<AST::Variable>(declaration)) {
            auto* node = info.createNode(globalVar);
            if (isGlobalNonUniform(*globalVar))
                node->addEdge(info.mayBeNonUniform);
            else
                node->addEdge(info.cfStart);
            info.setVariable(globalVar->name(), node);
        }
    }

    bool pushedFunctionSeverity = false;
    if (auto severity = function.severityFor(TriggeringRule::DerivativeUniformity)) {
        m_severityStack.append(*severity);
        pushedFunctionSeverity = true;
    }
    bool pushedFunctionSubgroupSeverity = false;
    if (auto severity = function.severityFor(TriggeringRule::SubgroupUniformity)) {
        m_subgroupSeverityStack.append(*severity);
        pushedFunctionSubgroupSeverity = true;
    }

    processStatements(info.cfStart, function.body().statements());

    if (pushedFunctionSeverity)
        m_severityStack.removeLast();
    if (pushedFunctionSubgroupSeverity)
        m_subgroupSeverityStack.removeLast();

    for (auto& paramInfo : info.parameters) {
        if (paramInfo.ptrOutputContents) {
            auto* currentVal = info.getVariable(paramInfo.name);
            if (currentVal)
                paramInfo.ptrOutputContents->addEdge(currentVal);
        }
    }

    auto getParamTag = [&](HashSet<Node*>& reachable, unsigned index) -> ParameterTag {
        auto& paramInfo = info.parameters[index];
        bool isPointer = paramInfo.ptrInputContents != nullptr;
        if (isPointer) {
            if (reachable.contains(paramInfo.ptrInputContents))
                return ParameterTag::ContentsRequiredToBeUniform;
            if (reachable.contains(paramInfo.value))
                return ParameterTag::ValueRequiredToBeUniform;
        } else {
            auto* varNode = info.getVariable(paramInfo.name);
            if (varNode && reachable.contains(varNode))
                return ParameterTag::ValueRequiredToBeUniform;
            if (reachable.contains(paramInfo.value))
                return ParameterTag::ValueRequiredToBeUniform;
        }
        return ParameterTag::NoRestriction;
    };

    {
        static constexpr SeverityControl severities[] = { SeverityControl::Error, SeverityControl::Warning, SeverityControl::Info };
        for (auto severity : severities) {
            auto* sentinel = info.requiredToBeUniformForSeverity(severity);
            info.resetVisited();
            HashSet<Node*> reachable;
            traverse(sentinel, &reachable);

            if (reachable.contains(info.mayBeNonUniform)) {
                String callName;
                const AST::Node* callAst = nullptr;
                for (auto* edge : sentinel->edges) {
                    if (!edge->ast)
                        continue;
                    if (auto* callExpr = dynamicDowncast<AST::CallExpression>(*edge->ast)) {
                        callAst = callExpr;
                        if (auto* target = dynamicDowncast<AST::IdentifierExpression>(callExpr->target()))
                            callName = target->identifier().id();
                        break;
                    }
                }
                RELEASE_ASSERT(callAst);
                RELEASE_ASSERT(!callName.isEmpty());

                if (auto it = m_functions.find(callName); it != m_functions.end())
                    callName = it->value.astNode->originalName();

                auto message = makeString("call to '"_s, callName, "' requires uniform control flow"_s);
                if (severity == SeverityControl::Error)
                    return Error { WTF::move(message), callAst->span() };
                m_warnings.append(Warning { WTF::move(message), callAst->span() });
            }

            if (reachable.contains(info.cfStart) && info.callSiteTag.tag == CallSiteTag::NoRestriction)
                info.callSiteTag = { CallSiteTag::RequiredToBeUniform, severity };

            for (unsigned i = 0; i < info.parameters.size(); ++i) {
                if (info.parameters[i].tagDirect.tag == ParameterTag::NoRestriction) {
                    auto tag = getParamTag(reachable, i);
                    if (tag != ParameterTag::NoRestriction)
                        info.parameters[i].tagDirect = { tag, severity };
                }
            }
        }
    }

    if (info.valueReturn) {
        info.resetVisited();
        HashSet<Node*> reachable;
        traverse(info.valueReturn, &reachable);

        if (reachable.contains(info.mayBeNonUniform))
            info.functionTag = FunctionTag::ReturnValueMayBeNonUniform;

        for (unsigned i = 0; i < info.parameters.size(); ++i)
            info.parameters[i].tagRetval = getParamTag(reachable, i);
    }

    for (unsigned i = 0; i < info.parameters.size(); ++i) {
        auto& paramInfo = info.parameters[i];
        if (!paramInfo.ptrOutputContents)
            continue;

        info.resetVisited();
        HashSet<Node*> reachable;
        traverse(paramInfo.ptrOutputContents, &reachable);

        if (reachable.contains(info.mayBeNonUniform))
            paramInfo.pointerMayBecomeNonUniform = true;

        for (unsigned j = 0; j < info.parameters.size(); ++j) {
            auto tag = getParamTag(reachable, j);
            if (tag == ParameterTag::ContentsRequiredToBeUniform)
                paramInfo.ptrOutputSourceParamContents.append(j);
            else if (tag == ParameterTag::ValueRequiredToBeUniform)
                paramInfo.ptrOutputSourceParamValues.append(j);
        }
    }

    m_currentFunction = nullptr;
    return std::nullopt;
}

Node* UniformityGraph::processStatements(Node* cf, AST::Statement::List& statements)
{
    for (auto& statement : statements) {
        cf = processStatement(cf, statement);
        auto behaviors = statement.behaviors();
        if (!behaviors.contains(Behavior::Next))
            break;
    }
    return cf;
}

Node* UniformityGraph::processStatement(Node* cf, AST::Statement& statement)
{
    auto& info = *m_currentFunction;

    bool pushedSeverity = false;
    if (auto severity = statement.severityFor(TriggeringRule::DerivativeUniformity)) {
        m_severityStack.append(*severity);
        pushedSeverity = true;
    }
    bool pushedSubgroupSeverity = false;
    if (auto severity = statement.severityFor(TriggeringRule::SubgroupUniformity)) {
        m_subgroupSeverityStack.append(*severity);
        pushedSubgroupSeverity = true;
    }
    auto popSeverity = makeScopeExit([&] {
        if (pushedSeverity)
            m_severityStack.removeLast();
        if (pushedSubgroupSeverity)
            m_subgroupSeverityStack.removeLast();
    });

    switch (statement.kind()) {
    case AST::NodeKind::CompoundStatement: {
        auto& compound = uncheckedDowncast<AST::CompoundStatement>(statement);
        info.pushScope();
        auto* cfOut = processStatements(cf, compound.statements());
        auto scopeAssignments = info.popScopeCapture();

        auto behaviors = statement.behaviors();
        if (behaviors.contains(Behavior::Next)) {
            for (auto& entry : scopeAssignments) {
                if (info.getVariable(entry.key))
                    info.setVariable(entry.key, entry.value);
                else
                    info.localVarDecls.remove(entry.key);
            }
        }
        return cfOut;
    }

    case AST::NodeKind::AssignmentStatement: {
        auto& assign = uncheckedDowncast<AST::AssignmentStatement>(statement);
        auto [cfL, vL, rootIdent] = processLValueExpression(cf, assign.lhs());
        auto [cfR, vR] = processExpression(cfL, assign.rhs());
        vL->addEdge(vR);
        if (!rootIdent.isEmpty())
            info.setVariable(rootIdent, vL);
        return cfR;
    }

    case AST::NodeKind::PhonyAssignmentStatement: {
        auto& phony = uncheckedDowncast<AST::PhonyAssignmentStatement>(statement);
        auto [cfR, _] = processExpression(cf, phony.rhs());
        return cfR;
    }

    case AST::NodeKind::CompoundAssignmentStatement: {
        auto& compAssign = uncheckedDowncast<AST::CompoundAssignmentStatement>(statement);
        auto [cfL, lhsValue, rootIdent] = processLValueExpression(cf, compAssign.leftExpression());
        auto* lhsLoad = rootIdent.isEmpty() ? nullptr : info.getVariable(rootIdent);
        auto [cfR, vR] = processExpression(cfL, compAssign.rightExpression());

        auto* result = info.createNode(&compAssign);
        result->addEdge(vR);
        if (lhsLoad)
            result->addEdge(lhsLoad);

        lhsValue->addEdge(result);
        if (!rootIdent.isEmpty())
            info.setVariable(rootIdent, lhsValue);
        return cfR;
    }

    case AST::NodeKind::DecrementIncrementStatement: {
        auto& incDec = uncheckedDowncast<AST::DecrementIncrementStatement>(statement);
        auto [cfL, lhsValue, rootIdent] = processLValueExpression(cf, incDec.expression());
        auto* lhsLoad = rootIdent.isEmpty() ? nullptr : info.getVariable(rootIdent);

        auto* result = info.createNode(&incDec);
        result->addEdge(cfL);
        if (lhsLoad)
            result->addEdge(lhsLoad);

        lhsValue->addEdge(result);
        if (!rootIdent.isEmpty())
            info.setVariable(rootIdent, lhsValue);
        return cfL;
    }

    case AST::NodeKind::VariableStatement: {
        auto& varStmt = uncheckedDowncast<AST::VariableStatement>(statement);
        auto& variable = varStmt.variable();

        Node* node;
        if (variable.maybeInitializer()) {
            auto [cfInit, v] = processExpression(cf, *variable.maybeInitializer());
            cf = cfInit;
            node = v;
        } else
            node = cf;

        info.setVariable(variable.name(), node);
        if (variable.flavor() == AST::VariableFlavor::Var)
            info.localVarDecls.add(variable.name());

        return cf;
    }

    case AST::NodeKind::IfStatement: {
        auto& ifStmt = uncheckedDowncast<AST::IfStatement>(statement);
        auto [cfCond, vCond] = processExpression(cf, ifStmt.test());

        auto* condNode = info.createNode(&ifStmt);
        condNode->affectsControlFlow = true;
        condNode->addEdge(vCond);
        // Code guarded by (or following, via an interrupting branch) this `if` is
        // reachable only along the control flow that reached the condition, so it
        // must inherit the uniformity of the incoming control flow. Without this
        // edge, an op inside `if u { op }` nested in a non-uniform loop would lose
        // the loop's non-uniformity.
        condNode->addEdge(cfCond);

        info.pushScope();
        auto* cfTrue = processStatements(condNode, ifStmt.trueBody().statements());
        auto trueVars = info.popScopeCapture();

        // Remove variables from localVarDecls that were declared only in this scope
        trueVars.removeIf([&](auto& entry) {
            if (!info.getVariable(entry.key)) {
                info.localVarDecls.remove(entry.key);
                return true;
            }
            return false;
        });

        bool trueHasNext = ifStmt.trueBody().behaviors().contains(Behavior::Next);

        HashMap<String, Node*> falseVars;
        Node* cfFalse = nullptr;
        bool falseHasNext = true;
        if (auto* falseBody = ifStmt.maybeFalseBody()) {
            info.pushScope();
            cfFalse = processStatement(condNode, *falseBody);
            falseVars = info.popScopeCapture();

            falseVars.removeIf([&](auto& entry) {
                if (!info.getVariable(entry.key)) {
                    info.localVarDecls.remove(entry.key);
                    return true;
                }
                return false;
            });

            falseHasNext = falseBody->behaviors().contains(Behavior::Next);
        }

        for (auto& varName : info.localVarDecls) {
            if (!trueVars.contains(varName) && !falseVars.contains(varName))
                continue;

            auto* mergeNode = info.createNode();
            if (trueHasNext) {
                auto trueIt = trueVars.find(varName);
                mergeNode->addEdge(trueIt != trueVars.end() ? trueIt->value : info.getVariable(varName));
            }
            if (falseHasNext) {
                auto falseIt = falseVars.find(varName);
                mergeNode->addEdge(falseIt != falseVars.end() ? falseIt->value : info.getVariable(varName));
            }
            info.setVariable(varName, mergeNode);
        }

        auto behaviors = statement.behaviors();
        if (behaviors != Behaviors(Behavior::Next)) {
            auto* cfEnd = info.createNode();
            cfEnd->addEdge(cfTrue);
            if (cfFalse)
                cfEnd->addEdge(cfFalse);
            return cfEnd;
        }
        return cf;
    }

    case AST::NodeKind::SwitchStatement: {
        auto& switchStmt = uncheckedDowncast<AST::SwitchStatement>(statement);
        auto [cfx, vCond] = processExpression(cf, switchStmt.value());

        auto* condNode = info.createNode(&switchStmt);
        condNode->affectsControlFlow = true;
        condNode->addEdge(vCond);

        auto behaviors = statement.behaviors();
        Node* cfEnd = nullptr;
        if (behaviors != Behaviors(Behavior::Next))
            cfEnd = info.createNode();

        auto loopSwitchInfo = std::unique_ptr<LoopSwitchInfo>(new LoopSwitchInfo);
        auto* loopSwitchInfoPtr = loopSwitchInfo.get();
        m_loopSwitchInfos.append(WTF::move(loopSwitchInfo));
        m_loopSwitchStack.append(loopSwitchInfoPtr);

        auto processCase = [&](AST::CompoundStatement& body) {
            info.pushScope();
            auto* cfCase = processStatements(condNode, body.statements());
            if (cfEnd)
                cfEnd->addEdge(cfCase);

            auto caseBehaviors = body.behaviors();
            if (caseBehaviors.contains(Behavior::Next)) {
                auto caseVars = info.popScopeCapture();
                for (auto& varName : info.localVarDecls) {
                    auto exitIt = loopSwitchInfoPtr->varExitNodes.find(varName);
                    Node* exitNode;
                    if (exitIt != loopSwitchInfoPtr->varExitNodes.end())
                        exitNode = exitIt->value;
                    else {
                        exitNode = info.createNode();
                        loopSwitchInfoPtr->varExitNodes.set(varName, exitNode);
                    }
                    auto caseIt = caseVars.find(varName);
                    if (caseIt != caseVars.end())
                        exitNode->addEdge(caseIt->value);
                    else {
                        auto* preVal = info.getVariable(varName);
                        if (preVal)
                            exitNode->addEdge(preVal);
                    }
                }
            } else
                info.popScopeCapture();
        };

        for (auto& clause : switchStmt.clauses())
            processCase(clause.body.get());
        processCase(switchStmt.defaultClause().body.get());

        m_loopSwitchStack.removeLast();

        for (auto& entry : loopSwitchInfoPtr->varExitNodes)
            info.setVariable(entry.key, entry.value);

        return cfEnd ?: cf;
    }

    case AST::NodeKind::ForStatement: {
        auto& forStmt = uncheckedDowncast<AST::ForStatement>(statement);

        auto* cfInit = cf;
        if (forStmt.maybeInitializer())
            cfInit = processStatement(cf, *forStmt.maybeInitializer());

        auto* cfx = info.createNode();

        auto loopSwitchInfo = std::unique_ptr<LoopSwitchInfo>(new LoopSwitchInfo);
        auto* loopSwitchInfoPtr = loopSwitchInfo.get();
        m_loopSwitchInfos.append(WTF::move(loopSwitchInfo));
        m_loopSwitchStack.append(loopSwitchInfoPtr);

        for (auto& varName : info.localVarDecls) {
            auto* inNode = info.createNode();
            auto* currentVal = info.getVariable(varName);
            if (currentVal)
                inNode->addEdge(currentVal);
            loopSwitchInfoPtr->varInNodes.set(varName, inNode);
            info.setVariable(varName, inNode);
        }

        auto* cfStart = cfx;
        if (forStmt.maybeTest()) {
            auto [cfCond, vCond] = processExpression(cfx, *forStmt.maybeTest());
            auto* condEnd = info.createNode(&forStmt);
            condEnd->affectsControlFlow = true;
            condEnd->addEdge(vCond);
            cfStart = condEnd;

            for (auto& varName : info.localVarDecls) {
                auto exitIt = loopSwitchInfoPtr->varExitNodes.find(varName);
                Node* exitNode;
                if (exitIt != loopSwitchInfoPtr->varExitNodes.end())
                    exitNode = exitIt->value;
                else {
                    exitNode = info.createNode();
                    loopSwitchInfoPtr->varExitNodes.set(varName, exitNode);
                }
                auto* currentVal = info.getVariable(varName);
                if (currentVal)
                    exitNode->addEdge(currentVal);
            }
        }

        auto* cf1 = processStatements(cfStart, forStmt.body().statements());

        if (forStmt.maybeUpdate())
            cf1 = processStatement(cf1, *forStmt.maybeUpdate());

        cfx->addEdge(cf1);
        cfx->addEdge(cfInit);

        for (auto& entry : loopSwitchInfoPtr->varInNodes) {
            auto* inNode = entry.value;
            auto* outNode = info.getVariable(entry.key);
            if (outNode && outNode != inNode)
                inNode->addEdge(outNode);
        }

        m_loopSwitchStack.removeLast();

        for (auto& entry : loopSwitchInfoPtr->varExitNodes)
            info.setVariable(entry.key, entry.value);

        if (forStmt.maybeInitializer()) {
            if (auto* varStmt = dynamicDowncast<AST::VariableStatement>(*forStmt.maybeInitializer()))
                info.localVarDecls.remove(varStmt->variable().name());
        }

        auto behaviors = statement.behaviors();
        if (behaviors == Behaviors(Behavior::Next))
            return cf;
        return cfx;
    }

    case AST::NodeKind::WhileStatement: {
        auto& whileStmt = uncheckedDowncast<AST::WhileStatement>(statement);

        auto* cfx = info.createNode();

        auto loopSwitchInfo = std::unique_ptr<LoopSwitchInfo>(new LoopSwitchInfo);
        auto* loopSwitchInfoPtr = loopSwitchInfo.get();
        m_loopSwitchInfos.append(WTF::move(loopSwitchInfo));
        m_loopSwitchStack.append(loopSwitchInfoPtr);

        for (auto& varName : info.localVarDecls) {
            auto* inNode = info.createNode();
            auto* currentVal = info.getVariable(varName);
            if (currentVal)
                inNode->addEdge(currentVal);
            loopSwitchInfoPtr->varInNodes.set(varName, inNode);
            info.setVariable(varName, inNode);
        }

        auto [cfCond, vCond] = processExpression(cfx, whileStmt.test());
        auto* condEnd = info.createNode(&whileStmt);
        condEnd->affectsControlFlow = true;
        condEnd->addEdge(vCond);

        for (auto& varName : info.localVarDecls) {
            auto exitIt = loopSwitchInfoPtr->varExitNodes.find(varName);
            Node* exitNode;
            if (exitIt != loopSwitchInfoPtr->varExitNodes.end())
                exitNode = exitIt->value;
            else {
                exitNode = info.createNode();
                loopSwitchInfoPtr->varExitNodes.set(varName, exitNode);
            }
            auto* currentVal = info.getVariable(varName);
            if (currentVal)
                exitNode->addEdge(currentVal);
        }

        auto* cf1 = processStatements(condEnd, whileStmt.body().statements());

        cfx->addEdge(cf1);
        cfx->addEdge(cf);

        for (auto& entry : loopSwitchInfoPtr->varInNodes) {
            auto* inNode = entry.value;
            auto* outNode = info.getVariable(entry.key);
            if (outNode && outNode != inNode)
                inNode->addEdge(outNode);
        }

        m_loopSwitchStack.removeLast();

        for (auto& entry : loopSwitchInfoPtr->varExitNodes)
            info.setVariable(entry.key, entry.value);

        auto behaviors = statement.behaviors();
        if (behaviors == Behaviors(Behavior::Next))
            return cf;
        return cfx;
    }

    case AST::NodeKind::LoopStatement: {
        auto& loopStmt = uncheckedDowncast<AST::LoopStatement>(statement);

        auto* cfx = info.createNode();

        auto loopSwitchInfo = std::unique_ptr<LoopSwitchInfo>(new LoopSwitchInfo);
        auto* loopSwitchInfoPtr = loopSwitchInfo.get();
        m_loopSwitchInfos.append(WTF::move(loopSwitchInfo));
        m_loopSwitchStack.append(loopSwitchInfoPtr);

        for (auto& varName : info.localVarDecls) {
            auto* inNode = info.createNode();
            auto* currentVal = info.getVariable(varName);
            if (currentVal)
                inNode->addEdge(currentVal);
            loopSwitchInfoPtr->varInNodes.set(varName, inNode);
            info.setVariable(varName, inNode);
        }

        info.pushScope();
        auto* cf1 = processStatements(cfx, loopStmt.body());

        if (auto& continuing = loopStmt.continuing()) {
            auto bodyBehaviors = loopStmt.bodyBehaviors();
            if (bodyBehaviors.contains(Behavior::Next) || bodyBehaviors.contains(Behavior::Continue)) {
                cf1 = processStatements(cf1, continuing->body);

                if (continuing->breakIf) {
                    auto [cfBr, vBr] = processExpression(cf1, *continuing->breakIf);

                    auto* breakIfNode = info.createNode(&*continuing->breakIf);
                    breakIfNode->affectsControlFlow = true;
                    breakIfNode->addEdge(vBr);

                    for (auto& varName : info.localVarDecls) {
                        auto exitIt = loopSwitchInfoPtr->varExitNodes.find(varName);
                        Node* exitNode;
                        if (exitIt != loopSwitchInfoPtr->varExitNodes.end())
                            exitNode = exitIt->value;
                        else {
                            exitNode = info.createNode();
                            loopSwitchInfoPtr->varExitNodes.set(varName, exitNode);
                        }
                        auto* currentVal = info.getVariable(varName);
                        if (currentVal)
                            exitNode->addEdge(currentVal);
                    }

                    auto* cfBreakEnd = info.createNode();
                    cfBreakEnd->addEdge(breakIfNode);
                    cf1 = cfBreakEnd;
                }
            }
        }

        auto bodyTopVars = info.popScopeCapture();
        for (auto& entry : bodyTopVars) {
            if (info.getVariable(entry.key))
                info.setVariable(entry.key, entry.value);
            else
                info.localVarDecls.remove(entry.key);
        }

        cfx->addEdge(cf1);
        cfx->addEdge(cf);

        for (auto& entry : loopSwitchInfoPtr->varInNodes) {
            auto* inNode = entry.value;
            auto* outNode = info.getVariable(entry.key);
            if (outNode && outNode != inNode)
                inNode->addEdge(outNode);
        }

        m_loopSwitchStack.removeLast();

        for (auto& entry : loopSwitchInfoPtr->varExitNodes)
            info.setVariable(entry.key, entry.value);

        auto behaviors = statement.behaviors();
        if (behaviors == Behaviors(Behavior::Next))
            return cf;
        return cfx;
    }

    case AST::NodeKind::BreakStatement: {
        if (!m_loopSwitchStack.isEmpty()) {
            auto* loopSwitchInfoPtr = m_loopSwitchStack.last();
            for (auto& varName : info.localVarDecls) {
                auto exitIt = loopSwitchInfoPtr->varExitNodes.find(varName);
                Node* exitNode;
                if (exitIt != loopSwitchInfoPtr->varExitNodes.end())
                    exitNode = exitIt->value;
                else {
                    exitNode = info.createNode();
                    loopSwitchInfoPtr->varExitNodes.set(varName, exitNode);
                }
                auto* currentVal = info.getVariable(varName);
                if (currentVal)
                    exitNode->addEdge(currentVal);
            }
        }
        return cf;
    }

    case AST::NodeKind::ContinueStatement: {
        for (int i = m_loopSwitchStack.size() - 1; i >= 0; --i) {
            auto* loopSwitchInfoPtr = m_loopSwitchStack[i];
            if (!loopSwitchInfoPtr->varInNodes.isEmpty()) {
                for (auto& entry : loopSwitchInfoPtr->varInNodes) {
                    auto* inNode = entry.value;
                    auto* outNode = info.getVariable(entry.key);
                    if (outNode && outNode != inNode)
                        inNode->addEdge(outNode);
                }
                break;
            }
        }
        return cf;
    }

    case AST::NodeKind::ReturnStatement: {
        auto& retStmt = uncheckedDowncast<AST::ReturnStatement>(statement);
        if (retStmt.maybeExpression() && info.valueReturn) {
            auto [cfR, v] = processExpression(cf, *retStmt.maybeExpression());
            info.valueReturn->addEdge(v);
            cf = cfR;
        }

        for (auto& paramInfo : info.parameters) {
            if (paramInfo.ptrOutputContents) {
                auto* currentVal = info.getVariable(paramInfo.name);
                if (currentVal)
                    paramInfo.ptrOutputContents->addEdge(currentVal);
            }
        }
        return cf;
    }

    case AST::NodeKind::DiscardStatement:
        return cf;

    case AST::NodeKind::CallStatement: {
        auto& callStmt = uncheckedDowncast<AST::CallStatement>(statement);
        auto [cfOut, _] = processCall(cf, callStmt.call());
        return cfOut;
    }

    default:
        return cf;
    }
}

std::pair<Node*, Node*> UniformityGraph::processExpression(Node* cf, AST::Expression& expression)
{
    auto& info = *m_currentFunction;

    if (is<AST::AbstractFloatLiteral>(expression)
        || is<AST::AbstractIntegerLiteral>(expression)
        || is<AST::BoolLiteral>(expression)
        || is<AST::Float16Literal>(expression)
        || is<AST::Float32Literal>(expression)
        || is<AST::Signed32Literal>(expression)
        || is<AST::Unsigned32Literal>(expression))
        return { cf, cf };

    if (auto* identExpr = dynamicDowncast<AST::IdentifierExpression>(expression)) {
        auto* node = info.createNode(&expression);
        auto* currentValue = info.getVariable(identExpr->identifier().id());
        if (currentValue)
            node->addEdge(currentValue);
        return { cf, node };
    }

    if (auto* identityExpr = dynamicDowncast<AST::IdentityExpression>(expression))
        return processExpression(cf, identityExpr->expression());

    if (auto* unaryExpr = dynamicDowncast<AST::UnaryExpression>(expression)) {
        if (unaryExpr->operation() == AST::UnaryOperation::AddressOf)
            return processAddressOf(cf, unaryExpr->expression());
        return processExpression(cf, unaryExpr->expression());
    }

    if (auto* derefExpr = dynamicDowncast<AST::PointerDereferenceExpression>(expression))
        return processExpression(cf, derefExpr->target());

    if (auto* binaryExpr = dynamicDowncast<AST::BinaryExpression>(expression)) {
        bool isShortCircuit = binaryExpr->operation() == AST::BinaryOperation::ShortCircuitAnd
            || binaryExpr->operation() == AST::BinaryOperation::ShortCircuitOr;

        if (isShortCircuit) {
            auto [cf1, v1] = processExpression(cf, binaryExpr->leftExpression());
            auto* scNode = info.createNode(&expression);
            scNode->affectsControlFlow = true;
            scNode->addEdge(v1);
            auto [cf2, v2] = processExpression(scNode, binaryExpr->rightExpression());
            auto* result = info.createNode(&expression);
            result->addEdge(v1);
            result->addEdge(v2);
            return { cf, result };
        }

        auto [cf1, v1] = processExpression(cf, binaryExpr->leftExpression());
        auto [cf2, v2] = processExpression(cf1, binaryExpr->rightExpression());
        auto* result = info.createNode(&expression);
        result->addEdge(v1);
        result->addEdge(v2);
        return { cf2, result };
    }

    if (auto* callExpr = dynamicDowncast<AST::CallExpression>(expression))
        return processCall(cf, *callExpr);

    if (auto* indexExpr = dynamicDowncast<AST::IndexAccessExpression>(expression)) {
        auto [cf1, v1] = processExpression(cf, indexExpr->base());
        auto [cf2, v2] = processExpression(cf1, indexExpr->index());
        auto* result = info.createNode(&expression);
        result->addEdge(v1);
        result->addEdge(v2);
        return { cf2, result };
    }

    if (auto* fieldExpr = dynamicDowncast<AST::FieldAccessExpression>(expression)) {
        if (auto* unaryBase = dynamicDowncast<AST::UnaryExpression>(fieldExpr->base())) {
            if (unaryBase->operation() == AST::UnaryOperation::AddressOf)
                return processExpression(cf, unaryBase->expression());
        }
        return processExpression(cf, fieldExpr->base());
    }

    return { cf, cf };
}

std::pair<Node*, Node*> UniformityGraph::processAddressOf(Node* cf, AST::Expression& expression)
{
    auto& info = *m_currentFunction;

    if (is<AST::IdentifierExpression>(expression))
        return { cf, cf };

    if (auto* fieldExpr = dynamicDowncast<AST::FieldAccessExpression>(expression))
        return processAddressOf(cf, fieldExpr->base());

    if (auto* indexExpr = dynamicDowncast<AST::IndexAccessExpression>(expression)) {
        auto [cf1, baseVal] = processAddressOf(cf, indexExpr->base());
        auto [cf2, indexVal] = processExpression(cf1, indexExpr->index());
        auto* result = info.createNode(&expression);
        result->addEdge(baseVal);
        result->addEdge(indexVal);
        return { cf2, result };
    }

    if (auto* identityExpr = dynamicDowncast<AST::IdentityExpression>(expression))
        return processAddressOf(cf, identityExpr->expression());

    if (auto* derefExpr = dynamicDowncast<AST::PointerDereferenceExpression>(expression))
        return processExpression(cf, derefExpr->target());

    if (auto* unaryExpr = dynamicDowncast<AST::UnaryExpression>(expression)) {
        if (unaryExpr->operation() == AST::UnaryOperation::Dereference)
            return processExpression(cf, unaryExpr->expression());
        return processAddressOf(cf, unaryExpr->expression());
    }

    return processExpression(cf, expression);
}

UniformityGraph::LValue UniformityGraph::processLValueExpression(Node* cf, AST::Expression& expr, bool isPartialReference)
{
    auto& info = *m_currentFunction;

    if (auto* identExpr = dynamicDowncast<AST::IdentifierExpression>(expr)) {
        auto& name = identExpr->identifier().id();
        auto* value = info.createNode(&expr);

        if (isPartialReference) {
            auto* oldValue = info.getVariable(name);
            if (oldValue)
                value->addEdge(oldValue);
        }

        return { cf, value, name };
    }

    if (auto* indexExpr = dynamicDowncast<AST::IndexAccessExpression>(expr)) {
        auto [cf1, lhsValue, rootIdent] = processLValueExpression(cf, indexExpr->base(), true);
        auto [cf2, vIdx] = processExpression(cf1, indexExpr->index());
        lhsValue->addEdge(vIdx);
        return { cf2, lhsValue, rootIdent };
    }

    if (auto* fieldExpr = dynamicDowncast<AST::FieldAccessExpression>(expr))
        return processLValueExpression(cf, fieldExpr->base(), true);

    if (auto* identityExpr = dynamicDowncast<AST::IdentityExpression>(expr))
        return processLValueExpression(cf, identityExpr->expression(), isPartialReference);

    if (auto* unaryExpr = dynamicDowncast<AST::UnaryExpression>(expr))
        return processLValueExpression(cf, unaryExpr->expression(), isPartialReference);

    if (auto* derefExpr = dynamicDowncast<AST::PointerDereferenceExpression>(expr))
        return processLValueExpression(cf, derefExpr->target(), isPartialReference);

    return { cf, info.createNode(), { } };
}

std::pair<Node*, Node*> UniformityGraph::processCall(Node* cf, AST::CallExpression& call)
{
    auto& info = *m_currentFunction;

    auto* target = dynamicDowncast<AST::IdentifierExpression>(call.target());
    String name;
    if (target)
        name = target->identifier().id();

    Node* cfLastArg = cf;
    Vector<Node*> args;
    Vector<Node*> ptrArgContents;
    args.resize(call.arguments().size());
    ptrArgContents.resize(call.arguments().size());

    for (unsigned i = 0; i < call.arguments().size(); ++i) {
        auto& arg = call.arguments()[i];
        auto [cfI, argI] = processExpression(cfLastArg, arg);

        auto* argNode = info.createNode(&call);
        argNode->addEdge(argI);

        bool isPointerArg = std::holds_alternative<Types::Pointer>(*arg.inferredType());

        if (isPointerArg) {
            auto* argContents = info.createNode(&call);
            auto* rootIdent = rootIdentifier(arg);
            if (rootIdent) {
                auto* rootVal = info.getVariable(rootIdent->identifier().id());
                if (rootVal)
                    argContents->addEdge(rootVal);
            }
            argContents->addEdge(argNode);
            ptrArgContents[i] = argContents;
        }

        cfLastArg = cfI;
        args[i] = argNode;
    }

    auto* callNode = info.createNode(&call);
    callNode->addEdge(cfLastArg);

    auto* result = info.createNode(&call);
    auto* cfAfter = info.createNode(&call);

    CallSiteTag callSiteTag = CallSiteTag::NoRestriction;
    SeverityControl callSiteSeverity = SeverityControl::Error;
    FunctionTag functionTag = FunctionTag::NoRestriction;
    const FunctionInfo* funcInfo = nullptr;
    std::optional<unsigned> subgroupUniformArgIndex;
    bool resultIsUniformRegardlessOfArgs = false;

    if (!name.isEmpty()) {
        auto it = m_functions.find(name);
        if (it != m_functions.end()) {
            funcInfo = &it->value;
            callSiteTag = funcInfo->callSiteTag.tag;
            callSiteSeverity = funcInfo->callSiteTag.severity;
            functionTag = funcInfo->functionTag;
        } else {
            static constexpr SortedArraySet barrierFunctions { WTF::toArray<ComparableASCIILiteral>({
                "storageBarrier"_s,
                "textureBarrier"_s,
                "workgroupBarrier"_s,
            }) };

            static constexpr SortedArraySet derivativeFunctions { WTF::toArray<ComparableASCIILiteral>({
                "dpdx"_s,
                "dpdxCoarse"_s,
                "dpdxFine"_s,
                "dpdy"_s,
                "dpdyCoarse"_s,
                "dpdyFine"_s,
                "fwidth"_s,
                "fwidthCoarse"_s,
                "fwidthFine"_s,
                "textureSample"_s,
                "textureSampleBias"_s,
                "textureSampleCompare"_s,
            }) };

            static constexpr SortedArraySet atomicFunctions { WTF::toArray<ComparableASCIILiteral>({
                "atomicAdd"_s,
                "atomicAnd"_s,
                "atomicCompareExchangeWeak"_s,
                "atomicExchange"_s,
                "atomicLoad"_s,
                "atomicMax"_s,
                "atomicMin"_s,
                "atomicOr"_s,
                "atomicStore"_s,
                "atomicSub"_s,
                "atomicXor"_s,
            }) };

            // Subgroup and quad built-in functions communicate across invocations,
            // so (absent the subgroup_uniformity language feature, which we do not
            // support) they require uniform control flow at their call site and may
            // return a non-uniform value. This is governed by the subgroup_uniformity
            // triggering rule rather than derivative_uniformity.
            static constexpr SortedArraySet subgroupFunctions { WTF::toArray<ComparableASCIILiteral>({
                "quadBroadcast"_s,
                "quadSwapDiagonal"_s,
                "quadSwapX"_s,
                "quadSwapY"_s,
                "subgroupAdd"_s,
                "subgroupAll"_s,
                "subgroupAnd"_s,
                "subgroupAny"_s,
                "subgroupBallot"_s,
                "subgroupBroadcast"_s,
                "subgroupBroadcastFirst"_s,
                "subgroupElect"_s,
                "subgroupExclusiveAdd"_s,
                "subgroupExclusiveMul"_s,
                "subgroupInclusiveAdd"_s,
                "subgroupInclusiveMul"_s,
                "subgroupMax"_s,
                "subgroupMin"_s,
                "subgroupMul"_s,
                "subgroupOr"_s,
                "subgroupShuffle"_s,
                "subgroupShuffleDown"_s,
                "subgroupShuffleUp"_s,
                "subgroupShuffleXor"_s,
                "subgroupXor"_s,
            }) };

            // Functions whose result is subgroup-uniform when evaluated in uniform
            // control flow at subgroup scope (https://www.w3.org/TR/WGSL/#uniformity).
            // The remaining subgroup/quad ops (shuffles, scans, quad swaps) may still
            // produce a non-uniform result even at subgroup scope.
            static constexpr SortedArraySet subgroupUniformResultFunctions { WTF::toArray<ComparableASCIILiteral>({
                "subgroupAdd"_s,
                "subgroupAll"_s,
                "subgroupAnd"_s,
                "subgroupAny"_s,
                "subgroupBallot"_s,
                "subgroupBroadcast"_s,
                "subgroupBroadcastFirst"_s,
                "subgroupMax"_s,
                "subgroupMin"_s,
                "subgroupMul"_s,
                "subgroupOr"_s,
                "subgroupXor"_s,
            }) };

            if (barrierFunctions.contains(name)) {
                // Barriers are a workgroup concern; they impose no requirement at subgroup scope.
                if (!m_analyzingSubgroupScope)
                    callSiteTag = CallSiteTag::RequiredToBeUniform;
            } else if (name == "workgroupUniformLoad"_s) {
                if (!m_analyzingSubgroupScope)
                    callSiteTag = CallSiteTag::RequiredToBeUniform;
            } else if (derivativeFunctions.contains(name)) {
                // Derivatives are governed by derivative_uniformity (workgroup/draw scope only).
                if (!m_analyzingSubgroupScope) {
                    callSiteSeverity = currentSeverity();
                    if (callSiteSeverity != SeverityControl::Off)
                        callSiteTag = CallSiteTag::RequiredToBeUniform;
                }
                functionTag = FunctionTag::ReturnValueMayBeNonUniform;
            } else if (subgroupFunctions.contains(name)) {
                // Subgroup/quad ops require uniform control flow, enforced either at
                // workgroup scope (feature off) or subgroup scope (feature on).
                bool enforcedInThisScope = m_analyzingSubgroupScope || !m_supportsSubgroupUniformity;
                if (enforcedInThisScope) {
                    callSiteSeverity = currentSubgroupSeverity();
                    if (callSiteSeverity != SeverityControl::Off)
                        callSiteTag = CallSiteTag::RequiredToBeUniform;
                    // subgroupShuffleUp/Down require a uniform `delta`, and subgroupShuffleXor
                    // a uniform `mask` (argument index 1).
                    if (name == "subgroupShuffleUp"_s || name == "subgroupShuffleDown"_s || name == "subgroupShuffleXor"_s)
                        subgroupUniformArgIndex = 1;
                }
                // At subgroup scope, the reduction/broadcast ops produce a uniform result;
                // everywhere else (and for shuffles/scans/quad swaps) the result may be non-uniform.
                if (m_analyzingSubgroupScope && subgroupUniformResultFunctions.contains(name))
                    resultIsUniformRegardlessOfArgs = true;
                else
                    functionTag = FunctionTag::ReturnValueMayBeNonUniform;
            } else if (atomicFunctions.contains(name))
                functionTag = FunctionTag::ReturnValueMayBeNonUniform;
            else if (name == "textureLoad"_s) {
                auto* argType = call.arguments()[0].inferredType();
                if (auto* texStorage = std::get_if<Types::TextureStorage>(argType)) {
                    if (texStorage->access == AccessMode::ReadWrite)
                        functionTag = FunctionTag::ReturnValueMayBeNonUniform;
                }
            }
        }
    }

    cfAfter->addEdge(callNode);

    if (functionTag == FunctionTag::ReturnValueMayBeNonUniform)
        result->addEdge(info.mayBeNonUniform);

    result->addEdge(cfAfter);

    for (unsigned i = 0; i < args.size(); ++i) {
        if (funcInfo) {
            auto& paramInfo = funcInfo->parameters[i];

            switch (paramInfo.tagDirect.tag) {
            case ParameterTag::ValueRequiredToBeUniform:
                if (auto* node = info.requiredToBeUniformForSeverity(paramInfo.tagDirect.severity))
                    node->addEdge(args[i]);
                break;
            case ParameterTag::ContentsRequiredToBeUniform:
                if (ptrArgContents[i]) {
                    if (auto* node = info.requiredToBeUniformForSeverity(paramInfo.tagDirect.severity))
                        node->addEdge(ptrArgContents[i]);
                }
                break;
            case ParameterTag::NoRestriction:
                break;
            }

            switch (paramInfo.tagRetval) {
            case ParameterTag::ValueRequiredToBeUniform:
                result->addEdge(args[i]);
                break;
            case ParameterTag::ContentsRequiredToBeUniform:
                if (ptrArgContents[i])
                    result->addEdge(ptrArgContents[i]);
                break;
            case ParameterTag::NoRestriction:
                break;
            }

            auto& arg = call.arguments()[i];
            bool isPointerArg = std::holds_alternative<Types::Pointer>(*arg.inferredType());
            if (isPointerArg) {
                auto* ptrResult = info.createNode(&call);
                if (paramInfo.pointerMayBecomeNonUniform)
                    ptrResult->addEdge(info.mayBeNonUniform);
                else {
                    ptrResult->addEdge(callNode);
                    for (auto j : paramInfo.ptrOutputSourceParamValues)
                        ptrResult->addEdge(args[j]);
                    for (auto j : paramInfo.ptrOutputSourceParamContents) {
                        if (ptrArgContents[j])
                            ptrResult->addEdge(ptrArgContents[j]);
                    }
                }

                auto* rootIdent = rootIdentifier(arg);
                if (rootIdent)
                    info.setVariable(rootIdent->identifier().id(), ptrResult);
            }
        } else {
            if (name == "workgroupUniformLoad"_s && !m_analyzingSubgroupScope) {
                // workgroupUniformLoad requires the pointer VALUE to be
                // uniform (same memory location across invocations), but
                // NOT the contents. For pointer parameters, args[i] reaches
                // ptrInputContents (contents tracking), which would cause
                // getParamTag to incorrectly tag as ContentsRequiredToBeUniform.
                // Use paramInfo.value instead to get ValueRequiredToBeUniform.
                // This is a workgroup concern, so it does not apply at subgroup scope.
                auto* ptrValueNode = args[i];
                auto* rootId = rootIdentifier(call.arguments()[i]);
                if (rootId) {
                    for (auto& paramInfo : info.parameters) {
                        if (paramInfo.name == rootId->identifier().id() && paramInfo.ptrInputContents) {
                            ptrValueNode = paramInfo.value;
                            break;
                        }
                    }
                }
                if (auto* node = info.requiredToBeUniformForSeverity(callSiteSeverity))
                    node->addEdge(ptrValueNode);
            } else {
                // A subgroup reduction/broadcast at subgroup scope yields a uniform
                // result regardless of whether its inputs are uniform, so its result
                // must not inherit argument non-uniformity.
                if (!resultIsUniformRegardlessOfArgs)
                    result->addEdge(args[i]);
                // subgroupShuffleUp/Down `delta` and subgroupShuffleXor `mask` must be uniform.
                if (subgroupUniformArgIndex && *subgroupUniformArgIndex == i) {
                    if (auto* node = info.requiredToBeUniformForSeverity(callSiteSeverity))
                        node->addEdge(args[i]);
                }
            }
        }
    }

    if (callSiteTag == CallSiteTag::RequiredToBeUniform) {
        if (auto* node = info.requiredToBeUniformForSeverity(callSiteSeverity))
            node->addEdge(callNode);
    }

    return { cfAfter, result };
}

} // namespace

std::optional<FailedCheck> uniformityAnalysis(ShaderModule& shaderModule)
{
    UniformityGraph graph(shaderModule);
    return graph.run();
}

} // namespace WGSL
