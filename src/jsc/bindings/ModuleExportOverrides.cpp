#include "root.h"
#include "ModuleExportOverrides.h"

#include "JSMockFunction.h"
#include "ModuleLoader.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include <JavaScriptCore/AbstractModuleRecord.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSSymbolTableObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SymbolTableInlines.h>
#include <JavaScriptCore/SyntheticModuleRecord.h>

namespace Bun {

using namespace JSC;

// The stores to one export variable, among the stores to all the variables of its module record. The record has them under a
// private name, in an object with no prototype that nothing else reaches and that is read and written by index only, so no
// JavaScript runs on the way. The record lets go of the object with the last store.
//   table[variablesSlot]: how many variables have stores.
// Then three slots per variable, by its scope offset: what the variable had before its stores (`table`: nothing), the owner of
// its store, and the value of that store. A store whose owner is null is nobody's: it ended, and the variable had no value to
// go back to. A second store to one variable is rare. Then the owner slot has a list, an object of the same kind, and the
// value slot has `table`. The list has the number of stores, and then an owner and a value for each, oldest first.
struct ExportVariableStores {
    static constexpr unsigned variablesSlot = 0, firstVariable = 1;
    static constexpr unsigned originalSlot = 0, ownerSlot = 1, valueSlot = 2, slotsOfVariable = 3;

    JSGlobalObject* globalObject;
    AbstractModuleRecord* record { nullptr };
    JSModuleEnvironment* environment { nullptr };
    Identifier localName;
    unsigned offset { 0 };
    JSObject* table { nullptr };
    // Of the variable: where its slots are, the list if it has one, and the number of its stores.
    unsigned base { 0 };
    JSObject* list { nullptr };
    unsigned count { 0 };

    static Identifier nameInRecord()
    {
        // One immortal private symbol for every VM, as the engine's own private names are. No VM registers it or pays for it at its start.
        static WTF::SymbolImpl::StaticSymbolImpl name { "exportStores"_s, WTF::SymbolImpl::s_flagIsPrivate };
        return Identifier::fromUid(name);
    }

    // Not through the namespace object, which would force a builtin's lazy export.
    JSValue read() const { return environment->readVariable(getVM(globalObject), ScopeOffset(offset)); }

    // The slots hold values of any kind. An object whose first indexed value is a number would keep numbers only, and hand
    // an integer back as a double once it gets one: so each of the two kinds of object begins with itself in its first slot.
    JSObject* makeSlots()
    {
        JSObject* slots = constructEmptyObject(getVM(globalObject), globalObject->nullPrototypeObjectStructure());
        slots->putDirectIndex(globalObject, 0, slots);
        return slots;
    }
    unsigned numberAt(JSObject* slots, unsigned index) const
    {
        JSValue number = slots->getDirectIndex(globalObject, index);
        return number.isInt32() ? number.asInt32() : 0;
    }

    // Finds the variable that `name` exports. `record` stays null if it exports none, or if the record that declares it has no
    // stores and `onlyWithStores`.
    __attribute__((minsize)) void find(JSModuleNamespaceObject* moduleNamespace, const Identifier& name, bool onlyWithStores)
    {
        auto& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto resolution = moduleNamespace->moduleRecord()->resolveExport(globalObject, name);
        RETURN_IF_EXCEPTION(scope, );
        if (resolution.type != AbstractModuleRecord::Resolution::Type::Resolved)
            return;
        JSValue stores = resolution.moduleRecord->getDirect(vm, nameInRecord());
        bool hasStores = stores && stores.isObject();
        if (!hasStores && onlyWithStores)
            return;
        // `export * as name`: the variable holds the namespace object of its module from the first time that something asks
        // for the object. A store is about to replace it, so it is asked for now.
        if (!onlyWithStores && resolution.localName == vm.propertyNames->starNamespacePrivateName) {
            resolution.moduleRecord->getModuleNamespace(globalObject);
            RETURN_IF_EXCEPTION(scope, );
        }
        auto* moduleEnvironment = resolution.moduleRecord->moduleEnvironmentMayBeNull();
        if (!moduleEnvironment)
            return;
        SymbolTableEntry::Fast entry = moduleEnvironment->symbolTable()->get(resolution.localName.impl());
        if (entry.isNull())
            return;
        record = resolution.moduleRecord;
        environment = moduleEnvironment;
        localName = resolution.localName;
        offset = entry.scopeOffset().offset();
        base = firstVariable + slotsOfVariable * offset;
        if (hasStores)
            load();
    }

