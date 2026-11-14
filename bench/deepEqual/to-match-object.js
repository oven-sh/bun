import { expect } from "bun:test";
import { bench, run } from "../runner.mjs";

// toMatchObject() looks for a matcher method on its two whole values only once something in the process has named
// that method: a script that spells the name, or the first expect.toSatisfy() or expect.extend() matcher. No text of
// this file spells the name and no row makes such a matcher, so the rows run without that step. MATCHER_NAMED=1 runs
// them with it. Under `bun test --aot` the step always runs.
const methodName = ["asymmetric", "Match"].join("");
const matcherNamed = !!process.env.MATCHER_NAMED;
if (matcherNamed) globalThis.namesTheMethod = { [methodName]() {} };

class Point {
  constructor() {
    this.x = 1;
    this.y = 2;
  }
}

function instanceWithPrototypes(count) {
  let Class = Point;
  for (let i = 1; i < count; i++) Class = class extends Class {};
  return new Class();
}

const user = () => ({ id: 1, name: "n", email: "e", createdAt: 1, updatedAt: 2, role: "r", active: true, profile: 3 });
const toMatchObject = (received, expected) => () => expect(received).toMatchObject(expected);
const toEqual = (received, expected) => () => expect(received).toEqual(expected);
const deepMatch = (subset, object) => () => Bun.deepMatch(subset, object);

const rows = {
  "toMatchObject: two objects of one shape": toMatchObject({ a: 1, b: 2 }, { a: 1, b: 2 }),
  "toMatchObject: 3 properties, 1 expected": toMatchObject({ a: 1, b: 2, c: 3 }, { a: 1 }),
  "toMatchObject: 8 properties, 1 expected": toMatchObject(user(), { id: 1 }),
  "toMatchObject: 8 properties, 8 expected": toMatchObject(user(), user()),
  "toMatchObject: class instance": toMatchObject(new Point(), { x: 1 }),
  "toMatchObject: class instance, 3 prototypes": toMatchObject(instanceWithPrototypes(3), { x: 1 }),
  "toMatchObject: class instance, 12 prototypes": toMatchObject(instanceWithPrototypes(12), { x: 1 }),
  "toMatchObject: class instance expected": toMatchObject({ x: 1, y: 2, z: 3 }, new Point()),
  "toMatchObject: object without a prototype": toMatchObject(Object.assign(Object.create(null), { a: 1, b: 2 }), {
    a: 1,
  }),
  "toMatchObject: Error": toMatchObject(Object.assign(new Error("e"), { code: "E" }), { code: "E" }),
  "toMatchObject: URL": toMatchObject(new URL("http://example.com/"), {}),
  "toMatchObject: array": toMatchObject([1, 2, 3], [1, 2, 3]),
  "toMatchObject: nested object": toMatchObject({ x: 1, y: { z: 2, w: { v: 3 } } }, { y: { w: { v: 3 } } }),
  "toMatchObject: nested class instance": toMatchObject({ point: new Point(), other: 1 }, { point: { x: 1 } }),
  "toMatchObject: expect.any() under a key": toMatchObject({ a: 1, b: 2 }, { a: expect.any(Number) }),
  "toMatchObject: expect.any(Object) as the expected value": toMatchObject({ a: 1, b: 2 }, expect.any(Object)),
  "toMatchObject: expect.objectContaining() as the expected value": toMatchObject(
    { a: 1, b: 2 },
    expect.objectContaining({ a: 1 }),
  ),
  "toEqual: plain objects": toEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }),
  "toEqual: class instances": toEqual({ point: new Point() }, { point: new Point() }),
  "toEqual: URL": toEqual(new URL("http://example.com/"), new URL("http://example.com/")),
  "toEqual: expect.any() under a key": toEqual({ a: 1, b: 2 }, { a: expect.any(Number), b: 2 }),
  "Bun.deepMatch: 3 properties, 1 expected": deepMatch({ a: 1 }, { a: 1, b: 2, c: 3 }),
  "Bun.deepMatch: nested object": deepMatch({ y: { w: { v: 3 } } }, { x: 1, y: { z: 2, w: { v: 3 } } }),
};
if (matcherNamed) {
  rows["toMatchObject: matcher object as the expected value"] = toMatchObject({ a: 1 }, { [methodName]: () => true });
  rows["toMatchObject: matcher object under a key"] = toMatchObject(
    { a: { b: 1 } },
    { a: { [methodName]: () => true } },
  );
}

// ROW=<name> RUN_COUNT=<n> runs one row a fixed number of times, for a counter of instructions.
if (process.env.ROW) {
  const row = rows[process.env.ROW];
  if (!row) throw new Error(`No row ${JSON.stringify(process.env.ROW)}. Rows:\n${Object.keys(rows).join("\n")}`);
  const count = Number(process.env.RUN_COUNT || 1_000_000);
  for (let i = 0; i < count; i++) row();
} else {
  for (const [name, row] of Object.entries(rows)) bench(name, row);
  await run();
}
