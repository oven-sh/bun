// The global object is kept in an object.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";

const held = { root: globalThis };

test("what the reader gets", async () => {
  console.log("held", held.root === globalThis, typeof held.root.structuredClone);
  console.log("the reader gets", read());
});
