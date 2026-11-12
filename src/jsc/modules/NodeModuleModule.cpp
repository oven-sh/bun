#include "root.h"
#include "headers-handwritten.h"
#include "NodeModuleModule.h"
#include "CodeGenerationFromStrings.h"
#include "BunCompiledModules.h"
#include "ModuleGraph.h"
#include "Path.h"
#include "WebCoreJSBuiltins.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/IteratorOperations.h>
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JSCommonJSExtensions.h"

#include "PathInlines.h"
#include "ZigGlobalObject.h"
#include "headers.h"
#include "ErrorCode.h"
#include "VectorSizeLimit.h"
#include "BunString.h"

#include "GeneratedNodeModuleModule.h"
#include "GeneratedResolverJsc.h"
#include "GeneratedSourcemap.h"

// Resolves from the file name alone. A CommonJS request that has a parent goes through Bun::resolveForRequire().
extern "C" JSC::EncodedJSValue Bun__resolveSync(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool is_esm, bool isUserRequireResolve);
// Resolves a CommonJS request in the `paths` of its parent. The entries from `aboveImporterStart` up to `aboveImporterEnd` are what
// Module._nodeModulePaths() lists for the directory of `from`.
// `*reachedInvalidEntry`: the search came to the entry that is not a string, and nothing was thrown.
extern "C" JSC::EncodedJSValue Bun__resolveSyncFromLookupPaths(JSC::JSGlobalObject* global, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool isUserRequireResolve, const BunString* paths, size_t paths_len, size_t aboveImporterStart, size_t aboveImporterEnd, bool endsAtInvalidEntry, bool* reachedInvalidEntry);
// Where among `paths` the list of Module._nodeModulePaths() for the directory of `filename` stands, whole and in order. `false`: nowhere.
extern "C" bool Resolver__nodeModulePathsRun(const BunString* filename, const BunString* paths, size_t paths_len, size_t* start, size_t* end);

namespace Bun {

using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsFunctionFindPath);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsBuiltinModule);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeModuleCreateRequire);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeModuleModuleConstructor);
JSC_DECLARE_HOST_FUNCTION(jsFunctionResolveFileName);
JSC_DECLARE_HOST_FUNCTION(jsFunctionResolveLookupPaths);
JSC_DECLARE_HOST_FUNCTION(jsFunctionWrap);

JSC_DECLARE_CUSTOM_GETTER(getterRequireFunction);
JSC_DECLARE_CUSTOM_SETTER(setterRequireFunction);

// This is a list of builtin module names that do not have the node prefix. It
// also includes Bun's builtin modules, as well as Bun's thirdparty overrides.
// The reason for overstuffing this list is so that uses that use these as the
// 'external' option to a bundler will properly exclude things like 'ws' which
// only work with Bun's native 'ws' implementation and not the JS one on NPM.
static constexpr ASCIILiteral builtinModuleNames[] = {
    "_http_agent"_s,
    "_http_client"_s,
    "_http_common"_s,
    "_http_incoming"_s,
    "_http_outgoing"_s,
    "_http_server"_s,
    "_stream_duplex"_s,
    "_stream_passthrough"_s,
    "_stream_readable"_s,
    "_stream_transform"_s,
    "_stream_wrap"_s,
    "_stream_writable"_s,
    "_tls_common"_s,
    "_tls_wrap"_s,
    "assert"_s,
    "assert/strict"_s,
    "async_hooks"_s,
    "buffer"_s,
    "bun:ffi"_s,
    "bun:jsc"_s,
    "bun:sqlite"_s,
    "bun:test"_s,
    "bun"_s,
    "child_process"_s,
    "cluster"_s,
    "console"_s,
    "constants"_s,
    "crypto"_s,
    "dgram"_s,
    "diagnostics_channel"_s,
    "dns"_s,
    "dns/promises"_s,
    "domain"_s,
    "events"_s,
    "fs"_s,
    "fs/promises"_s,
    "http"_s,
    "http2"_s,
    "https"_s,
    "inspector"_s,
    "inspector/promises"_s,
    "module"_s,
    "net"_s,
    "node:sqlite"_s,
    "os"_s,
    "path"_s,
    "path/posix"_s,
    "path/win32"_s,
    "perf_hooks"_s,
    "process"_s,
    "punycode"_s,
    "querystring"_s,
    "readline"_s,
    "readline/promises"_s,
    "repl"_s,
    "stream"_s,
    "stream/consumers"_s,
    "stream/promises"_s,
    "stream/web"_s,
    "string_decoder"_s,
    "sys"_s,
    "timers"_s,
    "timers/promises"_s,
    "tls"_s,
    "trace_events"_s,
    "tty"_s,
    "undici"_s,
    "url"_s,
    "util"_s,
    "util/types"_s,
    "v8"_s,
    "vm"_s,
    "wasi"_s,
    "worker_threads"_s,
    "ws"_s,
    "zlib"_s,
};

