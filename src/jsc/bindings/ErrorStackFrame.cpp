#include "root.h"
#include "ErrorStackFrame.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/StackFrame.h"
#include "wtf/Assertions.h"
#include "wtf/text/OrdinalNumber.h"

namespace Bun {
using namespace JSC;

void applyNegativeSourceStart(CodeBlock* code, int& lineZeroBased, int& columnZeroBased)
{
    auto* provider = code->source().provider();
    if (!provider)
        return;

    // Function code blocks share the provider of the program they were parsed from, so this is
    // the whole source's start even for a frame inside a function.
    TextPosition start = provider->startPosition();
    int startLine = start.m_line.zeroBasedInt();
    int startColumn = start.m_column.zeroBasedInt();

    // JSC only adds the start column to positions on the first physical line, which it reports
    // as the clamped start line.
    if (startColumn < 0 && lineZeroBased == std::max(startLine, 0))
        columnZeroBased += startColumn;
    if (startLine < 0)
        lineZeroBased += startLine;
}

/// Adjust a `ZigStackFramePosition` by a number of bytes. This accounts for when the adjustment
/// crosses line boundaries, and thus requires the source code in order to properly compute
/// the result.
void adjustPositionBackwards(ZigStackFramePosition& pos, int amount, CodeBlock* code)
{
    if (pos.byte_position - amount < 0) {
        pos.line_zero_based = 0;
        pos.column_zero_based = 0;
        pos.byte_position = 0;
        return;
    }

    pos.column_zero_based = pos.column_zero_based - amount;
    if (pos.column_zero_based < 0) {
        auto* provider = code->source().provider();
        if (!provider) {
            pos.line_zero_based = 0;
            pos.column_zero_based = 0;
            pos.byte_position = 0;
            return;
        }

        auto source = provider->source();
        if (!source.is8Bit()) {
            // Debug-only assertion
            // Bun does not yet use 16-bit sources anywhere. The transpiler ensures everything
            // fit's into latin1 / 8-bit strings for on-average lower memory usage.
            ASSERT_NOT_REACHED("16-bit source re-mapping is not implemented here.");

            pos.line_zero_based = 0;
            pos.column_zero_based = 0;
            pos.byte_position = 0;
            return;
        }

        for (int i = 0; i < amount; i++) {
            if (source[pos.byte_position - i] == '\n') {
                pos.line_zero_based = pos.line_zero_based - 1;
            }
        }

        int columns = 0;
        // Initial -1 to skip the newline that gets counted.
        int i = pos.byte_position - amount - 1;
        while (i > 0 && source[i] != '\n') {
            columns += 1;
            i -= 1;
        }
        pos.column_zero_based = columns;
    }

    pos.byte_position -= amount;
}

ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc)
{
    auto expr = code->expressionInfoForBytecodeIndex(bc);

    ZigStackFramePosition pos {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(expr.lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(expr.lineColumn.column).zeroBasedInt(),
        .byte_position = (int)expr.divot,
    };
    applyNegativeSourceStart(code, pos.line_zero_based, pos.column_zero_based);

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

ZigStackFramePosition getLineColumnForStackFrame(const StackFrame& frame)
{
    auto lineColumn = frame.computeLineAndColumn();
    ZigStackFramePosition pos {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt(),
        .byte_position = -1,
    };
    applyNegativeSourceStart(frame.codeBlock(), pos.line_zero_based, pos.column_zero_based);
    return pos;
}

} // namespace Bun
