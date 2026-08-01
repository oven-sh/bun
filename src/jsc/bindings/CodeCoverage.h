#pragma once

#include "root.h"
#include <JavaScriptCore/ControlFlowProfiler.h>

namespace Bun {

// JSC records a default class constructor's (unlinkedFunctionStart, unlinkedFunctionEnd)
// against the owner SourceID (CodeBlock::finishCreation) but clears it against the synthetic
// SourceID (UnlinkedFunctionExecutable::linkedSourceCode), so the owner entry stays
// !hasExecuted at (strlen("("), len-2) of BuiltinExecutables::defaultConstructorSourceCode().
constexpr bool isPhantomDefaultConstructorRange(bool hasExecuted, int start, int end)
{
    constexpr int kStart = 1;
    constexpr int kBaseEnd = static_cast<int>(sizeof("(function () { })") - 1) - 2;
    constexpr int kDerivedEnd = static_cast<int>(sizeof("(function (...args) { super(...args); })") - 1) - 2;
    static_assert(kBaseEnd == 15 && kDerivedEnd == 38);
    return !hasExecuted && start == kStart && (end == kBaseEnd || end == kDerivedEnd);
}

void appendFunctionRangesForCoverage(Vector<JSC::BasicBlockRange>& basicBlocks, JSC::VM& vm, JSC::SourceID sourceID);

}
