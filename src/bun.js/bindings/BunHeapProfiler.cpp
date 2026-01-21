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

extern "C" BunString Bun__generateHeapProfile(JSC::VM* vm);
extern "C" BunString Bun__generateHeapSnapshotV8(JSC::VM* vm);

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
        else if (c < 32 || c == 127)
            sb.append("\\x"_s, static_cast<unsigned>(c));
        else
            sb.append(c);
    }
    return sb.toString();
}

// Format bytes as plain number for grep-friendly output
static WTF::String formatBytesPlain(size_t bytes)
{
    return WTF::String::number(bytes);
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
    std::unordered_map<uint64_t, size_t> idToIndex; // node id -> index in nodes vector
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

            // GCDebugging format has additional fields
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

    // Parse roots to identify GC roots
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

    // Build outgoing edges map
    std::unordered_map<uint64_t, WTF::Vector<size_t>> outgoingEdges; // node id -> edge indices
    for (size_t i = 0; i < edges.size(); i++) {
        outgoingEdges[edges[i].fromId].append(i);
    }

    // Build incoming edges map for retainer analysis
    std::unordered_map<uint64_t, WTF::Vector<size_t>> incomingEdges; // node id -> edge indices
    for (size_t i = 0; i < edges.size(); i++) {
        incomingEdges[edges[i].toId].append(i);
    }

    // Calculate retained sizes (self + direct children)
    for (auto& node : nodes) {
        node.retainedSize = node.size;
        auto it = outgoingEdges.find(node.id);
        if (it != outgoingEdges.end()) {
            for (size_t edgeIdx : it->second) {
                auto childIt = idToIndex.find(edges[edgeIdx].toId);
                if (childIt != idToIndex.end()) {
                    node.retainedSize += nodes[childIt->second].size;
                }
            }
        }
    }

    // Build type statistics
    WTF::HashMap<WTF::String, TypeStats> typeStatsMap;
    for (const auto& node : nodes) {
        WTF::String className = (node.classNameIndex >= 0 && static_cast<size_t>(node.classNameIndex) < classNames.size())
            ? classNames[node.classNameIndex]
            : "(unknown)"_s;

        auto result = typeStatsMap.add(className, TypeStats());
        auto& stats = result.iterator->value;
        if (result.isNewEntry) {
            stats.name = className;
        }
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
    for (auto& pair : typeStatsMap) {
        sortedTypes.append(pair.value);
    }
    std::sort(sortedTypes.begin(), sortedTypes.end(), [](const TypeStats& a, const TypeStats& b) {
        return a.totalRetainedSize > b.totalRetainedSize;
    });

    // Find largest individual objects
    WTF::Vector<size_t> largestObjects;
    for (size_t i = 0; i < nodes.size(); i++) {
        largestObjects.append(i);
    }
    std::sort(largestObjects.begin(), largestObjects.end(), [&nodes](size_t a, size_t b) {
        return nodes[a].retainedSize > nodes[b].retainedSize;
    });

    // Helper to get class name
    auto getClassName = [&classNames](const NodeData& node) -> WTF::String {
        if (node.classNameIndex >= 0 && static_cast<size_t>(node.classNameIndex) < classNames.size())
            return classNames[node.classNameIndex];
        return "(unknown)"_s;
    };

    // Helper to get edge type name
    auto getEdgeType = [&edgeTypes](const EdgeData& edge) -> WTF::String {
        if (edge.typeIndex >= 0 && static_cast<size_t>(edge.typeIndex) < edgeTypes.size())
            return edgeTypes[edge.typeIndex];
        return "?"_s;
    };

    // Helper to get edge name
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

    // Helper to get node label
    auto getNodeLabel = [&labels](const NodeData& node) -> WTF::String {
        if (node.labelIndex >= 0 && static_cast<size_t>(node.labelIndex) < labels.size())
            return labels[node.labelIndex];
        return ""_s;
    };

    // Build output
    WTF::StringBuilder output;

    // ========================================
    // HEADER
    // ========================================
    output.append("# Bun Heap Profile\n\n"_s);
    output.append("> Generated by `bun --heap-prof-text`\n"_s);
    output.append("> Use grep, awk, sed to analyze. All data sections use consistent, parseable formats.\n\n"_s);

    // ========================================
    // SUMMARY
    // ========================================
    output.append("## Summary\n\n"_s);
    output.append("- **Total Heap Size:** "_s);
    output.append(formatBytes(totalHeapSize));
    output.append(" ("_s);
    output.append(WTF::String::number(totalHeapSize));
    output.append(" bytes)\n"_s);
    output.append("- **Total Objects:** "_s);
    output.append(WTF::String::number(nodes.size()));
    output.append("\n"_s);
    output.append("- **Total Edges:** "_s);
    output.append(WTF::String::number(edges.size()));
    output.append("\n"_s);
    output.append("- **Unique Types:** "_s);
    output.append(WTF::String::number(sortedTypes.size()));
    output.append("\n"_s);
    output.append("- **GC Roots:** "_s);
    output.append(WTF::String::number(gcRootIds.size()));
    output.append("\n\n"_s);

    // ========================================
    // TOP TYPES BY RETAINED SIZE (human-readable table)
    // ========================================
    output.append("## Top Types by Retained Size\n\n"_s);
    output.append("| # | Type | Count | Self Size | Retained | Largest |\n"_s);
    output.append("|--:|------|------:|----------:|---------:|--------:|\n"_s);

    size_t rank = 1;
    for (const auto& stats : sortedTypes) {
        if (rank > 50)
            break;

        WTF::String typeName = stats.name;
        if (typeName.length() > 35)
            typeName = makeString(typeName.left(32), "..."_s);

        output.append("| "_s);
        output.append(WTF::String::number(rank));
        output.append(" | `"_s);
        output.append(typeName);
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

    // ========================================
    // LARGEST OBJECTS (human-readable table)
    // ========================================
    output.append("## Largest Objects\n\n"_s);
    output.append("Objects retaining the most memory (potential leak sources):\n\n"_s);
    output.append("| # | ID | Type | Self | Retained | Out-Edges | In-Edges |\n"_s);
    output.append("|--:|---:|------|-----:|---------:|----------:|---------:|\n"_s);

    for (size_t i = 0; i < 50 && i < largestObjects.size(); i++) {
        const auto& node = nodes[largestObjects[i]];
        WTF::String className = getClassName(node);
        if (className.length() > 25)
            className = makeString(className.left(22), "..."_s);

        size_t outCount = 0;
        auto outIt = outgoingEdges.find(node.id);
        if (outIt != outgoingEdges.end())
            outCount = outIt->second.size();

        size_t inCount = 0;
        auto inIt = incomingEdges.find(node.id);
        if (inIt != incomingEdges.end())
            inCount = inIt->second.size();

        output.append("| "_s);
        output.append(WTF::String::number(i + 1));
        output.append(" | "_s);
        output.append(WTF::String::number(node.id));
        output.append(" | `"_s);
        output.append(className);
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

    // ========================================
    // RETAINER CHAINS for top objects
    // ========================================
    output.append("## Retainer Chains\n\n"_s);
    output.append("How the largest objects are kept alive (path from GC root):\n\n"_s);

    for (size_t i = 0; i < 20 && i < largestObjects.size(); i++) {
        const auto& node = nodes[largestObjects[i]];
        output.append("### Object #"_s);
        output.append(WTF::String::number(node.id));
        output.append(" (`"_s);
        output.append(getClassName(node));
        output.append("`, "_s);
        output.append(formatBytes(node.retainedSize));
        output.append(" retained)\n\n"_s);

        // Build retainer chain (BFS to find path to GC root)
        output.append("```\n"_s);

        std::unordered_map<uint64_t, uint64_t> parent; // child -> parent
        std::unordered_map<uint64_t, size_t> parentEdge; // child -> edge index
        WTF::Vector<uint64_t> queue;
        size_t queueIdx = 0;
        queue.append(node.id);
        parent[node.id] = node.id; // mark as visited

        uint64_t foundRoot = 0;
        while (queueIdx < queue.size() && foundRoot == 0) {
            uint64_t current = queue[queueIdx++];

            // Check if this is a GC root
            if (gcRootIds.contains(current) && current != node.id) {
                foundRoot = current;
                break;
            }

            // Find retainers (incoming edges)
            auto it = incomingEdges.find(current);
            if (it != incomingEdges.end()) {
                for (size_t edgeIdx : it->second) {
                    uint64_t retainerId = edges[edgeIdx].fromId;
                    if (parent.find(retainerId) == parent.end()) {
                        parent[retainerId] = current;
                        parentEdge[current] = edgeIdx;
                        queue.append(retainerId);
                    }
                }
            }
        }

        if (foundRoot != 0) {
            // Reconstruct path
            WTF::Vector<uint64_t> path;
            uint64_t current = node.id;
            while (current != foundRoot) {
                path.append(current);
                auto nextIt = parent.find(current);
                if (nextIt == parent.end() || nextIt->second == current)
                    break;
                // Find the parent of current
                auto edgeIt = parentEdge.find(current);
                if (edgeIt != parentEdge.end()) {
                    current = edges[edgeIt->second].fromId;
                } else {
                    break;
                }
            }
            path.append(foundRoot);

            // Print path in reverse (from root to object)
            for (size_t j = path.size(); j > 0; j--) {
                uint64_t nodeId = path[j - 1];
                auto nodeIt = idToIndex.find(nodeId);
                if (nodeIt == idToIndex.end())
                    continue;
                const auto& pathNode = nodes[nodeIt->second];

                for (size_t indent = 0; indent < path.size() - j; indent++)
                    output.append("  "_s);

                output.append(getClassName(pathNode));
                output.append("#"_s);
                output.append(WTF::String::number(nodeId));
                if (pathNode.isGCRoot)
                    output.append(" [GC ROOT]"_s);
                output.append(" ("_s);
                output.append(formatBytes(pathNode.size));
                output.append(")"_s);

                // Show edge name if not the last node
                if (j > 1) {
                    auto edgeIt = parentEdge.find(path[j - 2]);
                    if (edgeIt != parentEdge.end()) {
                        WTF::String edgeName = getEdgeName(edges[edgeIt->second]);
                        WTF::String edgeType = getEdgeType(edges[edgeIt->second]);
                        if (!edgeName.isEmpty()) {
                            output.append(" ."_s);
                            output.append(edgeName);
                        }
                        output.append(" -["_s);
                        output.append(edgeType);
                        output.append("]->"_s);
                    }
                }
                output.append("\n"_s);
            }
        } else if (node.isGCRoot) {
            output.append(getClassName(node));
            output.append("#"_s);
            output.append(WTF::String::number(node.id));
            output.append(" [GC ROOT] (this object is itself a GC root)\n"_s);
        } else {
            output.append("(no path to GC root found - object may be garbage)\n"_s);
        }
        output.append("```\n\n"_s);
    }

    // ========================================
    // ALL NODES (grep-friendly format)
    // ========================================
    output.append("## All Nodes\n\n"_s);
    output.append("Complete list of all heap objects. Format: `NODE id=<id> type=<type> size=<bytes> retained=<bytes> flags=<flags> label=<label>`\n\n"_s);
    output.append("```\n"_s);

    for (const auto& node : nodes) {
        output.append("NODE id="_s);
        output.append(WTF::String::number(node.id));
        output.append(" type="_s);
        output.append(escapeString(getClassName(node)));
        output.append(" size="_s);
        output.append(formatBytesPlain(node.size));
        output.append(" retained="_s);
        output.append(formatBytesPlain(node.retainedSize));
        output.append(" flags="_s);
        output.append(WTF::String::number(node.flags));
        if (node.isGCRoot)
            output.append(" gcroot=1"_s);
        if (node.isInternal)
            output.append(" internal=1"_s);
        WTF::String label = getNodeLabel(node);
        if (!label.isEmpty()) {
            output.append(" label=\""_s);
            output.append(escapeString(label));
            output.append("\""_s);
        }
        output.append("\n"_s);
    }
    output.append("```\n\n"_s);

    // ========================================
    // ALL EDGES (grep-friendly format)
    // ========================================
    output.append("## All Edges\n\n"_s);
    output.append("Complete object reference graph. Format: `EDGE from=<id> to=<id> type=<type> name=<name>`\n\n"_s);
    output.append("```\n"_s);

    for (const auto& edge : edges) {
        output.append("EDGE from="_s);
        output.append(WTF::String::number(edge.fromId));
        output.append(" to="_s);
        output.append(WTF::String::number(edge.toId));
        output.append(" type="_s);
        output.append(getEdgeType(edge));
        WTF::String edgeName = getEdgeName(edge);
        if (!edgeName.isEmpty()) {
            output.append(" name=\""_s);
            output.append(escapeString(edgeName));
            output.append("\""_s);
        }
        output.append("\n"_s);
    }
    output.append("```\n\n"_s);

    // ========================================
    // GC ROOTS
    // ========================================
    output.append("## GC Roots\n\n"_s);
    output.append("Objects directly held by the runtime (prevent garbage collection):\n\n"_s);
    output.append("```\n"_s);

    for (const auto& node : nodes) {
        if (node.isGCRoot) {
            output.append("ROOT id="_s);
            output.append(WTF::String::number(node.id));
            output.append(" type="_s);
            output.append(escapeString(getClassName(node)));
            output.append(" size="_s);
            output.append(formatBytesPlain(node.size));
            output.append(" retained="_s);
            output.append(formatBytesPlain(node.retainedSize));
            WTF::String label = getNodeLabel(node);
            if (!label.isEmpty()) {
                output.append(" label=\""_s);
                output.append(escapeString(label));
                output.append("\""_s);
            }
            output.append("\n"_s);
        }
    }
    output.append("```\n\n"_s);

    // ========================================
    // STRINGS (for identifying leak sources)
    // ========================================
    output.append("## String Values\n\n"_s);
    output.append("String objects in the heap (useful for identifying leak sources):\n\n"_s);
    output.append("```\n"_s);

    for (const auto& node : nodes) {
        WTF::String className = getClassName(node);
        if (className == "string"_s || className == "String"_s) {
            WTF::String label = getNodeLabel(node);
            output.append("STRING id="_s);
            output.append(WTF::String::number(node.id));
            output.append(" size="_s);
            output.append(formatBytesPlain(node.size));
            if (!label.isEmpty()) {
                // Truncate very long strings
                WTF::String displayLabel = label;
                if (displayLabel.length() > 200)
                    displayLabel = makeString(displayLabel.left(197), "..."_s);
                output.append(" value=\""_s);
                output.append(escapeString(displayLabel));
                output.append("\""_s);
            }
            output.append("\n"_s);
        }
    }
    output.append("```\n\n"_s);

    // ========================================
    // TYPE SUMMARY (grep-friendly)
    // ========================================
    output.append("## Type Summary\n\n"_s);
    output.append("Aggregate statistics by type. Format: `TYPE name=<type> count=<n> self=<bytes> retained=<bytes> largest_id=<id>`\n\n"_s);
    output.append("```\n"_s);

    for (const auto& stats : sortedTypes) {
        output.append("TYPE name=\""_s);
        output.append(escapeString(stats.name));
        output.append("\" count="_s);
        output.append(WTF::String::number(stats.count));
        output.append(" self="_s);
        output.append(formatBytesPlain(stats.totalSize));
        output.append(" retained="_s);
        output.append(formatBytesPlain(stats.totalRetainedSize));
        output.append(" largest_id="_s);
        output.append(WTF::String::number(stats.largestInstanceId));
        output.append("\n"_s);
    }
    output.append("```\n\n"_s);

    // ========================================
    // EDGE NAMES (for finding property references)
    // ========================================
    output.append("## Edge Names\n\n"_s);
    output.append("All unique property/variable names used in edges:\n\n"_s);
    output.append("```\n"_s);

    for (size_t i = 0; i < edgeNames.size(); i++) {
        if (!edgeNames[i].isEmpty()) {
            output.append("EDGENAME index="_s);
            output.append(WTF::String::number(i));
            output.append(" name=\""_s);
            output.append(escapeString(edgeNames[i]));
            output.append("\"\n"_s);
        }
    }
    output.append("```\n\n"_s);

    // ========================================
    // USAGE EXAMPLES
    // ========================================
    output.append("## Analysis Examples\n\n"_s);
    output.append("```bash\n"_s);
    output.append("# Find all objects of a specific type\n"_s);
    output.append("grep 'NODE.*type=Function' heap.heapprof\n\n"_s);
    output.append("# Find objects larger than 10KB\n"_s);
    output.append("awk '/^NODE/ && $4 > 10240 {print}' heap.heapprof\n\n"_s);
    output.append("# Find all edges pointing to a specific object\n"_s);
    output.append("grep 'EDGE.*to=12345' heap.heapprof\n\n"_s);
    output.append("# Find all edges from a specific object\n"_s);
    output.append("grep 'EDGE.*from=12345' heap.heapprof\n\n"_s);
    output.append("# Find strings containing a keyword\n"_s);
    output.append("grep 'STRING.*keyword' heap.heapprof\n\n"_s);
    output.append("# Count objects by type\n"_s);
    output.append("grep '^TYPE' heap.heapprof | sort -t= -k3 -rn | head -20\n\n"_s);
    output.append("# Find GC roots\n"_s);
    output.append("grep '^ROOT' heap.heapprof\n\n"_s);
    output.append("# Find objects with a specific property\n"_s);
    output.append("grep 'EDGE.*name=\"myProperty\"' heap.heapprof\n"_s);
    output.append("```\n"_s);

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
