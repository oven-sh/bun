#pragma once

// What source text compiles to, and running it.

#include "engine/api/GlobalObject.h"

namespace JSC {

inline constexpr SourceID noSourceID = 0;

enum CodeType : uint8_t {
    GlobalCode = Engine::CodeKind::Script,
    ModuleCode = Engine::CodeKind::Module,
    EvalCode = Engine::CodeKind::Eval,
    FunctionCode = Engine::CodeKind::Call,
};

class BytecodeIndex {
public:
    BytecodeIndex() = default;
    explicit BytecodeIndex(uint32_t offset)
        : m_offset(offset)
    {
    }

    uint32_t offset() const { return m_offset; }

private:
    uint32_t m_offset { std::numeric_limits<uint32_t>::max() };
};

class ExecutableBase : public JSCell {
public:
    ENGINE_DECLARE_CLASS(Executable)

    bool isHostFunction() const { return type() == NativeExecutableType; }
    bool isFunctionExecutable() const { return type() == FunctionExecutableType; }
    ImplementationVisibility implementationVisibility() const { return Engine::executable_visibility(this); }
};

class NativeExecutable final : public ExecutableBase {
public:
    ENGINE_DECLARE_CLASS(NativeExecutable)

    // Scripts see `bound ` in front of the name.
    void setIsNamedAsBound() { Engine::native_executable_set_is_named_as_bound(this); }
};
ENGINE_CLASS_HAS_TYPE(NativeExecutable, NativeExecutableType);

class ScriptExecutable : public ExecutableBase {
public:
    ENGINE_DECLARE_CLASS(ScriptExecutable)

    // The text that the positions in the code refer to, which lives as long as the executable.
    SourceProvider* sourceProvider() const { return const_cast<SourceProvider*>(Engine::executable_source_provider(this)); }
    // Of a function, from the parameters on.
    SourceCode source() const
    {
        uint32_t start, end;
        Engine::executable_source_range(this, start, end);
        return SourceCode(sourceProvider(), start, end);
    }
    SourceID sourceID() const { return sourceProvider()->asID(); }
    const SourceOrigin& sourceOrigin() const { return sourceProvider()->sourceOrigin(); }

    void setNeverInline() { Engine::executable_set_never_inline(this); }
    void setNeverFTLOptimize() { Engine::executable_set_never_fully_optimize(this); }
};
ENGINE_CLASS_HAS_TYPES(ScriptExecutable, ProgramExecutableType, FunctionExecutableType);

// It has the code for the realm that has called it first.
class FunctionExecutable final : public ScriptExecutable {
public:
    ENGINE_DECLARE_CLASS(FunctionExecutable)

    // Empty unless it is written as that of the function.
    String name() const { return Engine::function_executable_declared_name(this); }
    // Also one that follows from where the function stands.
    String ecmaName() const { return Engine::function_executable_name(this); }
    unsigned parameterCount() const { return Engine::function_executable_length(this); }

    bool isBuiltinFunction() const { return origin() & Engine::Origin::BUILTIN; }
    bool isBuiltinDefaultClassConstructor() const { return origin() & Engine::Origin::DEFAULT_CONSTRUCTOR; }
    bool isArrowFunction() const { return kind() == Engine::FunctionKind::Arrow; }
    bool isClassConstructorFunction() const { return kind() == Engine::FunctionKind::BaseConstructor || kind() == Engine::FunctionKind::DerivedConstructor; }
    bool isClass() const { return isClassConstructorFunction(); }
    // An async generator is one too.
    bool isAsyncFunction() const { return Engine::function_executable_is_async(this); }
    bool isGenerator() const { return Engine::function_executable_is_generator(this) && !isAsyncFunction(); }
    bool isAsyncGenerator() const { return Engine::function_executable_is_generator(this) && isAsyncFunction(); }
    // Whether a call can return before the end of the body.
    bool canSuspend() const { return Engine::function_executable_can_suspend(this); }

    SourceCode classSource() const
    {
        uint32_t start, end;
        auto* provider = const_cast<SourceProvider*>(Engine::function_executable_text_range(this, start, end));
        return SourceCode(provider, start, end);
    }

    // Null until it has been called in that way.
    CodeBlock* codeBlockForCall() const { return Engine::fieldAt<CodeBlock*>(this, Engine::Layout::Executable_code_blocks); }
    CodeBlock* codeBlockForConstruct() const { return Engine::fieldAt<CodeBlock*>(this, Engine::Layout::Executable_code_blocks + sizeof(CodeBlock*)); }
    CodeBlock* eitherCodeBlock() const { return codeBlockForCall() ? codeBlockForCall() : codeBlockForConstruct(); }

private:
    uint8_t kind() const { return Engine::function_executable_kind(this); }
    uint8_t origin() const { return Engine::function_executable_origin(this); }
};
ENGINE_CLASS_HAS_TYPE(FunctionExecutable, FunctionExecutableType);

inline std::optional<SourceCode> JSFunction::sourceCode() const
{
    if (isHostOrBuiltinFunction())
        return std::nullopt;
    return jsExecutable()->source();
}

// Offsets in the source. An error is reported at the divot.
struct ExpressionRange {
    unsigned divot;
    unsigned start;
    unsigned end;
};
ENGINE_CHECK_SIZE(ExpressionRange, sizeOfPosition);
ENGINE_CHECK_OFFSET(ExpressionRange, start, Position_start);
ENGINE_CHECK_OFFSET(ExpressionRange, end, Position_end);

class CodeBlock final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(CodeBlock)

