#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"

namespace JSC {
class CodeBlock;
class StackFrame;
}

namespace Bun {

ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

/// Adds the negative part of the provider's start position (node:vm lineOffset / columnOffset < 0)
/// to a position reported by JSC, which counts from the start clamped to 1:1 (JSC::SourceCode).
/// No-op for every other source.
void applyNegativeSourceStart(JSC::CodeBlock* code, int& lineZeroBased, int& columnZeroBased);

/// StackFrame::computeLineAndColumn() of a frame with a code block, with the above applied.
ZigStackFramePosition getLineColumnForStackFrame(const JSC::StackFrame& frame);

} // namespace Bun
