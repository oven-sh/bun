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
#include "ModuleGraph.h"
#include "ZigSourceProvider.h"
#include "wtf/Forward.h"

#include "NativeModuleImpl.h"
#include "BunBuiltinNames.h"
#include "BunCompiledModules.h"
#include "ErrorCode.h"
#include "JSBuffer.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/CachedBytecode.h>
#include <JavaScriptCore/CachedTypes.h>
#include <JavaScriptCore/CodeCache.h>
#include <JavaScriptCore/ParserError.h>
#include <JavaScriptCore/SourceProviderCache.h>
#include <JavaScriptCore/SourceProviderCacheItem.h>
#include <JavaScriptCore/SymbolTable.h>
#include <JavaScriptCore/UnlinkedFunctionCodeBlock.h>
#include <JavaScriptCore/AOTHost.h>

// A `bun build --compile` executable may carry ahead-of-time bytecode for the internal modules the app uses
// (StandaloneModuleGraph, Flags::HAS_BUILTIN_BYTECODE); those bytes live in the executable for the life of the process.
extern "C" bool Bun__standaloneInternalModuleBytecode(void* bunVM, uint32_t id, const uint8_t** bytes, size_t* size, uint32_t* entryOffset);
extern "C" JSC::EncodedJSValue Bun__createModuleNotCompiledInError(JSC::JSGlobalObject*, Bun::ErrorCode, const BunString* specifier);

