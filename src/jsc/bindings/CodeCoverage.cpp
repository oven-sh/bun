#include "root.h"
#include "ZigSourceProvider.h"
#include <JavaScriptCore/ControlFlowProfiler.h>

using namespace JSC;

extern "C" bool CodeCoverage__withBlocksAndFunctions(
    JSC::VM* vmPtr,
    JSC::SourceID sourceID,
    void* ctx,
    void (*blockCallback)(void* ctx, JSC::BasicBlockRange* range, size_t len, size_t functionOffset))
{

    VM& vm = *vmPtr;

    auto basicBlocks = vm.controlFlowProfiler()->basicBlocks(sourceID);

    if (basicBlocks.isEmpty()) {
        blockCallback(ctx, nullptr, 0, 0);
        return true;
    }

    size_t functionStartOffset = basicBlocks.size();

    auto functionRanges = vm.controlFlowProfiler()->codeRanges(sourceID);

    basicBlocks.reserveCapacity(functionRanges.size() + basicBlocks.size());

    for (const auto& functionRange : functionRanges) {
        // A generator or an async function is one function, and a static block is none.
        if (functionRange.kind != CodeRange::Kind::Function)
            continue;
        BasicBlockRange range;
        range.m_hasExecuted = functionRange.hasExecuted;
        range.m_startOffset = static_cast<int>(functionRange.start);
        range.m_endOffset = static_cast<int>(functionRange.end);
        range.m_executionCount = range.m_hasExecuted
            ? 1
            : 0; // This is a hack. We don't actually count this.
        basicBlocks.append(range);
    }

    blockCallback(ctx, basicBlocks.begin(), basicBlocks.size(), functionStartOffset);
    return true;
}
