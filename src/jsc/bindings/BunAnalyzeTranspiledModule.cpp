#include "root.h"

#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/GlobalObjectMethodTable.h"
#include "JavaScriptCore/Nodes.h"
#include "JavaScriptCore/Parser.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/SyntheticModuleRecord.h"
#include <wtf/text/MakeString.h>
#include "BunClientData.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/CachedTypes.h"
#include "ZigSourceProvider.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include "IsolatedModuleCache.h"
#include "BunAnalyzeTranspiledModule.h"

// ref: JSModuleLoader.cpp
// ref: ModuleAnalyzer.cpp
// ref: JSModuleRecord.cpp
// ref: NodesAnalyzeModule.cpp, search ::analyzeModule

#include "JavaScriptCore/ModuleAnalyzer.h"
#include "JavaScriptCore/ErrorType.h"

namespace JSC {

String dumpRecordInfo(JSModuleRecord* moduleRecord);

Identifier getFromIdentifierArray(VM& vm, Identifier* identifierArray, uint32_t n)
{
    if (n == std::numeric_limits<uint32_t>::max()) {
        return vm.propertyNames->starDefaultPrivateName;
    }
    if (n == std::numeric_limits<uint32_t>::max() - 1) {
        return vm.propertyNames->starNamespacePrivateName;
    }
    return identifierArray[n];
}

extern "C" JSModuleRecord* zig__ModuleInfoDeserialized__toJSModuleRecord(JSGlobalObject* globalObject, VM& vm, const Identifier& module_key, const SourceCode& source_code, bun_ModuleInfoDeserialized* module_info);
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
// A module-info slot (EncoderStringTable::slotFor) resolves like the bytecode's own string slots: one atom for both.
extern "C" bool JSC__IdentifierArray__setFromSlot(Identifier* identifierArray, size_t n, VM& vm, uint32_t slot)
{
    auto* table = WebCore::clientData(vm)->decoderStringTable();
    if (!table)
        return false;
    RefPtr<AtomStringImpl> atom = table->atomForSlot(vm, slot);
    if (!atom)
        return false;
    identifierArray[n] = Identifier::fromUid(vm, atom.get());
    return true;
}

// Slots for the executable's shared module-info string table (`count`
// strings): null until first use, then kept for every later module.
extern "C" Identifier* Bun__VM__sharedModuleInfoIdentifiers(VM& vm, size_t count)
{
    auto& identifiers = WebCore::clientData(vm)->sharedModuleInfoIdentifiers;
    if (identifiers.size() < count)
        identifiers.grow(count);
    return identifiers.mutableSpan().data();
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

extern "C" JSModuleRecord* JSC_JSModuleRecord__create(JSGlobalObject* globalObject, VM& vm, const Identifier* moduleKey, const SourceCode& sourceCode, bool hasImportMeta, bool isTypescript, bool hasTLA, uint32_t requestedModuleCount, uint32_t importCount, uint32_t exportCount)
{
    JSModuleRecord* result = JSModuleRecord::create(globalObject, vm, globalObject->moduleRecordStructure(), *moduleKey, sourceCode, hasImportMeta ? ImportMetaFeature : 0);
    result->reserveCapacity(requestedModuleCount, importCount, exportCount);
    result->m_isTypeScript = isTypescript;
    result->setHasTLA(hasTLA);
    return result;
}

extern "C" void JSC_JSModuleRecord__addIndirectExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t exportName, uint32_t importName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addExportEntry(JSModuleRecord::ExportEntry::createIndirect(getFromIdentifierArray(moduleRecord->vm(), identifierArray, exportName), getFromIdentifierArray(moduleRecord->vm(), identifierArray, importName), getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName), static_cast<JSC::ScriptFetchParameters::Type>(moduleRequestType)));
}
extern "C" void JSC_JSModuleRecord__addLocalExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t exportName, uint32_t localName)
{
    moduleRecord->addExportEntry(JSModuleRecord::ExportEntry::createLocal(getFromIdentifierArray(moduleRecord->vm(), identifierArray, exportName), getFromIdentifierArray(moduleRecord->vm(), identifierArray, localName)));
}
extern "C" void JSC_JSModuleRecord__addNamespaceExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t exportName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addExportEntry(JSModuleRecord::ExportEntry::createNamespace(getFromIdentifierArray(moduleRecord->vm(), identifierArray, exportName), getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName), static_cast<JSC::ScriptFetchParameters::Type>(moduleRequestType)));
}
extern "C" void JSC_JSModuleRecord__addStarExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addStarExportEntry(getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName), static_cast<JSC::ScriptFetchParameters::Type>(moduleRequestType));
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
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntry {
        .type = JSModuleRecord::ImportEntryType::Single,
        .moduleRequestType = static_cast<JSC::ScriptFetchParameters::Type>(moduleRequestType),
        .moduleRequest = getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName),
        .importName = getFromIdentifierArray(moduleRecord->vm(), identifierArray, importName),
        .localName = getFromIdentifierArray(moduleRecord->vm(), identifierArray, localName),
    });
}
extern "C" void JSC_JSModuleRecord__addImportEntrySingleTypeScript(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t importName, uint32_t localName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntry {
        .type = JSModuleRecord::ImportEntryType::SingleTypeScript,
        .moduleRequestType = static_cast<JSC::ScriptFetchParameters::Type>(moduleRequestType),
        .moduleRequest = getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName),
        .importName = getFromIdentifierArray(moduleRecord->vm(), identifierArray, importName),
        .localName = getFromIdentifierArray(moduleRecord->vm(), identifierArray, localName),
    });
}
extern "C" void JSC_JSModuleRecord__addImportEntryNamespace(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t importName, uint32_t localName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntry {
        .type = JSModuleRecord::ImportEntryType::Namespace,
        .moduleRequestType = static_cast<JSC::ScriptFetchParameters::Type>(moduleRequestType),
        .moduleRequest = getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName),
        .importName = getFromIdentifierArray(moduleRecord->vm(), identifierArray, importName),
        .localName = getFromIdentifierArray(moduleRecord->vm(), identifierArray, localName),
    });
}
extern "C" void JSC_JSModuleRecord__addImportEntryNamespaceDefer(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t importName, uint32_t localName, uint32_t moduleName, uint8_t moduleRequestType)
{
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntry {
        .type = JSModuleRecord::ImportEntryType::Namespace,
        .phase = AbstractModuleRecord::ModulePhase::Defer,
        .moduleRequestType = static_cast<JSC::ScriptFetchParameters::Type>(moduleRequestType),
        .moduleRequest = getFromIdentifierArray(moduleRecord->vm(), identifierArray, moduleName),
        .importName = getFromIdentifierArray(moduleRecord->vm(), identifierArray, importName),
        .localName = getFromIdentifierArray(moduleRecord->vm(), identifierArray, localName),
    });
}

