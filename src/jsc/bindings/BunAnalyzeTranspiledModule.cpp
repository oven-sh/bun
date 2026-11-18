#include "root.h"

#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/GlobalObjectMethodTable.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/SyntheticModuleRecord.h"
#include <wtf/text/MakeString.h>
#include "BunClientData.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "ZigSourceProvider.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include "IsolatedModuleCache.h"

#include "JavaScriptCore/ErrorType.h"

namespace JSC {

static const Identifier& getFromIdentifierArray(VM& vm, Identifier* identifierArray, uint32_t n)
{
    if (n == std::numeric_limits<uint32_t>::max()) {
        return vm.propertyNames->starDefaultPrivateName;
    }
    if (n == std::numeric_limits<uint32_t>::max() - 1) {
        return vm.propertyNames->starNamespacePrivateName;
    }
    return identifierArray[n];
}

static ModuleMapKey requestFromIdentifierArray(VM& vm, Identifier* identifierArray, uint32_t moduleName, uint8_t moduleRequestType)
{
    return { getFromIdentifierArray(vm, identifierArray, moduleName).impl(), static_cast<ScriptFetchParameters::Type>(moduleRequestType) };
}

extern "C" JSModuleRecord* zig__ModuleInfoDeserialized__toJSModuleRecord(JSGlobalObject* globalObject, VM& vm, JSModuleLoader*, const Identifier& module_key, const SourceCode& source_code, bun_ModuleInfoDeserialized* module_info);
extern "C" void zig__renderDiff(const char* expected_ptr, size_t expected_len, const char* received_ptr, size_t received_len);

// AtomStringImpl::add copies the characters; the record they came from is freed once the JSModuleRecord is built.
extern "C" void JSC__IdentifierArray__setFromChars(Identifier* identifierArray, size_t n, VM& vm, const uint8_t* chars, size_t len, bool is8Bit)
{
    ASSERT(is8Bit || !(reinterpret_cast<uintptr_t>(chars) % alignof(char16_t)));
    RefPtr<AtomStringImpl> atom = is8Bit
        ? AtomStringImpl::add(std::span { reinterpret_cast<const Latin1Character*>(chars), len })
        : AtomStringImpl::add(std::span { reinterpret_cast<const char16_t*>(chars), len / sizeof(char16_t) });
    identifierArray[n] = Identifier::fromUid(vm, atom.get());
}
extern "C" bool JSC__IdentifierArray__isNull(Identifier* identifierArray, size_t n)
{
    return identifierArray[n].isNull();
}
// `count` null slots for a record that carries its own strings, freed by
// JSC__IdentifierArray__destroy once the JSModuleRecord is built.
extern "C" Identifier* JSC__IdentifierArray__create(size_t count)
{
    static_assert(VectorTraits<Identifier>::canInitializeWithMemset);
    return static_cast<Identifier*>(WTF::fastZeroedMalloc(count * sizeof(Identifier)));
}
extern "C" void JSC__IdentifierArray__destroy(Identifier* identifiers, size_t count)
{
    for (size_t i = 0; i < count; ++i)
        identifiers[i].~Identifier();
    WTF::fastFree(identifiers);
}

extern "C" JSModuleRecord* JSC_JSModuleRecord__create(JSGlobalObject* globalObject, JSModuleLoader* moduleLoader, const Identifier* moduleKey, const SourceCode& sourceCode, bool isTypescript, bool hasTLA, uint32_t requestedModuleCount, uint32_t importCount, uint32_t exportCount)
{
    JSModuleRecord* result = JSModuleRecord::create(globalObject, moduleLoader, *moduleKey, sourceCode);
    result->reserveCapacity(requestedModuleCount, importCount, exportCount);
    result->setIsTypeScript(isTypescript);
    result->setHasTLA(hasTLA);
    return result;
}

extern "C" void JSC_JSModuleRecord__addIndirectExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t exportName, uint32_t importName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addIndirectExport(getFromIdentifierArray(moduleRecord->vm(), identifierArray, exportName), getFromIdentifierArray(moduleRecord->vm(), identifierArray, importName), requestFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName, moduleRequestType));
}
extern "C" void JSC_JSModuleRecord__addLocalExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t exportName, uint32_t localName)
{
    moduleRecord->addLocalExport(getFromIdentifierArray(moduleRecord->vm(), identifierArray, exportName), getFromIdentifierArray(moduleRecord->vm(), identifierArray, localName));
}
extern "C" void JSC_JSModuleRecord__addNamespaceExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t exportName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addNamespaceExport(getFromIdentifierArray(moduleRecord->vm(), identifierArray, exportName), requestFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName, moduleRequestType));
}
extern "C" void JSC_JSModuleRecord__addStarExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addStarExport(requestFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName, moduleRequestType));
}
static inline AbstractModuleRecord::ModulePhase toModulePhase(bool phaseDefer)
{
    return phaseDefer ? AbstractModuleRecord::ModulePhase::Defer : AbstractModuleRecord::ModulePhase::Evaluation;
}

