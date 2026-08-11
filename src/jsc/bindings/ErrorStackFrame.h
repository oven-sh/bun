#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"

namespace JSC {
class CodeBlock;
class StackFrame;
}

namespace Bun {

/// Position of the bytecode at `bc` where V8 would report it (`new X(...)` at `new`), with its source offset.
ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

/// Line and column of the above only (byte_position is -1); cheap for frames that are not at a construct.
ZigStackFramePosition getAdjustedLineColumnForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

/// The two above for a captured frame; -1 in every field (an invalid position) without a code block.
ZigStackFramePosition getAdjustedPositionForStackFrame(const JSC::StackFrame& frame);
ZigStackFramePosition getAdjustedLineColumnForStackFrame(const JSC::StackFrame& frame);

} // namespace Bun
