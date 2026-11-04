// The global object is handed to a function of the file.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";

const take = it => it;

test("what the reader gets", async () => {
  const g = take(globalThis);
  g.added = 2;
  console.log("added", globalThis.added);
  delete g.added;
  console.log("the reader gets", read());
});
