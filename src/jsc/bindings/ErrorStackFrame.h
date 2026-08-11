#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"

namespace JSC {
class CodeBlock;
class StackFrame;
}

namespace Bun {

/// Position of the bytecode at `bc` where V8 would report it: `new X(...)` at `new`, not after `X`.
/// byte_position is that position's offset into the source, for cutting out source lines.
ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

/// The line and column of the above (byte_position is -1), cheaper for the frames that are not at a construct.
ZigStackFramePosition getAdjustedLineColumnForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

/// The two above for a captured frame. Frames without a code block get -1 in every field (invalid position).
ZigStackFramePosition getAdjustedPositionForStackFrame(const JSC::StackFrame& frame);
ZigStackFramePosition getAdjustedLineColumnForStackFrame(const JSC::StackFrame& frame);

} // namespace Bun
