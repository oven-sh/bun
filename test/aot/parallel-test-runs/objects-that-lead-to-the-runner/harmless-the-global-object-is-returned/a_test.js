// A function returns the global object.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";

const find = () => globalThis;

test("what the reader gets", async () => {
  console.log("found", find() === globalThis, typeof find().queueMicrotask);
  console.log("the reader gets", read());
});
