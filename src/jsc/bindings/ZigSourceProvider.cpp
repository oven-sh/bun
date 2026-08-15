#include "root.h"

#include "helpers.h"

#include "ZigSourceProvider.h"
#include "MimallocWTFMalloc.h"
#include "BunAnalyzeTranspiledModule.h"

#include "ZigGlobalObject.h"
#include "wtf/Assertions.h"

#include <JavaScriptCore/Completion.h>
#include <wtf/Scope.h>
#include <wtf/text/StringHash.h>
#include <sys/stat.h>
#include <JavaScriptCore/SourceCodeKey.h>
#include <mimalloc.h>
#include <JavaScriptCore/BytecodeCacheError.h>
#include <JavaScriptCore/CachedTypes.h>
#include <JavaScriptCore/CodeCache.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/UnlinkedFunctionCodeBlock.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>
#include <wtf/HashMap.h>
#include <wtf/Lock.h>

extern "C" bool Bun__NodeCompileCache__attach(uint64_t key, uint64_t entryId, const void* provider);
extern "C" void Bun__NodeCompileCache__detach(uint64_t key, uint64_t entryId, const void* provider, const uint8_t* bytecode, size_t bytecodeLength);

namespace Zig {

using SourceOrigin = JSC::SourceOrigin;
using String = WTF::String;
using SourceProviderSourceType = JSC::SourceProviderSourceType;

// Collects the bytecode JSC generates for one compile-cache miss, in the
// incremental CachedBytecode layout the jsc shell's --diskCache uses: the
// top-level code block as the global update, then one function update per
// function the program actually compiled. commit() flattens that into the
// blob NodeCompileCache.rs writes, so persisting a module is a memcpy instead
// of re-parsing it and eagerly compiling every function on a second VM.
//
// addTopLevel()/addFunction() run on the owning VM's thread, inside JSC's
// compile. commit() only touches the already-encoded bytes, so it may run from
// any thread (exit, module.flushCompileCache(), the --watch reload thread)
// while that VM is still compiling; m_lock orders the two.
class NodeCompileCacheCollector {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(NodeCompileCacheCollector);

public:
    NodeCompileCacheCollector(uint64_t key, uint64_t entryId)
        : m_key(key)
        , m_entryId(entryId)
    {
    }

    // `providerHandle` identifies this collector to the Rust entry; it is only
    // ever compared and passed back to ZigSourceProvider__commitNodeCompileCache.
    void addTopLevel(const JSC::BytecodeCacheGenerator& generator, const SourceProvider* providerHandle)
    {
        {
            Locker locker { m_lock };
            // A second compile of the same provider (--isolate shares providers
            // between globals) builds a tree we never registered; its
            // functions fall out in addFunction().
            if (m_state != State::AwaitingTopLevel)
                return;
            // Nothing can reach this collector before attach() publishes it,
            // and encoding cannot re-enter the provider.
            RefPtr<JSC::CachedBytecode> topLevel = generator();
            if (!topLevel) {
                m_state = State::Done;
                return;
            }
            m_bytecode = JSC::CachedBytecode::create();
            pin(topLevel->leafExecutables());
            m_bytecode->addGlobalUpdate(topLevel.releaseNonNull());
            m_state = State::Collecting;
        }
        // Attach takes the Rust cache lock, which a concurrent persist holds
        // while calling commit(), so it must not nest inside m_lock.
        if (!Bun__NodeCompileCache__attach(m_key, m_entryId, providerHandle))
            discard();
    }

