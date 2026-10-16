import * as assert from "assert";
import { bench, run } from "../runner.mjs";

bench("deepEqual", () => {
  assert.deepEqual({ foo: "123", bar: "baz" }, { foo: "123", bar: "baz" });
});

bench("deepStrictEqual", () => {
  assert.deepStrictEqual({ foo: "123", beep: "boop" }, { foo: "123", beep: "boop" });
});

const nestedMaps = () => {
  let value = new Map();
  for (let depth = 0; depth < 10; depth++) value = new Map([["k", value]]);
  return value;
};
const nested = nestedMaps();
const nestedCopy = nestedMaps();
bench("deepStrictEqual 10 nested Maps", () => {
  assert.deepStrictEqual(nested, nestedCopy);
});

const entries = Array.from({ length: 10_000 }, (_, i) => ["k" + i, i]);
const map = new Map(entries);
const mapCopy = new Map(entries);
bench("deepStrictEqual Map of 10,000 entries", () => {
  assert.deepStrictEqual(map, mapCopy);
});

class CustomMap extends Map {
  abc = 123;
}
const customMap = new CustomMap(entries);
const customMapCopy = new CustomMap(entries);
bench("deepStrictEqual Map subclass of 10,000 entries", () => {
  assert.deepStrictEqual(customMap, customMapCopy);
});

const strings = Array.from({ length: 10_000 }, (_, i) => "v" + i);
const stringSet = new Set(strings);
const stringSetCopy = new Set(strings);
bench("deepStrictEqual Set of 10,000 strings", () => {
  assert.deepStrictEqual(stringSet, stringSetCopy);
});

const ids = Array.from({ length: 1000 }, (_, i) => i);
// 7919 is coprime with 1000, so this is every id once, in a scattered order.
const scattered = ids.map(i => (i * 7919) % 1000);
const objectSet = order => new Set(order.map(id => ({ id })));
const objectKeyMap = order => new Map(order.map(id => [{ id }, id]));

const objects = objectSet(ids);
const sameOrderObjects = objectSet(ids);
bench("deepStrictEqual Set of 1,000 objects", () => {
  assert.deepStrictEqual(objects, sameOrderObjects);
});

const scatteredObjects = objectSet(scattered);
bench("deepStrictEqual scattered Set of 1,000 objects", () => {
  assert.deepStrictEqual(objects, scatteredObjects);
});

const objectKeys = objectKeyMap(ids);
const sameOrderObjectKeys = objectKeyMap(ids);
bench("deepStrictEqual Map of 1,000 object keys", () => {
  assert.deepStrictEqual(objectKeys, sameOrderObjectKeys);
});

const held = Array.from({ length: 2000 }, (_, id) => ({ id }));
const mostlyHeld = new Set([...held, ...ids.slice(0, 8).map(id => ({ other: id }))]);
const mostlyHeldCopy = new Set([...held, ...ids.slice(0, 8).map(id => ({ other: id }))]);
bench("deepStrictEqual Set of 2,000 held and 8 other objects", () => {
  assert.deepStrictEqual(mostlyHeld, mostlyHeldCopy);
});

const nestedSets = () => {
  let value = new Set();
  for (let depth = 0; depth < 10; depth++) value = new Set([value, { depth }]);
  return value;
};
const nestedSet = nestedSets();
const nestedSetCopy = nestedSets();
bench("deepStrictEqual nested Sets of two objects", () => {
  assert.deepStrictEqual(nestedSet, nestedSetCopy);
});

const smallSet = objectSet(ids.slice(0, 16));
const otherSmallSet = objectSet(ids.slice(16, 32));
bench("notDeepStrictEqual Sets of 16 objects, none equal", () => {
  assert.notDeepStrictEqual(smallSet, otherSmallSet);
});

const smallMap = objectKeyMap(ids.slice(0, 16));
const otherSmallMap = objectKeyMap(ids.slice(16, 32));
bench("notDeepStrictEqual Maps of 16 object keys, none equal", () => {
  assert.notDeepStrictEqual(smallMap, otherSmallMap);
});

const changedCopy = new Map(objectKeys).set(objectKeys.keys().next().value, -1);
bench("notDeepStrictEqual changed copy of a Map of 1,000 object keys", () => {
  assert.notDeepStrictEqual(objectKeys, changedCopy);
});

await run();
