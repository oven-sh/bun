/**
 * ZigException handling and error processing utilities.
 *
 * This file contains functions for converting JavaScript exceptions to ZigException,
 * processing stack traces, and collecting source lines.
 */
#include "root.h"

#include "JavaScriptCore/ErrorType.h"
#include "JavaScriptCore/TopExceptionScope.h"
#include "JavaScriptCore/Exception.h"
#include "ErrorCode+List.h"
#include "ErrorCode.h"
#include "JavaScriptCore/ThrowScope.h"

#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "headers.h"

#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"

#include "JavaScriptCore/BytecodeIndex.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/ErrorInstanceInlines.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/VM.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include "JavaScriptCore/JSObjectInlines.h"

#include "wtf/Assertions.h"
#include "wtf/text/OrdinalNumber.h"
#include "wtf/text/StringView.h"
#include "wtf/text/WTFString.h"
#include "wtf/text/StringToIntegerConversion.h"

#include "ErrorStackFrame.h"
#include "ErrorStackTrace.h"
#include "ObjectBindings.h"

#include <JavaScriptCore/VMInlines.h>
#include "wtf-bindings.h"

static WTF::StringView StringView_slice(WTF::StringView sv, unsigned start, unsigned end)
{
    return sv.substring(start, end - start);
}

using namespace JSC;
using namespace WebCore;

#define SYNTAX_ERROR_CODE 4

using Zig::FinalizerSafety;

static void populateStackFrameMetadata(JSC::VM& vm, JSC::JSGlobalObject* globalObject, const JSC::StackFrame& stackFrame, ZigStackFrame& frame, FinalizerSafety finalizerSafety)
{
    if (stackFrame.isWasmFrame()) {
        frame.code_type = ZigStackFrameCodeWasm;

        auto name = Zig::functionName(vm, globalObject, stackFrame, finalizerSafety, nullptr);
        if (!name.isEmpty()) {
            frame.function_name = Bun::toStringRef(name);
        }

        auto sourceURL = Zig::sourceURL(vm, stackFrame);
        if (sourceURL != "[wasm code]"_s) {
            // [wasm code] is a useless source URL, so we don't bother to set it.
            // It is the default value JSC returns.
            frame.source_url = Bun::toStringRef(sourceURL);
        }
        return;
    }

    auto sourceURL = Zig::sourceURL(vm, stackFrame);
    frame.source_url = Bun::toStringRef(sourceURL);
    auto m_codeBlock = stackFrame.codeBlock();
    if (m_codeBlock) {
        switch (m_codeBlock->codeType()) {
        case JSC::EvalCode: {
            frame.code_type = ZigStackFrameCodeEval;
            return;
        }
        case JSC::ModuleCode: {
            frame.code_type = ZigStackFrameCodeModule;
            return;
        }
        case JSC::GlobalCode: {
            frame.code_type = ZigStackFrameCodeGlobal;
            return;
        }
        case JSC::FunctionCode: {
            frame.code_type = !m_codeBlock->isConstructor() ? ZigStackFrameCodeFunction : ZigStackFrameCodeConstructor;
            break;
        }
        default:
            ASSERT_NOT_REACHED();
        }
    }

    WTF::String functionName;
    if (finalizerSafety == FinalizerSafety::MustNotTriggerGC) {
        // Use the safe overload that avoids property access
        functionName = Zig::functionName(vm, globalObject, stackFrame, finalizerSafety, nullptr);
    } else {
        // Use the richer callee-based path
        if (auto calleeCell = stackFrame.callee()) {
            if (auto* callee = calleeCell->getObject())
                functionName = Zig::functionName(vm, globalObject, callee);
        }
    }
    if (!functionName.isEmpty())
        frame.function_name = Bun::toStringRef(functionName);

    frame.is_async = stackFrame.isAsyncFrame();
}

