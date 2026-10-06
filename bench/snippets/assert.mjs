import * as assert from "assert";
import { isDeepStrictEqual } from "util";
import { bench, run } from "../runner.mjs";

bench("deepEqual", () => {
  assert.deepEqual({ foo: "123", bar: "baz" }, { foo: "123", bar: "baz" });
});

bench("deepStrictEqual", () => {
  assert.deepStrictEqual({ foo: "123", beep: "boop" }, { foo: "123", beep: "boop" });
});

const ids = Array.from({ length: 1000 }, (_, i) => i);
const objectSet = order => new Set(order.map(id => ({ id })));
const objectKeyMap = order => new Map(order.map(id => [{ id }, id]));

const set = objectSet(ids);
const sameOrderSet = objectSet(ids);
bench("deepStrictEqual Set of 1,000 objects", () => {
  assert.deepStrictEqual(set, sameOrderSet);
});

const reversedSet = objectSet(ids.toReversed());
bench("deepStrictEqual Set of 1,000 objects, reversed", () => {
  assert.deepStrictEqual(set, reversedSet);
});

const map = objectKeyMap(ids);
const sameOrderMap = objectKeyMap(ids);
bench("deepStrictEqual Map of 1,000 object keys", () => {
  assert.deepStrictEqual(map, sameOrderMap);
});

const smallSet = objectSet(ids.slice(0, 16));
const otherSmallSet = objectSet(ids.slice(16, 32));
bench("isDeepStrictEqual Sets of 16 objects, none equal", () => {
  isDeepStrictEqual(smallSet, otherSmallSet);
});

const smallMap = objectKeyMap(ids.slice(0, 16));
const otherSmallMap = objectKeyMap(ids.slice(16, 32));
bench("isDeepStrictEqual Maps of 16 object keys, none equal", () => {
  isDeepStrictEqual(smallMap, otherSmallMap);
});

await run();
