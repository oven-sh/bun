#include "InternalModuleRegistry.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/Debugger.h>
#include <atomic>
#include <utility>

#include "InternalModuleRegistryConstants.h"
#include "wtf/Forward.h"

#include "NativeModuleImpl.h"
#include "BunBuiltinNames.h"
#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/CachedTypes.h>
#include <JavaScriptCore/CodeCache.h>
#include <JavaScriptCore/ParserError.h>

// A `bun build --compile` executable may carry ahead-of-time bytecode for the internal modules the app uses
// (StandaloneModuleGraph, Flags::HAS_BUILTIN_BYTECODE); those bytes live in the executable for the life of the process.
extern "C" bool Bun__standaloneInternalModuleBytecode(void* bunVM, uint32_t id, const uint8_t** bytes, size_t* size);

namespace Bun {

extern "C" bool BunTest__shouldGenerateCodeCoverage(const BunString* sourceURL);
extern "C" void ByteRangeMapping__generate(const BunString* sourceURL, const BunString* code, int sourceID);

static void maybeAddCodeCoverage(JSC::VM& vm, const JSC::SourceCode& code)
{
#if ASSERT_ENABLED
    bool isCodeCoverageEnabled = !!vm.controlFlowProfiler();
    BunString sourceURL = Bun::toString(code.provider()->sourceURL());
    bool shouldGenerateCodeCoverage = isCodeCoverageEnabled && BunTest__shouldGenerateCodeCoverage(&sourceURL);
    if (shouldGenerateCodeCoverage) {
        WTF::String sourceString = code.provider()->source().toStringWithoutCopying();
        BunString source = Bun::toString(sourceString);
        ByteRangeMapping__generate(&sourceURL, &source, code.provider()->asID());
    }
#endif
}

// The `INTERNAL_MODULE_REGISTRY_GENERATE` macro handles inlining code to compile and run a
// JS builtin that acts as a module. In debug mode, we use a different implementation that reads
// from the developer's filesystem. This allows reloading code without recompiling bindings.

static std::atomic<unsigned> s_internalModulesFromBytecode { 0 };

// bun:internal-for-testing: how many internal modules this process created from embedded bytecode rather than source.
JSC_DEFINE_HOST_FUNCTION(jsInternalModulesLoadedFromBytecode, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    return JSValue::encode(jsNumber(s_internalModulesFromBytecode.load(std::memory_order_relaxed)));
}

static SourceCode makeInternalModuleSource(const String& text, const String& moduleName, const String& urlString)
{
    return JSC::makeSource(text, SourceOrigin(WTF::URL(urlString)), JSC::SourceTaintedOrigin::Untainted, moduleName);
}

static UnlinkedFunctionExecutable* createInternalModuleExecutable(JSC::VM& vm, const SourceCode& source, const String& moduleName)
{
    return createBuiltinExecutable(vm, source, Identifier::fromString(vm, moduleName), ImplementationVisibility::Public, ConstructorKind::None, ConstructAbility::CannotConstruct, InlineAttribute::None);
}

JSC::JSValue generateModule(JSC::JSGlobalObject* globalObject, JSC::VM& vm, const String& SOURCE, const String& moduleName, const String& urlString, uint32_t id)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    SourceCode source = makeInternalModuleSource(SOURCE, moduleName, urlString);
    maybeAddCodeCoverage(vm, source);

    UnlinkedFunctionExecutable* executable = nullptr;
    const uint8_t* cachedBytes = nullptr;
    size_t cachedSize = 0;
    if (Bun__standaloneInternalModuleBytecode(::bunVM(globalObject), id, &cachedBytes, &cachedSize)) {
        Ref<JSC::CachedBytecode> cached = JSC::CachedBytecode::create(std::span<uint8_t> { const_cast<uint8_t*>(cachedBytes), cachedSize }, [](const void*) {}, {});
        cached->setPayloadIsPersistent();
        executable = JSC::decodeBuiltinFunction(vm, WTF::move(cached), *source.provider(), InternalModuleRegistryConstants::sourceStamp);
        if (executable)
            s_internalModulesFromBytecode.fetch_add(1, std::memory_order_relaxed);
    }
    if (!executable)
        executable = createInternalModuleExecutable(vm, source, moduleName);

