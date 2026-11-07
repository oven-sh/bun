#include "root.h"
#include "JavaScriptCore/CodeBlock.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "wtf/text/OrdinalNumber.h"

namespace Bun {
using namespace JSC;

ZigStackFramePosition getPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc)
{
    auto expr = code->expressionInfoForBytecodeIndex(bc);
    // Expression info has offsets only. The provider derives the line and the column from the divot.
    auto lineColumn = code->source().provider()->documentLineColumnForOffset(expr.divot);

    return {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt(),
        .byte_position = (int)expr.divot,
    };
}

} // namespace Bun
