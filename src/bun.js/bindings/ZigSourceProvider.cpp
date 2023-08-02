#include "root.h"

#include "helpers.h"

#include "ZigSourceProvider.h"

#include "JavaScriptCore/BytecodeCacheError.h"
#include "ZigGlobalObject.h"

#include "JavaScriptCore/Completion.h"
#include "wtf/Scope.h"
#include "wtf/text/StringHash.h"
#include <sys/stat.h>

extern "C" void RefString__free(void*, void*, unsigned);

namespace Zig {

using Base = JSC::SourceProvider;
using BytecodeCacheGenerator = JSC::BytecodeCacheGenerator;
using UnlinkedFunctionExecutable = JSC::UnlinkedFunctionExecutable;
using CachedBytecode = JSC::CachedBytecode;
using UnlinkedFunctionCodeBlock = JSC::UnlinkedFunctionCodeBlock;
using SourceCode = JSC::SourceCode;
using CodeSpecializationKind = JSC::CodeSpecializationKind;
using SourceOrigin = JSC::SourceOrigin;
using String = WTF::String;
using SourceProviderSourceType = JSC::SourceProviderSourceType;

static uintptr_t getSourceProviderMapKey(ResolvedSource& resolvedSource)
{
    switch (resolvedSource.source_code.tag) {
    case BunStringTag::WTFStringImpl: {
        return (uintptr_t)resolvedSource.source_code.impl.wtf->characters8();
    }
    case BunStringTag::StaticZigString:
    case BunStringTag::ZigString: {
        return (uintptr_t)Zig::untag(resolvedSource.source_code.impl.zig.ptr);
    }
    default: {
        return 0;
    }
    }
}

static SourceOrigin toSourceOrigin(const String& sourceURL, bool isBuiltin)
{
    if (isBuiltin) {
        if (sourceURL.startsWith("node:"_s)) {
            return SourceOrigin(WTF::URL(makeString("builtin://node/", sourceURL.substring(5))));
        } else if (sourceURL.startsWith("bun:"_s)) {
            return SourceOrigin(WTF::URL(makeString("builtin://bun/", sourceURL.substring(4))));
        } else {
            return SourceOrigin(WTF::URL(makeString("builtin://", sourceURL)));
        }
    }

    return SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL));
}

Ref<SourceProvider> SourceProvider::create(Zig::GlobalObject* globalObject, ResolvedSource resolvedSource, JSC::SourceProviderSourceType sourceType, bool isBuiltin)
{

    auto stringImpl = Bun::toWTFString(resolvedSource.source_code);
    auto sourceURLString = toStringCopy(resolvedSource.source_url);

    auto provider = adoptRef(*new SourceProvider(
        globalObject->isThreadLocalDefaultGlobalObject ? globalObject : nullptr,
        resolvedSource, stringImpl.releaseImpl().releaseNonNull(),
        toSourceOrigin(sourceURLString, isBuiltin),
        sourceURLString.impl(), TextPosition(),
        sourceType));

    return provider;
}

unsigned SourceProvider::hash() const
{
    if (m_hash) {
        return m_hash;
    }

    return m_source->hash();
}

void SourceProvider::freeSourceCode()
{
}

void SourceProvider::updateCache(const UnlinkedFunctionExecutable* executable, const SourceCode&,
    CodeSpecializationKind kind,
    const UnlinkedFunctionCodeBlock* codeBlock)
{
    // if (!m_resolvedSource.bytecodecache_fd || !m_cachedBytecode)
    return;

    JSC::BytecodeCacheError error;
    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeFunctionCodeBlock(executable->vm(), codeBlock, error);
    if (cachedBytecode && !error.isValid())
        m_cachedBytecode->addFunctionUpdate(executable, kind, *cachedBytecode);
}

