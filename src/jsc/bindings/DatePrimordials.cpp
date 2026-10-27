#include "root.h"

#include "DatePrimordials.h"

#include <JavaScriptCore/DateConstructor.h>
#include <JavaScriptCore/DatePrototype.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/Lookup.h>

namespace Bun {

using namespace JSC;

// The arguments are those of reifyStaticProperty() in Lookup.h, so the copy has the native code and the intrinsic of the property.
static JSFunction* createDateFunctionFromStaticTable(JSGlobalObject* globalObject, const ClassInfo* info, ASCIILiteral name)
{
    auto& vm = getVM(globalObject);
    const HashTable* table = info->staticPropHashTable;
    RELEASE_ASSERT(table);
    const HashTableValue* entry = table->entry(Identifier::fromString(vm, name));
    RELEASE_ASSERT(entry);
    unsigned attributes = entry->attributes();
    RELEASE_ASSERT(attributes & PropertyAttribute::Function);
    RELEASE_ASSERT(!(attributes & PropertyAttribute::Builtin) && !(attributes & PropertyAttribute::DOMJITFunction));
    return JSFunction::create(vm, globalObject, entry->functionLength(), name, entry->function(), ImplementationVisibility::Public, entry->intrinsic());
}

JSValue createDateNow(JSGlobalObject* globalObject)
{
    return createDateFunctionFromStaticTable(globalObject, DateConstructor::info(), "now"_s);
}

JSValue createDatePrototypeGetTime(JSGlobalObject* globalObject)
{
    return createDateFunctionFromStaticTable(globalObject, DatePrototype::info(), "getTime"_s);
}

JSValue createDatePrototypeToISOString(JSGlobalObject* globalObject)
{
    return createDateFunctionFromStaticTable(globalObject, DatePrototype::info(), "toISOString"_s);
}

JSValue createDatePrototypeToString(JSGlobalObject* globalObject)
{
    return createDateFunctionFromStaticTable(globalObject, DatePrototype::info(), "toString"_s);
}

} // namespace Bun
