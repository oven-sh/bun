#include "InternalModuleRegistry.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/Debugger.h>
#include <utility>

#include "InternalModuleRegistryConstants.h"
#include "InternalModuleRegistry+names.h"
#include "wtf/Forward.h"

#include "NativeModuleImpl.h"
#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/CachedTypes.h>
#include <JavaScriptCore/BytecodeCacheError.h>
#include <wtf/FileSystem.h>
#include <wtf/FileHandle.h>
#include <wtf/MappedFileData.h>
#include <wtf/DataLog.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>
#include <mutex>
namespace Bun {

extern "C" bool BunTest__shouldGenerateCodeCoverage(BunString sourceURL);
extern "C" void ByteRangeMapping__generate(BunString sourceURL, BunString code, int sourceID);

static void maybeAddCodeCoverage(JSC::VM& vm, const JSC::SourceCode& code)
{
#if ASSERT_ENABLED
    bool isCodeCoverageEnabled = !!vm.controlFlowProfiler();
    bool shouldGenerateCodeCoverage = isCodeCoverageEnabled && BunTest__shouldGenerateCodeCoverage(Bun::toString(code.provider()->sourceURL()));
    if (shouldGenerateCodeCoverage) {
        ByteRangeMapping__generate(Bun::toString(code.provider()->sourceURL()), Bun::toString(code.provider()->source().toStringWithoutCopying()), code.provider()->asID());
    }
#endif
}

// The `INTERNAL_MODULE_REGISTRY_GENERATE` macro handles inlining code to compile and run a
// JS builtin that acts as a module. In debug mode, we use a different implementation that reads
// from the developer's filesystem. This allows reloading code without recompiling bindings.

// ── Builtin bytecode cache (prototype) ───────────────────────────────────────
// BUN_BUILTIN_BYTECODE_DIR=<dir>   decode <dir>/<id>.jsc instead of parsing when present
// BUN_BUILTIN_BYTECODE_GENERATE=1  write <dir>/<id>.jsc for every module this process parses
// The payloads are process-wide and immortal; each VM wraps them in its own CachedBytecode.
namespace BuiltinBytecode {

static const char* directory()
{
    static const char* dir = getenv("BUN_BUILTIN_BYTECODE_DIR");
    return dir && *dir ? dir : nullptr;
}

static bool shouldGenerate()
{
    static bool generate = directory() && getenv("BUN_BUILTIN_BYTECODE_GENERATE");
    return generate;
}

static bool verbose()
{
    static bool v = !!getenv("BUN_BUILTIN_BYTECODE_VERBOSE");
    return v;
}

struct Store {
    Lock lock;
    std::array<std::span<uint8_t>, BUN_INTERNAL_MODULE_COUNT> payloads {};
    std::array<bool, BUN_INTERNAL_MODULE_COUNT> probed {};
};

static Store& store()
{
    static LazyNeverDestroyed<Store> s;
    static std::once_flag once;
    std::call_once(once, [] { s.construct(); });
    return s.get();
}

static String pathFor(unsigned id)
{
    return makeString(String::fromUTF8(directory()), "/"_s, id, ".jsc"_s);
}

// Immortal bytes for `id`, or an empty span.
static std::span<uint8_t> lookup(unsigned id)
{
    auto& st = store();
    Locker locker { st.lock };
    if (!st.probed[id] && directory()) {
        st.probed[id] = true;
        auto mapped = FileSystem::mapFile(pathFor(id), FileSystem::MappedFileMode::Private);
        if (mapped) {
            // Leak the mapping: payloads live for the process.
            st.payloads[id] = mapped->leakHandle();
        }
    }
    return st.payloads[id];
}

static size_t publishedSize(unsigned id)
{
    auto& st = store();
    Locker locker { st.lock };
    return st.payloads[id].size();
}

static void publish(unsigned id, std::span<const uint8_t> bytes)
{
    auto& st = store();
    {
        Locker locker { st.lock };
        // Keep whichever encoding carries the most generated code. A replaced payload is
        // left alive: decoders on other threads may still be reading it.
        if (st.payloads[id].size() >= bytes.size())
            return;
        auto* copy = static_cast<uint8_t*>(fastMalloc(bytes.size()));
        memcpy(copy, bytes.data(), bytes.size());
        st.payloads[id] = { copy, bytes.size() };
        st.probed[id] = true;
    }
    if (!directory() || !shouldGenerate())
        return;
    auto path = pathFor(id);
    auto handle = FileSystem::openFile(path, FileSystem::FileOpenMode::Truncate);
    if (handle) {
        handle.write(bytes);
    } else if (verbose())
        dataLogLn("[builtin-bytecode] failed to write ", path);
}

} // namespace BuiltinBytecode

static UnlinkedFunctionExecutable* createModuleExecutable(InternalModuleRegistry* registry, JSC::VM& vm, const SourceCode& source, const String& moduleName, unsigned id)
{
    MonotonicTime before;
    if (BuiltinBytecode::verbose()) [[unlikely]]
        before = MonotonicTime::now();

    if (auto bytes = BuiltinBytecode::lookup(id); !bytes.empty()) {
        auto cached = CachedBytecode::create(bytes, [](const void*) {}, {});
        if (auto* executable = decodeFunctionExecutable(vm, WTF::move(cached), source.provider())) {
            if (BuiltinBytecode::verbose()) [[unlikely]]
                dataLogLn("[builtin-bytecode] decoded ", moduleName, " (", bytes.size(), " bytes) in ", (MonotonicTime::now() - before).milliseconds(), " ms");
            return executable;
        }
        if (BuiltinBytecode::verbose()) [[unlikely]]
            dataLogLn("[builtin-bytecode] stale cache for ", moduleName, "; parsing");
    }

    UnlinkedFunctionExecutable* executable = createBuiltinExecutable(
        vm, source,
        Identifier::fromString(vm, moduleName),
        ImplementationVisibility::Public,
        ConstructorKind::None,
        ConstructAbility::CannotConstruct,
        InlineAttribute::None);

    registry->rememberModuleExecutable(vm, static_cast<InternalModuleRegistry::Field>(id), executable);

    if (BuiltinBytecode::shouldGenerate()) [[unlikely]] {
        BytecodeCacheError error;
        auto encodeStart = MonotonicTime::now();
        RefPtr<CachedBytecode> cached = encodeFunctionExecutable(vm, executable, source, NestedCodeBlocks::GenerateAll, error);
        if (cached && !error.isValid()) {
            BuiltinBytecode::publish(id, cached->span());
            if (BuiltinBytecode::verbose())
                dataLogLn("[builtin-bytecode] generated ", moduleName, " (", cached->span().size(), " bytes, source ", source.length(), ") in ", (MonotonicTime::now() - encodeStart).milliseconds(), " ms");
        } else if (BuiltinBytecode::verbose())
            dataLogLn("[builtin-bytecode] failed to encode ", moduleName, error.isValid() ? makeString(": "_s, error.message()) : String());
    } else if (BuiltinBytecode::verbose()) [[unlikely]]
        dataLogLn("[builtin-bytecode] parsed ", moduleName, " lazily in ", (MonotonicTime::now() - before).milliseconds(), " ms");

    return executable;
}

#ifndef BUN_DYNAMIC_JS_LOAD_PATH
// BUN_BUILTIN_BYTECODE_GENERATE_ALL=1: encode every JS builtin module (without evaluating any)
// the first time any module is loaded, so the cache directory is complete.
static void generateAllBuiltinBytecode(JSC::VM& vm)
{
    static std::once_flag once;
    std::call_once(once, [&] {
        if (!BuiltinBytecode::shouldGenerate() || !getenv("BUN_BUILTIN_BYTECODE_GENERATE_ALL"))
            return;
        size_t totalSource = 0, totalBytecode = 0;
        auto start = MonotonicTime::now();
        for (unsigned id = 0; id < BUN_NATIVE_MODULE_START_INDEX; id++) {
            auto [offset, length] = InternalModuleRegistryConstants::moduleSourceSpans[id];
            String name = String(internalModuleNames[id]).substring(strlen("NativeModule "));
            SourceCode source = JSC::makeSource(
                WTF::String(WTF::StringImpl::createWithoutCopying(std::span<const char>(bun_internal_modules_data + offset, length))),
                SourceOrigin(WTF::URL(makeString("builtin://"_s, name))), JSC::SourceTaintedOrigin::Untainted, name);
            UnlinkedFunctionExecutable* executable = createBuiltinExecutable(vm, source, Identifier::fromString(vm, name), ImplementationVisibility::Public, ConstructorKind::None, ConstructAbility::CannotConstruct, InlineAttribute::None);
            BytecodeCacheError error;
            RefPtr<CachedBytecode> cached = encodeFunctionExecutable(vm, executable, source, NestedCodeBlocks::GenerateAll, error);
            if (!cached || error.isValid()) {
                dataLogLn("[builtin-bytecode] FAILED ", name, error.isValid() ? makeString(": "_s, error.message()) : String());
                continue;
            }
            BuiltinBytecode::publish(id, cached->span());
            totalSource += length;
            totalBytecode += cached->span().size();
        }
        dataLogLn("[builtin-bytecode] generated all: ", BUN_NATIVE_MODULE_START_INDEX, " modules, source ", totalSource, " bytes, bytecode ", totalBytecode, " bytes, in ", (MonotonicTime::now() - start).milliseconds(), " ms");
    });
}
#endif

JSC::JSValue generateModule(JSC::JSGlobalObject* globalObject, JSC::VM& vm, const String& SOURCE, const String& moduleName, const String& urlString, unsigned id)
{
#ifndef BUN_DYNAMIC_JS_LOAD_PATH
    if (BuiltinBytecode::shouldGenerate()) [[unlikely]]
        generateAllBuiltinBytecode(vm);
#endif
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto&& origin = SourceOrigin(WTF::URL(urlString));
    SourceCode source = JSC::makeSource(SOURCE, origin, JSC::SourceTaintedOrigin::Untainted, moduleName);
    maybeAddCodeCoverage(vm, source);
    JSFunction* func
        = JSFunction::create(
            vm, globalObject,
            createModuleExecutable(uncheckedDowncast<Zig::GlobalObject>(globalObject)->internalModuleRegistry(), vm, source, moduleName, id)->link(vm, nullptr, source),
            static_cast<JSC::JSGlobalObject*>(globalObject));

    RETURN_IF_EXCEPTION(throwScope, {});
    if (globalObject->hasDebugger() && globalObject->debugger()->isInteractivelyDebugging()) [[unlikely]] {
        globalObject->debugger()->sourceParsed(globalObject, source.provider(), -1, ""_s);
    }

    JSC::MarkedArgumentBuffer argList;
    JSValue result = JSC::profiledCall(
        globalObject,
        ProfilingReason::Other,
        func,
        JSC::getCallData(func),
        globalObject, JSC::MarkedArgumentBuffer());

    RETURN_IF_EXCEPTION(throwScope, {});
    ASSERT(
        result && result.isCell() && dynamicDowncast<JSObject>(result),
        "Expected \"%s\" to export a JSObject. Bun is going to crash.",
        moduleName.utf8().span().data());
    return result;
}

// Accepts both generator signatures (BUN_FOREACH_ESM_NATIVE_MODULE and BUN_FOREACH_LAZY_ESM_NATIVE_MODULE);
// only the default export is used here, and a lazy generator always provides that one eagerly.
template<typename Generator>
ALWAYS_INLINE JSC::JSValue generateNativeModule(
    JSC::JSGlobalObject* globalObject,
    JSC::VM& vm,
    Generator generator)
{
    Vector<JSC::Identifier, 4> propertyNames;
    JSC::MarkedArgumentBuffer arguments;
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    generator(
        globalObject,
        vm.propertyNames->emptyIdentifier, // Our generators do not do anything with the key
        propertyNames,
        arguments);
    RETURN_IF_EXCEPTION(throwScope, {});
    // This goes off of the assumption that you only call this `evaluate` using a generator that explicitly
    // assigns the `default` export first.
    ASSERT_WITH_MESSAGE(
        propertyNames.at(0) == vm.propertyNames->defaultKeyword,
        "The native module must export a default value first.");
    JSValue defaultValue = arguments.at(0);
    ASSERT(defaultValue);
    return defaultValue;
}

#ifdef BUN_DYNAMIC_JS_LOAD_PATH
JSValue initializeInternalModuleFromDisk(JSGlobalObject* globalObject, VM& vm, const WTF::String& moduleName, WTF::String fileBase, const WTF::String& urlString, unsigned id)
{
    WTF::String file = makeString(ASCIILiteral::fromLiteralUnsafe(BUN_DYNAMIC_JS_LOAD_PATH), "/"_s, WTF::move(fileBase));
    if (auto contents = WTF::FileSystemImpl::readEntireFile(file)) {
        auto string = WTF::String::fromUTF8(contents.value());
        return generateModule(globalObject, vm, string, moduleName, urlString, id);
    } else {
        printf("\nFATAL: bun-debug failed to load bundled version of \"%s\" at \"%s\" (was it deleted?)\n"
               "Please re-compile Bun to continue.\n\n",
            moduleName.utf8().span().data(), file.utf8().span().data());
        CRASH();
    }
}
#define INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, moduleId, filename, OFFSET, LENGTH, urlString) \
    return initializeInternalModuleFromDisk(globalObject, vm, moduleId, filename, urlString, static_cast<unsigned>(id))
#else

// The module sources are linked as one read-only blob (bun_internal_modules_data,
// see the generated InternalModuleRegistryConstants.S); each module is a span at
// a known offset/length. createWithoutCopying is the same path the old
// ASCIILiteral → String conversion took.
#define INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, moduleId, filename, OFFSET, LENGTH, urlString)                         \
    return generateModule(globalObject, vm,                                                                                        \
        WTF::String(WTF::StringImpl::createWithoutCopying(std::span<const char>(bun_internal_modules_data + (OFFSET), (LENGTH)))), \
        moduleId, urlString, static_cast<unsigned>(id))
#endif

const ClassInfo InternalModuleRegistry::s_info = { "InternalModuleRegistry"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(InternalModuleRegistry) };

InternalModuleRegistry::InternalModuleRegistry(VM& vm, Structure* structure)
    : Base(vm, structure)
{
    // Initialize all internal fields to jsUndefined() using setWithoutWriteBarrier
    // to avoid triggering write barriers during construction
    for (uint8_t i = 0; i < BUN_INTERNAL_MODULE_COUNT; i++) {
        this->internalField(static_cast<Field>(i)).setWithoutWriteBarrier(jsUndefined());
    }
}

template<typename Visitor>
void InternalModuleRegistry::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<InternalModuleRegistry>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_moduleLoadList);
    if (thisObject->m_hasParsedExecutables) {
        for (auto& slot : thisObject->m_parsedExecutables)
            visitor.append(slot);
    }
}

