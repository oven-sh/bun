#pragma once

// Error objects, and shorthands for making and throwing them.

#include "engine/api/Stack.h"

namespace JSC {

class Exception final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(Exception)

    enum class StackCaptureAction : bool { CaptureStack,
        DoNotCaptureStack };

    static Exception* create(VM& vm, JSValue value, StackCaptureAction action = StackCaptureAction::CaptureStack) { return Engine::exception_create(vm, value, action == StackCaptureAction::CaptureStack); }

    JSValue value() const { return Engine::fieldAt<JSValue>(this, Engine::Layout::Exception_value); }
    // Empty if a script was sure to catch it.
    const Vector<StackFrame>& stack() const { return Engine::fieldAt<const Vector<StackFrame>>(this, Engine::Layout::Exception_stack); }
    // Falls back on the frames of the error.
    const Vector<StackFrame>& stackForReporting(VM& vm)
    {
        Engine::exception_prepare_stack_for_reporting(this, vm);
        return stack();
    }

    // The one that it was first thrown in, if any.
    JSValue asyncContext() const { return asyncContextField().get(); }
    void setAsyncContext(VM& vm, JSValue context) { asyncContextField().set(vm, this, context); }

private:
    WriteBarrier<Unknown>& asyncContextField() const { return Engine::fieldAt<WriteBarrier<Unknown>>(this, Engine::Layout::Exception_async_context); }
};
ENGINE_CLASS_HAS_TYPE(Exception, ExceptionType);

enum RuntimeType : uint16_t { TypeNothing };

class ErrorInstance final : public JSDestructibleObject {
public:
    ENGINE_DECLARE_CLASS(ErrorInstance)

    static constexpr unsigned StructureFlags = Engine::Layout::errorInstanceFlags;

    using SourceAppender = std::nullptr_t;

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype) { return Structure::create(vm, globalObject, prototype, TypeInfo(ErrorInstanceType, StructureFlags), info()); }

    static ErrorInstance* create(VM& vm, Structure* structure, const String& message, JSValue cause, SourceAppender = nullptr, RuntimeType = TypeNothing, ErrorType type = ErrorType::Error, bool useCurrentFrame = true, JSObject* subclassCaller = nullptr)
    {
        return Engine::error_create(vm, structure, type, message, cause, !useCurrentFrame, subclassCaller);
    }
    // One that was made elsewhere, so that the current stack says nothing about it.
    static ErrorInstance* create(JSGlobalObject* globalObject, String&& message, ErrorType type, LineColumn position, String&& sourceURL, String&& stack)
    {
        return Engine::error_with_info(globalObject, type, WTF::move(message), position, WTF::move(sourceURL), WTF::move(stack));
    }

    ErrorType errorType() const { return Engine::fieldAt<ErrorType>(this, Engine::Layout::ErrorInstance_error_type); }
    bool isStackOverflowError() const { return flags() & Engine::ErrorFlags::IS_STACK_OVERFLOW; }
    bool isOutOfMemoryError() const { return flags() & Engine::ErrorFlags::IS_OUT_OF_MEMORY; }
    void setNativeGetterTypeError() { Engine::error_set_native_getter_type_error(this); }

    // What a parser has left for the hooks that format the stack.
    unsigned line() const { return Engine::fieldAt<LineColumn>(this, Engine::Layout::ErrorInstance_position).line; }
    const String& sourceURL() const { return Engine::fieldAt<const String>(this, Engine::Layout::ErrorInstance_source_url); }

    // They run no script.
    String sanitizedToString(JSGlobalObject* globalObject) { return Engine::error_sanitized_to_string(this, globalObject); }
    String sanitizedMessageString(JSGlobalObject* globalObject) { return Engine::error_sanitized_message(this, globalObject); }
    String sanitizedNameString(JSGlobalObject* globalObject) { return Engine::error_sanitized_name(this, globalObject); }

    // A collection takes the frames away if something that they refer to has died.
    Vector<StackFrame>* stackTrace() { return Engine::error_stack_trace(this); }
    void captureStackTrace(VM&, JSGlobalObject* globalObject, size_t framesToSkip = 0) { Engine::error_capture_stack_trace(this, globalObject, framesToSkip); }
    void setStackFrames(VM& vm, Vector<StackFrame>&& frames) { Engine::error_set_stack_trace(this, vm, frames); }
    void setErrorInfoForEmbedderError(LineColumn position, String&& sourceURL, String&& stack) { Engine::error_set_info(this, position, WTF::move(sourceURL), WTF::move(stack)); }
    void setStackPropertyProvidedByCapturedStackTrace() { Engine::error_set_stack_is_provided(this); }

    // Defines `stack`, `line`, `column` and `sourceURL`.
    bool hasMaterializedErrorInfo() const { return flags() & Engine::ErrorFlags::IS_MATERIALIZED; }
    bool materializeErrorInfoIfNeeded(VM&) { return Engine::error_materialize(this); }
    bool materializeErrorInfoIfNeeded(VM& vm, PropertyName name) { return Engine::error_is_lazy_property(name) && materializeErrorInfoIfNeeded(vm); }

