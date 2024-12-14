#include "root.h"

#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSModuleRecord.h"
// #include "JavaScriptCore/BuiltinNames.h"
// #include "JavaScriptCore/CatchScope.h"
#include "JavaScriptCore/GlobalObjectMethodTable.h"
// #include "JavaScriptCore/JSCInlines.h"
// #include "JavaScriptCore/JSInternalPromise.h"
// #include "JavaScriptCore/JSMap.h"
// #include "JavaScriptCore/JSModuleNamespaceObject.h"
#include "JavaScriptCore/JSModuleRecord.h"
// #include "JavaScriptCore/JSScriptFetchParameters.h"
// #include "JavaScriptCore/JSSourceCode.h"
// #include "JavaScriptCore/JSWebAssembly.h"
#include "JavaScriptCore/Nodes.h"
// #include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/Parser.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/SyntheticModuleRecord.h"
// #include "JavaScriptCore/VMTrapsInlines.h"
#include <wtf/text/MakeString.h>
// #include "JavaScriptCore/IdentifierInlines.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/ModuleScopeData.h"
#include "JavaScriptCore/ExceptionScope.h"
// #include "JavaScriptCore/StrongInlines.h"

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

void dumpRecordInfo(JSModuleRecord* moduleRecord);

extern "C" void zig_log_u8(const char* m1, const unsigned char* m2, size_t m2_size);
extern "C" void zig_log_cstr(const char* m1, const char* m2);
extern "C" void zig_log_ushort(const char* m1, unsigned short value);

struct ModuleInfo;
extern "C" JSModuleRecord* zig__ModuleInfo__parseFromSourceCode(JSGlobalObject* globalObject, VM& vm, const Identifier& module_key, const SourceCode& source_code, VariableEnvironment& declared_variables, VariableEnvironment& lexical_variables, const char* source_ptr, size_t source_len, int* failure_reason);

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

extern "C" JSModuleRecord* JSC_JSModuleRecord__create(JSGlobalObject* globalObject, VM& vm, const Identifier* moduleKey, const SourceCode& sourceCode, const VariableEnvironment& declaredVariables, const VariableEnvironment& lexicalVariables, bool hasImportMeta)
{
    return JSModuleRecord::create(globalObject, vm, globalObject->moduleRecordStructure(), moduleKey[0], sourceCode, declaredVariables, lexicalVariables, hasImportMeta ? ImportMetaFeature : 0);
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
extern "C" void JSC_JSModuleRecord__addRequestedModuleHostDefined(JSModuleRecord* moduleRecord, Identifier* identifierArray, uint32_t moduleName, const char* hostDefinedImportType)
{
    Ref<ScriptFetchParameters> attributes = ScriptFetchParameters::create(makeString(ASCIILiteral::fromLiteralUnsafe(hostDefinedImportType)));
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

    zig_log_cstr("\n\n\n\n\n\n\x1b[95mBEGIN analyzeTranspiledModule\x1b(B\x1b[m\n  ---code---\n\n", sourceCode.toUTF8().data());
    zig_log_cstr("  ------", "");
    zig_log_cstr("  BunAnalyzeTranspiledModule:", "");

    auto sourceCodeStdString = sourceCode.toUTF8().toStdString();

    VariableEnvironment declaredVariables = VariableEnvironment();
    VariableEnvironment lexicalVariables = VariableEnvironment();

    int failure_reason = -1;
    auto moduleRecord = zig__ModuleInfo__parseFromSourceCode(globalObject, vm, moduleKey, sourceCode, declaredVariables, lexicalVariables, sourceCodeStdString.data(), sourceCodeStdString.size(), &failure_reason);
    if (moduleRecord == nullptr) {
        if (failure_reason == 1) {
            // module does not have a <jsc-module-info> block. fall back to double-parse.
            return fallbackParse(globalObject, moduleKey, sourceCode, promise);
        } else if (failure_reason == 2) {
            //
            RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, WTF::String::fromLatin1("parseFromSourceCode failed")))));
        } else {
            // :/
            RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, WTF::String::fromLatin1("parseFromSourceCode failed")))));
        }
    }

    bool compare = true;
    zig_log_cstr("\n\n  \x1b[91m<Actual Record Info>\x1b(B\x1b[m\n  ------", "");
    dumpRecordInfo(moduleRecord);
    zig_log_cstr("\n  \x1b[91m</Actual Record Info>\x1b(B\x1b[m", "");

    if (compare) {
        RELEASE_AND_RETURN(scope, fallbackParse(globalObject, moduleKey, sourceCode, promise, moduleRecord));
    } else {
        promise->fulfillWithNonPromise(globalObject, moduleRecord);
        RELEASE_AND_RETURN(scope, JSValue::encode(promise));
    }
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
    zig_log_cstr("\n\n  \x1b[92m<Expected Record Info>\x1b(B\x1b[m\n  ------", "");
    dumpRecordInfo(moduleRecord);
    zig_log_cstr("\n  \x1b[92m</Expected Record Info>\x1b(B\x1b[m", "");

    scope.release();
    promise->fulfillWithNonPromise(globalObject, resultValue == nullptr ? moduleRecord : resultValue);
    return JSValue::encode(promise);
}

void dumpRecordInfo(JSModuleRecord* moduleRecord)
{

    zig_log_cstr("  varDeclarations:", "");
    {
        auto iter = moduleRecord->m_declaredVariables.begin();
        auto end = moduleRecord->m_declaredVariables.end();
        while (iter != end) {
            auto& pair = *iter;

            zig_log_u8("  - ", pair.key->span8().data(), pair.key->span8().size());

            ++iter;
        }
    }
    zig_log_cstr("  lexicalVariables:", "");
    {
        auto iter = moduleRecord->m_lexicalVariables.begin();
        auto end = moduleRecord->m_lexicalVariables.end();
        while (iter != end) {
            auto& pair = *iter;

            zig_log_u8("  - ", pair.key->span8().data(), pair.key->span8().size());

            ++iter;
        }
    }
    // zig_log
    zig_log_ushort("  features: ", moduleRecord->m_features);

    moduleRecord->dump();
    zig_log_cstr("  -> done", "");

    // declaredVariables.add();
    // features |= ImportMetaFeature;
}

}
