#include "root.h"

#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/GlobalObjectMethodTable.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/Nodes.h"
#include "JavaScriptCore/Parser.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/SyntheticModuleRecord.h"
#include <wtf/text/MakeString.h>
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "ZigSourceProvider.h"
#include "BunAnalyzeTranspiledModule.h"

// ref: JSModuleLoader.cpp
// ref: ModuleAnalyzer.cpp
// ref: JSModuleRecord.cpp
// ref: NodesAnalyzeModule.cpp, search ::analyzeModule

// TODO: #include "JavaScriptCore/parser/ModuleAnalyzer.h"
#include "JavaScriptCore/ErrorType.h"
#include "JavaScriptCore/Nodes.h"

namespace JSC {

class JSModuleRecord;
class SourceCode;
class ScriptFetchParameters;

class ModuleAnalyzer {
    WTF_MAKE_NONCOPYABLE(ModuleAnalyzer);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    ModuleAnalyzer(JSGlobalObject*, const Identifier& moduleKey, const SourceCode&, const VariableEnvironment& declaredVariables, const VariableEnvironment& lexicalVariables, CodeFeatures);

    Expected<JSModuleRecord*, std::tuple<ErrorType, String>> analyze(ModuleProgramNode&);

    VM& vm() { return m_vm; }

    JSModuleRecord* moduleRecord() { return m_moduleRecord; }

    void appendRequestedModule(const Identifier&, RefPtr<ScriptFetchParameters>&&);

    void fail(std::tuple<ErrorType, String>&& errorMessage) { m_errorMessage = errorMessage; }

private:
    void exportVariable(ModuleProgramNode&, const RefPtr<UniquedStringImpl>&, const VariableEnvironmentEntry&);

    VM& m_vm;
    JSModuleRecord* m_moduleRecord;
    IdentifierSet m_requestedModules;
    std::tuple<ErrorType, String> m_errorMessage;
};

}

namespace JSC {

String dumpRecordInfo(JSModuleRecord* moduleRecord);

extern "C" JSModuleRecord* zig__ModuleInfoDeserialized__toJSModuleRecord(JSGlobalObject* globalObject, VM& vm, const Identifier& module_key, const SourceCode& source_code, VariableEnvironment& declared_variables, VariableEnvironment& lexical_variables, bun_ModuleInfoDeserialized* module_info);
extern "C" void zig__renderDiff(const char* expected_ptr, size_t expected_len, const char* received_ptr, size_t received_len, JSGlobalObject* globalObject);

extern "C" Identifier* JSC__IdentifierArray__create(size_t len)
{
    return new Identifier[len];
}
extern "C" void JSC__IdentifierArray__destroy(Identifier* identifier)
{
    delete[] identifier;
}
extern "C" void JSC__IdentifierArray__setFromUtf8(Identifier* identifierArray, size_t n, VM& vm, char* str, size_t len)
{
    identifierArray[n] = Identifier::fromString(vm, AtomString::fromUTF8(std::span<const char>(str, len)));
}
extern "C" void JSC__IdentifierArray__setFromStarDefault(Identifier* identifierArray, size_t n, VM& vm)
{
    identifierArray[n] = vm.propertyNames->starDefaultPrivateName;
}

extern "C" void JSC__VariableEnvironment__add(VariableEnvironment& environment, Identifier* identifierArray, uint32_t index)
{
    environment.add(identifierArray[index]);
}

extern "C" VariableEnvironment* JSC_JSModuleRecord__declaredVariables(JSModuleRecord* moduleRecord)
{
    return &moduleRecord->m_declaredVariables;
}
extern "C" VariableEnvironment* JSC_JSModuleRecord__lexicalVariables(JSModuleRecord* moduleRecord)
{
    return &moduleRecord->m_lexicalVariables;
}

extern "C" JSModuleRecord* JSC_JSModuleRecord__create(JSGlobalObject* globalObject, VM& vm, const Identifier* moduleKey, const SourceCode& sourceCode, const VariableEnvironment& declaredVariables, const VariableEnvironment& lexicalVariables, bool hasImportMeta, bool isTypescript)
{
    JSModuleRecord* result = JSModuleRecord::create(globalObject, vm, globalObject->moduleRecordStructure(), moduleKey[0], sourceCode, declaredVariables, lexicalVariables, hasImportMeta ? ImportMetaFeature : 0);
    result->m_isTypeScript = isTypescript;
    return result;
}

extern "C" void JSC_JSModuleRecord__addIndirectExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t exportName, uint32_t importName, uint32_t moduleName)
{
    moduleRecord->addExportEntry(JSModuleRecord::ExportEntry::createIndirect(identifierArray[exportName], identifierArray[importName], identifierArray[moduleName]));
}
extern "C" void JSC_JSModuleRecord__addLocalExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t exportName, uint32_t localName)
{
    moduleRecord->addExportEntry(JSModuleRecord::ExportEntry::createLocal(identifierArray[exportName], identifierArray[localName]));
}
extern "C" void JSC_JSModuleRecord__addNamespaceExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t exportName, uint32_t moduleName)
{
    moduleRecord->addExportEntry(JSModuleRecord::ExportEntry::createNamespace(identifierArray[exportName], identifierArray[moduleName]));
}
extern "C" void JSC_JSModuleRecord__addStarExport(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName)
{
    moduleRecord->addStarExportEntry(identifierArray[moduleName]);
}
extern "C" void JSC_JSModuleRecord__addRequestedModuleNullAttributesPtr(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName)
{
    RefPtr<ScriptFetchParameters> attributes = RefPtr<ScriptFetchParameters> {};
    moduleRecord->appendRequestedModule(identifierArray[moduleName], WTFMove(attributes));
}
extern "C" void JSC_JSModuleRecord__addRequestedModuleJavaScript(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName)
{
    Ref<ScriptFetchParameters> attributes = ScriptFetchParameters::create(ScriptFetchParameters::Type::JavaScript);
    moduleRecord->appendRequestedModule(identifierArray[moduleName], WTFMove(attributes));
}
extern "C" void JSC_JSModuleRecord__addRequestedModuleWebAssembly(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName)
{
    Ref<ScriptFetchParameters> attributes = ScriptFetchParameters::create(ScriptFetchParameters::Type::WebAssembly);
    moduleRecord->appendRequestedModule(identifierArray[moduleName], WTFMove(attributes));
}
extern "C" void JSC_JSModuleRecord__addRequestedModuleJSON(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName)
{
    Ref<ScriptFetchParameters> attributes = ScriptFetchParameters::create(ScriptFetchParameters::Type::JSON);
    moduleRecord->appendRequestedModule(identifierArray[moduleName], WTFMove(attributes));
}
extern "C" void JSC_JSModuleRecord__addRequestedModuleHostDefined(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName, uint32_t hostDefinedImportType)
{
    Ref<ScriptFetchParameters> attributes = ScriptFetchParameters::create(identifierArray[hostDefinedImportType].string());
    moduleRecord->appendRequestedModule(identifierArray[moduleName], WTFMove(attributes));
}

