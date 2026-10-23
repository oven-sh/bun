#pragma once

#include "root.h"
#include <JavaScriptCore/AOTRealmStartup.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ThrowScope.h>
#include <wtf/text/WTFString.h>

#if !defined(BUN_DISALLOW_CODE_GENERATION_FROM_STRINGS)
extern "C" uint8_t Bun__codeGenerationFromStrings();
extern "C" bool Bun__isCodeGenerationDisallowedByTrimming();
extern "C" bool Bun__isCodeGenerationDisallowedByCompiledProgram();
extern "C" bool Bun__isCodeGenerationFromStringsStrictByFlags();
#endif

namespace Bun {

// --disallow-code-generation-from-strings: bun_core::CodeGenerationFromStrings. The process's:
// set while the command line is parsed and never lowered, so it is the same on every thread and
// for every global object.
enum class CodeGenerationFromStrings : uint8_t {
    Allowed = 0,
    // As Node.js: eval and the Function constructors throw. JSGlobalObject::evalEnabled() of
    // every global object but a node:vm context's, which keeps its own `codeGeneration.strings`.
    DisallowedLikeNode = 1,
    // "=strict": nothing turns a string into script. The engine runs static code only (JSC::SourceProvenance,
    // JSC::Options::disallowNonStaticCode). What asks isCodeGenerationFromStringsStrict() only throws earlier than that.
    Strict = 2,
};

// A build configured with codeGenerationFromStrings off (scripts/build/config.ts) has the
// level as a constant, as bun_core::code_generation_from_strings() is in it: no flag is read, and
// the compiler drops what the level guards.
#if defined(BUN_DISALLOW_CODE_GENERATION_FROM_STRINGS)
constexpr CodeGenerationFromStrings codeGenerationFromStrings()
{
    return CodeGenerationFromStrings::Strict;
}
#else
inline CodeGenerationFromStrings codeGenerationFromStrings()
{
    return static_cast<CodeGenerationFromStrings>(Bun__codeGenerationFromStrings());
}
#endif

inline ASCIILiteral codeGenerationFromStringsDisallowedMessage()
{
#if !defined(BUN_DISALLOW_CODE_GENERATION_FROM_STRINGS)
    // Ahead of the message of --trim: where the compiled program refuses text, keeping the interpreter changes nothing.
    if (Bun__isCodeGenerationDisallowedByCompiledProgram())
        return JSC::AOT::evaluationRefusedMessage();
    if (Bun__isCodeGenerationDisallowedByTrimming())
        return "Code generation from strings disallowed for this context: eval() and new Function() were removed by --trim because your code never uses them. To keep them, add \"interpreter\" to compile.trim.allow in Bun.build()."_s;
#endif
    return "Code generation from strings disallowed for this context"_s;
}

inline bool isCodeGenerationFromStringsStrict()
{
    return codeGenerationFromStrings() == CodeGenerationFromStrings::Strict;
}

// The flag or the build asks for "strict", whatever else refuses text in this process.
inline bool isCodeGenerationFromStringsStrictByFlags()
{
#if defined(BUN_DISALLOW_CODE_GENERATION_FROM_STRINGS)
    return true;
#else
    return Bun__isCodeGenerationFromStringsStrictByFlags();
#endif
}

// No flag set the level: the program was compiled ahead of time to run nothing but its own code.
inline bool isCodeGenerationDisallowedByCompiledProgram()
{
#if defined(BUN_DISALLOW_CODE_GENERATION_FROM_STRINGS)
    return false;
#else
    return Bun__isCodeGenerationDisallowedByCompiledProgram();
#endif
}

inline JSC::JSObject* createCodeGenerationFromStringsError(JSC::JSGlobalObject* globalObject)
{
    return JSC::createEvalError(globalObject, codeGenerationFromStringsDisallowedMessage());
}

// Throws and returns the rest when nothing may make script from a string. Where the level is a
// constant the return is unconditional, so an optimized build drops the code after it.
#define THROW_AND_RETURN_IF_CODE_GENERATION_FROM_STRINGS_IS_STRICT(globalObject, scope, ...)                   \
    do {                                                                                                       \
        if (Bun::isCodeGenerationFromStringsStrict()) [[unlikely]] {                                           \
            JSC::throwException(globalObject, scope, Bun::createCodeGenerationFromStringsError(globalObject)); \
            return __VA_ARGS__;                                                                                \
        }                                                                                                      \
    } while (false)

inline bool isDataOrBlobURL(const WTF::String& specifier)
{
    return specifier.startsWith("data:"_s) || specifier.startsWith("blob:"_s);
}

} // namespace Bun
