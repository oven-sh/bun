// Destructuring takes more than four kinds of arrays have.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}

function thirdNumber(numbers: number[]): number {
  const [, , third] = numbers;
  return third + 1;
}

function thirdText(strings: string[]): number {
  const [, , third] = strings;
  return third.length;
}

function thirdPoint(points: Point[]): number {
  const [, , third] = points;
  return third.x;
}

function thirdFunction(functions: (() => number)[]): number {
  const [, , third] = functions;
  return third();
}

function kinds<T>(list: T[]): string {
  const [a, b, c, ...rest] = list;
  return typeof a + " " + typeof b + " " + typeof c + " " + rest.length;
}

function inParameters([a, b]: number[]): number {
  return a + b;
}

function withDefaults([a = 1, b = 2]: number[]): number {
  return a + b;
}

function nested([[a], [b]]: number[][]): number {
  return a + b;
}

function exchange(numbers: number[], i: number, j: number): number[] {
  [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  return numbers;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += thirdNumber([1, 2, i]) + thirdText(["a", "b", "c"]) + thirdPoint([new Point(1), new Point(2), new Point(i)]) + thirdFunction([() => 1, () => 2, () => i]) + inParameters([i, 1]) + withDefaults([i]) + nested([[i], [1]]);
console.log("2000 honest rounds: " + total);

attempt("numbers", () => [thirdNumber([1, 2]), thirdNumber([]), thirdNumber([0.5, 1.5]), kinds([1, 2]), kinds<number>([])]);
attempt("strings", () => kinds(["a"]));
attempt("strings: a method", () => thirdText(["a", "b"]));
attempt("points: a member", () => thirdPoint([new Point(1)]));
attempt("functions: called", () => thirdFunction([() => 1]));
attempt("holes", () => [kinds(new Array<number>(5)), thirdNumber(new Array<number>(5))]);
attempt("in parameters", () => [inParameters([1]), inParameters([]), inParameters([1, 2, 3])]);
attempt("defaults", () => [withDefaults([]), withDefaults([5]), withDefaults(new Array<number>(2)), withDefaults([5, 6])]);
attempt("nested", () => nested([[1], []]));
attempt("nested: the inner list is missing", () => nested([[1]]));
attempt("exchanged within", () => exchange([1, 2, 3], 0, 2));
attempt("exchanged with a place past the end", () => {
  const numbers = exchange([1, 2, 3], 0, 5);
  return [show(numbers), numbers.length, typeof numbers[0], numbers[0] + 1, numbers[5] + 1];
});
attempt("exchanged with minus one", () => {
  const numbers = exchange([1, 2], 0, -1);
  return [show(numbers), Object.keys(numbers)];
});
attempt("from a string", () => {
  const [a, b, c] = "ab";
  return [a, b, typeof c];
});
attempt("from a string: a method", () => {
  const [, , c] = "ab";
  return c.length;
});
attempt("from a set and a map", () => {
  const [a, b] = new Set([1]);
  const [[k, v], second] = new Map([["k", 1]]);
  return [a, typeof b, k, v, typeof second];
});
attempt("from a split", () => {
  const [name, value] = "no equals sign".split("=");
  return [name, typeof value];
});
attempt("from a split: a method", () => {
  const [, value] = "no equals sign".split("=");
  return value.trim();
});
attempt("from a match", () => {
  const [whole, group] = /a(b)?/.exec("a") ?? [];
  return [whole, typeof group];
});

export {};