    void addFunction(const JSC::UnlinkedFunctionExecutable* executable, JSC::CodeSpecializationKind kind, const JSC::UnlinkedFunctionCodeBlock* codeBlock)
    {
        Locker locker { m_lock };
        if (m_state != State::Collecting) {
            // Nothing consults the leaf map once the bytecode has been taken
            // (see m_pins), and this is the VM thread.
            if (m_state == State::Done)
                m_pins.clear();
            return;
        }

        // A debugger attaching mid-run deletes all code and recompiles it in a
        // different mode; the file must stay uniform with its top-level block.
        if (!m_codeGenerationMode)
            m_codeGenerationMode = codeBlock->codeGenerationMode();
        if (*m_codeGenerationMode != codeBlock->codeGenerationMode()) {
            stopCollecting();
            return;
        }

        // Only a function whose parent's encoding is in the file has a slot to
        // patch. Anything else (children of an update rejected below, a tree
        // from a second compile) is compiled from source on warm runs like any
        // uncached function.
        if (!m_bytecode->leafExecutables().contains(executable))
            return;
        // A function compiles a second time only after its code block was
        // jettisoned or deleted; the first encoding is still right.
        const uint8_t kindBit = kind == JSC::CodeSpecializationKind::CodeForCall ? RecordedForCall : RecordedForConstruct;
        auto recorded = m_recorded.add(executable, 0);
        if (recorded.iterator->value & kindBit)
            return;
        recorded.iterator->value |= kindBit;

        // The size accessors are non-const in JSC; they only read vector sizes.
        auto& block = *const_cast<JSC::UnlinkedFunctionCodeBlock*>(codeBlock);
        const size_t nestedFunctions = block.numberOfFunctionDecls() + block.numberOfFunctionExprs();
        const size_t budget = storedBytesBase + storedBytesPerBytecodeByte * block.instructionsSize() + storedBytesPerNestedFunction * nestedFunctions;
        if (nestedFunctions && m_nestedFunctionOverhead > budget)
            return;

        JSC::BytecodeCacheError error;
        RefPtr<JSC::CachedBytecode> update = JSC::encodeFunctionCodeBlock(executable->vm(), codeBlock, error);
        if (!update || error.isValid())
            return;
        if (update->size() > budget) {
            if (nestedFunctions) {
                const size_t overhead = update->size() - budget;
                m_nestedFunctionOverhead = m_nestedFunctionOverhead ? std::min(m_nestedFunctionOverhead, overhead) : overhead;
            }
            return;
        }
        pin(update->leafExecutables());
        m_bytecode->addFunctionUpdate(executable, kind, update.releaseNonNull());
    }

    // Flattens everything collected so far and ends collection. Empty when
    // there is nothing or it was already taken.
    Vector<uint8_t> commit()
    {
        Locker locker { m_lock };
        RefPtr<JSC::CachedBytecode> bytecode = std::exchange(m_bytecode, nullptr);
        m_recorded.clear();
        m_state = State::Done;
        if (!bytecode)
            return {};

        const size_t size = bytecode->sizeForUpdate();
        Vector<uint8_t> blob(FillWith {}, size, uint8_t(0));
        bytecode->commitUpdates([&](off_t offset, std::span<const uint8_t> data) {
            RELEASE_ASSERT(offset >= 0 && data.size() <= size && static_cast<size_t>(offset) <= size - data.size());
            memcpySpan(blob.mutableSpan().subspan(static_cast<size_t>(offset), data.size()), data);
        });
        return blob;
    }

    // ~SourceProvider. While attached, the Rust entry still points at this
    // provider: deliver what was collected (a worker tearing down, or a module
    // none of whose functions survived) so it is persisted at exit, and make
    // the entry forget the pointer.
    void detach(const SourceProvider* providerHandle)
    {
        {
            Locker locker { m_lock };
            if (m_state != State::Collecting && m_state != State::Frozen)
                return;
        }
        Vector<uint8_t> blob = commit();
        Bun__NodeCompileCache__detach(m_key, m_entryId, providerHandle, blob.span().data(), blob.size());
    }

private:
    enum class State : uint8_t {
        AwaitingTopLevel,
        // Attached to the Rust entry (or about to be) and accepting functions.
        Collecting,
        // Still attached; keeps what was collected but accepts no more.
        Frozen,
        // Never attached, or already committed; the Rust entry does not point
        // at this provider.
        Done,
    };

    static constexpr uint8_t RecordedForCall = 1 << 0;
    static constexpr uint8_t RecordedForConstruct = 1 << 1;

