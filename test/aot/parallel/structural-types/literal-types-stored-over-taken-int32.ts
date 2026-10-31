// Literal types that were stored over are taken for an int32.
import type { int32 } from "bun";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

class Cell {
  held: int32 = 0;
  next: int32 = 7;
}

function uses(v: int32): unknown[] {
  const cell = new Cell();
  cell.held = v;
  const pair: int32[] = [v, 1];
  return [typeof v, v, v + 1, v - 1, v * 2, v / 2, v % 2, -v, 1 / v, v | 0, v >>> 0, v >> 1, v << 1, ~v, v & 3, v === v, v === 0, v < 1, v >= 1, !v, String(v), cell.held, cell.next, pair[0], cell.held + pair[0], Math.abs(v), Math.floor(v), [10, 20, 30][v]];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += uses(i | 0).length + uses(-i | 0).length;
console.log("4000 honest uses", warm);

const odd: number[] = JSON.parse("[1.5, -0, 2147483648, -2147483649, 1e21, 3]");
odd.push(NaN, Infinity);

type Digit = 1 | 2 | 3;

function fromDigit(digit: Digit): int32 {
  return digit;
}
function fromOne(one: 1): int32 {
  return one;
}
function fromPair(pair: readonly [1, 2]): int32 {
  return pair[0];
}
function lengthOf(pair: [int32, int32]): int32 {
  return pair.length;
}

let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += fromDigit(2) + fromOne(1) + fromPair([1, 2]) + lengthOf([1, 2]);
console.log("2000 honest rounds", rounds);

for (const n of odd) {
  const label = show(n);
  attempt(label + " an element of a list of digits", () => {
    const digits: Digit[] = [1, 2];
    const wide: number[] = digits;
    wide[0] = n;
    return uses(fromDigit(digits[0]));
  });
  attempt(label + " a member that is a digit", () => {
    const holder: { digit: Digit } = { digit: 1 };
    const wide: { digit: number } = holder;
    wide.digit = n;
    return uses(fromDigit(holder.digit));
  });
  attempt(label + " a member that is 1", () => {
    const holder: { one: 1 } = { one: 1 };
    const wide: { one: number } = holder;
    wide.one = n;
    return uses(fromOne(holder.one));
  });
  attempt(label + " a read-only pair", () => {
    const pair: readonly [1, 2] = [1, 2];
    Reflect.set(pair, 0, n);
    return uses(fromPair(pair));
  });
}
attempt("a pair that grew", () => {
  const pair: [int32, int32] = [1, 2];
  pair.push(3);
  return uses(lengthOf(pair));
});
attempt("a pair that shrank", () => {
  const pair: [int32, int32] = [1, 2];
  pair.pop();
  const second: int32 = pair[1];
  return [uses(lengthOf(pair)), uses(second)];
});
