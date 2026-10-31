#pragma once

#include "root.h"
#include "JavaScriptCore/BooleanPrototype.h"
#include "JavaScriptCore/NumberPrototype.h"

namespace Bun {

// String.prototype, Number.prototype or Boolean.prototype of any realm. JSC makes them boxed values of "", 0 and false.
ALWAYS_INLINE bool isStringNumberOrBooleanPrototype(JSC::JSCell* cell)
{
    // Each of the three has a static property table, and few printed objects do: most values pay for this test only.
    if (!JSC::TypeInfo::hasStaticPropertyTable(cell->inlineTypeFlags()))
        return false;
    switch (cell->type()) {
    case JSC::DerivedStringObjectType:
        return true;
    case JSC::NumberObjectType:
        return cell->classInfo() == JSC::NumberPrototype::info();
    case JSC::BooleanObjectType:
        return cell->classInfo() == JSC::BooleanPrototype::info();
    default:
        return false;
    }
}

ALWAYS_INLINE bool isStringNumberOrBooleanPrototype(JSC::JSValue value)
{
    return value.isCell() && isStringNumberOrBooleanPrototype(value.asCell());
}

JSC::Structure* createUtilInspectOptionsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

// internalBinding('util').getOwnNonIndexProperties(object, filter)
JSC_DECLARE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties);

}
