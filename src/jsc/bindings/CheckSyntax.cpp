// Implements the engine half of `bun --check` / `-c` (Node.js compatibility):
// syntax-check a source without executing it, reporting errors with JSC's own
// SyntaxError messages the way `node --check` reports V8's.
#include "root.h"

#include "ZigGlobalObject.h"

#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/ParserError.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/SourceProvider.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/WTFString.h>

#include <cstdio>

namespace Bun {

static JSC::SourceCode makeCheckSource(const WTF::String& code, const WTF::String& filename, JSC::SourceProviderSourceType sourceType)
{
    TextPosition position;
    return JSC::SourceCode(
        JSC::StringSourceProvider::create(code, JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(filename)), filename, JSC::SourceTaintedOrigin::Untainted, position, sourceType),
        position.m_line.oneBasedInt(), position.m_column.oneBasedInt());
}

static void printSyntaxError(const WTF::String& filename, const JSC::ParserError& error)
{
    // The format follows `node --check`: the failing file (or "[stdin]") on the
    // first line, then a line starting with "SyntaxError: " carrying the
    // engine's parser message.
    auto filenameUtf8 = filename.utf8();
    auto messageUtf8 = error.message().utf8();
    fprintf(stderr, "%s:%d\n\nSyntaxError: %s\n", filenameUtf8.data(), error.line(), messageUtf8.data());
}

// Called from the CLI (`Run::start`) after the VM booted and `--require`
// preloads ran. `moduleType` is 0 = detect, 1 = CommonJS, 2 = ES module
// (from `--input-type` or the file extension). Returns 0 when the source
// parses, 1 when it does not (after printing the error to stderr).
extern "C" int32_t Bun__checkSyntaxForCLI(Zig::GlobalObject* globalObject, const unsigned char* sourcePtr, size_t sourceLen, const unsigned char* namePtr, size_t nameLen, int32_t moduleType)
{
    auto& vm = JSC::getVM(globalObject);

    WTF::String source = WTF::String::fromUTF8ReplacingInvalidSequences(std::span { sourcePtr, sourceLen });
    WTF::String filename = WTF::String::fromUTF8ReplacingInvalidSequences(std::span { namePtr, nameLen });

    // ES module check (used directly for "module", or as the fallback in
    // detect mode).
    auto checkAsModule = [&](JSC::ParserError& error) -> bool {
        JSC::SourceCode moduleSource = makeCheckSource(source, filename, JSC::SourceProviderSourceType::Module);
        return JSC::checkModuleSyntax(globalObject, moduleSource, error);
    };

    if (moduleType == 2) {
        JSC::ParserError moduleError;
        if (checkAsModule(moduleError))
            return 0;
        printSyntaxError(filename, moduleError);
        return 1;
    }

    // CommonJS sources are compiled inside the module wrapper, so a top-level
    // `return` is legal exactly when require() would accept it. Respect a
    // wrapper overridden via `require("module").wrapper`.
    WTF::String wrapperStart;
    WTF::String wrapperEnd;
    if (globalObject->hasOverriddenModuleWrapper) {
        wrapperStart = globalObject->m_moduleWrapperStart;
        wrapperEnd = globalObject->m_moduleWrapperEnd;
    } else {
        wrapperStart = "(function(exports,require,module,__filename,__dirname){"_s;
        wrapperEnd = "\n})"_s;
    }

    // The wrapper puts the source mid-program, where a shebang is a syntax
    // error; the CJS loader strips it before compiling, so do the same here.
    WTF::String body = source;
    if (body.startsWith("#!"_s)) {
        size_t newline = body.find('\n');
        body = newline == WTF::notFound ? WTF::String(""_s) : body.substring(newline);
    }

    JSC::ParserError commonJSError;
    JSC::SourceCode wrapped = makeCheckSource(makeString(wrapperStart, body, wrapperEnd), filename, JSC::SourceProviderSourceType::Program);
    if (JSC::checkSyntax(vm, wrapped, commonJSError))
        return 0;

    // Detect mode: the package "type" is not re-derived here, so accept the
    // source if it parses as an ES module instead. (A source that is invalid
    // for its real module type but valid for the other one therefore passes;
    // refine when full module-type detection is wired into --check.)
    if (moduleType == 0) {
        JSC::ParserError moduleError;
        if (checkAsModule(moduleError))
            return 0;
    }

    printSyntaxError(filename, commonJSError);
    return 1;
}

} // namespace Bun