template<std::size_t N, class T> consteval std::size_t countof(T (&)[N])
{
    return N;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeModuleModuleCall,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeModuleModuleConstructor,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{

    // In node, this is supposed to be the actual CommonJSModule constructor.
    // We are cutting a huge corner by not doing all that work.
    // This code is only to support babel.
    auto& vm = JSC::getVM(globalObject);
    JSString* idString = JSC::jsString(vm, WTF::String("."_s));

    JSString* dirname = jsEmptyString(vm);

    // TODO: handle when JSGlobalObject !== Zig::GlobalObject, such as in node:vm
    Structure* structure = static_cast<Zig::GlobalObject*>(globalObject)
                               ->CommonJSModuleObjectStructure();

    // TODO: handle ShadowRealm, node:vm, new.target, subclasses
    JSValue idValue = callFrame->argument(0);
    JSValue parentValue = callFrame->argument(1);

    auto scope = DECLARE_THROW_SCOPE(vm);
    if (idValue.isString()) {
        idString = idValue.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        auto index = idString->tryGetValue()->reverseFind('/', idString->length());

        if (index != WTF::notFound) {
            dirname = JSC::jsSubstring(globalObject, idString, 0, index);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    auto* out = Bun::JSCommonJSModule::create(vm, structure, idString, jsNull(),
        dirname, SourceCode());
    // A module made in a Bun.ModuleGraph's context is that graph's: what it requires and compiles
    // loads into the graph, over the graph's `globals`.
    out->setModuleGraph(vm, Bun::currentModuleGraph(defaultGlobalObject(globalObject)));

    if (!parentValue.isUndefined()) {
        out->putDirect(vm, JSC::Identifier::fromString(vm, "parent"_s), parentValue,
            0);
    }

    out->putDirect(vm, JSC::Identifier::fromString(vm, "exports"_s),
        JSC::constructEmptyObject(globalObject), 0);

    return JSValue::encode(out);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBuiltinModule,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue moduleName = callFrame->argument(0);
    if (!moduleName.isString()) {
        return JSValue::encode(jsBoolean(false));
    }

    auto moduleStr = moduleName.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsBoolean(false)));

    return JSValue::encode(jsBoolean(Bun::isBuiltinModule(moduleStr)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionWrap, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* code = callFrame->argument(0).toStringOrNull(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!code) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSString* prefix = jsString(
        vm,
        String(
            "(function (exports, require, module, __filename, __dirname) { "_s));
    JSString* suffix = jsString(vm, String("\n});"_s));

    RELEASE_AND_RETURN(scope, JSValue::encode(jsString(globalObject, prefix, code, suffix)));
}
extern "C" BunString Bun__Node__Path_joinWTF(const BunString* lhs, const char* rhs, size_t len);
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeModuleCreateRequire,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) {
        return Bun::throwError(globalObject, scope,
            Bun::ErrorCode::ERR_MISSING_ARGS,
            "createRequire() requires at least one argument"_s);
    }

    auto argument = callFrame->uncheckedArgument(0);
    auto val = argument.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (!isAbsolutePath(val)) {
        WTF::URL url(val);
        if (!url.isValid()) {
            ERR::INVALID_ARG_VALUE(scope, globalObject,
                "filename"_s, argument,
                "must be a file URL object, file URL string, or absolute path string"_s);
            RELEASE_AND_RETURN(scope, {});
        }
        if (!url.protocolIsFile()) {
            ERR::INVALID_ARG_VALUE(scope, globalObject,
                "filename"_s, argument,
                "must be a file URL object, file URL string, or absolute path string"_s);
            RELEASE_AND_RETURN(scope, {});
        }
        val = url.fileSystemPath();
    }

    bool trailingSlash = val.endsWith('/');
#if OS(WINDOWS)
    if (val.endsWith('\\')) {
        trailingSlash = true;
    }
#endif

    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/modules/cjs/loader.js#L1603-L1620
    if (trailingSlash) {
        BunString lhs = Bun::toString(val);
        val = Bun__Node__Path_joinWTF(&lhs, "noop.js", sizeof("noop.js") - 1).transferToWTFString();
    }

    // Called in a Bun.ModuleGraph's context: that graph's require().
    JSObject* require = Bun::JSCommonJSModule::createBoundRequireFunction(vm, globalObject, val, Bun::currentModuleGraph(defaultGlobalObject(globalObject)));
    if (Bun::hasCompiledModules()) [[unlikely]] {
        RETURN_IF_EXCEPTION(scope, {});
        Bun::didCreateRequire(vm, callFrame, require);
    }
    RETURN_IF_EXCEPTION(scope, {});
    // Node gives the module behind the function its `paths` here, from Module._nodeModulePaths as it stands.
    auto* bound = dynamicDowncast<JSC::JSBoundFunction>(require);
    if (auto* module = bound ? dynamicDowncast<Bun::JSCommonJSModule>(bound->boundThis()) : nullptr) {
        Bun::setModulePathsFromReplacedNodeModulePaths(defaultGlobalObject(globalObject), module);
        RETURN_IF_EXCEPTION(scope, {});
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(require));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionResolveFileName,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    switch (callFrame->argumentCount()) {
    case 0: {
        // not "requires" because "require" could be confusing
        JSC::throwTypeError(globalObject, scope, "Module._resolveFilename needs 2+ arguments (a string)"_s);
        return {};
    }
    default: {
        JSC::JSValue moduleName = callFrame->argument(0);
        JSC::JSValue parentValue = callFrame->argument(1);
        JSC::JSValue fromValue = parentValue;
        JSC::JSValue optionsValue = callFrame->argument(3); // 4th argument is options
        auto& names = builtinNames(vm);

        if (moduleName.isUndefinedOrNull()) {
            JSC::throwTypeError(globalObject, scope, "Module._resolveFilename expects a string"_s);
            return {};
        }

        // Extract filename string from fromValue
        // Follows pattern: typeof this === "string" ? this : (this?.filename ?? this?.id ?? "")
        if (!fromValue.isString()) {
            if (
                // fast path: it's a real CommonJS module object.
                auto* cjs = dynamicDowncast<Bun::JSCommonJSModule>(fromValue)) {
                fromValue = cjs->filename();
            } else if (fromValue.isObject()) {
                // slow path: userland code did something weird. Try filename first, then id
                auto* obj = fromValue.getObject();
                auto filenameValue = obj->getIfPropertyExists(globalObject, names.filenamePublicName());
                RETURN_IF_EXCEPTION(scope, {});

                if (filenameValue && filenameValue.isString()) {
                    fromValue = filenameValue;
                } else {
                    auto idValue = obj->getIfPropertyExists(globalObject, vm.propertyNames->id);
                    RETURN_IF_EXCEPTION(scope, {});

                    if (idValue && idValue.isString()) {
                        fromValue = idValue;
                    } else {
                        // Fallback to empty string if no valid filename or id
                        fromValue = jsEmptyString(vm);
                    }
                }
            } else {
                // Not a string, not an object - use empty string
                fromValue = jsEmptyString(vm);
            }
        }

        // Handle options.paths if provided
        JSC::JSValue pathsValue = JSC::jsUndefined();
        if (optionsValue.isObject()) {
            pathsValue = optionsValue.getObject()->get(globalObject, JSC::Identifier::fromString(vm, "paths"_s));
            RETURN_IF_EXCEPTION(scope, {});
        }

        JSC::EncodedJSValue result;

        // If paths are provided, use Bun__resolveSyncWithPaths
        if (!pathsValue.isUndefinedOrNull()) {
            // Node.js requires options.paths to be an array
            bool pathsIsArray = JSC::isArray(globalObject, pathsValue);
            RETURN_IF_EXCEPTION(scope, {});
            if (!pathsIsArray) {
                Bun::throwError(globalObject, scope,
                    Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
                    "options.paths must be an array"_s);
                return {};
            }

            WTF::Vector<BunString> paths;

            // Iterate through the array using forEachInIterable
            forEachInIterable(globalObject, pathsValue, [&](JSC::VM&, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue item) {
                if (scope.exception())
                    return;

                WTF::String pathStr = item.toWTFString(lexicalGlobalObject);
                if (scope.exception())
                    return;

                BunString pathRef = Bun::toStringRef(pathStr);
                if (!Bun::tryAppendWithinLimit(paths, pathRef)) [[unlikely]] {
                    pathRef.deref();
                    throwOutOfMemoryError(lexicalGlobalObject, scope);
                }
            });

            if (scope.exception()) {
                // Clean up on exception
                for (auto& path : paths) {
                    path.deref();
                }
                return {};
            }

            if (Bun::isNodeModulePathsReplaced(defaultGlobalObject(globalObject))) [[unlikely]]
                result = Bun::resolveFromPathsOption(globalObject, moduleName, fromValue, paths.span(), true);
            else
                result = Bun__resolveSyncWithPaths(globalObject, JSC::JSValue::encode(moduleName), JSValue::encode(fromValue), false, true, paths.begin(), paths.size());

            // Clean up BunStrings to avoid leaking
            for (auto& path : paths) {
                path.deref();
            }

            RETURN_IF_EXCEPTION(scope, {});

            if (!JSC::JSValue::decode(result).isString()) {
                JSC::throwException(globalObject, scope, JSC::JSValue::decode(result));
                return {};
            }

            return result;
        }

        // No paths provided: the `paths` of the parent, or the directories above its file.
        result = Bun::resolveForRequire(globalObject, moduleName, parentValue, fromValue, true);
        RETURN_IF_EXCEPTION(scope, {});

        if (!JSC::JSValue::decode(result).isString()) {
            JSC::throwException(globalObject, scope, JSC::JSValue::decode(result));
            return {};
        }

        return result;
    }
    }
}

JSC_DEFINE_CUSTOM_GETTER(nodeModuleResolveFilename,
    (JSGlobalObject * lexicalGlobalObject,
        EncodedJSValue thisValue,
        PropertyName propertyName))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (globalObject->hasOverriddenModuleResolveFilenameFunction()) [[unlikely]] {
        return JSValue::encode(globalObject->m_moduleResolveFilenameOverride.get());
    }
    return JSValue::encode(
        globalObject->m_moduleResolveFilenameFunction.getInitializedOnMainThread(
            globalObject));
}

