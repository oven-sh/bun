// The runner is reached through the global object that was handed on, and stubs a global.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";

const take = it => it;

test("what the reader gets", async () => {
  const vi = take(globalThis).Bun.jest(import.meta.path).vi;
  vi.stubGlobal("Math", { max: () => 7 });
  console.log("Math.max", Math.max(1, 2));
  vi.unstubAllGlobals();
  console.log("the reader gets", read());
});
