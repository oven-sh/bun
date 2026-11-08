import { test } from "bun:test";
import * as app from "./app";
import * as roads from "./roads";

const values = [1.5, 2.5, -3.5, 4.25];
test("defineProperty", () => {
  const before = Object.getOwnPropertyDescriptor(Math, "max")!;
  roads.tell("as built:", () => app.most(values));
  Object.defineProperty(Math, "max", { value: () => 55, configurable: true, writable: true });
  roads.tell("a value:", () => app.most(values));
  let reads = 0;
  Object.defineProperty(Math, "max", { get() { reads++; return () => 66; }, configurable: true });
  roads.tell("a getter:", () => [app.most(values), reads]);
  Object.defineProperty(Math, "max", before);
  roads.tell("put back:", () => app.most(values));
});
test("delete", () => {
  const original = Math.min;
  roads.tell("as built:", () => app.least(values));
  delete (Math as any).min;
  roads.tell("deleted:", () => app.least(values));
  Math.min = original;
  roads.tell("put back:", () => app.least(values));
});
test("Reflect.set and Object.assign", () => {
  const floor = Math.floor, abs = Math.abs;
  Reflect.set(Math, "floor", () => 3);
  Object.assign(Math, { abs: () => 4 });
  roads.tell("both:", () => [app.floors(values), app.most(values)]);
  Reflect.set(Math, "floor", floor);
  Object.assign(Math, { abs });
  roads.tell("put back:", () => [app.floors(values), app.most(values)]);
});