JSC_DEFINE_CUSTOM_SETTER(setNodeModuleResolveFilename,
    (JSGlobalObject * lexicalGlobalObject,
        EncodedJSValue thisValue, EncodedJSValue encodedValue,
        PropertyName propertyName))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto value = JSValue::decode(encodedValue);
    bool isOriginal = false;
    if (value.isCallable()) {
        JSC::CallData callData = JSC::getCallData(value);

        if (callData.type == JSC::CallData::Type::Native) {
            if (callData.native.function.untaggedPtr() == &jsFunctionResolveFileName) {
                isOriginal = true;
            }
        }
    }

    auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    Bun::willChangeRequireOverride(globalObject, JSC::AOT::RequireOverride::ResolveFilename, !isOriginal);
    RETURN_IF_EXCEPTION(scope, false);

    if (isOriginal) {
        globalObject->commonJSResolveFlags &= ~Zig::GlobalObject::ModuleResolveFilenameReplaced;
        globalObject->m_moduleResolveFilenameOverride.clear();
    } else {
        globalObject->m_moduleResolveFilenameOverride.set(
            lexicalGlobalObject->vm(), globalObject, value);
        globalObject->commonJSResolveFlags |= Zig::GlobalObject::ModuleResolveFilenameReplaced;
    }

    return true;
}

bool isNodeModulePathsReplaced(Zig::GlobalObject* globalObject)
{
    // Nobody has loaded node:module, so nobody has written to it.
    if (!globalObject->m_nodeModuleConstructor.isInitialized())
        return false;
    // The function lies in the static table of the class. It becomes a property of the object when script writes one there or lists the properties.
    JSValue stored = globalObject->m_nodeModuleConstructor.get(globalObject)->getDirect(JSC::getVM(globalObject), globalObject->nodeModulePathsName);
    if (!stored)
        return false;
    JSC::CallData callData = JSC::getCallData(stored);
    return callData.type != JSC::CallData::Type::Native || callData.native.function.untaggedPtr() != &Bun::Bindgen::Generated::ResolverJsc::jsNodeModulePaths;
}

// Module._nodeModulePaths(from), as the program has replaced it.
static JSValue callReplacedNodeModulePaths(Zig::GlobalObject* globalObject, JSValue from)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* constructor = globalObject->m_nodeModuleConstructor.getInitializedOnMainThread(globalObject);
    JSValue function = constructor->get(globalObject, globalObject->nodeModulePathsName);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::CallData callData = JSC::getCallData(function);
    if (callData.type == JSC::CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, "Module._nodeModulePaths is not a function"_s);
        return {};
    }
    MarkedArgumentBuffer args;
    args.append(from);
    RELEASE_AND_RETURN(scope, JSC::profiledCall(globalObject, ProfilingReason::API, function, callData, constructor, args));
}

void setModulePathsFromReplacedNodeModulePaths(Zig::GlobalObject* globalObject, JSCommonJSModule* module)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (module->m_paths || !isNodeModulePathsReplaced(globalObject))
        return;
    JSValue paths = callReplacedNodeModulePaths(globalObject, module->m_dirname.get());
    RETURN_IF_EXCEPTION(scope, );
    module->m_paths.set(vm, module, paths);
    globalObject->commonJSResolveFlags |= Zig::GlobalObject::ModulePathsSeenByScript;
}

// What Node makes of the `paths` of a module.
struct LookupPathsOfParent {
    WTF::Vector<BunString, 16> directories;
    // The list goes on with an entry that is not a string: Node's Module._findPath throws for it once the search gets there.
    bool endsAtInvalidEntry { false };
    // `paths` is a string, which has a length and is no list: Node throws a TypeError.
    bool isText { false };
    // The part of `directories` that Module._nodeModulePaths() lists for the directory of the parent's file.
    size_t aboveImporterStart { 0 };
    size_t aboveImporterEnd { 0 };

    ~LookupPathsOfParent()
    {
        for (auto& directory : directories)
            directory.deref();
    }

    void findDirectoriesAboveImporter(const String& filename)
    {
        BunString filenameString = Bun::toString(filename);
        if (!Resolver__nodeModulePathsRun(&filenameString, directories.begin(), directories.size(), &aboveImporterStart, &aboveImporterEnd))
            aboveImporterStart = aboveImporterEnd = 0;
    }

    // Script has left the list as Module._nodeModulePaths() made it.
    bool isUnchanged() const { return !isText && !endsAtInvalidEntry && !aboveImporterStart && aboveImporterEnd && aboveImporterEnd == directories.size(); }
};

// Appends the directories of `list`, the `paths` of a module, up to the first entry that is not a string. `false`: an exception was thrown.
static bool appendLookupPaths(JSGlobalObject* globalObject, JSValue list, LookupPathsOfParent& paths, bool skipsListed = false)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& directories = paths.directories;
    JSObject* object = list.getObject();
    if (!object) {
        // Node reads `paths.length`. Any value but a string has none: no directory is listed.
        paths.isText = list.isString() && asString(list)->length();
        return true;
    }
    auto* array = dynamicDowncast<JSArray>(object);
    uint64_t length;
    if (array) {
        length = array->length();
    } else {
        JSValue lengthValue = object->get(globalObject, vm.propertyNames->length);
        RETURN_IF_EXCEPTION(scope, false);
        length = lengthValue.toLength(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
    }
    for (uint64_t i = 0; i < length; i++) {
        JSValue entry = array ? array->tryGetIndexQuickly(i) : JSValue();
        if (!entry) [[unlikely]] {
            entry = object->get(globalObject, i);
            RETURN_IF_EXCEPTION(scope, false);
        }
        if (!entry.isString()) {
            paths.endsAtInvalidEntry = true;
            return true;
        }
        String directory = asString(entry)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        if (skipsListed && directories.containsIf([&](const BunString& listed) { return listed.toWTFString(BunString::ZeroCopy) == directory; }))
            continue;
        BunString directoryRef = Bun::toStringRef(directory);
        if (!Bun::tryAppendWithinLimit(directories, directoryRef)) [[unlikely]] {
            directoryRef.deref();
            throwOutOfMemoryError(globalObject, scope);
            return false;
        }
    }
    return true;
}

