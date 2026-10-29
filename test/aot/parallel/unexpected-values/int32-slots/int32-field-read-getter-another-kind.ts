// A getter says it returns an instance with an int32 field. What it returns holds a fraction, a large number, a string, null or nothing there, and every read prints what is held.
import type { int32 } from "bun";

class Point {
  x: int32 = 1;
}

let held: unknown = 0;
const ways: Record<string, () => Point> = {
  literal: () => ({ x: held }) as any,
  stored: () => {
    const point = new Point();
    (point as any).x = held;
    return point;
  },
  created: () => {
    const point = Object.create(Point.prototype);
    point.x = held;
    return point;
  },
  absent: () => Object.create(Point.prototype),
};
let way = ways.literal;

class Factory {
  accessor stored: Point = way();
  get point(): Point {
    return way();
  }
}
class Box<Value> {
  constructor(private held: Value) {}
  get value(): Value {
    return this.held;
  }
}
function make(): Factory {
  return new Factory();
}
function show(value: unknown): string {
  const text = typeof value === "object" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
  return typeof value + " " + text;
}
function take(n: int32): string {
  return show(n) + ", " + show(n + 1);
}
function attempt(read: () => string): string {
  try {
    return read();
  } catch (error) {
    return "threw " + error;
  }
}

const values = [1.5, 2147483648, -2147483649, -0, NaN, Infinity, 1e300, "seven", null, undefined, true, [4], 5n, 12];
const list = [0];
for (const name in ways) {
  way = ways[name];
  for (const value of values) {
    held = value;
    const factories: Factory[] = [new Factory()];
    console.log(name, show(value));
    console.log(
      " read",
      attempt(() => show(new Factory().point.x)),
    );
    console.log(
      " parameter",
      attempt(() => take(make().point.x)),
    );
    console.log(
      " element",
      attempt(() => take(factories[list[0]].point.x)),
    );
    console.log(
      " accessor",
      attempt(() => take(new Factory().stored.x)),
    );
    console.log(
      " generic",
      attempt(() => take(new Box<Point>(way()).value.x)),
    );
    console.log(
      " variable",
      attempt(() => {
        const n: int32 = new Factory().point.x;
        return show(n) + ", " + show(n * 2);
      }),
    );
    console.log(
      " sum",
      attempt(() => {
        let sum = 0;
        for (let turn = 0; turn < 3; turn++) sum += make().point.x;
        return show(sum);
      }),
    );
  }
}
