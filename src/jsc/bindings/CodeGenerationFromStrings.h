#pragma once

#include "root.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ThrowScope.h>
#include <wtf/text/WTFString.h>

extern "C" uint8_t Bun__codeGenerationFromStrings();

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

inline CodeGenerationFromStrings codeGenerationFromStrings()
{
    return static_cast<CodeGenerationFromStrings>(Bun__codeGenerationFromStrings());
}

inline constexpr ASCIILiteral codeGenerationFromStringsDisallowedMessage = "Code generation from strings disallowed for this context"_s;

inline bool mayNotMakeScriptFromStrings()
{
    return codeGenerationFromStrings() == CodeGenerationFromStrings::Disallowed;
}

inline JSC::JSObject* createCodeGenerationFromStringsError(JSC::JSGlobalObject* globalObject)
{
    return JSC::createEvalError(globalObject, codeGenerationFromStringsDisallowedMessage);
}

// True if it threw.
inline bool throwIfMayNotMakeScriptFromStrings(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope)
{
    if (!mayNotMakeScriptFromStrings()) [[likely]]
        return false;
    JSC::throwException(globalObject, scope, createCodeGenerationFromStringsError(globalObject));
    return true;
}

inline bool isDataOrBlobURL(const WTF::String& specifier)
{
    return specifier.startsWith("data:"_s) || specifier.startsWith("blob:"_s);
}

} // namespace Bun
