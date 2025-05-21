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
#include "JavaScriptCore/Watchdog.h"

#include "../vm/SigintWatcher.h"

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
    auto* exportNamesArray = jsDynamicCast<JSArray*>(exportNamesValue);
    if (!exportNamesArray) {
        throwArgumentTypeError(*globalObject, scope, 2, "exportNames"_s, "Module"_s, "Module"_s, "Array"_s);
        return nullptr;
    }

    WTF::Vector<Identifier, 4> exportNames;
    for (unsigned i = 0; i < exportNamesArray->getArrayLength(); i++) {
        JSValue exportNameValue = exportNamesArray->getDirectIndex(globalObject, i);
        if (!exportNameValue.isString()) {
            throwArgumentTypeError(*globalObject, scope, 2, "exportNames"_s, "Module"_s, "Module"_s, "string[]"_s);
        }
        exportNames.append(Identifier::fromString(vm, exportNameValue.toWTFString(globalObject)));
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    auto* structure = zigGlobalObject->NodeVMSyntheticModuleStructure();
    auto* ptr = new (NotNull, allocateCell<NodeVMSyntheticModule>(vm)) NodeVMSyntheticModule(vm, structure, identifierValue.toWTFString(globalObject), contextValue, WTFMove(exportNames));
    ptr->finishCreation(vm);
    return ptr;
}

void NodeVMSyntheticModule::destroy(JSCell* cell)
{
    static_cast<NodeVMSyntheticModule*>(cell)->NodeVMSyntheticModule::~NodeVMSyntheticModule();
}

void NodeVMSyntheticModule::createModuleRecord(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    SyntheticModuleRecord* moduleRecord = SyntheticModuleRecord::create(globalObject, vm, globalObject->syntheticModuleRecordStructure(), Identifier::fromString(vm, identifier()));

    m_moduleRecord.set(vm, this, moduleRecord);

    SymbolTable* exportSymbolTable = SymbolTable::create(vm);

    ScopeOffset offset = exportSymbolTable->takeNextScopeOffset(NoLockingNecessary);
    exportSymbolTable->set(NoLockingNecessary, vm.propertyNames->starNamespacePrivateName.impl(), SymbolTableEntry(VarOffset(offset)));

    for (const Identifier& exportName : m_exportNames) {
        auto offset = exportSymbolTable->takeNextScopeOffset(NoLockingNecessary);
        exportSymbolTable->set(NoLockingNecessary, exportName.impl(), SymbolTableEntry(VarOffset(offset)));
        moduleRecord->addExportEntry(SyntheticModuleRecord::ExportEntry::createLocal(exportName, exportName));
    }

    JSModuleEnvironment* moduleEnvironment = JSModuleEnvironment::create(vm, globalObject, nullptr, exportSymbolTable, jsTDZValue(), moduleRecord);
    moduleRecord->setModuleEnvironment(globalObject, moduleEnvironment);
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

JSValue NodeVMSyntheticModule::link(JSGlobalObject* globalObject, JSArray* specifiers, JSArray* moduleNatives, JSValue scriptFetcher)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_status != Status::Unlinked) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Module must be unlinked before linking"_s);
        return {};
    }

    SyntheticModuleRecord* record = m_moduleRecord.get();

    if (NodeVMGlobalObject* nodeVmGlobalObject = getGlobalObjectFromContext(globalObject, m_context.get(), false)) {
        globalObject = nodeVmGlobalObject;
    }

    Synchronousness sync = record->link(globalObject, scriptFetcher);

    RETURN_IF_EXCEPTION(scope, {});

    if (sync == Synchronousness::Async) {
        RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("TODO(@heimskr): async SyntheticModule linking");
    }

    status(Status::Linked);
    return JSC::jsUndefined();
}

JSValue NodeVMSyntheticModule::instantiate(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_status >= Status::Linked) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "Cannot reinstantiate a SyntheticModule"_s);
        return {};
    }

    if (m_status != Status::Unlinked) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "SyntheticModule must be unlinked before instantiating"_s);
        return {};
    }

    status(Status::Linked);
    return JSC::jsUndefined();
}

void NodeVMSyntheticModule::setExport(JSGlobalObject* globalObject, WTF::String exportName, JSValue value)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (status() < Status::Linked) {
        throwError(globalObject, scope, ErrorCode::ERR_VM_MODULE_STATUS, "SyntheticModule must be linked before exports can be set"_s);
        return;
    }

    ensureModuleRecord(globalObject);
    JSModuleNamespaceObject* namespaceObject = m_moduleRecord->getModuleNamespace(globalObject, false);
    namespaceObject->overrideExportValue(globalObject, Identifier::fromString(vm, exportName), value);
}

JSObject* NodeVMSyntheticModule::createPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return NodeVMModulePrototype::create(vm, NodeVMModulePrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

template<typename Visitor>
void NodeVMSyntheticModule::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* vmModule = jsCast<NodeVMSyntheticModule*>(cell);
    ASSERT_GC_OBJECT_INHERITS(vmModule, info());
    Base::visitChildren(vmModule, visitor);

    visitor.append(vmModule->m_moduleRecord);
}

DEFINE_VISIT_CHILDREN(NodeVMSyntheticModule);

const JSC::ClassInfo NodeVMSyntheticModule::s_info = { "NodeVMSyntheticModule"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMSyntheticModule) };

} // namespace Bun
