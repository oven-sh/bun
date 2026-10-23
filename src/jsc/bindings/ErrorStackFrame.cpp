#include "root.h"
#include "ErrorStackFrame.h"
#include "ErrorStackTrace.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/WasmIndexOrName.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "wtf/Assertions.h"
#include "wtf/text/OrdinalNumber.h"
#include "wtf/text/StringBuilder.h"

namespace Bun {
using namespace JSC;

ZigStackFramePosition getAdjustedPositionForBytecode(JSC::CodeBlock* code, JSC::BytecodeIndex bc)
{
    auto expr = code->expressionInfoForBytecodeIndex(bc);
    unsigned offset = expr.divot;

    switch (code->instructionAt(bc)->opcodeID()) {
    case op_construct:
    case op_construct_varargs:
    case op_super_construct:
    case op_super_construct_varargs:
        // JavaScriptCore's divot for a construct is at the `(` or the end of the class name. V8 reports
        // the `new` keyword, which is the start of the expression. startOffset is relative to the divot.
        offset = expr.startOffset <= expr.divot ? expr.divot - expr.startOffset : 0;
        break;
    default:
        break;
    }

    // Expression info has offsets only. The provider derives the line and the column from an offset,
    // and does so on any thread: the collector formats the stack of an error it is about to lose.
    auto lineColumn = code->source().provider()->documentLineColumnForOffset(offset);
    return {
        .line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt(),
        .column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt(),
        .byte_position = static_cast<int32_t>(offset),
    };
}

void populateStackFrame(JSC::VM& vm, const JSC::StackFrame& frame, ZigStackFrame& record)
{
    record.is_async = frame.isAsyncFrame();

    if (frame.isWasmFrame()) {
        record.kind = ZigStackFrameKindWasm;
        record.code_type = ZigStackFrameCodeWasm;
        record.function_name = Bun::toStringRef(JSC::Wasm::makeString(frame.wasmFunctionIndexOrName()));
        return;
    }

    JSC::JSObject* callee = frame.callee() ? frame.callee()->getObject() : nullptr;
    JSC::CodeBlock* codeBlock = frame.codeBlock();

    if (!codeBlock) {
        record.kind = ZigStackFrameKindHost;
        record.code_type = ZigStackFrameCodeNone;
        if (callee)
            record.function_name = Bun::toStringRef(Zig::functionName(vm, callee));
        return;
    }

    WTF::String sourceURL = Zig::sourceURL(codeBlock);
    // A builtin with a source URL of its own (one bundled from a file) reads as a script.
    bool isBuiltin = sourceURL.isEmpty() && codeBlock->unlinkedCodeBlock()->isBuiltinFunction();
    record.kind = isBuiltin ? ZigStackFrameKindBuiltin : ZigStackFrameKindScript;
    if (!sourceURL.isEmpty())
        record.source_url = Bun::toStringRef(sourceURL);

    switch (codeBlock->codeType()) {
    case JSC::EvalCode:
        record.code_type = ZigStackFrameCodeEval;
        break;
    case JSC::ModuleCode:
        record.code_type = ZigStackFrameCodeModule;
        break;
    case JSC::GlobalCode:
        record.code_type = ZigStackFrameCodeGlobal;
        break;
    case JSC::FunctionCode:
        record.code_type = codeBlock->isConstructor() ? ZigStackFrameCodeConstructor : ZigStackFrameCodeFunction;
        break;
    }

    WTF::String functionName;
    // Module and global code have a callee too (a JSCallee): not a function to name the frame after.
    if (callee && record.code_type != ZigStackFrameCodeModule && record.code_type != ZigStackFrameCodeGlobal)
        functionName = Zig::functionName(vm, callee);
    if (functionName.isEmpty())
        functionName = Zig::functionName(vm, codeBlock);
    if (!functionName.isEmpty())
        record.function_name = Bun::toStringRef(functionName);

    if (!isBuiltin && frame.hasBytecodeIndex()) {
        record.position = getAdjustedPositionForBytecode(codeBlock, frame.bytecodeIndex());
        return;
    }

    // A release build compiles the builtins without positions of their own, so JavaScriptCore places
    // the frame where the builtin starts.
    if (frame.hasLineAndColumnInfo()) {
        auto lineColumn = frame.computeLineAndColumn();
        record.position.line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt();
        record.position.column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt();
        record.position.byte_position = -1;
    }
}

static void appendPosition(WTF::StringBuilder& sb, const ZigStackFrame& record)
{
    if (!record.hasPosition())
        return;
    sb.append(':');
    sb.append(OrdinalNumber::fromZeroBasedInt(record.position.line_zero_based).oneBasedInt());
    sb.append(':');
    sb.append(OrdinalNumber::fromZeroBasedInt(record.position.column_zero_based).oneBasedInt());
}

void appendStackFrame(WTF::StringBuilder& sb, const ZigStackFrame& record)
{
    bool hasName = !record.function_name.isEmpty();
    if (!hasName) {
        switch (record.code_type) {
        case ZigStackFrameCodeEval:
        case ZigStackFrameCodeFunction:
        case ZigStackFrameCodeConstructor:
            hasName = true;
            break;
        default:
            break;
        }
    }

    if (hasName) {
        if (record.is_async)
            sb.append("async "_s);
        if (record.code_type == ZigStackFrameCodeConstructor)
            sb.append("new "_s);
        if (record.function_name.isEmpty())
            sb.append("<anonymous>"_s);
        else
            record.function_name.appendToBuilder(sb);
        sb.append(" ("_s);
    }

    switch (record.kind) {
    case ZigStackFrameKindBuiltin:
        sb.append("native"_s);
        appendPosition(sb, record);
        break;
    case ZigStackFrameKindHost:
        sb.append("unknown"_s);
        break;
    case ZigStackFrameKindWasm:
        sb.append("[wasm code]"_s);
        break;
    default:
        if (record.source_url.isEmpty())
            sb.append("unknown"_s);
        else
            record.source_url.appendToBuilder(sb);
        appendPosition(sb, record);
        break;
    }

    if (hasName)
        sb.append(')');
}

} // namespace Bun
