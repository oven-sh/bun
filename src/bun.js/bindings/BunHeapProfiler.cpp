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

extern "C" BunString Bun__generateHeapProfile(JSC::VM* vm);
extern "C" BunString Bun__generateHeapSnapshotV8(JSC::VM* vm);

namespace Bun {

BunString toStringRef(const WTF::String& wtfString);

// Type statistics for summary
struct TypeStatistics {
    WTF::String name;
    size_t totalSize { 0 };
    size_t count { 0 };
    size_t largestInstance { 0 };
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

// Format a number (simple version)
static WTF::String formatNumber(size_t n)
{
    return WTF::String::number(n);
}

WTF::String generateHeapProfile(JSC::VM& vm)
{
    vm.ensureHeapProfiler();
    auto& heapProfiler = *vm.heapProfiler();
    heapProfiler.clearSnapshots();

    // Build the heap snapshot using JSC's GCDebugging format for more detail
    JSC::HeapSnapshotBuilder builder(heapProfiler, JSC::HeapSnapshotBuilder::SnapshotType::GCDebuggingSnapshot);
    builder.buildSnapshot();

    // Get the JSON data
    WTF::String jsonString = builder.json();
    if (jsonString.isEmpty())
        return "ERROR: Failed to generate heap snapshot - empty JSON"_s;

    // Parse the JSON to extract information
    auto jsonValue = JSON::Value::parseJSON(jsonString);
    if (!jsonValue)
        return "ERROR: Failed to parse heap snapshot JSON"_s;

    auto jsonObject = jsonValue->asObject();
    if (!jsonObject)
        return "ERROR: Heap snapshot JSON is not an object"_s;

    // Get the type to determine node stride
    WTF::String snapshotType = jsonObject->getString("type"_s);
    if (snapshotType.isEmpty())
        snapshotType = "Inspector"_s;

    bool isGCDebugging = snapshotType == "GCDebugging"_s;
    int nodeStride = isGCDebugging ? 7 : 4;

    // Node layout indices
    const int NODE_SIZE = 1;
    const int NODE_CLASS_NAME_IDX = 2;

    // Get node class names
    WTF::Vector<WTF::String> classNames;
    auto classNamesArray = jsonObject->getArray("nodeClassNames"_s);
    if (classNamesArray) {
        for (size_t i = 0; i < classNamesArray->length(); i++) {
            auto nameValue = classNamesArray->get(i);
            auto nameStr = nameValue->asString();
            if (!nameStr.isEmpty())
                classNames.append(nameStr);
            else
                classNames.append("(unknown)"_s);
        }
    }

    // Get nodes array
    WTF::Vector<double> nodes;
    size_t totalHeapSize = 0;
    size_t nodeCount = 0;

    auto nodesArray = jsonObject->getArray("nodes"_s);
    if (nodesArray) {
        for (size_t i = 0; i < nodesArray->length(); i++) {
            auto nodeValue = nodesArray->get(i);
            double val = 0;
            int intVal = 0;
            if (nodeValue->asDouble(val))
                nodes.append(val);
            else if (nodeValue->asInteger(intVal))
                nodes.append(static_cast<double>(intVal));
        }
        nodeCount = nodes.size() / nodeStride;

        // Calculate total size
        for (size_t i = 0; i < nodeCount; i++) {
            size_t offset = i * nodeStride;
            if (offset + NODE_SIZE < nodes.size()) {
                totalHeapSize += static_cast<size_t>(nodes[offset + NODE_SIZE]);
            }
        }
    }

    // Build type statistics
    WTF::HashMap<WTF::String, TypeStatistics> typeStats;
    for (size_t i = 0; i < nodeCount; i++) {
        size_t offset = i * nodeStride;
        if (offset + NODE_CLASS_NAME_IDX >= nodes.size())
            continue;

        size_t size = static_cast<size_t>(nodes[offset + NODE_SIZE]);
        int classNameIdx = static_cast<int>(nodes[offset + NODE_CLASS_NAME_IDX]);

        WTF::String className = (classNameIdx >= 0 && static_cast<size_t>(classNameIdx) < classNames.size())
            ? classNames[classNameIdx]
            : "(unknown)"_s;

        auto result = typeStats.add(className, TypeStatistics());
        auto& stats = result.iterator->value;
        if (result.isNewEntry) {
            stats.name = className;
        }
        stats.totalSize += size;
        stats.count++;
        if (size > stats.largestInstance) {
            stats.largestInstance = size;
        }
    }

    // Sort types by total size
    WTF::Vector<TypeStatistics> sortedTypes;
    for (auto& pair : typeStats) {
        sortedTypes.append(pair.value);
    }
    std::sort(sortedTypes.begin(), sortedTypes.end(), [](const TypeStatistics& a, const TypeStatistics& b) {
        return a.totalSize > b.totalSize;
    });

    // Build the output using markdown format
    WTF::StringBuilder output;

    // Header
    output.append("# Bun Heap Profile\n\n"_s);
    output.append("Text-based heap profile for CLI analysis with grep, awk, etc.\n\n"_s);

    // Summary
    output.append("## Summary\n\n"_s);
    output.append("| Metric | Value |\n"_s);
    output.append("|--------|-------|\n"_s);
    output.append("| Total Heap Size | "_s);
    output.append(formatBytes(totalHeapSize));
    output.append(" ("_s);
    output.append(formatNumber(totalHeapSize));
    output.append(" bytes) |\n"_s);
    output.append("| Total Objects | "_s);
    output.append(formatNumber(nodeCount));
    output.append(" |\n"_s);
    output.append("| Unique Types | "_s);
    output.append(formatNumber(sortedTypes.size()));
    output.append(" |\n\n"_s);

    // Top types by size
    output.append("## Top Types by Size\n\n"_s);
    output.append("| Rank | Type | Count | Size | Avg |\n"_s);
    output.append("|------|------|-------|------|-----|\n"_s);

    size_t typeRank = 1;
    for (const auto& stats : sortedTypes) {
        if (typeRank > 50)
            break;

        WTF::String typeName = stats.name;
        if (typeName.length() > 40)
            typeName = makeString(typeName.left(37), "..."_s);

        size_t avgSize = stats.count > 0 ? stats.totalSize / stats.count : 0;

        output.append("| "_s);
        output.append(WTF::String::number(typeRank));
        output.append(" | "_s);
        output.append(typeName);
        output.append(" | "_s);
        output.append(formatNumber(stats.count));
        output.append(" | "_s);
        output.append(formatBytes(stats.totalSize));
        output.append(" | "_s);
        output.append(formatBytes(avgSize));
        output.append(" |\n"_s);

        typeRank++;
    }
    output.append("\n"_s);

    // All types (greppable list)
    output.append("## All Types\n\n"_s);
    output.append("```\n"_s);
    for (const auto& stats : sortedTypes) {
        output.append(stats.name);
        output.append(": count="_s);
        output.append(formatNumber(stats.count));
        output.append(" size="_s);
        output.append(formatBytes(stats.totalSize));
        output.append(" largest="_s);
        output.append(formatBytes(stats.largestInstance));
        output.append("\n"_s);
    }
    output.append("```\n\n"_s);

    // Category breakdown
    output.append("## Categories\n\n"_s);

    size_t totalStringSize = 0;
    size_t stringCount = 0;
    size_t totalArraySize = 0;
    size_t arrayCount = 0;
    size_t totalFuncSize = 0;
    size_t funcCount = 0;

    for (const auto& stats : sortedTypes) {
        if (stats.name.containsIgnoringASCIICase("String"_s)) {
            totalStringSize += stats.totalSize;
            stringCount += stats.count;
        }
        if (stats.name.containsIgnoringASCIICase("Array"_s) || stats.name.containsIgnoringASCIICase("Map"_s) || stats.name.containsIgnoringASCIICase("Set"_s) || stats.name.containsIgnoringASCIICase("Vector"_s)) {
            totalArraySize += stats.totalSize;
            arrayCount += stats.count;
        }
        if (stats.name.containsIgnoringASCIICase("Function"_s) || stats.name.containsIgnoringASCIICase("Closure"_s) || stats.name.containsIgnoringASCIICase("Executable"_s)) {
            totalFuncSize += stats.totalSize;
            funcCount += stats.count;
        }
    }

    auto pct = [totalHeapSize](size_t bytes) -> WTF::String {
        if (totalHeapSize == 0)
            return "0.0"_s;
        double p = (static_cast<double>(bytes) / static_cast<double>(totalHeapSize)) * 100.0;
        WTF::StringBuilder sb;
        sb.append(static_cast<int>(p));
        sb.append("."_s);
        sb.append(static_cast<int>(p * 10) % 10);
        sb.append("%"_s);
        return sb.toString();
    };

    output.append("| Category | Count | Size | % |\n"_s);
    output.append("|----------|-------|------|---|\n"_s);

    output.append("| Strings | "_s);
    output.append(formatNumber(stringCount));
    output.append(" | "_s);
    output.append(formatBytes(totalStringSize));
    output.append(" | "_s);
    output.append(pct(totalStringSize));
    output.append(" |\n"_s);

    output.append("| Collections | "_s);
    output.append(formatNumber(arrayCount));
    output.append(" | "_s);
    output.append(formatBytes(totalArraySize));
    output.append(" | "_s);
    output.append(pct(totalArraySize));
    output.append(" |\n"_s);

    output.append("| Functions | "_s);
    output.append(formatNumber(funcCount));
    output.append(" | "_s);
    output.append(formatBytes(totalFuncSize));
    output.append(" | "_s);
    output.append(pct(totalFuncSize));
    output.append(" |\n"_s);

    size_t otherSize = totalHeapSize - totalStringSize - totalArraySize - totalFuncSize;
    if (otherSize > totalHeapSize)
        otherSize = 0;

    output.append("| Other | - | "_s);
    output.append(formatBytes(otherSize));
    output.append(" | "_s);
    output.append(pct(otherSize));
    output.append(" |\n"_s);

    return output.toString();
}

WTF::String generateHeapSnapshotV8(JSC::VM& vm)
{
    vm.ensureHeapProfiler();
    auto& heapProfiler = *vm.heapProfiler();
    heapProfiler.clearSnapshots();

    // Build the heap snapshot using BunV8HeapSnapshotBuilder for V8-compatible format
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
