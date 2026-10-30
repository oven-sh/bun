// A formatter made with a constant locale and constant options holds a pattern computed at build time, whatever becomes of it: it may be
// passed on, captured, kept in a field, or have its `format` taken off. ICU is set up for it only when something needs ICU, and then it
// answers as any other formatter. Every result is compared with a formatter whose options are not constants.
// IR= 1 makeFormatter  = NewFormatterWithPattern 
// IR= 0 makeFormatter  = New(Plain)?Object 
// IR= 0 makeFormatter  = FreeGet 
// IR= 0 makeFormatter Construct|overload=IntlDateTimeFormat/
// IR= 0 makeWithOptionsThatEscape NewFormatterWithPattern
// IR= 1 makeWithOptionsThatEscape  = Construct |overload=IntlDateTimeFormat/
// IR= 0 makeSubclassInstance NewFormatterWithPattern
// IR= 1 makeWithSharedOptions  = NewFormatterWithPattern 
// IR= 0 makeWithOptionsThatAreChanged NewFormatterWithPattern
// IR= 1 makeWithOptionsThatAreChanged  = Construct |overload=IntlDateTimeFormat/
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
const same = (name: string, one: () => unknown, other: () => unknown) => console.log(name + ": " + (say(one) === say(other) ? "same" : say(one) + " | " + say(other)));

const dates: Date[] = [];
for (let i = 0; i < 400; i++) dates.push(new Date(-2_000_000_000_000 + i * 9_876_543_210.5));
const allSame = (name: string, one: (date: Date) => unknown, other: (date: Date) => unknown) => {
  let differences = 0;
  for (const date of dates) if (say(() => one(date)) !== say(() => other(date))) differences++;
  console.log(name + ": " + differences + " differences");
};

const dayOptions: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
const dayThroughICU = new Intl.DateTimeFormat(notConstant("en-US"), notConstant(dayOptions));
const day = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

