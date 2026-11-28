#pragma once

#include <JavaScriptCore/DecimalObject.h>
#include <JavaScriptCore/DecimalPrototype.h>

// A Decimal is a plain ObjectType with its value in an internal slot, so whatever walks properties takes it for {}.

namespace Bun {

inline bool isDecimal(JSC::JSValue value)
{
    return JSC::DecimalObject::tryCast(value);
}

inline bool isPrototypeOfDecimal(JSC::JSObject* object)
{
    return object->inherits<JSC::DecimalPrototype>();
}

// Both have to be Decimals. NaN is itself, and 0 and -0 differ.
inline bool isSameDecimal(JSC::JSValue a, JSC::JSValue b)
{
    return JSC::DecimalObject::tryCast(a)->value().isSameValueAs(JSC::DecimalObject::tryCast(b)->value());
}

// What toString() is, whatever the program made of it. Has to be a Decimal.
inline WTF::String textOfDecimal(JSC::JSValue value)
{
    return JSC::DecimalObject::tryCast(value)->value().toString();
}

// What Number() of it is. Has to be a Decimal.
inline double numberOfDecimal(JSC::JSValue value)
{
    return JSC::DecimalObject::tryCast(value)->toNumberValue();
}

// False if one of them is a Decimal and the other is not the same one. Own properties are not looked at.
inline bool decimalsDequal(JSC::JSValue a, JSC::JSValue b)
{
    bool isDecimalA = isDecimal(a);
    bool isDecimalB = isDecimal(b);
    if (!isDecimalA && !isDecimalB) [[likely]]
        return true;
    return isDecimalA && isDecimalB && isSameDecimal(a, b);
}

} // namespace Bun
