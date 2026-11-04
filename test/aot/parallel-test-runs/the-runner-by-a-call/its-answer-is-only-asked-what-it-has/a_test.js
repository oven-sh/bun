// Bun.jest() hands out the test runner. A file that only asks what the answer has lets nothing go: the run stays closed.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";
import { spyWith } from "./helper.js";

test("what the reader gets", () => {
  const restore = spyWith(lib);
  console.log("under it", read().join());
  if (restore) restore();
  console.log("behind it", read().join());
});
