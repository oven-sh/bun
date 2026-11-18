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
#include "IsolatedModuleCache.h"
#include "ModuleGraph.h"
#include "ZigSourceProvider.h"
#include "wtf/Forward.h"

#include "NativeModuleImpl.h"
#include "BunBuiltinNames.h"
#include "BunCompiledModules.h"
#include "ErrorCode.h"
#include "JSBuffer.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/CodeCache.h>
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
static std::atomic<unsigned> s_internalModulesFromSource { 0 };

// bun:internal-for-testing: how many internal modules this process created from embedded bytecode rather than source.
JSC_DEFINE_HOST_FUNCTION(jsInternalModulesLoadedFromBytecode, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    return JSValue::encode(jsNumber(s_internalModulesFromBytecode.load(std::memory_order_relaxed)));
}

// bun:internal-for-testing: how many times this process made an internal module's executable from its source.
JSC_DEFINE_HOST_FUNCTION(jsInternalModulesCompiledFromSource, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    return JSValue::encode(jsNumber(s_internalModulesFromSource.load(std::memory_order_relaxed)));
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

// src/codegen/lazy-function-table.ts. A debug build has none.
static bool readLazyFunctionTable(uint32_t id, JSC::KnownFunctions& table)
{
    if (InternalModuleRegistryConstants::lazyFunctionTableOffsets[id] == InternalModuleRegistryConstants::lazyFunctionTableOffsets[id + 1])
        return false;
    const uint8_t* cursor = InternalModuleRegistryConstants::lazyFunctionTable + InternalModuleRegistryConstants::lazyFunctionTableOffsets[id];
    for (uint32_t count = readVarint(cursor), start = 0; count--;) {
        start += readVarint(cursor);
        uint32_t bits = readVarint(cursor);
        table.captures.append({ start, bits >> 1, !!(bits & 1) });
    }
    for (uint32_t count = readVarint(cursor), closeBrace = 0; count--;) {
        uint32_t parametersStart = closeBrace + readVarint(cursor);
        closeBrace = parametersStart + readVarint(cursor);
        table.functions.append({ parametersStart, closeBrace + 1, readVarint(cursor) });
    }
    return true;
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
    SourceCode source;
    RefPtr<UnlinkedFunctionExecutable> executable;
    const bool outlivesGlobal = IsolatedModuleCache::canUse(vm, ::bunVM(globalObject));
    if (auto* cached = outlivesGlobal ? IsolatedModuleCache::lookupInternalModule(vm, id) : nullptr) {
        source = cached->source;
        executable = cached->executable;
    } else {
        source = makeInternalModuleSource(internalModuleSource(id), moduleName, internalModuleString(m.urlOffset, m.urlLength), internalModuleProvenance(id));
        maybeAddCodeCoverage(vm, source);

        executable = createBuiltinModuleExecutable(source, Identifier::fromString(vm, moduleName));

        const uint8_t* cachedBytes = nullptr;
        size_t cachedSize = 0;
        uint32_t cachedEntryOffset = 0;
        bool isFromBytecode = Bun__standaloneInternalModuleBytecode(::bunVM(globalObject), id, &cachedBytes, &cachedSize, &cachedEntryOffset)
            && JSC::loadBytecode(vm, *executable, bun_internal_modules_header.sourceStamp, { cachedBytes, cachedSize }, cachedEntryOffset);
        if (JSC::KnownFunctions table; !isFromBytecode && readLazyFunctionTable(id, table))
            table.tellParser(vm, *source.provider());
        (isFromBytecode ? s_internalModulesFromBytecode : s_internalModulesFromSource).fetch_add(1, std::memory_order_relaxed);
        if (outlivesGlobal)
            IsolatedModuleCache::insertInternalModule(vm, id, source, *executable);
    }

    JSFunction* func = JSFunction::create(vm, globalObject, executable->link(vm), static_cast<JSC::JSGlobalObject*>(globalObject));

    RETURN_IF_EXCEPTION(throwScope, {});
    if (globalObject->hasDebugger() && globalObject->inspectorController().isInteractivelyDebugging()) [[unlikely]] {
        globalObject->inspectorController().sourceParsed(*source.provider());
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
    if (vm.hasCompiledCode() && JSC::AOT::hasBuiltinModule(globalObject, id)) {
        Bun::ModuleGraphContextScope realmContext(*defaultGlobalObject(globalObject)->scriptExecutionContext());
        return JSC::AOT::evaluateBuiltinModule(globalObject, id);
    }
#endif
    if (auto feature = InternalModuleRegistryConstants::moduleFeatures[id]; feature && JSC::isFeatureRemoved(*feature)) [[unlikely]] {
        throwRemovedModuleError(globalObject, *feature, id);
        return {};
    }
#if ENABLE(AOT)
    if (vm.hasCompiledCode() && JSC::AOT::rejectsLibrarySource(globalObject)) [[unlikely]] {
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
        if (vm.hasCompiledCode()) [[unlikely]]
            JSC::AOT::hostDidLoadBuiltinModule(globalObject, id, value);
    }
    return value;
}

JSValue DeclaredModuleLoad::requireField(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field field)
{
    return globalObject->internalModuleRegistry()->requireId(globalObject, globalObject->vm(), field);
}

bool DeclaredModuleLoad::canLoad(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field field)
{
    uint32_t id = field;
    return id >= InternalModuleRegistryConstants::moduleCount || !globalObject->vm().hasCompiledCode() || !JSC::AOT::rejectsLibrarySource(globalObject) || JSC::AOT::hasBuiltinModule(globalObject, id);
}

// The build compiles the module for a program that uses the built-in, whether or not the program can import the module by name.
JSValue DeclaredModuleLoad::requireOnBehalfOf(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field field, ASCIILiteral builtin)
{
    if (!canLoad(globalObject, field)) [[unlikely]] {
        // What is loaded for a method that prints its own object is the printer of node:util.
        JSC::AOT::throwBuiltinNotCompiled(globalObject, builtin == "Startup"_s ? "util.inspect"_s : builtin);
        return {};
    }
    return requireField(globalObject, field);
}

JSValue DeclaredModuleLoad::requireModuleOnBehalfOf(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field field, ASCIILiteral builtin)
{
    JSValue module = requireOnBehalfOf(globalObject, field, builtin);
    if (module && globalObject->vm().hasCompiledCode()) [[unlikely]]
        JSC::AOT::willExposeBuiltinModuleToNativeCode(globalObject, field);
    return module;
}

JSValue DeclaredModuleLoad::requireExportOnBehalfOf(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field field, ASCIILiteral builtin, ASCIILiteral exportName)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue module = requireOnBehalfOf(globalObject, field, builtin);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_ASSERT(module.isObject());
    if (vm.hasCompiledCode()) [[unlikely]]
        JSC::AOT::willExposeBuiltinExportToNativeCode(globalObject, field, exportName);
    RELEASE_AND_RETURN(scope, asObject(module)->get(globalObject, Identifier::fromString(vm, exportName)));
}

JSValue DeclaredModuleLoad::requireNamedAtRunTime(Zig::GlobalObject* globalObject, InternalModuleRegistry::Field field, ErrorCode ifNotInExecutable)
{
    uint32_t id = field;
    if (id < InternalModuleRegistryConstants::moduleCount && !(globalObject->vm().hasCompiledCode() && JSC::AOT::hasBuiltinModule(globalObject, id))) {
        if (auto feature = InternalModuleRegistryConstants::moduleFeatures[id]; feature && JSC::isFeatureRemoved(*feature)) [[unlikely]] {
            throwRemovedModuleError(globalObject, *feature, id, ifNotInExecutable);
            return {};
        }
        if (globalObject->vm().hasCompiledCode() && JSC::AOT::rejectsLibrarySource(globalObject)) [[unlikely]] {
            throwModuleNotCompiledError(globalObject, id, ifNotInExecutable);
            return {};
        }
    }
    JSValue module = requireField(globalObject, field);
    if (module && globalObject->vm().hasCompiledCode()) [[unlikely]]
        JSC::AOT::willExposeBuiltinModuleToNativeCode(globalObject, field);
    return module;
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

extern "C" void Bun__internalModuleBytecode(const Latin1Character* text, size_t length, uint32_t stamp, void* context, void (*take)(void* context, const uint8_t* bytecode, size_t, const uint8_t* strings, size_t));

namespace Bun {

static String checkLazyFunctionTable(JSC::VM& vm, uint32_t id, unsigned& lazyFunctionCount)
{
    JSC::KnownFunctions table;
    if (!readLazyFunctionTable(id, table))
        return {};
    lazyFunctionCount = table.functions.size();
    const auto& m = internalModuleRecord(id);
    String moduleName = internalModuleString(m.nameOffset, m.nameLength);
    SourceCode source = makeInternalModuleSource(internalModuleSource(id), moduleName, internalModuleString(m.urlOffset, m.urlLength), JSC::SourceProvenance::Static);
    String mismatch = table.check(vm, createBuiltinModuleExecutable(source, Identifier::fromString(vm, moduleName)));
    return mismatch.isNull() ? mismatch : makeString("The lazy function table of "_s, moduleName, ": "_s, mismatch);
}

// bun:internal-for-testing: the bytecode `bun build --compile --bytecode` would embed for a builtin module, and the
// strings it would embed beside it -- either for internal module number `index` (null past the last one), or for `source` written in builtin syntax under `name`.
JSC_DEFINE_HOST_FUNCTION(jsInternalModuleBytecode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    String text, name;
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
    } else {
        uint32_t index = callFrame->argument(0).toUInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (index >= bun_internal_modules_header.moduleCount)
            return JSValue::encode(jsNull());
        const auto& m = internalModuleRecord(index);
        text = internalModuleSource(index);
        name = internalModuleString(m.nameOffset, m.nameLength);
        stamp = bun_internal_modules_header.sourceStamp;
        if (String mismatch = checkLazyFunctionTable(vm, index, lazyFunctionCount); !mismatch.isNull())
            return throwVMError(globalObject, scope, mismatch);
    }
    std::pair<Vector<uint8_t>, Vector<uint8_t>> generated;
    Bun__internalModuleBytecode(text.span8().data(), text.length(), stamp, &generated, [](void* context, const uint8_t* bytecode, size_t bytecodeSize, const uint8_t* strings, size_t stringsSize) {
        *static_cast<decltype(generated)*>(context) = { std::span { bytecode, bytecodeSize }, std::span { strings, stringsSize } };
    });
    if (generated.first.isEmpty())
        return throwVMError(globalObject, scope, makeString("could not generate bytecode for "_s, name));
    JSC::JSUint8Array* buffer = WebCore::createBuffer(globalObject, generated.first.span());
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSUint8Array* strings = WebCore::createBuffer(globalObject, generated.second.span());
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