    ScriptExecutable* ownerExecutable() const { return Engine::fieldAt<ScriptExecutable*>(this, Engine::Layout::CodeBlock_owner); }
    SourceProvider* sourceProvider() const { return ownerExecutable()->sourceProvider(); }
    SourceCode source() const { return ownerExecutable()->source(); }

    CodeType codeType() const { return static_cast<CodeType>(std::min<uint8_t>(Engine::code_block_kind(this), FunctionCode)); }
    bool isConstructor() const { return Engine::code_block_kind(this) == Engine::CodeKind::Construct; }
    bool isInStrictContext() const { return Engine::code_block_flags(this) & Engine::CodeFlags::STRICT; }
    bool isBuiltinFunction() const { return Engine::code_block_flags(this) & Engine::CodeFlags::BUILTIN; }

    ExpressionRange expressionRangeForBytecodeIndex(BytecodeIndex index) const
    {
        ExpressionRange range;
        Engine::code_block_position(this, index.offset(), range);
        return range;
    }
    // Whether it is `new` or `super()`.
    bool constructsAt(BytecodeIndex index) const { return Engine::code_block_constructs_at(this, index.offset()); }

    CodeBlock* baselineAlternative() const { return Engine::code_block_baseline(this); }
    unsigned reoptimizationRetryCounter() const { return Engine::code_block_reoptimizations(this); }
    unsigned numberOfOptimizingCompiles() const { return Engine::code_block_optimization_count(this); }
    void optimizeNextInvocation() { Engine::code_block_optimize_next_invocation(this); }
};
ENGINE_CLASS_HAS_TYPE(CodeBlock, CodeBlockType);

// A function and its code, for any realm of the VM.
class UnlinkedFunctionExecutable {
    WTF_MAKE_NONCOPYABLE(UnlinkedFunctionExecutable);

public:
    void ref() const { Engine::unlinked_function_retain(this); }
    void deref() const { Engine::unlinked_function_release(this); }

    FunctionExecutable* link(VM& vm) const { return Engine::unlinked_function_link(*this, vm); }
};

enum class ConstructAbility : bool { CannotConstruct,
    CanConstruct };

// What can be told of `(function (..) { .. })` without parsing it. The offsets count from the first parenthesis.
struct BuiltinSourceMetadata {
    unsigned parametersStart;
    unsigned parameterCount;
    // After the closing brace.
    unsigned end;
    bool isAsyncFunction;
    bool isGenerator;
    bool isInStrictContext;
};
ENGINE_CHECK_SIZE(BuiltinSourceMetadata, sizeOfBuiltinOutline);
ENGINE_CHECK_OFFSET(BuiltinSourceMetadata, parameterCount, BuiltinOutline_length);
ENGINE_CHECK_OFFSET(BuiltinSourceMetadata, end, BuiltinOutline_end);
ENGINE_CHECK_OFFSET(BuiltinSourceMetadata, isAsyncFunction, BuiltinOutline_is_async);
ENGINE_CHECK_OFFSET(BuiltinSourceMetadata, isGenerator, BuiltinOutline_is_generator);
ENGINE_CHECK_OFFSET(BuiltinSourceMetadata, isInStrictContext, BuiltinOutline_is_strict);

// `(function (..) { .. })` and a line feed, in strict code with @names.
inline Ref<UnlinkedFunctionExecutable> createBuiltinModuleExecutable(const SourceCode& source, const Identifier& name)
{
    return adoptRef(*const_cast<UnlinkedFunctionExecutable*>(Engine::unlinked_function_create_module(source, name)));
}

// A function that is written with @names, in static memory and without a URL, whose code the VM keeps for the next time.
inline FunctionExecutable* linkStaticBuiltin(VM& vm, const char* text, const BuiltinSourceMetadata& metadata, ASCIILiteral name, ImplementationVisibility visibility, ConstructAbility ability)
{
    return Engine::static_builtin_link(vm, reinterpret_cast<const uint8_t*>(text), metadata, name, visibility, ability == ConstructAbility::CanConstruct);
}