    // Also after JavaScript has run, which may have stored or ended a store.
    void load()
    {
        JSValue stores = record->getDirect(getVM(globalObject), nameInRecord());
        table = stores && stores.isObject() ? asObject(stores) : nullptr;
        list = nullptr;
        count = 0;
        JSValue owner = table ? table->getDirectIndex(globalObject, base + ownerSlot) : JSValue();
        if (!owner || owner.isUndefined())
            return;
        count = 1;
        if (table->getDirectIndex(globalObject, base + valueSlot) == table) {
            list = asObject(owner);
            count = numberAt(list, 0);
        }
    }

    // Stores are numbered from the oldest. The owner of one is in a slot, and its value in the next.
    JSObject* holder() const { return list ? list : table; }
    unsigned slotOf(unsigned store) const { return list ? 1 + 2 * store : base + ownerSlot; }
    JSValue ownerAt(unsigned store) const { return holder()->getDirectIndex(globalObject, slotOf(store)); }
    JSValue valueAt(unsigned store) const { return holder()->getDirectIndex(globalObject, slotOf(store) + 1); }
    // The store of `owner`, from the newest: the one that ends first is the one that was made last. `count` if it has none.
    unsigned storeOf(JSValue owner) const
    {
        for (unsigned store = count; store--;) {
            if (ownerAt(store) == owner)
                return store;
        }
        return count;
    }
    // Empty if the variable had no value.
    JSValue original() const
    {
        JSValue value = table->getDirectIndex(globalObject, base + originalSlot);
        return value == table ? JSValue() : value;
    }
    // What the variable shows without the store and those above it.
    JSValue beneath(unsigned store) const { return store ? valueAt(store - 1) : original(); }

    __attribute__((minsize)) void setStore(unsigned store, JSValue owner, JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        holder()->putDirectIndex(globalObject, slotOf(store), owner);
        RETURN_IF_EXCEPTION(scope, );
        RELEASE_AND_RETURN(scope, void(holder()->putDirectIndex(globalObject, slotOf(store) + 1, value)));
    }

    // The first store to the variable: `held` is what it has.
    __attribute__((minsize)) void begin(JSValue held)
    {
        auto& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        unsigned variables = 0;
        if (table)
            variables = numberAt(table, variablesSlot);
        else {
            table = makeSlots();
            RETURN_IF_EXCEPTION(scope, );
            record->putDirect(vm, nameInRecord(), table, static_cast<unsigned>(PropertyAttribute::DontEnum));
        }
        table->putDirectIndex(globalObject, variablesSlot, jsNumber(variables + 1));
        RETURN_IF_EXCEPTION(scope, );
        RELEASE_AND_RETURN(scope, void(table->putDirectIndex(globalObject, base + originalSlot, held ? held : JSValue(table))));
    }

    // Lays a store over the stores of the variable.
    __attribute__((minsize)) void append(JSValue owner, JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        if (count == 1 && !list) {
            JSObject* stores = makeSlots();
            RETURN_IF_EXCEPTION(scope, );
            JSValue firstOwner = ownerAt(0);
            JSValue firstValue = valueAt(0);
            list = stores;
            setStore(0, firstOwner, firstValue);
            RETURN_IF_EXCEPTION(scope, );
            table->putDirectIndex(globalObject, base + ownerSlot, stores);
            RETURN_IF_EXCEPTION(scope, );
            table->putDirectIndex(globalObject, base + valueSlot, table);
            RETURN_IF_EXCEPTION(scope, );
        }
        setStore(count, owner, value);
        RETURN_IF_EXCEPTION(scope, );
        ++count;
        if (list)
            RELEASE_AND_RETURN(scope, void(list->putDirectIndex(globalObject, 0, jsNumber(count))));
    }

