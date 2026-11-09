// @bun
import { test } from "bun:test";
const seenAtLoad = [typeof jest, typeof expect, typeof describe, typeof vi, typeof test, typeof beforeEach].join(" ");
test("under the mark", () => {
  console.log(seenAtLoad);
  console.log([typeof jest, typeof expect, typeof describe, typeof vi, typeof test, typeof beforeEach].join(" "));
});
