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
#include "GlobalSorting.h"

#include "ASTIdentifierExpression.h"
#include "ASTScopedVisitorInlines.h"
#include "ASTVariableStatement.h"
#include "ContextProviderInlines.h"
#include "WGSLShaderModule.h"
#include <wtf/DataLog.h>
#include <wtf/Deque.h>
#include <wtf/HashMap.h>
#include <wtf/ListHashSet.h>
#include <wtf/SetForScope.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>

namespace WGSL {

constexpr bool shouldLogGlobalSorting = false;

inline String nameForDeclaration(AST::Declaration& declaration)
{
    return is<AST::ConstAssert>(declaration) ? "const_assert"_s : declaration.name().id();
}

class Graph {
public:
    class Edge;
    class Node;
    struct EdgeHash;
    struct EdgeHashTraits;
    using EdgeSet = ListHashSet<Edge, EdgeHash>;

    class Edge {
        friend EdgeHash;
        friend EdgeHashTraits;
    public:
        Edge()
            : m_source(nullptr)
            , m_target(nullptr)
        {
        }

        Edge(Node& source, Node& target)
            : m_source(&source)
            , m_target(&target)
        {
        }

        Node& NODELETE source() const { return *m_source; }
        Node& NODELETE target() const { return *m_target; }

        bool NODELETE operator==(const Edge& other) const
        {
            return m_source == other.m_source && m_target == other.m_target;
        }

    private:
        Node* m_source;
        Node* m_target;
    };

    struct EdgeHashTraits : HashTraits<Edge> {
        static constexpr bool emptyValueIsZero = true;
        static void NODELETE constructDeletedValue(Edge& slot) { slot.m_source = std::bit_cast<Node*>(static_cast<intptr_t>(-1)); }
        static bool NODELETE isDeletedValue(const Edge& edge) { return edge.m_source == std::bit_cast<Node*>(static_cast<intptr_t>(-1)); }
    };

    struct EdgeHash {
        static unsigned hash(const Edge& edge)
        {
            return WTF::TupleHash<Node*, Node*>::hash(std::tuple(edge.m_source, edge.m_target));
        }
        static bool NODELETE equal(const Edge& a, const Edge& b)
        {
            return a == b;
        }
        static constexpr bool safeToCompareToEmptyOrDeleted = true;
    };

    class Node {
    public:
        Node()
            : m_astNode(nullptr)
        {
        }

        Node(unsigned index, AST::Declaration& astNode)
            : m_index(index)
            , m_astNode(&astNode)
        {
        }

        unsigned NODELETE index() const { return m_index; }
        AST::Declaration& NODELETE astNode() const { return *m_astNode; }
        EdgeSet& NODELETE incomingEdges() { return m_incomingEdges; }
        EdgeSet& NODELETE outgoingEdges() { return m_outgoingEdges; }

    private:
        unsigned m_index;
        AST::Declaration* m_astNode;
        EdgeSet m_incomingEdges;
        EdgeSet m_outgoingEdges;
    };


    Graph(size_t capacity)
        : m_nodes(capacity)
    {
    }

    FixedVector<Node>& NODELETE nodes() { return m_nodes; }
    Node* addNode(unsigned index, AST::Declaration& astNode)
    {
        bool isConstAssert = is<AST::ConstAssert>(astNode);
        if (!isConstAssert && m_nodeMap.find(astNode.name()) != m_nodeMap.end())
            return nullptr;

        m_nodes[index] = Node(index, astNode);
        auto* node = &m_nodes[index];
        if (!isConstAssert)
            m_nodeMap.add(astNode.name(), node);
        return node;
    }
    Node* getNode(const AST::Identifier& identifier)
    {
        auto it = m_nodeMap.find(identifier);
        if (it == m_nodeMap.end())
            return nullptr;
        return it->value;
    }

    EdgeSet& NODELETE edges() { return m_edges; }
    void addEdge(Node& source, Node& target)
    {
        if constexpr (shouldLogGlobalSorting)
            dataLogLn("addEdge: source: ", nameForDeclaration(source.astNode()), ", target: ", target.astNode().name());
        auto result = m_edges.add(Edge(source, target));
        Edge& edge = *result.iterator;
        source.outgoingEdges().add(edge);
        target.incomingEdges().add(edge);
    }

    void topologicalSort();

private:
    FixedVector<Node> m_nodes;
    HashMap<String, Node*> m_nodeMap;
    EdgeSet m_edges;
};

struct Empty { };

class GraphBuilder : public AST::ScopedVisitor<Empty> {
    static constexpr unsigned s_maxExpressionDepth = 512;

    using Base = AST::ScopedVisitor<Empty>;
    using Base::visit;

public:
    static Result<void> visit(Graph&, Graph::Node&);

    void visit(AST::Parameter&) override;
    void visit(AST::VariableStatement&) override;
    void visit(AST::Expression&) override;
    void visit(AST::IdentifierExpression&) override;

private:
    GraphBuilder(Graph&, Graph::Node&);

