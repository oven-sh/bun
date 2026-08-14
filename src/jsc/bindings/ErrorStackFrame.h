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

/// The class whose constructor JSC synthesized because it declared none (that constructor's own
/// source() is the URL-less "(function () { })" template), or null for any other executable.
JSC::SourceCode defaultClassConstructorClassSource(JSC::ScriptExecutable* executable);

/// Position of the `class` keyword `classSource` starts at; frames of its default constructor go there, as in V8.
ZigStackFramePosition classSourceStartPosition(const JSC::SourceCode& classSource);

ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc);

/// frame.computeLineAndColumn(), with default class constructor frames placed at their class.
JSC::LineColumn computeLineAndColumn(const JSC::StackFrame& frame);

} // namespace Bun
