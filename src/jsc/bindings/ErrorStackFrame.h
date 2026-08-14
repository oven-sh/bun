#pragma once

#include "root.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "JavaScriptCore/LineColumn.h"
#include "JavaScriptCore/SourceCode.h"

namespace JSC {
class CodeBlock;
class ScriptExecutable;
class StackFrame;
}

namespace Bun {

/// JSC compiles the constructor of a class that declares none from
/// BuiltinExecutables::defaultConstructorSourceCode(), a fixed one-line string with no URL, so that
/// executable's source() and bytecode positions only describe that string. For such an executable
/// this returns the SourceCode of the class itself (its file, starting at the `class` keyword), which
/// is where V8 reports these frames. Null for every other executable.
JSC::SourceCode defaultClassConstructorClassSource(JSC::ScriptExecutable* executable);

/// Position of the `class` keyword a class SourceCode starts at, in the same coordinates JSC reports
/// bytecode positions of that file in.
ZigStackFramePosition classSourceStartPosition(const JSC::SourceCode& classSource);

ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

/// frame.computeLineAndColumn(), except that a default class constructor frame is placed at its class.
JSC::LineColumn computeLineAndColumn(const JSC::StackFrame& frame);

} // namespace Bun