extern "C" void JSC_JSModuleRecord__addImportEntrySingle(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t importName, uint32_t localName, uint32_t moduleName)
{
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntry {
        .type = JSModuleRecord::ImportEntryType::Single,
        .moduleRequest = identifierArray[moduleName],
        .importName = identifierArray[importName],
        .localName = identifierArray[localName],
    });
}
extern "C" void JSC_JSModuleRecord__addImportEntrySingleTypeScript(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t importName, uint32_t localName, uint32_t moduleName)
{
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntry {
        .type = JSModuleRecord::ImportEntryType::SingleTypeScript,
        .moduleRequest = identifierArray[moduleName],
        .importName = identifierArray[importName],
        .localName = identifierArray[localName],
    });
}
extern "C" void JSC_JSModuleRecord__addImportEntryNamespace(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t importName, uint32_t localName, uint32_t moduleName)
{
    moduleRecord->addImportEntry(JSModuleRecord::ImportEntry {
        .type = JSModuleRecord::ImportEntryType::Namespace,
        .moduleRequest = identifierArray[moduleName],
        .importName = identifierArray[importName],
        .localName = identifierArray[localName],
    });
}

static EncodedJSValue fallbackParse(JSGlobalObject* globalObject, const Identifier& moduleKey, const SourceCode& sourceCode, JSInternalPromise* promise, JSModuleRecord* resultValue = nullptr);
extern "C" EncodedJSValue Bun__analyzeTranspiledModule(JSGlobalObject* globalObject, const Identifier& moduleKey, const SourceCode& sourceCode, JSInternalPromise* promise)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto rejectWithError = [&](JSValue error) {
        promise->reject(globalObject, error);
        return promise;
    };

    VariableEnvironment declaredVariables = VariableEnvironment();
    VariableEnvironment lexicalVariables = VariableEnvironment();

    auto provider = static_cast<Zig::SourceProvider*>(sourceCode.provider());

    if (provider->m_resolvedSource.module_info == nullptr) {
        dataLog("[note] module_info is null for module: ", moduleKey.utf8(), "\n");
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, WTF::String::fromLatin1("module_info is null")))));
    }

    auto moduleRecord = zig__ModuleInfoDeserialized__toJSModuleRecord(globalObject, vm, moduleKey, sourceCode, declaredVariables, lexicalVariables, provider->m_resolvedSource.module_info);
    if (moduleRecord == nullptr) {
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, WTF::String::fromLatin1("parseFromSourceCode failed")))));
    }

#ifdef DEBUG
    RELEASE_AND_RETURN(scope, fallbackParse(globalObject, moduleKey, sourceCode, promise, moduleRecord));
