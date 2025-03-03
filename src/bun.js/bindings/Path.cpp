#include "Path.h"
#include "root.h"
#include "headers.h"
#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSMicrotask.h>
#include <JavaScriptCore/ObjectConstructor.h>

#pragma mark - Node.js Path

namespace Zig {

static JSC::JSObject* createPath(JSC::JSGlobalObject* globalThis, bool isWindows);

using JSGlobalObject = JSC::JSGlobalObject;
using Exception = JSC::Exception;
using JSValue = JSC::JSValue;
using JSString = JSC::JSString;
using JSModuleLoader = JSC::JSModuleLoader;
using JSModuleRecord = JSC::JSModuleRecord;
using Identifier = JSC::Identifier;
using SourceOrigin = JSC::SourceOrigin;
using JSObject = JSC::JSObject;
using JSNonFinalObject = JSC::JSNonFinalObject;
namespace JSCastingHelpers = JSC::JSCastingHelpers;

using namespace JSC;

using PathFunction = JSC::EncodedJSValue (*SYSV_ABI)(JSGlobalObject*, bool, EncodedJSValue*, uint16_t len);

template<bool isWindows, PathFunction Function>
static inline JSC::EncodedJSValue createZigFunction(JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBufferWithSize<8> args = MarkedArgumentBufferWithSize<8>();
    for (unsigned i = 0, size = callFrame->argumentCount(); i < size; ++i) {
        args.append(callFrame->argument(i));
    }
    const auto result = Function(globalObject, isWindows, args.data(), args.size());
    RETURN_IF_EXCEPTION(scope, {});
    return result;
}

#define DEFINE_PATH_FUNCTION(jsFunctionName, Function, isWindows)               \
    JSC_DEFINE_HOST_FUNCTION(jsFunctionName,                                    \
        (JSC::JSGlobalObject * globalObject, JSC::CallFrame * callFrame))       \
    {                                                                           \
        return createZigFunction<isWindows, Function>(globalObject, callFrame); \
    }

DEFINE_PATH_FUNCTION(jsFunctionPath_basenamePosix, Bun__Path__basename, false)
DEFINE_PATH_FUNCTION(jsFunctionPath_dirnamePosix, Bun__Path__dirname, false)
DEFINE_PATH_FUNCTION(jsFunctionPath_extnamePosix, Bun__Path__extname, false)
DEFINE_PATH_FUNCTION(jsFunctionPath_formatPosix, Bun__Path__format, false)
DEFINE_PATH_FUNCTION(jsFunctionPath_isAbsolutePosix, Bun__Path__isAbsolute, false)
DEFINE_PATH_FUNCTION(jsFunctionPath_joinPosix, Bun__Path__join, false)
DEFINE_PATH_FUNCTION(jsFunctionPath_normalizePosix, Bun__Path__normalize, false)
DEFINE_PATH_FUNCTION(jsFunctionPath_parsePosix, Bun__Path__parse, false)
DEFINE_PATH_FUNCTION(jsFunctionPath_relativePosix, Bun__Path__relative, false)
DEFINE_PATH_FUNCTION(jsFunctionPath_resolvePosix, Bun__Path__resolve, false)
DEFINE_PATH_FUNCTION(jsFunctionPath_toNamespacedPathPosix, Bun__Path__toNamespacedPath, false)

DEFINE_PATH_FUNCTION(jsFunctionPath_basenameWindows, Bun__Path__basename, true)
DEFINE_PATH_FUNCTION(jsFunctionPath_dirnameWindows, Bun__Path__dirname, true)
DEFINE_PATH_FUNCTION(jsFunctionPath_extnameWindows, Bun__Path__extname, true)
DEFINE_PATH_FUNCTION(jsFunctionPath_formatWindows, Bun__Path__format, true)
DEFINE_PATH_FUNCTION(jsFunctionPath_isAbsoluteWindows, Bun__Path__isAbsolute, true)
DEFINE_PATH_FUNCTION(jsFunctionPath_joinWindows, Bun__Path__join, true)
DEFINE_PATH_FUNCTION(jsFunctionPath_normalizeWindows, Bun__Path__normalize, true)
DEFINE_PATH_FUNCTION(jsFunctionPath_parseWindows, Bun__Path__parse, true)
DEFINE_PATH_FUNCTION(jsFunctionPath_relativeWindows, Bun__Path__relative, true)
DEFINE_PATH_FUNCTION(jsFunctionPath_resolveWindows, Bun__Path__resolve, true)
DEFINE_PATH_FUNCTION(jsFunctionPath_toNamespacedPathWindows, Bun__Path__toNamespacedPath, true)

static JSC::JSObject* createPath(JSGlobalObject* globalThis, bool isWindows)
{
    auto& vm = JSC::getVM(globalThis);
    auto* path = JSC::constructEmptyObject(globalThis);
    auto builtinNames = WebCore::builtinNames(vm);

    if (!isWindows) {
        path->putDirectNativeFunction(vm, globalThis, builtinNames.basenamePublicName(), 1, jsFunctionPath_basenamePosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.dirnamePublicName(), 1, jsFunctionPath_dirnamePosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.extnamePublicName(), 1, jsFunctionPath_extnamePosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.formatPublicName(), 1, jsFunctionPath_formatPosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.isAbsolutePublicName(), 1, jsFunctionPath_isAbsolutePosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.joinPublicName(), 1, jsFunctionPath_joinPosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.normalizePublicName(), 1, jsFunctionPath_normalizePosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.parsePublicName(), 1, jsFunctionPath_parsePosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.relativePublicName(), 1, jsFunctionPath_relativePosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.resolvePublicName(), 1, jsFunctionPath_resolvePosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.toNamespacedPathPublicName(), 1, jsFunctionPath_toNamespacedPathPosix, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
    } else {
        path->putDirectNativeFunction(vm, globalThis, builtinNames.basenamePublicName(), 1, jsFunctionPath_basenameWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.dirnamePublicName(), 1, jsFunctionPath_dirnameWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.extnamePublicName(), 1, jsFunctionPath_extnameWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.formatPublicName(), 1, jsFunctionPath_formatWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.isAbsolutePublicName(), 1, jsFunctionPath_isAbsoluteWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.joinPublicName(), 1, jsFunctionPath_joinWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.normalizePublicName(), 1, jsFunctionPath_normalizeWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.parsePublicName(), 1, jsFunctionPath_parseWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.relativePublicName(), 1, jsFunctionPath_relativeWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.resolvePublicName(), 1, jsFunctionPath_resolveWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
        path->putDirectNativeFunction(vm, globalThis, builtinNames.toNamespacedPathPublicName(), 1, jsFunctionPath_toNamespacedPathWindows, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
    }

    return path;
}

} // namespace Zig

namespace Bun {

JSC::JSValue createNodePathBinding(Zig::GlobalObject* globalObject)
{
    auto binding = constructEmptyArray(globalObject, nullptr, 2);
    binding->putDirectIndex(
        globalObject,
        (unsigned)0,
        Zig::createPath(globalObject, false));
    binding->putDirectIndex(
        globalObject,
        (unsigned)1,
        Zig::createPath(globalObject, true));
    return binding;
}

} // namespace Bun
