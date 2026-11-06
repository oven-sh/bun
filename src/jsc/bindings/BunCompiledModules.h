#pragma once

#include "root.h"

#include "headers-handwritten.h"
#include <JavaScriptCore/AOTImage.h>
#include <JavaScriptCore/AOTModuleHost.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <wtf/Function.h>

namespace Zig {
class GlobalObject;
}

namespace JSC {
class Identifier;
class JSGlobalObject;
class JSObject;
class JSPromise;
class RegExp;
class ScriptFetchParameters;
}

namespace Bun {

class JSCommonJSModule;
enum class ErrorCode : uint16_t;

extern const JSC::AOT::ModuleHost compiledModuleHost;

// On this thread: a Worker that starts from text runs no compiled program.
inline bool hasCompiledModules() { return !!JSC::AOT::Image::current(); }
std::optional<JSC::AOT::ModuleID> compiledModuleForPath(const WTF::String& path);
inline bool isCompiledModule(const WTF::String& path) { return compiledModuleForPath(path).has_value(); }

// The attributes say as what the file is asked for, and the executable may hold it as that. Null: the import has none.
JSC::JSPromise* importCompiledModule(Zig::GlobalObject*, const WTF::String& key, const JSC::ScriptFetchParameters* attributes, int64_t referrerAsyncOrder);
// These three answer null or false for a request with import attributes.
JSC::JSPromise* compiledModuleSource(Zig::GlobalObject*, const WTF::String& key, bool hasImportAttributes);
bool requireCompiledModule(Zig::GlobalObject*, JSCommonJSModule* target, const WTF::String& path, bool hasImportAttributes);
// The function of the host that require() hands an ES module to, if the path names a compiled one.
JSC::JSObject* loaderOfCompiledESModule(Zig::GlobalObject*, const WTF::String& path, bool hasImportAttributes);

JSC::JSValue loadCompiledModuleNamespace(Zig::GlobalObject*, const WTF::String& path);
bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject*, JSCommonJSModule* target, const WTF::String& path, bool isTypeScriptLoader);
// True where the compiled modules have the paths of their source files, for which `bun run` asks the plugins of the run time. An executable is a bundle: no plugin is asked for a module in it.
bool compiledModulesRunInPlaceOfFiles();
// Null in an executable.
WTF::String firstCompiledModuleMatching(JSC::JSGlobalObject*, JSC::RegExp* filter);
// Empty unless `path`, which names JavaScript, TypeScript, WebAssembly or a native addon that is not compiled into the executable, may not be loaded.
enum class NotInExecutable : bool { Code,
    HostObject };
JSC::JSValue createNotInExecutableError(JSC::JSGlobalObject*, ErrorCode, const WTF::String& path, NotInExecutable = NotInExecutable::Code);
JSC::JSValue errorIfCodeOutsideImageIsRefused(JSC::JSGlobalObject*, ErrorCode, const WTF::String& path);
// The same for a file that loads as a database or a page, under a name the compiler could not follow.
JSC::JSValue errorIfHostObjectOutsideImageIsRefused(JSC::JSGlobalObject*, ErrorCode, const WTF::String& path);
// What process.mainModule and require.main answer in an ahead-of-time executable: the module object of the entry point, made now.
JSC::JSValue mainModuleOfExecutable(Zig::GlobalObject*);
// A file of an ahead-of-time executable has a module object only once its code uses `module` or `require` as a value.
bool appendNewChildrenOfCompiledModule(JSC::JSGlobalObject*, JSCommonJSModule* parent);
// The module object of the file that required the module first, or null.
JSCommonJSModule* parentOfCompiledModule(JSCommonJSModule*);
// What `module.parent` is in a file with the path `id` that `parent` has required.
JSC::JSValue parentSeenBy(Zig::GlobalObject*, JSC::JSString* id, JSC::JSValue parent);
// Takes the specifier of every require() and process.getBuiltinModule() that reaches the host, and of every import() in code that is not compiled.
inline void willRequire(JSC::JSGlobalObject* globalObject, JSC::JSValue specifier, JSC::AOT::LoadByName form = JSC::AOT::LoadByName::Require)
{
    if (hasCompiledModules())
        JSC::AOT::willLoadByName(globalObject, specifier, form);
}
// For a built-in that runs machine code or script the compiler did not see, or hands out objects it took for unreachable.
JSC::JSValue errorIfUnseenCodeIsRefused(JSC::JSGlobalObject*, ASCIILiteral builtin);
// False in an executable whose program was compiled ahead of time without --compile-inspector: a debugger reaches what the compiler took for unreachable.
bool isDebuggerAdmitted();
JSC::JSValue errorIfDebuggerIsRefused(JSC::JSGlobalObject*, ASCIILiteral builtin);

// These two come before the change they announce, and throw: the code of an ahead-of-time executable calls the module that each name stood for when it was compiled.
void willSetRequireCacheEntry(Zig::GlobalObject*, const WTF::String& key, JSC::JSValue entry);

// (holder, except, receiver): calls each own function of `holder` that takes no parameters on `receiver`, in the order of the keys, but for the keys that `except` owns, and asks each object that comes back for Symbol.iterator. It answers a list: the key and the function of each that has one.
JSC_DECLARE_HOST_FUNCTION(jsFunctionCallOwnFunctionsWithoutParameters);
// (target, source, replacements): defines each own property of `source` that `target` does not own on `target` as it stands on `source`, in the order of the keys. A value that `replacements` holds under the key takes the place of the value.
JSC_DECLARE_HOST_FUNCTION(jsFunctionDefineOwnPropertiesLeftOut);
JSC_DECLARE_HOST_FUNCTION(jsFunctionPrepareHoldersBeforeLookupsUnder);

inline void willChangeRequireOverride(JSC::JSGlobalObject* globalObject, JSC::AOT::RequireOverride location, bool isOverridden)
{
    if (hasCompiledModules())
        JSC::AOT::willChangeRequireOverride(globalObject, location, isOverridden);
}

}
