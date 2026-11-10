#pragma once

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>

// Decimal of https://tc39.es/proposal-decimal/. It is off unless BUN_JSC_useDecimal=1.
//
// A Decimal is a plain ObjectType without own properties and with its value in an internal slot, so whatever walks
// properties takes it for {}. A WebKit without Decimal has no header for it, and then nothing is one.
#if __has_include(<JavaScriptCore/DecimalObject.h>)
#define BUN_HAS_DECIMAL 1
#include <JavaScriptCore/DecimalObject.h>
#include <JavaScriptCore/DecimalPrototype.h>
#else
#define BUN_HAS_DECIMAL 0
#endif

namespace Bun {

#if BUN_HAS_DECIMAL

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

inline bool decimalIsWrittenAsString()
{
    return JSC::Options::useDecimalToJSON();
}

// For structured clone. The latter is null if the text is not that of a Decimal, or Decimal is off.
inline WTF::String cloneTextOfDecimal(JSC::JSValue value)
{
    return JSC::DecimalObject::tryCast(value)->textForClone();
}

inline JSC::JSObject* tryCreateDecimal(JSC::JSGlobalObject* globalObject, WTF::StringView cloneText)
{
    return JSC::DecimalObject::tryCreateFromCloneText(globalObject, cloneText);
}

#else

inline bool isDecimal(JSC::JSValue) { return false; }
inline bool isPrototypeOfDecimal(JSC::JSObject*) { return false; }
inline bool isSameDecimal(JSC::JSValue, JSC::JSValue) { return false; }
inline WTF::String textOfDecimal(JSC::JSValue) { return {}; }
inline double numberOfDecimal(JSC::JSValue) { return 0; }
inline bool decimalIsWrittenAsString() { return false; }
inline WTF::String cloneTextOfDecimal(JSC::JSValue) { return {}; }
inline JSC::JSObject* tryCreateDecimal(JSC::JSGlobalObject*, WTF::StringView) { return nullptr; }

#endif

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