extern "C" void JSC_JSModuleRecord__addRequestedModuleNullAttributesPtr(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName, bool phaseDefer)
{
    RefPtr<ScriptFetchParameters> attributes = RefPtr<ScriptFetchParameters> {};
    moduleRecord->appendRequestedModule(getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName), std::move(attributes), toModulePhase(phaseDefer));
}
extern "C" void JSC_JSModuleRecord__addRequestedModuleJavaScript(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName, bool phaseDefer)
{
    Ref<ScriptFetchParameters> attributes = ScriptFetchParameters::create(ScriptFetchParameters::Type::JavaScript);
    moduleRecord->appendRequestedModule(getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName), std::move(attributes), toModulePhase(phaseDefer));
}
extern "C" void JSC_JSModuleRecord__addRequestedModuleWebAssembly(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName, bool phaseDefer)
{
    Ref<ScriptFetchParameters> attributes = ScriptFetchParameters::create(ScriptFetchParameters::Type::WebAssembly);
    moduleRecord->appendRequestedModule(getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName), std::move(attributes), toModulePhase(phaseDefer));
}
extern "C" void JSC_JSModuleRecord__addRequestedModuleJSON(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName, bool phaseDefer)
{
    Ref<ScriptFetchParameters> attributes = ScriptFetchParameters::create(ScriptFetchParameters::Type::JSON);
    moduleRecord->appendRequestedModule(getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName), std::move(attributes), toModulePhase(phaseDefer));
}
extern "C" void JSC_JSModuleRecord__addRequestedModuleHostDefined(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName, uint32_t hostDefinedImportType, bool phaseDefer)
{
    Ref<ScriptFetchParameters> attributes = ScriptFetchParameters::create(getFromIdentifierArray(moduleRecord->vm(), identifierArray, hostDefinedImportType).string());
    moduleRecord->appendRequestedModule(getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName), std::move(attributes), toModulePhase(phaseDefer));
}

static_assert(static_cast<uint8_t>(JSC::ScriptFetchParameters::Type::JavaScript) == 1, "ScriptFetchParameters::Type tag drift vs to_script_fetch_parameters_type()");
static_assert(static_cast<uint8_t>(JSC::ScriptFetchParameters::Type::WebAssembly) == 2, "ScriptFetchParameters::Type tag drift vs to_script_fetch_parameters_type()");
static_assert(static_cast<uint8_t>(JSC::ScriptFetchParameters::Type::JSON) == 3, "ScriptFetchParameters::Type tag drift vs to_script_fetch_parameters_type()");
static_assert(static_cast<uint8_t>(JSC::ScriptFetchParameters::Type::Text) == 4, "ScriptFetchParameters::Type tag drift vs to_script_fetch_parameters_type()");
static_assert(static_cast<uint8_t>(JSC::ScriptFetchParameters::Type::HostDefined) == 5, "ScriptFetchParameters::Type tag drift vs to_script_fetch_parameters_type()");

extern "C" void JSC_JSModuleRecord__addImportEntrySingle(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t importName, uint32_t localName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntryType::Single, AbstractModuleRecord::ModulePhase::Evaluation, requestFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName, moduleRequestType), getFromIdentifierArray(moduleRecord->vm(), identifierArray, importName), getFromIdentifierArray(moduleRecord->vm(), identifierArray, localName));
}
extern "C" void JSC_JSModuleRecord__addImportEntrySingleTypeScript(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t importName, uint32_t localName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntryType::SingleTypeScript, AbstractModuleRecord::ModulePhase::Evaluation, requestFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName, moduleRequestType), getFromIdentifierArray(moduleRecord->vm(), identifierArray, importName), getFromIdentifierArray(moduleRecord->vm(), identifierArray, localName));
}
extern "C" void JSC_JSModuleRecord__addImportEntryNamespace(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t importName, uint32_t localName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntryType::Namespace, AbstractModuleRecord::ModulePhase::Evaluation, requestFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName, moduleRequestType), getFromIdentifierArray(moduleRecord->vm(), identifierArray, importName), getFromIdentifierArray(moduleRecord->vm(), identifierArray, localName));
}
extern "C" void JSC_JSModuleRecord__addImportEntryNamespaceDefer(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t importName, uint32_t localName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntryType::Namespace, AbstractModuleRecord::ModulePhase::Defer, requestFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName, moduleRequestType), getFromIdentifierArray(moduleRecord->vm(), identifierArray, importName), getFromIdentifierArray(moduleRecord->vm(), identifierArray, localName));
}

