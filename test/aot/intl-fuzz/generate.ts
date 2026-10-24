// Generates programs that compare formatters made from constants with ICU.
//
// `bun build --compile --aot` turns `new Intl.DateTimeFormat("de", { month: "long" })`, `new Intl.NumberFormat(..)` and
// `date.toLocaleString("de", { .. })` with constant arguments into a pattern in the executable. A generated program holds some
// hundreds of such formatters and calls, each beside the same locale and options as data that the compiler cannot see
// (JSON.parse of a string), which goes through ICU. Both format the same values and every result is compared.
//
//   bun test/aot/intl-fuzz/generate.ts <seed> [formatters: 240] > program.ts           options drawn at random
//   bun test/aot/intl-fuzz/generate.ts sweep:<part> [formatters: 240] > program.ts     every combination for every locale, in parts
//   bun test/aot/intl-fuzz/generate.ts sweep                                           how many parts there are
//   bun test/aot/intl-fuzz/generate.ts typical:<part> > program.ts                     what programs usually ask for, in common locales
//
// sweep.ts builds and runs them; README.md says when.
import { locales } from "./locales";

type Options = Record<string, string | number | boolean>;

class Random {
  #state: number;
  constructor(seed: number) {
    this.#state = (seed * 2654435761 + 1) >>> 0;
  }
  next(): number {
    let x = this.#state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state / 4294967296;
  }
  below(count: number): number {
    return Math.floor(this.next() * count);
  }
  pick<T>(list: readonly T[]): T {
    return list[this.below(list.length)];
  }
  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

// Locales with known traps come up more often than their share: month names in the genitive, numbering systems and calendars
// that are not the Latin digits and the Gregorian calendar, right-to-left marks, minimum grouping digits, unusual separators.
const localesWithTraps = [
  "en-US", "en-GB", "en-IN", "en-AU", "en-CA", "ru", "pl", "cs", "uk", "el", "fi", "ca", "hr", "lt", "sk", "sl", "be", "hy", "ka", "ar", "ar-EG", "ar-SA",
  "ar-MA", "fa", "he", "ur", "ps", "th", "hi", "mr", "ne", "bn", "my", "km", "lo", "dz", "ja", "ja-JP-u-ca-japanese", "zh", "zh-Hant", "zh-TW", "ko", "es",
  "es-MX", "es-419", "es-US", "pt", "pt-PT", "pt-BR", "de", "de-CH", "de-AT", "de-LI", "fr", "fr-CA", "fr-CH", "it", "it-CH", "nl", "sv", "nb", "da", "is",
  "hu", "bg", "ro", "tr", "vi", "id", "ms", "sw", "af", "eu", "gl", "et", "lv", "mk", "sq", "sr", "sr-Latn", "bs", "az", "kk", "uz", "mn", "ta", "te", "kn",
  "ml", "gu", "pa", "si", "am", "ti", "so", "ha", "yo", "ig", "zu", "ks", "sd", "ckb", "ug", "yi", "ff-Adlm", "sat", "mni", "root", "und", "en-u-hc-h23",
  "en-u-hc-h11", "en-u-nu-arab", "en-u-ca-buddhist", "de-u-nu-latn", "ar-u-nu-latn", "fa-u-ca-gregory-nu-latn", "th-u-ca-gregory", "hi-u-nu-deva", "en-US-u-ca-iso8601",
];

const timeZones = [
  "UTC", "UTC", "UTC", "UTC", "+00:00", "+05:30", "-03:00", "+14:00", "-11:00", "+01:00", "GMT", "Etc/UTC", "Etc/GMT+5", "America/New_York", "America/Los_Angeles",
  "America/Sao_Paulo", "America/St_Johns", "Europe/London", "Europe/Berlin", "Europe/Moscow", "Africa/Cairo", "Africa/Casablanca", "Asia/Kolkata", "Asia/Kathmandu",
  "Asia/Tokyo", "Asia/Tehran", "Asia/Shanghai", "Australia/Sydney", "Australia/Lord_Howe", "Pacific/Apia", "Pacific/Chatham", "Pacific/Kiritimati", "Antarctica/Troll",
];

function hourOptions(random: Random, options: Options) {
  const which = random.below(9);
  if (which < 4) options.hourCycle = ["h11", "h12", "h23", "h24"][which];
  else if (which < 6) options.hour12 = which === 4;
}

function dateTimeOptions(random: Random): Options | undefined {
  if (random.chance(0.03)) return undefined;
  const options: Options = {};
  if (random.chance(0.35)) {
    const styles = ["full", "long", "medium", "short"];
    if (random.chance(0.75)) options.dateStyle = random.pick(styles);
    if (!options.dateStyle || random.chance(0.6)) options.timeStyle = random.pick(styles);
  } else {
    const maybe = (name: string, probability: number, values: readonly (string | number)[]) => {
      if (random.chance(probability)) options[name] = random.pick(values);
    };
    maybe("weekday", 0.3, ["narrow", "short", "long"]);
    maybe("era", 0.06, ["narrow", "short", "long"]);
    maybe("year", 0.6, ["numeric", "2-digit"]);
    maybe("month", 0.65, ["numeric", "2-digit", "narrow", "short", "long"]);
    maybe("day", 0.6, ["numeric", "2-digit"]);
    maybe("dayPeriod", 0.05, ["narrow", "short", "long"]);
    maybe("hour", 0.45, ["numeric", "2-digit"]);
    maybe("minute", 0.4, ["numeric", "2-digit"]);
    maybe("second", 0.3, ["numeric", "2-digit"]);
    maybe("fractionalSecondDigits", 0.12, [1, 2, 3]);
    maybe("timeZoneName", 0.06, ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"]);
  }
  hourOptions(random, options);
  if (random.chance(0.85)) options.timeZone = random.pick(timeZones);
  if (random.chance(0.02)) options.calendar = random.pick(["gregory", "buddhist", "japanese", "islamic-civil", "hebrew", "iso8601", "roc", "persian", "chinese"]);
  if (random.chance(0.02)) options.numberingSystem = random.pick(["latn", "arab", "deva", "thai", "fullwide", "hanidec"]);
  if (random.chance(0.02)) options.formatMatcher = random.pick(["basic", "best fit"]);
  if (random.chance(0.02)) options.localeMatcher = random.pick(["lookup", "best fit"]);
  return options;
}

function numberOptions(random: Random): Options | undefined {
  if (random.chance(0.15)) return undefined;
  const options: Options = {};
  const style = random.below(10);
  if (style < 4) {
    options.style = "currency";
    options.currency = random.pick(["USD", "EUR", "JPY", "GBP", "INR", "CNY", "KRW", "CHF", "BRL", "RUB", "KWD", "BHD", "CLP", "CLF", "CVE", "XAF", "XXX", "MXN", "CAD", "AUD", "ILS", "SAR", "TRY", "PLN", "CZK", "HUF", "VND", "IDR", "ISK", "usd"]);
    if (random.chance(0.5)) options.currencyDisplay = random.pick(["symbol", "narrowSymbol", "code", "name"]);
    if (random.chance(0.25)) options.currencySign = random.pick(["standard", "accounting"]);
  } else if (style === 4) options.style = "percent";
  else if (style === 5) {
    options.style = "unit";
    options.unit = random.pick(["kilometer", "liter", "day", "kilometer-per-hour", "byte", "celsius", "percent", "second", "megabyte"]);
    if (random.chance(0.5)) options.unitDisplay = random.pick(["short", "narrow", "long"]);
  } else if (random.chance(0.3)) options.style = "decimal";
  if (random.chance(0.1)) {
    options.notation = random.pick(["standard", "scientific", "engineering", "compact"]);
    if (options.notation === "compact" && random.chance(0.5)) options.compactDisplay = random.pick(["short", "long"]);
  }
  if (random.chance(0.3)) options.useGrouping = random.pick([true, false, "always", "auto", "min2"]);
  if (random.chance(0.15)) options.signDisplay = random.pick(["auto", "always", "never", "exceptZero", "negative"]);
  if (random.chance(0.08)) options.minimumIntegerDigits = 1 + random.below(4);
  if (random.chance(0.35)) {
    const minimum = random.below(5);
    if (random.chance(0.7)) options.minimumFractionDigits = minimum;
    if (random.chance(0.8)) options.maximumFractionDigits = minimum + random.below(random.chance(0.1) ? 16 : 5);
  }
  if (random.chance(0.06)) {
    const minimum = 1 + random.below(4);
    if (random.chance(0.5)) options.minimumSignificantDigits = minimum;
    options.maximumSignificantDigits = minimum + random.below(6);
  }
  if (random.chance(0.08)) options.roundingMode = random.pick(["ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", "halfEven"]);
  if (random.chance(0.03)) options.roundingIncrement = random.pick([1, 2, 5, 10, 25, 50, 100]);
  if (random.chance(0.03)) options.roundingPriority = random.pick(["auto", "morePrecision", "lessPrecision"]);
  if (random.chance(0.05)) options.trailingZeroDisplay = random.pick(["auto", "stripIfInteger"]);
  if (random.chance(0.02)) options.numberingSystem = random.pick(["latn", "arab", "deva", "thai", "fullwide", "hanidec"]);
  return options;
}

const day = 86_400_000;

function timeValues(random: Random): number[] {
  const values: number[] = [NaN, Infinity, -Infinity, 8.64e15, 8.64e15 + 1, -8.64e15, 0, -0, -1, 1, 0.5, -0.5, 1e12 + 0.999];
  for (const year of [-271820, -1, 0, 1, 2, 9, 10, 99, 100, 101, 999, 1000, 1582, 1583, 1899, 1900, 1969, 1970, 1999, 2000, 2024, 2038, 2100, 9999, 10000, 99999, 100000, 275759]) {
    const start = new Date(0);
    start.setUTCFullYear(year, 0, 1);
    start.setUTCHours(0, 0, 0, 0);
    const first = start.getTime();
    values.push(first, first - 1, first + 1, first + 12 * 3_600_000, first + 12 * 3_600_000 - 1, first + 58 * day, first + 59 * day, first + 60 * day, first + 365 * day - 1);
  }
  for (let month = 0; month < 12; month++) values.push(Date.UTC(2024, month, 1), Date.UTC(2024, month, 1) - 1, Date.UTC(2023, month, 15, month * 2, month * 5, 59 - month, 999 - month * 83));
  for (let hour = 0; hour < 24; hour++) values.push(Date.UTC(2025, 5, 9 + (hour % 7), hour, 0, 0, 0), Date.UTC(2025, 5, 9, hour, 59, 59, 999));
  for (const transition of [Date.UTC(2024, 2, 10, 7), Date.UTC(2024, 10, 3, 6), Date.UTC(2024, 2, 31, 1), Date.UTC(2024, 9, 27, 1), Date.UTC(2011, 11, 30, 10), Date.UTC(2024, 3, 6, 15), Date.UTC(2024, 9, 5, 15, 30)])
    values.push(transition - 1, transition, transition + 1, transition + 3_600_000 - 1, transition + 3_600_000);
  for (let i = 0; i < 60; i++) values.push(Math.floor(-2_208_988_800_000 + random.next() * 6_311_433_600_000));
  for (let i = 0; i < 30; i++) values.push(Math.floor((random.next() * 2 - 1) * 8.64e15));
  return values;
}

function numberValues(random: Random): number[] {
  const values: number[] = [NaN, Infinity, -Infinity, 0, -0, 2 ** 53, 2 ** 53 - 1, 2 ** 53 + 2, -(2 ** 53), 2 ** 31, 2 ** 31 - 1, 2 ** 32, 1e21, 1e-7, 1e-6, 9.99e-7, 5e-324, 1.7976931348623157e308, 0.1 + 0.2, 1 / 3, 2 / 3];
  for (let power = 1; power < 1e17; power *= 10) values.push(power, power - 1, power + 1, -power, power * 5, power / 2);
  for (const numerator of [1, 4, 5, 6, 9, 15, 25, 35, 45, 49, 50, 51, 95, 99, 105, 125, 375, 995, 999, 1005, 1255, 2675, 8345, 9995, 99995])
    for (const scale of [10, 100, 1000, 10000, 100000]) values.push(numerator / scale, -numerator / scale, 1 + numerator / scale, 1234567 + numerator / scale);
  for (let i = 0; i < 40; i++) values.push(Math.floor(10 ** (random.next() * 16)) * (random.chance(0.3) ? -1 : 1));
  for (let i = 0; i < 60; i++) values.push((Math.floor(random.next() * 1e9) / 10 ** random.below(9)) * (random.chance(0.3) ? -1 : 1));
  for (let i = 0; i < 20; i++) values.push(10 ** (random.next() * 30 - 12));
  for (let i = 0; i < 60; i++) values.push((Math.floor(random.next() * 9e15) / 10 ** (1 + random.below(4))) * (random.chance(0.3) ? -1 : 1));
  for (let i = 0; i < 30; i++) values.push(Math.floor(random.next() * 1e12) + (2 * random.below(500) + 1) / 2 / 10 ** random.below(4));
  return values;
}

const canBeAllocated = (construct: () => unknown): boolean => {
  try {
    construct();
    return true;
  } catch {
    return false;
  }
};
const literal = (options: Options | undefined) => (options === undefined ? "" : ", " + JSON.stringify(options));
const number = (value: number) => (Object.is(value, -0) ? "-0" : String(value));

type Case = { kind: "DateTimeFormat" | "NumberFormat" | "toLocaleString" | "toLocaleDateString" | "toLocaleTimeString" | "number.toLocaleString"; tag: string; options: Options | undefined };

export function generateProgram(seed: number, formatters = 240): string {
  const random = new Random(seed);
  const locale = () => (random.chance(0.45) ? random.pick(localesWithTraps) : random.pick(locales));
  const list: Case[] = [];
  for (let i = 0; i < formatters; i++) {
    const kind = random.below(10);
    const tag = locale();
    if (kind < 5) list.push({ kind: "DateTimeFormat", tag, options: dateTimeOptions(random) });
    else if (kind < 8) list.push({ kind: "NumberFormat", tag, options: numberOptions(random) });
    else if (kind < 9) list.push({ kind: random.pick(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"] as const), tag, options: dateTimeOptions(random) });
    else list.push({ kind: "number.toLocaleString", tag, options: numberOptions(random) });
  }
  return programOf("seed " + seed, list, random);
}

// Every combination, not a sample: the date and time styles, the fields of a date, the fields of a time, each with every way to ask
// for an hour cycle where there is an hour, and the number options that have a pattern, for every locale.
function* product(choices: [string, readonly (string | number | boolean | undefined)[]][]): Generator<Options> {
  const indices = choices.map(() => 0);
  for (;;) {
    const options: Options = {};
    choices.forEach(([name, values], i) => {
      const value = values[indices[i]];
      if (value !== undefined) options[name] = value;
    });
    yield options;
    let i = 0;
    while (i < choices.length && ++indices[i] === choices[i][1].length) indices[i++] = 0;
    if (i === choices.length) return;
  }
}
const hourChoices: Options[] = [{}, { hourCycle: "h11" }, { hourCycle: "h12" }, { hourCycle: "h23" }, { hourCycle: "h24" }, { hour12: true }, { hour12: false }];
const styles = [undefined, "full", "long", "medium", "short"] as const;
const combinations: Omit<Case, "tag">[] = [];
for (const options of product([["dateStyle", styles], ["timeStyle", styles]]))
  for (const hour of options.timeStyle ? hourChoices : [{}]) if (options.dateStyle || options.timeStyle) combinations.push({ kind: "DateTimeFormat", options: { ...options, ...hour, timeZone: "UTC" } });
for (const options of product([["weekday", [undefined, "narrow", "short", "long"]], ["year", [undefined, "numeric", "2-digit"]], ["month", [undefined, "numeric", "2-digit", "narrow", "short", "long"]], ["day", [undefined, "numeric", "2-digit"]]]))
  combinations.push({ kind: "DateTimeFormat", options: { ...options, timeZone: "UTC" } });
for (const options of product([["hour", [undefined, "numeric", "2-digit"]], ["minute", [undefined, "numeric", "2-digit"]], ["second", [undefined, "numeric", "2-digit"]], ["fractionalSecondDigits", [undefined, 1, 2, 3]]]))
  for (const hour of options.hour ? hourChoices : [{}]) combinations.push({ kind: "DateTimeFormat", options: { ...options, ...hour, timeZone: "UTC" } });
for (const options of product([["month", ["numeric", "short", "long"]], ["day", ["numeric", "2-digit"]], ["year", [undefined, "numeric"]], ["weekday", [undefined, "short"]], ["hour", ["numeric", "2-digit"]], ["minute", ["2-digit"]], ["second", [undefined, "2-digit"]]]))
  for (const hour of hourChoices) combinations.push({ kind: "DateTimeFormat", options: { ...options, ...hour, timeZone: "UTC" } });
const fractions: Options[] = [{}, { maximumFractionDigits: 0 }, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, { minimumFractionDigits: 0, maximumFractionDigits: 3 }, { minimumFractionDigits: 1, maximumFractionDigits: 5 }];
const numberStyles: Options[] = [{}, { style: "percent" }];
for (const currency of ["USD", "EUR", "JPY", "INR"])
  for (const currencyDisplay of ["symbol", "narrowSymbol", "code"]) for (const currencySign of ["standard", "accounting"]) numberStyles.push({ style: "currency", currency, currencyDisplay, currencySign });
for (const style of numberStyles)
  for (const useGrouping of [undefined, true, false, "always", "auto", "min2"])
    for (const fraction of fractions) combinations.push({ kind: "NumberFormat", options: { ...style, ...(useGrouping === undefined ? {} : { useGrouping }), ...fraction } });
for (const minimumIntegerDigits of [2, 3, 4])
  for (const useGrouping of [undefined, false]) for (const fraction of fractions) combinations.push({ kind: "NumberFormat", options: { minimumIntegerDigits, ...(useGrouping === undefined ? {} : { useGrouping }), ...fraction } });

export const numberOfSweepPrograms = (formatters = 240) => Math.ceil((combinations.length * locales.length) / formatters);

export function generateSweepProgram(index: number, formatters = 240): string {
  const list: Case[] = [];
  for (let i = index * formatters; i < (index + 1) * formatters && i < combinations.length * locales.length; i++)
    list.push({ ...combinations[i % combinations.length], tag: locales[Math.floor(i / combinations.length)] });
  return programOf("part " + index + " of the sweep", list, new Random(index));
}

// Of the sweep's formatters, the share that has a pattern: 83.9% with ICU 78.3. sweep.ts fails below this.
export const expectedShareWithAPattern = 0.83;

// What programs usually ask for, in common locales. All but three of these have a pattern, and intl-fuzz.test.ts says so: a new ICU
// that takes the pattern from some of them makes those slower without a wrong text, which nothing else would notice.
// The three: zh-TW writes a time style with a flexible day period (pattern letter B: six names a day), which the writer does not know.
const commonLocales = ["en-US", "en-GB", "en-CA", "en-AU", "en-IN", "de", "de-AT", "de-CH", "fr", "fr-CA", "es", "es-MX", "es-419", "it", "pt-BR", "pt-PT", "nl", "sv", "da", "nb", "fi", "pl", "cs", "sk", "hu", "ro", "bg", "hr", "sl", "lt", "lv", "et", "el", "tr", "ru", "uk", "he", "id", "ms", "vi", "ja", "ko", "zh-CN", "zh-TW", "zh-HK"];
const usualRequests: Omit<Case, "tag">[] = [
  { kind: "DateTimeFormat", options: undefined },
  { kind: "DateTimeFormat", options: { dateStyle: "medium" } },
  { kind: "DateTimeFormat", options: { dateStyle: "long" } },
  { kind: "DateTimeFormat", options: { dateStyle: "short", timeStyle: "short" } },
  { kind: "DateTimeFormat", options: { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" } },
  { kind: "DateTimeFormat", options: { year: "numeric", month: "long", day: "numeric" } },
  { kind: "DateTimeFormat", options: { year: "numeric", month: "2-digit", day: "2-digit" } },
  { kind: "DateTimeFormat", options: { month: "short", day: "numeric" } },
  { kind: "DateTimeFormat", options: { weekday: "long" } },
  { kind: "DateTimeFormat", options: { hour: "numeric", minute: "2-digit" } },
  { kind: "DateTimeFormat", options: { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false } },
  { kind: "DateTimeFormat", options: { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" } },
  { kind: "toLocaleString", options: undefined },
  { kind: "toLocaleDateString", options: undefined },
  { kind: "toLocaleDateString", options: { year: "numeric", month: "short", day: "numeric" } },
  { kind: "toLocaleTimeString", options: undefined },
  { kind: "toLocaleTimeString", options: { hour: "2-digit", minute: "2-digit" } },
  { kind: "NumberFormat", options: undefined },
  { kind: "NumberFormat", options: { maximumFractionDigits: 2 } },
  { kind: "NumberFormat", options: { minimumFractionDigits: 2, maximumFractionDigits: 2 } },
  { kind: "NumberFormat", options: { maximumFractionDigits: 0 } },
  { kind: "NumberFormat", options: { useGrouping: false } },
  { kind: "NumberFormat", options: { minimumIntegerDigits: 2 } },
  { kind: "NumberFormat", options: { style: "currency", currency: "USD" } },
  { kind: "NumberFormat", options: { style: "currency", currency: "EUR" } },
  { kind: "NumberFormat", options: { style: "currency", currency: "JPY" } },
  { kind: "NumberFormat", options: { style: "currency", currency: "USD", maximumFractionDigits: 0 } },
  { kind: "NumberFormat", options: { style: "percent" } },
  { kind: "NumberFormat", options: { style: "percent", maximumFractionDigits: 1 } },
  { kind: "number.toLocaleString", options: undefined },
  { kind: "number.toLocaleString", options: { maximumFractionDigits: 1 } },
  { kind: "number.toLocaleString", options: { style: "currency", currency: "USD" } },
];
// One build plans at most 256 formatters (the limit MaxConstantFormatterRequests).
const localesInATypicalProgram = 8;
export const numberOfTypicalPrograms = Math.ceil(commonLocales.length / localesInATypicalProgram);
export const typicalFormattersWithoutAPattern = [0, 0, 0, 0, 0, 3];

export function generateTypicalProgram(part: number): string {
  const list: Case[] = [];
  for (const tag of commonLocales.slice(part * localesInATypicalProgram, (part + 1) * localesInATypicalProgram)) for (const request of usualRequests) list.push({ ...request, tag });
  return programOf("part " + part + " of what programs usually ask for", list, new Random(part));
}

function programOf(label: string, list: Case[], random: Random): string {
  const lines: string[] = [];
  const cases: string[] = [];
  list.forEach(({ kind, tag, options }, i) => {
    const data = JSON.stringify(JSON.stringify([tag, options ?? null]));
    if (kind === "DateTimeFormat" || kind === "NumberFormat") {
      const construction = `new Intl.${kind}(${JSON.stringify(tag)}${literal(options)})`;
      lines.push(`const f${i} = ${canBeAllocated(() => new Intl[kind](tag, options)) ? construction : `make(() => ${construction})`};`);
      cases.push(`[${JSON.stringify(kind)}, (value: any) => f${i}!.format(value), f${i}, ${data}]`);
    } else if (kind === "number.toLocaleString") {
      lines.push(`function f${i}(value: number): string {\n  return value.toLocaleString(${JSON.stringify(tag)}${literal(options)});\n}`);
      cases.push(`["number.toLocaleString", (value: any) => f${i}(value), true, ${data}]`);
    } else {
      lines.push(`function f${i}(date: Date): string {\n  return date.${kind}(${JSON.stringify(tag)}${literal(options)});\n}`);
      cases.push(`[${JSON.stringify(kind)}, (value: any) => f${i}(new Date(value)), true, ${data}]`);
    }
  });
  return `// Generated by test/aot/intl-fuzz/generate.ts, ${label}.
function make<T>(construct: () => T): T | null {
  try {
    return construct();
  } catch {
    return null;
  }
}
const say = (run: () => unknown): string => {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).name;
  }
};
${lines.join("\n")}
const cases: [string, (value: any) => string, unknown, string][] = [
  ${cases.join(",\n  ")},
];
const timeValues: number[] = [${timeValues(random).map(number).join(", ")}];
const numberValues: number[] = [${numberValues(random).map(number).join(", ")}];
let comparisons = 0;
let differences = 0;
for (const [kind, format, made, text] of cases) {
  const [locale, options] = JSON.parse(text);
  const given = options ?? undefined;
  const formatsDates = kind !== "NumberFormat" && kind !== "number.toLocaleString";
  let throughICU: (value: any) => unknown;
  if (kind === "DateTimeFormat" || kind === "NumberFormat") {
    const twin: any = make(() => (formatsDates ? new Intl.DateTimeFormat(locale, given) : new Intl.NumberFormat(locale, given)));
    comparisons++;
    if ((twin === null) !== (made === null)) {
      differences++;
      console.log("DIFFERENT", kind, text, "one of the two cannot be made");
    }
    if (twin === null || made === null) continue;
    throughICU = value => twin.format(value);
    const sample = formatsDates ? timeValues[40 + (comparisons % 100)] : numberValues[40 + (comparisons % 100)];
    const views: [string, (formatter: any) => unknown][] = [
      ["format before anything else", formatter => formatter.format(sample)],
      ["formatToParts", formatter => JSON.stringify(formatter.formatToParts(sample))],
      ["resolvedOptions", formatter => JSON.stringify(formatter.resolvedOptions())],
      ["formatRange", formatter => formatter.formatRange(sample, sample + 90_000_000)],
    ];
    for (const [view, look] of views) {
      comparisons++;
      const got = say(() => look(made));
      const expected = say(() => look(twin));
      if (got !== expected && ++differences <= 20) console.log("DIFFERENT", kind, text, view, sample, JSON.stringify(got), JSON.stringify(expected));
    }
  } else if (formatsDates) throughICU = value => (new Date(value) as any)[kind](locale, given);
  else throughICU = value => value.toLocaleString(locale, given);
  for (const value of formatsDates ? timeValues : numberValues) {
    comparisons++;
    const got = say(() => format(value));
    const expected = say(() => throughICU(value));
    if (got === expected) continue;
    if (++differences <= 20) console.log("DIFFERENT", kind, text, Object.is(value, -0) ? "-0" : value, JSON.stringify(got), JSON.stringify(expected));
  }
  if (kind !== "DateTimeFormat") continue;
  for (const value of timeValues) {
    comparisons++;
    const got = say(() => format(new Date(value)));
    const expected = say(() => throughICU(new Date(value)));
    if (got !== expected && ++differences <= 20) console.log("DIFFERENT", kind, text, "a Date of", value, JSON.stringify(got), JSON.stringify(expected));
  }
}
console.log(comparisons + " comparisons, " + differences + " differences");
`;
}

if (import.meta.main) {
  const [which = "1", size = "240"] = process.argv.slice(2);
  if (which === "sweep") console.log(numberOfSweepPrograms());
  else if (which.startsWith("typical:")) console.log(generateTypicalProgram(Number(which.slice(8))));
  else console.log(which.startsWith("sweep:") ? generateSweepProgram(Number(which.slice(6)), Number(size)) : generateProgram(Number(which), Number(size)));
}