static JSC::EncodedJSValue resolveFromLookupPaths(JSGlobalObject* globalObject, JSValue request, JSValue from, JSValue list, LookupPathsOfParent& paths, bool isRequireResolve)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    if (paths.isText) {
        throwTypeError(globalObject, scope, "The \"paths\" of a module must be an array of strings"_s);
        return {};
    }
    bool reachedInvalidEntry = false;
    JSC::EncodedJSValue result = Bun__resolveSyncFromLookupPaths(globalObject, JSValue::encode(request), JSValue::encode(from), isRequireResolve, paths.directories.begin(), paths.directories.size(), paths.aboveImporterStart, paths.aboveImporterEnd, paths.endsAtInvalidEntry, &reachedInvalidEntry);
    RETURN_IF_EXCEPTION(scope, {});
    if (reachedInvalidEntry) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "paths"_s, "array of strings"_s, list);
    RELEASE_AND_RETURN(scope, result);
}

// Node looks a request up in the `paths` of the parent unless it is a relative path (Module._resolveLookupPaths) or a whole one (Module._findPath).
static bool isLookedUpInPaths(StringView request)
{
    if (request.isEmpty() || request[0] == '/')
        return false;
    if (request[0] == '.') {
        if (request.length() == 1 || request[1] == '.' || request[1] == '/')
            return false;
#if OS(WINDOWS)
        if (request[1] == '\\')
            return false;
#endif
    }
#if OS(WINDOWS)
    if (request[0] == '\\' || (request.length() > 2 && request[1] == ':' && (request[2] == '/' || request[2] == '\\')))
        return false;
#endif
    return true;
}

JSC::EncodedJSValue resolveForRequire(JSC::JSGlobalObject* globalObject, JSC::JSValue request, JSC::JSValue parent, JSC::JSValue from, bool isRequireResolve)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* module = dynamicDowncast<JSCommonJSModule>(parent);
    // A module looks in the directories above its file until script reads or writes its `paths`.
    bool mayHaveOwnList = module ? !!module->m_paths : parent.isObject();
    JSValue list;
    if (mayHaveOwnList && request.isString()) {
        auto view = asString(request)->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (isLookedUpInPaths(view)) {
            list = module ? module->m_paths.get() : asObject(parent)->get(globalObject, builtinNames(vm).pathsPublicName());
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    // So does a parent without `paths`.
    if (!list || list.isUndefinedOrNull())
        RELEASE_AND_RETURN(scope, Bun__resolveSync(globalObject, JSValue::encode(request), JSValue::encode(from), false, isRequireResolve));

    LookupPathsOfParent paths;
    appendLookupPaths(globalObject, list, paths);
    RETURN_IF_EXCEPTION(scope, {});
    String filename = from.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    paths.findDirectoriesAboveImporter(filename);
    // So does a parent whose `paths` are the `node_modules` directories above its file, as they are until script changes them.
    if (paths.isUnchanged())
        RELEASE_AND_RETURN(scope, Bun__resolveSync(globalObject, JSValue::encode(request), JSValue::encode(from), false, isRequireResolve));

    // Node's require() asks its `relativeResolveCache` before it reads `paths`. An onResolve plugin is asked on every call.
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    if (!isRequireResolve && module && zigGlobalObject->onResolvePlugins.isEmpty()) {
        JSValue loaded = loadedModuleForRequest(zigGlobalObject, module, asString(request));
        RETURN_IF_EXCEPTION(scope, {});
        if (loaded)
            return JSValue::encode(loaded);
    }
    RELEASE_AND_RETURN(scope, resolveFromLookupPaths(globalObject, request, from, list, paths, isRequireResolve));
}

JSC::EncodedJSValue resolveFromPathsOption(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSValue request, JSC::JSValue from, std::span<const BunString> paths, bool isRequireResolve)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (request.isString()) {
        auto text = asString(request)->value(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        // Node looks for a relative request in each of `paths` itself, and answers for a builtin before it reads them.
        if (!isLookedUpInPaths(text.data) || Bun::isBuiltinModule(text.data))
            RELEASE_AND_RETURN(scope, Bun__resolveSyncWithPaths(lexicalGlobalObject, JSValue::encode(request), JSValue::encode(from), false, isRequireResolve, paths.data(), paths.size()));
    }

    LookupPathsOfParent lookup;
    JSValue list;
    for (auto& path : paths) {
        list = callReplacedNodeModulePaths(globalObject, jsString(vm, path.toWTFString(BunString::ZeroCopy)));
        RETURN_IF_EXCEPTION(scope, {});
        appendLookupPaths(globalObject, list, lookup, true);
        RETURN_IF_EXCEPTION(scope, {});
        if (lookup.endsAtInvalidEntry || lookup.isText)
            break;
    }
    String filename = from.toWTFString(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    lookup.findDirectoriesAboveImporter(filename);
    RELEASE_AND_RETURN(scope, resolveFromLookupPaths(lexicalGlobalObject, request, from, list, lookup, isRequireResolve));
}

PathResolveModule getParent(VM& vm, JSGlobalObject* global, JSValue maybe_parent)
{
    PathResolveModule value { nullptr, nullptr, false };

    if (!maybe_parent) {
        return value;
    }

    auto parent = maybe_parent.getObject();
    if (!parent) {
        return value;
    }

    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto& builtinNames = Bun::builtinNames(vm);
    JSValue paths = parent->get(global, builtinNames.pathsPublicName());
    RETURN_IF_EXCEPTION(scope, value);
    if (paths.isCell()) {
        value.paths = dynamicDowncast<JSArray>(paths);
    }

    JSValue filename = parent->get(global, builtinNames.filenamePublicName());
    RETURN_IF_EXCEPTION(scope, value);
    if (filename.isString()) {
        value.filename = filename.toString(global);
    }
    RELEASE_AND_RETURN(scope, value);
}

// https://github.com/nodejs/node/blob/40ef9d541ed79470977f90eb445c291b95ab75a0/lib/internal/modules/cjs/loader.js#L895
JSC_DEFINE_HOST_FUNCTION(jsFunctionResolveLookupPaths,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String request = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // A builtin name is short, so a request whose UTF-8 form does not fit in a buffer is not one.
    if (auto utf8 = UTF8View::tryCreate(request)) {
        auto span = utf8->span();
        if (ModuleLoader__isBuiltin(span.data(), span.size())) {
            return JSC::JSValue::encode(JSC::jsNull());
        }
    }

    PathResolveModule parent = getParent(vm, globalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(resolveLookupPaths(globalObject, request, parent)));
}

JSC::JSValue resolveLookupPaths(JSC::JSGlobalObject* globalObject, String request, PathResolveModule parent)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Check for node modules paths.
    if (request.codeUnitAt(0) != '.' || (request.length() > 1 && request.codeUnitAt(1) != '.' && request.codeUnitAt(1) != '/' &&
#if OS(WINDOWS)
            request.codeUnitAt(1) != '\\'
#else
            true
#endif
            )) {
        if (parent.paths) {
            auto array = JSC::constructArray(globalObject, (ArrayAllocationProfile*)nullptr, nullptr, 0);
            RETURN_IF_EXCEPTION(scope, {});
            auto len = parent.paths->length();
            for (size_t i = 0; i < len; i++) {
                auto path = parent.paths->getIndex(globalObject, i);
                RETURN_IF_EXCEPTION(scope, {});
                array->push(globalObject, path);
                RETURN_IF_EXCEPTION(scope, {});
            }
            RELEASE_AND_RETURN(scope, array);
        } else if (parent.pathsArrayLazy && parent.filename) {
            auto filenameValue = parent.filename->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto filename = Bun::toString(filenameValue);
            auto paths = JSValue::decode(Resolver__nodeModulePathsJSValue(&filename, globalObject, true));
            RELEASE_AND_RETURN(scope, paths);
        } else {
            auto array = JSC::constructEmptyArray(globalObject, nullptr, 0);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, array);
        }
    }

    JSValue dirname;
    if (parent.filename) {
        dirname = Bun::pathDirname(globalObject, parent.filename);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        dirname = jsString(vm, String("."_s));
    }

    JSValue values[] = { dirname };
    auto array = JSC::constructArray(globalObject, (ArrayAllocationProfile*)nullptr, values, 1);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, array);
}

