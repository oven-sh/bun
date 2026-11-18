/// The constructor of the object to throw.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ErrorKind {
    Range,
    Type,
}

pub type Result<T, E = Error> = core::result::Result<T, E>;

macro_rules! errors {
    ($($kind:ident { $($name:ident = $message:literal,)* })*) => {
        /// A failure whose message does not depend on the input.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum Error {
            $($($name,)*)*
        }

        impl Error {
            pub const fn kind(self) -> ErrorKind {
                match self {
                    $($(Error::$name)|* => ErrorKind::$kind,)*
                }
            }

            pub const fn message(self) -> &'static str {
                match self {
                    $($(Error::$name => $message,)*)*
                }
            }
        }
    };
}

errors! {
    Range {
        InvalidCalendarName = r#"calendarName must be "auto", "always", "never", or "critical""#,
        InvalidDirection = r#"direction must be "next" or "previous""#,
        InvalidDisambiguation = r#"disambiguation must be one of "compatible", "earlier", "later", or "reject""#,
        InvalidOffsetOption = r#"offset must be one of "use", "prefer", "ignore", or "reject""#,
        InvalidOverflow = r#"overflow must be either "constrain" or "reject""#,
        InvalidRoundingMode = r#"roundingMode must be "ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", or "halfEven""#,
        InvalidShowOffset = r#"offset must be "auto" or "never""#,
        InvalidTimeZoneName = r#"timeZoneName must be "auto", "never", or "critical""#,
        MissingDirectionOption = "Temporal.ZonedDateTime.prototype.getTimeZoneTransition requires a 'direction' option",

        InvalidUnit = "invalid Temporal unit",
        InvalidSmallestUnit = "smallestUnit is an invalid Temporal unit",
        InvalidTotalUnit = "unit is an invalid Temporal unit",
        MissingSmallestUnit = "'smallestUnit' option is required",
        MissingRoundingUnit = "Cannot round without a smallestUnit or largestUnit option",
        SmallestUnitIsAuto = r#"smallestUnit cannot be "auto""#,
        DisallowedLargestUnit = "largestUnit is a disallowed unit",
        DisallowedSmallestUnit = "smallestUnit is a disallowed unit",
        LargestUnitBelowMonth = "largestUnit must be one of year, years, month, months",
        SmallestUnitBelowMonth = "smallestUnit must be one of year, years, month, months",
        SmallestUnitAboveLargest = "smallestUnit must be smaller than largestUnit",
        SmallestUnitAboveSecond = r#"smallestUnit must not be "minute" or larger"#,
        HourInInstantText = r#"smallestUnit cannot be "hour" for Instant.toString"#,
        HourInPlainDateTimeText = r#"smallestUnit cannot be "hour" for PlainDateTime.toString"#,
        HourInPlainTimeText = r#"smallestUnit cannot be "hour" for PlainTime.toString"#,
        HourInZonedDateTimeText = r#"smallestUnit cannot be "hour" for ZonedDateTime.toString"#,

        IncrementIsNaN = "roundingIncrement is NaN",
        IncrementNotFinite = "roundingIncrement must be a finite integer",
        IncrementOutOfRange = "roundingIncrement must be in the range 1 to 10^9 inclusive",
        IncrementAboveMaximum = "rounding increment is out of range",
        IncrementDoesNotDivide = "roundingIncrement does not divide evenly",
        IncrementWithBalancing = "Incompatible rounding increment and largest/smallest units",

        InvalidDateText = "invalid date string",
        InvalidTimeText = "invalid time string",
        InvalidMonthCode = "Invalid monthCode",
        InvalidCalendarArgument = "invalid calendar ID",

        PlainDateYearNotFinite = "Temporal.PlainDate year property must be finite",
        PlainDateMonthNotFinite = "Temporal.PlainDate month property must be finite",
        PlainDateDayNotFinite = "Temporal.PlainDate day property must be finite",
        PlainDateTimeArgumentNotFinite = "Temporal.PlainDateTime properties must be finite",
        PlainMonthDayMonthNotFinite = "Temporal.PlainMonthDay month property must be finite",
        PlainMonthDayDayNotFinite = "Temporal.PlainMonthDay day property must be finite",
        PlainMonthDayYearNotFinite = "Temporal.PlainMonthDay reference year must be finite",
        PlainTimeArgumentIsNaN = "Temporal.PlainTime argument must not be NaN",
        PlainTimeArgumentNotFinite = "Temporal.PlainTime properties must be finite",
        PlainYearMonthYearNotFinite = "Temporal.PlainYearMonth year property must be finite",
        PlainYearMonthMonthNotFinite = "Temporal.PlainYearMonth month property must be finite",
        PlainYearMonthDayNotFinite = "Temporal.PlainYearMonth reference day must be finite",

        DayNotPositive = "day must be positive and finite",
        DayPropertyNotFinite = "day property must be finite",
        DayPropertyNotPositive = "day property must be positive and finite",
        DayPropertyBelowOne = "day property must be a positive integer",
        EraYearNotFinite = "eraYear must be finite",
        EraYearPropertyNotFinite = "eraYear property must be finite",
        MonthNotPositive = "month must be positive and finite",
        MonthPropertyNotPositive = "month property must be a positive finite integer",
        TimeFieldNotFinite = "Temporal time properties must be finite",
        YearNotFinite = "year must be finite",
        YearPropertyNotFinite = "year property must be finite",

        YearOutOfRange = "year is out of range",
        MonthOutOfRange = "month is out of range",
        DayOutOfRange = "day is out of range",
        HourOutOfRange = "hour is out of range",
        MinuteOutOfRange = "minute is out of range",
        SecondOutOfRange = "second is out of range",
        MillisecondOutOfRange = "millisecond is out of range",
        MicrosecondOutOfRange = "microsecond is out of range",
        NanosecondOutOfRange = "nanosecond is out of range",

        DateTimeOutOfRange = "date time is out of range of ECMAScript representation",
        DateAndTimeOutOfRange = "date-time combination is outside the valid range",
        DifferenceEndOutOfRange = "date-time is outside the representable range for Temporal",
        RoundedDateTimeOutOfRange = "Rounding result is outside the representable range",
        InvalidPlainYearMonth = "Temporal.PlainYearMonth: not a valid ISO date",
        PlainYearMonthOutOfRange = "PlainYearMonth is out of range of ECMAScript representation",
        YearMonthStartOutOfRange = "date is outside the representable range for Temporal",
        YearMonthDifferenceOutOfRange = "date/time value is outside of supported range",
        PlainMonthDayOutOfRange = "PlainMonthDay: date out of range of ECMAScript representation",
        MonthDayTextOutOfRange = "Date is not within ISO date time limits",

        CalendarDataUnavailable = "Failed to read calendar fields from ICU",
        DateFieldsOutOfRange = "Date is not within representable range",
        YearMonthFieldsOutOfRange = "YearMonth is not within representable range",
        EraYearOutOfRange = "eraYear is not within representable range",
        CalendarDateOutOfRange = "Resolved calendar date is outside representable range",
        CalendarSumOutOfRange = "Result of calendar date addition is outside representable range",
        CalendarDurationOutOfRange = "duration is out of the representable range",
        InvalidEra = "era is not valid for this calendar",
        YearContradictsEra = "year is inconsistent with era and eraYear",
        MonthContradictsMonthCode = "month does not match monthCode",
        LeapMonthInIsoCalendar = "iso8601 calendar does not have leap months",
        MonthCodeNotInIsoCalendar = "month must be 1-12 for iso8601 calendar",
        MonthCodeNotInCalendar = "monthCode is not valid for this calendar",
        MonthCodeNotInYear = "monthCode does not exist in this calendar year",
        MonthCodeNotInTargetYear = "month code does not exist in the target year (overflow: reject)",
        MonthNotInCalendar = "month is out of range for this calendar",
        MonthNotInYear = "month is out of range for this calendar year",
        DayNotInMonth = "Day is out of range for the given month",
        DayNotInCalendarMonth = "Day is out of range for the given month in this calendar",
        DayNotInTargetMonth = "day is out of range for the resulting month (overflow: reject)",
        LeapMonthWithoutReferenceYear = "This leap month does not exist in this calendar near the reference year",
        DatesInDifferentCalendars = "cannot compute difference between dates with different calendars",
        DateTimesInDifferentCalendars = "cannot compute difference between date-times with different calendars",
        YearMonthsInDifferentCalendars = "cannot compute difference between year-months with different calendars",
        ZonedDateTimesInDifferentCalendars = "cannot compute difference between ZonedDateTimes with different calendars",

        DurationFieldNotInteger = "Temporal.Duration properties must be integers",
        InvalidDuration = "Temporal.Duration properties must be finite and of consistent sign",
        DurationOutOfRange = "Duration is outside the representable range",
        DurationSumOutOfRange = "Sum of durations exceeds maximum time duration",
        RoundedTimeOutOfRange = "Rounded time duration exceeds maximum",
        TotalTimeOutOfRange = "Total time in duration is out of range",
        AddingCalendarUnits = "Cannot add or subtract durations with calendar units (years, months, or weeks)",
        ComparingCalendarUnits = "Cannot compare a duration of years, months, or weeks without a relativeTo option",
        RoundingCalendarUnits = "Cannot round a duration of years, months, or weeks without a relativeTo option",
        TotalOfCalendarUnits = "Cannot total a duration of years, months, or weeks without a relativeTo option",
        UnitsBelowMonth = "Duration must not have units below months for PlainYearMonth arithmetic",

        AddingYearsToInstant = "Adding years not supported by Temporal.Instant. Try Temporal.ZonedDateTime instead",
        AddingMonthsToInstant = "Adding months not supported by Temporal.Instant. Try Temporal.ZonedDateTime instead",
        AddingWeeksToInstant = "Adding weeks not supported by Temporal.Instant. Try Temporal.ZonedDateTime instead",
        AddingDaysToInstant = "Adding days not supported by Temporal.Instant. Try Temporal.ZonedDateTime instead",
        InstantSumOutOfRange = "Addition is outside of supported range for Temporal.Instant",
        InstantRemainderOutOfRange = "Subtraction is outside of supported range for Temporal.Instant",

        LocalTimeOutOfRange = "Epoch nanoseconds out of valid Temporal range",
        LocalTimeRepeated = "ambiguous instant: use a 'disambiguation' option to resolve",
        LocalTimeSkipped = "nonexistent instant: local time does not exist in this time zone (DST gap)",
        OffsetContradictsTimeZone = "offset does not agree with timezone for the given date/time",
        OffsetDateTimeOutOfRange = "date/time offset combination is outside the supported range for Temporal.ZonedDateTime",
        WallClockDateOutOfRange = "wall-clock date is outside the representable range for Temporal.ZonedDateTime",
        NoStartOfDay = "no start of day: time zone has no future transitions",
        IntermediateDateTimeOutOfRange = "intermediate datetime out of range",
        ZonedSumOutOfRange = "Duration addition results in an out-of-range ZonedDateTime",
        RoundedZonedOutOfRange = "Rounding result is outside the supported range of Temporal.ZonedDateTime",
        RoundingAcrossSkippedDay = "cannot round relative to a time zone transition that skips an entire day",
        DifferentTimeZones = "cannot compute day-or-larger difference between ZonedDateTimes with different time zones",
    }

    Type {
        NotConvertibleToDuration = "can only convert to Duration from object or string values",
        NotConvertibleToInstant = "can only convert to Instant from object or string values",
        NotConvertibleToPlainDate = "can only convert to PlainDate from object or string values",
        NotConvertibleToPlainDateTime = "can only convert to PlainDateTime from object or string values",
        NotConvertibleToPlainMonthDay = "can only convert to PlainMonthDay from object or string values",
        NotConvertibleToPlainTime = "can only convert to PlainTime from object or string values",
        NotConvertibleToPlainYearMonth = "can only convert to PlainYearMonth from object or string values",
        NotConvertibleToZonedDateTime = "Temporal.ZonedDateTime.from: argument must be a ZonedDateTime, string, or object",
        NotConvertibleToCalendar = "calendar must be a string or Temporal object",
        NotConvertibleToTimeZone = "time zone must be a string or ZonedDateTime",
        NotConvertibleToRelativeTo = "relativeTo must be a string or Temporal object",

        DurationValueOf = "Temporal.Duration.prototype.valueOf must not be called. To compare Duration values, use Temporal.Duration.compare",
        InstantValueOf = "Temporal.Instant.prototype.valueOf must not be called. To compare Instant values, use Temporal.Instant.compare",
        PlainDateValueOf = "Temporal.PlainDate.prototype.valueOf must not be called. To compare PlainDate values, use Temporal.PlainDate.compare",
        PlainDateTimeValueOf = "Temporal.PlainDateTime.prototype.valueOf must not be called. To compare PlainDateTime values, use Temporal.PlainDateTime.compare",
        PlainMonthDayValueOf = "Temporal.PlainMonthDay.prototype.valueOf must not be called. To compare PlainMonthDay values, use Temporal.PlainDate.compare on the corresponding PlainDate objects.",
        PlainTimeValueOf = "Temporal.PlainTime.prototype.valueOf must not be called. To compare PlainTime values, use Temporal.PlainTime.compare",
        PlainYearMonthValueOf = "Temporal.PlainYearMonth.prototype.valueOf must not be called. To compare PlainYearMonth values, use Temporal.PlainYearMonth.compare",
        ZonedDateTimeValueOf = "Temporal.ZonedDateTime.prototype.valueOf must not be called. To compare ZonedDateTime values, use Temporal.ZonedDateTime.compare",

        OptionsNotObjectOrUndefined = "options argument is not an object or undefined",
        OptionsNotObject = "options must be an object",
        ZonedOptionsNotObject = "Temporal.ZonedDateTime.from: options must be an object",
        DurationRoundWithoutOptions = "Temporal.Duration.prototype.round requires an options argument",
        DurationTotalWithoutOptions = "Temporal.Duration.prototype.total requires an options argument",
        InstantRoundWithoutOptions = "Temporal.Instant.prototype.round requires a roundTo option",
        PlainDateTimeRoundWithoutOptions = "Temporal.PlainDateTime.prototype.round requires a roundTo option",
        PlainTimeRoundWithoutOptions = "Temporal.PlainTime.prototype.round requires an options argument",
        ZonedRoundWithoutOptions = "Temporal.ZonedDateTime.prototype.round requires a smallestUnit option string or options object",
        MissingDirectionArgument = "Temporal.ZonedDateTime.prototype.getTimeZoneTransition requires a 'direction' option",
        DirectionNotObjectOrString = "Temporal.ZonedDateTime.prototype.getTimeZoneTransition requires an options object or string",

        DurationWithNotObject = "First argument to Temporal.Duration.prototype.with must be an object",
        PlainTimeWithNotObject = "First argument to Temporal.PlainTime.prototype.with must be an object",
        PlainTimeWithNotPartial = "argument must be a partial Temporal object",
        PlainDateWithNotPartial = "First argument to Temporal.PlainDate.prototype.with must be a partial Temporal object",
        PlainDateTimeWithNotPartial = "First argument to Temporal.PlainDateTime.prototype.with must be a partial Temporal object",
        PlainMonthDayWithNotPartial = "First argument to Temporal.PlainMonthDay.prototype.with must be a partial Temporal object",
        PlainYearMonthWithNotPartial = "First argument to Temporal.PlainYearMonth.prototype.with must be a partial Temporal object",
        ZonedWithNotPartial = "Temporal.ZonedDateTime.prototype.with requires a partial Temporal object of field overrides",
        MonthDayItemNotObject = "Temporal.PlainMonthDay.prototype.toPlainDate: item is not an object",
        YearMonthItemNotObject = "Temporal.PlainYearMonth.prototype.toPlainDate: item is not an object",

        CalendarIdNotString = "calendarId must be a string",
        MonthDayCalendarNotString = "calendar must be a string",
        ZonedCalendarNotString = "Temporal.ZonedDateTime calendar must be a string",
        ZonedTimeZoneNotString = "Temporal.ZonedDateTime timeZoneIdentifier must be a string",
        MonthCodeNotString = "monthCode must be a string",
        OffsetNotString = "offset must be a string",

        NoDateFields = "Object must contain at least one Temporal date property",
        NoDateTimeFields = "at least one field must be provided",
        NoDurationFields = "Object must contain at least one Temporal.Duration property",
        NoTimeFields = "Object must contain at least one Temporal time property",
        NoZonedFields = "at least one Temporal field must be provided",
        MissingYear = "year property must be present",
        MissingMonth = "month or monthCode property must be present",
        MissingDay = "day property must be present",
        MissingTimeZone = "Temporal.ZonedDateTime.from: timeZone property is required",
        EraWithoutEraYear = "era and eraYear must both be present or both absent",
        MonthDayItemWithoutYear = "Temporal.PlainMonthDay.prototype.toPlainDate: item does not have a year or era/eraYear field",
        YearMonthItemWithoutDay = "Temporal.PlainYearMonth.prototype.toPlainDate: item does not have a day field",
    }
}
