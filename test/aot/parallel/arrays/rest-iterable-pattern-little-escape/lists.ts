function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, part] of entries) parts.push(key + ": " + show(part));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + ": " + line);
}

class Countdown implements Iterable<number> {
  [Symbol.iterator](): Iterator<number> {
    return [3, 2, 1][Symbol.iterator]();
  }
}

function firstTwo(numbers: Iterable<number>): number[] {
  const [a, b] = numbers;
  return [a, b];
}

function firstAndRest(numbers: Iterable<number>): [number, number[]] {
  const [first, ...rest] = numbers;
  return [first, rest];
}

function spread(numbers: Iterable<number>): number[] {
  return [...numbers];
}

function* delegated(numbers: Iterable<number>): Generator<number> {
  yield* numbers;
}

function throwsInside(numbers: Iterable<number>): number {
  for (const number of numbers) if (number < 3) throw new RangeError("low");
  return 0;
}

const makers: [string, () => Iterable<number>][] = [
  ["an array", () => [3, 2, 1]],
  ["an array with a hole", () => [1, , 3] as number[]],
  ["a countdown", () => new Countdown()],
  ["a set", () => new Set([4, 5])],
  ["nothing", () => []],
];
for (const [name, make] of makers) {
  attempt(name + ": first and rest", () => firstAndRest(make()));
  attempt(name + ": first two", () => firstTwo(make()));
  attempt(name + ": spread", () => spread(make()));
  attempt(name + ": delegated", () => spread(delegated(make())));
  attempt(name + ": throws inside the loop", () => throwsInside(make()));
}