    void introduceVariable(AST::Identifier&);
    void readVariable(AST::Identifier&) const;

    Graph& m_graph;
    Graph::Node& m_currentNode;
    unsigned m_expressionDepth { 0 };
};

Result<void> GraphBuilder::visit(Graph& graph, Graph::Node& node)
{
    GraphBuilder graphBuilder(graph, node);
    graphBuilder.visit(node.astNode());
    return graphBuilder.result();
}

GraphBuilder::GraphBuilder(Graph& graph, Graph::Node& node)
    : m_graph(graph)
    , m_currentNode(node)
{
}

void GraphBuilder::visit(AST::Parameter& parameter)
{
    introduceVariable(parameter.name());
    Base::visit(parameter);
}

void GraphBuilder::visit(AST::VariableStatement& variable)
{
    introduceVariable(variable.variable().name());
    Base::visit(variable);
}

void GraphBuilder::visit(AST::Expression& expression)
{
    SetForScope expressionDepthScope(m_expressionDepth, m_expressionDepth + 1);
    if (m_expressionDepth > s_maxExpressionDepth) [[unlikely]] {
        setError({ makeString("reached maximum expression depth of "_s, String::number(s_maxExpressionDepth)), expression.span() });
        return;
    }

    Base::visit(expression);
}

void GraphBuilder::visit(AST::IdentifierExpression& identifier)
{
    readVariable(identifier.identifier());
}

void GraphBuilder::introduceVariable(AST::Identifier& name)
{
    ContextProvider::introduceVariable(name, { });
}

void GraphBuilder::readVariable(AST::Identifier& name) const
{
    if (ContextProvider::readVariable(name))
        return;
    if (auto* node = m_graph.getNode(name))
        m_graph.addEdge(m_currentNode, *node);
}


static std::optional<FailedCheck> reorder(AST::Declaration::List& list)
{
    Graph graph(list.size());
    Vector<Graph::Node*> graphNodeList;
    graphNodeList.reserveCapacity(list.size());
    unsigned index = 0;
    for (auto& node : list) {
        auto* graphNode = graph.addNode(index++, node);
        if (!graphNode) {
            // This is unfortunately duplicated between this pass and the type checker
            // since here we only cover redeclarations of the same type (e.g. two
            // variables with the same name), while the type checker will also identify
            // redeclarations of different types (e.g. a variable and a struct with the
            // same name)
            return FailedCheck { Vector<Error> { Error(makeString("redeclaration of '"_s, node.name(), '\''), node.span()) }, { } };
        }
        graphNodeList.append(graphNode);
    }

    for (auto* graphNode : graphNodeList) {
        auto result = GraphBuilder::visit(graph, *graphNode);
        if (!result)
            return FailedCheck { Vector<Error> { result.error() }, { } };
    }

    list.clear();
    Deque<Graph::Node> queue;

    std::function<void(Graph::Node&, unsigned)> processNode;
    processNode = [&](Graph::Node& node, unsigned currentIndex) {
        if constexpr (shouldLogGlobalSorting)
            dataLogLn("Process: ", nameForDeclaration(node.astNode()));
        list.append(node.astNode());
        for (auto edge : node.incomingEdges()) {
            auto& source = edge.source();
            source.outgoingEdges().remove(edge);
            graph.edges().remove(edge);
            if (source.outgoingEdges().isEmpty() && source.index() < currentIndex)
                processNode(source, currentIndex);
        }
    };

    for (auto& node : graph.nodes()) {
        if (node.outgoingEdges().isEmpty())
            processNode(node, node.index());
    }

    if (graph.edges().isEmpty())
        return std::nullopt;

    dataLogLnIf(shouldLogGlobalSorting, "=== CYCLE ===");
    Graph::Node* cycleNode = nullptr;
    for (auto& node : graph.nodes()) {
        if (!node.outgoingEdges().isEmpty()) {
            cycleNode = &node;
            break;
        }
    }
    ASSERT(cycleNode);
    StringBuilder error;
    auto* node = cycleNode;
    HashSet<Graph::Node*> visited;
    while (true) {
        if constexpr (shouldLogGlobalSorting)
            dataLogLn("cycle node: ", nameForDeclaration(node->astNode()));
        ASSERT(!node->outgoingEdges().isEmpty());
        visited.add(node);
        node = &node->outgoingEdges().first().target();
        if (visited.contains(node)) {
            cycleNode = node;
            break;
        }
    }
    error.append("encountered a dependency cycle: "_s, cycleNode->astNode().name());
    do {
        ASSERT(!node->outgoingEdges().isEmpty());
        node = &node->outgoingEdges().first().target();
        error.append(" -> "_s, node->astNode().name());
    } while (node != cycleNode);
    return FailedCheck { Vector<Error> { Error(error.toString(), cycleNode->astNode().span()) }, { } };
}

std::optional<FailedCheck> reorderGlobals(ShaderModule& module)
{
    if (auto maybeError = reorder(module.declarations()))
        return *maybeError;
    return std::nullopt;
}

} // namespace WGSL