    // Each function update is encoded on its own, so the stub it contains for
    // every nested function carries its own copy of the enclosing scopes' TDZ
    // variable lists (CachedFunctionExecutableRareData), and the decoder reads
    // every copy again. In a bundled module that list is tens of KB: on vite's
    // main chunk, updates without nested functions averaged 1.5 KB, while the
    // smallest update with one was 58 KB, for 7 bytes of bytecode, and the
    // copies made the file larger than eagerly compiling everything. Only keep
    // an update whose size is explained by what it adds: a budget built from
    // the measured costs with about 2x headroom (updates without nested
    // functions take 3-6 bytes per bytecode byte plus under 1 KB; a stub is
    // 150-250 bytes). What a rejected update exceeded its budget by is a lower
    // bound on what the scope lists cost every update in this module, so once
    // known, updates with nested functions that cannot fit are not encoded.
    static constexpr size_t storedBytesBase = 4 * 1024;
    static constexpr size_t storedBytesPerBytecodeByte = 8;
    static constexpr size_t storedBytesPerNestedFunction = 512;

    // JSC keys the leaf map it patches function updates into by raw cell
    // address, so every cell registered in it has to outlive our use of it;
    // otherwise a later, unregistered function could be allocated at a dead
    // entry's address and contains() would hand it that entry's slot. JSC
    // itself only keeps these cells alive through the program's code block,
    // which its in-memory CodeCache evicts (and module records drop after
    // evaluation), so root them here for as long as the map is consulted.
    void pin(const JSC::LeafExecutableMap& leaves) WTF_REQUIRES_LOCK(m_lock)
    {
        m_pins.reserveCapacity(m_pins.size() + leaves.size());
        for (const auto* executable : leaves.keys())
            m_pins.append(JSC::Strong<JSC::Unknown>(executable->vm(), JSC::JSValue(executable)));
    }

    void stopCollecting() WTF_REQUIRES_LOCK(m_lock)
    {
        m_state = State::Frozen;
        m_bytecode->leafExecutables().clear();
        m_recorded.clear();
        m_pins.clear();
    }

    // The entry was replaced between fetch and compile (the file changed), so
    // this bytecode describes source nobody will look up.
    void discard()
    {
        Locker locker { m_lock };
        m_bytecode = nullptr;
        m_recorded.clear();
        m_pins.clear();
        m_state = State::Done;
    }

    const uint64_t m_key;
    const uint64_t m_entryId;
    Lock m_lock;
    State m_state WTF_GUARDED_BY_LOCK(m_lock) { State::AwaitingTopLevel };
    RefPtr<JSC::CachedBytecode> m_bytecode WTF_GUARDED_BY_LOCK(m_lock);
    std::optional<OptionSet<JSC::CodeGenerationMode>> m_codeGenerationMode WTF_GUARDED_BY_LOCK(m_lock);
    // 0 until an update with nested functions has been rejected.
    size_t m_nestedFunctionOverhead WTF_GUARDED_BY_LOCK(m_lock) { 0 };
    // Recorded* bits per function JSC has already reported (stored or not).
    HashMap<const JSC::UnlinkedFunctionExecutable*, uint8_t> m_recorded WTF_GUARDED_BY_LOCK(m_lock);
    // See pin(). Strong handles belong to the VM thread, so commit() (any
    // thread) leaves these alone; they go when collection stops, on the first
    // addFunction() after a commit, or with the provider, whose destructor runs
    // on the VM thread because heap cells hold the last references to it.
    Vector<JSC::Strong<JSC::Unknown>> m_pins WTF_GUARDED_BY_LOCK(m_lock);
};

void SourceProvider::cacheBytecode(const JSC::BytecodeCacheGenerator& generator) const
{
    if (auto* collector = m_nodeCompileCache.get())
        collector->addTopLevel(generator, this);
}

void SourceProvider::updateCache(const JSC::UnlinkedFunctionExecutable* executable, const JSC::SourceCode&, JSC::CodeSpecializationKind kind, const JSC::UnlinkedFunctionCodeBlock* codeBlock) const
{
    if (auto* collector = m_nodeCompileCache.get())
        collector->addFunction(executable, kind, codeBlock);
}

// Called by NodeCompileCache.rs, under its lock, for a provider it is attached
// to. The provider is alive: it is only freed after ~SourceProvider detaches,
// which needs that same lock. Nothing in here releases provider references, so
// the caller's lock cannot be re-entered. `sink` is invoked at most once,
// synchronously, and only with a non-empty blob.
extern "C" void ZigSourceProvider__commitNodeCompileCache(const SourceProvider* provider, void* context, void (*sink)(void* context, const uint8_t* bytecode, size_t bytecodeLength))
{
    Vector<uint8_t> blob = provider->nodeCompileCache()->commit();
    if (!blob.isEmpty())
        sink(context, blob.span().data(), blob.size());
}

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

extern "C" int ByteRangeMapping__getSourceID(void* mappings);
extern "C" void* ByteRangeMapping__find(BunString sourceURL);

extern "C" void ByteRangeMapping__generate(BunString sourceURL, BunString code, int sourceID);

JSC::SourceID sourceIDForSourceURL(const WTF::String& sourceURL)
{
    void* mappings = ByteRangeMapping__find(Bun::toString(sourceURL));
    if (!mappings) {
        return 0;
    }

    return ByteRangeMapping__getSourceID(mappings);
}

extern "C" bool BunTest__shouldGenerateCodeCoverage(BunString sourceURL);
extern "C" void Bun__addSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, BunString* specifier);
extern "C" void Bun__removeSourceProviderSourceMap(void* bun_vm, SourceProvider* opaque_source_provider, BunString* specifier);

