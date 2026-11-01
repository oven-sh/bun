// Intl.DateTimeFormat and Intl.NumberFormat with a constant locale and constant options format from a pattern computed at build time. Every result is compared with a formatter whose options are not constants, which goes through ICU.
// IR+ ^variable (g\d+) name="minute" [\s\S]* (v\d+): \S+ = NewFormatterWithPattern [\s\S]*? = PutModuleVariable \2 variable=\1\b
// IR+ ^variable (g\d+) name="localTime" [\s\S]* (v\d+): \S+ = NewFormatterWithPattern [\s\S]*? = PutModuleVariable \2 variable=\1\b
// IR+ ^variable (g\d+) name="count" [\s\S]* (v\d+): \S+ = NewFormatterWithPattern [\s\S]*? = PutModuleVariable \2 variable=\1\b
// IR- ^variable (g\d+) name="buddhist" [\s\S]* (v\d+): \S+ = NewFormatterWithPattern [\s\S]*? = PutModuleVariable \2 variable=\1\b
// IR- ^variable (g\d+) name="compact" [\s\S]* (v\d+): \S+ = NewFormatterWithPattern [\s\S]*? = PutModuleVariable \2 variable=\1\b
// IRT= 1 formatMinute CallBuiltin v[0-9]+ \(v[0-9]+\) overload=IntlDateTimeFormatPrototypeFormat/
// IR= 1 formatCount CallBuiltin v[0-9]+ \(v[0-9]+\) overload=IntlNumberFormatPrototypeFormat/
// IRT= 1 formatLocalTime CallBuiltin v[0-9]+ \(v[0-9]+\) overload=IntlDateTimeFormatPrototypeFormat/
// IR= 1 formatRow CallBuiltin v[0-9]+ \(v[0-9]+\) overload=IntlDateTimeFormatPrototypeFormat/
// IR= 1 formatRow CallBuiltin v[0-9]+ \(v[0-9]+\) overload=IntlNumberFormatPrototypeFormat/
// IR= 1 formatNewDate CallBuiltin v[0-9]+ \(v[0-9]+\) overload=IntlDateTimeFormatPrototypeFormat/
function notConstant<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
const say = (run: () => unknown): string => {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).name;
  }
};

const minute = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const buddhist = new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: "UTC" });
const localTime = new Intl.DateTimeFormat("en-US", { dateStyle: "short" });
const count = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact" });
export function formatMinute(date: Date): string {
  return minute.format(date);
}
export function formatBuddhist(date: Date): string {
  return buddhist.format(date);
}
export function formatLocalTime(date: Date): string {
  return localTime.format(date);
}
export function formatCount(n: number): string {
  return count.format(n);
}
export function formatCompact(n: number): string {
  return compact.format(n);
}

const d1 = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const d2 = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "medium", timeZone: "UTC" });
const d3 = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeZone: "UTC" });
const d4 = new Intl.DateTimeFormat("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const d5 = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const d6 = new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "UTC" });
const d7 = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const d8 = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hour12: true, timeZone: "UTC" });
const d9 = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hourCycle: "h11", timeZone: "UTC" });
const d10 = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "numeric", hourCycle: "h12", timeZone: "UTC" });
const d11 = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hourCycle: "h24", timeZone: "UTC" });
const d12 = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" });
const d13 = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: "+05:30" });
const d14 = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: "-03:00" });
const d15 = new Intl.DateTimeFormat("en-US", { era: "short", year: "numeric", month: "narrow", timeZone: "UTC" });
const d16 = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", timeZoneName: "short", timeZone: "UTC" });
const d17 = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeZone: "UTC" });
const d18 = new Intl.DateTimeFormat("en-US-u-ca-hebrew", { dateStyle: "medium", timeZone: "UTC" });
const d19 = new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" });
const d20 = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" });
const d21 = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" });
const d22 = new Intl.DateTimeFormat("en-US", { hour: "numeric", dayPeriod: "long", timeZone: "UTC" });
const d23 = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "long", timeZone: "America/New_York" });
const d24 = new Intl.DateTimeFormat("he-IL", { dateStyle: "full", timeZone: "UTC" });
const d25 = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" });
const d26 = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });
const d27 = new Intl.DateTimeFormat("ca-ES", { day: "numeric", month: "long", timeZone: "UTC" });
const d28 = new Intl.DateTimeFormat("fi-FI", { weekday: "narrow", second: "numeric", fractionalSecondDigits: 1, timeZone: "Etc/UTC" });
const d29 = new Intl.DateTimeFormat("en-US", { year: "2-digit", month: "numeric", fractionalSecondDigits: 2, numberingSystem: "latn", calendar: "gregory", timeZone: "GMT" });

