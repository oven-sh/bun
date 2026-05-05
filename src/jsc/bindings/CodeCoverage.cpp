#include "root.h"
#include "ZigSourceProvider.h"
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/ControlFlowProfiler.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>
#include <wtf/HashSet.h>
#include <wtf/ScopedLambda.h>

using namespace JSC;

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

    // Classify function byte-offset ranges reachable from this source as synthetic
    // vs. same-source, so we can drop only the synthetic ones from the range list.
    //
    // JSC emits a synthetic default class constructor for `class Foo extends Bar() {}`
    // (and plain `class Foo {}`) by linking a *separate* builtin SourceProvider —
    // `(function (...args) { super(...args); })` or `(function () { })`. But
    // `CodeBlock::finishCreation` files the constructor's `unlinkedFunctionStart`
    // and `unlinkedFunctionEnd` under the OWNER's sourceID, so those offsets — which
    // live in the synthetic provider — end up looking like real function ranges in
    // the user's source. Coverage then reports bogus "uncovered" bytes that straddle
    // whatever user code happens to sit at those offsets. See issue #29691.
    //
    // The synthetic case is identifiable because `functionExecutable->sourceID()`
    // resolves to the synthetic provider's ID (via `linkedSourceCode`), not the
    // owner's. But a real user function CAN have offsets that numerically collide
    // with a synthetic constructor's `[1, N)` range (e.g. a user file starting with
    // `!function(){}` where the function begins at offset 1). So also collect
    // same-source ranges and skip only when a range is synthetic and NOT also
    // present in the same-source set.
    HashSet<std::pair<unsigned, unsigned>> syntheticFunctionRanges;
    HashSet<std::pair<unsigned, unsigned>> sameSourceFunctionRanges;
    vm.heap.forEachCodeBlock([&](CodeBlock* codeBlock) {
        auto* owner = codeBlock->ownerExecutable();
        if (!owner || owner->sourceID() != sourceID)
            return;

        auto collect = [&](FunctionExecutable* fnExec) {
            if (!fnExec)
                return;
            auto* unlinked = fnExec->unlinkedExecutable();
            if (!unlinked)
                return;
            std::pair<unsigned, unsigned> range { unlinked->unlinkedFunctionStart(), unlinked->unlinkedFunctionEnd() };
            if (fnExec->sourceID() == sourceID)
                sameSourceFunctionRanges.add(range);
            else
                syntheticFunctionRanges.add(range);
        };

        for (const auto& fn : codeBlock->functionDecls())
            collect(fn.get());
        for (int i = 0, count = static_cast<int>(codeBlock->numberOfFunctionExprs()); i < count; ++i)
            collect(codeBlock->functionExpr(i));
    });

    const Vector<std::tuple<bool, unsigned, unsigned>>& functionRanges = vm.functionHasExecutedCache()->getFunctionRanges(sourceID);

    basicBlocks.reserveCapacity(functionRanges.size() + basicBlocks.size());

    for (const auto& functionRange : functionRanges) {
        unsigned start = std::get<1>(functionRange);
        unsigned end = std::get<2>(functionRange);
        std::pair<unsigned, unsigned> key { start, end };
        if (syntheticFunctionRanges.contains(key) && !sameSourceFunctionRanges.contains(key))
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
