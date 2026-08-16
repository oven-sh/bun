#include "BuiltinModuleBytecode.h"

#include "ZigSourceProvider.h"

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/BytecodeCacheError.h>
#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/CachedTypes.h>
#include <JavaScriptCore/CodeCache.h>
#include <JavaScriptCore/ParserError.h>
#include <JavaScriptCore/SourceCodeKey.h>
#include <wtf/FileSystem.h>

#include "InternalModuleRegistry+builtinBytecode.h"

namespace Bun {

using namespace JSC;
namespace Builtins = InternalModuleRegistryBuiltins;

WTF::String builtinModuleSource(unsigned moduleId)
{
    if (moduleId >= Builtins::jsModuleCount)
        return {};
    const auto& module = Builtins::modules[moduleId];

#ifdef BUN_DYNAMIC_JS_LOAD_PATH
    WTF::String file = makeString(ASCIILiteral::fromLiteralUnsafe(BUN_DYNAMIC_JS_LOAD_PATH), "/"_s, module.file);
    auto contents = WTF::FileSystemImpl::readEntireFile(file);
    if (!contents) {
        printf("\nFATAL: bun-debug failed to load bundled version of \"%s\" at \"%s\" (was it deleted?)\n"
               "Please re-compile Bun to continue.\n\n",
            module.name.characters(), file.utf8().span().data());
        CRASH();
    }
    return WTF::String::fromUTF8(contents.value());
#else
    // bun_internal_modules_data is the blob InternalModuleRegistryConstants.S links in.
    return WTF::String(WTF::StringImpl::createWithoutCopying(std::span<const char>(bun_internal_modules_data + module.sourceOffset, module.sourceLength)));
#endif
}

JSC::SourceCode builtinModuleSourceCode(const WTF::String& source, const WTF::String& moduleName, const WTF::String& urlString)
{
    return JSC::makeSource(source, SourceOrigin(WTF::URL(urlString)), JSC::SourceTaintedOrigin::Untainted, moduleName);
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

// Defined in StandaloneModuleGraph.rs.
extern "C" bool Bun__getBuiltinModuleBytecode(unsigned moduleId, uint8_t** outBytes, size_t* outLength);

// Set by the standalone graph at startup. Every builtin load in every Bun process passes
// through decodeBuiltinModuleBytecode(), and almost none of them embed anything.
static std::atomic<bool> s_hasBuiltinModuleBytecode { false };

extern "C" void Bun__setHasBuiltinModuleBytecode()
{
    s_hasBuiltinModuleBytecode.store(true, std::memory_order_relaxed);
}

static std::atomic<unsigned> s_builtinsLoadedFromBytecode { 0 };

JSC::UnlinkedFunctionExecutable* decodeBuiltinModuleBytecode(JSC::JSGlobalObject* globalObject, JSC::VM& vm, const JSC::SourceCode& source, const WTF::String& moduleName, unsigned moduleId)
{
    if (!s_hasBuiltinModuleBytecode.load(std::memory_order_relaxed))
        return nullptr;

    uint8_t* bytes = nullptr;
    size_t length = 0;
    if (!Bun__getBuiltinModuleBytecode(moduleId, &bytes, &length) || !length)
        return nullptr;

    // Entries are generated with an empty CodeGenerationMode; a debugger or profiler changes it.
    if (!globalObject->defaultCodeGenerationMode().isEmpty())
        return nullptr;

    // The bytes are part of the executable image; nothing owns or frees them.
    Ref<JSC::CachedBytecode> cachedBytecode = JSC::CachedBytecode::create(
        std::span<uint8_t> { bytes, length }, [](const void*) {}, {});

    auto key = JSC::sourceCodeKeyForSerializedFunctionExecutable(vm, source, moduleName);
    auto* executable = JSC::decodeFunctionExecutable(vm, key, WTF::move(cachedBytecode));
    if (executable)
        s_builtinsLoadedFromBytecode.fetch_add(1, std::memory_order_relaxed);
    return executable;
}

// `*cachedBytecodePtr` owns the returned bytes; the caller releases it with CachedBytecode__deref.
extern "C" bool Bun__generateBuiltinModuleBytecode(unsigned moduleId, const uint8_t** outBytes, size_t* outLength, JSC::CachedBytecode** cachedBytecodePtr)
{
    WTF::String source = builtinModuleSource(moduleId);
    if (source.isNull())
        return false;
    const auto& module = Builtins::modules[moduleId];

    JSC::VM& vm = Zig::vmForBytecodeCache();
    JSC::JSLockHolder locker(vm);

    WTF::String moduleName { module.name };
    JSC::SourceCode sourceCode = builtinModuleSourceCode(source, moduleName, WTF::String { module.url });
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

extern "C" void Bun__builtinModuleDependencies(unsigned moduleId, const uint32_t** outIds, size_t* outLength)
{
    *outIds = nullptr;
    *outLength = 0;
    if (moduleId >= Builtins::jsModuleCount)
        return;

    uint32_t begin = Builtins::dependencyOffsets[moduleId];
    uint32_t end = Builtins::dependencyOffsets[moduleId + 1];
    if (begin == end)
        return;
    *outIds = &Builtins::dependencyIds[begin];
    *outLength = end - begin;
}

} // namespace Bun
