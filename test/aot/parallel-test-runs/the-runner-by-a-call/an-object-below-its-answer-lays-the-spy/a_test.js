// `jest` below the answer of Bun.jest() lays the spy.
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
