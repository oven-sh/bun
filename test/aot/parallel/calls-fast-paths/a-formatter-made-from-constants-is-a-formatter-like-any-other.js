// A formatter made from constants and toLocaleString with constant arguments write from a pattern of the build, and a program sees nothing of it.
// IR= 1 makeDates  = NewFormatterWithPattern
// IR= 1 makeNumbers  = NewFormatterWithPattern
// IR= 1 makeLocalTimes  = NewFormatterWithPattern
// CALLS+ grouped operationAOTFormatWithPattern
// CALLS+ shortDate operationAOTFormatWithPattern
function makeDates() {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}
function makeNumbers() {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
}
function makeLocalTimes() {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric" });
}
function grouped(value) {
  return Number(value).toLocaleString("en-US");
}
function shortDate(time) {
  return new Date(time).toLocaleDateString("en-GB", { timeZone: "UTC" });
}
const say = run => {
  try {
    return run();
  } catch (error) {
    return "throws " + error.name;
  }
};
const eightOf = text => [text, text, text, text, text, text, text, text];

const dates = makeDates();
const numbers = makeNumbers();
console.log(eightOf(grouped(1234.5)));
console.log(eightOf(shortDate(5e11)));
console.log(eightOf(numbers.format(1234.5)));
console.log(eightOf(dates.format(5e11)));

for (const formatter of [dates, numbers]) {
  const format = formatter.format;
  console.log(typeof format, JSON.stringify(format.name), format.length, format === formatter.format, Object.getOwnPropertyNames(format).sort().join());
  console.log(Object.getPrototypeOf(format) === Function.prototype, "prototype" in format, String(format), Bun.inspect(format));
  console.log([0, 34_603_200_000.5, 1e12].map(format));
  console.log(format.call(null, 7), format.apply({}, [1e12]), Reflect.apply(format, undefined, [5e11, "ignored"]), format.bind(null, 12)(13));
  console.log(say(() => new format(0)));
  console.log(Reflect.ownKeys(formatter).length, JSON.stringify(formatter), Bun.inspect(formatter), Object.isFrozen(Object.preventExtensions(formatter)));
}

console.log(dates.formatToParts(5e11).map(part => part.type + "=" + part.value).join("|"));
console.log(dates.formatRange(0, 86_400_000 * 40), JSON.stringify(dates.resolvedOptions()));
console.log(numbers.formatToParts(-1234.5).map(part => part.type + "=" + part.value).join("|"));
console.log(numbers.formatRange(1, 2), JSON.stringify(numbers.resolvedOptions()));

for (const value of [NaN, Infinity, -1e15, 8.64e15, 8.64e15 + 1, -62_135_596_800_001, null, true, "5", new Date(5e11), { valueOf: () => 5e11 }, 5n, Symbol.iterator])
  console.log("date", typeof value, say(() => dates.format(value)));
for (const value of [NaN, -Infinity, -0, 1e21, 9007199254740993, 1e-7, 0.005, 1.005, null, true, "12.5", "x", 12n, 10n ** 30n, { valueOf: () => 7 }, undefined, Symbol.iterator])
  console.log("number", typeof value, say(() => numbers.format(value)));
console.log(say(() => dates.format({ valueOf() { throw new RangeError("asked"); } })), say(() => numbers.format({ valueOf() { throw new EvalError("asked"); } })));

const withAProperty = makeDates();
withAProperty.extra = 1;
console.log(withAProperty.format(5e11), Object.keys(withAProperty).join(), Object.freeze(makeNumbers()).format(5));
console.log(makeDates().format !== makeDates().format, Intl.DateTimeFormat.prototype.formatToParts.call(makeDates(), 0).length);
console.log(say(() => Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format").get.call(makeNumbers())));

process.env.TZ = "Asia/Tokyo";
const madeInTokyo = makeLocalTimes();
console.log(madeInTokyo.format(0), madeInTokyo.resolvedOptions().timeZone);
process.env.TZ = "America/New_York";
console.log(madeInTokyo.format(0), makeLocalTimes().format(0), madeInTokyo.resolvedOptions().timeZone, makeLocalTimes().resolvedOptions().timeZone);
globalThis.kept = [makeDates, makeNumbers, makeLocalTimes, grouped, shortDate];
