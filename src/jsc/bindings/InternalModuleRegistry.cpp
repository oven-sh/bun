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
#include "JSBuffer.h"
#include <JavaScriptCore/ObjectConstructor.h>
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

// JS internal modules are compiled from the sources linked into the executable's builtins section (see
// InternalModuleRegistryConstants.h). In debug mode the sources are read from the developer's filesystem instead,
// which allows reloading code without recompiling bindings.

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

static const InternalModuleRegistryConstants::ModuleRecord& internalModuleRecord(uint32_t id)
{
    ASSERT(id < bun_internal_modules_header.moduleCount);
    auto* records = reinterpret_cast<const InternalModuleRegistryConstants::ModuleRecord*>(reinterpret_cast<const char*>(&bun_internal_modules_header) + bun_internal_modules_header.modulesOffset);
    return records[id];
}

static String internalModuleString(uint32_t offset, uint32_t length)
{
    return WTF::StringImpl::createWithoutCopying(std::span<const char>(bun_internal_modules_data + offset, length));
}

#ifdef BUN_DYNAMIC_JS_LOAD_PATH
static String internalModuleSource(uint32_t id)
{
    const auto& m = internalModuleRecord(id);
    String moduleName = internalModuleString(m.nameOffset, m.nameLength);
    WTF::String file = makeString(ASCIILiteral::fromLiteralUnsafe(BUN_DYNAMIC_JS_LOAD_PATH), "/"_s, ASCIILiteral::fromLiteralUnsafe(InternalModuleRegistryConstants::fileNames[id]));
    auto contents = WTF::FileSystemImpl::readEntireFile(file);
    if (!contents) {
        printf("\nFATAL: bun-debug failed to load bundled version of \"%s\" at \"%s\" (was it deleted?)\n"
               "Please re-compile Bun to continue.\n\n",
            moduleName.utf8().span().data(), file.utf8().span().data());
        CRASH();
    }
    return WTF::String::fromUTF8(contents.value());
}
#else
static String internalModuleSource(uint32_t id)
{
    const auto& m = internalModuleRecord(id);
    return internalModuleString(m.codeOffset, m.codeLength);
}
#endif

JSC::JSValue generateInternalModule(JSC::JSGlobalObject* globalObject, JSC::VM& vm, uint32_t id)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    const auto& m = internalModuleRecord(id);
    String moduleName = internalModuleString(m.nameOffset, m.nameLength);
    SourceCode source = makeInternalModuleSource(internalModuleSource(id), moduleName, internalModuleString(m.urlOffset, m.urlLength));
    maybeAddCodeCoverage(vm, source);

    UnlinkedFunctionExecutable* executable = nullptr;
    const uint8_t* cachedBytes = nullptr;
    size_t cachedSize = 0;
    if (Bun__standaloneInternalModuleBytecode(::bunVM(globalObject), id, &cachedBytes, &cachedSize)) {
        Ref<JSC::CachedBytecode> cached = JSC::CachedBytecode::create(std::span<uint8_t> { const_cast<uint8_t*>(cachedBytes), cachedSize }, [](const void*) {}, {});
        cached->setPayloadIsPersistent();
        executable = JSC::decodeBuiltinFunction(vm, WTF::move(cached), *source.provider(), bun_internal_modules_header.sourceStamp);
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
        recordLoad(globalObject, vm, id);
        RETURN_IF_EXCEPTION(throwScope, {});
    }
    return value;
}

#include "InternalModuleRegistry+createInternalModuleById.h"
#include "InternalModuleRegistry+names.h"

void InternalModuleRegistry::recordLoad(JSGlobalObject* globalObject, VM& vm, Field id)
{
    // Bounded: an id normally loads once, but a native module can be instantiated by
    // both the ES module loader and require(), and a builtin require cycle could
    // re-enter createInternalModuleById for an id that is still evaluating.
    if (m_loadCount < BUN_INTERNAL_MODULE_COUNT)
        m_loadOrder[m_loadCount++] = static_cast<uint8_t>(id);
    // putDirectIndex, not push: appending must not run Array.prototype setters or
    // fail on a frozen list in the middle of loading a builtin.
    if (auto* list = m_moduleLoadList.get())
        list->putDirectIndex(globalObject, list->length(), jsString(vm, String(internalModuleNames[static_cast<uint8_t>(id)])));
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
    RETURN_IF_EXCEPTION(throwScope, {});

    auto registry = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject)->internalModuleRegistry();
    auto mod = registry->createInternalModuleById(lexicalGlobalObject, vm, static_cast<Field>(id));
    RETURN_IF_EXCEPTION(throwScope, {});
    registry->internalField(static_cast<Field>(id)).set(vm, registry, mod);
    registry->recordLoad(lexicalGlobalObject, vm, static_cast<Field>(id));
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(mod);
}

} // namespace Bun

namespace Zig {
JSC::VM& vmForBytecodeCache();
void ensureBuiltinNamesForBytecodeCache(JSC::VM&);
}
extern "C" void Bun__destroyBytecodeCacheVM();

