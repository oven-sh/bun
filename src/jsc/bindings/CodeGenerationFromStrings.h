#pragma once

#include "root.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ThrowScope.h>
#include <wtf/text/WTFString.h>

#if !defined(BUN_DISALLOW_CODE_GENERATION_FROM_STRINGS)
extern "C" uint8_t Bun__codeGenerationFromStrings();
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
    // "=strict": nothing turns a string into script. evalEnabled() of every global object, and
    // what Bun compiles from a string itself asks mayNotMakeScriptFromStrings().
    Disallowed = 2,
};

// A build configured with codeGenerationFromStrings off (scripts/build/config.ts) has the
// level as a constant, as bun_core::code_generation_from_strings() is in it: no flag is read, and
// the compiler drops what the level guards.
#if defined(BUN_DISALLOW_CODE_GENERATION_FROM_STRINGS)
constexpr CodeGenerationFromStrings codeGenerationFromStrings()
{
    return CodeGenerationFromStrings::Disallowed;
}
#else
inline CodeGenerationFromStrings codeGenerationFromStrings()
{
    return static_cast<CodeGenerationFromStrings>(Bun__codeGenerationFromStrings());
}
#endif

inline constexpr ASCIILiteral codeGenerationFromStringsDisallowedMessage = "Code generation from strings disallowed for this context"_s;

inline bool mayNotMakeScriptFromStrings()
{
    return codeGenerationFromStrings() == CodeGenerationFromStrings::Disallowed;
}

inline JSC::JSObject* createCodeGenerationFromStringsError(JSC::JSGlobalObject* globalObject)
{
    return JSC::createEvalError(globalObject, codeGenerationFromStringsDisallowedMessage);
}

// Throws and returns the rest when nothing may make script from a string. Where the level is a
// constant the return is unconditional, so an optimized build drops the code after it.
#define RETURN_IF_MAY_NOT_MAKE_SCRIPT_FROM_STRINGS(globalObject, scope, ...)                                   \
    do {                                                                                                       \
        if (Bun::mayNotMakeScriptFromStrings()) [[unlikely]] {                                                 \
            JSC::throwException(globalObject, scope, Bun::createCodeGenerationFromStringsError(globalObject)); \
            return __VA_ARGS__;                                                                                \
        }                                                                                                      \
    } while (false)

inline bool isDataOrBlobURL(const WTF::String& specifier)
{
    return specifier.startsWith("data:"_s) || specifier.startsWith("blob:"_s);
}

} // namespace Bun
