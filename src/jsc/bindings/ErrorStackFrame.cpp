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

/// Moves `pos` (the divot of an expression) back `amount` code units, to the start of the
/// expression. When that crosses a line boundary the line and column have to be recounted from
/// the source text. If that is not possible, `pos` is left pointing at the divot.
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

    // eval, new Function and node:vm code is not transpiled, so unlike transpiled modules
    // its source can be 16-bit. StringView indexing handles both encodings.
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
    // Columns JSC reports on the first line of a source include the source's start column
    // (node:vm's columnOffset); the fast path above inherits that from the divot's column.
    if (i < 0)
        column += provider->startPosition().m_column.zeroBasedInt();

    pos.column_zero_based = column;
    pos.byte_position = start;
}

ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc)
{
    auto expr = code->expressionInfoForBytecodeIndex(bc);

    ZigStackFramePosition pos {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(expr.lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(expr.lineColumn.column).zeroBasedInt(),
        .byte_position = (int)expr.divot,
    };

    auto inst = code->instructionAt(bc);

    /// JavaScriptCore places error divots at different places than v8
    // Uncomment to debug this:
    // printf("lc = %d : %d (byte = %d)\n", pos.line.oneBasedInt(), pos.column.oneBasedInt(), expr.divot);
    // printf("off = %d : %d\n", expr.startOffset, expr.endOffset);
    // printf("name = %s\n", inst->name());

    switch (inst->opcodeID()) {
    case op_construct:
    case op_construct_varargs:
    case op_super_construct:
    case op_super_construct_varargs:
        // The divot by default is pointing at the `(` or the end of the class name.
        // We want to point at the `new` keyword, which is conveniently at the
        // expression start.
        adjustPositionBackwards(pos, expr.startOffset, code);
        break;

    default:
        break;
    }

    return pos;
}

ZigStackFramePosition getAdjustedPositionForStackFrame(const JSC::StackFrame& frame)
{
    if (!frame.hasLineAndColumnInfo() || !frame.hasBytecodeIndex()) {
        return ZigStackFramePosition {
            .line_zero_based = -1,
            .column_zero_based = -1,
            .byte_position = -1,
        };
    }

    return getAdjustedPositionForBytecode(frame.codeBlock(), frame.bytecodeIndex());
}

} // namespace Bun
