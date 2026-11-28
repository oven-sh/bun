#include "NodeVMSourceBuffer.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/UnlinkedProgramCodeBlock.h>
#include <wtf/Hasher.h>
#include <cstring>
#include <thread>

namespace Bun {

NodeVMSourceBuffer::NodeVMSourceBuffer(String string, unsigned hash, Kind kind, Ref<NodeVMSourceBufferCounters> counters)
    : m_string(WTF::move(string))
    , m_hash(hash)
    , m_kind(kind)
    , m_counters(WTF::move(counters))
{
    auto bytes = m_string.length() * (m_string.is8Bit() ? size_t(1) : size_t(2));
    (m_kind == Kind::Source ? m_counters->sourceBytes : m_counters->sourceMapBytes).fetch_add(bytes);
    m_counters->buffers.fetch_add(1);
}

NodeVMSourceBuffer::~NodeVMSourceBuffer()
{
    auto bytes = m_string.length() * (m_string.is8Bit() ? size_t(1) : size_t(2));
    (m_kind == Kind::Source ? m_counters->sourceBytes : m_counters->sourceMapBytes).fetch_sub(bytes);
    m_counters->buffers.fetch_sub(1);
}

void NodeVMSourceBufferPool::prune(Bucket& bucket)
{
    bucket.removeAllMatching([](auto& slot) { return !slot.buffer.get(); });
    if (bucket.isEmpty())
        bucket = Bucket {};
}

Ref<NodeVMSourceBuffer> NodeVMSourceBufferPool::intern(const String& string, Kind kind)
{
    return intern(string, kind, string.hash());
}

Ref<NodeVMSourceBuffer> NodeVMSourceBufferPool::intern(const String& string, Kind kind, unsigned hash)
{
    if (!m_table)
        m_table = makeUnique<Table>();
    if (!(++m_operations % 16))
        prune(m_table->buckets[m_sweep++ % bucketCount]);
    auto& bucket = m_table->buckets[WTF::computeHash(hash, string.length(), string.is8Bit(), static_cast<unsigned>(kind)) % bucketCount];
    for (auto& slot : bucket) {
        if (slot.hash != hash || slot.length != string.length() || slot.is8Bit != string.is8Bit() || slot.kind != kind)
            continue;
        if (auto buffer = slot.buffer.get()) {
            const String& candidate = buffer->string();
            // Width is part of the key. Compare every byte, including unpaired UTF-16 surrogates.
            bool matches = !string.length() || (string.is8Bit() ? !memcmp(candidate.span8().data(), string.span8().data(), string.span8().size_bytes()) : !memcmp(candidate.span16().data(), string.span16().data(), string.span16().size_bytes()));
            if (matches) {
                ++m_hits;
                return buffer.releaseNonNull();
            }
        }
    }
    ++m_misses;
    // A complete owned buffer can be adopted; slices and externally owned buffers must not pin a parent.
    String owned = string;
    if (string.impl() && (string.impl()->isSubString() || string.impl()->isExternal()))
        owned = string.is8Bit() ? String(string.span8()) : String(string.span16());
    Ref buffer = adoptRef(*new NodeVMSourceBuffer(WTF::move(owned), hash, kind, m_counters.copyRef()));
    if (bucket.size() == bucketLimit) {
        prune(bucket);
        if (bucket.size() == bucketLimit)
            bucket.removeLast();
    }
    bucket.append(Slot { hash, string.length(), string.is8Bit(), kind, buffer });
    return buffer;
}

NodeVMSourceBufferPool::Statistics NodeVMSourceBufferPool::statistics()
{
    Statistics result { m_counters->sourceBytes.load(), m_counters->sourceMapBytes.load(), m_counters->buffers.load(), 0, 0, m_hits, m_misses };
    if (m_table) {
        result.metadataBytes = sizeof(Table);
        for (auto& bucket : m_table->buckets) {
            prune(bucket);
            result.entries += bucket.size();
            result.metadataBytes += bucket.capacity() * sizeof(Slot);
        }
    }
    return result;
}

Ref<NodeVMSourceProvider> NodeVMSourceProvider::create(NodeVMSourceBufferPool& pool, const String& string, const JSC::SourceOrigin& origin, JSC::SourceTaintedness taint, String filename, const TextPosition& position, JSC::SourceProviderSourceType type, JSC::SourceProvenance provenance)
{
    return adoptRef(*new NodeVMSourceProvider(pool.intern(string), origin, taint, WTF::move(filename), position, type, provenance));
}

NodeVMSourceProvider::NodeVMSourceProvider(Ref<NodeVMSourceBuffer> buffer, const JSC::SourceOrigin& origin, JSC::SourceTaintedness taint, String filename, const TextPosition& position, JSC::SourceProviderSourceType type, JSC::SourceProvenance provenance)
    : StringSourceProvider(buffer->string(), origin, taint, WTF::move(filename), position, type, provenance)
    , m_buffer(WTF::move(buffer))
{
}

void NodeVMSourceProvider::shareSourceMap(NodeVMSourceBufferPool& pool, JSC::UnlinkedProgramCodeBlock* block)
{
    String directive = sourceMappingURLDirective();
    if (directive.isNull() && block && block->sourceMappingURLDirective())
        directive = String(block->sourceMappingURLDirective());
    if (directive.isNull())
        return;
    m_sourceMap = pool.intern(directive, NodeVMSourceBuffer::Kind::SourceMap);
    // A directly decoded compileFunction block need not have populated the provider's metadata.
    if (!sourceMappingURLDirective().isNull())
        setSourceMappingURLDirective(m_sourceMap->string());
    // The parsed block also retains the lexer's string and can outlive its Script wrapper.
    if (block && block->sourceMappingURLDirective() != m_sourceMap->string().impl())
        block->setSourceMappingURLDirective(m_sourceMap->string());
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVMSourceBufferStats, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto& vm = globalObject->vm();
    auto stats = WebCore::clientData(vm)->nodeVMSourceBuffers.statistics();
    auto* result = JSC::constructEmptyObject(globalObject);
    Bun::putDirectNamed(vm, result, "sourceBytes"_s, JSC::jsNumber(stats.sourceBytes));
    Bun::putDirectNamed(vm, result, "sourceMapBytes"_s, JSC::jsNumber(stats.sourceMapBytes));
    Bun::putDirectNamed(vm, result, "buffers"_s, JSC::jsNumber(stats.buffers));
    Bun::putDirectNamed(vm, result, "entries"_s, JSC::jsNumber(stats.entries));
    Bun::putDirectNamed(vm, result, "metadataBytes"_s, JSC::jsNumber(stats.metadataBytes));
    Bun::putDirectNamed(vm, result, "hits"_s, JSC::jsNumber(stats.hits));
    Bun::putDirectNamed(vm, result, "misses"_s, JSC::jsNumber(stats.misses));
    return JSC::JSValue::encode(result);
}

JSValue NodeVMSourceBufferPool::test(JSGlobalObject* globalObject)
{
    NodeVMSourceBufferPool pool;
    bool collisionPreserved, widthPreserved, sliceCopied, vmIsolated, threadReleased, overflowBounded;
    {
        auto first = pool.intern("alpha"_s, Kind::Source, 1);
        auto collision = pool.intern("bravo"_s, Kind::Source, 1);
        auto repeat = pool.intern("alpha"_s, Kind::Source, 1);
        collisionPreserved = first.ptr() != collision.ptr() && first.ptr() == repeat.ptr();
        const char16_t characters[] = { 'a', 'l', 'p', 'h', 'a' };
        auto wide = pool.intern(String(std::span { characters }), Kind::Source, 1);
        widthPreserved = wide.ptr() != first.ptr() && !wide->string().is8Bit() && wide->string() == first->string();
        std::span<Latin1Character> parentBytes;
        String parent(StringImpl::createUninitialized(1024 * 1024, parentBytes));
        memset(parentBytes.data(), 'x', parentBytes.size());
        String slice(StringImpl::createSubstringSharingImpl(*parent.impl(), 13, 4096));
        auto copied = pool.intern(slice);
        sliceCopied = slice.impl()->isSubString() && copied->string() == slice && !copied->string().impl()->isSubString();
        NodeVMSourceBufferPool otherVM;
        vmIsolated = otherVM.intern("alpha"_s, Kind::Source, 1).ptr() != first.ptr();
    }
    auto empty = pool.statistics();
    {
        Vector<Ref<NodeVMSourceBuffer>> held;
        for (unsigned i = 1000; i < 1096; ++i)
            held.append(pool.intern(String::number(i), Kind::Source, 7));
        auto full = pool.statistics();
        overflowBounded = full.entries == bucketLimit && full.buffers == held.size();
    }
    RefPtr<NodeVMSourceBuffer> orphan;
    RefPtr<NodeVMSourceBufferCounters> orphanCounters;
    {
        NodeVMSourceBufferPool otherVM;
        orphan = otherVM.intern(String::number(736421));
        orphanCounters = otherVM.m_counters.ptr();
    }
    // The pool is already gone; destruction must not call back into it or touch a VM.
    std::thread thread([orphan = WTF::move(orphan)]() mutable { orphan = nullptr; });
    thread.join();
    threadReleased = !orphanCounters->buffers.load() && !orphanCounters->sourceBytes.load();
    for (unsigned i = 0; i < 70000; ++i)
        pool.intern(String::number(i));
    auto churn = pool.statistics();
    auto& vm = globalObject->vm();
    auto* result = constructEmptyObject(globalObject);
    Bun::putDirectNamed(vm, result, "collisionPreserved"_s, jsBoolean(collisionPreserved));
    Bun::putDirectNamed(vm, result, "widthPreserved"_s, jsBoolean(widthPreserved));
    Bun::putDirectNamed(vm, result, "sliceCopied"_s, jsBoolean(sliceCopied));
    Bun::putDirectNamed(vm, result, "vmIsolated"_s, jsBoolean(vmIsolated));
    Bun::putDirectNamed(vm, result, "threadReleased"_s, jsBoolean(threadReleased));
    Bun::putDirectNamed(vm, result, "overflowBounded"_s, jsBoolean(overflowBounded));
    Bun::putDirectNamed(vm, result, "released"_s, jsBoolean(!empty.buffers && !empty.sourceBytes && !empty.sourceMapBytes && !empty.entries));
    Bun::putDirectNamed(vm, result, "churnReleased"_s, jsBoolean(!churn.buffers && !churn.sourceBytes && !churn.entries));
    Bun::putDirectNamed(vm, result, "metadataBytes"_s, jsNumber(churn.metadataBytes));
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsNodeVMSourceBufferTest, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(NodeVMSourceBufferPool::test(globalObject));
}

}