#else
    promise->fulfillWithNonPromise(globalObject, moduleRecord);
    RELEASE_AND_RETURN(scope, JSValue::encode(promise));
#endif
}
static EncodedJSValue fallbackParse(JSGlobalObject* globalObject, const Identifier& moduleKey, const SourceCode& sourceCode, JSInternalPromise* promise, JSModuleRecord* resultValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto rejectWithError = [&](JSValue error) {
        promise->reject(globalObject, error);
        return promise;
    };

    ParserError error;
    std::unique_ptr<ModuleProgramNode> moduleProgramNode = parseRootNode<ModuleProgramNode>(
        vm, sourceCode, ImplementationVisibility::Public, JSParserBuiltinMode::NotBuiltin,
        StrictModeLexicallyScopedFeature, JSParserScriptMode::Module, SourceParseMode::ModuleAnalyzeMode, error);
    if (error.isValid())
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(error.toErrorObject(globalObject, sourceCode))));
    ASSERT(moduleProgramNode);

    ModuleAnalyzer ModuleAnalyzer(globalObject, moduleKey, sourceCode, moduleProgramNode->varDeclarations(), moduleProgramNode->lexicalVariables(), moduleProgramNode->features());
    RETURN_IF_EXCEPTION(scope, JSValue::encode(promise->rejectWithCaughtException(globalObject, scope)));

    auto result = ModuleAnalyzer.analyze(*moduleProgramNode);
    if (!result) {
        auto [errorType, message] = WTFMove(result.error());
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, errorType, message))));
    }

    JSModuleRecord* moduleRecord = result.value();

    if (resultValue != nullptr) {
        auto actual = dumpRecordInfo(resultValue);
        auto expected = dumpRecordInfo(moduleRecord);
        if (actual != expected) {
            dataLog("\n\n\n\n\n\n\x1b[95mBEGIN analyzeTranspiledModule\x1b(B\x1b[m\n  ---code---\n\n", sourceCode.toUTF8().data(), "\n");
            dataLog("  ------", "\n");
            dataLog("  BunAnalyzeTranspiledModule:", "\n");

            zig__renderDiff(expected.utf8().data(), expected.utf8().length(), actual.utf8().data(), actual.utf8().length(), globalObject);

            RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, WTF::String::fromLatin1("Imports different between parseFromSourceCode and fallbackParse")))));
        }
    }

    scope.release();
    promise->fulfillWithNonPromise(globalObject, resultValue == nullptr ? moduleRecord : resultValue);
    return JSValue::encode(promise);
}

String dumpRecordInfo(JSModuleRecord* moduleRecord)
{
    WTF::StringPrintStream stream;

    stream.print("  varDeclarations:\n");
    for (const auto& pair : moduleRecord->m_declaredVariables) {
        stream.print("  - ", pair.key, "\n");
    }

    stream.print("  lexicalVariables:\n");
    for (const auto& pair : moduleRecord->m_lexicalVariables) {
        stream.print("  - ", pair.key, "\n");
    }

    stream.print("  features: ");
    stream.print(moduleRecord->m_features & ImportMetaFeature);
    stream.print("\n");

    stream.print("\nAnalyzing ModuleRecord key(", moduleRecord->moduleKey().impl(), ")\n");

    stream.print("    Dependencies: ", moduleRecord->requestedModules().size(), " modules\n");
    for (const auto& request : moduleRecord->requestedModules())
        if (request.m_attributes == nullptr) {
            stream.print("      module(", request.m_specifier, ")\n");
        } else {
            stream.print("      module(", request.m_specifier, "),attributes(", (uint8_t)request.m_attributes->type(), ", ", request.m_attributes->hostDefinedImportType(), ")\n");
        }

    stream.print("    Import: ", moduleRecord->importEntries().size(), " entries\n");
    for (const auto& pair : moduleRecord->importEntries()) {
        auto& importEntry = pair.value;
        stream.print("      import(", importEntry.importName, "), local(", importEntry.localName, "), module(", importEntry.moduleRequest, ")\n");
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
            line.print("      [Indirect] ", "export(", exportEntry.exportName, "), import(", exportEntry.importName, "), module(", exportEntry.moduleName, ")\n");
            break;

        case AbstractModuleRecord::ExportEntry::Type::Namespace:
            line.print("      [Namespace] ", "export(", exportEntry.exportName, "), module(", exportEntry.moduleName, ")\n");
            break;
        }
        sortedEntries.append(line.toString());
    }
    std::sort(sortedEntries.begin(), sortedEntries.end(), [](const String& a, const String& b) {
        return a.utf8().toStdString() < b.utf8().toStdString();
    });
    for (const auto& entry : sortedEntries)
        stream.print(entry);

    for (const auto& moduleName : moduleRecord->starExportEntries())
        stream.print("      [Star] module(", moduleName.get(), ")\n");

    stream.print("  -> done\n");

    return stream.toString();
}

}