private:
    uint16_t flags() const { return Engine::fieldAt<uint16_t>(this, Engine::Layout::ErrorInstance_flags); }
};
ENGINE_CLASS_HAS_TYPE(ErrorInstance, ErrorInstanceType);

class ErrorPrototype final : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(ErrorPrototype)
};

inline JSObject* createError(JSGlobalObject* globalObject, ErrorType type, const String& message) { return Engine::error_new(globalObject, type, message); }
inline JSObject* createError(JSGlobalObject* globalObject, const String& message) { return createError(globalObject, ErrorType::Error, message); }
inline JSObject* createEvalError(JSGlobalObject* globalObject, const String& message) { return createError(globalObject, ErrorType::EvalError, message); }
inline JSObject* createRangeError(JSGlobalObject* globalObject, const String& message) { return createError(globalObject, ErrorType::RangeError, message); }
inline JSObject* createReferenceError(JSGlobalObject* globalObject, const String& message) { return createError(globalObject, ErrorType::ReferenceError, message); }
inline JSObject* createSyntaxError(JSGlobalObject* globalObject, const String& message = "Syntax error"_s) { return createError(globalObject, ErrorType::SyntaxError, message); }
inline JSObject* createTypeError(JSGlobalObject* globalObject, const String& message = "Type error"_s) { return createError(globalObject, ErrorType::TypeError, message); }
inline JSObject* createNotEnoughArgumentsError(JSGlobalObject* globalObject) { return createTypeError(globalObject, "Not enough arguments"_s); }
inline JSObject* createOutOfMemoryError(JSGlobalObject* globalObject, StringView detail = {}) { return Engine::error_out_of_memory(globalObject, detail); }
inline JSObject* createStackOverflowError(JSGlobalObject* globalObject) { return Engine::error_stack_overflow(globalObject); }
inline JSObject* createUndefinedVariableError(JSGlobalObject* globalObject, const Identifier& name) { return Engine::error_undefined_variable(globalObject, name); }

// They quote the expression that the running script is at.
inline JSObject* createInvalidInParameterError(JSGlobalObject* globalObject, JSValue value) { return Engine::error_invalid_in_parameter(globalObject, value); }
inline JSObject* createNotAConstructorError(JSGlobalObject* globalObject, JSValue value) { return Engine::error_not_a_constructor(globalObject, value); }
inline JSObject* createNotAFunctionError(JSGlobalObject* globalObject, JSValue value) { return Engine::error_not_a_function(globalObject, value); }
inline JSObject* createNotAnObjectError(JSGlobalObject* globalObject, JSValue value) { return Engine::error_not_an_object(globalObject, value); }

inline ErrorInstance* createAggregateError(VM& vm, Structure* structure, JSArray* errors, const String& message, JSValue cause, ErrorInstance::SourceAppender = nullptr, RuntimeType = TypeNothing, bool useCurrentFrame = true)
{
    auto* error = ErrorInstance::create(vm, structure, message, cause, nullptr, TypeNothing, ErrorType::AggregateError, useCurrentFrame);
    Engine::error_define_errors(error, vm, errors);
    return error;
}

// Gives an object that is no ErrorInstance the properties of one.
inline void addErrorInfo(JSGlobalObject* globalObject, JSObject* object) { Engine::error_add_info_to_object(globalObject->vm(), object); }

inline String errorDescriptionForValue(JSGlobalObject* globalObject, JSValue value) { return Engine::describe_value_for_error(globalObject, value); }
inline String makeDOMAttributeGetterTypeErrorMessage(StringView interfaceName, StringView attributeName) { return Engine::getter_type_error_message(interfaceName, attributeName); }

