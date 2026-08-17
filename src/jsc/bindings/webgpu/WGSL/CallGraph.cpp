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
#include "CallGraph.h"

#include "AST.h"
#include "ASTVisitor.h"
#include "WGSLShaderModule.h"
#include <wtf/Deque.h>

namespace WGSL {

class CallGraphBuilder : public AST::Visitor {
public:
    CallGraphBuilder(ShaderModule& shaderModule)
        : m_shaderModule(shaderModule)
    {
    }

    void build();

    void visit(AST::Function&) override;
    void visit(AST::CallExpression&) override;

private:
    void initializeMappings();

    ShaderModule& m_shaderModule;
    CallGraph m_callGraph;
    HashMap<AST::Function*, unsigned> m_calleeBuildingMap;
    Vector<CallGraph::Callee>* m_callees { nullptr };
    AST::Function* m_currentFunction { nullptr };
    Deque<AST::Function*> m_queue;
};

void CallGraphBuilder::build()
{
    initializeMappings();
    m_shaderModule.setCallGraph(WTF::move(m_callGraph));
}

void CallGraphBuilder::initializeMappings()
{
    for (auto& declaration : m_shaderModule.declarations()) {
        auto* function = dynamicDowncast<AST::Function>(declaration);
        if (!function)
            continue;

        const auto& name = function->name();
        {
            auto result = m_callGraph.m_functionsByName.add(name, function);
            ASSERT_UNUSED(result, result.isNewEntry);
        }

        if (!function->stage())
            continue;

        m_callGraph.m_entrypoints.append({ *function, *function->stage(), function->name() });
        m_queue.append(function);
    }

    while (!m_queue.isEmpty())
        visit(*m_queue.takeFirst());
}

void CallGraphBuilder::visit(AST::Function& function)
{
    auto result = m_callGraph.m_calleeMap.add(&function, Vector<CallGraph::Callee>());
    if (!result.isNewEntry)
        return;

    ASSERT(!m_callees);
    m_callees = &result.iterator->value;
    m_currentFunction = &function;
    AST::Visitor::visit(function);
    m_calleeBuildingMap.clear();
    m_currentFunction = nullptr;
    m_callees = nullptr;
}

void CallGraphBuilder::visit(AST::CallExpression& call)
{
    for (auto& argument : call.arguments())
        AST::Visitor::visit(argument);

    auto* target = dynamicDowncast<AST::IdentifierExpression>(call.target());
    if (!target)
        return;

    auto it = m_callGraph.m_functionsByName.find(target->identifier());
    if (it == m_callGraph.m_functionsByName.end())
        return;

    m_queue.append(it->value);
    auto result = m_calleeBuildingMap.add(it->value, m_callees->size());
    if (result.isNewEntry)
        m_callees->append(CallGraph::Callee { it->value, { { m_currentFunction, &call } } });
    else
        m_callees->at(result.iterator->value).callSites.append({ m_currentFunction, &call });
}

void buildCallGraph(ShaderModule& shaderModule)
{
    CallGraphBuilder(shaderModule).build();
}

} // namespace WGSL
