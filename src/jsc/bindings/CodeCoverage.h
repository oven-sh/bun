#pragma once

#include "root.h"
#include <JavaScriptCore/ControlFlowProfiler.h>
#include <JavaScriptCore/FunctionHasExecutedCache.h>

namespace Bun {

// CodeBlock::finishCreation registers every nested function expression with
// FunctionHasExecutedCache under the owner's SourceID using the expression's
// unlinked offsets. For a class with no explicit constructor, the synthesized
// default constructor's offsets are into BuiltinExecutables::defaultConstructorSourceCode()
// rather than the owner's source, and removeUnexecutedRange later fires against
// the builtin SourceID, so the owner-side entry is never cleared.
static constexpr std::pair<int, int> defaultConstructorRange(size_t sourceLength)
{
    return { static_cast<int>(std::char_traits<char>::length("(")), static_cast<int>(sourceLength) - 2 };
}
static constexpr auto kBaseDefaultCtorRange = defaultConstructorRange(std::char_traits<char>::length("(function () { })"));
static constexpr auto kDerivedDefaultCtorRange = defaultConstructorRange(std::char_traits<char>::length("(function (...args) { super(...args); })"));
static_assert(kBaseDefaultCtorRange == std::pair { 1, 15 });
static_assert(kDerivedDefaultCtorRange == std::pair { 1, 38 });

static constexpr bool isSyntheticDefaultCtorRange(bool hasExecuted, int startOffset, int endOffset)
{
    if (hasExecuted)
        return false;
    auto offsets = std::pair { startOffset, endOffset };
    return offsets == kBaseDefaultCtorRange || offsets == kDerivedDefaultCtorRange;
}

static inline void appendFunctionRangesForCoverage(Vector<JSC::BasicBlockRange>& out, JSC::VM& vm, JSC::SourceID sourceID)
{
    const auto& functionRanges = vm.functionHasExecutedCache()->getFunctionRanges(sourceID);
    out.reserveCapacity(functionRanges.size() + out.size());
    for (const auto& functionRange : functionRanges) {
        JSC::BasicBlockRange range;
        range.m_hasExecuted = std::get<0>(functionRange);
        range.m_startOffset = static_cast<int>(std::get<1>(functionRange));
        range.m_endOffset = static_cast<int>(std::get<2>(functionRange));
        range.m_executionCount = range.m_hasExecuted ? 1 : 0;
        if (isSyntheticDefaultCtorRange(range.m_hasExecuted, range.m_startOffset, range.m_endOffset))
            continue;
        out.append(range);
    }
}

} // namespace Bun