namespace Bun {

extern "C" bool BunTest__shouldGenerateCodeCoverage(const BunString* sourceURL);
extern "C" void ByteRangeMapping__generate(const BunString* sourceURL, const BunString* code, int sourceID, bool alreadyBundled);

static void maybeAddCodeCoverage(JSC::VM& vm, const JSC::SourceCode& code)
{
#if ASSERT_ENABLED
    bool isCodeCoverageEnabled = !!vm.controlFlowProfiler();
    BunString sourceURL = Bun::toString(code.provider()->sourceURL());
    bool shouldGenerateCodeCoverage = isCodeCoverageEnabled && BunTest__shouldGenerateCodeCoverage(&sourceURL);
    if (shouldGenerateCodeCoverage) {
        WTF::String sourceString = code.provider()->source().toStringWithoutCopying();
        BunString source = Bun::toString(sourceString);
        ByteRangeMapping__generate(&sourceURL, &source, code.provider()->asID(), false);
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

// The debugger's module is no part of the program, so Options::crashIfInterpreterIsUsed() must not report it. The debugger never starts with Options::disallowNonStaticCode().
static JSC::SourceProvenance internalModuleProvenance(uint32_t id)
{
    return id == InternalModuleRegistry::Field::InternalDebugger ? JSC::SourceProvenance::GeneratedAtRuntime : JSC::SourceProvenance::Static;
}

static SourceCode makeInternalModuleSource(const String& text, const String& moduleName, const String& urlString, JSC::SourceProvenance provenance)
{
    return JSC::makeSource(text, SourceOrigin(WTF::URL(urlString)), JSC::SourceTaintedOrigin::Untainted, moduleName, TextPosition(), JSC::SourceProviderSourceType::Program, provenance);
}

static UnlinkedFunctionExecutable* createInternalModuleExecutable(JSC::VM& vm, const SourceCode& source, const String& moduleName)
{
    return createBuiltinExecutable(vm, source, Identifier::fromString(vm, moduleName), ImplementationVisibility::Public, ConstructorKind::None, ConstructAbility::CannotConstruct, InlineAttribute::None);
}

#ifndef BUN_DYNAMIC_JS_LOAD_PATH
static uint32_t readVarint(const uint8_t*& cursor)
{
    uint32_t value = 0;
    for (unsigned shift = 0;; shift += 7) {
        uint8_t byte = *cursor++;
        value |= static_cast<uint32_t>(byte & 0x7f) << shift;
        if (!(byte & 0x80))
            return value;
    }
}
#endif

// src/codegen/lazy-function-table.ts
static unsigned prefillSourceProviderCache(JSC::VM& vm, const SourceCode& source, uint32_t id)
{
#ifdef BUN_DYNAMIC_JS_LOAD_PATH
    UNUSED_PARAM(vm);
    UNUSED_PARAM(source);
    UNUSED_PARAM(id);
    return 0;
#else
    const uint8_t* cursor = InternalModuleRegistryConstants::lazyFunctionTable + InternalModuleRegistryConstants::lazyFunctionTableOffsets[id];
    if (InternalModuleRegistryConstants::lazyFunctionTableOffsets[id] == InternalModuleRegistryConstants::lazyFunctionTableOffsets[id + 1])
        return 0;

    StringView view = source.provider()->source();
    auto text = view.span8();
    uint32_t capturedNameCount = readVarint(cursor);
    Vector<Identifier, 128> capturedNames;
    capturedNames.reserveInitialCapacity(capturedNameCount);
    for (uint32_t i = 0, start = 0; i < capturedNameCount; ++i) {
        start += readVarint(cursor);
        uint32_t length = readVarint(cursor);
        capturedNames.append(Identifier::fromString(vm, text.subspan(start, length)));
    }

    JSC::SourceProviderCache* cache = vm.addSourceProviderCache(source.provider());
    uint32_t functionCount = readVarint(cursor);
    uint32_t capturedNamesOwner = readVarint(cursor);
    for (uint32_t i = 0, offset = 0; i < functionCount; ++i) {
        uint32_t parametersStart = offset + readVarint(cursor);
        uint32_t closeBrace = parametersStart + readVarint(cursor);
        uint32_t bits = readVarint(cursor);
        offset = closeBrace;

        JSC::SourceProviderCacheItemCreationParameters parameters;
        parameters.lastTokenStartOffset = closeBrace;
        parameters.lastTokenEndOffset = closeBrace + 1;
        parameters.endFunctionOffset = closeBrace;
        parameters.parameterCount = bits >> 1;
        parameters.containsTaggedTemplate = bits & 1;
        parameters.lexicallyScopedFeatures = JSC::StrictModeLexicallyScopedFeature;
        parameters.constructorKind = JSC::ConstructorKind::None;
        parameters.expectedSuperBinding = JSC::SuperBinding::NotNeeded;
        if (i == capturedNamesOwner) {
            for (auto& name : capturedNames)
                parameters.usedVariables.append(name.impl());
        }
        cache->add(parametersStart, JSC::SourceProviderCacheItem::create(parameters));
    }
    return functionCount;
#endif
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
            moduleName.utf8().legacyCStringPointer(), file.utf8().legacyCStringPointer());
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

static void throwModuleTextRemovedError(JSC::JSGlobalObject*, uint32_t id);

static NEVER_INLINE JSC::JSValue generateInternalModuleFromText(JSC::JSGlobalObject* globalObject, JSC::VM& vm, uint32_t id)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    const auto& m = internalModuleRecord(id);
    if (!m.codeLength) [[unlikely]] {
        throwModuleTextRemovedError(globalObject, id);
        RELEASE_AND_RETURN(throwScope, {});
    }
    String moduleName = internalModuleString(m.nameOffset, m.nameLength);
    SourceCode source = makeInternalModuleSource(internalModuleSource(id), moduleName, internalModuleString(m.urlOffset, m.urlLength), internalModuleProvenance(id));
    maybeAddCodeCoverage(vm, source);

    UnlinkedFunctionExecutable* executable = nullptr;
    const uint8_t* cachedBytes = nullptr;
    size_t cachedSize = 0;
    uint32_t cachedEntryOffset = 0;
    if (Bun__standaloneInternalModuleBytecode(::bunVM(globalObject), id, &cachedBytes, &cachedSize, &cachedEntryOffset)) {
        executable = JSC::decodeBuiltinFunction(vm, embeddedBytecode({ const_cast<uint8_t*>(cachedBytes), cachedSize }, cachedEntryOffset), *source.provider(), bun_internal_modules_header.sourceStamp);
        if (executable)
            s_internalModulesFromBytecode.fetch_add(1, std::memory_order_relaxed);
    }
    if (!executable) {
        JSC::BuiltinSourceMetadata metadata { static_cast<unsigned>(source.length()), static_cast<unsigned>(strlen("function (")), 0, static_cast<int>(strlen("})\n")), false, true };
        executable = createBuiltinExecutable(vm, source, metadata, Identifier::fromString(vm, moduleName), ImplementationVisibility::Public, ConstructorKind::None, ConstructAbility::CannotConstruct, InlineAttribute::None);
        prefillSourceProviderCache(vm, source, id);
    }

    JSFunction* func = JSFunction::create(vm, globalObject, executable->link(vm, nullptr, source), static_cast<JSC::JSGlobalObject*>(globalObject));

    RETURN_IF_EXCEPTION(throwScope, {});
    if (globalObject->hasDebugger() && globalObject->debugger()->isInteractivelyDebugging()) [[unlikely]] {
        globalObject->debugger()->sourceParsed(globalObject, source.provider(), -1, ""_s);
    }

    // A builtin module is the realm's, whichever script is first to load it: what its top level
    // makes (an http Agent, say) is not the Bun.ModuleGraph's that happened to need it first.
    Bun::ModuleGraphContextScope realmContext(*defaultGlobalObject(globalObject)->scriptExecutionContext());
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
        moduleName.utf8().legacyCStringPointer());
    return result;
}

static const char* publicModuleName(uint32_t id)
{
    const char* name = InternalModuleRegistryConstants::publicModuleNames;
    for (uint32_t before = id; before--;)
        name += strlen(name) + 1;
    return name;
}

static void throwRemovedModuleError(JSC::JSGlobalObject* globalObject, JSC::RemovableFeature feature, uint32_t id, Bun::ErrorCode code = Bun::ErrorCode::ERR_MODULE_NOT_FOUND)
{
    const char* name = publicModuleName(id);
    if (*name)
        Bun__throwIfModuleIsRemoved(globalObject, static_cast<uint16_t>(feature), name, strlen(name), code);
    else
        Bun__throwForRemovedFeature(globalObject, static_cast<uint16_t>(feature));
}

static void throwModuleNotCompiledError(JSC::JSGlobalObject* globalObject, uint32_t id, Bun::ErrorCode code)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    const char* name = publicModuleName(id);
    auto message = WTF::makeString("Cannot load '"_s, WTF::String::fromUTF8(*name ? name : "(internal)"), "': it isn't in this executable. Import it by name somewhere in your program to keep it."_s);
    JSC::throwException(globalObject, scope, Bun::createError(globalObject, code, JSC::withAOTErrorNote(message)));
}

