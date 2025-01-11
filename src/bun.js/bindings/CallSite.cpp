/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#include "config.h"
#include "CallSite.h"

#include "JavaScriptCore/CallData.h"
#include "helpers.h"
#include "wtf/text/OrdinalNumber.h"

#include <JavaScriptCore/JSCInlines.h>
#include <optional>

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
    JSC::CodeBlock* codeBlock = stackFrame.codeBlock();
    if (!isStrictFrame) {
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
    } else if (stackFrame.isFunctionOrEval()) {
        m_flags |= static_cast<unsigned int>(Flags::IsFunction);
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

    return JSValue::encode(JSC::call(globalObject, function, JSC::ArgList(), "nativeFrameForTesting"_s));
}

JSValue createNativeFrameForTesting(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();

    return JSC::JSFunction::create(vm, globalObject, 1, "nativeFrameForTesting"_s, nativeFrameForTesting, ImplementationVisibility::Public);
}

void CallSite::formatAsString(JSC::VM& vm, JSC::JSGlobalObject* globalObject, WTF::StringBuilder& sb)
{
    JSValue thisValue = jsUndefined();
    if (m_thisValue) {
        thisValue = m_thisValue.get();
    }

    JSString* myFunctionName = functionName().toStringOrNull(globalObject);
    JSString* mySourceURL = sourceURL().toStringOrNull(globalObject);

    String functionName;
    if (myFunctionName && myFunctionName->length() > 0) {
        functionName = myFunctionName->getString(globalObject);
    } else if (m_flags & (static_cast<unsigned int>(Flags::IsFunction) | static_cast<unsigned int>(Flags::IsEval))) {
        functionName = "<anonymous>"_s;
    }

    std::optional<OrdinalNumber> column = columnNumber().zeroBasedInt() >= 0 ? std::optional(columnNumber()) : std::nullopt;
    std::optional<OrdinalNumber> line = lineNumber().zeroBasedInt() >= 0 ? std::optional(lineNumber()) : std::nullopt;

    if (functionName.length() > 0) {

        if (isConstructor()) {
            sb.append("new "_s);
        }

        if (auto* object = thisValue.getObject()) {
            auto catchScope = DECLARE_CATCH_SCOPE(vm);
            auto className = object->calculatedClassName(object);
            if (catchScope.exception()) {
                catchScope.clearException();
            }

            if (className.length() > 0) {
                sb.append(className);
                sb.append("."_s);
            }
        }

        sb.append(functionName);
    }

    if (isNative()) {
        if (functionName.length() > 0) {
            sb.append(" ("_s);
        }
        sb.append("native"_s);
        if (functionName.length() > 0) {
            sb.append(")"_s);
        }
    } else {
        if (functionName.length() > 0) {
            sb.append(" ("_s);
        }
        if (!mySourceURL || mySourceURL->length() == 0) {
            sb.append("unknown"_s);
        } else {
            sb.append(mySourceURL->getString(globalObject));
        }

        if (line && column) {
            sb.append(':');
            sb.append(line.value().oneBasedInt());
            sb.append(':');
            sb.append(column.value().oneBasedInt());
        } else if (line) {
            sb.append(':');
            sb.append(line.value().oneBasedInt());
        }

        if (functionName.length() > 0) {
            sb.append(')');
        }
    }
}

DEFINE_VISIT_CHILDREN(CallSite);
}
