#include "root.h"

#include "helpers.h"

#include "ZigSourceProvider.h"
#include "MimallocWTFMalloc.h"

#include "ZigGlobalObject.h"
#include "wtf/Assertions.h"

#include <JavaScriptCore/Completion.h>
#include <wtf/Scope.h>
#include <wtf/text/StringHash.h>
#include <sys/stat.h>
#include <mimalloc.h>

namespace Zig {

using SourceOrigin = JSC::SourceOrigin;
using String = WTF::String;
using SourceProviderSourceType = JSC::SourceProviderSourceType;

SourceOrigin toSourceOrigin(const String& sourceURL, bool isBuiltin)
{

    ASSERT_WITH_MESSAGE(!sourceURL.startsWith("file://"_s), "specifier should not already be a file URL");

    if (isBuiltin) {
        if (sourceURL.startsWith("node:"_s)) {
            return SourceOrigin(WTF::URL(makeString("builtin://node/"_s, sourceURL.substring(5))));
        } else if (sourceURL.startsWith("bun:"_s)) {
            return SourceOrigin(WTF::URL(makeString("builtin://bun/"_s, sourceURL.substring(4))));
        } else {
            return SourceOrigin(WTF::URL(makeString("builtin://"_s, sourceURL)));
        }
    }
    return SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL));
}

extern "C" void ByteRangeMapping__generate(const BunString* sourceURL, const BunString* code, int sourceID, bool alreadyBundled);

extern "C" bool BunTest__shouldGenerateCodeCoverage(const BunString* sourceURL);
extern "C" void Bun__addSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, const BunString* specifier);
extern "C" void Bun__removeSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, const BunString* specifier);

Ref<SourceProvider> SourceProvider::create(
    Zig::GlobalObject* globalObject,
    ResolvedSource& resolvedSource,
    JSC::SourceProviderSourceType sourceType,
    bool isBuiltin)
{
    // Use BunTranspiledModule when module_info is present.
    // This allows JSC to skip parsing during the analyze phase (uses pre-computed imports/exports).
    if (resolvedSource.module_info != nullptr) {
        ASSERT(!resolvedSource.isCommonJSModule);
        sourceType = JSC::SourceProviderSourceType::BunTranspiledModule;
    }

    auto string = resolvedSource.source_code.transferToWTFString();
    auto sourceURLString = resolvedSource.source_url.transferToWTFString();

    bool isCodeCoverageEnabled = !!globalObject->vm().controlFlowProfiler();

    bool shouldGenerateCodeCoverage = false;
    if (isCodeCoverageEnabled && !isBuiltin) {
        BunString sourceURLBunString = Bun::toString(sourceURLString);
        shouldGenerateCodeCoverage = BunTest__shouldGenerateCodeCoverage(&sourceURLBunString);
    }

    const auto getSourceOrigin = [&]() -> SourceOrigin {
        auto originPath = resolvedSource.origin_path.transferToWTFString();
        if (!originPath.isEmpty())
            return SourceOrigin(WTF::URL::fileURLWithFileSystemPath(originPath));
        return toSourceOrigin(sourceURLString, isBuiltin);
    };

    auto origin = getSourceOrigin();
    auto provider = adoptRef(*new SourceProvider(globalObject->bunVM(), resolvedSource, string, origin, WTF::move(sourceURLString), TextPosition(), sourceType));

    if (shouldGenerateCodeCoverage) {
        BunString providerURL = Bun::toString(provider->sourceURL());
        WTF::String providerSourceString = provider->source().toStringWithoutCopying();
        BunString providerSource = Bun::toString(providerSourceString);
        ByteRangeMapping__generate(&providerURL, &providerSource, provider->asID(), provider->m_alreadyBundled);
    }

    if (provider->m_alreadyBundled) {
        BunString str = Bun::toString(provider->sourceURL());
        Bun__addSourceProviderSourceMap(globalObject->bunVM(), provider.ptr(), &str);
    }

    return provider;
}

SourceProvider::~SourceProvider()
{
    if (m_alreadyBundled) {
        BunString str = Bun::toString(sourceURL());
        Bun__removeSourceProviderSourceMap(m_bunVM, this, &str);
    }
}

void SourceProvider::takeBytecode(ResolvedSource& resolvedSource)
{
    auto& bytecode = resolvedSource.bytecode_cache;
    static_assert(offsetof(ResolvedSourceBytecode, owned) == 16 && offsetof(ResolvedSourceBytecode, isEmbedded) == 17 && offsetof(ResolvedSourceBytecode, entryOffset) == 20, "Bytecode layout is mirrored in src/jsc/ResolvedSource.rs");
    auto* bytes = std::exchange(bytecode.bytes, nullptr);
    if (!bytes)
        return;
    if (bytecode.isEmbedded) {
        setHash(resolvedSource.source_code_hash);
        setEmbeddedBytecode({ bytes, bytecode.size }, bytecode.entryOffset);
    } else if (bytecode.owned)
        adoptBytecode(bytes, bytecode.size);
    else
        setLastingBytecode({ bytes, bytecode.size });
}

extern "C" void JSC__Heap__setInitialAllocationBudget(JSC::VM* vm, size_t bytes)
{
    vm->heap.setInitialAllocationBudget(bytes);
}

extern "C" BunString ZigSourceProvider__getSourceSlice(SourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

}; // namespace Zig

namespace Bun {

// bun:internal-for-testing: whether the source of a function knows where its lines start. Before anything asked for a
// position in it, that means they came with its code: from the parse, or out of the bytecode.
JSC_DEFINE_HOST_FUNCTION(jsSourceHasLineStarts, (JSC::JSGlobalObject*, JSC::CallFrame* callFrame))
{
    auto* function = dynamicDowncast<JSC::JSFunction>(callFrame->argument(0));
    if (!function || function->isHostFunction())
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsBoolean(function->jsExecutable()->sourceProvider()->lineStartTableIsBuilt()));
}

} // namespace Bun
