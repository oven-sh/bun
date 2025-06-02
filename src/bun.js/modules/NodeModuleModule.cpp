#include "root.h"
#include "headers-handwritten.h"
#include "NodeModuleModule.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/JSInternalPromise.h>
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JSCommonJSExtensions.h"

#include "PathInlines.h"
#include "ZigGlobalObject.h"
#include "headers.h"
#include "ErrorCode.h"

#include "GeneratedNodeModuleModule.h"

namespace Bun {

using namespace JSC;

BUN_DECLARE_HOST_FUNCTION(Resolver__nodeModulePathsForJS);
JSC_DECLARE_HOST_FUNCTION(jsFunctionDebugNoop);
JSC_DECLARE_HOST_FUNCTION(jsFunctionFindPath);
JSC_DECLARE_HOST_FUNCTION(jsFunctionFindSourceMap);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsBuiltinModule);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeModuleCreateRequire);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeModuleModuleConstructor);
JSC_DECLARE_HOST_FUNCTION(jsFunctionResolveFileName);
JSC_DECLARE_HOST_FUNCTION(jsFunctionResolveLookupPaths);
JSC_DECLARE_HOST_FUNCTION(jsFunctionSourceMap);
JSC_DECLARE_HOST_FUNCTION(jsFunctionSyncBuiltinExports);
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
    "bun:wrap"_s,
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionDebugNoop,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
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
        }
    }

    auto* out = Bun::JSCommonJSModule::create(vm, structure, idString, jsNull(),
        dirname, SourceCode());

    if (!parentValue.isUndefined()) {
        out->putDirect(vm, JSC::Identifier::fromString(vm, "parent"_s), parentValue,
            0);
    }

    out->putDirect(vm, JSC::Identifier::fromString(vm, "exports"_s),
        JSC::constructEmptyObject(globalObject,
            globalObject->objectPrototype(), 0),
        0);

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

    return JSValue::encode(jsString(globalObject, prefix, code, suffix));
}
extern "C" void Bun__Node__Path_joinWTF(BunString* lhs, const char* rhs,
    size_t len, BunString* result);
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
            RELEASE_AND_RETURN(scope, JSValue::encode({}));
        }
        if (!url.protocolIsFile()) {
            ERR::INVALID_ARG_VALUE(scope, globalObject,
                "filename"_s, argument,
                "must be a file URL object, file URL string, or absolute path string"_s);
            RELEASE_AND_RETURN(scope, JSValue::encode({}));
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
        BunString result;
        Bun__Node__Path_joinWTF(&lhs, "noop.js", sizeof("noop.js") - 1, &result);
        val = result.toWTFString();
        if (!val.isNull()) {
            ASSERT(val.impl()->refCount() == 2);
            val.impl()->deref();
        }
    }

    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(
        scope, JSValue::encode(Bun::JSCommonJSModule::createBoundRequireFunction(vm, globalObject, val)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionFindSourceMap,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSyncBuiltinExports,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSourceMap, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, scope,
        createError(globalObject, "Not implemented"_s));
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionResolveFileName,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);

    switch (callFrame->argumentCount()) {
    case 0: {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        // not "requires" because "require" could be confusing
        JSC::throwTypeError(
            globalObject, scope,
            "Module._resolveFilename needs 2+ arguments (a string)"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    default: {
        JSC::JSValue moduleName = callFrame->argument(0);
        JSC::JSValue fromValue = callFrame->argument(1);

        if (moduleName.isUndefinedOrNull()) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope,
                "Module._resolveFilename expects a string"_s);
            scope.release();
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        if (
            // fast path: it's a real CommonJS module object.
            auto* cjs = jsDynamicCast<Bun::JSCommonJSModule*>(fromValue)) {
            fromValue = cjs->filename();
        } else if
            // slow path: userland code did something weird. lets let them do that
            // weird thing.
            (fromValue.isObject()) {

            if (auto idValue = fromValue.getObject()->getIfPropertyExists(
                    globalObject, builtinNames(vm).filenamePublicName())) {
                if (idValue.isString()) {
                    fromValue = idValue;
                }
            }
        }

        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        auto result = Bun__resolveSync(
            globalObject,
            JSC::JSValue::encode(moduleName), JSValue::encode(fromValue),
            false,
            true);
        RETURN_IF_EXCEPTION(scope, {});

        if (!JSC::JSValue::decode(result).isString()) {
            JSC::throwException(globalObject, scope, JSC::JSValue::decode(result));
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        scope.release();
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
    if (value.isCell()) {
        bool isOriginal = false;
        if (value.isCallable()) {
            JSC::CallData callData = JSC::getCallData(value);

            if (callData.type == JSC::CallData::Type::Native) {
                if (callData.native.function.untaggedPtr() == &jsFunctionResolveFileName) {
                    isOriginal = true;
                }
            }
        }
        globalObject->hasOverriddenModuleResolveFilenameFunction = !isOriginal;
        globalObject->m_moduleResolveFilenameFunction.set(
            lexicalGlobalObject->vm(), globalObject, value.asCell());
    }

    return true;
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
        value.paths = jsDynamicCast<JSArray*>(paths);
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

    auto utf8 = request.utf8();
    if (ModuleLoader__isBuiltin(utf8.data(), utf8.length())) {
        return JSC::JSValue::encode(JSC::jsNull());
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
    if (request.characterAt(0) != '.' || (request.length() > 1 && request.characterAt(1) != '.' && request.characterAt(1) != '/' &&
#if OS(WINDOWS)
            request.characterAt(1) != '\\'
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
                array->push(globalObject, path);
            }
            RELEASE_AND_RETURN(scope, array);
        } else if (parent.pathsArrayLazy && parent.filename) {
            auto filenameValue = parent.filename->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto filename = Bun::toString(filenameValue);
            auto paths = JSValue::decode(Resolver__nodeModulePathsJSValue(filename, globalObject, true));
            RELEASE_AND_RETURN(scope, paths);
        } else {
            auto array = JSC::constructEmptyArray(globalObject, nullptr, 0);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, array);
        }
    }

    JSValue dirname;
    if (parent.filename) {
        EncodedJSValue encodedFilename = JSValue::encode(parent.filename);
#if OS(WINDOWS)
        dirname = JSValue::decode(
            Bun__Path__dirname(globalObject, true, &encodedFilename, 1));
#else
        dirname = JSValue::decode(
            Bun__Path__dirname(globalObject, false, &encodedFilename, 1));
#endif
    } else {
        dirname = jsString(vm, String("."_s));
    }

    JSValue values[] = { dirname };
    auto array = JSC::constructArray(globalObject, (ArrayAllocationProfile*)nullptr, values, 1);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, array);
}

extern "C" JSC::EncodedJSValue NodeModuleModule__findPath(JSGlobalObject*,
    BunString, JSArray*);

JSC_DEFINE_HOST_FUNCTION(jsFunctionFindPath, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue request_value = callFrame->argument(0);
    JSValue paths_value = callFrame->argument(1);

    String request = request_value.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    BunString request_bun_str = Bun::toString(request);

    JSArray* paths = paths_value.isCell() ? jsDynamicCast<JSArray*>(paths_value) : nullptr;

    return NodeModuleModule__findPath(globalObject, request_bun_str, paths);
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
    globalObject->putDirect(globalObject->vm(),
        WebCore::clientData(globalObject->vm())
            ->builtinNames()
            .overridableRequirePrivateName(),
        JSValue::decode(value), 0);
    return true;
}

static JSValue getModuleCacheObject(VM& vm, JSObject* moduleObject)
{
    return jsCast<Zig::GlobalObject*>(moduleObject->globalObject())
        ->lazyRequireCacheObject();
}

static JSValue getModuleExtensionsObject(VM& vm, JSObject* moduleObject)
{
    return jsCast<Zig::GlobalObject*>(moduleObject->globalObject())
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

static JSValue getSourceMapFunction(VM& vm, JSObject* moduleObject)
{
    auto* globalObject = defaultGlobalObject(moduleObject->globalObject());
    JSFunction* sourceMapFunction = JSFunction::create(
        vm, globalObject, 1, "SourceMap"_s, jsFunctionSourceMap,
        ImplementationVisibility::Public, NoIntrinsic, jsFunctionSourceMap);
    return sourceMapFunction;
}

static JSValue getBuiltinModulesObject(VM& vm, JSObject* moduleObject)
{
    MarkedArgumentBuffer args;
    args.ensureCapacity(countof(builtinModuleNames));

    for (unsigned i = 0; i < countof(builtinModuleNames); ++i) {
        args.append(JSC::jsOwnedString(vm, String(builtinModuleNames[i])));
    }

    auto* globalObject = defaultGlobalObject(moduleObject->globalObject());
    return JSC::constructArray(
        globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr),
        JSC::ArgList(args));
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
    return JSC::constructEmptyArray(
        moduleObject->globalObject(),
        static_cast<ArrayAllocationProfile*>(nullptr), 0);
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
    global->m_moduleWrapperStart = aString;
    global->m_moduleWrapperEnd = bString;
    global->hasOverriddenModuleWrapper = true;
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

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::profiledCall(global, JSC::ProfilingReason::API, cb, callData, JSC::jsUndefined(), args, returnedException);
    ASSERT(!returnedException);
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

    globalObject->m_moduleWrapperStart = astring;
    globalObject->m_moduleWrapperEnd = bstring;
    globalObject->hasOverriddenModuleWrapper = true;

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

    return prototype;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionLoad, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

static JSC::EncodedJSValue resolverFunctionCallback(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" void Bun__VirtualMachine__setOverrideModuleRunMainPromise(void* bunVM, JSInternalPromise* promise);
JSC_DEFINE_HOST_FUNCTION(jsFunctionRunMain, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto arg1 = callFrame->argument(0);
    auto name = makeAtomString(arg1.toWTFString(globalObject));

    auto* promise = JSC::loadAndEvaluateModule(globalObject, name, JSC::jsUndefined(), JSC::jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSNativeStdFunction* resolverFunction = JSC::JSNativeStdFunction::create(
        vm, globalObject, 1, String(), resolverFunctionCallback);

    auto result = promise->then(globalObject, resolverFunction, nullptr);
    Bun__VirtualMachine__setOverrideModuleRunMainPromise(defaultGlobalObject(globalObject)->bunVM(), result);

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
    auto overrideHandler = jsCast<JSObject*>(global->m_moduleRunMainFunction.get(global));
    MarkedArgumentBuffer args;
    args.append(argv1);
    return JSC::JSValue::encode(JSC::profiledCall(global, JSC::ProfilingReason::API, overrideHandler, JSC::getCallData(overrideHandler), global, args));
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionEnableCompileCache,
    (JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionGetCompileCacheDir,
    (JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
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
_nodeModulePaths        Resolver__nodeModulePathsForJS    Function 1
_pathCache              getPathCacheObject                PropertyCallback
_preloadModules         jsFunctionPreloadModules          Function 0
_resolveFilename        nodeModuleResolveFilename         CustomAccessor
_resolveLookupPaths     jsFunctionResolveLookupPaths      Function 2
_stat                   &Generated::NodeModuleModule::js_stat Function 1
builtinModules          getBuiltinModulesObject           PropertyCallback
constants               getConstantsObject                PropertyCallback
createRequire           jsFunctionNodeModuleCreateRequire Function 1
enableCompileCache      jsFunctionEnableCompileCache      Function 0
findSourceMap           jsFunctionFindSourceMap           Function 0
getCompileCacheDir      jsFunctionGetCompileCacheDir      Function 0
globalPaths             getGlobalPathsObject              PropertyCallback
isBuiltin               jsFunctionIsBuiltinModule         Function 1
prototype               getModulePrototypeObject          PropertyCallback
register                jsFunctionRegister                Function 1
runMain                 moduleRunMain                        CustomAccessor
SourceMap               getSourceMapFunction              PropertyCallback
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
        return JSC::Structure::create(
            vm, globalObject, prototype,
            JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
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

void addNodeModuleConstructorProperties(JSC::VM& vm,
    Zig::GlobalObject* globalObject)
{
    globalObject->m_nodeModuleConstructor.initLater(
        [](const Zig::GlobalObject::Initializer<JSObject>& init) {
            JSObject* moduleConstructor = JSModuleConstructor::create(
                init.vm, static_cast<Zig::GlobalObject*>(init.owner));
            init.set(moduleConstructor);
        });

    globalObject->m_moduleRunMainFunction.initLater(
        [](const Zig::GlobalObject::Initializer<JSCell>& init) {
            JSFunction* runMainFunction = JSFunction::create(
                init.vm, init.owner, 2, "runMain"_s,
                jsFunctionRunMain, JSC::ImplementationVisibility::Public,
                JSC::NoIntrinsic, jsFunctionRunMain);
            init.set(runMainFunction);
        });

    globalObject->m_moduleResolveFilenameFunction.initLater(
        [](const Zig::GlobalObject::Initializer<JSCell>& init) {
            JSFunction* resolveFilenameFunction = JSFunction::create(
                init.vm, init.owner, 2, "_resolveFilename"_s,
                jsFunctionResolveFileName, JSC::ImplementationVisibility::Public,
                JSC::NoIntrinsic, jsFunctionResolveFileName);
            init.set(resolveFilenameFunction);
        });

    globalObject->m_modulePrototypeUnderscoreCompileFunction.initLater(
        [](const Zig::GlobalObject::Initializer<JSFunction>& init) {
            JSFunction* resolveFilenameFunction = JSFunction::create(
                init.vm, init.owner, 2, "_compile"_s,
                functionJSCommonJSModule_compile, JSC::ImplementationVisibility::Public,
                JSC::NoIntrinsic, functionJSCommonJSModule_compile);
            init.set(resolveFilenameFunction);
        });

    globalObject->m_commonJSRequireESMFromHijackedExtensionFunction.initLater(
        [](const Zig::GlobalObject::Initializer<JSFunction>& init) {
            JSC::JSFunction* requireESM = JSC::JSFunction::create(init.vm, init.owner, commonJSRequireESMFromHijackedExtensionCodeGenerator(init.vm), init.owner);
            init.set(requireESM);
        });

    globalObject->m_lazyRequireCacheObject.initLater(
        [](const Zig::GlobalObject::Initializer<JSObject>& init) {
            JSC::VM& vm = init.vm;
            JSC::JSGlobalObject* globalObject = init.owner;

            auto* function = JSFunction::create(vm, globalObject, static_cast<JSC::FunctionExecutable*>(commonJSCreateRequireCacheCodeGenerator(vm)), globalObject);

            NakedPtr<JSC::Exception> returnedException = nullptr;
            auto result = JSC::profiledCall(globalObject, ProfilingReason::API, function, JSC::getCallData(function), globalObject, ArgList(), returnedException);
            ASSERT(!returnedException);
            init.set(result.toObject(globalObject));
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
                ->hasOverriddenModuleResolveFilenameFunction));
}

} // namespace Bun

namespace Zig {
void generateNativeModule_NodeModule(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto catchScope = DECLARE_CATCH_SCOPE(vm);
    auto* constructor = globalObject->m_nodeModuleConstructor.getInitializedOnMainThread(
        globalObject);
    if (constructor->hasNonReifiedStaticProperties()) {
        constructor->reifyAllStaticProperties(globalObject);
        if (catchScope.exception()) {
            catchScope.clearException();
        }
    }

    exportNames.reserveCapacity(Bun::countof(Bun::nodeModuleObjectTableValues) + 1);
    exportValues.ensureCapacity(Bun::countof(Bun::nodeModuleObjectTableValues) + 1);

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(constructor);

    for (unsigned i = 0; i < Bun::countof(Bun::nodeModuleObjectTableValues);
        ++i) {
        const auto& entry = Bun::nodeModuleObjectTableValues[i];
        const auto& property = Identifier::fromString(vm, entry.m_key);
        JSValue value = constructor->getIfPropertyExists(globalObject, property);

        if (catchScope.exception()) [[unlikely]] {
            value = {};
            catchScope.clearException();
        }
        if (value.isEmpty()) [[unlikely]] {
            value = JSC::jsUndefined();
        }

        exportNames.append(property);
        exportValues.append(value);
    }
}

} // namespace Zig
