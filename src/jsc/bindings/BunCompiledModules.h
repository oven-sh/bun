#pragma once

#include "root.h"

#include "headers-handwritten.h"
#include <JavaScriptCore/AOTImage.h>
#include <JavaScriptCore/AOTModuleHost.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <span>
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
bool decompressSource(std::span<uint8_t> text, std::span<const uint8_t> compressed);

// On this thread. A Worker that starts from source text runs no compiled program.
inline bool hasCompiledModules() { return !!JSC::AOT::Image::current(); }
std::optional<JSC::AOT::ModuleID> compiledModuleForPath(const WTF::String& path);
std::optional<JSC::AOT::ModuleID> findMockedModule(const WTF::String& path);
inline bool isCompiledModule(const WTF::String& path) { return compiledModuleForPath(path).has_value(); }
// The file of the caller if it was loaded from disk at run time, else null. The origin of node:vm code is no file.
WTF::String uncompiledCallerFile(JSC::VM&, JSC::CallFrame*);
std::optional<bool> isHiddenFromRequireCache(const WTF::String& key);

// The attributes select the form of the file, if the executable has it. Null: the import has no attributes.
JSC::JSPromise* importCompiledModule(Zig::GlobalObject*, const WTF::String& key, const JSC::ScriptFetchParameters* attributes, int64_t referrerAsyncOrder);
// These three return null or false for a request with import attributes.
JSC::JSPromise* compiledModuleSource(Zig::GlobalObject*, const WTF::String& key, const JSC::ScriptFetchParameters* attributes);
bool requireCompiledModule(Zig::GlobalObject*, JSCommonJSModule* target, const WTF::String& path, bool hasImportAttributes);
// The host function that require() calls for an ES module, if the path names a compiled one.
JSC::JSObject* loaderOfCompiledESModule(Zig::GlobalObject*, const WTF::String& path, bool hasImportAttributes);

JSC::JSValue loadCompiledModuleNamespace(Zig::GlobalObject*, const WTF::String& path);
// The requester that the engine sees for a require() that loads into `target`, see JSC::AOT::ModuleRequesterScope. The program can overwrite `written`.
WTF::String requesterForRequire(JSCommonJSModule* target, const WTF::String& written);
// Called before and after require() and require.resolve() resolve a name. For importers from disk, files on disk take precedence over compiled ones. Null: nothing to restore.
std::optional<bool> willResolveName(JSC::JSGlobalObject*, JSC::JSValue requirer);
void didResolveName(JSC::JSGlobalObject*, bool previous);
void didCreateRequire(JSC::VM&, JSC::CallFrame*, JSC::JSObject* require);
void didCreateRequireOfCompiledModule(JSC::JSObject* require);
// The requester, as the key of the importing module in the loader.
const WTF::String& requesterForImporter(const WTF::String& importer);
const WTF::String& requesterForUncompiledImportCall(const WTF::String& origin);
const WTF::String& uncompiledImportReferrer(const WTF::String& origin);
// The loader resolves an import from its registry without calling the host. Throws if the importer may not load the file under the key.
void willResolveImport(Zig::GlobalObject*, const WTF::String& key, JSC::JSValue importer);
void throwIfOnlyTyped(Zig::GlobalObject*, const WTF::String& key, const WTF::String& specifier, const WTF::String& importer, bool isForRequire);
bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject*, JSCommonJSModule* target, const WTF::String& path, bool isTypeScriptLoader);
// require() passed the object of a compiled file to the program's extension loader, which delegates to a default loader.
bool resumeDelegatedRequire(Zig::GlobalObject*, JSCommonJSModule* target, const WTF::String& path);
// True if compiled modules have the paths of their source files, so that plugins apply at run time. False in an executable, which is a bundle.
bool runsCompiledModules();
bool compiledProgramRunsInSeveralRealmsAtOnce();
// Null in an executable.
// In a test run, matching files that have not been evaluated are left to the loader and its plugin, and the result is null.
WTF::String firstCompiledModuleMatching(JSC::JSGlobalObject*, JSC::RegExp* filter);
// The error for a JavaScript, TypeScript, WebAssembly or native addon file that is not in the executable and may not be loaded, else empty.
enum class NotInExecutable : bool { Code,
    HostObject };
