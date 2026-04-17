#pragma once

// Bun's V8-format heap-snapshot serializer.
//
// This is a copy of JSC::BunV8HeapSnapshotBuilder (vendor/WebKit/Source/
// JavaScriptCore/heap/BunV8HeapSnapshotBuilder.{h,cpp}) under a different
// namespace so the fixes below take effect without waiting on a prebuilt
// WebKit bump. The upstream copy is compiled into a unified-source object
// alongside CodeBlockSet/BlockDirectory, so it cannot simply be shadowed at
// link time.
//
// Differences from the upstream copy:
//   - String / regexp / symbol / cell-label node names are truncated to 1024
//     characters, matching V8's heap profiler. Without the cap, a single
//     large JSString in the heap would be embedded in full in the JSON; a
//     string > (INT_MAX - 2) / 6 characters overflows the CheckedInt32 in
//     StringBuilder::appendQuotedJSONString, and smaller-but-still-huge
//     strings OOM the upconverted-to-UTF-16 buffer during reallocateBuffer.
//   - generateV8HeapSnapshot() uses OverflowPolicy::RecordOverflow and
//     returns a null String on overflow instead of crashing, so callers can
//     surface a JS-level OutOfMemory error.

#include <JavaScriptCore/HeapAnalyzer.h>
#include <optional>
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/Vector.h>
#include <wtf/text/StringBuilder.h>

namespace JSC {
class JSCell;
class HeapProfiler;
}

namespace Bun {

class V8HeapSnapshotBuilder final : public JSC::HeapAnalyzer {
    WTF_MAKE_TZONE_ALLOCATED(V8HeapSnapshotBuilder);

public:
    V8HeapSnapshotBuilder(JSC::HeapProfiler&);
    ~V8HeapSnapshotBuilder() final;

    void analyzeNode(JSC::JSCell*) final;
    void analyzeEdge(JSC::JSCell* from, JSC::JSCell* to, JSC::RootMarkReason) final;
    void analyzePropertyNameEdge(JSC::JSCell* from, JSC::JSCell* to, WTF::UniquedStringImpl* propertyName) final;
    void analyzeVariableNameEdge(JSC::JSCell* from, JSC::JSCell* to, WTF::UniquedStringImpl* variableName) final;
    void analyzeIndexEdge(JSC::JSCell* from, JSC::JSCell* to, uint32_t index) final;
    void setOpaqueRootReachabilityReasonForCell(JSC::JSCell*, ASCIILiteral) final;
    void setWrappedObjectForCell(JSC::JSCell*, void*) final;
    void setLabelForCell(JSC::JSCell*, const String&) final;

    // Returns a null String if the serialized JSON would overflow String::MaxLength
    // or allocation failed; callers must handle that and surface an error.
    String json();
    Vector<uint8_t> jsonBytes();

private:
    String generateV8HeapSnapshot();
    Vector<uint8_t> generateV8HeapSnapshotBytes();
    unsigned analyzeNodeInternal(JSC::JSCell*, void* optionalHashId = nullptr);

    struct TraceLocation {
        unsigned scriptId { 0 };
        String scriptName;
        unsigned line { 0 };
        unsigned column { 0 };
    };

    struct Node {
        JSC::JSCell* cell { nullptr };
        unsigned id { 0 };
        unsigned typeIndex { 0 };
        String name {};
        size_t selfSize { 0 };
        Vector<unsigned> edges;
        std::optional<TraceLocation> traceLocation = std::nullopt;
        std::optional<unsigned> parentNodeId = std::nullopt;
        unsigned edgesCount { 0 };
        unsigned childrenVectorIndex { std::numeric_limits<unsigned>::max() };
    };

    struct Edge {
        unsigned fromNodeId { 0 };
        unsigned toNodeId { 0 };
        unsigned typeIndex { 0 };
        unsigned index { 0 };
        String name {};
    };

    enum class V8NodeType : uint8_t {
        Hidden,
        Array,
        String,
        Object,
        Code,
        Closure,
        RegExp,
        Number,
        Native,
        Synthetic,
        ConcatenatedString,
        SlicedString,
        Symbol,
        BigInt,
        ObjectShape,
        Count
    };

    enum class V8EdgeType : uint8_t {
        Context,
        Element,
        Property,
        Internal,
        Hidden,
        Shortcut,
        Weak,
        Count
    };

    JSC::HeapProfiler& m_profiler;
    Lock m_buildingNodeMutex;
    Lock m_buildingEdgeMutex;

    Vector<Node> m_nodes;
    Vector<Edge> m_edges;
    Lock m_cellToNodeIdMutex;
    HashMap<JSC::JSCell*, unsigned> m_cellToNodeId;

    Vector<String> m_strings;
    HashMap<size_t, unsigned> m_stringsLookupTable;
    Vector<String> m_nodeTypeNames;
    Vector<String> m_edgeTypeNames;
    HashMap<String, unsigned> m_nodeTypeMap;
    HashMap<String, unsigned> m_edgeTypeMap;

    HashMap<JSC::JSCell*, String> m_cellLabels;

    unsigned getOrCreateNodeId(JSC::JSCell*, void* optionalHashId = nullptr);
    unsigned getNodeTypeIndex(JSC::JSCell*);
    unsigned getEdgeTypeIndex(JSC::RootMarkReason);
    unsigned getEdgeTypeIndex(const String& type);
    unsigned addString(const String&);
    void initializeTypeNames();
    String getDetailedNodeType(JSC::JSCell*, bool recurse = true);
    std::optional<TraceLocation> getTraceLocation(JSC::JSCell*);
};

} // namespace Bun
