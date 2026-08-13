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

/// Re-adds the part of a negative node:vm lineOffset / columnOffset that JSC::SourceCode clamps away; no-op for other sources.
void applyNegativeSourceStart(JSC::CodeBlock* code, int& lineZeroBased, int& columnZeroBased);

/// StackFrame::computeLineAndColumn() of a frame with a code block, with the above applied.
ZigStackFramePosition getLineColumnForStackFrame(const JSC::StackFrame& frame);

} // namespace Bun