static void populateStackFramePosition(const JSC::StackFrame& stackFrame, ZigStackFrame& frame)
{
    auto code = stackFrame.codeBlock();
    if (!code)
        return;

    auto* provider = code->source().provider();
    if (!provider) [[unlikely]]
        return;
    // Make sure the range is valid:
    // https://github.com/oven-sh/bun/issues/6951
    WTF::StringView sourceString = provider->source();
    if (sourceString.isNull()) [[unlikely]]
        return;

    if (!stackFrame.hasBytecodeIndex()) {
        if (stackFrame.hasLineAndColumnInfo()) {
            auto lineColumn = stackFrame.computeLineAndColumn();
            frame.position.line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt();
            frame.position.column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt();
        }

        frame.position.byte_position = -1;
        return;
    }

    auto location = Bun::getAdjustedPositionForBytecode(code, stackFrame.bytecodeIndex());
    memcpy(&frame.position, &location, sizeof(ZigStackFramePosition));

    // Pin the provider so the frame's source lines can be sliced out later
    // (collectSourceLines) without going back to JSC's weakly-held frames.
    provider->ref();
    if (frame.source_provider)
        frame.source_provider->deref();
    frame.source_provider = provider;
}

static void populateStackFrame(JSC::VM& vm, const JSC::StackFrame& stackFrame, ZigStackFrame& frame, JSC::JSGlobalObject* globalObject, FinalizerSafety finalizerSafety)
{
    populateStackFrameMetadata(vm, globalObject, stackFrame, frame, finalizerSafety);
    populateStackFramePosition(stackFrame, frame);
}

// Frame `topFrame`'s line and a few above it, for the source preview. Most of
// the time the printer reads the original file itself; this is the fallback
// for sources that only exist in memory (eval, builtins, blobs).
static void collectSourceLines(ZigStackTrace& trace, uint8_t topFrame)
{
    if (topFrame >= trace.frames_len || trace.source_lines_ptr == nullptr || trace.source_lines_to_collect <= 1)
        return;
    ZigStackFrame& top = trace.frames_ptr[topFrame];
    JSC::SourceProvider* provider = top.source_provider;
    if (!provider || top.position.byte_position < 0)
        return;
    WTF::StringView sourceString = provider->source();
    if (sourceString.isNull() || !sourceString.is8Bit() || static_cast<unsigned>(top.position.byte_position) >= sourceString.length())
        return;

    BunString* source_lines = trace.source_lines_ptr;
    OrdinalNumber* source_line_numbers = trace.source_lines_numbers;
    const uint8_t source_lines_count = trace.source_lines_to_collect;
    const OrdinalNumber line = top.position.line();
    const unsigned length = sourceString.length();
    const Latin1Character* bytes = sourceString.span8().data();

    // It is key to not clone this data because source code strings are large.
    // Usage of toStringView (non-owning) is safe as we ref the provider.
    provider->ref();
    if (trace.referenced_source_provider != nullptr) {
        trace.referenced_source_provider->deref();
    }
    trace.referenced_source_provider = provider;

    // The top frame's line…
    unsigned lineStart = top.position.byte_position;
    while (lineStart > 0 && bytes[lineStart - 1] != '\n')
        lineStart--;
    unsigned lineEnd = top.position.byte_position;
    while (lineEnd < length && bytes[lineEnd] != '\n')
        lineEnd++;
    source_lines[0] = Bun::toStringView(sourceString.substring(lineStart, lineEnd - lineStart));
    source_line_numbers[0] = line;

    // …and a few above it, since that is what you want to see in a stack trace.
    uint8_t i = 1;
    while (i < source_lines_count && lineStart > 0) {
        lineEnd = lineStart - 1; // the '\n' ending the line above
        lineStart = lineEnd;
        while (lineStart > 0 && bytes[lineStart - 1] != '\n')
            lineStart--;
        source_lines[i] = Bun::toStringView(sourceString.substring(lineStart, lineEnd - lineStart));
        source_line_numbers[i] = OrdinalNumber::fromZeroBasedInt(line.zeroBasedInt() - i);
        i++;
    }
}

class V8StackTraceIterator {
public:
    class StackFrame {
    public:
        StringView functionName {};
        StringView sourceURL {};
        WTF::OrdinalNumber lineNumber = WTF::OrdinalNumber::beforeFirst();
        WTF::OrdinalNumber columnNumber = WTF::OrdinalNumber::beforeFirst();

        bool isConstructor = false;
        bool isGlobalCode = false;
        bool isAsync = false;
    };

    WTF::StringView stack;
    unsigned int offset = 0;

    V8StackTraceIterator(WTF::StringView stack_)
        : stack(stack_)
    {
    }

