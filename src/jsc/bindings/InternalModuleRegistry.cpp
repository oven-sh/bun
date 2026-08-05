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

#if OS(WINDOWS)
#include <stdlib.h> // _exit
#else
#include <unistd.h> // _exit
#endif

#include "InternalModuleRegistryConstants.h"
#include "wtf/Forward.h"

#include "NativeModuleImpl.h"
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

JSC::JSValue generateModule(JSC::JSGlobalObject* globalObject, JSC::VM& vm, const String& SOURCE, const String& moduleName, const String& urlString)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto&& origin = SourceOrigin(WTF::URL(urlString));
    SourceCode source = JSC::makeSource(SOURCE, origin, JSC::SourceTaintedOrigin::Untainted, moduleName);
    maybeAddCodeCoverage(vm, source);
    JSFunction* func
        = JSFunction::create(
            vm, globalObject,
            createBuiltinExecutable(
                vm, source,
                Identifier::fromString(vm, moduleName),
                ImplementationVisibility::Public,
                ConstructorKind::None,
                ConstructAbility::CannotConstruct,
                InlineAttribute::None)
                ->link(vm, nullptr, source),
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

ALWAYS_INLINE JSC::JSValue generateNativeModule(
    JSC::JSGlobalObject* globalObject,
    JSC::VM& vm,
    const SyntheticSourceProvider::SyntheticSourceGenerator& generator)
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
// bundle-modules.ts ends every file in BUN_DYNAMIC_JS_LOAD_PATH with
// `// @bun-internal-module-generation=<hash>`. The hash covers every
// codegen-assigned numeric ID space those files bake in ($lazy native-call
// IDs, internal module registry indices, error-code and js_classes IDs), and
// BUN_INTERNAL_MODULE_GENERATION is the hash this binary's dispatch tables
// were generated with. A file with a different stamp came from a different
// codegen run (rebuild in flight, or an aborted one) and its IDs may dispatch
// to the wrong native code; a file with no stamp is mid-write. Editing JS
// doesn't change the stamp, so hot-reload keeps working.
static bool hasMatchingGenerationStamp(const Vector<uint8_t>& contents)
{
    static constexpr char needle[] = "// @bun-internal-module-generation=";
    static constexpr size_t needleLength = sizeof(needle) - 1;
    static constexpr char expected[] = BUN_INTERNAL_MODULE_GENERATION;
    static constexpr size_t expectedLength = sizeof(expected) - 1;

    // The stamp is the last line; scan only the tail (slack for the trailing
    // newline, or \r\n if the checkout rewrote it).
    static constexpr size_t tailLength = needleLength + expectedLength + 8;
    size_t begin = contents.size() > tailLength ? contents.size() - tailLength : 0;
    for (size_t i = begin; i + needleLength + expectedLength <= contents.size(); i++) {
        if (memcmp(contents.span().data() + i, needle, needleLength) == 0)
            return memcmp(contents.span().data() + i + needleLength, expected, expectedLength) == 0;
    }
    return false;
}

JSValue initializeInternalModuleFromDisk(JSGlobalObject* globalObject, VM& vm, const WTF::String& moduleName, WTF::String fileBase, const WTF::String& urlString)
{
    WTF::String file = makeString(ASCIILiteral::fromLiteralUnsafe(BUN_DYNAMIC_JS_LOAD_PATH), "/"_s, WTF::move(fileBase));
    if (auto contents = WTF::FileSystemImpl::readEntireFile(file)) {
        if (!hasMatchingGenerationStamp(contents.value())) [[unlikely]] {
            fprintf(stderr,
                "\nFATAL: bun-debug hot-reloads builtin JS from disk, but \"%s\" was written by a different codegen generation than this binary (expected %s).\n"
                "Codegen-assigned numeric IDs may have shifted, so loading it could dispatch to the wrong native bindings.\n"
                "This usually means a build is in progress, a previous build stopped after codegen, or the file is mid-write.\n"
                "Re-run `bun bd` (or let the in-flight build finish) and try again.\n\n",
                file.utf8().span().data(), BUN_INTERNAL_MODULE_GENERATION);
            fflush(nullptr);
            // Deliberate clean exit instead of CRASH(): this is a build-state
            // error, not a bug worth a panic report.
            _exit(1);
        }
        auto string = WTF::String::fromUTF8(contents.value());
        return generateModule(globalObject, vm, string, moduleName, urlString);
    } else {
        printf("\nFATAL: bun-debug failed to load bundled version of \"%s\" at \"%s\" (was it deleted?)\n"
               "Please re-compile Bun to continue.\n\n",
            moduleName.utf8().span().data(), file.utf8().span().data());
        CRASH();
    }
}
#define INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, moduleId, filename, OFFSET, LENGTH, urlString) \
    return initializeInternalModuleFromDisk(globalObject, vm, moduleId, filename, urlString)
#else

// The module sources are linked as one read-only blob (bun_internal_modules_data,
// see the generated InternalModuleRegistryConstants.S); each module is a span at
// a known offset/length. createWithoutCopying is the same path the old
// ASCIILiteral → String conversion took.
#define INTERNAL_MODULE_REGISTRY_GENERATE(globalObject, vm, moduleId, filename, OFFSET, LENGTH, urlString)                         \
    return generateModule(globalObject, vm,                                                                                        \
        WTF::String(WTF::StringImpl::createWithoutCopying(std::span<const char>(bun_internal_modules_data + (OFFSET), (LENGTH)))), \
        moduleId, urlString)
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

#undef INTERNAL_MODULE_REGISTRY_GENERATE