Ref<SourceProvider> SourceProvider::create(
    Zig::GlobalObject* globalObject,
    ResolvedSource& resolvedSource,
    JSC::SourceProviderSourceType sourceType,
    bool isBuiltin)
{
    // Use BunTranspiledModule when module_info is present.
    // This allows JSC to skip parsing during the analyze phase (uses pre-computed imports/exports).
    // Bytecode cache (if present) is used separately during the evaluate phase.
    if (resolvedSource.module_info != nullptr) {
        ASSERT(!resolvedSource.isCommonJSModule);
        sourceType = JSC::SourceProviderSourceType::BunTranspiledModule;
    }

    auto string = resolvedSource.source_code.toWTFString(BunString::ZeroCopy);
    auto sourceURLString = resolvedSource.source_url.toWTFString(BunString::ZeroCopy);

    bool isCodeCoverageEnabled = !!globalObject->vm().controlFlowProfiler();

    bool shouldGenerateCodeCoverage = isCodeCoverageEnabled && !isBuiltin && BunTest__shouldGenerateCodeCoverage(resolvedSource.source_url);

    if (resolvedSource.needsDeref && !isBuiltin) {
        resolvedSource.needsDeref = false;
        resolvedSource.source_code.deref();
        // Do not deref either source_url or specifier
        // Specifier's lifetime is the JSValue, mostly
        // source_url is owned by the string above
        // https://github.com/oven-sh/bun/issues/9521
    }

    // Compute source origin: use explicit bytecode_origin_path if provided, otherwise derive from source_url.
    // bytecode_origin_path is used for bytecode cache validation where the origin must match
    // exactly what was used at build time.
    const auto getSourceOrigin = [&]() -> SourceOrigin {
        auto bytecodeOriginPath = resolvedSource.bytecode_origin_path.toWTFString(BunString::ZeroCopy);
        if (!bytecodeOriginPath.isNull() && !bytecodeOriginPath.isEmpty()) {
            // Convert file path to file:// URL (same as build time)
            return SourceOrigin(WTF::URL::fileURLWithFileSystemPath(bytecodeOriginPath));
        }
        return toSourceOrigin(sourceURLString, isBuiltin);
    };

    const auto getProvider = [&]() -> Ref<SourceProvider> {
        if (resolvedSource.bytecode_cache != nullptr) {
            const auto destructorPtr = [](const void* ptr) {
                // `bytecode_cache` was `heap::into_raw`'d from a Rust `Box<[u8]>`
                // (the global allocator); free with `defaultAllocatorFree` so
                // it agrees with the `#[global_allocator]`.
                Bun::defaultAllocatorFree(const_cast<void*>(ptr));
            };
            const auto destructorNoOp = [](const void* ptr) {
                // no-op, for bun build --compile.
            };
            const auto destructor = resolvedSource.needsDeref ? destructorPtr : destructorNoOp;

            auto origin = getSourceOrigin();

            Ref<JSC::CachedBytecode> bytecode = JSC::CachedBytecode::create(std::span<uint8_t>(resolvedSource.bytecode_cache, resolvedSource.bytecode_cache_size), destructor, {});
            auto provider = adoptRef(*new SourceProvider(
                globalObject->bunVM(),
                resolvedSource,
                string.isNull() ? *StringImpl::empty() : *string.impl(),
                JSC::SourceTaintedOrigin::Untainted,
                origin,
                sourceURLString.impl(), TextPosition(),
                sourceType));
            provider->m_cachedBytecode = WTF::move(bytecode);
            return provider;
        }

        return adoptRef(*new SourceProvider(
            globalObject->bunVM(),
            resolvedSource,
            string.isNull() ? *StringImpl::empty() : *string.impl(),
            JSC::SourceTaintedOrigin::Untainted,
            getSourceOrigin(),
            sourceURLString.impl(), TextPosition(),
            sourceType));
    };

    auto provider = getProvider();

    if (resolvedSource.node_compile_cache_entry_id != 0)
        provider->m_nodeCompileCache = makeUnique<NodeCompileCacheCollector>(resolvedSource.node_compile_cache_key, resolvedSource.node_compile_cache_entry_id);

    if (shouldGenerateCodeCoverage) {
        ByteRangeMapping__generate(Bun::toString(provider->sourceURL()), Bun::toString(provider->source().toStringWithoutCopying()), provider->asID());
    }

    if (resolvedSource.already_bundled) {
        Bun__addSourceProviderSourceMap(globalObject->bunVM(), provider.ptr(), &resolvedSource.source_url);
    }

    return provider;
}