    bool parseFrame(StackFrame& frame)
    {

        if (offset >= stack.length())
            return false;

        auto start = stack.find("\n    at "_s, offset);

        if (start == WTF::notFound) {
            offset = stack.length();
            return false;
        }

        start += 8;
        auto end = stack.find("\n"_s, start);

        if (end == WTF::notFound) {
            offset = stack.length();
            end = offset;
        }

        if (start >= end || start == WTF::notFound) {
            return false;
        }

        StringView line = stack.substring(start, end - start);
        offset = end;

        // the proper singular spelling is parenthesis
        auto openingParentheses = line.reverseFind('(');
        auto closingParentheses = line.reverseFind(')');

        if (openingParentheses > closingParentheses)
            openingParentheses = WTF::notFound;

        StringView functionName;
        StringView lineInner;
        if (openingParentheses == WTF::notFound || closingParentheses == WTF::notFound) {
            // `at <url>:<line>:<column>` — anonymous and top-level frames carry
            // no name and no parentheses (V8 and Bun both print them this way).
            lineInner = line;
            if (lineInner.startsWith("async "_s)) {
                frame.isAsync = true;
                lineInner = lineInner.substring(6);
            }
        } else {
            lineInner = StringView_slice(line, openingParentheses + 1, closingParentheses);
            if (openingParentheses > 0)
                functionName = line.substring(0, openingParentheses - 1);
        }

        {
            auto marker1 = 0;
            auto marker2 = lineInner.find(':', marker1);

            if (marker2 == WTF::notFound) {
                frame.sourceURL = lineInner;
                goto done_block;
            }

            auto marker3 = lineInner.find(':', marker2 + 1);
            if (marker3 == WTF::notFound) {
                // /path/to/file.js:
                // /path/to/file.js:1
                // node:child_process
                // C:\Users\chloe\bun\file.js

                marker3 = lineInner.length();

                auto segment1 = StringView_slice(lineInner, marker1, marker2);
                auto segment2 = StringView_slice(lineInner, marker2 + 1, marker3);

                if (auto int1 = WTF::parseIntegerAllowingTrailingJunk<unsigned int>(segment2)) {
                    frame.sourceURL = segment1;
                    frame.lineNumber = WTF::OrdinalNumber::fromOneBasedInt(int1.value());
                } else {
                    frame.sourceURL = StringView_slice(lineInner, marker1, marker3);
                }
                goto done_block;
            }

            // /path/to/file.js:1:
            // /path/to/file.js:1:2
            // node:child_process:1:2
            // C:\Users\chloe\bun\file.js:
            // C:\Users\chloe\bun\file.js:1
            // C:\Users\chloe\bun\file.js:1:2

            while (true) {
                auto newcolon = lineInner.find(':', marker3 + 1);
                if (newcolon == WTF::notFound)
                    break;
                marker2 = marker3;
                marker3 = newcolon;
            }

            auto marker4 = lineInner.length();

            auto segment1 = StringView_slice(lineInner, marker1, marker2);
            auto segment2 = StringView_slice(lineInner, marker2 + 1, marker3);
            auto segment3 = StringView_slice(lineInner, marker3 + 1, marker4);

            if (auto int1 = WTF::parseIntegerAllowingTrailingJunk<unsigned int>(segment2)) {
                if (auto int2 = WTF::parseIntegerAllowingTrailingJunk<unsigned int>(segment3)) {
                    frame.sourceURL = segment1;
                    frame.lineNumber = WTF::OrdinalNumber::fromOneBasedInt(int1.value());
                    frame.columnNumber = WTF::OrdinalNumber::fromOneBasedInt(int2.value());
                } else {
                    frame.sourceURL = segment1;
                    frame.lineNumber = WTF::OrdinalNumber::fromOneBasedInt(int1.value());
                }
            } else {
                if (auto int2 = WTF::parseIntegerAllowingTrailingJunk<unsigned int>(segment3)) {
                    frame.sourceURL = StringView_slice(lineInner, marker1, marker3);
                    frame.lineNumber = WTF::OrdinalNumber::fromOneBasedInt(int2.value());
                } else {
                    frame.sourceURL = StringView_slice(lineInner, marker1, marker4);
                }
            }
        }
    done_block:

        if (functionName == "global code"_s) {
            functionName = StringView();
            frame.isGlobalCode = true;
        }

        if (functionName.startsWith("async "_s)) {
            frame.isAsync = true;
            functionName = functionName.substring(6);
        }

        if (functionName.startsWith("new "_s)) {
            frame.isConstructor = true;
            functionName = functionName.substring(4);
        }

        frame.functionName = functionName;

        return true;
    }

