#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"

namespace JSC {
class StackFrame;
class VM;
}

namespace Bun {

ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

// Fills `record` from `frame`: its kind, code type, name, source URL and position. This is the one
// place that derives them, so `error.stack`, the default `Error.prepareStackTrace`, a `CallSite` and
// the error printer all describe a frame the same way. Safe on the collector thread: it allocates no
// JS cell and runs no script. A position that the frame does not have stays invalid (-1).
void populateStackFrame(JSC::VM&, const JSC::StackFrame&, ZigStackFrame& record);

// Appends one line of `error.stack` after its "    at ": `name (location)`, or the location alone when
// the frame has no name. The location is the source URL and position of a script frame, `native` and
// the position of a builtin, `unknown` for a host function, `[wasm code]` for a WebAssembly function.
void appendStackFrame(WTF::StringBuilder&, const ZigStackFrame& record);

} // namespace Bun
