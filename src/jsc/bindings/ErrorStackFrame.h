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

/// JSC::SourceCode counts from its start position clamped to line 1, column 1, so a source
/// created with a negative start (node:vm lineOffset / columnOffset below 0) reports physical
/// positions while its SourceProvider still carries the requested start. This adds back the part
/// JSC dropped, which is the position V8 reports for the same options. No-op for sources that
/// start at or after 1:1, i.e. everything that is not node:vm code.
void applyNegativeSourceStart(JSC::CodeBlock* code, int& lineZeroBased, int& columnZeroBased);

/// StackFrame::computeLineAndColumn() with applyNegativeSourceStart applied; byte_position is -1.
/// The frame must have a code block (StackFrame::hasLineAndColumnInfo()).
ZigStackFramePosition getLineColumnForStackFrame(const JSC::StackFrame& frame);

} // namespace Bun
