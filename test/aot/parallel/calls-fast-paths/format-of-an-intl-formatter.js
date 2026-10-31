// `formatter.format(value)`: `format` is an accessor that answers a function bound to the formatter. Where the formatter has its names, the call formats without the read and without a call of a function,
// and goes by what the read found, whatever the arguments do to the formatter afterwards.
const count = new Intl.NumberFormat("en-US");
const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" });
const say = run => {
  try {
    return String(run());
  } catch (error) {
    return "throws " + error.name + ": " + error.message;
  }
};

function formatCount(n) {
  return count.format(n + 0.5);
}
function lengthOfCount(n) {
  const text = count.format(n + 0.5);
  return text.length + 1;
}
function formatTime(time) {
  return day.format(time * 1000);
}
function formatNewDate(time) {
  return day.format(new Date(time * 1000));
}
for (const n of [0, 1, -1, 999, 1000, 1234567, 1e21, NaN, Infinity, -0]) console.log(formatCount(n), lengthOfCount(n), say(() => formatTime(n)), say(() => formatNewDate(n)));

// The read comes first, then the arguments, then the call.
const changed = new Intl.NumberFormat("de-DE");
function formatWith(argument) {
  return changed.format(argument());
}
const ownFormat = { value: () => "own format", configurable: true };
console.log(formatWith(() => 1234.5));
console.log(formatWith(() => (Object.defineProperty(changed, "format", ownFormat), 2345.5)));
console.log(formatWith(() => 3456.5));
console.log(formatWith(() => (delete changed.format, 4567.5)));
console.log(formatWith(() => 5678.5));
console.log(formatWith(() => (Object.setPrototypeOf(changed, { format: () => "inherited format" }), 6789.5)));
console.log(formatWith(() => 7890.5));
console.log(formatWith(() => (Object.setPrototypeOf(changed, Intl.NumberFormat.prototype), 8901.5)));
console.log(formatWith(() => 9012.5));

// A name that shadows nothing changes nothing. The function is the same at every read, and it is bound.
const named = new Intl.NumberFormat("fr-FR");
named.label = "french";
function formatNamed(n) {
  return named.format(n + 0.25);
}
console.log(formatNamed(1234), named.format === named.format, typeof named.format, named.format.name === "", named.format.length);
function formatLater(n) {
  const format = count.format;
  return format(n + 0.125) + " " + format.call(named, n + 0.125) + " " + [n, n + 1].map(format).join(" ");
}
console.log(formatLater(4321));

class Rounded extends Intl.NumberFormat {
  constructor() {
    super("en-US", { maximumFractionDigits: 0 });
  }
}
class Shouting extends Intl.NumberFormat {
  get format() {
    return n => super.format(n) + "!";
  }
}
const rounded = new Rounded();
const shouting = new Shouting("en-US");
function formatBySubclass(n) {
  return rounded.format(n + 0.75) + " " + shouting.format(n + 0.75);
}
console.log(formatBySubclass(1000), formatBySubclass(2000));

// A date is asked for its time as ToNumber asks it.
function formatDate(date) {
  return day.format(date);
}
class LaterDate extends Date {
  valueOf() {
    return super.valueOf() + 86_400_000;
  }
}
const dates = [
  () => new Date(0),
  () => new Date(1_700_000_000_000),
  () => new Date(NaN),
  () => new LaterDate(0),
  () => Object.assign(new Date(0), { valueOf: () => 86_400_000 * 2 }),
  () => Object.defineProperty(new Date(0), Symbol.toPrimitive, { value: () => 86_400_000 * 3 }),
  () => Object.setPrototypeOf(new Date(0), null),
  () => Object.assign(new Date(0), { label: "epoch" }),
  () => 86_400_000 * 4,
  () => "86400000",
  () => null,
  () => ({ valueOf: () => 86_400_000 * 5 }),
  () => 10n,
  () => Symbol.iterator,
];
for (const make of dates) console.log(say(() => formatDate(make())));
console.log(typeof formatDate(undefined), typeof day.format());

// Whoever is no formatter is refused in front of the arguments.
function formatOn(receiver, argument) {
  return receiver.format(argument());
}
const steps = [];
for (const receiver of [count, day, Object.create(Intl.NumberFormat.prototype), Intl.DateTimeFormat.prototype, { format: n => "plain " + n }, null])
  console.log(say(() => formatOn(receiver, () => (steps.push("argument"), 5))), steps.length);
globalThis.kept = [formatCount, lengthOfCount, formatTime, formatNewDate, formatWith, formatNamed, formatLater, formatBySubclass, formatDate, formatOn];