type DateCase = [string, (value: any) => string, string, Intl.DateTimeFormatOptions];
const dateCases: DateCase[] = [
  ["minute", value => minute.format(value), "en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }],
  ["buddhist", value => buddhist.format(value), "th-TH", { dateStyle: "long", timeZone: "UTC" }],
  ["localTime", value => localTime.format(value), "en-US", { dateStyle: "short" }],
  ["d1", value => d1.format(value), "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }],
  ["d2", value => d2.format(value), "en-US", { dateStyle: "full", timeStyle: "medium", timeZone: "UTC" }],
  ["d3", value => d3.format(value), "en-GB", { dateStyle: "short", timeZone: "UTC" }],
  ["d4", value => d4.format(value), "de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }],
  ["d5", value => d5.format(value), "fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }],
  ["d6", value => d6.format(value), "ja-JP", { dateStyle: "long", timeZone: "UTC" }],
  ["d7", value => d7.format(value), "es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }],
  ["d8", value => d8.format(value), "en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hour12: true, timeZone: "UTC" }],
  ["d9", value => d9.format(value), "en-US", { hour: "numeric", minute: "numeric", hourCycle: "h11", timeZone: "UTC" }],
  ["d10", value => d10.format(value), "en-US", { hour: "2-digit", minute: "numeric", hourCycle: "h12", timeZone: "UTC" }],
  ["d11", value => d11.format(value), "en-US", { hour: "numeric", minute: "numeric", hourCycle: "h24", timeZone: "UTC" }],
  ["d12", value => d12.format(value), "sv-SE", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" }],
  ["d13", value => d13.format(value), "en-US", { dateStyle: "short", timeStyle: "short", timeZone: "+05:30" }],
  ["d14", value => d14.format(value), "en-US", { dateStyle: "short", timeStyle: "short", timeZone: "-03:00" }],
  ["d15", value => d15.format(value), "en-US", { era: "short", year: "numeric", month: "narrow", timeZone: "UTC" }],
  ["d16", value => d16.format(value), "en-US", { hour: "numeric", minute: "numeric", timeZoneName: "short", timeZone: "UTC" }],
  ["d17", value => d17.format(value), "ar-EG", { dateStyle: "medium", timeZone: "UTC" }],
  ["d18", value => d18.format(value), "en-US-u-ca-hebrew", { dateStyle: "medium", timeZone: "UTC" }],
  ["d19", value => d19.format(value), "zh-CN", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }],
  ["d20", value => d20.format(value), "ru-RU", { dateStyle: "long", timeZone: "UTC" }],
  ["d21", value => d21.format(value), "pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }],
  ["d22", value => d22.format(value), "en-US", { hour: "numeric", dayPeriod: "long", timeZone: "UTC" }],
  ["d23", value => d23.format(value), "en-US", { dateStyle: "medium", timeStyle: "long", timeZone: "America/New_York" }],
  ["d24", value => d24.format(value), "he-IL", { dateStyle: "full", timeZone: "UTC" }],
  ["d25", value => d25.format(value), "ko-KR", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }],
  ["d26", value => d26.format(value), "en-US", { timeZone: "UTC" }],
  ["d27", value => d27.format(value), "ca-ES", { day: "numeric", month: "long", timeZone: "UTC" }],
  ["d28", value => d28.format(value), "fi-FI", { weekday: "narrow", second: "numeric", fractionalSecondDigits: 1, timeZone: "Etc/UTC" }],
  ["d29", value => d29.format(value), "en-US", { year: "2-digit", month: "numeric", fractionalSecondDigits: 2, numberingSystem: "latn", calendar: "gregory", timeZone: "GMT" }],
];

const times: number[] = [
  0, 1, -1, 999, 1000, 43_199_999, 43_200_000, 86_399_999, 86_400_000, -86_400_001, 951_782_400_000, 951_868_799_999, 951_868_800_000, 1_709_164_800_000,
  1_778_171_456_789, 4_107_542_400_000, 253_402_300_799_999, 253_402_300_800_000, -62_135_596_800_000, -62_135_596_800_001, -62_135_586_000_000, -62_135_616_600_000,
  -62_167_219_200_000, -62_198_755_200_000, -12_219_292_800_000, -12_219_292_800_001, 8.64e15, -8.64e15, 8.64e15 + 1, NaN, Infinity, -Infinity, 1.5, -1.5, -0,
];
for (let month = 0; month < 12; month++) for (let day = 1; day < 29; day += 9) times.push(Date.UTC(2024, month, day, (month * 2 + day) % 24, day * 2, month * 5, day * 35));
class SubclassOfDate extends Date {}
const otherValues: (() => unknown)[] = [
  () => "2020",
  () => "not a number",
  () => null,
  () => true,
  () => ({ valueOf: () => 86_400_000 }),
  () => ({}),
  () => new SubclassOfDate(5),
  () => Object.assign(new Date(6), { valueOf: () => 7 }),
  () => Object.defineProperty(new Date(8), Symbol.toPrimitive, { value: () => 9 }),
  () => Object.setPrototypeOf(new Date(10), null),
  () => Symbol.iterator,
  () => 10n,
];

for (const [name, format, locale, options] of dateCases) {
  const throughICU = new Intl.DateTimeFormat(notConstant(locale), notConstant(options));
  let differences = 0;
  for (const time of times) {
    if (say(() => format(new Date(time))) !== say(() => throughICU.format(new Date(time)))) differences++;
    if (say(() => format(time)) !== say(() => throughICU.format(time))) differences++;
  }
  for (const make of otherValues) if (say(() => format(make())) !== say(() => throughICU.format(make() as any))) differences++;
  console.log(name + ": " + differences + " differences");
}

const n1 = new Intl.NumberFormat("de-DE");
const n2 = new Intl.NumberFormat("fr-FR");
const n3 = new Intl.NumberFormat("en-IN");
const n4 = new Intl.NumberFormat("es-ES");
const n5 = new Intl.NumberFormat("de-CH");
const n6 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const n7 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const n8 = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });
const n9 = new Intl.NumberFormat("en-US", { style: "percent" });
const n10 = new Intl.NumberFormat("en-US", { style: "unit", unit: "kilometer-per-hour" });
const n11 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 });
const n12 = new Intl.NumberFormat("en-US", { useGrouping: false });
const n13 = new Intl.NumberFormat("en-US", { signDisplay: "always" });
const n14 = new Intl.NumberFormat("en-US", { signDisplay: "exceptZero" });
const n15 = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });
const n16 = new Intl.NumberFormat("ar-EG");
const n17 = new Intl.NumberFormat("hi-IN");
const n18 = new Intl.NumberFormat("en-US", { minimumIntegerDigits: 3 });
const n19 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", currencySign: "accounting" });
const n20 = new Intl.NumberFormat("sv-SE");
const n21 = new Intl.NumberFormat("en-US", { notation: "scientific" });
const n22 = new Intl.NumberFormat("pl-PL");
const n23 = new Intl.NumberFormat("en-US", { roundingIncrement: 5, maximumFractionDigits: 0 });

