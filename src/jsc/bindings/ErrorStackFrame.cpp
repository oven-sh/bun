#include "root.h"
#include "ErrorStackFrame.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/FunctionExecutable.h"
#include "JavaScriptCore/SourceProvider.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/UnlinkedFunctionExecutable.h"
#include "wtf/Assertions.h"
#include "wtf/text/OrdinalNumber.h"

namespace Bun {
using namespace JSC;

SourceCode defaultClassConstructorClassSource(ScriptExecutable* executable)
{
    auto* function = dynamicDowncast<FunctionExecutable>(executable);
    if (!function || !function->unlinkedExecutable()->isBuiltinDefaultClassConstructor())
        return {};
    return function->classSource();
}

static bool isLineTerminator(char16_t c)
{
    return c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029;
}

ZigStackFramePosition classSourceStartPosition(const SourceCode& classSource)
{
    auto* provider = classSource.provider();
    int start = classSource.startOffset();
    WTF::StringView source = provider->source();
    // node:vm lineOffset/columnOffset: JSC applies them (the column to the first line only) but clamps negative ones away; V8 does not.
    TextPosition providerStart = provider->startPosition();

    int line = classSource.firstLine().zeroBasedInt() + std::min(providerStart.m_line.zeroBasedInt(), 0);

    // startColumn() is only a fallback: on the first line of a lazily parsed function it counts from the function.
    int column = classSource.startColumn().zeroBasedInt();
    if (static_cast<unsigned>(start) <= source.length()) {
        int lineStart = start;
        while (lineStart > 0 && !isLineTerminator(source[lineStart - 1]))
            lineStart--;
        column = start - lineStart;
        if (lineStart == 0)
            column += providerStart.m_column.zeroBasedInt();
    }

    return ZigStackFramePosition {
        .line_zero_based = line,
        .column_zero_based = column,
        .byte_position = start,
    };
}

LineColumn computeLineAndColumn(const StackFrame& frame)
{
    auto* codeBlock = frame.codeBlock();
    auto classSource = codeBlock ? defaultClassConstructorClassSource(codeBlock->ownerExecutable()) : SourceCode();
    if (!classSource.isNull()) {
        auto position = classSourceStartPosition(classSource);
        return LineColumn {
            .line = static_cast<unsigned>(position.line().oneBasedInt()),
            .column = static_cast<unsigned>(position.column().oneBasedInt()),
        };
    }
    return frame.computeLineAndColumn();
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
    auto classSource = defaultClassConstructorClassSource(code->ownerExecutable());
    if (!classSource.isNull())
        return classSourceStartPosition(classSource);

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

} // namespace Bun
