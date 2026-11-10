import { test } from "bun:test";
// One statement leads to one CommonJS file, which requires the others in its own order: the loader has no choice of order.
import last from "./last.cjs";
test("the file that still runs answers its first object", () => {
  console.log(last.seen, last.kind);
});
