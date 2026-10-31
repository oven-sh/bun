// date.toLocaleString, toLocaleDateString, toLocaleTimeString and number.toLocaleString with a constant locale and constant options
// format from a pattern computed at build time: no formatter is made and the options object is only allocated on the slow path.
// Every result is compared with the same call with arguments that are not constants.
// CALLS+ longDate operationAOTFormatWithPattern
// CALLS+ dateAndTimeInUTC operationAOTFormatWithPattern
// CALLS+ timeOnly operationAOTFormatWithPattern
// CALLS+ ofNewDate operationAOTFormatWithPattern
// CALLS+ grouped operationAOTFormatWithPattern
// CALLS+ wholeDollars operationAOTFormatWithPattern
// CALLS+ percent operationAOTFormatWithPattern
// CALLS+ twoDigits operationAOTFormatWithPattern
// CALLS- fourDigits operationAOTFormatWithPattern
// CALLS- withSharedOptions operationAOTFormatWithPattern
// CALLS+ dollarsWithSharedOptions operationAOTFormatWithPattern
// CALLS- withOptionsThatAreChanged operationAOTFormatWithPattern
// CALLS+ inUntypedCode operationAOTFormatWithPattern
// CALLS- hostLocale operationAOTFormatWithPattern
// CALLS- localeFromOutside operationAOTFormatWithPattern
// CALLS- optionsFromOutside operationAOTFormatWithPattern
// CALLS+ inNewYork operationAOTFormatWithPattern
// CALLS- inNewYorkByName operationAOTFormatWithPattern
// CALLS- threeArguments operationAOTFormatWithPattern
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