DEFINE_VISIT_CHILDREN_WITH_MODIFIER(JS_EXPORT_PRIVATE, InternalModuleRegistry);

InternalModuleRegistry* InternalModuleRegistry::create(VM& vm, Structure* structure)
{
    InternalModuleRegistry* registry = new (NotNull, allocateCell<InternalModuleRegistry>(vm)) InternalModuleRegistry(vm, structure);
    registry->finishCreation(vm);
    return registry;
}

void InternalModuleRegistry::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

Structure* InternalModuleRegistry::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(InternalFieldTupleType, StructureFlags), info(), 0, 0);
}

JSValue InternalModuleRegistry::requireId(JSGlobalObject* globalObject, VM& vm, Field id)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto value = internalField(id).get();
    if (!value || value.isUndefined()) {
        value = createInternalModuleById(globalObject, vm, id);
        RETURN_IF_EXCEPTION(throwScope, {});
        internalField(id).set(vm, this, value);
        didLoad(globalObject, vm, id);
        RETURN_IF_EXCEPTION(throwScope, {});
    }
    return value;
}

#include "InternalModuleRegistry+createInternalModuleById.h"

void InternalModuleRegistry::didLoad(JSGlobalObject* globalObject, VM& vm, Field id)
{
    ASSERT(m_loadCount < BUN_INTERNAL_MODULE_COUNT);
    m_loadOrder[m_loadCount++] = static_cast<uint8_t>(id);
    if (auto* list = m_moduleLoadList.get())
        list->push(globalObject, jsString(vm, String(internalModuleNames[static_cast<uint8_t>(id)])));
}