JSC::JSValue createNotInExecutableError(JSC::JSGlobalObject*, ErrorCode, const WTF::String& path, NotInExecutable = NotInExecutable::Code);
// The compiled program is asking the loader for the reason of a load failure. Nothing is evaluated.
bool isDiagnosingLoadFailure();
JSC::JSValue errorIfCodeOutsideImageIsRefused(JSC::JSGlobalObject*, ErrorCode, const WTF::String& path);
// `bun test --aot` loads native addons that were not compiled with the program, and lists them at the end.
bool letsTestRunLoadAddon(JSC::JSGlobalObject*, const WTF::String& path);
// Whether the executable contains a file at the path. A native addon there is not code from disk.
bool isFileInExecutable(const WTF::String& path);
// The same for a file that loads as a database or an HTML page under a computed name.
JSC::JSValue errorIfHostObjectOutsideImageIsRefused(JSC::JSGlobalObject*, ErrorCode, const WTF::String& path);
// process.mainModule and require.main in an executable: the module object of the file at `Bun.main`.
JSC::JSValue mainModuleOfExecutable(Zig::GlobalObject*);
// The path inside the executable for `path` on the build machine, as in `__filename` and require.resolve(). Null if there is none.
WTF::String pathInExecutable(const WTF::String& path);
// Called before a store to `Bun.main`. Throws if the build saw no such store, except for the current value.
void willSetMainModulePath(Zig::GlobalObject*, JSC::JSValue path);
// A compiled file gets a module object only if its code uses `module` or `require` as a value.
bool appendNewChildrenOfCompiledModule(JSC::JSGlobalObject*, JSCommonJSModule* parent);
// A store to `children` drops what was required and not yet listed.
void dropNewChildrenOfCompiledModule(JSCommonJSModule* parent);
// The module object of the first requirer, or null.
JSC::JSObject* parentOfCompiledModule(JSCommonJSModule*);
// `module.parent` in a file with the path `id` that `parent` required.
JSC::JSValue parentSeenBy(Zig::GlobalObject*, JSC::JSString* id, JSC::JSValue parent);
// Called with the specifier of every require() and process.getBuiltinModule() that reaches the host, and of every import() in uncompiled code.
inline void willRequire(JSC::JSGlobalObject* globalObject, JSC::JSValue specifier, JSC::AOT::LoadKind form = JSC::AOT::LoadKind::Require)
{
    if (hasCompiledModules())
        JSC::AOT::willLoadByName(globalObject, specifier, form);
}
// For a built-in that runs uncompiled code or exposes objects that the compiler treated as unreachable.
JSC::JSValue errorIfUnseenCodeIsRefused(JSC::JSGlobalObject*, ASCIILiteral builtin);
JSC::JSValue errorIfBuildSawNoPlugin(JSC::JSGlobalObject*);
std::optional<JSC::EncodedJSValue> takeSavedResolution(JSC::JSGlobalObject*, const BunString* space, const BunString* name, const BunString* importer, bool& engineAsks);
void saveResolution(JSC::JSGlobalObject*, const BunString* space, const BunString* name, const BunString* importer, JSC::JSValue resultOrThrownValue, bool isThrown);
bool hasSavedResolutions();
void clearSavedResolutions(JSC::JSGlobalObject*);
// False in an executable built without --compile-inspector: a debugger can reach what the compiler treated as unreachable.
bool isDebuggerAdmitted();
JSC::JSValue errorIfDebuggerIsRefused(JSC::JSGlobalObject*, ASCIILiteral builtin);