static EncodedJSValue fallbackParse(JSGlobalObject* globalObject, const Identifier& moduleKey, const SourceCode& sourceCode, JSPromise* promise, JSModuleRecord* resultValue = nullptr);
extern "C" EncodedJSValue Bun__analyzeTranspiledModule(JSGlobalObject* globalObject, const Identifier& moduleKey, const SourceCode& sourceCode, JSPromise* promise)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto rejectWithError = [&](JSValue error) {
        promise->reject(vm, error);
        return promise;
    };

    auto provider = static_cast<Zig::SourceProvider*>(sourceCode.provider());

    if (provider->m_moduleInfo == nullptr) {
        dataLog("[note] module_info is null for module: ", moduleKey.utf8(), "\n");
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, WTF::String::fromLatin1("module_info is null")))));
    }

    auto* moduleInfo = provider->m_moduleInfo;
    auto moduleRecord = zig__ModuleInfoDeserialized__toJSModuleRecord(globalObject, vm, moduleKey, sourceCode, moduleInfo);
    // Under --isolate the same SourceProvider is reused across globals via the
    // IsolatedModuleCache, so module_info must remain alive on the provider;
    // ~SourceProvider frees it. Otherwise, free now.
    if (!Bun::IsolatedModuleCache::canUse(vm, uncheckedDowncast<Zig::GlobalObject>(globalObject)->bunVM())) {
        zig__ModuleInfoDeserialized__deinit(moduleInfo);
        provider->m_moduleInfo = nullptr;
    }
    if (moduleRecord == nullptr) {
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, WTF::String::fromLatin1("parseFromSourceCode failed")))));
    }

#if BUN_DEBUG
    RELEASE_AND_RETURN(scope, fallbackParse(globalObject, moduleKey, sourceCode, promise, moduleRecord));
#else
    promise->resolve(globalObject, vm, moduleRecord);
    RELEASE_AND_RETURN(scope, JSValue::encode(promise));
#endif
}
static EncodedJSValue fallbackParse(JSGlobalObject* globalObject, const Identifier& moduleKey, const SourceCode& sourceCode, JSPromise* promise, JSModuleRecord* resultValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto rejectWithError = [&](JSValue error) {
        promise->reject(vm, error);
        return promise;
    };

    ParserError error;
    std::unique_ptr<ModuleProgramNode> moduleProgramNode = parseRootNode<ModuleProgramNode>(
        vm, sourceCode, ImplementationVisibility::Public, JSParserBuiltinMode::NotBuiltin,
        StrictModeLexicallyScopedFeature, JSParserScriptMode::Module, SourceParseMode::ModuleAnalyzeMode, error);
    if (error.isValid())
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(error.toErrorObject(globalObject, sourceCode))));
    ASSERT(moduleProgramNode);

    ModuleAnalyzer moduleAnalyzer(globalObject, moduleKey, sourceCode, moduleProgramNode->features());
    RETURN_IF_EXCEPTION(scope, JSValue::encode(promise->rejectWithCaughtException(vm, scope)));

    auto result = moduleAnalyzer.analyze(*moduleProgramNode);
    if (!result) {
        auto [errorType, message] = std::move(result.error());
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, errorType, message))));
    }

    JSModuleRecord* moduleRecord = result.value();

    if (resultValue != nullptr) {
        auto actual = dumpRecordInfo(resultValue);
        auto expected = dumpRecordInfo(moduleRecord);
        if (actual != expected) {
            dataLog("\n\n\n\n\n\n\x1b[95mBEGIN analyzeTranspiledModule\x1b(B\x1b[m\n  --- module key ---\n", moduleKey.utf8().data(), "\n  --- code ---\n\n", sourceCode.toUTF8().data(), "\n");
            dataLog("  ------", "\n");
            dataLog("  BunAnalyzeTranspiledModule:", "\n");

            zig__renderDiff(expected.utf8().data(), expected.utf8().length(), actual.utf8().data(), actual.utf8().length());

            RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, WTF::String::fromLatin1("Imports different between parseFromSourceCode and fallbackParse")))));
        }
    }

    scope.release();
    promise->resolve(globalObject, vm, resultValue == nullptr ? moduleRecord : resultValue);
    return JSValue::encode(promise);
}

