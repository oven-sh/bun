#pragma once

#include "root.h"
#include <JavaScriptCore/ControlFlowProfiler.h>

namespace Bun {

// JSC records the constructor it synthesizes for a class without one in the defining file's
// function table (CodeBlock::finishCreation), with offsets into its own template string
// (BuiltinExecutables::defaultConstructorSourceCode), and never marks it executed because its
// code block is linked against the template (UnlinkedFunctionExecutable::linkedSourceCode).
constexpr bool isSynthesizedDefaultConstructorRange(bool hasExecuted, int start, int end)
{
    // The range starts at the `function` keyword and ends at the closing brace of the body.
    constexpr int functionKeyword = static_cast<int>(sizeof("(") - 1);
    constexpr int baseClosingBrace = static_cast<int>(sizeof("(function () { })") - sizeof("})"));
    constexpr int derivedClosingBrace = static_cast<int>(sizeof("(function (...args) { super(...args); })") - sizeof("})"));
    static_assert(functionKeyword == 1 && baseClosingBrace == 15 && derivedClosingBrace == 38);
    return !hasExecuted && start == functionKeyword && (end == baseClosingBrace || end == derivedClosingBrace);
}

// Appends every function range of `sourceID` to `basicBlocks` as a BasicBlockRange, except the
// synthesized default constructors above.
void appendFunctionRangesForCoverage(Vector<JSC::BasicBlockRange>& basicBlocks, JSC::VM& vm, JSC::SourceID sourceID);

}