extern "C" JSC::EncodedJSValue NodeModuleModule__findPath(JSGlobalObject*,
    const BunString*, JSArray*);

JSC_DEFINE_HOST_FUNCTION(jsFunctionFindPath, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue request_value = callFrame->argument(0);
    JSValue paths_value = callFrame->argument(1);

    String request = request_value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    BunString request_bun_str = Bun::toString(request);

    JSArray* paths = paths_value.isCell() ? dynamicDowncast<JSArray>(paths_value) : nullptr;

    return NodeModuleModule__findPath(globalObject, &request_bun_str, paths);
}

// These two setters are only used if you directly hit
// `Module.prototype.require` or `module.require`. When accessing the cjs
// require argument, this is a bound version of `require`, which calls into the
// overridden one.
//
// This require function also intentionally does not have .resolve on it, nor
// does it have any of the other properties.
//
// Note: allowing require to be overridable at all is only needed for Next.js to
// work (they do Module.prototype.require = ...)

JSC_DEFINE_CUSTOM_GETTER(getterRequireFunction,
    (JSC::JSGlobalObject * globalObject,
        JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    return JSValue::encode(globalObject->getDirect(
        globalObject->vm(), WebCore::clientData(globalObject->vm())->builtinNames().overridableRequirePrivateName()));
}

JSC_DEFINE_CUSTOM_SETTER(setterRequireFunction,
    (JSC::JSGlobalObject * globalObject,
        JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value,
        JSC::PropertyName propertyName))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Bun::willChangeRequireOverride(globalObject, JSC::AOT::RequireOverride::RequireFunction, true);
    RETURN_IF_EXCEPTION(scope, false);
    globalObject->putDirect(globalObject->vm(),
        WebCore::clientData(globalObject->vm())
            ->builtinNames()
            .overridableRequirePrivateName(),
        JSValue::decode(value), 0);
    return true;
}

static JSValue getModuleCacheObject(VM& vm, JSObject* moduleObject)
{
    // See getBuiltinModulesObject for why this needs a top exception scope.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(moduleObject->globalObject());
    JSValue cache = Bun::requireCacheOf(globalObject, Bun::testFileModuleGraph(globalObject), nullptr);
    // An executable compiled ahead of time whose code never names the cache lacks the function that makes it. Its own files are never listed, so the cache is empty.
    if (!cache && vm.hasCompiledCode() && scope.tryClearException())
        return JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return cache;
}

static JSValue getModuleExtensionsObject(VM& vm, JSObject* moduleObject)
{
    return uncheckedDowncast<Zig::GlobalObject>(moduleObject->globalObject())
        ->lazyRequireExtensionsObject();
}

static JSValue getModuleDebugObject(VM& vm, JSObject* moduleObject)
{
    return JSC::constructEmptyObject(moduleObject->globalObject());
}

static JSValue getPathCacheObject(VM& vm, JSObject* moduleObject)
{
    auto* globalObject = defaultGlobalObject(moduleObject->globalObject());
    return JSC::constructEmptyObject(
        vm, globalObject->nullPrototypeObjectStructure());
}

static JSValue getBuiltinModulesObject(VM& vm, JSObject* moduleObject)
{
    // reifyAllStaticProperties calls PropertyCallback builders without checking for exceptions, so check here.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    MarkedArgumentBuffer args;
    args.ensureCapacity(countof(builtinModuleNames));

    for (unsigned i = 0; i < countof(builtinModuleNames); ++i) {
        args.append(JSC::jsOwnedString(vm, String(builtinModuleNames[i])));
    }

    auto* globalObject = defaultGlobalObject(moduleObject->globalObject());
    auto* builtinModules = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), JSC::ArgList(args));
    RETURN_IF_EXCEPTION(scope, {});
    return builtinModules;
}

static JSValue getConstantsObject(VM& vm, JSObject* moduleObject)
{
    auto* globalObject = defaultGlobalObject(moduleObject->globalObject());
    auto* compileCacheStatus = JSC::constructEmptyObject(
        vm, globalObject->nullPrototypeObjectStructure());
    compileCacheStatus->putDirect(vm, JSC::Identifier::fromString(vm, "FAILED"_s),
        JSC::jsNumber(0));
    compileCacheStatus->putDirect(
        vm, JSC::Identifier::fromString(vm, "ENABLED"_s), JSC::jsNumber(1));
    compileCacheStatus->putDirect(
        vm, JSC::Identifier::fromString(vm, "ALREADY_ENABLED"_s),
        JSC::jsNumber(2));
    compileCacheStatus->putDirect(
        vm, JSC::Identifier::fromString(vm, "DISABLED"_s), JSC::jsNumber(3));

    auto* constantsObject = JSC::constructEmptyObject(
        vm, globalObject->nullPrototypeObjectStructure());
    constantsObject->putDirect(
        vm, JSC::Identifier::fromString(vm, "compileCacheStatus"_s),
        compileCacheStatus);
    return constantsObject;
}

static JSValue getGlobalPathsObject(VM& vm, JSObject* moduleObject)
{
    // See getBuiltinModulesObject for why this needs a top exception scope.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* globalPaths = JSC::constructEmptyArray(
        moduleObject->globalObject(),
        static_cast<ArrayAllocationProfile*>(nullptr), 0);
    RETURN_IF_EXCEPTION(scope, {});
    return globalPaths;
}

