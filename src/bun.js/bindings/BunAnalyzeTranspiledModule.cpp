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
// ref: ModuleAnalyzer2.cpp
// ref: JSModuleRecord.cpp
// ref: NodesAnalyzeModule.cpp, search ::analyzeModule

#include "JavaScriptCore/ErrorType.h"

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

} // namespace JSC

namespace JSC {

ModuleAnalyzer::ModuleAnalyzer(JSGlobalObject* globalObject, const Identifier& moduleKey, const SourceCode& sourceCode, const VariableEnvironment& declaredVariables, const VariableEnvironment& lexicalVariables, CodeFeatures features)
    : m_vm(globalObject->vm())
    , m_moduleRecord(JSModuleRecord::create(globalObject, m_vm, globalObject->moduleRecordStructure(), moduleKey, sourceCode, declaredVariables, lexicalVariables, features))
{
}

void ModuleAnalyzer::appendRequestedModule(const Identifier& specifier, RefPtr<ScriptFetchParameters>&& attributes)
{
    auto result = m_requestedModules.add(specifier.impl());
    if (result.isNewEntry)
        moduleRecord()->appendRequestedModule(specifier, WTFMove(attributes));
}

void ModuleAnalyzer::exportVariable(ModuleProgramNode& moduleProgramNode, const RefPtr<UniquedStringImpl>& localName, const VariableEnvironmentEntry& variable)
{
    // In the parser, we already marked the variables as Exported and Imported.
    // By leveraging this information, we collect the information that is needed
    // to construct the module environment.
    //
    // I E
    //   * = exported module local variable
    // *   = imported binding
    //     = non-exported module local variable
    // * * = indirect exported binding
    //
    // One exception is namespace binding (like import * as ns from "mod").
    // This is annotated as an imported, but the actual binding is locate in the
    // current module.

    if (!variable.isExported())
        return;

    // Exported module local variable.
    if (!variable.isImported()) {
        for (auto& exportName : moduleProgramNode.moduleScopeData().exportedBindings().get(localName.get()))
            moduleRecord()->addExportEntry(JSModuleRecord::ExportEntry::createLocal(Identifier::fromUid(m_vm, exportName.get()), Identifier::fromUid(m_vm, localName.get())));
        return;
    }

    if (variable.isImportedNamespace()) {
        // Exported namespace binding.
        // import * as namespace from "mod"
        // export { namespace }
        //
        // Sec 15.2.1.16.1 step 11-a-ii-2-b https://tc39.github.io/ecma262/#sec-parsemodule
        // Namespace export is handled as local export since a namespace object binding itself is implemented as a local binding.
        for (auto& exportName : moduleProgramNode.moduleScopeData().exportedBindings().get(localName.get()))
            moduleRecord()->addExportEntry(JSModuleRecord::ExportEntry::createLocal(Identifier::fromUid(m_vm, exportName.get()), Identifier::fromUid(m_vm, localName.get())));
        return;
    }

    // Indirectly exported binding.
    // import a from "mod"
    // export { a }
    std::optional<JSModuleRecord::ImportEntry> optionalImportEntry = moduleRecord()->tryGetImportEntry(localName.get());
    ASSERT(optionalImportEntry);
    const JSModuleRecord::ImportEntry& importEntry = *optionalImportEntry;
    for (auto& exportName : moduleProgramNode.moduleScopeData().exportedBindings().get(localName.get()))
        moduleRecord()->addExportEntry(JSModuleRecord::ExportEntry::createIndirect(Identifier::fromUid(m_vm, exportName.get()), importEntry.importName, importEntry.moduleRequest));
}

Expected<JSModuleRecord*, std::tuple<ErrorType, String>> ModuleAnalyzer::analyze(ModuleProgramNode& moduleProgramNode)
{
    // Traverse the module AST and collect
    // * Import entries
    // * Export entries that have FromClause (e.g. export { a } from "mod")
    // * Export entries that have star (e.g. export * from "mod")
    // * Aliased export names (e.g. export { a as b })
    if (!moduleProgramNode.analyzeModule(*this))
        return makeUnexpected(WTFMove(m_errorMessage));

    // Based on the collected information, categorize export entries into 3 types.
    // 1. Local export entries
    //     This references the local variable in the current module.
    //     This variable should be allocated in the current module environment as a heap variable.
    //
    //     const variable = 20
    //     export { variable }
    //
    // 2. Namespace export entries
    //     This references the namespace object imported by some import entries.
    //     This variable itself should be allocated in the current module environment as a heap variable.
    //     But when the other modules attempt to resolve this export name in this module, this module
    //     should tell the link to the original module.
    //
    //     import * as namespace from "mod"
    //     export { namespace as mod }
    //
    // 3. Indirect export entries
    //     This references the imported binding name from the other module.
    //     This module environment itself should hold the pointer to (1) the original module and
    //     (2) the binding in the original module. The variable itself is allocated in the original
    //     module. This indirect binding is resolved when the CodeBlock resolves the references.
    //
    //     import mod from "mod"
    //     export { mod }
    //
    //     export { a } from "mod"
    //
    // And separeted from the above 3 types, we also collect the star export entries.
    //
    // 4. Star export entries
    //     This exports all the names from the specified external module as the current module's name.
    //
    //     export * from "mod"
    for (const auto& pair : m_moduleRecord->declaredVariables())
        exportVariable(moduleProgramNode, pair.key, pair.value);

    for (const auto& pair : m_moduleRecord->lexicalVariables())
        exportVariable(moduleProgramNode, pair.key, pair.value);

    if (UNLIKELY(Options::dumpModuleRecord()))
        m_moduleRecord->dump();

    return m_moduleRecord;
}

} // namespace JSC

