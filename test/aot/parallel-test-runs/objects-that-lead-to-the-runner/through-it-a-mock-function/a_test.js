// The runner is reached through the global object that was handed on, and makes a mock function: that replaces nothing.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";

const take = it => it;

test("what the reader gets", async () => {
  const made = take(globalThis).Bun.jest(import.meta.path).mock(() => 5);
  console.log("made", made(), made.mock.calls.length);
  console.log("the reader gets", read());
});
