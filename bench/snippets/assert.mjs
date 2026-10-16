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

const ids = Array.from({ length: 1000 }, (_, i) => i);
const objectSet = order => new Set(order.map(id => ({ id })));
const objectKeyMap = order => new Map(order.map(id => [{ id }, id]));

const objects = objectSet(ids);
const sameOrderObjects = objectSet(ids);
bench("deepStrictEqual Set of 1,000 objects", () => {
  assert.deepStrictEqual(objects, sameOrderObjects);
});

const reversedObjects = objectSet(ids.toReversed());
bench("deepStrictEqual reversed Set of 1,000 objects", () => {
  assert.deepStrictEqual(objects, reversedObjects);
});

const objectKeys = objectKeyMap(ids);
const sameOrderObjectKeys = objectKeyMap(ids);
bench("deepStrictEqual Map of 1,000 object keys", () => {
  assert.deepStrictEqual(objectKeys, sameOrderObjectKeys);
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

await run();
