#include "root.h"
#include "BunHeapSampler.h"
#include "BunClientData.h"
#include "BunCPUProfiler.h"

#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/VM.h>
#include <wtf/JSONValues.h>
#include <wtf/TZoneMallocInlines.h>
#include <cmath>

namespace Bun {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HeapSampler);

void* const HeapSampler::deadCell = std::bit_cast<void*>(static_cast<uintptr_t>(1));
void* const HeapSampler::voidSample = std::bit_cast<void*>(static_cast<uintptr_t>(2));

static bool isCellAddress(void* cell)
{
    return std::bit_cast<uintptr_t>(cell) > 2;
}

static std::unique_ptr<HeapSampler>& slotFor(JSC::VM& vm)
{
    return static_cast<WebCore::JSVMClientData*>(vm.clientData)->heapSampler;
}

HeapSampler* HeapSampler::get(JSC::VM& vm)
{
    return slotFor(vm).get();
}

bool HeapSampler::start(JSC::VM& vm, const Options& options)
{
    auto& slot = slotFor(vm);
    if (slot)
        return false;
    slot = makeUnique<HeapSampler>(vm, options);
    vm.heap.startAllocationSampling(*slot, options.intervalBytes);
    return true;
}

void HeapSampler::stop(JSC::VM& vm)
{
    slotFor(vm) = nullptr;
}

HeapSampler::HeapSampler(JSC::VM& vm, const Options& options)
    : m_vm(vm)
    , m_options(options)
{
    m_nodes.append(Node { "(root)"_s, nullptr, 0, 0, {} });
}

HeapSampler::~HeapSampler()
{
    if (m_vm.heap.isSamplingAllocations())
        m_vm.heap.stopAllocationSampling();
}

void HeapSampler::didSampleAllocation(JSC::HeapCell* cell, size_t bytes)
{
    record(cell, bytes);
}

void HeapSampler::didSampleExtraMemory(const JSC::JSCell* owner, size_t bytes)
{
    // The bytes live as long as their owner, so they are followed through GC by its address.
    record(const_cast<JSC::JSCell*>(owner), bytes);
}

void HeapSampler::record(void* cell, size_t bytes)
{
    unsigned node = nodeForCurrentStack();
    // V8's weighting: a pick of n bytes stands for the allocations of that size that the interval skipped, and the
    // count is rounded so every size in the profile is a whole number of bytes.
    double scale = 1.0 / -std::expm1(-static_cast<double>(bytes) / m_options.intervalBytes);
    double size = static_cast<double>(bytes) * std::round(scale);
    unsigned index = m_samples.size();
    m_samples.append(Sample { cell, node, noSample, ++m_lastOrdinal, size });
    if (isCellAddress(cell))
        linkSampleToCell(index);
}

void HeapSampler::linkSampleToCell(unsigned index)
{
    auto result = m_firstSampleOfCell.add(m_samples[index].cell, index);
    if (!result.isNewEntry) {
        m_samples[index].nextOfSameCell = result.iterator->value;
        result.iterator->value = index;
    }
}

void HeapSampler::relinkSamplesToCells()
{
    m_firstSampleOfCell.clear();
    for (unsigned index = 0; index < m_samples.size(); ++index) {
        m_samples[index].nextOfSameCell = noSample;
        if (isCellAddress(m_samples[index].cell))
            linkSampleToCell(index);
    }
}

// The first of the cell's samples (the rest follow through nextOfSameCell), out of the map.
unsigned HeapSampler::takeSamplesOfCell(void* cell)
{
    auto iterator = m_firstSampleOfCell.find(cell);
    if (iterator == m_firstSampleOfCell.end())
        return noSample;
    unsigned index = iterator->value;
    m_firstSampleOfCell.remove(iterator);
    return index;
}

// The node of the innermost JS frame on the stack, created along with its ancestors as needed. Nodes are keyed by the
// function that allocated (its source and start position), so every allocation in one function from one call path
// lands on one node, whatever the line inside the function.
unsigned HeapSampler::nodeForCurrentStack()
{
    struct Frame {
        JSC::SourceProvider* provider;
        unsigned line;
        unsigned column;
        JSC::CodeBlock* codeBlock;
    };
    WTF::Vector<Frame, 32> frames;
    if (JSC::CallFrame* top = m_vm.topCallFrame) {
        unsigned depth = m_options.stackDepth;
        JSC::StackVisitor::visit(top, m_vm, [&](JSC::StackVisitor& visitor) -> IterationStatus {
            auto* codeBlock = visitor->codeBlock();
            if (!codeBlock)
                return IterationStatus::Continue;
            auto* executable = codeBlock->ownerExecutable();
            frames.append(Frame { executable->source().provider(), static_cast<unsigned>(executable->firstLine()), executable->startColumn(), codeBlock });
            return frames.size() >= depth ? IterationStatus::Done : IterationStatus::Continue;
        });
    }

    unsigned parent = 0;
    for (size_t i = frames.size(); i--;) {
        const Frame& frame = frames[i];
        auto result = m_nodeIndex.add(std::make_tuple(parent + 1, frame.provider, frame.line, frame.column), m_nodes.size());
        if (result.isNewEntry) {
            WTF::String functionName;
            if (frame.codeBlock->codeType() == JSC::FunctionCode)
                functionName = static_cast<JSC::FunctionExecutable*>(frame.codeBlock->ownerExecutable())->ecmaName().string();
            m_nodes.append(Node { WTF::move(functionName), frame.provider, frame.line, frame.column, {} });
            m_nodes[parent].children.append(result.iterator->value);
        }
        parent = result.iterator->value;
    }
    return parent;
}

