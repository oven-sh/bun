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

TemporalType temporalObjectType(JSC::JSValue value)
{
    // Every Temporal class is a plain ObjectType cell; anything else short-circuits.
    if (!value.isCell() || value.asCell()->type() != JSC::ObjectType)
        return TemporalType::None;
    JSC::JSCell* cell = value.asCell();
    if (cell->inherits<JSC::TemporalInstant>())
        return TemporalType::Instant;
    if (cell->inherits<JSC::TemporalPlainDateTime>())
        return TemporalType::PlainDateTime;
    if (cell->inherits<JSC::TemporalPlainDate>())
        return TemporalType::PlainDate;
    if (cell->inherits<JSC::TemporalPlainTime>())
        return TemporalType::PlainTime;
    if (cell->inherits<JSC::TemporalZonedDateTime>())
        return TemporalType::ZonedDateTime;
    if (cell->inherits<JSC::TemporalPlainYearMonth>())
        return TemporalType::PlainYearMonth;
    if (cell->inherits<JSC::TemporalPlainMonthDay>())
        return TemporalType::PlainMonthDay;
    if (cell->inherits<JSC::TemporalDuration>())
        return TemporalType::Duration;
    return TemporalType::None;
}

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
        return zonedDateTimeDisplayString(globalObject, uncheckedDowncast<JSC::TemporalZonedDateTime>(cell));
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

extern "C" [[ZIG_EXPORT(nothrow)]] Bun::TemporalType Bun__JSValue__temporalObjectType(JSC::EncodedJSValue encodedValue)
{
    return Bun::temporalObjectType(JSC::JSValue::decode(encodedValue));
}

// Precondition: value is Temporal. Writes e.g. ("Temporal.PlainDate", "2020-01-02").
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__Temporal__toDisplayString(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, BunString* label, BunString* text)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    Bun::TemporalType type = Bun::temporalObjectType(value);
    WTF::String string = Bun::temporalDisplayString(globalObject, value.asCell(), type);
    RETURN_IF_EXCEPTION(scope, );
    *label = Bun::toStringView(Bun::temporalLabel(type));
    *text = Bun::toStringRef(string);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTemporalLabel, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    Bun::TemporalType type = Bun::temporalObjectType(callFrame->argument(0));
    if (type == Bun::TemporalType::None)
        return JSC::JSValue::encode(JSC::jsUndefined());
    return JSC::JSValue::encode(JSC::jsNontrivialString(JSC::getVM(globalObject), Bun::temporalLabel(type)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTemporalToDisplayString, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue value = callFrame->argument(0);
    Bun::TemporalType type = Bun::temporalObjectType(value);
    if (type == Bun::TemporalType::None)
        return JSC::JSValue::encode(JSC::jsUndefined());

    WTF::String result = Bun::temporalDisplayString(globalObject, value.asCell(), type);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsString(vm, WTF::move(result)));
}
