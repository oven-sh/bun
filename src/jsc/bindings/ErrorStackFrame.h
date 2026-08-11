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
ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

/// Same for a captured frame. Frames without a code block get -1 in every field (invalid position).
ZigStackFramePosition getAdjustedPositionForStackFrame(const JSC::StackFrame& frame);

} // namespace Bun
