/*
 * Copyright (C) 2024 Jarred Sumner. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "root.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSObject.h"

namespace JSC {
class VM;
class JSGlobalObject;
class StackFrame;
class ErrorInstance;
class CallFrame;
enum class PropertyAttribute : unsigned;
} // namespace JSC

namespace WTF {
class String;
class OrdinalNumber;
} // namespace WTF

namespace Zig {
class GlobalObject;
class JSCStackTrace;
} // namespace Zig

using JSC::EncodedJSValue;
using JSC::PropertyName;

namespace Bun {

// Constants
constexpr size_t DEFAULT_ERROR_STACK_TRACE_LIMIT = 10;

// Main stack trace formatting function
WTF::String formatStackTrace(
    JSC::VM& vm,
    Zig::GlobalObject* globalObject,
    JSC::JSGlobalObject* lexicalGlobalObject,
    const WTF::String& name,
    const WTF::String& message,
    WTF::OrdinalNumber& line,
    WTF::OrdinalNumber& column,
    WTF::String& sourceURL,
    WTF::Vector<JSC::StackFrame>& stackTrace,
    JSC::JSObject* errorInstance);

// JSC Host Functions - Error constructor methods
JSC_DECLARE_HOST_FUNCTION(errorConstructorFuncCaptureStackTrace);
JSC_DECLARE_HOST_FUNCTION(errorConstructorFuncAppendStackTrace);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDefaultErrorPrepareStackTrace);

// JSC Custom Accessors - error.stack getter/setter
JSC_DECLARE_CUSTOM_GETTER(errorInstanceLazyStackCustomGetter);
JSC_DECLARE_CUSTOM_SETTER(errorInstanceLazyStackCustomSetter);

// Internal wrapper functions for JSC error info callbacks
WTF::String computeErrorInfoWrapperToString(JSC::VM& vm, WTF::Vector<JSC::StackFrame>& stackTrace, unsigned int& line_in, unsigned int& column_in, WTF::String& sourceURL, void* bunErrorData);
JSC::JSValue computeErrorInfoWrapperToJSValue(JSC::VM& vm, WTF::Vector<JSC::StackFrame>& stackTrace, unsigned int& line_in, unsigned int& column_in, WTF::String& sourceURL, JSC::JSObject* errorInstance, void* bunErrorData);
void computeLineColumnWithSourcemap(JSC::VM& vm, JSC::SourceProvider* _Nonnull sourceProvider, JSC::LineColumn& lineColumn);
} // namespace Bun

namespace Zig {

// GlobalObject member function for creating CallSite objects
void createCallSitesFromFrames(
    Zig::GlobalObject* globalObject,
    JSC::JSGlobalObject* lexicalGlobalObject,
    Zig::JSCStackTrace& stackTrace,
    JSC::MarkedArgumentBuffer& callSites);

} // namespace Zig
