// Shared formatting for Temporal values in console.log/Bun.inspect
// (ConsoleObject.rs), the test runner's pretty-format (pretty_format.rs), and
// util.inspect (internal/util/inspect.js, via the host functions at the
// bottom). The text matches each type's spec `toString()` with default
// options, built from internal slots so tampered prototypes can't change or
// observe inspection.

#include "root.h"
#include "Temporal.h"

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

// https://tc39.es/proposal-temporal/#sec-temporal-temporalzoneddatetimetostring
// with precision/showOffset/showTimeZone/showCalendar all ~auto~, mirroring
// `temporalZonedDateTimeToString` (file-static in
// TemporalZonedDateTimePrototype.cpp, so it cannot be called directly).
static WTF::String zonedDateTimeDisplayString(JSC::JSGlobalObject* globalObject, JSC::TemporalZonedDateTime* zonedDateTime)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto [date, time] = zonedDateTime->getLocalDateTime(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    std::optional<int64_t> offsetOpt = zonedDateTime->getOffsetNanoseconds(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(offsetOpt);

    WTF::StringBuilder builder;
    builder.append(JSC::ISO8601::temporalDateTimeToString(date, time, { JSC::Precision::Auto, 0 }));

    // FormatDateTimeUTCOffsetRounded: round the offset to the nearest minute.
    int64_t offsetNs = offsetOpt.value_or(0);
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

WTF::String temporalDisplayString(JSC::JSGlobalObject* globalObject, JSC::JSCell* cell, uint8_t temporalType)
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionTemporalObjectType, (JSC::JSGlobalObject*, JSC::CallFrame* callFrame))
{
    return JSC::JSValue::encode(JSC::jsNumber(Bun__JSValue__temporalObjectType(JSC::JSValue::encode(callFrame->argument(0)))));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTemporalToDisplayString, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue value = callFrame->argument(0);
    uint8_t temporalType = Bun__JSValue__temporalObjectType(JSC::JSValue::encode(value));
    if (!temporalType)
        return JSC::JSValue::encode(JSC::jsUndefined());

    WTF::String result = Bun::temporalDisplayString(globalObject, value.asCell(), temporalType);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsString(vm, WTF::move(result)));
}
