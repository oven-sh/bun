// Built ins over arrays of numbers with holes.
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

function holey(): number[] {
  const numbers = new Array<number>(4);
  numbers[0] = 3;
  numbers[2] = 1;
  return numbers;
}

function allHoles(): number[] {
  return new Array<number>(2);
}

const uses: [string, (numbers: number[]) => unknown][] = [
  ["Math.max", numbers => Math.max(...numbers)],
  ["Math.min.apply", numbers => Math.min.apply(null, numbers)],
  ["reduce", numbers => numbers.reduce((total, number) => total + number, 0)],
  ["reduce without a start", numbers => numbers.reduce((total, number) => total + number)],
  ["reduceRight", numbers => numbers.reduceRight((total, number) => total + number, 0)],
  ["visits of forEach", numbers => {
    const seen: number[] = [];
    numbers.forEach((_, index) => seen.push(index));
    return seen;
  }],
  ["map", numbers => inspect(numbers.map(number => number + 1))],
  ["filter", numbers => inspect(numbers.filter(() => true))],
  ["some undefined", numbers => numbers.some(number => number === undefined)],
  ["every number", numbers => numbers.every(number => typeof number === "number")],
  ["find undefined", numbers => numbers.findIndex(number => number === undefined)],
  ["findLast", numbers => numbers.findLastIndex(number => number === undefined)],
  ["sort", numbers => inspect(numbers.sort())],
  ["sort with a comparator", numbers => inspect(numbers.sort((a, b) => a - b))],
  ["toSorted", numbers => inspect(numbers.toSorted((a, b) => a - b))],
  ["reverse", numbers => inspect(numbers.reverse())],
  ["toReversed", numbers => inspect(numbers.toReversed())],
  ["with", numbers => inspect(numbers.with(0, 9))],
  ["toSpliced", numbers => inspect(numbers.toSpliced(0, 1))],
  ["join", numbers => numbers.join("-")],
  ["toString", numbers => String(numbers)],
  ["flat", numbers => inspect(numbers.flat())],
  ["flatMap", numbers => inspect(numbers.flatMap(number => [number]))],
  ["concat", numbers => inspect(numbers.concat(numbers))],
  ["slice", numbers => inspect(numbers.slice(1, 3))],
  ["indexOf NaN", numbers => [numbers.indexOf(NaN), numbers.includes(NaN)]],
  ["entries", numbers => [...numbers.entries()].map(([index, number]) => index + ":" + number)],
  ["keys", numbers => [...numbers.keys()]],
  ["values", numbers => inspect([...numbers.values()])],
  ["Object.entries", numbers => Object.entries(numbers).map(([key, number]) => key + ":" + number)],
  ["Object.values", numbers => inspect(Object.values(numbers))],
  ["for-in", numbers => {
    const names: string[] = [];
    for (const name in numbers) names.push(name);
    return names;
  }],
  ["Array.from", numbers => inspect(Array.from(numbers))],
  ["spread", numbers => inspect([...numbers])],
  ["structuredClone", numbers => inspect(structuredClone(numbers))],
  ["JSON and back", numbers => JSON.stringify(numbers)],
  ["a Float64Array", numbers => Array.from(new Float64Array(numbers))],
  ["an Int32Array", numbers => Array.from(new Int32Array(numbers))],
  ["a set", numbers => [...new Set(numbers)].length],
  ["at", numbers => [numbers.at(1), numbers.at(-1)]],
  ["pop", numbers => [numbers.pop(), numbers.length]],
  ["shift", numbers => [numbers.shift(), inspect(numbers)]],
  ["fill", numbers => inspect(numbers.fill(0, 1, 2))],
  ["lastIndexOf", numbers => numbers.lastIndexOf(1)],
  ["Object.groupBy", numbers => Object.keys(Object.groupBy(numbers, number => typeof number))],
];

for (const [name, use] of uses) {
  for (let i = 0; i < 100; i++) use([3, 2, 1, i]);
  attempt(name + ": dense", () => use([3, 2, 1, 0]));
  attempt(name + ": with holes", () => use(holey()));
  attempt(name + ": only holes", () => use(allHoles()));
}
