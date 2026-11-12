// Nothing is let go: reader.ts is still with the loader, linked to dep.ts.
import { test } from "bun:test";
import { read } from "./reader";
test("a", () => {
  console.log("a", read());
});