void InternalModuleRegistry::rememberModuleExecutable(VM& vm, Field id, UnlinkedFunctionExecutable* executable)
{
    m_hasParsedExecutables = true;
    m_parsedExecutables[static_cast<uint8_t>(id)].set(vm, this, executable);
}

void InternalModuleRegistry::publishBytecodeForWorkers(JSGlobalObject* globalObject)
{
    if (!m_hasParsedExecutables)
        return;
    VM& vm = globalObject->vm();
    MonotonicTime start;
    unsigned count = 0;
    size_t bytes = 0;
    if (BuiltinBytecode::verbose()) [[unlikely]]
        start = MonotonicTime::now();
    // AsIs encoding never touches the parent source; nested functions carry their own ranges.
    SourceCode unusedSource;
    for (unsigned id = 0; id < BUN_INTERNAL_MODULE_COUNT; id++) {
        UnlinkedFunctionExecutable* executable = m_parsedExecutables[id].get();
        if (!executable)
            continue;
        BytecodeCacheError error;
        if (RefPtr<CachedBytecode> cached = encodeFunctionExecutable(vm, executable, unusedSource, NestedCodeBlocks::AsIs, error); cached && !error.isValid()) {
            if (cached->span().size() > BuiltinBytecode::publishedSize(id)) {
                BuiltinBytecode::publish(id, cached->span());
                count++;
                bytes += cached->span().size();
            }
        }
    }
    m_hasParsedExecutables = true;
    if (BuiltinBytecode::verbose() && count) [[unlikely]]
        dataLogLn("[builtin-bytecode] published ", count, " modules (", bytes, " bytes) for workers in ", (MonotonicTime::now() - start).milliseconds(), " ms");
}