// Like the _resolveFilename / runMain setters: writing back the default (e.g. copying Module's statics onto a
// subclass, as jest-runtime does) is not an override.
// A wrapper that is not the default is a string compiled around every CommonJS module.
static void setModuleWrapper(Zig::GlobalObject* global, JSC::ThrowScope& scope, String&& start, String&& end)
{
    bool isOverride = start != commonJSDefaultWrapperStart || end != commonJSDefaultWrapperEnd;
    // A compiled program that runs nothing but its own code compiles no module from text: the wrapper goes around nothing.
    if (isOverride && !Bun::isCodeGenerationDisallowedByCompiledProgram()) [[unlikely]] {
        THROW_AND_RETURN_IF_CODE_GENERATION_FROM_STRINGS_IS_STRICT(global, scope);
    }
    global->hasOverriddenModuleWrapper = isOverride;
    global->m_moduleWrapperStart = WTF::move(start);
    global->m_moduleWrapperEnd = WTF::move(end);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSetCJSWrapperItem, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue a = callFrame->argument(0);
    JSValue b = callFrame->argument(1);
    Zig::GlobalObject* global = defaultGlobalObject(globalObject);
    String aString = a.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String bString = b.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    setModuleWrapper(global, scope, WTF::move(aString), WTF::move(bString));
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(nodeModuleWrapper,
    (JSGlobalObject * global,
        EncodedJSValue thisValue,
        PropertyName propertyName))
{
    // This does not cache anything because it is assumed nobody reads it more than once.
    VM& vm = global->vm();
    JSC::JSFunction* cb = JSC::JSFunction::create(vm, global, WebCore::commonJSGetWrapperArrayProxyCodeGenerator(vm), global);
    JSC::CallData callData = JSC::getCallData(cb);

    JSC::MarkedArgumentBuffer args;
    args.append(JSFunction::create(
        vm, global, 1, "onMutate"_s,
        jsFunctionSetCJSWrapperItem, JSC::ImplementationVisibility::Public,
        JSC::NoIntrinsic));
    args.append(jsString(vm, String(commonJSDefaultWrapperStart)));
    args.append(jsString(vm, String(commonJSDefaultWrapperEnd)));

    auto scope = DECLARE_THROW_SCOPE(vm);
    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::profiledCall(global, JSC::ProfilingReason::API, cb, callData, JSC::jsUndefined(), args, returnedException);
    if (returnedException) {
        // The builtin does not throw on its own; what comes back is a
        // termination (or stack exhaustion) that the getter's caller must see.
        JSC::throwException(global, scope, returnedException.get());
        return {};
    }
    ASSERT(result.isCell());
    return JSC::JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_SETTER(setNodeModuleWrapper,
    (JSGlobalObject * lexicalGlobalObject,
        EncodedJSValue thisValue, EncodedJSValue encodedValue,
        PropertyName propertyName))
{
    auto v = JSValue::decode(encodedValue);
    if (!v.isObject()) return false;
    auto o = v.getObject();
    if (!o) return false;

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    auto a = o->getIndex(globalObject, 0);
    RETURN_IF_EXCEPTION(scope, false);
    auto b = o->getIndex(globalObject, 1);
    RETURN_IF_EXCEPTION(scope, false);
    auto astring = a.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    auto bstring = b.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    setModuleWrapper(globalObject, scope, WTF::move(astring), WTF::move(bstring));
    RETURN_IF_EXCEPTION(scope, false);
    return true;
}

static JSValue getModulePrototypeObject(VM& vm, JSObject* moduleObject)
{
    auto* globalObject = defaultGlobalObject(moduleObject->globalObject());
    auto prototype = constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);

    prototype->putDirectCustomAccessor(
        vm, WebCore::clientData(vm)->builtinNames().requirePublicName(),
        JSC::CustomGetterSetter::create(vm, getterRequireFunction,
            setterRequireFunction),
        0);

    Bun::putDirectNamed(vm, prototype, "_compile"_s, globalObject->modulePrototypeUnderscoreCompileFunction());

    return prototype;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionLoad, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" void Bun__VirtualMachine__setOverrideModuleRunMainPromise(void* bunVM, JSPromise* promise);
JSC_DEFINE_HOST_FUNCTION(jsFunctionRunMain, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto name = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // JSC::loadAndEvaluateModule() takes a key.
    auto key = globalObject->moduleLoader()->resolve(globalObject, JSC::Identifier::fromString(vm, name), {}, nullptr, /* useImportMap */ true);
    RETURN_IF_EXCEPTION(scope, {});

    auto* promise = JSC::loadAndEvaluateModule(globalObject, key.string(), nullptr, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    Bun__VirtualMachine__setOverrideModuleRunMainPromise(defaultGlobalObject(globalObject)->bunVM(), promise);

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(moduleRunMain,
    (JSGlobalObject * lexicalGlobalObject,
        EncodedJSValue thisValue,
        PropertyName propertyName))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    return JSValue::encode(
        globalObject->m_moduleRunMainFunction.getInitializedOnMainThread(
            globalObject));
}

extern "C" void Bun__VirtualMachine__setOverrideModuleRunMain(void* bunVM, bool isOriginal);
extern "C" JSC::EncodedJSValue NodeModuleModule__callOverriddenRunMain(Zig::GlobalObject* global, JSValue argv1)
{
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue overrideHandler = global->m_moduleRunMainFunction.get(global);
    auto callData = JSC::getCallData(overrideHandler);
    if (callData.type == JSC::CallData::Type::None) {
        throwException(global, scope, createNotAFunctionError(global, overrideHandler));
        return {};
    }
    MarkedArgumentBuffer args;
    args.append(argv1);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::profiledCall(global, JSC::ProfilingReason::API, overrideHandler, callData, global, args)));
}

JSC_DEFINE_CUSTOM_SETTER(setModuleRunMain,
    (JSGlobalObject * lexicalGlobalObject,
        EncodedJSValue thisValue, EncodedJSValue encodedValue,
        PropertyName propertyName))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto value = JSValue::decode(encodedValue);
    if (value.isCell()) {
        bool isOriginal = false;
        if (value.isCallable()) {
            JSC::CallData callData = JSC::getCallData(value);
            if (callData.type == JSC::CallData::Type::Native) {
                if (callData.native.function.untaggedPtr() == &jsFunctionRunMain) {
                    isOriginal = true;
                }
            }
        }
        Bun__VirtualMachine__setOverrideModuleRunMain(globalObject->bunVM(), !isOriginal);
        globalObject->m_moduleRunMainFunction.set(
            lexicalGlobalObject->vm(), globalObject, value.asCell());
    }

    return true;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionPreloadModules,
    (JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSyncBuiltinESMExports,
    (JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionRegister, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" int32_t Bun__NodeCompileCache__enable(const BunString* dir, int32_t portable, BunString* outDirectory, BunString* outMessage);
extern "C" BunString Bun__NodeCompileCache__getDir();
extern "C" void Bun__NodeCompileCache__flush();

JSC_DEFINE_HOST_FUNCTION(jsFunctionEnableCompileCache,
    (JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Accepts `undefined`, a string, or `{ directory?, portable? }`.
    JSValue options = callFrame->argument(0);
    JSValue directoryValue = options;
    int32_t portable = -1; // -1 = unspecified, Rust falls back to the env var
    if (options.isObject() && !options.isCallable()) {
        auto* optionsObject = options.getObject();
        directoryValue = optionsObject->get(globalObject, JSC::Identifier::fromString(vm, "directory"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue portableValue = optionsObject->get(globalObject, JSC::Identifier::fromString(vm, "portable"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!portableValue.isUndefined()) {
            portable = portableValue.toBoolean(globalObject) ? 1 : 0;
        }
    }

    WTF::String directory;
    if (!directoryValue.isUndefined()) {
        if (!directoryValue.isString()) {
            Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "cacheDir should be a string"_s);
            return {};
        }
        directory = directoryValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    BunString directoryStr = Bun::toString(directory);
    BunString outDirectory = { BunStringTag::Empty, {} };
    BunString outMessage = { BunStringTag::Empty, {} };
    int32_t status = Bun__NodeCompileCache__enable(
        directory.isNull() ? nullptr : &directoryStr, portable, &outDirectory, &outMessage);

    auto* result = JSC::constructEmptyObject(globalObject);
    Bun::putDirectNamed(vm, result, "status"_s, JSC::jsNumber(status));
    if (!outMessage.isEmpty()) {
        JSValue message = outMessage.transferToJS(globalObject);
        if (scope.exception()) [[unlikely]] {
            outDirectory.deref();
            return {};
        }
        Bun::putDirectNamed(vm, result, "message"_s, message);
    }
    if (!outDirectory.isEmpty()) {
        JSValue dir = outDirectory.transferToJS(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        Bun::putDirectNamed(vm, result, "directory"_s, dir);
    }
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionGetCompileCacheDir,
    (JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    BunString dir = Bun__NodeCompileCache__getDir();
    if (dir.isEmpty()) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    return JSC::JSValue::encode(dir.transferToJS(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionFlushCompileCache,
    (JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    Bun__NodeCompileCache__flush();
    return JSC::JSValue::encode(JSC::jsUndefined());
}

static JSValue getModuleObject(VM& vm, JSObject* moduleObject)
{
    return moduleObject;
}

/* Source for NodeModuleModule.lut.h
@begin nodeModuleObjectTable
_cache                  getModuleCacheObject              PropertyCallback
_debug                  getModuleDebugObject              PropertyCallback
_extensions             getModuleExtensionsObject         PropertyCallback
_findPath                jsFunctionFindPath               Function 3
_initPaths              JSBuiltin                         Function|Builtin 0
_load                   jsFunctionLoad                    Function 1
_nodeModulePaths        &Bun::Bindgen::Generated::ResolverJsc::jsNodeModulePaths Function 1
_pathCache              getPathCacheObject                PropertyCallback
_preloadModules         jsFunctionPreloadModules          Function 0
_resolveFilename        nodeModuleResolveFilename         CustomAccessor
_resolveLookupPaths     jsFunctionResolveLookupPaths      Function 2
_stat                   &Bun::Bindgen::Generated::NodeModuleModule::jsStat Function 1
builtinModules          getBuiltinModulesObject           PropertyCallback
constants               getConstantsObject                PropertyCallback
createRequire           jsFunctionNodeModuleCreateRequire Function 1
enableCompileCache      jsFunctionEnableCompileCache      Function 1
findSourceMap           Bun::Bindgen::Generated::Sourcemap::jsFindSourceMap Function 1
flushCompileCache       jsFunctionFlushCompileCache       Function 0
getCompileCacheDir      jsFunctionGetCompileCacheDir      Function 0
globalPaths             getGlobalPathsObject              PropertyCallback
isBuiltin               jsFunctionIsBuiltinModule         Function 1
prototype               getModulePrototypeObject          DontEnum|DontDelete|PropertyCallback
register                jsFunctionRegister                Function 1
runMain                 moduleRunMain                        CustomAccessor
SourceMap               Bun::Bindgen::Generated::Sourcemap::getSourceMapConstructor PropertyCallback
syncBuiltinESMExports   jsFunctionSyncBuiltinESMExports   Function 0
wrap                    jsFunctionWrap                    Function 1
wrapper                 nodeModuleWrapper                 CustomAccessor
Module                  getModuleObject                   PropertyCallback
@end
*/
#include "NodeModuleModule.lut.h"

class JSModuleConstructor : public JSC::InternalFunction {
    using Base = JSC::InternalFunction;

public:
    DECLARE_EXPORT_INFO;
    static constexpr JSC::DestructionMode needsDestruction = DoesNotNeedDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    static JSC::Structure* createStructure(JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        ASSERT(globalObject);
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSModuleConstructor, Base);
        return &vm.internalFunctionSpace();
    }

    static JSModuleConstructor* create(JSC::VM& vm,
        Zig::GlobalObject* globalObject)
    {
        auto* structure = createStructure(vm, globalObject, globalObject->functionPrototype());

        auto* moduleConstructor = new (NotNull, JSC::allocateCell<JSModuleConstructor>(vm))
            JSModuleConstructor(vm, structure);
        moduleConstructor->finishCreation(vm);
        return moduleConstructor;
    }

private:
    JSModuleConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, jsFunctionNodeModuleModuleCall,
              jsFunctionNodeModuleModuleConstructor)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm, 1, "Module"_s,
            PropertyAdditionMode::WithoutStructureTransition);
    }
};

const JSC::ClassInfo JSModuleConstructor::s_info = {
    "Module"_s, &Base::s_info, &nodeModuleObjectTable, nullptr,
    CREATE_METHOD_TABLE(JSModuleConstructor)
};

static JSC::Structure* createNodeModuleSourceMapEntryStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), 6);
    PropertyOffset offset;

    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "generatedLine"), 0, offset);
    RELEASE_ASSERT(offset == 0);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "generatedColumn"), 0, offset);
    RELEASE_ASSERT(offset == 1);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "originalLine"), 0, offset);
    RELEASE_ASSERT(offset == 2);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "originalColumn"), 0, offset);
    RELEASE_ASSERT(offset == 3);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "originalSource"), 0, offset);
    RELEASE_ASSERT(offset == 4);
    structure = Structure::addPropertyTransition(vm, structure, vm.propertyNames->name, 0, offset);
    RELEASE_ASSERT(offset == 5);

    return structure;
}