// `--trim` leaves the record of a module whose text it removed without text (src/trim/apply.rs).
static void throwModuleTextRemovedError(JSC::JSGlobalObject* globalObject, uint32_t id)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    const char* name = publicModuleName(id);
    WTF::String specifier = WTF::String::fromUTF8(*name ? name : "(internal)");
    BunString specifierString = Bun::toString(specifier);
    JSC::throwException(globalObject, scope, JSC::JSValue::decode(Bun__createModuleNotCompiledInError(globalObject, Bun::ErrorCode::ERR_MODULE_NOT_FOUND, &specifierString)));
}

JSC::JSValue generateInternalModule(JSC::JSGlobalObject* globalObject, JSC::VM& vm, uint32_t id)
{
#if ENABLE(AOT)
    // The JavaScript of a module stays when its feature is removed. Its native functions throw.
    if (JSC::AOT::hasBuiltinModule(globalObject, id)) {
        Bun::ModuleGraphContextScope realmContext(*defaultGlobalObject(globalObject)->scriptExecutionContext());
        return JSC::AOT::evaluateBuiltinModule(globalObject, id);
    }
#endif
    if (auto feature = InternalModuleRegistryConstants::moduleFeatures[id]; feature && JSC::isFeatureRemoved(*feature)) [[unlikely]] {
        throwRemovedModuleError(globalObject, *feature, id);
        return {};
    }
#if ENABLE(AOT)
    if (JSC::AOT::refusesLibraryText(globalObject)) [[unlikely]] {
        throwModuleNotCompiledError(globalObject, id, Bun::ErrorCode::ERR_MODULE_NOT_FOUND);
        return {};
    }
#endif
    if (JSC::isFeatureRemoved(Bun::Feature::RuntimeTranspiler)) [[unlikely]] {
        throwRemovedModuleError(globalObject, Bun::Feature::RuntimeTranspiler, id);
        return {};
    }
    return JSC::callRemovable<Bun::Feature::RuntimeTranspiler, JSC::RemovedFeatureStub::Abort, generateInternalModuleFromText>(globalObject, vm, id);
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
        JSC::AOT::hostDidLoadBuiltinModule(globalObject, id, value);
    }
    return value;
}

