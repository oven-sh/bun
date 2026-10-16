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

await run();