function through(formatter: Intl.DateTimeFormat, date: Date): string {
  return formatter.format(date);
}
function throughAnything(formatter: any, date: Date): string {
  return formatter.format(date);
}
export function makeFormatter(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
let seenOptions: unknown;
export function makeWithOptionsThatEscape(): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
  seenOptions = options;
  return new Intl.DateTimeFormat("en-US", options);
}
const sharedOptions: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
export function makeWithSharedOptions(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", sharedOptions);
}
const optionsThatAreChanged: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
export function makeWithOptionsThatAreChanged(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", optionsThatAreChanged);
}
class Loud extends Intl.DateTimeFormat {
  shout(date: Date): string {
    return this.format(date).toUpperCase();
  }
}
export function makeSubclassInstance(): Loud {
  return new Loud("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
function makeClosure(): (date: Date) => string {
  const captured = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  return date => captured.format(date);
}
class Page {
  static formatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  formatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  byStatic(date: Date): string {
    return Page.formatter.format(date);
  }
  byField(date: Date): string {
    return this.formatter.format(date);
  }
}
const holder = { formatter: day };
const takenOff = day.format;
const closure = makeClosure();
const page = new Page();
const getter = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format")!.get!;

allSame("a module variable", date => day.format(date), date => dayThroughICU.format(date));
allSame("an argument", date => through(day, date), date => dayThroughICU.format(date));
allSame("an untyped argument", date => throughAnything(day, date), date => dayThroughICU.format(date));
allSame("a result", date => makeFormatter().format(date), date => dayThroughICU.format(date));
allSame("options that escape", date => makeWithOptionsThatEscape().format(date), date => dayThroughICU.format(date));
allSame("shared options", date => makeWithSharedOptions().format(date), date => dayThroughICU.format(date));
allSame("options that are changed", date => makeWithOptionsThatAreChanged().format(date), date => dayThroughICU.format(date));
optionsThatAreChanged.month = "long";
allSame("options that are changed, changed", date => makeWithOptionsThatAreChanged().format(date), date => new Intl.DateTimeFormat(notConstant("en-US"), notConstant({ year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })).format(date));
allSame("a subclass", date => makeSubclassInstance().shout(date), date => dayThroughICU.format(date).toUpperCase());
allSame("a captured variable", closure, date => dayThroughICU.format(date));
allSame("a static field", date => page.byStatic(date), date => dayThroughICU.format(date));
allSame("a field", date => page.byField(date), date => dayThroughICU.format(date));
allSame("a property", date => holder.formatter.format(date), date => dayThroughICU.format(date));
allSame("format taken off", date => takenOff(date), date => dayThroughICU.format(date));
allSame("the getter", date => getter.call(day)(date), date => dayThroughICU.format(date));
allSame("Reflect.get", date => Reflect.get(day, "format")(date), date => dayThroughICU.format(date));
allSame("a time value", date => day.format(date.getTime()), date => dayThroughICU.format(date.getTime()));
same("map", () => dates.map(day.format).join(), () => dates.map(dayThroughICU.format).join());
console.log(typeof seenOptions, typeof day.format(), day.format === day.format, day.format.name === "", day.format.length);

same("prototype", () => Object.getPrototypeOf(day) === Intl.DateTimeFormat.prototype, () => true);
same("instanceof", () => day instanceof Intl.DateTimeFormat, () => true);
same("toString", () => Object.prototype.toString.call(day), () => Object.prototype.toString.call(dayThroughICU));
same("own keys", () => Reflect.ownKeys(day).length, () => 0);

same("resolvedOptions first", () => JSON.stringify(makeFormatter().resolvedOptions()), () => JSON.stringify(dayThroughICU.resolvedOptions()));
same("formatToParts first", () => JSON.stringify(makeFormatter().formatToParts(dates[7])), () => JSON.stringify(dayThroughICU.formatToParts(dates[7])));
same("formatRange first", () => makeFormatter().formatRange(dates[7], dates[300]), () => dayThroughICU.formatRange(dates[7], dates[300]));
same("formatRangeToParts first", () => JSON.stringify(makeFormatter().formatRangeToParts(dates[7], dates[300])), () => JSON.stringify(dayThroughICU.formatRangeToParts(dates[7], dates[300])));
const oddValues: any[] = [NaN, Infinity, 8.64e15, 8.64e15 + 1, -8.64e15, -62_135_596_800_000, -62_135_596_800_001, "2020", null, true, {}, new Date(NaN), { valueOf: () => 86_400_000 }, [0], 10n, Symbol.iterator];
for (const odd of oddValues) same("odd value first", () => makeFormatter().format(odd), () => dayThroughICU.format(odd));
const used = makeFormatter();
same("format", () => used.format(dates[9]), () => dayThroughICU.format(dates[9]));
same("then resolvedOptions", () => JSON.stringify(used.resolvedOptions()), () => JSON.stringify(dayThroughICU.resolvedOptions()));
same("then formatToParts", () => JSON.stringify(used.formatToParts(dates[9])), () => JSON.stringify(dayThroughICU.formatToParts(dates[9])));
same("then format", () => used.format(dates[10]), () => dayThroughICU.format(dates[10]));
const withAnotherPrototype = makeFormatter();
Object.setPrototypeOf(withAnotherPrototype, { format: () => "another prototype" });
console.log(through(withAnotherPrototype, dates[0]), throughAnything(withAnotherPrototype, dates[0]), say(() => getter.call(withAnotherPrototype)(dates[0])) === say(() => dayThroughICU.format(dates[0])));
const dateWithItsOwnValueOf = new Date(0);
Object.defineProperty(dateWithItsOwnValueOf, "valueOf", { value: () => 86_400_000 * 400 });
same("a date with its own valueOf", () => day.format(dateWithItsOwnValueOf), () => dayThroughICU.format(dateWithItsOwnValueOf));
same("not a formatter", () => getter.call({}), () => {
  throw new TypeError();
});

const local = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium" });
const localThroughICU = new Intl.DateTimeFormat(notConstant("en-US"), notConstant({ dateStyle: "medium", timeStyle: "medium" }));
const localDefault = new Intl.DateTimeFormat("en-GB");
const localDefaultThroughICU = new Intl.DateTimeFormat(notConstant("en-GB"));
const localWithName = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZoneName: "short" });
const localWithNameThroughICU = new Intl.DateTimeFormat(notConstant("en-US"), notConstant({ hour: "numeric", timeZoneName: "short" }));
allSame("the default time zone", date => local.format(date), date => localThroughICU.format(date));
allSame("the default time zone and no options", date => localDefault.format(date), date => localDefaultThroughICU.format(date));
allSame("the default time zone by name", date => localWithName.format(date), date => localWithNameThroughICU.format(date));
same("the default time zone's options", () => JSON.stringify(local.resolvedOptions()), () => JSON.stringify(localThroughICU.resolvedOptions()));
let differencesByHour = 0;
for (let hour = 0; hour < 24 * 366; hour++) if (local.format(1_700_000_000_000 + hour * 3_600_000) !== localThroughICU.format(1_700_000_000_000 + hour * 3_600_000)) differencesByHour++;
console.log("every hour of a year: " + differencesByHour + " differences");

