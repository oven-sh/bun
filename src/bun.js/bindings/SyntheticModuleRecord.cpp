#include "SyntheticModuleRecord.h"
#include "JavaScriptCore/CellSize.h"
#include "JavaScriptCore/BuiltinNames.h"
#include "JavaScriptCore/JSCInlines.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSONObject.h"


JSC::SyntheticModuleRecord* tryCreateWithExportNamesAndValues(
    JSC::JSGlobalObject* globalObject, const JSC::Identifier& moduleKey,
    const WTF::Vector<JSC::Identifier, 4>& exportNames, const JSC::MarkedArgumentBuffer& exportValues)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    ASSERT(exportNames.size() == exportValues.size());

    auto* moduleRecord = JSC::SyntheticModuleRecord::create(
        globalObject, vm, globalObject->syntheticModuleRecordStructure(), moduleKey);
    moduleRecord->addExportEntry(
        JSC::AbstractModuleRecord::ExportEntry::createLocal(
            vm.propertyNames->defaultKeyword, vm.propertyNames->defaultKeyword));

    JSC::SymbolTable* exportSymbolTable = JSC::SymbolTable::create(vm);
    {
        auto offset = exportSymbolTable->takeNextScopeOffset(NoLockingNecessary);
        exportSymbolTable->set(
            NoLockingNecessary, vm.propertyNames->starNamespacePrivateName.impl(), JSC::SymbolTableEntry(JSC::VarOffset(offset)));
    }
    for (auto& exportName : exportNames) {
        auto offset = exportSymbolTable->takeNextScopeOffset(NoLockingNecessary);
        exportSymbolTable->set(NoLockingNecessary, exportName.impl(), JSC::SymbolTableEntry(JSC::VarOffset(offset)));
    }

    JSC::JSModuleEnvironment* moduleEnvironment = JSC::JSModuleEnvironment::create(
        vm, globalObject, nullptr, exportSymbolTable, JSC::jsTDZValue(), moduleRecord);
    moduleRecord->setModuleEnvironment(globalObject, moduleEnvironment);
    RETURN_IF_EXCEPTION(scope, { });

    for (unsigned index = 0; index < exportNames.size(); ++index) {
        JSC::PropertyName exportName = exportNames[index];
        JSC::JSValue exportValue = exportValues.at(index);
        constexpr bool shouldThrowReadOnlyError = false;
        constexpr bool ignoreReadOnlyErrors = true;
        bool putResult = false;
        JSC::symbolTablePutTouchWatchpointSet(
            moduleEnvironment, globalObject, exportName, exportValue,
            shouldThrowReadOnlyError, ignoreReadOnlyErrors, putResult);
        RETURN_IF_EXCEPTION(scope, { });
        ASSERT(putResult);
    }

    return moduleRecord;

}
