#include "BunClientData.h"
#include "NodeVMScriptFetcher.h"
#include "NodeVMSourceTextModule.h"
#include "NodeVMSyntheticModule.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"

#include "wtf/Scope.h"

#include "JavaScriptCore/JIT.h"
#include "JavaScriptCore/JSModuleEnvironment.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSSourceCode.h"
#include "JavaScriptCore/ModuleAnalyzer.h"
#include "JavaScriptCore/ModuleProgramCodeBlock.h"
#include "JavaScriptCore/Parser.h"
#include "JavaScriptCore/SourceCodeKey.h"

namespace Bun {
using namespace NodeVM;

NodeVMSyntheticModule* NodeVMSyntheticModule::create(VM& vm, JSGlobalObject* globalObject, ArgList args)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue identifierValue = args.at(0);
    if (!identifierValue.isString()) {
        throwArgumentTypeError(*globalObject, scope, 0, "identifier"_s, "Module"_s, "Module"_s, "string"_s);
        return nullptr;
    }

    JSValue contextValue = args.at(1);
    if (contextValue.isUndefined()) {
        contextValue = globalObject;
    } else if (!contextValue.isObject()) {
        throwArgumentTypeError(*globalObject, scope, 1, "context"_s, "Module"_s, "Module"_s, "object"_s);
        return nullptr;
    }

    JSValue exportNamesValue = args.at(2);
    auto* exportNamesArray = dynamicDowncast<JSArray>(exportNamesValue);
    if (!exportNamesArray) {
        throwArgumentTypeError(*globalObject, scope, 2, "exportNames"_s, "Module"_s, "Module"_s, "Array"_s);
        return nullptr;
    }

    JSValue syntheticEvaluationStepsValue = args.at(3);
    if (!syntheticEvaluationStepsValue.isCallable()) {
        throwArgumentTypeError(*globalObject, scope, 3, "syntheticEvaluationSteps"_s, "Module"_s, "Module"_s, "function"_s);
        return nullptr;
    }

    JSValue moduleWrapperValue = args.at(4);
    if (!moduleWrapperValue.isObject()) {
        throwArgumentTypeError(*globalObject, scope, 4, "moduleWrapper"_s, "Module"_s, "Module"_s, "object"_s);
        return nullptr;
    }

    WTF::HashSet<String> exportNames;
    for (unsigned i = 0; i < exportNamesArray->getArrayLength(); i++) {
        JSValue exportNameValue = exportNamesArray->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (!exportNameValue.isString()) {
            throwArgumentTypeError(*globalObject, scope, 2, "exportNames"_s, "Module"_s, "Module"_s, "string[]"_s);
            return nullptr;
        }
        exportNames.addVoid(exportNameValue.toWTFString(globalObject));
        RETURN_IF_EXCEPTION(scope, nullptr);
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    auto* structure = zigGlobalObject->NodeVMSyntheticModuleStructure();
    WTF::String identifier = identifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* ptr = new (NotNull, allocateCell<NodeVMSyntheticModule>(vm)) NodeVMSyntheticModule(vm, structure, WTF::move(identifier), contextValue, moduleWrapperValue, WTF::move(exportNames), syntheticEvaluationStepsValue);
    ptr->finishCreation(vm);
    return ptr;
}

void NodeVMSyntheticModule::destroy(JSCell* cell)
{
    static_cast<NodeVMSyntheticModule*>(cell)->NodeVMSyntheticModule::~NodeVMSyntheticModule();
}

// An unnamed variable of the record's environment that holds the module until its evaluateCallback ran.
static ScopeOffset moduleScopeOffset() { return ScopeOffset(0); }

// The one source of all vm.SyntheticModule records. Its fetcher tells the moduleLoaderEvaluate hook what they are.
static SourceCode sourceCodeOfSyntheticModules(VM& vm)
{
    RefPtr<JSC::SourceProvider>& provider = WebCore::clientData(vm)->nodeVMSourceOriginCache().syntheticModuleSource;
    if (!provider) [[unlikely]] {
        Ref fetcher = NodeVMScriptFetcher::createForSyntheticModule();
        provider = StringSourceProvider::create(emptyString(), SourceOrigin { {}, fetcher.get() }, String {}, SourceTaintedOrigin::Untainted, TextPosition(), SourceProviderSourceType::Module);
    }
    return SourceCode(Ref { *provider });
}

void NodeVMSyntheticModule::createModuleRecord(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGlobalObject* realm = moduleRealm(globalObject);
    RETURN_IF_EXCEPTION(scope, void());

    JSModuleRecord* moduleRecord = JSModuleRecord::create(realm, vm, realm->moduleRecordStructure(), realm->moduleLoader(), Identifier::fromString(vm, identifier()), sourceCodeOfSyntheticModules(vm), NoFeatures);

    SymbolTable* exportSymbolTable = SymbolTable::create(vm);

    ScopeOffset offset = exportSymbolTable->takeNextScopeOffset(NoLockingNecessary);
    RELEASE_ASSERT(offset == moduleScopeOffset());

    offset = exportSymbolTable->takeNextScopeOffset(NoLockingNecessary);
    exportSymbolTable->set(NoLockingNecessary, vm.propertyNames->starNamespacePrivateName.impl(), SymbolTableEntry(VarOffset(offset)));

    for (const String& exportName : m_exportNames) {
        auto offset = exportSymbolTable->takeNextScopeOffset(NoLockingNecessary);
        // Named after its slot: JSC shares linked code between importers whose (source, variable name) bindings match.
        Identifier localName = Identifier::from(vm, offset.offset());
        moduleRecord->addExportEntry(JSModuleRecord::ExportEntry::createLocal(Identifier::fromString(vm, exportName), localName));
        exportSymbolTable->set(NoLockingNecessary, localName.impl(), SymbolTableEntry(VarOffset(offset)));
    }

    // V8 initializes synthetic-module exports to undefined (reading one
    // before setExport() yields undefined), unlike TDZ which would throw.
    JSModuleEnvironment* moduleEnvironment = JSModuleEnvironment::create(vm, realm, nullptr, exportSymbolTable, jsUndefined(), moduleRecord);
    moduleEnvironment->variableAt(moduleScopeOffset()).set(vm, moduleEnvironment, this);
    moduleRecord->setModuleEnvironment(realm, moduleEnvironment);
    RETURN_IF_EXCEPTION(scope, void());
    // Link() would make the environment from the code of the module, and this record has none: it is linked as it is.
    moduleRecord->setStatus(JSC::CyclicModuleRecord::Status::Linked);

    m_moduleRecord.set(vm, this, moduleRecord);
}

void NodeVMSyntheticModule::ensureModuleRecord(JSGlobalObject* globalObject)
{
    if (!m_moduleRecord) {
        createModuleRecord(globalObject);
    }
}

AbstractModuleRecord* NodeVMSyntheticModule::moduleRecord(JSGlobalObject* globalObject)
{
    ensureModuleRecord(globalObject);
    return m_moduleRecord.get();
}

JSValue NodeVMSyntheticModule::instantiate(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_isInstantiated) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Cannot reinstantiate a SyntheticModule"_s);
        return {};
    }

    m_isInstantiated = true;
    return JSC::jsUndefined();
}