const newYork = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "America/New_York" });
const newYorkThroughICU = new Intl.DateTimeFormat(notConstant("en-US"), notConstant({ dateStyle: "medium", timeStyle: "medium", timeZone: "America/New_York" }));
const kolkata = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" });
const kolkataThroughICU = new Intl.DateTimeFormat(notConstant("en-GB"), notConstant({ dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" }));
const lordHowe = new Intl.DateTimeFormat("en-AU", { dateStyle: "short", timeStyle: "medium", timeZone: "Australia/Lord_Howe" });
const lordHoweThroughICU = new Intl.DateTimeFormat(notConstant("en-AU"), notConstant({ dateStyle: "short", timeStyle: "medium", timeZone: "Australia/Lord_Howe" }));
const lowerCase = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: "europe/berlin" });
const lowerCaseThroughICU = new Intl.DateTimeFormat(notConstant("en-US"), notConstant({ dateStyle: "short", timeStyle: "short", timeZone: "europe/berlin" }));
const berlinWithName = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZoneName: "short", timeZone: "Europe/Berlin" });
const berlinWithNameThroughICU = new Intl.DateTimeFormat(notConstant("en-US"), notConstant({ hour: "numeric", timeZoneName: "short", timeZone: "Europe/Berlin" }));
allSame("America/New_York", date => newYork.format(date), date => newYorkThroughICU.format(date));
allSame("Asia/Kolkata", date => kolkata.format(date), date => kolkataThroughICU.format(date));
allSame("Australia/Lord_Howe", date => lordHowe.format(date), date => lordHoweThroughICU.format(date));
allSame("europe/berlin", date => lowerCase.format(date), date => lowerCaseThroughICU.format(date));
allSame("Europe/Berlin by name", date => berlinWithName.format(date), date => berlinWithNameThroughICU.format(date));
same("America/New_York's options", () => JSON.stringify(newYork.resolvedOptions()), () => JSON.stringify(newYorkThroughICU.resolvedOptions()));
same("no such time zone", () => new Intl.DateTimeFormat("en-US", { timeZone: "Mars/Olympus" }).format(0), () => new Intl.DateTimeFormat(notConstant("en-US"), notConstant({ timeZone: "Mars/Olympus" })).format(0));
let differencesInNamedZones = 0;
for (let quarter = 0; quarter < 4 * 24 * 366; quarter++) {
  const time = 1_704_067_200_000 + quarter * 900_000 - 1;
  if (newYork.format(time) !== newYorkThroughICU.format(time) || lordHowe.format(time) !== lordHoweThroughICU.format(time)) differencesInNamedZones++;
}
console.log("every quarter of an hour of a year in two time zones: " + differencesInNamedZones + " differences");

const amountThroughICU = new Intl.NumberFormat(notConstant("en-US"), notConstant({ style: "currency", currency: "USD", maximumFractionDigits: 0 }));
export function makeAmount(): Intl.NumberFormat {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
const amount = makeAmount();
const amountTakenOff = amount.format;
const numbersAndOthers: any[] = [0, 1, -1, 1234, 1234567, -1234567, 0.5, 1.5, 2.5, -0, NaN, Infinity, 1e21, 10n, "12", "x", null, undefined, true, { valueOf: () => 4321 }];
for (const number of numbersAndOthers) {
  same("a number", () => amount.format(number), () => amountThroughICU.format(number));
  same("a number first", () => makeAmount().format(number), () => amountThroughICU.format(number));
  same("a number, format taken off", () => amountTakenOff(number), () => amountThroughICU.format(number));
}
same("number resolvedOptions first", () => JSON.stringify(makeAmount().resolvedOptions()), () => JSON.stringify(amountThroughICU.resolvedOptions()));
same("number formatToParts first", () => JSON.stringify(makeAmount().formatToParts(1234)), () => JSON.stringify(amountThroughICU.formatToParts(1234)));
same("number formatRange first", () => makeAmount().formatRange(1, 2000), () => amountThroughICU.formatRange(1, 2000));
same("number formatRangeToParts first", () => JSON.stringify(makeAmount().formatRangeToParts(1, 2000)), () => JSON.stringify(amountThroughICU.formatRangeToParts(1, 2000)));
same("number prototype", () => Object.getPrototypeOf(amount) === Intl.NumberFormat.prototype && amount instanceof Intl.NumberFormat, () => true);
(globalThis as any).kept = [makeWithSharedOptions, makeWithOptionsThatAreChanged, makeFormatter, makeWithOptionsThatEscape, makeSubclassInstance, makeAmount];