    void forEachFrame(const WTF::Function<void(const V8StackTraceIterator::StackFrame&, bool&)> callback)
    {
        bool stop = false;
        while (!stop) {
            StackFrame frame;
            if (!parseFrame(frame))
                break;
            callback(frame, stop);
        }
    }
};

static void populateStackTrace(JSC::VM& vm, const WTF::Vector<JSC::StackFrame>& frames, ZigStackTrace& trace, JSC::JSGlobalObject* globalObject, FinalizerSafety finalizerSafety = FinalizerSafety::NotInFinalizer)
{
    uint8_t frame_i = 0;
    size_t stack_frame_i = 0;
    const size_t total_frame_count = frames.size();
    const uint8_t frame_count = total_frame_count < trace.frames_cap ? total_frame_count : trace.frames_cap;

    while (frame_i < frame_count && stack_frame_i < total_frame_count) {
        // Skip native frames
        while (stack_frame_i < total_frame_count && !(frames.at(stack_frame_i).hasLineAndColumnInfo()) && !(frames.at(stack_frame_i).isWasmFrame())) {
            stack_frame_i++;
        }
        if (stack_frame_i >= total_frame_count)
            break;

        populateStackFrame(vm, frames[stack_frame_i], trace.frames_ptr[frame_i], globalObject, finalizerSafety);
        stack_frame_i++;
        frame_i++;
    }
    trace.frames_len = frame_i;
}

static JSC::JSValue getNonObservable(JSC::VM& vm, JSC::JSGlobalObject* global, JSC::JSObject* obj, const JSC::PropertyName& propertyName)
{
    PropertySlot slot = PropertySlot(obj, PropertySlot::InternalMethodType::VMInquiry, &vm);
    if (obj->getNonIndexPropertySlot(global, propertyName, slot)) {
        if (slot.isAccessor()) {
            return {};
        }

        JSValue value = slot.getValue(global, propertyName);
        if (!value || value.isUndefinedOrNull()) {
            return {};
        }
        return value;
    }
    return {};
}

