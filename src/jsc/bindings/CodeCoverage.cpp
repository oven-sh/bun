#include "root.h"
#include "ZigSourceProvider.h"
#include <JavaScriptCore/ControlFlowProfiler.h>

using namespace JSC;

// JSC counts the condition, the increment and the left side in a loop header by themselves. A line is counted here by the basic block that the loop is in:
// each part of a loop header goes back into that basic block, which is then in as many pieces as it would be without them.
static void foldLoopHeadersIntoBasicBlocksAroundThem(VM& vm, SourceID sourceID, Vector<BasicBlockRange>& pieces)
{
    if (!pieces.containsIf([](const BasicBlockRange& piece) { return piece.m_isInLoopHeader; }))
        return;

    // Whole basic blocks lie in one another or apart.
    auto blocks = vm.controlFlowProfiler()->getBasicBlocksForSourceIDWithoutFunctionRange(sourceID, vm, ControlFlowProfiler::Gaps::With);
    blocks.removeAllMatching([](const BasicBlockRange& block) { return block.m_isInLoopHeader; });
    std::ranges::sort(blocks, [](const BasicBlockRange& a, const BasicBlockRange& b) {
        return a.m_startOffset != b.m_startOffset ? a.m_startOffset < b.m_startOffset : a.m_endOffset > b.m_endOffset;
    });
    std::ranges::sort(pieces, {}, &BasicBlockRange::m_startOffset);

    constexpr size_t none = std::numeric_limits<size_t>::max();
    Vector<size_t, 16> open;
    size_t nextBlock = 0;
    size_t blockOfLastPiece = none;
    size_t kept = 0;
    for (BasicBlockRange piece : pieces) {
        while (nextBlock < blocks.size() && blocks[nextBlock].m_startOffset <= piece.m_startOffset)
            open.append(nextBlock++);
        while (!open.isEmpty() && blocks[open.last()].m_endOffset < piece.m_startOffset)
            open.removeLast();
        size_t block = open.isEmpty() ? none : open.last();
        if (piece.m_isInLoopHeader) {
            if (block == none)
                continue;
            piece.m_isInLoopHeader = false;
            piece.m_hasExecuted = blocks[block].m_hasExecuted;
            piece.m_executionCount = blocks[block].m_executionCount;
        }
        if (kept && block != none && block == blockOfLastPiece && pieces[kept - 1].m_endOffset + 1 == piece.m_startOffset)
            pieces[kept - 1].m_endOffset = piece.m_endOffset;
        else
            pieces[kept++] = piece;
        blockOfLastPiece = block;
    }
    pieces.shrink(kept);
}

extern "C" bool CodeCoverage__withBlocksAndFunctions(
    JSC::VM* vmPtr,
    JSC::SourceID sourceID,
    void* ctx,
    void (*blockCallback)(void* ctx, JSC::BasicBlockRange* range, size_t len, size_t functionOffset))
{

    VM& vm = *vmPtr;

    auto basicBlocks = vm.controlFlowProfiler()->getBasicBlocksForSourceIDWithoutFunctionRange(
        sourceID, vm);
    foldLoopHeadersIntoBasicBlocksAroundThem(vm, sourceID, basicBlocks);

    if (basicBlocks.isEmpty()) {
        blockCallback(ctx, nullptr, 0, 0);
        return true;
    }

    size_t functionStartOffset = basicBlocks.size();

    auto functionRanges = vm.functionHasExecutedCache()->getFunctionRanges(sourceID);

    basicBlocks.reserveCapacity(functionRanges.size() + basicBlocks.size());

    for (const auto& functionRange : functionRanges) {
        // A generator or an async function is one function, and a static block is none.
        auto parseMode = std::get<3>(functionRange);
        if (JSC::isProgramOrModuleParseMode(parseMode) || JSC::isGeneratorOrAsyncFunctionBodyParseMode(parseMode) || parseMode == JSC::SourceParseMode::ClassStaticBlockMode)
            continue;
        BasicBlockRange range;
        range.m_hasExecuted = std::get<0>(functionRange);
        range.m_startOffset = static_cast<int>(std::get<1>(functionRange));
        range.m_endOffset = static_cast<int>(std::get<2>(functionRange));
        range.m_executionCount = range.m_hasExecuted
            ? 1
            : 0; // This is a hack. We don't actually count this.
        basicBlocks.append(range);
    }

    blockCallback(ctx, basicBlocks.begin(), basicBlocks.size(), functionStartOffset);
    return true;
}
