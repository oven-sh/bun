// Temporal value formatting shared by console.log/Bun.inspect, the test
// runner's pretty-format, and util.inspect: each type's default-options spec
// toString() text, built from internal slots, never from user-reachable code.

#include "root.h"
#include "Temporal.h"
#include "headers-handwritten.h"

#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/TemporalDuration.h"
#include "JavaScriptCore/TemporalInstant.h"
#include "JavaScriptCore/TemporalObject.h"
#include "JavaScriptCore/TemporalPlainDate.h"
#include "JavaScriptCore/TemporalPlainDateTime.h"
#include "JavaScriptCore/TemporalPlainMonthDay.h"
#include "JavaScriptCore/TemporalPlainTime.h"
#include "JavaScriptCore/TemporalPlainYearMonth.h"
#include "JavaScriptCore/TemporalZonedDateTime.h"

namespace Bun {

using JSC::TemporalType;

static ASCIILiteral temporalLabel(TemporalType type)
{
    switch (type) {
    case TemporalType::Instant:
        return "Temporal.Instant"_s;
    case TemporalType::PlainDateTime:
        return "Temporal.PlainDateTime"_s;
    case TemporalType::PlainDate:
        return "Temporal.PlainDate"_s;
    case TemporalType::PlainTime:
        return "Temporal.PlainTime"_s;
    case TemporalType::ZonedDateTime:
        return "Temporal.ZonedDateTime"_s;
    case TemporalType::PlainYearMonth:
        return "Temporal.PlainYearMonth"_s;
    case TemporalType::PlainMonthDay:
        return "Temporal.PlainMonthDay"_s;
    case TemporalType::Duration:
        return "Temporal.Duration"_s;
    case TemporalType::None:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

static WTF::String temporalDisplayString(JSC::JSGlobalObject* globalObject, JSC::JSCell* cell, TemporalType type)
{
    switch (type) {
    case TemporalType::Instant:
        return uncheckedDowncast<JSC::TemporalInstant>(cell)->toString();
    case TemporalType::PlainDateTime:
        return uncheckedDowncast<JSC::TemporalPlainDateTime>(cell)->toString();
    case TemporalType::PlainDate:
        return uncheckedDowncast<JSC::TemporalPlainDate>(cell)->toString();
    case TemporalType::PlainTime:
        return uncheckedDowncast<JSC::TemporalPlainTime>(cell)->toString();
    case TemporalType::ZonedDateTime:
        return uncheckedDowncast<JSC::TemporalZonedDateTime>(cell)->toString(globalObject);
    case TemporalType::PlainYearMonth:
        return uncheckedDowncast<JSC::TemporalPlainYearMonth>(cell)->toString();
    case TemporalType::PlainMonthDay:
        return uncheckedDowncast<JSC::TemporalPlainMonthDay>(cell)->toString();
    case TemporalType::Duration:
        return uncheckedDowncast<JSC::TemporalDuration>(cell)->toString(globalObject);
    case TemporalType::None:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

} // namespace Bun

extern "C" [[ZIG_EXPORT(nothrow)]] JSC::TemporalType Bun__JSValue__temporalType(JSC::EncodedJSValue encodedValue)
{
    return JSC::temporalType(JSC::JSValue::decode(encodedValue));
}

// Precondition: value is Temporal. Writes e.g. ("Temporal.PlainDate", "2020-01-02").
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__Temporal__toDisplayString(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, BunString* label, BunString* text)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    JSC::TemporalType type = JSC::temporalType(value);
    WTF::String string = Bun::temporalDisplayString(globalObject, value.asCell(), type);
    RETURN_IF_EXCEPTION(scope, );
    *label = Bun::toStringView(Bun::temporalLabel(type));
    *text = Bun::toStringRef(string);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTemporalLabel, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::TemporalType type = JSC::temporalType(callFrame->argument(0));
    if (type == JSC::TemporalType::None)
        return JSC::JSValue::encode(JSC::jsUndefined());
    return JSC::JSValue::encode(JSC::jsNontrivialString(JSC::getVM(globalObject), Bun::temporalLabel(type)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTemporalToDisplayString, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue value = callFrame->argument(0);
    JSC::TemporalType type = JSC::temporalType(value);
    if (type == JSC::TemporalType::None)
        return JSC::JSValue::encode(JSC::jsUndefined());

    WTF::String result = Bun::temporalDisplayString(globalObject, value.asCell(), type);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsString(vm, WTF::move(result)));
}
