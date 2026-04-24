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

    // Collect byte-offset ranges of synthetic functions reachable from this source.
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
    // owner's. Collect those (start, end) pairs so we can drop them from the range
    // list returned to Bun's coverage reporter.
    HashSet<std::pair<unsigned, unsigned>> syntheticFunctionRanges;
    vm.heap.forEachCodeBlock([&](CodeBlock* codeBlock) {
        auto* owner = codeBlock->ownerExecutable();
        if (!owner || owner->sourceID() != sourceID)
            return;

        auto collect = [&](FunctionExecutable* fnExec) {
            if (!fnExec)
                return;
            if (fnExec->sourceID() == sourceID)
                return;
            auto* unlinked = fnExec->unlinkedExecutable();
            if (!unlinked)
                return;
            syntheticFunctionRanges.add({ unlinked->unlinkedFunctionStart(), unlinked->unlinkedFunctionEnd() });
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
        if (syntheticFunctionRanges.contains({ start, end }))
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