static bool encodeInternalModule(const String& text, const String& moduleName, const String& url, uint32_t sourceStamp, uint32_t depth, const uint8_t** bytes, size_t* size, JSC::CachedBytecode** handle, JSC::EncoderStringTable* externalStrings)
{
    using namespace Bun;
    JSC::VM& vm = Zig::vmForBytecodeCache();
    JSC::JSLockHolder locker(vm);
    Zig::ensureBuiltinNamesForBytecodeCache(vm);
    SourceCode source = makeInternalModuleSource(text, moduleName, url);
    UnlinkedFunctionExecutable* executable = createInternalModuleExecutable(vm, source, moduleName);
    ParserError error;
    JSC::recursivelyGenerateUnlinkedCodeBlocksForFunction(vm, executable, source, error, depth);
    if (error.isValid())
        return false;
    RefPtr<JSC::CachedBytecode> result = JSC::encodeBuiltinFunction(vm, executable, source.length(), sourceStamp, externalStrings, JSC::BytecodeCacheChecksums::No, JSC::BytecodeCacheUpdatable::No);
    if (!result)
        return false;
    result->ref();
    *bytes = result->span().data();
    *size = result->size();
    *handle = result.get();
    return true;
}

// bun build --compile: bytecode for this executable's internal JS module `id` (an index below
// BUN_NATIVE_MODULE_START_INDEX), generated the way generateInternalModule() will consume it. The caller owns *handle and
// releases it with CachedBytecode__deref. `depth`: how many levels of nested functions get code blocks too
// (UINT32_MAX = all; 0 = only the module wrapper's own).
extern "C" bool Bun__generateInternalModuleBytecode(uint32_t id, uint32_t depth, const uint8_t** bytes, size_t* size, JSC::CachedBytecode** handle, JSC::EncoderStringTable* externalStrings)
{
    using namespace Bun;
    if (id >= bun_internal_modules_header.moduleCount)
        return false;
    const auto& m = internalModuleRecord(id);
    return encodeInternalModule(internalModuleSource(id), internalModuleString(m.nameOffset, m.nameLength), internalModuleString(m.urlOffset, m.urlLength), bun_internal_modules_header.sourceStamp, depth, bytes, size, handle, externalStrings);
}

// Same, for an internal module of another bun executable (cross-compiling): its source, name, url and source stamp as
// read from that executable's builtins section.
extern "C" bool Bun__generateInternalModuleBytecodeFromSource(const Latin1Character* text, size_t textLength, const Latin1Character* name, size_t nameLength, const Latin1Character* url, size_t urlLength, uint32_t sourceStamp, uint32_t depth, const uint8_t** bytes, size_t* size, JSC::CachedBytecode** handle, JSC::EncoderStringTable* externalStrings)
{
    using namespace Bun;
    return encodeInternalModule(String({ text, textLength }), String({ name, nameLength }), String({ url, urlLength }), sourceStamp, depth, bytes, size, handle, externalStrings);
}

namespace Bun {

// bun:internal-for-testing: the bytecode `bun build --compile --bytecode` would embed for a builtin module, and the
// external string table it would embed beside it -- either for internal module number `index` (null past the last
// one), or for `source` written in builtin syntax under `name`.
JSC_DEFINE_HOST_FUNCTION(jsInternalModuleBytecode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    String text, name, url;
    uint32_t stamp = 0;
    if (callFrame->argument(0).isString()) {
        text = callFrame->argument(0).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (!callFrame->argument(1).isString())
            return throwVMTypeError(globalObject, scope, "internalModuleBytecode(source, name): name must be a string"_s);
        name = callFrame->argument(1).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (!text.is8Bit() || !text.startsWith("(function ("_s))
            return throwVMTypeError(globalObject, scope, "internalModuleBytecode(source, name): source must be Latin-1 and start with \"(function (\""_s);
        url = makeString("builtin://"_s, name);
    } else {
        uint32_t index = callFrame->argument(0).toUInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (index >= bun_internal_modules_header.moduleCount)
            return JSValue::encode(jsNull());
        const auto& m = internalModuleRecord(index);
        text = internalModuleSource(index);
        name = internalModuleString(m.nameOffset, m.nameLength);
        url = internalModuleString(m.urlOffset, m.urlLength);
        stamp = bun_internal_modules_header.sourceStamp;
    }
    JSC::EncoderStringTable externalStrings;
    const uint8_t* bytes = nullptr;
    size_t size = 0;
    JSC::CachedBytecode* handle = nullptr;
    bool encoded = encodeInternalModule(text, name, url, stamp, std::numeric_limits<uint32_t>::max(), &bytes, &size, &handle, &externalStrings);
    // The encoder runs in this thread's bytecode-cache VM; `bun build` tears it down after a build, and so does this.
    Bun__destroyBytecodeCacheVM();
    if (!encoded)
        return throwVMError(globalObject, scope, makeString("could not generate bytecode for "_s, name));
    RefPtr<JSC::CachedBytecode> bytecode = adoptRef(handle);
    JSC::JSUint8Array* buffer = WebCore::createBuffer(globalObject, bytecode->span());
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSUint8Array* strings = WebCore::createBuffer(globalObject, externalStrings.serialize().span());
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* result = constructEmptyObject(globalObject);
    result->putDirect(vm, vm.propertyNames->name, jsString(vm, name));
    result->putDirect(vm, Identifier::fromString(vm, "bytecode"_s), buffer);
    result->putDirect(vm, Identifier::fromString(vm, "strings"_s), strings);
    return JSValue::encode(result);
}

} // namespace Bun

// This executable's whole builtins section (header, index, sources), for the bundler's section reader.
extern "C" const uint8_t* Bun__builtinsSection(size_t* length)
{
    const auto& h = bun_internal_modules_header;
    *length = h.dataOffset + h.dataLength;
    return reinterpret_cast<const uint8_t*>(&h);
}