type NumberCase = [string, (value: any) => string, string, Intl.NumberFormatOptions | undefined];
const numberCases: NumberCase[] = [
  ["count", value => count.format(value), "en-US", undefined],
  ["compact", value => compact.format(value), "en-US", { notation: "compact" }],
  ["n1", value => n1.format(value), "de-DE", undefined],
  ["n2", value => n2.format(value), "fr-FR", undefined],
  ["n3", value => n3.format(value), "en-IN", undefined],
  ["n4", value => n4.format(value), "es-ES", undefined],
  ["n5", value => n5.format(value), "de-CH", undefined],
  ["n6", value => n6.format(value), "en-US", { style: "currency", currency: "USD" }],
  ["n7", value => n7.format(value), "de-DE", { style: "currency", currency: "EUR" }],
  ["n8", value => n8.format(value), "ja-JP", { style: "currency", currency: "JPY" }],
  ["n9", value => n9.format(value), "en-US", { style: "percent" }],
  ["n10", value => n10.format(value), "en-US", { style: "unit", unit: "kilometer-per-hour" }],
  ["n11", value => n11.format(value), "en-US", { minimumFractionDigits: 2 }],
  ["n12", value => n12.format(value), "en-US", { useGrouping: false }],
  ["n13", value => n13.format(value), "en-US", { signDisplay: "always" }],
  ["n14", value => n14.format(value), "en-US", { signDisplay: "exceptZero" }],
  ["n15", value => n15.format(value), "en-US", { maximumSignificantDigits: 3 }],
  ["n16", value => n16.format(value), "ar-EG", undefined],
  ["n17", value => n17.format(value), "hi-IN", undefined],
  ["n18", value => n18.format(value), "en-US", { minimumIntegerDigits: 3 }],
  ["n19", value => n19.format(value), "en-US", { style: "currency", currency: "USD", currencySign: "accounting" }],
  ["n20", value => n20.format(value), "sv-SE", undefined],
  ["n21", value => n21.format(value), "en-US", { notation: "scientific" }],
  ["n22", value => n22.format(value), "pl-PL", undefined],
  ["n23", value => n23.format(value), "en-US", { roundingIncrement: 5, maximumFractionDigits: 0 }],
];
const numbers: unknown[] = [
  0, -0, 1, -1, 7, 10, 99, 100, 999, 1000, -1000, 1234, 9999, 10000, 12345, 99999, 100000, 123456, 999999, 1000000, 1234567, -1234567, 12345678, 123456789, 2147483647, 2147483648,
  -2147483648, 4294967296, 1234567890123, 9007199254740991, -9007199254740991, 9007199254740992, 1e21, 0.5, -0.5, 1.005, 1234.5678, 0.1 + 0.2, 1e-7, NaN, Infinity, -Infinity,
  12.5, -12.5, 12.345, 12.3456, 0.005, 0.015, 0.025, 0.125, 0.375, 2.675, 1.255, 8.345, 1.45, 999.995, 999.9995, 0.9995, 0.0005, -0.0004, -0.0005, 0.0000015, 1e-6, 9.9e-7, 1234567.891, 1 / 3, 2 / 3, 4503599627370495.5,
  "12", "1234567", "x", null, undefined, true, 10n, 123456789012345678901234567890n, { valueOf: () => 4321 }, [5],
];
for (const [name, format, locale, options] of numberCases) {
  const throughICU = new Intl.NumberFormat(notConstant(locale), options && notConstant(options));
  let differences = 0;
  for (const number of numbers) if (say(() => format(number)) !== say(() => throughICU.format(number as any))) differences++;
  console.log(name + ": " + differences + " differences");
}