void SourceProvider::cacheBytecode(const BytecodeCacheGenerator& generator)
{
    // if (!m_resolvedSource.bytecodecache_fd)
    return;

    if (!m_cachedBytecode)
        m_cachedBytecode = JSC::CachedBytecode::create();
    auto update = generator();
    if (update)
        m_cachedBytecode->addGlobalUpdate(*update);
}
void SourceProvider::commitCachedBytecode()
{
    // if (!m_resolvedSource.bytecodecache_fd || !m_cachedBytecode || !m_cachedBytecode->hasUpdates())
    return;

    // auto clearBytecode = WTF::makeScopeExit([&] { m_cachedBytecode = nullptr; });
    // const auto fd = m_resolvedSource.bytecodecache_fd;

    // auto fileSize = FileSystem::fileSize(fd);
    // if (!fileSize)
    //     return;

    // size_t cacheFileSize;
    // if (!WTF::convertSafely(*fileSize, cacheFileSize) || cacheFileSize != m_cachedBytecode->size()) {
    //     // The bytecode cache has already been updated
    //     return;
    // }

    // if (!FileSystem::truncateFile(fd, m_cachedBytecode->sizeForUpdate()))
    //     return;

    // m_cachedBytecode->commitUpdates([&](off_t offset, const void* data, size_t size) {
    //     long long result = FileSystem::seekFile(fd, offset, FileSystem::FileSeekOrigin::Beginning);
    //     ASSERT_UNUSED(result, result != -1);
    //     size_t bytesWritten = static_cast<size_t>(FileSystem::writeToFile(fd, data, size));
    //     ASSERT_UNUSED(bytesWritten, bytesWritten == size);
    // });
}

bool SourceProvider::isBytecodeCacheEnabled() const
{
    // return m_resolvedSource.bytecodecache_fd > 0;
    return false;
}

void SourceProvider::readOrGenerateByteCodeCache(JSC::VM& vm, const JSC::SourceCode& sourceCode)
{
    // auto status = this->readCache(vm, sourceCode);
    // switch (status) {
    // case -1: {
    //     m_resolvedSource.bytecodecache_fd = 0;
    //     break;
    // }
    // case 0: {
    //     JSC::BytecodeCacheError err;
    //     m_cachedBytecode = JSC::generateModuleBytecode(vm, sourceCode, m_resolvedSource.bytecodecache_fd, err);

    //     if (err.isValid()) {
    //         m_resolvedSource.bytecodecache_fd = 0;
    //         m_cachedBytecode = JSC::CachedBytecode::create();
    //     }
    // }
    // // TODO: read the bytecode into a JSC::SourceCode object here
    // case 1: {
    // }
    // }
}
int SourceProvider::readCache(JSC::VM& vm, const JSC::SourceCode& sourceCode)
{
    return -1;
    // if (m_resolvedSource.bytecodecache_fd == 0)
    //     return -1;
    // if (!FileSystem::isHandleValid(m_resolvedSource.bytecodecache_fd))
    //     return -1;
    // const auto fd = m_resolvedSource.bytecodecache_fd;

    // bool success;
    // FileSystem::MappedFileData mappedFile(fd, FileSystem::MappedFileMode::Shared, success);
    // if (!success)
    //     return -1;

    // const uint8_t* fileData = reinterpret_cast<const uint8_t*>(mappedFile.data());
    // unsigned fileTotalSize = mappedFile.size();
    // if (fileTotalSize == 0)
    //     return 0;

    // Ref<JSC::CachedBytecode> cachedBytecode = JSC::CachedBytecode::create(WTFMove(mappedFile));
    // // auto key = JSC::sourceCodeKeyForSerializedModule(vm, sourceCode);
    // // if (isCachedBytecodeStillValid(vm, cachedBytecode.copyRef(), key,
    // //                                JSC::SourceCodeType::ModuleType)) {
    // m_cachedBytecode = WTFMove(cachedBytecode);
    // return 1;
    // } else {
    //   FileSystem::truncateFile(fd, 0);
    //   return 0;
    // }
}
}; // namespace Zig
