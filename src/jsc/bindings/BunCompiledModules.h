#pragma once

#include "root.h"

#include "headers-handwritten.h"
#include <JavaScriptCore/AOTImage.h>
#include <JavaScriptCore/AOTModuleHost.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <wtf/Function.h>

#if !ENABLE(AOT)
#error "Bun needs a JavaScriptCore built with ENABLE(AOT)"
#endif

namespace Zig {
class GlobalObject;
}

namespace JSC {
class Identifier;
class JSGlobalObject;
class JSObject;
class JSPromise;
class RegExp;
}

namespace Bun {

class JSCommonJSModule;
enum class ErrorCode : uint16_t;

extern const JSC::AOT::ModuleHost compiledModuleHost;

inline bool hasCompiledModules() { return JSC::AOT::Image::isRegistered(); }
std::optional<JSC::AOT::ModuleID> compiledModuleForPath(const WTF::String& path);
inline bool isCompiledModule(const WTF::String& path) { return compiledModuleForPath(path).has_value(); }

// A request with import attributes is never a request for the compiled module: these three answer null or false for it.
JSC::JSPromise* compiledModuleSource(Zig::GlobalObject*, const WTF::String& key, bool hasImportAttributes);
JSC::JSPromise* importCompiledModule(Zig::GlobalObject*, const WTF::String& key, bool hasImportAttributes, int64_t referrerAsyncOrder);
bool requireCompiledModule(Zig::GlobalObject*, JSCommonJSModule* target, const WTF::String& path, bool hasImportAttributes);

JSC::JSValue loadCompiledModuleNamespace(Zig::GlobalObject*, const WTF::String& path);
bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject*, JSCommonJSModule* target, const WTF::String& path, bool isTypeScriptLoader);
WTF::String firstCompiledModuleMatching(JSC::JSGlobalObject*, JSC::RegExp* filter);
// The end of every message about code that is not in the executable: what to do in one that was built with --no-compile-function-source, and nothing in any other.
ASCIILiteral adviceToKeepFunctionSource();
// Empty unless `path`, which names JavaScript, TypeScript, WebAssembly or a native addon that is not compiled into the executable, may not be loaded.
JSC::JSValue createNotInExecutableError(JSC::JSGlobalObject*, ErrorCode, const WTF::String& path);
JSC::JSValue errorIfCodeOutsideImageIsRefused(JSC::JSGlobalObject*, ErrorCode, const WTF::String& path);
// The same for a file that loads as a database or a page, under a name the compiler could not follow.
JSC::JSValue errorIfHostObjectOutsideImageIsRefused(JSC::JSGlobalObject*, ErrorCode, const WTF::String& path);
// What process.mainModule and require.main answer in an ahead-of-time executable: the module object of the entry point, made now. Undefined, as in a bundled executable, where no file of the program
// names a way from one module object to another: these two, `children` and `parent`.
JSC::JSValue mainModuleOfExecutable(Zig::GlobalObject*);
// A file of an ahead-of-time executable has a module object only once its code uses `module` or `require` as a value. What the program has required is written down apart from it.
// Brings `children` of such a module object up to date. False: the compiler took one of the children for out of reach, and `children` is undefined, as in a bundled executable.
bool appendNewChildrenOfCompiledModule(JSC::JSGlobalObject*, JSCommonJSModule* parent);
// The module object of the file that required the module first, or null.
JSCommonJSModule* parentOfCompiledModule(JSCommonJSModule*);
// What `module.parent` is in a file with the path `id` that `parent` has required. A file outside of such an executable gets a module object that stands in for the file that required it:
// the same paths, no exports. In a bundled executable one object stands for the whole bundle likewise.
JSC::JSValue parentSeenBy(Zig::GlobalObject*, JSC::JSString* id, JSC::JSValue parent);
// Takes the specifier of every require() and process.getBuiltinModule() that reaches the host, and of every import() in code that is not compiled. Throws in a program
// that loads no module by a name the compiler could not follow. One that --external names admits code outside the executable.
inline void willRequire(JSC::JSGlobalObject* globalObject, JSC::JSValue specifier, JSC::AOT::LoadByName form = JSC::AOT::LoadByName::Require)
{
    if (hasCompiledModules())
        JSC::AOT::willLoadByName(globalObject, specifier, form);
}
// For a built-in that runs machine code or script the compiler did not see, or hands out objects it took for unreachable. `builtin`: its name as a program writes it.
// Empty unless the compiler found that the program uses none of them, and relied on it.
JSC::JSValue errorIfUnseenCodeIsRefused(JSC::JSGlobalObject*, ASCIILiteral builtin);
// False in an executable whose program was compiled ahead of time without --compile-inspector: a debugger reaches what the compiler took for unreachable.
bool isDebuggerAdmitted();
JSC::JSValue errorIfDebuggerIsRefused(JSC::JSGlobalObject*, ASCIILiteral builtin);

// These two come before the change they announce, and throw: the code of an ahead-of-time executable calls the module that each name stood for when it was compiled.
void willSetRequireCacheEntry(Zig::GlobalObject*, const WTF::String& key, JSC::JSValue entry);

inline void willChangeRequireOverride(JSC::JSGlobalObject* globalObject, JSC::AOT::RequireOverride location, bool isOverridden)
{
    if (hasCompiledModules())
        JSC::AOT::willChangeRequireOverride(globalObject, location, isOverridden);
}

}