SourceProvider::SourceProvider(void* bunVM, ResolvedSource resolvedSource, Ref<WTF::StringImpl>&& sourceImpl,
    JSC::SourceTaintedOrigin taintedness,
    const SourceOrigin& sourceOrigin, WTF::String&& sourceURL,
    const TextPosition& startPosition, JSC::SourceProviderSourceType sourceType)
    : Base(sourceOrigin, WTF::move(sourceURL), String(), taintedness, startPosition, sourceType)
    , m_resolvedSource(resolvedSource)
    , m_bunVM(bunVM)
    , m_source(WTF::move(sourceImpl))
{
}

StringView SourceProvider::source() const
{
    return StringView(m_source.get());
}

SourceProvider::~SourceProvider()
{
    if (m_nodeCompileCache)
        m_nodeCompileCache->detach(this);
    if (m_resolvedSource.already_bundled) {
        BunString str = Bun::toString(sourceURL());
        Bun__removeSourceProviderSourceMap(m_bunVM, this, &str);
    }
    if (m_resolvedSource.module_info != nullptr) {
        zig__ModuleInfoDeserialized__deinit(static_cast<bun_ModuleInfoDeserialized*>(m_resolvedSource.module_info));
        m_resolvedSource.module_info = nullptr;
    }
    // The Rust side hands these as +1 (RuntimeTranspilerStore::run_from_js_thread:
    // `out.dupeRef()` / `out.createIfDifferent(..)`; ModuleLoader paths likewise).
    // #9521 removed the early deref in `create()` because these strings are still
    // read after that point; the matching deref belongs here, once all uses are done.
    // `source_code` is intentionally NOT deref'd here — its +1 is consumed in
    // `create()` (gated on `needsDeref && !isBuiltin`) or by ResolvedSourceCodeHolder.
    m_resolvedSource.specifier.deref();
    m_resolvedSource.source_url.deref();
    m_resolvedSource.bytecode_origin_path.deref();
}

extern "C" void CachedBytecode__deref(JSC::CachedBytecode* cachedBytecode)
{
    cachedBytecode->deref();
}

static JSC::VM& getVMForBytecodeCache()
{
    static thread_local JSC::VM* vmForBytecodeCache = nullptr;
    if (!vmForBytecodeCache) {
        const auto heapSize = JSC::HeapType::Small;
        auto vmPtr = JSC::VM::tryCreate(heapSize);
        vmPtr->refSuppressingSaferCPPChecking();
        vmForBytecodeCache = vmPtr.get();
        vmPtr->heap.acquireAccess();
    }
    return *vmForBytecodeCache;
}

