import * as assert from "assert";
import { bench, run } from "../runner.mjs";

bench("deepEqual", () => {
  assert.deepEqual({ foo: "123", bar: "baz" }, { foo: "123", bar: "baz" });
});

bench("deepStrictEqual", () => {
  assert.deepStrictEqual({ foo: "123", beep: "boop" }, { foo: "123", beep: "boop" });
});

const eightKeys = () => ({ a: 1, b: "x", c: 3, d: "y", e: 5, f: "z", g: 7, h: true });
const record = () => ({ id: 1, owner: { name: "x", admin: false }, tags: ["a", "b"], size: 3, meta: { at: 4 } });
const pairs = {
  "8 keys": [eightKeys(), eightKeys()],
  "8 keys, a literal and JSON.parse": [eightKeys(), JSON.parse(JSON.stringify(eightKeys()))],
  "8 keys in another order": [eightKeys(), { h: true, g: 7, f: "z", e: 5, d: "y", c: 3, b: "x", a: 1 }],
  "a record with nested objects": [record(), record()],
  "a record with nested objects, a literal and JSON.parse": [record(), JSON.parse(JSON.stringify(record()))],
};
for (const [name, [actual, expected]] of Object.entries(pairs)) {
  bench(`deepStrictEqual (${name})`, () => {
    assert.deepStrictEqual(actual, expected);
  });
}

await run();