    // Takes a store out. What the variable had before its stores goes with the last of them, and the table of the record with
    // its last variable: `table` is null after that.
    __attribute__((minsize)) void remove(unsigned store)
    {
        auto& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (count > 1) {
            for (unsigned at = store; at + 1 < count; ++at) {
                setStore(at, ownerAt(at + 1), valueAt(at + 1));
                RETURN_IF_EXCEPTION(scope, );
            }
            --count;
            setStore(count, jsUndefined(), jsUndefined());
            RETURN_IF_EXCEPTION(scope, );
            RELEASE_AND_RETURN(scope, void(list->putDirectIndex(globalObject, 0, jsNumber(count))));
        }
        list = nullptr;
        count = 0;
        for (unsigned slot : { originalSlot, ownerSlot, valueSlot }) {
            table->putDirectIndex(globalObject, base + slot, jsUndefined());
            RETURN_IF_EXCEPTION(scope, );
        }
        unsigned variables = numberAt(table, variablesSlot) - 1;
        if (variables)
            RELEASE_AND_RETURN(scope, void(table->putDirectIndex(globalObject, variablesSlot, jsNumber(variables))));
        record->putDirect(vm, nameInRecord(), jsUndefined(), static_cast<unsigned>(PropertyAttribute::DontEnum));
        table = nullptr;
    }

    // Takes a store from under the store above it. What it returns goes to didEndExportBeneathMock() after the last use of
    // the table, because that can run JavaScript: the value above, the one that left, and the one beneath, if any.
    struct FromUnder {
        JSValue above;
        JSValue ended;
        JSValue beneath;
    };
    __attribute__((minsize)) FromUnder removeFromUnder(unsigned store)
    {
        FromUnder values { valueAt(store + 1), valueAt(store), beneath(store) };
        remove(store);
        return values;
    }

    // A variable that had no value at its first store gets its own later: the body of its module runs to the declaration.
    // What the variable holds is that value if no store made it. A store that was nobody's is gone then.
    __attribute__((minsize)) void takeValueOfModule()
    {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        if (!count || original())
            return;
        JSValue held = read();
        if (!held)
            return;
        for (unsigned store = 0; store < count; ++store) {
            if (valueAt(store) == held)
                return;
        }
        if (ownerAt(count - 1).isNull())
            RELEASE_AND_RETURN(scope, remove(count - 1));
        RELEASE_AND_RETURN(scope, void(table->putDirectIndex(globalObject, base + originalSlot, held)));
    }

    // The engine's store to the variable, as JSModuleNamespaceObject::overrideExportValue() makes it, without a second search
    // for the variable. Only for a variable that the engine has stored to for us before.
    void write(JSValue value)
    {
        bool isPut = false;
        symbolTablePutTouchWatchpointSet(environment, globalObject, localName, value, false, true, isPut);
    }
};

__attribute__((minsize)) bool overrideExport(JSGlobalObject* globalObject, JSModuleNamespaceObject* moduleNamespace, const Identifier& name, JSValue value, JSObject* owner)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    ExportVariableStores stores { globalObject };
    stores.find(moduleNamespace, name, false);
    RETURN_IF_EXCEPTION(scope, false);
    stores.takeValueOfModule();
    RETURN_IF_EXCEPTION(scope, false);
    JSValue held = stores.record ? stores.read() : JSValue();
    unsigned newest = stores.count - 1;
    JSValue newestOwner = stores.count ? stores.ownerAt(newest) : JSValue();
    // What the variable shows already is no new store. It is the store of `owner` only if `owner` made it.
    if (stores.record && value == held)
        return newestOwner == owner;
    // Nor is what the variable would show without the store of `owner`: under a second name of the variable, `owner` hands back
    // what its store replaced.
    if (newestOwner == owner && stores.beneath(newest) == value) {
        stores.remove(newest);
        RETURN_IF_EXCEPTION(scope, false);
        stores.write(value);
        RETURN_IF_EXCEPTION(scope, false);
        return false;
    }

    if (!stores.count) {
        // The first store to a variable goes through the engine, which says whether the module takes one.
        bool isStored = moduleNamespace->overrideExportValue(globalObject, name, value);
        RETURN_IF_EXCEPTION(scope, false);
        if (!isStored || !stores.record)
            return false;
        stores.begin(held);
        RETURN_IF_EXCEPTION(scope, false);
        stores.append(owner, value);
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    }

