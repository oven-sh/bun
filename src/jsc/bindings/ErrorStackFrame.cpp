#include "root.h"
#include "ErrorStackFrame.h"
#include "JavaScriptCore/CodeBlock.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "wtf/Assertions.h"
#include "wtf/text/OrdinalNumber.h"

namespace Bun {
using namespace JSC;

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
    auto offset = expr.divot;
    // Constructors point to `new`; other calls retain JSC's syntax location.
    if (isConstruct(code, bc))
        offset -= std::min(offset, expr.startOffset);

    auto lineColumn = code->source().provider()->documentLineColumnForOffset(offset);
    return {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt(),
        .byte_position = static_cast<int>(offset),
    };
}

ZigStackFramePosition getAdjustedLineColumnForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc)
{
    if (isConstruct(code, bc)) {
        auto position = getAdjustedPositionForBytecode(code, bc);
        position.byte_position = -1;
        return position;
    }

    // Keep JSC's cached lookup for frames that do not need an expression-range adjustment.
    auto lineColumn = code->lineColumnForBytecodeIndex(bc);
    return {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt(),
        .byte_position = -1,
    };
}

} // namespace Bun
