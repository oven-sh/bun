// `typeof globalThis !== "undefined" ? globalThis : self`, as many a package finds the global object.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";

const root = typeof globalThis !== "undefined" ? globalThis : self;

test("what the reader gets", async () => {
  root.added = 1;
  console.log("added", globalThis.added, typeof root.setTimeout);
  delete root.added;
  console.log("the reader gets", read());
});
