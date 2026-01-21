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
    size_t retainedSize { 0 };
    uint64_t dominatorId { 0 };
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
    size_t largestInstance { 0 };
    size_t largestRetained { 0 };
    uint64_t largestInstanceId { 0 };
};

// Format bytes nicely
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
        if (!arr) return;
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
    auto rootsArray = jsonObject->getArray("roots"_s);
    if (rootsArray) {
        for (size_t i = 0; i < rootsArray->length(); i += 3) {
            int nodeId = 0;
            rootsArray->get(i)->asInteger(nodeId);
            auto it = idToIndex.find(nodeId);
            if (it != idToIndex.end()) {
                nodes[it->second].isGCRoot = true;
            }
        }
    }

    // Build outgoing edges map for retained size calculation
    std::unordered_map<uint64_t, WTF::Vector<size_t>> outgoingEdges; // node id -> edge indices
    for (size_t i = 0; i < edges.size(); i++) {
        outgoingEdges[edges[i].fromId].append(i);
    }

    // Build incoming edges for retainer analysis
    std::unordered_map<uint64_t, WTF::Vector<size_t>> incomingEdges; // node id -> edge indices
    for (size_t i = 0; i < edges.size(); i++) {
        incomingEdges[edges[i].toId].append(i);
    }

    // Simple retained size approximation: self size + direct children sizes
    // (Full dominator tree calculation is complex, this gives a useful approximation)
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
        if (node.size > stats.largestInstance) {
            stats.largestInstance = node.size;
            stats.largestInstanceId = node.id;
        }
        if (node.retainedSize > stats.largestRetained) {
            stats.largestRetained = node.retainedSize;
        }
    }

    // Sort types by retained size (more useful for finding leaks)
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

    // Build output
    WTF::StringBuilder output;

    // Header
    output.append("# Bun Heap Profile\n\n"_s);
    output.append("> Generated by `bun --heap-prof-text`\n\n"_s);

    // Summary as a nice list
    output.append("## Summary\n\n"_s);
    output.append("- **Total Heap Size:** "_s);
    output.append(formatBytes(totalHeapSize));
    output.append("\n"_s);
    output.append("- **Total Objects:** "_s);
    output.append(WTF::String::number(nodes.size()));
    output.append("\n"_s);
    output.append("- **Total Edges:** "_s);
    output.append(WTF::String::number(edges.size()));
    output.append("\n"_s);
    output.append("- **Unique Types:** "_s);
    output.append(WTF::String::number(sortedTypes.size()));
    output.append("\n\n"_s);

    // Top types by retained size
    output.append("## Top Types by Retained Size\n\n"_s);
    output.append("| # | Type | Count | Self Size | Retained | Largest |\n"_s);
    output.append("|--:|------|------:|----------:|---------:|--------:|\n"_s);

    size_t rank = 1;
    for (const auto& stats : sortedTypes) {
        if (rank > 50) break;

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

    // Largest individual objects
    output.append("## Largest Objects\n\n"_s);
    output.append("These objects retain the most memory and are potential leak sources:\n\n"_s);
    output.append("| # | ID | Type | Self | Retained | Edges |\n"_s);
    output.append("|--:|---:|------|-----:|---------:|------:|\n"_s);

    for (size_t i = 0; i < 30 && i < largestObjects.size(); i++) {
        const auto& node = nodes[largestObjects[i]];
        WTF::String className = (node.classNameIndex >= 0 && static_cast<size_t>(node.classNameIndex) < classNames.size())
            ? classNames[node.classNameIndex]
            : "(unknown)"_s;

        if (className.length() > 28)
            className = makeString(className.left(25), "..."_s);

        size_t edgeCount = 0;
        auto it = outgoingEdges.find(node.id);
        if (it != outgoingEdges.end())
            edgeCount = it->second.size();

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
        output.append(WTF::String::number(edgeCount));
        output.append(" |\n"_s);
    }
    output.append("\n"_s);

    // GC Roots
    output.append("## GC Roots\n\n"_s);
    output.append("Objects directly held by the runtime (first 50):\n\n"_s);

    size_t gcRootCount = 0;
    for (const auto& node : nodes) {
        if (node.isGCRoot) {
            gcRootCount++;
            if (gcRootCount <= 50) {
                WTF::String className = (node.classNameIndex >= 0 && static_cast<size_t>(node.classNameIndex) < classNames.size())
                    ? classNames[node.classNameIndex]
                    : "(unknown)"_s;
                output.append("- `"_s);
                output.append(className);
                output.append("` #"_s);
                output.append(WTF::String::number(node.id));
                output.append(" - "_s);
                output.append(formatBytes(node.size));
                output.append(" (retains "_s);
                output.append(formatBytes(node.retainedSize));
                output.append(")\n"_s);
            }
        }
    }
    if (gcRootCount > 50) {
        output.append("\n*...and "_s);
        output.append(WTF::String::number(gcRootCount - 50));
        output.append(" more GC roots*\n"_s);
    }
    output.append("\n"_s);

    // Object Graph Edges (sample of interesting edges)
    output.append("## Object References\n\n"_s);
    output.append("Sample of property references between objects:\n\n"_s);
    output.append("```javascript\n"_s);

    size_t edgeSample = 0;
    for (const auto& edge : edges) {
        if (edgeSample >= 100) break;

        // Skip internal edges, they're less useful
        WTF::String edgeType = (edge.typeIndex >= 0 && static_cast<size_t>(edge.typeIndex) < edgeTypes.size())
            ? edgeTypes[edge.typeIndex]
            : "?"_s;

        if (edgeType == "Internal"_s)
            continue;

        auto fromIt = idToIndex.find(edge.fromId);
        auto toIt = idToIndex.find(edge.toId);
        if (fromIt == idToIndex.end() || toIt == idToIndex.end())
            continue;

        const auto& fromNode = nodes[fromIt->second];
        const auto& toNode = nodes[toIt->second];

        WTF::String fromClass = (fromNode.classNameIndex >= 0 && static_cast<size_t>(fromNode.classNameIndex) < classNames.size())
            ? classNames[fromNode.classNameIndex]
            : "?"_s;
        WTF::String toClass = (toNode.classNameIndex >= 0 && static_cast<size_t>(toNode.classNameIndex) < classNames.size())
            ? classNames[toNode.classNameIndex]
            : "?"_s;

        WTF::String edgeName;
        if (edgeType == "Property"_s || edgeType == "Variable"_s) {
            if (edge.dataIndex >= 0 && static_cast<size_t>(edge.dataIndex) < edgeNames.size())
                edgeName = edgeNames[edge.dataIndex];
        } else if (edgeType == "Index"_s) {
            edgeName = makeString("["_s, WTF::String::number(edge.dataIndex), "]"_s);
        }

        output.append(fromClass);
        output.append("#"_s);
        output.append(WTF::String::number(edge.fromId));
        if (!edgeName.isEmpty()) {
            output.append("."_s);
            output.append(edgeName);
        }
        output.append(" -> "_s);
        output.append(toClass);
        output.append("#"_s);
        output.append(WTF::String::number(edge.toId));
        output.append("  // "_s);
        output.append(formatBytes(toNode.size));
        output.append("\n"_s);

        edgeSample++;
    }
    output.append("```\n\n"_s);

    // All types for grep
    output.append("## All Types\n\n"_s);
    output.append("<details>\n<summary>Click to expand full type list</summary>\n\n"_s);
    output.append("```\n"_s);
    for (const auto& stats : sortedTypes) {
        output.append(stats.name);
        output.append(": count="_s);
        output.append(WTF::String::number(stats.count));
        output.append(" self="_s);
        output.append(formatBytes(stats.totalSize));
        output.append(" retained="_s);
        output.append(formatBytes(stats.totalRetainedSize));
        output.append(" largest_id="_s);
        output.append(WTF::String::number(stats.largestInstanceId));
        output.append("\n"_s);
    }
    output.append("```\n\n"_s);
    output.append("</details>\n"_s);

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
