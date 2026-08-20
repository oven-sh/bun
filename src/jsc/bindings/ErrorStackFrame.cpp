#include "root.h"
#include "ErrorStackFrame.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/StackFrame.h"
#include "wtf/text/OrdinalNumber.h"

namespace Bun {
using namespace JSC;

// The LineTerminator set JSC's lexer counts lines with (LF, CR, U+2028, U+2029).
static bool isLineTerminator(char16_t c)
{
    return c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029;
}

/// Moves the divot in `pos` back `amount` code units, recounting line/column when that crosses a line break.
static void adjustPositionBackwards(ZigStackFramePosition& pos, int amount, CodeBlock* code)
{
    if (amount <= 0 || pos.byte_position < amount)
        return;

    int start = pos.byte_position - amount;

    if (pos.column_zero_based >= amount) {
        pos.column_zero_based -= amount;
        pos.byte_position = start;
        return;
    }

    auto* provider = code->source().provider();
    if (!provider)
        return;

    // Untranspiled sources (eval, new Function, node:vm) can be 16-bit; indexing handles both.
    WTF::StringView source = provider->source();
    if (static_cast<unsigned>(pos.byte_position) > source.length())
        return;

    for (int i = start; i < pos.byte_position; i++) {
        if (!isLineTerminator(source[i]))
            continue;
        pos.line_zero_based--;
        if (source[i] == '\r' && i + 1 < pos.byte_position && source[i + 1] == '\n')
            i++;
    }

    int column = 0;
    int i = start - 1;
    for (; i >= 0 && !isLineTerminator(source[i]); i--)
        column++;
    // JSC's columns on the first line of a source include its start column (node:vm columnOffset).
    if (i < 0)
        column += provider->startPosition().m_column.zeroBasedInt();

    pos.column_zero_based = column;
    pos.byte_position = start;
}

// JavaScriptCore puts the divot of these at the `(` or the end of the callee; V8 reports the `new`.
static bool isConstruct(JSC::CodeBlock* code, JSC::BytecodeIndex bc)
{
    switch (code->instructionAt(bc)->opcodeID()) {
    case op_construct:
    case op_construct_varargs:
    case op_super_construct:
    case op_super_construct_varargs:
        return true;
    default:
        return false;
    }
}

ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc)
{
    auto expr = code->expressionInfoForBytecodeIndex(bc);

    ZigStackFramePosition pos {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(expr.lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(expr.lineColumn.column).zeroBasedInt(),
        .byte_position = (int)expr.divot,
    };

    if (isConstruct(code, bc))
        adjustPositionBackwards(pos, expr.startOffset, code);

    return pos;
}

ZigStackFramePosition getAdjustedLineColumnForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc)
{
    if (isConstruct(code, bc)) {
        auto pos = getAdjustedPositionForBytecode(code, bc);
        pos.byte_position = -1;
        return pos;
    }

    // Cached per bytecode index; expressionInfoForBytecodeIndex decodes a whole chapter every call.
    auto lineColumn = code->lineColumnForBytecodeIndex(bc);
    return ZigStackFramePosition {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt(),
        .byte_position = -1,
    };
}

static constexpr ZigStackFramePosition noPosition {
    .line_zero_based = -1,
    .column_zero_based = -1,
    .byte_position = -1,
};

ZigStackFramePosition getAdjustedPositionForStackFrame(const JSC::StackFrame& frame)
{
    if (!frame.hasLineAndColumnInfo() || !frame.hasBytecodeIndex())
        return noPosition;
    return getAdjustedPositionForBytecode(frame.codeBlock(), frame.bytecodeIndex());
}

ZigStackFramePosition getAdjustedLineColumnForStackFrame(const JSC::StackFrame& frame)
{
    if (!frame.hasLineAndColumnInfo() || !frame.hasBytecodeIndex())
        return noPosition;
    return getAdjustedLineColumnForBytecode(frame.codeBlock(), frame.bytecodeIndex());
}

} // namespace Bun
