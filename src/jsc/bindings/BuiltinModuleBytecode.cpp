#include "BuiltinModuleBytecode.h"

#include "ZigSourceProvider.h"

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/BytecodeCacheError.h>
#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/CachedTypes.h>
#include <JavaScriptCore/CodeCache.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/ParserError.h>
#include <JavaScriptCore/SourceCodeKey.h>
#include <wtf/FileSystem.h>

#include "InternalModuleRegistryConstants.h"
#include "InternalModuleRegistry+builtinBytecode.h"

namespace Bun {

using namespace JSC;
namespace Builtins = InternalModuleRegistryBuiltins;

WTF::String builtinModuleName(unsigned moduleId)
{
    if (moduleId >= Builtins::jsModuleCount)
        return {};
    return Builtins::nameById(moduleId);
}

WTF::String builtinModuleSource(unsigned moduleId)
{
    if (moduleId >= Builtins::jsModuleCount)
        return {};

#ifdef BUN_DYNAMIC_JS_LOAD_PATH
    WTF::String file = makeString(ASCIILiteral::fromLiteralUnsafe(BUN_DYNAMIC_JS_LOAD_PATH), "/"_s, Builtins::fileById(moduleId));
    auto contents = WTF::FileSystemImpl::readEntireFile(file);
    if (!contents) {
        printf("\nFATAL: bun-debug failed to load bundled version of \"%s\" at \"%s\" (was it deleted?)\n"
               "Please re-compile Bun to continue.\n\n",
            Builtins::nameById(moduleId).characters(), file.utf8().span().data());
        CRASH();
    }
    return WTF::String::fromUTF8(contents.value());
#else
    return Builtins::sourceById(moduleId);
#endif
}

JSC::SourceCode builtinModuleSourceCode(JSC::VM& vm, unsigned moduleId, const WTF::String& source)
{
    UNUSED_PARAM(vm);
    if (source.isNull())
        return {};
    auto origin = SourceOrigin(WTF::URL(WTF::String(Builtins::urlById(moduleId))));
    return JSC::makeSource(source, origin, JSC::SourceTaintedOrigin::Untainted, Builtins::nameById(moduleId));
}

JSC::UnlinkedFunctionExecutable* createBuiltinModuleExecutable(JSC::VM& vm, const JSC::SourceCode& source, const WTF::String& moduleName)
{
    return createBuiltinExecutable(
        vm, source,
        Identifier::fromString(vm, moduleName),
        ImplementationVisibility::Public,
        ConstructorKind::None,
        ConstructAbility::CannotConstruct,
        InlineAttribute::None);
}

// Looks up one entry in the embedded section. Defined in `StandaloneModuleGraph.rs`.
extern "C" bool Bun__getBuiltinModuleBytecode(unsigned moduleId, uint8_t** outBytes, size_t* outLength);

// Only a `--compile --bytecode` executable carries builtin bytecode. Every other Bun process
// compiles its builtins from source, and this is on the path of every one of them, so gate on
// a plain flag the standalone graph sets at startup rather than calling across into Rust.
static std::atomic<bool> s_hasBuiltinModuleBytecode { false };

extern "C" void Bun__setHasBuiltinModuleBytecode()
{
    s_hasBuiltinModuleBytecode.store(true, std::memory_order_relaxed);
}

// How many builtins have been loaded from the embedded cache rather than parsed. Read by
// `bun:internal-for-testing` so the `--compile --bytecode` tests can tell the two apart.
static std::atomic<unsigned> s_builtinsLoadedFromBytecode { 0 };

JSC::UnlinkedFunctionExecutable* decodeBuiltinModuleBytecode(JSC::JSGlobalObject* globalObject, JSC::VM& vm, const JSC::SourceCode& source, const WTF::String& moduleName, unsigned moduleId)
{
    if (!s_hasBuiltinModuleBytecode.load(std::memory_order_relaxed))
        return nullptr;

    uint8_t* bytes = nullptr;
    size_t length = 0;
    if (!Bun__getBuiltinModuleBytecode(moduleId, &bytes, &length) || !length)
        return nullptr;

    // The entry was keyed on an empty code generation mode. A debugger or a profiler changes
    // what the runtime would generate, so don't reuse bytecode generated without one.
    if (!globalObject->defaultCodeGenerationMode().isEmpty())
        return nullptr;

    // The bytes live in the compiled executable's embedded section for the whole process
    // lifetime, so nothing frees them when the CachedBytecode goes away.
    Ref<JSC::CachedBytecode> cachedBytecode = JSC::CachedBytecode::create(
        std::span<uint8_t> { bytes, length }, [](const void*) {}, {});

    auto key = JSC::sourceCodeKeyForSerializedFunctionExecutable(vm, source, moduleName);
    auto* executable = JSC::decodeFunctionExecutable(vm, key, WTF::move(cachedBytecode));
    if (executable)
        s_builtinsLoadedFromBytecode.fetch_add(1, std::memory_order_relaxed);
    return executable;
}

// Generates the cache entry for one builtin. Runs on a bytecode-cache thread with its own
// VM, never on a JS thread. `cachedBytecodePtr` owns the returned bytes; the caller must
// release it with CachedBytecode__deref.
extern "C" bool Bun__generateBuiltinModuleBytecode(unsigned moduleId, const uint8_t** outBytes, size_t* outLength, JSC::CachedBytecode** cachedBytecodePtr)
{
    WTF::String source = builtinModuleSource(moduleId);
    if (source.isNull())
        return false;

    JSC::VM& vm = Zig::vmForBytecodeCache();
    JSC::JSLockHolder locker(vm);

    WTF::String moduleName = builtinModuleName(moduleId);
    JSC::SourceCode sourceCode = builtinModuleSourceCode(vm, moduleId, source);
    UnlinkedFunctionExecutable* executable = createBuiltinModuleExecutable(vm, sourceCode, moduleName);

    ParserError parserError;
    if (!JSC::recursivelyGenerateUnlinkedCodeBlockForFunctionExecutable(vm, executable, sourceCode, parserError))
        return false;

    auto key = JSC::sourceCodeKeyForSerializedFunctionExecutable(vm, sourceCode, moduleName);
    dataLogLnIf(JSC::Options::verboseDiskCache(), "[Bytecode Build] builtin ", moduleName, " sourceSize=", source.length(), " keyHash=", key.hash());

    JSC::BytecodeCacheError cacheError;
    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeFunctionExecutable(vm, key, executable, cacheError);
    if (!cachedBytecode || cacheError.isValid())
        return false;

    cachedBytecode->ref();
    *cachedBytecodePtr = cachedBytecode.get();
    *outBytes = cachedBytecode->span().data();
    *outLength = cachedBytecode->span().size();
    return true;
}

BUN_DEFINE_HOST_FUNCTION(Bun__builtinModuleBytecodeDecodedCount, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    UNUSED_PARAM(globalObject);
    return JSValue::encode(jsNumber(s_builtinsLoadedFromBytecode.load(std::memory_order_relaxed)));
}

// The builtins that `moduleId` requires directly. Empty for native modules.
extern "C" void Bun__builtinModuleDependencies(unsigned moduleId, const unsigned** outIds, size_t* outLength)
{
    if (moduleId >= Builtins::jsModuleCount) {
        *outIds = nullptr;
        *outLength = 0;
        return;
    }

    unsigned begin = Builtins::dependencyOffsets[moduleId];
    unsigned end = Builtins::dependencyOffsets[moduleId + 1];
    *outIds = Builtins::dependencyIdsCount ? &Builtins::dependencyIds[begin] : nullptr;
    *outLength = end - begin;
}

} // namespace Bun