String dumpRecordInfo(JSModuleRecord* moduleRecord)
{
    WTF::StringPrintStream stream;

    stream.print("  features: (not accessible)\n");

    stream.print("\nAnalyzing ModuleRecord key(", moduleRecord->moduleKey().impl(), ")\n");

    stream.print("    Dependencies: ", moduleRecord->requestedModules().size(), " modules\n");
    {
        Vector<String> sortedDeps;
        for (const auto& request : moduleRecord->requestedModules()) {
            WTF::StringPrintStream line;
            if (request.m_attributes == nullptr)
                line.print("      module(", request.m_specifier, ")");
            else
                line.print("      module(", request.m_specifier, "),attributes(", (uint8_t)request.m_attributes->type(), ", ", request.m_attributes->hostDefinedImportType(), ")");
            if (request.m_phase == AbstractModuleRecord::ModulePhase::Defer)
                line.print(",phase(defer)");
            line.print("\n");
            sortedDeps.append(line.toString());
        }
        std::sort(sortedDeps.begin(), sortedDeps.end(), [](const String& a, const String& b) {
            return codePointCompare(a, b) < 0;
        });
        for (const auto& dep : sortedDeps)
            stream.print(dep);
    }

    stream.print("    Import: ", moduleRecord->importEntries().size(), " entries\n");
    {
        Vector<String> sortedImports;
        for (const auto& pair : moduleRecord->importEntries()) {
            WTF::StringPrintStream line;
            auto& importEntry = pair.value;
            line.print("      import(", importEntry.importName, "), local(", importEntry.localName, "), module(", importEntry.moduleRequest, "), type(", (uint8_t)importEntry.moduleRequestType, ")");
            if (importEntry.phase == AbstractModuleRecord::ModulePhase::Defer)
                line.print(", phase(defer)");
            line.print("\n");
            sortedImports.append(line.toString());
        }
        std::sort(sortedImports.begin(), sortedImports.end(), [](const String& a, const String& b) {
            return codePointCompare(a, b) < 0;
        });
        for (const auto& imp : sortedImports)
            stream.print(imp);
    }

    stream.print("    Export: ", moduleRecord->exportEntries().size(), " entries\n");
    Vector<String> sortedEntries;
    for (const auto& pair : moduleRecord->exportEntries()) {
        WTF::StringPrintStream line;
        auto& exportEntry = pair.value;
        switch (exportEntry.type) {
        case AbstractModuleRecord::ExportEntry::Type::Local:
            line.print("      [Local] ", "export(", exportEntry.exportName, "), local(", exportEntry.localName, ")\n");
            break;

        case AbstractModuleRecord::ExportEntry::Type::Indirect:
            line.print("      [Indirect] ", "export(", exportEntry.exportName, "), import(", exportEntry.importName, "), module(", exportEntry.moduleName, "), type(", (uint8_t)exportEntry.moduleRequestType, ")\n");
            break;

        case AbstractModuleRecord::ExportEntry::Type::Namespace:
            line.print("      [Namespace] ", "export(", exportEntry.exportName, "), module(", exportEntry.moduleName, "), type(", (uint8_t)exportEntry.moduleRequestType, ")\n");
            break;
        }
        sortedEntries.append(line.toString());
    }
    std::sort(sortedEntries.begin(), sortedEntries.end(), [](const String& a, const String& b) {
        return codePointCompare(a, b) < 0;
    });
    for (const auto& entry : sortedEntries)
        stream.print(entry);

    {
        Vector<String> sortedStarExports;
        for (const auto& [moduleName, moduleRequestType] : moduleRecord->starExportEntries()) {
            WTF::StringPrintStream line;
            line.print("      [Star] module(", moduleName.get(), "), type(", (uint8_t)moduleRequestType, ")\n");
            sortedStarExports.append(line.toString());
        }
        std::sort(sortedStarExports.begin(), sortedStarExports.end(), [](const String& a, const String& b) {
            return codePointCompare(a, b) < 0;
        });
        for (const auto& entry : sortedStarExports)
            stream.print(entry);
    }

    stream.print("  -> done\n");

    return stream.toString();
}

}