void NodeVMSyntheticModule::runEvaluationSteps(JSGlobalObject* globalObject, JSC::JSModuleRecord* record)
{
    VM& vm = globalObject->vm();

    // Evaluate() runs a record once, so the module is there. The record has no more use for it.
    JSModuleEnvironment* environment = record->moduleEnvironment();
    auto* module = dynamicDowncast<NodeVMSyntheticModule>(environment->variableAt(moduleScopeOffset()).get());
    RELEASE_ASSERT(module);
    environment->variableAt(moduleScopeOffset()).set(vm, environment, jsUndefined());

    // As a module body does, the steps run in the async context of the code that evaluates the module.
    JSValue steps = module->m_syntheticEvaluationSteps.get();
    JSC::call(globalObject, steps, JSC::getCallData(steps), module->m_moduleWrapper.get(), ArgList());
}

void NodeVMSyntheticModule::setExport(JSGlobalObject* globalObject, WTF::String exportName, JSValue value)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_isInstantiated) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "SyntheticModule must be linked before exports can be set"_s);
        return;
    }

    if (!m_exportNames.contains(exportName)) {
        // `exportName` comes from JS. Past `String::MaxLength`, `makeString` calls `CRASH()` and `tryMakeString` returns null.
        auto message = tryMakeString("Export '"_s, exportName, "' is not defined in module"_s);
        if (!message) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return;
        }
        throwVMError(globalObject, scope, createReferenceError(globalObject, message));
        return;
    }

    ensureModuleRecord(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    JSModuleNamespaceObject* namespaceObject = m_moduleRecord->getModuleNamespace(globalObject, false);
    RETURN_IF_EXCEPTION(scope, );
    namespaceObject->overrideExportValue(globalObject, Identifier::fromString(vm, exportName), value);
    RETURN_IF_EXCEPTION(scope, );
}

JSObject* NodeVMSyntheticModule::createPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return NodeVMModulePrototype::create(vm, NodeVMModulePrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

template<typename Visitor>
void NodeVMSyntheticModule::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* vmModule = uncheckedDowncast<NodeVMSyntheticModule>(cell);
    ASSERT_GC_OBJECT_INHERITS(vmModule, info());
    Base::visitChildren(vmModule, visitor);

    visitor.append(vmModule->m_moduleRecord);
    visitor.append(vmModule->m_syntheticEvaluationSteps);
}

DEFINE_VISIT_CHILDREN(NodeVMSyntheticModule);

const JSC::ClassInfo NodeVMSyntheticModule::s_info = { "NodeVMSyntheticModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMSyntheticModule) };

} // namespace Bun