static EncodedJSValue fallbackParse(JSGlobalObject* globalObject, JSModuleLoader*, const Identifier& moduleKey, const SourceCode& sourceCode, JSPromise* promise, JSModuleRecord* resultValue = nullptr);
extern "C" EncodedJSValue Bun__analyzeTranspiledModule(JSGlobalObject* globalObject, JSModuleLoader* moduleLoader, const Identifier& moduleKey, const SourceCode& sourceCode, JSPromise* promise)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto rejectWithError = [&](JSValue error) {
        promise->reject(vm, error);
        return promise;
    };

    auto provider = static_cast<Zig::SourceProvider*>(sourceCode.provider());

    if (provider->m_moduleInfo == nullptr)
        RELEASE_AND_RETURN(scope, fallbackParse(globalObject, moduleLoader, moduleKey, sourceCode, promise));

    auto moduleRecord = zig__ModuleInfoDeserialized__toJSModuleRecord(globalObject, vm, moduleLoader, moduleKey, sourceCode, provider->m_moduleInfo.get());
    // Under --isolate the same SourceProvider is reused across globals via the
    // IsolatedModuleCache, so module_info must remain alive on the provider;
    // ~SourceProvider frees it. Otherwise, free now.
    if (!Bun::IsolatedModuleCache::canUse(vm, uncheckedDowncast<Zig::GlobalObject>(globalObject)->bunVM())) {
        provider->m_moduleInfo = nullptr;
    }
    if (moduleRecord == nullptr) {
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, WTF::String::fromLatin1("parseFromSourceCode failed")))));
    }

#if BUN_DEBUG
    RELEASE_AND_RETURN(scope, fallbackParse(globalObject, moduleLoader, moduleKey, sourceCode, promise, moduleRecord));
#else
    promise->resolve(globalObject, vm, moduleRecord);
    RELEASE_AND_RETURN(scope, JSValue::encode(promise));
#endif
}
static EncodedJSValue fallbackParse(JSGlobalObject* globalObject, JSModuleLoader* moduleLoader, const Identifier& moduleKey, const SourceCode& sourceCode, JSPromise* promise, JSModuleRecord* resultValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto rejectWithError = [&](JSValue error) {
        promise->reject(vm, error);
        return promise;
    };

    ParserError error;
    String attributeError;
    JSModuleRecord* moduleRecord = JSModuleRecord::analyze(moduleLoader, moduleKey, sourceCode, error, attributeError);
    if (error.isValid())
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(error.toErrorObject(globalObject, sourceCode))));
    if (!moduleRecord)
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createTypeError(globalObject, attributeError))));

    if (resultValue != nullptr) {
        auto actual = resultValue->describeEntries();
        auto expected = moduleRecord->describeEntries();
        if (actual != expected) {
            dataLog("\n\n\n\n\n\n\x1b[95mBEGIN analyzeTranspiledModule\x1b(B\x1b[m\n  --- module key ---\n", moduleKey.utf8(), "\n  --- code ---\n\n", sourceCode.toUTF8(), "\n");
            dataLog("  ------", "\n");
            dataLog("  BunAnalyzeTranspiledModule:", "\n");

            auto expectedUTF8 = expected.utf8();
            auto actualUTF8 = actual.utf8();
            auto expectedBytes = byteCast<char>(expectedUTF8.span());
            auto actualBytes = byteCast<char>(actualUTF8.span());
            zig__renderDiff(expectedBytes.data(), expectedBytes.size(), actualBytes.data(), actualBytes.size());

            RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, WTF::String::fromLatin1("Imports different between parseFromSourceCode and fallbackParse")))));
        }
    }

    scope.release();
    promise->resolve(globalObject, vm, resultValue == nullptr ? moduleRecord : resultValue);
    return JSValue::encode(promise);
}

}
