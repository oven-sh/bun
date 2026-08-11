#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"

namespace JSC {
class CodeBlock;
class StackFrame;
}

namespace Bun {

/// Source position of the bytecode at `bc`, moved to where V8 reports it
/// (`new X(...)` is reported at `new`, JSC's divot is at the end of `X`).
ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

/// Same for a captured stack frame. Frames without a code block (native, wasm) get a position
/// with every field set to -1, which Bun__remapStackFramePositions skips.
ZigStackFramePosition getAdjustedPositionForStackFrame(const JSC::StackFrame& frame);

} // namespace Bun