extern "C" JSC::EncodedJSValue Bun__createNodeModuleSourceMapEntryObject(
    JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue encodedGeneratedLine,
    JSC::EncodedJSValue encodedGeneratedColumn,
    JSC::EncodedJSValue encodedOriginalLine,
    JSC::EncodedJSValue encodedOriginalColumn,
    JSC::EncodedJSValue encodedOriginalSource,
    JSC::EncodedJSValue encodedName)
{
    auto& vm = globalObject->vm();
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSObject* object = JSC::constructEmptyObject(vm, zigGlobalObject->m_nodeModuleSourceMapEntryStructure.getInitializedOnMainThread(zigGlobalObject));
    object->putDirectOffset(vm, 0, JSC::JSValue::decode(encodedGeneratedLine));
    object->putDirectOffset(vm, 1, JSC::JSValue::decode(encodedGeneratedColumn));
    object->putDirectOffset(vm, 2, JSC::JSValue::decode(encodedOriginalLine));
    object->putDirectOffset(vm, 3, JSC::JSValue::decode(encodedOriginalColumn));
    object->putDirectOffset(vm, 4, JSC::JSValue::decode(encodedOriginalSource));
    object->putDirectOffset(vm, 5, JSC::JSValue::decode(encodedName));
    return JSValue::encode(object);
}

