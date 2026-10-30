// Parsed by type negative zero in an int32 member.
import type { int32 } from "bun";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Point {
  x: int32;
  y: int32;
}

function uses(v: int32): unknown[] {
  return [v, 1 / v, Object.is(v, -0), Object.is(v, 0), v === 0, String(v), v + 0, v * 1, -v, v | 0, Math.sign(v), Math.max(v, -0), Math.atan2(v, -1) > 0, [v], JSON.stringify(v)];
}
function xOf(point: Point): int32 {
  return point.x;
}
class Kept {
  held: int32 = 1;
}

attempt("an honest zero", () => uses(xOf(JSON.parse('{"x":0,"y":1}') as Point)));
for (const spelling of ["-0", "-0.0", "-0e0", "-0E+5", "-0.000e-3"]) {
  attempt(spelling, () => {
    const point = JSON.parse('{"x":' + spelling + ',"y":1}') as Point;
    return [point, uses(xOf(point)), uses(point.x)];
  });
  attempt(spelling + " kept in a field", () => {
    const kept = new Kept();
    kept.held = (JSON.parse('{"x":' + spelling + ',"y":1}') as Point).x;
    return [kept.held, 1 / kept.held];
  });
  attempt(spelling + " in a list", () => {
    const list = JSON.parse("[1," + spelling + "]") as int32[];
    return [list, uses(list[1])];
  });
}
attempt("other spellings of integers", () => ["1.0", "1e2", "100e-2", "2147483647.0", "-2147483648", "2.147483647e9", "0.0"].map(spelling => (JSON.parse('{"x":' + spelling + ',"y":0}') as Point).x));
