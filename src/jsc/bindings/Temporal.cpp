// Temporal value formatting shared by console.log/Bun.inspect, the test
// runner's pretty-format, and util.inspect: each type's default-options spec
// toString() text, built from internal slots, never from user-reachable code.

#include "root.h"
#include "Temporal.h"
#include "headers-handwritten.h"

#include "JavaScriptCore/ISO8601.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/TemporalCoreTypes.h"
#include "JavaScriptCore/TemporalDuration.h"
#include "JavaScriptCore/TemporalEnums.h"
#include "JavaScriptCore/TemporalInstant.h"
#include "JavaScriptCore/TemporalPlainDate.h"
#include "JavaScriptCore/TemporalPlainDateTime.h"
#include "JavaScriptCore/TemporalPlainMonthDay.h"
#include "JavaScriptCore/TemporalPlainTime.h"
#include "JavaScriptCore/TemporalPlainYearMonth.h"
#include "JavaScriptCore/TemporalZonedDateTime.h"
#include <wtf/text/StringBuilder.h>

namespace Bun {

uint8_t temporalObjectType(JSC::JSValue value)
{
    // Every Temporal class is a plain ObjectType cell; anything else short-circuits.
    if (!value.isCell() || value.asCell()->type() != JSC::ObjectType)
        return 0;
    JSC::JSCell* cell = value.asCell();
    if (cell->inherits<JSC::TemporalInstant>())
        return 1;
    if (cell->inherits<JSC::TemporalPlainDateTime>())
        return 2;
    if (cell->inherits<JSC::TemporalPlainDate>())
        return 3;
    if (cell->inherits<JSC::TemporalPlainTime>())
        return 4;
    if (cell->inherits<JSC::TemporalZonedDateTime>())
        return 5;
    if (cell->inherits<JSC::TemporalPlainYearMonth>())
        return 6;
    if (cell->inherits<JSC::TemporalPlainMonthDay>())
        return 7;
    if (cell->inherits<JSC::TemporalDuration>())
        return 8;
    return 0;
}

static ASCIILiteral temporalLabel(uint8_t temporalType)
{
    switch (temporalType) {
    case 1:
        return "Temporal.Instant"_s;
    case 2:
        return "Temporal.PlainDateTime"_s;
    case 3:
        return "Temporal.PlainDate"_s;
    case 4:
        return "Temporal.PlainTime"_s;
    case 5:
        return "Temporal.ZonedDateTime"_s;
    case 6:
        return "Temporal.PlainYearMonth"_s;
    case 7:
        return "Temporal.PlainMonthDay"_s;
    case 8:
        return "Temporal.Duration"_s;
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

// https://tc39.es/proposal-temporal/#sec-temporal-temporalzoneddatetimetostring
// with every option ~auto~; JSC's own implementation is file-static in
// TemporalZonedDateTimePrototype.cpp, so the recipe is replicated here.
static WTF::String zonedDateTimeDisplayString(JSC::JSGlobalObject* globalObject, JSC::TemporalZonedDateTime* zonedDateTime)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto [date, time] = zonedDateTime->getLocalDateTime(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    std::optional<int64_t> offsetOpt = zonedDateTime->getOffsetNanoseconds(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::StringBuilder builder;
    builder.append(JSC::ISO8601::temporalDateTimeToString(date, time, { JSC::Precision::Auto, 0 }));

    // FormatDateTimeUTCOffsetRounded: round the offset to the nearest minute.
    int64_t offsetNs = *offsetOpt;
    int64_t offsetMinutes = offsetNs / 60'000'000'000;
    int64_t remainder = offsetNs % 60'000'000'000;
    if (remainder > 30'000'000'000 || (remainder == 30'000'000'000 && offsetNs > 0))
        offsetMinutes++;
    else if (remainder < -30'000'000'000 || (remainder == -30'000'000'000 && offsetNs < 0))
        offsetMinutes--;
    builder.append(JSC::ISO8601::formatTimeZoneOffsetString(offsetMinutes * 60'000'000'000));

    builder.append('[');
    builder.append(zonedDateTime->timeZoneId());
    builder.append(']');

    if (!JSC::TemporalCore::calendarIsISO(zonedDateTime->calendarID())) {
        builder.append("[u-ca="_s);
        builder.append(zonedDateTime->calendarId());
        builder.append(']');
    }
    return builder.toString();
}

// `temporalType` is the non-zero `temporalObjectType(cell)`.
static WTF::String temporalDisplayString(JSC::JSGlobalObject* globalObject, JSC::JSCell* cell, uint8_t temporalType)
{
    switch (temporalType) {
    case 1:
        return uncheckedDowncast<JSC::TemporalInstant>(cell)->toString();
    case 2:
        return uncheckedDowncast<JSC::TemporalPlainDateTime>(cell)->toString();
    case 3:
        return uncheckedDowncast<JSC::TemporalPlainDate>(cell)->toString();
    case 4:
        return uncheckedDowncast<JSC::TemporalPlainTime>(cell)->toString();
    case 5:
        return zonedDateTimeDisplayString(globalObject, uncheckedDowncast<JSC::TemporalZonedDateTime>(cell));
    case 6:
        return uncheckedDowncast<JSC::TemporalPlainYearMonth>(cell)->toString();
    case 7:
        return uncheckedDowncast<JSC::TemporalPlainMonthDay>(cell)->toString();
    case 8:
        return uncheckedDowncast<JSC::TemporalDuration>(cell)->toString(globalObject);
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
}

} // namespace Bun

extern "C" [[ZIG_EXPORT(nothrow)]] uint8_t Bun__JSValue__temporalObjectType(JSC::EncodedJSValue encodedValue)
{
    return Bun::temporalObjectType(JSC::JSValue::decode(encodedValue));
}

// Precondition: Bun::temporalObjectType(value) != 0. Writes e.g. ("Temporal.PlainDate", "2020-01-02").
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__Temporal__toDisplayString(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, BunString* label, BunString* text)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    uint8_t temporalType = Bun::temporalObjectType(value);
    WTF::String string = Bun::temporalDisplayString(globalObject, value.asCell(), temporalType);
    RETURN_IF_EXCEPTION(scope, );
    *label = Bun::toStringView(Bun::temporalLabel(temporalType));
    *text = Bun::toStringRef(string);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTemporalLabel, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    uint8_t temporalType = Bun::temporalObjectType(callFrame->argument(0));
    if (!temporalType)
        return JSC::JSValue::encode(JSC::jsUndefined());
    return JSC::JSValue::encode(JSC::jsNontrivialString(JSC::getVM(globalObject), Bun::temporalLabel(temporalType)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTemporalToDisplayString, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue value = callFrame->argument(0);
    uint8_t temporalType = Bun::temporalObjectType(value);
    if (!temporalType)
        return JSC::JSValue::encode(JSC::jsUndefined());

    WTF::String result = Bun::temporalDisplayString(globalObject, value.asCell(), temporalType);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsString(vm, WTF::move(result)));
}
