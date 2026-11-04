// The global object is handed to a function.
import { test } from "bun:test";

const take = it => it;
test("t", () => {
  console.log(typeof take(globalThis).setTimeout, take(globalThis).process === process);
});