    ExportVariableStores::FromUnder earlier;
    if (newestOwner == owner || newestOwner.isNull()) {
        // The newest store is the earlier one of `owner`, or nobody's: it becomes this one.
        stores.setStore(newest, owner, value);
        RETURN_IF_EXCEPTION(scope, false);
    } else {
        if (unsigned own = stores.storeOf(owner); own < stores.count) {
            earlier = stores.removeFromUnder(own);
            RETURN_IF_EXCEPTION(scope, false);
        }
        stores.append(owner, value);
        RETURN_IF_EXCEPTION(scope, false);
    }
    stores.write(value);
    RETURN_IF_EXCEPTION(scope, false);
    if (earlier.beneath) {
        didEndExportBeneathMock(globalObject, earlier.above, earlier.ended, earlier.beneath);
        RETURN_IF_EXCEPTION(scope, true);
    }
    return true;
}

__attribute__((minsize)) void restoreExport(JSGlobalObject* globalObject, JSModuleNamespaceObject* moduleNamespace, const Identifier& name, JSObject* owner)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    ExportVariableStores stores { globalObject };
    stores.find(moduleNamespace, name, true);
    RETURN_IF_EXCEPTION(scope, );
    if (!stores.record)
        return;
    stores.takeValueOfModule();
    RETURN_IF_EXCEPTION(scope, );
    unsigned own = stores.storeOf(owner);
    if (own == stores.count)
        return;

    if (!own && !stores.original() && stores.record->inherits<SyntheticModuleRecord>()) {
        // What is beneath is a builtin's lazy export that nothing had read. The builtin makes it now, which runs JavaScript:
        // the stores may be others after it.
        BunString builtinKey = Bun::toString(stores.record->moduleKey().string());
        JSValue builtin = Bun::resolveAndFetchBuiltinModule(defaultGlobalObject(globalObject), &builtinKey);
        RETURN_IF_EXCEPTION(scope, );
        JSValue made;
        if (builtin && builtin.isObject()) {
            made = builtin.getObject()->get(globalObject, stores.localName);
            RETURN_IF_EXCEPTION(scope, );
        }
        stores.load();
        own = stores.storeOf(owner);
        if (own == stores.count)
            return;
        if (made && !stores.original()) {
            stores.table->putDirectIndex(globalObject, stores.base + ExportVariableStores::originalSlot, made);
            RETURN_IF_EXCEPTION(scope, );
        }
    }

    if (own + 1 < stores.count) {
        // A newer store stands over it, so the variable does not show it.
        auto values = stores.removeFromUnder(own);
        RETURN_IF_EXCEPTION(scope, );
        if (values.beneath)
            RELEASE_AND_RETURN(scope, didEndExportBeneathMock(globalObject, values.above, values.ended, values.beneath));
        return;
    }
    JSValue beneath = stores.beneath(own);
    // The variable had no value. It can't go back to having none, because optimized code has dropped the check, and the body of
    // a JS module gives it its own. Until then the value stays in the variable, and is nobody's.
    if (!beneath)
        RELEASE_AND_RETURN(scope, stores.setStore(own, jsNull(), stores.valueAt(own)));

    stores.remove(own);
    RETURN_IF_EXCEPTION(scope, );
    RELEASE_AND_RETURN(scope, stores.write(beneath));
}

__attribute__((minsize)) JSValue exportBeneathOverride(JSGlobalObject* globalObject, JSModuleNamespaceObject* moduleNamespace, const Identifier& name, JSObject* owner, bool& hasStored)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    hasStored = false;
    ExportVariableStores stores { globalObject };
    stores.find(moduleNamespace, name, true);
    RETURN_IF_EXCEPTION(scope, {});
    if (!stores.record)
        return {};
    stores.takeValueOfModule();
    RETURN_IF_EXCEPTION(scope, {});
    unsigned own = stores.storeOf(owner);
    if (own == stores.count)
        return {};
    hasStored = true;
    return stores.beneath(own);
}

}
