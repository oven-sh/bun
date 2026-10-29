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

interface Numbers {
  length: number;
  [index: number]: number;
  fill(value: number, start?: number, end?: number): Numbers;
  indexOf(value: number): number;
  includes(value: number): boolean;
  join(separator?: string): string;
  reverse(): Numbers;
  slice(start?: number, end?: number): Numbers;
  sort(): Numbers;
  at(index: number): number | undefined;
  [Symbol.iterator](): Iterator<number>;
}

function list(numbers: Numbers): unknown[] {
  const seen: unknown[] = [];
  for (let i = 0; i < numbers.length; i++) seen.push(i in numbers ? numbers[i] : "absent");
  return seen;
}

function store(numbers: Numbers, index: number, value: number): unknown[] {
  numbers[index] = value;
  return [numbers[index], numbers.length, list(numbers)];
}

function sum(numbers: Numbers): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function increment(numbers: Numbers, index: number): unknown[] {
  numbers[index]++;
  return [numbers[index], list(numbers)];
}

const uses: [string, (numbers: Numbers) => unknown][] = [
  ["list", list],
  ["sum", sum],
  ["store 300 at 0", numbers => store(numbers, 0, 300)],
  ["store -1 at 0", numbers => store(numbers, 0, -1)],
  ["store 1.5 at 0", numbers => store(numbers, 0, 1.5)],
  ["store NaN at 0", numbers => store(numbers, 0, NaN)],
  ["store -0 at 0", numbers => store(numbers, 0, -0)],
  ["store 2 ** 32 + 1 at 0", numbers => store(numbers, 0, 2 ** 32 + 1)],
  ["store past the end", numbers => store(numbers, 5, 7)],
  ["store at -1", numbers => store(numbers, -1, 7)],
  ["store at 1.5", numbers => store(numbers, 1.5, 7)],
  ["++ at 1", numbers => increment(numbers, 1)],
  ["++ past the end", numbers => increment(numbers, 9)],
  ["read past the end", numbers => [numbers[3], numbers[3] + 1, 3 in numbers]],
  ["default sort", numbers => list(numbers.sort())],
  ["fill", numbers => list(numbers.fill(7.5, 1))],
  ["reverse is in place", numbers => numbers.reverse() === numbers],
  ["slice", numbers => [list(numbers.slice(1)), numbers.slice().constructor.name]],
  ["join", numbers => numbers.join("/")],
  ["indexOf and includes NaN", numbers => (store(numbers, 0, NaN), [numbers.indexOf(NaN), numbers.includes(NaN)])],
  ["at(-1)", numbers => numbers.at(-1)],
  ["spread", numbers => [...numbers]],
  ["the length is stored to", numbers => {
    numbers.length = 1;
    return [numbers.length, list(numbers)];
  }],
  ["isArray, typeof", numbers => [Array.isArray(numbers), typeof numbers]],
  ["JSON", numbers => JSON.stringify(numbers)],
  ["keys", numbers => Object.keys(numbers)],
];

const makers: [string, () => Numbers][] = [
  ["an array", () => [10, 9, 100]],
  ["an array of doubles", () => [10.5, 9.5, 100.5]],
  ["Uint8Array", () => new Uint8Array([10, 9, 100])],
  ["Int8Array", () => new Int8Array([10, 9, 100])],
  ["Uint8ClampedArray", () => new Uint8ClampedArray([10, 9, 100])],
  ["Int32Array", () => new Int32Array([10, 9, 100])],
  ["Uint32Array", () => new Uint32Array([10, 9, 100])],
  ["Float32Array", () => new Float32Array([10.5, 9.5, 100.5])],
  ["Float64Array", () => new Float64Array([10.5, 9.5, 100.5])],
];

for (const [, use] of uses) for (let i = 0; i < 300; i++) use([10, 9, i]);
console.log("after 300 arrays at every use");

for (const [name, make] of makers) for (const [use, run] of uses) attempt(name + ": " + use, () => run(make()));