extern "C" bool generateCachedModuleByteCodeFromSourceCode(BunString* sourceProviderURL, const Latin1Character* inputSourceCode, size_t inputSourceCodeSize, const uint8_t** outputByteCode, size_t* outputByteCodeSize, JSC::CachedBytecode** cachedBytecodePtr)
{
    std::span<const Latin1Character> sourceCodeSpan(inputSourceCode, inputSourceCodeSize);
    JSC::SourceCode sourceCode = JSC::makeSource(WTF::String(sourceCodeSpan), toSourceOrigin(sourceProviderURL->toWTFString(), false), JSC::SourceTaintedOrigin::Untainted);

    JSC::VM& vm = getVMForBytecodeCache();

    JSC::JSLockHolder locker(vm);
    LexicallyScopedFeatures lexicallyScopedFeatures = StrictModeLexicallyScopedFeature;
    JSParserScriptMode scriptMode = JSParserScriptMode::Module;
    EvalContextType evalContextType = EvalContextType::None;

    ParserError parserError;
    UnlinkedModuleProgramCodeBlock* unlinkedCodeBlock = JSC::recursivelyGenerateUnlinkedCodeBlockForModuleProgram(vm, sourceCode, lexicallyScopedFeatures, scriptMode, {}, parserError, evalContextType);
    if (parserError.isValid())
        return false;
    if (!unlinkedCodeBlock)
        return false;

    auto key = JSC::sourceCodeKeyForSerializedModule(vm, sourceCode);

    dataLogLnIf(JSC::Options::verboseDiskCache(), "[Bytecode Build] generateModule url=", sourceProviderURL->toWTFString(), " origin=", sourceCode.provider()->sourceOrigin().url().string(), " sourceSize=", inputSourceCodeSize, " keyHash=", key.hash());

    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeCodeBlock(vm, key, unlinkedCodeBlock);
    if (!cachedBytecode)
        return false;

    cachedBytecode->ref();
    *cachedBytecodePtr = cachedBytecode.get();
    *outputByteCode = cachedBytecode->span().data();
    *outputByteCodeSize = cachedBytecode->span().size();

    return true;
}

extern "C" bool generateCachedCommonJSProgramByteCodeFromSourceCode(BunString* sourceProviderURL, const Latin1Character* inputSourceCode, size_t inputSourceCodeSize, const uint8_t** outputByteCode, size_t* outputByteCodeSize, JSC::CachedBytecode** cachedBytecodePtr)
{
    std::span<const Latin1Character> sourceCodeSpan(inputSourceCode, inputSourceCodeSize);

    JSC::SourceCode sourceCode = JSC::makeSource(WTF::String(sourceCodeSpan), toSourceOrigin(sourceProviderURL->toWTFString(), false), JSC::SourceTaintedOrigin::Untainted);
    JSC::VM& vm = getVMForBytecodeCache();

    JSC::JSLockHolder locker(vm);
    LexicallyScopedFeatures lexicallyScopedFeatures = NoLexicallyScopedFeatures;
    JSParserScriptMode scriptMode = JSParserScriptMode::Classic;
    EvalContextType evalContextType = EvalContextType::None;

    ParserError parserError;
    UnlinkedProgramCodeBlock* unlinkedCodeBlock = JSC::recursivelyGenerateUnlinkedCodeBlockForProgram(vm, sourceCode, lexicallyScopedFeatures, scriptMode, {}, parserError, evalContextType);
    if (parserError.isValid())
        return false;
    if (!unlinkedCodeBlock)
        return false;

    auto key = JSC::sourceCodeKeyForSerializedProgram(vm, sourceCode);

    dataLogLnIf(JSC::Options::verboseDiskCache(), "[Bytecode Build] generateCJS url=", sourceProviderURL->toWTFString(), " origin=", sourceCode.provider()->sourceOrigin().url().string(), " sourceSize=", inputSourceCodeSize, " keyHash=", key.hash());

    RefPtr<JSC::CachedBytecode> cachedBytecode = JSC::encodeCodeBlock(vm, key, unlinkedCodeBlock);
    if (!cachedBytecode)
        return false;

    cachedBytecode->ref();
    *cachedBytecodePtr = cachedBytecode.get();
    *outputByteCode = cachedBytecode->span().data();
    *outputByteCodeSize = cachedBytecode->span().size();

    return true;
}

unsigned SourceProvider::hash() const
{
    if (m_hash) {
        return m_hash;
    }

    return m_source->hash();
}

extern "C" BunString ZigSourceProvider__getSourceSlice(SourceProvider* provider)
{
    return Bun::toStringView(provider->source());
}

}; // namespace Zig
