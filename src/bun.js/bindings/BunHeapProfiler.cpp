#include "root.h"
#include "BunHeapProfiler.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/HeapProfiler.h>
#include <JavaScriptCore/HeapSnapshotBuilder.h>
#include <JavaScriptCore/BunV8HeapSnapshotBuilder.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSONObject.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/HashMap.h>
#include <wtf/Vector.h>
#include <wtf/JSONValues.h>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>

namespace Bun {

BunString toStringRef(const WTF::String& wtfString);

// Node data parsed from snapshot
struct NodeData {
    uint64_t id;
    size_t size;
    int classNameIndex;
    int flags;
    int labelIndex { -1 };
    size_t retainedSize { 0 };
    bool isGCRoot { false };
    bool isInternal { false };
};

// Edge data parsed from snapshot
struct EdgeData {
    uint64_t fromId;
    uint64_t toId;
    int typeIndex;
    int dataIndex;
};

// Type statistics for summary
struct TypeStats {
    WTF::String name;
    size_t totalSize { 0 };
    size_t totalRetainedSize { 0 };
    size_t count { 0 };
    size_t largestRetained { 0 };
    uint64_t largestInstanceId { 0 };
};

// Escape string for safe output (replace newlines, tabs, etc.)
static WTF::String escapeString(const WTF::String& str)
{
    if (str.isEmpty())
        return str;

    WTF::StringBuilder sb;
    for (unsigned i = 0; i < str.length(); i++) {
        UChar c = str[i];
        if (c == '\n')
            sb.append("\\n"_s);
        else if (c == '\r')
            sb.append("\\r"_s);
        else if (c == '\t')
            sb.append("\\t"_s);
        else if (c == '\\')
            sb.append("\\\\"_s);
        else if (c == '"')
            sb.append("\\\""_s);
        else if (c == '|')
            sb.append("\\|"_s);
        else if (c < 32 || c == 127)
            continue; // skip control characters
        else
            sb.append(c);
    }
    return sb.toString();
}

// Format bytes nicely for human-readable sections
static WTF::String formatBytes(size_t bytes)
{
    WTF::StringBuilder sb;
    if (bytes < 1024) {
        sb.append(bytes);
        sb.append(" B"_s);
    } else if (bytes < 1024 * 1024) {
        sb.append(bytes / 1024);
        sb.append("."_s);
        sb.append((bytes % 1024) * 10 / 1024);
        sb.append(" KB"_s);
    } else if (bytes < 1024ULL * 1024 * 1024) {
        sb.append(bytes / (1024 * 1024));
        sb.append("."_s);
        sb.append((bytes % (1024 * 1024)) * 10 / (1024 * 1024));
        sb.append(" MB"_s);
    } else {
        sb.append(bytes / (1024ULL * 1024 * 1024));
        sb.append("."_s);
        sb.append((bytes % (1024ULL * 1024 * 1024)) * 10 / (1024ULL * 1024 * 1024));
        sb.append(" GB"_s);
    }
    return sb.toString();
}

WTF::String generateHeapProfile(JSC::VM& vm)
{
    vm.ensureHeapProfiler();
    auto& heapProfiler = *vm.heapProfiler();
    heapProfiler.clearSnapshots();

    // Build the heap snapshot using JSC's GCDebugging format for more detail
    JSC::HeapSnapshotBuilder builder(heapProfiler, JSC::HeapSnapshotBuilder::SnapshotType::GCDebuggingSnapshot);
    builder.buildSnapshot();

    WTF::String jsonString = builder.json();
    if (jsonString.isEmpty())
        return "ERROR: Failed to generate heap snapshot"_s;

    auto jsonValue = JSON::Value::parseJSON(jsonString);
    if (!jsonValue)
        return "ERROR: Failed to parse heap snapshot JSON"_s;

    auto jsonObject = jsonValue->asObject();
    if (!jsonObject)
        return "ERROR: Heap snapshot JSON is not an object"_s;

    // Determine format
    WTF::String snapshotType = jsonObject->getString("type"_s);
    bool isGCDebugging = snapshotType == "GCDebugging"_s;
    int nodeStride = isGCDebugging ? 7 : 4;

    // Parse string tables
    WTF::Vector<WTF::String> classNames;
    WTF::Vector<WTF::String> edgeTypes;
    WTF::Vector<WTF::String> edgeNames;
    WTF::Vector<WTF::String> labels;

    auto parseStringArray = [](RefPtr<JSON::Array> arr, WTF::Vector<WTF::String>& out) {
        if (!arr)
            return;
        for (size_t i = 0; i < arr->length(); i++) {
            auto val = arr->get(i);
            out.append(val->asString());
        }
    };

    parseStringArray(jsonObject->getArray("nodeClassNames"_s), classNames);
    parseStringArray(jsonObject->getArray("edgeTypes"_s), edgeTypes);
    parseStringArray(jsonObject->getArray("edgeNames"_s), edgeNames);
    parseStringArray(jsonObject->getArray("labels"_s), labels);

    // Parse nodes
    WTF::Vector<NodeData> nodes;
    std::unordered_map<uint64_t, size_t> idToIndex;
    size_t totalHeapSize = 0;

    auto nodesArray = jsonObject->getArray("nodes"_s);
    if (nodesArray) {
        size_t nodeCount = nodesArray->length() / nodeStride;
        nodes.reserveCapacity(nodeCount);

        for (size_t i = 0; i < nodeCount; i++) {
            NodeData node;
            size_t offset = i * nodeStride;

            int intVal = 0;
            nodesArray->get(offset + 0)->asInteger(intVal);
            node.id = intVal;

            nodesArray->get(offset + 1)->asInteger(intVal);
            node.size = intVal;

            nodesArray->get(offset + 2)->asInteger(intVal);
            node.classNameIndex = intVal;

            nodesArray->get(offset + 3)->asInteger(intVal);
            node.flags = intVal;
            node.isInternal = (node.flags & 1) != 0;

            if (isGCDebugging && nodeStride >= 7) {
                nodesArray->get(offset + 4)->asInteger(intVal);
                node.labelIndex = intVal;
            }

            totalHeapSize += node.size;
            idToIndex[node.id] = nodes.size();
            nodes.append(node);
        }
    }

    // Parse edges
    WTF::Vector<EdgeData> edges;
    auto edgesArray = jsonObject->getArray("edges"_s);
    if (edgesArray) {
        size_t edgeCount = edgesArray->length() / 4;
        edges.reserveCapacity(edgeCount);

        for (size_t i = 0; i < edgeCount; i++) {
            EdgeData edge;
            size_t offset = i * 4;

            int intVal = 0;
            edgesArray->get(offset + 0)->asInteger(intVal);
            edge.fromId = intVal;

            edgesArray->get(offset + 1)->asInteger(intVal);
            edge.toId = intVal;

            edgesArray->get(offset + 2)->asInteger(intVal);
            edge.typeIndex = intVal;

            edgesArray->get(offset + 3)->asInteger(intVal);
            edge.dataIndex = intVal;

            edges.append(edge);
        }
    }

    // Parse roots
    std::unordered_set<uint64_t> gcRootIds;
    auto rootsArray = jsonObject->getArray("roots"_s);
    if (rootsArray) {
        for (size_t i = 0; i < rootsArray->length(); i += 3) {
            int nodeId = 0;
            rootsArray->get(i)->asInteger(nodeId);
            gcRootIds.insert(nodeId);
            auto it = idToIndex.find(nodeId);
            if (it != idToIndex.end()) {
                nodes[it->second].isGCRoot = true;
            }
        }
    }

    // Build edge maps for efficient traversal
    std::unordered_map<uint64_t, WTF::Vector<size_t>> outgoingEdges;
    std::unordered_map<uint64_t, WTF::Vector<size_t>> incomingEdges;
    for (size_t i = 0; i < edges.size(); i++) {
        outgoingEdges[edges[i].fromId].append(i);
        incomingEdges[edges[i].toId].append(i);
    }

    // ============================================================
    // DOMINATOR TREE CALCULATION
    // Based on: K. Cooper, T. Harvey and K. Kennedy
    // "A Simple, Fast Dominance Algorithm"
    // ============================================================

    size_t nodeCount = nodes.size();
    if (nodeCount == 0) {
        return ""_s;
    }

    // Build nodeOrdinal (index) to nodeId mapping
    WTF::Vector<uint64_t> ordinalToId(nodeCount);
    for (size_t i = 0; i < nodeCount; i++) {
        ordinalToId[i] = nodes[i].id;
    }

    // Step 1: Build post-order indexes via DFS from root (node 0)
    WTF::Vector<uint32_t> nodeOrdinalToPostOrderIndex(nodeCount);
    WTF::Vector<uint32_t> postOrderIndexToNodeOrdinal(nodeCount);

    // DFS using explicit stack
    WTF::Vector<uint32_t> stackNodes(nodeCount);
    WTF::Vector<size_t> stackEdgeIdx(nodeCount);
    WTF::Vector<uint8_t> visited(nodeCount, 0);

    uint32_t postOrderIndex = 0;
    int stackTop = 0;

    // Start from root node (ordinal 0)
    stackNodes[0] = 0;
    stackEdgeIdx[0] = 0;
    visited[0] = 1;

    while (stackTop >= 0) {
        uint32_t nodeOrdinal = stackNodes[stackTop];
        uint64_t nodeId = ordinalToId[nodeOrdinal];

        auto outIt = outgoingEdges.find(nodeId);
        size_t& edgeIdx = stackEdgeIdx[stackTop];

        bool foundChild = false;
        if (outIt != outgoingEdges.end()) {
            while (edgeIdx < outIt->second.size()) {
                size_t currentEdgeIdx = outIt->second[edgeIdx];
                edgeIdx++;

                uint64_t toId = edges[currentEdgeIdx].toId;
                auto toIt = idToIndex.find(toId);
                if (toIt == idToIndex.end())
                    continue;

                uint32_t toOrdinal = toIt->second;
                if (visited[toOrdinal])
                    continue;

                // Push child onto stack
                visited[toOrdinal] = 1;
                stackTop++;
                stackNodes[stackTop] = toOrdinal;
                stackEdgeIdx[stackTop] = 0;
                foundChild = true;
                break;
            }
        }

        if (!foundChild) {
            // No more children, assign post-order index
            nodeOrdinalToPostOrderIndex[nodeOrdinal] = postOrderIndex;
            postOrderIndexToNodeOrdinal[postOrderIndex] = nodeOrdinal;
            postOrderIndex++;
            stackTop--;
        }
    }

    // Handle unvisited nodes (can happen with unreachable nodes)
    if (postOrderIndex != nodeCount) {
        // Root was last visited, revert
        if (postOrderIndex > 0 && postOrderIndexToNodeOrdinal[postOrderIndex - 1] == 0) {
            postOrderIndex--;
        }

        // Visit unvisited nodes
        for (uint32_t nodeOrdinal = 1; nodeOrdinal < nodeCount; ++nodeOrdinal) {
            if (!visited[nodeOrdinal]) {
                nodeOrdinalToPostOrderIndex[nodeOrdinal] = postOrderIndex;
                postOrderIndexToNodeOrdinal[postOrderIndex] = nodeOrdinal;
                postOrderIndex++;
            }
        }

        // Make sure root is last
        if (!visited[0] || nodeOrdinalToPostOrderIndex[0] != nodeCount - 1) {
            nodeOrdinalToPostOrderIndex[0] = postOrderIndex;
            postOrderIndexToNodeOrdinal[postOrderIndex] = 0;
            postOrderIndex++;
        }
    }

    // Step 2: Build dominator tree using Cooper-Harvey-Kennedy algorithm
    uint32_t rootPostOrderIndex = nodeCount - 1;
    uint32_t noEntry = nodeCount;

    WTF::Vector<uint8_t> affected(nodeCount, 0);
    WTF::Vector<uint32_t> dominators(nodeCount, noEntry);
    WTF::Vector<uint32_t> nodeOrdinalToDominator(nodeCount, 0);

    // Root dominates itself
    dominators[rootPostOrderIndex] = rootPostOrderIndex;

    // Mark root's children as affected and as GC roots
    uint64_t rootId = ordinalToId[0];
    auto rootOutEdges = outgoingEdges.find(rootId);
    if (rootOutEdges != outgoingEdges.end()) {
        for (size_t edgeIdx : rootOutEdges->second) {
            uint64_t toId = edges[edgeIdx].toId;
            auto toIt = idToIndex.find(toId);
            if (toIt != idToIndex.end()) {
                uint32_t toOrdinal = toIt->second;
                uint32_t toPostOrder = nodeOrdinalToPostOrderIndex[toOrdinal];
                affected[toPostOrder] = 1;
                nodes[toOrdinal].isGCRoot = true;
            }
        }
    }

    // Iteratively compute dominators
    bool changed = true;
    while (changed) {
        changed = false;

        for (int32_t postOrder = static_cast<int32_t>(rootPostOrderIndex) - 1; postOrder >= 0; --postOrder) {
            if (!affected[postOrder])
                continue;
            affected[postOrder] = 0;

            // Already dominated by root
            if (dominators[postOrder] == rootPostOrderIndex)
                continue;

            uint32_t newDominator = noEntry;
            uint32_t nodeOrdinal = postOrderIndexToNodeOrdinal[postOrder];
            uint64_t nodeId = ordinalToId[nodeOrdinal];

            // Check all incoming edges
            auto inIt = incomingEdges.find(nodeId);
            if (inIt != incomingEdges.end()) {
                for (size_t edgeIdx : inIt->second) {
                    uint64_t fromId = edges[edgeIdx].fromId;
                    auto fromIt = idToIndex.find(fromId);
                    if (fromIt == idToIndex.end())
                        continue;

                    uint32_t fromOrdinal = fromIt->second;
                    uint32_t fromPostOrder = nodeOrdinalToPostOrderIndex[fromOrdinal];

                    if (dominators[fromPostOrder] == noEntry)
                        continue;

                    if (newDominator == noEntry) {
                        newDominator = fromPostOrder;
                    } else {
                        // Find common dominator (intersect)
                        uint32_t finger1 = fromPostOrder;
                        uint32_t finger2 = newDominator;
                        while (finger1 != finger2) {
                            while (finger1 < finger2)
                                finger1 = dominators[finger1];
                            while (finger2 < finger1)
                                finger2 = dominators[finger2];
                        }
                        newDominator = finger1;
                    }

                    if (newDominator == rootPostOrderIndex)
                        break;
                }
            }

            // Update if changed
            if (newDominator != noEntry && dominators[postOrder] != newDominator) {
                dominators[postOrder] = newDominator;
                changed = true;

                // Mark children as affected
                auto outIt = outgoingEdges.find(nodeId);
                if (outIt != outgoingEdges.end()) {
                    for (size_t edgeIdx : outIt->second) {
                        uint64_t toId = edges[edgeIdx].toId;
                        auto toIt = idToIndex.find(toId);
                        if (toIt != idToIndex.end()) {
                            uint32_t toPostOrder = nodeOrdinalToPostOrderIndex[toIt->second];
                            affected[toPostOrder] = 1;
                        }
                    }
                }
            }
        }
    }

    // Convert post-order dominators to node ordinals
    for (uint32_t postOrder = 0; postOrder < nodeCount; ++postOrder) {
        uint32_t nodeOrdinal = postOrderIndexToNodeOrdinal[postOrder];
        uint32_t domPostOrder = dominators[postOrder];
        uint32_t domOrdinal = (domPostOrder < nodeCount) ? postOrderIndexToNodeOrdinal[domPostOrder] : 0;
        nodeOrdinalToDominator[nodeOrdinal] = domOrdinal;
    }

    // Step 3: Calculate retained sizes by attributing size up the dominator tree
    // First, set self size
    for (size_t i = 0; i < nodeCount; i++) {
        nodes[i].retainedSize = nodes[i].size;
    }

    // Walk in post-order (children before parents) and add to dominator
    for (uint32_t postOrder = 0; postOrder < nodeCount - 1; ++postOrder) {
        uint32_t nodeOrdinal = postOrderIndexToNodeOrdinal[postOrder];
        uint32_t domOrdinal = nodeOrdinalToDominator[nodeOrdinal];
        nodes[domOrdinal].retainedSize += nodes[nodeOrdinal].retainedSize;
    }

    // Build type statistics
    WTF::HashMap<WTF::String, TypeStats> typeStatsMap;
    for (const auto& node : nodes) {
        WTF::String className = (node.classNameIndex >= 0 && static_cast<size_t>(node.classNameIndex) < classNames.size())
            ? classNames[node.classNameIndex]
            : "(unknown)"_s;

        auto result = typeStatsMap.add(className, TypeStats());
        auto& stats = result.iterator->value;
        if (result.isNewEntry)
            stats.name = className;
        stats.totalSize += node.size;
        stats.totalRetainedSize += node.retainedSize;
        stats.count++;
        if (node.retainedSize > stats.largestRetained) {
            stats.largestRetained = node.retainedSize;
            stats.largestInstanceId = node.id;
        }
    }

    // Sort types by retained size
    WTF::Vector<TypeStats> sortedTypes;
    for (auto& pair : typeStatsMap)
        sortedTypes.append(pair.value);
    std::sort(sortedTypes.begin(), sortedTypes.end(), [](const TypeStats& a, const TypeStats& b) {
        return a.totalRetainedSize > b.totalRetainedSize;
    });

    // Find largest objects
    WTF::Vector<size_t> largestObjects;
    for (size_t i = 0; i < nodes.size(); i++)
        largestObjects.append(i);
    std::sort(largestObjects.begin(), largestObjects.end(), [&nodes](size_t a, size_t b) {
        return nodes[a].retainedSize > nodes[b].retainedSize;
    });

    // Helpers
    auto getClassName = [&classNames](const NodeData& node) -> WTF::String {
        if (node.classNameIndex >= 0 && static_cast<size_t>(node.classNameIndex) < classNames.size())
            return classNames[node.classNameIndex];
        return "(unknown)"_s;
    };

    auto getEdgeType = [&edgeTypes](const EdgeData& edge) -> WTF::String {
        if (edge.typeIndex >= 0 && static_cast<size_t>(edge.typeIndex) < edgeTypes.size())
            return edgeTypes[edge.typeIndex];
        return "?"_s;
    };

    auto getEdgeName = [&edgeNames, &edgeTypes](const EdgeData& edge) -> WTF::String {
        WTF::String edgeType;
        if (edge.typeIndex >= 0 && static_cast<size_t>(edge.typeIndex) < edgeTypes.size())
            edgeType = edgeTypes[edge.typeIndex];

        if (edgeType == "Property"_s || edgeType == "Variable"_s) {
            if (edge.dataIndex >= 0 && static_cast<size_t>(edge.dataIndex) < edgeNames.size())
                return edgeNames[edge.dataIndex];
        } else if (edgeType == "Index"_s) {
            return makeString("["_s, WTF::String::number(edge.dataIndex), "]"_s);
        }
        return ""_s;
    };

    auto getNodeLabel = [&labels](const NodeData& node) -> WTF::String {
        if (node.labelIndex >= 0 && static_cast<size_t>(node.labelIndex) < labels.size())
            return labels[node.labelIndex];
        return ""_s;
    };

    // Build output
    WTF::StringBuilder output;

    // ==================== HEADER ====================
    output.append("# Bun Heap Profile\n\n"_s);
    output.append("Generated by `bun --heap-prof-md`. This profile contains complete heap data in markdown format.\n\n"_s);
    output.append("**Quick Search Commands:**\n"_s);
    output.append("```bash\n"_s);
    output.append("grep 'type=Function' file.md          # Find all Function objects\n"_s);
    output.append("grep 'size=[0-9]\\{5,\\}' file.md       # Find objects >= 10KB\n"_s);
    output.append("grep 'EDGE.*to=12345' file.md         # Find references to object #12345\n"_s);
    output.append("grep 'gcroot=1' file.md               # Find all GC roots\n"_s);
    output.append("```\n\n"_s);
    output.append("---\n\n"_s);

    // ==================== SUMMARY ====================
    output.append("## Summary\n\n"_s);
    output.append("| Metric | Value |\n"_s);
    output.append("|--------|------:|\n"_s);
    output.append("| Total Heap Size | "_s);
    output.append(formatBytes(totalHeapSize));
    output.append(" ("_s);
    output.append(WTF::String::number(totalHeapSize));
    output.append(" bytes) |\n"_s);
    output.append("| Total Objects | "_s);
    output.append(WTF::String::number(nodes.size()));
    output.append(" |\n"_s);
    output.append("| Total Edges | "_s);
    output.append(WTF::String::number(edges.size()));
    output.append(" |\n"_s);
    output.append("| Unique Types | "_s);
    output.append(WTF::String::number(sortedTypes.size()));
    output.append(" |\n"_s);
    output.append("| GC Roots | "_s);
    output.append(WTF::String::number(gcRootIds.size()));
    output.append(" |\n\n"_s);

    // ==================== TOP TYPES ====================
    output.append("## Top 50 Types by Retained Size\n\n"_s);
    output.append("| Rank | Type | Count | Self Size | Retained Size | Largest Instance |\n"_s);
    output.append("|-----:|------|------:|----------:|--------------:|-----------------:|\n"_s);

    size_t rank = 1;
    for (const auto& stats : sortedTypes) {
        if (rank > 50)
            break;

        output.append("| "_s);
        output.append(WTF::String::number(rank));
        output.append(" | `"_s);
        output.append(escapeString(stats.name));
        output.append("` | "_s);
        output.append(WTF::String::number(stats.count));
        output.append(" | "_s);
        output.append(formatBytes(stats.totalSize));
        output.append(" | "_s);
        output.append(formatBytes(stats.totalRetainedSize));
        output.append(" | "_s);
        output.append(formatBytes(stats.largestRetained));
        output.append(" |\n"_s);
        rank++;
    }
    output.append("\n"_s);

    // ==================== LARGEST OBJECTS ====================
    output.append("## Top 50 Largest Objects\n\n"_s);
    output.append("Objects that retain the most memory (potential memory leak sources):\n\n"_s);
    output.append("| Rank | ID | Type | Self Size | Retained Size | Out-Edges | In-Edges |\n"_s);
    output.append("|-----:|---:|------|----------:|--------------:|----------:|---------:|\n"_s);

    for (size_t i = 0; i < 50 && i < largestObjects.size(); i++) {
        const auto& node = nodes[largestObjects[i]];
        size_t outCount = 0, inCount = 0;
        auto outIt = outgoingEdges.find(node.id);
        if (outIt != outgoingEdges.end())
            outCount = outIt->second.size();
        auto inIt = incomingEdges.find(node.id);
        if (inIt != incomingEdges.end())
            inCount = inIt->second.size();

        output.append("| "_s);
        output.append(WTF::String::number(i + 1));
        output.append(" | "_s);
        output.append(WTF::String::number(node.id));
        output.append(" | `"_s);
        output.append(escapeString(getClassName(node)));
        output.append("` | "_s);
        output.append(formatBytes(node.size));
        output.append(" | "_s);
        output.append(formatBytes(node.retainedSize));
        output.append(" | "_s);
        output.append(WTF::String::number(outCount));
        output.append(" | "_s);
        output.append(WTF::String::number(inCount));
        output.append(" |\n"_s);
    }
    output.append("\n"_s);

    // ==================== RETAINER CHAINS ====================
    output.append("## Retainer Chains\n\n"_s);
    output.append("How the top 20 largest objects are kept alive (path from GC root to object):\n\n"_s);

    for (size_t i = 0; i < 20 && i < largestObjects.size(); i++) {
        const auto& node = nodes[largestObjects[i]];
        output.append("### "_s);
        output.append(WTF::String::number(i + 1));
        output.append(". Object #"_s);
        output.append(WTF::String::number(node.id));
        output.append(" - `"_s);
        output.append(escapeString(getClassName(node)));
        output.append("` ("_s);
        output.append(formatBytes(node.retainedSize));
        output.append(" retained)\n\n"_s);

        // BFS to find path to GC root
        // We traverse from node.id upward through retainers (incoming edges)
        // parent[X] = Y means "X is retained by Y" (Y is X's retainer)
        // retainerEdge[X] = edgeIdx means "edges[edgeIdx] is the edge FROM parent[X] TO X"
        std::unordered_map<uint64_t, uint64_t> retainer;
        std::unordered_map<uint64_t, size_t> retainerEdge;
        WTF::Vector<uint64_t> queue;
        size_t queueIdx = 0;
        queue.append(node.id);
        retainer[node.id] = node.id; // sentinel

        uint64_t foundRoot = 0;
        while (queueIdx < queue.size() && foundRoot == 0) {
            uint64_t current = queue[queueIdx++];
            if (gcRootIds.contains(current) && current != node.id) {
                foundRoot = current;
                break;
            }
            auto it = incomingEdges.find(current);
            if (it != incomingEdges.end()) {
                for (size_t edgeIdx : it->second) {
                    uint64_t retainerId = edges[edgeIdx].fromId;
                    if (retainer.find(retainerId) == retainer.end()) {
                        // retainerId retains current via this edge
                        // Store: current's retainer is retainerId
                        retainer[current] = retainerId;
                        retainerEdge[current] = edgeIdx;
                        // Add retainerId to queue to continue searching upward
                        retainer[retainerId] = retainerId; // mark as visited (will be updated if we find its retainer)
                        queue.append(retainerId);
                    }
                }
            }
        }

        output.append("```\n"_s);
        if (foundRoot != 0) {
            // Build path from node.id to foundRoot
            WTF::Vector<uint64_t> path;
            uint64_t current = node.id;
            while (current != foundRoot && retainer.find(current) != retainer.end()) {
                path.append(current);
                uint64_t next = retainer[current];
                if (next == current) break; // sentinel or no retainer
                current = next;
            }
            path.append(foundRoot);

            // Print path from root to node (reverse order)
            for (size_t j = path.size(); j > 0; j--) {
                uint64_t nodeId = path[j - 1];
                auto nodeIt = idToIndex.find(nodeId);
                if (nodeIt == idToIndex.end())
                    continue;
                const auto& pathNode = nodes[nodeIt->second];

                for (size_t indent = 0; indent < path.size() - j; indent++)
                    output.append("    "_s);

                output.append(getClassName(pathNode));
                output.append("#"_s);
                output.append(WTF::String::number(nodeId));
                if (pathNode.isGCRoot)
                    output.append(" [ROOT]"_s);
                output.append(" ("_s);
                output.append(formatBytes(pathNode.size));
                output.append(")"_s);

                // Show edge to child (path[j-2])
                if (j > 1) {
                    uint64_t childId = path[j - 2];
                    auto edgeIt = retainerEdge.find(childId);
                    if (edgeIt != retainerEdge.end()) {
                        WTF::String edgeName = getEdgeName(edges[edgeIt->second]);
                        if (!edgeName.isEmpty()) {
                            output.append(" ."_s);
                            output.append(edgeName);
                        }
                        output.append(" -> "_s);
                    }
                }
                output.append("\n"_s);
            }
        } else if (node.isGCRoot) {
            output.append(getClassName(node));
            output.append("#"_s);
            output.append(WTF::String::number(node.id));
            output.append(" [ROOT] (this object is a GC root)\n"_s);
        } else {
            output.append("(no path to GC root found)\n"_s);
        }
        output.append("```\n\n"_s);
    }

    // ==================== GC ROOTS ====================
    output.append("## GC Roots\n\n"_s);
    output.append("Objects directly held by the runtime (prevent garbage collection):\n\n"_s);
    output.append("| ID | Type | Size | Retained | Label |\n"_s);
    output.append("|---:|------|-----:|---------:|-------|\n"_s);

    size_t rootCount = 0;
    for (const auto& node : nodes) {
        if (node.isGCRoot && rootCount < 100) {
            output.append("| "_s);
            output.append(WTF::String::number(node.id));
            output.append(" | `"_s);
            output.append(escapeString(getClassName(node)));
            output.append("` | "_s);
            output.append(formatBytes(node.size));
            output.append(" | "_s);
            output.append(formatBytes(node.retainedSize));
            output.append(" | "_s);
            WTF::String label = getNodeLabel(node);
            if (!label.isEmpty())
                output.append(escapeString(label.left(50)));
            output.append(" |\n"_s);
            rootCount++;
        }
    }
    if (gcRootIds.size() > 100) {
        output.append("\n*... and "_s);
        output.append(WTF::String::number(gcRootIds.size() - 100));
        output.append(" more GC roots*\n"_s);
    }
    output.append("\n"_s);

    // ==================== ALL NODES ====================
    output.append("## All Objects\n\n"_s);
    output.append("<details>\n<summary>Click to expand "_s);
    output.append(WTF::String::number(nodes.size()));
    output.append(" objects (searchable with grep)</summary>\n\n"_s);
    output.append("| ID | Type | Size | Retained | Flags | Label |\n"_s);
    output.append("|---:|------|-----:|---------:|-------|-------|\n"_s);

    for (const auto& node : nodes) {
        output.append("| "_s);
        output.append(WTF::String::number(node.id));
        output.append(" | `"_s);
        output.append(escapeString(getClassName(node)));
        output.append("` | "_s);
        output.append(WTF::String::number(node.size));
        output.append(" | "_s);
        output.append(WTF::String::number(node.retainedSize));
        output.append(" | "_s);
        if (node.isGCRoot)
            output.append("gcroot=1 "_s);
        if (node.isInternal)
            output.append("internal=1"_s);
        output.append(" | "_s);
        WTF::String label = getNodeLabel(node);
        if (!label.isEmpty()) {
            WTF::String displayLabel = label.length() > 40 ? makeString(label.left(37), "..."_s) : label;
            output.append(escapeString(displayLabel));
        }
        output.append(" |\n"_s);
    }
    output.append("\n</details>\n\n"_s);

    // ==================== ALL EDGES ====================
    output.append("## All Edges\n\n"_s);
    output.append("<details>\n<summary>Click to expand "_s);
    output.append(WTF::String::number(edges.size()));
    output.append(" edges (object reference graph)</summary>\n\n"_s);
    output.append("| From | To | Type | Name |\n"_s);
    output.append("|-----:|---:|------|------|\n"_s);

    for (const auto& edge : edges) {
        output.append("| "_s);
        output.append(WTF::String::number(edge.fromId));
        output.append(" | "_s);
        output.append(WTF::String::number(edge.toId));
        output.append(" | "_s);
        output.append(getEdgeType(edge));
        output.append(" | "_s);
        WTF::String edgeName = getEdgeName(edge);
        if (!edgeName.isEmpty())
            output.append(escapeString(edgeName));
        output.append(" |\n"_s);
    }
    output.append("\n</details>\n\n"_s);

    // ==================== STRING VALUES ====================
    output.append("## String Values\n\n"_s);
    output.append("String objects (useful for identifying leak sources by content):\n\n"_s);
    output.append("<details>\n<summary>Click to expand string values</summary>\n\n"_s);
    output.append("| ID | Size | Value |\n"_s);
    output.append("|---:|-----:|-------|\n"_s);

    for (const auto& node : nodes) {
        WTF::String className = getClassName(node);
        if (className == "string"_s || className == "String"_s) {
            WTF::String label = getNodeLabel(node);
            output.append("| "_s);
            output.append(WTF::String::number(node.id));
            output.append(" | "_s);
            output.append(WTF::String::number(node.size));
            output.append(" | "_s);
            if (!label.isEmpty()) {
                WTF::String displayLabel = label.length() > 100 ? makeString(label.left(97), "..."_s) : label;
                output.append("`"_s);
                output.append(escapeString(displayLabel));
                output.append("`"_s);
            }
            output.append(" |\n"_s);
        }
    }
    output.append("\n</details>\n\n"_s);

    // ==================== TYPE STATISTICS ====================
    output.append("## Complete Type Statistics\n\n"_s);
    output.append("<details>\n<summary>Click to expand all "_s);
    output.append(WTF::String::number(sortedTypes.size()));
    output.append(" types</summary>\n\n"_s);
    output.append("| Type | Count | Self Size | Retained Size | Largest ID |\n"_s);
    output.append("|------|------:|----------:|--------------:|-----------:|\n"_s);

    for (const auto& stats : sortedTypes) {
        output.append("| `"_s);
        output.append(escapeString(stats.name));
        output.append("` | "_s);
        output.append(WTF::String::number(stats.count));
        output.append(" | "_s);
        output.append(WTF::String::number(stats.totalSize));
        output.append(" | "_s);
        output.append(WTF::String::number(stats.totalRetainedSize));
        output.append(" | "_s);
        output.append(WTF::String::number(stats.largestInstanceId));
        output.append(" |\n"_s);
    }
    output.append("\n</details>\n\n"_s);

    // ==================== EDGE NAMES ====================
    output.append("## Property Names\n\n"_s);
    output.append("<details>\n<summary>Click to expand all "_s);
    output.append(WTF::String::number(edgeNames.size()));
    output.append(" property/variable names</summary>\n\n"_s);
    output.append("| Index | Name |\n"_s);
    output.append("|------:|------|\n"_s);

    for (size_t i = 0; i < edgeNames.size(); i++) {
        if (!edgeNames[i].isEmpty()) {
            output.append("| "_s);
            output.append(WTF::String::number(i));
            output.append(" | `"_s);
            output.append(escapeString(edgeNames[i]));
            output.append("` |\n"_s);
        }
    }
    output.append("\n</details>\n\n"_s);

    // ==================== FOOTER ====================
    output.append("---\n\n"_s);
    output.append("*End of heap profile*\n"_s);

    return output.toString();
}

WTF::String generateHeapSnapshotV8(JSC::VM& vm)
{
    vm.ensureHeapProfiler();
    auto& heapProfiler = *vm.heapProfiler();
    heapProfiler.clearSnapshots();

    JSC::BunV8HeapSnapshotBuilder builder(heapProfiler);
    return builder.json();
}

} // namespace Bun

extern "C" BunString Bun__generateHeapProfile(JSC::VM* vm)
{
    WTF::String result = Bun::generateHeapProfile(*vm);
    return Bun::toStringRef(result);
}

extern "C" BunString Bun__generateHeapSnapshotV8(JSC::VM* vm)
{
    WTF::String result = Bun::generateHeapSnapshotV8(*vm);
    return Bun::toStringRef(result);
}
