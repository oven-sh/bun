#include "root.h"
#include "JavaScriptCore/CodeBlock.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "wtf/Assertions.h"
#include "wtf/text/OrdinalNumber.h"

namespace Bun {
using namespace JSC;

/// Adjust a `ZigStackFramePosition` by a number of code units. This accounts for when the adjustment
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
        auto* provider = code->sourceProvider();
        if (!provider) {
            pos.line_zero_based = 0;
            pos.column_zero_based = 0;
            pos.byte_position = 0;
            return;
        }

        auto source = provider->source();
        unsigned length = source.length();

        for (int i = 0; i < amount; i++) {
            // byte_position equals the source length when the callee ends at the end of the source.
            unsigned index = pos.byte_position - i;
            if (index < length && source[index] == '\n') {
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
    auto expr = code->expressionRangeForBytecodeIndex(bc);
    // Expression info has offsets only. The provider derives the line and the column from the divot.
    auto lineColumn = code->sourceProvider()->documentLineColumnForOffset(expr.divot);

    ZigStackFramePosition pos {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt(),
        .byte_position = (int)expr.divot,
    };

    // The divot by default is pointing at the `(` or the end of the class name.
    // Like V8, we want to point at the `new` keyword, which is conveniently at the
    // expression start.
    if (code->constructsAt(bc))
        adjustPositionBackwards(pos, expr.divot - expr.start, code);

    return pos;
}

} // namespace Bun