static void fromErrorInstance(ZigException& except, JSC::JSGlobalObject* global,
    JSC::ErrorInstance* err, const Vector<JSC::StackFrame>* stackTrace,
    JSC::JSValue val)
{
    JSC::JSObject* obj = dynamicDowncast<JSC::JSObject>(val);
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    if (stackTrace != nullptr && stackTrace->size() > 0) {
        populateStackTrace(vm, *stackTrace, except.stack, global);
    } else if (err->stackTrace() != nullptr && err->stackTrace()->size() > 0) {
        populateStackTrace(vm, *err->stackTrace(), except.stack, global, FinalizerSafety::MustNotTriggerGC);
    }
    except.type = (unsigned char)err->errorType();
    if (err->isStackOverflowError()) {
        except.type = 253;
    }
    if (err->isOutOfMemoryError()) {
        except.type = 8;
    }
    if (except.type == SYNTAX_ERROR_CODE) {
        except.message = Bun::toStringRef(err->sanitizedMessageString(global));

    } else if (JSC::JSValue message = obj->getIfPropertyExists(global, vm.propertyNames->message)) {
        except.message = Bun::toStringRef(global, message);
        if (!scope.clearExceptionExceptTermination()) [[unlikely]]
            return;
    } else {

        except.message = Bun::toStringRef(err->sanitizedMessageString(global));
    }

    if (!scope.clearExceptionExceptTermination()) [[unlikely]] {
        return;
    }

    except.name = Bun::toStringRef(err->sanitizedNameString(global));
    if (!scope.clearExceptionExceptTermination()) [[unlikely]] {
        return;
    }

    except.runtime_type = err->runtimeTypeForCause();

    const auto& names = builtinNames(vm);
    if (except.type != SYNTAX_ERROR_CODE) {

        JSC::JSValue syscall = getNonObservable(vm, global, obj, names.syscallPublicName());
        if (!scope.clearExceptionExceptTermination()) [[unlikely]]
            return;
        if (syscall) {
            if (syscall.isString()) {
                except.syscall = Bun::toStringRef(global, syscall);
                if (!scope.clearExceptionExceptTermination()) [[unlikely]]
                    return;
            }
        }

        JSC::JSValue code = getNonObservable(vm, global, obj, names.codePublicName());
        if (!scope.clearExceptionExceptTermination()) [[unlikely]]
            return;
        if (code) {
            if (code.isString() || code.isNumber()) {
                except.system_code = Bun::toStringRef(global, code);
                if (!scope.clearExceptionExceptTermination()) [[unlikely]]
                    return;
            }
        }

        JSC::JSValue path = getNonObservable(vm, global, obj, names.pathPublicName());
        if (!scope.clearExceptionExceptTermination()) [[unlikely]]
            return;
        if (path) {
            if (path.isString()) {
                except.path = Bun::toStringRef(global, path);
                if (!scope.clearExceptionExceptTermination()) [[unlikely]]
                    return;
            }
        }

        JSC::JSValue fd = getNonObservable(vm, global, obj, names.fdPublicName());
        if (!scope.clearExceptionExceptTermination()) [[unlikely]]
            return;
        if (fd) {
            if (fd.isNumber()) {
                except.fd = fd.toInt32(global);
            }
        }

        JSC::JSValue errno_ = getNonObservable(vm, global, obj, names.errnoPublicName());
        if (!scope.clearExceptionExceptTermination()) [[unlikely]]
            return;
        if (errno_) {
            if (errno_.isNumber()) {
                except.errno_ = errno_.toInt32(global);
            }
        }
    }

    if (except.stack.frames_len == 0) {
        // we don't want to serialize JSC::StackFrame longer than we need to
        // so in this case, we parse the stack trace as a string

        // This one intentionally calls getters.
        JSC::JSValue stackValue = obj->getIfPropertyExists(global, vm.propertyNames->stack);
        if (!scope.clearExceptionExceptTermination()) [[unlikely]]
            return;
        if (stackValue) {
            // Prevent infinite recursion if stack property is the error object itself
            if (stackValue == val) {
                return;
            }
            if (stackValue.isString()) {
                WTF::String stack = stackValue.toWTFString(global);
                if (!scope.clearExceptionExceptTermination()) [[unlikely]] {
                    return;
                }
                if (!stack.isEmpty()) {

                    V8StackTraceIterator iterator(stack);
                    const uint8_t frame_count = except.stack.frames_cap;

                    except.stack.frames_len = 0;

                    iterator.forEachFrame([&](const V8StackTraceIterator::StackFrame& frame, bool& stop) -> void {
                        ASSERT(except.stack.frames_len < frame_count);
                        // A frame that can't be located isn't worth a slot: no URL, the
                        // `unknown`/`native` placeholders populateStackTrace would have skipped
                        // as native frames, or a bare word with neither line nor path.
                        bool hasLine = frame.lineNumber.zeroBasedInt() >= 0;
                        bool urlIsPath = frame.sourceURL.find('/') != WTF::notFound || frame.sourceURL.find('\\') != WTF::notFound;
                        if (frame.sourceURL.isEmpty() || (!hasLine && (frame.sourceURL == "unknown"_s || frame.sourceURL == "native"_s || (frame.functionName.isEmpty() && !urlIsPath))))
                            return;
                        auto& current = except.stack.frames_ptr[except.stack.frames_len];
                        current = {};

                        String functionName = frame.functionName == "<anonymous>"_s ? String() : frame.functionName.toString();
                        String sourceURL = frame.sourceURL.toString();
                        current.function_name = Bun::toStringRef(functionName);
                        current.source_url = Bun::toStringRef(sourceURL);
                        current.position.line_zero_based = frame.lineNumber.zeroBasedInt();
                        current.position.column_zero_based = frame.columnNumber.zeroBasedInt();

                        current.remapped = true;
                        current.is_async = frame.isAsync;

                        if (frame.isConstructor) {
                            current.code_type = ZigStackFrameCodeConstructor;
                        } else if (frame.isGlobalCode) {
                            current.code_type = ZigStackFrameCodeGlobal;
                        } else if (!frame.functionName.isEmpty()) {
                            current.code_type = ZigStackFrameCodeFunction;
                        }

                        except.stack.frames_len += 1;

                        stop = except.stack.frames_len >= frame_count;
                    });

                    if (except.stack.frames_len > 0)
                        except.remapped = true;
                }
            }
        }
    }

    if (except.stack.frames_len == 0) {
        JSC::JSValue sourceURL = getNonObservable(vm, global, obj, vm.propertyNames->sourceURL);
        if (!scope.clearExceptionExceptTermination()) [[unlikely]]
            return;
        if (sourceURL) {
            if (sourceURL.isString()) {
                except.stack.frames_ptr[0].source_url.deref();
                except.stack.frames_ptr[0].source_url = Bun::toStringRef(global, sourceURL);
                if (!scope.clearExceptionExceptTermination()) [[unlikely]]
                    return;

                // Take care not to make these getter calls observable.

                JSC::JSValue column = getNonObservable(vm, global, obj, vm.propertyNames->column);
                if (!scope.clearExceptionExceptTermination()) [[unlikely]]
                    return;
                if (column) {
                    if (column.isNumber()) {
                        except.stack.frames_ptr[0].position.column_zero_based = OrdinalNumber::fromOneBasedInt(column.toInt32(global)).zeroBasedInt();
                    }
                }

                JSC::JSValue line = getNonObservable(vm, global, obj, vm.propertyNames->line);
                if (!scope.clearExceptionExceptTermination()) [[unlikely]]
                    return;
                if (line) {
                    if (line.isNumber()) {
                        except.stack.frames_ptr[0].position.line_zero_based = OrdinalNumber::fromOneBasedInt(line.toInt32(global)).zeroBasedInt();

                        JSC::JSValue lineText = getNonObservable(vm, global, obj, builtinNames(vm).lineTextPublicName());
                        if (!scope.clearExceptionExceptTermination()) [[unlikely]]
                            return;
                        if (lineText) {
                            if (lineText.isString()) {
                                if (JSC::JSString* jsStr = lineText.toStringOrNull(global)) {
                                    auto str = jsStr->value(global);
                                    except.stack.source_lines_ptr[0] = Bun::toStringRef(str);
                                    except.stack.source_lines_numbers[0] = except.stack.frames_ptr[0].position.line();
                                    except.stack.source_lines_len = 1;
                                    except.remapped = true;
                                }
                            }
                        }
                    }
                }
            }

            except.stack.frames_len = 1;
            PropertySlot slot = PropertySlot(obj, PropertySlot::InternalMethodType::VMInquiry, &vm);
            except.stack.frames_ptr[0].remapped = obj->getNonIndexPropertySlot(global, names.originalLinePublicName(), slot);
            if (!scope.clearExceptionExceptTermination()) [[unlikely]]
                return;
        }
    }
}

