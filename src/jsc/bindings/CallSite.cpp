/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#include "config.h"
#include "CallSite.h"
#include "ErrorStackFrame.h"

#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/CodeBlock.h"
#include "helpers.h"
#include "wtf/text/OrdinalNumber.h"

#include <JavaScriptCore/JSCInlines.h>

using namespace JSC;
using namespace WebCore;

namespace Zig {

const JSC::ClassInfo CallSite::s_info = { "CallSite"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(CallSite) };

static JSC::JSFunction* calleeFunction(JSC::JSCell* callee)
{
    return callee ? dynamicDowncast<JSC::JSFunction>(callee) : nullptr;
}

static bool isUserFunction(JSC::JSCell* callee)
{
    auto* function = calleeFunction(callee);
    if (!function || function->isHostFunction() || function->isBuiltinFunction()) {
        return false;
    }

    // A generator or async body function takes JSC-internal arguments: a call from JS corrupts memory.
    return !JSC::isGeneratorOrAsyncFunctionBodyParseMode(function->jsExecutable()->parseMode());
}

static bool isEvalFrame(const ZigStackFrame& record, JSC::CodeBlock* codeBlock)
{
    if (record.code_type == ZigStackFrameCodeEval)
        return true;
    if (!codeBlock)
        return false;
    auto* executable = codeBlock->ownerExecutable();
    if (!executable)
        return false;
    switch (executable->evalContextType()) {
    case JSC::EvalContextType::None:
        return false;
    case JSC::EvalContextType::FunctionEvalContext:
    case JSC::EvalContextType::InstanceFieldEvalContext:
        return true;
    }
    return false;
}

void CallSite::finishCreation(VM& vm, const JSC::StackFrame& stackFrame, const ZigStackFrame& record, bool encounteredStrictFrame)
{
    Base::finishCreation(vm);

    /* From v8's "Stack Trace API" (https://github.com/v8/v8/wiki/Stack-Trace-API):
     * "To maintain restrictions imposed on strict mode functions, frames that have a
     * strict mode function and all frames below (its caller etc.) are not allow to access
     * their receiver and function objects. For those frames, getFunction() and getThis()
     * will return undefined.".
     * Thus, if we've already encountered a strict frame, we'll treat our frame as strict too. */

    JSC::JSCell* callee = stackFrame.callee();
    // A builtin's code block stays hidden: JSC's builtins are all strict, and their strictness must not
    // cascade to the user frames below [].map(callback).
    JSC::CodeBlock* codeBlock = record.kind == ZigStackFrameKindScript ? stackFrame.codeBlock() : nullptr;
    bool isStrictFrame = encounteredStrictFrame;
    if (!isStrictFrame && codeBlock) {
        isStrictFrame = codeBlock->ownerExecutable()->isInStrictContext();
    }

    // JSC::StackFrame has no receiver, so getThis() is always undefined.
    m_thisValue.set(vm, this, JSC::jsUndefined());
    if (isStrictFrame) {
        m_flags |= static_cast<unsigned int>(Flags::IsStrict);
    }
    // Hiding a callee must not set IsStrict: that cascades to the callers, and JSC shows host frames that V8 omits.
    if (isStrictFrame || !isUserFunction(callee)) {
        m_function.set(vm, this, JSC::jsUndefined());
    } else {
        m_function.set(vm, this, callee);
    }
    // isToplevel() needs the real callee: m_function is undefined when the callee is hidden.
    if (!isStrictFrame) {
        auto* function = calleeFunction(callee);
        if (function && !function->isHostFunction()) {
            m_flags |= static_cast<unsigned int>(Flags::IsSloppyFunctionCall);
        }
    }

    m_functionName.set(vm, this, jsString(vm, record.function_name.toWTFString(BunString::ZeroCopy)));
    m_sourceURL.set(vm, this, jsString(vm, record.source_url.toWTFString(BunString::ZeroCopy)));
    m_sourceID = codeBlock ? codeBlock->ownerExecutable()->sourceID() : JSC::noSourceID;

    if (record.hasPosition()) {
        m_lineNumber = OrdinalNumber::fromZeroBasedInt(record.position.line_zero_based);
        m_columnNumber = OrdinalNumber::fromZeroBasedInt(record.position.column_zero_based);
    }

    if (isEvalFrame(record, codeBlock)) {
        m_flags |= static_cast<unsigned int>(Flags::IsEval);
    } else if (record.code_type == ZigStackFrameCodeFunction || record.code_type == ZigStackFrameCodeConstructor) {
        m_flags |= static_cast<unsigned int>(Flags::IsFunction);
    }
    if (record.code_type == ZigStackFrameCodeConstructor) {
        m_flags |= static_cast<unsigned int>(Flags::IsConstructor);
    }
    switch (record.kind) {
    case ZigStackFrameKindHost:
        m_flags |= static_cast<unsigned int>(Flags::IsNative);
        break;
    case ZigStackFrameKindBuiltin:
        m_flags |= static_cast<unsigned int>(Flags::IsNative) | static_cast<unsigned int>(Flags::IsBuiltin);
        break;
    case ZigStackFrameKindWasm:
        m_flags |= static_cast<unsigned int>(Flags::IsNative) | static_cast<unsigned int>(Flags::IsWasm);
        break;
    default:
        break;
    }
    if (record.is_async) {
        m_flags |= static_cast<unsigned int>(Flags::IsAsync);
    }
}

template<typename Visitor>
void CallSite::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    CallSite* thisCallSite = uncheckedDowncast<CallSite>(cell);
    Base::visitChildren(thisCallSite, visitor);
    visitor.append(thisCallSite->m_thisValue);
    visitor.append(thisCallSite->m_function);
    visitor.append(thisCallSite->m_functionName);
    visitor.append(thisCallSite->m_sourceURL);
}
JSC_DEFINE_HOST_FUNCTION(nativeFrameForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::JSFunction* function = uncheckedDowncast<JSC::JSFunction>(callFrame->argument(0));
    return JSValue::encode(JSC::call(globalObject, function, JSC::ArgList(), "nativeFrameForTesting"_s));
}