namespace JSC {

extern "C" void zig_log_u8(const char* m1, const unsigned char* m2, size_t m2_size);
extern "C" void zig_log_cstr(const char* m1, const char* m2);
extern "C" void zig_log_ushort(const char* m1, unsigned short value);

extern "C" __attribute__((weak)) EncodedJSValue Bun__analyzeTranspiledModule(JSGlobalObject* globalObject, const Identifier& moduleKey, const SourceCode& sourceCode, JSInternalPromise* promise)
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
    zig_log_cstr("  ---code---\n\n", sourceCode.toUTF8().data());
    zig_log_cstr("  ------", "");
    zig_log_cstr("  BunAnalyzeTranspiledModule:", "");
    if (!result) {
        auto [errorType, message] = WTFMove(result.error());
        zig_log_cstr("    -> Error:", message.ascii().data());
        RELEASE_AND_RETURN(scope, JSValue::encode(rejectWithError(createError(globalObject, errorType, message))));
    }

    JSModuleRecord* moduleRecord = result.value();

    // VariableEnvironment declaredVariables = VariableEnvironment();
    // VariableEnvironment lexicalVariables = VariableEnvironment();
    // CodeFeatures features = 0;
    if (true) {
        zig_log_cstr("  -> Success.", "");
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

    // it looks like the only usage of moduleRecord->m_lexicalVariables and others is in modulerecord and
    // JSModuleRecord::instantiateDeclarations for declaredVariables
    //      SymbolTableEntry entry = symbolTable->get(variable.key.get());
    //      VarOffset offset = entry.varOffset();
    //      if (!offset.isStack()) {
    //          bool putResult = false;
    //          symbolTablePutTouchWatchpointSet(moduleEnvironment, globalObject, Identifier::fromUid(vm, variable.key.get()), jsUndefined(), /* shouldThrowReadOnlyError */ false, /* ignoreReadOnlyErrors */ true, putResult);
    //          RETURN_IF_EXCEPTION(scope, void());
    //      }

    // m_sourceCode is easy, we have it already
    // m_declaredVariables is:
    // m_lexicalVariables is:
    // m_moduleProgramExecutable is managed by JSModuleRecord
    // m_features is:
    //   const CodeFeatures ImportMetaFeature =             1 << 12;
    // (that is the only used CodeFeature)

    scope.release();
    promise->fulfillWithNonPromise(globalObject, result.value());
    return JSValue::encode(promise);
}

}
