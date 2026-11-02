// `formatter.format` answers one function, which the formatter keeps and which is bound to it. The compiler follows a call of it to the formatter, so a formatter whose `format` is called is not taken for
// an object that anybody may have changed, and code that runs once, which gets no test, formats in line too.
// IRM= 0 PropGet v[0-9]+ key="format"
// IRM= 0 IsPristine
// IR- IsPristine v[0-9]+ builtinClass=Intl
// IR= 1 formatChangedOnce PropGet v[0-9]+ key="format"
const count = new Intl.NumberFormat("en-US");
const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const say = run => {
  try {
    return String(run());
  } catch (error) {
    return "throws " + error.name + (error.note ? " " + error.note : "");
  }
};
function formatOnce(n) {
  return count.format(n + 0.5);
}
function formatDayOnce(time) {
  return day.format(time * 86_400_000);
}
console.log(formatOnce(1234), formatDayOnce(1));

// A formatter that has got a `format` of its own is asked for that.
const changed = new Intl.NumberFormat("en-US");
Object.defineProperty(changed, "format", { value: n => "own " + n, configurable: true });
function formatChangedOnce(n) {
  return changed.format(n + 0.5);
}
console.log(formatChangedOnce(1234));

// One function for each formatter, the same at every read. What is stored on it at one read is there at the next.
const other = new Intl.NumberFormat("de-DE");
console.log(count.format === count.format, count.format === other.format, typeof count.format, count.format.name === "", count.format.length);
count.format.tag = "tagged";
console.log(count.format.tag, other.format.tag, Object.keys(count.format).join());
function tagOf(formatter) {
  return formatter.format.tag;
}
console.log(tagOf(count), tagOf(other));
console.log(Object.getPrototypeOf(count.format) === Function.prototype, "prototype" in count.format, say(() => new count.format(1)));

// It formats with its own formatter, whoever calls it and on whatever.
const format = other.format;
const spare = new Intl.NumberFormat("en-IN");
console.log(format(1234.5), format.call(spare, 1234.5), format.apply(null, [1234.5]), Reflect.apply(format, day, [1234.5]), format.bind(spare)(1234.5), spare.format(1234567.5));
console.log([1, 2000, 3000000].map(other.format).join(" "), [0, 1].map(day.format).join(" "));
function makeFormat(locale) {
  return new Intl.NumberFormat(locale).format;
}
console.log(makeFormat("fr-FR")(1234.5).length, makeFormat("en-IN")(1234567.5));
globalThis.handedOut = count.format;
console.log(globalThis.handedOut(7777));

// The argument is converted by its own code, which runs, and what it throws comes out.
let conversions = 0;
const converted = {
  valueOf() {
    conversions++;
    return 4321;
  },
  neverAsked: "no",
};
console.log(count.format(converted), conversions, format(converted), conversions);
class Refusal extends Error {
  note = "from the argument";
}
const refusing = {
  [Symbol.toPrimitive]() {
    throw new Refusal("no");
  },
};
console.log(say(() => count.format(refusing)), say(() => day.format(refusing)), say(() => count.format(Symbol.iterator)), say(() => day.format(10n)), count.format(10n), count.format("12.5"), count.format());
const written = { seen: 0 };
console.log(count.format({ valueOf: () => (written.seen = 5) }), written.seen);
const later = new Date(86_400_000);
later.valueOf = () => 0;
console.log(day.format(later), day.format(new Date(86_400_000)), say(() => day.format(new Date(NaN))));
globalThis.kept = [formatOnce, formatDayOnce, formatChangedOnce, tagOf, makeFormat];
