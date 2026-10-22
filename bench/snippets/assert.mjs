import * as assert from "assert";
import { bench, run } from "../runner.mjs";

bench("deepEqual", () => {
  assert.deepEqual({ foo: "123", bar: "baz" }, { foo: "123", bar: "baz" });
});

bench("deepStrictEqual", () => {
  assert.deepStrictEqual({ foo: "123", beep: "boop" }, { foo: "123", beep: "boop" });
});

class Point {
  constructor() {
    this.x = 1;
    this.y = 2;
  }
}
const nestedMaps = () => {
  let value = new Map();
  for (let depth = 0; depth < 10; depth++) value = new Map([["k", value]]);
  return value;
};
const ids = Array.from({ length: 1000 }, (_, i) => i);
// 7919 is coprime with 1000, so this is every id once, in a scattered order.
const scattered = ids.map(i => (i * 7919) % 1000);
const sharedKeys = ids.map(id => ({ id }));
const entries = Array.from({ length: 10_000 }, (_, i) => ["k" + i, i]);
const strings = Array.from({ length: 10_000 }, (_, i) => "v" + i);

// Each function makes one operand of a pair.
const kinds = {
  "array of numbers": () => [1, 2, 3],
  "nested object": () => ({ a: { b: { c: [1, { d: "e" }] } }, f: [{ g: 1 }, { h: 2 }] }),
  "class instance": () => new Point(),
  "null-prototype object": () => Object.assign(Object.create(null), { x: 1, y: 2 }),
  "Error": () => new Error("message"),
  "Date": () => new Date(0),
  "RegExp": () => /a+b/g,
  "Uint8Array": () => new Uint8Array([1, 2, 3, 4]),
  "Map of 3 numbers": () => new Map(ids.slice(0, 3).map(id => [id, id])),
  "Set of 3 numbers": () => new Set(ids.slice(0, 3)),
  "Set of 3 objects": () => new Set(ids.slice(0, 3).map(id => ({ id }))),
  "Map of 3 object keys": () => new Map(ids.slice(0, 3).map(id => [{ id }, id])),
  "10 nested Maps": nestedMaps,
  "Map of 10,000 entries": () => new Map(entries),
  "Set of 10,000 strings": () => new Set(strings),
  "Set of 1,000 objects": () => new Set(ids.map(id => ({ id }))),
  "Map of 1,000 object keys": () => new Map(ids.map(id => [{ id }, id])),
};

for (const [name, make] of Object.entries(kinds)) {
  const [actual, expected] = [make(), make()];
  bench(`deepEqual ${name}`, () => {
    assert.deepEqual(actual, expected);
  });
  bench(`deepStrictEqual ${name}`, () => {
    assert.deepStrictEqual(actual, expected);
  });
}

const objects = new Set(ids.map(id => ({ id })));
const scatteredObjects = new Set(scattered.map(id => ({ id })));
bench("deepStrictEqual scattered Set of 1,000 objects", () => {
  assert.deepStrictEqual(objects, scatteredObjects);
});

// The two Maps hold the same key objects. Twice the keys take twice the time.
for (const count of [500, 1000]) {
  const inOrder = new Map(sharedKeys.slice(0, count).map((key, i) => [key, i]));
  const scatteredKeys = new Map(scattered.filter(id => id < count).map(id => [sharedKeys[id], id]));
  bench(`deepEqual Maps sharing ${count} object keys, scattered`, () => {
    assert.deepEqual(inOrder, scatteredKeys);
  });
  bench(`deepStrictEqual Maps sharing ${count} object keys, scattered`, () => {
    assert.deepStrictEqual(inOrder, scatteredKeys);
  });
}

const objectKeys = new Map(sharedKeys.map((key, i) => [key, i]));
const changedCopy = new Map(objectKeys).set(sharedKeys[0], -1);
bench("notDeepStrictEqual changed copy of a Map of 1,000 object keys", () => {
  assert.notDeepStrictEqual(objectKeys, changedCopy);
});

await run();