JSValue DeclaredModuleLoad::requireField(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field field)
{
    return globalObject->internalModuleRegistry()->requireId(globalObject, globalObject->vm(), field);
}

// The build compiles the module for a program that uses the built-in, whether or not the program can import the module by name.
JSValue DeclaredModuleLoad::requireOnBehalfOf(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field field, ASCIILiteral builtin)
{
    uint32_t id = field;
    if (id < InternalModuleRegistryConstants::moduleCount && JSC::AOT::refusesLibraryText(globalObject) && !JSC::AOT::hasBuiltinModule(globalObject, id)) [[unlikely]] {
        JSC::AOT::throwBuiltinNotCompiled(globalObject, builtin);
        return {};
    }
    return requireField(globalObject, field);
}

JSValue DeclaredModuleLoad::requireNamedAtRunTime(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field field, ErrorCode ifNotInExecutable)
{
    uint32_t id = field;
    if (id < InternalModuleRegistryConstants::moduleCount && !JSC::AOT::hasBuiltinModule(globalObject, id)) {
        if (auto feature = InternalModuleRegistryConstants::moduleFeatures[id]; feature && JSC::isFeatureRemoved(*feature)) [[unlikely]] {
            throwRemovedModuleError(globalObject, *feature, id, ifNotInExecutable);
            return {};
        }
        if (JSC::AOT::refusesLibraryText(globalObject)) [[unlikely]] {
            throwModuleNotCompiledError(globalObject, id, ifNotInExecutable);
            return {};
        }
    }
    return requireField(globalObject, field);
}

JSValue DeclaredModuleLoad::requireForCommandLine(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field field)
{
    return requireField(globalObject, field);
}

#include "InternalModuleRegistry+createInternalModuleById.h"

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
    return JSValue::encode(mod);
}

} // namespace Bun

namespace Zig {
JSC::VM& vmForBytecodeCache();
JSC::VM& vmOfBytecodeLinkEncoder(JSC::BytecodeLinkEncoder&);
void ensureBuiltinNamesForBytecodeCache(JSC::VM&);
}
extern "C" void Bun__destroyBytecodeCacheVM();

// The internal module's function with the code of everything nested in it down to `depth` generated, in the bytecode
// VM (whose lock the caller holds); null on a parse error.
static UnlinkedFunctionExecutable* generateInternalModuleCode(JSC::VM& vm, const SourceCode& source, const String& moduleName, uint32_t depth)
{
    using namespace Bun;
    Zig::ensureBuiltinNamesForBytecodeCache(vm);
    UnlinkedFunctionExecutable* executable = createInternalModuleExecutable(vm, source, moduleName);
    ParserError error;
    JSC::recursivelyGenerateUnlinkedCodeBlocksForFunction(vm, executable, source, error, depth);
    return error.isValid() ? nullptr : executable;
}

