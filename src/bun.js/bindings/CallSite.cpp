/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#include "config.h"
#include "CallSite.h"

#include "helpers.h"

#include <JavaScriptCore/JSCInlines.h>

using namespace JSC;
using namespace WebCore;

namespace Zig {

const JSC::ClassInfo CallSite::s_info = { "CallSite"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(CallSite) };

void CallSite::finishCreation(VM& vm, JSC::JSGlobalObject* globalObject, JSCStackFrame& stackFrame, bool encounteredStrictFrame)
{
    Base::finishCreation(vm);

    /* From v8's "Stack Trace API" (https://github.com/v8/v8/wiki/Stack-Trace-API):
     * "To maintain restrictions imposed on strict mode functions, frames that have a
     * strict mode function and all frames below (its caller etc.) are not allow to access
     * their receiver and function objects. For those frames, getFunction() and getThis()
     * will return undefined.".
     * Thus, if we've already encountered a strict frame, we'll treat our frame as strict too. */

    bool isStrictFrame = encounteredStrictFrame;
    if (!isStrictFrame) {
        JSC::CodeBlock* codeBlock = stackFrame.codeBlock();
        if (codeBlock) {
            isStrictFrame = codeBlock->ownerExecutable()->isInStrictContext();
        }
    }

    // Initialize "this" and "function" (and set the "IsStrict" flag if needed)
    JSC::CallFrame* callFrame = stackFrame.callFrame();
    if (isStrictFrame) {
        m_thisValue.set(vm, this, JSC::jsUndefined());
        m_function.set(vm, this, JSC::jsUndefined());
        m_flags |= static_cast<unsigned int>(Flags::IsStrict);
    } else {
        if (callFrame && callFrame->thisValue()) {
            // We know that we're not in strict mode
            m_thisValue.set(vm, this, callFrame->thisValue().toThis(globalObject, JSC::ECMAMode::sloppy()));
        } else {
            m_thisValue.set(vm, this, JSC::jsUndefined());
        }

        m_function.set(vm, this, stackFrame.callee());
    }

    m_functionName.set(vm, this, stackFrame.functionName());
    m_sourceURL.set(vm, this, stackFrame.sourceURL());

    const auto* sourcePositions = stackFrame.getSourcePositions();
    if (sourcePositions) {
        m_lineNumber = sourcePositions->line;
        m_columnNumber = sourcePositions->column;
    }

    if (stackFrame.isEval()) {
        m_flags |= static_cast<unsigned int>(Flags::IsEval);
    }
    if (stackFrame.isConstructor()) {
        m_flags |= static_cast<unsigned int>(Flags::IsConstructor);
    }
    if (!stackFrame.codeBlock()) {
        m_flags |= static_cast<unsigned int>(Flags::IsNative);
    }
}

template<typename Visitor>
void CallSite::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    CallSite* thisCallSite = jsCast<CallSite*>(cell);
    Base::visitChildren(thisCallSite, visitor);
    visitor.append(thisCallSite->m_thisValue);
    visitor.append(thisCallSite->m_function);
    visitor.append(thisCallSite->m_functionName);
    visitor.append(thisCallSite->m_sourceURL);
}
JSC_DEFINE_HOST_FUNCTION(nativeFrameForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSFunction* function = jsCast<JSC::JSFunction*>(callFrame->argument(0));

    return JSValue::encode(
        JSC::call(globalObject, function, JSC::ArgList(), "nativeFrameForTesting"_s));
}

JSValue createNativeFrameForTesting(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();

    return JSC::JSFunction::create(vm, globalObject, 1, "nativeFrameForTesting"_s, nativeFrameForTesting, ImplementationVisibility::Public);
}

void CallSite::formatAsString(JSC::VM& vm, JSC::JSGlobalObject* globalObject, WTF::StringBuilder& sb)
{
    JSString* myFunctionName = functionName().toString(globalObject);
    JSString* mySourceURL = sourceURL().toString(globalObject);

    JSString* myColumnNumber = columnNumber().zeroBasedInt() >= 0 ? JSValue(columnNumber().oneBasedInt()).toString(globalObject) : jsEmptyString(vm);
    JSString* myLineNumber = lineNumber().zeroBasedInt() >= 0 ? JSValue(lineNumber().oneBasedInt()).toString(globalObject) : jsEmptyString(vm);

    bool myIsConstructor = isConstructor();

    if (myFunctionName->length() > 0) {
        if (myIsConstructor) {
            sb.append("new "_s);
        } else {
            // TODO: print type or class name if available
            // sb.append(myTypeName->getString(globalObject));
            // sb.append(" "_s);
        }
        sb.append(myFunctionName->getString(globalObject));
    } else {
        sb.append("<anonymous>"_s);
    }
    sb.append(" ("_s);
    if (isNative()) {
        sb.append("native"_s);
    } else {
        if (mySourceURL->length() == 0) {
            sb.append("unknown"_s);
        } else {
            sb.append(mySourceURL->getString(globalObject));
        }

        if (myLineNumber->length() > 0 && myColumnNumber->length() > 0) {
            sb.append(":"_s);
            sb.append(myLineNumber->getString(globalObject));
            sb.append(":"_s);
            sb.append(myColumnNumber->getString(globalObject));
        } else if (myLineNumber->length() > 0) {
            sb.append(":"_s);
            sb.append(myLineNumber->getString(globalObject));
        }
    }
    sb.append(")"_s);
}

DEFINE_VISIT_CHILDREN(CallSite);

}