extern "C" void Bun__publishBuiltinBytecodeForWorkers(Zig::GlobalObject* globalObject)
{
    globalObject->internalModuleRegistry()->publishBytecodeForWorkers(globalObject);
}

JSArray* InternalModuleRegistry::moduleLoadList(JSGlobalObject* globalObject)
{
    if (auto* list = m_moduleLoadList.get())
        return list;
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer names;
    for (uint16_t i = 0; i < m_loadCount; i++)
        names.append(jsString(vm, String(internalModuleNames[m_loadOrder[i]])));
    auto* list = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), names);
    RETURN_IF_EXCEPTION(throwScope, nullptr);
    m_moduleLoadList.set(vm, this, list);
    return list;
}

// This is called like @getInternalField(@internalModuleRegistry, 1) ?? @createInternalModuleById(1)
// so we want to write it to the internal field when loaded.
JSC_DEFINE_HOST_FUNCTION(InternalModuleRegistry::jsCreateInternalModuleById, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto id = callframe->argument(0).toUInt32(lexicalGlobalObject);

    auto registry = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject)->internalModuleRegistry();
    auto mod = registry->createInternalModuleById(lexicalGlobalObject, vm, static_cast<Field>(id));
    RETURN_IF_EXCEPTION(throwScope, {});
    registry->internalField(static_cast<Field>(id)).set(vm, registry, mod);
    registry->didLoad(lexicalGlobalObject, vm, static_cast<Field>(id));
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(mod);
}

} // namespace Bun

#undef INTERNAL_MODULE_REGISTRY_GENERATE