static bool encodeInternalModule(const String& text, const String& moduleName, const String& url, uint32_t sourceStamp, uint32_t depth, const uint8_t** bytes, size_t* size, JSC::CachedBytecode** handle, JSC::EncoderStringTable* externalStrings)
{
    using namespace Bun;
    if (text.isEmpty())
        return false;
    JSC::VM& vm = Zig::vmForBytecodeCache();
    JSC::JSLockHolder locker(vm);
    SourceCode source = makeInternalModuleSource(text, moduleName, url, JSC::SourceProvenance::Static);
    UnlinkedFunctionExecutable* executable = generateInternalModuleCode(vm, source, moduleName, depth);
    if (!executable)
        return false;
    RefPtr<JSC::CachedBytecode> result = JSC::encodeBuiltinFunction(vm, executable, source, sourceStamp, externalStrings, JSC::BytecodeCacheUpdatable::No);
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

// With an order file the internal modules are modules of the link's one payload like the chunks (see ZigSourceProvider.cpp).
static bool addInternalModuleToLink(JSC::BytecodeLinkEncoder* encoder, const String& text, const String& moduleName, const String& url, uint32_t sourceStamp, uint32_t depth, const JSC::BytecodeOrderNames& names)
{
    using namespace Bun;
    if (text.isEmpty())
        return false;
    JSC::VM& vm = Zig::vmOfBytecodeLinkEncoder(*encoder);
    JSC::JSLockHolder locker(vm);
    SourceCode source = makeInternalModuleSource(text, moduleName, url, JSC::SourceProvenance::Static);
    UnlinkedFunctionExecutable* executable = generateInternalModuleCode(vm, source, moduleName, depth);
    if (!executable)
        return false;
    encoder->addBuiltinFunction(executable, source, sourceStamp, names);
    return true;
}

// The names are of the module's source as the builtins section has it (bun_bundler::bytecode_order::Named::InternalModule).
extern "C" bool Bun__BytecodeLinkEncoder__addInternalModule(JSC::BytecodeLinkEncoder* encoder, uint32_t id, uint32_t depth, const Bun::BytecodeOrderNamesRef& names)
{
    using namespace Bun;
    if (id >= bun_internal_modules_header.moduleCount)
        return false;
    const auto& m = internalModuleRecord(id);
    return addInternalModuleToLink(encoder, internalModuleSource(id), internalModuleString(m.nameOffset, m.nameLength), internalModuleString(m.urlOffset, m.urlLength), bun_internal_modules_header.sourceStamp, depth, names.view());
}

extern "C" bool Bun__BytecodeLinkEncoder__addInternalModuleFromSource(JSC::BytecodeLinkEncoder* encoder, const Latin1Character* text, size_t textLength, const Latin1Character* name, size_t nameLength, const Latin1Character* url, size_t urlLength, uint32_t sourceStamp, uint32_t depth, const Bun::BytecodeOrderNamesRef& names)
{
    return addInternalModuleToLink(encoder, String({ text, textLength }), String({ name, nameLength }), String({ url, urlLength }), sourceStamp, depth, names.view());
}

// BUN_BYTECODE_DIGEST_OUT (see ZigSourceProvider.cpp), for the embedded bytecode of internal module `id`: the digest of
// all its code.
static std::optional<JSC::SourceCode> internalModuleSourceCode(uint32_t id)
{
    using namespace Bun;
    if (id >= bun_internal_modules_header.moduleCount)
        return std::nullopt;
    const auto& m = internalModuleRecord(id);
    if (!m.codeLength)
        return std::nullopt;
    return makeInternalModuleSource(internalModuleSource(id), internalModuleString(m.nameOffset, m.nameLength), internalModuleString(m.urlOffset, m.urlLength), internalModuleProvenance(id));
}

extern "C" bool Bun__BytecodeOrder__digestInternalModule(JSC::VM* vm, uint32_t id, uint8_t* bytecode, size_t bytecodeSize, uint32_t entryOffset, uint64_t* digest, uint32_t* codeBlocks)
{
    using namespace Bun;
    JSC::JSLockHolder locker(*vm);
    auto source = internalModuleSourceCode(id);
    auto result = source ? JSC::digestOfAllCachedBuiltinCode(*vm, *source, bun_internal_modules_header.sourceStamp, embeddedBytecode({ bytecode, bytecodeSize }, entryOffset)) : std::nullopt;
    if (!result)
        return false;
    *digest = result->digest;
    *codeBlocks = result->codeBlocks;
    return true;
}

namespace Bun {

// bun:internal-for-testing: the bytecode `bun build --compile --bytecode` would embed for a builtin module, and the
// external string table it would embed beside it -- either for internal module number `index` (null past the last
// one), or for `source` written in builtin syntax under `name`.
static bool collectCapturedVariables(JSC::VM& vm, const SourceCode& source, const String& moduleName, UncheckedKeyHashSet<RefPtr<UniquedStringImpl>>& captured)
{
    UnlinkedFunctionExecutable* executable = createInternalModuleExecutable(vm, source, moduleName);
    ParserError error;
    UnlinkedFunctionCodeBlock* codeBlock = executable->unlinkedCodeBlockFor(vm, executable->linkedSourceCode(source), CodeSpecializationKind::CodeForCall, {}, error, executable->parseMode());
    if (!codeBlock)
        return false;
    for (auto& constant : codeBlock->constantRegisters()) {
        auto* table = constant.get().isCell() ? dynamicDowncast<SymbolTable>(constant.get().asCell()) : nullptr;
        if (!table)
            continue;
        ConcurrentJSLocker locker(table->m_lock);
        for (auto it = table->begin(locker), end = table->end(locker); it != end; ++it) {
            if (it->value.varOffset().isScope())
                captured.add(it->key);
        }
    }
    return true;
}

static String checkLazyFunctionTable(JSC::VM& vm, uint32_t id, unsigned& lazyFunctionCount)
{
    const auto& m = internalModuleRecord(id);
    String moduleName = internalModuleString(m.nameOffset, m.nameLength);
    String url = internalModuleString(m.urlOffset, m.urlLength);
    SourceCode parsed = makeInternalModuleSource(internalModuleSource(id), moduleName, url, JSC::SourceProvenance::Static);
    SourceCode prefilled = makeInternalModuleSource(internalModuleSource(id), moduleName, url, JSC::SourceProvenance::Static);
    lazyFunctionCount = prefillSourceProviderCache(vm, prefilled, id);
    if (!lazyFunctionCount)
        return {};

    UncheckedKeyHashSet<RefPtr<UniquedStringImpl>> capturedWhenParsed;
    UncheckedKeyHashSet<RefPtr<UniquedStringImpl>> capturedWhenPrefilled;
    if (!collectCapturedVariables(vm, parsed, moduleName, capturedWhenParsed) || !collectCapturedVariables(vm, prefilled, moduleName, capturedWhenPrefilled))
        return makeString(moduleName, ": does not parse"_s);
    for (auto& name : capturedWhenParsed) {
        if (!capturedWhenPrefilled.contains(name))
            return makeString(moduleName, ": "_s, StringView(name.get()), " is captured, and the lazy function table does not say so"_s);
    }

    JSC::SourceProviderCache* parsedCache = vm.addSourceProviderCache(parsed.provider());
    JSC::SourceProviderCache* prefilledCache = vm.addSourceProviderCache(prefilled.provider());
    unsigned found = 0;
    for (unsigned offset = 0; offset < m.codeLength; ++offset) {
        const JSC::SourceProviderCacheItem* expected = parsedCache->get(offset);
        const JSC::SourceProviderCacheItem* actual = prefilledCache->get(offset);
        if (!actual)
            continue;
        ++found;
        if (!expected)
            return makeString(moduleName, ": no function has its parameters at "_s, offset);
        if (expected->endFunctionOffset != actual->endFunctionOffset
            || expected->lastTokenStartOffset != actual->lastTokenStartOffset
            || expected->lastTokenEndOffset != actual->lastTokenEndOffset
            || expected->parameterCount != actual->parameterCount
            || expected->strictMode != actual->strictMode
            || expected->taintedByWithScope != actual->taintedByWithScope
            || expected->usesEval != actual->usesEval
            || expected->usesImportMeta != actual->usesImportMeta
            || expected->needsSuperBinding != actual->needsSuperBinding
            || expected->expectedSuperBinding != actual->expectedSuperBinding
            || expected->constructorKind != actual->constructorKind
            || expected->implementationVisibility != actual->implementationVisibility
            || expected->isBodyArrowExpression != actual->isBodyArrowExpression
            || expected->containsTaggedTemplate != actual->containsTaggedTemplate)
            return makeString(moduleName, ": the lazy function table describes the function at "_s, offset, " differently from the parser"_s);
    }
    if (found < lazyFunctionCount)
        return makeString(moduleName, ": the lazy function table names a function twice"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsInternalModuleBytecode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    String text, name, url;
    uint32_t stamp = 0;
    unsigned lazyFunctionCount = 0;
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
        if (String mismatch = checkLazyFunctionTable(vm, index, lazyFunctionCount); !mismatch.isNull())
            return throwVMError(globalObject, scope, mismatch);
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
    Bun::putDirectNamed(vm, result, "bytecode"_s, buffer);
    Bun::putDirectNamed(vm, result, "strings"_s, strings);
    Bun::putDirectNamed(vm, result, "lazyFunctionCount"_s, jsNumber(lazyFunctionCount));
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
