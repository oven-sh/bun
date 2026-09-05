#include "root.h"
#include "CodeCoverage.h"
#include "ZigSourceProvider.h"
#include <JavaScriptCore/ControlFlowProfiler.h>

using namespace JSC;

namespace Bun {

void appendFunctionRangesForCoverage(Vector<BasicBlockRange>& basicBlocks, VM& vm, SourceID sourceID)
{
    const Vector<std::tuple<bool, unsigned, unsigned>>& functionRanges = vm.functionHasExecutedCache()->getFunctionRanges(sourceID);

    basicBlocks.reserveCapacity(functionRanges.size() + basicBlocks.size());

    for (const auto& functionRange : functionRanges) {
        BasicBlockRange range;
        range.m_hasExecuted = std::get<0>(functionRange);
        range.m_startOffset = static_cast<int>(std::get<1>(functionRange));
        range.m_endOffset = static_cast<int>(std::get<2>(functionRange));
        range.m_executionCount = range.m_hasExecuted
            ? 1
            : 0; // This is a hack. We don't actually count this.
        if (isSynthesizedDefaultConstructorRange(range.m_hasExecuted, range.m_startOffset, range.m_endOffset))
            continue;
        basicBlocks.append(range);
    }
}

}

extern "C" bool CodeCoverage__withBlocksAndFunctions(
    JSC::VM* vmPtr,
    JSC::SourceID sourceID,
    void* ctx,
    bool ignoreSourceMap,
    void (*blockCallback)(void* ctx, JSC::BasicBlockRange* range, size_t len, size_t functionOffset, bool ignoreSourceMap))
{

    VM& vm = *vmPtr;

    auto basicBlocks = vm.controlFlowProfiler()->getBasicBlocksForSourceIDWithoutFunctionRange(
        sourceID, vm);

    if (basicBlocks.isEmpty()) {
        blockCallback(ctx, nullptr, 0, 0, ignoreSourceMap);
        return true;
    }

    size_t functionStartOffset = basicBlocks.size();

    Bun::appendFunctionRangesForCoverage(basicBlocks, vm, sourceID);

    blockCallback(ctx, basicBlocks.begin(), basicBlocks.size(), functionStartOffset, ignoreSourceMap);
    return true;
}