// jest.requireActual() and similar: the require() result of the compiled module under the key. Empty: use the host's own require().
JSC::JSValue requireCompiledModuleForTestRunner(Zig::GlobalObject*, const WTF::String& key);
void didDeleteRequireCacheEntry(Zig::GlobalObject*, const WTF::String& key);
// Called before and after a mock ends. In `bun test` the original has a key of its own, so the end decides what the file's own key holds. `restoresOriginal`: packagesToRestore of unmockModule(). True: nothing is under the file's own key, and the file leaves the program.
bool willUnmockCompiledFile(Zig::GlobalObject*, const WTF::String& key, bool restoresOriginal, bool isReplacedByLaterMock);
void didUnmockCompiledFile(Zig::GlobalObject*, const WTF::String& key, bool runsAtNextLoad, bool restoresOriginal, bool factoryIsPending);
// As stashLoadedModule(). False: the file is already under the key of the original, so nothing was loaded under its own.
bool didStashCompiledFile(Zig::GlobalObject*, const WTF::String& key);
// The file has left the program, and the runtime retains the original of its mock.
bool isCompiledOriginalRetained(Zig::GlobalObject*, const WTF::String& key);
// A file that left the program and was reloaded is mocked: the reloaded module is its original.
void willMockReloadedFile(Zig::GlobalObject*, const WTF::String& key, JSC::JSValue loadedExports);
// `call`: "vi.resetModules()". Every evaluated file of the program is loaded from disk again, as after a `delete` of its entry.
void willResetModules(Zig::GlobalObject*, WTF::ASCIILiteral call, bool keepsPackages);
// Called at the end of a test file. Restores the preload's files that the test file reset, and returns their paths, which may have disk copies in the loader.
WTF::Vector<WTF::String> restorePreloadModules(Zig::GlobalObject*);
bool requireCacheListsCompiledFiles();
bool isLibraryModuleInRequireCache(Zig::GlobalObject*, const WTF::String& key);
bool isEvaluatedCompiledFile(Zig::GlobalObject*, const WTF::String& key);
JSC::JSValue compiledRequireCacheEntry(Zig::GlobalObject*, const WTF::String& key);
bool isRecordOfCompiledModule(JSC::AbstractModuleRecord*);
// For a file of the program or its stand-in in the loader. forEachEvaluatedCompiledFile() follows the order of an uncompiled run.
bool isRecordOfCompiledFile(JSC::AbstractModuleRecord*);
void forEachEvaluatedCompiledFile(Zig::GlobalObject*, const WTF::Function<void(const WTF::String&)>&);

// These two are called before the change and may throw, because compiled code calls the module that each name had at build time.
// A falsy entry replaces nothing. If files are reloaded from disk, the next require() loads the file again.
void willSetRequireCacheEntry(Zig::GlobalObject*, const WTF::String& key, JSC::JSValue entry);

// (holder, except, receiver): calls each own function of `holder` without parameters on `receiver`, except the keys of `except`. Returns an array of the key and function of each whose result has Symbol.iterator.
JSC_DECLARE_HOST_FUNCTION(jsFunctionCallOwnFunctionsWithoutParameters);
// (target, source, replacements): defines the own properties of `source` that `target` lacks, with the values of `replacements` under the same keys.
JSC_DECLARE_HOST_FUNCTION(jsFunctionDefineMissingProperties);
JSC_DECLARE_HOST_FUNCTION(jsFunctionPrepareHoldersBeforeLookupsUnder);

// `require.extensions[".js"] = loader`
void willSetExtensionLoader(Zig::GlobalObject*, WTF::StringView extension);

inline void willChangeRequireOverride(JSC::JSGlobalObject* globalObject, JSC::AOT::RequireOverride location, bool isOverridden)
{
    if (hasCompiledModules())
        JSC::AOT::willChangeRequireOverride(globalObject, location, isOverridden);
}

}