// An ordinary function in strict code: not async, no generator, outside any class, and without a direct `eval`.
struct KnownFunction {
    unsigned parametersStart;
    unsigned end;
    unsigned parameterCount;
};
ENGINE_CHECK_SIZE(KnownFunction, sizeOfKnownFunction);
ENGINE_CHECK_OFFSET(KnownFunction, end, KnownFunction_end);
ENGINE_CHECK_OFFSET(KnownFunction, parameterCount, KnownFunction_length);

struct KnownCapture {
    unsigned nameStart;
    unsigned nameLength;
    bool mayBeAssigned;
};
ENGINE_CHECK_SIZE(KnownCapture, sizeOfKnownCapture);
ENGINE_CHECK_OFFSET(KnownCapture, nameLength, KnownCapture_length);
ENGINE_CHECK_OFFSET(KnownCapture, mayBeAssigned, KnownCapture_may_be_assigned);

// Inner functions in one scope of a function, which the parser can skip, and all variables of that scope that they refer to.
struct KnownFunctions {
    void tellParser(VM& vm, SourceProvider& provider) const { Engine::source_add_known_functions(vm, provider, functions.span(), captures.span()); }
    // Null if the parser finds the same.
    String check(VM& vm, UnlinkedFunctionExecutable& outer) const { return Engine::unlinked_function_check_known_functions(outer, vm, functions.span(), captures.span()); }

    Vector<KnownFunction, 64> functions;
    Vector<KnownCapture, 128> captures;
};

struct JSTextPosition {
    int offset { -1 };
};

struct JSToken {
    JSTextPosition m_startPosition;
    JSTextPosition m_endPosition;
};

class ParserError {
public:
    enum ErrorType : uint8_t {
        SyntaxError = Engine::ErrorKind::Syntax,
        StackOverflow = Engine::ErrorKind::StackOverflow,
        OutOfMemory = Engine::ErrorKind::OutOfMemory,
    };

    enum SyntaxErrorType : uint8_t {
        SyntaxErrorIrrecoverable = Engine::Recovery::Irrecoverable,
        SyntaxErrorUnterminatedLiteral = Engine::Recovery::UnterminatedLiteral,
        SyntaxErrorRecoverable = Engine::Recovery::Recoverable,
    };

    ParserError() = default;
    ParserError(ErrorType type, SyntaxErrorType syntaxErrorType, JSToken token, const String& message, int line)
        : m_message(message)
        , m_token(token)
        , m_line(line)
        , m_isValid(true)
        , m_type(type)
        , m_syntaxErrorType(syntaxErrorType)
    {
    }

    bool isValid() const { return m_isValid; }
    ErrorType type() const { return m_type; }
    SyntaxErrorType syntaxErrorType() const { return m_syntaxErrorType; }
    const String& message() const { return m_message; }
    const JSToken& token() const { return m_token; }
    // Negative unless it is a syntax error.
    int line() const { return m_line; }

    JSObject* toErrorObject(JSGlobalObject*, const SourceCode&, int overrideLineNumber = -1) const;

private:
    static void checkLayout();

    String m_message;
    JSToken m_token;
    int m_line { -1 };
    bool m_isValid { false };
    ErrorType m_type { SyntaxError };
    SyntaxErrorType m_syntaxErrorType { SyntaxErrorIrrecoverable };
};

inline void ParserError::checkLayout()
{
    ENGINE_CHECK_SIZE(ParserError, sizeOfParserError);
    ENGINE_CHECK_OFFSET(ParserError, m_token, ParserError_token_start);
    ENGINE_CHECK_OFFSET(ParserError, m_line, ParserError_line);
    ENGINE_CHECK_OFFSET(ParserError, m_isValid, ParserError_is_valid);
    ENGINE_CHECK_OFFSET(ParserError, m_type, ParserError_kind);
    ENGINE_CHECK_OFFSET(ParserError, m_syntaxErrorType, ParserError_recovery);
}

inline bool checkSyntax(VM& vm, const SourceCode& source, ParserError& error) { return Engine::check_script_syntax(vm, *source.provider(), error); }

inline JSValue Interpreter::executeProgram(const SourceCode& source, JSGlobalObject* globalObject, JSObject* thisObject) { return Engine::evaluate_script(globalObject, source, thisObject); }
// Takes the exception, and returns undefined then.
JSValue evaluate(JSGlobalObject*, const SourceCode&, JSValue thisValue, NakedPtr<Exception>& returnedException);

class AsyncFunctionPrototype final : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(AsyncFunctionPrototype)
};

// For tests of the tiers.
FunctionExecutable* getExecutableForFunction(JSValue);
CodeBlock* getSomeBaselineCodeBlockForFunction(JSValue);
JSValue numberOfDFGCompiles(JSGlobalObject*, CallFrame*);
JSValue optimizeNextInvocation(JSValue);
JSValue setNeverInline(JSGlobalObject*, CallFrame*);
inline JSValue optimizeNextInvocation(JSGlobalObject*, CallFrame* callFrame) { return optimizeNextInvocation(callFrame->argument(0)); }

} // namespace JSC
