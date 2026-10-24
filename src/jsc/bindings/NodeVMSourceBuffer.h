#pragma once

#include <JavaScriptCore/SourceProvider.h>
#include <wtf/ThreadSafeWeakPtr.h>
#include <wtf/Vector.h>
#include <array>
#include <atomic>

namespace JSC {
class UnlinkedProgramCodeBlock;
}

namespace Bun {

class NodeVMSourceBufferPool;

struct NodeVMSourceBufferCounters : public ThreadSafeRefCounted<NodeVMSourceBufferCounters> {
    std::atomic<size_t> sourceBytes { 0 };
    std::atomic<size_t> sourceMapBytes { 0 };
    std::atomic<size_t> buffers { 0 };
};

class NodeVMSourceBuffer final : public ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<NodeVMSourceBuffer> {
public:
    enum class Kind : uint8_t { Source,
        SourceMap };
    NodeVMSourceBuffer(String, unsigned hash, Kind, Ref<NodeVMSourceBufferCounters>);
    ~NodeVMSourceBuffer();
    const String& string() const { return m_string; }
    unsigned hash() const { return m_hash; }

private:
    const String m_string;
    const unsigned m_hash;
    const Kind m_kind;
    Ref<NodeVMSourceBufferCounters> m_counters;
};

// Only the VM thread operates the index. Leases may die on a GC thread, even after VM teardown.
class NodeVMSourceBufferPool {
public:
    using Kind = NodeVMSourceBuffer::Kind;
    Ref<NodeVMSourceBuffer> intern(const String&, Kind = Kind::Source);
    struct Statistics {
        size_t sourceBytes, sourceMapBytes, buffers, entries, metadataBytes;
        uint64_t hits, misses;
    };
    Statistics statistics();
    static JSC::JSValue test(JSC::JSGlobalObject*);

private:
    struct Slot {
        unsigned hash;
        unsigned length;
        bool is8Bit;
        Kind kind;
        ThreadSafeWeakPtr<NodeVMSourceBuffer> buffer;
    };
    // Bound both lookup work and weak metadata without retaining any source bytes at capacity.
    static constexpr size_t bucketCount = 2048;
    static constexpr size_t bucketLimit = 32;
    using Bucket = Vector<Slot>;
    struct Table {
        WTF_DEPRECATED_MAKE_STRUCT_FAST_ALLOCATED(Table);
        std::array<Bucket, bucketCount> buckets;
    };
    std::unique_ptr<Table> m_table;
    Ref<NodeVMSourceBufferCounters> m_counters { adoptRef(*new NodeVMSourceBufferCounters) };
    uint64_t m_hits { 0 };
    uint64_t m_misses { 0 };
    size_t m_sweep { 0 };
    size_t m_operations { 0 };
    static void prune(Bucket&);
    Ref<NodeVMSourceBuffer> intern(const String&, Kind, unsigned hash);
};

class NodeVMSourceProvider final : public JSC::StringSourceProvider {
public:
    static Ref<NodeVMSourceProvider> create(NodeVMSourceBufferPool&, const String&, const JSC::SourceOrigin&, JSC::SourceTaintedness, String filename, const TextPosition&, JSC::SourceProviderSourceType = JSC::SourceProviderSourceType::Program, JSC::SourceProvenance = JSC::SourceProvenance::GeneratedAtRuntime);
    unsigned hash() const final { return m_buffer->hash(); }
    const Ref<NodeVMSourceBuffer>& buffer() const { return m_buffer; }
    void shareSourceMap(NodeVMSourceBufferPool&, JSC::UnlinkedProgramCodeBlock*);

private:
    NodeVMSourceProvider(Ref<NodeVMSourceBuffer>, const JSC::SourceOrigin&, JSC::SourceTaintedness, String, const TextPosition&, JSC::SourceProviderSourceType, JSC::SourceProvenance);
    Ref<NodeVMSourceBuffer> m_buffer;
    RefPtr<NodeVMSourceBuffer> m_sourceMap;
};

JSC_DECLARE_HOST_FUNCTION(jsNodeVMSourceBufferStats);
JSC_DECLARE_HOST_FUNCTION(jsNodeVMSourceBufferTest);

}
