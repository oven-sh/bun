/**
 * This source code is licensed under the terms found in the LICENSE file in
 * node-jsc's root directory.
 */

#pragma once

#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/WasmIndexOrName.h>

#include "ZigGlobalObject.h"

using namespace JSC;
using namespace WebCore;

namespace Zig {

class JSCStackTrace {
public:
    static void getFramesForCaller(JSC::VM& vm, JSC::CallFrame* callFrame, JSC::JSCell* owner, JSC::JSValue caller, WTF::Vector<JSC::StackFrame>& stackTrace, size_t stackTraceLimit);
};

bool isImplementationVisibilityPrivate(JSC::StackVisitor& visitor);
bool isImplementationVisibilityPrivate(const JSC::StackFrame& frame);

String sourceURL(const JSC::SourceOrigin& origin);
String sourceURL(JSC::SourceProvider* sourceProvider);
String sourceURL(const JSC::SourceCode& sourceCode);
String sourceURL(JSC::CodeBlock* codeBlock);
String sourceURL(JSC::CodeBlock& codeBlock);
String sourceURL(JSC::StackVisitor& visitor);
String sourceURL(JSC::VM& vm, JSC::JSFunction* function);

String functionName(JSC::VM& vm, JSC::CodeBlock* codeBlock);
String functionName(JSC::VM& vm, JSC::JSObject* callee);

}
