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

// The one derivation of a frame's kind, code type, name, source URL and position, for error.stack,
// Error.prepareStackTrace, CallSite and the error printer. Safe on the collector thread.
void populateStackFrame(JSC::VM&, const JSC::StackFrame&, ZigStackFrame& record);

// The one serializer of a frame: what follows "    at " on a line of error.stack.
void appendStackFrame(WTF::StringBuilder&, const ZigStackFrame& record);

} // namespace Bun
