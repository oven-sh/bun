#include "root.h"
#include "ZigSourceProvider.h"
#include <JavaScriptCore/ControlFlowProfiler.h>

using namespace JSC;

// JSC synthesizes an implicit class constructor from one of two static
// strings (BuiltinExecutables::defaultConstructorSourceCode). The function
// range of that executable is 1 (the "function" keyword after the opening
// paren) to the byte before the closing brace. CodeBlock::finishCreation
// records that range under the enclosing file's source ID, but the
// constructor's own CodeBlock is keyed by the builtin source, so the range is
// never marked as executed. Drop these ranges so an implicit constructor
// neither counts as an uncovered function nor zeroes the lines it overlaps.
static constexpr unsigned implicitConstructorStart = 1;
static constexpr unsigned implicitBaseConstructorEnd = sizeof("(function () { })") - 1 - 2;
static constexpr unsigned implicitDerivedConstructorEnd = sizeof("(function (...args) { super(...args); })") - 1 - 2;

static bool isImplicitClassConstructorRange(unsigned start, unsigned end)
{
    return start == implicitConstructorStart
        && (end == implicitBaseConstructorEnd || end == implicitDerivedConstructorEnd);
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

    const Vector<std::tuple<bool, unsigned, unsigned>>& functionRanges = vm.functionHasExecutedCache()->getFunctionRanges(sourceID);

    basicBlocks.reserveCapacity(functionRanges.size() + basicBlocks.size());

    for (const auto& functionRange : functionRanges) {
        unsigned start = std::get<1>(functionRange);
        unsigned end = std::get<2>(functionRange);
        if (isImplicitClassConstructorRange(start, end))
            continue;

        BasicBlockRange range;
        range.m_hasExecuted = std::get<0>(functionRange);
        range.m_startOffset = static_cast<int>(start);
        range.m_endOffset = static_cast<int>(end);
        range.m_executionCount = range.m_hasExecuted
            ? 1
            : 0; // This is a hack. We don't actually count this.
        basicBlocks.append(range);
    }

    blockCallback(ctx, basicBlocks.begin(), basicBlocks.size(), functionStartOffset, ignoreSourceMap);
    return true;
}