void HeapSampler::didRelocateCell(JSC::HeapCell* from, JSC::HeapCell* to)
{
    // The copy may have been picked as an allocation while it was made; that is not one.
    for (auto index = takeSamplesOfCell(to); index != noSample; index = m_samples[index].nextOfSameCell)
        m_samples[index].cell = voidSample;
    auto index = takeSamplesOfCell(from);
    if (index == noSample)
        return;
    for (auto cursor = index; cursor != noSample; cursor = m_samples[cursor].nextOfSameCell)
        m_samples[cursor].cell = to;
    m_firstSampleOfCell.add(to, index);
}

void HeapSampler::reconcileSampledCells(JSC::CollectionScope scope)
{
    bool keepDead = scope == JSC::CollectionScope::Full ? m_options.includeObjectsCollectedByMajorGC : m_options.includeObjectsCollectedByMinorGC;
    bool changed = false;
    for (auto& sample : m_samples) {
        if (sample.cell == voidSample) {
            changed = true;
            continue;
        }
        if (!isCellAddress(sample.cell) || m_vm.heap.isMarked(sample.cell))
            continue;
        sample.cell = keepDead ? deadCell : voidSample;
        changed = true;
    }
    if (!changed)
        return;
    m_samples.removeAllMatching([](const Sample& sample) { return sample.cell == voidSample; });
    relinkSamplesToCells();
}

WTF::String HeapSampler::profileJSON()
{
    if (m_options.forceGC)
        m_vm.heap.collectSync(JSC::CollectionScope::Full);

    WTF::Vector<double> selfSizes(m_nodes.size(), 0.0);
    auto samples = JSON::Array::create();
    for (const auto& sample : m_samples) {
        if (sample.cell == voidSample)
            continue;
        selfSizes[sample.node] += sample.size;
        auto object = JSON::Object::create();
        object->setDouble("size"_s, sample.size);
        object->setInteger("nodeId"_s, sample.node + 1);
        object->setDouble("ordinal"_s, static_cast<double>(sample.ordinal));
        samples->pushObject(WTF::move(object));
    }

    auto nodeJSON = [&](auto& self, unsigned index) -> Ref<JSON::Object> {
        const Node& node = m_nodes[index];
        auto callFrame = JSON::Object::create();
        WTF::String url;
        int line = -1;
        int column = -1;
        unsigned scriptId = 0;
        if (node.provider) {
            url = node.provider->sourceURL();
            scriptId = static_cast<unsigned>(node.provider->asID());
            JSC::LineColumn lineColumn { node.line, node.column };
            if (node.line > 0) {
                auto& remap = m_vm.computeLineColumnWithSourcemap();
                if (remap)
                    remap(m_vm, node.provider.get(), lineColumn, url);
            }
            // JSC counts from 1, the profile from 0.
            line = lineColumn.line > 0 ? static_cast<int>(lineColumn.line) - 1 : 0;
            column = lineColumn.column > 0 ? static_cast<int>(lineColumn.column) - 1 : 0;
            normalizeProfileURL(url);
        }
        callFrame->setString("functionName"_s, node.functionName);
        callFrame->setString("scriptId"_s, WTF::String::number(scriptId));
        callFrame->setString("url"_s, url);
        callFrame->setInteger("lineNumber"_s, line);
        callFrame->setInteger("columnNumber"_s, column);
        auto object = JSON::Object::create();
        object->setObject("callFrame"_s, WTF::move(callFrame));
        object->setDouble("selfSize"_s, selfSizes[index]);
        object->setInteger("id"_s, index + 1);
        auto children = JSON::Array::create();
        for (unsigned child : node.children)
            children->pushObject(self(self, child));
        object->setArray("children"_s, WTF::move(children));
        return object;
    };

    auto profile = JSON::Object::create();
    profile->setObject("head"_s, nodeJSON(nodeJSON, 0));
    profile->setArray("samples"_s, WTF::move(samples));
    return profile->toJSONString();
}

} // namespace Bun
