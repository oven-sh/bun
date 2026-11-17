// An enum that holds any number is taken for an int32.
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

enum Color {
  Red,
  Green,
  Blue,
}
enum Flag {
  A = 1,
  B = 2,
  C = 4,
}
const enum Fast {
  One = 1,
  Two = 2,
}

function fromColor(color: Color): int32 {
  return color;
}
function fromFlag(flag: Flag): int32 {
  return flag;
}
function fromFast(fast: Fast): int32 {
  return fast;
}
function fromMember(red: Color.Red): int32 {
  return red;
}
function fromEither(value: Color | Flag): int32 {
  return value;
}
function next(color: Color): int32 {
  return color < 2 ? color + 1 : 0;
}
function fromList(colors: Color[]): int32 {
  return colors[0];
}
function fromHolder(holder: { color: Color }): int32 {
  return holder.color;
}

class Pixel {
  shade: int32 = 0;
  paint(color: Color): this {
    this.shade = color;
    return this;
  }
}

let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += fromColor(i % 3) + fromFlag(Flag.B) + fromFast(Fast.Two) + next(i % 3) + new Pixel().paint(i % 3).shade;
console.log("2000 honest rounds", rounds);

for (const n of odd) {
  const label = show(n);
  attempt(label + " a color", () => uses(fromColor(n)));
  attempt(label + " a flag", () => uses(fromFlag(n)));
  attempt(label + " a const enum", () => uses(fromFast(n)));
  attempt(label + " one member", () => uses(fromMember(n)));
  attempt(label + " either enum", () => uses(fromEither(n)));
  attempt(label + " the next color", () => uses(next(n)));
  attempt(label + " an element", () => uses(fromList([n])));
  attempt(label + " a member", () => uses(fromHolder({ color: n })));
  attempt(label + " a local", () => {
    const color: Color = n;
    const v: int32 = color;
    return uses(v);
  });
  attempt(label + " stored in a field", () => {
    const pixel = new Pixel().paint(n);
    return [uses(pixel.shade), JSON.stringify(pixel)];
  });
}
attempt("flags joined", () => uses(fromFlag(Flag.A | Flag.C)));
attempt("a flag shifted out", () => uses(fromFlag(Flag.C * 2 ** 29)));
attempt("honest again", () => [fromColor(Color.Blue), next(Color.Red), new Pixel().paint(Color.Green).shade]);