const changed = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "UTC" });
const formatChanged = (date: Date) => changed.format(date);
console.log(formatChanged(new Date(0)));
Object.defineProperty(changed, "format", { value: () => "own format", configurable: true });
console.log(formatChanged(new Date(0)));
delete (changed as { format?: unknown }).format;
console.log(formatChanged(new Date(0)));
console.log(new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", timeZone: "UTC" }).format(new Date(86_400_000 * 365)), new Intl.NumberFormat("en-US").format(7654321));
console.log(typeof formatMinute(new Date(1_778_171_456_000)), formatCount(1234567), typeof formatBuddhist(new Date(0)), typeof formatLocalTime(new Date(0)), formatCompact(1500));

interface Row {
  at: Date;
  amount: number;
}
export function formatRow(row: Row): string {
  return d12.format(row.at) + " " + count.format(row.amount);
}
export function formatNewDate(time: number): string {
  return d12.format(new Date(time));
}
let calls = 0;
function dateWithSideEffect(): Date {
  if (++calls === 2) Object.defineProperty(d12, "format", { value: () => "replaced while the argument was evaluated", configurable: true });
  return new Date(calls * 86_400_000);
}
export function formatResultOfCall(): string {
  return d12.format(dateWithSideEffect());
}
console.log(formatRow({ at: new Date(0), amount: 1234 }), formatNewDate(1000), formatResultOfCall(), formatResultOfCall(), formatResultOfCall());
(globalThis as any).kept = [formatMinute, formatBuddhist, formatLocalTime, formatCount, formatCompact, formatRow, formatNewDate, formatResultOfCall];
