function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

function inspect(numbers: number[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const value = numbers[i];
    const exact = Object.is(value, undefined) ? "undefined" : Object.is(value, 0) ? "zero" : Object.is(value, -0) ? "minus zero" : Object.is(value, NaN) ? "not a number" : String(value);
    lines.push(i + " " + (i in numbers ? "present" : "absent") + " " + typeof value + " " + exact);
  }
  return lines;
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function sumByForOf(numbers: number[]): number {
  let total = 0;
  for (const number of numbers) total += number;
  return total;
}

function sumAsIntegers(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total = (total + numbers[i]) | 0;
  return total;
}

function doubled(numbers: number[]): number[] {
  return numbers.map(number => number * 2);
}

function doubledByHand(numbers: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < numbers.length; i++) result.push(numbers[i] * 2);
  return result;
}

function report(name: string, make: () => number[]): void {
  attempt(name + ": elements", () => inspect(make()));
  attempt(name + ": length", () => make().length);
  attempt(name + ": sum", () => sum(make()));
  attempt(name + ": sum by for-of", () => sumByForOf(make()));
  attempt(name + ": sum as integers", () => sumAsIntegers(make()));
  attempt(name + ": map", () => doubled(make()));
  attempt(name + ": doubled by hand", () => doubledByHand(make()));
  attempt(name + ": the first, fixed", () => make()[0].toFixed(1));
  attempt(name + ": after a push", () => {
    const numbers = make();
    const length = numbers.push(7);
    return [length, inspect(numbers), sum(numbers)];
  });
  attempt(name + ": after a store at 1", () => {
    const numbers = make();
    numbers[1] = 1.5;
    return [inspect(numbers), sum(numbers)];
  });
  attempt(name + ": keys", () => Object.keys(make()));
  attempt(name + ": JSON", () => JSON.stringify(make()));
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  for (const dense of [[i, 2, 3], [i + 0.5, 2.5, 3.5]]) {
    warm += inspect(dense).length + sum(dense) + sumByForOf(dense) + sumAsIntegers(dense) + doubled(dense)[0] + doubledByHand(dense)[1];
  }
}
console.log("after 4000 dense arrays", warm);

function bitsToDouble(high: number, low: number): number {
  const words = new Uint32Array([low, high]);
  return new Float64Array(words.buffer)[0];
}

function bitsOf(value: number): string {
  const words = new Uint32Array(new Float64Array([value]).buffer);
  return Number.isNaN(value) ? "some NaN" : words[1].toString(16) + ":" + words[0].toString(16);
}

const oddNaNs: [string, number][] = [
  ["the usual NaN", NaN],
  ["0 / 0", bitsToDouble(0, 0) / bitsToDouble(0, 0)],
  ["a negative quiet NaN", bitsToDouble(0xfff80000, 0)],
  ["a NaN with a payload", bitsToDouble(0x7ff80000, 1)],
  ["a NaN with every bit set", bitsToDouble(0xffffffff, 0xffffffff)],
  ["a NaN that looks like a boxed integer", bitsToDouble(0xfffe0000, 42)],
  ["a NaN that looks like a pointer tag", bitsToDouble(0xfffc0000, 0x1000)],
  ["a signaling NaN", bitsToDouble(0x7ff00000, 1)],
  ["a NaN from a Float32Array", new Float32Array(new Uint32Array([0x7fc00001]).buffer)[0]],
];

class Reading {
  before = 1.5;
  value: number;
  after = 2.5;
  constructor(value: number) {
    this.value = value;
  }
}

function hold(value: number): () => number {
  return () => value;
}

for (const [name, value] of oddNaNs) {
  attempt(name + ": itself", () => [typeof value, value, value === value, Number.isNaN(value), Object.is(value, NaN), bitsOf(value)]);
  attempt(name + ": in an array of doubles", () => {
    const numbers = [1.5, value, 2.5];
    return [inspect(numbers), 1 in numbers, sum(numbers), numbers.includes(NaN), numbers.indexOf(value)];
  });
  attempt(name + ": pushed", () => {
    const numbers: number[] = [0.5];
    numbers.push(value);
    return [inspect(numbers), Object.keys(numbers)];
  });
  attempt(name + ": stored over a hole", () => {
    const numbers = new Array<number>(2);
    numbers[0] = 0.5;
    numbers[1] = value;
    return inspect(numbers);
  });
  attempt(name + ": beside a hole", () => {
    const numbers = [0.5, value, 1.5];
    delete numbers[0];
    return [inspect(numbers), numbers.map(number => typeof number)];
  });
  attempt(name + ": in a field", () => {
    const reading = new Reading(value);
    return [reading.before, typeof reading.value, reading.value, reading.after, JSON.stringify(reading)];
  });
  attempt(name + ": captured, returned, boxed", () => {
    const boxed: {} = hold(value)();
    const list: {}[] = [boxed];
    return [typeof boxed, boxed, typeof list[0], new Map<string, number>([["k", value]]).get("k")];
  });
  attempt(name + ": arithmetic", () => [value + 1, value * 0, value | 0, value >>> 0, Math.max(value, 1), value < 1, value > 1, value ? "truthy" : "falsy"]);
}

report("copied out of a Float64Array", () => Array.from(new Float64Array(new Uint32Array([1, 0x7ff80000, 42, 0xfffe0000, 0, 0x3ff80000]).buffer)));
report("copied by a loop", () => {
  const doubles = new Float64Array(new Uint32Array([0xffffffff, 0xffffffff, 42, 0xfffe0000, 0, 0x3ff80000]).buffer);
  const numbers: number[] = [];
  for (let i = 0; i < doubles.length; i++) numbers.push(doubles[i]);
  return numbers;
});
report("read by a DataView", () => {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, 0xfffe0000);
  view.setUint32(4, 7);
  return [view.getFloat64(0), 1.5, view.getFloat64(0)];
});
