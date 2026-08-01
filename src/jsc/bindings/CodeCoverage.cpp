#include "root.h"
#include "ZigSourceProvider.h"
#include <JavaScriptCore/ControlFlowProfiler.h>

using namespace JSC;

// CodeBlock::finishCreation registers every nested function expression with
// FunctionHasExecutedCache::insertUnexecutedRange against the *owner* SourceID,
// using the expression's unlinkedFunctionStart/End. For a class with no explicit
// constructor, BytecodeGenerator::emitNewDefaultConstructor adds an executable
// synthesized from BuiltinExecutables::defaultConstructorSourceCode() to that list,
// so the range is in the synthetic provider's coordinate space rather than the
// owner's. UnlinkedFunctionExecutable::linkedSourceCode swaps back to the synthetic
// provider when the constructor runs, so removeUnexecutedRange fires against the
// synthetic SourceID and the owner-SourceID entry is never cleared. The entry is
// therefore always (hasExecuted == false) and always at one of these two offsets,
// derived by BuiltinExecutables::createExecutable as unlinkedFunctionStart =
// strlen("(") and unlinkedFunctionEnd = source.length() - 2:
//
//   "(function () { })"                         -> (1, 15)
//   "(function (...args) { super(...args); })"  -> (1, 38)
static constexpr std::pair<int, int> defaultConstructorRange(size_t sourceLength)
{
    return { 1, static_cast<int>(sourceLength) - 2 };
}
static constexpr auto kBaseDefaultCtorRange = defaultConstructorRange(std::char_traits<char>::length("(function () { })"));
static constexpr auto kDerivedDefaultCtorRange = defaultConstructorRange(std::char_traits<char>::length("(function (...args) { super(...args); })"));
static_assert(kBaseDefaultCtorRange == std::pair { 1, 15 });
static_assert(kDerivedDefaultCtorRange == std::pair { 1, 38 });

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
        if (!range.m_hasExecuted) {
            auto offsets = std::pair { range.m_startOffset, range.m_endOffset };
            if (offsets == kBaseDefaultCtorRange || offsets == kDerivedDefaultCtorRange)
                continue;
        }
        basicBlocks.append(range);
    }

    blockCallback(ctx, basicBlocks.begin(), basicBlocks.size(), functionStartOffset, ignoreSourceMap);
    return true;
}
