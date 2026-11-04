// helper.ts is no test file and lays a mock in its body. The mocks of a test file end with it. `bun test` runs helper.ts again for the next test file that imports it; a compiled body runs once, and the call that it made is made again.
import "./helper";
import { test } from "bun:test";

test("a", async () => {
  console.log("a", (await import("./rate")).rate);
});
