#include "InternalBuiltinBytecode.h"

#include "InternalModuleRegistryConstants.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/BytecodeCacheError.h>
#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/CachedTypes.h>
#include <JavaScriptCore/CodeCache.h>
#include <JavaScriptCore/Debugger.h>
#include <JavaScriptCore/JSLock.h>
#include <JavaScriptCore/SourceCode.h>
#include <wtf/URL.h>
#include <JavaScriptCore/ObjectConstructor.h>

// The blob and its size. Weak zero-size definitions here are overridden at final
// link time by the generated InternalBuiltinBytecode.S when the build embeds
// bytecode; every other configuration (debug, cross-compiles, Windows) links
// only these and the loader sees an empty blob.
#if OS(WINDOWS)
extern "C" const uint8_t bun_builtin_bytecode_blob[8] = { 0 };
extern "C" const uint64_t bun_builtin_bytecode_blob_size = 0;
#else
extern "C" __attribute__((weak)) const uint8_t bun_builtin_bytecode_blob[8] = { 0 };
extern "C" __attribute__((weak)) const uint64_t bun_builtin_bytecode_blob_size = 0;
#endif

namespace Bun {
namespace BuiltinBytecode {

using namespace JSC;

// Blob layout (little-endian, produced and consumed by the same build):
//   u32 magic; u32 version; u32 count;
//   struct { u64 offset; u64 length; } index[count];   // module index -> payload
//   payloads..., each aligned to kPayloadAlignment
static constexpr uint32_t kMagic = 0x42434243; // "CBCB"
static constexpr uint32_t kFormatVersion = 1;
static constexpr size_t kPayloadAlignment = 128;
static constexpr size_t kHeaderSize = 12;
static constexpr size_t kIndexEntrySize = 16;

static Stats s_stats { false, 0, 0 };

Stats stats()
{
    return s_stats;
}

static std::span<const uint8_t> blob()
{
    uint64_t size = bun_builtin_bytecode_blob_size;
    if (!size)
        return {};
    return { bun_builtin_bytecode_blob, size };
}

static SourceCode makeBuiltinModuleSource(const InternalModuleRegistryConstants::InternalModuleSpan& span)
{
    auto sourceText = WTF::String(WTF::StringImpl::createWithoutCopying(std::span<const char>(bun_internal_modules_data + span.offset, span.length)));
    auto&& origin = SourceOrigin(WTF::URL(String(ASCIILiteral::fromLiteralUnsafe(span.url))));
    return JSC::makeSource(sourceText, origin, JSC::SourceTaintedOrigin::Untainted, String(ASCIILiteral::fromLiteralUnsafe(span.moduleName)));
}

void generateBlobAndExit(JSC::JSGlobalObject* globalObject, JSC::VM& vm, const char* path)
{
    JSC::JSLockHolder locker(vm);

    constexpr size_t count = std::size(InternalModuleRegistryConstants::kInternalModuleSpans);
    Vector<uint8_t> out;
    Vector<Vector<uint8_t>, count> payloads;
    payloads.grow(count);
    size_t failures = 0;

    for (size_t i = 0; i < count; i++) {
        auto& span = InternalModuleRegistryConstants::kInternalModuleSpans[i];
        SourceCode source = makeBuiltinModuleSource(span);
        auto moduleName = String(ASCIILiteral::fromLiteralUnsafe(span.moduleName));
        auto* executable = createBuiltinExecutable(vm, source, Identifier::fromString(vm, moduleName), ImplementationVisibility::Public, ConstructorKind::None, ConstructAbility::CannotConstruct, InlineAttribute::None);
        ParserError parserError;
        // Depth 0: only each module's top-level code block. Nested functions keep
        // parsing lazily on first call, which is nearly free (see PR description).
        auto* codeBlock = JSC::recursivelyGenerateUnlinkedCodeBlockForFunctionExecutable(vm, executable, source, parserError, 0);
        if (!codeBlock || parserError.isValid()) {
            fprintf(stderr, "[builtin-bytecode] %s: bytecode generation failed\n", span.moduleName);
            failures++;
            continue;
        }
        JSC::BytecodeCacheError cacheError;
        auto key = JSC::sourceCodeKeyForSerializedFunctionExecutable(vm, source, moduleName);
        RefPtr<JSC::CachedBytecode> cached = JSC::encodeFunctionExecutable(vm, key, executable, cacheError);
        if (!cached || cacheError.isValid()) {
            fprintf(stderr, "[builtin-bytecode] %s: encode failed\n", span.moduleName);
            failures++;
            continue;
        }
        payloads[i].append(cached->span());
    }

    if (failures)
        exit(1);

    auto writeU32 = [&](uint32_t v) { out.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(&v), 4)); };
    auto writeU64 = [&](uint64_t v) { out.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(&v), 8)); };
    auto alignTo = [&](size_t alignment) {
        while (out.size() % alignment)
            out.append(0);
    };

    writeU32(kMagic);
    writeU32(kFormatVersion);
    writeU32(count);
    // Reserve the index; patch offsets after payloads are placed.
    size_t indexStart = kHeaderSize;
    out.grow(kHeaderSize + count * kIndexEntrySize);
    for (size_t i = 0; i < count; i++) {
        alignTo(kPayloadAlignment);
        uint64_t offset = payloads[i].isEmpty() ? 0 : out.size();
        uint64_t length = payloads[i].size();
        memcpy(out.mutableSpan().data() + indexStart + i * kIndexEntrySize, &offset, 8);
        memcpy(out.mutableSpan().data() + indexStart + i * kIndexEntrySize + 8, &length, 8);
        if (length)
            out.append(payloads[i].span());
    }

    FILE* f = fopen(path, "wb");
    if (!f || fwrite(out.span().data(), 1, out.size(), f) != out.size()) {
        fprintf(stderr, "[builtin-bytecode] failed to write %s\n", path);
        exit(1);
    }
    fclose(f);
    exit(0);
}