JSValue createNativeFrameForTesting(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();

    return JSC::JSFunction::create(vm, globalObject, 1, "nativeFrameForTesting"_s, nativeFrameForTesting, ImplementationVisibility::Public);
}

JSC::JSString* CallSite::fileName(JSC::VM& vm) const
{
    JSC::JSValue sourceURL = m_sourceURL.get();
    if (sourceURL.isString() && asString(sourceURL)->length() > 0)
        return asString(sourceURL);
    if (isWasm())
        return jsNontrivialString(vm, "[wasm code]"_s);
    if (isNative() && !isBuiltin())
        return jsNontrivialString(vm, "[native code]"_s);
    if (m_sourceID == JSC::noSourceID)
        return jsNontrivialString(vm, "[unknown]"_s);
    // The 'bindings' package finds the calling module through Error.prepareStackTrace. A frame with
    // no URL needs a name that tells it apart from the others.
    return jsNontrivialString(vm, makeString("[source:"_s, m_sourceID, ']'));
}

void CallSite::formatAsString(JSC::VM& vm, JSC::JSGlobalObject* globalObject, WTF::StringBuilder& sb)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    WTF::String functionName;
    if (JSC::JSValue name = m_functionName.get(); name.isString()) {
        functionName = asString(name)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, );
    }
    WTF::String sourceURL;
    if (JSC::JSValue url = m_sourceURL.get(); url.isString()) {
        sourceURL = asString(url)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, );
    }

    Bun::OwnedZigStackFrames records(1);
    ZigStackFrame& record = records[0];
    record.function_name = Bun::toStringRef(functionName);
    record.source_url = Bun::toStringRef(sourceURL);
    record.is_async = isAsync();
    if (isWasm())
        record.kind = ZigStackFrameKindWasm;
    else if (isBuiltin())
        record.kind = ZigStackFrameKindBuiltin;
    else if (isNative())
        record.kind = ZigStackFrameKindHost;
    if (isConstructor())
        record.code_type = ZigStackFrameCodeConstructor;
    else if (isEval())
        record.code_type = ZigStackFrameCodeEval;
    else if (m_flags & static_cast<unsigned int>(Flags::IsFunction))
        record.code_type = ZigStackFrameCodeFunction;
    if (m_lineNumber.zeroBasedInt() >= 0) {
        record.position.line_zero_based = m_lineNumber.zeroBasedInt();
        record.position.column_zero_based = std::max(m_columnNumber.zeroBasedInt(), 0);
    }

    Bun::appendStackFrame(sb, record);
}

DEFINE_VISIT_CHILDREN(CallSite);
}
