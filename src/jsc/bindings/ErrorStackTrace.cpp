/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#include "config.h"
#include "ErrorStackTrace.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/CodeType.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ExecutableBase.h"
#include "JavaScriptCore/JSType.h"
#include "wtf/text/OrdinalNumber.h"

#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/DebuggerPrimitives.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/NativeCallee.h>
#include <JavaScriptCore/Interpreter.h>
#include <wtf/IterationStatus.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/FunctionCodeBlock.h>

#include "ErrorStackFrame.h"

using namespace JSC;
using namespace WebCore;

namespace Zig {

static ImplementationVisibility getImplementationVisibility(JSC::CodeBlock* codeBlock)
{

    if (auto* executable = codeBlock->ownerExecutable()) {
        return executable->implementationVisibility();
    }

    return ImplementationVisibility::Public;
}

bool isImplementationVisibilityPrivate(JSC::StackVisitor& visitor)
{
    ImplementationVisibility implementationVisibility = [&]() -> ImplementationVisibility {
        if (visitor->callee().isCell()) {
            if (auto* callee = visitor->callee().asCell()) {
                if (auto* jsFunction = dynamicDowncast<JSFunction>(callee)) {
                    if (auto* executable = jsFunction->executable())
                        return executable->implementationVisibility();
                }
            }
        }

        if (auto* codeBlock = visitor->codeBlock()) {
            return getImplementationVisibility(codeBlock);
        }

#if ENABLE(WEBASSEMBLY)
        if (visitor->isNativeCalleeFrame())
            return visitor->callee().asNativeCallee()->implementationVisibility();
#endif

        return ImplementationVisibility::Public;
    }();

    return implementationVisibility != ImplementationVisibility::Public;
}

bool isImplementationVisibilityPrivate(const JSC::StackFrame& frame)
{
    ImplementationVisibility implementationVisibility = [&]() -> ImplementationVisibility {

#if ENABLE(WEBASSEMBLY)
        if (frame.isWasmFrame())
            return ImplementationVisibility::Public;
#endif

        if (auto* callee = frame.callee()) {
            if (auto* jsFunction = dynamicDowncast<JSFunction>(callee)) {
                if (auto* executable = jsFunction->executable())
                    return executable->implementationVisibility();
            }
        }

        if (auto* codeBlock = frame.codeBlock()) {
            return getImplementationVisibility(codeBlock);
        }

        return ImplementationVisibility::Public;
    }();

    return implementationVisibility != ImplementationVisibility::Public;
}

void JSCStackTrace::getFramesForCaller(JSC::VM& vm, JSC::CallFrame* callFrame, JSC::JSCell* owner, JSC::JSValue caller, WTF::Vector<JSC::StackFrame>& stackTrace, size_t stackTraceLimit)
{
    UNUSED_PARAM(callFrame);

    // Delegate to Interpreter::getStackTrace which includes async stack frames
    // (from the await chain via getAsyncStackTrace). The previous hand-rolled
    // StackVisitor::visit walk only collected synchronous frames.
    //
    // We always collect with framesToSkip=1 (to drop Error.captureStackTrace
    // itself) and without the caller argument, because Interpreter::getStackTrace's
    // built-in caller filtering skips entry-frame tracking during the skip phase,
    // which loses async frames when the caller is the innermost sync frame.
    // Instead we filter out frames up to and including the caller afterwards.
    //
    // Collect without a limit: stackTraceLimit must apply to visible frames
    // AFTER Bun's post-filter and AFTER caller removal, not to raw frames from
    // JSC. If the caller is deep, capping at stackTraceLimit here would collect
    // only frames that get removed, leaving an empty trace. Stack depth is
    // bounded by native stack size so this walk is still O(actual depth).
    WTF::Vector<JSC::StackFrame> rawFrames;
    vm.interpreter.getStackTrace(owner, rawFrames, 1, std::numeric_limits<size_t>::max());

    // JSC's getStackTrace uses StackVisitor::isImplementationVisibilityPrivate
    // which differs from Bun's helper — post-filter to keep behavior consistent
    // with new Error() stack formatting.
    stackTrace.reserveInitialCapacity(rawFrames.size());
    for (auto& frame : rawFrames) {
        if (!isImplementationVisibilityPrivate(frame))
            stackTrace.append(WTF::move(frame));
    }

    if (!caller.isObject()) {
        if (stackTrace.size() > stackTraceLimit)
            stackTrace.shrink(stackTraceLimit);
        return;
    }

    JSC::JSObject* callerObject = caller.getObject();
    WTF::String callerName = Zig::functionName(vm, callerObject);

    // Match V8: remove all frames up to and including the caller. If the caller
    // is not found anywhere in the sync portion of the stack, remove everything.
    // We match by cell identity first, then by name — name matching is needed
    // because a resumed async function's frame callee is the generator's `next`
    // function (a different cell) but Zig::functionName still reports the
    // original async function's name.
    size_t removeCount = stackTrace.size();
    for (size_t i = 0; i < stackTrace.size(); i++) {
        const auto& frame = stackTrace.at(i);
        if (frame.isAsyncFrame())
            break;
        if (frame.callee() == callerObject) {
            removeCount = i + 1;
            break;
        }
        if (!callerName.isEmpty()) {
            Bun::OwnedZigStackFrames record(1);
            Bun::populateStackFrame(vm, frame, record[0]);
            if (record[0].function_name.toWTFString(BunString::ZeroCopy) == callerName) {
                removeCount = i + 1;
                break;
            }
        }
    }

    if (removeCount > 0)
        stackTrace.removeAt(0, removeCount);

    if (stackTrace.size() > stackTraceLimit)
        stackTrace.shrink(stackTraceLimit);
}

String sourceURL(const JSC::SourceOrigin& origin)
{
    if (origin.isNull()) {
        return String();
    }

    return origin.string();
}

String sourceURL(JSC::SourceProvider* sourceProvider)
{
    if (!sourceProvider) [[unlikely]] {
        return String();
    }

    String url = sourceProvider->sourceURLDirective();
    if (!url.isEmpty()) {
        return url;
    }

    url = sourceProvider->sourceURL();
    if (!url.isEmpty()) {
        return url;
    }

    const auto& origin = sourceProvider->sourceOrigin();
    return sourceURL(origin);
}

String sourceURL(const JSC::SourceCode& sourceCode)
{
    return sourceURL(sourceCode.provider());
}

String sourceURL(JSC::CodeBlock& codeBlock)
{
    if (!codeBlock.ownerExecutable()) {
        return String();
    }

    const auto& source = codeBlock.source();
    return sourceURL(source);
}

String sourceURL(JSC::CodeBlock* codeBlock)
{
    if (!codeBlock) [[unlikely]] {
        return String();
    }

    return Zig::sourceURL(*codeBlock);
}

String sourceURL(JSC::StackVisitor& visitor)
{
    switch (visitor->codeType()) {
    case JSC::StackVisitor::Frame::Eval:
    case JSC::StackVisitor::Frame::Module:
    case JSC::StackVisitor::Frame::Function:
    case JSC::StackVisitor::Frame::Global: {
        return sourceURL(visitor->codeBlock());
    }
    case JSC::StackVisitor::Frame::Native:
        return "[native code]"_s;
    case JSC::StackVisitor::Frame::Wasm:
        return "[wasm code]"_s;
    }

    RELEASE_ASSERT_NOT_REACHED();
}

String functionName(JSC::VM& vm, JSC::CodeBlock* codeBlock)
{
    auto codeType = codeBlock->codeType();

    auto* executable = codeBlock->ownerExecutable();
    if (!executable) {
        return String();
    }

    if (codeType == JSC::FunctionCode) {
        return uncheckedDowncast<JSC::FunctionExecutable>(executable)->ecmaNameWithoutGC();
    }

    return String();
}

String functionName(JSC::VM& vm, JSC::JSObject* object)
{
    WTF::String functionName;
    auto jstype = object->type();
    if (jstype == JSC::ProxyObjectType) return {};

    // First try the "name" property, if it is a plain data property. This also names frames at the
    // end of a collection, where nothing may be allocated in the heap and no script may run, and a
    // stack must read the same whenever it is formatted, so nothing here or below does either.
    {
        unsigned attributes;
        PropertyOffset offset = object->structure()->getConcurrently(vm.propertyNames->name.impl(), attributes);
        if (offset != invalidOffset && !(attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue))) {
            JSValue functionNameValue = object->getDirect(offset);
            if (functionNameValue && functionNameValue.isString()) {
                auto name = asString(functionNameValue)->tryGetValueWithoutGC();
                if (!name->isEmpty())
                    return name;
            }
        }
    }

    {
        // Then try the "displayName" property (what this does internally)
        auto topExceptionScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        functionName = JSC::getCalculatedDisplayName(vm, object);
        if (topExceptionScope.exception()) [[unlikely]] {
            (void)topExceptionScope.tryClearException();
        }
    }

    {
        if (functionName.isEmpty()) {
            if (jstype == JSC::JSFunctionType) {
                auto* function = uncheckedDowncast<JSC::JSFunction>(object);
                functionName = function->nameWithoutGC(vm);
                if (functionName.isEmpty() && !function->isHostFunction()) {
                    functionName = function->jsExecutable()->ecmaNameWithoutGC();
                }
            } else if (jstype == JSC::InternalFunctionType) {
                functionName = uncheckedDowncast<JSC::InternalFunction>(object)->name();
            }
        }
    }

    return functionName;
}
}