JSC::UnlinkedFunctionExecutable* tryDecode(JSC::JSGlobalObject* globalObject, JSC::VM& vm, const JSC::SourceCode& source, const WTF::String& moduleName, unsigned moduleIndex)
{
    auto data = blob();
    if (data.empty())
        return nullptr;
    s_stats.available = true;

    // Bytecode was generated with the default code-generation mode; a debugger
    // or coverage profiler needs different bytecode, so parse from source.
    if (globalObject->hasDebugger() || vm.controlFlowProfiler() || vm.typeProfiler())
        return nullptr;

    if (data.size() < kHeaderSize)
        return nullptr;
    uint32_t magic, version, count;
    memcpy(&magic, data.data(), 4);
    memcpy(&version, data.data() + 4, 4);
    memcpy(&count, data.data() + 8, 4);
    if (magic != kMagic || version != kFormatVersion || moduleIndex >= count || data.size() < kHeaderSize + count * kIndexEntrySize)
        return nullptr;

    uint64_t offset, length;
    memcpy(&offset, data.data() + kHeaderSize + moduleIndex * kIndexEntrySize, 8);
    memcpy(&length, data.data() + kHeaderSize + moduleIndex * kIndexEntrySize + 8, 8);
    if (!length || offset + length > data.size()) {
        s_stats.misses++;
        return nullptr;
    }

    // The blob lives in the binary's read-only image for the life of the process, so
    // CachedBytecode can wrap it without copying and without a destructor.
    Ref<JSC::CachedBytecode> cached = JSC::CachedBytecode::create(std::span<uint8_t>(const_cast<uint8_t*>(data.data() + offset), length), [](const void*) {}, {});
    auto key = JSC::sourceCodeKeyForSerializedFunctionExecutable(vm, source, moduleName);
    auto* executable = JSC::decodeFunctionExecutable(vm, key, cached);
    if (executable)
        s_stats.hits++;
    else
        s_stats.misses++;
    return executable;
}

} // namespace BuiltinBytecode

JSC_DEFINE_HOST_FUNCTION(jsBuiltinBytecodeCacheStats, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto stats = BuiltinBytecode::stats();
    auto* object = JSC::constructEmptyObject(globalObject);
    object->putDirect(vm, JSC::Identifier::fromString(vm, "available"_s), JSC::jsBoolean(stats.available));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "hits"_s), JSC::jsNumber(stats.hits));
    object->putDirect(vm, JSC::Identifier::fromString(vm, "misses"_s), JSC::jsNumber(stats.misses));
    return JSC::JSValue::encode(object);
}

} // namespace Bun