    JSFunction* func = JSFunction::create(vm, globalObject, executable->link(vm, nullptr, source), static_cast<JSC::JSGlobalObject*>(globalObject));

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
static WTF::String internalModuleSourceFromDisk(const WTF::String& moduleName, WTF::String fileBase)
{
    WTF::String file = makeString(ASCIILiteral::fromLiteralUnsafe(BUN_DYNAMIC_JS_LOAD_PATH), "/"_s, WTF::move(fileBase));
    auto contents = WTF::FileSystemImpl::readEntireFile(file);
    if (!contents) {
        printf("\nFATAL: bun-debug failed to load bundled version of \"%s\" at \"%s\" (was it deleted?)\n"
               "Please re-compile Bun to continue.\n\n",
            moduleName.utf8().span().data(), file.utf8().span().data());
        CRASH();
    }
    return WTF::String::fromUTF8(contents.value());
}

JSValue initializeInternalModuleFromDisk(JSGlobalObject* globalObject, VM& vm, const WTF::String& moduleName, WTF::String fileBase, const WTF::String& urlString, uint32_t id)
{
    return generateModule(globalObject, vm, internalModuleSourceFromDisk(moduleName, WTF::move(fileBase)), moduleName, urlString, id);
}
#define INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, moduleId, filename, OFFSET, LENGTH, urlString, ID) \
    return initializeInternalModuleFromDisk(globalObject, vm, moduleId, filename, urlString, ID)
#define INTERNAL_MODULE_SOURCE(m) internalModuleSourceFromDisk(m.moduleId, m.fileName)
#else

// The module sources are linked as one read-only blob (bun_internal_modules_data,
// see the generated InternalModuleRegistryConstants.S); each module is a span at
// a known offset/length. createWithoutCopying is the same path the old
// ASCIILiteral → String conversion took.
#define INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, moduleId, filename, OFFSET, LENGTH, urlString, ID)                     \
    return generateModule(globalObject, vm,                                                                                        \
        WTF::String(WTF::StringImpl::createWithoutCopying(std::span<const char>(bun_internal_modules_data + (OFFSET), (LENGTH)))), \
        moduleId, urlString, ID)
#define INTERNAL_MODULE_SOURCE(m) WTF::String(WTF::StringImpl::createWithoutCopying(std::span<const char>(bun_internal_modules_data + m.codeOffset, m.codeLength)))
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
    }
    return value;
}

#include "InternalModuleRegistry+createInternalModuleById.h"

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
    return JSValue::encode(mod);
}

} // namespace Bun

namespace Zig {
JSC::VM& vmForBytecodeCache();
}

// bun build --compile: bytecode for internal JS module `id` (an index below BUN_NATIVE_MODULE_START_INDEX), generated the
// way generateModule() will consume it. The caller owns *handle and releases it with CachedBytecode__deref.
// `depth`: how many levels of nested functions get code blocks too (UINT32_MAX = all; 0 = only the module wrapper's own).
extern "C" bool Bun__generateInternalModuleBytecode(uint32_t id, uint32_t depth, const uint8_t** bytes, size_t* size, JSC::CachedBytecode** handle, JSC::EncoderStringTable* externalStrings)
{
    using namespace Bun;
    if (id >= std::size(internalJSModules))
        return false;
    const InternalJSModule& m = internalJSModules[id];
    JSC::VM& vm = Zig::vmForBytecodeCache();
    JSC::JSLockHolder locker(vm);
    // The builtins parse with private @names; register Bun's on this throwaway VM (its own VM gets them from JSVMClientData).
    static thread_local std::unique_ptr<BunBuiltinNames> builtinNames;
    if (!vm.clientData && !builtinNames)
        builtinNames = BunBuiltinNames::createStandalone(vm);
    String text = INTERNAL_MODULE_SOURCE(m);
    SourceCode source = makeInternalModuleSource(text, m.moduleId, m.url);
    UnlinkedFunctionExecutable* executable = createInternalModuleExecutable(vm, source, m.moduleId);
    ParserError error;
    JSC::recursivelyGenerateUnlinkedCodeBlocksForFunction(vm, executable, source, error, depth);
    if (error.isValid())
        return false;
    RefPtr<JSC::CachedBytecode> result = JSC::encodeBuiltinFunction(vm, executable, source.length(), InternalModuleRegistryConstants::sourceStamp, externalStrings);
    if (!result)
        return false;
    result->ref();
    *bytes = result->span().data();
    *size = result->size();
    *handle = result.get();
    return true;
}

// The internal JS modules `id` statically requires (so an ahead-of-time build can include them too).
extern "C" size_t Bun__internalModuleDependencies(uint32_t id, const uint16_t** out)
{
    using namespace Bun::InternalModuleRegistryConstants;
    if (id >= std::size(dependencyOffsets) - 1)
        return 0;
    *out = dependencies + dependencyOffsets[id];
    return dependencyOffsets[id + 1] - dependencyOffsets[id];
}

#undef INTERNAL_MODULE_REGISTRY_GENERATE
#undef INTERNAL_MODULE_SOURCE