void exceptionFromString(ZigException& except, JSC::JSValue value, JSC::JSGlobalObject* global)
{
    auto& vm = JSC::getVM(global);
    if (vm.hasPendingTerminationException()) [[unlikely]] {
        return;
    }

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // Fallback case for when it's a user-defined ErrorLike-object that doesn't inherit from
    // ErrorInstance
    if (JSC::JSObject* obj = dynamicDowncast<JSC::JSObject>(value)) {
        auto name_value = obj->getIfPropertyExists(global, vm.propertyNames->name);
        if (scope.exception()) [[unlikely]] {
            scope.clearExceptionExceptTermination();
        }
        if (name_value) {
            if (name_value.isString()) {
                auto name_str = name_value.toWTFString(global);
                except.name = Bun::toStringRef(name_str);
                if (name_str == "Error"_s) {
                    except.type = JSErrorCodeError;
                } else if (name_str == "EvalError"_s) {
                    except.type = JSErrorCodeEvalError;
                } else if (name_str == "RangeError"_s) {
                    except.type = JSErrorCodeRangeError;
                } else if (name_str == "ReferenceError"_s) {
                    except.type = JSErrorCodeReferenceError;
                } else if (name_str == "SyntaxError"_s) {
                    except.type = JSErrorCodeSyntaxError;
                } else if (name_str == "TypeError"_s) {
                    except.type = JSErrorCodeTypeError;
                } else if (name_str == "URIError"_s) {
                    except.type = JSErrorCodeURIError;
                } else if (name_str == "AggregateError"_s) {
                    except.type = JSErrorCodeAggregateError;
                }
            }
        }

        auto message = obj->getIfPropertyExists(global, vm.propertyNames->message);
        if (scope.exception()) [[unlikely]] {
            scope.clearExceptionExceptTermination();
        }
        if (message) {
            if (message.isString()) {
                except.message = Bun::toStringRef(message.toWTFString(global));
            }
        }

        if (except.stack.frames_len == 0) {
            auto sourceURL = obj->getIfPropertyExists(global, vm.propertyNames->sourceURL);
            if (scope.exception()) [[unlikely]] {
                scope.clearExceptionExceptTermination();
            }
            if (sourceURL) {
                if (sourceURL.isString()) {
                    except.stack.frames_ptr[0].source_url = Bun::toStringRef(sourceURL.toWTFString(global));
                    except.stack.frames_len = 1;
                }
            }

            if (scope.exception()) [[unlikely]] {
                scope.clearExceptionExceptTermination();
            }

            auto line = obj->getIfPropertyExists(global, vm.propertyNames->line);
            if (scope.exception()) [[unlikely]] {
                scope.clearExceptionExceptTermination();
            }
            if (line) {
                if (line.isNumber()) {
                    except.stack.frames_ptr[0].position.line_zero_based = OrdinalNumber::fromOneBasedInt(line.toInt32(global)).zeroBasedInt();

                    // TODO: don't sourcemap it twice
                    auto originalLine = obj->getIfPropertyExists(global, builtinNames(vm).originalLinePublicName());
                    if (scope.exception()) [[unlikely]] {
                        scope.clearExceptionExceptTermination();
                    }
                    if (originalLine) {
                        if (originalLine.isNumber()) {
                            except.stack.frames_ptr[0].position.line_zero_based = OrdinalNumber::fromOneBasedInt(originalLine.toInt32(global)).zeroBasedInt();
                        }
                    }
                    except.stack.frames_len = 1;
                }
            }
        }

        if (scope.exception()) [[unlikely]] {
            scope.clearExceptionExceptTermination();
        }

        return;
    }

    if (value.isCell()) {
        // This code is mostly here for debugging purposes if this spot is reached.
        JSCell* cell = value.asCell();
        auto type = cell->type();

        switch (type) {
        case JSC::SymbolType: {
            auto* symbol = asSymbol(cell);
            auto& uid = symbol->uid();
            if (uid.isNullSymbol() || uid.isEmpty()) {
                except.message = BunStringEmpty;
            } else {
                except.message = Bun::toStringRef(static_cast<WTF::StringImpl*>(&uid));
            }
            return;
        }

        default: {
            break;
        }
        }
    }

    auto str = value.toWTFString(global);
    if (scope.exception()) [[unlikely]] {
        scope.clearExceptionExceptTermination();
        return;
    }

    except.message = Bun::toStringRef(str);
}