ALWAYS_INLINE Exception* throwError(JSGlobalObject* globalObject, ThrowScope& scope, ErrorType type, const String& message)
{
    scope.willThrow();
    return Engine::throw_error(globalObject, type, message);
}
ALWAYS_INLINE Exception* throwTypeError(JSGlobalObject* globalObject, ThrowScope& scope)
{
    scope.willThrow();
    return Engine::throw_type_error(globalObject);
}
ALWAYS_INLINE Exception* throwTypeError(JSGlobalObject* globalObject, ThrowScope& scope, ASCIILiteral message)
{
    scope.willThrow();
    return Engine::throw_type_error_literal(globalObject, message);
}
ALWAYS_INLINE Exception* throwOutOfMemoryError(JSGlobalObject* globalObject, ThrowScope& scope)
{
    scope.willThrow();
    return Engine::throw_out_of_memory(globalObject);
}
ALWAYS_INLINE Exception* throwStackOverflowError(JSGlobalObject* globalObject, ThrowScope& scope)
{
    scope.willThrow();
    return Engine::throw_stack_overflow(globalObject);
}
ALWAYS_INLINE Exception* throwConstructorCannotBeCalledAsFunctionTypeError(JSGlobalObject* globalObject, ThrowScope& scope, ASCIILiteral constructorName)
{
    scope.willThrow();
    return Engine::throw_called_without_new(globalObject, constructorName);
}
ALWAYS_INLINE JSValue throwDOMAttributeGetterTypeError(JSGlobalObject* globalObject, ThrowScope& scope, const ClassInfo* info, PropertyName name)
{
    scope.willThrow();
    return Engine::throw_getter_type_error(globalObject, info, name);
}
ALWAYS_INLINE JSValue throwDOMAttributeSetterTypeError(JSGlobalObject* globalObject, ThrowScope& scope, const ClassInfo* info, PropertyName name)
{
    scope.willThrow();
    return Engine::throw_setter_type_error(globalObject, info, name);
}

ALWAYS_INLINE Exception* throwTypeError(JSGlobalObject* globalObject, ThrowScope& scope, const String& message) { return throwError(globalObject, scope, ErrorType::TypeError, message); }
ALWAYS_INLINE Exception* throwRangeError(JSGlobalObject* globalObject, ThrowScope& scope, const String& message) { return throwError(globalObject, scope, ErrorType::RangeError, message); }
ALWAYS_INLINE Exception* throwSyntaxError(JSGlobalObject* globalObject, ThrowScope& scope, const String& message) { return throwError(globalObject, scope, ErrorType::SyntaxError, message); }

// What a host function returns. It is no cell, in case a caller takes the exception and passes the result on.
ALWAYS_INLINE EncodedJSValue afterThrowing(JSValue) { return encodedJSValue(); }

ALWAYS_INLINE EncodedJSValue throwVMError(JSGlobalObject* globalObject, ThrowScope& scope, JSValue error) { return afterThrowing(throwException(globalObject, scope, error)); }
ALWAYS_INLINE EncodedJSValue throwVMError(JSGlobalObject* globalObject, ThrowScope& scope, const String& message) { return afterThrowing(throwError(globalObject, scope, ErrorType::Error, message)); }
ALWAYS_INLINE EncodedJSValue throwVMTypeError(JSGlobalObject* globalObject, ThrowScope& scope) { return afterThrowing(throwTypeError(globalObject, scope)); }
ALWAYS_INLINE EncodedJSValue throwVMTypeError(JSGlobalObject* globalObject, ThrowScope& scope, ASCIILiteral message) { return afterThrowing(throwTypeError(globalObject, scope, message)); }
ALWAYS_INLINE EncodedJSValue throwVMTypeError(JSGlobalObject* globalObject, ThrowScope& scope, const String& message) { return afterThrowing(throwTypeError(globalObject, scope, message)); }
ALWAYS_INLINE EncodedJSValue throwVMRangeError(JSGlobalObject* globalObject, ThrowScope& scope, const String& message) { return afterThrowing(throwRangeError(globalObject, scope, message)); }
ALWAYS_INLINE EncodedJSValue throwVMDOMAttributeGetterTypeError(JSGlobalObject* globalObject, ThrowScope& scope, const ClassInfo* info, PropertyName name) { return afterThrowing(throwDOMAttributeGetterTypeError(globalObject, scope, info, name)); }
ALWAYS_INLINE EncodedJSValue throwVMDOMAttributeSetterTypeError(JSGlobalObject* globalObject, ThrowScope& scope, const ClassInfo* info, PropertyName name) { return afterThrowing(throwDOMAttributeSetterTypeError(globalObject, scope, info, name)); }

// For an internal method that fails.
template<typename Message> bool typeError(JSGlobalObject* globalObject, ThrowScope& scope, bool shouldThrow, Message message)
{
    if (shouldThrow)
        throwTypeError(globalObject, scope, message);
    return false;
}

// A limit on the time that a call may take.
class TerminationDeadline {
    WTF_MAKE_NONCOPYABLE(TerminationDeadline);

public:
    void ref() const { Engine::termination_deadline_retain(this); }
    void deref() const { Engine::termination_deadline_release(this); }

    // Afterwards didFire() does not change any more.
    void cancel(VM&) { Engine::termination_deadline_cancel(*this); }
    bool didFire() const { return Engine::termination_deadline_did_fire(*this); }
};

inline Ref<TerminationDeadline> VM::addTerminationDeadline(MonotonicTime time)
{
    return adoptRef(*const_cast<TerminationDeadline*>(Engine::termination_deadline_add(*this, (time - MonotonicTime::now()).seconds())));
}

} // namespace JSC