export function longDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
export function dateAndTimeInUTC(date: Date): string {
  return date.toLocaleString("en-GB", { timeZone: "UTC" });
}
export function timeOnly(date: Date): string {
  return date.toLocaleTimeString("de-DE");
}
export function ofNewDate(time: number): string {
  return new Date(time).toLocaleDateString("fr-FR");
}
export function grouped(n: number): string {
  return n.toLocaleString("en-US");
}
export function wholeDollars(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
const sharedOptions: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
export function withSharedOptions(date: Date): string {
  return date.toLocaleDateString("en-US", sharedOptions);
}
const sharedNumberOptions: Intl.NumberFormatOptions = { style: "currency", currency: "USD" };
export function dollarsWithSharedOptions(n: number): string {
  return n.toLocaleString("en-US", sharedNumberOptions);
}
const optionsThatAreChanged: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
export function withOptionsThatAreChanged(date: Date): string {
  return date.toLocaleDateString("en-US", optionsThatAreChanged);
}
export function percent(n: number): string {
  return n.toLocaleString("de", { style: "percent", maximumFractionDigits: 1 });
}
export function twoDigits(n: number): string {
  return n.toLocaleString("en-US", { minimumIntegerDigits: 2 });
}
export function fourDigits(n: number): string {
  return n.toLocaleString("en-US", { minimumIntegerDigits: 4 });
}
export function hostLocale(date: Date): string {
  return date.toLocaleDateString();
}
export function localeFromOutside(date: Date, locale: string): string {
  return date.toLocaleDateString(locale);
}
export function optionsFromOutside(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString("en-US", options);
}
export function inNewYork(date: Date): string {
  return date.toLocaleString("en-US", { timeZone: "America/New_York" });
}
export function inNewYorkByName(date: Date): string {
  return date.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" });
}
export function threeArguments(date: Date): string {
  return (date.toLocaleDateString as (...rest: unknown[]) => string).call(date, "en-US", { year: "numeric" }, 7);
}
export function timeStyleForADate(date: Date): string {
  return date.toLocaleDateString("en-US", { timeStyle: "short" });
}
export function inUntypedCode(time: any): any {
  const date: any = new Date(time);
  return date.toLocaleDateString("en-US", { year: "2-digit", month: "2-digit", day: "2-digit", timeZone: "UTC" });
}
export function untyped(value: any): string {
  return value.toLocaleString("en-US");
}

const dates: Date[] = [new Date(NaN), new Date(8.64e15), new Date(-8.64e15), new Date(-62_135_596_800_000), new Date(-62_135_596_800_001), new Date(-62_198_755_200_000), new Date(0), new Date(-1)];
for (let i = 0; i < 400; i++) dates.push(new Date(-2_000_000_000_000 + i * 9_876_543_210.5));
for (let hour = 0; hour < 24 * 366; hour += 7) dates.push(new Date(1_700_000_000_000 + hour * 3_600_000));
const compareDates = (name: string, one: (date: Date) => unknown, other: (date: Date) => unknown) => {
  let differences = 0;
  for (const date of dates) if (say(() => one(date)) !== say(() => other(date))) differences++;
  console.log(name + ": " + differences + " differences");
};
compareDates("longDate", longDate, date => date.toLocaleDateString(notConstant("en-US"), notConstant({ year: "numeric", month: "long", day: "numeric" })));
compareDates("dateAndTimeInUTC", dateAndTimeInUTC, date => date.toLocaleString(notConstant("en-GB"), notConstant({ timeZone: "UTC" })));
compareDates("timeOnly", timeOnly, date => date.toLocaleTimeString(notConstant("de-DE")));
compareDates("ofNewDate", date => ofNewDate(date.getTime()), date => date.toLocaleDateString(notConstant("fr-FR")));
compareDates("withSharedOptions", withSharedOptions, date => date.toLocaleDateString(notConstant("en-US"), notConstant({ year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })));
compareDates("withOptionsThatAreChanged", withOptionsThatAreChanged, date => date.toLocaleDateString(notConstant("en-US"), notConstant({ year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })));
optionsThatAreChanged.month = "long";
compareDates("withOptionsThatAreChanged, changed", withOptionsThatAreChanged, date => date.toLocaleDateString(notConstant("en-US"), notConstant({ year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })));
compareDates("hostLocale", hostLocale, date => date.toLocaleDateString(undefined, notConstant({})));
compareDates("localeFromOutside", date => localeFromOutside(date, "ja-JP"), date => date.toLocaleDateString(notConstant("ja-JP")));
compareDates("optionsFromOutside", date => optionsFromOutside(date, { month: "narrow" }), date => date.toLocaleDateString(notConstant("en-US"), notConstant({ month: "narrow" })));
compareDates("inNewYork", inNewYork, date => date.toLocaleString(notConstant("en-US"), notConstant({ timeZone: "America/New_York" })));
compareDates("inNewYorkByName", inNewYorkByName, date => date.toLocaleString(notConstant("en-US"), notConstant({ timeZone: "America/New_York", timeZoneName: "short" })));
compareDates("threeArguments", threeArguments, date => date.toLocaleDateString(notConstant("en-US"), notConstant({ year: "numeric" })));
compareDates("timeStyleForADate", timeStyleForADate, date => date.toLocaleDateString(notConstant("en-US"), notConstant({ timeStyle: "short" })));
compareDates("inUntypedCode", date => inUntypedCode(date.getTime()), date => date.toLocaleDateString(notConstant("en-US"), notConstant({ year: "2-digit", month: "2-digit", day: "2-digit", timeZone: "UTC" })));
compareDates("untyped", untyped, date => date.toLocaleString(notConstant("en-US")));

const numbers = [0.285, 0.2845, 0.005, 0.0005, 0.99995, 12.345, -0.125, 7, 42, 0, -0, 1, -1, 999, 1000, 1234, -1234, 1234567, 2147483648, 9007199254740991, 9007199254740992, 1e21, 0.5, 1.5, 2.5, -0.5, 1234.5678, NaN, Infinity, -Infinity];
const compareNumbers = (name: string, one: (n: number) => unknown, other: (n: number) => unknown) => {
  let differences = 0;
  for (const number of numbers) if (say(() => one(number)) !== say(() => other(number))) differences++;
  console.log(name + ": " + differences + " differences");
};
compareNumbers("grouped", grouped, n => n.toLocaleString(notConstant("en-US")));
compareNumbers("wholeDollars", wholeDollars, n => n.toLocaleString(notConstant("en-US"), notConstant({ style: "currency", currency: "USD", maximumFractionDigits: 0 })));
compareNumbers("dollarsWithSharedOptions", dollarsWithSharedOptions, n => n.toLocaleString(notConstant("en-US"), notConstant({ style: "currency", currency: "USD" })));
compareNumbers("percent", percent, n => n.toLocaleString(notConstant("de"), notConstant({ style: "percent", maximumFractionDigits: 1 })));
compareNumbers("twoDigits", twoDigits, n => n.toLocaleString(notConstant("en-US"), notConstant({ minimumIntegerDigits: 2 })));
compareNumbers("fourDigits", fourDigits, n => n.toLocaleString(notConstant("en-US"), notConstant({ minimumIntegerDigits: 4 })));
compareNumbers("untyped", untyped, n => n.toLocaleString(notConstant("en-US")));

const withItsOwnMethod = new Date(0);
Object.defineProperty(withItsOwnMethod, "toLocaleDateString", { value: (...rest: unknown[]) => "own method, " + rest.length + " arguments, " + JSON.stringify(rest[1]) });
export function longDateOfAnyDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
console.log(longDateOfAnyDate(withItsOwnMethod));
class Birthday extends Date {
  toLocaleDateString(): string {
    return "a birthday";
  }
}
console.log(longDateOfAnyDate(new Birthday(0)), longDateOfAnyDate(new Date(0)) === longDate(new Date(0)));
console.log(say(() => untyped(null)), say(() => untyped(undefined)), untyped("text"), untyped([1234, 5678]), untyped(1234n));
(globalThis as any).kept = [percent, twoDigits, fourDigits, inUntypedCode, dollarsWithSharedOptions, longDateOfAnyDate, withSharedOptions, withOptionsThatAreChanged, longDate, dateAndTimeInUTC, timeOnly, ofNewDate, grouped, wholeDollars, hostLocale, localeFromOutside, optionsFromOutside, inNewYork, inNewYorkByName, threeArguments, timeStyleForADate, untyped];
