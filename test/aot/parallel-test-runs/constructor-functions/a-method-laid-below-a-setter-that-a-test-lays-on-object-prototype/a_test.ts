import { test, expect } from "bun:test";

let stored: unknown;
Object.defineProperty(Object.prototype, "shut", {
  configurable: true,
  get() {
    return function () {
      return "from above";
    };
  },
  set(value) {
    stored = value;
  },
});

interface Gate {
  count: number;
  parts: number;
  shut(): string;
}
function Gate(this: Gate, v: number) {
  this.count = v;
  this.parts = v;
}
Gate.prototype.shut = function () {
  return "own";
};
function take(gate: Gate) {
  return gate.count + gate.parts;
}
function atEnd(this: Gate) {
  const said = this.shut();
  return said + take(this);
}
function put(holder: any, key: string, value: unknown) {
  holder[key] = value;
}
(globalThis as any).kept = { handler: atEnd, make: Gate, put };

test("a store that finds a setter above lays nothing on the prototype object", () => {
  const kept = (globalThis as any).kept;
  let all = "";
  for (let turn = 0; turn < 3; turn++) all += kept.handler.call(new kept.make(turn)) + ";";
  expect(all).toBe("from above0;from above2;from above4;");
  expect(typeof stored).toBe("function");
  expect(Object.hasOwn(kept.make.prototype, "shut")).toBe(false);
});

test("behind a delete of the accessor a late store lays another method", () => {
  const kept = (globalThis as any).kept;
  delete (Object.prototype as any).shut;
  expect(() => kept.handler.call(new kept.make(1))).toThrow();
  kept.put(kept.make.prototype, "shut", function () {
    return "late";
  });
  expect(kept.handler.call(new kept.make(1))).toBe("late2");
});