extern "C" void JSC__Exception__getStackTrace(JSC::Exception* arg0, JSC::JSGlobalObject* global, ZigStackTrace* trace)
{
    populateStackTrace(arg0->vm(), arg0->stack(), *trace, global);
}

extern "C" [[ZIG_EXPORT(check_slow)]] void JSC__JSValue__toZigException(JSC::EncodedJSValue jsException, JSC::JSGlobalObject* global, ZigException* exception)
{
    JSC::JSValue value = JSC::JSValue::decode(jsException);
    if (value == JSC::JSValue {}) {
        exception->type = JSErrorCodeError;
        exception->name = Bun::toStringRef("Error"_s);
        exception->message = Bun::toStringRef("Unknown error"_s);
        return;
    }

    if (value.classInfoOrNull() == JSC::Exception::info()) {
        auto* jscException = uncheckedDowncast<JSC::Exception>(value);
        JSValue unwrapped = jscException->value();

        if (JSC::ErrorInstance* error = dynamicDowncast<JSC::ErrorInstance>(unwrapped)) {
            fromErrorInstance(*exception, global, error, &jscException->stack(), unwrapped);
            return;
        }

        if (jscException->stack().size() > 0) {
            populateStackTrace(global->vm(), jscException->stack(), exception->stack, global);
        }

        exceptionFromString(*exception, unwrapped, global);
        return;
    }

    if (JSC::ErrorInstance* error = dynamicDowncast<JSC::ErrorInstance>(value)) {
        fromErrorInstance(*exception, global, error, nullptr, value);
        return;
    }

    exceptionFromString(*exception, value, global);
}

extern "C" void ZigException__collectSourceLines(ZigException* exception, uint8_t topFrame)
{
    collectSourceLines(exception->stack, topFrame);
}
