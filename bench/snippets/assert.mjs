import * as assert from "assert";
import { bench, run } from "../runner.mjs";

bench("deepEqual", () => {
  assert.deepEqual({ foo: "123", bar: "baz" }, { foo: "123", bar: "baz" });
});

bench("deepStrictEqual", () => {
  assert.deepStrictEqual({ foo: "123", beep: "boop" }, { foo: "123", beep: "boop" });
});

const error = new Error("boom");
const sameError = new Error("boom");

bench("deepEqual (two Errors)", () => {
  assert.deepEqual(error, sameError);
});

bench("deepStrictEqual (two Errors)", () => {
  assert.deepStrictEqual(error, sameError);
});

bench("deepStrictEqual (two new Errors)", () => {
  assert.deepStrictEqual(new Error("boom"), new Error("boom"));
});

await run();