static JSC::Structure* createNodeModuleSourceMapOriginStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), 4);
    PropertyOffset offset;

    structure = Structure::addPropertyTransition(vm, structure, vm.propertyNames->name, 0, offset);
    RELEASE_ASSERT(offset == 0);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "line"), 0, offset);
    RELEASE_ASSERT(offset == 1);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "column"), 0, offset);
    RELEASE_ASSERT(offset == 2);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "fileName"), 0, offset);
    RELEASE_ASSERT(offset == 3);

    return structure;
}

extern "C" JSC::EncodedJSValue Bun__createNodeModuleSourceMapOriginObject(
    JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue encodedName,
    JSC::EncodedJSValue encodedLine,
    JSC::EncodedJSValue encodedColumn,
    JSC::EncodedJSValue encodedSource)
{
    auto& vm = globalObject->vm();
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSObject* object = JSC::constructEmptyObject(vm, zigGlobalObject->m_nodeModuleSourceMapOriginStructure.getInitializedOnMainThread(zigGlobalObject));
    object->putDirectOffset(vm, 0, JSC::JSValue::decode(encodedName));
    object->putDirectOffset(vm, 1, JSC::JSValue::decode(encodedLine));
    object->putDirectOffset(vm, 2, JSC::JSValue::decode(encodedColumn));
    object->putDirectOffset(vm, 3, JSC::JSValue::decode(encodedSource));
    return JSValue::encode(object);
}

void addNodeModuleConstructorProperties(JSC::VM& vm,
    Zig::GlobalObject* globalObject)
{
    globalObject->m_nodeModuleConstructor.initLater(
        [](const Zig::GlobalObject::Initializer<JSObject>& init) {
            JSObject* moduleConstructor = JSModuleConstructor::create(
                init.vm, static_cast<Zig::GlobalObject*>(init.owner));
            static_cast<Zig::GlobalObject*>(init.owner)->nodeModulePathsName = Identifier::fromString(init.vm, "_nodeModulePaths"_s);
            init.set(moduleConstructor);
            if (init.vm.hasCompiledCode()) [[unlikely]]
                JSC::AOT::hostDidCreateNodeModule(init.owner, moduleConstructor);
        });

    globalObject->m_nodeModuleSourceMapEntryStructure.initLater(
        [](const Zig::GlobalObject::Initializer<Structure>& init) {
            init.set(createNodeModuleSourceMapEntryStructure(init.vm, init.owner));
        });
    globalObject->m_nodeModuleSourceMapOriginStructure.initLater(
        [](const Zig::GlobalObject::Initializer<Structure>& init) {
            init.set(createNodeModuleSourceMapOriginStructure(init.vm, init.owner));
        });

    globalObject->m_moduleRunMainFunction.initLater(
        [](const Zig::GlobalObject::Initializer<JSCell>& init) {
            JSFunction* runMainFunction = JSFunction::create(
                init.vm, init.owner, 2, "runMain"_s,
                jsFunctionRunMain, JSC::ImplementationVisibility::Public,
                JSC::NoIntrinsic);
            init.set(runMainFunction);
        });

    globalObject->m_moduleResolveFilenameFunction.initLater(
        [](const Zig::GlobalObject::Initializer<JSFunction>& init) {
            JSFunction* resolveFilenameFunction = JSFunction::create(
                init.vm, init.owner, 2, "_resolveFilename"_s,
                jsFunctionResolveFileName, JSC::ImplementationVisibility::Public,
                JSC::NoIntrinsic);
            init.set(resolveFilenameFunction);
        });

    globalObject->m_modulePrototypeUnderscoreCompileFunction.initLater(
        [](const Zig::GlobalObject::Initializer<JSFunction>& init) {
            JSFunction* resolveFilenameFunction = JSFunction::create(
                init.vm, init.owner, 2, "_compile"_s,
                functionJSCommonJSModule_compile, JSC::ImplementationVisibility::Public,
                JSC::NoIntrinsic);
            init.set(resolveFilenameFunction);
        });

    globalObject->m_commonJSRequireESMFromHijackedExtensionFunction.initLater(
        [](const Zig::GlobalObject::Initializer<JSFunction>& init) {
            JSC::JSFunction* requireESM = JSC::JSFunction::create(init.vm, init.owner, commonJSRequireESMFromHijackedExtensionCodeGenerator(init.vm), init.owner);
            init.set(requireESM);
        });

    globalObject->m_lazyRequireExtensionsObject.initLater(
        [](const Zig::GlobalObject::Initializer<Bun::JSCommonJSExtensions>& init) {
            JSC::VM& vm = init.vm;
            JSC::JSGlobalObject* globalObject = init.owner;

            init.set(JSCommonJSExtensions::create(vm, globalObject, JSCommonJSExtensions::createStructure(vm, globalObject, globalObject->nullPrototype())));
        });
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsModuleResolveFilenameSlowPathEnabled,
    (JSGlobalObject * globalObject,
        CallFrame* callframe))
{
    return JSValue::encode(
        jsBoolean(defaultGlobalObject(globalObject)
                ->hasOverriddenModuleResolveFilenameFunction()));
}

extern "C" bool Bun__streamIterEnabled();

// $cpp("NodeModuleModule.cpp", "createStreamIterEnabledFlag"): the write-once
// `--experimental-stream-iter` CLI bit, so builtins don't have to consult the
// user-mutable `process.execArgv`.
JSC::JSValue createStreamIterEnabledFlag(Zig::GlobalObject*)
{
    return JSC::jsBoolean(Bun__streamIterEnabled());
}

} // namespace Bun

namespace Zig {
JSC::JSObject* generateNativeModule_NodeModule(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto* constructor = globalObject->m_nodeModuleConstructor.getInitializedOnMainThread(globalObject);

    // The exports are the static table's enumerable entries, not the constructor's own properties (`length`,
    // `name`, `prototype`, whatever user code assigned onto Module).
    PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    for (const auto& entry : Bun::nodeModuleObjectTableValues) {
        if (entry.attributes() & PropertyAttribute::DontEnum)
            continue;
        properties.add(Identifier::fromString(vm, entry.m_key));
    }

    return exportObjectProperties(globalObject, constructor, properties, exportNames, exportValues);
}

} // namespace Zig
