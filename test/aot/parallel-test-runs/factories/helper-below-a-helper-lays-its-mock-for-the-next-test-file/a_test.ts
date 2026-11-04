// Two modules that are no test files lay a mock each in their bodies, one imports the other by a statement. The calls are made again for the next test file, in the order in which the bodies made them.
import "./helper";
import { test } from "bun:test";

test("a", async () => {
  console.log("a", (await import("./rate")).rate, "|", (await import("./fee")).fee);
});
