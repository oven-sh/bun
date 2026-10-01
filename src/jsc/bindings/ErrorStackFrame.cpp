#include "root.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/AOTFunction.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "wtf/Assertions.h"
#include "wtf/text/OrdinalNumber.h"

namespace Bun {
using namespace JSC;

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

        // The expression started on an earlier line, and the executable was built without the text that says which. It stays
        // where JSC put it.
        if (provider->hasNoText()) {
            pos.column_zero_based = pos.column_zero_based + amount;
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
    // Code that was compiled ahead of time may record its position in the executable's original sources, in which case none
    // of what follows is needed.
    if (auto function = JSC::AOT::FunctionRef::of(code)) {
        if (auto position = function.reportedPositionFor(bc, JSC::AOT::FunctionRef::OfConstruction::WhereItStarts)) {
            return ZigStackFramePosition {
                .line_zero_based = OrdinalNumber::fromOneBasedInt(position->lineColumn.line).zeroBasedInt(),
                .column_zero_based = OrdinalNumber::fromOneBasedInt(position->lineColumn.column).zeroBasedInt(),
                .byte_position = -1,
            };
        }
    }

    auto expr = code->expressionInfoForBytecodeIndex(bc);
    // Expression info has offsets only. The provider derives the line and the column from the divot.
    auto lineColumn = code->source().provider()->documentLineColumnForOffset(expr.divot);

    ZigStackFramePosition pos {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt(),
        .byte_position = (int)expr.divot,
    };

    /// JavaScriptCore places error divots at different places than v8
    // Uncomment to debug this:
    // printf("lc = %d : %d (byte = %d)\n", pos.line.oneBasedInt(), pos.column.oneBasedInt(), expr.divot);
    // printf("off = %d : %d\n", expr.startOffset, expr.endOffset);

    bool constructs = false;
    // Code that was compiled ahead of time may have no instructions to look at.
    if (auto function = JSC::AOT::FunctionRef::of(code))
        constructs = function.constructsAt(bc);
    else {
        switch (code->instructionAt(bc)->opcodeID()) {
        case op_construct:
        case op_construct_varargs:
        case op_super_construct:
        case op_super_construct_varargs:
            constructs = true;
            break;
        default:
            break;
        }
    }
    // The divot by default is pointing at the `(` or the end of the class name.
    // We want to point at the `new` keyword, which is conveniently at the
    // expression start.
    if (constructs)
        adjustPositionBackwards(pos, expr.startOffset, code);

    return pos;
}

} // namespace Bun
