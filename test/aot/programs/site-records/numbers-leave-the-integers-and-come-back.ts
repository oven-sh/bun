// A field declared `number` starts with a small integer. Honest stores then bring fractions, minus zero, NaN, infinities and integers beyond 32 and 53 bits, and small integers again. Each value is read back exactly, by typed reads, updates and copies.
class Meter {
  reading = 0;
  label = "meter";
  total = 0;
}
class FractionMeter {
  reading = 0.5;
  label = "fractions";
  total = 0.25;
}

function show(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}
function readingOf(meter: Meter): number {
  return meter.reading;
}
function setReading(meter: Meter, value: number): void {
  meter.reading = value;
}
function accumulate(meter: Meter): number {
  return (meter.total += meter.reading);
}
function increment(meter: Meter): number {
  return ++meter.reading;
}
function negate(meter: Meter): number {
  return (meter.reading = -meter.reading);
}
function halve(meter: Meter): number {
  return (meter.reading /= 2);
}
function toInteger(meter: Meter): number {
  return (meter.reading |= 0);
}
function copy(meter: Meter): Meter {
  return { reading: meter.reading, label: meter.label, total: meter.total };
}

const values = [0, 1, -1, 2 ** 30, 2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32, 2 ** 52, 2 ** 53, 2 ** 53 + 2, 0.5, -0.5, 1e-300, 1e300, -0, NaN, Infinity, -Infinity, Number.MIN_VALUE, Number.MAX_VALUE, 3];

function exercise(mark: string, make: () => Meter): void {
  const reused = make();
  for (const value of values) {
    const fresh = make();
    setReading(fresh, value);
    setReading(reused, value);
    const copied = copy(fresh);
    console.log(
      mark,
      show(value) + ":",
      show(readingOf(fresh)),
      show(readingOf(reused)),
      show(readingOf(copied)),
      Object.is(readingOf(fresh), value),
      "| total",
      show(accumulate(reused)),
      "| ++",
      show(increment(fresh)),
      "| -",
      show(negate(fresh)),
      "| /2",
      show(halve(fresh)),
      "| |0",
      show(toInteger(fresh)),
      show(readingOf(fresh)),
      fresh.label,
      JSON.stringify(copied),
    );
  }
  setReading(reused, 7);
  console.log(mark, "at last:", show(readingOf(reused)), show(increment(reused)), reused.label, Object.keys(reused).join());
}

exercise("integers first", () => new Meter());
exercise("fractions first", () => new FractionMeter());
exercise("literal", () => ({ reading: 0, label: "literal", total: 0 }));
exercise("parsed", () => JSON.parse('{"total":0,"label":"parsed","reading":0}'));

const list: Meter[] = [new Meter(), new FractionMeter(), { reading: 1, label: "l", total: 1 }];
let sum = 0;
for (const meter of list) {
  setReading(meter, readingOf(meter) + 2 ** 31);
  sum += readingOf(meter);
  setReading(meter, readingOf(meter) - 2 ** 31);
  sum += readingOf(meter);
}
console.log(sum, JSON.stringify(list));

export {};
