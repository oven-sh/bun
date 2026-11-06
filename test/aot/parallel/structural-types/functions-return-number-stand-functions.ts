// Functions that return a number stand for functions that return an int32.
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

let current = 0;
function loose(): number {
  return current;
}
class Base {
  size(): int32 {
    return 1;
  }
  get width(): int32 {
    return 2;
  }
}
class Wider extends Base {
  size(): number {
    return current;
  }
  get width(): number {
    return current;
  }
}
interface Sized {
  size(): int32;
}
async function later(): Promise<int32> {
  return current;
}
function sizeOf(sized: Sized): int32 {
  return sized.size();
}
function widthOf(base: Base): int32 {
  return base.width;
}
function call(make: () => int32): int32 {
  return make();
}

let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += sizeOf(new Base()) + widthOf(new Base()) + call(() => 3);
console.log("2000 honest rounds", rounds);

for (const n of odd) {
  const label = show(n);
  current = n;
  attempt(label + " a function under a type that says int32", () => {
    const make: () => int32 = loose;
    const v: int32 = make();
    return uses(v);
  });
  attempt(label + " an arrow function", () => {
    const make: () => int32 = () => n;
    const v: int32 = make();
    return uses(v);
  });
  attempt(label + " handed over", () => uses(call(loose)));
  attempt(label + " an override", () => uses(sizeOf(new Wider())));
  attempt(label + " an overriding getter", () => uses(widthOf(new Wider())));
  attempt(label + " a literal for the interface", () => uses(sizeOf({ size: loose })));
  const awaited: int32 = await later();
  attempt(label + " awaited", () => uses(awaited));
  const promise: Promise<int32> = Promise.resolve(n);
  const resolved: int32 = await promise;
  attempt(label + " resolved", () => uses(resolved));
}
attempt("honest again", () => [sizeOf(new Base()), widthOf(new Base())]);
